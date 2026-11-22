import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../src/content/wave29';
import { SYNTHETIC_RULES as RULES } from '../src/content/wave26-synthetic';
import { createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { assertCommandShape } from '../src/core/command-shape';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getStudioView } from '../src/core/studio';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { getSyntheticView, previewSyntheticGeneration, syntheticWorkId } from '../src/modules/synthetic-data';
import { paidSyntheticTeacherReport, syntheticRights, syntheticSourceReason, syntheticTeacherReason } from '../src/modules/synthetic-evidence';
import { buildTrainingPlan, expectedTrainingOutcome, getCorpusEvidence, getTrainingPreview } from '../src/modules/lab-planner';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { getAvailableRoleCapacity } from '../src/modules/workforce';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { getSyntheticFixture, getSyntheticReadyFixture } from './fixtures/wave26-synthetic';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL_023 = 'frontier-lab.content023.original';
const FIXTURES = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  writes: string[] = [];
  failWriteKey: string | null = null;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWriteKey === key) throw new Error('Quota exceeded');
    this.writes.push(key); this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  seed(key: string, value: string) { this.values.set(key, value); }
}
function inBrowser(storage: MemoryStorage, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
function invalidSnapshot(state: GameState, label: string) {
  assert.ok(validateState(state).length, label);
  assert.equal(deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
    contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state })).ok, false, label + ' with a correct checksum');
}
function restored(state: GameState) {
  const result = deserializeState(serializeState(state)); if (!result.ok) throw new Error(result.error);
  assert.equal(canonicalStateHash(result.state), canonicalStateHash(state)); return result.state;
}

test('W26-S01: old companies migrate with synthetic support without grants, clock changes or new synthetic records', () => {
  assert.equal(CONTENT.research.length, 54);
  assert.deepEqual(CONTENT.research.filter(item => ['S1', 'S2'].includes(item.id)).map(item => ({ id: item.id, requires: item.requires, fee: item.feeCents, role: item.role, staff: item.staffWeeks, work: item.workCUw })), [
    { id: 'S1', requires: ['R2A', 'R10A'], fee: 600000, role: 'data', staff: 3, work: 6000000000 },
    { id: 'S2', requires: ['S1', 'R4C'], fee: 900000, role: 'ml', staff: 5, work: 12000000000 },
  ]);
  for (const file of ['wave0-snapshot.json', 'wave1-inflight-snapshot.json', 'wave16-snapshot.json', 'wave24-browser.json']) {
    const raw = readFileSync(join(FIXTURES, file), 'utf8'), original = JSON.parse(raw).state;
    const result = deserializeState(raw); if (!result.ok) throw new Error(`${file}: ${result.error}`);
    assert.equal(result.state.contentVersion, CONTENT.version);
    assert.equal(result.state.week, original.week);
    assert.equal(result.state.slices.company.companies[result.state.playerCompanyId].cashCents, original.slices.company.companies[original.playerCompanyId].cashCents);
    assert.equal(result.state.slices.data.syntheticJobs, undefined);
    if (original.contentVersion === '0.23.0') {
      const normalized = structuredClone(result.state);
      normalized.contentVersion = original.contentVersion; normalized.buildVersion = original.buildVersion;
      assert.deepEqual(normalized, { ...original, slices: { ...original.slices, markets: { ...original.slices.markets, opportunityCalendar: { startedWeek: original.week, sequenceVersion: 2 as const } } } },
        'Every existing slice and queued command survives; the announced market calendar starts at the saved week.');
      assert.equal(result.migratedFrom, 24);
    }
    assert.equal(getSyntheticView(result.state).jobs.length, 0);
    assert.deepEqual(validateState(result.state), []);
    const restored = deserializeState(serializeState(result.state)); if (!restored.ok) throw new Error(restored.error);
    assert.equal(canonicalStateHash(restored.state), canonicalStateHash(result.state));
  }
  assert.equal(getSyntheticView(createInitialState()).canGenerate, false);
  assert.equal(RULES.candidateUnits, 100);
});

