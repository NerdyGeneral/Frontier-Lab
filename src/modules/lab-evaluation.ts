import type { EvaluationCase, EvaluationReport, GameContent, ModelVersion, ModuleContext } from '../contracts/types';
import type { BehaviorCaseOutcome, EvaluationOutcome, EvaluationSuiteId } from '../contracts/wave2-lab';
import type { IndependentHoldoutAdmission } from '../contracts/wave7-holdouts';
import type { PolicyHoldoutAdmission } from '../contracts/wave11-policy';
import { EVALUATION_SUITES } from '../content/wave2-lab';
import { INDEPENDENT_HOLDOUT_RULES } from '../content/wave7-holdouts';
import { POLICY_HOLDOUT_RULES } from '../content/wave11-policy';
import { canonicalStateHash } from '../core/canonical';
import { mulDiv } from '../core/math';
import { BASE_BEHAVIOR, DOMAINS } from './lab-planner';
import { isCapabilitySuite } from './evaluation-classification';
import { createIndependentHoldoutResult, independentHoldoutCases } from './independent-holdouts';
import { createPolicyHoldoutResult, policyHoldoutCases } from './policy-holdouts';
import { ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE } from '../content/advanced-skills';
import { advancedScores } from './advanced-skills';
import type { ModelChallengeAdmission } from '../contracts/model-challenges';
import { createModelChallengeReceipt, isModelChallengeSuite, modelChallengeCases } from './model-challenges';
export const BASIC_SUITE: EvaluationSuiteId = 'basic-conversation-1';
export function evaluationSuite(id: EvaluationSuiteId | undefined) { return EVALUATION_SUITES.find(suite => suite.id === (id ?? BASIC_SUITE)); }
export function evaluateCases(model: ModelVersion, suiteId: EvaluationSuiteId, ctx: ModuleContext, content: GameContent, admission?: IndependentHoldoutAdmission, policyAdmission?: PolicyHoldoutAdmission): EvaluationCase[] {
  if (isModelChallengeSuite(suiteId)) return modelChallengeCases(model, suiteId);
  if (suiteId === POLICY_HOLDOUT_RULES.suiteId) {
    if (!policyAdmission) throw new Error('Policy holdouts need a reserved candidate and paid capability baseline.');
    return policyHoldoutCases(model, policyAdmission);
  }
  if (suiteId === INDEPENDENT_HOLDOUT_RULES.suiteId) {
    if (!admission) throw new Error('Independent holdouts need a reserved candidate and paid capability baseline.');
    return independentHoldoutCases(model, admission);
  }
  const suite = evaluationSuite(suiteId)!;
  const identity = canonicalStateHash({ modelId: model.id, suite: suiteId });
  if (suiteId === ADVANCED_EVALUATION_SUITE.id) {
    const scores = advancedScores(model);
    return Array.from({ length: suite.cases }, (_, index) => {
      const domain = ADVANCED_DOMAINS[index % ADVANCED_DOMAINS.length];
      const difficultyBps = 3000 + Math.floor(index / ADVANCED_DOMAINS.length) % 5 * 1000;
      const technicalBps = Math.max(500, Math.min(9800, 5000 + scores[domain] - difficultyBps));
      const technical = ctx.random.draw(`eval:${identity}:${index}:technical`);
      const execution = ctx.random.draw(`eval:${identity}:${index}:execution`);
      return { id: `${suiteId}:case-${String(index + 1).padStart(2, '0')}`, domain, difficultyBps,
        passed: technical * 10000 < technicalBps && execution * 10000 < model.reliabilityBps };
    });
  }
  return Array.from({ length: suiteId === BASIC_SUITE ? content.evaluation.cases : suite.cases }, (_, index) => {
    const domain = suiteId === BASIC_SUITE ? 'conversation' : DOMAINS[index % DOMAINS.length];
    const difficultyBps = suiteId === BASIC_SUITE ? 0 : 2000;
    const technicalBps = Math.max(500, Math.min(9800, 5000 + model.capabilityBps[domain] - difficultyBps));
    const id = `${suiteId}:case-${String(index + 1).padStart(2, '0')}`;
    if (suiteId === 'behavior-cases-1') {
      if (index % 10 === 9) return { id, domain, difficultyBps, passed: true, outcome: 'correct-policy-refusal' };
      const behavior = model.behavior ?? BASE_BEHAVIOR;
      const success = mulDiv(technicalBps, model.reliabilityBps, 10000);
      const useful = Math.max(0, success - behavior.falseRefusalBps);
      const confident = Math.min(behavior.confidentErrorBps, 10000 - success);
      const falseRefusal = Math.min(behavior.falseRefusalBps, 10000 - useful - confident);
      const draw = ctx.random.draw(`eval:${identity}:${index}:behavior`) * 10000;
      const outcome: BehaviorCaseOutcome = draw < useful ? 'useful' : draw < useful + confident ? 'confident-error'
        : draw < useful + confident + falseRefusal ? 'false-refusal' : 'clarification';
      return { id, domain, difficultyBps, passed: outcome === 'useful', outcome };
    }
    // Preserve the original opening suite's two named draws exactly.
    const technical = ctx.random.draw(`eval:${identity}:${index}:technical`);
    const execution = ctx.random.draw(`eval:${identity}:${index}:execution`);
    return { id, domain, difficultyBps, passed: technical * 10000 < technicalBps && execution * 10000 < model.reliabilityBps };
  });
}
export function behaviorOutcomes(cases: readonly EvaluationCase[]): EvaluationOutcome {
  const count = (outcome: BehaviorCaseOutcome) => cases.filter(item => item.outcome === outcome).length;
  const correctPolicyRefusals = count('correct-policy-refusal');
  return { usefulAnswers: count('useful'), confidentErrors: count('confident-error'), falseRefusals: count('false-refusal'), clarifications: count('clarification'),
    correctPolicyRefusals, eligibleCases: cases.length - correctPolicyRefusals };
}
export function createEvaluationReport(model: ModelVersion, evaluationId: string, suiteId: EvaluationSuiteId, ctx: ModuleContext, content: GameContent, admission?: IndependentHoldoutAdmission, policyAdmission?: PolicyHoldoutAdmission, challengeAdmission?: ModelChallengeAdmission): EvaluationReport {
  if (isModelChallengeSuite(suiteId)) {
    if (!challengeAdmission) throw new Error('Challenge evaluations require a paid baseline and frozen admission.');
    const challenge = createModelChallengeReceipt(model, suiteId, challengeAdmission);
    return { id: 'report-' + evaluationId, companyId: model.companyId, modelId: model.id, week: ctx.week, heldOut: true,
      suiteId, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
      cases: modelChallengeCases(model, suiteId), passedCases: challenge.passedCases, basicChatEligible: false, challenge };
  }
  if (suiteId === POLICY_HOLDOUT_RULES.suiteId) {
    if (!policyAdmission) throw new Error('Policy holdouts need a reserved candidate and paid capability baseline.');
    const result = createPolicyHoldoutResult(model, policyAdmission);
    return { id: 'report-' + evaluationId, companyId: model.companyId, modelId: model.id, week: ctx.week, heldOut: true,
      suiteId, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
      // This legacy bookkeeping count is not a policy score: the report exposes separate eligible/restricted denominators.
      ...result, passedCases: result.cases.filter(item => item.passed).length, basicChatEligible: false };
  }
  if (suiteId === INDEPENDENT_HOLDOUT_RULES.suiteId) {
    if (!admission) throw new Error('Independent holdouts need a reserved candidate and paid capability baseline.');
    const result = createIndependentHoldoutResult(model, admission);
    return { id: 'report-' + evaluationId, companyId: model.companyId, modelId: model.id, week: ctx.week, heldOut: true,
      suiteId, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
      ...result, passedCases: result.holdout.totals.actualSuccesses, basicChatEligible: false };
  }
  const cases = evaluateCases(model, suiteId, ctx, content);
  return {
    id: 'report-' + evaluationId, companyId: model.companyId, modelId: model.id, week: ctx.week, heldOut: true,
    suiteId, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
    cases, passedCases: cases.filter(item => item.passed).length,
    basicChatEligible: isCapabilitySuite(suiteId) && model.capabilityBps.conversation >= content.firstSale.minConversationBps && model.reliabilityBps >= content.firstSale.minReliabilityBps,
    ...(suiteId === 'behavior-cases-1' ? { outcomes: behaviorOutcomes(cases) } : {}),
    ...(suiteId === ADVANCED_EVALUATION_SUITE.id ? { advancedCapabilities: advancedScores(model) } : {}),
  };
}
