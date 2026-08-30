import { beforeEach, describe, expect, it } from 'vitest';
import {
  getScenario,
  resetTacticalStore,
  saveScenario,
  saveUnits,
} from '../services/tacticalService.js';
import {
  analyzeEnemyCoas,
  generateOpord,
  recommendCounterMoves,
} from '../services/tacticalPlanningService.js';

const friendlyUnit = {
  id: 'friendly-1',
  name: 'Squad 1-1',
  type: 'infantry',
  affiliation: 'friendly',
  hierarchy: 'squad',
  position: { latitude: 51.5, longitude: -0.1 },
  strength: 9,
  readiness: 'full',
};

const enemyUnit = {
  id: 'enemy-1',
  name: 'Enemy Platoon',
  type: 'armor',
  affiliation: 'enemy',
  hierarchy: 'platoon',
  position: { latitude: 51.48, longitude: -0.12 },
  strength: 24,
  readiness: 'full',
};

describe('phase 3 tactical planning services', () => {
  beforeEach(() => {
    resetTacticalStore();
  });

  it('generates structured enemy COAs from documents and map units', async () => {
    const result = await analyzeEnemyCoas({
      documents: [{ filename: 'enemy.txt', text: 'Enemy armored force intends to seize Objective Falcon before dawn.' }],
      enemyUnits: [enemyUnit],
      friendlyUnits: [friendlyUnit],
      terrain: { classification: 'mixed urban terrain' },
      weather: { current: { visibility: 'good', windSpeed: 12 } },
    });

    expect(result.coas).toHaveLength(3);
    expect(result.coas[0]).toMatchObject({
      name: expect.stringContaining('Armored'),
      timeline: expect.any(String),
      riskAssessment: expect.any(String),
      mostLikely: true,
    });
    expect(result.coas[0].phases).toHaveLength(3);
    expect(result.coas[0].visualization.paths[0].points.length).toBeGreaterThan(1);
  });

  it('rejects COA analysis without documents or enemy units', async () => {
    await expect(analyzeEnemyCoas({ documents: [], enemyUnits: [enemyUnit] })).rejects.toThrow(/document/);
    await expect(analyzeEnemyCoas({ documents: [{ text: 'intel' }], enemyUnits: [] })).rejects.toThrow(/enemy unit/);
  });

  it('recommends friendly counter-moves with casualty and logistics estimates', async () => {
    const { coas } = await analyzeEnemyCoas({
      documents: [{ filename: 'enemy.txt', text: 'Enemy will flank the objective.' }],
      enemyUnits: [enemyUnit],
      friendlyUnits: [friendlyUnit],
    });

    const counterPlan = await recommendCounterMoves({
      selectedCOA: coas[0],
      friendlyUnits: [friendlyUnit],
      enemyUnits: [enemyUnit],
      terrain: { classification: 'restricted terrain' },
    });

    expect(counterPlan.unitRecommendations[0]).toMatchObject({
      unitName: 'Squad 1-1',
      primaryTask: expect.any(String),
      fireSupport: expect.any(String),
    });
    expect(counterPlan.supplyRequirements.ammunitionRounds).toBeGreaterThan(0);
    expect(counterPlan.casualtyEstimate.friendly.total).toBeGreaterThanOrEqual(0);
    expect(counterPlan.scenarioOptions).toHaveLength(3);
  });

  it('generates an OPORD and saves a complete scenario', async () => {
    saveUnits({ scenarioId: 'alpha', units: [friendlyUnit, enemyUnit] });
    const { coas } = await analyzeEnemyCoas({
      documents: [{ filename: 'enemy.txt', text: 'Enemy intends to seize Objective Falcon.' }],
      enemyUnits: [enemyUnit],
      friendlyUnits: [friendlyUnit],
    });
    const counterPlan = await recommendCounterMoves({
      selectedCOA: coas[0],
      friendlyUnits: [friendlyUnit],
      enemyUnits: [enemyUnit],
    });
    const opord = await generateOpord({
      counterPlan,
      enemyCOA: coas[0],
      scenarioName: 'Alpha',
      friendlyUnits: [friendlyUnit],
      enemyUnits: [enemyUnit],
    });

    const scenario = saveScenario({
      id: 'alpha',
      name: 'Alpha',
      coas,
      selectedCOAId: coas[0].id,
      counterPlan,
      opord,
    });

    expect(opord.opord).toMatch(/OPORD: Alpha/);
    expect(scenario.units).toHaveLength(2);
    expect(getScenario('alpha')).toMatchObject({ name: 'Alpha', selectedCOAId: coas[0].id });
  });
});
