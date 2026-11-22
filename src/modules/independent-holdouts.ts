import type { EvaluationCase, EvaluationReport, GameContent, GameState, ModelVersion } from '../contracts/types';
import type { AgentConfiguration, AgentModelSnapshot } from '../contracts/wave3-agents';
import type { IndependentHoldoutAdmission, IndependentHoldoutCase, IndependentHoldoutReport, IndependentHoldoutTotals } from '../contracts/wave7-holdouts';
import { AGENT_ORDERS } from '../content/wave3-agents';
import { INDEPENDENT_HOLDOUT_RULES as RULES } from '../content/wave7-holdouts';
import { canonicalStateHash, hashText } from '../core/canonical';
import { agentExpectedCheck, agentExpectedDraft, agentExpectedPlan } from './agents';
import { isCapabilitySuite } from './evaluation-classification';
import { BASE_BEHAVIOR } from './lab-planner';
import { modelWorkBps } from './model-runtime';

export { INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE } from '../content/wave7-holdouts';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);

function candidate(model: ModelVersion, reportId: string): AgentModelSnapshot {
  return { id: model.id, name: model.name, family: model.family, architecture: model.architecture,
    residentMU: model.residentMU, workBps: modelWorkBps(model), capabilityBps: { ...model.capabilityBps },
    reliabilityBps: model.reliabilityBps, behavior: { ...(model.behavior ?? BASE_BEHAVIOR) }, reportId,
    ...(model.planner ? { planner: { ...model.planner } } : {}) };
}

/** Display names, release status, and the mutable preferred-report pointer are not model properties. */
export function independentHoldoutFingerprint(model: ModelVersion): string {
  const { name: _name, reportId: _reportId, ...properties } = candidate(model, '');
  return canonicalStateHash({ companyId: model.companyId, ...properties });
}

function paidCapabilityReport(state: Readonly<GameState>, model: ModelVersion, reportId: string, atWeek: number): boolean {
  const report = state.slices.models.reports[reportId];
  return !!report && report.modelId === model.id && report.companyId === model.companyId && report.heldOut
    && !report.scenarioStart && isCapabilitySuite(report.suiteId) && report.week <= atWeek
    && Object.values(state.slices.models.evaluationRuns).some(run => run.companyId === model.companyId && run.modelId === model.id
      && run.reportId === report.id && run.status === 'complete' && run.completedWeek === report.week
      && run.completedWork === run.requiredWork && run.completedStaff === run.requiredStaff && isCapabilitySuite(run.suiteId)
      && (run.suiteId ?? 'basic-conversation-1') === (report.suiteId ?? 'basic-conversation-1'));
}

function capturedAdmission(state: Readonly<GameState>, model: ModelVersion, baselineReportId: string): IndependentHoldoutAdmission {
  return { protocol: RULES.protocol, baselineReportId, modelFingerprint: independentHoldoutFingerprint(model),
    // Every candidate faces the same separate reserved cases. A new name, command,
    // report, week, or equivalent model alias cannot choose more favorable cases.
    evidenceKey: canonicalStateHash({ seed: state.seed, companyId: model.companyId, protocol: RULES.protocol }) };
}

export function createIndependentHoldoutAdmission(state: Readonly<GameState>, companyId: string, modelId: string): IndependentHoldoutAdmission | null {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId || model.status === 'checkpoint') return null;
  const baseline = Object.values(state.slices.models.reports).filter(report => paidCapabilityReport(state, model, report.id, state.week))
    .sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0];
  return baseline ? capturedAdmission(state, model, baseline.id) : null;
}

/** This lab protocol invokes the live draft/check/plan rules without running a customer order. */
export function independentHoldoutCases(model: ModelVersion, admission: IndependentHoldoutAdmission): EvaluationCase[] {
  const snapshot = candidate(model, admission.baselineReportId);
  return Array.from({ length: RULES.cases }, (_, index) => {
    const terms = AGENT_ORDERS[index % AGENT_ORDERS.length];
    const configuration: AgentConfiguration = { mode: 'bounded', verification: 'basic', tools: [...terms.readTools, terms.actionTool],
      maxSteps: 24, maxRetries: 0, workBudget: 32_000_000_000 };
    const scenario = { model: snapshot, terms, configuration, evidenceKey: hashText(`${admission.evidenceKey}:reserved-case:${index + 1}`) };
    const outcome = agentExpectedDraft(scenario, 0), actualSuccess = outcome === 'useful';
    const planned = agentExpectedPlan(scenario, 0), plannedLookups = planned.filter(tool => terms.readTools.includes(tool)).length;
    const audit: IndependentHoldoutCase = { templateId: terms.id, outcome, actualSuccess,
      claimedComplete: actualSuccess || outcome === 'confident-error', basicAccepted: agentExpectedCheck(scenario, 0),
      independentAccepted: agentExpectedCheck({ ...scenario, configuration: { ...configuration, verification: 'independent' } }, 0),
      necessaryLookups: terms.readTools.length, plannedLookups, repeatedLookups: Math.max(0, plannedLookups - terms.readTools.length),
      outOfScopeProposals: planned.length - plannedLookups };
    return { id: `${RULES.suiteId}:case-${String(index + 1).padStart(2, '0')}`,
      domain: terms.readTools.includes('search_docs') ? 'documents' : 'conversation', difficultyBps: terms.difficultyBps,
      passed: actualSuccess, holdout: audit };
  });
}

