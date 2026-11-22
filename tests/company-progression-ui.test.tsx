import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '../src/core/engine';
import { getGameView } from '../src/core/selectors';
import { canonicalStateHash } from '../src/core/canonical';
import { CampaignPanel } from '../src/ui/campaign-panel';
import { ResearchProgramsPanel } from '../src/ui/research-programs-panel';

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
