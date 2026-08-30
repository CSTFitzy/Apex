import React, { useEffect, useMemo, useState } from 'react';
import api from '../utils/api.js';

const sampleOperation = {
  name: 'Operation Review',
  objective: 'Secure and report assigned area',
  commander: 'Commander',
  units: [{ name: 'Alpha', type: 'Reconnaissance', assigned: 12, casualties: 0, objectivesAssigned: 2, objectivesCompleted: 2, engagements: 3, successfulEngagements: 2 }],
  events: [{ timestamp: new Date().toISOString(), type: 'report', description: 'Initial reconnaissance report received.', unitId: 'unit-1' }],
};

export default function AARPanel() {
  const [operation, setOperation] = useState(sampleOperation);
  const [review, setReview] = useState(null);
  const [frames, setFrames] = useState([]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState(null);

  useEffect(() => {
    if (!playing || !frames.length) return undefined;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % frames.length), 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, frames.length]);

  const currentFrame = useMemo(() => frames[frame], [frames, frame]);
  const createReview = async () => {
    setError('');
    try {
      const { operation: saved } = await api.post('/aar/operations', operation);
      const [{ review: nextReview }, { frames: nextFrames }] = await Promise.all([
        api.post(`/aar/operations/${saved.id}/review`, {}),
        api.get(`/aar/operations/${saved.id}/replay`),
      ]);
      setReview({ ...nextReview, id: saved.id });
      setFrames(nextFrames);
      setFrame(0);
      setScenario(null);
    } catch (err) {
      setError(err.message);
    }
  };
  const download = async (format) => {
    try {
      const token = localStorage.getItem('sharknet_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/aar/operations/${review.id}/export/${format}`, {
        headers: token ? { Authorization: ['Bearer', token].join(' ') } : {},
      });
      if (!response.ok) throw new Error('Report export failed');
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement('a'), { href: url, download: `after-action-review.${format}` });
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };
  const generateScenario = async () => {
    try {
      const data = await api.post(`/aar/operations/${review.id}/training-scenario`, {});
      setScenario(data.scenario);
    } catch (err) { setError(err.message); }
  };

  return <section className="aar-panel">
    <h2>After-Action Review</h2>
    <div className="aar-form">
      <input aria-label="Operation name" value={operation.name} onChange={(event) => setOperation({ ...operation, name: event.target.value })} />
      <input aria-label="Commander" value={operation.commander} onChange={(event) => setOperation({ ...operation, commander: event.target.value })} />
      <button onClick={createReview}>Generate review</button>
    </div>
    {error && <p className="aar-error">{error}</p>}
    {review && <div className="aar-results">
      <div className="aar-score"><strong>Commander score</strong><span>{review.analytics.commanderScore}/100</span></div>
      <div className="aar-replay">
        <h3>Tactical replay</h3>
        <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <label>Speed <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <input aria-label="Replay position" type="range" min="0" max={Math.max(0, frames.length - 1)} value={frame} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} />
        <p>{currentFrame ? `${currentFrame.type}: ${currentFrame.description}` : 'No recorded events.'}</p>
      </div>
      <h3>Unit performance</h3>
      <div className="aar-table">{review.analytics.unitPerformance.map((unit) => <div key={unit.id}><strong>{unit.name}</strong><span>Score {unit.score} · Objectives {unit.objectiveRate}% · Engagements {unit.engagementRate}%</span></div>)}</div>
      <h3>Lessons learned</h3>
      <ul>{review.lessons.map((lesson) => <li key={lesson.category}><strong>{lesson.category}:</strong> {lesson.lesson}</li>)}</ul>
      <h3>Threat analysis</h3><p>{review.threatAnalysis.summary}</p>
      <div className="aar-actions"><button onClick={() => download('json')}>JSON</button><button onClick={() => download('csv')}>CSV</button><button onClick={() => download('html')}>HTML</button><button onClick={generateScenario}>Create training scenario</button></div>
      {scenario && <div className="aar-scenario"><strong>{scenario.title}</strong><p>{scenario.objective}</p><p>Focus: {scenario.focusAreas.join(', ')}</p></div>}
    </div>}
  </section>;
}
