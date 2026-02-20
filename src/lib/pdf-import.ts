import { Resident, AccessEntry } from '@/types';
import { supabase } from '@/integrations/supabase/client';

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check if extracted text quality is good enough
 */
function isTextQualityGood(text: string): boolean {
  if (!text || text.trim().length < 50) return false;
  const letterCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  return letterCount > 30;
}

/**
 * Extract text from a scanned PDF using OCR via AI
 */
export async function extractTextWithOCR(arrayBuffer: ArrayBuffer, fileName?: string): Promise<string> {
  const pdfBase64 = arrayBufferToBase64(arrayBuffer);

  const { data, error } = await supabase.functions.invoke('pdf-ocr', {
    body: { pdfBase64, fileName },
  });

  if (error) {
    console.error('OCR edge function error:', error);
    throw new Error(`Erro no OCR: ${error.message}`);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data?.text || '';
}

/**
 * Smart extraction: tries native first, falls back to OCR
 */
export async function smartExtractText(arrayBuffer: ArrayBuffer, fileName?: string): Promise<{ text: string; method: 'native' | 'ocr' }> {
  try {
    const nativeText = await extractTextFromPDF(arrayBuffer);
    if (isTextQualityGood(nativeText)) {
      return { text: nativeText, method: 'native' };
    }
  } catch (e) {
    console.warn('Native PDF extraction failed, trying OCR...', e);
  }

  // Fallback to OCR
  const ocrText = await extractTextWithOCR(arrayBuffer, fileName);
  return { text: ocrText, method: 'ocr' };
}
let pdfjsInitialized = false;

/**
 * Extract text from a PDF file using pdfjs-dist (browser-compatible)
 */
export async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');

  // Configure worker only once, using the correct CDN path for v4
  if (!pdfjsInitialized) {
    const workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    pdfjsInitialized = true;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    
    // Group items by their Y position to reconstruct lines
    const items = content.items.filter((item: any) => 'str' in item && item.str.trim());
    
    if (items.length === 0) continue;

    // Sort by Y (descending = top to bottom) then X (left to right)
    const sorted = [...items].sort((a: any, b: any) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 3) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    const lines: string[] = [];
    let currentLine: string[] = [];
    let lastY = (sorted[0] as any).transform[5];

    for (const item of sorted) {
      const y = (item as any).transform[5];
      if (Math.abs(y - lastY) > 3) {
        if (currentLine.length > 0) {
          lines.push(currentLine.join('  '));
        }
        currentLine = [];
        lastY = y;
      }
      currentLine.push((item as any).str);
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join('  '));
    }

    pages.push(lines.join('\n'));
  }

  return pages.join('\n');
}

interface ParsedResident {
  name: string;
  apartment: string;
  cpf?: string;
  phone?: string;
  email?: string;
}

/**
 * Try multiple patterns to extract resident data from PDF text.
 * Returns parsed residents found by all strategies combined.
 */
