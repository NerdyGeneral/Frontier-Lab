import { isModelCustomizationResearch } from './model-customization-version';
import { isAISystemsResearch } from './ai-systems-version';
import { AI_SYSTEM_RESEARCH_IDS } from '../content/ai-systems';
import { CUSTOMIZATION_RESEARCH_IDS } from '../content/model-customization-research';
import { assertCustomTrainingRun, assertModelDesignInheritance } from './model-design-validation';
import { isCustomTrainingRecipe } from '../modules/model-design-training';
import { FAMILY_SERVING_MULTIPLIER } from '../modules/model-design';
import { DESIGN_RESEARCH_IDS, TRAINING_WORKSPACES } from '../content/model-designs';
import { CAMPAIGN_ORIGINS } from '../content/campaign-origins';
import { RIVAL_STARTS } from './wave2-state';
import { hasConnectedCompanyRules } from './connected-company-version';
import { SPARSE_DESIGN } from '../content/wave4-research';
import { hasCapabilityEvaluation, inheritedModelRights, modelWorkBps } from '../modules/model-runtime';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameContent, GameState, ModelVersion } from '../contracts/types';
import { DATA_CATALOG, EVALUATION_SUITES, FAMILY_DESIGNS, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';
import { BASE_BEHAVIOR, DOMAINS, expectedTrainingOutcome, getCorpusEvidence, ordinaryTrainingIdentity, packetSources, trainingIdentity } from '../modules/lab-planner';
import { BASIC_SUITE, behaviorOutcomes } from '../modules/lab-evaluation';
import { hasResearch } from '../modules/research';
import { createDeduplicationReceipt, dataProcessingProfile, trainingDeduplicationReceipt } from '../modules/data-quality';
import { assertAdapterTrainingPlan } from '../modules/adapter-bank';
import { assertIndependentHoldoutsState } from '../modules/independent-holdouts';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { plannerTarget, validPlannerTrait } from '../modules/agent-planning';
import { createPolicyTrainingReceipt, policyDataProvenance, validModelPolicy } from '../modules/policy-training';
import { POLICY_DATA_ID, POLICY_DATA_RULES, POLICY_RESEARCH_IDS } from '../content/wave11-policy';
import { assertWave11PolicyHoldouts } from './wave11-policy-validation';
import { assertTrainingReplay } from './wave15-replay-validation';
import { assertTrainingCurriculum } from './wave17-curriculum-validation';
import { trainingEvidenceFingerprint } from '../modules/replay-curriculum';
import { assertSyntheticTraining } from './wave26-synthetic-validation';
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.'); }
function bps(value: number): void { checkedInteger(value); check(value <= 10000, 'Lab score exceeds 100%.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(value), 'Lab identifier is invalid.'); }
function unique(values: readonly string[], label: string): void { check(Array.isArray(values) && values.length <= 10000, label + ' must be a bounded list.'); values.forEach(id); check(new Set(values).size === values.length, label + ' contains duplicates.'); }
function meter(done: number, required: number): void { checkedInteger(done); checkedInteger(required); check(done <= required, 'Lab progress exceeds its frozen requirement.'); }
function scores(value: ModelVersion['capabilityBps']): void { record(value, 'Capability vector'); for (const domain of DOMAINS) bps(value[domain]); }
function behavior(value: { confidentErrorBps: number; falseRefusalBps: number }): void { record(value, 'Model behavior'); bps(value.confidentErrorBps); bps(value.falseRefusalBps); }

/** Validates frozen laboratory plans, source identity, evidence-only reports and company-scoped knowledge. */
export function assertWave2LabState(state: GameState, content: GameContent): void {
  const { company, data, models, research } = state.slices;
  const ownCompany = (companyId: string) => check(Object.hasOwn(company.companies, companyId), 'Lab record has an unknown company.');
  const past = (week: number) => { checkedInteger(week); check(week <= state.week, 'Lab record comes from a future week.'); };
  for (const packet of Object.values(data.packets)) {
    check(packet.companyId !== undefined, 'Data packet has no company owner.'); ownCompany(packet.companyId!);
    id(packet.catalogId); unique(packet.sourceIds!, 'Data source identity'); check(packet.sourceIds!.length > 0, 'A data packet needs a source identity.');
    if (packet.behaviorUnits !== undefined) { checkedInteger(packet.behaviorUnits); check(packet.behaviorUnits <= packet.rawUnits, 'Behavior evidence exceeds raw data.'); }
    if (packet.broadUnits !== undefined) { checkedInteger(packet.broadUnits); check(packet.broadUnits <= packet.rawUnits, 'Broad evidence exceeds raw data.'); }
    if (packet.revision !== undefined) checkedInteger(packet.revision);
    const expectedPolicyData = policyDataProvenance(packet.catalogId!);
    check(same(packet.policy ?? null, expectedPolicyData ?? null), 'Policy paired labels changed provenance or appeared in an ordinary dataset.');
    if (expectedPolicyData) {
      check(!packet.feedback && packet.rawUnits === POLICY_DATA_RULES.rawUnits && packet.behaviorUnits === 0 && packet.broadUnits === 0
        && Object.values(packet.coverageBps).every(value => value === 0), 'Policy contrast pairs invented generic feedback, capability, behavior or broad evidence.');
      const jobs = Object.values(data.preparationJobs).filter(job => job.packetId === packet.id);
      check(jobs.length <= 1 && (!(packet.parentPacketId || packet.prepared) || jobs.length === 1), 'Policy labels have no unique paid preparation or curation job.');
      if (jobs.length) {
        const job = jobs[0], admission = state.commandReceipts[job.id.slice('preparation-'.length)];
        check(job.companyId === packet.companyId && job.kind === (packet.parentPacketId ? 'curate' : 'prepare')
          && job.sourcePacketId === packet.parentPacketId && job.requiredStaff === POLICY_DATA_RULES.preparationStaff,
          'Policy label preparation changed its source, method or three staff-week cost.');
        check(job.id.startsWith('preparation-') && admission?.status === 'accepted' && admission.week === job.startedWeek,
          'Policy labels have no accepted preparation admission at their saved boundary.');
        check(packet.prepared === (job.status === 'complete') && packet.readyUnits === (packet.prepared ? packet.rawUnits : 0),
          'Policy labels became ready before their paid preparation completed.');
        if (packet.prepared) check(job.completedStaff === job.requiredStaff && job.completedWeek !== undefined
          && job.completedWeek >= job.startedWeek && job.completedWeek <= state.week, 'Policy labels omitted completed data-staff work.');
        if (packet.parentPacketId) {
          const parentJob = Object.values(data.preparationJobs).find(item => item.packetId === packet.parentPacketId);
          check(packet.id === 'curated-' + job.id.slice('preparation-'.length) && parentJob?.status === 'complete'
            && parentJob.completedWeek! < job.startedWeek, 'Policy curation has no previously prepared source or immutable revision identity.');
        } else check(packet.purchasedWeek! < job.startedWeek, 'Policy labels were prepared before their purchase was available.');
      }
    }
    if (packet.parentPacketId) {
      const parent = data.packets[packet.parentPacketId];
      check(parent && parent.companyId === packet.companyId && parent.prepared, 'Data revision has no owned prepared parent.');
      check(packet.revision === (parent.revision ?? 0) + 1 && same(packetSources(packet), packetSources(parent)) && packet.catalogId === parent.catalogId, 'Data revision changed source identity or revision order.');
      const cleanup = !!packet.deduplication && packet.deduplication.sourcePacketId === parent.id;
      check(packet.rawUnits === parent.rawUnits && packet.qualityBps === (cleanup ? parent.qualityBps : Math.min(9500, parent.qualityBps + 1000))
        && same(packet.coverageBps, parent.coverageBps) && same(packet.rights, parent.rights)
        && packet.behaviorUnits === parent.behaviorUnits && packet.broadUnits === parent.broadUnits, 'Data revision manufactured volume, coverage, rights, or an invalid quality gain.');
      if (cleanup) {
        const receipt = packet.deduplication!, rollout = research.systemRollouts[receipt.rolloutId];
        check(!parent.deduplication && parent.readyUnits === parent.rawUnits && same(receipt, createDeduplicationReceipt(parent, receipt.rolloutId)) && receipt.reductionBps > 0, 'Cleanup changed its authored processing receipt or compounded an earlier saving.');
        check(rollout && rollout.companyId === packet.companyId && rollout.method === 'deduplication' && rollout.status === 'active' && hasResearch(state, packet.companyId!, 'R2A'), 'Cleanup has no installed researched system.');
        const jobs = Object.values(data.preparationJobs).filter(job => job.packetId === packet.id);
        check(jobs.length === 1 && jobs[0].kind === 'deduplicate' && jobs[0].sourcePacketId === parent.id && rollout.readyWeek! <= jobs[0].startedWeek, 'Cleanup has no unique paid preparation job or preceded system activation.');
        check(packet.prepared === (jobs[0].status === 'complete'), 'Cleanup supplied usable evidence before its data work finished.');
      } else {
        check(same(packet.deduplication ?? null, parent.deduplication ?? null), 'Curation invented or discarded an inherited cleanup receipt.');
        if (packet.deduplication) {
          const jobs = Object.values(data.preparationJobs).filter(job => job.packetId === packet.id);
          check(jobs.length === 1 && jobs[0].kind === 'curate' && packet.prepared === (jobs[0].status === 'complete'), 'A cleaned curation revision skipped its own preparation work.');
        }
      }
    } else {
      check(packet.deduplication === undefined, 'An original source has an unearned cleanup receipt.');
    }
    const catalog = DATA_CATALOG.find(item => item.id === packet.catalogId);
    if (catalog && !packet.parentPacketId) {
      check(packet.rawUnits === catalog.rawUnits && packet.qualityBps === catalog.qualityBps && same(packet.coverageBps, catalog.coverageBps)
        && same(packet.rights, catalog.rights) && packet.behaviorUnits === catalog.behaviorUnits && packet.broadUnits === catalog.broadUnits
        && same(packet.sourceIds, [catalog.id]), 'Purchased evidence differs from its authored edition.');
      id(packet.purchaseFactId); past(packet.purchasedWeek!);
      check(company.postedFacts[packet.purchaseFactId!], 'Purchased data has no posted purchase charge.');
      if (catalog.id === POLICY_DATA_ID) {
        const purchase = state.commandReceipts[packet.purchaseFactId!.slice('data-purchase-'.length)];
        check(packet.id === `data-${packet.companyId}-${POLICY_DATA_ID}` && packet.purchaseFactId!.startsWith('data-purchase-') && purchase?.status === 'accepted' && purchase.week === packet.purchasedWeek,
          'Policy labels have no accepted paid source purchase at their saved boundary.');
      }
    }
  }
  const cleanupIdentities = new Set<string>();
  for (const job of Object.values(data.preparationJobs)) {
    const packet = data.packets[job.packetId]; check(packet.companyId === job.companyId, 'Preparation is using another company’s data.');
    if (job.kind === 'curate') {
      check(job.sourcePacketId === packet.parentPacketId && job.requiredStaff === 3 * U && hasResearch(state, job.companyId, 'R2'), 'Curation requirements or source lineage are invalid.');
    } else if (job.kind === 'deduplicate') {
      const source = job.sourcePacketId ? data.packets[job.sourcePacketId] : undefined;
      check(source && source.prepared && job.sourcePacketId === packet.parentPacketId && packet.deduplication?.sourcePacketId === source.id
        && job.requiredStaff === dataProcessingProfile(source).requiredStaff && hasResearch(state, job.companyId, 'R2A'), 'Cleanup requirements or source lineage are invalid.');
      const identity = canonicalStateHash({ companyId: job.companyId, sourceIds: packetSources(source!), qualityBps: source!.qualityBps });
      check(!cleanupIdentities.has(identity), 'Cleanup duplicated the same source and quality revision.'); cleanupIdentities.add(identity);
    } else {
      check(job.kind === undefined || job.kind === 'prepare', 'Unknown data preparation method.');
      const catalog = DATA_CATALOG.find(item => item.id === packet.catalogId);
      check(job.requiredStaff === (catalog?.preparationStaff ?? content.preparation.staffWeeks * U), 'Data preparation changed its staff requirement.');
    }
  }
  const trainingIdentities = new Set<string>();
  for (const run of Object.values(models.trainingRuns)) {
    if (isCustomTrainingRecipe(run.recipeId) || run.plan?.modelDesign) { assertCustomTrainingRun(state, run, content, trainingIdentities); continue; }
    check(run.plan?.advanced === undefined, 'An ordinary training plan cannot invent advanced skill training.');
    const recipe = TRAINING_RECIPES.find(item => item.id === run.recipeId); check(recipe, 'Training recipe is not authored.');
    const base = models.versions[run.baseModelId];
    check(data.packets[run.packetId]?.companyId === run.companyId, 'Training primary evidence belongs to another company.');
    if (!run.plan) {
      check(run.recipeId === content.firstTraining.id && run.requiredWork === content.firstTraining.workCUw && run.requiredMemory === content.firstSale.trainingMemory, 'Legacy opening training requirements changed.');
      continue;
    }
    const plan = run.plan; record(plan, 'Frozen training plan');
    check(plan.foundationRights === undefined || (plan.kind === 'foundation' && plan.foundationRights === 'independent'), 'Only a new foundation can start an independent rights lineage.');
    assertSyntheticTraining(state, run);
    check(plan.recipeName === recipe!.name && plan.kind === recipe!.kind && ['dense', 'sparse'].includes(plan.architecture), 'Training recipe or architecture changed after admission.');
    check(Object.hasOwn(FAMILY_DESIGNS, plan.family) && (recipe!.family ? plan.family === recipe!.family : plan.family === base.family), 'A specialization changed model size.');
    const inheritsDesign = !!base.modelDesign && !['foundation', 'distillation'].includes(plan.kind);
    const design = inheritsDesign ? { residentMU: base.residentMU, ceilings: base.modelDesign!.ceilings } : FAMILY_DESIGNS[plan.family];
    assertAdapterTrainingPlan(state, run);
    if (plan.parentScores !== undefined) {
      check(plan.kind === 'adaptation' && !!base.trainingRunId && !base.runtimeVariant && !plan.adapter,
        'Only an ordinary adaptation of a trained checkpoint can continue its parent.');
      check(same(plan.parentScores, { capabilityBps: base.capabilityBps, reliabilityBps: base.reliabilityBps }),
        'Continued training must use the exact selected parent scores.');
    }
    const resident = plan.adapter ? plan.adapter.baseResidentMU + plan.adapter.adapterMemoryMU : inheritsDesign ? base.residentMU : plan.architecture === 'sparse' ? mulDiv(design.residentMU, SPARSE_DESIGN.residentMemoryBps, 10000) : design.residentMU;
    check(plan.workspace === undefined || (Object.hasOwn(TRAINING_WORKSPACES, plan.workspace) && ['foundation', 'adaptation'].includes(plan.kind)), 'Unknown or ineligible training workspace.');
    const workspace = plan.workspace ? TRAINING_WORKSPACES[plan.workspace] : undefined;
    const workspaceMemory = mulDiv(resident * (plan.kind === 'foundation' ? 3 : 2), workspace?.memoryBps ?? 10000, 10000, 'ceil');
    check(plan.residentMU === resident && run.requiredMemory === workspaceMemory, 'Training workspace does not fit its saved design.');
    check(Object.hasOwn(TRAINING_PROFILES, plan.profile) && typeof plan.profileApplied === 'boolean', 'Unknown training profile.');
    const profile = TRAINING_PROFILES[plan.profile], trainsCapabilities = ['adaptation', 'foundation'].includes(plan.kind);
    if (!trainsCapabilities) check(plan.profile === 'balanced' && !plan.profileApplied, 'Behavior curricula cannot acquire a free capability target tier.');
    let required = trainsCapabilities ? mulDiv(recipe!.workCUw, profile.workMultiplierBps, 10000, 'ceil') : recipe!.workCUw;
    unique(plan.methods, 'Applied training methods');
    check(plan.methods.every(method => ['R3', 'R4', 'R14', 'R2A', 'R4B', 'R4C', workspace?.researchId, recipe!.requiredResearch, ...(plan.kind === 'policy' ? ['R1A'] : [])].includes(method)), 'Training contains an unknown applied method.');
    for (const method of plan.methods) check(hasResearch(state, run.companyId, method), 'Training applied unavailable research.');
    for (const method of plan.methods.filter(id => DESIGN_RESEARCH_IDS.includes(id))) {
      const discovery = Object.values(research.projects).find(item => item.companyId === run.companyId && item.researchId === method);
      check(discovery?.status === 'complete' && discovery.availableWeek! <= run.startedWeek, 'Training began before its model design research was available.');
    }
    if (plan.methods.includes('R4')) { check(plan.kind === 'adaptation', 'Efficient adaptation cannot discount foundation or behavior work.'); required = mulDiv(required, 7500, 10000, 'ceil'); }
    if (plan.architecture === 'sparse') { check(plan.methods.includes('R14'), 'Sparse architecture omitted its research gate.'); if (trainsCapabilities) required = mulDiv(required, SPARSE_DESIGN.workBps, 10000, 'ceil'); }
    else check(!plan.methods.includes('R14'), 'Dense training cannot claim a sparse work discount.');
    if (workspace) {
      check(plan.methods.includes(workspace.researchId), 'The selected workspace is missing its research method.');
      required = mulDiv(required, workspace.workBps, 10000, 'ceil');
    }
    const nominalFocusWorkCUw = required;
    const cleanupWork = plan.kind === 'policy' ? undefined : trainingDeduplicationReceipt(plan.corpus.packetIds.map(packetId => data.packets[packetId]), required);
    check(same(plan.deduplication ?? null, cleanupWork ?? null) && plan.methods.includes('R2A') === !!(cleanupWork || plan.replay?.deduplication || plan.curriculum?.tracks?.some(track => track.deduplication)), 'Training changed its frozen cleanup saving or applied an unearned method.');
    if (cleanupWork) required -= cleanupWork.savedWorkCUw;
    const focusWorkCUw = required;
    if (plan.replay) required += plan.replay.replayWorkCUw;
    if (plan.curriculum) required += plan.curriculum.replayWorkCUw;
    if (plan.kind !== 'foundation') check(plan.architecture === base.architecture, 'A specialization changed its saved architecture.');
    check(!base.runtimeVariant, 'Training silently consumed a deployment variant.');
    if (recipe!.requiredResearch) check(plan.methods.includes(recipe!.requiredResearch), 'Training omitted its required researched method.');
    check(run.requiredWork === required && plan.requiredEvidence === recipe!.relevantUnits * U, 'Training work or evidence requirements were changed.');
    check(plan.preparationRequired === recipe!.preparationStaff, 'Foundation design preparation changed.');
    meter(run.preparationCompleted ?? 0, plan.preparationRequired);
    if ((run.preparationCompleted ?? 0) < plan.preparationRequired) check(run.completedWork === 0 && (run.checkpointOverheadCompleted ?? 0) === 0, 'Training began before foundation design was complete.');
    const expectedCheckpoints = plan.methods.includes('R3') ? Array.from({ length: 10 }, (_, index) => ({ atBps: (index + 1) * 1000, overheadWork: [4, 9].includes(index) ? 0 : U / 4 })) : [{ atBps: 5000, overheadWork: 0 }, { atBps: 10000, overheadWork: 0 }];
    check(same(plan.checkpoints, expectedCheckpoints) && plan.checkpointOverheadRequired === expectedCheckpoints.reduce((sum, point) => sum + point.overheadWork, 0), 'Checkpoint cadence has unpaid or invented work.');
    meter(run.checkpointOverheadCompleted ?? 0, plan.checkpointOverheadRequired);
    let allowedOverhead = 0;
    for (const point of plan.checkpoints) if (run.completedWork >= mulDiv(run.requiredWork, point.atBps, 10000, 'ceil')) allowedOverhead += point.overheadWork;
    check((run.checkpointOverheadCompleted ?? 0) <= allowedOverhead, 'Checkpoint overhead was paid before its saved milestone.');
    let cumulativeOverhead = 0;
    for (const point of plan.checkpoints) {
      cumulativeOverhead += point.overheadWork;
      const milestone = mulDiv(run.requiredWork, point.atBps, 10000, 'ceil');
      if ((run.checkpointOverheadCompleted ?? 0) < cumulativeOverhead) check(run.completedWork <= milestone, 'Training skipped a required checkpoint charge.');
    }
    const corpus = plan.corpus; record(corpus, 'Frozen corpus'); unique(corpus.packetIds, 'Corpus packets'); unique(corpus.sourceIds, 'Corpus sources');
    check(corpus.packetIds.includes(run.packetId) && corpus.packetIds.length > 0 && corpus.packetIds.length <= 20, 'Training corpus has no primary evidence.');
    for (const packetId of corpus.packetIds) check(data.packets[packetId]?.companyId === run.companyId && data.packets[packetId]?.prepared, 'Training corpus has unprepared or foreign evidence.');
    const actualCorpus = getCorpusEvidence(state, run.companyId, corpus.packetIds);
    check(same(corpus, actualCorpus) && corpus.rights.hosted, 'Frozen corpus does not reconcile with its distinct immutable sources or rights.');
    check(run.evidence.companyId === run.companyId && same(run.evidence.sourceIds, corpus.sourceIds) && run.evidence.readyUnits === corpus.distinctUnits
      && run.evidence.rawUnits === corpus.distinctUnits && same(run.evidence.rights, corpus.rights), 'Saved training evidence differs from its admitted corpus.');
    check(run.evidence.policy === undefined, 'Aggregate training evidence claimed to be an original policy-label packet.');
    const identityOptions = { baseModelId: run.baseModelId, packetId: run.packetId, recipeId: run.recipeId, profile: plan.profileApplied ? plan.profile : undefined,
      architecture: plan.architecture, ...(plan.teacher ? { teacherModelId: plan.teacher.modelId, teacherDomain: plan.teacher.domain } : {}),
      ...(plan.replay ? { replay: { domain: plan.replay.domain, shareBps: plan.replay.shareBps, packetIds: plan.replay.corpus.packetIds } } : {}),
      ...(plan.curriculum ? { curriculum: { shareBps: plan.curriculum.shareBps, tracks: plan.curriculum.tracks.map(track => ({ domain: track.domain, packetIds: track.corpus.packetIds })) as import('../contracts/wave17-curriculum').TrainingCurriculumChoice['tracks'] } } : {}) };
    const ordinaryIdentity = ordinaryTrainingIdentity(state, run.companyId, identityOptions, recipe!, corpus, plan.foundationRights);
    const identity = trainingIdentity(state, run.companyId, identityOptions, recipe!, corpus, plan.foundationRights);
    assertTrainingCurriculum(state, run, ordinaryIdentity, nominalFocusWorkCUw, focusWorkCUw, content);
    if (plan.curriculum === undefined) assertTrainingReplay(state, run, ordinaryIdentity, nominalFocusWorkCUw, focusWorkCUw, content);
    check(plan.identity === identity && !trainingIdentities.has(plan.identity), 'Training identity was changed or repeated to reroll an outcome.'); trainingIdentities.add(plan.identity);
    id(plan.lineageId); check(plan.lineageId === (plan.kind === 'foundation' ? 'foundation-' + identity : (base.trainingRunId ? models.trainingRuns[base.trainingRunId]?.plan?.lineageId ?? lineageRootId(base, state) : base.id)), 'Training lineage anchor changed.');
    scores(plan.targets); scores(plan.ceilings); scores(plan.foundationAnchor); check(same(plan.ceilings, design.ceilings), 'Family ceilings changed.');
    const anchor = plan.kind === 'foundation' ? { conversation: 2000, documents: 2000, coding: 1000, tools: 1000 } : base.foundationAnchor ?? lineageRootModel(base, state).capabilityBps;
    const expectedAnchors = structuredClone(trainsCapabilities ? anchor : base.capabilityBps);
    if (plan.kind === 'distillation' && plan.teacher) expectedAnchors[plan.teacher.domain] = anchor[plan.teacher.domain];
    check(same(plan.foundationAnchor, anchor) && same(run.anchorScores, expectedAnchors), 'Training compounded a previous gain into its saved anchor.');
    for (const domain of DOMAINS) {
      const target = trainsCapabilities ? Math.min(design.ceilings[domain], recipe!.targets[domain] + profile.targetBonusBps) : plan.kind === 'distillation' && plan.teacher?.domain === domain ? Math.min(design.ceilings[domain], Math.max(0, plan.teacher.scoreBps - 500)) : plan.kind === 'synthetic' && plan.synthetic?.domain === domain ? plan.synthetic.targetBps : base.capabilityBps[domain];
      check(plan.targets[domain] === target, 'Training absolute target changed.');
      checkedInteger(plan.savedAdjustments[domain], 'saved adjustment', false);
      const draw = parseInt(canonicalStateHash({ seed: state.seed, stream: `training-profile:${ordinaryIdentity}:${domain}` }), 16) / 4294967296;
      const expectedAdjustment = plan.profileApplied ? Math.floor(draw * (2 * profile.varianceBps + 1)) - profile.varianceBps : 0;
      check(plan.savedAdjustments[domain] === expectedAdjustment, 'Saved profile adjustment was rerolled.');
    }
    if (plan.kind === 'distillation') {
      check(plan.teacher && plan.family === 'compact' && plan.architecture === 'dense', 'Distillation lost its compact teacher/student configuration.');
      const teacher = plan.teacher!, model = models.versions[teacher.modelId];
      check(model && model.companyId === run.companyId && hasCapabilityEvaluation(state, model.id) && DOMAINS.includes(teacher.domain), 'Distillation teacher is missing, foreign or unevaluated.');
      const rights = inheritedModelRights(state, teacher.modelId, content);
      check(same(teacher.rights, rights) && rights.weights && teacher.scoreBps === model.capabilityBps[teacher.domain] && teacher.studentAnchorBps === anchor[teacher.domain] && teacher.scoreBps >= 6000 && teacher.scoreBps >= teacher.studentAnchorBps + 1000, 'Distillation transferred an unqualified teacher or laundered rights.');
      check(teacher.residentMU === model.residentMU && teacher.requiredWork === mulDiv(4 * U * FAMILY_SERVING_MULTIPLIER[model.family], modelWorkBps(model), 10000), 'Teacher generation changed its frozen workload or memory.');
      meter(run.teacherWorkCompleted ?? 0, teacher.requiredWork); checkedInteger(run.teacherPhysicalWork ?? 0);
      if ((run.preparationCompleted ?? 0) < plan.preparationRequired) check((run.teacherWorkCompleted ?? 0) === 0, 'Teacher generation preceded data preparation.');
      if ((run.teacherWorkCompleted ?? 0) < teacher.requiredWork) check(run.completedWork === 0 && (run.checkpointOverheadCompleted ?? 0) === 0, 'Student updates began before teacher generation finished.');
      check((run.teacherWorkCompleted ?? 0) === 0 || (run.teacherPhysicalWork ?? 0) > 0, 'Teacher generation has no physical inference work.');
      if (run.status === 'complete') check(run.teacherWorkCompleted === teacher.requiredWork, 'A completed student omitted teacher inference.');
      check(company.postedFacts[run.id + ':setup'], 'Distillation setup fee was not posted.');
    } else check(plan.teacher === undefined && run.teacherWorkCompleted === undefined && run.teacherPhysicalWork === undefined, 'An ordinary recipe contains unaccounted teacher work.');
    behavior(plan.behaviorAnchor); behavior(plan.behaviorTarget);
    const rootBehavior = lineageRootModel(base, state).behavior ?? BASE_BEHAVIOR;
    check(same(plan.behaviorAnchor, rootBehavior), 'Calibration changed its saved lineage anchor.');
    if (plan.kind === 'calibration') check(plan.behaviorTarget.confidentErrorBps === Math.floor(rootBehavior.confidentErrorBps / 2) && plan.behaviorTarget.falseRefusalBps === (base.behavior ?? BASE_BEHAVIOR).falseRefusalBps, 'Calibration invented a capability or refusal gain.');
    else if (plan.kind === 'policy') {
      const expectedPolicy = createPolicyTrainingReceipt(run.recipeId, corpus.packetIds.map(packetId => data.packets[packetId]), rootBehavior.falseRefusalBps);
      check(expectedPolicy && expectedPolicy.distinctPairs > 0 && same(plan.policy, expectedPolicy), 'Policy training changed its paired evidence, fixed lineage anchors or authored tradeoff.');
      for (const packetId of corpus.packetIds.filter(packetId => data.packets[packetId].policy)) {
        const prepared = Object.values(data.preparationJobs).find(job => job.packetId === packetId);
        check(prepared?.status === 'complete' && prepared.completedWeek! < run.startedWeek, 'Policy training used paired labels before their paid preparation became available.');
      }
      check(plan.behaviorTarget.confidentErrorBps === (base.behavior ?? BASE_BEHAVIOR).confidentErrorBps
        && plan.behaviorTarget.falseRefusalBps === expectedPolicy!.targetFalseRefusalBps, 'Policy training invented confidence gains or changed its refusal target.');
      for (const researchId of POLICY_RESEARCH_IDS) {
        const discovery = Object.values(research.projects).find(project => project.companyId === run.companyId && project.researchId === researchId);
        check(plan.methods.includes(researchId) && discovery?.status === 'complete' && discovery.availableWeek! <= run.startedWeek,
          'Policy training began before both researched methods became available.');
      }
      const admission = state.commandReceipts[run.id.slice('training-'.length)];
      check(run.id.startsWith('training-') && admission?.status === 'accepted' && admission.week === run.startedWeek,
        'Policy training has no accepted admission at its saved boundary.');
    }
    else check(same(plan.behaviorTarget, plan.kind === 'foundation' ? BASE_BEHAVIOR : base.behavior ?? BASE_BEHAVIOR), 'A capability recipe silently changed model behavior.');
    if (plan.kind !== 'policy') check(plan.policy === undefined, 'An ordinary training recipe acquired unearned policy targets.');
    const expectedInheritedPolicy = plan.kind !== 'policy' && plan.kind !== 'foundation' ? base.policy : undefined;
    check(same(plan.inheritedPolicy ?? null, expectedInheritedPolicy ?? null), 'Training changed its inherited policy or a fresh foundation retained old policy gains.');
    const expectedPlanner = plan.kind === 'planning' ? plannerTarget(base.planner) : plan.kind === 'foundation' ? undefined : base.planner;
    check(same(plan.planner ?? null, expectedPlanner ?? null), 'Planning changed its fixed lineage target or inherited trait.');
    if (plan.kind === 'planning') {
      check(corpus.behaviorUnits > 0 && plan.methods.includes('R11A'), 'Planning curriculum has no behavior evidence or researched method.');
      const discovery = Object.values(research.projects).find(project => project.companyId === run.companyId && project.researchId === 'R11A');
      check(discovery?.status === 'complete' && discovery.availableWeek! <= run.startedWeek, 'Planner training began before its method became available.');
    }
    check(plan.reliabilityTargetBps === (['calibration', 'planning', 'policy', 'synthetic'].includes(plan.kind) ? base.reliabilityBps : recipe!.reliabilityTargetBps), 'Reliability target changed.');
    const reliabilityAnchor = ['calibration', 'planning', 'policy', 'synthetic'].includes(plan.kind) ? base.reliabilityBps : (base.foundationAnchor || plan.kind === 'foundation' ? 7000 : lineageRootModel(base, state).reliabilityBps);
    check(run.anchorReliabilityBps === reliabilityAnchor, 'Reliability compounded a prior gain into its anchor.');
    if (plan.kind === 'foundation') {
      check(corpus.broadUnits >= recipe!.minimumBroadUnits && DOMAINS.every(domain => corpus.relevantUnits[domain] >= recipe!.relevantUnits * U) && corpus.behaviorUnits >= 100, 'Foundation evidence gate was bypassed.');
      check(company.postedFacts[run.id + ':setup'], 'Foundation setup fee was not posted.');
    }
    unique(run.checkpointModelIds ?? [], 'Saved checkpoint versions');
    for (const checkpointId of run.checkpointModelIds ?? []) check(models.versions[checkpointId]?.trainingRunId === run.id, 'Checkpoint points to another training run.');
    if (run.status === 'complete') check((run.preparationCompleted ?? 0) === plan.preparationRequired && (run.checkpointOverheadCompleted ?? 0) === plan.checkpointOverheadRequired, 'Completed training skipped preparation or checkpoint overhead.');
  }
  for (const model of Object.values(models.versions)) {
    if (model.behavior) behavior(model.behavior); if (model.foundationAnchor) scores(model.foundationAnchor);
    if (model.policy !== undefined) {
      check(validModelPolicy(model.policy), 'Model policy is outside its authored finite lineage targets.');
      check(model.trainingRunId || model.runtimeVariant, 'An untrained model acquired policy learning.');
      if (model.runtimeVariant) check(same(model.policy, models.versions[model.runtimeVariant.sourceModelId]?.policy), 'A deployment variant changed its source policy.');
    }
    if (model.planner !== undefined) {
      check(validPlannerTrait(model.planner), 'Model planner is outside its finite lineage target.');
      check(model.trainingRunId || model.runtimeVariant, 'An untrained model acquired a planner trait.');
      if (model.runtimeVariant) check(same(model.planner, models.versions[model.runtimeVariant.sourceModelId]?.planner), 'A deployment variant changed its source planner.');
    }
    if (!model.trainingRunId) continue;
    const run = models.trainingRuns[model.trainingRunId]; if (!run) continue;
    const plan = run.plan; if (!plan) { check(model.planner === undefined && model.policy === undefined, 'Legacy training did not earn a planner or policy trait.'); continue; }
    const point = plan.checkpoints.find(item => model.id === (item.atBps === 10000 ? run.outputModelId : 'checkpoint-' + run.id + (item.atBps === 5000 ? '' : '-' + item.atBps)));
    check(point, 'Model is not a named checkpoint in its frozen run.');
    const work = mulDiv(run.requiredWork, point!.atBps, 10000, 'ceil');
    check(work <= run.completedWork && model.parentModelId === run.baseModelId && model.family === plan.family && model.architecture === plan.architecture && model.residentMU === plan.residentMU, 'Model has not earned its saved work or design.');
    const owed = plan.checkpoints.filter(item => item.atBps <= point!.atBps).reduce((sum, item) => sum + item.overheadWork, 0);
    check((run.checkpointOverheadCompleted ?? 0) >= owed, 'Checkpoint model was saved without paying its overhead.');
    const expected = expectedTrainingOutcome(run, work, content);
    check(same(model.capabilityBps, expected.capabilityBps) && model.reliabilityBps === expected.reliabilityBps && same(model.behavior, expected.behavior), 'Model gains differ from its fixed targets, work, evidence or saved adjustment.');
    check(same(model.planner ?? null, expected.planner ?? null), 'Model planning gain differs from its paid work, finite evidence or lineage target.');
    check(same(model.policy ?? null, expected.policy ?? null), 'Model policy differs from its paid work, paired evidence, inherited properties or fixed lineage target.');
    check(model.trainingEvidenceId === trainingEvidenceFingerprint(plan) && same(model.foundationAnchor, plan.foundationAnchor), 'Model lost its evidence or lineage provenance.');
  }
  assertModelDesignInheritance(state);
  const reportPairs = new Set<string>();
  for (const run of Object.values(models.evaluationRuns)) {
    const suite = EVALUATION_SUITES.find(item => item.id === (run.suiteId ?? BASIC_SUITE)); check(suite, 'Evaluation suite is unknown.');
    check(run.requiredWork === suite!.workCUw && run.requiredStaff === suite!.researchStaff, 'Evaluation work requirements changed.');
    if (suite!.requiredResearch) check(hasResearch(state, run.companyId, suite!.requiredResearch), 'Evaluation method was not researched.');
    if (run.reportId) check((models.reports[run.reportId]?.suiteId ?? BASIC_SUITE) === suite!.id, 'Evaluation report uses a different suite.');
  }
  for (const report of Object.values(models.reports)) {
    const suiteId = report.suiteId ?? BASIC_SUITE, suite = EVALUATION_SUITES.find(item => item.id === suiteId); check(suite, 'Report suite is unknown.');
    check(report.cases.length === suite!.cases, 'Held-out report is incomplete.');
    const pair = `${report.companyId}:${report.modelId}:${suiteId}`; check(!reportPairs.has(pair), 'Repeated cases were sold as independent held-out evidence.'); reportPairs.add(pair);
    if (!report.scenarioStart) for (const [index, test] of report.cases.entries()) check(test.id === `${suiteId}:case-${String(index + 1).padStart(2, '0')}`, 'Held-out case identity changed.');
    const model = models.versions[report.modelId];
    check(report.basicChatEligible === (isCapabilitySuite(suiteId) && model.capabilityBps.conversation >= content.firstSale.minConversationBps && model.reliabilityBps >= content.firstSale.minReliabilityBps), 'Release evidence does not match its model and suite.');
    if (suiteId === 'behavior-cases-1') {
      for (const item of report.cases) check(['useful', 'confident-error', 'false-refusal', 'clarification', 'correct-policy-refusal'].includes(item.outcome ?? '') && item.passed === ['useful', 'correct-policy-refusal'].includes(item.outcome!), 'Behavior outcome and case result differ.');
      check(report.outcomes && same(report.outcomes, behaviorOutcomes(report.cases)) && report.outcomes.correctPolicyRefusals === 10 && report.outcomes.eligibleCases === 90, 'Behavior denominators or outcome counts do not reconcile.');
    } else check(report.outcomes === undefined && report.cases.every(item => item.outcome === undefined), 'Capability-only evidence has invented behavior counts.');
  }
  assertIndependentHoldoutsState(state, content);
  assertWave11PolicyHoldouts(state, content);
  record(research.completedByCompany, 'Company research'); record(research.projects, 'Research projects');
  for (const [companyId, completed] of Object.entries(research.completedByCompany)) {
    ownCompany(companyId); unique(completed, 'Completed research');
    for (const researchId of completed) check(content.research.some(item => item.id === researchId), 'Completed knowledge is not in the research catalog.');
  }
  const researchPairs = new Set<string>();
  for (const [key, project] of Object.entries(research.projects)) {
    check(key === project.id, 'Research project identity mismatch.'); ownCompany(project.companyId); past(project.startedWeek);
    const definition = content.research.find(item => item.id === project.researchId); check(definition, 'Research project is not authored.');
    check(['running', 'paused', 'complete'].includes(project.status) && project.requiredWork === definition!.workCUw && project.requiredStaff === definition!.staffWeeks * U && project.role === definition!.role, 'Research requirements changed.');
    meter(project.completedWork, project.requiredWork); meter(project.completedStaff, project.requiredStaff); checkedInteger(project.lastProgress);
    if (project.assistanceStaff !== undefined) { checkedInteger(project.assistanceStaff); check(project.assistanceStaff <= Math.floor((project.completedStaff - project.assistanceStaff) / 5) && project.role === 'research' && project.researchId !== 'R15', 'Research assistance exceeds 20% of actual researcher effort or assisted itself.'); }
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000, 'Research explanation is invalid.');
    const pair = project.companyId + ':' + project.researchId; check(!researchPairs.has(pair), 'Research project was duplicated.'); researchPairs.add(pair);
    check(definition!.requires.every(prerequisite => hasResearch(state, project.companyId, prerequisite)), 'Research started before its prerequisites.');
    check(company.postedFacts[project.id + ':fee'], 'Research entry fee was not posted.');
    if (project.researchId === 'S5') check(Object.values(state.slices.compute.facilities).some(site => site.companyId === project.companyId
      && site.status === 'active' && site.readyWeek !== null && site.readyWeek <= project.startedWeek), 'Facility specialization research preceded an owned site commissioning.');
    if (project.researchId === 'S6') check(Object.values(state.slices.compute.hardwareSales ?? {}).some(sale => sale.companyId === project.companyId
      && sale.shippedWeek !== null && sale.shippedWeek <= project.startedWeek), 'Successor silicon research preceded a verified accelerator buyer shipment.');
    if (project.researchId === 'S5' || project.researchId === 'S6') check(definition!.requires.every(prerequisite =>
      Object.values(research.projects).some(proof => proof.companyId === project.companyId && proof.researchId === prerequisite
        && proof.status === 'complete' && proof.availableWeek !== undefined && proof.availableWeek <= project.startedWeek)), 'Campus research preceded its paid prerequisite availability.');
    if (isModelCustomizationResearch(project.researchId) || isAISystemsResearch(project.researchId)) {
      const founding = project.companyId === state.playerCompanyId ? CAMPAIGN_ORIGINS[state.slices.campaign.origin ?? 'garage'].knowledge
        : hasConnectedCompanyRules(state.contentVersion) ? RIVAL_STARTS.find(rival => 'rival-' + rival.id === project.companyId)?.research ?? [] : [];
      check(definition!.requires.every(prerequisite => founding.includes(prerequisite)
        || Object.values(research.projects).some(proof => proof.companyId === project.companyId && proof.researchId === prerequisite
          && proof.status === 'complete' && proof.availableWeek !== undefined && proof.availableWeek <= project.startedWeek)), 'Model customization research preceded its prerequisite availability.');
      const admission = state.commandReceipts[project.id.slice('research-'.length)];
      check(project.id.startsWith('research-') && admission?.status === 'accepted' && admission.week === project.startedWeek, 'Model customization research has no accepted admission.');
      const proofId = `${project.id}:method:${project.researchId}`;
      check(company.postedFacts[proofId] === true, 'Model customization research changed its paid discovery.');
      for (const id of [...CUSTOMIZATION_RESEARCH_IDS, ...AI_SYSTEM_RESEARCH_IDS]) if (id !== project.researchId)
        check(!company.postedFacts[`${project.id}:method:${id}`], 'Model design research has conflicting discovery receipts.');
      const fee = company.ledger.find(fact => fact.id === project.id + ':fee');
      if (fee) check(fee.companyId === project.companyId && fee.sourceId === project.id && fee.week === project.startedWeek
        && fee.amountCents === definition!.feeCents && fee.kind === 'expense' && fee.category === 'operating', 'Model customization research changed its paid entry fee.');
      const proof = company.ledger.find(fact => fact.id === proofId);
      if (proof) check(proof.companyId === project.companyId && proof.sourceId === project.id && proof.week === project.startedWeek
        && proof.amountCents === 0 && proof.kind === 'expense' && proof.category === 'operating', 'Model customization discovery receipt is invalid.');
    }
    if (project.status === 'complete') {
      past(project.completedWeek!); check(project.completedWeek! >= project.startedWeek && project.availableWeek === project.completedWeek! + 1 && project.completedWork === project.requiredWork && project.completedStaff === project.requiredStaff, 'Completed research has not earned its knowledge.');
      check(hasResearch(state, project.companyId, project.researchId) === (project.availableWeek! <= state.week), 'Research unlocked at the wrong weekly boundary.');
    } else check(project.completedWeek === undefined && project.availableWeek === undefined && !hasResearch(state, project.companyId, project.researchId), 'Unfinished research supplied completed knowledge.');
  }
  const foundingKnowledge = CAMPAIGN_ORIGINS[state.slices.campaign.origin ?? 'garage'].knowledge;
  for (const researchId of research.completedByCompany[state.playerCompanyId] ?? []) check(foundingKnowledge.includes(researchId) || researchPairs.has(state.playerCompanyId + ':' + researchId), 'Player research has no completed project.');
  check(same([...research.completed].sort(), [...(research.completedByCompany[state.playerCompanyId] ?? [])].sort()), 'Player research alias includes another company’s knowledge.');
  const active = Object.values(research.projects).filter(project => project.companyId === state.playerCompanyId && !hasResearch(state, project.companyId, project.researchId)).map(project => project.researchId).sort();
  check(same([...research.active].sort(), active), 'Active player research does not reconcile.');
}
function lineageRootModel(model: ModelVersion, state: GameState): ModelVersion {
  let current = model; const seen = new Set<string>();
  while (current.parentModelId && !seen.has(current.id)) { seen.add(current.id); const parent = state.slices.models.versions[current.parentModelId]; if (!parent) break; current = parent; }
  return current;
}
function lineageRootId(model: ModelVersion, state: GameState): string { return lineageRootModel(model, state).id; }
