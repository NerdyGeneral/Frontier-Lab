import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, getGameView, previewCommand, serializeState, submitCommand } from '../src/core/index';
import { getResearchView } from '../src/modules/research';
import { StudioResearchMethod } from '../src/ui/studio-research-method';
import { StudioResearchTree } from '../src/ui/studio-research-tree';
import { LabPanel } from '../src/ui/lab-panels';
import { StudioCommandReviewProvider, StudioTrainingSelectionProvider } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';

const noAction = () => assert.fail('Rendering must not make a decision');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function render(game: GameState, researchId: string | null, canAct = true) {
  return renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}><StudioResearchMethod game={game} researchId={researchId} canAct={canAct} onQueue={noAction} onOpenMethod={noAction} onOpenPanel={noAction} onReviewResources={noAction} onBrowse={noAction} /></StudioCommandReviewProvider>);
}
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
function activeResearch() {
  let game = createPlayerOnlyState();
  game = queue(game, { kind: 'assign_founder', allocations: { ...game.slices.company.founderAssignments[game.playerCompanyId], data: 0, research: U } }, 'research-founder');
  game = queue(game, { kind: 'allocate_compute', serving: 0, development: 0, research: 2 * U }, 'research-compute');
  game = queue(game, { kind: 'start_research', researchId: 'R1' }, 'method-one');
  return step(game);
}

test('W30D-R01: focused method uses the exact catalog identity, actual quote and current shared capacity', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = render(game, 'R1'), text = textOnly(html);
  const quote = previewCommand(game, { kind: 'start_research', researchId: 'R1' });
  assert.equal(quote.accepted, true); assert.equal(quote.upfrontCostCents, 100_000);
  assert.match(html, /data-research-method="R1"/);
  assert.match(text, /Discovery R1 Evaluation suite/);
  assert.match(text, /Entry fee \$1,000 Required research work 40 points Required research compute 2 CUw/);
  assert.match(text, /Research points each week 0 points \/ week/);
  assert.match(text, /Research compute limit 0 CU/);
  assert.match(text, /Other projects share the team’s points and GPUs/);
  assert.match(html, /data-studio-review="start_research" data-studio-action-flow="direct"/);
  assert.match(text, /Research evaluation suite · \$1,000/);
  assert.equal((html.match(/role="dialog"/g) ?? []).length, 0, 'The shared host is the only dialog owner');
  assert.equal(serializeState(game), before);
});

