import type { CommandPayload } from './types';
import type { EvaluationSuiteId } from './wave2-lab';

export type DevelopmentTrainingOrder = Extract<CommandPayload, { kind: 'start_training' }>;
export type DevelopmentPlanStatus = 'running' | 'paused' | 'blocked' | 'review' | 'cancelled';
export type DevelopmentStage = 'prepare' | 'train' | 'evaluate' | 'review';
export interface DevelopmentPlanSpec {
  name: string;
  training: DevelopmentTrainingOrder;
  suiteId: EvaluationSuiteId;
  /** Direct preparation and training setup fees. Weekly operations continue normally. */
  feeBudgetCents: number;
  cashReserveCents: number;
  deadlineWeek: number;
}
export interface DevelopmentPlanStep {
  key: string;
  commandId: string;
  issuedWeek: number;
  feeCents: number;
  payload: Extract<CommandPayload, { kind: 'prepare_data' | 'start_training' | 'evaluate_model' }>;
}
export interface DevelopmentPlan extends DevelopmentPlanSpec {
  id: string;
  companyId: string;
  createdWeek: number;
  status: DevelopmentPlanStatus;
  stage: DevelopmentStage;
  steps: DevelopmentPlanStep[];
  message: string;
  decisionWeek?: number;
  completedWeek?: number;
  modelId?: string;
  reportId?: string;
}
export type DevelopmentPlanCommand =
  | ({ kind: 'start_development_plan' } & DevelopmentPlanSpec)
  | { kind: 'set_development_plan_paused'; planId: string; paused: boolean }
  | { kind: 'revise_development_plan'; planId: string; feeBudgetCents: number; cashReserveCents: number; deadlineWeek: number }
  | { kind: 'cancel_development_plan'; planId: string };

export const DEVELOPMENT_PLAN_COMMANDS = ['start_development_plan', 'set_development_plan_paused', 'revise_development_plan', 'cancel_development_plan'] as const;
export const DEVELOPMENT_PLAN_LIMIT = 100;
