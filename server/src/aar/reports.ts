import type { LessonInsight, Operation, PerformanceAnalytics } from './types.js';
import { aarStore } from './store.js';
import { generateNarrativeReport, isClaudeConfigured } from './claudeService.js';

export interface AARReportBundle {
  summary: ReturnType<typeof aarStore.summarize>;
  analytics: PerformanceAnalytics;
  lessons: LessonInsight[];
  bookmarks: Operation['bookmarks'];
  narrative: string;
}

function fallbackNarrative(operation: Operation, analytics: PerformanceAnalytics): string {
  const summary = aarStore.summarize(operation);
  return (
    `Operation "${summary.name}" ran for approximately ${Math.round(summary.durationMs / 60000)} minute(s), ` +
    `recording ${summary.eventCount} event(s) and ${summary.casualties} total casualties across ${analytics.units.length} tracked unit(s). ` +
    `${summary.objectivesAchieved} objective(s) were achieved, yielding an overall success rating of ${summary.successRating}/100. ` +
    `Commander effectiveness scored ${analytics.commanderEffectiveness.overallScore}/100 overall ` +
    `(tactical decision quality ${analytics.commanderEffectiveness.tacticalDecisionQualityScore}/100, ` +
    `supply management ${analytics.commanderEffectiveness.supplyManagementScore}/100).`
  );
}

/**
 * Builds the full report bundle, preferring a Claude-generated narrative summary
 * when configured and falling back to a templated narrative otherwise.
 */
export async function buildReportBundle(
  operation: Operation,
  analytics: PerformanceAnalytics,
  lessons: LessonInsight[]
): Promise<AARReportBundle> {
  let narrative = fallbackNarrative(operation, analytics);
  if (isClaudeConfigured()) {
    try {
      narrative = await generateNarrativeReport(operation, analytics, lessons);
    } catch (error) {
      console.error(`Claude narrative generation failed for operation ${operation.id}, using templated narrative:`, error);
    }
  }

  return {
    summary: aarStore.summarize(operation),
    analytics,
    lessons,
    bookmarks: operation.bookmarks,
    narrative,
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
  rows.push('Lesson Category,Title,Severity,Applicability,Source,Detail');
  for (const l of bundle.lessons) {
    rows.push([l.category, l.title, l.severity, l.applicability, l.source, l.detail].map(csvEscape).join(','));
  }
  return rows.join('\n');
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toHtmlReport(bundle: AARReportBundle): string {
  const { summary, analytics, lessons, narrative } = bundle;
  const unitRows = analytics.units
    .map(
      (u) => `<tr>
        <td>${htmlEscape(u.unitName)}</td>
        <td>${htmlEscape(u.affiliation)}</td>
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
      (l) =>
        `<li><strong>[${htmlEscape(l.severity.toUpperCase())}]</strong> ${htmlEscape(l.title)} - ${htmlEscape(l.detail)} <em>(${l.source === 'claude' ? 'AI-generated' : 'rule-based'})</em></li>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>After-Action Report: ${htmlEscape(summary.name)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1, h2 { color: #12314f; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #12314f; color: #fff; }
    .summary-grid { display: flex; gap: 2rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .summary-item { background: #f2f4f7; padding: 0.75rem 1rem; border-radius: 6px; }
    .narrative { white-space: pre-wrap; line-height: 1.5; background: #f2f4f7; padding: 1rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>After-Action Report: ${htmlEscape(summary.name)}</h1>
  <div class="summary-grid">
    <div class="summary-item"><strong>Duration:</strong> ${Math.round(summary.durationMs / 60000)} min</div>
    <div class="summary-item"><strong>Casualties:</strong> ${summary.casualties}</div>
    <div class="summary-item"><strong>Objectives Achieved:</strong> ${summary.objectivesAchieved}</div>
    <div class="summary-item"><strong>Success Rating:</strong> ${summary.successRating}/100</div>
  </div>

  <h2>Executive Summary</h2>
  <p class="narrative">${htmlEscape(narrative)}</p>

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
