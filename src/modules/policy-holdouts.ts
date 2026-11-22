import type { EvaluationCase, EvaluationReport, GameState, ModelVersion, Rejection } from '../contracts/types';
import type { PolicyHoldoutAdmission, PolicyHoldoutCase, PolicyHoldoutReport, PolicyHoldoutTotals } from '../contracts/wave11-policy';
import { POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS, POLICY_HOLDOUT_RULES as RULES } from '../content/wave11-policy';
import { EVALUATION_SUITES } from '../content/wave2-lab';
import { canonicalStateHash, hashText } from '../core/canonical';
import { mulDiv } from '../core/math';
import { isCapabilitySuite } from './evaluation-classification';

export { POLICY_HOLDOUT_ADMISSION_MESSAGE } from '../content/wave11-policy';
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const ordinaryBehavior = (model: ModelVersion) => model.behavior ?? { confidentErrorBps: 1000, falseRefusalBps: 700 };

/** Freeze the candidate's intrinsic properties, never its mutable display name, release status or report pointer. */
export function policyModelFingerprint(model: ModelVersion): string {
  return canonicalStateHash({ id: model.id, companyId: model.companyId, family: model.family, architecture: model.architecture,
    capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, residentMU: model.residentMU,
    behavior: ordinaryBehavior(model), ...(model.policy ? { policy: model.policy } : {}),
    ...(model.runtimeVariant ? { runtimeVariant: model.runtimeVariant } : {}), ...(model.planner ? { planner: model.planner } : {}),
    ...(model.parentModelId ? { parentModelId: model.parentModelId } : {}),
    ...(model.trainingEvidenceId ? { trainingEvidenceId: model.trainingEvidenceId } : {}) });
}

/** A copied, diagnostic, scenario or merely queued report cannot authorize the next paid test. */
export function paidPolicyCapabilityBaseline(state: Readonly<GameState>, model: ModelVersion, reportId: string, atWeek: number): boolean {
  const report = state.slices.models.reports[reportId];
  return !!report && report.modelId === model.id && report.companyId === model.companyId && report.heldOut
    && !report.scenarioStart && isCapabilitySuite(report.suiteId) && report.week <= atWeek
    && same(report.capabilityBps, model.capabilityBps) && report.reliabilityBps === model.reliabilityBps
    && Object.values(state.slices.models.evaluationRuns).some(run => {
      const suite = EVALUATION_SUITES.find(item => item.id === (run.suiteId ?? 'basic-conversation-1'));
      return run.companyId === model.companyId && run.modelId === model.id && run.reportId === report.id
        && report.id === 'report-' + run.id && run.status === 'complete' && run.completedWeek === report.week
        && run.requiredWork === suite?.workCUw && run.completedWork === run.requiredWork
        && run.requiredStaff === suite?.researchStaff && run.completedStaff === run.requiredStaff && isCapabilitySuite(run.suiteId)
        && (run.suiteId ?? 'basic-conversation-1') === (report.suiteId ?? 'basic-conversation-1');
    });
}

export function capturedPolicyHoldoutAdmission(state: Readonly<GameState>, model: ModelVersion, baselineReportId: string): PolicyHoldoutAdmission {
  return { protocol: RULES.protocol, baselineReportId, modelFingerprint: policyModelFingerprint(model),
    evidenceKey: canonicalStateHash({ seed: state.seed, companyId: model.companyId, protocol: RULES.protocol }) };
}

export function createPolicyHoldoutAdmission(state: Readonly<GameState>, companyId: string, modelId: string): PolicyHoldoutAdmission | null {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId || model.status === 'checkpoint') return null;
  const baseline = Object.values(state.slices.models.reports).filter(report => paidPolicyCapabilityBaseline(state, model, report.id, state.week))
    .sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0];
  return baseline ? capturedPolicyHoldoutAdmission(state, model, baseline.id) : null;
}

const allowedCategories: PolicyHoldoutCase['category'][] = ['privacy', 'permission', 'valid-sensitive-request', 'harmful-assistance'];
const restrictedCategories: PolicyHoldoutCase['category'][] = ['privacy', 'permission', 'harmful-assistance'];
const domains: Record<PolicyHoldoutCase['category'], keyof ModelVersion['capabilityBps']> = {
  privacy: 'documents', permission: 'tools', 'valid-sensitive-request': 'conversation', 'harmful-assistance': 'conversation',
};

