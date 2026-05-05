import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImportResult {
  headers: string[];
  rows: string[][];
}

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
};

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;
const HEADER_KEYWORDS = [
  'nome',
  'morador',
  'apartamento',
  'apto',
  'unidade',
  'bloco',
  'cpf',
  'documento',
  'telefone',
  'celular',
  'email',
  'e-mail',
  'placa',
  'tag',
  'veiculo',
  'carro',
];

function normalizeText(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@._ -]/g, '')
    .trim();
}

function isNumericLike(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[-+]?\d[\d .,/()-]*$/.test(v);
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count++;
    }
  }

  return count;
}

function parseDelimitedContent(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[i + 1] === '\n') {
        i++;
      }
      row.push(field.trim());
      field = '';

      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function detectDelimiter(content: string): string | null {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith('sep='))
    .slice(0, 30);

  if (lines.length === 0) return null;

  let bestDelimiter: string | null = null;
  let bestScore = -1;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
    const nonZero = counts.filter((c) => c > 0);

    if (nonZero.length === 0) continue;

    const avg = nonZero.reduce((sum, c) => sum + c, 0) / nonZero.length;
    const variancePenalty = nonZero.length > 1 ? Math.abs(Math.max(...nonZero) - Math.min(...nonZero)) * 0.2 : 0;
    const score = nonZero.length * 2 + avg - variancePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestScore >= 2 ? bestDelimiter : null;
}

function splitByRepeatedSpaces(lines: string[]): string[][] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s{2,}/).map((cell) => cell.trim()));
}

function ensureRowWidth(rows: string[][], minWidth = 1): { rows: string[][]; width: number } {
  const width = Math.max(
    minWidth,
    ...rows.map((r) => r.length)
  );

  const padded = rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push('');
    return next;
  });

  return { rows: padded, width };
}

