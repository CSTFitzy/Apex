/**
 * In-memory tactical event log buffer.
 *
 * The analytics engine is otherwise stateless (see server/analytics/engine.js),
 * but the event ingestion endpoint keeps a short rolling buffer so newly
 * connected clients/dashboards can fetch recent history instead of only
 * receiving events broadcast after they subscribe.
 */

const MAX_BUFFERED_EVENTS = 500;

let events = [];

/** Append an event to the buffer, trimming to the max buffer size. */
export function recordEvent(event) {
  events.push(event);
  if (events.length > MAX_BUFFERED_EVENTS) {
    events = events.slice(events.length - MAX_BUFFERED_EVENTS);
  }
  return event;
}

/** Return the most recent buffered events (default: all buffered). */
export function getRecentEvents(limit = MAX_BUFFERED_EVENTS) {
  if (limit >= events.length) return [...events];
  return events.slice(events.length - limit);
}

/** Clear the buffer (primarily for tests). */
export function clearEvents() {
  events = [];
}
