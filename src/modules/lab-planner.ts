import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from '../core/model-customization-version';
import type { ModelDesignSpec } from '../contracts/model-design';
import type { AdvancedScores } from '../contracts/advanced-skills';
import { advancedTrainingOutcome } from './advanced-skills';
import { buildCustomTrainingPlan, validateCustomTrainingOptions, isCustomTrainingRecipe } from './model-design-training';
import { getModelDesignForecast, FAMILY_SERVING_MULTIPLIER } from './model-design';
import { TRAINING_WORKSPACES } from '../content/model-designs';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { DataPacket, GameContent, GameState, ModelVersion, Rejection, TrainingRun } from '../contracts/types';
import type { CapabilityScores, CorpusEvidence, ModelBehavior, TrainingPlan, TrainingProfile, TrainingWorkspace, TrainingRecipe } from '../contracts/wave2-lab';
import { CONTENT } from '../content/catalog';
import { getAvailableRoleCapacity } from './workforce';
import { FAMILY_DESIGNS, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, mulDiv } from '../core/math';
import { finiteOutcome } from './lab-math';
import { customizationBehaviorOutcome } from './model-customization';
import { STRATEGY_CONTENT_VERSION } from '../core/strategy-version';
import { hasResearch } from './research';
import { SPARSE_DESIGN } from '../content/wave4-research';
import { hasCapabilityEvaluation, inheritedModelRights, modelWorkBps } from './model-runtime';
import { getCompatibleComputePools } from './compute-pools';
import { trainingDeduplicationReceipt } from './data-quality';
import { getAdapterTrainingReceipt, validateAdapterTrainingOption } from './adapter-bank';
import { plannerTarget } from './agent-planning';
import type { PlannerTrait } from '../contracts/wave7-agents';
import type { ModelPolicy } from '../contracts/wave11-policy';
import { POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS, POLICY_RESEARCH_IDS } from '../content/wave11-policy';
import { createPolicyTrainingReceipt, policyEvidenceFromPackets, policyTrainingOutcome } from './policy-training';
import type { ReplayTrainingChoice, TrainingReplayReceipt } from '../contracts/wave15-replay';
import { applyReplayOutcome, createTrainingReplayReceipt, replayAdmissionIdentity, replayChoiceRejection, validateReplayTrainingOption } from './replay-curriculum';
import type { TrainingCurriculumChoice, TrainingCurriculumReceipt } from '../contracts/wave17-curriculum';
import { applyCurriculumOutcome, createTrainingCurriculumReceipt, curriculumAdmissionIdentity, curriculumChoiceRejection, validateCurriculumTrainingOption } from './training-curriculum';
import { createSyntheticTrainingReceipt, validateSyntheticTraining } from './synthetic-training';

