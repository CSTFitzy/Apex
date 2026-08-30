import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import COAAnalysisPanel from '../components/COAAnalysisPanel.jsx';

describe('COAAnalysisPanel', () => {
  it('renders COA comparison, counter-move estimates, and OPORD preview', () => {
    const markup = renderToStaticMarkup(
      <COAAnalysisPanel
        scenarioId="alpha"
        units={[
          { id: 'friendly-1', name: 'Squad 1-1', affiliation: 'friendly', type: 'infantry' },
          { id: 'enemy-1', name: 'Enemy Platoon', affiliation: 'enemy', type: 'armor' },
        ]}
        documents={[{ id: 'doc-1', filename: 'enemy.txt', preview: { text: 'Enemy objective' } }]}
        coas={[
          {
            id: 'coa-1',
            name: 'Frontal Assault',
            probability: 65,
            timeline: '2-4 hours',
            riskAssessment: 'HIGH',
            mostLikely: true,
            phases: [{ name: 'Phase I', objective: 'Advance to contact' }],
            keyTerrain: ['ridge line'],
            vulnerabilities: ['exposed flank'],
          },
        ]}
        selectedCOAId="coa-1"
        counterPlan={{
          unitRecommendations: [
            {
              unitId: 'friendly-1',
              unitName: 'Squad 1-1',
              primaryTask: 'DEFEND key terrain',
              movementTimeline: 'Phase I',
              fireSupport: 'Artillery on-call',
              supplyRequirements: { ammunitionRounds: 500, fuelGallons: 50 },
              combatEffectiveness: '75% after contact',
              riskLevel: 'HIGH',
            },
          ],
          supplyRequirements: { ammunitionRounds: 500, fuelGallons: 50, medicalKits: 2 },
          casualtyEstimate: { friendly: { total: 4 }, enemy: { total: 8 } },
          successProbability: 72,
        }}
        opord={{ opord: 'OPORD: Alpha' }}
      />
    );

    expect(markup).toContain('Enemy COA Analysis');
    expect(markup).toContain('Most Likely');
    expect(markup).toContain('COA Comparison');
    expect(markup).toContain('Counter-Move Recommendations');
    expect(markup).toContain('Total Ammo Required: 500 rounds');
    expect(markup).toContain('OPORD: Alpha');
  });
});
