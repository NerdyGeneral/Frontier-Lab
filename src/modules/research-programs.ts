import type { ResearchExperiment, ResearchExperimentTerms, ResearchProgramId } from '../contracts/company-progression';
import type { CommandQuote, DomainResult, GameCommand, GameState, ModelVersion, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { RESEARCH_EXPERIMENT_LIMIT, RESEARCH_PROGRAMS, RESEARCH_PROGRAM_IDS, RESEARCH_PROGRAM_STAGES } from '../content/company-progression';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getAISystemMetrics } from './ai-systems';
import { isCapabilitySuite } from './evaluation-classification';
import { isPaidChallengeReport } from './model-challenges';
import { earnedCompanyChapters, getCompanyWorld } from './progression-state';
import { formatWorkPoints } from './workforce-points';

export const RESEARCH_PROGRAM_COMMANDS = ['start_research_experiment'] as const;
export const experimentWorkId = (id: string) => id + ':work';
export const experimentFeeId = (id: string) => id + ':fee';

export function researchModelFingerprint(model: ModelVersion): string {
  return canonicalStateHash({ id: model.id, capabilityBps: model.capabilityBps, advancedCapabilities: model.advancedCapabilities ?? null,
    reliabilityBps: model.reliabilityBps, metrics: getAISystemMetrics(model) });
}
export function getResearchProgramLevel(state: Readonly<GameState>, programId: ResearchProgramId, atWeek = state.week): number {
  const experiments = Object.values(state.slices.campaign.progression?.experiments ?? {});
  let level = 0;
  for (let stage = 1; stage <= 4; stage++) {
    if (!experiments.some(experiment => experiment.programId === programId && experiment.terms.stage === stage
      && experiment.status === 'complete' && experiment.passed && experiment.availableWeek !== null && experiment.availableWeek <= atWeek)) break;
    level = stage;
  }
  return level;
}
export function createResearchExperimentTerms(state: Readonly<GameState>, programId: ResearchProgramId, stage: number, atWeek = state.week + 1): ResearchExperimentTerms {
  if (!RESEARCH_PROGRAM_IDS.includes(programId) || !Number.isSafeInteger(stage) || stage < 1 || stage > 4) throw new Error('Choose an authored research program stage.');
  const world = getCompanyWorld(state);
  if (!world) throw new Error('Systems research requires a connected company campaign.');
  // Funding commits before that week's work. Only earlier settled achievements may reduce its frozen cost.
  const origin = state.slices.campaign.origin ?? 'garage', chapterIds = earnedCompanyChapters(state, atWeek - 1);
  let feeCents = 150000 * stage * stage;
  if (world.favoredProgram === programId) feeCents = mulDiv(feeCents, 8500, 10000, 'ceil');
  if (origin === 'garage') feeCents = mulDiv(feeCents, 9000, 10000, 'ceil');
  let requiredWork = stage * 4 * U, requiredStaff = (stage + 2) * U;
  if (chapterIds.includes('efficient-portfolio')) requiredWork = mulDiv(requiredWork, 8500, 10000, 'ceil');
  if (chapterIds.includes('advanced-specialist')) requiredStaff = mulDiv(requiredStaff, 8000, 10000, 'ceil');
  if (origin === 'university') requiredStaff = mulDiv(requiredStaff, 8500, 10000, 'ceil');
  const index = stage - 1;
  return { version: 1, stage, worldId: world.id, origin, chapterIds, feeCents, requiredWork, requiredStaff,
    concurrentSessions: [25, 50, 100, 200][index], minimumQualityBps: [5000, 5500, 6000, 6500][index],
    minimumReliabilityBps: [8400, 8700, 9000, 9200][index],
    maximumServingMicroCUw: programId === 'efficient-systems' ? [300000, 240000, 180000, 120000][index] : programId === 'verified-systems' ? 2500000 : 1000000,
    maximumMemoryMU: (programId === 'efficient-systems' ? [8, 12, 16, 24][index] : [18, 24, 32, 52][index]) * U,
    maximumLatencyBps: programId === 'verified-systems' ? [60000, 50000, 45000, 43000][index] : 15000,
    minimumRetentionBps: programId === 'persistent-systems' ? [5000, 5800, 6600, 7500][index] : 0,
    minimumVerifiedBps: programId === 'verified-systems' ? [5800, 6500, 7200, 7900][index] : 0 };
}
export function researchExperimentChecks(model: ModelVersion, programId: ResearchProgramId, terms: ResearchExperimentTerms) {
  const metrics = getAISystemMetrics(model), advanced = model.advancedCapabilities ?? { reasoning: 0, longContext: 0, multimodal: 0 };
  const quality = programId === 'efficient-systems' ? Math.max(model.capabilityBps.conversation, model.capabilityBps.coding, model.capabilityBps.documents)
    : programId === 'persistent-systems' ? Math.floor((model.capabilityBps.documents + advanced.longContext) / 2)
      : Math.floor((model.capabilityBps.tools + model.capabilityBps.coding + advanced.reasoning) / 3);
  const serving = Math.round(metrics.servingCUwPer1000 * 1_000_000), memory = metrics.residentMU + metrics.sessionMemoryMU * terms.concurrentSessions;
  return [
    { id: 'quality', label: 'Useful task performance', actual: quality, target: terms.minimumQualityBps, passed: quality >= terms.minimumQualityBps, detail: `${(quality / 100).toFixed(1)} / ${terms.minimumQualityBps / 100} minimum` },
    { id: 'reliability', label: 'Reliability', actual: model.reliabilityBps, target: terms.minimumReliabilityBps, passed: model.reliabilityBps >= terms.minimumReliabilityBps, detail: `${model.reliabilityBps / 100}% / ${terms.minimumReliabilityBps / 100}% minimum` },
    { id: 'cost', label: 'Compute per 1,000 requests', actual: serving, target: terms.maximumServingMicroCUw, passed: serving <= terms.maximumServingMicroCUw, detail: `${metrics.servingCUwPer1000.toFixed(3)} / ${(terms.maximumServingMicroCUw / 1_000_000).toFixed(3)} CUw maximum` },
    { id: 'memory', label: `Memory for ${terms.concurrentSessions} sessions`, actual: memory, target: terms.maximumMemoryMU, passed: memory <= terms.maximumMemoryMU, detail: `${formatUnits(memory)} / ${formatUnits(terms.maximumMemoryMU)} MU maximum` },
    { id: 'latency', label: 'Response-time index', actual: metrics.latencyBps, target: terms.maximumLatencyBps, passed: metrics.latencyBps <= terms.maximumLatencyBps, detail: `${(metrics.latencyBps / 10000).toFixed(2)} / ${(terms.maximumLatencyBps / 10000).toFixed(2)} maximum` },
    ...(terms.minimumRetentionBps ? [{ id: 'retention', label: 'State retained', actual: metrics.retentionBps, target: terms.minimumRetentionBps, passed: metrics.retentionBps >= terms.minimumRetentionBps, detail: `${(metrics.retentionBps / 100).toFixed(1)}% / ${terms.minimumRetentionBps / 100}% minimum` }] : []),
    ...(terms.minimumVerifiedBps ? [{ id: 'verification', label: 'Verified completion', actual: metrics.verifiedCompletionBps, target: terms.minimumVerifiedBps, passed: metrics.verifiedCompletionBps >= terms.minimumVerifiedBps, detail: `${(metrics.verifiedCompletionBps / 100).toFixed(1)}% / ${terms.minimumVerifiedBps / 100}% minimum` }] : []),
  ];
}
export function researchExperimentBaseline(state: Readonly<GameState>, modelId: string, atWeek = state.week) {
  return Object.values(state.slices.models.reports).filter(report => report.companyId === state.playerCompanyId && report.modelId === modelId
    && isCapabilitySuite(report.suiteId) && isPaidChallengeReport(state, report, atWeek)).sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
}
export function researchProgramGate(state: Readonly<GameState>, programId: ResearchProgramId, modelId: string, atWeek = state.week): string | undefined {
  const progression = state.slices.campaign.progression;
  if (!progression || !getCompanyWorld(state)) return 'Advance a current campaign to open systems research programs.';
  if (!RESEARCH_PROGRAM_IDS.includes(programId)) return 'Choose a listed research program.';
  if (!earnedCompanyChapters(state, atWeek).includes('first-product')) return 'Deliver your first trained, independently tested paying service to open applied research.';
  const stage = getResearchProgramLevel(state, programId, atWeek) + 1;
  if (stage > 4) return 'All four stages of this research program are earned.';
  if (stage === 4 && !earnedCompanyChapters(state, atWeek).includes('frontier-lab') && !Object.keys(progression.ambitions).length)
    return 'Earn a company ambition or the Frontier chapter to open the frontier testbed.';
  if (Object.values(progression.experiments).some(experiment => experiment.status === 'running')) return 'Finish the active systems experiment before funding another.';
  if (Object.keys(progression.experiments).length >= RESEARCH_EXPERIMENT_LIMIT) return 'This campaign has filled its systems experiment archive.';
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== state.playerCompanyId || !researchExperimentBaseline(state, modelId, atWeek)) return 'Choose your own model with a completed paid capability evaluation.';
  const fingerprint = researchModelFingerprint(model);
  if (Object.values(progression.experiments).some(experiment => experiment.programId === programId && experiment.terms.stage === stage && experiment.modelFingerprint === fingerprint))
    return 'This exact model has already been tested at this stage. Develop or evaluate a different model; the test cannot be rerolled.';
}
export function validateResearchProgramCommand(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const payload = command.payload;
  if (payload.kind !== 'start_research_experiment') return { code: 'INVALID_COMMAND', message: 'Choose a research experiment.' };
  if (command.companyId !== state.playerCompanyId) return { code: 'NOT_READY', message: 'This research program belongs to your company.' };
  const reason = researchProgramGate(state, payload.programId, payload.modelId, command.issuedForWeek);
  if (reason) return { code: 'NOT_READY', message: reason };
  if (state.queuedCommands.some(other => other.id !== command.id && other.payload.kind === 'start_research_experiment')) return { code: 'ALREADY_ACTIVE', message: 'A systems experiment is already queued.' };
}
export function quoteResearchProgramCommand(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const payload = command.payload;
  if (payload.kind !== 'start_research_experiment') throw new Error('Expected a systems experiment.');
  const stage = getResearchProgramLevel(state, payload.programId, command.issuedForWeek) + 1;
  const terms = createResearchExperimentTerms(state, payload.programId, stage, command.issuedForWeek);
  const checks = researchExperimentChecks(state.slices.models.versions[payload.modelId], payload.programId, terms), misses = checks.filter(check => !check.passed);
  return { upfrontCostCents: terms.feeCents, weeklyCostDeltaCents: 0, summary: `${RESEARCH_PROGRAMS[payload.programId].name} · ${RESEARCH_PROGRAM_STAGES[stage - 1]}: pay ${formatMoney(terms.feeCents)}, then deliver ${formatUnits(terms.requiredWork)} research CUw and ${formatWorkPoints(terms.requiredStaff)} Research points. ${misses.length ? 'Current model falls short: ' + misses.map(check => check.label).join(', ') + '.' : 'The current model meets all published constraints.'} Only completed, passing work earns accreditation; results become available the following week.` };
}
export function applyResearchProgramCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const payload = command.payload;
  if (payload.kind !== 'start_research_experiment') return {};
  const campaign = structuredClone(state.slices.campaign), progression = campaign.progression!;
  const stage = getResearchProgramLevel(state, payload.programId, command.issuedForWeek) + 1;
  const terms = createResearchExperimentTerms(state, payload.programId, stage, command.issuedForWeek), model = state.slices.models.versions[payload.modelId];
  const id = 'systems-experiment:' + command.id;
  progression.experiments[id] = { id, commandId: command.id, programId: payload.programId, companyId: command.companyId,
    modelId: model.id, modelFingerprint: researchModelFingerprint(model), baselineReportId: researchExperimentBaseline(state, model.id, command.issuedForWeek)!.id,
    startedWeek: state.week, terms, completedWork: 0, physicalWork: 0, completedStaff: 0, grants: [],
    status: 'running', completedWeek: null, availableWeek: null, passed: null, lastBottleneck: 'Waiting for funded research compute and Research points.' };
  return { updates: { campaign }, facts: [{ id: experimentFeeId(id), sourceId: id, companyId: command.companyId, week: state.week,
    category: 'operating', kind: 'expense', amountCents: terms.feeCents, label: `${RESEARCH_PROGRAMS[payload.programId].name} · stage ${stage} experiment` }],
    messages: [{ category: 'project', message: `Funded ${RESEARCH_PROGRAMS[payload.programId].name}, stage ${stage}. The model, paid baseline report and workload constraints are fixed for this experiment.` }] };
}
export function researchExperimentRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.campaign.progression?.experiments ?? {}).filter(experiment => experiment.status === 'running').map(experiment => {
    const model = state.slices.models.versions[experiment.modelId], metrics = getAISystemMetrics(model);
    return { id: experimentWorkId(experiment.id), companyId: experiment.companyId, taskId: experiment.id, category: 'research',
      normalizedWorkCUw: experiment.terms.requiredWork - experiment.completedWork,
      memoryMU: metrics.residentMU + metrics.sessionMemoryMU * experiment.terms.concurrentSessions,
      workloadKind: 'inference', modelArchitecture: model.architecture, modelFamily: model.family,
      requiresFastFabric: model.architecture === 'sparse', priority: 55, poolId: 'auto',
      staffDemand: [{ role: 'research', staffWeeks: experiment.terms.requiredStaff - experiment.completedStaff }] };
  });
}
export function advanceResearchExperiments(state: Readonly<GameState>, context: ModuleContext): DomainResult {
  if (!Object.values(state.slices.campaign.progression?.experiments ?? {}).some(experiment => experiment.status === 'running')) return {};
  const campaign = structuredClone(state.slices.campaign), messages: NonNullable<DomainResult['messages']> = [];
  for (const experiment of Object.values(campaign.progression!.experiments)) {
    if (experiment.status !== 'running') continue;
    const compute = context.resources.computeGrants.find(grant => grant.requestId === experimentWorkId(experiment.id));
    const staff = context.resources.staffGrants.find(grant => grant.requestId === experimentWorkId(experiment.id))?.grants.find(grant => grant.role === 'research')?.staffWeeks ?? 0;
    const work = compute?.hardwareEffectiveCUw ?? 0, physicalWork = compute?.physicalCUw ?? 0;
    if (work > experiment.terms.requiredWork - experiment.completedWork || staff > experiment.terms.requiredStaff - experiment.completedStaff)
      throw new Error('A systems experiment received more than its remaining paid work.');
    experiment.completedWork = checkedAdd(experiment.completedWork, work); experiment.physicalWork = checkedAdd(experiment.physicalWork, physicalWork);
    experiment.completedStaff = checkedAdd(experiment.completedStaff, staff);
    if (work || staff) experiment.grants.push({ week: context.week, work, physicalWork, staff });
    experiment.lastBottleneck = [experiment.completedWork < experiment.terms.requiredWork && !work ? 'Allocate research compute and enough memory for the published session workload.' : '',
      experiment.completedStaff < experiment.terms.requiredStaff && !staff ? 'Assign Research points.' : ''].filter(Boolean).join(' ');
    if (experiment.completedWork !== experiment.terms.requiredWork || experiment.completedStaff !== experiment.terms.requiredStaff) continue;
    const model = state.slices.models.versions[experiment.modelId];
    if (researchModelFingerprint(model) !== experiment.modelFingerprint) throw new Error('The funded experiment model changed.');
    experiment.status = 'complete'; experiment.completedWeek = context.week; experiment.availableWeek = context.week + 1;
    experiment.passed = researchExperimentChecks(model, experiment.programId, experiment.terms).every(check => check.passed);
    experiment.lastBottleneck = experiment.passed ? `Accreditation is available in Week ${experiment.availableWeek}.` : 'The completed test found unmet constraints. Compare its results before developing the next candidate.';
    messages.push({ category: 'project', message: `${RESEARCH_PROGRAMS[experiment.programId].name}, stage ${experiment.terms.stage}: ${experiment.passed ? 'passed. The next stage and earned product accreditation become available next week.' : 'experiment completed with unmet constraints. Its paid evidence is retained; improve the model before retrying.'}` });
  }
  return { updates: { campaign }, messages };
}
