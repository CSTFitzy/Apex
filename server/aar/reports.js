/**
 * Report export for recorded operations: JSON, CSV, and HTML formats.
 */

import { buildAnalyticsBundle } from './analytics.js';
import { getLessonsForOperation } from './lessons.js';
import { summarizeOperation } from './store.js';

/** Build the full report bundle (metadata + analytics + lessons) for an operation. */
export function buildReportBundle(operation) {
  return {
    operation: summarizeOperation(operation),
    events: operation.events,
    bookmarks: operation.bookmarks,
    analytics: buildAnalyticsBundle(operation),
    lessons: getLessonsForOperation(operation),
  };
}

/** Export a report as a JSON string. */
export function exportJSON(operation) {
  return JSON.stringify(buildReportBundle(operation), null, 2);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Export a report as CSV containing per-unit metrics. */
export function exportCSV(operation) {
  const { analytics } = buildReportBundle(operation);
  const header = [
    'unitId',
    'name',
    'side',
    'type',
    'startStrength',
    'endStrength',
    'casualties',
    'engagementCount',
    'destroyed',
    'effectiveness',
  ];
  const rows = analytics.unitAnalytics.map((u) =>
    [
      u.unitId,
      u.name,
      u.side,
      u.type,
      u.startStrength,
      u.endStrength,
      u.casualties,
      u.engagementCount,
      u.destroyed,
      u.effectiveness,
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

/** Export a report as a formatted HTML document. */
export function exportHTML(operation) {
  const bundle = buildReportBundle(operation);
  const { operation: meta, analytics, lessons } = bundle;

  const unitRows = analytics.unitAnalytics
    .map(
      (u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.side)}</td><td>${u.casualties}</td>` +
        `<td>${u.engagementCount}</td><td>${u.effectiveness}</td><td>${u.destroyed ? 'Yes' : 'No'}</td></tr>`
    )
    .join('\n');

  const lessonItems = lessons
    .map((l) => `<li><strong>[${escapeHtml(l.category)}]</strong> ${escapeHtml(l.title)}: ${escapeHtml(l.detail)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>After-Action Review: ${escapeHtml(meta.name)}</title>
<style>
body { font-family: sans-serif; margin: 2rem; color: #1a1a1a; }
h1, h2 { color: #0b3d91; }
table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
th { background: #f0f0f0; }
</style>
</head>
<body>
<h1>After-Action Review: ${escapeHtml(meta.name)}</h1>
<p>Started: ${escapeHtml(meta.startedAt)} — Duration: ${meta.durationMs}ms</p>
<h2>Unit Performance</h2>
<table>
<thead><tr><th>Unit</th><th>Side</th><th>Casualties</th><th>Engagements</th><th>Effectiveness</th><th>Destroyed</th></tr></thead>
<tbody>
${unitRows}
</tbody>
</table>
<h2>Lessons Learned</h2>
<ul>
${lessonItems}
</ul>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Export a report in the given format ('json' | 'csv' | 'html'). */
export function exportReport(operation, format = 'json') {
  switch (format) {
    case 'csv':
      return { contentType: 'text/csv', body: exportCSV(operation) };
    case 'html':
      return { contentType: 'text/html', body: exportHTML(operation) };
    case 'json':
    default:
      return { contentType: 'application/json', body: exportJSON(operation) };
  }
}
