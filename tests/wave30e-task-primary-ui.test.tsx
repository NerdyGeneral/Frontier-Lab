import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { previewCommand, serializeState, submitCommand } from '../src/core/index';
import { ActionControl } from '../src/ui/components';
import { StudioCommandReviewProvider } from '../src/ui/studio-interaction-context';
import { selectStudioPrimaryAction } from '../src/ui/studio-task-primary';
import type { StudioVisibleAction } from '../src/ui/studio-task-primary';
import { createPlayerOnlyState } from './fixtures/player-only';

// Pure selection and rendered marker checks. Visibility, MutationObserver
// lifetime, disclosure toggles and original-button dispatch need a mounted browser.
const noAction = () => assert.fail('Rendering must not review or schedule an action');
const attribute = (tag: string, name: string) => tag.match(new RegExp('\\b' + name + '="([^"]*)"'))?.[1];
const button = (html: string) => {
  const tag = html.match(/<button\b[^>]*>/)?.[0];
  assert.ok(tag, 'Expected the original action control');
  return tag;
};
const visible = (id: string, actionKey?: string, disabled = false): StudioVisibleAction => ({
  id, actionKey, label: 'Review ' + id, disabled, reason: disabled ? 'Requirements are missing.' : '',
});

test('W31B-P01: a named blocked action stays primary instead of selecting another enabled command', () => {
  const blocked = visible('selected-training', 'training-start', true);
  const enabled = visible('other-research', 'research-start');
  const actions = [enabled, blocked], before = JSON.stringify(actions);
  assert.equal(selectStudioPrimaryAction(actions, 'training-start'), blocked);
  assert.equal(selectStudioPrimaryAction([...actions].reverse(), 'training-start'), blocked);
  assert.equal(JSON.stringify(actions), before);
});

test('W31B-P02: absent or duplicate bindings never infer a different action', () => {
  const first = visible('first', 'training-start');
  const duplicate = visible('duplicate', 'training-start', true);
  const other = visible('other', 'research-start');
  assert.equal(selectStudioPrimaryAction([first, duplicate, other], 'training-start'), undefined);
  assert.equal(selectStudioPrimaryAction([other, duplicate, first], 'training-start'), undefined);
  assert.equal(selectStudioPrimaryAction([other], 'training-start'), undefined);
  assert.equal(selectStudioPrimaryAction([first, other]), undefined);
  assert.equal(selectStudioPrimaryAction([first, other], ''), undefined);
  assert.equal(selectStudioPrimaryAction([], 'training-start'), undefined);
});

test('W31B-P03: same-kind commands retain exact semantic and DOM identities with their original quotes', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}>
    <ActionControl game={game} payload={{ kind: 'start_research', researchId: 'R1' }} taskAction="research:R1" label="Review first research" canAct onQueue={noAction} />
    <ActionControl game={game} payload={{ kind: 'start_research', researchId: 'R3' }} taskAction="research:R3" label="Review second research" canAct onQueue={noAction} />
  </StudioCommandReviewProvider>);
  const tags = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.equal(tags.length, 2);
  const ids = tags.map(tag => attribute(tag, 'data-studio-action-id'));
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, 2, 'Two same-kind commands must not collapse into one footer choice');
  const bindings = tags.map(tag => attribute(tag, 'data-studio-primary-for'));
  assert.deepEqual(bindings, ['research:R1', 'research:R3']);
  const candidates = tags.map((tag, index) => visible(ids[index]!, bindings[index]));
  assert.equal(selectStudioPrimaryAction(candidates, 'research:R3')?.id, ids[1]);
  tags.forEach(tag => {
    const quoteId = attribute(tag, 'aria-describedby');
    assert.ok(quoteId);
    assert.equal(attribute(tag, 'data-studio-review'), 'start_research');
    assert.equal(attribute(tag, 'data-studio-action-id'), 'action-' + quoteId);
    assert.ok(html.includes('id="' + quoteId + '"'));
    assert.equal(attribute(tag, 'data-studio-blocked-reason'), undefined);
    assert.doesNotMatch(tag, /disabled=/);
  });
  assert.equal(serializeState(game), before);
});

