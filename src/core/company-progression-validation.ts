import type { CompanyAmbitionId, CompanyAmbitionWeek, CompanyChapterProof, ResearchProgramId } from '../contracts/company-progression';
import type { ChapterId } from '../contracts/strategic-variety';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import { COMPANY_AMBITIONS, COMPANY_AMBITION_HISTORY_LIMIT, COMPANY_AMBITION_IDS, COMPANY_WORLDS, RESEARCH_EXPERIMENT_LIMIT, RESEARCH_PROGRAM_IDS } from '../content/company-progression';
import { CHAPTERS } from '../content/strategic-variety';
import { captureCompanyAmbitionWeek, companyAmbitionCriteria, connectedChapterCriteria } from '../modules/company-progression';
import { companyChapterEarnedWeek, companyWorldId } from '../modules/progression-state';
import { createResearchExperimentTerms, experimentFeeId, getResearchProgramLevel, researchExperimentChecks, researchModelFingerprint } from '../modules/research-programs';
import { hasCompletedModelTraining } from '../modules/campaign-progress';
import { getAISystemMetrics } from '../modules/ai-systems';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { isPaidChallengeReport } from '../modules/model-challenges';
import { canonicalStateHash } from './canonical';
import { hasConnectedCompanyRules } from './connected-company-version';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.');
}
function keys(value: object, expected: readonly string[], label: string): void {
  check(Object.keys(value).sort().join() === [...expected].sort().join(), label + ' has unknown or missing fields.');
}
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum, label + ' is outside its allowed range.');
}
function identifier(value: unknown, label: string): asserts value is string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value), label + ' is invalid.');
}

export function assertCompanyProgressionCommand(payload: CommandPayload): void {
  if (payload.kind !== 'start_research_experiment') return;
  keys(payload, ['kind', 'programId', 'modelId'], 'Systems experiment command');
  check(RESEARCH_PROGRAM_IDS.includes(payload.programId), 'Choose an authored systems research program.');
  identifier(payload.modelId, 'Experiment model');
}

