import React, { useMemo, useState } from 'react';
import api from '../utils/api.js';

function riskClass(risk) {
  return `risk-${String(risk || 'medium').toLowerCase()}`;
}

export default function COAAnalysisPanel({
  scenarioId = 'default',
  units = [],
  documents = [],
  terrain = null,
  weather = null,
  coas = [],
  selectedCOAId,
  counterPlan = null,
  opord = null,
  onCoasChange,
  onSelectedCOAChange,
  onCounterPlanChange,
  onOpordChange,
  onOverlayChange,
}) {
  const [status, setStatus] = useState('');
  const [visibleCoaIds, setVisibleCoaIds] = useState(new Set());
  const [analysisText, setAnalysisText] = useState('');
  const [recommendationsText, setRecommendationsText] = useState('');

  const enemyUnits = useMemo(() => units.filter((unit) => unit.affiliation === 'enemy'), [units]);
  const friendlyUnits = useMemo(() => units.filter((unit) => unit.affiliation === 'friendly'), [units]);
  const selectedCOA = coas.find((coa) => coa.id === selectedCOAId) || coas[0];

  function updateVisibility(nextIds, nextCoas = coas) {
    setVisibleCoaIds(nextIds);
    onOverlayChange?.(nextCoas.map((coa) => ({ ...coa, visible: nextIds.has(coa.id) })));
  }

  async function analyzeCoas() {
    if (!documents.length) {
      setStatus('Upload at least one enemy document before analyzing COAs.');
      return;
    }
    if (!enemyUnits.length) {
      setStatus('Place at least one enemy unit on the map before analyzing COAs.');
      return;
    }

    setStatus('Analyzing enemy COAs...');
    try {
      const result = await api.analyzeEnemyCoas({
        scenarioId,
        documents: documents.map((document) => ({
          filename: document.filename,
          text: document.preview?.text || document.text || '',
        })),
        enemyUnits,
        friendlyUnits,
        terrain,
        weather,
      });
      const nextCoas = result.coas || [];
      const nextSelected = nextCoas.find((coa) => coa.mostLikely) || nextCoas[0] || null;
      const nextVisible = new Set(nextSelected ? [nextSelected.id] : nextCoas.map((coa) => coa.id));
      onCoasChange?.(nextCoas);
      onSelectedCOAChange?.(nextSelected?.id || null);
      setAnalysisText(result.analysis || '');
      setRecommendationsText(result.recommendations || '');
      updateVisibility(nextVisible, nextCoas);
      setStatus(`Generated ${nextCoas.length} enemy COA options.`);
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function generateCounterPlan() {
    if (!selectedCOA) {
      setStatus('Select an enemy COA before generating counter-moves.');
      return;
    }
    if (!friendlyUnits.length) {
      setStatus('Place at least one friendly unit before generating counter-moves.');
      return;
    }

    setStatus('Generating counter-move recommendations...');
    try {
      const result = await api.recommendCounterMoves({
        scenarioId,
        selectedCOA,
        friendlyUnits,
        enemyUnits,
        terrain,
      });
      onCounterPlanChange?.(result);
      setStatus('Counter-move recommendations generated.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function generateOpord() {
    if (!counterPlan || !selectedCOA) {
      setStatus('Generate counter-moves before creating an OPORD.');
      return;
    }

    setStatus('Generating OPORD...');
    try {
      const result = await api.generateOpord({
        counterPlan,
        enemyCOA: selectedCOA,
        scenarioName: scenarioId,
        friendlyUnits,
        enemyUnits,
      });
      onOpordChange?.(result);
      setStatus('OPORD generated.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function saveScenario() {
    setStatus('Saving scenario...');
    try {
      await api.saveTacticalScenario({
        id: scenarioId,
        name: scenarioId,
        units,
        documents,
        coas,
        selectedCOAId: selectedCOA?.id,
        counterPlan,
        opord,
        casualtyEstimate: counterPlan?.casualtyEstimate,
        logisticsEstimate: counterPlan?.supplyRequirements,
        riskAssessment: selectedCOA?.riskAssessment,
      });
      setStatus('Scenario saved with COAs, counter-plan, OPORD, casualties, logistics, and risk.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  function selectCoa(coa) {
    onSelectedCOAChange?.(coa.id);
    updateVisibility(new Set([coa.id]));
  }

  function toggleCoa(coa) {
    const next = new Set(visibleCoaIds);
    if (next.has(coa.id)) next.delete(coa.id);
    else next.add(coa.id);
    updateVisibility(next);
  }

  return (
    <section className="coa-panel">
      <header className="coa-panel-header">
        <div>
          <h3>Enemy COA Analysis</h3>
          <small>
            {documents.length} document(s) · {enemyUnits.length} enemy · {friendlyUnits.length} friendly
          </small>
        </div>
        <button type="button" onClick={analyzeCoas} disabled={!documents.length || !enemyUnits.length}>
          Analyze Enemy COAs
        </button>
      </header>

      {status && <p className="coa-status">{status}</p>}
      {analysisText && <p className="coa-summary">{analysisText}</p>}

      <div className="coa-card-grid">
        {coas.map((coa) => (
          <article key={coa.id} className={`coa-card ${selectedCOA?.id === coa.id ? 'coa-card-selected' : ''}`}>
            <header>
              <label className="coa-toggle">
                <input type="checkbox" checked={visibleCoaIds.has(coa.id)} onChange={() => toggleCoa(coa)} />
                Show
              </label>
              {coa.mostLikely && <span className="coa-badge">Most Likely</span>}
            </header>
            <button type="button" className="coa-select-button" onClick={() => selectCoa(coa)}>
              <strong>{coa.name || coa.title}</strong>
              <span>{coa.probability}% likely · {coa.timeline}</span>
              <span className={riskClass(coa.riskAssessment)}>{coa.riskAssessment} threat</span>
            </button>
            <details>
              <summary>Phases and vulnerabilities</summary>
              <ul>
                {(coa.phases || []).map((phase) => (
                  <li key={phase.name}>
                    <strong>{phase.name}:</strong> {phase.objective}
                  </li>
                ))}
              </ul>
              <p><strong>Terrain:</strong> {(coa.keyTerrain || []).join(', ') || 'Not specified'}</p>
              <p><strong>Vulnerabilities:</strong> {(coa.vulnerabilities || []).join(', ') || 'Not specified'}</p>
            </details>
          </article>
        ))}
      </div>

      {coas.length > 0 && (
        <div className="coa-comparison">
          <h4>COA Comparison</h4>
          <table>
            <thead>
              <tr>
                <th>COA</th>
                <th>Probability</th>
                <th>Timeline</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {coas.map((coa) => (
                <tr key={coa.id}>
                  <td>{coa.name || coa.title}</td>
                  <td>{coa.probability}%</td>
                  <td>{coa.timeline}</td>
                  <td className={riskClass(coa.riskAssessment)}>{coa.riskAssessment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="coa-actions">
        <button type="button" onClick={generateCounterPlan} disabled={!selectedCOA}>
          Recommend Counter-Moves
        </button>
        <button type="button" onClick={generateOpord} disabled={!counterPlan || !selectedCOA}>
          Generate OPORD
        </button>
        <button type="button" onClick={saveScenario}>
          Save Scenario
        </button>
      </div>

      {recommendationsText && <p className="coa-summary">{recommendationsText}</p>}

      {counterPlan && (
        <section className="counter-plan">
          <h4>Counter-Move Recommendations</h4>
          {(counterPlan.unitRecommendations || []).map((recommendation) => (
            <article key={recommendation.unitId} className="counter-unit-card">
              <strong>{recommendation.unitName}</strong>
              <ul>
                <li>Task: {recommendation.primaryTask}</li>
                <li>When: {recommendation.movementTimeline}</li>
                <li>Fire Support: {recommendation.fireSupport}</li>
                <li>Supply: {recommendation.supplyRequirements?.ammunitionRounds} rds, {recommendation.supplyRequirements?.fuelGallons} gal fuel</li>
                <li>Combat Effectiveness: {recommendation.combatEffectiveness}</li>
                <li className={riskClass(recommendation.riskLevel)}>Risk: {recommendation.riskLevel}</li>
              </ul>
            </article>
          ))}

          <div className="coa-estimates">
            <h4>Logistics & Casualty Estimates</h4>
            <p>Total Ammo Required: {counterPlan.supplyRequirements?.ammunitionRounds} rounds</p>
            <p>Total Fuel Required: {counterPlan.supplyRequirements?.fuelGallons} gallons</p>
            <p>Medical Supplies: {counterPlan.supplyRequirements?.medicalKits} kits</p>
            <p>Expected Friendly Casualties: {counterPlan.casualtyEstimate?.friendly?.total} personnel</p>
            <p>Expected Enemy Casualties: {counterPlan.casualtyEstimate?.enemy?.total} personnel</p>
            <p>Overall Success Probability: {counterPlan.successProbability}%</p>
          </div>
        </section>
      )}

      {opord && (
        <section className="opord-preview">
          <h4>Generated OPORD</h4>
          <pre>{opord.opord}</pre>
        </section>
      )}
    </section>
  );
}
