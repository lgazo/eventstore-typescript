import {
  parsePostgresConnectionString,
  PostgresEventStore,
} from '../store';

const BASE = 'postgresql://user:pass@localhost:5432/myapp';

describe('PostgresEventStore construction', () => {
  describe('parsePostgresConnectionString', () => {
    it('should extract and strip table and tenantId params', () => {
      const parsed = parsePostgresConnectionString(`${BASE}?sslmode=disable&table=events_spa&tenantId=tenant-1`);
      expect(parsed.connectionString).toBe(`${BASE}?sslmode=disable`);
      expect(parsed.tableName).toBe('events_spa');
      expect(parsed.tenantId).toBe('tenant-1');
    });

    it('should return undefined for missing params', () => {
      const parsed = parsePostgresConnectionString(BASE);
      expect(parsed.connectionString).toBe(BASE);
      expect(parsed.tableName).toBeUndefined();
      expect(parsed.tenantId).toBeUndefined();
    });

    it('should ignore empty param values', () => {
      const parsed = parsePostgresConnectionString(`${BASE}?table=&tenantId=`);
      expect(parsed.tableName).toBeUndefined();
      expect(parsed.tenantId).toBeUndefined();
    });
  });

  describe('options resolution', () => {
    it('should default table name to events and no tenant', () => {
      const store = new PostgresEventStore({ connectionString: BASE });
      expect(store.tableName).toBe('events');
      expect(store.tenantId).toBeUndefined();
    });

    it('should prefer explicit options over connection-string params', () => {
      const store = new PostgresEventStore({
        connectionString: `${BASE}?table=from_conn&tenantId=conn-tenant`,
        tableName: 'from_option',
        tenantId: 'option-tenant',
      });
      expect(store.tableName).toBe('from_option');
      expect(store.tenantId).toBe('option-tenant');
    });

    it('should use connection-string params when options absent', () => {
      const store = new PostgresEventStore({
        connectionString: `${BASE}?table=from_conn&tenantId=conn-tenant`,
      });
      expect(store.tableName).toBe('from_conn');
      expect(store.tenantId).toBe('conn-tenant');
    });

    it('should reject empty table name with err11', () => {
      expect(() => new PostgresEventStore({ connectionString: BASE, tableName: '' }))
        .toThrow('eventstore-stores-postgres-err11');
    });

    it('should reject table name containing null byte with err11', () => {
      expect(() => new PostgresEventStore({ connectionString: BASE, tableName: 'eve\u0000nts' }))
        .toThrow('eventstore-stores-postgres-err11');
    });

    it('should reject empty tenant id with err12', () => {
      expect(() => new PostgresEventStore({ connectionString: BASE, tenantId: '' }))
        .toThrow('eventstore-stores-postgres-err12');
    });
  });
});