export const DOMAINS = ['conversation', 'documents', 'coding', 'tools'] as const;
export const BASE_BEHAVIOR: ModelBehavior = { confidentErrorBps: 1000, falseRefusalBps: 700 };
const zeros = (): CapabilityScores => ({ conversation: 0, documents: 0, coding: 0, tools: 0 });
export interface TrainingOptions { modelDesign?: ModelDesignSpec; baseModelId: string; packetId: string; packetIds?: string[]; recipeId?: string; profile?: TrainingProfile; workspace?: TrainingWorkspace; continueFromParent?: true; automatedCheckpoints?: boolean; teacherModelId?: string; teacherDomain?: keyof ModelVersion['capabilityBps']; architecture?: 'dense' | 'sparse'; asAdapter?: boolean; replay?: ReplayTrainingChoice; curriculum?: TrainingCurriculumChoice }
export interface TrainingPreview {
  advancedCapabilityRange?: { minimum: AdvancedScores; maximum: AdvancedScores };
  recipeId: string; recipeName: string; workCUw: number; memoryMU: number; preparationStaff: number;
  feeCents: number; checkpointOverheadWork: number;
  capabilityRange: { minimum: CapabilityScores; maximum: CapabilityScores };
  reliabilityRange: { minimum: number; maximum: number };
  behavior?: ModelBehavior; plannerRepeatBps?: number;
  policy?: { distinctPairs: number; qualityBps: number; unsafeComplianceBps: number; falseRefusalBps: number };
  replay?: TrainingReplayReceipt;
  curriculum?: TrainingCurriculumReceipt;
  corpus: CorpusEvidence; notes: string[]; reason?: Rejection;
}
export function packetOwnedBy(packet: DataPacket, companyId: string, playerCompanyId: string): boolean {
  return (packet.companyId ?? playerCompanyId) === companyId;
}
export function packetSources(packet: DataPacket): string[] {
  // Old snapshots lacked source IDs. Their content hash still prevents renamed copies from multiplying evidence.
  return packet.sourceIds?.length ? [...new Set(packet.sourceIds)].sort() : ['legacy-' + canonicalStateHash({ rawUnits: packet.rawUnits, coverageBps: packet.coverageBps, rights: packet.rights })];
}
export function corpusFromPackets(packets: readonly DataPacket[]): CorpusEvidence {
  const sources = new Map<string, DataPacket>();
  for (const packet of [...packets].sort((a, b) => b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))) {
    for (const sourceId of packetSources(packet)) if (!sources.has(sourceId)) sources.set(sourceId, packet);
  }
  const relevantUnits = zeros(), qualityNumerator = zeros();
  let distinctFixed = 0, broadFixed = 0, behaviorFixed = 0, behaviorQualityNumerator = 0;
  const rights = { hosted: true, weights: true, feedback: true };
  const fingerprints: unknown[] = [];
  for (const [sourceId, packet] of [...sources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = packetSources(packet).length;
    const units = mulDiv(packet.prepared ? packet.readyUnits : 0, U, parts);
    const behavior = mulDiv(packet.prepared ? Math.min(packet.readyUnits, packet.behaviorUnits ?? packet.readyUnits) : 0, U, parts);
    const broad = mulDiv(packet.prepared ? (packet.broadUnits ?? 0) : 0, U, parts);
    distinctFixed = checkedAdd(distinctFixed, units); broadFixed = checkedAdd(broadFixed, broad); behaviorFixed = checkedAdd(behaviorFixed, behavior);
    behaviorQualityNumerator = checkedAdd(behaviorQualityNumerator, mulDiv(behavior, packet.qualityBps, 10000));
    for (const domain of DOMAINS) {
      const relevant = mulDiv(units, packet.coverageBps[domain], 10000);
      relevantUnits[domain] = checkedAdd(relevantUnits[domain], relevant);
      qualityNumerator[domain] = checkedAdd(qualityNumerator[domain], mulDiv(relevant, packet.qualityBps, 10000));
    }
    rights.hosted &&= packet.rights.hosted; rights.weights &&= packet.rights.weights; rights.feedback &&= packet.rights.feedback;
    fingerprints.push({ sourceId, units, behavior, broad, qualityBps: packet.qualityBps, coverageBps: packet.coverageBps, rights: packet.rights });
  }
  const qualityBps = zeros();
  for (const domain of DOMAINS) qualityBps[domain] = relevantUnits[domain] ? mulDiv(qualityNumerator[domain], 10000, relevantUnits[domain], 'nearest') : 0;
  return {
    sourceIds: [...sources.keys()].sort(), packetIds: [...new Set(packets.map(packet => packet.id))].sort(),
    distinctUnits: Math.floor(distinctFixed / U), broadUnits: Math.floor(broadFixed / U), relevantUnits, qualityBps,
    behaviorUnits: Math.floor(behaviorFixed / U), behaviorQualityBps: behaviorFixed ? mulDiv(behaviorQualityNumerator, 10000, behaviorFixed, 'nearest') : 0,
    rights, fingerprint: 'corpus-' + canonicalStateHash(fingerprints),
  };
}
export function getCorpusEvidence(state: Readonly<GameState>, companyId: string, packetIds: readonly string[]): CorpusEvidence {
  const packets = [...new Set(packetIds)].map(id => state.slices.data.packets[id]).filter(packet => packet && packetOwnedBy(packet, companyId, state.playerCompanyId));
  return corpusFromPackets(packets);
}
export function lineageId(state: Readonly<GameState>, model: ModelVersion): string | null {
  const seen = new Set<string>(); let current = model;
  while (true) {
    if (seen.has(current.id)) return null; seen.add(current.id);
    const run = current.trainingRunId && state.slices.models.trainingRuns[current.trainingRunId];
    if (run && run.plan) return run.plan.lineageId;
    if (!current.parentModelId) return current.id;
    const parent = state.slices.models.versions[current.parentModelId];
    if (!parent || parent.companyId !== model.companyId) return null;
    current = parent;
  }
}
function anchorModel(state: Readonly<GameState>, model: ModelVersion): ModelVersion {
  const seen = new Set<string>(); let current = model;
  while (current.parentModelId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = state.slices.models.versions[current.parentModelId];
    if (!parent || parent.companyId !== model.companyId) break;
    current = parent;
  }
  return current;
}
function nominalRecipe(options: TrainingOptions, content: GameContent): TrainingRecipe {
  return TRAINING_RECIPES.find(recipe => recipe.id === (options.recipeId ?? content.firstTraining.id)) ?? TRAINING_RECIPES[0];
}
export function ordinaryTrainingIdentity(state: Readonly<GameState>, companyId: string, options: TrainingOptions, recipe: TrainingRecipe, corpus: CorpusEvidence): string {
  const base = state.slices.models.versions[options.baseModelId];
  return 'training-identity-' + canonicalStateHash({
    companyId, lineage: recipe.kind === 'foundation' ? recipe.family : (base ? lineageId(state, base) : options.baseModelId),
    recipe: recipe.id, evidence: corpus.fingerprint,
    targetTier: options.profile === 'ambitious' && ['adaptation', 'foundation'].includes(recipe.kind) ? 'ambitious' : 'standard',
    ...((options.architecture ?? (recipe.kind === 'foundation' ? 'dense' : base?.architecture)) === 'sparse' ? { architecture: 'sparse' } : {}),
    ...(recipe.kind === 'distillation' ? { teacher: options.teacherModelId, domain: options.teacherDomain } : {}),
  });
}
export function trainingIdentity(state: Readonly<GameState>, companyId: string, options: TrainingOptions, recipe: TrainingRecipe, corpus: CorpusEvidence): string {
  const ordinary = ordinaryTrainingIdentity(state, companyId, options, recipe, corpus);
  if (options.replay !== undefined && !replayChoiceRejection(options.replay))
    return replayAdmissionIdentity(ordinary, options.replay, getCorpusEvidence(state, companyId, options.replay.packetIds));
  if (options.curriculum !== undefined && !curriculumChoiceRejection(options.curriculum))
    return curriculumAdmissionIdentity(ordinary, options.curriculum, options.curriculum.tracks.map(track => getCorpusEvidence(state, companyId, track.packetIds)) as [CorpusEvidence, CorpusEvidence]);
  return ordinary;
}
export function existingRunTrainingIdentity(state: Readonly<GameState>, run: TrainingRun, content: GameContent = CONTENT): string {
  if (run.plan) return run.plan.identity;
  const current = state.slices.data.packets[run.packetId];
  const evidence = { ...run.evidence, companyId: run.companyId, sourceIds: run.evidence.sourceIds ?? current?.sourceIds };
  const recipe = TRAINING_RECIPES.find(item => item.id === run.recipeId) ?? TRAINING_RECIPES.find(item => item.id === content.firstTraining.id) ?? TRAINING_RECIPES[0];
  return trainingIdentity(state, run.companyId, { baseModelId: run.baseModelId, packetId: run.packetId, recipeId: run.recipeId }, recipe, corpusFromPackets([evidence]));
}
export interface PlannedTraining { plan: TrainingPlan; recipe: TrainingRecipe; requiredWork: number; requiredMemory: number; anchorScores: CapabilityScores; anchorReliabilityBps: number; evidence: DataPacket }
export function buildTrainingPlan(state: Readonly<GameState>, companyId: string, options: TrainingOptions, content: GameContent = CONTENT, saveAdjustments = false): PlannedTraining {
  if (options.modelDesign) return buildCustomTrainingPlan(state, companyId, options, content);
  const recipe = nominalRecipe(options, content), base = state.slices.models.versions[options.baseModelId] ?? content.seedModel;
  const corpus = getCorpusEvidence(state, companyId, options.packetIds?.length ? options.packetIds : [options.packetId]);
  const family = recipe.family ?? base.family;
  const inheritsDesign = !!base.modelDesign && !['foundation', 'distillation'].includes(recipe.kind);
  const design = inheritsDesign ? { residentMU: base.residentMU, ceilings: base.modelDesign!.ceilings } : FAMILY_DESIGNS[family];
  const architecture = recipe.kind === 'foundation' ? options.architecture ?? 'dense' : recipe.kind === 'distillation' ? 'dense' : base.architecture;
  const teacher = recipe.kind === 'distillation' && options.teacherModelId ? state.slices.models.versions[options.teacherModelId] : undefined;
  const teacherDomain = options.teacherDomain ?? 'conversation';
  const trainedProperties = recipe.kind === 'adaptation' || recipe.kind === 'foundation';
  const profile = trainedProperties ? (options.profile ?? 'balanced') : 'balanced', profileData = TRAINING_PROFILES[profile];
  const foundationAnchor: CapabilityScores = recipe.kind === 'foundation' ? { conversation: 2000, documents: 2000, coding: 1000, tools: 1000 }
    : structuredClone(base.foundationAnchor ?? anchorModel(state, base).capabilityBps);
  const anchorScores = trainedProperties ? structuredClone(foundationAnchor) : structuredClone(base.capabilityBps);
  const targets = trainedProperties ? structuredClone(recipe.targets) : structuredClone(base.capabilityBps);
  const synthetic = recipe.kind === 'synthetic' ? createSyntheticTrainingReceipt(state, base, options.packetId) : undefined;
  if (synthetic) targets[synthetic.domain] = synthetic.targetBps;
  if (recipe.kind === 'distillation') { anchorScores[teacherDomain] = foundationAnchor[teacherDomain]; targets[teacherDomain] = Math.min(design.ceilings[teacherDomain], Math.max(0, (teacher?.capabilityBps[teacherDomain] ?? 0) - 500)); }
  const efficient = recipe.kind === 'adaptation' && hasResearch(state, companyId, 'R4');
  let requiredWork = mulDiv(recipe.workCUw, profileData.workMultiplierBps, 10000, 'ceil');
  if (efficient) requiredWork = mulDiv(requiredWork, 7500, 10000, 'ceil');
  if (!trainedProperties) requiredWork = recipe.workCUw;
  if (architecture === 'sparse' && trainedProperties) requiredWork = mulDiv(requiredWork, SPARSE_DESIGN.workBps, 10000, 'ceil');
  const workspace = options.workspace && Object.hasOwn(TRAINING_WORKSPACES, options.workspace) ? TRAINING_WORKSPACES[options.workspace] : undefined;
  if (workspace) requiredWork = mulDiv(requiredWork, workspace.workBps, 10000, 'ceil');
  const nominalFocusWorkCUw = requiredWork;
  // Generic cleaned text is not update work for paired policy labels. This
  // policy source has no authored repeated-processing discount.
  const deduplication = recipe.kind === 'policy' ? undefined : trainingDeduplicationReceipt(corpus.packetIds.map(id => state.slices.data.packets[id]), requiredWork);
  if (deduplication) requiredWork -= deduplication.savedWorkCUw;
  const ordinaryIdentity = ordinaryTrainingIdentity(state, companyId, options, recipe, corpus);
  const replay = options.replay !== undefined && !replayChoiceRejection(options.replay)
    ? createTrainingReplayReceipt(state, base, options.replay, getCorpusEvidence(state, companyId, options.replay.packetIds), ordinaryIdentity, nominalFocusWorkCUw, requiredWork) : null;
  if (replay) requiredWork = checkedAdd(requiredWork, replay.replayWorkCUw);
  const curriculum = options.replay === undefined && options.curriculum !== undefined && !curriculumChoiceRejection(options.curriculum)
    ? createTrainingCurriculumReceipt(state, base, options.curriculum,
      options.curriculum.tracks.map(track => getCorpusEvidence(state, companyId, track.packetIds)) as [CorpusEvidence, CorpusEvidence], ordinaryIdentity, nominalFocusWorkCUw, requiredWork) : null;
  if (curriculum) requiredWork = checkedAdd(requiredWork, curriculum.replayWorkCUw);
  const checkpoints = options.automatedCheckpoints && hasResearch(state, companyId, 'R3')
    ? Array.from({ length: 10 }, (_, index) => ({ atBps: (index + 1) * 1000, overheadWork: [4, 9].includes(index) ? 0 : U / 4 }))
    : [{ atBps: 5000, overheadWork: 0 }, { atBps: 10000, overheadWork: 0 }];
  const identity = trainingIdentity(state, companyId, options, recipe, corpus), savedAdjustments = zeros();
  for (const domain of DOMAINS) {
    if (trainedProperties) targets[domain] = Math.min(design.ceilings[domain], targets[domain] + profileData.targetBonusBps);
    if (trainedProperties && options.profile && saveAdjustments) {
      const draw = parseInt(canonicalStateHash({ seed: state.seed, stream: `training-profile:${ordinaryIdentity}:${domain}` }), 16) / 4294967296;
      savedAdjustments[domain] = Math.floor(draw * (2 * profileData.varianceBps + 1)) - profileData.varianceBps;
    }
  }
  const root = anchorModel(state, base), behaviorAnchor = structuredClone(root.behavior ?? BASE_BEHAVIOR), behaviorTarget = structuredClone(recipe.kind === 'foundation' ? BASE_BEHAVIOR : (base.behavior ?? BASE_BEHAVIOR));
  if (recipe.kind === 'calibration') { behaviorTarget.confidentErrorBps = Math.floor(behaviorAnchor.confidentErrorBps / 2); behaviorTarget.falseRefusalBps = base.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps; }
  const policy = recipe.kind === 'policy' ? createPolicyTrainingReceipt(recipe.id, corpus.packetIds.map(id => state.slices.data.packets[id]), behaviorAnchor.falseRefusalBps) : undefined;
  if (policy) behaviorTarget.falseRefusalBps = policy.targetFalseRefusalBps;
  const inheritedPolicy = recipe.kind !== 'policy' && recipe.kind !== 'foundation' && base.policy ? structuredClone(base.policy) : undefined;
  const adapter = options.asAdapter ? getAdapterTrainingReceipt(state, companyId, base.id) : undefined;
  const planner = recipe.kind === 'planning' ? plannerTarget(base.planner) : recipe.kind !== 'foundation' && base.planner ? structuredClone(base.planner) : undefined;
  const plan: TrainingPlan = {
    recipeName: recipe.name, kind: recipe.kind, profile, profileApplied: trainedProperties && !!options.profile, family, architecture, residentMU: adapter ? adapter.baseResidentMU + adapter.adapterMemoryMU : inheritsDesign ? base.residentMU : architecture === 'sparse' ? mulDiv(design.residentMU, SPARSE_DESIGN.residentMemoryBps, 10000) : design.residentMU,
    ...(teacher ? { teacher: { modelId: teacher.id, domain: teacherDomain, scoreBps: teacher.capabilityBps[teacherDomain], studentAnchorBps: foundationAnchor[teacherDomain], requiredWork: mulDiv(4 * U * FAMILY_SERVING_MULTIPLIER[teacher.family], modelWorkBps(teacher), 10000), residentMU: teacher.residentMU, rights: inheritedModelRights(state, teacher.id, content) } } : {}),
    lineageId: recipe.kind === 'foundation' ? 'foundation-' + identity : (lineageId(state, base) ?? base.id), identity, corpus,
    targets, ceilings: structuredClone(design.ceilings), savedAdjustments, requiredEvidence: recipe.relevantUnits * U,
    reliabilityTargetBps: ['calibration', 'planning', 'policy', 'synthetic'].includes(recipe.kind) ? base.reliabilityBps : recipe.reliabilityTargetBps,
    behaviorAnchor, behaviorTarget, preparationRequired: recipe.preparationStaff,
    checkpointOverheadRequired: checkpoints.reduce((sum, item) => sum + item.overheadWork, 0), checkpoints,
    ...(options.continueFromParent && base.trainingRunId && recipe.kind === 'adaptation' && !options.asAdapter
      ? { parentScores: { capabilityBps: { ...base.capabilityBps }, reliabilityBps: base.reliabilityBps } } : {}),
    ...(workspace ? { workspace: options.workspace } : {}),
    methods: [...(workspace ? [workspace.researchId] : []), ...(efficient ? ['R4'] : []), ...(options.automatedCheckpoints && hasResearch(state, companyId, 'R3') ? ['R3'] : []), ...(recipe.requiredResearch ? [recipe.requiredResearch] : []), ...(recipe.kind === 'policy' ? ['R1A'] : []), ...(architecture === 'sparse' ? ['R14'] : []), ...(deduplication || replay?.deduplication || curriculum?.tracks.some(track => track.deduplication) ? ['R2A'] : []), ...(adapter ? ['R4B'] : []), ...(replay || curriculum ? ['R4C'] : [])],
    ...(deduplication ? { deduplication } : {}),
    ...(replay ? { replay } : {}),
    ...(curriculum ? { curriculum } : {}), ...(synthetic ? { synthetic } : {}),
    ...(adapter ? { adapter } : {}), ...(planner ? { planner } : {}),
    ...(policy ? { policy } : {}), ...(inheritedPolicy ? { inheritedPolicy } : {}),
    foundationAnchor,
  };
  const selected = state.slices.data.packets[options.packetId] ?? content.starterData;
  const evidence: DataPacket = { ...structuredClone(selected), companyId, name: corpus.packetIds.length > 1 ? 'Combined prepared corpus' : selected.name,
    rawUnits: corpus.distinctUnits, readyUnits: corpus.distinctUnits, prepared: true, sourceIds: corpus.sourceIds, behaviorUnits: corpus.behaviorUnits, broadUnits: corpus.broadUnits,
    qualityBps: policy?.qualityBps ?? (corpus.behaviorQualityBps || Math.max(...Object.values(corpus.qualityBps))), rights: corpus.rights,
    coverageBps: Object.fromEntries(DOMAINS.map(domain => [domain, corpus.distinctUnits ? Math.min(10000, mulDiv(corpus.relevantUnits[domain], 10000, corpus.distinctUnits * U)) : 0])) as CapabilityScores };
  // A merged evidence record is not a packet cleanup receipt. The exact selected
  // source savings live in the separately frozen plan above.
  delete evidence.deduplication;
  // Feedback provenance belongs to the selected packets; an aggregate corpus
  // must not claim to be the original packet from a single paid review.
  delete evidence.feedback;
  // Paired-label provenance belongs to immutable source packets. Its exact
  // selected source receipt is frozen separately from aggregate evidence.
  delete evidence.policy;
  delete evidence.synthetic;
  return { plan, recipe, requiredWork, requiredMemory: mulDiv(plan.residentMU * (recipe.kind === 'foundation' ? 3 : 2), workspace?.memoryBps ?? 10000, 10000, 'ceil'), anchorScores,
    anchorReliabilityBps: ['calibration', 'planning', 'policy', 'synthetic'].includes(recipe.kind) ? base.reliabilityBps : (base.foundationAnchor || recipe.kind === 'foundation' ? 7000 : root.reliabilityBps), evidence };
}
/** New evidence sets an absolute attainable score. Preserve three quarters of
 * the difference when a new focus would otherwise erase the parent's skill. */
