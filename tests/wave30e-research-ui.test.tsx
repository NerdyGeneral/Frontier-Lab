import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, serializeState, submitCommand } from '../src/core/index';
import { StudioResearchMethod } from '../src/ui/studio-research-method';
import { getStudioResearchCapacity, getStudioResearchPrerequisiteChain, getStudioResearchReadiness, getStudioResearchTreeNodes, StudioResearchTree } from '../src/ui/studio-research-tree';
import { StudioCommandReviewProvider } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';

const noAction = () => assert.fail('Rendering research must not submit or navigate');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const method = (game: GameState, researchId = 'R1') => renderToStaticMarkup(
  <StudioCommandReviewProvider value={noAction}><StudioResearchMethod game={game} researchId={researchId} canAct onQueue={noAction} onOpenMethod={noAction} onOpenPanel={noAction} onReviewStaff={noAction} onReviewCompute={noAction} /></StudioCommandReviewProvider>,
);
const tree = (game: GameState, researchId = 'R1') => renderToStaticMarkup(
  <StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} onOpenMethod={noAction} selection={{ intentId: 1, researchId }} />,
);
function queue(game: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function step(game: GameState) {
  const result = advanceWeek(game, CONTENT);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}
function researchStaff(game: GameState) {
  return queue(game, { kind: 'assign_founder', allocations: { ...game.slices.company.founderAssignments[game.playerCompanyId], data: 0, research: U } }, 'assign-research');
}
function researchCompute(game: GameState) {
  return queue(game, { kind: 'allocate_compute', serving: 0, development: 0, research: 2 * U }, 'assign-compute');
}
function readiness(game: GameState, researchId = 'R1') {
  const node = getStudioResearchTreeNodes(game).find(item => item.id === researchId)!;
  return getStudioResearchReadiness(node, getStudioResearchCapacity(game));
}

test('W30E-R01: missing assignments are explained before the review action without changing admission', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = method(game), text = textOnly(html);
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'R1' }).accepted, true);
  assert.match(text, /Evaluation suite Unlocked What you gain/);
  assert.doesNotMatch(text, /Ready to begin/);
  assert.match(text, /Research points each week 0 points \/ week · waiting for points/);
  assert.match(text, /Research compute limit 0 CU · compute work will wait/);
  assert.match(text, /You can schedule this now\. Both point progress and compute work will wait/);
  assert.ok(html.indexOf('aria-label="Research requirements"') < html.indexOf('aria-label="Research decision"'));
  const review = html.match(/<button[^>]*data-studio-review="start_research"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(review && !review.includes('disabled='));
  assert.match(text, /Increase research output Allocate research compute/);
  assert.equal(serializeState(game), before);
});

test('W30E-R02: readiness uses settled assignments, the required staff role and suitable research compute', () => {
  let game = researchCompute(researchStaff(createPlayerOnlyState()));
  assert.equal(readiness(game).ready, false, 'Queued assignments are not yet current capacity');
  assert.match(textOnly(method(game)), /Queued changes and new hires finishing onboarding can change next week/);
  game = step(game);
  assert.equal(readiness(game).ready, true);
  assert.equal(readiness(game).needsStaff, false);
  assert.equal(readiness(game).needsCompute, false);
  assert.match(textOnly(method(game)), /Research points each week 20 points \/ week/);
  assert.match(textOnly(method(game)), /Research compute limit 2 CU/);
  const ml = readiness(game, 'R3');
  assert.equal(ml.needsStaff, true, 'Research staff cannot stand in for ML engineering');
  assert.equal(ml.needsCompute, false);
  assert.match(textOnly(method(game, 'R3')), /Design points each week 0 points \/ week/);
  assert.match(textOnly(method(game, 'R3')), /Increase design output/);
  const noPools = getStudioResearchCapacity(game);
  noPools.pools = [];
  const node = getStudioResearchTreeNodes(game).find(item => item.id === 'R1')!;
  assert.equal(getStudioResearchReadiness(node, noPools).needsCompute, true, 'An allocation without a compatible online pool is not ready');
});

