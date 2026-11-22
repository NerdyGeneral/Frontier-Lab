import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { AI_SYSTEM_DEFAULTS, AI_SYSTEM_RESEARCH } from '../src/content/ai-systems';
import { CUSTOMER_BRIEFS } from '../src/content/customer-briefs';
import { SPECIALIST_BRIEF_IDS } from '../src/contracts/customer-briefs';
import { canonicalStateHash, createInitialState, getGameView } from '../src/core/index';
import { getModelDesignForBase, getModelDesignForecast, getAISystemForecastModel } from '../src/modules/model-design';
import { getAISystemMetrics } from '../src/modules/ai-systems';
import { getModelChallengeCaseViews } from '../src/modules/model-challenges';
import { getSystemsBriefOffers } from '../src/modules/systems-briefs';
import { ModelDesigner, ModelDesignForecast } from '../src/ui/model-designer';
import { AISystemMetricsView } from '../src/ui/ai-system-designer';
import { applyModelDesignResearch, inheritModelDesignDraft } from '../src/ui/model-design-draft';
import { DevelopmentGoalSummary, DevelopmentWorkspaceHeader } from '../src/ui/development-workspace';
import { developmentGoalResearch } from '../src/ui/development-goals';
import { ModelWorkspaceProvider, type ModelWorkspace } from '../src/ui/model-workspace-context';
import { StudioResearchTree } from '../src/ui/studio-research-tree';
import { CustomerBriefsPanel } from '../src/ui/customer-briefs-panel';
import { getStudioCommandReviewReason } from '../src/ui/studio-command-flow';
import { getStudioManagementReview } from '../src/ui/studio-management-review';

const noAction = () => assert.fail('Rendering cannot schedule work or navigate.');
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const workspace = (): ModelWorkspace => ({ manual: null, delegated: null, blueprints: [], ready: true, epoch: 1, notice: '', persistent: true,
  setDraft: noAction, saveBlueprint: noAction, setDevelopmentGoal: noAction, developmentGoal: { kind: 'system-challenge', id: 'systems-retention-1' } });

test('all operating designs and their locked controls remain visible without spending or changing the lab', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const spec = { ...getModelDesignForBase(CONTENT.seedModel), mode: 'foundation' as const, system: { ...AI_SYSTEM_DEFAULTS.adaptive, verifier: 'independent' as const } };
  const html = renderToStaticMarkup(<ModelDesigner game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]} value={spec} onChange={noAction} canAct showForecast={false} />);
  for (const label of ['Standard model', 'Expert network', 'Persistent-state model', 'Adaptive reasoning', 'Maximum reasoning passes', 'Candidate search', 'Answer checking', 'Stopping rule', 'Independent verification']) assert.ok(plain(html).includes(label), label);
  assert.match(html, /aria-label="AI operating design"/); assert.match(html, /Research needed for these choices/);
  assert.equal(canonicalStateHash(game), before);
});

test('system research opens the intended new foundation and further training preserves the complete paid system', () => {
  const draft = { ...getModelDesignForBase(CONTENT.seedModel), name: 'Chosen name', computeBudgetCUw: 90_000_000_000 };
  const applied = applyModelDesignResearch(draft, 'A12')!;
  assert.equal(applied.mode, 'foundation'); assert.equal(applied.system?.kind, 'adaptive');
  assert.equal(applied.system?.kind === 'adaptive' && applied.system.stopping, 'confidence');
  assert.equal(applied.name, draft.name); assert.equal(applied.computeBudgetCUw, draft.computeBudgetCUw); assert.deepEqual(applied.dataMix, draft.dataMix);
  const game = createInitialState(), model = getAISystemForecastModel(applied, getModelDesignForecast(game, game.playerCompanyId, CONTENT.seedModel.id, [], applied));
  const inherited = inheritModelDesignDraft({ ...draft, system: AI_SYSTEM_DEFAULTS.experts }, model);
  assert.deepEqual(inherited.system, applied.system);
  assert.equal(inheritModelDesignDraft(inherited, CONTENT.seedModel).system, undefined, 'An ordinary parent must not inherit an unrelated system draft.');
  assert.deepEqual(applied.system, model.modelDesign?.system?.spec);
});

