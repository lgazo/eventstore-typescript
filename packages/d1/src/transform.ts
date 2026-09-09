import { EventRecord } from '@ricofritzsche/eventstore';

export interface EventRow {
  sequence_number: number;
  occurred_at: string;
  event_type: string;
  payload: string | Record<string, unknown>;
}

export function deserializeEvent(row: EventRow): EventRecord {
  const payload =
    typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

  return {
    sequenceNumber: Number(row.sequence_number),
    timestamp: new Date(row.occurred_at),
    eventType: row.event_type,
    payload: payload as Record<string, unknown>,
  };
}

export function mapRowsToEvents(rows: EventRow[]): EventRecord[] {
  return rows.map(deserializeEvent);
}

export function extractMaxSequenceNumber(records: EventRecord[]): number {
  const last = records[records.length - 1];
  return last ? last.sequenceNumber : 0;
}
