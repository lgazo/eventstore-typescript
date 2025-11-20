# EventStore

[![npm version](https://img.shields.io/npm/v/@ricofritzsche/eventstore.svg)](https://www.npmjs.com/package/@ricofritzsche/eventstore)

A comprehensive TypeScript implementation of event sourcing with real-time event subscriptions and projections. 
This system provides persistent event storage with automatic notification to subscribers for building responsive, event-sourced applications.

This package is a collaboration between [Ralf Westphal](https://github.com/ralfw) and [Rico Fritzsche](https://github.com/ricofritzsche).

## Installation

```bash
# PostgreSQL-backed store
npm install @ricofritzsche/eventstore @ricofritzsche/eventstore-postgres

# Cloudflare D1-backed store
npm install @ricofritzsche/eventstore @ricofritzsche/eventstore-d1
```

> Install the adapter that matches your persistence choice (`eventstore-postgres` or `eventstore-d1`).

**NPM Package:** https://www.npmjs.com/package/@ricofritzsche/eventstore

## Workspace Packages

- `@ricofritzsche/eventstore` – Core types, filters, in-memory store, and notifiers
- `@ricofritzsche/eventstore-postgres` – PostgreSQL-backed implementation that builds on the core APIs
- `@ricofritzsche/eventstore-d1` – Cloudflare D1 (SQLite) implementation for Workers environments

## High-Level Architecture

The system is built around a core EventStore with pluggable notification system.

### **EventStore** - The Source of Truth
- **Persistent Storage**: Events are immutably stored in PostgreSQL or Cloudflare D1
- **Query Engine**: Fast retrieval with filtering and payload-based queries
- **Optimistic Locking**: Ensures consistency without traditional database locks
- **Auto-Notification**: Automatically notifies subscribers when events are appended
- **Pluggable Notifiers**: Configurable notification systems (memory, database, etc.)

### **Event Notifiers** - Real-time Processing  
- **Subscription Management**: Multiple subscribers can listen to the same events
- **Concurrent Processing**: Events are processed by all subscribers simultaneously
- **Error Isolation**: If one subscriber fails, others continue processing
- **Lifecycle Management**: Clean subscription setup and teardown

## Core Modules

### **EventStore Module** (`src/eventstore/`)

**Purpose**: Persistent event storage with real-time notifications

**Key Components**:
- **`types.ts`** - Core interfaces (Event, EventStore, EventQuery, EventStreamNotifier)
- **PostgreSQL adapter** - Provided via the `@ricofritzsche/eventstore-postgres` workspace package
- **Cloudflare D1 adapter** - Provided via the `@ricofritzsche/eventstore-d1` workspace package
- **`stores/memory/`** - In-memory implementation of EventStore with subscription support
- **`notifiers/memory/`** - In-memory notification system (default)
- **`filter/`** - Event filters and queries

**Responsibilities**:
- Store events immutably in storage medium, e.g. PostgreSQL database or in-memory
- Query events with complex filtering using EventQuery
- Provide atomic consistency through optimistic locking (CTE-based for Postgres, transactional for D1)
- Notify subscribers immediately when events are appended
- Manage subscription lifecycle

### **Examples** (`src/examples/banking/`)

**Purpose**: Feature-sliced banking application demonstrating real-world usage

**Key Components**:
- **`features/`** - Individual feature slices with projections
- **`cli.ts`** - Interactive command-line interface
- **Feature Structure**:
  - `core.ts` - Pure business logic
  - `shell.ts` - EventStore integration
  - `types.ts` - Domain types and interfaces
  - `projector.ts` - Database projection logic
  - `listener.ts` - Event subscription handlers

**Banking Features**:
- **Account Management**: Open accounts, deposits, withdrawals, transfers
- **Account Projections**: Real-time account balance updates
- **Analytics Projections**: Monthly account opening statistics
- **Rebuild Functionality**: Projection recovery from event history

## Event Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                Event Flow                                      │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────┐  append()  ┌─────────────┐   notify()   ┌─────────────┐       │
│  │   Command   │ ─────────▶ │ EventStore  │ ───────────▶ │   Event     │       │
│  │  Handler    │            │             │              │  Notifier   │       │
│  └─────────────┘            └─────────────┘              └─────────────┘       │
│                                     │                            │             │
│                                     ▼                            ▼             │
│  ┌─────────────┐            ┌─────────────┐              ┌─────────────┐       │
│  │ PostgreSQL/│            │   Events    │              │  Multiple   │       │
│  │    D1 DB   │            │   Saved     │              │ Subscribers │       │
│  └─────────────┘            └─────────────┘              └─────────────┘       │
│                                                                   │            │
│                                                                   ▼            │
│                                                          ┌─────────────┐       │
│  ┌─────────────┐                                         │ Concurrent  │       │
│  │  Queries    │ ◀───────────────────────────────────────│ Processing  │       │
│  │             │                                         │             │       │
│  └─────────────┘                                         └─────────────┘       │
│                                                                   │            │
│                                                                   ▼            │
│                                                          ┌─────────────┐       │
│                                                          │ Projections │       │
│                                                          │   Updated   │       │
│                                                          └─────────────┘       │
│                                                                                │
│                          Real-time, concurrent event processing                │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Subscription System

The subscription system enables real-time, concurrent processing:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         Subscription Architecture                              │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│                              ┌─────────────┐                                   │
│                              │ EventStore  │                                   │
│                              │             │                                   │
│                              │ ┌─────────┐ │                                   │
│                              │ │New Event│ │                                   │
│                              │ │Appended │ │                                   │
│                              │ └─────────┘ │                                   │
│                              └──────┬──────┘                                   │
│                                     │                                          │
│                                     ▼                                          │
│                              ┌─────────────┐                                   │
│                              │Event        │                                   │
│                              │Notifier     │                                   │
│                              │(Memory)     │                                   │
│                              └──────┬──────┘                                   │
│                                     │                                          │
│                    ┌────────────────┼────────────────┐                         │
│                    │                │                │                         │
│                    ▼                ▼                ▼                         │
│            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│            │ Projection  │  │ Analytics   │  │   Business  │                   │
│            │ Subscriber  │  │ Subscriber  │  │ Logic       │                   │
│            │             │  │             │  │ Subscriber  │                   │
│            └─────────────┘  └─────────────┘  └─────────────┘                   │
│                    │                │                │                         │
│                    ▼                ▼                ▼                         │
│            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│            │ Read Model  │  │ Metrics &   │  │ Notifications│                  │
│            │ Database    │  │ Reports     │  │ & Workflows │                   │
│            │             │  │             │  │             │                   │
│            └─────────────┘  └─────────────┘  └─────────────┘                   │
│                                                                                │
│              Concurrent, independent processing of the same events             │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Setup
```bash
# Install the package
npm install @ricofritzsche/eventstore @ricofritzsche/eventstore-postgres

# Start Postgres
docker run --name eventstore-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bank -p 5432:5432 -d postgres:15

# Set connection string
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/bank"

# Or configure Cloudflare D1 (example with Wrangler)
# wrangler d1 create eventstore
# wrangler d1 migrations apply eventstore
```

### 2. EventQuery
```typescript
import { MemoryEventStore, createQuery, createFilter } from '@ricofritzsche/eventstore';
import { PostgresEventStore } from '@ricofritzsche/eventstore-postgres';
import { D1EventStore } from '@ricofritzsche/eventstore-d1';

// Postgres
const eventStore = new PostgresEventStore({ connectionString: "..." }); 
await eventStore.initializeDatabase();

// Cloudflare D1 (Workers binding)
// const eventStore = new D1EventStore({ database: env.EVENTSTORE });
// await eventStore.initializeDatabase();

// In-memory
// const eventStore = new MemoryEventStore();

// Create events
const events = [
  { eventType: 'UserRegistered', payload: { userId: '123', email: 'user@example.com' } },
  { eventType: 'UserEmailVerified', payload: { userId: '123', verifiedAt: new Date() } }
];

// Subscribe before appending to catch real-time events
const subscription = await eventStore.subscribe(async (events) => {
console.log(`Received ${events.length} new events`);
  // Process events immediately as they're appended
});

// Append events - subscribers will be notified automatically
await eventStore.append(events);

// Query historical events using EventQuery (supports complex OR conditions)
const userFilter = createFilter(['UserRegistered', 'UserEmailVerified'], [{ userId: '123' }]);
const adminFilter = createFilter(['AdminAction'], [{ action: 'user_management' }]);
const query = createQuery(userFilter, adminFilter); // OR between filters

const result = await eventStore.query(query);
console.log(`Found ${result.events.length} historical events`);

// Example: Query with payload conditions
const specificUserQuery = createQuery(
  createFilter(['UserRegistered'], [{ email: 'user@example.com' }]),
  createFilter(['UserEmailVerified'], [{ userId: '123' }])
);
const specificResult = await eventStore.query(specificUserQuery);
```

### 3. Atomic Consistency with Optimistic Locking

The EventStore provides atomic consistency through optimistic locking using database-specific techniques (CTEs for Postgres, wrapped transactions for D1). 
This approach ensures that concurrent operations only conflict when they actually depend on the same event context, rather than using traditional aggregate-level locking.

```typescript
// Atomic append with consistency check
const accountEvents = [
  { eventType: 'MoneyDeposited', payload: { accountId: 'acc-123', amount: 100 } }
];

// Create a query for the specific context we want to protect
const accountQuery = createQuery(
  createFilter(['BankAccountOpened', 'MoneyDeposited', 'MoneyWithdrawn'], 
               [{ accountId: 'acc-123' }])
);

// Get current state to determine expected sequence number
const currentState = await eventStore.query(accountQuery);
const expectedMaxSeq = currentState.maxSequenceNumber;

try {
  // Atomic append using EventQuery - only succeeds if no conflicting events were added
  await eventStore.append(accountEvents, accountQuery, expectedMaxSeq);
  console.log('Deposit successful');
  
  // Alternative: Using EventFilter for backward compatibility
  const accountFilter = createFilter(['BankAccountOpened', 'MoneyDeposited', 'MoneyWithdrawn'], 
    [{ accountId: 'acc-123' }]);
  await eventStore.append(accountEvents, accountFilter, expectedMaxSeq);
  
} catch (error) {
  if (error.message.includes('optimistic locking')) {
    // Retry the operation with updated state
    console.log('Concurrent modification detected, retrying...');
  }
}
```

**How CTE-based Consistency Works (Postgres):**

1. **Context-Specific Protection**: Only events matching the query filter are considered for consistency
2. **Atomic Check-and-Insert**: Uses SQL CTE to check max sequence number and insert events in one transaction
3. **Reduced Conflicts**: Commands only conflict when they actually affect the same business context
4. **High Concurrency**: Multiple commands can run simultaneously if they don't share context

The underlying SQL implementation:
```sql
WITH context AS (
  SELECT MAX(sequence_number) AS max_seq
  FROM events
  WHERE [filter conditions]
)
INSERT INTO events (event_type, payload, sequence_number)
SELECT event_type, payload, (max_seq + row_number())
FROM context, unnest($1) AS new_events
WHERE COALESCE(max_seq, 0) = $2
```

Cloudflare D1 performs the same optimistic check inside a single transaction: it selects the current max sequence for the query context and rolls back if the expectation does not match before inserting the new events.

### 4. Event Subscription
```typescript
import { createQuery, createFilter } from '@ricofritzsche/eventstore';
import { PostgresEventStore } from '@ricofritzsche/eventstore-postgres';

// Create EventStore with default MemoryEventStreamNotifier
const eventStore = new PostgresEventStore({connectionstring: "..."});
await eventStore.initializeDatabase();

// Subscribe to events for real-time processing
const subscription = await eventStore.subscribe(async (events) => {
  for (const event of events) {
    console.log('Processing event:', event.eventType);
    
    // Update projections, analytics, send notifications, etc.
    switch (event.eventType) {
      case 'BankAccountOpened':
        await updateAccountProjection(event);
        await updateAnalytics(event);
        break;
      case 'MoneyDeposited':
        await updateAccountBalance(event);
        break;
    }
  }
});
```

### 5. Pluggable Notifiers
Replace the notification system with your own:

```typescript
import { EventStreamNotifier } from '@ricofritzsche/eventstore';
import { PostgresEventStore } from '@ricofritzsche/eventstore-postgres';

class DatabaseEventStreamNotifier implements EventStreamNotifier {
  // Custom implementation using database triggers, message queues, etc.
}

const eventStore = new PostgresEventStore({
  notifier: new DatabaseEventStreamNotifier()
});
```


## API Reference

### PostgresEventStore (`@ricofritzsche/eventstore-postgres`)

The PostgreSQL-backed store is distributed via the `@ricofritzsche/eventstore-postgres` workspace package and depends on `@ricofritzsche/eventstore` for core types.

```typescript
class PostgresEventStore {
  constructor(options?: PostgresEventStoreOptions)
  
  // Initialize database schema
  async initializeDatabase(): Promise<void>
  
  // Query events with filtering using EventQuery or EventFilter
  async query(eventQuery: EventQuery): Promise<QueryResult>
  async query(eventFilter: EventFilter): Promise<QueryResult>
  
  // Append events with multiple overloads for flexibility
  async append(events: Event[]): Promise<void>
  async append(events: Event[], filterCriteria: EventQuery, expectedMaxSequenceNumber: number): Promise<void>
  async append(events: Event[], filterCriteria: EventFilter, expectedMaxSequenceNumber: number): Promise<void>
  
  // Subscribe to new events
  async subscribe(handle: HandleEvents): Promise<EventSubscription>
  
  // Clean up resources
  async close(): Promise<void>
}
```

### D1EventStore (`@ricofritzsche/eventstore-d1`)

The Cloudflare D1-backed store targets Workers environments that expose a D1 binding. It mirrors the Postgres API but uses SQLite transactions behind the scenes.

```typescript
class D1EventStore {
  constructor(options: D1EventStoreOptions)

  async initializeDatabase(): Promise<void>

  async query(eventQuery: EventQuery): Promise<QueryResult>
  async query(eventFilter: EventFilter): Promise<QueryResult>

  async append(events: Event[]): Promise<void>
  async append(events: Event[], filterCriteria: EventQuery, expectedMaxSequenceNumber: number): Promise<void>
  async append(events: Event[], filterCriteria: EventFilter, expectedMaxSequenceNumber: number): Promise<void>

  async subscribe(handle: HandleEvents): Promise<EventSubscription>

  async close(): Promise<void>
}
```

### Query and Filter Functions

```typescript
// Create event filters (AND within filter, OR between payload predicates)
createFilter(eventTypes: string[], payloadPredicates?: Record<string, unknown>[]): EventFilter

// Create event queries (OR between filters)
createQuery(...filters: EventFilter[]): EventQuery
```

### Append Method Overloads

```typescript
// Simple append without consistency checks
await eventStore.append(events);

// Append with EventQuery and optimistic locking
await eventStore.append(events, eventQuery, expectedMaxSequenceNumber);

// Append with EventFilter and optimistic locking (backward compatible)
await eventStore.append(events, eventFilter, expectedMaxSequenceNumber);
```

### EventQuery Structure

```typescript
interface EventFilter {
  readonly eventTypes: string[]; // OR condition
  readonly payloadPredicates?: Record<string, unknown>[]; // OR condition
}

interface EventQuery {
  readonly filters: EventFilter[]; // OR condition between filters
}
```

**Query Logic:**
- Within an `EventFilter`: event types are OR'ed AND payload predicates are OR'ed
- Within an `EventQuery`: filters are OR'ed
- This provides flexible querying: `((eventType1 OR eventType2) AND (payload1 OR payload2)) OR (eventType3 AND payload3)`

### Backward Compatibility

The EventStore maintains full backward compatibility with existing code using `EventFilter`:

```typescript
// Legacy approach (still supported)
const filter = createFilter(['UserRegistered'], [{ userId: '123' }]);
const result = await eventStore.query(filter);

// With optimistic locking using EventFilter
const currentState = await eventStore.query(filter);
await eventStore.append(newEvents, filter, currentState.maxSequenceNumber);

// New approach with EventQuery
const query = createQuery(
  createFilter(['UserRegistered'], [{ userId: '123' }]),
  createFilter(['UserUpdated'], [{ userId: '123' }])
);
const result2 = await eventStore.query(query);

// EventFilter is automatically converted to EventQuery internally
// Both approaches provide the same functionality and performance
```


## License

MIT License - see [LICENSE](LICENSE) file for details
