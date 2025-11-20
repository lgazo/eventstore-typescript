import { EventQuery } from '@ricofritzsche/eventstore';

export interface SqlQuery {
  sql: string;
  params: unknown[];
}

export function buildContextQuerySql(query?: EventQuery): SqlQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query) {
    const eventTypes = collectEventTypes(query);
    if (eventTypes.length > 0) {
      const placeholders = eventTypes.map(() => '?').join(', ');
      clauses.push(`event_type IN (${placeholders})`);
      params.push(...eventTypes);
    }
  }

  let sql = 'SELECT sequence_number, occurred_at, event_type, payload FROM events';
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  sql += ' ORDER BY sequence_number ASC';

  return { sql, params };
}

function collectEventTypes(query: EventQuery): string[] {
  const set = new Set<string>();

  for (const filter of query.filters) {
    if (!filter.eventTypes) continue;
    for (const eventType of filter.eventTypes) {
      set.add(eventType);
    }
  }

  return Array.from(set);
}
