export interface ParsedPackageLabel {
  sender: string;
  trackingCode?: string;
  recipientName?: string;
  recipientAddress?: string;
  apartment?: string;
  city?: string;
  state?: string;
  cep?: string;
  phone?: string;
  packageType?: string;
  rawText: string;
  confidence: number;
}

const COMPANY_PATTERNS = {
  'Mercado Livre': {
    keywords: ['mercado livre', 'mercadolivre', 'mercado livre', 'ml', 'meli'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(\d{13,})/g,
      /(MLB\d+)/gi,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
      /seller[:\s]+([^\n]+)/i,
    ],
  },
  'Amazon': {
    keywords: ['amazon', 'amzn'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(TBA\d+)/gi,
      /(\d{12,})/g,
    ],
    senderPatterns: [
      /sold by[:\s]+([^\n]+)/i,
      /vendido por[:\s]+([^\n]+)/i,
      /remetente[:\s]+([^\n]+)/i,
    ],
  },
  'Loggi': {
    keywords: ['loggi'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(LG\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Correios': {
    keywords: ['correios', 'sedex', 'pac', 'e-sedex'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /([A-Z]{2}\d{8}[A-Z]{2})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Jadlog': {
    keywords: ['jadlog'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(JDL\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Total Express': {
    keywords: ['total express', 'totalexpress'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(TOT\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Sequoia': {
    keywords: ['sequoia'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(SEQ\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Intelipost': {
    keywords: ['intelipost'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(INT\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
  'Blu': {
    keywords: ['blu', 'blu log'],
    trackingPatterns: [
      /([A-Z]{2}\d{9}[A-Z]{2})/g,
      /(BLU\d+)/gi,
      /(\d{10,})/g,
    ],
    senderPatterns: [
      /remetente[:\s]+([^\n]+)/i,
      /de[:\s]+([^\n]+)/i,
    ],
  },
};

const COMPANY_KEYWORDS = [
  'mercado livre', 'mercadolivre', 'mercadoenvios', 'meli', 'amazon', 'amzn',
  'loggi', 'correios', 'sedex', 'pac', 'e-sedex', 'jadlog', 'sequoia',
  'total express', 'intelipost', 'blu', 'fedex', 'ups', 'dhl', 'meliexpress',
  'shopee', 'shein', 'aliexpress', 'kabum', 'magalu', 'magazine luiza',
];

const ADDRESS_PATTERNS = {
  address: [
    /(?:endere[cç]o|rua|av\.|avenida|travessa|alameda)[:\s]+([^\n]+)/i,
    /([^\n]+\d+[^\n]*(?:apt|apto|apartamento|casa|bloco|condom[ií]nio)[^\n]*)/i,
  ],
  cep: [
    /\b(\d{5}-?\d{3})\b/g,
    /CEP[:\s]*(\d{5}-?\d{3})/i,
  ],
  city: [
    /(?:cidade|city)[:\s]+([^\n]+)/i,
    /\b([A-Z][a-zÀ-ü]+(?:\s+[A-Z][a-zÀ-ü]+)*)\s*[-/]\s*[A-Z]{2}\b/,
  ],
  state: [
    /\b([A-Z]{2})\b(?=\s*\d{5})/,
    /(?:estado|uf)[:\s]+([A-Z]{2})/i,
  ],
  phone: [
    /(?:fone|telefone|tel|celular|whatsapp)[:\s]*\(?(\d{2})\)?[\s-]?(\d{4,5})[\s-]?(\d{4})/i,
    /\((\d{2})\)\s*(\d{4,5})[\s-]?(\d{4})/g,
  ],
  packageType: [
    /(?:tipo|peso|volume|dimens[aõ]es?)[:\s]+([^\n]+)/i,
    /(?:caixa|box|pacote|envelope|saco)[:\s]*([^\n]+)/i,
  ],
};

function isCompanyName(name: string): boolean {
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return COMPANY_KEYWORDS.some(k => normalized.includes(k));
}

function extractWithPatterns(text: string, patterns: RegExp[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      results.push(...matches);
    }
  }
  return results;
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/[:\s]+$/, '')
    .replace(/^[:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCompany(text: string): string {
  const lowerText = text.toLowerCase();
  for (const [company, config] of Object.entries(COMPANY_PATTERNS)) {
    for (const keyword of config.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return company;
      }
    }
  }
  return 'Desconhecido';
}

function extractTrackingCode(text: string, company: string): string | undefined {
  const companyConfig = COMPANY_PATTERNS[company as keyof typeof COMPANY_PATTERNS];
  if (companyConfig) {
    for (const pattern of companyConfig.trackingPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0];
      }
    }
  }
  const genericMatches = text.match(/([A-Z]{2}\d{8,9}[A-Z]{2})/g);
  if (genericMatches) return genericMatches[0];
  const numericMatches = text.match(/\b(\d{10,})\b/g);
  if (numericMatches) return numericMatches[0];
  return undefined;
}

function extractSender(text: string, company: string): string {
  const companyConfig = COMPANY_PATTERNS[company as keyof typeof COMPANY_PATTERNS];
  if (companyConfig) {
    for (const pattern of companyConfig.senderPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return cleanExtractedText(match[1]);
      }
    }
  }
  const genericMatch = text.match(
    /(?:remetente|remitente|enviado por|de|do vendedor|from|seller|sold by|vendido por|origem)[:\s]+([^\n]+)/i
  );
  if (genericMatch && genericMatch[1]) {
    return cleanExtractedText(genericMatch[1]);
  }
  return company;
}

function extractRecipientName(text: string): string | undefined {
  // Prioridade 1: nome após palavra-chave de destinatário
  const markedMatch = text.match(/(?:para|destinat[aá]rio|nome)[:\s]+([^\n]+)/i);
  if (markedMatch && markedMatch[1]) {
    const candidate = cleanExtractedText(markedMatch[1]);
    if (!isCompanyName(candidate)) return candidate;
  }

  // Prioridade 2: linha que parece nome próprio (ignorando empresas/transportadoras)
  const lines = text.split('\n');
  const candidates: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-Z][a-zÀ-ü]+(?:\s+(?:[A-Z][a-zÀ-ü]+|da|de|do|das|dos|e|y)){1,4}$/.test(trimmed) && trimmed.length > 5) {
      candidates.push(trimmed);
    }
  }
  for (const candidate of candidates) {
    if (!isCompanyName(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || undefined;
}

function extractAddress(text: string): string | undefined {
  const addresses = extractWithPatterns(text, ADDRESS_PATTERNS.address);
  if (addresses.length > 0) {
    return cleanExtractedText(addresses[0]);
  }
  return undefined;
}

function extractApartment(text: string): string | undefined {
  const patterns = [
    /(?:apto?\.?|apartamento|ap\.?)[\s:.]*([A-Z0-9]+(?:[-/][A-Z0-9]+)*)/i,
    /(?:bloco|casa)[\s:.]*([A-Z0-9]+(?:[-/][A-Z0-9]+)*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return cleanExtractedText(match[1]);
    }
  }
  return undefined;
}

function extractCEP(text: string): string | undefined {
  const ceps = extractWithPatterns(text, ADDRESS_PATTERNS.cep);
  if (ceps.length > 0) {
    return ceps[0].replace(/\D/g, '');
  }
  return undefined;
}

function extractCity(text: string): string | undefined {
  const cities = extractWithPatterns(text, ADDRESS_PATTERNS.city);
  if (cities.length > 0) {
    return cleanExtractedText(cities[0]);
  }
  return undefined;
}

function extractState(text: string): string | undefined {
  const states = extractWithPatterns(text, ADDRESS_PATTERNS.state);
  if (states.length > 0) {
    return states[0].toUpperCase();
  }
  return undefined;
}

function extractPhone(text: string): string | undefined {
  const phones = extractWithPatterns(text, ADDRESS_PATTERNS.phone);
  if (phones.length > 0) {
    return phones[0].replace(/\D/g, '');
  }
  return undefined;
}

function extractPackageType(text: string): string | undefined {
  const types = extractWithPatterns(text, ADDRESS_PATTERNS.packageType);
  if (types.length > 0) {
    return cleanExtractedText(types[0]);
  }
  const lowerText = text.toLowerCase();
  if (lowerText.includes('pacote grande') || lowerText.includes('box grande')) return 'Pacote Grande';
  if (lowerText.includes('pacote m') || lowerText.includes('box m')) return 'Pacote Médio';
  if (lowerText.includes('pacote p') || lowerText.includes('box p') || lowerText.includes('pacote pequeno')) return 'Pacote Pequeno';
  if (lowerText.includes('carta') || lowerText.includes('envelope') || lowerText.includes('documento')) return 'Carta';
  return undefined;
}

function calculateConfidence(parsed: ParsedPackageLabel): number {
  let score = 0;
  if (parsed.sender && parsed.sender !== 'Desconhecido') score += 20;
  if (parsed.trackingCode) score += 25;
  if (parsed.recipientName) score += 15;
  if (parsed.apartment) score += 15;
  if (parsed.cep) score += 10;
  if (parsed.phone) score += 5;
  if (parsed.packageType) score += 10;
  return Math.min(score, 100);
}

export function parsePackageLabel(text: string): ParsedPackageLabel {
  const company = detectCompany(text);
  const trackingCode = extractTrackingCode(text, company);
  const sender = extractSender(text, company);
  const recipientName = extractRecipientName(text);
  const address = extractAddress(text);
  const apartment = extractApartment(text);
  const cep = extractCEP(text);
  const city = extractCity(text);
  const state = extractState(text);
  const phone = extractPhone(text);
  const packageType = extractPackageType(text);

  const parsed: ParsedPackageLabel = {
    sender,
    trackingCode,
    recipientName,
    recipientAddress: address,
    apartment,
    city,
    state,
    cep,
    phone,
    packageType,
    rawText: text,
    confidence: 0,
  };

  parsed.confidence = calculateConfidence(parsed);
  return parsed;
}

export function matchResident(
  parsed: ParsedPackageLabel,
  residents: Array<{ id: string; name: string; apartment: string; phone?: string; email?: string }>
): { resident: typeof residents[0]; score: number } | null {
  const normalizeStr = (str: string) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizeApt = (str: string) => normalizeStr(str).replace(/[^a-z0-9]/g, '');
  let bestMatch: { resident: typeof residents[0]; score: number } | null = null;

  for (const resident of residents) {
    let score = 0;

    if (parsed.apartment) {
      const parsedApt = normalizeApt(parsed.apartment.replace(/(apt[o.]?|apartamento|ap\.?)\s*/i, ''));
      const residentApt = normalizeApt(resident.apartment);
      if (parsedApt && residentApt && parsedApt === residentApt) {
        score += 50;
      } else if (parsedApt && residentApt && residentApt.includes(parsedApt)) {
        score += 40;
      }
    }

    if (parsed.recipientName) {
      const parsedName = normalizeStr(parsed.recipientName).replace(/\s+/g, ' ').trim();
      const residentName = normalizeStr(resident.name).replace(/\s+/g, ' ').trim();
      if (parsedName === residentName) {
        score += 40;
      } else {
        // Remover sufixos comuns de cadastro (ex: " - Apto", " APTO 12")
        const cleanParsed = parsedName.replace(/\s*[-–]\s*.*$/, '').trim();
        const cleanResident = residentName.replace(/\s*[-–]\s*.*$/, '').trim();
        if (cleanParsed === cleanResident) {
          score += 35;
        } else if (cleanParsed.includes(cleanResident) || cleanResident.includes(cleanParsed)) {
          score += 25;
        } else {
          const parsedWords = cleanParsed.split(' ');
          const residentWords = cleanResident.split(' ');
          const commonWords = parsedWords.filter(w => w.length > 2 && residentWords.includes(w)).length;
          const lastName = residentWords[residentWords.length - 1];
          const parsedLastName = parsedWords[parsedWords.length - 1];
          if (parsedLastName === lastName) {
            score += 20;
          }
          if (commonWords > 0) {
            score += commonWords * 8;
          }
        }
      }
    }

    if (parsed.phone && resident.phone) {
      const parsedPhone = parsed.phone.replace(/\D/g, '');
      const residentPhone = resident.phone.replace(/\D/g, '');
      if (parsedPhone === residentPhone) {
        score += 30;
      } else if (parsedPhone.endsWith(residentPhone.slice(-8)) || residentPhone.endsWith(parsedPhone.slice(-8))) {
        score += 15;
      }
    }

    if (score > (bestMatch?.score || 0)) {
      bestMatch = { resident, score };
    }
  }

  return bestMatch && bestMatch.score > 20 ? bestMatch : null;
}