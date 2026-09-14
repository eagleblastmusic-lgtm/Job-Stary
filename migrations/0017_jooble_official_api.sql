INSERT OR IGNORE INTO job_source_registry(
  key,label,kind,enabled,terms_metadata,health_status,health_message,last_checked_at,created_at,updated_at
) VALUES (
  'jooble_pl',
  'Jooble Polska',
  'OFFICIAL_API',
  1,
  '{"api":"https://pl.jooble.org/api/{key}","docs":"https://pl.jooble.org/api/about","checkedAt":"2026-09-13","notes":"Oficjalny REST API Jooble dla polskiego rynku. Wymaga JOOBLE_API_KEY_PL."}',
  'UNKNOWN',
  'Klucz API nie został jeszcze zweryfikowany.',
  NULL,
  datetime('now'),
  datetime('now')
);
