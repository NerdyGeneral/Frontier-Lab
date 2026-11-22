import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '../src/core/engine';
import { getGameView } from '../src/core/selectors';
import { canonicalStateHash } from '../src/core/canonical';
import { CampaignPanel } from '../src/ui/campaign-panel';
import { ResearchProgramsPanel } from '../src/ui/research-programs-panel';
import { ResearchProgramsWorkspace } from '../src/ui/research-programs-workspace';
import { StudioResearchTree } from '../src/ui/studio-research-tree';

test('company progression shows all business paths, world influence and permanent rewards without triggering actions', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<CampaignPanel game={game} view={getGameView(game)} canAct={true} onQueue={() => assert.fail('Rendering must not queue work')} />);
  for (const text of ['Efficient intelligence provider', 'Private AI supplier', 'Verified work company', 'Silicon supplier', 'Founding advantage', 'Applied research access', 'Pin this goal']) assert.ok(html.includes(text), text);
  assert.match(html, /Every chapter tracks your results in the background/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.equal(canonicalStateHash(game), before);
});

test('systems programs expose all choices and the paid work gate before any model is ready', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<ResearchProgramsPanel game={game} canAct={true} onQueue={() => assert.fail('Rendering must not spend money')} />);
  for (const text of ['Efficient systems', 'Persistent systems', 'Verified systems', 'Pilot', 'Production', 'Fleet', 'Frontier', 'Entry fee', 'Research compute', 'Research work', 'Concurrent sessions']) assert.ok(html.includes(text), text);
  assert.match(html, /first trained, independently tested paying service/);
  assert.match(html, /Train and evaluate a model first/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.equal(canonicalStateHash(game), before);
});

test('every discovery collection keeps the same programs entry without embedding a second funding form', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const noAction = () => assert.fail('Browsing discoveries must not schedule or navigate');
  for (const [researchId, scope] of [['R1', 'all'], ['M1', 'customization'], ['A1', 'systems']]) {
    const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} selection={{ intentId: 1, researchId }} />);
    assert.ok(html.includes('data-scope="' + scope + '"'));
    assert.match(html, /Open research programs/);
    assert.doesNotMatch(html, /aria-label="Systems research programs"|aria-label="Architecture research"/);
  }
  const programs = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={noAction} />);
  assert.match(programs, /id="research-programs"/);
  assert.match(programs, /aria-label="Research program type"/);
  assert.match(programs, /Systems experiments/);
  assert.match(programs, /Architecture program/);
  assert.match(programs, /aria-label="Systems research programs"/);
  assert.match(programs, /aria-label="Architecture research"/);
  assert.equal(canonicalStateHash(game), before);
});

test('a campaign awaiting its next week can inspect every systems program without initializing or funding it', () => {
  const game = createInitialState();
  delete game.slices.campaign.progression;
  const before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={() => assert.fail('Inspecting pending programs must not advance or fund work')} />);
  for (const text of ['Efficient systems', 'Persistent systems', 'Verified systems', 'Program costs and eligibility will load after your next week', 'Architecture research']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Fund experiment|Entry fee/);
  assert.equal(game.slices.campaign.progression, undefined);
  assert.equal(canonicalStateHash(game), before);
});

test('explicit program navigation selects the requested body while retaining a single form for both program types', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  for (const programType of ['architecture', 'systems'] as const) {
    const html = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={() => assert.fail('Program navigation must not fund work')} selection={{ intentId: 7, programType }} />);
    const controls = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*aria-controls="([^"]+)"[^>]*>/g)];
    const selected = controls.find(control => control[1] === 'true');
    assert.ok(selected?.[2].endsWith('-' + programType));
    const body = html.match(new RegExp('<div id="' + selected![2] + '"([^>]*)>'));
    assert.ok(body && !body[1].includes('hidden'), 'The requested program opens without another click');
    const otherType = programType === 'systems' ? 'architecture' : 'systems';
    const other = controls.find(control => control[2].endsWith('-' + otherType));
    assert.ok(other && html.includes('<div id="' + other[2] + '" hidden="">'));
    assert.equal((html.match(/aria-label="Systems research programs"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-label="Architecture research"/g) ?? []).length, 1);
  }
  assert.equal(canonicalStateHash(game), before);
});
