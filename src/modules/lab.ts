import { isModelChallengeSuite, validateModelChallengeAdmission, createModelChallengeAdmission } from './model-challenges';
import { DEVELOPMENT_PLAN_COMMANDS } from '../contracts/development-plans';
import { applyDevelopmentCommand, quoteDevelopmentCommand, validateDevelopmentCommand } from './development-plans';
import { formatWorkPoints } from './workforce-points';
import { trainingEvidenceFingerprint } from './replay-curriculum';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { DomainModule, DomainResult, GameCommand, GameContent, GameState, ModelVersion, ModuleContext, Rejection, TrainingRun, WorkRequest } from '../contracts/types';
import { checkedAdd, formatUnits, mulDiv } from '../core/math';
import { DATA_COMMANDS, applyDataCommand, quoteDataCommand, validateDataCommand } from './lab-data';
import { SYNTHETIC_COMMANDS, advanceSyntheticJobs, applySyntheticCommand, commitSyntheticJobs, quoteSyntheticCommand, resolveSyntheticJobs, syntheticRequests, validateSyntheticCommand } from './synthetic-data';
import { BASIC_SUITE, createEvaluationReport, evaluationSuite } from './lab-evaluation';
import { BASE_BEHAVIOR, DOMAINS, buildTrainingPlan, corpusFromPackets, expectedTrainingOutcome, getTrainingPreview, trainingImprovementRejection, validateTrainingOptions } from './lab-planner';
import { hasResearch } from './research';
import { MODEL_APPLICATION_COMMANDS, advanceModelApplications, applyModelApplication, modelApplicationRequests, quoteModelApplication, resolveModelApplications, trainingSupervision, validateModelApplication } from './applied-research';
import { modelExecutionHints } from './model-runtime';
import { createIndependentHoldoutAdmission, INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE } from './independent-holdouts';
import { createPolicyHoldoutAdmission, POLICY_HOLDOUT_ADMISSION_MESSAGE } from './policy-holdouts';
import { FEEDBACK_COMMANDS, applyFeedbackCommand, quoteFeedbackCommand, resolveFeedback, validateFeedbackCommand } from './feedback';
import { FEEDBACK_REVIEW_COMMANDS, advanceFeedbackReviews, applyFeedbackReviewCommand, commitFeedbackReviews, feedbackReviewRequests, quoteFeedbackReviewCommand, resolveFeedbackReviews, validateFeedbackReviewCommand } from './feedback-review';
export { finiteOutcome } from './lab-math';
export type { FiniteOutcomeInput } from './lab-math';
export { getTrainingPreview, getCorpusEvidence } from './lab-planner';

