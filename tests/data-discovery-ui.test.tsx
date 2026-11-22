import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { DATA_CATALOG } from '../src/content/wave2-lab';
import { createInitialState, canonicalStateHash, getGameView } from '../src/core/index';
import { DataCatalog, searchDataCatalog } from '../src/ui/data-catalog';
import { DataPanel, LabPanel } from '../src/ui/lab-panels';
import { StudioDataSelectionProvider } from '../src/ui/studio-interaction-context';

const noAction = () => assert.fail('Browsing must not submit a game action');
test('the data catalog is discoverable before the first preparation and exposes all advanced sources', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const panel = renderToStaticMarkup(<DataPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />);
  assert.match(panel, /Data catalog · 14 sources/);
  assert.match(panel, /My datasets/);
  const html = renderToStaticMarkup(<DataCatalog game={game} catalogId="advanced-reasoning-1" canAct onQueue={noAction} onSelect={noAction} />);
  for (const item of DATA_CATALOG) assert.ok(html.includes(item.name), item.name + ' must be discoverable');
  assert.match(html, /Search training data/);
  assert.match(html, /Selected dataset and cost/);
  assert.equal((html.match(/data-studio-review="buy_data"/g) ?? []).length, 1);
  assert.equal(canonicalStateHash(game), before);
});
test('catalog searches find skills and foundation data without modifying game content', () => {
  assert.equal(searchDataCatalog('').length, DATA_CATALOG.length);
  assert.ok(searchDataCatalog('reasoning').some(item => item.id === 'advanced-reasoning-1'));
  assert.ok(searchDataCatalog('long context').some(item => item.id === 'advanced-longContext-1'));
  assert.ok(searchDataCatalog('foundation').every(item => item.broadUnits > 0));
  assert.equal(searchDataCatalog('no such source').length, 0);
});
test('the training library shortcut opens the catalog directly without an unavailable dataset warning', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioDataSelectionProvider value={{ intentId: 1, view: 'catalog' }}>
    <DataPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </StudioDataSelectionProvider>);
  assert.match(html, /Search training data/);
  assert.match(html, /Data catalog · 14 sources/);
  assert.doesNotMatch(html, /This dataset is unavailable/);
  assert.equal((html.match(/data-studio-review="buy_data"/g) ?? []).length, 1);
});
test('additional training data and experiment comparison are reachable in the guided view', () => {
  const game = createInitialState();
  const starter = game.slices.data.packets[CONTENT.starterData.id];
  starter.prepared = true; starter.readyUnits = starter.rawUnits;
  game.slices.data.packets.extra = { ...structuredClone(starter), id: 'extra', name: 'Another prepared source', companyId: game.playerCompanyId };
  const html = renderToStaticMarkup(<LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />);
  assert.match(html, /aria-label="Additional training datasets"/);
  assert.match(html, /Another prepared source/);
  assert.match(html, /Compare training experiments/);
  assert.doesNotMatch(html, /class="studio-training-experiments" hidden/);
});