test('W26-S02: the first content upgrade exposes untouched original bytes and never overwrites on archive failure', () => {
  const original = readFileSync(join(FIXTURES, 'wave24-browser.json'), 'utf8') + '\n';
  const storage = new MemoryStorage(); storage.seed(PRIMARY, original);
  inBrowser(storage, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected a migrated 0.23 company.');
    assert.equal(loaded.migratedFrom, 24); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_023, PRIMARY]);
    assert.deepEqual(readBrowserRecovery('content023'), { text: original, filename: 'frontier-lab-content023-original.json' });
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['content023']);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL_023), original);
    assert.deepEqual(storage.writes, [ORIGINAL_023, PRIMARY, PRIMARY]);
  });
  const blocked = new MemoryStorage(); blocked.seed(PRIMARY, original); blocked.failWriteKey = ORIGINAL_023;
  inBrowser(blocked, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected a migrated 0.23 company.');
    assert.equal(writeBrowserSnapshot(loaded.state).ok, false);
    assert.equal(blocked.getItem(PRIMARY), original); assert.equal(blocked.getItem(ORIGINAL_023), null);
    assert.deepEqual(blocked.writes, []);
    assert.equal(readBrowserRecovery('stored')?.text, original);
  });
});

test('W26-S03: paid method, teacher qualification, licensed sources and pure previews control generation admission', () => {
  const fixture = getSyntheticReadyFixture(), state = fixture.state, owner = state.playerCompanyId;
  const options = { teacherModelId: fixture.teacherModelId, sourcePacketId: fixture.sourcePacketId, domain: fixture.domain };
  const payload: CommandPayload = { kind: 'start_synthetic_generation', ...options };
  assert.equal(previewCommand(createInitialState(), payload).accepted, false);
  assert.ok(previewCommand(state, payload).accepted);
  const original = canonicalStateHash(state), preview = previewSyntheticGeneration(state, options);
  assert.ok(preview.accepted, preview.reason ?? ''); assert.equal(preview.candidateUnits, 100);
  assert.equal(preview.generationFeeCents, 150000); assert.equal(preview.reviewFeeCents, 50000);
  assert.equal(preview.memoryMU, state.slices.models.versions[options.teacherModelId].residentMU);
  assert.equal(getSyntheticView(state).canGenerate, true); assert.equal(getSyntheticView(state).canTrain, true);
  for (let i = 0; i < 3; i++) { getSyntheticView(state); previewSyntheticGeneration(state, options); }
  assert.equal(canonicalStateHash(state), original);
  const reportId = paidSyntheticTeacherReport(state, options.teacherModelId)!.id;
  const cases: Array<[string, (changed: GameState) => void]> = [
    ['unearned S1', value => { value.slices.research.completedByCompany[owner] = value.slices.research.completedByCompany[owner].filter(id => id !== 'S1'); }],
    ['foreign teacher', value => { value.slices.models.versions[options.teacherModelId].companyId = 'foreign'; }],
    ['no paid capability report', value => { delete value.slices.models.reports[reportId]; }],
    ['scenario evidence', value => { value.slices.models.reports[reportId].scenarioStart = true; }],
    ['weak target', value => { value.slices.models.versions[options.teacherModelId].capabilityBps.documents = 5999; }],
    ['unreliable teacher', value => { value.slices.models.versions[options.teacherModelId].reliabilityBps = 5999; }],
    ['teacher lacks inherited transfer rights', value => { const teacher = value.slices.models.versions[options.teacherModelId]; value.slices.models.trainingRuns[teacher.trainingRunId!].plan!.corpus.rights.weights = false; }],
    ['foreign source', value => { value.slices.data.packets[options.sourcePacketId].companyId = 'foreign'; }],
    ['unprepared source', value => { value.slices.data.packets[options.sourcePacketId].prepared = false; }],
    ['insufficient source', value => { value.slices.data.packets[options.sourcePacketId].readyUnits = 99; }],
    ['low quality cannot enter an empty audit dead end', value => { value.slices.data.packets[options.sourcePacketId].qualityBps = 5999; }],
    ['unlicensed source', value => { value.slices.data.packets[options.sourcePacketId].rights.hosted = false; }],
    ['missing original identities', value => { value.slices.data.packets[options.sourcePacketId].sourceIds = []; }],
    ['reserved source', value => { value.slices.data.packets[options.sourcePacketId].sourceIds = ['independent-holdouts-1:reserved-case-01']; }],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(state); mutate(changed);
    assert.equal(previewSyntheticGeneration(changed, options).accepted, false, label);
  }
  const constrained = structuredClone(state); constrained.slices.data.packets[options.sourcePacketId].rights.weights = false;
  assert.deepEqual(syntheticRights(constrained, options), { hosted: true, weights: false, feedback: false });
  const missingQueued = structuredClone(state);
  missingQueued.queuedCommands.push({ id: 'missing-source-command', companyId: owner, issuedForWeek: state.week + 1,
    payload: { ...payload, sourcePacketId: 'missing-source' } });
  assert.doesNotThrow(() => previewSyntheticGeneration(missingQueued, options));
  for (const malformed of [ { ...payload, domain: 'unknown' }, { ...payload, teacherModelId: '__proto__' }, { ...payload, free: true },
    { kind: 'start_synthetic_review', jobId: 'job', acceptedUnits: 100 }, { kind: 'set_synthetic_job_paused', jobId: 'job', paused: 1 } ])
    assert.throws(() => assertCommandShape(malformed as CommandPayload));
});

