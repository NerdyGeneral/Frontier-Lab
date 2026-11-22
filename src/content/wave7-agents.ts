import { RESOURCE_SCALE as U } from '../contracts/types';

/** Authored game coefficients, not a claim about a real model or accelerator. */
export const PLANNER_CURRICULUM = {
  research: 'R11A', recipeId: 'planner-curriculum', work: 16 * U, behaviorCases: 100,
  baselineRepeatBps: 10000, targetRepeatBps: 8000,
} as const;

export const AGENT_RECOVERY = {
  research: 'R9A', method: 'action-receipts', maximumHandoffs: 2,
  workPerCase: U / 100, inputTokensPerCase: 300, outputTokensPerCase: 50,
} as const;