test('W30E-R03: staff and compute work are reported separately, including completed staff work', () => {
  let game = queue(researchStaff(createPlayerOnlyState()), { kind: 'start_research', researchId: 'R1' }, 'staff-only-method');
  game = step(game);
  const afterOneWeek = game.slices.research.projects['research-staff-only-method'];
  assert.equal(afterOneWeek.completedStaff, U);
  assert.equal(afterOneWeek.completedWork, 0);
  assert.match(textOnly(method(game)), /Compute work will wait for suitable GPUs and a research allocation; point progress can continue/);
  game = step(game);
  game = step(queue(game, { kind: 'assign_founder', allocations: { ...game.slices.company.founderAssignments[game.playerCompanyId], research: 0, data: U } }, 'leave-finished-staff-work'));
  const current = readiness(game);
  assert.equal(current.staffRemaining, 0);
  assert.equal(current.needsStaff, false);
  assert.equal(current.needsCompute, true);
  assert.match(textOnly(method(game)), /0 points \/ week · required points complete/);
  assert.doesNotMatch(textOnly(method(game)), /Increase research output/);
});

test('W30E-R04: entry-fee readiness accounts for reserved cash and does not charge a queued project twice', () => {
  let game = createPlayerOnlyState();
  game.slices.company.companies[game.playerCompanyId].cashCents = 100_000;
  assert.match(textOnly(method(game, 'R3')), /\$1,000 available · \$1,500 needed/);
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'R3' }).accepted, false);
  const availableStrip = tree(game).split('class="research-tree-full-heading"')[0];
  assert.match(availableStrip, /data-research-id="R1"/);
  assert.doesNotMatch(availableStrip, /data-research-id="R3"/);
  game = queue(game, { kind: 'start_research', researchId: 'R1' }, 'reserved-method');
  const html = method(game), text = textOnly(html);
  assert.match(text, /Entry fee · reserved \$1,000/);
  assert.match(html, /<li data-ready="true">.*?Cash for the entry fee.*?\$1,000 reserved<\/span>/);
  assert.doesNotMatch(text, /\$0 available · \$1,000 needed/);
  assert.ok(html.match(/<button[^>]*data-studio-review="start_research"[^>]*>[\s\S]*?<\/button>/)?.[0].includes('disabled=""'));
});

test('W30E-R05: available cards show exact reachable methods and retain the complete map and list', () => {
  const game = createPlayerOnlyState(), before = serializeState(game), html = tree(game);
  const strip = html.split('class="research-tree-full-heading"')[0];
  assert.deepEqual([...strip.matchAll(/data-research-id="([^"]+)"/g)].map(match => match[1]), ['R1', 'R3', 'D1']);
  assert.match(textOnly(strip), /Available now/);
  assert.match(textOnly(strip), /Evaluation suite Unlock 100-case tests and model comparisons/);
  assert.match(textOnly(strip), /Needs staff and compute/);
  assert.match(html, /research-tree-map-view/);
  assert.match(html, /research-tree-list-view/);
  for (const definition of CONTENT.research) assert.ok(html.includes('aria-label="' + definition.id + ':'), definition.id + ' remains in the full map');
  assert.equal(serializeState(game), before);
});

test('W30E-R06: a deep locked selection highlights every ancestor and offers the next unfinished prerequisite', () => {
  const game = createPlayerOnlyState(), nodes = getStudioResearchTreeNodes(game);
  assert.deepEqual(getStudioResearchPrerequisiteChain(nodes, 'R4C').map(node => node.id), ['R1', 'R2', 'R4']);
  const html = tree(game, 'R4C');
  assert.match(html, /class="research-tree-next-prerequisite" data-research-target="R1"/);
  assert.match(html, /data-research-from="R1" data-research-to="R2"[^>]*class="is-selected is-unmet"/);
  assert.match(html, /data-research-from="R2" data-research-to="R4"[^>]*class="is-selected is-unmet"/);
  assert.match(html, /data-research-from="R4" data-research-to="R4C"[^>]*class="is-selected is-unmet"/);
  assert.doesNotMatch(html, /data-research-from="R1" data-research-to="R7"[^>]*class="is-selected/);
  let completed = queue(researchCompute(researchStaff(game)), { kind: 'start_research', researchId: 'R1' }, 'first-prerequisite');
  completed = step(step(step(completed)));
  const completedHtml = tree(completed, 'R4C');
  assert.match(completedHtml, /class="research-tree-next-prerequisite" data-research-target="R2"/);
  assert.match(completedHtml, /data-research-from="R1" data-research-to="R2"[^>]*class="is-selected is-satisfied"/);
});
