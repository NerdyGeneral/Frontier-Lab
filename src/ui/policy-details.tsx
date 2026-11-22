'use client';

import type { EvaluationReport, GameState, ModelVersion } from '../contracts/types';
import { POLICY_HOLDOUT_RULES } from '../content/wave11-policy';
import { policyHoldoutReport, policyReleaseRejection } from '../modules/policy-holdouts';
import { Metric, Metrics } from './components';

const OUTCOMES = {
  useful: 'Useful answer', 'confident-error': 'Confident error', 'false-refusal': 'Unnecessary refusal',
  clarification: 'Clarification', 'correct-policy-refusal': 'Correct refusal', 'unsafe-compliance': 'Answered a restricted request',
};
const CATEGORIES = { privacy: 'Privacy', permission: 'Permission', 'harmful-assistance': 'Harmful assistance', 'valid-sensitive-request': 'Sensitive request' };

export function PolicyHoldoutDetails({ report }: { report: EvaluationReport }) {
  if (!report.policy) return null;
  const counts = report.policy.totals;
  const passed = counts.unsafeCompliances <= POLICY_HOLDOUT_RULES.unsafeCeiling;
  return <div className="evaluation-report">
    <p className="small-heading">Independent policy test · Week {report.week}</p>
    <Metrics>
      <Metric label="Allowed requests">{counts.allowedCases}</Metric>
      <Metric label="Useful allowed answers">{counts.usefulAnswers} / {counts.allowedCases}</Metric>
      <Metric label="Unnecessary refusals">{counts.falseRefusals} / {counts.allowedCases}</Metric>
      <Metric label="Confident errors">{counts.confidentErrors} / {counts.allowedCases}</Metric>
      <Metric label="Clarifications">{counts.clarifications} / {counts.allowedCases}</Metric>
      <Metric label="Restricted requests">{counts.restrictedCases}</Metric>
      <Metric label="Restricted requests refused">{counts.correctPolicyRefusals} / {counts.restrictedCases}</Metric>
      <Metric label="Restricted requests answered">{counts.unsafeCompliances} / {counts.restrictedCases}</Metric>
      <Metric label="Policy launch requirement">{passed ? 'Meets threshold' : 'Too many restricted answers'}</Metric>
    </Metrics>
    <p className="small-note">To launch a policy-trained model, it must answer no more than {POLICY_HOLDOUT_RULES.unsafeCeiling} restricted requests out of {POLICY_HOLDOUT_RULES.restrictedCases} restricted test cases. Allowed requests are scored separately: refusing a valid request still counts as a failure. The model must also meet capability and data-rights requirements.</p>
    <p className="small-note">These test cases are separate from training data. Every model faces the same cases, so renaming a model or waiting will not make the test easier. Testing does not train the model, and passing covers these cases only.</p>
    <details className="inline-details"><summary>Direct and adversarial cases</summary>
      <Metrics><Metric label="Direct restricted requests answered">{counts.directUnsafeCompliances} / {counts.directRestrictedCases}</Metric><Metric label="Adversarial restricted requests answered">{counts.adversarialUnsafeCompliances} / {counts.adversarialRestrictedCases}</Metric></Metrics>
      <ol className="case-list">{report.cases.map((item, index) => item.policy && <li key={item.id}><span>{index + 1}. {CATEGORIES[item.policy.category]} · {item.policy.eligibility} · {item.policy.challenge}</span><span>{OUTCOMES[item.policy.outcome]}</span></li>)}</ol>
    </details>
  </div>;
}

export function ModelPolicyDetails({ game, model }: { game: GameState; model: ModelVersion }) {
  if (!model.policy) return null;
  const report = policyHoldoutReport(game, model.id);
  const rejection = policyReleaseRejection(game, model.id);
  return <div className="training-preview">
    <p className="small-heading">Learned response rules</p>
    <Metrics><Metric label="Chance of an unnecessary refusal">{(model.behavior!.falseRefusalBps / 100).toFixed(2)}%</Metric><Metric label="Chance of answering a restricted request">{(model.policy.currentUnsafeComplianceBps / 100).toFixed(2)}%</Metric><Metric label="Policy test">{report ? 'This model tested' : 'Paid test required'}</Metric></Metrics>
    <p className="small-note">{rejection?.message ?? 'This model passes the policy test. Launch it separately when ready; training and testing leave the current live model in place.'}</p>
    <p className="small-note">These percentages describe the model’s tendencies. See Policy boundary holdouts for actual test results. Refusal training changes how the model follows policy; its skills, reliability, confident errors, compute needs, and agent permissions stay the same.</p>
  </div>;
}
