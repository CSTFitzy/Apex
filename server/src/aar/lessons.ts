import { randomUUID } from 'crypto';
import type { LessonInsight, Operation, PerformanceAnalytics } from './types.js';
import { generateLessonsWithClaude, isClaudeConfigured } from './claudeService.js';

/**
 * Rule-based lessons-learned generator used as an offline fallback when the
 * Claude API is not configured or a request to it fails. Analyzes an
 * operation's recorded events and computed performance analytics to produce
 * structured insights across the six standard AAR categories.
 */
export function generateLessons(operation: Operation, analytics: PerformanceAnalytics): LessonInsight[] {
  const now = Date.now();
  const events = operation.frames.flatMap((f) => f.events);
  const lessons: LessonInsight[] = [];

  const push = (
    category: LessonInsight['category'],
    title: string,
    detail: string,
    severity: LessonInsight['severity'],
    applicability: LessonInsight['applicability']
  ) => {
    lessons.push({
      id: randomUUID(),
      operationId: operation.id,
      category,
      title,
      detail,
      severity,
      applicability,
      createdAt: now,
      source: 'rule_based',
    });
  };

  // 1. What went well
  const topPerformers = [...analytics.units]
    .filter((u) => u.affiliation === 'friendly')
    .sort((a, b) => b.combatEffectivenessScore - a.combatEffectivenessScore)
    .slice(0, 1);
  if (topPerformers.length && topPerformers[0].combatEffectivenessScore >= 60) {
    push(
      'what_went_well',
      `${topPerformers[0].unitName} performed effectively`,
      `${topPerformers[0].unitName} recorded a combat effectiveness score of ${topPerformers[0].combatEffectivenessScore}/100, dealing ${topPerformers[0].damageDealt} casualties to the enemy while sustaining ${topPerformers[0].casualties}.`,
      'low',
      'unit'
    );
  }
  const objectiveEvents = events.filter((e) => e.type === 'objective');
  if (objectiveEvents.length > 0) {
    push(
      'what_went_well',
      `${objectiveEvents.length} objective(s) achieved`,
      'Coordinated maneuver and fire support successfully achieved assigned objectives during the operation.',
      'low',
      'commander'
    );
  }

  // 2. What could improve
  const casualtyHeavyUnits = analytics.units.filter((u) => u.affiliation === 'friendly' && u.casualties > 0);
  if (casualtyHeavyUnits.length > 0) {
    const worst = [...casualtyHeavyUnits].sort((a, b) => b.casualties - a.casualties)[0];
    push(
      'what_could_improve',
      `${worst.unitName} sustained significant casualties`,
      `${worst.unitName} lost ${worst.casualties} strength over the course of the operation. Review dispersion, movement timing, and use of cover during contact.`,
      worst.casualties > 30 ? 'high' : 'medium',
      'unit'
    );
  }
  const destroyedFriendlies = analytics.units.filter((u) => u.affiliation === 'friendly' && !u.survived);
  if (destroyedFriendlies.length > 0) {
    push(
      'what_could_improve',
      `${destroyedFriendlies.length} friendly unit(s) lost`,
      'One or more friendly units were destroyed during the operation. Assess whether withdrawal criteria and reinforcement timing were correctly applied.',
      'high',
      'commander'
    );
  }

  // 3. Doctrinal alignment
  const contactEvents = events.filter((e) => e.type === 'contact');
  if (contactEvents.length > 3) {
    push(
      'doctrinal_alignment',
      'Repeated close contact with enemy forces',
      `Friendly units made contact with the enemy ${contactEvents.length} times. Confirm this is consistent with the commander's intent and scheme of maneuver rather than reactive drift into contact.`,
      contactEvents.length > 6 ? 'high' : 'medium',
      'doctrine'
    );
  } else {
    push(
      'doctrinal_alignment',
      'Engagement tempo within expected doctrine',
      'The number of direct-fire engagements observed is consistent with a deliberate, doctrine-aligned scheme of maneuver.',
      'low',
      'doctrine'
    );
  }

  // 4. Enemy analysis
  const hostileUnits = analytics.units.filter((u) => u.affiliation === 'hostile');
  const hostileLosses = hostileUnits.reduce((s, u) => s + u.casualties, 0);
  if (hostileUnits.length > 0) {
    push(
      'enemy_analysis',
      'Enemy attrition summary',
      `Enemy forces sustained ${hostileLosses} total casualties across ${hostileUnits.length} tracked unit(s). ${
        hostileUnits.filter((u) => !u.survived).length
      } enemy unit(s) were destroyed, indicating the relative effectiveness of the friendly scheme of maneuver against the observed enemy tactics.`,
      'low',
      'general'
    );
  }

  // 5. Environmental factors
  const movementEvents = events.filter((e) => e.type === 'movement');
  push(
    'environmental_factors',
    'Terrain and movement observations',
    movementEvents.length > 0
      ? `Units executed ${movementEvents.length} recorded movement(s). Review terrain, weather, and time-of-day data for this operation to identify any conditions that affected mobility or visibility.`
      : 'No significant movement-related events were recorded; environmental conditions did not appear to materially constrain maneuver.',
    'low',
    'general'
  );

  // 6. Training recommendations
  if (analytics.commanderEffectiveness.tacticalDecisionQualityScore < 60) {
    push(
      'training_recommendations',
      'Tactical decision-making below target',
      `Tactical decision quality score was ${analytics.commanderEffectiveness.tacticalDecisionQualityScore}/100. Recommend follow-on training focused on contact drills, objective sequencing, and command-and-control under fire.`,
      'medium',
      'commander'
    );
  }
  if (analytics.commanderEffectiveness.supplyManagementScore < 60) {
    push(
      'training_recommendations',
      'Supply management below target',
      `Supply management score was ${analytics.commanderEffectiveness.supplyManagementScore}/100. Recommend logistics-focused training on resupply scheduling and consumption forecasting.`,
      'medium',
      'commander'
    );
  }
  if (lessons.filter((l) => l.category === 'training_recommendations').length === 0) {
    push(
      'training_recommendations',
      'No critical skill gaps identified',
      'Overall commander effectiveness scores were at or above target thresholds. Continue sustainment training to maintain readiness.',
      'low',
      'general'
    );
  }

  return lessons;
}

/** Full-text search across a collection of lessons by title/detail. */
export function searchLessons(lessons: LessonInsight[], query: string): LessonInsight[] {
  const q = query.trim().toLowerCase();
  if (!q) return lessons;
  return lessons.filter(
    (l) => l.title.toLowerCase().includes(q) || l.detail.toLowerCase().includes(q) || l.category.includes(q)
  );
}

/**
 * Produces lessons learned for an operation, preferring a real Claude API analysis
 * when configured and falling back transparently to the offline rule-based
 * generator if Claude is not configured or the request fails.
 */
export async function getLessonsForOperation(
  operation: Operation,
  analytics: PerformanceAnalytics
): Promise<LessonInsight[]> {
  if (isClaudeConfigured()) {
    try {
      return await generateLessonsWithClaude(operation, analytics);
    } catch (error) {
      console.error(`Claude lessons generation failed for operation ${operation.id}, falling back to rule-based analysis:`, error);
    }
  }
  return generateLessons(operation, analytics);
}
