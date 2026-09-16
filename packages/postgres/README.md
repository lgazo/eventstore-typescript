# @ricofritzsche/eventstore-postgres

PostgreSQL implementation for [`@ricofritzsche/eventstore`](https://www.npmjs.com/package/@ricofritzsche/eventstore).

## Installation

```bash
npm install @ricofritzsche/eventstore @ricofritzsche/eventstore-postgres
```

## Usage

```ts
import { createFilter } from '@ricofritzsche/eventstore';
import { PostgresEventStore } from '@ricofritzsche/eventstore-postgres';

const eventStore = new PostgresEventStore({
  connectionString: process.env.DATABASE_URL,
});

await eventStore.append([
  {
    eventType: 'AccountOpened',
    payload: { accountId: '123', owner: 'Alice' },
  },
]);

const query = createFilter(['AccountOpened']);
const result = await eventStore.query(query);
console.log(result.events);
```

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

> Note: the `?table=`/`?tenantId=` shorthand is parsed only from an explicit `connectionString` option, not from the `DATABASE_URL` environment variable.

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

Tenant-less stores always emit `tenant_id IS NULL` in SQL, so the events table **must** have a `tenant_id` column. **Before using the upgraded package version against an existing table, run this migration — required, not optional** (queries fail with `column "tenant_id" does not exist` until it runs):

```sql
ALTER TABLE events ADD COLUMN tenant_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tenant_seq ON events(tenant_id, sequence_number);
```

Legacy rows have `tenant_id IS NULL`, so a store without `tenantId` keeps seeing exactly the rows it saw before.

> Workspace note: when working inside this repository, build `@ricofritzsche/eventstore` first (`npm run build:core`) so that its type declarations are available for this package's compiler.

## License

MIT © Rico Fritzsche
