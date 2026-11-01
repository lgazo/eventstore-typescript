import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../types';

/** Minimal D1 over node:sqlite: prepare/bind/run/all/first/raw + exec. bind() returns a NEW statement, like D1. */
export function nodeSqliteD1(path = ':memory:'): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  const stmt = (sql: string, params: unknown[]): D1PreparedStatement => {
    const run = <T>(): Promise<D1Result<T>> => {
      const s = db.prepare(sql);
      const rows = /^\s*(select|with)|returning/i.test(sql)
        ? (s.all(...(params as never[])) as T[])
        : (s.run(...(params as never[])), []);
      return Promise.resolve({ success: true, results: rows });
    };
    return {
      bind: (...values: unknown[]) => stmt(sql, values),
      run,
      all: <T>(): Promise<D1Result<T>> => run<T>(),
      first: async <T>(): Promise<T | null> => {
        const r = await run<T>();
        return r.results?.[0] ?? null;
      },
      raw: async <T>(): Promise<T[]> => (await run<T>()).results ?? [],
    };
  };
  return {
    raw: db,
    prepare: (sql) => stmt(sql, []),
    exec: (sql): Promise<{ success: boolean; error?: string }> => {
      db.exec(sql);
      return Promise.resolve({ success: true });
    },
  };
}
