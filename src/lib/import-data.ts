import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure worker for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImportResult {
  headers: string[];
  rows: string[][];
}

/**
 * Parses a CSV string into headers and rows.
 * Handles different delimiters and quoted values.
 */
export function parseCSV(content: string): ImportResult {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter (comma or semicolon)
  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = commaCount >= semiCount ? ',' : ';';

  const parseLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
}

/**
 * Extracts text content from a PDF file.
 * Tries to preserve table-like structures.
 */
export async function parsePDF(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let allRows: string[][] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group items by their Y coordinate (same line)
    const lines: Record<number, any[]> = {};
    textContent.items.forEach((item: any) => {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push(item);
    });

    // Sort lines from top to bottom
    const sortedY = Object.keys(lines).map(Number).sort((a, b) => b - a);
    
    sortedY.forEach(y => {
      // Sort items within a line from left to right
      const lineItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
      const row = lineItems.map(item => item.str.trim()).filter(s => s.length > 0);
      if (row.length > 0) {
        allRows.push(row);
      }
    });
  }

  if (allRows.length === 0) return { headers: [], rows: [] };

  // Assume the first row with more than 1 column is the header
  const headerIndex = allRows.findIndex(r => r.length > 1);
  if (headerIndex === -1) return { headers: ['Coluna 1'], rows: allRows };

  const headers = allRows[headerIndex];
  const rows = allRows.slice(headerIndex + 1);

  return { headers, rows };
}

/**
 * Extracts text content from a PDF using OCR (Gemini).
 * This is used for scanned documents where getPage().getTextContent() fails.
 */
export async function parsePDFWithOCR(file: File, supabaseClient: any): Promise<ImportResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data:application/pdf;base64,
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const { data, error } = await supabaseClient.functions.invoke("pdf-ocr", {
    body: { pdfBase64: base64, fileName: file.name }
  });

  if (error) throw error;
  if (!data.text) throw new Error("Nenhum texto extraído pelo OCR");

  const lines = data.text.split("\n").filter((l: string) => l.trim().length > 0 && l.includes(";"));
  
  const headers = ["Nome", "Apartamento", "CPF", "Telefone", "Email"];
  const rows = lines.map((line: string) => line.split(";").map((s: string) => s.trim()));

  return { headers, rows };
}

/**
 * Heuristics to find the best matching column for a field.
 */
export function findBestMatch(headers: string[], field: string): string {
  const h = headers.map(s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const target = field.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Exact match
  let idx = h.indexOf(target);
  if (idx !== -1) return headers[idx];

  // Partial match
  idx = h.findIndex(s => s.includes(target) || target.includes(s));
  if (idx !== -1) return headers[idx];

  // Synonyms
  const synonyms: Record<string, string[]> = {
    name: ['nome', 'cliente', 'morador', 'pessoal', 'usuario'],
    apartment: ['apt', 'apartamento', 'casa', 'unidade', 'bloco', 'nro', 'numero'],
    cpf: ['cpf', 'documento', 'doc', 'identidade'],
    phone: ['tel', 'telefone', 'celular', 'contato', 'fone'],
    email: ['email', 'e-mail', 'correio'],
    vehicleTag: ['tag', 'adesivo', 'uhf', 'cartao', 'acesso'],
    vehiclePlate: ['placa', 'veiculo', 'carro', 'moto'],
  };

  const keys = synonyms[field] || [];
  for (const k of keys) {
    idx = h.findIndex(s => s.includes(k) || k.includes(s));
    if (idx !== -1) return headers[idx];
  }

  return '';
}
