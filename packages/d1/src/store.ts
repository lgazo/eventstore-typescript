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
import { buildContextQuerySql } from './sql';
import { filterEventsByQuery } from './query-filter';
import { mapRowsToEvents, extractMaxSequenceNumber, EventRow } from './transform';
import { CREATE_EVENTS_TABLE, CREATE_EVENT_TYPE_INDEX, CREATE_OCCURRED_AT_INDEX } from './schema';

const NON_EXISTENT_EVENT_TYPE = '__NON_EXISTENT__' + Math.random().toString(36);
const INSERT_EVENT_SQL = `
  INSERT INTO events (event_type, payload)
  VALUES (?1, ?2)
  RETURNING sequence_number, occurred_at, event_type, payload
`;

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

    let transactionStarted = false;
    const insertedEvents: EventRecord[] = [];

    try {
      await this.beginTransaction();
      transactionStarted = true;

      const contextEvents = await this.runQuery(query);
      const currentMaxSeq = extractMaxSequenceNumber(contextEvents);

      if (currentMaxSeq !== expectedSequenceNumber) {
        throw new Error('eventstore-stores-d1-err03: Context changed: events were modified between query() and append()');
      }

      for (const event of events) {
        const rows = await this.executeAll<EventRow>(INSERT_EVENT_SQL, [
          event.eventType,
          JSON.stringify(event.payload),
        ]);
        insertedEvents.push(...mapRowsToEvents(rows));
      }

      await this.commitTransaction();
      transactionStarted = false;

      await this.notifier.notify(insertedEvents);
    } catch (err) {
      if (transactionStarted) {
        await this.rollbackTransaction();
      }
      throw err;
    }
  }

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
    const statement = this.db.prepare(sql);
    if (params.length > 0) {
      statement.bind(...params);
    }

    const result = await statement.all<T>();
    if (!result.success) {
      throw new Error(`eventstore-stores-d1-err04: Query failed: ${result.error ?? 'Unknown error'}`);
    }

    return result.results ?? [];
  }

  private async beginTransaction(): Promise<void> {
    await this.exec('BEGIN IMMEDIATE TRANSACTION');
  }

  private async commitTransaction(): Promise<void> {
    await this.exec('COMMIT');
  }

  private async rollbackTransaction(): Promise<void> {
    await this.exec('ROLLBACK');
  }

  private async exec(sql: string): Promise<void> {
    const result = await this.db.exec(sql);
    if (!result.success) {
      throw new Error(`eventstore-stores-d1-err05: Statement failed: ${result.error ?? 'Unknown error'}`);
    }
  }
}
