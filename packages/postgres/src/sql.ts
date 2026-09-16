import { EventFilter, EventQuery } from '@ricofritzsche/eventstore';
import { quoteIdentifier } from './schema';


export function compileContextQueryConditions(query: EventQuery, paramsBaseIndex: number = 0): { sql: string; params: unknown[] } {
  let sql = '';
  const params: unknown[] = [];

  if (query.filters && query.filters.length > 0) {
    for(const filter of query.filters) {
      if (sql.length > 0) {
        sql += ' OR ';
      }

      const filterClause = compileContextQueryConditionsFilter(filter, paramsBaseIndex + params.length);
      if (filterClause.sql.length > 0)
        sql += `(${filterClause.sql})`;

      params.push(...filterClause.params);
    }
  }

  return { sql, params };
}

function compileContextQueryConditionsFilter(filter: EventFilter, paramsBaseIndex:number): { sql: string; params: unknown[] } {
  let sql = ''
  const params: unknown[] = [];

  if (filter.eventTypes && filter.eventTypes.length > 0) {
    params.push(filter.eventTypes);
    sql += `event_type = ANY($${paramsBaseIndex + params.length})`;
  }

  if (filter.payloadPredicates && filter.payloadPredicates.length > 0) {
    const orConditions = filter.payloadPredicates.map((predicate: Record<string, unknown>) => {
      params.push(JSON.stringify(predicate));
      return `payload @> $${paramsBaseIndex + params.length}`;
    });

    if (sql.length > 0) sql += ' AND ';
    sql += `(${orConditions.join(' OR ')})`;
  }
  if (sql.length > 0) sql = `(${sql})`

  return {
    sql,
    params
  };
}


export function buildContextQuerySql(query: EventQuery, tableName: string = 'events', tenantId?: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (tenantId !== undefined) {
    params.push(tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  } else {
    clauses.push('tenant_id IS NULL');
  }

  if (query.options?.minSequenceNumber !== undefined) {
    params.push(query.options.minSequenceNumber);
    clauses.push(`sequence_number > $${params.length}`);
  }

  const conditions = compileContextQueryConditions(query, params.length);
  params.push(...conditions.params);

  if (conditions.sql.length > 0) {
    clauses.push(conditions.sql);
  }

  let sql = `SELECT * FROM ${quoteIdentifier(tableName)}`;
  if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`;
  sql += ' ORDER BY sequence_number ASC';

  return { sql, params };
}


export function buildAppendSql(query: EventQuery, expectedMaxSeq: number, tableName: string = 'events', tenantId?: string): { sql: string, params: unknown[] } {
  const tenantParams: unknown[] = tenantId !== undefined ? [tenantId] : [];
  const conditions = compileContextQueryConditions(query, tenantParams.length);

  const contextParams = [...tenantParams, ...conditions.params];
  const contextWhere = [
    ...(tenantId !== undefined ? [`tenant_id = $${tenantParams.length}`] : ['tenant_id IS NULL']),
    ...(conditions.sql.length > 0 ? [conditions.sql] : []),
  ].join(' AND ');

  const expectedMaxSeqParam = contextParams.length + 1;
  const eventTypesParam = contextParams.length + 2;
  const payloadsParam = contextParams.length + 3;

  const insertColumns = tenantId !== undefined
    ? 'event_type, payload, tenant_id'
    : 'event_type, payload';
  const tenantSelect = tenantId !== undefined ? ', $1' : '';
  const contextWhereSql = contextWhere.length > 0 ? ' WHERE ' + contextWhere : '';

  return {
    sql:
`WITH context AS (SELECT MAX(sequence_number) AS max_seq FROM ${quoteIdentifier(tableName)}${contextWhereSql})
INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns})
SELECT unnest($${eventTypesParam}::text[]), unnest($${payloadsParam}::jsonb[])${tenantSelect} FROM context WHERE COALESCE(max_seq, 0) = $${expectedMaxSeqParam}
RETURNING *`,
    params: [...contextParams, expectedMaxSeq]
  };
}
