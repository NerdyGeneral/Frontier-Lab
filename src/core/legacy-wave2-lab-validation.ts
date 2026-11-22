/** Frozen schema-3 validation for authentic Wave 2 saves. */
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameContent, GameState, ModelVersion } from '../contracts/types';
import { DATA_CATALOG, EVALUATION_SUITES, FAMILY_DESIGNS, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';
import { BASE_BEHAVIOR, DOMAINS, expectedTrainingOutcome, getCorpusEvidence, packetSources, trainingIdentity } from '../modules/lab-planner';
import { BASIC_SUITE, behaviorOutcomes } from '../modules/lab-evaluation';
import { hasResearch } from '../modules/research';
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
    if (packet.parentPacketId) {
      const parent = data.packets[packet.parentPacketId];
      check(parent && parent.companyId === packet.companyId && parent.prepared, 'Curated revision has no owned prepared parent.');
      check(packet.revision === (parent.revision ?? 0) + 1 && same(packetSources(packet), packetSources(parent)), 'Curation changed source identity or revision order.');
      check(packet.rawUnits === parent.rawUnits && packet.qualityBps === Math.min(9500, parent.qualityBps + 1000)
        && same(packet.coverageBps, parent.coverageBps) && same(packet.rights, parent.rights)
        && packet.behaviorUnits === parent.behaviorUnits && packet.broadUnits === parent.broadUnits, 'Curation manufactured volume, coverage, rights, or an invalid quality gain.');
    }
    const catalog = DATA_CATALOG.find(item => item.id === packet.catalogId);
    if (catalog && !packet.parentPacketId) {
      check(packet.rawUnits === catalog.rawUnits && packet.qualityBps === catalog.qualityBps && same(packet.coverageBps, catalog.coverageBps)
        && same(packet.rights, catalog.rights) && packet.behaviorUnits === catalog.behaviorUnits && packet.broadUnits === catalog.broadUnits
        && same(packet.sourceIds, [catalog.id]), 'Purchased evidence differs from its authored edition.');
      id(packet.purchaseFactId); past(packet.purchasedWeek!);
      check(company.postedFacts[packet.purchaseFactId!], 'Purchased data has no posted purchase charge.');
    }
  }
  for (const job of Object.values(data.preparationJobs)) {
    const packet = data.packets[job.packetId]; check(packet.companyId === job.companyId, 'Preparation is using another company’s data.');
    if (job.kind === 'curate') {
      check(job.sourcePacketId === packet.parentPacketId && job.requiredStaff === 3 * U && hasResearch(state, job.companyId, 'R2'), 'Curation requirements or source lineage are invalid.');
    } else {
      const catalog = DATA_CATALOG.find(item => item.id === packet.catalogId);
      check(job.requiredStaff === (catalog?.preparationStaff ?? content.preparation.staffWeeks * U), 'Data preparation changed its staff requirement.');
    }
  }
  const trainingIdentities = new Set<string>();
  for (const run of Object.values(models.trainingRuns)) {
    const recipe = TRAINING_RECIPES.find(item => item.id === run.recipeId); check(recipe, 'Training recipe is not authored.');
    const base = models.versions[run.baseModelId];
    check(data.packets[run.packetId]?.companyId === run.companyId, 'Training primary evidence belongs to another company.');
    if (!run.plan) {
      check(run.recipeId === content.firstTraining.id && run.requiredWork === content.firstTraining.workCUw && run.requiredMemory === content.firstSale.trainingMemory, 'Legacy opening training requirements changed.');
      continue;
    }
    const plan = run.plan; record(plan, 'Frozen training plan');
    check(plan.recipeName === recipe!.name && plan.kind === recipe!.kind && plan.architecture === 'dense', 'Training recipe or architecture changed after admission.');
    check(Object.hasOwn(FAMILY_DESIGNS, plan.family) && (recipe!.family ? plan.family === recipe!.family : plan.family === base.family), 'A specialization changed model size.');
    const design = FAMILY_DESIGNS[plan.family];
    check(plan.residentMU === design.residentMU && run.requiredMemory === design.residentMU * (plan.kind === 'foundation' ? 3 : 2), 'Training workspace does not fit its saved design.');
    check(Object.hasOwn(TRAINING_PROFILES, plan.profile) && typeof plan.profileApplied === 'boolean', 'Unknown training profile.');
    const profile = TRAINING_PROFILES[plan.profile], trainsCapabilities = ['adaptation', 'foundation'].includes(plan.kind);
    if (!trainsCapabilities) check(plan.profile === 'balanced' && !plan.profileApplied, 'Behavior curricula cannot acquire a free capability target tier.');
    let required = trainsCapabilities ? mulDiv(recipe!.workCUw, profile.workMultiplierBps, 10000, 'ceil') : recipe!.workCUw;
    unique(plan.methods, 'Applied training methods');
    check(plan.methods.every(method => ['R3', 'R4', recipe!.requiredResearch].includes(method)), 'Training contains an unknown applied method.');
    for (const method of plan.methods) check(hasResearch(state, run.companyId, method), 'Training applied unavailable research.');
    if (plan.methods.includes('R4')) { check(plan.kind === 'adaptation', 'Efficient adaptation cannot discount foundation or behavior work.'); required = mulDiv(required, 7500, 10000, 'ceil'); }
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
    const identity = trainingIdentity(state, run.companyId, { baseModelId: run.baseModelId, packetId: run.packetId, recipeId: run.recipeId, profile: plan.profileApplied ? plan.profile : undefined }, recipe!, corpus);
    check(plan.identity === identity && !trainingIdentities.has(plan.identity), 'Training identity was changed or repeated to reroll an outcome.'); trainingIdentities.add(plan.identity);
    id(plan.lineageId); check(plan.lineageId === (plan.kind === 'foundation' ? 'foundation-' + identity : (base.trainingRunId ? models.trainingRuns[base.trainingRunId]?.plan?.lineageId ?? lineageRootId(base, state) : base.id)), 'Training lineage anchor changed.');
    scores(plan.targets); scores(plan.ceilings); scores(plan.foundationAnchor); check(same(plan.ceilings, design.ceilings), 'Family ceilings changed.');
    const anchor = plan.kind === 'foundation' ? { conversation: 2000, documents: 2000, coding: 1000, tools: 1000 } : base.foundationAnchor ?? lineageRootModel(base, state).capabilityBps;
    check(same(plan.foundationAnchor, anchor) && same(run.anchorScores, trainsCapabilities ? anchor : base.capabilityBps), 'Training compounded a previous gain into its saved anchor.');
    for (const domain of DOMAINS) {
      const target = trainsCapabilities ? Math.min(design.ceilings[domain], recipe!.targets[domain] + profile.targetBonusBps) : base.capabilityBps[domain];
      check(plan.targets[domain] === target, 'Training absolute target changed.');
      checkedInteger(plan.savedAdjustments[domain], 'saved adjustment', false);
      const draw = parseInt(canonicalStateHash({ seed: state.seed, stream: `training-profile:${identity}:${domain}` }), 16) / 4294967296;
      const expectedAdjustment = plan.profileApplied ? Math.floor(draw * (2 * profile.varianceBps + 1)) - profile.varianceBps : 0;
      check(plan.savedAdjustments[domain] === expectedAdjustment, 'Saved profile adjustment was rerolled.');
    }
    behavior(plan.behaviorAnchor); behavior(plan.behaviorTarget);
    const rootBehavior = lineageRootModel(base, state).behavior ?? BASE_BEHAVIOR;
    check(same(plan.behaviorAnchor, rootBehavior), 'Calibration changed its saved lineage anchor.');
    if (plan.kind === 'calibration') check(plan.behaviorTarget.confidentErrorBps === Math.floor(rootBehavior.confidentErrorBps / 2) && plan.behaviorTarget.falseRefusalBps === (base.behavior ?? BASE_BEHAVIOR).falseRefusalBps, 'Calibration invented a capability or refusal gain.');
    else check(same(plan.behaviorTarget, plan.kind === 'foundation' ? BASE_BEHAVIOR : base.behavior ?? BASE_BEHAVIOR), 'A capability recipe silently changed model behavior.');
    check(plan.reliabilityTargetBps === (plan.kind === 'calibration' ? base.reliabilityBps : recipe!.reliabilityTargetBps), 'Reliability target changed.');
    const reliabilityAnchor = plan.kind === 'calibration' ? base.reliabilityBps : (base.foundationAnchor || plan.kind === 'foundation' ? 7000 : lineageRootModel(base, state).reliabilityBps);
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
    if (!model.trainingRunId) continue;
    const run = models.trainingRuns[model.trainingRunId]; if (!run) continue;
    const plan = run.plan; if (!plan) continue;
    const point = plan.checkpoints.find(item => model.id === (item.atBps === 10000 ? run.outputModelId : 'checkpoint-' + run.id + (item.atBps === 5000 ? '' : '-' + item.atBps)));
    check(point, 'Model is not a named checkpoint in its frozen run.');
    const work = mulDiv(run.requiredWork, point!.atBps, 10000, 'ceil');
    check(work <= run.completedWork && model.parentModelId === run.baseModelId && model.family === plan.family && model.architecture === plan.architecture && model.residentMU === plan.residentMU, 'Model has not earned its saved work or design.');
    const owed = plan.checkpoints.filter(item => item.atBps <= point!.atBps).reduce((sum, item) => sum + item.overheadWork, 0);
    check((run.checkpointOverheadCompleted ?? 0) >= owed, 'Checkpoint model was saved without paying its overhead.');
    const expected = expectedTrainingOutcome(run, work, content);
    check(same(model.capabilityBps, expected.capabilityBps) && model.reliabilityBps === expected.reliabilityBps && same(model.behavior, expected.behavior), 'Model gains differ from its fixed targets, work, evidence or saved adjustment.');
    check(model.trainingEvidenceId === plan.corpus.fingerprint && same(model.foundationAnchor, plan.foundationAnchor), 'Model lost its evidence or lineage provenance.');
  }
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
    check(report.basicChatEligible === (suiteId !== 'behavior-cases-1' && model.capabilityBps.conversation >= content.firstSale.minConversationBps && model.reliabilityBps >= content.firstSale.minReliabilityBps), 'Release evidence does not match its model and suite.');
    if (suiteId === 'behavior-cases-1') {
      for (const item of report.cases) check(['useful', 'confident-error', 'false-refusal', 'clarification', 'correct-policy-refusal'].includes(item.outcome ?? '') && item.passed === ['useful', 'correct-policy-refusal'].includes(item.outcome!), 'Behavior outcome and case result differ.');
      check(report.outcomes && same(report.outcomes, behaviorOutcomes(report.cases)) && report.outcomes.correctPolicyRefusals === 10 && report.outcomes.eligibleCases === 90, 'Behavior denominators or outcome counts do not reconcile.');
    } else check(report.outcomes === undefined && report.cases.every(item => item.outcome === undefined), 'Capability-only evidence has invented behavior counts.');
  }
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
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000, 'Research explanation is invalid.');
    const pair = project.companyId + ':' + project.researchId; check(!researchPairs.has(pair), 'Research project was duplicated.'); researchPairs.add(pair);
    check(definition!.requires.every(prerequisite => hasResearch(state, project.companyId, prerequisite)), 'Research started before its prerequisites.');
    check(company.postedFacts[project.id + ':fee'], 'Research entry fee was not posted.');
    if (project.status === 'complete') {
      past(project.completedWeek!); check(project.completedWeek! >= project.startedWeek && project.availableWeek === project.completedWeek! + 1 && project.completedWork === project.requiredWork && project.completedStaff === project.requiredStaff, 'Completed research has not earned its knowledge.');
      check(hasResearch(state, project.companyId, project.researchId) === (project.availableWeek! <= state.week), 'Research unlocked at the wrong weekly boundary.');
    } else check(project.completedWeek === undefined && project.availableWeek === undefined && !hasResearch(state, project.companyId, project.researchId), 'Unfinished research supplied completed knowledge.');
  }
  for (const researchId of research.completedByCompany[state.playerCompanyId] ?? []) check(researchPairs.has(state.playerCompanyId + ':' + researchId), 'Player research has no completed project.');
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
