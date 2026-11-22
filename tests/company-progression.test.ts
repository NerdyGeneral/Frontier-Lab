import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { COMPANY_WORLDS } from '../src/content/company-progression';
import { createInitialState, previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateCompanyProgressionState } from '../src/core/company-progression-validation';
import { canonicalStateHash } from '../src/core/canonical';
import { getAISystemMetrics } from '../src/modules/ai-systems';
import { advanceConnectedChapters, assessConnectedChapter, getCompanyAmbitionView, initializeCompanyProgression } from '../src/modules/company-progression';
import { companyChapterEarnedWeek, getCompanyWorld } from '../src/modules/progression-state';
import { createResearchExperimentTerms, experimentFeeId, getResearchProgramLevel, researchExperimentChecks, researchProgramGate } from '../src/modules/research-programs';
import { NaturalBusinessCampaign, openNaturalBusiness } from './fixtures/wave5-business';

function saved(state: GameState) {
  assert.deepEqual(validateState(state), []);
  const restored = deserializeState(serializeState(state));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(state));
  return restored.state;
}
let freshFixture: GameState | undefined;
function freshBusiness() {
  if (!freshFixture) {
    const lab = openNaturalBusiness('release');
    lab.until(state => companyChapterEarnedWeek(state, 'first-product') !== null, 20, 'automatic paying-service chapter');
    freshFixture = saved(lab.state);
  }
  return new NaturalBusinessCampaign(structuredClone(freshFixture), 'connected-research');
}
function matureBusiness() {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const restored = deserializeState(readFileSync(join(directory, 'connected-037-paid-published.json'), 'utf8'));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  initializeCompanyProgression(restored.state);
  const lab = new NaturalBusinessCampaign(restored.state, 'connected-paid-program');
  lab.step(2);
  assert.notEqual(companyChapterEarnedWeek(lab.state, 'first-product'), null);
  return lab;
}

test('company chapters earn in the background without pinning and keep their permanent research access', () => {
  const lab = freshBusiness();
  assert.equal(lab.state.slices.campaign.chapters, undefined);
  const earned = structuredClone(lab.state.slices.campaign.progression!.chapters['first-product']!.achievement);
  assert.ok(earned && earned.proof[0].billedCents > 0 && earned.proof[0].reportIds.length > 0);
  lab.queue({ kind: 'select_chapter', chapterId: 'efficient-portfolio' }); lab.step();
  lab.queue({ kind: 'select_chapter', chapterId: 'advanced-specialist' }); lab.step();
  assert.deepEqual(lab.state.slices.campaign.progression!.chapters['first-product']!.achievement, earned);
  assert.equal(lab.state.slices.campaign.chapters!.active, 'advanced-specialist');
  saved(lab.state);
});

test('a funded experiment waits for real resources, charges once, and a failing candidate earns no free accreditation', () => {
  const lab = freshBusiness(), modelId = lab.state.slices.products.deployments[lab.offers()[0].deploymentId].modelId;
  const payload = { kind: 'start_research_experiment' as const, programId: 'verified-systems' as const, modelId };
  assert.equal(researchProgramGate(lab.state, payload.programId, modelId), undefined);
  lab.founder('commercial');
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: 0, development: 0 });
  const commandId = lab.queue(payload); lab.step(2);
  const id = 'systems-experiment:' + commandId;
  let experiment = lab.state.slices.campaign.progression!.experiments[id];
  assert.equal(experiment.completedWork, 0);
  assert.ok(experiment.completedStaff <= experiment.terms.requiredStaff, 'Automatic founder work may progress independently; compute still must be paid.');
  assert.equal(experiment.passed, null); assert.equal(getResearchProgramLevel(lab.state, payload.programId), 0);
  assert.equal(lab.state.slices.company.ledger.filter(entry => entry.id === experimentFeeId(id)).length, 1);
  lab.queue({ kind: 'set_cloud_capacity', cu: 8 * U }); lab.step();
  lab.founder('research'); lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: 4 * U, development: 0 });
  lab.until(state => state.slices.campaign.progression!.experiments[id].status === 'complete', 25, 'resource-completed experiment');
  experiment = lab.state.slices.campaign.progression!.experiments[id];
  assert.ok(experiment.physicalWork > 0 && experiment.completedStaff === experiment.terms.requiredStaff);
  assert.equal(experiment.passed, false); assert.equal(getResearchProgramLevel(lab.state, payload.programId), 0);
  assert.equal(previewCommand(lab.state, payload).accepted, false, 'The exact failed candidate cannot be rerolled.');
  saved(lab.state);
  for (const mutate of [
    (state: GameState) => { state.slices.campaign.progression!.experiments[id].passed = true; },
    (state: GameState) => { state.slices.campaign.progression!.experiments[id].grants = []; },
    (state: GameState) => { state.slices.campaign.progression!.experiments[id].terms.feeCents = 0; },
    (state: GameState) => { state.slices.campaign.progression!.experiments[id].baselineReportId = 'rival-atlas-baseline-report'; },
  ]) {
    const bad = structuredClone(lab.state); mutate(bad);
    assert.throws(() => validateCompanyProgressionState(bad, CONTENT));
  }
});