export function parseResidentsFromText(rawText: string): ParsedResident[] {
  const results: ParsedResident[] = [];
  const seen = new Set<string>();

  const addResult = (r: ParsedResident) => {
    const key = `${r.name.toLowerCase().trim()}|${r.apartment.toLowerCase().trim()}`;
    if (!seen.has(key) && r.name.trim().length > 1 && r.apartment.trim().length > 0) {
      seen.add(key);
      results.push({
        name: r.name.trim(),
        apartment: r.apartment.trim(),
        cpf: r.cpf?.trim() || undefined,
        phone: r.phone?.trim() || undefined,
        email: r.email?.trim() || undefined,
      });
    }
  };

  // Normalize text: collapse multiple spaces, fix common OCR issues
  const text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Strategy 1: Pipe-separated (Nome | Apto | Telefone)
  for (const line of lines) {
    const match = line.match(/^(.+?)\s*\|\s*(.+?)\s*(?:\|\s*(.+?))?$/);
    if (match && match[1] && match[2]) {
      addResult({ name: match[1], apartment: match[2], phone: match[3] || undefined });
    }
  }

  // Strategy 2: Tab-separated or multi-space separated table rows
  for (const line of lines) {
    const parts = line.split(/\t+/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      // Try multi-space split (common in PDF tables)
      const spaceParts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (spaceParts.length >= 2) {
        parts.length = 0;
        parts.push(...spaceParts);
      }
    }
    if (parts.length >= 2) {
      // Skip header rows
      const headerWords = ['nome', 'name', 'apartamento', 'apto', 'apt', 'telefone', 'phone', 'cpf', 'email', 'morador', 'unidade', 'bloco'];
      const isHeader = parts.some(p => headerWords.includes(p.toLowerCase()));
      if (isHeader) continue;

      // Skip numeric-only or very short entries
      if (/^\d+$/.test(parts[0]) || parts[0].length < 2) continue;

      const resident: ParsedResident = { name: '', apartment: '' };

      // Detect which column is which by content patterns
      const cpfPattern = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
      const phonePattern = /^\(?\d{2}\)?\s?\d{4,5}-?\d{4}$/;
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const aptPattern = /^(apto?\.?\s*|apt\.?\s*|bloco?\s*|torre?\s*|casa?\s*|un\.?\s*)?\d{1,4}\w{0,2}$/i;

      for (const part of parts) {
        if (cpfPattern.test(part)) {
          resident.cpf = part;
        } else if (phonePattern.test(part)) {
          resident.phone = part;
        } else if (emailPattern.test(part)) {
          resident.email = part;
        } else if (aptPattern.test(part) && !resident.apartment) {
          resident.apartment = part;
        } else if (!resident.name) {
          resident.name = part;
        } else if (!resident.apartment) {
          resident.apartment = part;
        }
      }

      if (resident.name && resident.apartment) {
        addResult(resident);
      }
    }
  }

  // Strategy 3: Semicolon-separated (CSV-style)
  for (const line of lines) {
    const parts = line.split(';').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const headerWords = ['nome', 'apartamento', 'cpf', 'telefone'];
      if (parts.some(p => headerWords.includes(p.toLowerCase()))) continue;

      addResult({
        name: parts[0],
        apartment: parts[1],
        cpf: parts[2] || undefined,
        phone: parts[3] || undefined,
        email: parts[4] || undefined,
      });
    }
  }

  // Strategy 4: "Name - Apto XXX" or "Name – Apt 101" inline format
  for (const line of lines) {
    const match = line.match(/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)+)\s*[-–—]\s*((?:apto?\.?\s*|apt\.?\s*|bloco?\s*|casa?\s*|un\.?\s*)?[\d]+\w{0,2})/i);
    if (match) {
      addResult({ name: match[1], apartment: match[2] });
    }
  }

  // Strategy 5: Labeled fields across lines
  // E.g. "Nome: João Silva\nApartamento: 101\nTelefone: ..."
  const fullText = lines.join('\n');
  const labelBlocks = fullText.split(/(?=(?:nome|morador|proprietário)\s*:)/i);
  for (const block of labelBlocks) {
    const nameMatch = block.match(/(?:nome|morador|proprietário)\s*:\s*(.+)/i);
    const aptMatch = block.match(/(?:apartamento|apto|apt|unidade|casa|bloco)\s*:?\s*([\d]+\w{0,2})/i);
    if (nameMatch && aptMatch) {
      const cpfMatch = block.match(/cpf\s*:?\s*([\d.\-/]+)/i);
      const phoneMatch = block.match(/(?:telefone|tel|celular|fone)\s*:?\s*([\d()\s\-+]+)/i);
      const emailMatch = block.match(/(?:e-?mail)\s*:?\s*([^\s@]+@[^\s@]+\.[^\s@]+)/i);
      addResult({
        name: nameMatch[1].replace(/\s+/g, ' ').trim(),
        apartment: aptMatch[1],
        cpf: cpfMatch?.[1],
        phone: phoneMatch?.[1]?.trim(),
        email: emailMatch?.[1],
      });
    }
  }

  // Strategy 6: Comma-separated
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 6) {
      const headerWords = ['nome', 'apartamento', 'cpf', 'telefone', 'name'];
      if (parts.some(p => headerWords.includes(p.toLowerCase()))) continue;
      // First part should look like a name (at least 2 words or >5 chars)
      if (parts[0].split(/\s+/).length >= 2 || parts[0].length > 5) {
        addResult({
          name: parts[0],
          apartment: parts[1],
          cpf: parts[2] || undefined,
          phone: parts[3] || undefined,
          email: parts[4] || undefined,
        });
      }
    }
  }

  return results;
}

/**
 * Convert parsed residents to the app's Resident type
 */
