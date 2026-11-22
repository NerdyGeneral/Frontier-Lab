import type { PlannerTrait } from '../contracts/wave7-agents';
import { PLANNER_CURRICULUM } from '../content/wave7-agents';

export function plannerRepeatMultiplier(model: { planner?: PlannerTrait }): number {
  return model.planner?.currentRepeatBps ?? PLANNER_CURRICULUM.baselineRepeatBps;
}

export function validPlannerTrait(value: unknown): value is PlannerTrait {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const trait = value as PlannerTrait;
  return Object.keys(trait).sort().join() === 'baselineRepeatBps,currentRepeatBps'
    && trait.baselineRepeatBps === PLANNER_CURRICULUM.baselineRepeatBps
    && Number.isSafeInteger(trait.currentRepeatBps)
    && trait.currentRepeatBps >= PLANNER_CURRICULUM.targetRepeatBps
    && trait.currentRepeatBps <= trait.baselineRepeatBps;
}

/** Every descendant targets the original multiplier; repeated curricula cannot compound it. */
export function plannerTarget(anchor?: PlannerTrait): PlannerTrait {
  return { baselineRepeatBps: anchor?.baselineRepeatBps ?? PLANNER_CURRICULUM.baselineRepeatBps, currentRepeatBps: PLANNER_CURRICULUM.targetRepeatBps };
}
