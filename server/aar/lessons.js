/**
 * Rule-based lessons-learned generator.
 *
 * Produces lessons across six categories from a recorded operation's
 * events, frames, and computed analytics. Lessons are persisted alongside
 * the operation (in-memory) and are searchable by keyword.
 */

import { buildAnalyticsBundle } from './analytics.js';

export const LESSON_CATEGORIES = {
  WHAT_WENT_WELL: 'what_went_well',
  WHAT_COULD_IMPROVE: 'what_could_improve',
  DOCTRINAL_ALIGNMENT: 'doctrinal_alignment',
  ENEMY_ANALYSIS: 'enemy_analysis',
  ENVIRONMENTAL_FACTORS: 'environmental_factors',
  TRAINING_RECOMMENDATIONS: 'training_recommendations',
};

const lessonsByOperation = new Map();

function makeLesson(category, title, detail, severity = 'info') {
  return { category, title, detail, severity };
}

/** Generate rule-based lessons learned for a recorded operation. */
export function generateLessons(operation) {
  const { unitAnalytics, commanderEffectiveness, forceMetrics } = buildAnalyticsBundle(operation);
  const friendly = unitAnalytics.filter((u) => u.side === 'friendly');
  const enemy = unitAnalytics.filter((u) => u.side === 'enemy');
  const lessons = [];

  /* ---------------------------- What Went Well --------------------------- */
  const topPerformers = friendly.filter((u) => u.effectiveness >= 70);
  if (topPerformers.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_WENT_WELL,
        `${topPerformers.length} unit(s) performed with high effectiveness`,
        `${topPerformers.map((u) => u.name).join(', ')} achieved effectiveness scores of 70+, ` +
          'indicating sound positioning and engagement discipline.',
        'positive'
      )
    );
  }
  if (forceMetrics.exchangeRatio > 1) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_WENT_WELL,
        'Favorable casualty exchange ratio',
        `Enemy casualties outpaced friendly casualties (ratio ${forceMetrics.exchangeRatio}:1), ` +
          'suggesting effective fire discipline and target prioritization.',
        'positive'
      )
    );
  }
  if (lessons.filter((l) => l.category === LESSON_CATEGORIES.WHAT_WENT_WELL).length === 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_WENT_WELL,
        'No standout successes identified',
        'No units achieved a notably high effectiveness score during this operation.',
        'neutral'
      )
    );
  }

  /* ------------------------- What Could Improve -------------------------- */
  const strugglingUnits = friendly.filter((u) => u.effectiveness < 40);
  if (strugglingUnits.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_COULD_IMPROVE,
        `${strugglingUnits.length} unit(s) underperformed`,
        `${strugglingUnits.map((u) => u.name).join(', ')} scored below 40 effectiveness; review ` +
          'positioning, supply status, and command decisions for these units.',
        'warning'
      )
    );
  }
  const destroyedFriendly = friendly.filter((u) => u.destroyed);
  if (destroyedFriendly.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_COULD_IMPROVE,
        `${destroyedFriendly.length} friendly unit(s) lost`,
        `${destroyedFriendly.map((u) => u.name).join(', ')} were destroyed. Review the tactical ` +
          'decisions leading up to each loss for avoidable errors.',
        'critical'
      )
    );
  }
  if (forceMetrics.exchangeRatio < 1 && forceMetrics.friendly.casualties > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.WHAT_COULD_IMPROVE,
        'Unfavorable casualty exchange ratio',
        `Friendly casualties outpaced enemy casualties (ratio ${forceMetrics.exchangeRatio}:1). ` +
          'Consider adjusting engagement ranges or fire support coordination.',
        'warning'
      )
    );
  }

  /* -------------------------- Doctrinal Alignment ------------------------- */
  const commander = commanderEffectiveness.friendly;
  lessons.push(
    makeLesson(
      LESSON_CATEGORIES.DOCTRINAL_ALIGNMENT,
      'Commander effectiveness assessment',
      `Tactical decision score: ${commander.tacticalDecisionScore}, supply management score: ` +
        `${commander.supplyManagementScore}, combat effectiveness score: ${commander.combatEffectivenessScore}.`,
      commander.overallScore >= 60 ? 'positive' : 'warning'
    )
  );
  if (commander.supplyManagementScore < 50) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.DOCTRINAL_ALIGNMENT,
        'Supply discipline below doctrine standard',
        'Units consumed supply at a rate inconsistent with sustainment doctrine; reinforce ' +
          'resupply planning during mission briefs.',
        'warning'
      )
    );
  }

  /* ---------------------------- Enemy Analysis ---------------------------- */
  lessons.push(
    makeLesson(
      LESSON_CATEGORIES.ENEMY_ANALYSIS,
      'Enemy force composition and losses',
      `Enemy fielded ${enemy.length} identified unit(s), sustaining ${forceMetrics.enemy.casualties} ` +
        `casualties and ${forceMetrics.enemy.unitsDestroyed} unit(s) destroyed.`,
      'info'
    )
  );
  const enemyContactEvents = operation.events.filter((e) => e.type === 'enemy_contact');
  if (enemyContactEvents.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.ENEMY_ANALYSIS,
        `${enemyContactEvents.length} enemy contact event(s) recorded`,
        'Review contact locations and timing to identify enemy patterns of movement and likely avenues of approach.',
        'info'
      )
    );
  }

  /* ------------------------- Environmental Factors ------------------------ */
  const commsBlackouts = operation.events.filter((e) => e.type === 'comms_blackout');
  if (commsBlackouts.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.ENVIRONMENTAL_FACTORS,
        `${commsBlackouts.length} communications blackout event(s)`,
        'Communications degradation may have affected coordination; assess terrain/jamming impact on comms.',
        'warning'
      )
    );
  }
  const supplyLowEvents = operation.events.filter((e) => e.type === 'supply_low');
  if (supplyLowEvents.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.ENVIRONMENTAL_FACTORS,
        `${supplyLowEvents.length} low-supply event(s)`,
        'Terrain and distance from depots may have constrained resupply; consider forward staging.',
        'warning'
      )
    );
  }
  if (commsBlackouts.length === 0 && supplyLowEvents.length === 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.ENVIRONMENTAL_FACTORS,
        'No significant environmental degradation observed',
        'Communications and supply remained stable throughout the operation.',
        'neutral'
      )
    );
  }

  /* ----------------------- Training Recommendations ------------------------ */
  if (strugglingUnits.length > 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.TRAINING_RECOMMENDATIONS,
        'Focused refresher training recommended',
        `Schedule refresher training for ${strugglingUnits.map((u) => u.name).join(', ')} focused on ` +
          'engagement discipline and casualty avoidance.',
        'action'
      )
    );
  }
  if (commander.supplyManagementScore < 50) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.TRAINING_RECOMMENDATIONS,
        'Logistics planning exercise recommended',
        'Run a sustainment/logistics planning exercise to reinforce supply management fundamentals.',
        'action'
      )
    );
  }
  if (lessons.filter((l) => l.category === LESSON_CATEGORIES.TRAINING_RECOMMENDATIONS).length === 0) {
    lessons.push(
      makeLesson(
        LESSON_CATEGORIES.TRAINING_RECOMMENDATIONS,
        'Maintain current training tempo',
        'No critical gaps identified; continue standard sustainment and combat readiness training.',
        'neutral'
      )
    );
  }

  return lessons.map((lesson, index) => ({
    id: `${operation.id}-lesson-${index}`,
    operationId: operation.id,
    ...lesson,
  }));
}

/** Compute (and cache) lessons for an operation, persisting them in memory. */
export function getLessonsForOperation(operation) {
  if (!lessonsByOperation.has(operation.id)) {
    lessonsByOperation.set(operation.id, generateLessons(operation));
  }
  return lessonsByOperation.get(operation.id);
}

/** Force regeneration of lessons for an operation (e.g. after AI augmentation). */
export function regenerateLessons(operation) {
  const lessons = generateLessons(operation);
  lessonsByOperation.set(operation.id, lessons);
  return lessons;
}

/** Search lessons for an operation by keyword (title/detail/category match). */
export function searchLessons(operation, query) {
  const lessons = getLessonsForOperation(operation);
  if (!query || typeof query !== 'string') return lessons;
  const needle = query.trim().toLowerCase();
  if (!needle) return lessons;
  return lessons.filter(
    (lesson) =>
      lesson.title.toLowerCase().includes(needle) ||
      lesson.detail.toLowerCase().includes(needle) ||
      lesson.category.toLowerCase().includes(needle)
  );
}

/** Clear the lessons cache (primarily for tests). */
export function clearLessonsCache() {
  lessonsByOperation.clear();
}
