export type JobSourceKind = 'USER_PROVIDED' | 'OFFICIAL_API' | 'LICENSED_FEED' | 'PARTNERSHIP' | 'PUBLIC_DATASET' | 'PERMITTED_CAREER_PAGE';
export type SourceHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN';

export interface JobSourceTermsMetadata {
  basis: JobSourceKind;
  referenceUrl: string | null;
  notes: string;
  checkedAt: string | null;
}

export interface JobSourceHealth {
  status: SourceHealthStatus;
  message: string | null;
  checkedAt: string | null;
}

export interface JobSourceInput {
  rawText: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
}

export interface NormalizedSourceJob {
  rawText: string;
  sourceUrl: string | null;
  externalId: string | null;
  publishedAt: string | null;
  provenance: Record<string, unknown>;
}

export interface JobSourceConnector {
  readonly key: string;
  readonly label: string;
  readonly kind: JobSourceKind;
  fetch(): Promise<JobSourceInput[]>;
  normalize(input: JobSourceInput): NormalizedSourceJob;
  provenance(input: JobSourceInput): Record<string, unknown>;
  termsMetadata(): JobSourceTermsMetadata;
  healthStatus(): JobSourceHealth;
}

function canonicalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
}

export class UserProvidedJobConnector implements JobSourceConnector {
  readonly key = 'user_provided';
  readonly label = 'Treść dostarczona przez użytkownika';
  readonly kind: JobSourceKind = 'USER_PROVIDED';

  constructor(private readonly items: JobSourceInput[]) {}

  async fetch(): Promise<JobSourceInput[]> {
    return this.items;
  }

  normalize(input: JobSourceInput): NormalizedSourceJob {
    const rawText = input.rawText.trim();
    return {
      rawText,
      sourceUrl: canonicalUrl(input.sourceUrl),
      externalId: input.externalId?.trim() || null,
      publishedAt: input.publishedAt?.trim() || null,
      provenance: this.provenance(input)
    };
  }

  provenance(input: JobSourceInput): Record<string, unknown> {
    return {
      connector: this.key,
      basis: this.kind,
      suppliedByUser: true,
      hasSourceUrl: Boolean(canonicalUrl(input.sourceUrl)),
      hasExternalId: Boolean(input.externalId?.trim())
    };
  }

  termsMetadata(): JobSourceTermsMetadata {
    return {
      basis: this.kind,
      referenceUrl: null,
      notes: 'Connector nie pobiera danych z zewnętrznych serwisów. Treść i ewentualny URL są przekazywane przez użytkownika.',
      checkedAt: null
    };
  }

  healthStatus(): JobSourceHealth {
    return { status: 'HEALTHY', message: 'Brak zewnętrznej zależności sieciowej.', checkedAt: null };
  }
}

export function normalizeSourceUrl(value: string | null | undefined): string | null {
  return canonicalUrl(value);
}