function continuedScore(parent: number, attainable: number, work: number, requiredWork: number): number {
  const change = attainable >= parent ? attainable - parent : mulDiv(parent - attainable, 1, 4, 'nearest');
  const portion = mulDiv(change, Math.min(work, requiredWork), requiredWork, 'nearest');
  return attainable >= parent ? parent + portion : parent - portion;
}

export function expectedTrainingOutcome(run: TrainingRun, work: number, content: GameContent = CONTENT): { advancedCapabilities?: AdvancedScores; capabilityBps: CapabilityScores; reliabilityBps: number; behavior?: ModelBehavior; planner?: PlannerTrait; policy?: ModelPolicy } {
  const plan = run.plan; let capabilityBps = structuredClone(run.anchorScores);
  if (!plan) {
    for (const domain of DOMAINS) capabilityBps[domain] = finiteOutcome({ anchorBps: run.anchorScores[domain], targetBps: content.firstSale.trainingTargetsBps[domain], completedWork: work, requiredWork: run.requiredWork,
      relevantEvidence: mulDiv(run.evidence.readyUnits * U, run.evidence.coverageBps[domain], 10000), requiredEvidence: content.firstTraining.relevantUnits * U, qualityBps: run.evidence.qualityBps, ceilingBps: FAMILY_DESIGNS.compact.ceilings[domain] });
    const reliabilityBps = finiteOutcome({ anchorBps: run.anchorReliabilityBps, targetBps: content.firstTraining.reliabilityTargetBps, completedWork: work, requiredWork: run.requiredWork,
      relevantEvidence: run.evidence.readyUnits * U, requiredEvidence: content.firstTraining.relevantUnits * U, qualityBps: run.evidence.qualityBps });
    return { capabilityBps, reliabilityBps };
  }
  const scoringWork = plan.parentScores ? run.requiredWork : work;
  if (plan.kind === 'adaptation' || plan.kind === 'foundation' || plan.kind === 'distillation' || plan.kind === 'synthetic') for (const domain of DOMAINS.filter(domain => (plan.kind !== 'distillation' || domain === plan.teacher?.domain) && (plan.kind !== 'synthetic' || domain === plan.synthetic?.domain))) capabilityBps[domain] = finiteOutcome({ anchorBps: run.anchorScores[domain], targetBps: Math.max(0, Math.min(10000, plan.targets[domain] + plan.savedAdjustments[domain])),
    completedWork: scoringWork, requiredWork: run.requiredWork, relevantEvidence: plan.corpus.relevantUnits[domain], requiredEvidence: plan.requiredEvidence, qualityBps: plan.corpus.qualityBps[domain], ceilingBps: plan.ceilings[domain] });
  if (plan.parentScores) for (const domain of DOMAINS) {
    capabilityBps[domain] = continuedScore(plan.parentScores.capabilityBps[domain], capabilityBps[domain], work, run.requiredWork);
  }
  if (plan.modelDesign && plan.parentScores) for (const domain of DOMAINS) {
    if (plan.modelDesign.spec.dataMix[domain] === 0) capabilityBps[domain] = plan.parentScores.capabilityBps[domain];
  }
  capabilityBps = applyReplayOutcome(plan.replay, capabilityBps, work, run.requiredWork);
  capabilityBps = applyCurriculumOutcome(plan.curriculum, capabilityBps, work, run.requiredWork);
  let reliabilityBps = ['calibration', 'planning', 'policy', 'synthetic'].includes(plan.kind) ? run.anchorReliabilityBps : finiteOutcome({ anchorBps: run.anchorReliabilityBps, targetBps: plan.reliabilityTargetBps, completedWork: scoringWork, requiredWork: run.requiredWork,
    relevantEvidence: plan.corpus.behaviorUnits * U, requiredEvidence: 100 * U, qualityBps: plan.corpus.behaviorQualityBps });
  if (plan.parentScores) reliabilityBps = continuedScore(plan.parentScores.reliabilityBps, reliabilityBps, work, run.requiredWork);
  const behavior = structuredClone(plan.behaviorTarget);
  if (plan.kind === 'calibration') behavior.confidentErrorBps = finiteOutcome({ anchorBps: plan.behaviorAnchor.confidentErrorBps, targetBps: plan.behaviorTarget.confidentErrorBps, completedWork: work, requiredWork: run.requiredWork,
    relevantEvidence: plan.corpus.behaviorUnits * U, requiredEvidence: 100 * U, qualityBps: plan.corpus.behaviorQualityBps });
  const planner = plan.planner ? structuredClone(plan.planner) : undefined;
  if (planner && plan.kind === 'planning') planner.currentRepeatBps = finiteOutcome({ anchorBps: planner.baselineRepeatBps, targetBps: planner.currentRepeatBps, completedWork: work, requiredWork: run.requiredWork,
    relevantEvidence: plan.corpus.behaviorUnits * U, requiredEvidence: 100 * U, qualityBps: plan.corpus.behaviorQualityBps });
  const policyOutcome = plan.kind === 'policy' && plan.policy ? policyTrainingOutcome(plan.policy, work, run.requiredWork) : undefined;
  if (policyOutcome) behavior.falseRefusalBps = policyOutcome.falseRefusalBps;
  const customizedBehavior = customizationBehaviorOutcome(run, work);
  if (customizedBehavior) Object.assign(behavior, customizedBehavior);
  const policy = policyOutcome?.policy ?? plan.inheritedPolicy;
  const advancedCapabilities = advancedTrainingOutcome(run, work);
  return { ...(advancedCapabilities ? { advancedCapabilities } : {}), capabilityBps, reliabilityBps, behavior, ...(planner ? { planner } : {}), ...(policy ? { policy: structuredClone(policy) } : {}) };
}
function trainingBaseRejection(state: Readonly<GameState>, companyId: string, base: ModelVersion | undefined, content: GameContent): Rejection | undefined {
  if (!base || base.companyId !== companyId || !lineageId(state, base)) return { code: 'NOT_READY', message: 'Choose one of your saved models.' };
  const root = anchorModel(state, base);
  if (root.id !== content.seedModel.id && !root.scenarioStart) return { code: 'NOT_READY', message: 'Choose a starting model or a model trained from it.' };
  if (base.runtimeVariant) return { code: 'NOT_READY', message: 'Train from the original model. Alternate deployment formats cannot be trained further.' };
}

