export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`;

export const CREATE_EVENT_TYPE_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)
`;

export const CREATE_OCCURRED_AT_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at)
`;
