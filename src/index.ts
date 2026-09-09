// Main Node.js entry point for @ricofritzsche/eventstore
export { MemoryEventStore } from './eventstore/stores/memory';
export { EventStream } from './eventstore/stores/memory/eventstream';
export { processQuery } from './eventstore/stores/memory/queryprocessor';
export { MemoryEventStreamNotifier } from './eventstore/notifiers';
export { createFilter, createQuery } from './eventstore/filter';
export * from './eventstore/types';