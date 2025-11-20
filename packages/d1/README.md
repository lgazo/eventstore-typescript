# @ricofritzsche/eventstore-d1

Cloudflare D1 implementation for [`@ricofritzsche/eventstore`](https://www.npmjs.com/package/@ricofritzsche/eventstore).

## Installation

```bash
npm install @ricofritzsche/eventstore @ricofritzsche/eventstore-d1
```

## Usage

```ts
import { createFilter } from '@ricofritzsche/eventstore';
import { D1EventStore } from '@ricofritzsche/eventstore-d1';

export default {
  async fetch(request: Request, env: { EVENTSTORE: D1Database }) {
    const eventStore = new D1EventStore({
      database: env.EVENTSTORE,
    });

    await eventStore.append([
      {
        eventType: 'AccountOpened',
        payload: { accountId: '123', owner: 'Alice' },
      },
    ]);

    const query = createFilter(['AccountOpened']);
    const result = await eventStore.query(query);
    return Response.json(result.events);
  },
};
```

> Workspace note: when working inside this repository, build `@ricofritzsche/eventstore` first (`npm run build:core`) so that its type declarations are available for this package's compiler.

## License

MIT © Rico Fritzsche
