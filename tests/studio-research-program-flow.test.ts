import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { DEFAULT_DECISION_CLOCK_POLICY, nextDecisionStop } from '../src/core/decision-clock';
import { getStudioView } from '../src/core/studio';
import { selectStudioResults } from '../src/core/studio-results';
import { getStudioWorkQueue } from '../src/core/studio-work-queue';
import { resolveStudioHash } from '../src/core/studio-navigation';
import { resolveStudioIntent } from '../src/core/studio-tasks';
import { initializeCompanyProgression } from '../src/modules/company-progression';
import { companyChapterEarnedWeek } from '../src/modules/progression-state';
import { createResearchExperimentTerms, researchExperimentChecks, researchProgramGate } from '../src/modules/research-programs';
import { NaturalBusinessCampaign, openNaturalBusiness } from './fixtures/wave5-business';
import { fixtureState } from './fixtures/wave25-studio';

const researchPolicy = { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: 0, maxWeeks: 100,
  projects: false, deadlines: false, opportunities: false, service: false };
const programTarget = (experimentId: string) => ({ kind: 'intent', intent: { kind: 'research-experiment', experimentId } });

test('paid systems work stays visible while blocked, progressing and awaiting evidence, then produces one exact result', () => {
  const lab = openNaturalBusiness('release');
  lab.until(state => companyChapterEarnedWeek(state, 'first-product') !== null, 20, 'paying-service chapter');
  lab.autoCapacity = false;
  const modelId = lab.state.slices.products.deployments[lab.offers()[0].deploymentId].modelId;
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: 0, development: 0 });
  const commandId = lab.queue({ kind: 'start_research_experiment', programId: 'verified-systems', modelId });
  const id = 'systems-experiment:' + commandId;
  lab.step(2);
  const card = () => getStudioView(lab.state).projects.find(project => project.id === id)!;
  assert.equal(card().status, 'blocked');
  assert.match(card().bottleneck, /research compute/);
  assert.equal(card().progressBps, 0);
  assert.deepEqual([card().targetPanel, card().targetTask], ['research-programs', 'research-program']);
  assert.deepEqual(card().targetIntent, programTarget(id).intent);
  assert.match(card().title, /Verified systems · Pilot/);
  assert.ok(card().detail.includes(lab.state.slices.models.versions[modelId].name));
  assert.equal(getStudioWorkQueue(lab.state, getStudioView(lab.state).projects).individualProjects.filter(project => project.id === id).length, 1);
  assert.equal(selectStudioResults(lab.state).some(result => result.sourceId === id), false);

  lab.queue({ kind: 'set_cloud_capacity', cu: 8 * U }); lab.step();
  lab.founder('research');
  lab.queue({ kind: 'allocate_compute', serving: 2 * U, research: U, development: 0 }); lab.step();
  assert.equal(card().status, 'working');
  assert.ok(card().progressBps > 0 && card().progressBps < 10000);
  assert.equal(card().bottleneck, '');
  let beforeCompletion = lab.state;
  for (let weeks = 0; weeks < 20 && lab.state.slices.campaign.progression!.experiments[id].status !== 'complete'; weeks++) {
    beforeCompletion = lab.state; lab.step();
  }
  const experiment = lab.state.slices.campaign.progression!.experiments[id];
  assert.equal(experiment.status, 'complete'); assert.equal(experiment.passed, false);
  assert.equal(card().status, 'waiting'); assert.equal(card().progressBps, 10000);
  assert.match(card().detail, new RegExp('evidence available in Week ' + experiment.availableWeek));
  assert.equal(card().bottleneck, '', 'Finished evidence is not an unresolved resource block.');
  assert.equal(selectStudioResults(lab.state).some(result => result.sourceId === id), false);
  assert.equal(nextDecisionStop(beforeCompletion, lab.state, researchPolicy, beforeCompletion.week), null, 'The next-week evidence boundary remains authoritative.');

  const beforeAvailable = lab.state; lab.step();
  const stop = nextDecisionStop(beforeAvailable, lab.state, researchPolicy, beforeAvailable.week);
  assert.equal(stop?.target, '#research-experiment/' + encodeURIComponent(id));
  assert.deepEqual(resolveStudioHash(stop!.target)?.intent, programTarget(id).intent);
  const hash = canonicalStateHash(lab.state);
  assert.equal(card().status, 'complete'); assert.match(card().detail, /Constraints unmet/);
  const results = selectStudioResults(lab.state).filter(result => result.sourceId === id);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'research'); assert.equal(results[0].week, experiment.availableWeek);
  assert.match(results[0].title, /constraints unmet/);
  assert.ok(results[0].summary.includes(lab.state.slices.models.versions[modelId].name));
  assert.deepEqual(results[0].action?.target, programTarget(id));
  assert.deepEqual(resolveStudioIntent(lab.state, { kind: 'research-experiment', experimentId: id }), {
    ok: true, panel: 'research-programs', task: 'research-program', target: { kind: 'research-experiment', experimentId: id, programId: 'verified-systems' },
  });
  assert.equal(canonicalStateHash(lab.state), hash, 'Project and result selectors only read the paid record.');

  const foreign = structuredClone(lab.state);
  foreign.slices.campaign.progression!.experiments[id].companyId = 'another-company';
  assert.equal(getStudioView(foreign).projects.some(project => project.id === id), false);
  assert.equal(selectStudioResults(foreign).some(result => result.sourceId === id), false);
  assert.equal(resolveStudioIntent(foreign, { kind: 'research-experiment', experimentId: id }).ok, false);
  assert.equal(resolveStudioIntent(lab.state, { kind: 'research-experiment', experimentId: 'missing' }).ok, false);
});

test('passed systems work records accreditation at its real availability date and opens the existing Programs task', () => {
  const game = fixtureState('connected-037-paid-published.json');
  initializeCompanyProgression(game);
  const lab = new NaturalBusinessCampaign(game, 'studio-program-evidence'); lab.step(2);
  const programId = 'efficient-systems' as const, terms = createResearchExperimentTerms(lab.state, programId, 1);
  const model = lab.models().find(candidate => !researchProgramGate(lab.state, programId, candidate.id)
    && researchExperimentChecks(candidate, programId, terms).every(check => check.passed));
  assert.ok(model);
  lab.founder('research');
  const id = 'systems-experiment:' + lab.queue({ kind: 'start_research_experiment', programId, modelId: model.id });
  lab.step();
  lab.until(state => state.slices.campaign.progression!.experiments[id].status === 'complete', 20, 'passed paid experiment');
  assert.equal(lab.state.slices.campaign.progression!.experiments[id].passed, true);
  assert.equal(selectStudioResults(lab.state).some(result => result.sourceId === id), false);
  lab.step();
  const result = selectStudioResults(lab.state).find(result => result.sourceId === id)!;
  assert.equal(result.title, 'Systems research accreditation earned');
  assert.equal(result.week, lab.state.slices.campaign.progression!.experiments[id].availableWeek);
  assert.deepEqual(result.action?.target, programTarget(id));
  assert.match(getStudioView(lab.state).projects.find(project => project.id === id)!.detail, /Passed · accreditation earned/);
  lab.step();
  assert.deepEqual(selectStudioResults(lab.state).find(item => item.sourceId === id), result, 'Later weeks do not redraft historical evidence.');
});