test('W26-S04: an ordinary paid company generates, reviews, quarantines, trains and independently evaluates a distinct candidate', () => {
  const f = getSyntheticFixture(), before = f.beforeGeneration, accepted = f.accepted, owner = before.playerCompanyId;
  const generated = f.generated.slices.data.syntheticJobs![f.jobId], job = accepted.slices.data.syntheticJobs![f.jobId];
  assert.equal(before.slices.data.syntheticJobs?.[f.jobId], undefined);
  assert.equal(generated.phase, 'awaiting-review'); assert.equal(f.generated.slices.data.packets[f.packetId], undefined);
  assert.equal(Object.keys(f.generated.slices.models.reports).length, Object.keys(before.slices.models.reports).length);
  assert.equal(getStudioView(f.generated, CONTENT).projects.find(item => item.id === f.jobId)?.status, 'waiting');
  assert.equal(job.phase, 'complete'); assert.equal(job.availableWeek, job.completedWeek! + 1);
  assert.ok(job.reviewStartedWeek! > job.generatedWeek!); assert.ok(job.auditCompute.latestGrant!.week > job.review.latestGrant!.week);
  assert.equal(job.generation.completedWork, job.generation.requiredWork); assert.ok(job.generation.physicalWork > 0);
  assert.equal(job.review.completedStaff, 2 * U); assert.equal(job.auditStaff.completedStaff, U); assert.equal(job.auditCompute.completedWork, 2 * U);
  assert.ok(job.generationStaffGranted > 0); assert.ok(job.generationStaffGranted * 16 >= job.generation.completedWork);
  const audit = job.audit!, packet = accepted.slices.data.packets[f.packetId];
  assert.equal(audit.acceptedUnits + audit.sourceOverlapUnits + audit.holdoutOverlapUnits + audit.qualityRejectedUnits, 100);
  assert.equal(audit.acceptedUnits, Math.floor(70 * Math.min(job.teacherScoreBps, job.teacherReliabilityBps, job.sourceQualityBps) / 10000));
  assert.ok(audit.acceptedUnits >= 40 && audit.acceptedUnits < 100);
  assert.equal(new Set(audit.acceptedCaseIds).size, audit.acceptedUnits);
  assert.ok(audit.acceptedCaseIds.every(id => !audit.quarantinedCaseIds.includes(id)));
  assert.equal(packet.readyUnits, audit.acceptedUnits); assert.equal(packet.rawUnits, audit.acceptedUnits);
  assert.deepEqual(packet.rights, syntheticRights(accepted, job)); assert.equal(packet.rights.feedback, false);
  assert.deepEqual(packet.synthetic?.sourceIds, job.sourceIds); assert.equal(packet.sourceIds?.length, 1);
  const corpus = getCorpusEvidence(accepted, owner, [packet.id, packet.id]);
  assert.equal(corpus.distinctUnits, packet.readyUnits);
  const project = getStudioView(accepted, CONTENT).projects.find(item => item.id === f.jobId)!;
  assert.equal(project.status, 'complete'); assert.equal(project.targetPanel, 'synthetic-data'); assert.equal(project.progressBps, 10000);
  const admissionId = job.id.slice('synthetic-job:'.length);
  assert.ok(accepted.slices.company.postedFacts[`synthetic-fee:${admissionId}`]);
  assert.ok(accepted.slices.company.postedFacts[`synthetic-fee:${job.reviewCommandId}`]);
  const trained = f.trained.slices.models.trainingRuns[f.trainingRunId], model = f.trained.slices.models.versions[f.modelId];
  assert.equal(trained.recipeId, RULES.recipeId); assert.equal(trained.plan!.kind, 'synthetic');
  assert.equal(trained.requiredWork, 12 * U); assert.equal(trained.completedWork, trained.requiredWork); assert.ok(trained.physicalWork > 0);
  assert.ok(f.trained.slices.company.postedFacts[trained.id + ':setup']);
  assert.equal(trained.evidence.synthetic, undefined); assert.equal(trained.plan!.synthetic!.auditFingerprint, audit.fingerprint);
  const expected = expectedTrainingOutcome(trained, trained.requiredWork);
  assert.deepEqual(model.capabilityBps, expected.capabilityBps); assert.equal(model.reliabilityBps, expected.reliabilityBps);
  const base = f.trained.slices.models.versions[trained.baseModelId];
  assert.ok(model.capabilityBps.documents > base.capabilityBps.documents);
  assert.ok(model.capabilityBps.documents <= job.teacherScoreBps - RULES.teacherMarginBps);
  assert.ok(model.capabilityBps.documents <= base.capabilityBps.documents + RULES.maximumTargetGainBps);
  for (const domain of ['conversation', 'coding', 'tools'] as const) assert.equal(model.capabilityBps[domain], base.capabilityBps[domain]);
  assert.equal(model.reliabilityBps, base.reliabilityBps);
  assert.equal(Object.values(f.trained.slices.models.reports).some(report => report.modelId === model.id), false);
  assert.equal(previewCommand(f.trained, { kind: 'evaluate_model', modelId: model.id, suiteId: 'independent-holdouts-1' }).accepted, false, 'The data audit is not a paid capability baseline.');
  const capability = f.evaluated.slices.models.reports[f.capabilityReportId], independent = f.evaluated.slices.models.reports[f.independentReportId];
  assert.equal(capability.modelId, model.id); assert.equal(capability.suiteId, 'expanded-capabilities-1');
  assert.equal(independent.modelId, model.id); assert.equal(independent.suiteId, 'independent-holdouts-1');
  assert.equal(independent.holdout?.baselineReportId, capability.id);
  assert.ok(independent.cases.length > 0 && independent.cases.every(item => !audit.acceptedCaseIds.includes(item.id) && !packet.sourceIds!.includes(item.id)));
  for (const report of [capability, independent]) {
    const paid = Object.values(f.evaluated.slices.models.evaluationRuns).find(run => run.reportId === report.id)!;
    assert.equal(paid.status, 'complete'); assert.equal(paid.completedWork, paid.requiredWork); assert.ok(paid.requiredWork > 0);
    assert.equal(paid.completedStaff, paid.requiredStaff); assert.ok(paid.requiredStaff > 0);
  }
  assert.deepEqual(f.evaluated.slices.models.versions[model.id].capabilityBps, model.capabilityBps);
  assert.equal(f.evaluated.slices.models.versions[model.id].reliabilityBps, model.reliabilityBps);
  assert.deepEqual(inheritedModelRights(f.evaluated, model.id, CONTENT), { hosted: packet.rights.hosted, weights: packet.rights.weights });
  for (const state of [f.generating, f.generated, f.reviewing, accepted, f.training, f.trained, f.evaluated]) {
    assert.deepEqual(validateState(state), []); restored(state);
    assert.equal(state.slices.company.companies[owner].arrearsCents, 0);
  }
});

