import {
  EventRecord,
  EventStreamNotifier,
  EventSubscription,
  HandleEvents,
  Subscription,
} from '../../types';

/**
 * MemoryEventStreamNotifier is an in-memory implementation of the EventStreamNotifier interface.
 * It allows subscribing to an event stream, notifying subscribers of events, and managing subscriptions.
 * This is the default mechanism to notify about events in an app.
 */
export class MemoryEventStreamNotifier implements EventStreamNotifier {
  private subscriptions: Map<string, Subscription> = new Map();
  private subscriptionCounter = 0;

  subscribe(handle: HandleEvents): Promise<EventSubscription> {
    const id = `notifier-sub-${++this.subscriptionCounter}`;
    const subscription: Subscription = { id, handle };

    this.subscriptions.set(id, subscription);

    return Promise.resolve({
      id,
      unsubscribe: () => {
        this.subscriptions.delete(id);
        return Promise.resolve();
      },
    });
  }

  async notify(events: EventRecord[]): Promise<void> {
    if (events.length === 0) return;

    const processPromises = Array.from(this.subscriptions.values()).map(async (subscription) => {
      try {
        await subscription.handle(events);
      } catch (error) {
        console.error(
          `notifiers-memory-err01: Error notifying subscription ${subscription.id}:`,
          error
        );
      }
    });

    await Promise.allSettled(processPromises);
  }

  close(): Promise<void> {
    this.subscriptions.clear();
    return Promise.resolve();
  }
}
