import { createFilter, createQuery } from '@ricofritzsche/eventstore';
import { D1EventStore } from '../store';
import { nodeSqliteD1 } from '../test-support/node-sqlite-d1';

const fresh = async () => {
  const db = nodeSqliteD1();
  const store = new D1EventStore({ database: db });
  await store.initializeDatabase();
  return { db, store };
};
const ev = (eventType: string, payload: Record<string, unknown>) => ({ eventType, payload });

test('append stores the real event type and payload (no literal placeholders)', async () => {
  const { store } = await fresh();
  const f = createFilter(['DraftOpened'], [{ proposalId: 'prp_a' }]);
  await store.append([ev('DraftOpened', { proposalId: 'prp_a', orgId: 7, title: 'x' })], f, 0);
  const r = await store.query(createQuery(f));
  expect(r.events).toHaveLength(1);
  expect(r.events[0]!.eventType).toBe('DraftOpened');
  expect(r.events[0]!.payload).toEqual({ proposalId: 'prp_a', orgId: 7, title: 'x' });
  expect(r.maxSequenceNumber).toBe(1);
});

test('query filters payload predicates in SQL, per stream', async () => {
  const { store } = await fresh();
  const fa = createFilter(['DraftOpened'], [{ proposalId: 'prp_a' }]);
  const fb = createFilter(['DraftOpened'], [{ proposalId: 'prp_b' }]);
  await store.append([ev('DraftOpened', { proposalId: 'prp_a' })], fa, 0);
  await store.append([ev('DraftOpened', { proposalId: 'prp_b' })], fb, 0);
  expect((await store.query(createQuery(fa))).events.map((e) => e.payload.proposalId)).toEqual(['prp_a']);
  expect((await store.query(createQuery(fb))).maxSequenceNumber).toBe(2);
});

test('stale expected sequence is rejected and nothing is written', async () => {
  const { store } = await fresh();
  const f = createFilter(['DraftOpened', 'DraftItemsUpserted'], [{ proposalId: 'prp_a' }]);
  await store.append([ev('DraftOpened', { proposalId: 'prp_a' })], f, 0);
  await expect(store.append([ev('DraftItemsUpserted', { proposalId: 'prp_a', n: 1 })], f, 0)).rejects.toThrow(/err03/);
  expect((await store.query(createQuery(f))).events).toHaveLength(1);
});

test('two concurrent appends with the same expected sequence: exactly one wins', async () => {
  const { store } = await fresh();
  const f = createFilter(['DraftOpened', 'DraftItemsUpserted'], [{ proposalId: 'prp_a' }]);
  await store.append([ev('DraftOpened', { proposalId: 'prp_a' })], f, 0);
  const results = await Promise.allSettled([
    store.append([ev('DraftItemsUpserted', { proposalId: 'prp_a', n: 1 })], f, 1),
    store.append([ev('DraftItemsUpserted', { proposalId: 'prp_a', n: 2 })], f, 1),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await store.query(createQuery(f))).events).toHaveLength(2);
});

test('a multi-event append lands all events or none', async () => {
  const { store } = await fresh();
  const f = createFilter(['A', 'B'], [{ proposalId: 'p' }]);
  await store.append([ev('A', { proposalId: 'p' }), ev('B', { proposalId: 'p' })], f, 0);
  expect((await store.query(createQuery(f))).events.map((e) => e.eventType)).toEqual(['A', 'B']);
});

test('numeric predicates compare as numbers', async () => {
  const { store } = await fresh();
  const f = createFilter(['X'], [{ orgId: 12 }]);
  await store.append([ev('X', { orgId: 12 })], f, 0);
  expect((await store.query(createQuery(createFilter(['X'], [{ orgId: 12 }])))).events).toHaveLength(1);
  expect((await store.query(createQuery(createFilter(['X'], [{ orgId: 13 }])))).events).toHaveLength(0);
});

test('nested object predicates are refused', async () => {
  const { store } = await fresh();
  await expect(store.query(createQuery(createFilter(['X'], [{ a: { b: 1 } }])))).rejects.toThrow(/err06/);
});