function validateChapterProof(state: GameState, id: ChapterId, proof: CompanyChapterProof): void {
  record(proof, 'Background chapter proof');
  keys(proof, ['week', 'sourceKind', 'sourceId', 'modelId', 'reportIds', 'billedCents', 'fulfillmentBps', 'revenueCents', 'operatingExpenseCents',
    'efficient', 'efficiencyReason', 'efficiencyInstallationId', 'secondaryModelId'], 'Background chapter proof');
  integer(proof.week, 'Background chapter week', state.slices.campaign.progression!.activatedWeek + 1, state.week);
  identifier(proof.sourceId, 'Chapter service'); identifier(proof.modelId, 'Chapter model');
  const model = state.slices.models.versions[proof.modelId];
  check(model?.companyId === state.playerCompanyId && hasCompletedModelTraining(state, model), 'Background chapters require an owned, trained model.');
  check(['product', 'contract', 'commission'].includes(proof.sourceKind), 'Background chapter service type is invalid.');
  const source = proof.sourceKind === 'product' ? state.slices.products.offers[proof.sourceId]
    : proof.sourceKind === 'contract' ? state.slices.products.commercialContracts[proof.sourceId] : state.slices.campaign.systemsBriefs?.[proof.sourceId];
  check(source && (proof.sourceKind === 'commission' || 'companyId' in source && source.companyId === state.playerCompanyId), 'Background chapter service is missing or belongs to another company.');
  integer(proof.billedCents, 'Chapter paid work', 1); integer(proof.fulfillmentBps, 'Chapter delivery', 0, 10000);
  integer(proof.revenueCents, 'Chapter revenue'); integer(proof.operatingExpenseCents, 'Chapter expenses');
  check(typeof proof.efficient === 'boolean' && typeof proof.efficiencyReason === 'string' && proof.efficiencyReason.length <= 200, 'Chapter efficiency evidence is malformed.');
  check(Array.isArray(proof.reportIds) && proof.reportIds.length >= 1 && proof.reportIds.length <= 2 && new Set(proof.reportIds).size === proof.reportIds.length, 'Chapter evaluation evidence is invalid.');
  const reports = proof.reportIds.map(reportId => {
    identifier(reportId, 'Chapter report'); const report = state.slices.models.reports[reportId];
    check(report?.modelId === model.id && report.companyId === state.playerCompanyId && isPaidChallengeReport(state, report, proof.week), 'Chapter evidence must be paid, completed work on the exact model.');
    return report;
  });
  check(reports.some(report => isCapabilitySuite(report.suiteId)), 'Chapter proof is missing a paid capability evaluation.');
  if (proof.efficiencyInstallationId !== null) {
    identifier(proof.efficiencyInstallationId, 'Efficiency installation');
    check(proof.sourceKind === 'product' && proof.efficiencyInstallationId.startsWith('efficiency:'), 'Only a product may use a paid efficiency installation.');
    const receipt = state.commandReceipts[proof.efficiencyInstallationId.slice('efficiency:'.length)];
    check(receipt?.status === 'accepted' && receipt.week < proof.week, 'Efficiency evidence has no accepted installation before service.');
    if (proof.secondaryModelId !== null) {
      identifier(proof.secondaryModelId, 'Efficiency secondary model');
      const secondary = state.slices.models.versions[proof.secondaryModelId];
      check(secondary?.companyId === state.playerCompanyId && secondary.id !== model.id, 'The efficiency route needs two distinct owned models.');
    }
  } else {
    check(proof.secondaryModelId === null, 'A secondary efficiency model has no paid route.');
    if (proof.efficient) {
      const metrics = getAISystemMetrics(model);
      check(metrics.servingCUwPer1000 <= 0.2 && Math.max(...Object.values(model.capabilityBps)) >= 5500
        || model.runtimeVariant && model.runtimeVariant.servingWorkBps <= 8500, 'The model has no measured efficiency improvement.');
    }
  }
  check(connectedChapterCriteria(state, id, proof).every(criterion => criterion.met), 'Background chapter proof contains an unmet requirement.');
}
function chapterSequence(state: GameState, id: ChapterId, rows: CompanyChapterProof[], complete: boolean): void {
  check(Array.isArray(rows) && rows.length <= CHAPTERS[id].weeks && (!complete || rows.length === CHAPTERS[id].weeks), 'Background chapter has the wrong number of qualifying weeks.');
  rows.forEach((row, index) => { validateChapterProof(state, id, row); if (index) check(row.week === rows[index - 1].week + 1, 'Background chapter weeks must be consecutive.'); });
}
function ambitionRow(state: GameState, row: CompanyAmbitionWeek): void {
  record(row, 'Company ambition evidence');
  keys(row, ['week', 'revenueCents', 'operatingExpenseCents', 'cashCents', 'baseCostCents', 'arrearsCents', 'serviceBps', 'efficientBilledCents',
    'privateBilledCents', 'verifiedBilledCents', 'hardwareDeliveries', 'hardwareRevenueCents', 'hardwareCostCents', 'programLevels'], 'Company ambition evidence');
  for (const [key, value] of Object.entries(row)) if (key !== 'programLevels') integer(value, 'Company ambition ' + key);
  integer(row.week, 'Company ambition week', state.slices.campaign.progression!.activatedWeek + 1, state.week);
  integer(row.serviceBps, 'Company ambition delivery', 0, 10000);
  integer(row.hardwareDeliveries, 'Hardware deliveries', 0, 4);
  record(row.programLevels, 'Company research evidence'); keys(row.programLevels, RESEARCH_PROGRAM_IDS, 'Company research evidence');
  for (const id of RESEARCH_PROGRAM_IDS) {
    integer(row.programLevels[id], 'Company research stage', 0, 4);
    check(row.programLevels[id] === getResearchProgramLevel(state, id, row.week), 'Company research credit is not backed by completed paid experiments.');
  }
  const legacy = state.slices.campaign.history.find(week => week.week === row.week);
  if (legacy) for (const field of ['revenueCents', 'operatingExpenseCents', 'cashCents', 'baseCostCents', 'arrearsCents'] as const)
    check(row[field] === legacy[field], 'Company ambition finances differ from the settled company ledger.');
}

