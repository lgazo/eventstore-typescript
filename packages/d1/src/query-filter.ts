import { EventFilter, EventQuery, EventRecord } from '@ricofritzsche/eventstore';

export function filterEventsByQuery(events: EventRecord[], query?: EventQuery): EventRecord[] {
  if (!query) return events;
  return events.filter((event) => matchesQuery(event, query));
}

function matchesQuery(event: EventRecord, query: EventQuery): boolean {
  return query.filters.some((filter) => matchesFilter(event, filter));
}

function matchesFilter(event: EventRecord, filter: EventFilter): boolean {
  return matchesEventType(event.eventType, filter.eventTypes) && matchesPredicates(event.payload, filter.payloadPredicates);
}

function matchesEventType(eventType: string, eventTypes?: string[]): boolean {
  if (eventTypes && eventTypes.length > 0) {
    return eventTypes.includes(eventType);
  }
  return true;
}

function matchesPredicates(payload: Record<string, unknown>, predicates?: Record<string, unknown>[]): boolean {
  if (predicates && predicates.length > 0) {
    return predicates.some((predicate) => isSubset(payload, predicate));
  }
  return true;
}

function isSubset(payload: unknown, predicate: unknown): boolean {
  if (predicate === null || predicate === undefined) return true;
  if (payload === null || payload === undefined) return false;

  if (typeof predicate !== 'object' || typeof payload !== 'object') {
    return predicate === payload;
  }

  if (Array.isArray(predicate) && Array.isArray(payload)) {
    return predicate.every((predicateElement) =>
      payload.some((payloadElement) => isSubset(payloadElement, predicateElement))
    );
  }

  if (Array.isArray(predicate) !== Array.isArray(payload)) return false;

  const predicateRecord = predicate as Record<string, unknown>;
  const payloadRecord = payload as Record<string, unknown>;

  for (const key of Object.keys(predicateRecord)) {
    if (!(key in payloadRecord)) return false;
    if (!isSubset(payloadRecord[key], predicateRecord[key])) return false;
  }

  return true;
}
