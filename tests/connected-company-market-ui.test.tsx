import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { canonicalStateHash, deserializeState, getGameView } from '../src/core/index';
import type { GameState, ProductKind } from '../src/contracts/types';
import { isCapabilitySuite } from '../src/modules/evaluation-classification';
import { ProductPanel, DeveloperApiPanel } from '../src/ui/product-panels';
import { BusinessCommitmentsPanel } from '../src/ui/business-panels';
import { SystemsBriefsPanel } from '../src/ui/systems-briefs-panel';
import { StudioLaunchSelectionProvider } from '../src/ui/studio-interaction-context';
import { PRODUCT_WORKLOADS } from '../src/content/product-workloads';

function published() {
  const decoded = deserializeState(readFileSync(new URL('./fixtures/connected-037-paid-published.json', import.meta.url), 'utf8'));
  assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}
const noAction = () => assert.fail('Rendering must not queue work or choose an offer.');
const props = (game: GameState) => ({ game, view: getGameView(game), canAct: true, onQueue: noAction });
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function visible(html: string, id: string) {
  const position = html.indexOf(`id="${id}"`); assert.ok(position >= 0, id);
  const ancestors: boolean[] = [];
  for (const match of html.slice(0, position).matchAll(/<(\/?)details\b([^>]*)>/g)) {
    if (match[1]) ancestors.pop(); else ancestors.push(/\bopen(?:=|\s|$)/.test(match[2]));
  }
  assert.ok(ancestors.every(Boolean), `${id} must be visible without opening technical menus.`);
}

test('offer selectors and all customer workload choices are visible in the three product destinations', () => {
  const game = published(), before = canonicalStateHash(game);
  for (const [kind, Panel] of [['basic-chat', ProductPanel], ['developer-api', DeveloperApiPanel], ['business-docs', BusinessCommitmentsPanel]] as const) {
    const product = Object.values(game.slices.products.offers).find(product => product.companyId === game.playerCompanyId && product.kind === kind)!;
    const html = renderToStaticMarkup(<Panel {...props(game)} />);
    visible(html, kind + '-portfolio'); visible(html, product.id + '-workload'); visible(html, product.id + '-name');
    for (const workload of Object.values(PRODUCT_WORKLOADS)) assert.ok(plain(html).includes(workload.name), workload.name);
    assert.match(plain(html), /share customers, commercial staff and compute/);
  }
  assert.equal(canonicalStateHash(game), before);
});

test('developer and business handoffs keep existing offers visible, preselect the exact replacement and reject an unrelated report', () => {
  const game = published();
  const model = Object.values(game.slices.models.versions).find(model => model.name === 'Case continuity model')!;
  const report = Object.values(game.slices.models.reports).find(report => report.companyId === game.playerCompanyId && report.modelId === model.id && isCapabilitySuite(report.suiteId))!;
  const unrelated = Object.values(game.slices.models.reports).find(report => report.modelId !== model.id && isCapabilitySuite(report.suiteId))!;
  for (const [kind, Panel] of [['developer-api', DeveloperApiPanel], ['business-docs', BusinessCommitmentsPanel]] as const) {
    const product = Object.values(game.slices.products.offers).find(product => product.companyId === game.playerCompanyId && product.kind === kind)!;
    const selectId = product.id + '-replacement';
    const render = (reportId: string) => renderToStaticMarkup(<StudioLaunchSelectionProvider value={{ intentId: 71, productKind: kind as ProductKind, modelId: model.id, reportId }}><Panel {...props(game)} /></StudioLaunchSelectionProvider>);
    const html = render(report.id); visible(html, selectId);
    assert.ok(html.includes(`value="${product.id}" selected=""`), 'An existing offer remains selected; creating another offer is an explicit player choice.');
    assert.ok(html.includes(`value="${model.id}" selected=""`), 'The development result must select its own model, even when a newer model exists.');
    assert.match(plain(render(unrelated.id)), /report.*(another model|exact model|this tested model)|report does not prove/i);
  }
});

test('client progress shows earned demand access and the full repeat commitment before acceptance', () => {
  const game = published(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<SystemsBriefsPanel game={game} canAct onQueue={noAction} />);
  assert.match(html, /aria-label="Client relationships"/);
  assert.match(plain(html), /Repeat client/); assert.match(plain(html), /12% acquisition weight/);
  assert.match(plain(html), /3 consecutive delivery weeks/); assert.match(plain(html), /repeat commitment/);
  assert.equal(canonicalStateHash(game), before);
});
