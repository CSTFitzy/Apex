import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

const COA_COLORS = ['#f85149', '#d29922', '#a371f7'];
const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
const UNIT_TASKS = {
  infantry: ['DEFEND key terrain', 'DELAY enemy advance', 'SECURE objective'],
  armor: ['COUNTER-ATTACK flank', 'BLOCK armored approach', 'SCREEN main body'],
  artillery: ['PROVIDE fire support', 'SUPPRESS enemy movement', 'INTERDICT avenue of approach'],
  air: ['RECON enemy axis', 'PROVIDE close air support', 'DISRUPT reserves'],
  naval: ['CONTROL littoral approach', 'INTERDICT movement', 'SUPPORT fires'],
  support: ['SUSTAIN forward units', 'ESTABLISH resupply point', 'PROVIDE evacuation support'],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeDocuments(documents) {
  const text = asArray(documents)
    .map((doc) => `${doc.filename || 'document'}: ${doc.text || doc.extractedText || doc.preview?.text || ''}`)
    .join('\n')
    .toLowerCase();

  return {
    mentionsArmor: /armor|tank|mechanized|armoured/.test(text),
    mentionsFlank: /flank|encircle|envelopment|bypass/.test(text),
    mentionsDelay: /delay|fallback|withdraw|defen[cs]e/.test(text),
    mentionsObjective: /objective|seize|capture|secure/.test(text),
    text,
  };
}

function centroid(units) {
  const valid = asArray(units).filter((unit) => unit.position);
  if (!valid.length) return { latitude: 0, longitude: 0 };
  return {
    latitude: valid.reduce((sum, unit) => sum + toNumber(unit.position.latitude), 0) / valid.length,
    longitude: valid.reduce((sum, unit) => sum + toNumber(unit.position.longitude), 0) / valid.length,
  };
}

function offsetPoint(point, latOffset, lonOffset) {
  return {
    latitude: Number((toNumber(point.latitude) + latOffset).toFixed(5)),
    longitude: Number((toNumber(point.longitude) + lonOffset).toFixed(5)),
  };
}

function terrainSummary(terrain = {}) {
  const classification =
    terrain.summary?.classification ||
    terrain.classification ||
    terrain.mobility?.classification ||
    'mixed terrain';
  const keyFeatures = [
    classification,
    terrain.weatherImpact?.summary,
    terrain.mobility?.description,
    terrain.obstacles?.summary,
  ].filter(Boolean);
  return keyFeatures.length ? keyFeatures : ['key routes', 'dominant terrain', 'covered approaches'];
}

function weatherSummary(weather = {}) {
  const current = weather.current || weather.currentWeather || weather.forecast?.current || {};
  return {
    wind: current.windSpeed ?? current.wind_speed ?? 'unknown',
    visibility: current.visibility ?? weather.visibility ?? 'variable',
    precipitation: current.precipitation ?? weather.precipitation ?? 'unknown',
  };
}

function buildFallbackCoas({ documents = [], enemyUnits = [], friendlyUnits = [], terrain = {}, weather = {} }) {
  const docSummary = summarizeDocuments(documents);
  const terrainFeatures = terrainSummary(terrain);
  const friendlyCenter = centroid(friendlyUnits);
  const enemyCenter = centroid(enemyUnits);
  const weatherInfo = weatherSummary(weather);
  const objectivePoint = offsetPoint(friendlyCenter, 0.01, 0.01);
  const enemyStrength = enemyUnits.reduce((sum, unit) => sum + toNumber(unit.strength, 8), 0);
  const friendlyStrength = friendlyUnits.reduce((sum, unit) => sum + toNumber(unit.strength, 8), 0);
  const forceRatio = friendlyStrength > 0 ? enemyStrength / friendlyStrength : 1.2;

  const baseCoas = [
    {
      name: docSummary.mentionsArmor ? 'Armored Frontal Assault' : 'Frontal Assault',
      baseProbability: docSummary.mentionsObjective ? 62 : 50,
      timeline: '2-4 hours',
      riskAssessment: forceRatio >= 1 ? 'HIGH' : 'MEDIUM',
      theme: 'main effort along the most direct avenue of approach',
      vulnerabilities: ['Predictable axis of advance', 'Exposed logistics tail', 'Susceptible to flank fires'],
      objective: 'Seize the primary friendly position or named objective',
      offset: [0, 0],
    },
    {
      name: docSummary.mentionsFlank ? 'Deliberate Encirclement' : 'Flanking Envelopment',
      baseProbability: docSummary.mentionsFlank ? 55 : 30,
      timeline: '4-8 hours',
      riskAssessment: 'MEDIUM',
      theme: 'wide movement around restrictive terrain to isolate friendly forces',
      vulnerabilities: ['Longer movement timeline', 'Coordination risk', 'Exposed flank guard'],
      objective: 'Fix friendly forces while a maneuver element attacks from a flank',
      offset: [0.025, 0.03],
    },
    {
      name: docSummary.mentionsDelay ? 'Delay and Fallback' : 'Reconnaissance and Probe',
      baseProbability: docSummary.mentionsDelay ? 45 : 25,
      timeline: '6-12 hours',
      riskAssessment: forceRatio < 0.8 ? 'LOW' : 'MEDIUM',
      theme: 'limited probes to identify weak points before committing reserves',
      vulnerabilities: ['Low tempo', 'Opportunity for friendly counter-reconnaissance', 'Cedes initiative'],
      objective: 'Identify gaps, attrit forward units, and preserve combat power',
      offset: [-0.02, 0.025],
    },
  ];

  const total = baseCoas.reduce((sum, coa) => sum + coa.baseProbability, 0);
  return baseCoas.map((coa, index) => {
    const probability = Math.round((coa.baseProbability / total) * 100);
    const color = COA_COLORS[index % COA_COLORS.length];
    const phasePoints = [
      offsetPoint(enemyCenter, coa.offset[0], coa.offset[1]),
      offsetPoint(
        {
          latitude: (enemyCenter.latitude + friendlyCenter.latitude) / 2,
          longitude: (enemyCenter.longitude + friendlyCenter.longitude) / 2,
        },
        coa.offset[0] / 2,
        coa.offset[1] / 2
      ),
      objectivePoint,
    ];

    return {
      id: `coa-${index + 1}`,
      name: coa.name,
      title: coa.name,
      probability,
      timeline: coa.timeline,
      keyTerrain: terrainFeatures.slice(0, 4),
      weatherConsiderations: `Weather impact: wind ${weatherInfo.wind}, visibility ${weatherInfo.visibility}, precipitation ${weatherInfo.precipitation}.`,
      objectives: [coa.objective, 'Maintain freedom of maneuver', 'Disrupt friendly command and control'],
      vulnerabilities: coa.vulnerabilities,
      riskAssessment: coa.riskAssessment,
      phases: ['Phase I', 'Phase II', 'Phase III'].map((phase, phaseIndex) => ({
        name: phase,
        timeline: phaseIndex === 0 ? 'T+0 to T+1' : phaseIndex === 1 ? 'T+1 to T+3' : 'T+3 to completion',
        objective:
          phaseIndex === 0
            ? `Reconnoiter and shape ${coa.theme}`
            : phaseIndex === 1
              ? `Commit maneuver units on ${coa.theme}`
              : coa.objective,
        movements: enemyUnits.map((unit) => ({
          unitId: unit.id,
          unitName: unit.name,
          from: unit.position,
          to: phasePoints[phaseIndex],
          description: `${unit.name} moves during ${phase} to support ${coa.name.toLowerCase()}.`,
        })),
      })),
      visualization: {
        color,
        paths: enemyUnits.map((unit) => ({
          unitId: unit.id,
          unitName: unit.name,
          color,
          points: [unit.position, ...phasePoints],
        })),
        phaseLines: phasePoints.map((point, phaseIndex) => ({
          label: `PL ${phaseIndex + 1}`,
          points: [offsetPoint(point, -0.01, -0.02), offsetPoint(point, 0.01, 0.02)],
        })),
        objectives: [{ label: `OBJ ${index + 1}`, position: objectivePoint }],
      },
    };
  });
}

function buildAnalysisPrompt(payload) {
  return `You are a military AI analyst. Analyze the following:
- ENEMY INTELLIGENCE DOCUMENTS: ${JSON.stringify(payload.documents || [])}
- ENEMY UNIT DISPOSITION: ${JSON.stringify(payload.enemyUnits || [])}
- FRIENDLY UNIT DISPOSITION: ${JSON.stringify(payload.friendlyUnits || [])}
- TERRAIN ANALYSIS: ${JSON.stringify(payload.terrain || {})}
- WEATHER: ${JSON.stringify(payload.weather || {})}

Generate 3 likely courses of action (COAs) the enemy would take to achieve their objectives.
For each COA provide name, probability, estimated timeline, phase breakdown, key terrain features, vulnerabilities, and risk assessment.
Output only structured JSON in this shape: {"coas":[...],"analysis":"...","recommendations":"..."}.`;
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeCoas(coas, fallbackCoas) {
  const incoming = asArray(coas).length ? asArray(coas) : fallbackCoas;
  return incoming.slice(0, 3).map((coa, index) => ({
    ...fallbackCoas[index],
    ...coa,
    id: coa.id || fallbackCoas[index]?.id || `coa-${index + 1}`,
    name: coa.name || coa.title || fallbackCoas[index]?.name || `COA ${index + 1}`,
    title: coa.title || coa.name || fallbackCoas[index]?.title || `COA ${index + 1}`,
    probability: clamp(Math.round(toNumber(coa.probability, fallbackCoas[index]?.probability || 0)), 0, 100),
    riskAssessment: String(coa.riskAssessment || coa.risk || fallbackCoas[index]?.riskAssessment || RISK_LEVELS[index]).toUpperCase(),
    phases: asArray(coa.phases).length ? coa.phases : fallbackCoas[index]?.phases || [],
  }));
}

async function callConfiguredAI(payload) {
  const prompt = buildAnalysisPrompt(payload);
  const model = String(process.env.AI_MODEL || 'claude').toLowerCase();

  if (model === 'gpt4' && process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    return extractJson(response.choices?.[0]?.message?.content);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
      max_tokens: 3500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content?.map((part) => part.text || '').join('\n');
    return extractJson(text);
  }

  return null;
}

export async function analyzeEnemyCoas(payload) {
  const enemyUnits = asArray(payload.enemyUnits);
  const documents = asArray(payload.documents);
  if (!documents.length) throw new Error('At least one enemy document is required for COA analysis');
  if (!enemyUnits.length) throw new Error('At least one enemy unit is required for COA analysis');

  const fallbackCoas = buildFallbackCoas(payload);
  let aiResult = null;
  try {
    aiResult = await callConfiguredAI(payload);
  } catch {
    aiResult = null;
  }

  const coas = normalizeCoas(aiResult?.coas, fallbackCoas);
  const mostLikely = coas.reduce((best, coa) => (coa.probability > best.probability ? coa : best), coas[0]);
  return {
    coas: coas.map((coa) => ({ ...coa, mostLikely: coa.id === mostLikely.id })),
    analysis:
      aiResult?.analysis ||
      `Generated ${coas.length} enemy COAs from ${documents.length} intelligence document(s), ${enemyUnits.length} enemy unit(s), terrain, and weather inputs.`,
    recommendations:
      aiResult?.recommendations ||
      'Compare the most likely and most dangerous COAs, then generate a friendly counter-plan against the selected COA.',
  };
}

export function estimateCasualties({ friendlyUnits = [], enemyUnits = [], selectedCOA = {} }) {
  const friendlyStrength = friendlyUnits.reduce((sum, unit) => sum + toNumber(unit.strength, 8), 0);
  const enemyStrength = enemyUnits.reduce((sum, unit) => sum + toNumber(unit.strength, 8), 0);
  const riskMultiplier = selectedCOA.riskAssessment === 'HIGH' ? 0.22 : selectedCOA.riskAssessment === 'LOW' ? 0.08 : 0.14;
  const forceRatio = friendlyStrength > 0 ? enemyStrength / friendlyStrength : 1;
  const friendlyCasualties = Math.round(friendlyStrength * riskMultiplier * clamp(forceRatio, 0.6, 1.8));
  const enemyCasualties = Math.round(enemyStrength * riskMultiplier * clamp(1 / Math.max(forceRatio, 0.3), 0.5, 1.6));
  return {
    friendly: {
      total: friendlyCasualties,
      kia: Math.round(friendlyCasualties * 0.25),
      wounded: Math.round(friendlyCasualties * 0.75),
      byUnit: friendlyUnits.map((unit) => ({
        unitId: unit.id,
        unitName: unit.name,
        estimatedCasualties: Math.max(0, Math.round(toNumber(unit.strength, 8) * riskMultiplier)),
      })),
    },
    enemy: {
      total: enemyCasualties,
      kia: Math.round(enemyCasualties * 0.3),
      wounded: Math.round(enemyCasualties * 0.7),
    },
  };
}

export function estimateSupply({ friendlyUnits = [], durationHours = 8, intensity = 'medium', terrain = {} }) {
  const intensityFactor = intensity === 'high' ? 1.5 : intensity === 'low' ? 0.75 : 1;
  const terrainFactor = /mountain|urban|restricted/i.test(JSON.stringify(terrain)) ? 1.25 : 1;
  const days = Math.max(1, Math.ceil(toNumber(durationHours, 8) / 24));
  const personnel = friendlyUnits.reduce((sum, unit) => sum + toNumber(unit.strength, 8), 0);

  return {
    ammunitionRounds: Math.round(personnel * 120 * days * intensityFactor),
    fuelGallons: Math.round(friendlyUnits.length * 45 * days * terrainFactor),
    medicalKits: Math.max(1, Math.round(personnel * 0.15)),
    foodWaterPounds: Math.round(personnel * 12 * days),
    maintenanceKits: Math.max(1, Math.ceil(friendlyUnits.length / 2)),
  };
}

export async function recommendCounterMoves(payload) {
  const friendlyUnits = asArray(payload.friendlyUnits);
  if (!payload.selectedCOA) throw new Error('selectedCOA is required');
  if (!friendlyUnits.length) throw new Error('At least one friendly unit is required for counter-move planning');

  const durationMatch = String(payload.selectedCOA.timeline || '').match(/(\d+)/g);
  const durationHours = durationMatch ? toNumber(durationMatch.at(-1), 8) : 8;
  const casualtyEstimate = estimateCasualties(payload);
  const supplyRequirements = estimateSupply({
    friendlyUnits,
    durationHours,
    intensity: payload.selectedCOA.riskAssessment === 'HIGH' ? 'high' : 'medium',
    terrain: payload.terrain,
  });

  const unitRecommendations = friendlyUnits.map((unit, index) => {
    const tasks = UNIT_TASKS[unit.type] || UNIT_TASKS.infantry;
    const riskLevel = payload.selectedCOA.riskAssessment === 'HIGH' && index === 0 ? 'HIGH' : 'MEDIUM';
    return {
      unitId: unit.id,
      unitName: unit.name,
      primaryTask: tasks[index % tasks.length],
      recommendedPosition: unit.position,
      movementTimeline: index % 2 === 0 ? 'Phase I (T+0)' : 'Phase II (T+2 hours)',
      reinforcementNeeded: riskLevel === 'HIGH',
      reinforcements: riskLevel === 'HIGH' ? ['Reserve or adjacent unit support'] : [],
      fireSupport: unit.type === 'artillery' ? 'Priority fires for counter-mobility' : 'Artillery on-call',
      supplyRequirements: {
        ammunitionRounds: Math.round(toNumber(unit.strength, 8) * 120),
        fuelGallons: unit.type === 'armor' ? 75 : 35,
        medicalKits: Math.max(1, Math.round(toNumber(unit.strength, 8) * 0.1)),
      },
      combatEffectiveness: `${clamp(85 - index * 8 - (riskLevel === 'HIGH' ? 12 : 0), 45, 90)}% after contact`,
      expectedLosses: casualtyEstimate.friendly.byUnit.find((entry) => entry.unitId === unit.id)?.estimatedCasualties || 0,
      riskLevel,
    };
  });

  const successProbability = clamp(
    Math.round(72 - (payload.selectedCOA.riskAssessment === 'HIGH' ? 10 : 0) + friendlyUnits.length * 2),
    35,
    90
  );

  return {
    unitRecommendations,
    timeline: `Counter-plan synchronized against ${payload.selectedCOA.name || 'selected COA'} over ${durationHours} hours.`,
    supplyRequirements,
    casualtyEstimate,
    successProbability,
    scenarioOptions: [
      { name: 'Best Counter', focus: 'Balance casualties, terrain advantage, and enemy disruption', successProbability },
      { name: 'Most Defensive', focus: 'Preserve friendly combat power and hold key terrain', successProbability: clamp(successProbability - 5, 35, 90) },
      { name: 'Most Aggressive', focus: 'Maximize pressure on exposed enemy forces', successProbability: clamp(successProbability - 8, 35, 90) },
    ],
  };
}

export async function generateOpord(payload) {
  if (!payload.counterPlan) throw new Error('counterPlan is required');
  if (!payload.enemyCOA) throw new Error('enemyCOA is required');
  const scenarioName = payload.scenarioName || 'Apex Scenario';
  const unitTasks = asArray(payload.counterPlan.unitRecommendations);
  const opordJSON = {
    id: uuidv4(),
    scenarioName,
    situation: `Enemy most likely COA: ${payload.enemyCOA.name || payload.enemyCOA.title}. Risk ${payload.enemyCOA.riskAssessment}.`,
    mission: `Friendly forces counter ${payload.enemyCOA.name || 'enemy COA'} while protecting the selected area of operations.`,
    execution: {
      phases: asArray(payload.enemyCOA.phases).map((phase, index) => ({
        phase: phase.name || `Phase ${index + 1}`,
        timeline: phase.timeline || 'TBD',
        tasks: unitTasks.map((task) => `${task.unitName}: ${task.primaryTask} (${task.movementTimeline})`),
      })),
    },
    logistics: payload.counterPlan.supplyRequirements,
    commandAndControl: {
      hierarchy: asArray(payload.friendlyUnits).map((unit) => unit.name),
      communications: 'Primary command net with alternate digital and voice reporting.',
    },
    riskAssessment: {
      enemyRisk: payload.enemyCOA.riskAssessment,
      mitigations: ['Maintain reserve', 'Protect supply routes', 'Use redundant communications', 'Reassess after each phase'],
    },
    appendices: {
      unitTasks,
      casualtyEstimate: payload.counterPlan.casualtyEstimate,
      scenarioOptions: payload.counterPlan.scenarioOptions,
    },
    generatedAt: new Date().toISOString(),
  };

  const opord = [
    `OPORD: ${scenarioName}`,
    '',
    `1. SITUATION: ${opordJSON.situation}`,
    `2. MISSION: ${opordJSON.mission}`,
    '3. EXECUTION:',
    ...opordJSON.execution.phases.map((phase) => `- ${phase.phase} (${phase.timeline}): ${phase.tasks.join('; ')}`),
    `4. LOGISTICS: Ammo ${opordJSON.logistics?.ammunitionRounds || 0} rds; Fuel ${
      opordJSON.logistics?.fuelGallons || 0
    } gal; Medical kits ${opordJSON.logistics?.medicalKits || 0}.`,
    `5. COMMAND & CONTROL: ${opordJSON.commandAndControl.communications}`,
    `RISK MITIGATION: ${opordJSON.riskAssessment.mitigations.join('; ')}.`,
  ].join('\n');

  return { opord, opordJSON, pdfUrl: null };
}
