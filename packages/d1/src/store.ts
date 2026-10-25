import {
  Event,
  EventFilter,
  EventQuery,
  EventRecord,
  EventStore,
  EventStreamNotifier,
  HandleEvents,
  EventSubscription,
  MemoryEventStreamNotifier,
  QueryResult,
  createFilter,
  createQuery,
} from '@ricofritzsche/eventstore';

import { D1Database } from './types';
import { buildContextQuerySql, buildContextWhere } from './sql';
import { filterEventsByQuery } from './query-filter';
import { mapRowsToEvents, extractMaxSequenceNumber, EventRow } from './transform';
import { CREATE_EVENTS_TABLE, CREATE_EVENT_TYPE_INDEX, CREATE_OCCURRED_AT_INDEX } from './schema';

const NON_EXISTENT_EVENT_TYPE = '__NON_EXISTENT__' + Math.random().toString(36);

export interface D1EventStoreOptions {
  database: D1Database;
  notifier?: EventStreamNotifier;
}

/**
 * D1EventStore provides an EventStore implementation using Cloudflare D1 (SQLite) as its persistence layer.
 * It mirrors the API of the Postgres store while relying on transactions and in-memory predicate checks
 * to guarantee optimistic concurrency semantics.
 */
export class D1EventStore implements EventStore {
  private readonly db: D1Database;
  private readonly notifier: EventStreamNotifier;

  constructor(options: D1EventStoreOptions) {
    if (!options?.database) {
      throw new Error('eventstore-stores-d1-err01: D1 database missing. Pass the Cloudflare binding through the constructor.');
    }

    this.db = options.database;
    this.notifier = options.notifier ?? new MemoryEventStreamNotifier();
  }

  async query(filterCriteria: EventQuery): Promise<QueryResult>;
  async query(filterCriteria: EventFilter): Promise<QueryResult>;
  async query(filterCriteria: EventQuery | EventFilter): Promise<QueryResult> {
    const eventQuery = this.toEventQuery(filterCriteria);
    const events = await this.runQuery(eventQuery);

    return {
      events,
      maxSequenceNumber: extractMaxSequenceNumber(events),
    };
  }

  async subscribe(handle: HandleEvents): Promise<EventSubscription> {
    return this.notifier.subscribe(handle);
  }

  async append(events: Event[]): Promise<void>;
  async append(events: Event[], filterCriteria: EventQuery, expectedMaxSequenceNumber: number): Promise<void>;
  async append(events: Event[], filterCriteria: EventFilter, expectedMaxSequenceNumber: number): Promise<void>;
  async append(
    events: Event[],
    filterCriteria?: EventQuery | EventFilter,
    expectedMaxSequenceNumber?: number
  ): Promise<void> {
    if (events.length === 0) return;

    const { query, expectedSequenceNumber } = this.normalizeAppendContext(filterCriteria, expectedMaxSequenceNumber);

    const { where, params } = buildContextWhere(query);
    const values = events.map(() => '(?, ?)').join(', ');
    const sql = `INSERT INTO events (event_type, payload)
      SELECT v.column1, json(v.column2) FROM (VALUES ${values}) AS v
      WHERE (SELECT COALESCE(MAX(sequence_number), 0) FROM events WHERE ${where}) = ?
      RETURNING sequence_number, occurred_at, event_type, payload`;
    const rows = await this.executeAll<EventRow>(sql, [
      ...events.flatMap((e) => [e.eventType, JSON.stringify(e.payload)]),
      ...params,
      expectedSequenceNumber,
    ]);
    if (rows.length === 0) {
      throw new Error('eventstore-stores-d1-err03: Context changed: events were modified between query() and append()');
    }
    await this.notifier.notify(mapRowsToEvents(rows));
  }

  // AFAIK this won't work with CF
  async initializeDatabase(): Promise<void> {
    await this.exec(CREATE_EVENTS_TABLE);
    await this.exec(CREATE_EVENT_TYPE_INDEX);
    await this.exec(CREATE_OCCURRED_AT_INDEX);
  }

  async close(): Promise<void> {
    await this.notifier.close();
  }

  private toEventQuery(filterCriteria: EventQuery | EventFilter): EventQuery {
    return 'filters' in filterCriteria ? filterCriteria : createQuery(filterCriteria);
  }

  private normalizeAppendContext(
    filterCriteria?: EventQuery | EventFilter,
    expectedMaxSequenceNumber?: number
  ): { query: EventQuery; expectedSequenceNumber: number } {
    let eventQuery: EventQuery;
    let expectedSequence = expectedMaxSequenceNumber;

    if (filterCriteria === undefined) {
      eventQuery = createQuery(createFilter([NON_EXISTENT_EVENT_TYPE]));
      expectedSequence = 0;
    } else if ('filters' in filterCriteria) {
      eventQuery = filterCriteria;
      if (eventQuery.filters.length === 0) {
        eventQuery = createQuery(createFilter([NON_EXISTENT_EVENT_TYPE]));
        expectedSequence = 0;
      }
    } else {
      eventQuery = createQuery(filterCriteria);
    }

    if (expectedSequence === undefined) {
      throw new Error('eventstore-stores-d1-err02: Expected max sequence number is required when a filter is provided!');
    }

    return {
      query: eventQuery,
      expectedSequenceNumber: expectedSequence,
    };
  }

  private async runQuery(query?: EventQuery): Promise<EventRecord[]> {
    const sqlQuery = buildContextQuerySql(query);
    const rows = await this.executeAll<EventRow>(sqlQuery.sql, sqlQuery.params);
    const events = mapRowsToEvents(rows);
    return filterEventsByQuery(events, query);
  }

  private async executeAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const statement = params.length > 0 ? this.db.prepare(sql).bind(...params) : this.db.prepare(sql);

    const result = await statement.run<T>();
    if (!result.success) {
      throw new Error(`eventstore-stores-d1-err04: Query failed: ${result.error ?? 'Unknown error'}`);
    }

    return result.results ?? [];
  }

  private async exec(sql: string): Promise<void> {
    const result = await this.db.prepare(sql).run();
    if (!result.success) {
      throw new Error(`eventstore-stores-d1-err05: Statement failed: ${result.error ?? 'Unknown error'}`);
    }
  }
}
