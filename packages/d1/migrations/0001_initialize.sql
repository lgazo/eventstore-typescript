-- Event store schema for the D1 store (packages/d1).
-- Apply with: wrangler d1 migrations apply <database>
CREATE TABLE IF NOT EXISTS events (
  sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  tenant_id TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at);
