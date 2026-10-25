import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../types';

/** Minimal D1 over node:sqlite: prepare/bind/run/all/first/raw + exec. bind() returns a NEW statement, like D1. */
export function nodeSqliteD1(path = ':memory:'): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  const stmt = (sql: string, params: unknown[]): D1PreparedStatement => ({
    bind: (...values: unknown[]) => stmt(sql, values),
    async run<T>(): Promise<D1Result<T>> {
      const s = db.prepare(sql);
      const rows = /^\s*(select|with)|returning/i.test(sql) ? (s.all(...(params as never[])) as T[]) : (s.run(...(params as never[])), []);
      return { success: true, results: rows };
    },
    async all<T>() { return this.run<T>(); },
    async first<T>() { const r = await this.run<T>(); return (r.results?.[0] ?? null) as T | null; },
    async raw<T>() { return (await this.run<T>()).results as T[]; },
  });
  return { raw: db, prepare: (sql) => stmt(sql, []), exec: async (sql) => { db.exec(sql); return { success: true }; } };
}
