CREATE TABLE IF NOT EXISTS local_labour_snapshots (
  id TEXT PRIMARY KEY,
  area_name TEXT NOT NULL,
  normalized_area TEXT NOT NULL,
  area_type TEXT NOT NULL CHECK (area_type IN ('POWIAT','CITY','VOIVODESHIP')),
  role_name TEXT NOT NULL,
  normalized_role TEXT NOT NULL,
  role_aliases TEXT NOT NULL DEFAULT '[]',
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  shortage_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (shortage_status IN ('BIG_DEFICIT','DEFICIT','BALANCE','SURPLUS','UNKNOWN')),
  registered_unemployed INTEGER CHECK (registered_unemployed IS NULL OR registered_unemployed >= 0),
  offers_pup INTEGER CHECK (offers_pup IS NULL OR offers_pup >= 0),
  offers_cbop INTEGER CHECK (offers_cbop IS NULL OR offers_cbop >= 0),
  offers_online INTEGER CHECK (offers_online IS NULL OR offers_online >= 0),
  salary_min INTEGER CHECK (salary_min IS NULL OR salary_min >= 0),
  salary_max INTEGER CHECK (salary_max IS NULL OR salary_max >= 0),
  required_credentials TEXT NOT NULL DEFAULT '[]',
  source_name TEXT NOT NULL CHECK (source_name IN ('BAROMETR_ZAWODOW','GUS_BDL','OTHER_OFFICIAL')),
  source_url TEXT NOT NULL,
  source_license TEXT,
  source_updated_at TEXT,
  imported_at TEXT NOT NULL,
  UNIQUE(normalized_area, normalized_role, year, source_name)
);
CREATE INDEX IF NOT EXISTS idx_local_labour_lookup ON local_labour_snapshots(normalized_area, normalized_role, year DESC);

CREATE TABLE IF NOT EXISTS local_labour_area_links (
  normalized_from_area TEXT NOT NULL,
  from_area TEXT NOT NULL,
  normalized_to_area TEXT NOT NULL,
  to_area TEXT NOT NULL,
  distance_km REAL NOT NULL CHECK (distance_km >= 0 AND distance_km <= 500),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (normalized_from_area, normalized_to_area)
);
CREATE INDEX IF NOT EXISTS idx_local_labour_links_from ON local_labour_area_links(normalized_from_area, distance_km);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('local_labour', 0, 0, datetime('now'));
