import type { DesignDomain } from '../contracts/model-design';
import type { ModelChallengeSuiteId, ModelChallengeTier, SystemsChallengeFormat } from '../contracts/model-challenges';
import { SYSTEMS_CHALLENGE_CASES } from './systems-challenges';

const U = 1_000_000_000;
export const CHALLENGE_SKILLS: readonly DesignDomain[] = ['conversation', 'documents', 'coding', 'tools', 'reasoning', 'longContext', 'multimodal'];
export const CHALLENGE_SKILL_NAMES: Record<DesignDomain, string> = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tools', reasoning: 'Reasoning', longContext: 'Long context', multimodal: 'Multimodal' };
export interface ModelChallengeDefinition {
  id: ModelChallengeSuiteId;
  tierId: ModelChallengeTier;
  name: string;
  title: string;
  cases: number;
  workCUw: number;
  researchStaff: number;
  requiredResearch: string;
  previousTier: ModelChallengeTier | null;
  difficulty: readonly [number, number, number];
  reliability: readonly [number, number, number];
  requiredPasses: number;
  minimumPassesPerSkill: number;
  description: string;
  format?: SystemsChallengeFormat;
}
export const MODEL_CHALLENGES: readonly ModelChallengeDefinition[] = [
  { id: 'challenge-applied-1', tierId: 'applied', name: 'Applied challenge', title: 'Applied Researcher', cases: 21, workCUw: 8 * U, researchStaff: 2 * U, requiredResearch: 'R1', previousTier: null,
    difficulty: [4500, 5400, 6200], reliability: [7800, 8300, 8800], requiredPasses: 17, minimumPassesPerSkill: 2,
    description: 'Resolve short customer, document, code and visual tasks using two skills together. Earn Applied Researcher by passing 17 of 21 cases, including at least two of three in every skill.' },
  { id: 'challenge-frontier-1', tierId: 'frontier', name: 'Frontier challenge', title: 'Frontier Fellow', cases: 21, workCUw: 16 * U, researchStaff: 3 * U, requiredResearch: 'R1', previousTier: 'applied',
    difficulty: [6400, 7200, 8000], reliability: [8500, 8900, 9200], requiredPasses: 17, minimumPassesPerSkill: 2,
    description: 'Handle conflicting evidence, dependent tools and long documents. Requires Applied Researcher; earn Frontier Fellow with 17 of 21 cases and at least two passes in every skill.' },
  { id: 'challenge-horizon-1', tierId: 'horizon', name: 'Horizon challenge', title: 'Horizon Laureate', cases: 21, workCUw: 28 * U, researchStaff: 4 * U, requiredResearch: 'R1', previousTier: 'frontier',
    difficulty: [7900, 8500, 9000], reliability: [9000, 9250, 9450], requiredPasses: 17, minimumPassesPerSkill: 2,
    description: 'Combine distant evidence, unfamiliar procedures and ambiguous visual records. Requires Frontier Fellow; earn Horizon Laureate with 17 of 21 cases and at least two passes in every skill.' },
  { id: 'systems-cost-1', tierId: 'systems-cost', format: 'cost', name: 'Cost challenge', title: 'Efficient Systems Engineer', cases: 6, workCUw: 5 * U, researchStaff: U, requiredResearch: 'R1', previousTier: null,
    difficulty: [4300, 5000, 5100], reliability: [8300, 8600, 8700], requiredPasses: 5, minimumPassesPerSkill: 0,
    description: 'Deliver useful support, document and tool results inside explicit serving-compute limits. Pass five of six workloads. Size alone does not determine cost: routing, active parameters and reasoning effort matter.' },
  { id: 'systems-memory-1', tierId: 'systems-memory', format: 'memory', name: 'Memory challenge', title: 'Compact Systems Engineer', cases: 6, workCUw: 5 * U, researchStaff: U, requiredResearch: 'R1', previousTier: null,
    difficulty: [4200, 5000, 5100], reliability: [8300, 8600, 8700], requiredPasses: 5, minimumPassesPerSkill: 0,
    description: 'Keep useful local assistants inside their complete model-and-session memory allowance. Pass five of six workloads; stored experts and persistent state count against the limit.' },
  { id: 'systems-retention-1', tierId: 'systems-retention', format: 'retention', name: 'Retention challenge', title: 'Continuity Systems Engineer', cases: 6, workCUw: 7 * U, researchStaff: 1.5 * U, requiredResearch: 'R1', previousTier: null,
    difficulty: [4700, 5300, 5600], reliability: [8400, 8700, 8800], requiredPasses: 5, minimumPassesPerSkill: 0,
    description: 'Retain early constraints, repair revised facts and finish long-lived cases with bounded memory. Pass five of six workloads; a longer context window alone does not guarantee retention.' },
  { id: 'systems-verification-1', tierId: 'systems-verification', format: 'verification', name: 'Verified completion challenge', title: 'Verified Systems Engineer', cases: 6, workCUw: 8 * U, researchStaff: 1.5 * U, requiredResearch: 'R1', previousTier: null,
    difficulty: [5000, 5500, 5800], reliability: [8600, 8800, 8900], requiredPasses: 5, minimumPassesPerSkill: 0,
    description: 'Check conclusions and tool outcomes before claiming success, while meeting response-time budgets. Pass five of six workloads; extra reasoning has a real serving and latency cost.' },
];
export const CHALLENGE_TASKS: Record<DesignDomain, { support: DesignDomain; titles: readonly [string, string, string] }> = {
  conversation: { support: 'reasoning', titles: ['Resolve an ambiguous customer request', 'Reconcile a customer’s conflicting constraints', 'Explain a decision with several exceptions'] },
  documents: { support: 'longContext', titles: ['Extract a clause and its exception', 'Reconcile clauses in distant sections', 'Resolve contradictory revisions of a contract'] },
  coding: { support: 'reasoning', titles: ['Repair a function against its specification', 'Trace a fault through dependent functions', 'Refactor unfamiliar code while preserving invariants'] },
  tools: { support: 'coding', titles: ['Choose a tool and validate its arguments', 'Sequence tools with dependent outputs', 'Recover a workflow after a partial tool failure'] },
  reasoning: { support: 'documents', titles: ['Connect facts from independent sources', 'Resolve a misleading premise using evidence', 'Verify a conclusion across competing explanations'] },
  longContext: { support: 'reasoning', titles: ['Recall a relevant detail across sections', 'Track changing constraints through a long record', 'Resolve a late exception to an earlier instruction'] },
  multimodal: { support: 'documents', titles: ['Match a diagram to written instructions', 'Reconcile a chart with a conflicting caption', 'Combine visual records and text into a supported conclusion'] },
};
export function modelChallengeDefinition(suiteId: string | undefined): ModelChallengeDefinition | undefined { return MODEL_CHALLENGES.find(tier => tier.id === suiteId); }
export function modelChallengeCaseDefinition(tier: ModelChallengeDefinition, index: number) {
  if (tier.format) return { ...SYSTEMS_CHALLENGE_CASES[tier.format][index], context: 'A fixed systems workload with an explicit operating constraint' };
  const domain = CHALLENGE_SKILLS[index % CHALLENGE_SKILLS.length], stage = Math.floor(index / CHALLENGE_SKILLS.length) as 0 | 1 | 2;
  const task = CHALLENGE_TASKS[domain];
  return { domain, support: task.support, title: task.titles[stage], difficultyBps: tier.difficulty[stage], reliabilityBps: tier.reliability[stage],
    context: tier.tierId === 'applied' ? 'Short, well-scoped evidence' : tier.tierId === 'frontier' ? 'Conflicting evidence with dependent steps' : 'Unfamiliar evidence, distant dependencies and exceptions' };
}

