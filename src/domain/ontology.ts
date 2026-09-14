export interface OntologyEntry {
  family: string;
  canonical: string;
  aliases: string[];
  type: 'SKILL' | 'CREDENTIAL' | 'TOOL' | 'LANGUAGE';
}

export const OCCUPATIONAL_FAMILIES = [
  'accounting', 'finance', 'administration', 'customer_service', 'sales', 'logistics',
  'warehouse', 'production', 'retail', 'transport', 'construction', 'engineering',
  'IT', 'marketing', 'hospitality', 'support_services'
] as const;

export const ONTOLOGY: OntologyEntry[] = [
  { family: 'accounting', canonical: 'Excel', aliases: ['excel', 'microsoft excel', 'ms excel'], type: 'TOOL' },
  { family: 'accounting', canonical: 'SAP', aliases: ['sap'], type: 'TOOL' },
  { family: 'finance', canonical: 'Power BI', aliases: ['power bi', 'powerbi'], type: 'TOOL' },
  { family: 'IT', canonical: 'SQL', aliases: ['sql'], type: 'SKILL' },
  { family: 'IT', canonical: 'JavaScript', aliases: ['javascript', 'js'], type: 'SKILL' },
  { family: 'IT', canonical: 'TypeScript', aliases: ['typescript', 'ts'], type: 'SKILL' },
  { family: 'warehouse', canonical: 'UDT', aliases: ['udt', 'uprawnienia udt'], type: 'CREDENTIAL' },
  { family: 'warehouse', canonical: 'Wózek widłowy', aliases: ['wózek widłowy', 'wózki widłowe', 'forklift'], type: 'SKILL' },
  { family: 'warehouse', canonical: 'WMS', aliases: ['wms'], type: 'TOOL' },
  { family: 'production', canonical: 'CNC', aliases: ['cnc'], type: 'TOOL' },
  { family: 'engineering', canonical: 'SEP', aliases: ['sep', 'uprawnienia sep'], type: 'CREDENTIAL' },
  { family: 'transport', canonical: 'Prawo jazdy B', aliases: ['prawo jazdy kat. b', 'prawo jazdy kat b', 'kat. b'], type: 'CREDENTIAL' },
  { family: 'transport', canonical: 'Prawo jazdy C+E', aliases: ['c+e', 'kat. c+e', 'prawo jazdy c+e'], type: 'CREDENTIAL' },
  { family: 'transport', canonical: 'ADR', aliases: ['adr'], type: 'CREDENTIAL' },
  { family: 'customer_service', canonical: 'Język angielski', aliases: ['angielski', 'english'], type: 'LANGUAGE' },
  { family: 'customer_service', canonical: 'Język niemiecki', aliases: ['niemiecki', 'german', 'deutsch'], type: 'LANGUAGE' },
  { family: 'sales', canonical: 'CRM', aliases: ['crm'], type: 'TOOL' },
  { family: 'administration', canonical: 'MS Office', aliases: ['ms office', 'microsoft office', 'pakiet office'], type: 'TOOL' }
];

export function normalizeText(value: string): string {
  return value
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findOntologyMatches(text: string): OntologyEntry[] {
  const normalized = normalizeText(text);
  const seen = new Set<string>();
  const matches: OntologyEntry[] = [];
  for (const entry of ONTOLOGY) {
    if (entry.aliases.some(alias => normalized.includes(normalizeText(alias))) && !seen.has(entry.canonical)) {
      seen.add(entry.canonical);
      matches.push(entry);
    }
  }
  return matches;
}