function uniqueHeaders(rawHeaders: string[]): string[] {
  const used = new Map<string, number>();

  return rawHeaders.map((header, idx) => {
    const base = header.trim() || `Coluna ${idx + 1}`;
    const key = normalizeToken(base) || `coluna-${idx + 1}`;
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function isLikelyHeader(firstRow: string[], secondRow?: string[]): boolean {
  const nonEmpty = firstRow.map((c) => c.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;

  const normalized = nonEmpty.map(normalizeToken);
  const keywordHits = normalized.filter((cell) =>
    HEADER_KEYWORDS.some((keyword) => cell.includes(keyword))
  ).length;

  if (keywordHits > 0) return true;

  const alphaCount = nonEmpty.filter((cell) => /[A-Za-z\u00C0-\u017F]/.test(cell)).length;
  const numericCount = nonEmpty.filter((cell) => isNumericLike(cell)).length;

  if (alphaCount >= Math.ceil(nonEmpty.length * 0.7) && numericCount === 0 && secondRow) {
    const secondNonEmpty = secondRow.map((c) => c.trim()).filter(Boolean);
    const secondNumeric = secondNonEmpty.filter((cell) => isNumericLike(cell)).length;
    return secondNumeric > 0 || secondNonEmpty.length >= nonEmpty.length;
  }

  return false;
}

function rowsToImportResult(rawRows: string[][]): ImportResult {
  const cleanedRows = rawRows
    .map((row) => row.map((cell) => normalizeText(cell).trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (cleanedRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const { rows, width } = ensureRowWidth(cleanedRows, 1);
  const firstRow = rows[0];
  const secondRow = rows[1];

  if (isLikelyHeader(firstRow, secondRow)) {
    const headers = uniqueHeaders(firstRow);
    const dataRows = rows
      .slice(1)
      .filter((row) => {
        const rowTokens = row.map(normalizeToken);
        const headerTokens = headers.map(normalizeToken);
        const equalCells = rowTokens.filter((token, idx) => token === headerTokens[idx]).length;
        return equalCells < Math.max(1, Math.floor(headers.length * 0.8));
      });

    return { headers, rows: dataRows };
  }

  const headers = uniqueHeaders(Array.from({ length: width }, (_, idx) => `Coluna ${idx + 1}`));
  return { headers, rows };
}

function parseTabularText(text: string): ImportResult {
  const normalized = normalizeText(text);
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const delimiter = detectDelimiter(normalized);
  if (delimiter) {
    const rows = parseDelimitedContent(normalized, delimiter);
    if (rows.length > 0 && rows.some((row) => row.length > 1)) {
      return rowsToImportResult(rows);
    }
  }

  const spacedRows = splitByRepeatedSpaces(lines);
  if (spacedRows.some((row) => row.length > 1)) {
    return rowsToImportResult(spacedRows);
  }

  return rowsToImportResult(lines.map((line) => [line]));
}

function textItemsToPageLines(items: PdfTextItem[]): string[] {
  if (items.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const item of items) {
    const token = (item.str || '').trim();
    if (token) {
      current += (current ? ' ' : '') + token;
    }

    if (item.hasEOL) {
      if (current.trim()) lines.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) lines.push(current.trim());
  return lines;
}

function textItemsToSpatialRows(items: PdfTextItem[]): string[][] {
  const grouped: Array<{ y: number; items: PdfTextItem[] }> = [];

  const sortedByY = [...items].sort((a, b) => b.transform[5] - a.transform[5]);

  for (const item of sortedByY) {
    const text = (item.str || '').trim();
    if (!text) continue;

    const y = item.transform[5];
    const existing = grouped.find((group) => Math.abs(group.y - y) <= 2.5);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.push({ y, items: [item] });
    }
  }

  return grouped.map((group) => {
    const rowItems = [...group.items].sort((a, b) => a.transform[4] - b.transform[4]);
    const row: string[] = [];
    let current = '';
    let lastRight = 0;

    rowItems.forEach((item, idx) => {
      const token = (item.str || '').trim();
      if (!token) return;

      const x = item.transform[4];
      const tokenWidth = Number.isFinite(item.width) ? Math.max(0, item.width) : token.length * 4;
      const gap = idx === 0 ? 0 : x - lastRight;

      if (idx > 0 && gap > 18) {
        if (current.trim()) row.push(current.trim());
        current = token;
      } else {
        current += (current ? ' ' : '') + token;
      }

      lastRight = x + tokenWidth;
    });

    if (current.trim()) row.push(current.trim());
    return row;
  }).filter((row) => row.length > 0);
}

export function parseCSV(content: string): ImportResult {
  const normalized = normalizeText(content);
  if (!normalized.trim()) return { headers: [], rows: [] };

  let working = normalized;
  let forcedDelimiter: string | null = null;

  const firstLine = working.split('\n')[0]?.trim().toLowerCase() || '';
  if (firstLine.startsWith('sep=') && firstLine.length >= 5) {
    forcedDelimiter = firstLine[4] || null;
    working = working.split('\n').slice(1).join('\n');
  }

  const delimiter = forcedDelimiter || detectDelimiter(working);

  if (delimiter) {
    const rows = parseDelimitedContent(working, delimiter);
    if (rows.length > 0) {
      return rowsToImportResult(rows);
    }
  }

  return parseTabularText(working);
}

export async function parsePDF(file: File): Promise<ImportResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allRows: string[][] = [];
  const pageTextLines: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent({ disableNormalization: false });
    const items = (textContent.items as PdfTextItem[]).filter((item) => typeof item.str === 'string');

    const spatialRows = textItemsToSpatialRows(items);
    if (spatialRows.length > 0) {
      allRows.push(...spatialRows);
    }

    const lines = textItemsToPageLines(items);
    if (lines.length > 0) {
      pageTextLines.push(...lines);
    }
  }

  if (allRows.length > 0 && allRows.some((row) => row.length > 1)) {
    const parsed = rowsToImportResult(allRows);
    if (parsed.rows.length > 0 || parsed.headers.length > 0) {
      return parsed;
    }
  }

  const textFallback = parseTabularText(pageTextLines.join('\n'));
  if (textFallback.rows.length > 0 || textFallback.headers.length > 0) {
    return textFallback;
  }

  return { headers: [], rows: [] };
}

export async function parsePDFWithOCR(file: File, supabaseClient: any): Promise<ImportResult> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const { data, error } = await supabaseClient.functions.invoke('pdf-ocr', {
    body: { pdfBase64: base64, fileName: file.name },
  });

  if (error) throw error;

  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text.trim()) throw new Error('Nenhum texto extraido pelo OCR');

  const parsed = parseTabularText(text);
  if (parsed.rows.length === 0) {
    throw new Error('OCR concluiu, mas nao foi possivel estruturar os dados em colunas');
  }

  return parsed;
}

export function findBestMatch(headers: string[], field: string): string {
  const h = headers.map((s) => normalizeToken(s));
  const target = normalizeToken(field);

  let idx = h.indexOf(target);
  if (idx !== -1) return headers[idx];

  idx = h.findIndex((s) => s.includes(target) || target.includes(s));
  if (idx !== -1) return headers[idx];

  const synonyms: Record<string, string[]> = {
    name: ['nome', 'cliente', 'morador', 'pessoa', 'usuario'],
    apartment: ['apt', 'apartamento', 'casa', 'unidade', 'bloco', 'nro', 'numero', 'apto'],
    cpf: ['cpf', 'documento', 'doc', 'identidade'],
    phone: ['tel', 'telefone', 'celular', 'contato', 'fone'],
    email: ['email', 'e-mail', 'correio'],
    vehicleTag: ['tag', 'adesivo', 'uhf', 'cartao', 'acesso'],
    vehiclePlate: ['placa', 'veiculo', 'carro', 'moto'],
  };

  const keys = synonyms[field] || [];
  for (const key of keys) {
    const normalizedKey = normalizeToken(key);
    idx = h.findIndex((s) => s.includes(normalizedKey) || normalizedKey.includes(s));
    if (idx !== -1) return headers[idx];
  }

  return '';
}
