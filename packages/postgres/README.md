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

> Workspace note: when working inside this repository, build `@ricofritzsche/eventstore` first (`npm run build:core`) so that its type declarations are available for this package's compiler.

## License

MIT © Rico Fritzsche
