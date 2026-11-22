import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '../src/core/engine';
import type { GameState, ModelVersion } from '../src/contracts/types';
import type { DevelopmentMetricRow } from '../src/modules/model-development';
import { ModelVersionHistoryChart, TrainingBaselineChart, TrainingForecastChart } from '../src/ui/model-development-charts';

function seed(game: GameState) {
  return Object.values(game.slices.models.versions).find(model => model.companyId === game.playerCompanyId)!;
}

function child(game: GameState, parent: ModelVersion, id: string, name: string, conversation: number, createdWeek: number) {
  const model = { ...parent, id, name, createdWeek, parentModelId: parent.id, capabilityBps: { ...parent.capabilityBps, conversation } };
  game.slices.models.versions[id] = model;
  return model;
}

test('the forecast separates stored starting values, forecast bounds, direction and unchanged scores', () => {
  const rows: DevelopmentMetricRow[] = [
    { id: 'conversation', label: 'Conversation', currentBps: 4000, minBps: 5125, maxBps: 5200, lowerIsBetter: false },
    { id: 'documents', label: 'Documents', currentBps: 2100, minBps: 2010, maxBps: 2010, lowerIsBetter: false },
    { id: 'coding', label: 'Coding', currentBps: 3000, minBps: 3000, maxBps: 3000, lowerIsBetter: false },
    { id: 'tools', label: 'Tool use', currentBps: 3500, minBps: 3400, maxBps: 3600, lowerIsBetter: false },
  ];
  const html = renderToStaticMarkup(<TrainingForecastChart rows={rows} />);
  assert.match(html, /Expected skill changes/);
  assert.match(html, /Starting score/);
  assert.match(html, /Forecast range/);
  assert.match(html, /51.25–52/);
  assert.match(html, /Change \+11.25 to \+12 points/);
  assert.match(html, /Change −0.9 points/);
  assert.match(html, /No change/);
  assert.match(html, /data-change="mixed"/);
  const blank = renderToStaticMarkup(<TrainingForecastChart rows={[]} />);
  assert.match(blank, /prepared data to see a forecast/);
  assert.doesNotMatch(blank, /mdc-track/);
});

test('the first version has all recorded capabilities and no fabricated improvement', () => {
  const game = createInitialState(), model = seed(game);
  const html = renderToStaticMarkup(<ModelVersionHistoryChart game={game} model={model} />);
  assert.match(html, /1 saved version/);
  for (const label of ['Conversation', 'Documents', 'Coding', 'Tool use', 'Reliability']) assert.match(html, new RegExp(label));
  assert.equal((html.match(/class="mdc-baseline-track"/g) ?? []).length, 5);
  assert.match(html, /first recorded version/);
  assert.doesNotMatch(html, /<polyline|Skill changes from/);
  const waiting = renderToStaticMarkup(<TrainingBaselineChart model={model} />);
  assert.match(waiting, /Starting scores/);
  assert.equal((waiting.match(/class="mdc-baseline-track"/g) ?? []).length, 5);
  assert.doesNotMatch(waiting, /Forecast range/);
});

test('history connects only the selected branch in version order and compares exact saved scores', () => {
  const game = createInitialState(), root = seed(game);
  const first = child(game, root, 'c1', 'Support one', 5200, 4);
  child(game, root, 'other', 'Sibling draft', 8500, 6);
  const second = child(game, first, 'c2', 'Support two', 6333, 10);
  const html = renderToStaticMarkup(<ModelVersionHistoryChart game={game} model={second} />);
  assert.match(html, /3 saved versions/);
  assert.match(html, /\+11.33 points/);
  assert.match(html, /Skill changes from Support one/);
  assert.match(html, /Version scores for conversation/);
  assert.match(html, /Support two/);
  assert.doesNotMatch(html, /Sibling draft/);
  assert.equal((html.match(/class="mdc-history-point"/g) ?? []).length, 3);
});

test('historical gaps and other companies cannot invent an ancestor', () => {
  const game = createInitialState(), root = seed(game);
  const model = child(game, root, 'c3', 'Old import', 5100, 8);
  model.parentModelId = 'missing-base';
  assert.match(renderToStaticMarkup(<ModelVersionHistoryChart game={game} model={model} />), /1 saved version/);
  model.parentModelId = 'elsewhere';
  game.slices.models.versions.elsewhere = { ...root, id: 'elsewhere', name: 'Another lab', companyId: 'foreign' };
  assert.doesNotMatch(renderToStaticMarkup(<ModelVersionHistoryChart game={game} model={model} />), /Another lab/);
});

test('calibration and policy improvements appear even when every general skill stays flat', () => {
  const game = createInitialState(), root = seed(game);
  root.behavior = { confidentErrorBps: 1200, falseRefusalBps: 700 };
  const model = child(game, root, 'calibration', 'Calibrated version', root.capabilityBps.conversation, 5);
  model.behavior = { ...root.behavior, confidentErrorBps: 600 };
  const html = renderToStaticMarkup(<ModelVersionHistoryChart game={game} model={model} />);
  assert.match(html, /Confident mistakes/);
  assert.match(html, /data-change="gain">−6 points from/);
  assert.match(html, /Lower is better/);
  assert.match(html, /Version scores for confident mistakes/);
});
