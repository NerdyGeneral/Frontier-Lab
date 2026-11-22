'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { FEEDBACK_REVIEW_RULES as RULES, FEEDBACK_REVIEW_SCOPE } from '../content/wave10-feedback-review';
import type { FeedbackReview, FeedbackReviewMode } from '../contracts/wave10-feedback-review';
import { formatMoney, formatUnits } from '../core/math';
import { computeCostAvailability } from '../modules/compute-costs';
import { getReviewableFeedbackStudy } from '../modules/feedback';
import { feedbackDataRights, feedbackReviewTariffEstimateCents, feedbackReviewTerms } from '../modules/feedback-review';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

function ReviewProgress({ review, game, canAct, onQueue }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & { review: FeedbackReview }) {
  const study = game.slices.data.feedbackStudies![review.studyId], packet = game.slices.data.packets[review.outputPacketId];
  const accountingAvailable = computeCostAvailability(game, review.companyId).available;
  return <details className="inline-details"><summary>{RULES.modes[review.mode].name} · {study.totalCases} cases · {review.status === 'complete'
    ? 'Dataset ready' : review.status === 'ready' ? 'Available Week ' + review.availableWeek : review.paused ? 'Paused' : 'In progress'}</summary>
    <Metrics>
      <Metric label="Data review">{formatWorkPoints(review.completedStaff)} / {formatWorkPoints(review.requiredStaff)} points</Metric>
      <Metric label="Development work">{formatUnits(review.completedWork)} / {formatUnits(review.requiredWork)} CUw</Metric>
      <Metric label="GPU workspace">{formatUnits(review.memoryMU)} MU</Metric>
      <Metric label="GPU work used">{formatUnits(review.physicalWork)} CUw</Metric>
      <Metric label="Estimated GPU cost">{formatMoney(feedbackReviewTariffEstimateCents(review))}</Metric>
    </Metrics>
    <p className="small-note">Processing is included in your usual compute bills. {accountingAvailable
      ? <>Inspect recorded work under Development work in <a href="#compute-costs">Compute cost accounting</a>. The installed meter records work from activation onward. </>
      : <>Research Capacity forecast (R12A) and install cost accounting to see costs by workload. </>}
      The estimate uses the price of the GPUs that did the work. Staff pay and shared site costs are billed separately.</p>
    {packet ? <>
      <p className="small-note"><strong>{packet.name}</strong> is training-ready: quality {packet.qualityBps / 100}%, {packet.behaviorUnits} behavior units, {study.productKind === 'basic-chat' ? 'conversation' : 'coding'} coverage {packet.coverageBps[study.productKind === 'basic-chat' ? 'conversation' : 'coding'] / 100}%, no broad-corpus units.</p>
      <p className="small-note">{packet.rights.weights ? 'Permits hosted models and distribution of trained weights.' : 'Permits hosted models; trained weights remain restricted from distribution.'} Curation keeps the original examples, coverage, and source rights. Find the dataset in <a href="#data">Data</a>, then use it for training in the <a href="#lab-projects">Lab</a>.</p>
    </> : <p className="small-note" role="status">{review.lastBottleneck}</p>}
    {review.status === 'running' && <ActionControl game={game} payload={{ kind: 'set_feedback_review_paused', reviewId: review.id, paused: !review.paused }}
      label={review.paused ? 'Resume feedback review' : 'Pause feedback review'} canAct={canAct} onQueue={onQueue} compact />}
  </details>;
}

/** Rendered beside collection inside the product's single native Customer feedback disclosure. */
export function FeedbackReviewPanel({ productId, ...props }: PanelProps & { productId: string }) {
  const { game, canAct, onQueue } = props;
  const studies = Object.values(game.slices.data.feedbackStudies ?? {}).filter(item => item.productId === productId && item.companyId === game.playerCompanyId);
  const history = Object.values(game.slices.data.feedbackReviews ?? {}).filter(item => studies.some(study => study.id === item.studyId))
    .sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
  const choices = studies.filter(study => getReviewableFeedbackStudy(game, game.playerCompanyId, study.id)
    && !history.some(review => review.studyId === study.id)).sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
  const [studyId, setStudyId] = useState(''), [mode, setMode] = useState<FeedbackReviewMode>('verified');
  const study = choices.find(item => item.id === studyId) ?? choices[0], terms = study ? feedbackReviewTerms(study, mode) : undefined;
  if (!studies.length) return null;
  return <div className="system-application">
    <p className="small-heading">Review collected feedback</p>
    <p className="small-note">{FEEDBACK_REVIEW_SCOPE}</p>
    {study ? <>
      <label className="line-control wide-select" htmlFor={productId + '-feedback-review-study'}>Closed study<select id={productId + '-feedback-review-study'} value={study.id}
        onChange={event => setStudyId(event.target.value)} disabled={!canAct}>
        {choices.map(item => <option key={item.id} value={item.id}>Week {item.startedWeek} · {item.totalCases} cases · {item.sampling === 'representative' ? 'Representative' : 'Failure-focused'}</option>)}
      </select></label>
      <label className="line-control" htmlFor={productId + '-feedback-review-mode'}>Review method<select id={productId + '-feedback-review-mode'} value={mode}
        onChange={event => setMode(event.target.value as FeedbackReviewMode)} disabled={!canAct}>
        <option value="verified">Verified · 90% quality</option><option value="quick">Quick · 65% quality</option>
      </select></label>
      <p className="small-note">This batch needs {formatWorkPoints(terms!.requiredStaff)} Data points and {formatUnits(terms!.requiredWork)} development CUw with 1 MU workspace. Data review is capped at 20 points each week. GPU processing can finish while staff review continues.</p>
      <p className="small-note">{feedbackDataRights(game, study).weights ? 'Consent and source rights allow hosted use and distribution of trained weights.' : 'The resulting dataset permits hosted use; consent or source-model rights restrict distribution of trained weights.'} One review per study; the resulting dataset can be reused.</p>
      <ActionControl game={game} payload={{ kind: 'start_feedback_review', studyId: study.id, mode }} label="Start feedback review" canAct={canAct} onQueue={onQueue} />
    </> : <p className="small-note">{history.length ? 'All available studies with examples already have a review. Reuse a completed dataset or start another study.' : 'A finished study with collected examples can be reviewed from the start of the following week.'}</p>}
    {history.map(review => <ReviewProgress key={review.id} review={review} {...props} />)}
  </div>;
}
