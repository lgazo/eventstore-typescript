import { createFilter, createQuery, Event } from '../src/eventstore';
import { PostgresEventStore } from '@ricofritzsche/eventstore-postgres';
import dotenv from 'dotenv';

dotenv.config();

const baseUrl = process.env.DATABASE_TEST_URL || 'postgres://postgres:postgres@localhost:5432/eventstore_test';
const scenarioTable = 'events_tenancy_scenario';

class TestEvent implements Event {
  public readonly eventType: string;
  public readonly payload: Record<string, unknown>;

  constructor(eventType: string, id: string, data: Record<string, unknown>) {
    this.eventType = eventType;
    this.payload = { id, ...data };
  }
}

async function dropTable(tableName: string): Promise<void> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: baseUrl });
  try {
    await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Live-Postgres scenario tests for ESTS-5 (table name config + multi-tenancy).
 * Requires the compose.yaml Postgres (podman-compose up -d or docker compose up -d).
 */
describe('Postgres tenancy scenarios', () => {
  describe('Scenario A: shared stream (default table, no tenantId)', () => {
    let store: PostgresEventStore;

    beforeAll(async () => {
      store = new PostgresEventStore({
        connectionString: `${baseUrl}?table=${scenarioTable}`,
      });
      await store.initializeDatabase();
    });

    afterAll(async () => {
      await store.close();
    });

    it('appends and queries shared-stream events', async () => {
      await store.append([
        new TestEvent('SharedEvent', 's1', { value: 1 }),
        new TestEvent('SharedEvent', 's2', { value: 2 }),
      ]);

      const result = await store.query(createFilter(['SharedEvent']));
      expect(result.events).toHaveLength(2);
      expect(result.maxSequenceNumber).toBeGreaterThan(0);
    });

    it('rejects a stale expected max sequence number (optimistic locking)', async () => {
      const context = await store.query(createFilter(['SharedEvent']));
      const freshMax = context.maxSequenceNumber;

      const staleMax = freshMax - 1;
      await expect(
        store.append([new TestEvent('SharedEvent', 's3', {})], createFilter(['SharedEvent']), staleMax)
      ).rejects.toThrow('eventstore-stores-postgres-err05');
    });

    it('accepts an append with the fresh expected max sequence number', async () => {
      const context = await store.query(createFilter(['SharedEvent']));
      await store.append(
        [new TestEvent('SharedEvent', 's3', { value: 3 })],
        createQuery(createFilter(['SharedEvent'])),
        context.maxSequenceNumber
      );

      const result = await store.query(createFilter(['SharedEvent']));
      expect(result.events).toHaveLength(3);
    });
  });

  describe('Scenario B: tenant-scoped stores sharing one custom table', () => {
    let tenantA: PostgresEventStore;
    let tenantB: PostgresEventStore;

    beforeAll(async () => {
      // The first initializeDatabase creates the table + indexes; the second is a no-op.
      tenantA = new PostgresEventStore({
        connectionString: baseUrl,
        tableName: scenarioTable,
        tenantId: 'tenant-a',
      });
      tenantB = new PostgresEventStore({
        connectionString: baseUrl,
        tableName: scenarioTable,
        tenantId: 'tenant-b',
      });
      await tenantA.initializeDatabase();
    });

    afterAll(async () => {
      await tenantA.close();
      await tenantB.close();
      await dropTable(scenarioTable);
    });

    it('keeps tenant streams isolated in the same table', async () => {
      await tenantA.append([new TestEvent('AEvent', 'a1', { owner: 'a' })]);
      await tenantB.append([new TestEvent('BEvent', 'b1', { owner: 'b' })]);

      const seenByA = await tenantA.query(createFilter(['AEvent', 'BEvent']));
      expect(seenByA.events.map((event) => event.eventType)).toEqual(['AEvent']);

      const seenByB = await tenantB.query(createFilter(['AEvent', 'BEvent']));
      expect(seenByB.events.map((event) => event.eventType)).toEqual(['BEvent']);
    });

    it('computes the concurrency max within the tenant scope (sequence gaps allowed)', async () => {
      const contextB = await tenantB.query(createFilter(['BEvent']));
      // tenantB's scoped max is its own last sequence number — appending against it succeeds
      await tenantB.append(
        [new TestEvent('BEvent', 'b2', {})],
        createQuery(createFilter(['BEvent'])),
        contextB.maxSequenceNumber
      );

      const seenByB = await tenantB.query(createFilter(['BEvent']));
      expect(seenByB.events).toHaveLength(2);

      // tenantA's stream is untouched by tenantB's appends
      const seenByA = await tenantA.query(createFilter(['AEvent']));
      expect(seenByA.events).toHaveLength(1);
    });

    it('rejects a stale tenant-scoped expected max', async () => {
      const contextA = await tenantA.query(createFilter(['AEvent']));
      await expect(
        tenantA.append(
          [new TestEvent('AEvent', 'a2', {})],
          createQuery(createFilter(['AEvent'])),
          contextA.maxSequenceNumber - 1
        )
      ).rejects.toThrow('eventstore-stores-postgres-err05');
    });

    it('writes NULL tenant rows from a shared store that a tenant store cannot see', async () => {
      const shared = new PostgresEventStore({ connectionString: baseUrl, tableName: scenarioTable });
      try {
        await shared.append([new TestEvent('SharedEvent', 'sh1', {})]);

        const seenByShared = await shared.query(createFilter(['SharedEvent']));
        // Scenario A also wrote 'SharedEvent' rows into the same NULL scope
        expect(seenByShared.events.map((event) => event.eventType)).toContain('SharedEvent');

        const seenByA = await tenantA.query(createFilter(['SharedEvent']));
        expect(seenByA.events).toHaveLength(0);
      } finally {
        await shared.close();
      }
    });
  });
});