import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESOURCE_SCALE as U, type GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { getStudioView } from '../src/core/studio';
import { selectStudioResults } from '../src/core/studio-results';
import { getStudioDestinationForPanel, resolveStudioHash } from '../src/core/studio-navigation';
import { resolveStudioIntent, STUDIO_TASKS } from '../src/core/studio-tasks';
import type { StudioIntent } from '../src/core/studio-tasks';
import { companyChapterEarnedWeek } from '../src/modules/progression-state';
import { ResearchProgramsWorkspace } from '../src/ui/research-programs-workspace';
import type { ResearchProgramsSelection } from '../src/ui/research-programs-workspace';
import { openNaturalBusiness } from './fixtures/wave5-business';

let cached: { game: GameState; first: string; latest: string } | undefined;
function paidHistory() {
  if (cached) return structuredClone(cached);
  const lab = openNaturalBusiness('release');
  lab.until(state => companyChapterEarnedWeek(state, 'first-product') !== null, 20, 'paying-service chapter');
  lab.autoCapacity = false;
  const modelId = lab.state.slices.products.deployments[lab.offers()[0].deploymentId].modelId;
  lab.queue({ kind: 'set_cloud_capacity', cu: 8 * U }); lab.step(); lab.founder('research');
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: U, development: 0 }); lab.step();
  const finish = (candidateId: string) => {
    const id = 'systems-experiment:' + lab.queue({ kind: 'start_research_experiment', programId: 'verified-systems', modelId: candidateId });
    lab.step(); lab.until(state => state.slices.campaign.progression!.experiments[id].status === 'complete', 30, 'verified experiment'); lab.step();
    assert.equal(lab.state.slices.campaign.progression!.experiments[id].passed, false);
    return id;
  };
  const first = finish(modelId);
  lab.founder('ml'); lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: U, development: 4 * U }); lab.step();
  const nextModel = lab.train({ baseModelId: modelId, packetId: CONTENT.starterData.id, recipeId: 'document-adaptation', profile: 'balanced' });
  lab.founder('research'); lab.evaluate(nextModel, 'basic-conversation-1');
  const latest = finish(nextModel);
  cached = { game: lab.state, first, latest };
  return structuredClone(cached);
}

const shellSource = readFileSync(new URL('../src/ui/studio-shell.tsx', import.meta.url), 'utf8');
const shellTree = ts.createSourceFile('studio-shell.tsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function bindCallback(name: string, closure: Record<string, unknown>): (...args: unknown[]) => unknown {
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(shellTree);
    ts.forEachChild(node, visit);
  };
  visit(shellTree); assert.ok(expression, `Missing production callback ${name}`);
  const js = ts.transpileModule('const callback = ' + expression + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(closure), js + '\nreturn callback;')(...Object.values(closure));
}

test('project and result navigation selects the exact systems program and older paid evidence', () => {
  const { game, first, latest } = paidHistory(), before = canonicalStateHash(game);
  const project = getStudioView(game).projects.find(item => item.id === first)!;
  const result = selectStudioResults(game).find(item => item.sourceId === first)!;
  assert.deepEqual(project.targetIntent, { kind: 'research-experiment', experimentId: first });
  assert.deepEqual(result.action?.target, { kind: 'intent', intent: project.targetIntent });
  let selection: ResearchProgramsSelection | undefined;
  const noAction = () => {};
  const openTask = bindCallback('openTask', {
    game, forceSaveOpen: false, busy: false, inFlight: { current: null }, sections: {}, STUDIO_TASKS,
    getStudioPanelLock: () => null, resolveStudioIntent, getStudioDestinationForPanel,
    setMenusOpen: noAction, setCommandError: noAction, setProgramSelection: (value: ResearchProgramsSelection) => { selection = value; },
    nextIntentId: { current: 1 }, taskSession: { detour: null, tasks: {} }, task: null,
    taskReturnFocusRef: { current: null }, document: { activeElement: null }, HTMLElement: class {},
    dispatchTask: noAction, screen: 'projects', panel: null, projectTab: 'work',
    setPanel: noAction, setScreen: noAction, setNavigationMessage: noAction, setInspectedProjectId: noAction, onPause: noAction,
  });
  openTask('research-program', project.targetIntent);
  assert.equal(selection?.experimentId, first);
  assert.equal(selection?.programType, 'systems');
  const html = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={() => assert.fail('Navigation must not fund work')} selection={selection} />);
  assert.match(html, /<h3>Verified systems<\/h3>/);
  const selectedEvidence = html.match(/<article[^>]*aria-label="Selected experiment evidence"[^>]*>/)?.[0];
  assert.ok(selectedEvidence?.includes(`data-experiment-id="${first}"`));
  assert.ok(!selectedEvidence?.includes(`data-experiment-id="${latest}"`), 'A newer attempt must not replace the requested paid evidence.');
  assert.equal(canonicalStateHash(game), before);

  openTask('architecture-research', { kind: 'task', task: 'architecture-research' });
  assert.equal(selection?.programType, 'architecture');
  assert.equal(selection?.experimentId, undefined);
  const architecture = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={noAction} selection={selection} />);
  assert.match(architecture, /aria-pressed="true" aria-controls="[^"]+-architecture"/);
});

test('decision-stop links preserve explicit research targets in Studio and Classic', () => {
  const { game, first } = paidHistory();
  class ClickedElement {
    constructor(readonly hash: string) {}
    closest() { return { getAttribute: () => this.hash }; }
  }
  for (const mode of ['studio', 'classic']) {
    const calls: Array<{ task: string; intent: StudioIntent }> = [];
    const openNavigationIntent = bindCallback('openNavigationIntent', {
      game, busy: false, forceSaveOpen: false, task: null, inFlight: { current: null }, resolveStudioIntent,
      openResultTask: (task: string, intent: StudioIntent) => calls.push({ task, intent }),
      showUnavailableTarget: () => assert.fail('Owned experiment is available'),
    });
    const followLink = bindCallback('followLink', { mode, Element: ClickedElement, resolveStudioHash, openNavigationIntent });
    for (const hash of ['#research-experiment/' + encodeURIComponent(first), '#architecture-research']) {
      let prevented = false;
      followLink({ target: new ClickedElement(hash), preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true);
    }
    assert.deepEqual(calls, [
      { task: 'research-program', intent: { kind: 'research-experiment', experimentId: first } },
      { task: 'architecture-research', intent: { kind: 'task', task: 'architecture-research' } },
    ]);
  }
});

test('missing, foreign and invalid-program research links show unavailable without substituting evidence', () => {
  const { game, first } = paidHistory();
  for (const variant of ['missing', 'foreign', 'program'] as const) {
    const changed = structuredClone(game);
    if (variant === 'missing') delete changed.slices.campaign.progression!.experiments[first];
    else if (variant === 'foreign') changed.slices.campaign.progression!.experiments[first].companyId = 'another-company';
    else Object.assign(changed.slices.campaign.progression!.experiments[first], { programId: 'missing-program' });
    assert.equal(resolveStudioIntent(changed, { kind: 'research-experiment', experimentId: first }).ok, false);
    const html = renderToStaticMarkup(<ResearchProgramsWorkspace game={changed} canAct onQueue={() => assert.fail('Unavailable navigation must not schedule work')} selection={{ intentId: 9, programType: 'systems', experimentId: first }} />);
    assert.match(html, /This research experiment is unavailable/);
    assert.doesNotMatch(html, /(?:Selected|Latest) paid evidence|Fund experiment/);
  }
});
