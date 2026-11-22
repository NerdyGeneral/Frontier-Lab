import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { RIVAL_TACTIC_RULES } from '../src/content/market-dynamics';
import { createInitialState } from '../src/core/engine';
import { initializeMarketOpportunities } from '../src/modules/market-opportunities';
import { createRivalCampaign } from '../src/modules/rivals';
import { MarketDynamicsPanel } from '../src/ui/market-dynamics-panel';

test('the market briefing exposes dates, demand limits and optional responses without hidden details', () => {
  const game = createInitialState(); initializeMarketOpportunities(game);
  for (const rival of Object.values(game.slices.markets.rivals)) rival.campaign = createRivalCampaign(game, rival, CONTENT);
  const html = renderToStaticMarkup(<MarketDynamicsPanel game={game} onNavigate={() => {}} />);
  assert.match(html, /Weeks 6–9/); assert.match(html, /Professional planning season/); assert.match(html, /1\.75× the normal shopping rate/);
  assert.match(html, /not guaranteed sales/); assert.match(html, /Review your offer/); assert.match(html, /Check serving capacity/);
  assert.match(html, /Affordable API expansion/); assert.match(html, /Dependable model release/); assert.match(html, /Enterprise relationships/);
  assert.match(html, /No response is required each week/);
  for (const rival of Object.values(game.slices.markets.rivals)) {
    assert.ok(rival.campaign?.tactics);
    assert.ok(html.includes('Approach: ' + RIVAL_TACTIC_RULES[rival.campaign.tactics.focus].name), 'The announced tactic must be visible.');
  }
  assert.doesNotMatch(html, /<details|role="dialog"/);
  assert.doesNotMatch(html, /startingCash|reserveTarget/);
});

test('the market briefing does not reveal an unannounced future event or invent current demand', () => {
  const game = createInitialState(); initializeMarketOpportunities(game); game.week = 10;
  const html = renderToStaticMarkup(<MarketDynamicsPanel game={game} />);
  assert.match(html, /No buying window is active/); assert.match(html, /announced in Week 12/);
  assert.doesNotMatch(html, /Developer showcase|× the normal shopping rate/);
});