test('an existing paid company earns accreditation through independent work, unlocks a harder stage, and freezes its costs', () => {
  const lab = matureBusiness(), programId = 'efficient-systems' as const;
  const terms = createResearchExperimentTerms(lab.state, programId, 1);
  const model = lab.models().find(candidate => !researchProgramGate(lab.state, programId, candidate.id)
    && researchExperimentChecks(candidate, programId, terms).every(check => check.passed));
  assert.ok(model, 'The authentic paid save contains a measured efficient candidate.');
  lab.founder('research');
  const commandId = lab.queue({ kind: 'start_research_experiment', programId, modelId: model.id });
  lab.step();
  const id = 'systems-experiment:' + commandId, admitted = structuredClone(lab.state.slices.campaign.progression!.experiments[id].terms);
  lab.until(state => state.slices.campaign.progression!.experiments[id].status === 'complete', 20, 'passed paid experiment');
  assert.equal(lab.state.slices.campaign.progression!.experiments[id].passed, true);
  assert.equal(getResearchProgramLevel(lab.state, programId), 0, 'Evidence becomes usable only on its announced next-week boundary.');
  lab.step();
  assert.equal(getResearchProgramLevel(lab.state, programId), 1);
  const next = createResearchExperimentTerms(lab.state, programId, 2);
  assert.ok(next.maximumServingMicroCUw < admitted.maximumServingMicroCUw && next.concurrentSessions > admitted.concurrentSessions);
  assert.deepEqual(lab.state.slices.campaign.progression!.experiments[id].terms, admitted);
  const restored = saved(lab.state);
  assert.equal(getResearchProgramLevel(restored, programId), 1);
  assert.ok(getCompanyAmbitionView(restored).some(ambition => ambition.id === 'efficient-provider' && ambition.criteria.find(criterion => criterion.id === 'program-evidence')!.met));
  lab.until(state => !state.slices.company.ledger.some(entry => entry.id === experimentFeeId(id)), 30, 'ordinary ledger compaction');
  assert.equal(lab.state.slices.company.postedFacts[experimentFeeId(id)], true);
  assert.equal(getResearchProgramLevel(saved(lab.state), programId), 1, 'Accreditation survives ordinary removal of old ledger rows.');
});

test('chapter continuity follows qualifying company outcomes across model changes and alternative efficiency paths', () => {
  const lab = matureBusiness();
  if (!assessConnectedChapter(lab.state, 'efficient-portfolio').proof) {
    const product = lab.offers().find(offer => offer.kind === 'basic-chat')!;
    const model = lab.models().find(candidate => getAISystemMetrics(candidate).servingCUwPer1000 <= 0.2
      && Math.max(...Object.values(candidate.capabilityBps)) >= 5500
      && previewCommand(lab.state, { kind: 'upgrade_product', productId: product.id, modelId: candidate.id }).accepted);
    assert.ok(model, 'The paid archive has an independently evaluated efficient release.');
    lab.queue({ kind: 'upgrade_product', productId: product.id, modelId: model.id });
    lab.until(state => !!assessConnectedChapter(state, 'efficient-portfolio').proof, 12, 'efficient paid service');
  }
  const state = lab.state;
  const assessment = assessConnectedChapter(state, 'efficient-portfolio');
  assert.ok(assessment.proof, 'The paid company has an efficient, profitable service without forcing an Economy policy.');
  const campaign = structuredClone(state.slices.campaign);
  const proof = structuredClone(assessment.proof);
  // An isolated transition check: a preceding qualifying company week may use another model and service.
  // No such edited state is submitted as a valid paid campaign or saved as release evidence.
  campaign.progression!.chapters['efficient-portfolio'] = { progress: [{ ...proof, week: state.week - 2, modelId: 'prior-qualified-release', sourceId: 'prior-qualified-service' },
    { ...proof, week: state.week - 1, modelId: 'prior-qualified-release', sourceId: 'prior-qualified-service' }], achievement: null };
  const view = { ...state, slices: { ...state.slices, campaign } };
  const result = advanceConnectedChapters(campaign, view);
  assert.ok(campaign.progression!.chapters['efficient-portfolio']!.achievement);
  assert.ok(result.some(message => message.message.includes('efficient intelligence')));
  assert.equal(campaign.progression!.chapters['efficient-portfolio']!.progress[2].modelId, proof.modelId);
});

test('visible seed conditions and lasting origin advantages change paid experiment terms without changing old models', () => {
  const worlds = new Set<string>();
  for (let seed = 0; seed < 20; seed++) {
    const state = createInitialState({ ...CONTENT, opening: { ...CONTENT.opening, seed: 'connected-world-' + seed } }, 'release');
    worlds.add(getCompanyWorld(state)!.id);
    assert.equal(getCompanyWorld(state)!.acquisitionBps, 11200);
    assert.ok(Object.hasOwn(COMPANY_WORLDS, getCompanyWorld(state)!.id));
    assert.deepEqual(state.slices.models.versions[CONTENT.seedModel.id].capabilityBps, CONTENT.seedModel.capabilityBps);
    assert.equal(state.slices.models.versions[CONTENT.seedModel.id].reliabilityBps, CONTENT.seedModel.reliabilityBps);
  }
  assert.ok(worlds.size >= 3, 'Seeds produce visible strategic market conditions.');
  const garage = createInitialState(CONTENT, 'release', 'garage'), university = createInitialState(CONTENT, 'release', 'university'), consultancy = createInitialState(CONTENT, 'release', 'consultancy');
  const g = createResearchExperimentTerms(garage, 'efficient-systems', 1), u = createResearchExperimentTerms(university, 'efficient-systems', 1), c = createResearchExperimentTerms(consultancy, 'efficient-systems', 1);
  assert.ok(g.feeCents < u.feeCents && u.feeCents === c.feeCents);
  assert.ok(u.requiredStaff < g.requiredStaff && g.requiredStaff === c.requiredStaff);
  const historicalContent = { ...CONTENT, version: '0.37.0' }, historical = createInitialState(historicalContent, 'classic');
  assert.equal(historical.slices.campaign.progression, undefined);
  assert.equal(previewCommand(historical, { kind: 'start_research_experiment', programId: 'efficient-systems', modelId: CONTENT.seedModel.id }, historicalContent).accepted, false);
});
