import type { CommandPayload, GameContent, GameState, ModelVersion, ProductOffer } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { RivalCampaign } from '../contracts/market-dynamics';
import type { RivalState } from '../contracts/wave2-market';
import type { ModelDesignSpec } from '../contracts/model-design';
import { DEFAULT_MODEL_CUSTOMIZATION } from '../content/model-customization';
import { getCompanyWorld } from './progression-state';
import { getProductWorkloadMeasure } from './product-workloads';
import { getResearchView } from './research';
import { getTrainingPreview } from './lab-planner';
import { isPaidChallengeReport } from './model-challenges';
import { isCapabilitySuite } from './evaluation-classification';

export const RIVAL_SYSTEMS_RULES = {
  local: { name: 'Compact local service', description: 'Fund working-state research, train a smaller operating system, independently test it and compete for local workloads.' },
  continuity: { name: 'Continuing customer work', description: 'Fund state compression, selective memory, data and repair; train and test persistent systems before offering continuing casework.' },
  verified: { name: 'Checked reasoning service', description: 'Fund reasoning search and a checker, license reasoning examples, then train and independently evaluate a system for verified analysis.' },
} as const;
export function rivalSystemsFocus(state: Readonly<GameState>, style: RivalState['style']): NonNullable<RivalCampaign['systems']>['focus'] | null {
  const world = getCompanyWorld(state);
  if (!world) return null;
  return style === 'efficient' ? 'local' : style === 'enterprise' ? world.favoredWorkload === 'local' ? 'local' : 'continuity'
    : world.favoredWorkload === 'continuity' ? 'continuity' : 'verified';
}
export function rivalSystemsDesign(focus: NonNullable<RivalCampaign['systems']>['focus']): ModelDesignSpec {
  if (focus === 'local') return { name: 'Local operating model', mode: 'foundation', family: 'compact', parameterMillions: 4000,
    sparsityBps: 0, computeBudgetCUw: 240 * U, dataMix: { conversation: 15, documents: 20, coding: 50, tools: 15, reasoning: 0, longContext: 0, multimodal: 0 },
    system: { version: 1, kind: 'stateful', stateSlots: 16, memory: 'fixed', repair: false } };
  if (focus === 'continuity') return { name: 'Continuity operating model', mode: 'foundation', family: 'compact', parameterMillions: 8000,
    sparsityBps: 0, computeBudgetCUw: 640 * U, dataMix: { conversation: 10, documents: 35, coding: 5, tools: 5, reasoning: 0, longContext: 45, multimodal: 0 },
    customization: { ...DEFAULT_MODEL_CUSTOMIZATION, contextWindow: 'extended' },
    system: { version: 1, kind: 'stateful', stateSlots: 256, memory: 'selective', repair: true } };
  return { name: 'Checked reasoning model', mode: 'foundation', family: 'compact', parameterMillions: 8000,
    sparsityBps: 0, computeBudgetCUw: 900 * U, dataMix: { conversation: 15, documents: 5, coding: 20, tools: 20, reasoning: 40, longContext: 0, multimodal: 0 },
    customization: { ...DEFAULT_MODEL_CUSTOMIZATION, objective: 'reasoning' },
    system: { version: 1, kind: 'adaptive', maxPasses: 4, search: 'branching', verifier: 'independent', stopping: 'confidence' } };
}
export function rivalSystemModelFits(state: Readonly<GameState>, campaign: RivalCampaign, model: ModelVersion): boolean {
  if (!campaign.systems || !model.modelDesign?.system) return false;
  const expected = campaign.systems.focus === 'verified' ? 'adaptive' : 'stateful';
  if (model.modelDesign.system.spec.kind !== expected) return false;
  const evidence = Object.values(state.slices.models.reports).some(report => report.modelId === model.id && isCapabilitySuite(report.suiteId) && isPaidChallengeReport(state, report, state.week));
  const measure = getProductWorkloadMeasure(model, { version: 1, id: campaign.systems.focus, selectedWeek: state.week });
  return evidence && !!measure && measure.fitBps === 10000;
}
/** No rival gets free knowledge, model scores, datasets, staff, capacity or customers. */
export function proposeRivalSystemsStep(state: Readonly<GameState>, rival: RivalState, product: ProductOffer, content: GameContent,
  propose: (payload: CommandPayload, label: string, speculative?: boolean) => boolean): boolean {
  const campaign = rival.campaign, focus = campaign?.systems?.focus;
  if (!focus) return false;
  const owner = rival.companyId, fleet = state.slices.compute.fleets[owner];
  const models = Object.values(state.slices.models.versions).filter(model => model.companyId === owner), live = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  const fitted = models.filter(model => rivalSystemModelFits(state, campaign, model)).sort((a, b) => (b.createdWeek ?? 0) - (a.createdWeek ?? 0))[0];
  if (fitted && fitted.id !== live.id && propose({ kind: 'upgrade_product', productId: product.id, modelId: fitted.id }, 'Released its independently evaluated operating-system candidate.')) return true;
  if (fitted?.id === live.id && product.workload?.id !== focus && propose({ kind: 'configure_product_offer', productId: product.id, name: product.name, workload: focus }, `Committed its tested ${RIVAL_SYSTEMS_RULES[focus].name.toLowerCase()} to matching customers.`)) return true;
  const candidate = models.find(model => model.modelDesign?.system && !Object.values(state.slices.models.reports).some(report => report.modelId === model.id && isCapabilitySuite(report.suiteId)
    && isPaidChallengeReport(state, report, state.week)) && model.trainingRunId && state.slices.models.trainingRuns[model.trainingRunId]?.status === 'complete');
  if (candidate && propose({ kind: 'evaluate_model', modelId: candidate.id, suiteId: 'expanded-capabilities-1' }, 'Funded an independent capability test for its finished AI system.')) return true;
  if (fitted?.id === live.id && product.workload?.id === focus) return false;
  const goals = focus === 'local' ? ['A5'] : focus === 'continuity' ? ['A8', 'M4'] : ['A12', 'M8'];
  const needed = new Set<string>();
  const collect = (id: string) => { if (needed.has(id) || (state.slices.research.completedByCompany[owner] ?? []).includes(id)) return; for (const dependency of content.research.find(method => method.id === id)?.requires ?? []) collect(dependency); needed.add(id); };
  goals.forEach(collect);
  const available = getResearchView(state, owner, content);
  const next = [...needed].find(id => available.some(method => method.id === id && method.status === 'available'));
  if (next) {
    const role = content.research.find(method => method.id === next)!.role;
    if (role === 'data' && !Object.values(state.slices.company.staff).some(member => member.companyId === owner && member.role === 'data'))
      if (propose({ kind: 'hire_staff', role: 'data' }, 'Recruited a paid data engineer for its announced systems program.', true)) return true;
    if (propose({ kind: 'start_research', researchId: next }, `Funded ${next} toward ${RIVAL_SYSTEMS_RULES[focus].name.toLowerCase()}.`, true)) return true;
  }
  if (needed.size) return false;
  if (focus === 'continuity') {
    const starter = Object.values(state.slices.data.packets).filter(item => item.companyId === owner && item.catalogId === 'scenario-corpus' && item.prepared)
      .sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))[0];
    if (starter && starter.qualityBps < 9000) return propose({ kind: 'curate_data', packetId: starter.id }, 'Funded better document evidence before building a system that promises continuing casework.', true);
  }
  const datasets = focus === 'verified' ? ['advanced-reasoning-1', 'advanced-broad-1', 'advanced-broad-2']
    : focus === 'continuity' ? ['advanced-longContext-1'] : [];
  for (const catalogId of datasets) {
    const packet = Object.values(state.slices.data.packets).filter(item => item.companyId === owner && item.catalogId === catalogId)
      .sort((a, b) => Number(b.prepared) - Number(a.prepared) || b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))[0];
    if (!packet) return propose({ kind: 'buy_data', catalogId }, 'Licensed the specialist and cross-domain evidence required by its announced AI system.', true);
    if (!packet.prepared) return propose({ kind: 'prepare_data', packetId: packet.id }, 'Preparing its paid specialist corpus before training.', true);
    if (packet.qualityBps < 9500) return propose({ kind: 'curate_data', packetId: packet.id }, 'Funded data curation so the earned model can meet its advertised workload, not just its design target.', true);
  }
  const base = models.find(model => !model.runtimeVariant && model.id === campaign.startingModelId) ?? models.find(model => !model.runtimeVariant);
  const packets = Object.values(state.slices.data.packets).filter(item => item.companyId === owner && item.prepared && item.readyUnits > 0);
  if (!base || !packets.length) return false;
  const spec = rivalSystemsDesign(focus), payload: Extract<CommandPayload, { kind: 'start_training' }> = { kind: 'start_training', baseModelId: base.id,
    packetId: packets[0].id, packetIds: packets.map(item => item.id).slice(0, 32), recipeId: 'custom-model-foundation', modelDesign: spec };
  const preview = getTrainingPreview(state, owner, payload, content);
  if (preview.reason) return false;
  const servingMemory = Object.values(state.slices.products.offers).filter(offer => offer.companyId === owner && offer.status === 'active')
    .reduce((sum, offer) => sum + state.slices.models.versions[state.slices.products.deployments[offer.deploymentId].modelId].residentMU, 0);
  if (preview.memoryMU + servingMemory > fleet.memoryMU && fleet.cloudCU < content.firstSale.maxCloudCU)
    return propose({ kind: 'set_cloud_capacity', cu: Math.min(content.firstSale.maxCloudCU, fleet.cloudCU + 8 * U) }, 'Funded connected memory before starting its operating-system candidate.', true);
  return propose(payload, `Funded a new ${focus === 'verified' ? 'adaptive reasoning' : 'persistent-state'} foundation with a frozen compute budget and licensed evidence.`, true);
}
