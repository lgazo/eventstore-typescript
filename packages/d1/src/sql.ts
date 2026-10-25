import { EventQuery } from '@ricofritzsche/eventstore';

export interface SqlQuery { sql: string; params: unknown[] }

const scalar = (v: unknown): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v);

/** WHERE body for a query: OR over filters, each = event_type IN (...) AND (OR over predicates of AND'ed json_extract equalities). */
export function buildContextWhere(query?: EventQuery): { where: string; params: unknown[] } {
  if (!query || query.filters.length === 0) return { where: '1 = 1', params: [] };
  const params: unknown[] = [];
  const ors = query.filters.map((filter) => {
    const parts: string[] = [];
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      parts.push(`event_type IN (${filter.eventTypes.map(() => '?').join(', ')})`);
      params.push(...filter.eventTypes);
    }
    const preds = filter.payloadPredicates ?? [];
    if (preds.length > 0) {
      const predOrs = preds.map((pred) => {
        const ands = Object.entries(pred).map(([k, v]) => {
          if (!/^[A-Za-z0-9_]+$/.test(k)) throw new Error(`eventstore-stores-d1-err06: unsupported predicate key ${k}`);
          if (!scalar(v)) throw new Error(`eventstore-stores-d1-err06: predicate ${k} must be a string, number or boolean`);
          params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
          return `json_extract(payload, '$.${k}') = ?`;
        });
        return ands.length > 0 ? `(${ands.join(' AND ')})` : '1 = 1';
      });
      parts.push(`(${predOrs.join(' OR ')})`);
    }
    return parts.length > 0 ? `(${parts.join(' AND ')})` : '1 = 1';
  });
  return { where: ors.join(' OR '), params };
}

export function buildContextQuerySql(query?: EventQuery): SqlQuery {
  const { where, params } = buildContextWhere(query);
  return { sql: `SELECT sequence_number, occurred_at, event_type, payload FROM events WHERE ${where} ORDER BY sequence_number ASC`, params };
}
