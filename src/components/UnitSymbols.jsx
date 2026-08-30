import React, { useMemo, useState } from 'react';
import ms from 'milsymbol';

export const UNIT_TYPES = ['infantry', 'armor', 'artillery', 'air', 'naval', 'support'];
export const AFFILIATIONS = ['friendly', 'enemy', 'neutral'];
export const HIERARCHIES = ['individual', 'section', 'squad', 'platoon'];

export function sidcForUnit(type, affiliation) {
  const affiliationCode = affiliation === 'enemy' ? '6' : affiliation === 'neutral' ? '4' : '3';
  const functionCode =
    {
      infantry: '121100',
      armor: '120500',
      artillery: '130300',
      air: '110100',
      naval: '140100',
      support: '150000',
    }[type] || '121100';
  return `100${affiliationCode}1000${functionCode}000000`;
}

export function UnitSymbolPreview({ type = 'infantry', affiliation = 'friendly', size = 34 }) {
  const svg = useMemo(() => {
    try {
      return new ms.Symbol(sidcForUnit(type, affiliation), { size }).asSVG();
    } catch {
      return '';
    }
  }, [type, affiliation, size]);

  if (!svg) {
    return <span className={`unit-symbol-fallback unit-${affiliation}`}>{type.slice(0, 3).toUpperCase()}</span>;
  }

  return <span className="unit-symbol-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function UnitSymbols({ selectedTemplate, onTemplateChange, onPlacementMode }) {
  const [template, setTemplate] = useState(
    selectedTemplate || {
      name: 'Squad 1-1',
      type: 'infantry',
      affiliation: 'friendly',
      hierarchy: 'squad',
      strength: 9,
      readiness: 'full',
      supply: { ammo: 100, fuel: 100, medical: 100 },
    }
  );

  function update(field, value) {
    const next = { ...template, [field]: value };
    setTemplate(next);
    onTemplateChange?.(next);
  }

  return (
    <section className="unit-symbol-picker">
      <header>
        <h3>NATO Unit Picker</h3>
        <UnitSymbolPreview type={template.type} affiliation={template.affiliation} />
      </header>
      <label>
        Unit name
        <input value={template.name} onChange={(event) => update('name', event.target.value)} />
      </label>
      <div className="tactical-form-row">
        <label>
          Affiliation
          <select value={template.affiliation} onChange={(event) => update('affiliation', event.target.value)}>
            {AFFILIATIONS.map((affiliation) => (
              <option key={affiliation} value={affiliation}>
                {affiliation}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hierarchy
          <select value={template.hierarchy} onChange={(event) => update('hierarchy', event.target.value)}>
            {HIERARCHIES.map((hierarchy) => (
              <option key={hierarchy} value={hierarchy}>
                {hierarchy}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Equipment type
        <select value={template.type} onChange={(event) => update('type', event.target.value)}>
          {UNIT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Personnel strength
        <input
          min="0"
          type="number"
          value={template.strength}
          onChange={(event) => update('strength', Number(event.target.value))}
        />
      </label>
      <label>
        Readiness
        <select value={template.readiness} onChange={(event) => update('readiness', event.target.value)}>
          <option value="full">Full</option>
          <option value="degraded">Degraded</option>
          <option value="combat ineffective">Combat ineffective</option>
        </select>
      </label>
      <button type="button" onClick={() => onPlacementMode?.({ ...template })}>
        Place unit on map
      </button>
    </section>
  );
}