test('W26-S05: alternate teachers, curated aliases and partially overlapping source sets cannot mint a second target slice', () => {
  const f = getSyntheticFixture(), state = f.accepted;
  const options = { teacherModelId: f.teacherModelId, sourcePacketId: f.sourcePacketId, domain: f.domain };
  assert.equal(previewSyntheticGeneration(state, options).accepted, false);
  const alias = structuredClone(state), original = alias.slices.data.packets[f.sourcePacketId], id = 'curated-source-alias';
  alias.slices.data.packets[id] = { ...structuredClone(original), id, name: 'Curated source alias', revision: original.revision! + 1, qualityBps: 9500 };
  assert.equal(previewSyntheticGeneration(alias, { ...options, sourcePacketId: id }).accepted, false);
  alias.slices.data.packets[id].sourceIds!.push('additional-independent-source');
  assert.equal(previewSyntheticGeneration(alias, { ...options, sourcePacketId: id }).accepted, false, 'Partial source intersection still consumes the original source once.');
  const other = getSyntheticView(state).teachers.find(teacher => teacher.id !== f.teacherModelId && teacher.eligibleDomains.includes(f.domain));
  if (other) assert.equal(previewSyntheticGeneration(state, { ...options, teacherModelId: other.id }).accepted, false);
  const queued = submitCommand(f.beforeGeneration, { kind: 'start_synthetic_generation', ...options }, CONTENT, 'wave26-first-overlap');
  assert.ok(queued.accepted, queued.reason?.message);
  assert.equal(previewSyntheticGeneration(queued.state, options).accepted, false);
  const freshIds = canonicalStateHash({ job: state.slices.data.syntheticJobs![f.jobId], packet: state.slices.data.packets[f.packetId] });
  for (let i = 0; i < 3; i++) getSyntheticView(state);
  assert.equal(canonicalStateHash({ job: state.slices.data.syntheticJobs![f.jobId], packet: state.slices.data.packets[f.packetId] }), freshIds);
});