/** Each candidate faces the same fictional cases; no model ID, command, week or simulation RNG enters a draw. */
export function policyHoldoutCases(model: ModelVersion, admission: PolicyHoldoutAdmission): EvaluationCase[] {
  const behavior = ordinaryBehavior(model), unsafe = model.policy?.currentUnsafeComplianceBps ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS;
  return Array.from({ length: RULES.cases }, (_, index) => {
    const eligibility = index < RULES.allowedCases ? 'allowed' : 'restricted';
    const groupIndex = eligibility === 'allowed' ? index : index - RULES.allowedCases;
    const challenge = groupIndex < 25 ? 'direct' : 'adversarial';
    const categories = eligibility === 'allowed' ? allowedCategories : restrictedCategories;
    const category = categories[groupIndex % categories.length], domain = domains[category];
    const difficultyBps = challenge === 'direct' ? 1000 : 2000;
    const draw = parseInt(hashText(`${admission.evidenceKey}:reserved-policy-case:${index + 1}`), 16) % 10000;
    let outcome: PolicyHoldoutCase['outcome'];
    if (eligibility === 'restricted') {
      // Equal direct/adversarial halves preserve the trait's mean tendency while showing pressure-specific failures.
      const unsafeBps = Math.min(10000, mulDiv(unsafe, challenge === 'direct' ? 7500 : 12500, 10000));
      outcome = draw < unsafeBps ? 'unsafe-compliance' : 'correct-policy-refusal';
    } else {
      const technical = Math.max(500, Math.min(9800, 5000 + model.capabilityBps[domain as keyof ModelVersion['capabilityBps']] - difficultyBps));
      const success = mulDiv(technical, model.reliabilityBps, 10000);
      const refusal = Math.min(success, behavior.falseRefusalBps), useful = success - refusal;
      const confident = Math.min(10000 - success, behavior.confidentErrorBps);
      outcome = draw < useful ? 'useful' : draw < useful + refusal ? 'false-refusal'
        : draw < useful + refusal + confident ? 'confident-error' : 'clarification';
    }
    return { id: `${RULES.suiteId}:case-${String(index + 1).padStart(2, '0')}`, domain, difficultyBps,
      passed: outcome === 'useful' || outcome === 'correct-policy-refusal', policy: { category, eligibility, challenge, outcome } };
  });
}

export function policyHoldoutTotals(cases: readonly EvaluationCase[]): PolicyHoldoutTotals {
  const outcomes = cases.map(item => item.policy!);
  const count = (predicate: (item: PolicyHoldoutCase) => boolean) => outcomes.filter(predicate).length;
  const result = (outcome: PolicyHoldoutCase['outcome']) => count(item => item.outcome === outcome);
  return { cases: cases.length, allowedCases: count(item => item.eligibility === 'allowed'),
    usefulAnswers: result('useful'), confidentErrors: result('confident-error'), falseRefusals: result('false-refusal'), clarifications: result('clarification'),
    restrictedCases: count(item => item.eligibility === 'restricted'), correctPolicyRefusals: result('correct-policy-refusal'), unsafeCompliances: result('unsafe-compliance'),
    directRestrictedCases: count(item => item.eligibility === 'restricted' && item.challenge === 'direct'),
    directUnsafeCompliances: count(item => item.challenge === 'direct' && item.outcome === 'unsafe-compliance'),
    adversarialRestrictedCases: count(item => item.eligibility === 'restricted' && item.challenge === 'adversarial'),
    adversarialUnsafeCompliances: count(item => item.challenge === 'adversarial' && item.outcome === 'unsafe-compliance') };
}

export function createPolicyHoldoutResult(model: ModelVersion, admission: PolicyHoldoutAdmission): { cases: EvaluationCase[]; policy: PolicyHoldoutReport } {
  const cases = policyHoldoutCases(model, admission);
  return { cases, policy: { ...admission, totals: policyHoldoutTotals(cases) } };
}

/** Only a completed paid test of this immutable version can satisfy a new policy-trained candidate's release requirement. */
export function policyHoldoutReport(state: Readonly<GameState>, modelId: string): EvaluationReport | undefined {
  const model = state.slices.models.versions[modelId];
  if (!model) return;
  return Object.values(state.slices.models.reports).find(report => {
    if (report.suiteId !== RULES.suiteId || report.modelId !== modelId || report.companyId !== model.companyId
      || !report.heldOut || report.scenarioStart || report.basicChatEligible || report.week > state.week || !report.policy) return false;
    const run = Object.values(state.slices.models.evaluationRuns).find(item => item.reportId === report.id);
    if (!run?.policy || run.modelId !== modelId || run.companyId !== model.companyId || run.suiteId !== RULES.suiteId
      || run.status !== 'complete' || run.completedWeek !== report.week || report.id !== 'report-' + run.id
      || run.requiredWork !== RULES.workCUw || run.completedWork !== run.requiredWork
      || run.requiredStaff !== RULES.researchStaff || run.completedStaff !== run.requiredStaff
      || !paidPolicyCapabilityBaseline(state, model, run.policy.baselineReportId, run.startedWeek - 1)
      || !same(run.policy, capturedPolicyHoldoutAdmission(state, model, run.policy.baselineReportId))) return false;
    const expected = createPolicyHoldoutResult(model, run.policy);
    return same(report.policy, expected.policy) && same(report.cases, expected.cases)
      && report.passedCases === expected.cases.filter(item => item.passed).length;
  });
}

export function policyReleaseRejection(state: Readonly<GameState>, modelId: string): Rejection | undefined {
  const model = state.slices.models.versions[modelId];
  if (!model?.policy) return;
  const report = policyHoldoutReport(state, modelId);
  if (!report) return { code: 'NOT_READY', message: 'This policy-trained candidate needs its exact paid policy boundary report before commercial use.' };
  const totals = report.policy!.totals;
  if (totals.unsafeCompliances > RULES.unsafeCeiling) return { code: 'NOT_READY',
    message: `This candidate complied with ${totals.unsafeCompliances}/${totals.restrictedCases} restricted cases; commercial admission requires at most ${RULES.unsafeCeiling}/${RULES.restrictedCases}. Train a different candidate; repeating this fixed test cannot reroll the result.` };
}
