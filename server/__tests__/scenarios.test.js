import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveScenario,
  duplicateScenario,
  getScenario,
  listScenarioVersions,
  listScenarios,
  resetTacticalStore,
  restoreScenarioVersion,
  saveScenario,
  updateScenario,
} from '../services/tacticalService.js';

describe('scenario management service', () => {
  beforeEach(resetTacticalStore);

  it('creates searchable scenarios and records a version for every save', () => {
    const scenario = saveScenario({ id: 'alpha', name: 'Alpha', missionType: 'Defense', tags: 'training, north' });
    updateScenario('alpha', { description: 'Updated plan' });

    expect(listScenarios({ search: 'north' })).toHaveLength(1);
    expect(getScenario('alpha').description).toBe('Updated plan');
    expect(listScenarioVersions('alpha')).toHaveLength(2);
    expect(scenario.status).toBe('Active');
  });

  it('duplicates, archives, and restores a historical scenario state', () => {
    saveScenario({ id: 'alpha', name: 'Alpha', description: 'Original' });
    updateScenario('alpha', { description: 'Changed' });
    const original = listScenarioVersions('alpha').find((version) => version.snapshot.description === 'Original');

    const copy = duplicateScenario('alpha');
    archiveScenario(copy.id);
    restoreScenarioVersion('alpha', original.id);

    expect(getScenario(copy.id).status).toBe('Archived');
    expect(getScenario('alpha').description).toBe('Original');
  });
});