test('W26-S06: generation needs actual ML and connected compute grants, and paid progress resumes exactly after pause and reload', () => {
  const f = getSyntheticReadyFixture(), run = new NaturalBusinessCampaign(f.state, 'w26-resource-proof');
  // Every profession at this inherited company supplies some Design points.
  const employees = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  assert.ok(employees.length > 0);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('commercial');
  // Keep a serving budget the rented fleet can support while its rack operators are offline.
  const serving = Math.min(run.fleet.allocation.serving, run.fleet.cloudCU - 8 * U);
  run.queue({ kind: 'allocate_compute', serving, development: 8 * U, research: 0 });
  const jobId = 'synthetic-job:' + run.queue({ kind: 'start_synthetic_generation', teacherModelId: f.teacherModelId, sourcePacketId: f.sourcePacketId, domain: f.domain });
  run.step(); const current = () => run.state.slices.data.syntheticJobs![jobId];
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'ml'), 0);
  assert.equal(current().generation.completedWork, 0); assert.equal(current().generation.physicalWork, 0);
  assert.equal(getStudioView(run.state, CONTENT).projects.find(item => item.id === jobId)?.status, 'blocked');
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 }); run.step();
  assert.equal(current().generation.completedWork, 0);
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: U }); run.step();
  assert.ok(current().generation.completedWork > 0 && current().generation.completedWork < current().generation.requiredWork);
  const paid = current().generation.completedWork, physical = current().generation.physicalWork;
  const grant = run.fleet.lastGrants.find(item => item.requestId === syntheticWorkId(jobId, 'generation'))!;
  assert.equal(grant.grantedWork, current().generation.latestGrant!.effectiveCUw);
  run.queue({ kind: 'set_synthetic_job_paused', jobId, paused: true }); run.step(2);
  assert.equal(current().generation.completedWork, paid); assert.equal(current().generation.physicalWork, physical);
  const uninterrupted = new NaturalBusinessCampaign(structuredClone(run.state), 'w26-resume');
  const reloaded = new NaturalBusinessCampaign(restored(run.state), 'w26-resume');
  for (const scenario of [uninterrupted, reloaded]) {
    scenario.queue({ kind: 'set_synthetic_job_paused', jobId, paused: false });
    scenario.queue({ kind: 'allocate_compute', ...scenario.fleet.allocation, development: 8 * U });
    scenario.until(state => state.slices.data.syntheticJobs![jobId].phase === 'awaiting-review', 12, 'resumed paid teacher generation');
  }
  assert.equal(canonicalStateHash(reloaded.state), canonicalStateHash(uninterrupted.state));
  assert.equal(reloaded.state.slices.data.packets[current().outputPacketId], undefined);
});

