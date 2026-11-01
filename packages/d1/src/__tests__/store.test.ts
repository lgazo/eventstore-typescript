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

import { buildContextQuerySql, buildTenantScopeSql } from '../sql';

test('buildTenantScopeSql scopes shared when no tenant, tenant otherwise', () => {
  expect(buildTenantScopeSql()).toEqual({ sql: 'tenant_id IS NULL', params: [] });
  expect(buildTenantScopeSql('tn_a')).toEqual({ sql: 'tenant_id = ?', params: ['tn_a'] });
});

test('query SQL honours tenant scope and minSequenceNumber', () => {
  const f = createFilter(['DraftOpened'], [{ proposalId: 'prp_a' }]);
  const q = createQuery({ minSequenceNumber: 5 }, f);
  const sqlQuery = buildContextQuerySql(q, 'tn_a');
  expect(sqlQuery.sql).toContain('tenant_id = ?');
  expect(sqlQuery.sql).toContain('sequence_number > ?');
  expect(sqlQuery.params).toEqual(['tn_a', 'DraftOpened', 'prp_a', 5]);
});

test('tenant-scoped stores on one db see only their rows and check sequences per scope', async () => {
  const db = nodeSqliteD1();
  const shared = new D1EventStore({ database: db });
  const tenantA = new D1EventStore({ database: db, tenantId: 'tn_a' });
  await shared.initializeDatabase();
  await tenantA.initializeDatabase();
  const fs = createFilter(['A'], [{ k: 's' }]);
  const fa = createFilter(['A'], [{ k: 'a' }]);
  await shared.append([ev('A', { k: 's' })], fs, 0);
  await tenantA.append([ev('A', { k: 'a' })], fa, 0);
  expect((await tenantA.query(fa)).events.map((e) => e.payload.k)).toEqual(['a']);
  expect((await shared.query(fs)).events.map((e) => e.payload.k)).toEqual(['s']);
  expect((await tenantA.query(fa)).maxSequenceNumber).toBe(2);
  await expect(tenantA.append([ev('A', { k: 'nope' })], fa, 0)).rejects.toThrow(/err03/);
});

test('occurred_at is bound ISO with millisecond precision', async () => {
  const { store } = await fresh();
  const f = createFilter(['T'], [{ key: 'v' }]);
  await store.append([ev('T', { key: 'v' })], f, 0);
  const { events } = await store.query(f);
  expect(events[0]!.timestamp.toISOString()).toMatch(/\.\d{3}Z$/);
});

test('initializeDatabase migrates a legacy table without tenant_id', async () => {
  const db = nodeSqliteD1();
  db.raw.exec(
    'CREATE TABLE events (sequence_number INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, event_type TEXT NOT NULL, payload TEXT NOT NULL)'
  );
  const store = new D1EventStore({ database: db });
  await store.initializeDatabase();
  const f = createFilter(['A'], []);
  await store.append([ev('A', {})], f, 0);
  expect((await store.query(f)).events).toHaveLength(1);
});

test('empty tenant id is rejected', () => {
  expect(() => new D1EventStore({ database: nodeSqliteD1(), tenantId: '' })).toThrow(/err07/);
});
