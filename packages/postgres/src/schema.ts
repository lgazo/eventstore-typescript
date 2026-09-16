export function createEventsTableSql(tableName: string): string {
  return `
  CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
    sequence_number BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL
  )
`.trim();
}

export function createEventTypeIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_type`)} ON ${quoteIdentifier(tableName)}(event_type)
`.trim();
}

export function createOccurredAtIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_occurred_at`)} ON ${quoteIdentifier(tableName)}(occurred_at)
`.trim();
}

export function createPayloadGinIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_payload_gin`)} ON ${quoteIdentifier(tableName)} USING gin(payload)
`.trim();
}

export function createTenantSequenceIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_tenant_seq`)} ON ${quoteIdentifier(tableName)}(tenant_id, sequence_number)
`.trim();
}

export const CREATE_EVENTS_TABLE = createEventsTableSql('events');
export const CREATE_EVENT_TYPE_INDEX = createEventTypeIndexSql('events');
export const CREATE_OCCURRED_AT_INDEX = createOccurredAtIndexSql('events');
export const CREATE_PAYLOAD_GIN_INDEX = createPayloadGinIndexSql('events');

export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw new Error('eventstore-stores-postgres-err07: Database name must not be empty');
  }
  if (identifier.includes('\u0000')) {
    throw new Error('eventstore-stores-postgres-err08: Database name must not contain null bytes');
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function createDatabaseQuery(dbName: string): string {
  return `CREATE DATABASE ${quoteIdentifier(dbName)}`;
}

export function changeDatabaseInConnectionString(connStr: string, newDbName: string): string {
  const url = new URL(connStr);
  url.pathname = `/${newDbName}`;
  return url.toString();
}

export function getDatabaseNameFromConnectionString(connStr: string): string | null {
  try {
    const url = new URL(connStr);
    const dbName = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    return dbName || null;
  } catch (err) {
    console.error('eventstore-stores-postgres-err01: Invalid connection string:', err);
    return null;
  }
}
