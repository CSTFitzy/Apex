import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type { LessonCategory, LessonInsight, Operation, PerformanceAnalytics } from './types.js';
import { aarStore } from './store.js';

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-opus-20240229';
const MAX_TOKENS = 1536;

const VALID_CATEGORIES: LessonCategory[] = [
  'what_went_well',
  'what_could_improve',
  'doctrinal_alignment',
  'enemy_analysis',
  'environmental_factors',
  'training_recommendations',
];

let client: Anthropic | null = null;
let clientInitAttempted = false;

/** Lazily constructs the Anthropic client. Returns null when no API key is configured. */
function getClient(): Anthropic | null {
  if (clientInitAttempted) return client;
  clientInitAttempted = true;
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

/** True when a Claude API key is configured, so AI-generated (rather than rule-based) insights can be requested. */
export function isClaudeConfigured(): boolean {
  return getClient() !== null;
}

/** Builds a compact JSON description of an operation for inclusion in Claude prompts. */
function buildOperationContext(operation: Operation, analytics: PerformanceAnalytics): string {
  const summary = aarStore.summarize(operation);
  const events = operation.frames.flatMap((f) => f.events);
  return JSON.stringify(
    {
      summary,
      units: analytics.units,
      commanderEffectiveness: analytics.commanderEffectiveness,
      rankings: analytics.rankings,
      events: events.slice(0, 200),
    },
    null,
    2
  );
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

/**
 * Uses Claude to perform tactical analysis and reasoning over a completed operation,
 * generating lessons-learned insights across all 6 AAR categories - including
 * doctrinal alignment assessment, enemy force analysis, and training recommendations.
 * Falls back to the caller's rule-based generator on any error.
 */
export async function generateLessonsWithClaude(
  operation: Operation,
  analytics: PerformanceAnalytics
): Promise<LessonInsight[]> {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Claude API is not configured (set CLAUDE_API_KEY)');

  const context = buildOperationContext(operation, analytics);
  const prompt = `You are a military operations analyst conducting an After-Action Review (AAR).
Analyze the following completed tactical operation data and produce structured lessons learned.

Operation data (JSON):
${context}

Perform tactical analysis and reasoning, then respond with ONLY a JSON array (no prose, no markdown fences) of lesson objects. Cover all 6 categories, with at least one lesson per category where the data supports it:
- "what_went_well": successful tactics, effective coordination
- "what_could_improve": suboptimal decisions, communication failures
- "doctrinal_alignment": doctrine compliance or violations
- "enemy_analysis": enemy tactics, weaknesses exploited
- "environmental_factors": terrain, weather, time-of-day effects
- "training_recommendations": skill gaps and training priorities

Each object must have exactly these fields:
- "category": one of the 6 category strings above
- "title": short headline (max ~80 chars)
- "detail": 1-3 sentence explanation grounded in the provided data
- "severity": "low" | "medium" | "high"
- "applicability": "unit" | "commander" | "doctrine" | "general"`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude response did not contain text content');
  }

  const parsed = extractJson(textBlock.text);
  if (!Array.isArray(parsed)) {
    throw new Error('Claude response was not a JSON array');
  }

  const now = Date.now();
  const lessons: LessonInsight[] = parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const category = VALID_CATEGORIES.includes(item.category as LessonCategory)
        ? (item.category as LessonCategory)
        : 'what_could_improve';
      const severity = ['low', 'medium', 'high'].includes(item.severity as string)
        ? (item.severity as LessonInsight['severity'])
        : 'medium';
      const applicability = ['unit', 'commander', 'doctrine', 'general'].includes(item.applicability as string)
        ? (item.applicability as LessonInsight['applicability'])
        : 'general';
      return {
        id: randomUUID(),
        operationId: operation.id,
        category,
        title: String(item.title ?? 'Untitled insight').slice(0, 200),
        detail: String(item.detail ?? '').slice(0, 2000),
        severity,
        applicability,
        createdAt: now,
        source: 'claude' as const,
      };
    });

  if (lessons.length === 0) {
    throw new Error('Claude returned no usable lessons');
  }
  return lessons;
}

/**
 * Uses Claude to generate a professional narrative AAR summary (executive-style prose)
 * describing the operation, tying together performance analytics and lessons learned.
 * Falls back to a simple templated narrative on any error.
 */
export async function generateNarrativeReport(
  operation: Operation,
  analytics: PerformanceAnalytics,
  lessons: LessonInsight[]
): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Claude API is not configured (set CLAUDE_API_KEY)');

  const context = buildOperationContext(operation, analytics);
  const lessonsSummary = lessons.map((l) => `- [${l.category}] ${l.title}: ${l.detail}`).join('\n');
  const prompt = `You are a military operations analyst writing the executive-summary narrative section of an After-Action Report.

Operation data (JSON):
${context}

Lessons learned already identified:
${lessonsSummary || '(none identified)'}

Write a concise, professional narrative (3-5 paragraphs, plain text, no markdown headers) summarizing what happened during the operation, commander performance, and the most important takeaways. Do not repeat the raw JSON back.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude response did not contain text content');
  }
  return textBlock.text.trim();
}