/** A version can be opened for development before a method or corpus is chosen. */
export function trainingBaseUnavailableReason(state: Readonly<GameState>, modelId: string): string | undefined {
  const base = state.slices.models.versions[modelId], owner = state.playerCompanyId;
  return trainingBaseRejection(state, owner, base, CONTENT)?.message
    ?? validateAdapterTrainingOption(state, owner, modelId, 'adaptation', false)?.message;
}

export function validateTrainingOptions(state: Readonly<GameState>, companyId: string, options: TrainingOptions, content: GameContent = CONTENT): Rejection | undefined {
  if (options.replay !== undefined && options.curriculum !== undefined) return { code: 'INVALID_COMMAND', message: 'Choose one-skill replay or a two-skill curriculum for this run, not both.' };
  const base = state.slices.models.versions[options.baseModelId];
  const baseProblem = trainingBaseRejection(state, companyId, base, content);
  if (baseProblem) return baseProblem;
  if (options.modelDesign || (options.recipeId && isCustomTrainingRecipe(options.recipeId))) {
    // New custom plans use the same audited-synthetic boundary as ordinary
    // training. Historical commands and already-paid design receipts keep their
    // original behavior; this guard is admission-only, never a saved-run rewrite.
    if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(state.contentVersion)) {
      const syntheticReason = validateSyntheticTraining(state, companyId, options); if (syntheticReason) return syntheticReason;
    }
    return validateCustomTrainingOptions(state, companyId, options, content);
  }
  const recipe = TRAINING_RECIPES.find(item => item.id === (options.recipeId ?? content.firstTraining.id));
  if (!recipe) return { code: 'INVALID_COMMAND', message: 'Choose an available training method.' };
  if (options.continueFromParent !== undefined && (options.continueFromParent !== true || !base.trainingRunId || recipe.kind !== 'adaptation' || options.asAdapter)) {
    return { code: 'INVALID_COMMAND', message: 'Continue a saved training checkpoint with an ordinary adaptation.' };
  }
  const syntheticReason = validateSyntheticTraining(state, companyId, options); if (syntheticReason) return syntheticReason;
  if (options.workspace !== undefined) {
    if (!Object.hasOwn(TRAINING_WORKSPACES, options.workspace)) return { code: 'INVALID_COMMAND', message: 'Choose an available training workspace.' };
    if (!['adaptation', 'foundation'].includes(recipe.kind)) return { code: 'NOT_READY', message: 'Workspace designs apply to adaptation and foundation training.' };
    const design = TRAINING_WORKSPACES[options.workspace];
    if (!hasResearch(state, companyId, design.researchId)) return { code: 'NOT_READY', message: 'Complete ' + content.research.find(item => item.id === design.researchId)?.name + ' to use this workspace.' };
  }
  const invalidAdapter = validateAdapterTrainingOption(state, companyId, base.id, recipe.kind, options.asAdapter); if (invalidAdapter) return invalidAdapter;
  if (options.profile && !Object.hasOwn(TRAINING_PROFILES, options.profile)) return { code: 'INVALID_COMMAND', message: 'Choose stable, balanced, or ambitious training.' };
  const architecture = recipe.kind === 'foundation' ? options.architecture ?? 'dense' : base.architecture;
  if (options.architecture && recipe.kind !== 'foundation' && options.architecture !== base.architecture) return { code: 'NOT_READY', message: 'Choose a new architecture when building a foundation model. Adaptation keeps the current model’s architecture.' };
  if (architecture === 'sparse') {
    if (!hasResearch(state, companyId, 'R14')) return { code: 'NOT_READY', message: 'Complete Sparse architecture research before designing or adapting sparse models.' };
    const resident = base.modelDesign && !['foundation', 'distillation'].includes(recipe.kind) ? base.residentMU : mulDiv(FAMILY_DESIGNS[recipe.family ?? base.family].residentMU, SPARSE_DESIGN.residentMemoryBps, 10000);
    const workspace = resident * (recipe.kind === 'foundation' ? 3 : 2);
    const requiredWorkspace = mulDiv(workspace, options.workspace ? TRAINING_WORKSPACES[options.workspace].memoryBps : 10000, 10000, 'ceil');
    if (!getCompatibleComputePools(state, companyId, { modelArchitecture: 'sparse', workloadKind: 'training', requiresFastFabric: true }, content).some(pool => pool.capacityCU >= 16 * U && pool.memoryMU >= requiredWorkspace)) return { code: 'NOT_READY', message: 'A sparse model needs suitable training GPUs with a fast fabric network, at least 16 usable CU, and enough connected memory. Install the network and get the compatible racks running first.' };
  }
  if (recipe.kind === 'distillation') {
    const teacher = options.teacherModelId ? state.slices.models.versions[options.teacherModelId] : undefined, domain = options.teacherDomain;
    if (base.family !== 'compact' || base.architecture !== 'dense') return { code: 'NOT_READY', message: 'Choose a compact dense student model for distillation.' };
    if (!teacher || teacher.companyId !== companyId || !hasCapabilityEvaluation(state, teacher.id) || !domain || !DOMAINS.includes(domain)) return { code: 'NOT_READY', message: 'Choose one of your tested teacher models and a skill to teach.' };
    const anchor = (base.foundationAnchor ?? anchorModel(state, base).capabilityBps)[domain];
    if (!inheritedModelRights(state, teacher.id, content).weights) return { code: 'NOT_READY', message: 'The teacher’s license and all its earlier model licenses must allow weight transfer. A license to host the model alone is not enough for distillation.' };
    if (teacher.capabilityBps[domain] < 6000 || teacher.capabilityBps[domain] < anchor + 1000) return { code: 'NOT_READY', message: 'The teacher needs at least 60 in the chosen skill and a ten-point lead over the student’s saved starting score.' };
  } else if (options.teacherModelId !== undefined || options.teacherDomain !== undefined) return { code: 'INVALID_COMMAND', message: 'Choose a teacher and target skill only for distillation.' };
  if (recipe.requiredResearch && !hasResearch(state, companyId, recipe.requiredResearch)) return { code: 'NOT_READY', message: `Complete ${recipe.requiredResearch} before using this training method.` };
  if (recipe.kind === 'policy' && POLICY_RESEARCH_IDS.some(id => !hasResearch(state, companyId, id))) return { code: 'NOT_READY', message: 'Complete Preference tuning R5 and Behavior evaluation R1A before training policy boundaries.' };
  if (options.automatedCheckpoints && !hasResearch(state, companyId, 'R3')) return { code: 'NOT_READY', message: 'Research R3 before using 10% checkpoints.' };
  const ids = options.packetIds?.length ? options.packetIds : [options.packetId];
  if (!ids.length || !ids.includes(options.packetId) || ids.length > 20) return { code: 'INVALID_COMMAND', message: 'Choose up to twenty prepared datasets, including the main dataset.' };
  for (const id of ids) {
    const packet = state.slices.data.packets[id];
    if (!packet || !packetOwnedBy(packet, companyId, state.playerCompanyId) || !packet.prepared || !packet.readyUnits) return { code: 'NOT_READY', message: 'You must own and fully prepare every selected dataset.' };
    if (!packet.rights.hosted) return { code: 'NOT_READY', message: 'Every selected dataset must allow hosted model use.' };
  }
  const corpus = getCorpusEvidence(state, companyId, ids);
  if (options.replay !== undefined) {
    const malformed = replayChoiceRejection(options.replay); if (malformed) return malformed;
    const replayReason = validateReplayTrainingOption(state, companyId, base, recipe.id, options.replay,
      getCorpusEvidence(state, companyId, options.replay.packetIds), options.asAdapter, corpus);
    if (replayReason) return replayReason;
  }
  if (options.curriculum !== undefined) {
    const malformed = curriculumChoiceRejection(options.curriculum); if (malformed) return malformed;
    const curriculumReason = validateCurriculumTrainingOption(state, companyId, base, recipe.id, options.curriculum,
      options.curriculum.tracks.map(track => getCorpusEvidence(state, companyId, track.packetIds)) as [CorpusEvidence, CorpusEvidence], options.asAdapter, corpus);
    if (curriculumReason) return curriculumReason;
  }
  if (recipe.kind === 'foundation') {
    const evaluatedReleases = Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && model.status === 'released'
      && Object.values(state.slices.models.reports).some(report => report.modelId === model.id && report.companyId === companyId));
    if (evaluatedReleases.length < 2) return { code: 'NOT_READY', message: 'Test and release two different model versions before building a new foundation.' };
    if (getAvailableRoleCapacity(state, companyId, 'research') < U) return { code: 'MISSING_STAFF', message: 'Generate at least 20 Research points per week before designing a new foundation.' };
    if (corpus.broadUnits < recipe.minimumBroadUnits || DOMAINS.some(domain => corpus.relevantUnits[domain] < recipe.relevantUnits * U) || corpus.behaviorUnits < 100) return { code: 'NOT_READY', message: `This foundation needs ${recipe.minimumBroadUnits} unique general data units, ${recipe.relevantUnits} relevant units for each skill, and 100 behavior examples.` };
  }
  if (['behavior', 'calibration', 'planning'].includes(recipe.kind) && !corpus.behaviorUnits) return { code: 'NOT_READY', message: 'Select prepared behavior cases for this recipe.' };
  if (recipe.kind === 'policy' && !policyEvidenceFromPackets(corpus.packetIds.map(id => state.slices.data.packets[id])).distinctPairs) return { code: 'NOT_READY', message: 'Choose prepared Policy contrast pairs. Ordinary behavior cases and customer feedback do not include the required allow/refuse labels.' };
  const identity = trainingIdentity(state, companyId, options, recipe, corpus);
  const previous = Object.values(state.slices.models.trainingRuns).find(run => run.companyId === companyId && existingRunTrainingIdentity(state, run, content) === identity);
  if (previous) return { code: previous.status === 'complete' ? 'NO_IMPROVEMENT' : 'ALREADY_ACTIVE', message: previous.status === 'complete'
    ? 'You already have a model from this training plan. Repeating the plan will not improve it or change its result.'
    : 'This model already has training in progress. Resume the run if it is paused.' };
  return;
}
export function trainingImprovementRejection(base: ModelVersion, outcome: ReturnType<typeof expectedTrainingOutcome>, kind: TrainingRecipe['kind']): Rejection | undefined {
  // Foundations are independently initialized; the comparison model cannot
  // disqualify a new design that passed its evidence and identity checks.
  if (kind === 'foundation') return;
  if ((outcome.advancedCapabilities && Object.entries(outcome.advancedCapabilities).some(([domain, score]) => score > (base.advancedCapabilities?.[domain as keyof AdvancedScores] ?? 0)))
    || DOMAINS.some(domain => outcome.capabilityBps[domain] > base.capabilityBps[domain]) || outcome.reliabilityBps > base.reliabilityBps
    || (outcome.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps) < (base.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps)
    || (outcome.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps) < (base.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps)
    || (outcome.policy?.currentUnsafeComplianceBps ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS) < (base.policy?.currentUnsafeComplianceBps ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS)
    || (outcome.planner?.currentRepeatBps ?? 10000) < (base.planner?.currentRepeatBps ?? 10000)) return;
  return { code: 'NO_IMPROVEMENT', message: 'This plan cannot improve the selected model. Try stronger data for your target skill or a different training method.' };
}

