import test from 'node:test';
import assert from 'node:assert/strict';
import { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, canonicalStateHash, createInitialState, submitCommand } from '../src/core/index';
import { formatMoney } from '../src/core/math';
import { getStudioView } from '../src/core/studio';
import type { StudioPanelId } from '../src/core/studio-tasks';
import { getStudioDestinationForPanel } from '../src/core/studio-navigation';
import { StudioCompanySummary } from '../src/ui/studio-company-summary';

const noAction = () => assert.fail('Rendering a summary must not open a panel');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .map(match => ({ attributes: match[1], text: textOnly(match[2]) }));

test('W30E-SU01: four labelled shortcuts show company status without changing the game', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const summary = getStudioView(game).summary;
  const html = renderToStaticMarkup(<StudioCompanySummary summary={summary} onOpenPanel={noAction} />);
  const items = buttons(html);
  assert.match(html, /<nav[^>]*aria-label="Company status"/);
  assert.equal(items.length, 4);
  assert.equal(items.every(item => item.attributes.includes('type="button"')), true);
  assert.deepEqual(items.map(item => item.attributes.match(/aria-label="([^:]+):/)?.[1]), ['Company cash', 'Runway', 'Team', 'Compute']);
  assert.match(items[2].text, /1 person 1 ready · 0 onboarding/);
  assert.match(items[3].text, /4 CU total 0 CUw used last week/);
  assert.equal(canonicalStateHash(game), before);
});

test('W30E-SU02: cash reservations and new hires retain their different timing', () => {
  const queued = submitCommand(createInitialState(), { kind: 'hire_staff', role: 'ml' }, CONTENT, 'summary-hire');
  assert.equal(queued.accepted, true, queued.reason?.message);
  const pending = getStudioView(queued.state).summary;
  const pendingItems = buttons(renderToStaticMarkup(<StudioCompanySummary summary={pending} onOpenPanel={noAction} />));
  assert.equal(pending.reservedCashCents, 150_000);
  assert.equal(pending.availableCashCents, pending.cashCents - 150_000);
  assert.ok(pendingItems[0].text.includes(`${formatMoney(pending.availableCashCents)} available`));
  assert.ok(pendingItems[0].text.includes(`${formatMoney(pending.cashCents)} total · $1,500 reserved for queued actions`));
  assert.match(pendingItems[2].text, /1 person 1 ready · 0 onboarding/);

  const advanced = advanceWeek(queued.state, CONTENT);
  assert.equal(advanced.accepted, true, advanced.reason?.message);
  const onboarded = getStudioView(advanced.state).summary;
  const team = buttons(renderToStaticMarkup(<StudioCompanySummary summary={onboarded} onOpenPanel={noAction} />))[2];
  assert.match(team.text, /2 people 1 ready · 1 onboarding/);
});

test('W30E-SU03: runway is conditional and total compute stays distinct from past work', () => {
  const summary = { ...getStudioView(createInitialState()).summary, runwayWeeks: null, totalCU: 7_500_000_000, executedCUw: 2_250_000_000 };
  const items = buttons(renderToStaticMarkup(<StudioCompanySummary summary={summary} onOpenPanel={noAction} />));
  assert.match(items[1].text, /Runway Costs covered At current pace/);
  assert.doesNotMatch(items[1].text, /Unlimited|forever|Self-funded/i);
  assert.match(items[3].text, /Compute 7.5 CU total 2.25 CUw used last week/);
  assert.doesNotMatch(items[3].text, /free|available|allocated/i);
  const oneWeek = buttons(renderToStaticMarkup(<StudioCompanySummary summary={{ ...summary, runwayWeeks: 1 }} onOpenPanel={noAction} />))[1];
  assert.match(oneWeek.text, /Runway 1 week At current pace/);
  const noWeeks = buttons(renderToStaticMarkup(<StudioCompanySummary summary={{ ...summary, runwayWeeks: 0 }} onOpenPanel={noAction} />))[1];
  assert.match(noWeeks.text, /Runway 0 weeks At current pace/);
});

test('W30E-SU04: shortcuts open their existing management panels and support a disabled guard', () => {
  const summary = getStudioView(createInitialState()).summary;
  const opened: StudioPanelId[] = [];
  const tree = StudioCompanySummary({ summary, onOpenPanel: panel => opened.push(panel) });
  for (const child of Children.toArray(tree.props.children)) {
    assert.ok(isValidElement<{ type: string; onClick: () => void }>(child));
    assert.equal(child.type, 'button');
    assert.equal(child.props.type, 'button');
    child.props.onClick();
  }
  assert.deepEqual(opened, ['business', 'business', 'people', 'compute']);
  assert.deepEqual(opened.map(getStudioDestinationForPanel), ['company', 'company', 'operations', 'operations']);
  const disabled = buttons(renderToStaticMarkup(<StudioCompanySummary summary={summary} disabled onOpenPanel={noAction} />));
  assert.equal(disabled.length, 4);
  assert.equal(disabled.every(item => item.attributes.includes('disabled=""')), true);
});
