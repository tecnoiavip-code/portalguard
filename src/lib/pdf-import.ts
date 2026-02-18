import { Resident } from '@/types';

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
