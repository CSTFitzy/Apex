import { randomUUID } from 'crypto';
import type { AARUnit, Bookmark, Operation, OperationEvent, OperationFrame, OperationSummary } from './types.js';

/**
 * In-memory store for AAR operations. Each operation is a recorded timeline of
 * unit-state frames + events captured while a simulation runs, which the
 * replay engine, analytics, lessons-learned, comparison and report generators
 * all read from.
 */
class AARStore {
  private operations = new Map<string, Operation>();

  startOperation(name: string, initialUnits: AARUnit[] = []): Operation {
    const now = Date.now();
    const operation: Operation = {
      id: randomUUID(),
      name: name || `Operation ${new Date(now).toISOString()}`,
      startedAt: now,
      endedAt: null,
      frames: initialUnits.length ? [{ timestamp: now, units: initialUnits, events: [] }] : [],
      bookmarks: [],
    };
    this.operations.set(operation.id, operation);
    return operation;
  }

  recordFrame(
    operationId: string,
    units: AARUnit[],
    events: OperationEvent[] = [],
    timestamp: number = Date.now()
  ): OperationFrame | null {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    const frame: OperationFrame = { timestamp, units, events };
    operation.frames.push(frame);
    return frame;
  }

  endOperation(operationId: string): Operation | null {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    operation.endedAt = Date.now();
    return operation;
  }

  addBookmark(operationId: string, timestamp: number, label: string): Bookmark | null {
    const operation = this.operations.get(operationId);
    if (!operation) return null;
    const bookmark: Bookmark = { id: randomUUID(), timestamp, label };
    operation.bookmarks.push(bookmark);
    return bookmark;
  }

  getOperation(operationId: string): Operation | null {
    return this.operations.get(operationId) ?? null;
  }

  listOperations(): Operation[] {
    return [...this.operations.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  deleteOperation(operationId: string): boolean {
    return this.operations.delete(operationId);
  }

  summarize(operation: Operation): OperationSummary {
    const lastFrame = operation.frames[operation.frames.length - 1];
    const firstFrame = operation.frames[0];
    const events = operation.frames.flatMap((f) => f.events);
    const casualties = firstFrame && lastFrame
      ? firstFrame.units.reduce((sum, u) => {
          const end = lastFrame.units.find((eu) => eu.id === u.id);
          if (!end) return sum;
          return sum + Math.max(0, u.strength - end.strength);
        }, 0)
      : 0;
    const objectivesAchieved = events.filter((e) => e.type === 'objective').length;
    const destroyedFriendlies = lastFrame
      ? lastFrame.units.filter((u) => u.affiliation === 'friendly' && u.status === 'destroyed').length
      : 0;
    const destroyedHostiles = lastFrame
      ? lastFrame.units.filter((u) => u.affiliation === 'hostile' && u.status === 'destroyed').length
      : 0;
    const successRating = Math.max(
      0,
      Math.min(
        100,
        60 + objectivesAchieved * 10 + destroyedHostiles * 8 - destroyedFriendlies * 15 - casualties * 0.2
      )
    );

    return {
      id: operation.id,
      name: operation.name,
      startedAt: operation.startedAt,
      endedAt: operation.endedAt,
      durationMs: (operation.endedAt ?? lastFrame?.timestamp ?? operation.startedAt) - operation.startedAt,
      frameCount: operation.frames.length,
      eventCount: events.length,
      casualties: Math.round(casualties),
      objectivesAchieved,
      successRating: Math.round(successRating),
    };
  }
}

export const aarStore = new AARStore();