test('W26-S07: review and audit are separate paid stages that cannot finish from elapsed time or a single resource alone', () => {
  const f = getSyntheticFixture(), run = new NaturalBusinessCampaign(f.generated, 'w26-review-proof');
  const employees = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('commercial');
  const serving = Math.min(run.fleet.allocation.serving, run.fleet.cloudCU - 8 * U);
  run.queue({ kind: 'allocate_compute', serving, development: 8 * U, research: 0 });
  const review = run.queue({ kind: 'start_synthetic_review', jobId: f.jobId }); run.step(2);
  const current = () => run.state.slices.data.syntheticJobs![f.jobId];
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'data'), 0);
  assert.equal(current().phase, 'reviewing'); assert.equal(current().review.completedStaff, 0);
  assert.equal(current().auditCompute.completedWork, 0); assert.equal(current().audit, null);
  assert.equal(previewCommand(run.state, { kind: 'start_synthetic_review', jobId: f.jobId }).accepted, false);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.founder('data');
  run.until(() => current().phase === 'auditing', 5, 'two paid data staff-weeks');
  // Stop the multi-role employee supply before the first audit reservation.
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.step();
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'research'), 0);
  assert.equal(current().auditCompute.completedWork, RULES.auditWork); assert.equal(current().auditStaff.completedStaff, 0);
  assert.equal(current().audit, null); assert.equal(run.state.slices.data.packets[f.packetId], undefined);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.founder('research');
  run.step(); assert.equal(current().phase, 'ready'); assert.ok(current().audit); assert.equal(run.state.slices.data.packets[f.packetId], undefined);
  run.step(); assert.equal(current().phase, 'complete'); assert.ok(run.state.slices.data.packets[f.packetId]);
  assert.equal(current().reviewCommandId, review); assert.deepEqual(validateState(run.state), []);
});

test('W26-S08: only a separate student may use audited evidence through S2, without ordinary-recipe or recursive shortcuts', () => {
  const f = getSyntheticFixture(), state = f.accepted;
  const payload = { kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: f.packetId, recipeId: RULES.recipeId };
  assert.ok(previewCommand(state, payload).accepted);
  const plan = buildTrainingPlan(state, state.playerCompanyId, payload), preview = getTrainingPreview(state, state.playerCompanyId, payload);
  assert.equal(preview.feeCents, 100000); assert.equal(preview.workCUw, 12 * U); assert.ok(!preview.reason);
  assert.equal(plan.plan.synthetic!.teacherModelId, f.teacherModelId);
  const missingS2 = structuredClone(state);
  missingS2.slices.research.completedByCompany[state.playerCompanyId] = missingS2.slices.research.completedByCompany[state.playerCompanyId].filter(id => id !== 'S2');
  assert.equal(previewCommand(missingS2, payload).accepted, false);
  for (const changed of [{ ...payload, baseModelId: f.teacherModelId }, { ...payload, recipeId: 'compact-document-adaptation' },
    { ...payload, packetIds: [f.packetId, f.sourcePacketId] }, { ...payload, profile: 'ambitious' }, { ...payload, asAdapter: true },
    { ...payload, automatedCheckpoints: true }, { ...payload, recipeId: 'compact-conversation-adaptation', packetId: f.sourcePacketId,
      replay: { domain: 'documents', shareBps: 5000, packetIds: [f.packetId] } },
    { ...payload, recipeId: 'compact-conversation-adaptation', packetId: f.sourcePacketId,
      curriculum: { shareBps: 5000, tracks: [{ domain: 'documents', packetIds: [f.packetId] }, { domain: 'coding', packetIds: [f.sourcePacketId] }] } },
  ]) assert.equal(previewCommand(state, changed as CommandPayload).accepted, false);
  for (const kind of ['prepare_data', 'curate_data', 'deduplicate_data'] as const)
    assert.equal(previewCommand(state, { kind, packetId: f.packetId }).accepted, false);
  assert.ok(syntheticSourceReason(state, state.playerCompanyId, f.packetId));
  const recursiveSource = structuredClone(state); recursiveSource.slices.data.packets[f.packetId].readyUnits = RULES.minimumSourceUnits;
  assert.match(syntheticSourceReason(recursiveSource, state.playerCompanyId, f.packetId)!, /Synthetic/);
  assert.equal(previewCommand(f.trained, payload).accepted, false);
  assert.equal(previewCommand(f.trained, { ...payload, baseModelId: f.modelId }).accepted, false);
  assert.match(syntheticTeacherReason(f.evaluated, state.playerCompanyId, f.modelId, f.domain)!, /synthetic|reliability/i);
  const inherited = structuredClone(state), teacherChild = inherited.slices.models.versions[CONTENT.seedModel.id];
  teacherChild.parentModelId = f.teacherModelId;
  assert.equal(previewCommand(inherited, payload).accepted, false, 'Teacher descendants cannot teach themselves through a different model ID.');
});

