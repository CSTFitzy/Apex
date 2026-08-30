import React, { useState } from 'react';

export const DEFAULT_LAYERS = [
  { id: 'terrain', name: 'Terrain', visible: true },
  { id: 'enemy-plan', name: 'Enemy Plan', visible: true },
  { id: 'friendly-plan', name: 'Friendly Plan', visible: true },
  { id: 'objectives', name: 'Objectives', visible: true },
];

const TOOLS = ['select', 'line', 'circle', 'polygon', 'point', 'text', 'sketch'];

export default function MarkupTools({
  activeTool,
  layers,
  activeLayerId,
  style,
  draftPointCount = 0,
  onToolChange,
  onLayerChange,
  onLayersChange,
  onStyleChange,
  onFinishDrawing,
  onClear,
  onSave,
  onExport,
}) {
  const [newLayerName, setNewLayerName] = useState('');

  function addLayer() {
    const name = newLayerName.trim();
    if (!name) return;
    const layer = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, visible: true };
    onLayersChange?.([...layers, layer]);
    onLayerChange?.(layer.id);
    setNewLayerName('');
  }

  function updateLayer(id, patch) {
    onLayersChange?.(layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  return (
    <section className="markup-tools">
      <header>
        <h3>Markup Tools</h3>
        <button type="button" onClick={onSave}>
          Save
        </button>
        <button type="button" onClick={onExport}>
          GeoJSON
        </button>
        <button type="button" className="danger-button" onClick={onClear}>
          Clear
        </button>
      </header>
      <div className="markup-toolbar">
        {TOOLS.map((tool) => (
          <button
            key={tool}
            type="button"
            className={activeTool === tool ? 'tool-active' : ''}
            onClick={() => onToolChange?.(tool)}
          >
            {tool}
          </button>
        ))}
        {draftPointCount > 0 && (
          <button type="button" onClick={onFinishDrawing}>
            Finish ({draftPointCount})
          </button>
        )}
      </div>
      <div className="tactical-form-row">
        <label>
          Active layer
          <select value={activeLayerId} onChange={(event) => onLayerChange?.(event.target.value)}>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Color
          <input
            type="color"
            value={style.color}
            onChange={(event) => onStyleChange?.({ ...style, color: event.target.value })}
          />
        </label>
        <label>
          Width
          <input
            min="1"
            max="10"
            type="number"
            value={style.weight}
            onChange={(event) => onStyleChange?.({ ...style, weight: Number(event.target.value) })}
          />
        </label>
      </div>
      <details>
        <summary>Layer Manager</summary>
        <ul className="layer-list">
          {layers.map((layer) => (
            <li key={layer.id}>
              <input
                aria-label={`Toggle ${layer.name}`}
                type="checkbox"
                checked={layer.visible}
                onChange={(event) => updateLayer(layer.id, { visible: event.target.checked })}
              />
              <input value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />
              <button
                type="button"
                className="danger-button"
                onClick={() => onLayersChange?.(layers.filter((candidate) => candidate.id !== layer.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="layer-add">
          <input
            placeholder="New layer"
            value={newLayerName}
            onChange={(event) => setNewLayerName(event.target.value)}
          />
          <button type="button" onClick={addLayer}>
            Add
          </button>
        </div>
      </details>
    </section>
  );
}
