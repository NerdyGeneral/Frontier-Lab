import assert from 'node:assert/strict';
import { CONTENT } from '../../src/content/catalog';
import { POLICY_DATA_ID, POLICY_HOLDOUT_RULES } from '../../src/content/wave11-policy';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import type { GameState, StaffRole } from '../../src/contracts/types';
import type { PolicyApproach } from '../../src/contracts/wave11-policy';
import { advanceWeek, validateState } from '../../src/core/engine';
import { createPlayerOnlyState } from './player-only';
import { NaturalBusinessCampaign } from './wave5-business';

let scenario: GameState | undefined;
/** Isolated earned-resource tests: only the initial model/research/capital are scenario fixtures. */
export function createPolicyScenario(): GameState {
  if (scenario) return structuredClone(scenario);
  const first = advanceWeek(createPlayerOnlyState()); assert.ok(first.accepted, first.reason?.message);
  const state = first.state, companyId = state.playerCompanyId;
  state.slices.company.companies[companyId].cashCents = 1_000_000_000;
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.status = 'evaluated'; model.scenarioStart = true;
  model.capabilityBps = { conversation: 7000, documents: 6500, coding: 6500, tools: 6000 };
  model.reliabilityBps = 9600; model.behavior = { confidentErrorBps: 1000, falseRefusalBps: 700 };
  model.evaluationReportId = 'policy-scenario-report';
  state.slices.models.reports[model.evaluationReportId] = { id: model.evaluationReportId, companyId, modelId: model.id,
    week: 0, scenarioStart: true, heldOut: true, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps,
    basicChatEligible: true, passedCases: 20, cases: Array.from({ length: 20 }, (_, index) => ({ id: 'policy-scenario-case-' + index, domain: 'conversation' as const, difficultyBps: 0, passed: true })) };
  // This historical isolated policy scenario has neither a commissioned site nor a buyer shipment.
  const definitions = CONTENT.research.filter(item => item.implemented && (item.id.startsWith('R') || ['S1', 'S2', 'S3', 'S4'].includes(item.id))), researchIds = definitions.map(item => item.id).sort();
  state.slices.research.completedByCompany[companyId] = researchIds; state.slices.research.completed = [...researchIds];
  for (const definition of definitions) {
    const id = 'policy-scenario-' + definition.id;
    state.slices.research.projects[id] = { id, companyId, researchId: definition.id, startedWeek: 0, completedWeek: 0, availableWeek: 1,
      requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
      role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  assert.deepEqual(validateState(state), []);
  const run = new NaturalBusinessCampaign(state, 'policy-scenario');
  run.founder('ml'); run.queue({ kind: 'set_cloud_capacity', cu: 64 * U });
  for (const role of ['ml', 'data', 'research', 'commercial', 'infrastructure'] as StaffRole[]) run.queue({ kind: 'hire_staff', role });
  run.step(4); run.queue({ kind: 'allocate_compute', serving: 48 * U, development: 16 * U, research: 0 }); run.step();
  assert.deepEqual(validateState(run.state), []); scenario = structuredClone(run.state);
  return structuredClone(scenario);
}

export interface PolicyCandidateFixture { state: GameState; modelId: string; baseModelId: string; packetId: string }
const candidates = new Map<string, PolicyCandidateFixture>();

/** All paired data, preparation, training, capability evidence and optional holdouts below are paid ordinary commands. */
export function policyCandidate(options: { approach?: PolicyApproach; reported?: boolean } = {}): PolicyCandidateFixture {
  const approach = options.approach ?? 'boundary-discrimination', key = approach + ':' + !!options.reported;
  const cached = candidates.get(key); if (cached) return structuredClone(cached);
  const run = new NaturalBusinessCampaign(createPolicyScenario(), 'policy-candidate-' + approach);
  const packetId = run.prepare(POLICY_DATA_ID), baseModelId = CONTENT.seedModel.id;
  const recipeId = approach === 'boundary-discrimination' ? 'policy-boundary-discrimination' : 'policy-conservative-refusal';
  const modelId = run.train({ baseModelId, packetId, recipeId });
  run.evaluate(modelId, 'expanded-capabilities-1');
  if (options.reported) run.evaluate(modelId, POLICY_HOLDOUT_RULES.suiteId);
  assert.deepEqual(validateState(run.state), []);
  const result = { state: run.state, modelId, baseModelId, packetId };
  candidates.set(key, structuredClone(result)); return structuredClone(result);
}
