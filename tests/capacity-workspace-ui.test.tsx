import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { canonicalStateHash, createInitialState, deserializeState, getGameView } from '../src/core/index';
import { capacityForecastAvailability } from '../src/modules/capacity-forecast';
import { getComputeCostView } from '../src/modules/compute-costs';
import { AppliedResearchPanel } from '../src/ui/applied-research-panel';
import { CapacityForecastPanel } from '../src/ui/capacity-forecast-panel';
import { ComputeCostsPanel } from '../src/ui/compute-costs-panel';
import { StudioWorkbenchPanel, StudioWorkbenchProvider, retainedWorkbenchPropsEqual } from '../src/ui/studio-workbench-context';
import type { PanelProps } from '../src/ui/panels';

const noAction = () => assert.fail('Reading capacity reports must not submit an action');
function establishedLab() {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave27-canary-published.json', import.meta.url), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  return loaded.state;
}
function renderCapacity(props: PanelProps, mode: 'classic' | 'studio', panel: string | null) {
  return renderToStaticMarkup(<StudioWorkbenchProvider value={{ mode, panel, standalone: null, epoch: 0 }}>
    <StudioWorkbenchPanel panelId="capacity-forecast"><CapacityForecastPanel {...props} /></StudioWorkbenchPanel>
    <StudioWorkbenchPanel panelId="compute-costs"><ComputeCostsPanel {...props} /></StudioWorkbenchPanel>
  </StudioWorkbenchProvider>);
}

test('the dedicated Studio forecast opens its twelve-week tool while hidden and closed Classic forecasts stay lazy', () => {
  const game = establishedLab(), before = canonicalStateHash(game);
  const props = { game, view: getGameView(game), canAct: true, onQueue: noAction };
  assert.equal(capacityForecastAvailability(game).available, true);
  const returningCustomers = game.slices.markets.returnedNextWeek;
  let customerProjectionReads = 0;
  Object.defineProperty(game.slices.markets, 'returnedNextWeek', { configurable: true, enumerable: true, get: () => { customerProjectionReads++; return returningCustomers; } });

  assert.equal(renderCapacity(props, 'studio', null), '');
  assert.equal(customerProjectionReads, 0, 'Unvisited panels must not calculate forecasts');
  const classic = renderCapacity(props, 'classic', null);
  assert.ok(classic.includes('<summary>Plan the next twelve weeks</summary>'));
  assert.ok(!classic.includes('id="forecast-base-growth"'));
  assert.equal(customerProjectionReads, 0, 'The closed Classic disclosure must not project customer demand');

  const focused = renderCapacity(props, 'studio', 'capacity-forecast');
  assert.ok(focused.includes('aria-label="Twelve-week capacity planning"'));
  assert.equal((focused.match(/id="forecast-base-growth"/g) ?? []).length, 1);
  assert.ok(focused.includes('Base case: twelve-week customer-service plan'));
  assert.ok(!focused.includes('<summary>Plan the next twelve weeks</summary>'));
  assert.ok(!focused.includes('id="compute-costs"'), 'The adjacent Costs route stays unmounted');
  assert.ok(customerProjectionReads > 0, 'The selected route calculates the actual forecast immediately');
  assert.equal(canonicalStateHash(game), before);
});

test('the dedicated Studio costs route shows its report immediately while the Classic report stays collapsed and lazy', () => {
  const game = establishedLab(), before = canonicalStateHash(game);
  const props = { game, view: getGameView(game), canAct: true, onQueue: noAction };
  const report = getComputeCostView(game).latest;
  assert.ok(report);
  const activities = report.activities;
  let reportReads = 0;
  Object.defineProperty(report, 'activities', { configurable: true, enumerable: true, get: () => { reportReads++; return activities; } });
  const classic = renderCapacity(props, 'classic', null);
  assert.ok(classic.includes('<summary>View compute costs · Week ' + report.week + '</summary>'));
  assert.ok(!classic.includes('Billed compute and infrastructure'));
  assert.equal(reportReads, 0, 'Closed Classic reports do not render the detailed accounting');

  const focused = renderCapacity(props, 'studio', 'compute-costs');
  assert.ok(focused.includes('aria-label="Compute costs for Week ' + report.week + '"'));
  assert.equal((focused.match(/id="compute-cost-week"/g) ?? []).length, 1);
  assert.ok(focused.includes('Billed compute and infrastructure'));
  assert.ok(!focused.includes('<summary>View compute costs'));
  assert.ok(!focused.includes('id="capacity-forecast"'), 'The adjacent Forecast route stays unmounted');
  assert.ok(reportReads > 0);
  assert.equal(canonicalStateHash(game), before);
});

test('focused report presentation preserves installation gates and the applied research handoff reaches Forecast', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const props = { game, view: getGameView(game), canAct: true, onQueue: noAction };
  for (const panel of ['capacity-forecast', 'compute-costs']) {
    const html = renderCapacity(props, 'studio', panel);
    assert.ok(html.includes('Research Capacity forecast (R12A)'));
    assert.ok(!html.includes('id="forecast-base-growth"') && !html.includes('id="compute-cost-week"'));
  }
  assert.equal(canonicalStateHash(game), before);
  const established = establishedLab();
  const applied = renderToStaticMarkup(<AppliedResearchPanel game={established} view={getGameView(established)} canAct onQueue={noAction} />);
  assert.ok(applied.includes('href="#capacity-forecast">Capacity forecast</a>'));
});

test('changing presentation wakes an active retained panel but does not wake hidden report panels', () => {
  const children = <span>Retained report</span>;
  const previous = { active: true, epoch: 1, presentation: 'classic' as const, children };
  assert.equal(retainedWorkbenchPropsEqual(previous, { ...previous, presentation: 'studio' }), false);
  assert.equal(retainedWorkbenchPropsEqual(previous, { ...previous, presentation: 'studio', active: false }), true);
});
