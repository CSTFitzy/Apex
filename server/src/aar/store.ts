import type { AAROperation } from './types.js';

/**
 * In-memory AAR operation store. Mirrors the pattern used elsewhere in the
 * server (e.g. simulated doctrine data) - no persistent database is wired up
 * yet, so operations live for the lifetime of the server process.
 */
const operations = new Map<string, AAROperation>();
let operationCounter = 0;

export function nextOperationId(): string {
  operationCounter += 1;
  return `op-${Date.now()}-${operationCounter}`;
}

export function saveOperation(operation: AAROperation): void {
  operations.set(operation.operationId, operation);
}

export function getOperation(operationId: string): AAROperation | undefined {
  return operations.get(operationId);
}

export function listOperations(): AAROperation[] {
  return Array.from(operations.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteOperation(operationId: string): boolean {
  return operations.delete(operationId);
}
