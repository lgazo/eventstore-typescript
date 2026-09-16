# Postgres Table Name Config & Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tableName` and `tenantId` options to `PostgresEventStore`, with tenant scoping enforced in SQL (query WHERE clause and append CTE), mirroring the supabase store's semantics.

**Architecture:** Options surface mirrors `packages/supabase/src/store.ts` (options override connection-string params). Tenant scope becomes an AND-ed SQL predicate in both SQL builders so `MAX(sequence_number)` in the optimistic-concurrency check is computed within the same scope the command queried. Inserts bind the tenant value (or leave NULL for shared-stream stores).

**Tech Stack:** TypeScript (strict), `pg`, jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-09-16-postgres-table-name-tenancy-design.md` (approved). Decisions from review: `tenant_id TEXT`; no-tenant store sees only `tenant_id IS NULL` rows; connection-string params `table`/`tenantId` supported.

## Global Constraints

- Strict TypeScript: no `any` unless already in the codebase (`transform.ts` row params keep existing style), no unchecked casts without justification.
- Never weaken optimistic locking: the append concurrency check (`COALESCE(max_seq, 0) = $n`) must stay, computed over the tenant-scoped context query.
- Error codes are sequential: next free codes in `packages/postgres` are `err11` (invalid table name) and `err12` (invalid tenant id). Existing `err01`–`err10` unchanged.
- Table/identifier names are never interpolated unquoted — always through `quoteIdentifier` (doubles embedded quotes; rejects empty strings and null bytes with `eventstore-stores-postgres-err07`/`err08`).
- Run tests from repo root: `npx jest packages/postgres --coverage=false`. Core package needs no build for jest (moduleNameMapper maps to `src`).
- Commit after every task; message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---

### Task 1: Parameterized schema DDL in `packages/postgres/src/schema.ts`

**Files:**
- Modify: `packages/postgres/src/schema.ts`
- Test: `packages/postgres/src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: existing private `quoteIdentifier(identifier: string): string` in `schema.ts`.
- Produces (used by Tasks 2 and 3): `export function quoteIdentifier(identifier: string): string`; `export function createEventsTableSql(tableName: string): string`; `export function createEventTypeIndexSql(tableName: string): string`; `export function createOccurredAtIndexSql(tableName: string): string`; `export function createPayloadGinIndexSql(tableName: string): string`; `export function createTenantSequenceIndexSql(tableName: string): string`. Back-compat constants `CREATE_EVENTS_TABLE`, `CREATE_EVENT_TYPE_INDEX`, `CREATE_OCCURRED_AT_INDEX`, `CREATE_PAYLOAD_GIN_INDEX` remain exported, now defined as the `'events'`-table calls of these functions (their strings change: table name becomes quoted `"events"`).

- [ ] **Step 1: Write the failing tests**

Replace the `describe('SQL Constants')` block in `packages/postgres/src/__tests__/schema.test.ts` with:

```ts
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
```

Update the import at the top of the test file to add the new functions:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest packages/postgres/src/__tests__/schema.test.ts --coverage=false`
Expected: FAIL — `createEventsTableSql` is not defined (TS error).

- [ ] **Step 3: Write the implementation**

In `packages/postgres/src/schema.ts`:

1. Add `export` to the existing `quoteIdentifier` function (keep the body exactly as is, including `err07`/`err08` messages).
2. Replace the four `CREATE_*` constants with functions plus back-compat aliases:

```ts
export function createEventsTableSql(tableName: string): string {
  return `
  CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (
    sequence_number BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL
  )
`;
}

export function createEventTypeIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_type`)} ON ${quoteIdentifier(tableName)}(event_type)
`;
}

export function createOccurredAtIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_occurred_at`)} ON ${quoteIdentifier(tableName)}(occurred_at)
`;
}

export function createPayloadGinIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_payload_gin`)} ON ${quoteIdentifier(tableName)} USING gin(payload)
`;
}

export function createTenantSequenceIndexSql(tableName: string): string {
  return `
  CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${tableName}_tenant_seq`)} ON ${quoteIdentifier(tableName)}(tenant_id, sequence_number)
`;
}

export const CREATE_EVENTS_TABLE = createEventsTableSql('events');
export const CREATE_EVENT_TYPE_INDEX = createEventTypeIndexSql('events');
export const CREATE_OCCURRED_AT_INDEX = createOccurredAtIndexSql('events');
export const CREATE_PAYLOAD_GIN_INDEX = createPayloadGinIndexSql('events');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest packages/postgres/src/__tests__/schema.test.ts --coverage=false`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Verify the whole postgres package still compiles (back-compat constants keep `store.ts` building)**

