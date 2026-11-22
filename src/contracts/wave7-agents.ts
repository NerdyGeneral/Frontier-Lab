/** Multiplier on the existing chance of an avoidable repeated lookup, in basis points. */
export interface PlannerTrait {
  baselineRepeatBps: number;
  currentRepeatBps: number;
}

/** A paid execution handoff continues one admitted customer order and its original evidence. */
export interface AgentRecovery {
  rootJobId: string;
  parentJobId: string;
  rolloutId: string;
  generation: 1 | 2;
  startedWeek: number;
  parentStatus: 'paused' | 'failed';
}
