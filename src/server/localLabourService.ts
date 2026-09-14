import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import { normalizeText } from '../domain/ontology.js';
import { buildLocalLabourReport, type LabourAreaInput, type LabourSourceEvidence, type LocalLabourReport, type ShortageStatus } from '../domain/localLabour.js';

type SnapshotSource = 'BAROMETR_ZAWODOW' | 'GUS_BDL' | 'OTHER_OFFICIAL';
type AreaType = 'POWIAT' | 'CITY' | 'VOIVODESHIP';

interface SnapshotRow {
  id: string; area_name: string; normalized_area: string; area_type: AreaType; role_name: string; normalized_role: string; role_aliases: string;
  year: number; shortage_status: ShortageStatus; registered_unemployed: number | null; offers_pup: number | null; offers_cbop: number | null; offers_online: number | null;
  salary_min: number | null; salary_max: number | null; required_credentials: string; source_name: SnapshotSource; source_url: string; source_license: string | null;
  source_updated_at: string | null; imported_at: string;
}

interface AreaLinkRow {
  normalized_from_area: string; from_area: string; normalized_to_area: string; to_area: string; distance_km: number; source_name: string; source_url: string; imported_at: string;
}

interface ProfileRow { desired_roles: string; location: string | null; commute_km: number | null }
interface JobRow { location: string | null; normalized_title: string | null; title: string | null }
interface CredentialRow { name: string; normalized_name: string }

export interface LocalLabourSnapshotInput {
  areaName: string;
  areaType: AreaType;
  roleName: string;
  roleAliases?: string[];
  year: number;
  shortageStatus?: ShortageStatus;
  registeredUnemployed?: number | null;
  offersPup?: number | null;
  offersCbop?: number | null;
  offersOnline?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  requiredCredentials?: string[];
  sourceName: SnapshotSource;
  sourceUrl: string;
  sourceLicense?: string | null;
  sourceUpdatedAt?: string | null;
}

export interface LocalLabourAreaLinkInput {
  fromArea: string;
  toArea: string;
  distanceKm: number;
  sourceName: string;
  sourceUrl: string;
}

function jsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function roleMatches(row: SnapshotRow, role: string): boolean {
  const target = normalizeText(role);
  if (row.normalized_role === target) return true;
  return jsonArray(row.role_aliases).some(alias => normalizeText(alias) === target);
}

function assertOfficialUrl(source: SnapshotSource | string, rawUrl: string): void {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Nieprawidłowy URL źródła danych rynku pracy.'); }
  if (url.protocol !== 'https:') throw new Error('Źródło danych rynku pracy musi używać HTTPS.');
  const host = url.hostname.toLowerCase();
  const allowed = source === 'BAROMETR_ZAWODOW'
    ? host === 'barometrzawodow.pl' || host === 'www.barometrzawodow.pl'
    : source === 'GUS_BDL'
      ? host === 'bdl.stat.gov.pl' || host === 'api.stat.gov.pl'
      : host.endsWith('.gov.pl') || host === 'gov.pl' || host.endsWith('.stat.gov.pl') || host.endsWith('.praca.gov.pl');
  if (!allowed) throw new Error('URL nie należy do dozwolonego urzędowego źródła danych.');
}

function latestNonNull<T>(rows: SnapshotRow[], pick: (row: SnapshotRow) => T | null): T | null {
  for (const row of [...rows].sort((a, b) => b.year - a.year || b.imported_at.localeCompare(a.imported_at))) {
    const value = pick(row);
    if (value !== null) return value;
  }
  return null;
}