Run: `npx tsc -p packages/postgres/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/postgres/src/schema.ts packages/postgres/src/__tests__/schema.test.ts
git commit -m "feat(postgres): parameterized table DDL with tenant_id column

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Table name and tenant scope in SQL builders

**Files:**
- Modify: `packages/postgres/src/sql.ts`
- Test: `packages/postgres/src/__tests__/sql.test.ts`

**Interfaces:**
- Consumes: `quoteIdentifier` from `./schema` (Task 1).
- Produces (used by Task 3): `buildContextQuerySql(query: EventQuery, tableName?: string, tenantId?: string): { sql: string; params: unknown[] }` and `buildAppendSql(query: EventQuery, expectedMaxSeq: number, tableName?: string, tenantId?: string): { sql: string; params: unknown[] }`. Defaults preserve single-table, no-tenant behavior; `tenantId === undefined` emits no tenant clause and inserts no `tenant_id` value (column stays NULL).

Parameter order contract: with a tenant, the tenant param is `$1`; `minSequenceNumber` and filter params follow; in `buildAppendSql` the expected-max-seq, event-types, and payloads params follow the tenant + filter params.

- [ ] **Step 1: Write the failing tests**

Add these describes to `packages/postgres/src/__tests__/sql.test.ts` (keep existing tests, but update every expected SQL string that references the `events` table to the quoted form `"events"` — defaults now quote the table name; e.g. `'SELECT * FROM "events" ORDER BY sequence_number ASC'`, `'WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events")\nINSERT INTO "events" (event_type, payload)\n...'`). Then add:

```ts
  describe('table name', () => {
    it('query uses custom table name', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[])), 'events_spa');
      expect(result.sql).toBe('SELECT * FROM "events_spa" WHERE ((event_type = ANY($1))) ORDER BY sequence_number ASC');
      expect(result.params).toEqual([["t1"]]);
    });

    it('append uses custom table name', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1, 'events_spa');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events_spa")
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

    it('no tenantId emits no tenant clause (shared stream)', () => {
      const result = buildContextQuerySql(createQuery(createFilter(["t1"],[])), 'events');
      expect(result.sql).toBe('SELECT * FROM "events" WHERE ((event_type = ANY($1))) ORDER BY sequence_number ASC');
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

    it('append without tenantId omits tenant_id column', () => {
      const result = buildAppendSql(createQuery(createFilter([],[])), 1, 'events');
      expect(result.sql).toBe(`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM "events")
INSERT INTO "events" (event_type, payload)
SELECT unnest($2::text[]), unnest($3::jsonb[]) FROM context WHERE COALESCE(max_seq, 0) = $1
RETURNING *`);
      expect(result.params).toEqual([1]);
    });
  });
