import type { AISystemKind, AISystemSpec } from '../contracts/ai-systems';
import type { ResearchDefinition } from '../contracts/types';

const U = 1_000_000_000;
export const AI_SYSTEM_RESEARCH_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'] as const;
export const AI_SYSTEM_DEFAULTS: { [K in AISystemKind]: Extract<AISystemSpec, { kind: K }> } = {
  experts: { version: 1, kind: 'experts', experts: 4, activeExperts: 1, routing: 'uniform', specialization: 'coding' },
  stateful: { version: 1, kind: 'stateful', stateSlots: 16, memory: 'fixed', repair: false },
  adaptive: { version: 1, kind: 'adaptive', maxPasses: 2, search: 'single', verifier: 'self', stopping: 'fixed' },
};
export const AI_SYSTEM_OPTIONS: { kind: AISystemKind; name: string; description: string; researchId: string }[] = [
  { kind: 'experts', name: 'Expert network', researchId: 'A1', description: 'Train several specialists around a shared core. Route each request to a few experts; all weights remain resident, and uneven routing wastes work.' },
  { kind: 'stateful', name: 'Persistent-state model', researchId: 'A5', description: 'Keep a bounded state between requests. More slots retain more facts but consume memory for every account; compression and repair change what survives.' },
  { kind: 'adaptive', name: 'Adaptive reasoning', researchId: 'A9', description: 'Spend extra passes searching and checking an answer. Stronger verification costs inference work, memory and response time.' },
];
export const AI_SYSTEM_RESEARCH_GROUPS = [
  { id: 'experts', name: 'Expert engineering', short: 'Experts', ids: ['A1', 'A2', 'A3', 'A4'] },
  { id: 'stateful', name: 'Persistent state', short: 'State', ids: ['A5', 'A6', 'A7', 'A8'] },
  { id: 'adaptive', name: 'Adaptive reasoning', short: 'Reasoning', ids: ['A9', 'A10', 'A11', 'A12'] },
] as const;
/** Discoveries unlock choices in future paid foundations, never free retroactive upgrades. */
export const AI_SYSTEM_RESEARCH: ResearchDefinition[] = [
  { id: 'A1', name: 'Expert decomposition', requires: ['R3', 'R14'], feeCents: 700_000, role: 'ml', staffWeeks: 4, workCUw: 12 * U, implemented: true,
    description: 'Unlock four-expert networks with one or two active experts and a chosen specialty. Smaller active work lowers inference costs, while every expert occupies memory. Requires sparse-compatible fast fabric.' },
  { id: 'A2', name: 'Learned expert routing', requires: ['A1', 'R1'], feeCents: 480_000, role: 'research', staffWeeks: 3, workCUw: 10 * U, implemented: true,
    description: 'Unlock learned routing. Send requests to a more suitable expert and reduce routing overhead, while retaining the cost of training the router and experts.' },
  { id: 'A3', name: 'Expert load balancing', requires: ['A2', 'R8'], feeCents: 800_000, role: 'ml', staffWeeks: 4, workCUw: 16 * U, implemented: true,
    description: 'Unlock balanced routing. Reduce overloaded-expert waste and improve reliable specialist handoffs in future networks; more active experts still cost inference work.' },
  { id: 'A4', name: 'Expandable expert banks', requires: ['A3', 'R12'], feeCents: 1_400_000, role: 'research', staffWeeks: 6, workCUw: 28 * U, implemented: true,
    description: 'Unlock eight- and sixteen-expert banks and up to four active experts. Larger banks raise specialty potential but require more evidence, memory and router training.' },
  { id: 'A5', name: 'Recurrent working state', requires: ['R3', 'R6'], feeCents: 320_000, role: 'ml', staffWeeks: 3, workCUw: 6 * U, implemented: true,
    description: 'Unlock persistent-state foundations with sixteen memory slots. Retain bounded information between requests and reduce repeated attention work, at a cost in static task breadth and account memory.' },
  { id: 'A6', name: 'State compression', requires: ['A5', 'R2'], feeCents: 450_000, role: 'data', staffWeeks: 3, workCUw: 8 * U, implemented: true,
    description: 'Unlock compressed state and sixty-four slots. Compressing each slot reduces account memory but can discard details; training and evaluation still determine actual recall.' },
  { id: 'A7', name: 'Selective memory', requires: ['A6', 'M4'], feeCents: 850_000, role: 'research', staffWeeks: 5, workCUw: 16 * U, implemented: true,
    description: 'Unlock selective retention and 256 slots. Keep useful facts longer in a fixed budget, trading more training work and account memory for long-running retention.' },
  { id: 'A8', name: 'State contradiction repair', requires: ['A7', 'R5A'], feeCents: 1_000_000, role: 'research', staffWeeks: 5, workCUw: 20 * U, implemented: true,
    description: 'Unlock state repair. Reconcile conflicting retained facts and improve reliability, while paying extra inference work and evidence costs. Existing models keep their original state protocol.' },
  { id: 'A9', name: 'Reasoning work budgets', requires: ['R1', 'R4'], feeCents: 280_000, role: 'research', staffWeeks: 3, workCUw: 6 * U, implemented: true,
    description: 'Unlock adaptive reasoning foundations with two answer passes and self-checking. Spend additional work to improve verified completion; extra passes increase serving costs and latency.' },
  { id: 'A10', name: 'Candidate search', requires: ['A9', 'M8'], feeCents: 650_000, role: 'research', staffWeeks: 4, workCUw: 12 * U, implemented: true,
    description: 'Unlock branching candidate search and four- or eight-pass budgets. Explore more alternatives at a larger compute cost; strong trained reasoning is still necessary to find a useful answer.' },
  { id: 'A11', name: 'Independent verification', requires: ['A10', 'R5A'], feeCents: 950_000, role: 'ml', staffWeeks: 5, workCUw: 20 * U, implemented: true,
    description: 'Unlock a separately trained checker within the system. Independent checking improves verified completion, but its weights, evidence and inference work are included in the paid design.' },
  { id: 'A12', name: 'Confidence stopping', requires: ['A11', 'R12A'], feeCents: 1_300_000, role: 'research', staffWeeks: 6, workCUw: 24 * U, implemented: true,
    description: 'Unlock confidence-based stopping. Stop easier requests early to reduce average work and latency, accepting a small completion tradeoff against always using the full budget.' },
];