export function validateCompanyProgressionState(state: GameState, content: GameContent): void {
  const progression = state.slices.campaign.progression;
  if (progression === undefined) return;
  record(progression, 'Connected company progression');
  keys(progression, ['version', 'activatedWeek', 'worldId', 'chapters', 'experiments', 'ambitionHistory', 'ambitions'], 'Connected company progression');
  check(hasConnectedCompanyRules(state.contentVersion) && hasConnectedCompanyRules(content.version) && progression.version === 1, 'Connected company progression does not belong to this campaign.');
  integer(progression.activatedWeek, 'Company progression boundary', 0, state.week);
  check(Object.hasOwn(COMPANY_WORLDS, progression.worldId) && progression.worldId === companyWorldId(state.seed), 'Company world differs from its fixed seed.');
  record(progression.chapters, 'Background chapters');
  check(Object.keys(progression.chapters).every(id => Object.hasOwn(CHAPTERS, id)), 'Unknown background chapter.');
  for (const [id, track] of Object.entries(progression.chapters)) {
    record(track, 'Background chapter track'); keys(track, ['progress', 'achievement'], 'Background chapter track');
    chapterSequence(state, id as ChapterId, track.progress, false);
    if (track.achievement === null) { check(track.progress.length < CHAPTERS[id as ChapterId].weeks, 'A completed background chapter lost its achievement.'); continue; }
    record(track.achievement, 'Background chapter achievement'); keys(track.achievement, ['earnedWeek', 'proof'], 'Background chapter achievement');
    chapterSequence(state, id as ChapterId, track.achievement.proof, true);
    check(track.achievement.earnedWeek === track.achievement.proof.at(-1)?.week && canonicalStateHash(track.progress) === canonicalStateHash(track.achievement.proof), 'Background chapter achievement differs from its earned proof.');
  }
  record(progression.experiments, 'Systems experiments');
  check(Object.keys(progression.experiments).length <= RESEARCH_EXPERIMENT_LIMIT, 'Systems experiment archive is full.');
  check(Object.values(progression.experiments).filter(experiment => experiment.status === 'running').length <= 1, 'Only one systems experiment may run at a time.');
  const attempts = new Set<string>();
  for (const [id, experiment] of Object.entries(progression.experiments)) {
    record(experiment, 'Systems experiment');
    keys(experiment, ['id', 'commandId', 'programId', 'companyId', 'modelId', 'modelFingerprint', 'baselineReportId', 'startedWeek', 'terms',
      'completedWork', 'physicalWork', 'completedStaff', 'grants', 'status', 'completedWeek', 'availableWeek', 'passed', 'lastBottleneck'], 'Systems experiment');
    identifier(id, 'Experiment identity'); identifier(experiment.commandId, 'Experiment command');
    check(experiment.id === id && id === 'systems-experiment:' + experiment.commandId && experiment.companyId === state.playerCompanyId, 'Experiment identity or owner changed.');
    check(RESEARCH_PROGRAM_IDS.includes(experiment.programId), 'Unknown research program.');
    integer(experiment.startedWeek, 'Experiment funding week', progression.activatedWeek + 1, state.week);
    const receipt = state.commandReceipts[experiment.commandId];
    check(receipt?.status === 'accepted' && receipt.week === experiment.startedWeek, 'Experiment has no accepted funding command.');
    const model = state.slices.models.versions[experiment.modelId], report = state.slices.models.reports[experiment.baselineReportId];
    check(model?.companyId === state.playerCompanyId && experiment.modelFingerprint === researchModelFingerprint(model), 'Experiment model differs from the funded immutable candidate.');
    check(report?.companyId === state.playerCompanyId && report.modelId === model.id && isCapabilitySuite(report.suiteId) && isPaidChallengeReport(state, report, experiment.startedWeek - 1), 'Experiment baseline is not an earlier completed paid capability evaluation.');
    record(experiment.terms, 'Experiment terms');
    integer(experiment.terms.stage, 'Experiment stage', 1, 4);
    const terms = createResearchExperimentTerms(state, experiment.programId, experiment.terms.stage, experiment.startedWeek);
    check(canonicalStateHash(experiment.terms) === canonicalStateHash(terms), 'Experiment cost or workload differs from its frozen protocol and earned benefits.');
    const firstChapter = companyChapterEarnedWeek(state, 'first-product');
    check(firstChapter !== null && firstChapter < experiment.startedWeek, 'Experiment lacks earned applied-research access.');
    check(getResearchProgramLevel(state, experiment.programId, experiment.startedWeek) === experiment.terms.stage - 1, 'Experiment skipped a paid research stage.');
    if (experiment.terms.stage === 4) check((companyChapterEarnedWeek(state, 'frontier-lab') ?? Number.MAX_SAFE_INTEGER) < experiment.startedWeek
      || Object.values(progression.ambitions).some(ambition => ambition.earnedWeek < experiment.startedWeek), 'Frontier experiment lacks an earned company testbed.');
    const key = experiment.programId + ':' + experiment.terms.stage + ':' + experiment.modelFingerprint;
    check(!attempts.has(key), 'An exact systems experiment was rerolled.'); attempts.add(key);
    const fee = state.slices.company.ledger.find(entry => entry.id === experimentFeeId(id));
    check(state.slices.company.postedFacts[experimentFeeId(id)], 'Experiment entry cost has not been posted.');
    if (fee) check(fee.sourceId === id && fee.companyId === experiment.companyId && fee.week === experiment.startedWeek && fee.kind === 'expense' && fee.category === 'operating'
      && fee.amountCents === terms.feeCents && fee.paidCents === terms.feeCents && fee.unpaidCents === 0, 'Experiment entry cost has not been paid exactly once.');
    integer(experiment.completedWork, 'Experiment compute', 0, terms.requiredWork); integer(experiment.completedStaff, 'Experiment staff', 0, terms.requiredStaff);
    integer(experiment.physicalWork, 'Experiment physical work');
    check(Array.isArray(experiment.grants) && experiment.grants.length <= 2048, 'Experiment grant evidence is invalid or unbounded.');
    let work = 0, physical = 0, staff = 0;
    experiment.grants.forEach((grant, index) => {
      record(grant, 'Experiment resource grant'); keys(grant, ['week', 'work', 'physicalWork', 'staff'], 'Experiment resource grant');
      integer(grant.week, 'Experiment grant week', experiment.startedWeek, experiment.completedWeek ?? state.week);
      integer(grant.work, 'Experiment granted work'); integer(grant.physicalWork, 'Experiment physical grant'); integer(grant.staff, 'Experiment staff grant');
      check((grant.work > 0 || grant.staff > 0) && (grant.work > 0 ? grant.physicalWork > 0 : grant.physicalWork === 0), 'Experiment work must have real resource grants.');
      if (index) check(grant.week > experiment.grants[index - 1].week, 'Experiment grant weeks are duplicated or out of order.');
      work += grant.work; physical += grant.physicalWork; staff += grant.staff;
    });
    check(work === experiment.completedWork && physical === experiment.physicalWork && staff === experiment.completedStaff, 'Experiment progress was not earned by resource grants.');
    check(typeof experiment.lastBottleneck === 'string' && experiment.lastBottleneck.length <= 400, 'Experiment status message is invalid.');
    const finished = experiment.completedWork === terms.requiredWork && experiment.completedStaff === terms.requiredStaff;
    if (experiment.status === 'complete') {
      integer(experiment.completedWeek, 'Experiment completion', experiment.startedWeek, state.week);
      check(finished && experiment.availableWeek === experiment.completedWeek + 1 && experiment.grants.at(-1)?.week === experiment.completedWeek,
        'Experiment completion lacks its full paid compute and staff work.');
      check(experiment.passed === researchExperimentChecks(model, experiment.programId, terms).every(test => test.passed), 'Experiment result differs from the model and frozen constraints.');
    } else check(experiment.status === 'running' && !finished && experiment.completedWeek === null && experiment.availableWeek === null && experiment.passed === null, 'Unfinished experiment contains unearned results.');
  }
  check(Array.isArray(progression.ambitionHistory) && progression.ambitionHistory.length <= COMPANY_AMBITION_HISTORY_LIMIT, 'Company ambition history is unbounded.');
  progression.ambitionHistory.forEach((row, index) => { ambitionRow(state, row); if (index) check(row.week > progression.ambitionHistory[index - 1].week, 'Company ambition weeks are not increasing.'); });
  const latest = progression.ambitionHistory.at(-1);
  if (latest?.week === state.week) {
    const delivered = captureCompanyAmbitionWeek(state, content);
    // The history is the settled financial snapshot. Planning/employee progression can change next-week base costs.
    const expected = { ...delivered, revenueCents: latest.revenueCents, operatingExpenseCents: latest.operatingExpenseCents,
      cashCents: latest.cashCents, baseCostCents: latest.baseCostCents, arrearsCents: latest.arrearsCents };
    check(canonicalStateHash(latest) === canonicalStateHash(expected), 'Current company ambition metrics differ from delivered work.');
  }
  record(progression.ambitions, 'Company ambitions');
  for (const [id, achievement] of Object.entries(progression.ambitions)) {
    check(COMPANY_AMBITION_IDS.includes(id as CompanyAmbitionId), 'Unknown company ambition.');
    record(achievement, 'Company ambition achievement'); keys(achievement, ['earnedWeek', 'proof'], 'Company ambition achievement');
    const definition = COMPANY_AMBITIONS[id as CompanyAmbitionId];
    check(Array.isArray(achievement.proof) && achievement.proof.length === definition.weeks, 'Company ambition has incomplete evidence.');
    achievement.proof.forEach((row, index) => {
      ambitionRow(state, row);
      check(companyAmbitionCriteria(row, id as CompanyAmbitionId).every(criterion => criterion.met) && (!index || row.week === achievement.proof[index - 1].week + 1), 'Company ambition proof includes a failed or nonconsecutive week.');
    });
    check(achievement.earnedWeek === achievement.proof.at(-1)?.week, 'Company ambition award date differs from its proof.');
  }
}