const LAB_COMMANDS = [...DEVELOPMENT_PLAN_COMMANDS, ...DATA_COMMANDS, ...SYNTHETIC_COMMANDS, ...MODEL_APPLICATION_COMMANDS, ...FEEDBACK_COMMANDS, ...FEEDBACK_REVIEW_COMMANDS, 'start_training', 'evaluate_model', 'set_job_paused'] as const;
const workId = (id: string) => id + ':work';
function own<T>(records: Record<string, T>, id: unknown): T | undefined { return typeof id === 'string' && Object.hasOwn(records, id) ? records[id] : undefined; }
const rejection = (code: Rejection['code'], message: string): Rejection => ({ code, message });
function jobFor(state: Readonly<GameState>, id: string) { return own(state.slices.data.preparationJobs, id) ?? own(state.slices.models.trainingRuns, id) ?? own(state.slices.models.evaluationRuns, id) ?? own(state.slices.models.applicationRuns ?? {}, id); }
function queued(state: Readonly<GameState>, command: GameCommand, matches: (other: GameCommand) => boolean): boolean {
  return state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && matches(other));
}
function staffGranted(ctx: ModuleContext, jobId: string, role: 'data' | 'ml' | 'research'): number {
  return ctx.resources.staffGrants.find(grant => grant.requestId === workId(jobId))?.grants.find(grant => grant.role === role)?.staffWeeks ?? 0;
}
function computeGranted(ctx: ModuleContext, jobId: string) { return ctx.resources.computeGrants.find(grant => grant.requestId === workId(jobId)); }
function grantReason(state: Readonly<GameState>, companyId: string, jobId: string): string {
  return state.slices.compute.fleets[companyId]?.lastGrants.find(grant => grant.requestId === workId(jobId))?.reason ?? '';
}
function newRun(state: Readonly<GameState>, command: GameCommand, content: GameContent): TrainingRun {
  if (command.payload.kind !== 'start_training') throw new Error('Training requires a training command.');
  const p = command.payload, planned = buildTrainingPlan(state, command.companyId, p, content, true);
  return {
    id: 'training-' + command.id, companyId: command.companyId, baseModelId: p.baseModelId, packetId: p.packetId,
    outputModelId: 'model-' + command.id, recipeId: planned.recipe.id, startedWeek: state.week,
    requiredWork: planned.requiredWork, completedWork: 0, physicalWork: 0, requiredMemory: planned.requiredMemory,
    status: 'running', checkpointWork: 0, checkpointModelId: null, checkpointModelIds: [],
    anchorScores: planned.anchorScores, anchorReliabilityBps: planned.anchorReliabilityBps,
    evidence: planned.evidence, plan: planned.plan, preparationCompleted: 0, checkpointOverheadCompleted: 0, ...(planned.plan.teacher ? { teacherWorkCompleted: 0, teacherPhysicalWork: 0 } : {}),
    lastProgress: 0, lastBottleneck: usesWorkPointProfiles(state)
      ? planned.plan.preparationRequired ? 'Generate Research points for foundation design before training begins.' : 'Waiting for development compute and Design points.'
      : planned.plan.preparationRequired ? 'Assign research staff for foundation design before training begins.' : 'Waiting for development compute and ML coverage.',
  };
}
function validateLabCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if ((DEVELOPMENT_PLAN_COMMANDS as readonly string[]).includes(p.kind)) return validateDevelopmentCommand(state, command, content);
  if (!own(state.slices.company.companies, command.companyId)) return rejection('UNKNOWN_COMPANY', 'The company does not exist.');
  if ((FEEDBACK_COMMANDS as readonly string[]).includes(p.kind)) return validateFeedbackCommand(state, command, content);
  if ((FEEDBACK_REVIEW_COMMANDS as readonly string[]).includes(p.kind)) return validateFeedbackReviewCommand(state, command, content);
  if (p.kind !== 'set_job_paused' && state.slices.company.companies[command.companyId].arrearsCents) return rejection('ARREARS', 'Resolve unpaid expenses before starting a lab project.');
  if ((DATA_COMMANDS as readonly string[]).includes(p.kind)) return validateDataCommand(state, command);
  if ((SYNTHETIC_COMMANDS as readonly string[]).includes(p.kind)) return validateSyntheticCommand(state, command, content);
  if (p.kind === 'create_model_variant') return validateModelApplication(state, command);
  if (p.kind === 'start_training') {
    const invalid = validateTrainingOptions(state, command.companyId, p, content, command.id); if (invalid) return invalid;
    const run = newRun(state, command, content), base = state.slices.models.versions[p.baseModelId];
    const outcome = expectedTrainingOutcome(run, run.requiredWork, content);
    return trainingImprovementRejection(base, outcome, run.plan!.kind);
  }
  if (p.kind === 'evaluate_model') {
    const model = own(state.slices.models.versions, p.modelId), suite = evaluationSuite(p.suiteId);
    if (!model || model.companyId !== command.companyId) return rejection('NOT_READY', 'Choose one of your saved model checkpoints.');
    if (!suite) return rejection('INVALID_COMMAND', 'Choose an available test suite.');
    if (suite.requiredResearch && !hasResearch(state, command.companyId, suite.requiredResearch)) return rejection('NOT_READY', `Complete ${suite.requiredResearch} before running this test.`);
    const challengeRejection = validateModelChallengeAdmission(state, command.companyId, model.id, suite.id); if (challengeRejection) return challengeRejection;
    if (suite.id === 'independent-holdouts-1' && !createIndependentHoldoutAdmission(state, command.companyId, model.id)) return rejection('NOT_READY', INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE);
    if (suite.id === 'policy-boundaries-1' && !createPolicyHoldoutAdmission(state, command.companyId, model.id)) return rejection('NOT_READY', POLICY_HOLDOUT_ADMISSION_MESSAGE);
    if (Object.values(state.slices.models.reports).some(report => report.companyId === command.companyId && report.modelId === model.id && (report.suiteId ?? BASIC_SUITE) === suite.id)) return rejection('NO_IMPROVEMENT', 'This model has already taken this test. Repeating the same cases will not produce new results.');
    if (Object.values(state.slices.models.evaluationRuns).some(run => run.modelId === model.id && (run.suiteId ?? BASIC_SUITE) === suite.id && run.status !== 'complete')
      || queued(state, command, other => other.payload.kind === 'evaluate_model' && other.payload.modelId === model.id && (other.payload.suiteId ?? BASIC_SUITE) === suite.id)) return rejection('ALREADY_ACTIVE', 'This model already has this test running, paused, or queued.');
    return;
  }
  if (p.kind === 'set_job_paused') {
    const job = jobFor(state, p.jobId);
    if (!job || job.companyId !== command.companyId || typeof p.paused !== 'boolean') return rejection('NOT_READY', 'Choose one of your unfinished lab projects.');
    if (job.status === 'complete') return rejection('NO_IMPROVEMENT', 'This project is complete; its result is saved.');
    if ((job.status === 'paused') === p.paused) return rejection('ALREADY_ACTIVE', p.paused ? 'This project is already paused.' : 'This project is already running.');
    return;
  }
  return rejection('INVALID_COMMAND', 'This action is not a lab command.');
}
function overheadRemaining(run: TrainingRun): number { return (run.plan?.checkpointOverheadRequired ?? 0) - (run.checkpointOverheadCompleted ?? 0); }
function labRequests(state: Readonly<GameState>, content: GameContent): WorkRequest[] {
  const requests: WorkRequest[] = [...modelApplicationRequests(state), ...feedbackReviewRequests(state, content), ...syntheticRequests(state)];
  for (const job of Object.values(state.slices.data.preparationJobs)) {
    if (job.status !== 'running') continue;
    requests.push({ id: workId(job.id), companyId: job.companyId, taskId: job.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 30, poolId: 'auto', staffDemand: [{ role: 'data', staffWeeks: job.requiredStaff - job.completedStaff }] });
  }
  for (const run of Object.values(state.slices.models.trainingRuns)) {
    if (run.status !== 'running') continue;
    const preparation = (run.plan?.preparationRequired ?? 0) - (run.preparationCompleted ?? 0);
    if (preparation > 0) {
      requests.push({ id: workId(run.id), companyId: run.companyId, taskId: run.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 35, poolId: 'auto', staffDemand: [{ role: 'research', staffWeeks: preparation }] });
      continue;
    }
    if (run.plan?.teacher && (run.teacherWorkCompleted ?? 0) < run.plan.teacher.requiredWork) {
      const teacher = state.slices.models.versions[run.plan.teacher.modelId];
      requests.push({ id: 'teacher-work:' + run.id, companyId: run.companyId, taskId: run.id, category: 'serving', normalizedWorkCUw: run.plan.teacher.requiredWork - (run.teacherWorkCompleted ?? 0), memoryMU: run.plan.teacher.residentMU, priority: 30, poolId: 'auto', ...modelExecutionHints(teacher) });
      continue;
    }
    const work = run.requiredWork - run.completedWork + overheadRemaining(run);
    requests.push({ id: workId(run.id), companyId: run.companyId, taskId: run.id, category: 'development', normalizedWorkCUw: work, memoryMU: work ? run.requiredMemory : 0, priority: 40, poolId: 'auto',
      ...modelExecutionHints({ ...state.slices.models.versions[run.baseModelId], architecture: run.plan?.architecture ?? state.slices.models.versions[run.baseModelId].architecture, family: run.plan?.family ?? state.slices.models.versions[run.baseModelId].family }, 'training'), ...trainingSupervision(state, run, work, content) });
  }
  for (const run of Object.values(state.slices.models.evaluationRuns)) {
    if (run.status !== 'running') continue;
    const work = run.requiredWork - run.completedWork, model = state.slices.models.versions[run.modelId];
    requests.push({ id: workId(run.id), companyId: run.companyId, taskId: run.id, category: 'development', normalizedWorkCUw: work, memoryMU: work ? model.residentMU : 0, priority: 20, poolId: 'auto',
      ...modelExecutionHints(model), staffDemand: [{ role: 'research', staffWeeks: run.requiredStaff - run.completedStaff }] });
  }
  return requests;
}
function applyTrainingWork(run: TrainingRun, work: number): void {
  if (work > run.requiredWork - run.completedWork + overheadRemaining(run)) throw new Error('Training grant exceeds remaining useful work and checkpoint overhead.');
  if (!run.plan) { run.completedWork = checkedAdd(run.completedWork, work); return; }
  let remaining = work, overheadTarget = 0;
  for (const checkpoint of run.plan.checkpoints) {
    const threshold = mulDiv(run.requiredWork, checkpoint.atBps, 10000, 'ceil');
    const useful = Math.min(remaining, Math.max(0, threshold - run.completedWork));
    run.completedWork = checkedAdd(run.completedWork, useful); remaining -= useful;
    overheadTarget += checkpoint.overheadWork;
    if (run.completedWork < threshold) break;
    const overhead = Math.min(remaining, Math.max(0, overheadTarget - (run.checkpointOverheadCompleted ?? 0)));
    run.checkpointOverheadCompleted = checkedAdd(run.checkpointOverheadCompleted ?? 0, overhead); remaining -= overhead;
    if ((run.checkpointOverheadCompleted ?? 0) < overheadTarget) break;
  }
  if (remaining) throw new Error('Training grant could not be assigned to its frozen work plan.');
}
function advanceLab(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const data = structuredClone(state.slices.data), models = structuredClone(state.slices.models);
  advanceModelApplications(models, state, ctx);
  advanceFeedbackReviews(state, ctx, data);
  advanceSyntheticJobs(state, ctx, data);
  for (const job of Object.values(data.preparationJobs)) {
    if (job.status !== 'running') continue;
    const progress = Math.min(job.requiredStaff - job.completedStaff, staffGranted(ctx, job.id, 'data'));
    job.completedStaff = checkedAdd(job.completedStaff, progress); job.lastProgress = progress;
    job.lastBottleneck = progress ? '' : usesWorkPointProfiles(state) ? 'No Data points available. Higher-priority work uses the available team output. A data engineer adds 30 Data points per week after onboarding.' : 'No data staff available. Assign the founder to data or hire a data engineer.';
  }
  for (const run of Object.values(models.trainingRuns)) {
    if (run.status !== 'running') continue;
    const preparation = (run.plan?.preparationRequired ?? 0) - (run.preparationCompleted ?? 0);
    if (preparation > 0) {
      const staff = Math.min(preparation, staffGranted(ctx, run.id, 'research'));
      run.preparationCompleted = checkedAdd(run.preparationCompleted ?? 0, staff); run.lastProgress = staff;
      run.lastBottleneck = staff ? '' : usesWorkPointProfiles(state) ? 'Generate Research points to finish foundation design before training begins.' : 'Assign research staff to finish foundation design before training begins.';
      if ((computeGranted(ctx, run.id)?.hardwareEffectiveCUw ?? 0) > 0) throw new Error('Foundation compute cannot precede design preparation.');
      continue;
    }
    if (run.plan?.teacher && (run.teacherWorkCompleted ?? 0) < run.plan.teacher.requiredWork) {
      const teacher = ctx.resources.computeGrants.find(grant => grant.requestId === 'teacher-work:' + run.id);
      run.teacherWorkCompleted = checkedAdd(run.teacherWorkCompleted ?? 0, teacher?.hardwareEffectiveCUw ?? 0); run.teacherPhysicalWork = checkedAdd(run.teacherPhysicalWork ?? 0, teacher?.physicalCUw ?? 0);
      run.lastProgress = teacher?.hardwareEffectiveCUw ?? 0;
      run.lastBottleneck = run.lastProgress ? 'Teacher generation is separate from student training; parameter updates begin after it finishes.' : 'Allocate serving capacity with the teacher’s connected model memory.';
      continue;
    }
    const grant = computeGranted(ctx, run.id), work = grant?.hardwareEffectiveCUw ?? 0;
    if (work > 0 && (!grant || grant.memoryMU < run.requiredMemory)) throw new Error('Training compute was granted without its complete workspace.');
    applyTrainingWork(run, work); run.physicalWork = checkedAdd(run.physicalWork, grant?.physicalCUw ?? 0); run.lastProgress = work;
    run.lastBottleneck = work ? '' : grantReason(state, run.companyId, run.id) || (state.slices.compute.fleets[run.companyId].allocation.development === 0 ? 'No development compute allocated.' : usesWorkPointProfiles(state) ? 'Waiting for Design points, development capacity, or training memory.' : 'Waiting for ML coverage, development capacity, or training memory.');
  }
  for (const run of Object.values(models.evaluationRuns)) {
    if (run.status !== 'running') continue;
    const grant = computeGranted(ctx, run.id), work = grant?.hardwareEffectiveCUw ?? 0;
    if (work > 0 && (!grant || grant.memoryMU < models.versions[run.modelId].residentMU)) throw new Error('Evaluation compute was granted without its model memory.');
    if (work > run.requiredWork - run.completedWork) throw new Error('Evaluation grant exceeds remaining work.');
    const staff = Math.min(run.requiredStaff - run.completedStaff, staffGranted(ctx, run.id, 'research'));
    run.completedWork = checkedAdd(run.completedWork, work); run.completedStaff = checkedAdd(run.completedStaff, staff); run.lastProgress = work;
    const reasons: string[] = [];
    if (run.completedWork < run.requiredWork && !work) reasons.push(grantReason(state, run.companyId, run.id) || 'Waiting for development compute and model memory.');
    if (run.completedStaff < run.requiredStaff && !staff) reasons.push(usesWorkPointProfiles(state) ? 'Generate Research points to finish the held-out review.' : 'Assign research staff to finish the held-out review.');
    run.lastBottleneck = reasons.join(' ');
  }
  return { updates: { data, models } };
}
function makeModel(state: Readonly<GameState>, run: TrainingRun, work: number, week: number, content: GameContent, checkpointBps: number): ModelVersion {
  const base = state.slices.models.versions[run.baseModelId];
  const runs = Object.values(state.slices.models.trainingRuns).filter(item => item.companyId === run.companyId).sort((a, b) => a.startedWeek - b.startedWeek || a.id.localeCompare(b.id));
  const ordinal = runs.findIndex(item => item.id === run.id) + 1, midpoint = checkpointBps < 10000;
  const label = run.recipeId === content.firstTraining.id ? 'Conversation' : (run.plan?.recipeName ?? 'Model');
  return {
    id: midpoint ? 'checkpoint-' + run.id + (checkpointBps === 5000 ? '' : '-' + checkpointBps) : run.outputModelId,
    name: run.plan?.modelDesign ? `${run.plan.modelDesign.spec.name.trim()}${midpoint ? ` · ${checkpointBps / 100}% checkpoint` : ''}` : `${label} ${ordinal}${midpoint ? ` · ${checkpointBps / 100}% checkpoint` : ''}`,
    companyId: run.companyId, family: run.plan?.family ?? base.family, architecture: run.plan?.architecture ?? base.architecture,
    ...(!run.plan?.advanced && run.plan?.kind !== 'foundation' && base.advancedCapabilities ? { advancedCapabilities: structuredClone(base.advancedCapabilities) } : {}),
    ...(run.plan?.modelDesign ? { modelDesign: structuredClone(run.plan.modelDesign) } : run.plan?.kind !== 'foundation' && run.plan?.kind !== 'distillation' && base.modelDesign ? { modelDesign: structuredClone(base.modelDesign) } : {}),
    status: 'checkpoint', ...expectedTrainingOutcome(run, work, content), residentMU: run.plan?.residentMU ?? base.residentMU,
    source: `${run.plan?.recipeName ?? content.firstTraining.name}: ${formatUnits(work)} of ${formatUnits(run.requiredWork)} useful CUw. ${run.plan?.checkpointOverheadRequired ? 'Optional checkpoint overhead is metered separately. ' : ''}Evaluation is separate.`,
    parentModelId: run.baseModelId, trainingRunId: run.id, trainingEvidenceId: run.plan ? trainingEvidenceFingerprint(run.plan) : corpusFromPackets([run.evidence]).fingerprint,
    createdWeek: week, ...(run.plan ? { foundationAnchor: structuredClone(run.plan.foundationAnchor) } : {}),
  };
}
function resolveLab(state: Readonly<GameState>, ctx: ModuleContext, content: GameContent): DomainResult {
  const data = structuredClone(state.slices.data), models = structuredClone(state.slices.models), messages: NonNullable<DomainResult['messages']> = [];
  messages.push(...resolveModelApplications(models, state, ctx));
  messages.push(...resolveFeedback(state, ctx, data), ...resolveFeedbackReviews(state, ctx, data));
  messages.push(...resolveSyntheticJobs(ctx, data));
  for (const job of Object.values(data.preparationJobs)) {
    if (job.status !== 'running' || job.completedStaff < job.requiredStaff) continue;
    const packet = data.packets[job.packetId]; packet.readyUnits = packet.rawUnits; packet.prepared = true;
    job.status = 'complete'; job.completedWeek = ctx.week; job.lastBottleneck = '';
    messages.push({ companyId: job.companyId, category: 'project', message: `${packet.name} is ready: ${packet.readyUnits} reusable units at quality ${packet.qualityBps / 100}.${job.kind === 'deduplicate' ? ' Repeated processing is removed; evidence, targets and existing training budgets are unchanged.' : job.kind === 'curate' ? ' Its source lineage is unchanged.' : ''}` });
  }
  for (const run of Object.values(models.trainingRuns)) {
    if (run.status !== 'running' || (run.preparationCompleted ?? 0) < (run.plan?.preparationRequired ?? 0) || (run.teacherWorkCompleted ?? 0) < (run.plan?.teacher?.requiredWork ?? 0)) continue;
    const checkpoints = run.plan?.checkpoints ?? [{ atBps: 5000, overheadWork: 0 }, { atBps: 10000, overheadWork: 0 }];
    let overheadTarget = 0;
    for (const point of checkpoints) {
      overheadTarget += point.overheadWork; if (point.atBps === 10000) continue;
      const threshold = mulDiv(run.requiredWork, point.atBps, 10000, 'ceil');
      if (run.completedWork < threshold || (run.checkpointOverheadCompleted ?? 0) < overheadTarget) continue;
      const checkpoint = makeModel(state, run, threshold, ctx.week, content, point.atBps);
      if (Object.hasOwn(models.versions, checkpoint.id)) continue;
      models.versions[checkpoint.id] = checkpoint; run.checkpointWork = threshold; run.checkpointModelId = checkpoint.id;
      if (run.plan) (run.checkpointModelIds ??= []).push(checkpoint.id);
      messages.push({ companyId: run.companyId, category: 'project', message: `${checkpoint.name} saved as an immutable model version.` });
    }
    if (run.completedWork < run.requiredWork || overheadRemaining(run) > 0) continue;
    const model = makeModel(state, run, run.requiredWork, ctx.week, content, 10000);
    if (Object.hasOwn(models.versions, model.id)) throw new Error('Completed model version already exists.');
    models.versions[model.id] = model; run.status = 'complete'; run.completedWeek = ctx.week;
    run.checkpointWork = run.requiredWork; run.checkpointModelId = model.id; run.lastBottleneck = '';
    if (run.plan) (run.checkpointModelIds ??= []).push(model.id);
    messages.push({ companyId: run.companyId, category: 'project', message: `${model.name} completed: C ${model.capabilityBps.conversation / 100}, D ${model.capabilityBps.documents / 100}, K ${model.capabilityBps.coding / 100}, T ${model.capabilityBps.tools / 100}; reliability ${model.reliabilityBps / 100}. Evaluate it before release.` });
  }
  for (const run of Object.values(models.evaluationRuns)) {
    if (run.status !== 'running' || run.completedWork < run.requiredWork || run.completedStaff < run.requiredStaff) continue;
    const model = models.versions[run.modelId], suiteId = run.suiteId ?? BASIC_SUITE;
    if (Object.values(models.reports).some(report => report.modelId === model.id && (report.suiteId ?? BASIC_SUITE) === suiteId)) throw new Error('This model already has this held-out report.');
    const report = createEvaluationReport(model, run.id, suiteId, ctx, content, run.holdout, run.policy, run.challenge); models.reports[report.id] = report;
    // A behavior-only report never removes an existing capability release report.
    if (suiteId !== 'independent-holdouts-1' && suiteId !== 'policy-boundaries-1' && !isModelChallengeSuite(suiteId)) models.versions[model.id] = { ...model, status: model.status === 'released' ? 'released' : 'evaluated', evaluationReportId: suiteId === 'behavior-cases-1' && model.evaluationReportId ? model.evaluationReportId : report.id };
    run.status = 'complete'; run.completedWeek = ctx.week; run.reportId = report.id; run.lastBottleneck = '';
    messages.push({ companyId: run.companyId, category: 'project', message: report.holdout
      ? `${model.name} independent outcome report saved: ${report.holdout.totals.actualSuccesses}/${report.holdout.totals.cases} useful outcomes against ${report.holdout.totals.claimedCompletions} claimed completions. Capability release evidence and trained weights are unchanged.`
      : report.policy
      ? `${model.name} policy report saved: ${report.policy.totals.falseRefusals}/${report.policy.totals.allowedCases} allowed requests refused; ${report.policy.totals.unsafeCompliances}/${report.policy.totals.restrictedCases} restricted requests complied with. This is limited game-authored evidence; capability evidence and model weights are unchanged.`
      : report.challenge
      ? `${model.name} challenge complete: ${report.challenge.passedCases}/${report.challenge.totalCases} cases passed. ${report.challenge.earnedTitle ? report.challenge.earnedTitle + ' earned.' : 'Improve the weak skills before attempting this tier with a new model.'} Prior release evidence is retained.`
      : report.outcomes
      ? `${model.name} behavior report saved: ${report.outcomes.usefulAnswers}/${report.outcomes.eligibleCases} useful eligible answers; ${report.outcomes.confidentErrors} confident errors, ${report.outcomes.falseRefusals} false refusals and ${report.outcomes.clarifications} clarifications. Correct policy refusals are outside the eligible denominator.`
      : `${model.name} evaluated: ${report.passedCases}/${report.cases.length} held-out cases passed. ${report.basicChatEligible ? 'Basic Chat capability gates met.' : 'Basic Chat capability gates are not yet met.'} Testing did not train weights.` });
  }
  return { updates: { data, models }, messages };
}
/** Owns prepared evidence, finite model candidates, frozen training plans and held-out reports. */
export function createLabModule(content: GameContent): DomainModule {
  return {
    id: 'lab', owns: ['data', 'models'], commandKinds: LAB_COMMANDS,
    validateCommand: (state, command) => validateLabCommand(state, command, content),
    quoteCommand(state, command) {
      const p = command.payload;
      if ((DEVELOPMENT_PLAN_COMMANDS as readonly string[]).includes(p.kind)) return quoteDevelopmentCommand(state, command, content);
      if ((FEEDBACK_COMMANDS as readonly string[]).includes(p.kind)) return quoteFeedbackCommand(state, command, content);
      if ((FEEDBACK_REVIEW_COMMANDS as readonly string[]).includes(p.kind)) return quoteFeedbackReviewCommand(state, command, content);
      if ((SYNTHETIC_COMMANDS as readonly string[]).includes(p.kind)) return quoteSyntheticCommand(state, command);
      if (p.kind === 'create_model_variant') return quoteModelApplication(command);
      if ((DATA_COMMANDS as readonly string[]).includes(p.kind)) return quoteDataCommand(state, command, content);
      if (p.kind === 'start_training') {
        const preview = getTrainingPreview(state, command.companyId, p, content);
        if (!usesWorkPointProfiles(state)) return { upfrontCostCents: preview.feeCents, weeklyCostDeltaCents: 0, summary: `${preview.recipeName}: ${formatUnits(preview.workCUw)} useful development CUw${preview.checkpointOverheadWork ? ` + ${formatUnits(preview.checkpointOverheadWork)} checkpoint CUw` : ''}, ${formatUnits(preview.memoryMU)} MU workspace${preview.preparationStaff ? ` after ${formatUnits(preview.preparationStaff)} research staff-weeks` : ''}. Targets and evidence are frozen at admission; rent and payroll continue.` };
        return { upfrontCostCents: preview.feeCents, weeklyCostDeltaCents: 0, summary: `${preview.recipeName}: ${formatUnits(preview.workCUw)} development CUw of training work${preview.checkpointOverheadWork ? ` + ${formatUnits(preview.checkpointOverheadWork)} checkpoint CUw` : ''}, ${formatUnits(preview.memoryMU)} MU of memory${preview.preparationStaff ? ` after ${formatWorkPoints(preview.preparationStaff)} Research points` : ''}. Your choices and skill targets are set when training starts. GPU rental and salaries continue.` };
      }
      if (p.kind === 'evaluate_model') {
        const suite = evaluationSuite(p.suiteId)!;
        if (!usesWorkPointProfiles(state)) return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${suite.name}: ${suite.cases} held-out cases, ${formatUnits(suite.workCUw)} development CUw and ${formatUnits(suite.researchStaff)} research staff-weeks. This creates evidence, not trained gains.` };
        return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${suite.name}: ${suite.cases} test cases, ${formatUnits(suite.workCUw)} development CUw and ${formatWorkPoints(suite.researchStaff)} Research points. Testing measures this model; it does not improve it.` };
      }
      return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.kind === 'set_job_paused' && p.paused
        ? usesWorkPointProfiles(state) ? 'Pause next week and keep completed progress and checkpoints. GPU rental and salaries continue.' : 'Pause next week and preserve all completed work and checkpoints. Rent and payroll continue.'
        : 'Resume this project next week with its saved progress.' };
    },
    applyCommand(state, command) {
      const p = command.payload;
      if ((DEVELOPMENT_PLAN_COMMANDS as readonly string[]).includes(p.kind)) return applyDevelopmentCommand(state, command);
      if ((FEEDBACK_COMMANDS as readonly string[]).includes(p.kind)) return applyFeedbackCommand(state, command, content);
      if ((FEEDBACK_REVIEW_COMMANDS as readonly string[]).includes(p.kind)) return applyFeedbackReviewCommand(state, command, content);
      if (p.kind === 'create_model_variant') return applyModelApplication(state, command);
      if ((DATA_COMMANDS as readonly string[]).includes(p.kind)) return applyDataCommand(state, command, content);
      if ((SYNTHETIC_COMMANDS as readonly string[]).includes(p.kind)) return applySyntheticCommand(state, command, content);
      const models = structuredClone(state.slices.models);
      if (p.kind === 'start_training') {
        const run = newRun(state, command, content); models.trainingRuns[run.id] = run;
        const fee = buildTrainingPlan(state, command.companyId, p, content).recipe.feeCents;
        return { updates: { models }, facts: fee ? [{ id: run.id + ':setup', companyId: command.companyId, week: state.week, sourceId: run.id, category: 'operating', amountCents: fee, label: run.plan!.recipeName + ' setup', kind: 'expense' }] : [],
          messages: [{ companyId: command.companyId, category: 'project', message: `${run.plan!.recipeName} started with a frozen evidence plan, finite targets and ${formatUnits(run.requiredWork)} useful CUw.` }] };
      }
      if (p.kind === 'evaluate_model') {
        const id = 'evaluation-' + command.id, suite = evaluationSuite(p.suiteId)!;
        const holdout = suite.id === 'independent-holdouts-1' ? createIndependentHoldoutAdmission(state, command.companyId, p.modelId) : null;
        if (suite.id === 'independent-holdouts-1' && !holdout) throw new Error(INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE);
        const policy = suite.id === 'policy-boundaries-1' ? createPolicyHoldoutAdmission(state, command.companyId, p.modelId) : null;
        if (suite.id === 'policy-boundaries-1' && !policy) throw new Error(POLICY_HOLDOUT_ADMISSION_MESSAGE);
        const challenge = createModelChallengeAdmission(state, command.companyId, p.modelId, suite.id);
        models.evaluationRuns[id] = { id, companyId: command.companyId, modelId: p.modelId, suiteId: suite.id, startedWeek: state.week,
          ...(holdout ? { holdout } : {}),
          ...(policy ? { policy } : {}), ...(challenge ? { challenge } : {}),
          requiredWork: suite.workCUw, completedWork: 0, requiredStaff: suite.researchStaff, completedStaff: 0, status: 'running', reportId: null, lastProgress: 0, lastBottleneck: 'Waiting for development compute and research review.' };
        return { updates: { models }, messages: [{ companyId: command.companyId, category: 'project', message: `${models.versions[p.modelId].name} entered ${suite.name.toLowerCase()} evaluation. Its trained scores will not change.` }] };
      }
      if (p.kind === 'set_job_paused') {
        const data = structuredClone(state.slices.data), job = own(data.preparationJobs, p.jobId) ?? own(models.trainingRuns, p.jobId) ?? own(models.evaluationRuns, p.jobId) ?? own(models.applicationRuns ?? {}, p.jobId);
        if (!job) throw new Error('This project no longer exists.');
        job.status = p.paused ? 'paused' : 'running'; job.lastProgress = 0; job.lastBottleneck = p.paused ? 'Paused by you.' : 'Waiting for the next resource grant.';
        return { updates: { data, models }, messages: [{ companyId: command.companyId, category: 'project', message: `${p.paused ? 'Paused' : 'Resumed'} ${job.id}; completed work and checkpoint identity were preserved.` }] };
      }
      return {};
    },
    handlers: {
      commit(state, ctx) {
        const due = state.scheduled.filter(item => item.kind === 'model_release' && item.dueWeek === ctx.week);
        const feedbackDue = Object.values(state.slices.data.feedbackReviews ?? {}).some(review => review.status === 'ready' && review.availableWeek !== null && review.availableWeek <= ctx.week);
        const syntheticDue = Object.values(state.slices.data.syntheticJobs ?? {}).some(job => job.phase === 'ready' && job.availableWeek !== null && job.availableWeek <= ctx.week);
        if (!due.length && !feedbackDue && !syntheticDue) return {};
        const data = feedbackDue || syntheticDue ? structuredClone(state.slices.data) : undefined;
        const messages = data ? [...commitFeedbackReviews(state, ctx, data), ...commitSyntheticJobs(ctx, data)] : [];
        const models = due.length ? structuredClone(state.slices.models) : undefined;
        for (const item of due) {
          const model = own(models!.versions, item.targetId);
          if (!model || model.companyId !== item.companyId) throw new Error('A release must belong to its scheduled company.');
          models!.versions[item.targetId] = { ...model, status: 'released' };
        }
        return { updates: { ...(models ? { models } : {}), ...(data ? { data } : {}) }, fulfilledScheduleIds: due.map(item => item.id), messages: [...messages, ...due.map(item => ({ companyId: item.companyId, category: 'delivery' as const, message: `${models!.versions[item.targetId].name} is released at this weekly boundary.` }))] };
      },
      reserve: state => ({ workRequests: labRequests(state, content) }), execute: advanceLab,
      resolve: (state, ctx) => resolveLab(state, ctx, content),
    },
  };
}
import { usesWorkPointProfiles } from './workforce';
