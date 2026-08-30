import type { AAREvent, AARFrame, Lesson, UnitPerformance } from './types.js';

/**
 * LessonsService: rule-based heuristic analysis of an operation's timeline
 * and computed performance metrics, generating "AI-style" lessons learned
 * across the six standard AAR insight categories.
 */

let lessonCounter = 0;
function nextLessonId(): string {
  lessonCounter += 1;
  return `lesson-${Date.now()}-${lessonCounter}`;
}

function combatEvents(events: AAREvent[]): AAREvent[] {
  return events.filter((e) => e.eventType === 'combat_action');
}

export function generateLessons(
  events: AAREvent[],
  frames: AARFrame[],
  unitPerformance: UnitPerformance[]
): Lesson[] {
  const lessons: Lesson[] = [];
  const friendly = unitPerformance.filter((u) => u.affiliation === 'friendly');
  const hostile = unitPerformance.filter((u) => u.affiliation === 'hostile');
  const engagements = combatEvents(events);

  // --- What Went Well ---
  const bestFriendly = [...friendly].sort(
    (a, b) => b.combatEffectivenessScore - a.combatEffectivenessScore
  )[0];
  if (bestFriendly && engagements.length > 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'what_went_well',
      severity: 'low',
      summary: `${bestFriendly.unitName} maintained the highest combat effectiveness (${bestFriendly.combatEffectivenessScore}/100) of all friendly units, sustaining only ${bestFriendly.casualtyRatePct}% casualties across ${bestFriendly.engagementsInvolved} engagement(s).`,
      evidenceEventIds: engagements
        .filter((e) => e.unitIds?.includes(bestFriendly.unitId))
        .map((e) => e.eventId),
    });
  }
  const favourableExchange =
    hostile.reduce((s, u) => s + u.casualties, 0) > friendly.reduce((s, u) => s + u.casualties, 0);
  if (favourableExchange && engagements.length > 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'what_went_well',
      severity: 'low',
      summary:
        'Friendly forces achieved a favourable casualty exchange ratio, inflicting more casualties on the enemy than sustained across the operation.',
      evidenceEventIds: engagements.map((e) => e.eventId),
    });
  }

  // --- What Could Improve ---
  const worstFriendly = [...friendly].sort(
    (a, b) => a.combatEffectivenessScore - b.combatEffectivenessScore
  )[0];
  if (worstFriendly && worstFriendly.casualtyRatePct > 25) {
    lessons.push({
      id: nextLessonId(),
      category: 'what_could_improve',
      severity: worstFriendly.casualtyRatePct > 50 ? 'high' : 'medium',
      summary: `${worstFriendly.unitName} sustained a high casualty rate (${worstFriendly.casualtyRatePct}%). Review positioning and support at the time of contact to reduce exposure in similar future engagements.`,
      evidenceEventIds: combatEvents(events)
        .filter((e) => e.unitIds?.includes(worstFriendly.unitId))
        .map((e) => e.eventId),
    });
  }
  if (engagements.length === 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'what_could_improve',
      severity: 'low',
      summary:
        'No engagements were recorded during this operation. Confirm this reflects an accurate reconnaissance/avoidance posture rather than a missed contact.',
      evidenceEventIds: [],
    });
  }

  // --- Doctrinal Alignment ---
  const spreadUnits = friendly.length;
  if (spreadUnits > 1 && favourableExchange === false && engagements.length > 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'doctrinal_alignment',
      severity: 'medium',
      summary:
        'Unfavourable casualty exchange during contact suggests friendly units may have been engaged without adequate mutual support. Doctrine recommends maintaining supporting distance between manoeuvre elements.',
      evidenceEventIds: engagements.map((e) => e.eventId),
    });
  } else {
    lessons.push({
      id: nextLessonId(),
      category: 'doctrinal_alignment',
      severity: 'low',
      summary:
        'No clear doctrinal violations were identified from the recorded unit dispositions and engagement outcomes.',
      evidenceEventIds: [],
    });
  }

  // --- Enemy Analysis ---
  const bestHostile = [...hostile].sort(
    (a, b) => b.combatEffectivenessScore - a.combatEffectivenessScore
  )[0];
  if (bestHostile) {
    lessons.push({
      id: nextLessonId(),
      category: 'enemy_analysis',
      severity: 'low',
      summary: `Enemy element "${bestHostile.unitName}" retained ${bestHostile.combatEffectivenessScore}/100 combat effectiveness by the end of the operation. Assess whether its doctrine or terrain use should inform future counter-plans.`,
      evidenceEventIds: [],
    });
  }
  const destroyedHostile = hostile.filter((u) => u.finalStatus === 'destroyed');
  if (destroyedHostile.length > 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'enemy_analysis',
      severity: 'low',
      summary: `${destroyedHostile.length} enemy element(s) were rendered combat ineffective, indicating friendly forces successfully exploited weaknesses in enemy dispositions.`,
      evidenceEventIds: [],
    });
  }

  // --- Environmental Factors ---
  const durationMs =
    frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0;
  const durationMinutes = Math.round(durationMs / 60000);
  lessons.push({
    id: nextLessonId(),
    category: 'environmental_factors',
    severity: 'low',
    summary:
      durationMinutes > 0
        ? `Operation ran for approximately ${durationMinutes} minute(s) of simulated time. Consider terrain, weather, and time-of-day conditions recorded in the mission log when planning similar future operations.`
        : 'Insufficient timeline data was recorded to assess environmental impact on this operation.',
    evidenceEventIds: [],
  });

  // --- Training Recommendations ---
  const highCasualtyUnits = friendly.filter((u) => u.casualtyRatePct > 30);
  if (highCasualtyUnits.length > 0) {
    lessons.push({
      id: nextLessonId(),
      category: 'training_recommendations',
      severity: 'medium',
      summary: `${highCasualtyUnits
        .map((u) => u.unitName)
        .join(', ')} would benefit from additional training focused on contact drills and casualty avoidance, given casualty rates above 30%.`,
      evidenceEventIds: [],
    });
  } else {
    lessons.push({
      id: nextLessonId(),
      category: 'training_recommendations',
      severity: 'low',
      summary:
        'No unit-specific training gaps were identified from casualty and effectiveness data; continue sustainment training on current tactics, techniques, and procedures.',
      evidenceEventIds: [],
    });
  }

  return lessons;
}
