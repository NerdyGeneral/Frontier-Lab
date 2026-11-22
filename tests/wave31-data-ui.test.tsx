import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { DATA_CATALOG } from '../src/content/wave2-lab';
import { advanceWeek, canonicalStateHash, createInitialState, getGameView, submitCommand } from '../src/core/index';
import { formatMoney } from '../src/core/math';
import { DataPanel } from '../src/ui/lab-panels';
import { DataCatalog } from '../src/ui/data-catalog';
import { getUiCommandPreview } from '../src/ui/command-preview';
import { StudioDataSelectionProvider, StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';

const noAction = () => assert.fail('Inspecting data must not perform a player action');
const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction };
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function render(game: GameState, packetId = CONTENT.starterData.id, canAct = true, studio = true) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={studio ? actions : null}>
    <StudioDataSelectionProvider value={studio ? { intentId: 1, packetId } : null}>
      <DataPanel game={game} view={getGameView(game)} canAct={canAct} onQueue={noAction} />
    </StudioDataSelectionProvider>
  </StudioTaskActionsProvider>);
}

function preparationButton(html: string) {
  const button = html.match(/<button\b([^>]*data-studio-review="prepare_data"[^>]*)>/);
  assert.ok(button, 'The original preparation ActionControl remains in the real task');
  return button[1];
}

test('W31-D01: the selected dataset retains its exact authoritative quote and one original action', () => {
  for (const catalog of [undefined, DATA_CATALOG[0]]) {
    const game = createInitialState(), id = 'chosen-data';
    game.slices.data.packets[id] = { ...structuredClone(CONTENT.starterData), id, name: 'Chosen dataset', companyId: game.playerCompanyId,
      ...(catalog ? { catalogId: catalog.id, rawUnits: catalog.rawUnits } : {}) };
    const before = canonicalStateHash(game), html = render(game, id);
    const quote = getUiCommandPreview(game, { kind: 'prepare_data', packetId: id }, CONTENT);
    assert.equal(quote.accepted, true);
    assert.match(html, /data-selected-packet="chosen-data"/);
    assert.match(html, /<option value="chosen-data" selected="">Chosen dataset/);
    assert.ok(textOnly(html).includes(quote.summary));
    if (quote.upfrontCostCents) assert.ok(textOnly(html).includes(formatMoney(quote.upfrontCostCents) + ' upfront'));
    assert.equal((html.match(/data-studio-review="prepare_data"/g) ?? []).length, 1);
    const quoteId = preparationButton(html).match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(quoteId && html.includes('id="' + quoteId + '"'));
    assert.doesNotMatch(preparationButton(html), /disabled/);
    assert.equal(canonicalStateHash(game), before);
  }
});

test('W31-D02: missing data time explains the wait while keeping the engine scheduling decision', () => {
  const game = createInitialState();
  game.slices.company.founderAssignments[game.playerCompanyId].data = 0;
  const before = canonicalStateHash(game), html = render(game);
  assert.match(html, /Waiting for Data points/);
  assert.match(html, /You can schedule this work now, but it will wait/);
  assert.match(html, />Review staff plan<\/button>/);
  assert.doesNotMatch(preparationButton(html), /disabled/);
  assert.equal(canonicalStateHash(game), before);
});

