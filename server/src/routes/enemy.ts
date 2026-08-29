import { Router, Request, Response } from 'express';
import { doctrineProfiles, matchDoctrineProfiles, DoctrineProfile } from '../data/doctrine.js';

const router = Router();

interface FriendlyForce {
  name: string;
  composition: string;
  strength?: number;
  equipment?: string[];
  location?: { lat: number; lon: number };
}

interface CounterPlanRequest {
  enemyText?: string;
  matchedDoctrineIds?: string[];
  friendlyForces: FriendlyForce[];
  terrainSummary?: string;
}

function assessThreatLevel(
  profiles: DoctrineProfile[],
  friendlyForces: FriendlyForce[]
): { level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'; probabilityOfSuccessPct: number; rationale: string[] } {
  const rationale: string[] = [];
  let score = 0;

  score += profiles.length * 2;
  if (profiles.some((p) => p.id === 'armored')) {
    score += 3;
    rationale.push('Enemy armored capability identified - significant lethality against unprotected positions');
  }
  if (profiles.some((p) => p.id === 'artillery')) {
    score += 2;
    rationale.push('Enemy indirect fire capability identified - requires dispersion and counter-battery planning');
  }
  if (profiles.some((p) => p.id === 'light-infantry')) {
    score += 1;
    rationale.push('Irregular/light infantry threat identified - requires route clearance and 360-degree security');
  }

  const friendlyStrength = friendlyForces.reduce((sum, f) => sum + (f.strength || 0), 0);
  if (friendlyStrength > 0 && friendlyStrength < 50) {
    score += 2;
    rationale.push('Friendly force strength is relatively small compared to identified enemy composition');
  }

  if (rationale.length === 0) {
    rationale.push('Limited enemy information extracted - assessment based on generic doctrine assumptions');
  }

  let level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (score >= 8) level = 'CRITICAL';
  else if (score >= 5) level = 'HIGH';
  else if (score >= 2) level = 'MODERATE';

  const probabilityOfSuccessPct = Math.max(10, Math.min(90, 90 - score * 8));

  return { level, probabilityOfSuccessPct, rationale };
}

function generateCounterPlan(
  profiles: DoctrineProfile[],
  friendlyForces: FriendlyForce[],
  terrainSummary?: string
): { narrative: string; recommendedActions: string[] } {
  const recommendedActions = new Set<string>();

  profiles.forEach((profile) => {
    profile.counterTactics.forEach((tactic) => recommendedActions.add(tactic));
  });

  if (recommendedActions.size === 0) {
    recommendedActions.add('Maintain standard defensive posture and continue ISR collection to refine the enemy picture');
  }

  if (terrainSummary) {
    recommendedActions.add(
      `Incorporate terrain analysis findings into the plan: ${terrainSummary}`
    );
  }

  const enemyTacticsText = profiles
    .map((p) => `${p.name} is likely to: ${p.tactics.join('; ')}.`)
    .join(' ');

  const friendlySummary =
    friendlyForces.length > 0
      ? friendlyForces
          .map((f) => `${f.name} (${f.composition}${f.strength ? `, ~${f.strength} personnel` : ''})`)
          .join(', ')
      : 'friendly forces (composition not specified)';

  const narrative =
    `Based on the identified enemy composition, the enemy is expected to employ the following doctrine: ` +
    `${enemyTacticsText || 'no specific doctrine matched - insufficient intelligence extracted from the uploaded orders.'} ` +
    `Against ${friendlySummary}, the recommended counter-plan focuses on using terrain to friendly advantage, ` +
    `disrupting enemy reconnaissance and freedom of movement, and concentrating combat power at points identified ` +
    `by the terrain analysis engine as key/decisive terrain.`;

  return { narrative, recommendedActions: Array.from(recommendedActions) };
}

/**
 * POST /api/enemy/counter-plan
 * Body: { enemyText, matchedDoctrineIds?, friendlyForces, terrainSummary? }
 * Uses the simulated ODIN doctrine database to analyze likely enemy tactics
 * against the supplied friendly force disposition, and generates a
 * counter-plan narrative plus a threat/probability-of-success assessment.
 */
router.post('/counter-plan', (req: Request, res: Response) => {
  try {
    const body = req.body as CounterPlanRequest;
    const friendlyForces = body.friendlyForces || [];

    let profiles: DoctrineProfile[] = [];
    if (body.matchedDoctrineIds?.length) {
      profiles = doctrineProfiles.filter((p) => body.matchedDoctrineIds!.includes(p.id));
    } else if (body.enemyText) {
      profiles = matchDoctrineProfiles(body.enemyText);
    }

    const threatAssessment = assessThreatLevel(profiles, friendlyForces);
    const counterPlan = generateCounterPlan(profiles, friendlyForces, body.terrainSummary);

    res.json({
      matchedDoctrine: profiles,
      threatAssessment,
      counterPlan,
    });
  } catch (error) {
    console.error('Counter-plan generation failed:', error);
    res.status(500).json({ error: 'Failed to generate counter-plan' });
  }
});

/**
 * GET /api/enemy/doctrine
 * Returns the full simulated ODIN doctrine database (for UI reference/browsing).
 */
router.get('/doctrine', (_req: Request, res: Response) => {
  res.json({ doctrineProfiles });
});

export default router;