test('W31B-P04: incomplete and disabled drafts retain their named binding and actual original reason', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const validPayload = { kind: 'start_research', researchId: 'R1' } as const;
  const missing = button(renderToStaticMarkup(<ActionControl game={game} payload={null} taskAction="training-start" label="Review training" canAct onQueue={noAction} emptyReason="Choose a dataset first." />));
  assert.equal(attribute(missing, 'data-studio-review'), 'incomplete');
  assert.equal(attribute(missing, 'data-studio-primary-for'), 'training-start');
  assert.equal(attribute(missing, 'data-studio-blocked-reason'), 'Choose a dataset first.');
  assert.match(missing, /disabled=""/);
  const incomplete = visible(attribute(missing, 'data-studio-action-id')!, attribute(missing, 'data-studio-primary-for'), true);
  assert.equal(selectStudioPrimaryAction([visible('other', 'research-start'), incomplete], 'training-start'), incomplete);
  const observer = button(renderToStaticMarkup(<ActionControl game={game} payload={validPayload} label="Review research" canAct={false} onQueue={noAction} />));
  assert.equal(attribute(observer, 'data-studio-blocked-reason'), 'Wait until this lab is ready to make choices.');
  assert.match(observer, /disabled=""/);
  const unchanged = button(renderToStaticMarkup(<ActionControl game={game} payload={validPayload} label="Review research" canAct onQueue={noAction} extraDisabled />));
  assert.equal(attribute(unchanged, 'data-studio-blocked-reason'), 'Complete the requirements above.');
  assert.match(unchanged, /disabled=""/);
  const lockedPayload = { kind: 'start_research', researchId: 'R2' } as const;
  const locked = button(renderToStaticMarkup(<ActionControl game={game} payload={lockedPayload} label="Review locked research" canAct onQueue={noAction} />));
  assert.equal(attribute(locked, 'data-studio-blocked-reason'), previewCommand(game, lockedPayload).reason?.message);
  assert.match(locked, /disabled=""/);
  assert.equal(serializeState(game), before);
});

test('W31B-P05: a queued bound control stays disabled and points to its real scheduled week', () => {
  const payload = { kind: 'start_research', researchId: 'R1' } as const;
  const result = submitCommand(createPlayerOnlyState(), payload, CONTENT, 'footer-scheduled-research');
  assert.equal(result.accepted, true, result.reason?.message);
  const game = result.state, before = serializeState(game);
  const html = renderToStaticMarkup(<ActionControl game={game} payload={payload} taskAction="research:R1" label="Review research" canAct onQueue={noAction} />);
  const original = button(html);
  assert.match(original, /disabled=""/);
  assert.equal(attribute(original, 'data-studio-blocked-reason'), 'Already scheduled for Week 1.');
  assert.equal(attribute(original, 'data-studio-review'), payload.kind);
  assert.equal(attribute(original, 'data-studio-primary-for'), 'research:R1');
  assert.match(html, /Queued for Week 1/);
  assert.equal(serializeState(game), before);
});

test('W31B-P06: an unmarked management action keeps its inline command without becoming a default primary', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<ActionControl game={game} payload={{ kind: 'prepare_data', packetId: CONTENT.starterData.id }} label="Prepare data" canAct onQueue={noAction} />);
  const original = button(html);
  assert.equal(attribute(original, 'data-studio-primary-for'), undefined);
  assert.equal(attribute(original, 'data-studio-review'), 'prepare_data');
  assert.doesNotMatch(original, /disabled=""/);
  const unbound = visible(attribute(original, 'data-studio-action-id')!);
  assert.equal(selectStudioPrimaryAction([unbound]), undefined);
  assert.equal(selectStudioPrimaryAction([unbound], 'prepare_data'), undefined);
  assert.equal(serializeState(game), before);
});
