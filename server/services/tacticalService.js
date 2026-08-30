import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { buildPreview, extractTextFromDocument, normalizeFileType } from './documentParser.js';

export const UNIT_TYPES = ['infantry', 'armor', 'artillery', 'air', 'naval', 'support'];
export const AFFILIATIONS = ['friendly', 'enemy', 'neutral'];
export const HIERARCHIES = ['individual', 'section', 'squad', 'platoon'];
export const READINESS = ['full', 'degraded', 'combat ineffective'];

const units = new Map();
const markupVersions = new Map();
const documents = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeScenarioId(scenarioId) {
  return String(scenarioId || 'default');
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      // Fall through to comma-separated tag parsing.
    }
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizePosition(input) {
  const latitude = Number(input.position?.latitude ?? input.latitude);
  const longitude = Number(input.position?.longitude ?? input.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('Invalid unit latitude');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid unit longitude');
  }
  return { latitude, longitude };
}

export function validateUnitPayload(input) {
  const type = String(input.type || input.equipmentType || '').toLowerCase();
  const affiliation = String(input.affiliation || '').toLowerCase();
  const hierarchy = String(input.hierarchy || '').toLowerCase();
  const readiness = String(input.readiness || 'full').toLowerCase();

  if (!input.name) throw new Error('Unit name is required');
  if (!UNIT_TYPES.includes(type)) {
    throw new Error(`Invalid unit type. Expected one of: ${UNIT_TYPES.join(', ')}`);
  }
  if (!AFFILIATIONS.includes(affiliation)) {
    throw new Error(`Invalid affiliation. Expected one of: ${AFFILIATIONS.join(', ')}`);
  }
  if (!HIERARCHIES.includes(hierarchy)) {
    throw new Error(`Invalid hierarchy. Expected one of: ${HIERARCHIES.join(', ')}`);
  }
  if (!READINESS.includes(readiness)) {
    throw new Error(`Invalid readiness. Expected one of: ${READINESS.join(', ')}`);
  }

  return { type, affiliation, hierarchy, readiness, position: normalizePosition(input) };
}

function normalizeUnit(input) {
  const { type, affiliation, hierarchy, readiness, position } = validateUnitPayload(input);
  const timestamp = nowIso();
  const existing = input.id ? units.get(String(input.id)) : null;
  return {
    id: existing?.id || String(input.id || uuidv4()),
    scenarioId: normalizeScenarioId(input.scenarioId),
    name: String(input.name).trim(),
    type,
    affiliation,
    hierarchy,
    equipmentType: String(input.equipmentType || type),
    position,
    strength: Number.isFinite(Number(input.strength)) ? Number(input.strength) : 0,
    readiness,
    supply: {
      ammo: Number(input.supply?.ammo ?? input.ammo ?? 100),
      fuel: Number(input.supply?.fuel ?? input.fuel ?? 100),
      medical: Number(input.supply?.medical ?? input.medical ?? 100),
    },
    status: input.status || 'active',
    notes: input.notes || '',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export function saveUnits(payload) {
  const incoming = Array.isArray(payload.units) ? payload.units : [payload];
  const saved = incoming.map((unitInput) => {
    const unit = normalizeUnit({ ...unitInput, scenarioId: unitInput.scenarioId ?? payload.scenarioId });
    units.set(unit.id, unit);
    return unit;
  });
  return saved;
}

export function listUnits(scenarioId = 'default') {
  const normalized = normalizeScenarioId(scenarioId);
  return [...units.values()].filter((unit) => unit.scenarioId === normalized);
}

export function removeUnit(id) {
  return units.delete(String(id));
}

export function saveMarkupSet(payload) {
  if (!payload.scenarioId) throw new Error('scenarioId is required');
  const timestamp = nowIso();
  const scenarioId = normalizeScenarioId(payload.scenarioId);
  const set = {
    id: uuidv4(),
    scenarioId,
    name: payload.name || `Markup ${timestamp}`,
    layers: Array.isArray(payload.layers) ? payload.layers : [],
    markups: Array.isArray(payload.markups) ? payload.markups : [],
    createdAt: timestamp,
  };
  const existing = markupVersions.get(scenarioId) || [];
  markupVersions.set(scenarioId, [set, ...existing]);
  return set;
}

export function listMarkupSets(scenarioId) {
  return markupVersions.get(normalizeScenarioId(scenarioId)) || [];
}

export function exportMarkupGeoJson(scenarioId) {
  const [latest] = listMarkupSets(scenarioId);
  return {
    type: 'FeatureCollection',
    features: (latest?.markups || []).map((markup) => ({
      type: 'Feature',
      properties: {
        id: markup.id,
        layerId: markup.layerId,
        label: markup.label,
        style: markup.style || {},
      },
      geometry: markup.geometry,
    })),
  };
}

export async function addDocument({ file, scenarioId = 'default', tags = [], uploadedBy = 'unknown' }) {
  const fileType = normalizeFileType(file.originalname, file.mimetype);
  const buffer = await readFile(file.path);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const duplicate = [...documents.values()].find(
    (doc) => doc.scenarioId === normalizedScenarioId && doc.hash === hash
  );
  if (duplicate) return { ...duplicate, duplicate: true };

  const extractedText = await extractTextFromDocument(file.path, fileType);
  const timestamp = nowIso();
  const document = {
    id: uuidv4(),
    scenarioId: normalizedScenarioId,
    filename: file.originalname,
    filePath: file.path,
    fileType,
    fileSize: file.size,
    hash,
    extractedText,
    tags: normalizeTags(tags),
    uploadedBy,
    uploadedAt: timestamp,
    createdAt: timestamp,
  };
  documents.set(document.id, document);
  return document;
}

export function listDocuments(scenarioId = 'default') {
  const normalized = normalizeScenarioId(scenarioId);
  return [...documents.values()]
    .filter((doc) => doc.scenarioId === normalized)
    .map((doc) => ({
      id: doc.id,
      scenarioId: doc.scenarioId,
      filename: doc.filename,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      hash: doc.hash,
      tags: doc.tags,
      uploadedBy: doc.uploadedBy,
      uploadedAt: doc.uploadedAt,
      createdAt: doc.createdAt,
      duplicate: doc.duplicate,
      preview: buildPreview(doc.extractedText, doc.fileType),
    }));
}

export function getDocumentPreview(id) {
  const document = documents.get(String(id));
  if (!document) return null;
  return {
    id: document.id,
    filename: document.filename,
    fileType: document.fileType,
    preview: buildPreview(document.extractedText, document.fileType),
  };
}

export function searchDocuments({ query, scenarioId = 'default' }) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const normalized = normalizeScenarioId(scenarioId);
  return [...documents.values()]
    .filter((doc) => doc.scenarioId === normalized)
    .map((doc) => {
      const haystack = `${doc.filename}\n${doc.tags.join(' ')}\n${doc.extractedText}`.toLowerCase();
      const index = haystack.indexOf(needle);
      if (index === -1) return null;
      const source = doc.extractedText || doc.filename;
      const sourceLower = source.toLowerCase();
      const sourceIndex = sourceLower.indexOf(needle);
      const start = Math.max(0, sourceIndex === -1 ? 0 : sourceIndex - 80);
      return {
        id: doc.id,
        filename: doc.filename,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        tags: doc.tags,
        uploadedAt: doc.uploadedAt,
        context: source.slice(start, start + 220),
      };
    })
    .filter(Boolean);
}

export function removeDocument(id) {
  return documents.delete(String(id));
}

export function resetTacticalStore() {
  units.clear();
  markupVersions.clear();
  documents.clear();
}
