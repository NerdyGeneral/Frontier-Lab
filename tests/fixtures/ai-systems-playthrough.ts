import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AISystemSpec } from '../../src/contracts/ai-systems';
import type { GameState } from '../../src/contracts/types';
import type { SystemsBriefId } from '../../src/contracts/systems-briefs';
import type { SystemsChallengeSuiteId } from '../../src/contracts/model-challenges';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { CONTENT } from '../../src/content/catalog';
import { AI_SYSTEM_RESEARCH_IDS } from '../../src/content/ai-systems';
import { deserializeState } from '../../src/core/snapshot';
import { getComputePools } from '../../src/modules/compute-pools';
import { DEFAULT_MODEL_DESIGN } from '../../src/modules/model-design';
import { getAISystemMetrics } from '../../src/modules/ai-systems';
import { getModelResearchLevel } from '../../src/modules/model-research';
import { getModelChallengeCaseViews } from '../../src/modules/model-challenges';
import { getSystemsBriefOffers, getSystemsBriefOrders } from '../../src/modules/systems-briefs';
import { NaturalBusinessCampaign } from './wave5-business';

export interface AISystemsStage { stage: string; week: number; cashCents: number; detail?: unknown }

/** A continuation of a published company. Every discovery, hire, training run,
 * test and delivery uses ordinary commands; no balances or model scores change
 * outside the game engine. This proves feasibility, not an optimal speedrun. */
export function playAISystemsCampaign(report: (stage: AISystemsStage, state: GameState) => void = () => {}) {
  const root = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
  const imported = deserializeState(readFileSync(join(root, 'systems-036-active-published.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? undefined : imported.error);
  const lab = new NaturalBusinessCampaign(imported.state, 'ai-systems-proof');
  const mark = (stage: string, detail?: unknown) => report({ stage, week: lab.week, cashCents: lab.cash, ...(detail === undefined ? {} : { detail }) }, lab.state);
  mark('Published company imported');
  lab.queue({ kind: 'allocate_compute', serving: 144 * U, development: 24 * U, research: 24 * U });
  lab.founder('research'); lab.step();
  lab.hire('research', 3);
  const discover = (id: string) => {
    if (lab.research.includes(id)) return;
    const definition = CONTENT.research.find(node => node.id === id)!;
    assert.ok(definition, 'Research must exist: ' + id);
    for (const prerequisite of definition.requires) discover(prerequisite);
    lab.founder(definition.role); lab.step(); lab.discover(id);
    mark('Discovery earned', { id, name: definition.name });
  };
  for (const id of AI_SYSTEM_RESEARCH_IDS) discover(id);
  lab.founder('research'); lab.step();
  while (getModelResearchLevel(lab.state, lab.state.playerCompanyId) < 2) {
    const level = getModelResearchLevel(lab.state, lab.state.playerCompanyId) + 1;
    lab.queue({ kind: 'start_model_research', focus: 'balanced' });
    lab.until(state => getModelResearchLevel(state, state.playerCompanyId) >= level, 40, 'Architecture level ' + level);
  }
  const fabricPool = getComputePools(lab.state).find(pool => pool.ownership === 'owned' && pool.capacityCU >= 16 * U)!;
  assert.ok(fabricPool, 'The published company has compatible owned capacity.');
  if (!fabricPool.fastFabric) {
    lab.queue({ kind: 'install_fast_fabric', location: fabricPool.location });
    lab.until(state => getComputePools(state).some(pool => pool.location === fabricPool.location && pool.fastFabric), 30, 'Paid fast fabric');
  }
  const packetId = lab.prepare('advanced-broad-1', 9500);
  mark('Research and infrastructure ready');
  const designs: Array<{ label: string; size: number; budget: number; system: AISystemSpec; suite: SystemsChallengeSuiteId; brief: SystemsBriefId }> = [
    { label: 'Expert service network', size: 4000, budget: 320,
      system: { version: 1, kind: 'experts', experts: 8, activeExperts: 1, routing: 'balanced', specialization: 'coding' },
      suite: 'systems-cost-1', brief: 'efficient-experts' },
    { label: 'Local memory assistant', size: 2000, budget: 160,
      system: { version: 1, kind: 'stateful', stateSlots: 16, memory: 'fixed', repair: false },
      suite: 'systems-memory-1', brief: 'bounded-memory' },
    { label: 'Case continuity model', size: 8000, budget: 800,
      system: { version: 1, kind: 'stateful', stateSlots: 256, memory: 'selective', repair: true },
      suite: 'systems-retention-1', brief: 'continuity-desk' },
    { label: 'Verified reasoning model', size: 8000, budget: 800,
      system: { version: 1, kind: 'adaptive', maxPasses: 4, search: 'branching', verifier: 'independent', stopping: 'confidence' },
      suite: 'systems-verification-1', brief: 'verified-analysis' },
  ];
  const models: Array<{ modelId: string; suiteId: SystemsChallengeSuiteId; briefId: SystemsBriefId }> = [];
  for (const design of designs) {
    lab.founder('ml'); lab.step();
    const modelId = lab.train({ baseModelId: CONTENT.seedModel.id, packetId, packetIds: [packetId], recipeId: 'custom-model-foundation',
      modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN), name: design.label, mode: 'foundation', family: 'compact',
        parameterMillions: design.size, computeBudgetCUw: design.budget * U, system: design.system,
        dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 } } });
    const model = lab.state.slices.models.versions[modelId];
    mark('System trained', { modelId, label: design.label, metrics: getAISystemMetrics(model), scores: model.capabilityBps,
      advanced: model.advancedCapabilities, reliabilityBps: model.reliabilityBps });
    lab.founder('research'); lab.step();
    lab.evaluate(modelId, 'expanded-capabilities-1'); lab.evaluate(modelId, design.suite);
    const result = Object.values(lab.state.slices.models.reports).find(item => item.modelId === modelId && item.suiteId === design.suite)!;
    assert.ok(result.challenge?.passed, JSON.stringify({ label: design.label, cases: getModelChallengeCaseViews(model, design.suite) }));
    models.push({ modelId, suiteId: design.suite, briefId: design.brief });
    mark('Systems challenge passed', { modelId, suiteId: design.suite, passedCases: result.passedCases });
    lab.until(state => getSystemsBriefOffers(state).some(offer => offer.briefId === design.brief && offer.available), 30, design.label + ' customer offer');
    const offer = getSystemsBriefOffers(lab.state).find(item => item.briefId === design.brief && item.available)!;
    lab.queue({ kind: 'accept_systems_brief', offerId: offer.id, modelId });
    lab.until(state => getSystemsBriefOrders(state).some(order => order.id === offer.id && order.status === 'completed'), 7, design.label + ' paid delivery');
    mark('Customer delivery paid', { offerId: offer.id, briefId: design.brief, feeCents: offer.feeCents });
  }
  return { lab, models };
}