export function parsedToResident(parsed: ParsedResident): Resident {
  return {
    id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: parsed.name,
    apartment: parsed.apartment,
    cpf: parsed.cpf || '',
    phone: parsed.phone || '',
    email: parsed.email || '',
    photo: '',
    vehiclePlate: '',
    vehicleModel: '',
    vehicleColor: '',
    vehicleTag: '',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Parsed access entry from imported text
 */
interface ParsedAccessEntry {
  visitorName: string;
  visitorDocument: string;
  visitorType: 'visitor' | 'service_provider';
  apartment: string;
  residentName?: string;
  purpose?: string;
  entryTime?: string;
  exitTime?: string;
  company?: string;
  vehiclePlate?: string;
  badgeNumber?: string;
}

/**
 * Try to parse a date/time string in common BR formats
 */
function parseBRDateTime(str: string): string | null {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  // dd/mm/yyyy HH:mm or dd/mm/yyyy HH:mm:ss
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m1) {
    return new Date(+m1[3], +m1[2] - 1, +m1[1], +m1[4], +m1[5], +(m1[6] || 0)).toISOString();
  }
  // yyyy-mm-dd HH:mm or ISO
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m2) {
    return new Date(s).toISOString();
  }
  // dd/mm/yyyy only
  const m3 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m3) {
    return new Date(+m3[3], +m3[2] - 1, +m3[1]).toISOString();
  }
  return null;
}

/**
 * Detect if text looks like access entries (visitors) rather than residents
 */
export function detectTextType(rawText: string): 'residents' | 'access_entries' | 'unknown' {
  const lower = rawText.toLowerCase();
  const accessKeywords = ['visitante', 'prestador', 'entrada', 'saída', 'saida', 'crachá', 'cracha', 'visitor', 'badge', 'empresa', 'motivo', 'documento', 'rg/cpf', 'horário', 'horario'];
  const residentKeywords = ['morador', 'proprietário', 'proprietario', 'resident', 'condômino', 'condomino', 'inquilino'];
  
  let accessScore = 0;
  let residentScore = 0;
  
  for (const kw of accessKeywords) {
    const count = (lower.match(new RegExp(kw, 'g')) || []).length;
    accessScore += count;
  }
  for (const kw of residentKeywords) {
    const count = (lower.match(new RegExp(kw, 'g')) || []).length;
    residentScore += count;
  }
  
  // Also check for date/time patterns typical of access logs
  const dateTimePatterns = (lower.match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g) || []).length;
  accessScore += dateTimePatterns * 2;
  
  if (accessScore > residentScore + 2) return 'access_entries';
  if (residentScore > accessScore) return 'residents';
  if (accessScore > 0) return 'access_entries';
  return 'unknown';
}

/**
 * Parse access entries from text extracted from PDF/CSV
 */
