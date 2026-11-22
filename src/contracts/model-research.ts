import type { JobStatus } from './wave1';

export type ModelResearchFocus = 'balanced' | 'capability' | 'efficiency' | 'reliability';
/** Derived from paid, available iterations; frozen into future design receipts. */
export interface ModelResearchFocusReceipt {
  counts: Record<ModelResearchFocus, number>;
  capacityBonusBps: number;
  efficiencyBonusBps: number;
  reliabilityBonusBps: number;
}

/** One paid iteration of the ongoing model architecture research program. */
export interface ModelResearchProject {
  id: string;
  companyId: string;
  level: number;
  /** Absent on historical iterations, which retain the original balanced effect. */
  focus?: ModelResearchFocus;
  focusFactId?: string;
  startedWeek: number;
  feeCents: number;
  requiredWork: number;
  completedWork: number;
  physicalWork: number;
  requiredStaff: number;
  completedStaff: number;
  status: JobStatus;
  lastProgress: number;
  lastBottleneck: string;
  completedWeek?: number;
  availableWeek?: number;
}

export type ModelResearchCommand =
  | { kind: 'start_model_research'; focus?: ModelResearchFocus }
  | { kind: 'set_model_research_paused'; projectId: string; paused: boolean };

export interface ModelResearchQuote {
  level: number;
  feeCents: number;
  requiredWork: number;
  requiredStaff: number;
  potentialBonusBps: number;
  unlock: string;
}
