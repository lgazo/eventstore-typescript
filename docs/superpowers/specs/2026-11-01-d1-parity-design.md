# ESTS-6: D1 store gap closure — spec

Follows the gap analysis on ESTS-6 ("review the current state of CloudFlare D1 implementation"). Scope: bring `D1EventStore` (`packages/d1/`) to meaningful parity with `PostgresEventStore` and prove it against a real D1 runtime. Mirrors the decisions of the ESTS-5 postgres tenancy spec (`docs/superpowers/specs/2026-09-16-postgres-table-name-tenancy-design.md`) wherever the same capability lands on a second store.

## Architectural principles held fixed

- Core (`src/`) is storage-agnostic; stores implement `EventStore` and own their SQL. No core type changes.
- **Optimistic concurrency is the single-statement conditional append** — D1 has no interactive transactions, so no transaction is introduced or "wrapped". The append is one atomic SQLite statement: `INSERT … SELECT … WHERE (SELECT MAX(sequence_number) …) = ?`, err03 on mismatch. This is preserved; tenancy and timestamps must ride inside that statement.
- Payload predicates keep their two-layer semantics: SQL `json_extract` equality pre-filter (SQLite JSON1 cannot express recursive subset matching) + JS `filterEventsByQuery` subset post-filter. Nested/array predicates remain refused on D1 (err06) — accepted limitation, documented.
- Strict TypeScript, no `any`; no weakened locking to make tests pass.

## Requirements

### 1. Tenancy (mirrors postgres / supabase semantics)

- `D1EventStoreOptions` gains `tenantId?: string`. Empty string rejected with a new error, `eventstore-stores-d1-err07` (one instance, one scope — same as postgres).
- Table `events` gains `tenant_id TEXT NULL`. Legacy rows are NULL = shared stream.
- Store without `tenantId`: reads and writes only `tenant_id IS NULL` rows. Store with `tenantId`: only `tenant_id = <value>` rows. Tenant clause is AND-ed into both the query WHERE and the append context max check, so the expected sequence is always compared against the max inside the same scope the command queried.
- Append binds `tenant_id` per row (shared-stream stores bind NULL — column present in INSERT list to be explicit).
- Schema migration for legacy databases: `initializeDatabase()` attempts `ALTER TABLE events ADD COLUMN tenant_id TEXT` and treats a `duplicate column name` failure as already-migrated (non-fatal). Fresh deployments get the column from CREATE TABLE.

### 2. `minSequenceNumber` support

- `EventQuery.options.minSequenceNumber` must no longer be silently ignored: `createContextQuerySql` appends `sequence_number > ?` to the query WHERE. Append context (the optimistic check) is unaffected — postgres behaves the same way (`packages/postgres/src/sql.ts:64-67`, append has no min clause).

### 3. Timestamp fidelity

- New appends stop relying on SQLite's `CURRENT_TIMESTAMP` (UTC, second resolution, space-separated). The store binds `occurred_at` explicitly as `new Date().toISOString()` (UTC, millisecond resolution, ISO-8601) per append command — all events in one append share the timestamp. The column keeps its DEFAULT for legacy rows. `EventRecord.timestamp` stays a `Date` produced by `new Date(row.occurred_at)`; ISO strings parse everywhere `CURRENT_TIMESTAMP` strings did.

### 4. Real e2e test against a real D1 runtime

- New dev dependency `miniflare` (root `package.json`). Miniflare runs the actual workers D1 sqlite implementation in-process (workerd); the test imports `Miniflare`, creates a binding, and drives `D1EventStore` through the real `D1Database`.
- New suite `tests/d1.miniflare.e2e.test.ts` (jest, style of `tests/supabase.scenario.test.ts`; no external env needed — miniflare is local) covering: `initializeDatabase()` DDL + legacy ALTER, append/query round-trip, stale expected sequence rejected and nothing written, multi-event all-or-nothing, two-appends-same-expected-exactly-one-wins (real D1 statement processing), tenancy isolation (shared vs tenant-scoped stores on the same DB, plus cross-tenant read exclusion), `minSequenceNumber`, timestamp millisecond precision & ISO parseability.
- The suite runs on every `npm test` (jest roots already include `tests/`). If workerd cannot start in the environment the suite fails loudly — we want that signal, not a skip.

### 5. Shipped migration + docs cleanup

- `packages/d1/migrations/0001_initialize.sql`: CREATE TABLE (with `tenant_id`), type index, occurred_at index — deployable with `wrangler d1 migrations apply`; documented in the package README section added to the root README.
- Root README corrected: D1 append is a single conditional statement, not "wrapped transactions… rolls back" (`README.md:92,329`); document tenant usage, `minSequenceNumber`, and D1 limitations (scalar predicates only, 100 bound-parameter D1 limit ≈ max events per append, no interactive transactions).
- Dead code removed: `createPayloadKeyIndex` (`packages/d1/src/schema.ts:18`) — never called; SQLite lacks a GIN analog for it. Stale `// AFAIK this won't work with CF` comment removed once the DDL is exercised by the e2e suite.

## Non-goals

- Nested/array payload predicates on D1 (JSON1 cannot do subset matching recursively; refused err06, documented).
- Configurable table name (postgres-only concern; a D1 user reaches the same result by using separate databases).
- Real cross-process/concurrent-Workers concurrency proof (in-process D1 statement atomicity is the proof surface we can run repeatedly in CI).
- Per-tenant sequence generators (sequence numbers stay a global rowid, gaps expected — same as postgres/supabase).

## Error codes

- `err07`: invalid tenant id, empty string. Next free code in the package after `err06`.

## Testing

- Unit: `packages/d1/src/__tests__/store.test.ts` on the node:sqlite shim — tenant semantics, min-seq, timestamp format, legacy column migration.
- E2E: `tests/d1.miniflare.e2e.test.ts` against real miniflare D1 — full scenario list above.
- All existing suites stay green.