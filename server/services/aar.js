import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';

const operations = new Map();
const MAX_OPERATIONS = 50;
const LESSON_CATEGORIES = [
  'Mission planning',
  'Command and control',
  'Unit performance',
  'Intelligence and threats',
  'Logistics and sustainment',
  'Communications',
];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeText(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normaliseOperation(input, ownerId) {
  const units = Array.isArray(input.units) ? input.units.slice(0, 100) : [];
  const events = Array.isArray(input.events) ? input.events.slice(0, 1000) : [];
  const startTime = input.startTime || new Date().toISOString();
  const endTime = input.endTime || new Date().toISOString();
  return {
    id: randomUUID(),
    ownerId,
    name: safeText(input.name, 120) || 'Untitled operation',
    objective: safeText(input.objective, 500),
    commander: safeText(input.commander, 120) || 'Unassigned',
    startTime,
    endTime,
    units: units.map((unit, index) => ({
      id: safeText(unit?.id, 80) || `unit-${index + 1}`,
      name: safeText(unit?.name, 120) || `Unit ${index + 1}`,
      type: safeText(unit?.type, 80) || 'Unknown',
      status: safeText(unit?.status, 40) || 'active',
      assigned: number(unit?.assigned, 1),
      casualties: Math.max(0, number(unit?.casualties)),
      objectivesCompleted: Math.max(0, number(unit?.objectivesCompleted)),
      objectivesAssigned: Math.max(0, number(unit?.objectivesAssigned, 1)),
      engagements: Math.max(0, number(unit?.engagements)),
      successfulEngagements: Math.max(0, number(unit?.successfulEngagements)),
    })),
    events: events.map((event, index) => ({
      id: safeText(event?.id, 80) || `event-${index + 1}`,
      timestamp: event?.timestamp || startTime,
      type: safeText(event?.type, 80) || 'activity',
      description: safeText(event?.description, 500),
      unitId: safeText(event?.unitId, 80),
      severity: safeText(event?.severity, 30) || 'info',
      position: event?.position && Number.isFinite(Number(event.position.lat)) && Number.isFinite(Number(event.position.lng))
        ? { lat: Number(event.position.lat), lng: Number(event.position.lng) }
        : undefined,
    })),
    createdAt: new Date().toISOString(),
  };
}

export function calculateAnalytics(operation) {
  const units = operation.units;
  const totalAssigned = units.reduce((sum, unit) => sum + unit.assigned, 0);
  const casualties = units.reduce((sum, unit) => sum + unit.casualties, 0);
  const assignedObjectives = units.reduce((sum, unit) => sum + unit.objectivesAssigned, 0);
  const completedObjectives = units.reduce((sum, unit) => sum + unit.objectivesCompleted, 0);
  const engagements = units.reduce((sum, unit) => sum + unit.engagements, 0);
  const successfulEngagements = units.reduce((sum, unit) => sum + unit.successfulEngagements, 0);
  const unitPerformance = units.map((unit) => {
    const objectiveRate = unit.objectivesAssigned ? unit.objectivesCompleted / unit.objectivesAssigned : 0;
    const engagementRate = unit.engagements ? unit.successfulEngagements / unit.engagements : 0;
    const casualtyRate = unit.assigned ? unit.casualties / unit.assigned : 0;
    return {
      ...unit,
      objectiveRate: Math.round(objectiveRate * 100),
      engagementRate: Math.round(engagementRate * 100),
      casualtyRate: Math.round(casualtyRate * 100),
      score: Math.round(Math.max(0, Math.min(100, objectiveRate * 50 + engagementRate * 30 + (1 - casualtyRate) * 20))),
    };
  });
  const objectiveRate = assignedObjectives ? completedObjectives / assignedObjectives : 0;
  const engagementRate = engagements ? successfulEngagements / engagements : 0;
  const casualtyRate = totalAssigned ? casualties / totalAssigned : 0;
  return {
    personnel: { assigned: totalAssigned, casualties, casualtyRate: Math.round(casualtyRate * 100) },
    objectives: { assigned: assignedObjectives, completed: completedObjectives, completionRate: Math.round(objectiveRate * 100) },
    engagements: { total: engagements, successful: successfulEngagements, successRate: Math.round(engagementRate * 100) },
    unitPerformance,
    commanderScore: Math.round(Math.max(0, Math.min(100, objectiveRate * 55 + engagementRate * 25 + (1 - casualtyRate) * 20))),
  };
}

function fallbackLessons(operation, analytics) {
  const lessons = [];
  if (analytics.objectives.completionRate < 75) lessons.push(['Mission planning', 'Refine phase objectives and decision points before the next operation.']);
  if (analytics.commanderScore < 70) lessons.push(['Command and control', 'Establish clearer command triggers and review them during rehearsal.']);
  if (analytics.unitPerformance.some((unit) => unit.score < 65)) lessons.push(['Unit performance', 'Provide focused rehearsal for units with lower objective or engagement performance.']);
  if (operation.events.some((event) => /threat|enemy|ambush/i.test(event.description))) lessons.push(['Intelligence and threats', 'Update threat indicators from observed activity and brief units before movement.']);
  if (analytics.personnel.casualtyRate > 5) lessons.push(['Logistics and sustainment', 'Review protection, medical response, and resupply posture to reduce losses.']);
  if (operation.events.some((event) => /comm|radio|signal/i.test(event.description))) lessons.push(['Communications', 'Validate alternate communications plans and reporting cadence.']);
  return LESSON_CATEGORIES.map((category) => {
    const lesson = lessons.find(([lessonCategory]) => lessonCategory === category);
    return { category, lesson: lesson?.[1] || 'Sustain the current approach while capturing observations for the next review.' };
  });
}

function operationSummary(operation, analytics) {
  return JSON.stringify({
    name: operation.name,
    objective: operation.objective,
    commander: operation.commander,
    analytics,
    events: operation.events.slice(0, 100),
  });
}

async function aiLessons(operation, analytics) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: 'You are a military after-action-review assistant. Return strictly a JSON array of six concise objects: {"category": string, "lesson": string}. Cover each requested category once. Do not provide operational instructions for violence.',
    messages: [{ role: 'user', content: `Generate lessons for these categories: ${LESSON_CATEGORIES.join(', ')}. Operation data: ${operationSummary(operation, analytics)}` }],
  });
  const text = response.content.find((item) => item.type === 'text')?.text;
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.slice(0, 6) : null;
}

