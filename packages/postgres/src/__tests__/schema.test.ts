import { 
  createDatabaseQuery,
  changeDatabaseInConnectionString,
  getDatabaseNameFromConnectionString,
  CREATE_EVENTS_TABLE,
  CREATE_EVENT_TYPE_INDEX,
  CREATE_OCCURRED_AT_INDEX,
  CREATE_PAYLOAD_GIN_INDEX,
  createEventsTableSql,
  createEventTypeIndexSql,
  createOccurredAtIndexSql,
  createPayloadGinIndexSql,
  createTenantSequenceIndexSql
} from '../schema';

describe('Schema Functions', () => {
  describe('createDatabaseQuery', () => {
    it('should create database query string', () => {
      const result = createDatabaseQuery('testdb');
      expect(result).toBe('CREATE DATABASE "testdb"');
    });

    it('should escape double quotes in database name', () => {
      const result = createDatabaseQuery('te"stdb');
      expect(result).toBe('CREATE DATABASE "te""stdb"');
    });
  });

  describe('changeDatabaseInConnectionString', () => {
    it('should change database name in connection string', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/olddb';
      const result = changeDatabaseInConnectionString(connStr, 'newdb');
      expect(result).toBe('postgresql://user:pass@localhost:5432/newdb');
    });

    it('should handle connection string without port', () => {
      const connStr = 'postgresql://user:pass@localhost/olddb';
      const result = changeDatabaseInConnectionString(connStr, 'newdb');
      expect(result).toBe('postgresql://user:pass@localhost/newdb');
    });
  });

  describe('getDatabaseNameFromConnectionString', () => {
    it('should extract database name from connection string', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/myapp';
      const result = getDatabaseNameFromConnectionString(connStr);
      expect(result).toBe('myapp');
    });

    it('should handle connection string with trailing slash', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/myapp/';
      const result = getDatabaseNameFromConnectionString(connStr);
      expect(result).toBe('myapp/');
    });

    it('should return null for invalid connection string', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const connStr = 'invalid-connection-string';
      const result = getDatabaseNameFromConnectionString(connStr);
      expect(result).toBe(null);
      consoleSpy.mockRestore();
    });

    it('should return null for connection string without database', () => {
      const connStr = 'postgresql://user:pass@localhost:5432/';
      const result = getDatabaseNameFromConnectionString(connStr);
      expect(result).toBe(null);
    });
  });

  describe('parameterized DDL', () => {
    it('should create events table SQL with tenant column for custom table', () => {
      const result = createEventsTableSql('events_spa');
      expect(result).toContain('CREATE TABLE IF NOT EXISTS "events_spa"');
      expect(result).toContain('sequence_number BIGSERIAL PRIMARY KEY');
      expect(result).toContain('tenant_id TEXT NULL');
      expect(result).toContain('event_type TEXT NOT NULL');
      expect(result).toContain('payload JSONB NOT NULL');
    });

    it('should quote embedded double quotes in table name', () => {
      const result = createEventsTableSql('even"ts');
      expect(result).toContain('"even""ts"');
    });

    it('should reject empty table name', () => {
      expect(() => createEventsTableSql('')).toThrow('eventstore-stores-postgres-err07');
    });

    it('should create index SQL with per-table index names', () => {
      expect(createEventTypeIndexSql('events_spa')).toBe(
        'CREATE INDEX IF NOT EXISTS "idx_events_spa_type" ON "events_spa"(event_type)'
      );
      expect(createOccurredAtIndexSql('events_spa')).toBe(
        'CREATE INDEX IF NOT EXISTS "idx_events_spa_occurred_at" ON "events_spa"(occurred_at)'
      );
      expect(createPayloadGinIndexSql('events_spa')).toBe(
        'CREATE INDEX IF NOT EXISTS "idx_events_spa_payload_gin" ON "events_spa" USING gin(payload)'
      );
      expect(createTenantSequenceIndexSql('events_spa')).toBe(
        'CREATE INDEX IF NOT EXISTS "idx_events_spa_tenant_seq" ON "events_spa"(tenant_id, sequence_number)'
      );
    });

    it('should keep back-compat constants on the events table', () => {
      expect(CREATE_EVENTS_TABLE).toContain('CREATE TABLE IF NOT EXISTS "events"');
      expect(CREATE_EVENTS_TABLE).toContain('tenant_id TEXT NULL');
      expect(CREATE_EVENT_TYPE_INDEX).toContain('idx_events_type');
      expect(CREATE_OCCURRED_AT_INDEX).toContain('idx_events_occurred_at');
      expect(CREATE_PAYLOAD_GIN_INDEX).toContain('idx_events_payload_gin');
    });
  });
});