export function getTrainingPreview(state: Readonly<GameState>, companyId: string, options: TrainingOptions, content: GameContent = CONTENT): TrainingPreview {
  const planned = buildTrainingPlan(state, companyId, options, content, true), p = planned.plan;
  const fake: TrainingRun = { id: 'preview', companyId, baseModelId: options.baseModelId, packetId: options.packetId, outputModelId: 'preview-model', recipeId: planned.recipe.id, startedWeek: state.week,
    requiredWork: planned.requiredWork, completedWork: 0, physicalWork: 0, requiredMemory: planned.requiredMemory, status: 'running', checkpointWork: 0, checkpointModelId: null,
    anchorScores: planned.anchorScores, anchorReliabilityBps: planned.anchorReliabilityBps, evidence: planned.evidence, lastProgress: 0, lastBottleneck: '', plan: p };
  const variance = options.profile && ['adaptation', 'foundation'].includes(p.kind) ? TRAINING_PROFILES[p.profile].varianceBps : 0;
  const minimum = structuredClone(fake), maximum = structuredClone(fake);
  for (const domain of DOMAINS) { minimum.plan!.savedAdjustments[domain] = -variance; maximum.plan!.savedAdjustments[domain] = variance; }
  const low = expectedTrainingOutcome(minimum, planned.requiredWork, content), high = expectedTrainingOutcome(maximum, planned.requiredWork, content);
  const notes = p.modelDesign ? getModelDesignForecast(state, companyId, options.baseModelId, p.corpus.packetIds, p.modelDesign.spec).notes : ['You can reuse prepared data. Each source counts once, using the best-quality version you selected.', 'This plan has fixed skill targets based on the model’s starting point. Test and release the finished model in separate steps.'];
  if (p.parentScores) notes.push('Checkpoints start at the selected parent’s scores. Higher skills move toward the target supported by the training data. If the new focus would lower a score, it loses one quarter of the gap.');
  if (p.workspace) notes.push(TRAINING_WORKSPACES[p.workspace].name + ' uses ' + TRAINING_WORKSPACES[p.workspace].detail + '. The finished model keeps its normal serving footprint.');
  if (p.methods.includes('R4')) notes.push('R4 reduces this new adaptation’s update work by 25%; existing runs keep their saved budgets.');
  if (p.deduplication) notes.push(`Cleaned data saves ${p.deduplication.reductionBps / 100}% of update work (${p.deduplication.savedWorkCUw / U} CUw) by removing repeated processing. Cleanup keeps the same data and skill targets. Memory and teacher compute costs stay the same, and existing runs keep their original budgets.`);
  if (p.replay) notes.push(`Replay uses ${p.replay.shareBps / 100}% of training work before cleanup savings: ${p.replay.focusWorkCUw / U} primary CUw plus ${p.replay.replayWorkCUw / U} replay CUw. Separate ${p.replay.domain} data at ${p.replay.qualityBps / 100}% quality keeps a minimum score of ${p.replay.preservationFloorBps / 100} from the starting skill of ${p.replay.baselineScoreBps / 100} once training finishes. You keep the normal training result if it is higher. Other skill targets and the profile result stay fixed. Both datasets’ licenses apply. Test the new model afterward.`);
  if (p.curriculum) notes.push(`Two-skill replay uses ${p.curriculum.shareBps / 100}% of training work, split equally before cleanup savings: ${p.curriculum.focusWorkCUw / U} primary CUw plus ${p.curriculum.replayWorkCUw / U} replay CUw. ${p.curriculum.tracks.map(track => `${track.domain} at ${track.qualityBps / 100}% data quality keeps a minimum score of ${track.preservationFloorBps / 100} from the starting skill of ${track.baselineScoreBps / 100}`).join('; ')} once training finishes. You keep the normal training result if it is higher. All three datasets’ licenses apply. Profile results and the new skill target stay fixed. Test the new model afterward.`);
  if (p.checkpointOverheadRequired) notes.push('Eight optional checkpoints each consume 0.25 additional development CUw.');
  if (p.kind === 'foundation' && !p.modelDesign) notes.push('Finish the research design work before GPU training begins. A new foundation starts with skill scores of 20/20/10/10.');
  if (p.kind === 'calibration') notes.push('Calibration helps the model ask for clarification instead of giving confident wrong answers. It does not improve its ability to answer correctly.');
  if (p.kind === 'planning') notes.push(`Budgeted planner aims for 20% fewer avoidable repeat lookups. With this data, completed training gives ${((10000 - (low.planner?.currentRepeatBps ?? 10000)) / 100).toFixed(1)}% fewer avoidable repeats. Required reads, checks, tool permissions, and answer quality stay the same.`);
  if (p.policy && low.policy) notes.push(`The ${p.policy.distinctPairs} unique policy pairs at ${p.policy.qualityBps / 100}% quality give ${(low.policy.currentUnsafeComplianceBps / 100).toFixed(2)}% chance of accepting restricted requests and ${((low.behavior?.falseRefusalBps ?? BASE_BEHAVIOR.falseRefusalBps) / 100).toFixed(2)}% chance of refusing allowed requests after full training. These are game estimates. Skill scores, reliability, confidence, and serving costs stay the same. Run a paid policy test before release.`);
  if (p.inheritedPolicy) notes.push('This model keeps its base model’s trained policy. Run its own paid capability and policy tests before release.');
  if (p.adapter) notes.push(`The adapter uses the base model ${baseName(state, p.adapter.baseModelId)} plus 0.25 MU of extra model memory. Running it alone needs ${p.residentMU / U} MU. Compatible public adapters can share the base only on the same serving GPU pool. Customer requests and conversation memory still use their usual resources.`);
  if (p.teacher) notes.push(`Teacher generation requires ${p.teacher.requiredWork / U} serving CUw and ${p.teacher.residentMU / U} MU before student training starts. Distribution must be allowed by both models’ licenses, including the models they were trained from.`);
  if (p.architecture === 'sparse' && !p.modelDesign) notes.push('Sparse models use 70% of a dense model’s training work and 65% of its serving work, but need 150% of its model memory. You must use a connected GPU pool with fast fabric.');
  const base = state.slices.models.versions[options.baseModelId];
  const reason = validateTrainingOptions(state, companyId, options, content) ?? (base && trainingImprovementRejection(base, expectedTrainingOutcome(fake, planned.requiredWork, content), p.kind));
  return { recipeId: planned.recipe.id, recipeName: planned.recipe.name, workCUw: planned.requiredWork, memoryMU: planned.requiredMemory, preparationStaff: p.preparationRequired, feeCents: planned.recipe.feeCents,
    checkpointOverheadWork: p.checkpointOverheadRequired, capabilityRange: { minimum: low.capabilityBps, maximum: high.capabilityBps }, reliabilityRange: { minimum: low.reliabilityBps, maximum: high.reliabilityBps },
    ...(low.advancedCapabilities && high.advancedCapabilities ? { advancedCapabilityRange: { minimum: low.advancedCapabilities, maximum: high.advancedCapabilities } } : {}),
    corpus: p.corpus, notes, ...(low.behavior ? { behavior: low.behavior } : {}), ...(low.planner ? { plannerRepeatBps: low.planner.currentRepeatBps } : {}), ...(p.replay ? { replay: p.replay } : {}), ...(p.curriculum ? { curriculum: p.curriculum } : {}), ...(p.policy && low.policy ? { policy: { distinctPairs: p.policy.distinctPairs, qualityBps: p.policy.qualityBps, unsafeComplianceBps: low.policy.currentUnsafeComplianceBps, falseRefusalBps: low.behavior!.falseRefusalBps } } : {}), ...(reason ? { reason } : {}) };
}
function baseName(state: Readonly<GameState>, modelId: string): string { return state.slices.models.versions[modelId]?.name ?? modelId; }
