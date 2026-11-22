'use client';

import { useState } from 'react';
import { FEEDBACK_CONSENTS, FEEDBACK_ROW_LABELS, FEEDBACK_RULES as RULES, FEEDBACK_SAMPLING, FEEDBACK_SCOPE } from '../content/wave10-feedback';
import type { FeedbackConsent, FeedbackSampling, FeedbackStudy } from '../contracts/wave10-feedback';
import { feedbackPaidUsage, feedbackRowCounts, getReviewableFeedbackStudy } from '../modules/feedback';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

function StudyReceipt({ study, game, canAct, onQueue }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & { study: FeedbackStudy }) {
  const available = study.status === 'closed' && study.reviewableWeek !== null && game.week >= study.reviewableWeek;
  const reviewable = !!getReviewableFeedbackStudy(game, study.companyId, study.id)
    && !Object.values(game.slices.data.feedbackReviews ?? {}).some(review => review.studyId === study.id);
  const outcomes = study.weeks.reduce((sum, row) => ({ useful: sum.useful + row.outcomes.useful,
    confidentError: sum.confidentError + row.outcomes.confidentError, falseRefusal: sum.falseRefusal + row.outcomes.falseRefusal,
    clarification: sum.clarification + row.outcomes.clarification }), { useful: 0, confidentError: 0, falseRefusal: 0, clarification: 0 });
  return <div className="system-application">
    <p className="small-heading">{study.sampling === 'representative' ? 'Representative' : 'Failure-focused'} · Week {study.startedWeek}
      <span className="status-inline">{study.status === 'collecting' ? 'Collecting' : available ? study.endedEarly ? 'Ended early' : 'Closed' : 'Report Week ' + study.reviewableWeek}</span></p>
    <Metrics>
      <Metric label="Collected examples">{study.totalCases} / {RULES.maximumCases}</Metric>
      <Metric label="Calendar window">Weeks {study.startedWeek}–{study.endsWeek}</Metric>
      <Metric label="Training consent">{study.consent === 'hosted-only' ? 'Hosted only · 25%' : 'Distribution · 10%'}</Metric>
      <Metric label="Source model">{game.slices.models.versions[study.sourceModelId]?.name ?? study.sourceModelId}</Metric>
    </Metrics>
    <p className="small-note" role="status">{study.lastBottleneck}</p>
    {study.status === 'collecting' && <ActionControl game={game} payload={{ kind: 'cancel_feedback_study', studyId: study.id }} label="End study early" canAct={canAct} onQueue={onQueue} compact />}
    <details className="inline-details"><summary>Weekly collection results</summary>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Week</th><th>Paid accounts</th><th>Completed paid responses</th><th>Opted-in accounts</th><th>Cases</th><th>Collection result</th></tr></thead><tbody>
        {study.weeks.map(row => <tr key={row.week}><td>{row.week}</td><td>{row.paidUsage.paidAccounts.toLocaleString()}</td><td>{row.paidUsage.paidCompletedExchanges.toLocaleString()}</td><td>{row.consentAccounts.toLocaleString()}</td><td>{row.outcomes.cases}</td><td>{FEEDBACK_ROW_LABELS[row.reason]}{row.paidUsage.guardrail && <span className="table-subline">{row.paidUsage.guardrail.profile} runtime checks</span>}</td></tr>)}
        {!study.weeks.length && <tr><td colSpan={6}>No serving week has been collected.</td></tr>}
      </tbody></table></div>
      <p className="small-note">Collection depends on paying customers who received service, with at most one example per participant each week. Missed requests and free trials do not count. Replacing the live model stops collection for this study.</p>
    </details>
    {available && study.totalCases > 0 && <>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Response breakdown (estimate)</th><th>Cases</th></tr></thead><tbody>
        <tr><td>Useful answer</td><td>{outcomes.useful}</td></tr><tr><td>Confident error</td><td>{outcomes.confidentError}</td></tr>
        <tr><td>False refusal of an allowed task</td><td>{outcomes.falseRefusal}</td></tr><tr><td>Clarification / uncertainty</td><td>{outcomes.clarification}</td></tr>
      </tbody></table></div>
      <p className="small-note">{study.sampling === 'failure-focused' ? 'This sample focuses on bad responses. Use it to find problems, not to measure the product’s overall failure rate.' : 'These results cover paying customers who opted in. They are separate from formal model tests and may not represent every customer.'} {reviewable ? 'Pay Data staff to review these examples and turn them into reusable training data.' : ''}</p>
    </>}
  </div>;
}

/** Parent supplies the single native Customer feedback disclosure for collection and paid review. */
export function FeedbackPanel({ productId, ...props }: PanelProps & { productId: string }) {
  const { game, canAct, onQueue } = props;
  const [sampling, setSampling] = useState<FeedbackSampling>('representative');
  const [consent, setConsent] = useState<FeedbackConsent>('hosted-only');
  const product = game.slices.products.offers[productId];
  if (!product || !['basic-chat', 'developer-api'].includes(product.kind)) return null;
  const history = Object.values(game.slices.data.feedbackStudies ?? {}).filter(study => study.productId === productId)
    .sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
  const collecting = history.some(study => study.status === 'collecting');
  const usage = feedbackPaidUsage(game.slices.products.lastUsage[productId], productId, game.week);
  const estimate = feedbackRowCounts({ sampling, consent }, usage, true);
  return <div>
    <p className="small-note">Collect examples from customers who opt in over the next four weeks of paid service. Collection is free. Review the data, then train, test, and launch a model to improve its answers.</p>
    {!collecting && <>
      <label className="line-control wide-select" htmlFor={productId + '-feedback-sampling'}>Sample<select id={productId + '-feedback-sampling'} value={sampling} onChange={event => setSampling(event.target.value as FeedbackSampling)} disabled={!canAct}>
        {FEEDBACK_SAMPLING.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <p className="small-note">{FEEDBACK_SAMPLING.find(item => item.id === sampling)!.description}</p>
      <label className="line-control wide-select" htmlFor={productId + '-feedback-consent'}>Consent<select id={productId + '-feedback-consent'} value={consent} onChange={event => setConsent(event.target.value as FeedbackConsent)} disabled={!canAct}>
        {FEEDBACK_CONSENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <p className="small-note">{FEEDBACK_CONSENTS.find(item => item.id === consent)!.description}</p>
      {game.slices.products.lastUsage[productId]?.week === game.week && <p className="small-note">At the most recent paid usage, these choices would permit {estimate.outcomes.cases} cases per week from {estimate.consentAccounts.toLocaleString()} customers who opted in and received service. A new study starts next week and collects future responses only.</p>}
      <ActionControl game={game} payload={{ kind: 'start_feedback_study', productId, sampling, consent }} label="Start four-week feedback study" canAct={canAct} onQueue={onQueue} />
    </>}
    {history.map(study => <StudyReceipt {...props} study={study} key={study.id} />)}
    <details className="inline-details"><summary>Study rules</summary>
      <p className="small-note">{FEEDBACK_SCOPE}</p>
      <p className="small-note">Maximum {RULES.casesPerWeek} cases per week, {RULES.maximumCases} per study. You need at least 4 served customers for hosted-only consent, or 10 for distribution consent. The study’s four weeks keep counting down while service is paused. You can keep up to {RULES.maximumPerProduct} studies per product and {RULES.maximumHistory} across the company, including their source records.</p>
    </details>
  </div>;
}
