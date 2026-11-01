import { createFilter, createQuery } from '@lgazo/eventstore';
import type { D1Database } from '@lgazo/eventstore-d1';
import { Miniflare } from 'miniflare';
import { D1EventStore } from '../packages/d1/src/store';

const ev = (eventType: string, payload: Record<string, unknown>) => ({ eventType, payload });

describe('D1 store against real workerd D1 (miniflare)', () => {
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: { EVENTSTORE: '' },
    });
    const bindings = await mf.getBindings();
    // workers-types D1Database is a structural superset of the store's minimal interface.
    db = bindings.EVENTSTORE as unknown as D1Database;
  });

  afterAll(async () => {
    await mf.dispose();
  });

  const fresh = async () => {
    await db.exec('DROP TABLE IF EXISTS events');
    const store = new D1EventStore({ database: db });
    await store.initializeDatabase();
    return store;
  };

  test('initializeDatabase creates the schema on a real D1 binding', async () => {
    await fresh();
    const info = await db.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind('events').run();
    expect((info.results as Array<{ name: string }>).map((r) => r.name)).toContain('events');
  });

  test('a multi-event append lands all events or none', async () => {
    const store = await fresh();
    const f = createFilter(['A', 'B'], [{ k: 'atomic' }]);
    await store.append([ev('A', { k: 'atomic' }), ev('B', { k: 'atomic' })], f, 0);
    const { events } = await store.query(f);
    expect(events.map((e) => e.eventType)).toEqual(['A', 'B']);
  });

  test('stale expected sequence is rejected and nothing is written', async () => {
    const store = await fresh();
    const f = createFilter(['A', 'B'], [{ k: 'stale' }]);
    await store.append([ev('A', { k: 'stale' })], f, 0);
    await expect(store.append([ev('B', { k: 'stale' })], f, 0)).rejects.toThrow(/err03/);
    expect((await store.query(f)).events).toHaveLength(1);
  });

  test('two appends with the same expected sequence: exactly one wins', async () => {
    const store = await fresh();
    const f = createFilter(['A', 'B'], [{ k: 'race' }]);
    await store.append([ev('A', { k: 'race' })], f, 0);
    const results = await Promise.allSettled([
      store.append([ev('B', { k: 'race', n: 1 })], f, 1),
      store.append([ev('B', { k: 'race', n: 2 })], f, 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.query(f)).events).toHaveLength(2);
  });

  test('tenant-scoped and shared stores isolate rows on one binding', async () => {
    const store = await fresh();
    const shared = store;
    const tenant = new D1EventStore({ database: db, tenantId: 'tn_e2e' });
    const fs = createFilter(['A'], [{ k: 'shared' }]);
    const fa = createFilter(['A'], [{ k: 'tenant' }]);
    await store.append([ev('A', { k: 'shared' })], fs, 0);
    await tenant.append([ev('A', { k: 'tenant' })], fa, 0);
    expect((await tenant.query(fa)).events.map((e) => e.payload.k)).toEqual(['tenant']);
    expect((await shared.query(fs)).events.map((e) => e.payload.k)).toEqual(['shared']);
    expect((await tenant.query(fs)).events).toHaveLength(0);
    expect((await shared.query(fa)).events).toHaveLength(0);
  });

  test('tenant store can append after shared rows exist (scoped max sequence)', async () => {
    const store = await fresh();
    const shared = store;
    const tenant = new D1EventStore({ database: db, tenantId: 'tn_seq' });
    const fs = createFilter(['A'], [{ k: 's' }]);
    const fa = createFilter(['A'], [{ k: 'a' }]);
    await shared.append([ev('A', { k: 's' })], fs, 0);
    await tenant.append([ev('A', { k: 'a' })], fa, 0);
    expect((await tenant.query(fa)).maxSequenceNumber).toBe(2);
    await expect(tenant.append([ev('A', { k: 'nope' })], fa, 0)).rejects.toThrow(/err03/);
  });

  test('minSequenceNumber narrows the returned window', async () => {
    const store = await fresh();
    const f = createFilter(['A'], [{ k: 'w' }]);
    await store.append([ev('A', { k: 'w' }), ev('A', { k: 'w' })], f, 0);
    const q = createQuery({ minSequenceNumber: 1 }, f);
    const { events } = await store.query(q);
    expect(events.map((e) => e.sequenceNumber)).toEqual([2]);
  });

  test('timestamps are ISO strings with millisecond precision', async () => {
    const store = await fresh();
    const f = createFilter(['T'], [{ k: 'ts' }]);
    await store.append([ev('T', { k: 'ts' })], f, 0);
    const { events } = await store.query(f);
    const iso = events[0]!.timestamp.toISOString();
    expect(iso).toMatch(/\.\d{3}Z$/);
    expect(events[0]!.timestamp.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });
});
