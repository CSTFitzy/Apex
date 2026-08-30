import api from './client';
import type {
  AAREvent,
  AARUnit,
  ComparisonResult,
  LessonInsight,
  Operation,
  OperationSummary,
  PerformanceAnalytics,
  TrainingScenario,
} from '../types';

export async function startOperation(name: string, units: AARUnit[]): Promise<Operation> {
  const res = await api.post('/aar/operations', { name, units });
  return res.data;
}

export async function recordFrame(
  operationId: string,
  units: AARUnit[],
  events: AAREvent[]
): Promise<void> {
  await api.post(`/aar/operations/${operationId}/frames`, { units, events });
}

export async function endOperation(operationId: string): Promise<Operation> {
  const res = await api.post(`/aar/operations/${operationId}/end`);
  return res.data;
}

export async function listOperations(): Promise<OperationSummary[]> {
  const res = await api.get('/aar/operations');
  return res.data;
}

export async function getOperation(operationId: string): Promise<Operation> {
  const res = await api.get(`/aar/operations/${operationId}`);
  return res.data;
}

export async function addBookmark(operationId: string, timestamp: number, label: string) {
  const res = await api.post(`/aar/operations/${operationId}/bookmarks`, { timestamp, label });
  return res.data;
}

export async function getAnalytics(operationId: string): Promise<PerformanceAnalytics> {
  const res = await api.get(`/aar/operations/${operationId}/analytics`);
  return res.data;
}

export async function getLessons(operationId: string, query = ''): Promise<LessonInsight[]> {
  const res = await api.get(`/aar/operations/${operationId}/lessons`, { params: query ? { q: query } : {} });
  return res.data;
}

export async function searchLessonsAcrossOperations(query: string): Promise<LessonInsight[]> {
  const res = await api.get('/aar/lessons/search', { params: { q: query } });
  return res.data;
}

export async function compareOperations(ids: string[]): Promise<ComparisonResult> {
  const res = await api.get('/aar/compare', { params: { ids: ids.join(',') } });
  return res.data;
}

export async function generateTrainingScenario(
  operationId: string,
  difficulty: TrainingScenario['difficulty']
): Promise<TrainingScenario> {
  const res = await api.post(`/aar/operations/${operationId}/training`, { difficulty });
  return res.data;
}

export function reportUrl(operationId: string, format: 'json' | 'csv' | 'html'): string {
  return `/api/aar/operations/${encodeURIComponent(operationId)}/report?format=${encodeURIComponent(format)}`;
}

export async function getAIStatus(): Promise<{ claudeConfigured: boolean }> {
  const res = await api.get('/aar/ai/status');
  return res.data;
}

export async function getNarrativeReport(operationId: string): Promise<{ narrative: string; source: 'claude' }> {
  const res = await api.get(`/aar/operations/${operationId}/narrative`);
  return res.data;
}
