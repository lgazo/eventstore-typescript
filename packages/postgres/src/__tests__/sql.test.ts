import { buildContextQuerySql, buildAppendSql } from '../sql';
import { createFilter, createQuery } from '@ricofritzsche/eventstore';

describe('Sql builder', () => {
  describe('query', () => {
    it('No filters', () => {
      const result = buildContextQuerySql(createQuery(createFilter([],[])));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL ORDER BY sequence_number ASC');
      expect(result.params).toEqual([]);
    });

    it('event type', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[])));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND ((event_type = ANY($1))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([["t1"]]);
    });

    it('event type with payload', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[{a:1}])));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND ((event_type = ANY($1) AND (payload @> $2))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([["t1"], "{\"a\":1}"]);
    });

    it('minSequenceNumber only', () => {
      const result = buildContextQuerySql(createQuery({ minSequenceNumber: 5 }));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND sequence_number > $1 ORDER BY sequence_number ASC');
      expect(result.params).toEqual([5]);
    });

    it('event type with minSequenceNumber', () => {
      const result = buildContextQuerySql(createQuery({ minSequenceNumber: 10 }, createFilter(["t1"],[])));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND sequence_number > $1 AND ((event_type = ANY($2))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([10, ["t1"]]);
    });

    it('event type with payload and minSequenceNumber', () => {
      const result = buildContextQuerySql(createQuery({ minSequenceNumber: 3 }, createFilter(["t1"],[{a:1}])));
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND sequence_number > $1 AND ((event_type = ANY($2) AND (payload @> $3))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([3, ["t1"], "{\"a\":1}"]);
    });
  });

  describe('append', () => {
    it('No filters', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1);
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id IS NULL)
INSERT INTO "events" (event_type, payload)
SELECT unnest($2::text[]), unnest($3::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $1
RETURNING *`);
      expect(result.params).toEqual([1]);
    });

    it('event type', () => {
      const result = buildAppendSql(createQuery(createFilter(["t1"],[])), 2);
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id IS NULL AND ((event_type = ANY($1))))
INSERT INTO "events" (event_type, payload)
SELECT unnest($3::text[]), unnest($4::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $2
RETURNING *`);
      expect(result.params).toEqual([["t1"], 2]);
    });

    it('event type with payload', () => {
      const result = buildAppendSql(createQuery(createFilter(["t1"],[{a:1}])), 3);
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id IS NULL AND ((event_type = ANY($1) AND (payload @> $2))))
INSERT INTO "events" (event_type, payload)
SELECT unnest($4::text[]), unnest($5::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $3
RETURNING *`);
      expect(result.params).toEqual([["t1"], "{\"a\":1}", 3]);
    });
  });

  describe('table name', () => {
    it('query uses custom table name', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[])), 'events_spa');
      expect(result.sql).toBe('SELECT * FROM "events_spa" WHERE tenant_id IS NULL AND ((event_type = ANY($1))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([["t1"]]);
    });

    it('append uses custom table name', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1, 'events_spa');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events_spa" WHERE tenant_id IS NULL)
INSERT INTO "events_spa" (event_type, payload)
SELECT unnest($2::text[]), unnest($3::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $1
RETURNING *`);
      expect(result.params).toEqual([1]);
    });
  });

  describe('tenant scope', () => {
    it('query with tenantId only', () => {
      const result = buildContextQuerySql(createQuery(createFilter([],[])), 'events', 'tenant-1');
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id = $1 ORDER BY sequence_number ASC');
      expect(result.params).toEqual(['tenant-1']);
    });

    it('query with tenantId and minSequenceNumber', () => {
      const result = buildContextQuerySql(createQuery({ minSequenceNumber: 5 }), 'events', 'tenant-1');
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id = $1 AND sequence_number > $2 ORDER BY sequence_number ASC');
      expect(result.params).toEqual(['tenant-1', 5]);
    });

    it('query with tenantId and filters', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[{a:1}])), 'events', 'tenant-1');
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id = $1 AND ((event_type = ANY($2) AND (payload @> $3))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual(['tenant-1', ["t1"], "{\"a\":1}"]);
    });

    it('no tenantId scopes query to tenant_id IS NULL rows (shared stream)', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[])), 'events');
      expect(result.sql).toBe('SELECT * FROM "events" WHERE tenant_id IS NULL AND ((event_type = ANY($1))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([["t1"]]);
    });

    it('append with tenantId scopes context max and inserts tenant_id', () => {
      const result = buildAppendSql(createQuery(createFilter(["t1"],[])), 2, 'events', 'tenant-1');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id = $1 AND ((event_type = ANY($2))))
INSERT INTO "events" (event_type, payload, tenant_id)
SELECT unnest($4::text[]), unnest($5::jsonb[]), $1 FROM context WHERE COALESCE(max_seq, 0) = $3
RETURNING *`);
      expect(result.params).toEqual(['tenant-1', ["t1"], 2]);
    });

    it('append without tenantId scopes context to tenant_id IS NULL and omits tenant_id column', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1, 'events');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id IS NULL)
INSERT INTO "events" (event_type, payload)
SELECT unnest($2::text[]), unnest($3::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $1
RETURNING *`);
      expect(result.params).toEqual([1]);
    });

    it('append with tenantId and no filters scopes context to tenant only', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1, 'events', 'tenant-1');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events" WHERE tenant_id = $1)
INSERT INTO "events" (event_type, payload, tenant_id)
SELECT unnest($3::text[]), unnest($4::jsonb[]), $1 FROM context WHERE COALESCE(max_seq, 0) = $2
RETURNING *`);
      expect(result.params).toEqual(['tenant-1', 1]);
    });
  });
});