test('W26-S09: correctly checksummed imports cannot forge paid work, audit acceptance, source provenance or synthetic targets', () => {
  const f = getSyntheticFixture();
  const activeCases: Array<[string, (state: GameState) => void]> = [
    ['unknown domain and missing score', state => { const job = state.slices.data.syntheticJobs![f.jobId]; (job as unknown as { domain: string }).domain = 'unknown'; Reflect.deleteProperty(job, 'teacherScoreBps'); }],
    ['unpaid generation', state => { delete state.slices.company.postedFacts['synthetic-fee:' + f.jobId.slice('synthetic-job:'.length)]; }],
    ['invented effective work', state => { state.slices.data.syntheticJobs![f.jobId].generation.completedWork++; }],
    ['unpaid ML supervision', state => { state.slices.data.syntheticJobs![f.jobId].generationStaffGranted = 0; }],
  ];
  for (const [label, mutate] of activeCases) { const changed = structuredClone(f.generating); mutate(changed); invalidSnapshot(changed, label); }
  const acceptedCases: Array<[string, (state: GameState) => void]> = [
    ['accepted units inflation', state => { state.slices.data.packets[f.packetId].readyUnits++; }],
    ['broadened packet rights', state => { state.slices.data.packets[f.packetId].rights.feedback = true; }],
    ['reserved case promoted to training', state => { const audit = state.slices.data.syntheticJobs![f.jobId].audit!; audit.acceptedCaseIds[0] = audit.quarantinedCaseIds[0]; }],
    ['audit staff skipped', state => { state.slices.data.syntheticJobs![f.jobId].auditStaff.completedStaff = 0; }],
    ['source audit identity changed', state => { state.slices.data.syntheticJobs![f.jobId].sourceIds.push('invented-source'); }],
    ['copied synthetic packet', state => { const packet = structuredClone(state.slices.data.packets[f.packetId]); packet.id = 'synthetic-copy'; state.slices.data.packets[packet.id] = packet; }],
  ];
  for (const [label, mutate] of acceptedCases) { const changed = structuredClone(f.accepted); mutate(changed); invalidSnapshot(changed, label); }
  const target = structuredClone(f.trained); target.slices.models.trainingRuns[f.trainingRunId].plan!.synthetic!.targetBps++;
  invalidSnapshot(target, 'raised fixed teacher target');
  const disguised = structuredClone(f.accepted); disguised.contentVersion = '0.23.0'; disguised.buildVersion = '0.23.0';
  invalidSnapshot(disguised, 'synthetic records hidden under a historical content header');
});