```

Note the append-with-tenant layout: context WHERE uses `$1` (tenant) and `$2` (filter); `COALESCE(max_seq, 0) = $3` compares against `expectedMaxSeq`; the inserted `tenant_id` value references the tenant param `$1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest packages/postgres/src/__tests__/sql.test.ts --coverage=false`
Expected: FAIL — new describes fail; quoted-table expectations fail until implementation.

- [ ] **Step 3: Write the implementation**

In `packages/postgres/src/sql.ts`:

```ts
import { EventFilter, EventQuery } from '@ricofritzsche/eventstore';
import { quoteIdentifier } from './schema';
```

Change `buildContextQuerySql` (keep `compileContextQueryConditions*` untouched):

```ts
export function buildContextQuerySql(query: EventQuery, tableName: string = 'events', tenantId?: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (tenantId !== undefined) {
    params.push(tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  }

  if (query.options?.minSequenceNumber !== undefined) {
    params.push(query.options.minSequenceNumber);
    clauses.push(`sequence_number > $${params.length}`);
  }

  const conditions = compileContextQueryConditions(query, params.length);
  params.push(...conditions.params);

  if (conditions.sql.length > 0) {
    clauses.push(conditions.sql);
  }

  let sql = `SELECT * FROM ${quoteIdentifier(tableName)}`;
  if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY sequence_number ASC';

  return { sql, params };
}
```

Change `buildAppendSql`:

```ts
export function buildAppendSql(query: EventQuery, expectedMaxSeq: number, tableName: string = 'events', tenantId?: string): { sql: string, params: unknown[] } {
  const tenantParams: unknown[] = tenantId !== undefined ? [tenantId] : [];
  const conditions = compileContextQueryConditions(query, tenantParams.length);

  const contextParams = [...tenantParams, ...conditions.params];
  const contextWhere = [
    ...(tenantId !== undefined ? [`tenant_id = $${tenantParams.length}`] : []),
    ...(conditions.sql.length > 0 ? [conditions.sql] : []),
  ].join(' AND ');

  const expectedMaxSeqParam = contextParams.length + 1;
  const eventTypesParam = contextParams.length + 2;
  const payloadsParam = contextParams.length + 3;

  const insertColumns = tenantId !== undefined
    ? 'event_type, payload, tenant_id'
    : 'event_type, payload';
  const tenantSelect = tenantId !== undefined ? ', $1' : '';
  const contextWhereSql = contextWhere.length > 0 ? ' WHERE ' + contextWhere : '';

  return {
    sql:
`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM ${quoteIdentifier(tableName)}${contextWhereSql})
INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns})
SELECT unnest($${eventTypesParam}::text[]), unnest($${payloadsParam}::jsonb[])${tenantSelect} FROM context WHERE COALESCE(max_seq, 0) = $${expectedMaxSeqParam}
RETURNING *`,
    params: [...contextParams, expectedMaxSeq]
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest packages/postgres/src/__tests__/sql.test.ts packages/postgres/src/__tests__/sqlconditions.test.ts --coverage=false`
Expected: PASS (including pre-existing tests with updated quoted-table expectations).

- [ ] **Step 5: Commit**

```bash
git add packages/postgres/src/sql.ts packages/postgres/src/__tests__/sql.test.ts
git commit -m "feat(postgres): tenant-scoped SQL builders with configurable table

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Store options, connection-string params, and plumbing

**Files:**
- Modify: `packages/postgres/src/store.ts`
- Modify: `packages/postgres/src/index.ts` (export the parse function and parsed type)
- Test: `packages/postgres/src/__tests__/store.test.ts` (new file)

**Interfaces:**
- Consumes: `buildContextQuerySql(query, tableName?, tenantId?)`, `buildAppendSql(query, expectedMaxSeq, tableName?, tenantId?)` (Task 2); `createEventsTableSql/createEventTypeIndexSql/createOccurredAtIndexSql/createPayloadGinIndexSql/createTenantSequenceIndexSql` (Task 1).
- Produces: `export interface ParsedPostgresConnectionString { connectionString: string; tableName?: string; tenantId?: string }`; `export function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnectionString`; `PostgresEventStoreOptions` gains `tableName?: string; tenantId?: string`. `parsePostgresConnectionString` and `ParsedPostgresConnectionString` are exported from `packages/postgres/src/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/postgres/src/__tests__/store.test.ts`:

```ts
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
      expect(() => new PostgresEventStore({ connectionString: BASE, tableName: 'eve nts' }))
        .toThrow('eventstore-stores-postgres-err11');
    });

    it('should reject empty tenant id with err12', () => {
      expect(() => new PostgresEventStore({ connectionString: BASE, tenantId: '' }))
        .toThrow('eventstore-stores-postgres-err12');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest packages/postgres/src/__tests__/store.test.ts --coverage=false`
Expected: FAIL — `parsePostgresConnectionString` not exported, options unknown, fields private.

- [ ] **Step 3: Write the implementation**

In `packages/postgres/src/store.ts`:

1. Options interface:

```ts
export interface PostgresEventStoreOptions {
  connectionString?: string;
  tableName?: string;
  tenantId?: string;
  notifier?: EventStreamNotifier;
}

export interface ParsedPostgresConnectionString {
  connectionString: string;
  tableName?: string;
  tenantId?: string;
}

export function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnectionString {
  const url = new URL(connectionString);
  const tableName = url.searchParams.get('table') ?? undefined;
  const tenantId = url.searchParams.get('tenantId') ?? undefined;

  url.searchParams.delete('table');
  url.searchParams.delete('tenantId');

  return {
    connectionString: url.toString(),
    ...(tableName ? { tableName } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}
```

2. In the constructor, after the connection-string resolution, add:

```ts
    const parsed = options.connectionString
      ? parsePostgresConnectionString(options.connectionString)
      : undefined;

    this.tableName = options.tableName ?? parsed?.tableName ?? 'events';
    if (this.tableName.length === 0 || this.tableName.includes(' ')) {
      throw new Error('eventstore-stores-postgres-err11: Invalid table name. Table name must not be empty or contain null bytes.');
    }
    this.tenantId = options.tenantId ?? parsed?.tenantId;
    if (this.tenantId !== undefined && this.tenantId.length === 0) {
      throw new Error('eventstore-stores-postgres-err12: Invalid tenant id. Tenant id must not be empty.');
    }
```

IMPORTANT: run this BEFORE `new Pool({ connectionString })` so a rejected connection string (with its params stripped) is what the pool gets — assign `this.connectionString = parsed?.connectionString ?? resolvedConnectionString` and pass that to the Pool. The database-name extraction keeps using the full original connection string (db name comes from the path, unaffected by param stripping).

3. New private readonly fields:

```ts
  private readonly tableName: string;
  private readonly tenantId: string | undefined;
```

Expose them for tests as public readonly getters or public readonly fields (fields are fine; the test above reads `store.tableName`).

4. Plumb through:

```ts
    // in query():
      const sqlQuery = buildContextQuerySql(eventQuery, this.tableName, this.tenantId);

    // in append():
      const cteQuery = buildAppendSql(eventQuery, expectedMaxSequenceNumber, this.tableName, this.tenantId);

    // in createTableAndIndexes():
      await client.query(createEventsTableSql(this.tableName));
      await client.query(createEventTypeIndexSql(this.tableName));
      await client.query(createOccurredAtIndexSql(this.tableName));
      await client.query(createPayloadGinIndexSql(this.tableName));
      await client.query(createTenantSequenceIndexSql(this.tableName));
```

Replace the `CREATE_EVENTS_TABLE`/`CREATE_EVENT_TYPE_INDEX`/`CREATE_OCCURRED_AT_INDEX`/`CREATE_PAYLOAD_GIN_INDEX` imports from `./schema` with the five function imports.

5. In `packages/postgres/src/index.ts`:

```ts
export { PostgresEventStore, PostgresEventStoreOptions, parsePostgresConnectionString, ParsedPostgresConnectionString } from './store';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest packages/postgres --coverage=false`
Expected: PASS — all postgres package tests, including pre-existing ones.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p packages/postgres/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/postgres/src/store.ts packages/postgres/src/index.ts packages/postgres/src/__tests__/store.test.ts
git commit -m "feat(postgres): tableName and tenantId options with connection-string params

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: README documentation and full-suite verification

**Files:**
- Modify: `packages/postgres/README.md`

**Interfaces:**
- Consumes: the finished API from Tasks 1–3 (`tableName`, `tenantId`, `parsePostgresConnectionString`).
- Produces: documented usage. No code changes.

- [ ] **Step 1: Add usage sections to `packages/postgres/README.md`**

After the existing usage example, add:

````markdown
## Options

| Option | Default | Description |
| --- | --- | --- |
| `connectionString` | `DATABASE_URL` env var | Postgres connection string |
| `tableName` | `events` | Name of the events table |
| `tenantId` | `undefined` | Tenant scope for this store instance |
| `notifier` | `MemoryEventStreamNotifier` | Event stream notifier for subscriptions |

Connection-string shorthand: `?table=<name>&tenantId=<id>` query params, stripped before connecting:

```ts
const store = new PostgresEventStore({
  connectionString: 'postgresql://user:pass@localhost:5432/myapp?table=events_spa&tenantId=tenant-1',
});
```

Explicit options override connection-string params.

## Streams: shared vs tenant-scoped

**Shared stream (no `tenantId`):** reads and writes only rows with `tenant_id IS NULL`. Use for single-tenant apps.

```ts
const store = new PostgresEventStore({ connectionString: process.env.DATABASE_URL });
```

**Tenant-scoped stream (`tenantId`):** reads and writes only rows with `tenant_id = <value>`. Use one store instance per tenant.

```ts
const store = new PostgresEventStore({
  connectionString: process.env.DATABASE_URL,
  tableName: 'events',
  tenantId: 'tenant-1',
});
```

Tenant scoping is enforced in SQL: queries filter on `tenant_id`, and the optimistic-concurrency check (`MAX(sequence_number)` inside the append CTE) is computed within the tenant's scope. Sequence numbers are a shared `BIGSERIAL`, so per-tenant maxima have gaps — the check compares the expected max **within the queried scope**.

## Custom table name

```ts
const store = new PostgresEventStore({
  connectionString: process.env.DATABASE_URL,
  tableName: 'events_spa',
});
await store.initializeDatabase(); // creates "events_spa" plus per-table indexes
```

## Existing deployments

To upgrade an existing `events` table to tenant support without recreating it:

```sql
ALTER TABLE events ADD COLUMN tenant_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tenant_seq ON events(tenant_id, sequence_number);
```

Legacy rows have `tenant_id IS NULL`, so a store without `tenantId` keeps seeing exactly the rows it saw before.
````

- [ ] **Step 2: Run the full test suite**

Run: `npx jest --coverage=false`
Expected: PASS — entire repo suite green (core, postgres, supabase).

- [ ] **Step 3: Build check**

Run: `npm run build:core && npx tsc -p packages/postgres/tsconfig.json --noEmit`
Expected: no errors. (If `build:core` is not defined in `package.json`, run `npx tsc -p tsconfig.json --noEmit` for the core package instead.)

- [ ] **Step 4: Commit**

```bash
git add packages/postgres/README.md
git commit -m "docs(postgres): document tableName and tenantId options

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
