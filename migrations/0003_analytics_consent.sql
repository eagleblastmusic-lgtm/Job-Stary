CREATE TRIGGER IF NOT EXISTS trg_analytics_requires_consent
BEFORE INSERT ON analytics_events
WHEN COALESCE((
  SELECT granted
  FROM consents
  WHERE user_id = NEW.user_id AND consent_type = 'ANALYTICS'
  ORDER BY created_at DESC, rowid DESC
  LIMIT 1
), 0) <> 1
BEGIN
  SELECT RAISE(IGNORE);
END;
