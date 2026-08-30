import type { LessonInsight, Operation, PerformanceAnalytics } from './types.js';
import { aarStore } from './store.js';

export interface AARReportBundle {
  summary: ReturnType<typeof aarStore.summarize>;
  analytics: PerformanceAnalytics;
  lessons: LessonInsight[];
  bookmarks: Operation['bookmarks'];
}

export function buildReportBundle(
  operation: Operation,
  analytics: PerformanceAnalytics,
  lessons: LessonInsight[]
): AARReportBundle {
  return {
    summary: aarStore.summarize(operation),
    analytics,
    lessons,
    bookmarks: operation.bookmarks,
  };
}

export function toJsonReport(bundle: AARReportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

function csvEscape(value: string | number | boolean): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCsvReport(bundle: AARReportBundle): string {
  const rows: string[] = [];
  rows.push('Unit ID,Unit Name,Affiliation,Starting Strength,Ending Strength,Casualties,Damage Dealt,Combat Effectiveness Score,Survived,Engagements');
  for (const u of bundle.analytics.units) {
    rows.push(
      [
        u.unitId,
        u.unitName,
        u.affiliation,
        u.startingStrength,
        u.endingStrength,
        u.casualties,
        u.damageDealt,
        u.combatEffectivenessScore,
        u.survived,
        u.engagements,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  rows.push('');
  rows.push('Lesson Category,Title,Severity,Applicability,Detail');
  for (const l of bundle.lessons) {
    rows.push([l.category, l.title, l.severity, l.applicability, l.detail].map(csvEscape).join(','));
  }
  return rows.join('\n');
}

export function toHtmlReport(bundle: AARReportBundle): string {
  const { summary, analytics, lessons } = bundle;
  const unitRows = analytics.units
    .map(
      (u) => `<tr>
        <td>${u.unitName}</td>
        <td>${u.affiliation}</td>
        <td>${u.startingStrength}</td>
        <td>${u.endingStrength}</td>
        <td>${u.casualties}</td>
        <td>${u.damageDealt}</td>
        <td>${u.combatEffectivenessScore}</td>
        <td>${u.survived ? 'Yes' : 'No'}</td>
      </tr>`
    )
    .join('\n');

  const lessonSections = lessons
    .map(
      (l) => `<li><strong>[${l.severity.toUpperCase()}]</strong> ${l.title} - ${l.detail}</li>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>After-Action Report: ${summary.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1, h2 { color: #12314f; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #12314f; color: #fff; }
    .summary-grid { display: flex; gap: 2rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .summary-item { background: #f2f4f7; padding: 0.75rem 1rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>After-Action Report: ${summary.name}</h1>
  <div class="summary-grid">
    <div class="summary-item"><strong>Duration:</strong> ${Math.round(summary.durationMs / 60000)} min</div>
    <div class="summary-item"><strong>Casualties:</strong> ${summary.casualties}</div>
    <div class="summary-item"><strong>Objectives Achieved:</strong> ${summary.objectivesAchieved}</div>
    <div class="summary-item"><strong>Success Rating:</strong> ${summary.successRating}/100</div>
  </div>

  <h2>Unit Performance</h2>
  <table>
    <thead>
      <tr><th>Unit</th><th>Affiliation</th><th>Start Strength</th><th>End Strength</th><th>Casualties</th><th>Damage Dealt</th><th>Effectiveness</th><th>Survived</th></tr>
    </thead>
    <tbody>
      ${unitRows}
    </tbody>
  </table>

  <h2>Commander Effectiveness</h2>
  <ul>
    <li>Tactical Decision Quality: ${analytics.commanderEffectiveness.tacticalDecisionQualityScore}/100</li>
    <li>Supply Management: ${analytics.commanderEffectiveness.supplyManagementScore}/100</li>
    <li>Combat Effectiveness: ${analytics.commanderEffectiveness.combatEffectivenessScore}/100</li>
    <li>Overall: ${analytics.commanderEffectiveness.overallScore}/100</li>
  </ul>

  <h2>Lessons Learned</h2>
  <ul>
    ${lessonSections || '<li>No lessons generated for this operation.</li>'}
  </ul>
</body>
</html>`;
}
