/**
 * AI-powered AAR analysis using Claude (Anthropic) and GPT-4 (OpenAI).
 *
 * Both clients are initialized lazily and only if the corresponding API key
 * is configured. All AI calls are wrapped so that failures (missing key,
 * network error, API error) fall back gracefully to the rule-based engine
 * (see server/aar/lessons.js) rather than throwing. Responses are cached
 * in memory keyed by operation id + analysis kind to avoid redundant calls.
 */

import { logger } from '../utils/logger.js';
import { getLessonsForOperation } from './lessons.js';
import { buildAnalyticsBundle } from './analytics.js';

const responseCache = new Map();

let anthropicClientPromise;
let openaiClientPromise;

/** Lazily construct (and memoize) the Anthropic client, or null if unconfigured/unavailable. */
function getAnthropicClient() {
  if (!process.env.CLAUDE_API_KEY) return Promise.resolve(null);
  if (!anthropicClientPromise) {
    anthropicClientPromise = import('@anthropic-ai/sdk')
      .then(({ default: Anthropic }) => new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }))
      .catch((err) => {
        logger.error('Failed to initialize Anthropic client', { error: err.message });
        return null;
      });
  }
  return anthropicClientPromise;
}

/** Lazily construct (and memoize) the OpenAI client, or null if unconfigured/unavailable. */
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return Promise.resolve(null);
  if (!openaiClientPromise) {
    openaiClientPromise = import('openai')
      .then(({ default: OpenAI }) => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
      .catch((err) => {
        logger.error('Failed to initialize OpenAI client', { error: err.message });
        return null;
      });
  }
  return openaiClientPromise;
}

function cacheKey(operationId, kind) {
  return `${operationId}:${kind}`;
}

function summarizeOperationForPrompt(operation) {
  const { forceMetrics, commanderEffectiveness } = buildAnalyticsBundle(operation);
  return {
    name: operation.name,
    objectives: operation.objectives,
    durationMs: forceMetrics.durationMs,
    forceMetrics,
    commanderEffectiveness,
    eventCount: operation.events.length,
    sampleEvents: operation.events.slice(0, 25).map((e) => ({ type: e.type, details: e.details })),
  };
}

/**
 * Report AI availability: whether Claude and/or GPT-4 are configured.
 */
export function getAIStatus() {
  return {
    claudeAvailable: Boolean(process.env.CLAUDE_API_KEY),
    gpt4Available: Boolean(process.env.OPENAI_API_KEY),
  };
}

/**
 * Generate AI-enhanced lessons learned + a narrative summary using Claude,
 * and a threat assessment / tactical evaluation using GPT-4. Falls back to
 * the rule-based lessons engine (and a simple templated narrative/threat
 * assessment) if either API is unavailable or errors out.
 */
export async function generateAIAnalysis(operation, { forceRefresh = false } = {}) {
  const key = cacheKey(operation.id, 'ai-analysis');
  if (!forceRefresh && responseCache.has(key)) {
    return responseCache.get(key);
  }

  const [claude, gpt4] = await Promise.all([
    generateClaudeNarrative(operation).catch((err) => {
      logger.error('Claude analysis failed', { error: err.message });
      return null;
    }),
    generateGPT4ThreatAssessment(operation).catch((err) => {
      logger.error('GPT-4 analysis failed', { error: err.message });
      return null;
    }),
  ]);

  const result = {
    operationId: operation.id,
    generatedAt: new Date().toISOString(),
    claude: claude || fallbackNarrative(operation),
    gpt4: gpt4 || fallbackThreatAssessment(operation),
  };

  responseCache.set(key, result);
  return result;
}

/** Generate a narrative report / enhanced lessons via Claude. */
export async function generateClaudeNarrative(operation) {
  const client = await getAnthropicClient();
  if (!client) {
    return null;
  }

  const key = cacheKey(operation.id, 'claude-narrative');
  if (responseCache.has(key)) return responseCache.get(key);

  const summary = summarizeOperationForPrompt(operation);
  const model = process.env.CLAUDE_MODEL || 'claude-3-opus-20240229';

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content:
          'You are a military after-action review analyst. Given this operation summary, ' +
          'write a concise narrative report and 3-5 key lessons learned:\n\n' +
          JSON.stringify(summary),
      },
    ],
  });

  const text = message?.content?.map((block) => block.text || '').join('\n') || '';
  const result = { source: 'claude', model, narrative: text };
  responseCache.set(key, result);
  return result;
}

/** Generate a threat assessment / tactical evaluation via GPT-4. */
export async function generateGPT4ThreatAssessment(operation) {
  const client = await getOpenAIClient();
  if (!client) {
    return null;
  }

  const key = cacheKey(operation.id, 'gpt4-threat');
  if (responseCache.has(key)) return responseCache.get(key);

  const summary = summarizeOperationForPrompt(operation);
  const model = process.env.OPENAI_MODEL || 'gpt-4';

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a military intelligence analyst providing threat assessments and tactical recommendations.',
      },
      {
        role: 'user',
        content:
          'Given this operation summary, provide a threat assessment of the enemy force and ' +
          'strategic recommendations:\n\n' + JSON.stringify(summary),
      },
    ],
  });

  const text = completion?.choices?.[0]?.message?.content || '';
  const result = { source: 'gpt-4', model, assessment: text };
  responseCache.set(key, result);
  return result;
}

/**
 * Generate an AI-assisted training scenario narrative using Claude,
 * falling back to null (caller should use the rule-based generator) if
 * Claude is unavailable or errors.
 */
export async function generateAITrainingNarrative(operation, scenario) {
  const client = await getAnthropicClient();
  if (!client) return null;

  const key = cacheKey(operation.id, `claude-training-${scenario.difficulty}`);
  if (responseCache.has(key)) return responseCache.get(key);

  try {
    const model = process.env.CLAUDE_MODEL || 'claude-3-opus-20240229';
    const message = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content:
            'Write a 2-3 sentence training scenario briefing based on this scenario definition:\n\n' +
            JSON.stringify(scenario),
        },
      ],
    });
    const text = message?.content?.map((block) => block.text || '').join('\n') || '';
    const result = { source: 'claude', briefing: text };
    responseCache.set(key, result);
    return result;
  } catch (err) {
    logger.error('Claude training narrative failed', { error: err.message });
    return null;
  }
}

function fallbackNarrative(operation) {
  const lessons = getLessonsForOperation(operation);
  return {
    source: 'rule-based-fallback',
    narrative:
      `Operation "${operation.name}" recorded ${operation.events.length} events across ` +
      `${operation.frames.length} frames. Key lessons: ` +
      lessons.slice(0, 3).map((l) => l.title).join('; ') + '.',
  };
}

function fallbackThreatAssessment(operation) {
  const enemyEvents = operation.events.filter((e) => e.side === 'enemy' || e.type === 'enemy_contact');
  return {
    source: 'rule-based-fallback',
    assessment:
      `Rule-based assessment: ${enemyEvents.length} enemy-related event(s) observed. ` +
      'Configure OPENAI_API_KEY to enable GPT-4 powered threat assessment.',
  };
}

/** Clear the AI response cache (primarily for tests). */
export function clearAICache() {
  responseCache.clear();
}
