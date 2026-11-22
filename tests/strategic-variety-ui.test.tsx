import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState, deserializeState, getGameView, canonicalStateHash } from '../src/core/index';
import type { GameState } from '../src/contracts/types';
import { CampaignPanel } from '../src/ui/campaign-panel';
import { ProductPanel, DeveloperApiPanel } from '../src/ui/product-panels';
import { BusinessCommitmentsPanel } from '../src/ui/business-panels';
import { openNaturalBusiness } from './fixtures/wave5-business';

const props = (game: GameState) => ({ game, view: getGameView(game), canAct: true, onQueue: () => assert.fail('Render must not submit an action') });
function visiblyMounted(html: string, id: string) {
  const position = html.indexOf(`id="${id}"`); assert.ok(position >= 0, `Missing control ${id}`);
  const ancestors: boolean[] = [];
  for (const match of html.slice(0, position).matchAll(/<(\/?)details\b([^>]*)>/g)) {
    if (match[1]) ancestors.pop(); else ancestors.push(/\bopen(?:=|\s|$)/.test(match[2]));
  }
  assert.ok(ancestors.every(Boolean), `${id} must be visible outside closed disclosures`);
}

test('STR-UI01: chapter choices are available from the opening and explain automatic progress', () => {
  const game = createInitialState(), before = canonicalStateHash(game), html = renderToStaticMarkup(<CampaignPanel {...props(game)} />);
  const chapterPosition = html.indexOf('id="chapters"'); assert.ok(chapterPosition >= 0);
  const sectionAncestors: Array<string | undefined> = [];
  for (const match of html.slice(0, chapterPosition).matchAll(/<(\/?)section\b([^>]*)>/g)) {
    if (match[1]) sectionAncestors.pop(); else sectionAncestors.push(match[2].match(/\bid="([^"]+)"/)?.[1]);
  }
  assert.ok(sectionAncestors.includes('campaign'), 'The chapter board must be a descendant of the selected campaign workspace, not a hidden sibling.');
  visiblyMounted(html, 'company-chapter');
  assert.match(html, /Your first paying product/); assert.match(html, /Focus on this chapter/);
  assert.match(html, /records qualifying weeks automatically/);
  assert.equal(canonicalStateHash(game), before);
});

test('STR-UI02: a first live product exposes audience positioning before efficiency research with a clear routing prerequisite', () => {
  const run = openNaturalBusiness(), game = run.state;
  const product = run.offers().find(item => item.kind === 'basic-chat')!;
  assert.equal(run.research.includes('R8'), false);
  const html = renderToStaticMarkup(<ProductPanel {...props(game)} />);
  visiblyMounted(html, product.id + '-audience'); visiblyMounted(html, product.id + '-serving-policy');
  assert.match(html, /Value seekers/); assert.match(html, /Professional use/);
  assert.match(html, /Economy · requires two-model routing/);
  assert.match(html, /Apply product strategy/); assert.match(html, /Serving work \/ 1,000 exchanges/);
});

test('STR-UI03: API and Business Documents strategies are visible without opening technical panels', () => {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave12-snapshot.json', import.meta.url), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); const game = loaded.state;
  const api = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'developer-api')!;
  const business = Object.values(game.slices.products.offers).find(item => item.companyId === game.playerCompanyId && item.kind === 'business-docs')!;
  visiblyMounted(renderToStaticMarkup(<DeveloperApiPanel {...props(game)} />), api.id + '-audience');
  visiblyMounted(renderToStaticMarkup(<BusinessCommitmentsPanel {...props(game)} />), business.id + '-audience');
});
