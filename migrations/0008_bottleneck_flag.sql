INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('bottleneck', 0, 0, datetime('now'));
