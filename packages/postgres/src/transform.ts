import { QueryResult } from 'pg';
import { EventRecord, Event } from '@lgazo/eventstore';

function toSequenceNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || !Number.isSafeInteger(parsed)) {
    throw new Error('eventstore-stores-postgres-err09: sequence_number is not a safe integer');
  }
  return parsed;
}

function toTimestamp(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('eventstore-stores-postgres-err10: occurred_at is not a valid timestamp');
  }
  return parsed;
}

export interface EventRow {
  sequence_number?: unknown;
  occurred_at?: unknown;
  event_type: string;
  payload: string | Record<string, unknown>;
}

export function deserializeEvent(row: EventRow): EventRecord {
  return {
    sequenceNumber: toSequenceNumber(row.sequence_number),
    timestamp: toTimestamp(row.occurred_at),
    eventType: row.event_type,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  };
}

export function mapRecordsToEvents(result: QueryResult<EventRow>): EventRecord[] {
  return result.rows.map((row) => deserializeEvent(row));
}

export function extractMaxSequenceNumber(result: QueryResult<EventRow>): number {
  const lastRow = result.rows[result.rows.length - 1];
  return lastRow ? parseInt(String(lastRow.sequence_number), 10) : 0;
}

export function prepareInsertParams(events: Event[], contextParams: unknown[]): unknown[] {
  const eventTypes: string[] = [];
  const payloads: string[] = [];

  for (const event of events) {
    eventTypes.push(event.eventType);
    payloads.push(JSON.stringify(event.payload));
  }

  return [...contextParams, eventTypes, payloads];
}