test('the AI systems collection shows all twelve discoveries and external prerequisites', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<ModelWorkspaceProvider value={workspace()}><StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} selection={{ intentId: 2, researchId: 'A12' }} /></ModelWorkspaceProvider>);
  assert.match(html, /data-scope="systems"/); assert.match(plain(html), /12 discoveries across three operating designs/);
  for (const method of AI_SYSTEM_RESEARCH) assert.ok(html.includes('aria-label="' + method.id + ': ' + method.name), method.id);
  assert.match(html, /R12A/); assert.match(plain(html), /Case retention/);
  assert.equal(canonicalStateHash(game), before);
  assert.ok(developmentGoalResearch({ kind: 'system-challenge', id: 'systems-memory-1' }).includes('M6'), 'Memory advice includes compact conventional routes.');
});

test('projected goal checks reuse the paid benchmark and never present the projection as earned evidence', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const spec = { ...getModelDesignForBase(CONTENT.seedModel), mode: 'foundation' as const, system: { ...AI_SYSTEM_DEFAULTS.stateful, stateSlots: 256 as const, memory: 'selective' as const, repair: true } };
  const design = getModelDesignForecast(game, game.playerCompanyId, CONTENT.seedModel.id, [], spec);
  const model = getAISystemForecastModel(spec, design, { capabilityBps: { conversation: 6500, documents: 8000, coding: 4500, tools: 6000 }, advancedCapabilities: { reasoning: 6500, longContext: 8000, multimodal: 2000 }, reliabilityBps: 9100 });
  const expected = getModelChallengeCaseViews(model, 'systems-retention-1');
  const html = renderToStaticMarkup(<DevelopmentGoalSummary game={game} goal={{ kind: 'system-challenge', id: 'systems-retention-1' }} model={model} projected />);
  assert.match(plain(html), new RegExp(`${expected.filter(item => item.passed).length} / 6 challenge workloads forecast to pass`));
  for (const check of expected) assert.ok(plain(html).includes(check.requirementText));
  assert.match(plain(html), /Forecast only.*paid test/); assert.equal(canonicalStateHash(game), before);
  const noData = renderToStaticMarkup(<ModelDesignForecast game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]} value={spec} />);
  assert.match(plain(noData), /Operating potential · data needed/); assert.match(plain(noData), /Choose prepared data/);
  const metrics = getAISystemMetrics(model), displayed = renderToStaticMarkup(<AISystemMetricsView metrics={metrics} />);
  assert.match(plain(displayed), new RegExp(metrics.servingCUwPer1000.toLocaleString('en-US', { maximumFractionDigits: 4 }).replace('.', '\\.') + ' CUw'));
});

test('manual and delegated views expose the same remembered objective, with all four customer routes visible while locked', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  for (const mode of ['manual', 'delegated'] as const) {
    const html = renderToStaticMarkup(<ModelWorkspaceProvider value={workspace()}><DevelopmentWorkspaceHeader game={game} mode={mode} canAct onManual={noAction} onDelegate={noAction} /></ModelWorkspaceProvider>);
    assert.match(html, /value="system-challenge:systems-retention-1" selected/); assert.match(plain(html), /Manual Delegated/);
  }
  const html = renderToStaticMarkup(<CustomerBriefsPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />);
  for (const label of ['Expert service desk', 'Local knowledge assistant', 'Case continuity service', 'Verified analysis desk']) assert.ok(html.includes(label));
  assert.match(plain(html), /New offers every 12 weeks/); assert.match(plain(html), /2 consecutive delivery weeks/);
  assert.match(plain(html), /successful pilot earns repeat work/); assert.match(html, /aria-label="Client relationships"/);
  assert.match(html, /data-studio-review="accept_systems_brief"/); assert.equal(canonicalStateHash(game), before);
  const offer = getSystemsBriefOffers(game)[0], payload = { kind: 'accept_systems_brief' as const, offerId: offer.id, modelId: CONTENT.seedModel.id };
  assert.equal(getStudioCommandReviewReason(payload), undefined, 'A visible commission quote does not need a duplicate confirmation.');
  const review = getStudioManagementReview(game, payload);
  assert.ok(review.facts.some(fact => fact.label === 'Customer commission' && fact.value.includes(offer.client)));
});

test('the new content version keeps every existing specialist commission visible after a first sale', () => {
  const game = createInitialState();
  // Presentation fixture: the company has received one cent. No admission or
  // gameplay proof is fabricated by this read-only visibility check.
  game.slices.company.companies[game.playerCompanyId].earnedRevenueCents = 1;
  const before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<CustomerBriefsPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />);
  for (const id of SPECIALIST_BRIEF_IDS) assert.ok(html.includes(CUSTOMER_BRIEFS[id].title), id);
  assert.equal(canonicalStateHash(game), before);
});
