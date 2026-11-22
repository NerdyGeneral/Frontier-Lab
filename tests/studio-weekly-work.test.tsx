import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { advanceWeek, createInitialState, submitCommand } from '../src/core/engine';
import { getStudioView } from '../src/core/studio';
import { StudioWeeklyWork } from '../src/ui/studio-weekly-work';

function tick(game: GameState, commands: CommandPayload[] = []) {
  for (const payload of commands) {
    const result = submitCommand(game, payload, CONTENT);
    assert.ok(result.accepted, result.reason?.message);
    game = result.state;
  }
  const result = advanceWeek(game, CONTENT);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}

function render(game: GameState) {
  return renderToStaticMarkup(<StudioWeeklyWork game={game} projects={getStudioView(game).projects} onInspect={() => {}} />);
}

test('The room shows settled data progress, with no production animation when loading a save', () => {
  const game = createInitialState(CONTENT, 'release');
  assert.match(render(game), /Start a project and advance the week/);
  const working = tick(game, [{ kind: 'prepare_data', packetId: CONTENT.starterData.id }]);
  const html = render(working);
  assert.match(html, /<b>\+20<\/b> Data/);
  assert.match(html, /20 of 20 points matched to work/);
  assert.match(html, /Prepare dataset/);
  assert.match(html, /50%/);
  assert.doesNotMatch(html, /has-new-week/);
});

test('Idle specialists generate points even when no project requests their output', () => {
  let game = tick(createInitialState(CONTENT, 'release'), [{ kind: 'hire_staff', role: 'ml' }]);
  game = tick(tick(game));
  const html = render(game);
  assert.match(html, /<b>\+30<\/b> Design/);
  assert.match(html, /0 of [\d.]+ points matched to work/);
  assert.match(html, /Ready staff pick up matching work automatically/);
});
