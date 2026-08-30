/**
 * In-memory After-Action Review (AAR) operation store.
 *
 * Records frame-by-frame unit state, tactical events, and bookmarks/notes
 * captured during a live simulation or replay session, plus operation
 * metadata (name, date, duration, commanders, objectives).
 *
 * This is intentionally in-memory only; the shape here is designed so it
 * can be swapped for a persistent store (Postgres/TimescaleDB) later
 * without changing call sites (see server/routes/aar.js).
 */

import { randomUUID } from 'crypto';

const MAX_FRAMES_PER_OPERATION = 5000;
const MAX_EVENTS_PER_OPERATION = 2000;

/** @type {Map<string, object>} */
const operations = new Map();

/**
 * Start recording a new operation.
 * @param {object} meta - { name, commanders, objectives, side }
 */
export function startOperation(meta = {}) {
  const id = meta.id || randomUUID();
  const startedAt = meta.startedAt || new Date().toISOString();
  const operation = {
    id,
    name: meta.name || `Operation ${id.slice(0, 8)}`,
    commanders: Array.isArray(meta.commanders) ? meta.commanders : [],
    objectives: Array.isArray(meta.objectives) ? meta.objectives : [],
    startedAt,
    endedAt: null,
    status: 'recording',
    frames: [],
    events: [],
    bookmarks: [],
  };
  operations.set(id, operation);
  return operation;
}

/** Look up an operation by id. */
export function getOperation(id) {
  return operations.get(id) || null;
}

/** List all recorded operations (most recent first), without frame/event bodies. */
export function listOperations() {
  return [...operations.values()]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .map(summarizeOperation);
}

/** Summarize an operation for list views (omits bulky frame/event arrays). */
export function summarizeOperation(operation) {
  return {
    id: operation.id,
    name: operation.name,
    commanders: operation.commanders,
    objectives: operation.objectives,
    startedAt: operation.startedAt,
    endedAt: operation.endedAt,
    status: operation.status,
    durationMs: operationDurationMs(operation),
    frameCount: operation.frames.length,
    eventCount: operation.events.length,
    bookmarkCount: operation.bookmarks.length,
  };
}

/** Duration (ms) of an operation, using `endedAt` if set, else "now". */
export function operationDurationMs(operation) {
  const start = new Date(operation.startedAt).getTime();
  const end = operation.endedAt ? new Date(operation.endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

/** Record a frame of unit state (positions/status) for an operation. */
export function recordFrame(operationId, frame) {
  const operation = operations.get(operationId);
  if (!operation) return null;
  const enriched = {
    timestamp: frame.timestamp || new Date().toISOString(),
    units: Array.isArray(frame.units) ? frame.units : [],
  };
  operation.frames.push(enriched);
  if (operation.frames.length > MAX_FRAMES_PER_OPERATION) {
    operation.frames.splice(0, operation.frames.length - MAX_FRAMES_PER_OPERATION);
  }
  return enriched;
}

/** Record a tactical event (casualty, enemy contact, unit destroyed, supply consumed, ...). */
export function recordEvent(operationId, event) {
  const operation = operations.get(operationId);
  if (!operation) return null;
  const enriched = {
    id: event.id || randomUUID(),
    timestamp: event.timestamp || new Date().toISOString(),
    type: event.type || 'unknown',
    unitId: event.unitId ?? null,
    side: event.side ?? null,
    severity: event.severity ?? null,
    position: event.position ?? null,
    details: event.details ?? '',
  };
  operation.events.push(enriched);
  if (operation.events.length > MAX_EVENTS_PER_OPERATION) {
    operation.events.splice(0, operation.events.length - MAX_EVENTS_PER_OPERATION);
  }
  return enriched;
}

/** Add a bookmark/note at a point in the operation timeline. */
export function addBookmark(operationId, bookmark) {
  const operation = operations.get(operationId);
  if (!operation) return null;
  const enriched = {
    id: bookmark.id || randomUUID(),
    timestamp: bookmark.timestamp || new Date().toISOString(),
    label: bookmark.label || 'Bookmark',
    note: bookmark.note || '',
  };
  operation.bookmarks.push(enriched);
  return enriched;
}

/** Mark an operation as complete. */
export function endOperation(operationId, meta = {}) {
  const operation = operations.get(operationId);
  if (!operation) return null;
  operation.endedAt = meta.endedAt || new Date().toISOString();
  operation.status = 'complete';
  return operation;
}

/** Delete an operation (primarily for tests / cleanup). */
export function deleteOperation(operationId) {
  return operations.delete(operationId);
}

/** Clear all operations (primarily for tests). */
export function clearOperations() {
  operations.clear();
}
