# ESTS-5: table name config and multi-tenancy support for the postgres store

## Goals

- `tableName` option for `PostgresEventStore` (default `events`), honored in initialization, query building, and append.
- `tenantId` option mirroring the semantics the supabase store already ships (`packages/supabase/src/store.ts`), but enforced at the SQL level, which plain Postgres makes possible.

## Non-goals

- Row-level security, roles, or Supabase-style policies.
- One store instance serving multiple tenants (mirrors supabase: one instance, one scope).
- Migration tooling for existing deployments (documented manual `ALTER TABLE` instead).

## Recommended approach: mirror the supabase options surface, enforce scope in SQL

### Options

```ts
export interface PostgresEventStoreOptions {
  connectionString?: string;
  tableName?: string;   // default 'events'
  tenantId?: string;    // undefined => shared stream (tenant_id IS NULL rows only)
  notifier?: EventStreamNotifier;
}
```

Connection string gains query params `?table=<name>&tenantId=<id>`, parsed and stripped like `parseSupabaseConnectionString` does for supabase. Explicit options override connection-string values.

### Schema (`initializeDatabase`, `packages/postgres/src/schema.ts`)

- Table DDL becomes parameterized: `CREATE TABLE IF NOT EXISTS "<tableName>"`, identifier quoted with the existing `quoteIdentifier` (exported from `schema.ts` so `sql.ts` can reuse it).
- New column `tenant_id TEXT NULL`. TEXT rather than supabase's UUID: plain Postgres tenants need not be auth UUIDs. Supabase keeps UUID there because it binds to `auth.users.id`.
- Index names become per-table, as supabase already does: `idx_<table>_type`, `idx_<table>_occurred_at`, `idx_<table>_payload_gin`, plus a new composite `idx_<table>_tenant_seq ON (tenant_id, sequence_number)` for the tenant-scoped max-sequence lookup.
- Existing deployments: a documented manual `ALTER TABLE events ADD COLUMN tenant_id TEXT NULL` keeps old stores working (a store without `tenantId` reads only `tenant_id IS NULL` rows, which all legacy rows are).

### SQL building (`packages/postgres/src/sql.ts`)

- `buildContextQuerySql(query, tableName, tenantId)`: tenant scope clause is AND-ed ahead of the filter conditions — `tenant_id IS NULL` or `tenant_id = $n`; parameter ordering starts with the tenant param when present, then `minSequenceNumber`, then filter params.
- `buildAppendSql(query, expectedMaxSeq, tableName, tenantId)`:
  - Context CTE reads from the named table with the tenant scope AND-ed into its WHERE, so `MAX(sequence_number)` is the tenant-scoped max — the optimistic-concurrency check compares against the max observed inside the same scope the command queried.
  - INSERT gains the `tenant_id` column, bound to the store's tenant param (NULL for shared-stream stores).
- Sequence numbers stay a global `BIGSERIAL`; per-tenant maxima therefore have gaps. Same behavior as supabase; no per-tenant sequence generator.

### Query/append semantics (supabase parity)

- Store without `tenantId`: reads and writes only rows with `tenant_id IS NULL`.
- Store with `tenantId`: reads and writes only rows with `tenant_id = <value>`.
- Difference from supabase: no client-side `matchesTenantScope` post-filtering. Postgres scopes in SQL, so `append`'s `RETURNING *` rows are already correctly scoped and `query` does not over-fetch.

### Error handling

- `eventstore-stores-postgres-err11`: invalid table name (empty, null byte, or contains a double quote — `quoteIdentifier` validation, message extended to say table name).
- `eventstore-stores-postgres-err12`: invalid tenant id (empty string).
- Next free codes after `err10` in the current package.

### Files touched

- `packages/postgres/src/schema.ts` — parameterized DDL, index names, export `quoteIdentifier`.
- `packages/postgres/src/sql.ts` — table name and tenant scope in both builders.
- `packages/postgres/src/transform.ts` — `prepareInsertParams` appends the tenant param.
- `packages/postgres/src/store.ts` — options, conn-string parsing, plumb values through.
- `packages/postgres/README.md` — usage sections for shared vs tenant-scoped streams.

### Testing

- `sql.test.ts`: tenant scope clauses, table interpolation, param ordering with `minSequenceNumber` + filters.
- `schema.test.ts`: parameterized DDL/index names, `quoteIdentifier` edge cases.
- `transform.test.ts`: insert params include tenant value.
- No store-level test infra exists in this package (unit tests only); integration test against a live Postgres remains out of scope unless requested.

## Alternatives considered

- **Schema-per-tenant** (`search_path` per tenant, one events table each): strong isolation, but multiplies operational surface and diverges from the supabase pattern. Rejected.
- **Supabase-style JS post-filtering**: would keep `sql.ts` simpler, but over-fetches on query and would require post-filtering append results; SQL-level scoping is strictly better here. Rejected.

## Open questions

1. `tenant_id` type — TEXT (recommended, flexible) or UUID (strict supabase parity)?
2. Store without `tenantId`: only `tenant_id IS NULL` rows (recommended, supabase parity) or all rows including tenant rows?
3. Connection-string params `table`/`tenantId` (recommended, parity) or options only?