export function parseAccessEntriesFromText(rawText: string): ParsedAccessEntry[] {
  const results: ParsedAccessEntry[] = [];
  const seen = new Set<string>();

  const addResult = (r: ParsedAccessEntry) => {
    const key = `${r.visitorName.toLowerCase().trim()}|${r.apartment.toLowerCase().trim()}|${r.entryTime || ''}`;
    if (!seen.has(key) && r.visitorName.trim().length > 1 && r.apartment.trim().length > 0) {
      seen.add(key);
      results.push({
        ...r,
        visitorName: r.visitorName.trim(),
        apartment: r.apartment.trim(),
        visitorDocument: r.visitorDocument?.trim() || '',
      });
    }
  };

  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Strategy 1: Tab or multi-space separated table rows
  const headerWords = ['visitante', 'nome', 'documento', 'rg', 'cpf', 'apartamento', 'apto', 'apt', 'entrada', 'saída', 'saida', 'empresa', 'motivo', 'crachá', 'cracha', 'placa', 'tipo', 'morador'];
  let headerMap: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Try to detect header row
    const parts = line.split(/[\t;|]/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      const spaceParts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (spaceParts.length >= 2) {
        parts.length = 0;
        parts.push(...spaceParts);
      }
    }

    const isHeader = parts.filter(p => headerWords.some(hw => p.toLowerCase().includes(hw))).length >= 2;
    
    if (isHeader) {
      headerMap = {};
      parts.forEach((p, idx) => {
        const lp = p.toLowerCase();
        if (lp.includes('visitante') || lp === 'nome') headerMap['name'] = idx;
        if (lp.includes('documento') || lp.includes('rg') || lp.includes('cpf')) headerMap['document'] = idx;
        if (lp.includes('apartamento') || lp.includes('apto') || lp.includes('apt')) headerMap['apartment'] = idx;
        if (lp.includes('morador')) headerMap['resident'] = idx;
        if (lp.includes('entrada') || lp.includes('horário') || lp.includes('data')) headerMap['entry'] = idx;
        if (lp.includes('saída') || lp.includes('saida')) headerMap['exit'] = idx;
        if (lp.includes('empresa')) headerMap['company'] = idx;
        if (lp.includes('motivo')) headerMap['purpose'] = idx;
        if (lp.includes('crachá') || lp.includes('cracha')) headerMap['badge'] = idx;
        if (lp.includes('placa')) headerMap['plate'] = idx;
        if (lp.includes('tipo')) headerMap['type'] = idx;
      });
      continue;
    }

    // If we have a header map, parse data rows
    if (Object.keys(headerMap).length >= 2 && parts.length >= 2) {
      const get = (key: string) => headerMap[key] !== undefined ? (parts[headerMap[key]] || '') : '';
      const name = get('name');
      const apartment = get('apartment');
      if (!name || !apartment || name.length < 2) continue;

      const typeStr = get('type').toLowerCase();
      const visitorType: 'visitor' | 'service_provider' = typeStr.includes('prestador') || typeStr.includes('service') ? 'service_provider' : 'visitor';

      addResult({
        visitorName: name,
        visitorDocument: get('document'),
        visitorType,
        apartment,
        residentName: get('resident') || undefined,
        entryTime: parseBRDateTime(get('entry')) || undefined,
        exitTime: parseBRDateTime(get('exit')) || undefined,
        company: get('company') || undefined,
        purpose: get('purpose') || undefined,
        badgeNumber: get('badge') || undefined,
        vehiclePlate: get('plate') || undefined,
      });
    }
  }

  // Strategy 2: Labeled fields (Nome: ..., Documento: ..., Apartamento: ...)
  const fullText = lines.join('\n');
  const entryBlocks = fullText.split(/(?=(?:visitante|nome)\s*:)/i);
  for (const block of entryBlocks) {
    const nameMatch = block.match(/(?:visitante|nome)\s*:\s*(.+)/i);
    const aptMatch = block.match(/(?:apartamento|apto|apt)\s*:?\s*([\d]+\w{0,2})/i);
    if (nameMatch && aptMatch) {
      const docMatch = block.match(/(?:documento|rg|cpf)\s*:?\s*([\d.\-/]+)/i);
      const entryMatch = block.match(/(?:entrada|data\/hora)\s*:?\s*(.+)/i);
      const exitMatch = block.match(/(?:saída|saida)\s*:?\s*(.+)/i);
      const companyMatch = block.match(/(?:empresa)\s*:?\s*(.+)/i);
      const purposeMatch = block.match(/(?:motivo|finalidade)\s*:?\s*(.+)/i);
      const typeMatch = block.match(/(?:tipo)\s*:?\s*(.+)/i);
      const badgeMatch = block.match(/(?:crachá|cracha)\s*:?\s*(.+)/i);
      const plateMatch = block.match(/(?:placa|veículo|veiculo)\s*:?\s*(.+)/i);

      const typeStr = typeMatch?.[1]?.toLowerCase() || '';
      const visitorType: 'visitor' | 'service_provider' = typeStr.includes('prestador') ? 'service_provider' : 'visitor';

      addResult({
        visitorName: nameMatch[1].replace(/\s+/g, ' ').trim(),
        visitorDocument: docMatch?.[1] || '',
        visitorType,
        apartment: aptMatch[1],
        entryTime: parseBRDateTime(entryMatch?.[1] || '') || undefined,
        exitTime: parseBRDateTime(exitMatch?.[1] || '') || undefined,
        company: companyMatch?.[1]?.trim() || undefined,
        purpose: purposeMatch?.[1]?.trim() || undefined,
        badgeNumber: badgeMatch?.[1]?.trim() || undefined,
        vehiclePlate: plateMatch?.[1]?.trim() || undefined,
      });
    }
  }

  return results;
}

/**
 * Convert parsed access entry to the app's AccessEntry type
 */
export function parsedToAccessEntry(parsed: ParsedAccessEntry): AccessEntry {
  return {
    id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    visitorName: parsed.visitorName,
    visitorDocument: parsed.visitorDocument,
    visitorType: parsed.visitorType,
    residentId: '',
    residentName: parsed.residentName || '',
    apartment: parsed.apartment,
    purpose: parsed.purpose || '',
    entryTime: parsed.entryTime || new Date().toISOString(),
    exitTime: parsed.exitTime || null,
    company: parsed.company || '',
    vehiclePlate: parsed.vehiclePlate || '',
    vehicleModel: '',
    vehicleColor: '',
    badgeNumber: parsed.badgeNumber || '',
    autoRecognized: false,
  };
}
