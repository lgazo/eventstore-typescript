const queries: Array<{ pool: number; sql: string }> = [];
const released: number[] = [];
const ended: number[] = [];
let poolCounter = 0;
let createDbError: unknown = { code: '42501', message: 'permission denied to create database' };

jest.mock('pg', () => {
  class Pool {
    id = ++poolCounter;
    on() {}
    async connect() {
      const id = this.id;
      return {
        query: async (sql: string) => {
          queries.push({ pool: id, sql });
          if (/CREATE DATABASE/i.test(sql)) throw createDbError;
          return { rows: [] };
        },
        release: () => {
          released.push(id);
        },
      };
    }
    async end() {
      ended.push(this.id);
    }
  }
  return { Pool };
});

import { PostgresEventStore } from '@lgazo/eventstore-postgres';

describe('PostgresEventStore.initializeDatabase without CREATEDB permission', () => {
  beforeEach(() => {
    queries.length = 0;
    released.length = 0;
    ended.length = 0;
    poolCounter = 0;
    createDbError = { code: '42501', message: 'permission denied to create database' };
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('tolerates 42501 and still creates the table', async () => {
    const store = new PostgresEventStore({
      connectionString: 'postgres://u:p@localhost:5432/target_db',
      tableName: 'events_x',
    } as any);
    await expect(store.initializeDatabase()).resolves.toBeUndefined();
    expect(queries.some((q) => /CREATE TABLE/i.test(q.sql))).toBe(true);
    expect(released.length).toBeGreaterThan(0);
    expect(ended.length).toBeGreaterThan(0);
  });

  it('still rethrows other errors', async () => {
    createDbError = { code: '57P01', message: 'boom' };
    const store = new PostgresEventStore({
      connectionString: 'postgres://u:p@localhost:5432/target_db',
      tableName: 'events_x',
    } as any);
    await expect(store.initializeDatabase()).rejects.toMatchObject({ code: '57P01' });
  });
});