test('W31-D03: scheduled, active and completed preparation show their actual distinct states', () => {
  const queued = submitCommand(createInitialState(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'desktop-data');
  assert.equal(queued.accepted, true, queued.reason?.message);
  const queuedHtml = render(queued.state);
  assert.match(queuedHtml, /Scheduled/);
  assert.match(queuedHtml, /Queued for Week 1/);
  assert.match(preparationButton(queuedHtml), /disabled=""/);
  const first = advanceWeek(queued.state, CONTENT);
  assert.equal(first.accepted, true, first.reason?.message);
  const activeHtml = render(first.state);
  assert.match(activeHtml, /Preparation in progress/);
  assert.match(activeHtml, /Selected dataset preparation progress/);
  assert.doesNotMatch(activeHtml, /Confirm to schedule preparation/);
  assert.match(preparationButton(activeHtml), /disabled=""/);
  const second = advanceWeek(first.state, CONTENT);
  assert.equal(second.accepted, true, second.reason?.message);
  const finishedHtml = render(second.state);
  assert.match(finishedHtml, /Ready for training/);
  assert.match(finishedHtml, /Choose this dataset in a training plan/);
  assert.doesNotMatch(finishedHtml, /data-studio-review="prepare_data"/);
});

test('W31-D04: a missing or foreign explicit packet cannot show a different preparation action', () => {
  const game = createInitialState();
  game.slices.data.packets.foreign = { ...structuredClone(CONTENT.starterData), id: 'foreign', name: 'Foreign data', companyId: 'another-company' };
  const before = canonicalStateHash(game);
  for (const id of ['missing', 'foreign']) {
    const html = render(game, id);
    assert.match(html, /This dataset is unavailable. Choose another to continue/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /data-studio-review="prepare_data"|data-selected-packet|Foreign data/);
  }
  assert.equal(canonicalStateHash(game), before);
});

test('W31-D05: data tools and the catalog have direct entries with one purchase action', () => {
  const game = createInitialState();
  game.slices.data.packets[CONTENT.starterData.id].prepared = true;
  game.slices.data.packets[CONTENT.starterData.id].readyUnits = CONTENT.starterData.rawUnits;
  const studio = render(game), classic = render(game, CONTENT.starterData.id, true, false);
  assert.match(studio, /aria-label="Data workspace"/);
  assert.match(studio, /Data catalog · 14 sources/);
  assert.doesNotMatch(studio, /More data options/);
  assert.match(studio, /<summary>Curate this dataset<\/summary>/);
  const catalog = renderToStaticMarkup(<DataCatalog game={game} catalogId={DATA_CATALOG[0].id} onSelect={noAction} canAct onQueue={noAction} />);
  assert.equal((catalog.match(/data-studio-review="buy_data"/g) ?? []).length, 1);
  for (const offer of DATA_CATALOG) assert.ok(textOnly(catalog).includes(offer.name), offer.name + ' is visible in the catalog');
  for (const html of [studio, classic]) {
    assert.equal((html.match(/data-studio-review="curate_data"/g) ?? []).length, 1);
    assert.equal((html.match(/data-studio-review="buy_data"/g) ?? []).length, 0, 'Purchases have their own direct catalog view');
    assert.match(html, /Data catalog · 14 sources/);
  }
  assert.doesNotMatch(classic, /studio-data-layout|More data options|What happens next/);
  assert.match(classic, /Training-ready data/);
});

test('W31-D06: read-only and unaffordable preparations retain their authoritative disabled state', () => {
  assert.match(preparationButton(render(createInitialState(), CONTENT.starterData.id, false)), /disabled=""/);
  const game = createInitialState();
  game.slices.company.companies[game.playerCompanyId].cashCents = 0;
  const before = canonicalStateHash(game), html = render(game);
  const quote = getUiCommandPreview(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT);
  assert.equal(quote.accepted, false);
  assert.match(preparationButton(html), /disabled=""/);
  assert.ok(quote.reason && textOnly(html).includes(quote.reason.message));
  assert.equal(canonicalStateHash(game), before);
});

test('W31-D07: a real stalled preparation describes the wait and keeps its recorded work', () => {
  const opening = createInitialState();
  opening.slices.company.founderAssignments[opening.playerCompanyId].data = 0;
  const queued = submitCommand(opening, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'desktop-stalled');
  assert.equal(queued.accepted, true, queued.reason?.message);
  const advanced = advanceWeek(queued.state, CONTENT);
  assert.equal(advanced.accepted, true, advanced.reason?.message);
  const before = canonicalStateHash(advanced.state), html = render(advanced.state);
  assert.match(html, /Waiting for Data points/);
  assert.match(html, /This project needs Data points to continue/);
  assert.doesNotMatch(html, /Preparation in progress|Staff continue preparing/);
  assert.match(html, /0 of 40 Data points complete/);
  assert.equal(canonicalStateHash(advanced.state), before);
});

test('W31-D08: researched cleanup stays reachable with only one unprepared dataset', () => {
  const game = createInitialState();
  game.slices.research.completedByCompany[game.playerCompanyId].push('R2A');
  const html = render(game);
  assert.match(html, /Improve data quality/);
  assert.match(html, /Deduplication and processing cost/);
  assert.match(html, /Install deduplication system/);
});
