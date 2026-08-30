import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDocument,
  exportMarkupGeoJson,
  listDocuments,
  listMarkupSets,
  listUnits,
  resetTacticalStore,
  saveMarkupSet,
  saveUnits,
  searchDocuments,
  validateUnitPayload,
} from '../services/tacticalService.js';
import { buildPreview, isAllowedDocumentType } from '../services/documentParser.js';

describe('phase 2 tactical services', () => {
  beforeEach(() => {
    resetTacticalStore();
  });

  it('validates and stores NATO unit dispositions by scenario', () => {
    const [unit] = saveUnits({
      scenarioId: 'alpha',
      name: '1 Section',
      type: 'infantry',
      affiliation: 'friendly',
      hierarchy: 'section',
      position: { latitude: 51.5, longitude: -0.1 },
      strength: 8,
      readiness: 'degraded',
    });

    expect(unit.id).toBeTruthy();
    expect(listUnits('alpha')).toHaveLength(1);
    expect(listUnits('bravo')).toHaveLength(0);
    expect(unit.supply).toMatchObject({ ammo: 100, fuel: 100, medical: 100 });
  });

  it('rejects unsupported unit types before they reach the map', () => {
    expect(() =>
      validateUnitPayload({
        name: 'Invalid',
        type: 'cavalry',
        affiliation: 'friendly',
        hierarchy: 'squad',
        latitude: 0,
        longitude: 0,
      })
    ).toThrow(/Invalid unit type/);
  });

  it('stores timestamped markup sets and exports GeoJSON', () => {
    const markupSet = saveMarkupSet({
      scenarioId: 'alpha',
      name: 'Enemy plan',
      layers: [{ id: 'enemy-plan', name: 'Enemy Plan', visible: true }],
      markups: [
        {
          id: 'm1',
          layerId: 'enemy-plan',
          label: 'Axis',
          style: { color: '#ff0000', weight: 3 },
          geometry: { type: 'LineString', coordinates: [[0, 51], [1, 52]] },
        },
      ],
    });

    expect(listMarkupSets('alpha')[0]).toEqual(markupSet);
    expect(exportMarkupGeoJson('alpha')).toMatchObject({
      type: 'FeatureCollection',
      features: [{ geometry: { type: 'LineString' }, properties: { label: 'Axis' } }],
    });
  });

  it('extracts and searches uploaded text documents with tags', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'apex-docs-'));
    const filePath = path.join(dir, 'enemy.txt');
    await writeFile(filePath, 'Enemy armored platoon intends to seize Objective Falcon before dawn.');

    try {
      const document = await addDocument({
        scenarioId: 'alpha',
        tags: 'Enemy Disposition, Intel',
        uploadedBy: 'tester',
        file: {
          originalname: 'enemy.txt',
          mimetype: 'text/plain',
          path: filePath,
          size: 68,
        },
      });

      expect(document.extractedText).toMatch(/Objective Falcon/);
      expect(listDocuments('alpha')[0].preview.text).toMatch(/Enemy armored/);
      expect(searchDocuments({ query: 'falcon', scenarioId: 'alpha' })[0]).toMatchObject({
        id: document.id,
        filename: 'enemy.txt',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('identifies supported upload types and trims previews to 500 characters', () => {
    expect(isAllowedDocumentType('orders.pdf', 'application/pdf')).toBe(true);
    expect(isAllowedDocumentType('archive.zip', 'application/zip')).toBe(false);
    const preview = buildPreview('x'.repeat(600), 'txt');
    expect(preview.text).toHaveLength(500);
    expect(preview.truncated).toBe(true);
  });
});