function publicEvidence(rows: SnapshotRow[], areaName: string, distanceKm: number, observedJobs: number): LabourAreaInput {
  const sorted = [...rows].sort((a, b) => b.year - a.year || b.imported_at.localeCompare(a.imported_at));
  const shortage = sorted.find(row => row.shortage_status !== 'UNKNOWN');
  const sources: LabourSourceEvidence[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const key = `${row.source_name}:${row.source_url}:${row.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ sourceName: row.source_name, sourceUrl: row.source_url, sourceLicense: row.source_license, year: row.year, updatedAt: row.source_updated_at });
  }
  const requiredCredentials = [...new Set(sorted.flatMap(row => jsonArray(row.required_credentials)))];
  return {
    areaName,
    normalizedArea: normalizeText(areaName),
    distanceKm,
    shortageStatus: shortage?.shortage_status ?? 'UNKNOWN',
    registeredUnemployed: latestNonNull(sorted, row => row.registered_unemployed),
    offersPup: latestNonNull(sorted, row => row.offers_pup),
    offersCbop: latestNonNull(sorted, row => row.offers_cbop),
    offersOnline: latestNonNull(sorted, row => row.offers_online),
    salaryMin: latestNonNull(sorted, row => row.salary_min),
    salaryMax: latestNonNull(sorted, row => row.salary_max),
    requiredCredentials,
    observedJobs,
    sources
  };
}

export class LocalLabourService {
  constructor(private readonly db: JobDatabase) {}

  build(userId: string, requestedRole?: string | null, requestedArea?: string | null): LocalLabourReport {
    const profile = this.db.db.prepare('SELECT desired_roles, location, commute_km FROM career_profiles WHERE user_id=?').get(userId) as unknown as ProfileRow | undefined;
    if (!profile) throw new Error('Najpierw uzupełnij profil zawodowy.');
    const desiredRoles = jsonArray(profile.desired_roles);
    const role = requestedRole?.trim() || desiredRoles[0] || '';
    const baseArea = requestedArea?.trim() || profile.location?.trim() || '';
    if (!role) throw new Error('Nie znamy roli, dla której mamy przeanalizować lokalny rynek.');
    if (!baseArea) throw new Error('Nie znamy Twojej lokalizacji. Uzupełnij ją w profilu.');

    const normalizedBase = normalizeText(baseArea);
    const maxDistance = profile.commute_km === null ? 0 : Math.max(0, profile.commute_km + 10);
    const links = this.db.db.prepare('SELECT * FROM local_labour_area_links WHERE normalized_from_area=? AND distance_km<=? ORDER BY distance_km').all(normalizedBase, maxDistance) as unknown as AreaLinkRow[];
    const areaRefs = [{ areaName: baseArea, normalizedArea: normalizedBase, distanceKm: 0 }, ...links.map(link => ({ areaName: link.to_area, normalizedArea: link.normalized_to_area, distanceKm: link.distance_km }))];
    const jobs = this.db.db.prepare('SELECT location, normalized_title, title FROM jobs WHERE user_id=?').all(userId) as unknown as JobRow[];
    const normalizedRole = normalizeText(role);
    const credentials = this.db.db.prepare("SELECT name, normalized_name FROM credentials WHERE user_id=? AND status='CONFIRMED'").all(userId) as unknown as CredentialRow[];
    const confirmedCredentials = credentials.flatMap(item => [item.name, item.normalized_name]);

    const areas = areaRefs.map(ref => {
      const allRows = this.db.db.prepare('SELECT * FROM local_labour_snapshots WHERE normalized_area=? ORDER BY year DESC, imported_at DESC').all(ref.normalizedArea) as unknown as SnapshotRow[];
      const rows = allRows.filter(row => roleMatches(row, role));
      const observedJobs = jobs.filter(job => normalizeText(job.location ?? '') === ref.normalizedArea && normalizeText(job.normalized_title ?? job.title ?? '') === normalizedRole).length;
      return publicEvidence(rows, ref.areaName, ref.distanceKm, observedJobs);
    });

    return buildLocalLabourReport({ role, baseArea, commuteKm: profile.commute_km, areas, confirmedCredentials });
  }

  upsertSnapshot(input: LocalLabourSnapshotInput): void {
    assertOfficialUrl(input.sourceName, input.sourceUrl);
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error('Nieprawidłowy rok danych rynku pracy.');
    const now = new Date().toISOString();
    const normalizedArea = normalizeText(input.areaName);
    const normalizedRole = normalizeText(input.roleName);
    const id = randomUUID();
    this.db.db.prepare(`INSERT INTO local_labour_snapshots(
      id,area_name,normalized_area,area_type,role_name,normalized_role,role_aliases,year,shortage_status,registered_unemployed,offers_pup,offers_cbop,offers_online,salary_min,salary_max,required_credentials,source_name,source_url,source_license,source_updated_at,imported_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(normalized_area,normalized_role,year,source_name) DO UPDATE SET
      area_name=excluded.area_name,area_type=excluded.area_type,role_name=excluded.role_name,role_aliases=excluded.role_aliases,shortage_status=excluded.shortage_status,
      registered_unemployed=excluded.registered_unemployed,offers_pup=excluded.offers_pup,offers_cbop=excluded.offers_cbop,offers_online=excluded.offers_online,
      salary_min=excluded.salary_min,salary_max=excluded.salary_max,required_credentials=excluded.required_credentials,source_url=excluded.source_url,source_license=excluded.source_license,
      source_updated_at=excluded.source_updated_at,imported_at=excluded.imported_at`).run(
      id, input.areaName, normalizedArea, input.areaType, input.roleName, normalizedRole, JSON.stringify(input.roleAliases ?? []), input.year, input.shortageStatus ?? 'UNKNOWN',
      input.registeredUnemployed ?? null, input.offersPup ?? null, input.offersCbop ?? null, input.offersOnline ?? null, input.salaryMin ?? null, input.salaryMax ?? null,
      JSON.stringify(input.requiredCredentials ?? []), input.sourceName, input.sourceUrl, input.sourceLicense ?? null, input.sourceUpdatedAt ?? null, now
    );
  }

  upsertAreaLink(input: LocalLabourAreaLinkInput): void {
    assertOfficialUrl('OTHER_OFFICIAL', input.sourceUrl);
    if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0 || input.distanceKm > 500) throw new Error('Nieprawidłowa odległość między obszarami.');
    const now = new Date().toISOString();
    this.db.db.prepare(`INSERT INTO local_labour_area_links(normalized_from_area,from_area,normalized_to_area,to_area,distance_km,source_name,source_url,imported_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(normalized_from_area,normalized_to_area) DO UPDATE SET from_area=excluded.from_area,to_area=excluded.to_area,distance_km=excluded.distance_km,source_name=excluded.source_name,source_url=excluded.source_url,imported_at=excluded.imported_at`).run(
      normalizeText(input.fromArea), input.fromArea, normalizeText(input.toArea), input.toArea, input.distanceKm, input.sourceName, input.sourceUrl, now
    );
  }
}
