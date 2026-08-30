import React, { useMemo, useState } from 'react';
import { UnitSymbolPreview } from './UnitSymbols.jsx';

export default function UnitsPanel({ units = [], selectedUnitId, onSelect, onUpdate, onDelete }) {
  const [filter, setFilter] = useState({ affiliation: 'all', type: 'all' });

  const filtered = useMemo(
    () =>
      units.filter(
        (unit) =>
          (filter.affiliation === 'all' || unit.affiliation === filter.affiliation) &&
          (filter.type === 'all' || unit.type === filter.type)
      ),
    [filter, units]
  );
  const selected = units.find((unit) => unit.id === selectedUnitId);

  function updateSelected(field, value) {
    if (!selected) return;
    onUpdate?.({ ...selected, [field]: value });
  }

  return (
    <section className="units-panel">
      <header>
        <h3>Units Panel</h3>
        <span>{units.length} placed</span>
      </header>
      <div className="tactical-form-row">
        <label>
          Affiliation
          <select
            value={filter.affiliation}
            onChange={(event) => setFilter((current) => ({ ...current, affiliation: event.target.value }))}
          >
            <option value="all">All</option>
            <option value="friendly">Friendly</option>
            <option value="enemy">Enemy</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label>
          Type
          <select
            value={filter.type}
            onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value }))}
          >
            <option value="all">All</option>
            <option value="infantry">Infantry</option>
            <option value="armor">Armor</option>
            <option value="artillery">Artillery</option>
            <option value="air">Air</option>
            <option value="naval">Naval</option>
            <option value="support">Support</option>
          </select>
        </label>
      </div>
      <ul className="unit-list">
        {filtered.map((unit) => (
          <li key={unit.id} className={`unit-list-item unit-${unit.affiliation}`}>
            <button type="button" onClick={() => onSelect?.(unit.id)}>
              <UnitSymbolPreview type={unit.type} affiliation={unit.affiliation} size={28} />
              <span>
                <strong>{unit.name}</strong>
                <small>
                  {unit.affiliation} {unit.hierarchy} / {unit.type}
                </small>
              </span>
            </button>
            <button type="button" className="danger-button" onClick={() => onDelete?.(unit.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="unit-info-panel">
          <h4>Unit Info</h4>
          <label>
            Name
            <input value={selected.name} onChange={(event) => updateSelected('name', event.target.value)} />
          </label>
          <label>
            Strength
            <input
              type="number"
              min="0"
              value={selected.strength}
              onChange={(event) => updateSelected('strength', Number(event.target.value))}
            />
          </label>
          <label>
            Readiness
            <select value={selected.readiness} onChange={(event) => updateSelected('readiness', event.target.value)}>
              <option value="full">Full</option>
              <option value="degraded">Degraded</option>
              <option value="combat ineffective">Combat ineffective</option>
            </select>
          </label>
          <div className="supply-status-grid">
            {['ammo', 'fuel', 'medical'].map((key) => (
              <label key={key}>
                {key}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={selected.supply?.[key] ?? 0}
                  onChange={(event) =>
                    onUpdate?.({
                      ...selected,
                      supply: { ...selected.supply, [key]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