test('W30D-R02: locked methods name prerequisites and preserve their real rejection', () => {
  const game = createPlayerOnlyState(), html = render(game, 'R2'), text = textOnly(html);
  const quote = previewCommand(game, { kind: 'start_research', researchId: 'R2' });
  assert.equal(quote.accepted, false);
  assert.match(text, /R1 · Evaluation suite/);
  assert.match(text, /Complete R1 and wait until the following week/);
  assert.match(text, /Entry fee \$2,000/);
  const button = html.match(/<button[^>]*data-studio-review="start_research"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(button?.includes('disabled=""'));
  assert.match(text, /See how to use it/);
  assert.doesNotMatch(html, />Curate training data(?:<svg|<\/button>)/);
});

test('W30D-R03: unknown and absent method identities stay explicit without a fallback action', () => {
  const game = createPlayerOnlyState();
  for (const id of [null, 'missing-method']) {
    const html = render(game, id);
    assert.match(html, /data-research-method=""/);
    assert.match(html, /Choose a method/);
    assert.match(html, /<option value="" selected="">/);
    assert.doesNotMatch(html, /data-studio-review="start_research"/);
  }
  assert.match(render(game, 'missing-method'), /This method is unavailable/);
});

test('W30D-R04: queued research remains a next-boundary decision with no invented progress', () => {
  const game = queue(createPlayerOnlyState(), { kind: 'start_research', researchId: 'R1' }, 'queued-method');
  const html = render(game, 'R1');
  assert.match(textOnly(html), /Queued/);
  assert.match(textOnly(html), /Queued for week 1/i);
  assert.doesNotMatch(html, /Research progress|<progress/);
  assert.ok(html.match(/<button[^>]*data-studio-review="start_research"[^>]*>[\s\S]*?<\/button>/)?.[0].includes('disabled=""'));
});

test('W30D-R05: active and paused research retain exact project progress and paid-entry semantics', () => {
  const active = activeResearch(), project = active.slices.research.projects['research-method-one'];
  assert.equal(project.status, 'running'); assert.equal(project.completedStaff, U);
  const before = serializeState(active), html = render(active, 'R1');
  assert.match(textOnly(html), /Entry fee · already charged \$1,000/);
  assert.match(textOnly(html), /20 \/ 40 points/);
  assert.match(html, /research-method-one/);
  assert.match(html, />Pause research<\/button>/);
  assert.equal(serializeState(active), before);
  const paused = step(queue(active, { kind: 'set_research_paused', projectId: project.id, paused: true }, 'pause-method'));
  assert.equal(paused.slices.research.projects[project.id].completedStaff, project.completedStaff);
  const pausedHtml = render(paused, 'R1');
  assert.match(pausedHtml, />Resume research<\/button>/);
  assert.match(textOnly(pausedHtml), /20 \/ 40 points/);
});

test('W30D-R06: real completion remains distinct from the following usable boundary', () => {
  const pending = step(activeResearch());
  const project = pending.slices.research.projects['research-method-one'];
  assert.equal(project.status, 'complete'); assert.equal(project.completedWeek, 2); assert.equal(project.availableWeek, 3);
  assert.equal(getResearchView(pending, pending.playerCompanyId).find(item => item.id === 'R1')?.status, 'pending');
  const pendingText = textOnly(render(pending, 'R1'));
  assert.match(pendingText, /Research finished · ready next week/);
  assert.match(pendingText, /Ready to use Week 3/);
  assert.match(pendingText, /Research finished in Week 2. The discovery will be ready to use next week/);
  assert.doesNotMatch(render(pending, 'R1'), /data-studio-review="(?:start_research|set_research_paused)"/);
  const available = step(pending), availableHtml = render(available, 'R1');
  assert.match(textOnly(availableHtml), /Available to use/);
  assert.match(textOnly(availableHtml), /Available since Week 3/);
  assert.match(availableHtml, />Evaluate a model<svg/);
});

test('W30D-R07: method review stays readable for observers and cannot queue their decision', () => {
  const html = render(createPlayerOnlyState(), 'R1', false);
  assert.match(html, /Evaluation suite/);
  assert.ok(html.match(/<button[^>]*data-studio-review="start_research"[^>]*>[\s\S]*?<\/button>/)?.[0].includes('disabled=""'));
  assert.match(html, /Increase research output.*Allocate research compute/);
});

test('W30D-R08: the shared method entry preserves the complete research workspace and list alternative', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} onOpenMethod={noAction} selection={{ intentId: 1, researchId: 'R2' }} />);
  assert.match(html, /research-tree-map/);
  assert.match(html, /research-tree-list-view/);
  assert.match(html, /research-tree-search/);
  assert.match(html, />Review method<svg/);
  assert.doesNotMatch(html, />Research data curation<\/button>/);
  assert.match(html, /R1.*Evaluation suite/);
  assert.match(html, /S6.*Second-generation silicon/);
  assert.equal(serializeState(game), before);
});

test('Discovery application links open the corresponding blueprint or workspace in the training form', () => {
  const game = createPlayerOnlyState(), view = getGameView(game, CONTENT);
  for (const [researchId, value] of [
    ['D1', 'support-desk'], ['D2', 'document-extractor'], ['D3', 'tool-dispatcher'],
    ['D4', 'compact-foundation'], ['D5', 'recompute'], ['D6', 'large-batch'],
  ]) {
    const html = renderToStaticMarkup(<StudioTrainingSelectionProvider value={{ intentId: 1, designResearchId: researchId }}>
      <LabPanel game={game} view={view} canAct onQueue={noAction} />
    </StudioTrainingSelectionProvider>);
    const option = html.match(new RegExp('<option[^>]*value="' + value + '"[^>]*>'))?.[0];
    assert.ok(option?.includes('selected=""'), researchId + ' preselects ' + value);
  }
});
