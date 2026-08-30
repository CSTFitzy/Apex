import React, { useEffect, useState } from 'react';
import api from '../utils/api.js';

export default function ScenarioLibrary() {
  const [scenarios, setScenarios] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  const [missionType, setMissionType] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setScenarios((await api.listScenarios({ search, ...(status ? { status } : {}) })).scenarios || []);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [search, status]);

  const create = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createScenario({ name: name.trim(), missionType });
      setName('');
      setMissionType('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const archive = async (id) => {
    try {
      await api.archiveScenario(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="scenario-library">
      <h2>Scenario Library</h2>
      <form onSubmit={create}>
        <input aria-label="Scenario name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Scenario name" />
        <select aria-label="Mission type" value={missionType} onChange={(event) => setMissionType(event.target.value)}>
          <option value="">Mission type</option><option>Defense</option><option>Offense</option><option>Patrol</option>
        </select>
        <button type="submit">New Scenario</button>
      </form>
      <input aria-label="Search scenarios" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or tags" />
      <select aria-label="Scenario filter" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">Active and archived</option><option value="Active">Active</option><option value="Archived">Archived</option>
      </select>
      {error && <p role="alert">{error}</p>}
      <ul>
        {scenarios.map((scenario) => (
          <li key={scenario.id}>
            <strong>{scenario.name}</strong> {scenario.missionType && `— ${scenario.missionType}`} <small>{scenario.status}</small>
            {scenario.status === 'Active' && <button type="button" onClick={() => archive(scenario.id)}>Archive</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
