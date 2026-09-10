import {
  Event,
  EventStore,
  QueryResult,
  EventStreamNotifier,
  HandleEvents,
  EventSubscription,
  EventQuery,
  EventFilter,
  MemoryEventStreamNotifier,
  createFilter,
  createQuery,
} from '@ricofritzsche/eventstore';
import { buildContextQuerySql, buildAppendSql } from './sql';
import { mapRecordsToEvents, extractMaxSequenceNumber, prepareInsertParams } from './transform';
import {
  createEventsTableSql,
  createEventTypeIndexSql,
  createOccurredAtIndexSql,
  createPayloadGinIndexSql,
  createTenantSequenceIndexSql,
  createDatabaseQuery,
  changeDatabaseInConnectionString,
  getDatabaseNameFromConnectionString
} from './schema';

import { Pool } from 'pg';

const NON_EXISTENT_EVENT_TYPE = '__NON_EXISTENT__' + Math.random().toString(36);

export interface PostgresEventStoreOptions {
  connectionString?: string;
  tableName?: string;
  tenantId?: string;
  notifier?: EventStreamNotifier;
}

export interface ParsedPostgresConnectionString {
  connectionString: string;
  tableName?: string;
  tenantId?: string;
}

export function parsePostgresConnectionString(connectionString: string): ParsedPostgresConnectionString {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (err) {
    throw new Error('eventstore-stores-postgres-err13: Invalid connection string. URL parsing failed: ' + (err instanceof Error ? err.message : String(err)));
  }
  const tableName = url.searchParams.get('table') ?? undefined;
  const tenantId = url.searchParams.get('tenantId') ?? undefined;

  url.searchParams.delete('table');
  url.searchParams.delete('tenantId');

  return {
    connectionString: url.toString(),
    ...(tableName ? { tableName } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}


/**
 * Represents an implementation of an event store using Postgres as the underlying database.
 * Provides functionality to append events, query events, and manage database initialization.
 * Additionally, it facilitates event subscriptions through an event stream notifier mechanism.
 */
export class PostgresEventStore implements EventStore {
  private pool: Pool;
  private readonly connectionString: string;
  private readonly databaseName: string;
  private readonly notifier: EventStreamNotifier;
  readonly tableName: string;
  readonly tenantId: string | undefined;

  constructor(options: PostgresEventStoreOptions = {}) {
    const resolvedConnectionString = options.connectionString || process.env.DATABASE_URL;
    if (!resolvedConnectionString) throw new Error('eventstore-stores-postgres-err02: Connection string missing. DATABASE_URL environment variable not set.');

    const parsed = options.connectionString
      ? parsePostgresConnectionString(options.connectionString)
      : undefined;

    const databaseNameFromConnectionString = getDatabaseNameFromConnectionString(resolvedConnectionString);
    if (!databaseNameFromConnectionString) throw new Error('eventstore-stores-postgres-err03: Database name not found. Invalid connection string: ' + resolvedConnectionString);
    this.databaseName = databaseNameFromConnectionString;

    this.connectionString = parsed?.connectionString ?? resolvedConnectionString;

    this.tableName = options.tableName ?? parsed?.tableName ?? 'events';
    if (this.tableName.length === 0 || this.tableName.includes('\u0000')) {
      throw new Error('eventstore-stores-postgres-err11: Invalid table name. Table name must not be empty or contain null bytes.');
    }
    this.tenantId = options.tenantId ?? parsed?.tenantId;
    if (this.tenantId !== undefined && this.tenantId.length === 0) {
      throw new Error('eventstore-stores-postgres-err12: Invalid tenant id. Tenant id must not be empty.');
    }

    this.pool = new Pool({ connectionString: this.connectionString });
    // This is the "Default" EventStreamNotifier, but allow override
    this.notifier = options.notifier ?? new MemoryEventStreamNotifier();
  }

  async query(filterCriteria: EventQuery): Promise<QueryResult>;
  async query(filterCriteria: EventFilter): Promise<QueryResult>;
  async query(filterCriteria: EventQuery | EventFilter): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      // If it's an EventFilter, wrap it in an EventQuery
      const eventQuery = 'filters' in filterCriteria 
        ? filterCriteria as EventQuery 
        : createQuery(filterCriteria as EventFilter);
      
      const sqlQuery = buildContextQuerySql(eventQuery, this.tableName, this.tenantId);
      const result = await client.query(sqlQuery.sql, sqlQuery.params);

      return {
        events: mapRecordsToEvents(result),
        maxSequenceNumber: extractMaxSequenceNumber(result)
      };
    } finally {
      client.release();
    }
  }

  async subscribe(handle: HandleEvents): Promise<EventSubscription> {
    return this.notifier.subscribe(handle);
  }


  async append(events: Event[]): Promise<void>;
  async append(events: Event[], filterCriteria: EventQuery, expectedMaxSequenceNumber: number): Promise<void>;
  async append(events: Event[], filterCriteria: EventFilter, expectedMaxSequenceNumber: number): Promise<void>;
  async append(events: Event[], filterCriteria?: EventQuery | EventFilter,  expectedMaxSequenceNumber?: number): Promise<void> {
    if (events.length === 0) return;

    // Convert EventFilter to EventQuery if needed
    let eventQuery: EventQuery;
    if (filterCriteria === undefined) {
      eventQuery = createQuery(createFilter([NON_EXISTENT_EVENT_TYPE]));
      expectedMaxSequenceNumber = 0;
    } else if ('filters' in filterCriteria) {
      // It's an EventQuery
      eventQuery = filterCriteria;
      if (eventQuery.filters.length === 0) {
        eventQuery = createQuery(createFilter([NON_EXISTENT_EVENT_TYPE]));
        expectedMaxSequenceNumber = 0;
      }
    } else {
      // It's an EventFilter, wrap it in EventQuery
      eventQuery = createQuery(filterCriteria);
    }

    if (expectedMaxSequenceNumber === undefined)
      throw new Error('eventstore-stores-postgres-err04: Expected max sequence number is required when a filter is provided!')

    const client = await this.pool.connect();
    try {
      const cteQuery = buildAppendSql(eventQuery, expectedMaxSequenceNumber, this.tableName, this.tenantId);
      const params = prepareInsertParams(events, cteQuery.params);

      const result = await client.query(cteQuery.sql, params);

      if (result.rowCount === 0) {
        throw new Error('eventstore-stores-postgres-err05: Context changed: events were modified between query() and append()');
      }

      // Convert inserted records to EventRecord[] and notify subscribers
      const insertedEvents = mapRecordsToEvents(result);
      await this.notifier.notify(insertedEvents);

    } finally {
      client.release();
    }
  }

  async initializeDatabase(): Promise<void> {
    await this.createDatabase();
    await this.createTableAndIndexes();
  }

  async close(): Promise<void> {
    await this.notifier.close();
    await this.pool.end();
  }

  private async createDatabase(): Promise<void> {
    const adminConnectionString = changeDatabaseInConnectionString(
      this.connectionString,
      'postgres'
    );

    const adminPool = new Pool({ connectionString: adminConnectionString });
    let client;
    try {
      client = await adminPool.connect();
    } catch (err: any) {
      // Managed Postgres (e.g. WebHouse) pre-provisions the target database and
      // forbids connecting to the `postgres` maintenance database. Treat an
      // unreachable admin database as non-fatal: the target already exists, so
      // fall through to createTableAndIndexes(). A genuinely missing database
      // surfaces as a clear error there instead.
      console.log(`eventstore-stores-postgres-err06: admin database unreachable, assuming ${this.databaseName} already exists: ${err.message}`);
      await adminPool.end().catch(() => {});
      return;
    }

    try {
      await client.query(createDatabaseQuery(this.databaseName));
      console.log(`Database created: ${this.databaseName}`);
    } catch (err: any) {
      if (err.code === '42P04') {
        console.log(`eventstore-stores-postgres-err06: Database already exists: ${this.databaseName}`);
      } else {
        throw err;
      }
    } finally {
      client.release();
      await adminPool.end();
    }
  }

  private async createTableAndIndexes(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(createEventsTableSql(this.tableName));
      await client.query(createEventTypeIndexSql(this.tableName));
      await client.query(createOccurredAtIndexSql(this.tableName));
      await client.query(createPayloadGinIndexSql(this.tableName));
      await client.query(createTenantSequenceIndexSql(this.tableName));
    } finally {
      client.release();
    }
  }
}
