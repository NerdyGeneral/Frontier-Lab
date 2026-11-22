import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { createInitialState } from '../src/core/engine';
import { previewCommand, submitCommand } from '../src/core/index';
import { ActionControl, actionCostLabel } from '../src/ui/components';
import { StudioCommandReviewProvider } from '../src/ui/studio-interaction-context';
import { getStudioCommandReviewReason } from '../src/ui/studio-command-flow';
import { StudioCommandReview } from '../src/ui/studio-command-review';

const noAction = () => assert.fail('Rendering must not submit an action');

test('routine editor action states its action and authoritative cost without a review prefix', () => {
  const game = createInitialState();
  const payload = { kind: 'prepare_data', packetId: CONTENT.starterData.id } as const;
  const quote = previewCommand(game, payload, CONTENT);
  const html = renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}>
    <ActionControl game={game} payload={payload} label="Review preparation" canAct onQueue={noAction} />
  </StudioCommandReviewProvider>);
  assert.match(html, /data-studio-action-flow="direct"/);
  assert.match(html, />Prepare training data/);
  assert.doesNotMatch(html, /Review preparation|Review: Prepare/);
  assert.ok(html.includes(actionCostLabel(quote)));
  assert.match(html, /Cash after planned actions/);
});

test('queued action remains visible, disabled and identified by its actual effective week', () => {
  const payload = { kind: 'prepare_data', packetId: CONTENT.starterData.id } as const;
  const queued = submitCommand(createInitialState(), payload, CONTENT);
  assert.equal(queued.accepted, true);
  const html = renderToStaticMarkup(<ActionControl game={queued.state} payload={payload} label="Prepare data" canAct onQueue={noAction} />);
  assert.match(html, /disabled=""[^>]*>Scheduled for Week 1<\/button>/);
  assert.match(html, /Already scheduled for Week 1/);
  assert.match(html, /Queued for Week 1/);
});

test('permanent staff choice retains a concise explicit review', () => {
  const payload = { kind: 'specialize_staff', staffId: 'missing', specialty: 'depth' } as const;
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}>
    <ActionControl game={game} payload={payload} label="Choose career specialty" canAct onQueue={noAction} />
  </StudioCommandReviewProvider>);
  assert.match(html, /data-studio-action-flow="review"/);
  assert.match(html, /Review: Choose career specialty/);
  const review = renderToStaticMarkup(<StudioCommandReview concise game={game} payload={payload} label="Choose career specialty"
    stale={false} onRefresh={noAction} canRefresh busy={false} />);
  assert.match(review, /This career specialty is permanent/);
  assert.match(review, /studio-task-review-concise/);
  assert.doesNotMatch(review, /How costs and timing work|What happens next/);
});

test('review policy covers irreversible work removal and leaves ordinary quoted work direct', () => {
  assert.ok(getStudioCommandReviewReason({ kind: 'dismiss_staff', staffId: 'a' }));
  assert.ok(getStudioCommandReviewReason({ kind: 'discard_prepared_release', releaseId: 'a' }));
  assert.ok(getStudioCommandReviewReason({ kind: 'cancel_batch_job', jobId: 'a' }));
  assert.equal(getStudioCommandReviewReason({ kind: 'hire_staff', role: 'ml' }), undefined);
  assert.equal(getStudioCommandReviewReason({ kind: 'start_model_research' }), undefined);
  assert.equal(getStudioCommandReviewReason({ kind: 'set_job_paused', jobId: 'a', paused: true }), undefined);
  assert.equal(getStudioCommandReviewReason({ kind: 'start_training', baseModelId: 'a', packetId: 'b' }), undefined);
});