export function independentHoldoutTotals(cases: readonly EvaluationCase[]): IndependentHoldoutTotals {
  const outcomes = cases.map(item => item.holdout!);
  const count = (predicate: (item: IndependentHoldoutCase) => boolean) => outcomes.filter(predicate).length;
  const sum = (key: 'necessaryLookups' | 'plannedLookups' | 'repeatedLookups' | 'outOfScopeProposals') => outcomes.reduce((value, item) => value + item[key], 0);
  const actualSuccesses = count(item => item.actualSuccess);
  return { cases: cases.length, claimedCompletions: count(item => item.claimedComplete), actualSuccesses,
    unsuccessfulCases: cases.length - actualSuccesses, basicAccepted: count(item => item.basicAccepted),
    basicFalseAccepts: count(item => item.basicAccepted && !item.actualSuccess), independentAccepted: count(item => item.independentAccepted),
    independentFalseAccepts: count(item => item.independentAccepted && !item.actualSuccess), necessaryLookups: sum('necessaryLookups'),
    plannedLookups: sum('plannedLookups'), repeatedLookups: sum('repeatedLookups'), outOfScopeProposals: sum('outOfScopeProposals') };
}

export function createIndependentHoldoutResult(model: ModelVersion, admission: IndependentHoldoutAdmission): { cases: EvaluationCase[]; holdout: IndependentHoldoutReport } {
  const cases = independentHoldoutCases(model, admission);
  return { cases, holdout: { ...admission, totals: independentHoldoutTotals(cases) } };
}

function assertAdmission(state: Readonly<GameState>, model: ModelVersion, admission: IndependentHoldoutAdmission | undefined, atWeek: number): void {
  check(admission && typeof admission === 'object' && !Array.isArray(admission), 'Independent holdouts lost their reserved protocol and candidate.');
  const saved = admission!;
  check(paidCapabilityReport(state, model, saved.baselineReportId, atWeek), 'Independent holdouts need this candidate’s prior paid capability report.');
  check(same(saved, capturedAdmission(state, model, saved.baselineReportId)), 'Independent holdouts changed their frozen candidate or reserved case set.');
}

/** New diagnostics reconcile exactly. Existing suites retain their published validation rules. */
export function assertIndependentHoldoutsState(state: GameState, _content: GameContent): void {
  const { models, research } = state.slices, pairs = new Set<string>();
  for (const run of Object.values(models.evaluationRuns)) {
    if (run.suiteId !== RULES.suiteId) { check(run.holdout === undefined, 'An ordinary evaluation contains an independent-holdout receipt.'); continue; }
    const model = models.versions[run.modelId];
    check(model && model.companyId === run.companyId && model.status !== 'checkpoint', 'Independent holdouts lost their owned evaluated candidate.');
    check((research.completedByCompany[run.companyId] ?? []).includes(RULES.researchId), 'Independent holdouts were not researched.');
    const method = Object.values(research.projects).find(project => project.companyId === run.companyId && project.researchId === RULES.researchId);
    check(method?.status === 'complete' && method.availableWeek !== undefined && method.availableWeek <= run.startedWeek,
      'Independent holdouts began before their researched method became available.');
    check(run.requiredWork === RULES.workCUw && run.requiredStaff === RULES.researchStaff, 'Independent holdouts changed their paid requirements.');
    assertAdmission(state, model, run.holdout, run.startedWeek);
    const pair = run.companyId + ':' + run.modelId;
    check(!pairs.has(pair), 'Independent holdouts were rerun on the same candidate.'); pairs.add(pair);
  }
  for (const report of Object.values(models.reports)) {
    if (report.suiteId !== RULES.suiteId) {
      check(report.holdout === undefined && report.cases.every(item => item.holdout === undefined), 'An ordinary report contains independent-holdout results.');
      continue;
    }
    const model = models.versions[report.modelId], run = Object.values(models.evaluationRuns).find(item => item.reportId === report.id);
    check(run && run.suiteId === RULES.suiteId && run.companyId === report.companyId && run.modelId === report.modelId
      && run.status === 'complete' && run.completedWeek === report.week && report.id === 'report-' + run.id,
    'Independent holdout results have no completed paid evaluation.');
    check(model && report.heldOut && !report.scenarioStart && report.basicChatEligible === false && model.evaluationReportId !== report.id,
      'Independent holdouts cannot manufacture a capability release.');
    const expected = createIndependentHoldoutResult(model, run!.holdout!);
    check(same(report.holdout ?? null, expected.holdout) && same(report.cases, expected.cases)
      && report.passedCases === expected.holdout.totals.actualSuccesses && report.outcomes === undefined,
    'Independent claims, checker decisions, outcomes, or planner counts do not reconcile with their reserved cases.');
  }
}

export function independentHoldoutReport(state: Readonly<GameState>, modelId: string): EvaluationReport | undefined {
  return Object.values(state.slices.models.reports).find(report => report.modelId === modelId && report.suiteId === RULES.suiteId);
}