async function aiThreats(operation, analytics) {
  if (!process.env.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1',
    input: `Assess observed operational risks at a high level from this after-action data. Return JSON with "summary" and "threats" (array of up to 5 {risk, assessment, priority}). Avoid tactical instructions for violence. Data: ${operationSummary(operation, analytics)}`,
    text: { format: { type: 'json_object' } },
  });
  return JSON.parse(response.output_text);
}

export async function buildReview(operation) {
  const analytics = calculateAnalytics(operation);
  let lessons = fallbackLessons(operation, analytics);
  let threatAnalysis = { summary: 'AI threat analysis is unavailable; review recorded events.', threats: [] };
  let ai = { lessons: false, threats: false };
  try {
    const generated = await aiLessons(operation, analytics);
    if (generated) {
      lessons = generated;
      ai.lessons = true;
    }
  } catch {
    // Rule-based lessons preserve reporting availability when the provider is unavailable.
  }
  try {
    const generated = await aiThreats(operation, analytics);
    if (generated) {
      threatAnalysis = generated;
      ai.threats = true;
    }
  } catch {
    // Event data remains available if the provider request fails.
  }
  return { ...operation, analytics, lessons, threatAnalysis, ai };
}

export function createOperation(input, ownerId) {
  const operation = normaliseOperation(input, ownerId);
  operations.set(operation.id, operation);
  if (operations.size > MAX_OPERATIONS) operations.delete(operations.keys().next().value);
  return operation;
}

export function getOperation(id, ownerId) {
  const operation = operations.get(id);
  return operation?.ownerId === ownerId ? operation : null;
}

export function listOperations(ownerId) {
  return [...operations.values()].filter((operation) => operation.ownerId === ownerId);
}

export function compareOperations(current, historical) {
  const currentAnalytics = calculateAnalytics(current);
  return historical.map((operation) => {
    const analytics = calculateAnalytics(operation);
    return {
      id: operation.id,
      name: operation.name,
      createdAt: operation.createdAt,
      commanderScore: analytics.commanderScore,
      scoreDelta: currentAnalytics.commanderScore - analytics.commanderScore,
      objectiveDelta: currentAnalytics.objectives.completionRate - analytics.objectives.completionRate,
      casualtyDelta: currentAnalytics.personnel.casualtyRate - analytics.personnel.casualtyRate,
    };
  });
}

export function createTrainingScenario(review) {
  const weakest = [...review.analytics.unitPerformance].sort((a, b) => a.score - b.score)[0];
  return {
    title: `Training: ${review.name}`,
    objective: weakest ? `Improve ${weakest.name} performance in ${weakest.type} tasks.` : 'Rehearse mission command and reporting procedures.',
    focusAreas: review.lessons.map((lesson) => lesson.category),
    injects: review.threatAnalysis.threats?.map((threat) => threat.risk) || [],
    evaluationCriteria: ['Objective completion', 'Communication timeliness', 'Personnel safety'],
  };
}

export function exportReview(review, format) {
  if (format === 'json') return { contentType: 'application/json', body: JSON.stringify(review, null, 2), extension: 'json' };
  if (format === 'csv') {
    const rows = [['Unit', 'Type', 'Score', 'Objectives %', 'Engagements %', 'Casualties %'], ...review.analytics.unitPerformance.map((unit) => [unit.name, unit.type, unit.score, unit.objectiveRate, unit.engagementRate, unit.casualtyRate])];
    return { contentType: 'text/csv', body: rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n'), extension: 'csv' };
  }
  const escape = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(review.name)} AAR</title></head><body><h1>${escape(review.name)}</h1><p>Commander score: ${review.analytics.commanderScore}/100</p><h2>Lessons learned</h2><ul>${review.lessons.map((lesson) => `<li><strong>${escape(lesson.category)}:</strong> ${escape(lesson.lesson)}</li>`).join('')}</ul><h2>Unit performance</h2><table><tr><th>Unit</th><th>Score</th></tr>${review.analytics.unitPerformance.map((unit) => `<tr><td>${escape(unit.name)}</td><td>${unit.score}</td></tr>`).join('')}</table></body></html>`;
  return { contentType: 'text/html', body, extension: 'html' };
}
