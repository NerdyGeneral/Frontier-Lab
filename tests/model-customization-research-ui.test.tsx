import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CUSTOMIZATION_RESEARCH, CUSTOMIZATION_RESEARCH_IDS } from '../src/content/model-customization-research';
import { serializeState } from '../src/core/snapshot';
import { researchApplicationLink } from '../src/ui/guide-links';
import { StudioResearchMethod } from '../src/ui/studio-research-method';
import { getStudioResearchApplication, StudioResearchTree } from '../src/ui/studio-research-tree';
import { StudioCommandReviewProvider } from '../src/ui/studio-interaction-context';
import { earnResearch } from './fixtures/customization-research';
import { createPlayerOnlyState } from './fixtures/player-only';

const noAction = () => assert.fail('Rendering research cannot schedule work or navigate');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('all thirteen customization choices remain visible and searchable in the full research tree while locked', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} onOpenMethod={noAction} />);
  assert.match(html, /data-scope="all"/);
  assert.match(html, /aria-label="Research collection"/);
  assert.match(textOnly(html), /All research 66 Model customization 13 AI systems 12/);
  assert.ok(html.indexOf('aria-label="Research collection"') < html.indexOf('model-architecture-research-'), 'The new collection is reachable before the architecture panel');
  assert.match(html, /type="search"/);
  for (const definition of CUSTOMIZATION_RESEARCH) {
    assert.ok(html.includes('aria-label="' + definition.id + ': ' + definition.name), definition.id);
    assert.ok(html.includes(definition.name));
  }
  assert.equal(serializeState(game), before);
});

test('a customization selection opens a compact four-pathway view with all external prerequisites still linked', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} onOpenMethod={noAction} selection={{ intentId: 1, researchId: 'M5' }} />);
  assert.match(html, /data-scope="customization"/);
  assert.doesNotMatch(html, /model-architecture-research-/, 'The focused collection avoids repeating the architecture program');
  assert.doesNotMatch(html, /data-research-id="(?:R|D)/, 'Available cards belong to the selected collection');
  assert.match(textOnly(html), /13 methods across four design pathways/);
  assert.match(html, /grid-template-columns:repeat\(4, 216px\)/);
  assert.equal([...html.matchAll(/aria-label="M\d+:/g)].length, 13);
  assert.doesNotMatch(html, /aria-label="R1:/, 'External research remains linked rather than crowding the focused diagram');
  assert.match(html, /data-research-from="M4" data-research-to="M5"/);
  assert.match(textOnly(html), /M4 Extended context/);
  assert.match(textOnly(html), /R12 Enterprise operations/);
  assert.match(html, /data-research-target="R1"/);
  assert.match(textOnly(html), /Open model designer/);
  assert.match(html, />Open model designer<\/button>/);
  assert.match(html, /research-tree-list-view/);
  assert.equal(serializeState(game), before);
});

test('every customization method has a direct designer application and an explicit training tradeoff', () => {
  const game = createPlayerOnlyState();
  for (const id of CUSTOMIZATION_RESEARCH_IDS) {
    assert.deepEqual(researchApplicationLink(id), { href: '#lab-projects', label: 'Use in custom design' });
    const application = getStudioResearchApplication(game, id);
    assert.equal(application.summary, 'Choose in the model designer');
    assert.match(application.detail, /new paid training run earns its effects/);
    assert.match(application.detail, /existing models keep their saved design/);
  }
});

test('paid customization unlocks expose the exact designer action while unfinished methods explain the gate', () => {
  const game = earnResearch(['R3', 'M1']);
  const render = (researchId: string) => renderToStaticMarkup(<StudioCommandReviewProvider value={noAction}>
    <StudioResearchMethod game={game} researchId={researchId} canAct onQueue={noAction} onOpenMethod={noAction} onOpenPanel={noAction} />
  </StudioCommandReviewProvider>);
  assert.match(textOnly(render('M1')), /Available to use/);
  assert.match(render('M1'), />Use in custom design<svg/);
  const locked = textOnly(render('M2'));
  assert.match(locked, /R6 · Retrieval/);
  assert.match(locked, /See how to use it/);
  assert.doesNotMatch(render('M2'), />Use in custom design<svg/);
});
