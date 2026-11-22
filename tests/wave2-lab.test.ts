import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trainingRunProgress } from '../src/core/selectors';
import { deserializeState } from '../src/core/snapshot';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainResult, GameCommand, GameState, LedgerFact, ModuleContext, Phase, ResourceFrame, RoleAllocation } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { drawNamed } from '../src/core/random';
import { assertWave2LabState } from '../src/core/wave2-lab-validation';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { createResearchModule, getResearchView, hasResearch } from '../src/modules/research';
import { getCorpusEvidence, getTrainingPreview } from '../src/modules/lab-planner';

const lab = createLabModule(CONTENT), research = createResearchModule(CONTENT);
const company = createCompanyModule(CONTENT), compute = createComputeModule(CONTENT);
const roles = (): RoleAllocation => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 });
/** Focused lab fixture: real workforce and compute owners supply all grants. */
class Lab2Fixture {
  state = createInitialState();
  facts: LedgerFact[] = [];
  resources: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  sequence = 0;
  get id() { return this.state.playerCompanyId; }
  get fleet() { return this.state.slices.compute.fleets[this.id]; }
  get modelSlice() { return this.state.slices.models; }
  ctx(phase: Phase): ModuleContext {
    return { week: this.state.week, phase, content: CONTENT, facts: this.facts, resources: this.resources,
      random: { draw: key => { const result = drawNamed(this.state, 'lab:' + key); this.state.random = result.state.random; return result.value; } } };
  }
  apply(result: DomainResult): void {
    Object.assign(this.state.slices, structuredClone(result.updates ?? {}));
    this.facts.push(...(result.facts ?? []));
    // Settlement is isolated in integration tests; mark submitted one-time facts for lane invariant tests.
    for (const fact of result.facts ?? []) this.state.slices.company.postedFacts[fact.id] = true;
  }
  command(payload: CommandPayload, id = 'fixture-' + ++this.sequence): GameCommand { return { id, companyId: this.id, issuedForWeek: this.state.week + 1, payload }; }
  accept(payload: CommandPayload, id = 'fixture-' + ++this.sequence): GameCommand {
    const command = this.command(payload, id), owner = ['start_research', 'set_research_paused'].includes(payload.kind) ? research : lab;
    assert.equal(owner.validateCommand!(this.state, command, CONTENT), undefined);
    const quote = owner.quoteCommand!(this.state, command, CONTENT), result = owner.applyCommand!(this.state, command, CONTENT);
    assert.equal(result.facts?.filter(fact => fact.kind === 'expense').reduce((sum, fact) => sum + fact.amountCents, 0) ?? 0, quote.upfrontCostCents);
    this.apply(result); return command;
  }
  founder(allocation: Partial<RoleAllocation>): void { this.state.slices.company.founderAssignments[this.id] = { ...roles(), ...allocation }; }
  allocation(development: number, researchCU = 0): void { this.fleet.allocation = { serving: 0, development, research: researchCU }; }
  step(): void {
    this.state.week += 1; this.resources = { requests: [], computeGrants: [], staffGrants: [] };
    this.apply(research.handlers.commit!(this.state, this.ctx('commit')));
    this.resources.requests = [...(lab.handlers.reserve!(this.state, this.ctx('reserve')).workRequests ?? []), ...(research.handlers.reserve!(this.state, this.ctx('reserve')).workRequests ?? [])];
    const staff = company.grantResources!(this.state, this.ctx('reserve')); this.apply(staff); this.resources.staffGrants = staff.staffGrants ?? [];
    const gpu = compute.grantResources!(this.state, this.ctx('reserve')); this.apply(gpu); this.resources.computeGrants = gpu.computeGrants ?? [];
    this.apply(lab.handlers.execute!(this.state, this.ctx('execute'))); this.apply(research.handlers.execute!(this.state, this.ctx('execute')));
    this.apply(lab.handlers.resolve!(this.state, this.ctx('resolve'))); this.apply(research.handlers.resolve!(this.state, this.ctx('resolve')));
  }
  until(predicate: () => boolean, limit = 500): void { for (let i = 0; i < limit && !predicate(); i++) this.step(); assert.ok(predicate(), 'Project must make progress from real resource grants.'); }
  asyncResearch(id: string): void {
    const definition = CONTENT.research.find(item => item.id === id)!;
    for (const prerequisite of definition.requires) if (!hasResearch(this.state, this.id, prerequisite)) this.asyncResearch(prerequisite);
    if (hasResearch(this.state, this.id, id)) return;
    this.accept({ kind: 'start_research', researchId: id }, 'learn-' + id);
    this.founder({ [definition.role]: U }); this.allocation(0, 4 * U);
    this.until(() => hasResearch(this.state, this.id, id));
  }
  prepare(catalogId = CONTENT.starterData.id): string {
    let packetId = CONTENT.starterData.id;
    if (catalogId !== CONTENT.starterData.id) {
      this.accept({ kind: 'buy_data', catalogId });
      packetId = `data-${this.id}-${catalogId}`;
    }
    this.accept({ kind: 'prepare_data', packetId }); this.founder({ data: U }); this.allocation(0);
    this.until(() => this.state.slices.data.packets[packetId].prepared); return packetId;
  }
  train(packetId: string, recipeId = CONTENT.firstTraining.id, baseModelId = CONTENT.seedModel.id, id = 'candidate-' + ++this.sequence): string {
    this.accept({ kind: 'start_training', baseModelId, packetId, recipeId }, id);
    this.founder({ ml: U }); this.allocation(4 * U);
    this.until(() => this.modelSlice.trainingRuns['training-' + id].status === 'complete'); return 'model-' + id;
  }
}

test('W2-L01: research has independent paid meters, pause, and next-boundary availability', () => {
  const f = new Lab2Fixture();
  assert.equal(hasResearch(f.state, f.id, 'R1'), false, 'A rival’s initial research is not player knowledge.');
  f.accept({ kind: 'start_research', researchId: 'R1' }, 'r1'); f.founder({}); f.allocation(0, 4 * U); f.step();
  const project = f.state.slices.research.projects['research-r1'];
  assert.equal(project.completedWork, 2 * U); assert.equal(project.completedStaff, 0);
  assert.equal(hasResearch(f.state, f.id, 'R1'), false);
  f.accept({ kind: 'set_research_paused', projectId: project.id, paused: true }); f.founder({ research: U }); f.step();
  assert.equal(f.state.slices.research.projects[project.id].completedStaff, 0);
  f.accept({ kind: 'set_research_paused', projectId: project.id, paused: false }); f.allocation(0); f.step(); f.step();
  assert.equal(f.state.slices.research.projects[project.id].status, 'complete'); assert.equal(hasResearch(f.state, f.id, 'R1'), false);
  assert.equal(getResearchView(f.state, f.id).find(item => item.id === 'R1')!.status, 'pending');
  assert.equal(research.validateCommand!(f.state, f.command({ kind: 'start_research', researchId: 'R2' }), CONTENT)?.code, 'NOT_READY');
  f.step(); assert.equal(hasResearch(f.state, f.id, 'R1'), true);
  assert.equal(f.facts.filter(fact => fact.id === 'research-r1:fee').length, 1);
  assert.equal(f.facts.find(fact => fact.id === 'research-r1:fee')!.amountCents, 100_000);
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L02: specialist purchases are unique owned editions and require actual preparation', () => {
  const f = new Lab2Fixture(); f.accept({ kind: 'buy_data', catalogId: 'specialist-documents-1' }, 'purchase');
  const packetId = `data-${f.id}-specialist-documents-1`, packet = f.state.slices.data.packets[packetId];
  assert.equal(packet.rawUnits, 120); assert.equal(packet.readyUnits, 0); assert.equal(packet.companyId, f.id);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'buy_data', catalogId: packet.catalogId! }), CONTENT)?.code, 'NO_IMPROVEMENT');
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'document-adaptation' }), CONTENT)?.code, 'NOT_READY');
  f.accept({ kind: 'prepare_data', packetId }, 'prepare-specialist'); f.founder({ data: U }); f.allocation(0); f.step();
  assert.equal(f.state.slices.data.packets[packetId].prepared, false); f.step();
  assert.equal(f.state.slices.data.packets[packetId].readyUnits, 120);
  assert.equal(f.facts.filter(fact => fact.sourceId === packetId).reduce((sum, fact) => sum + fact.amountCents, 0), 600_000);
  const foreign = Object.values(f.state.slices.data.packets).find(other => other.companyId !== f.id)!;
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'prepare_data', packetId: foreign.id }), CONTENT)?.code, 'NOT_READY');
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L03: curation creates immutable revisions, retains rights, and never doubles source evidence', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-documents-1'); f.asyncResearch('R2');
  const original = structuredClone(f.state.slices.data.packets[packetId]);
  f.accept({ kind: 'curate_data', packetId }, 'curate'); f.founder({ data: U }); f.allocation(0);
  f.step(); f.step(); assert.equal(f.state.slices.data.packets['curated-curate'].prepared, false); f.step();
  const curated = f.state.slices.data.packets['curated-curate'];
  assert.deepEqual(f.state.slices.data.packets[packetId], original); assert.equal(curated.qualityBps, 9500);
  const corpus = getCorpusEvidence(f.state, f.id, [packetId, curated.id]);
  assert.equal(corpus.distinctUnits, 120); assert.equal(corpus.relevantUnits.documents, 120 * U); assert.equal(corpus.qualityBps.documents, 9500);
  assert.deepEqual(curated.rights, original.rights); assert.deepEqual(curated.sourceIds, original.sourceIds);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'curate_data', packetId: curated.id }), CONTENT)?.code, 'NO_IMPROVEMENT');
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L04: authored document and preference recipes preserve separate capability and reliability effects', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-documents-1');
  const documentId = f.train(packetId, 'document-adaptation', CONTENT.seedModel.id, 'documents');
  assert.equal(f.modelSlice.versions[documentId].capabilityBps.documents, 5520); assert.equal(f.modelSlice.versions[documentId].reliabilityBps, 8800);
  f.asyncResearch('R5');
  const behaviorId = f.train(packetId, 'behavior-reliability', documentId, 'preferences');
  assert.deepEqual(f.modelSlice.versions[behaviorId].capabilityBps, f.modelSlice.versions[documentId].capabilityBps);
  assert.equal(f.modelSlice.versions[behaviorId].reliabilityBps, 9160);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', baseModelId: behaviorId, packetId, recipeId: 'behavior-reliability' }), CONTENT)?.code, 'NO_IMPROVEMENT');
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L05: code and tool evidence has domain coverage and cannot borrow another company’s data', () => {
  const f = new Lab2Fixture(), code = f.prepare('specialist-coding-1'), tools = f.prepare('specialist-tools-1');
  const one = getTrainingPreview(f.state, f.id, { baseModelId: CONTENT.seedModel.id, packetId: code, recipeId: 'coding-tools-adaptation' });
  assert.equal(one.capabilityRange.minimum.coding, 5240); assert.equal(one.capabilityRange.minimum.tools, 2612);
  const both = getTrainingPreview(f.state, f.id, { baseModelId: CONTENT.seedModel.id, packetId: code, packetIds: [code, tools], recipeId: 'coding-tools-adaptation' });
  assert.equal(both.capabilityRange.minimum.coding, 5240); assert.equal(both.capabilityRange.minimum.tools, 5060);
  const foreign = Object.values(f.state.slices.data.packets).find(packet => packet.companyId !== f.id)!;
  assert.equal(getTrainingPreview(f.state, f.id, { baseModelId: CONTENT.seedModel.id, packetId: code, packetIds: [code, foreign.id], recipeId: 'coding-tools-adaptation' }).reason?.code, 'NOT_READY');
});

test('W2-L06: efficient adaptation changes future budgets and never rewrites an admitted run', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-documents-1');
  f.accept({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'document-adaptation' }, 'old-budget');
  f.accept({ kind: 'set_job_paused', jobId: 'training-old-budget', paused: true });
  const oldPlan = structuredClone(f.modelSlice.trainingRuns['training-old-budget']); f.asyncResearch('R4');
  assert.deepEqual(f.modelSlice.trainingRuns['training-old-budget'], oldPlan);
  const next = getTrainingPreview(f.state, f.id, { baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'document-adaptation' });
  assert.equal(next.workCUw, 18 * U); assert.equal(f.modelSlice.trainingRuns['training-old-budget'].requiredWork, 24 * U);
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L07: profile previews are read-only, adjustments persist, and command IDs cannot reroll them', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-documents-1'), before = structuredClone(f.state);
  const options = { baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'document-adaptation' };
  assert.equal(getTrainingPreview(f.state, f.id, { ...options, profile: 'stable' }).workCUw, 26.4 * U);
  assert.equal(getTrainingPreview(f.state, f.id, { ...options, profile: 'balanced' }).workCUw, 24 * U);
  assert.equal(getTrainingPreview(f.state, f.id, { ...options, profile: 'ambitious' }).workCUw, 33.6 * U);
  assert.deepEqual(f.state, before);
  const a = lab.applyCommand!(f.state, f.command({ kind: 'start_training', ...options, profile: 'balanced' }, 'a'), CONTENT);
  const b = lab.applyCommand!(f.state, f.command({ kind: 'start_training', ...options, profile: 'balanced' }, 'b'), CONTENT);
  assert.deepEqual(a.updates!.models!.trainingRuns['training-a'].plan!.savedAdjustments, b.updates!.models!.trainingRuns['training-b'].plan!.savedAdjustments);
  f.apply(a); assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', ...options, profile: 'stable' }), CONTENT)?.code, 'ALREADY_ACTIVE');
  const replay = new Lab2Fixture(); replay.state = JSON.parse(JSON.stringify(f.state)) as GameState;
  f.founder({ ml: U }); f.allocation(4 * U); replay.founder({ ml: U }); replay.allocation(4 * U);
  for (let i = 0; i < 6; i++) { f.step(); replay.step(); }
  assert.deepEqual(f.modelSlice.versions['model-a'], replay.modelSlice.versions['model-a']);
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L08: optional checkpoints spend two extra CUw and preserve useful attainment', () => {
  const f = new Lab2Fixture(), packetId = f.prepare(); f.asyncResearch('R3');
  f.accept({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId, automatedCheckpoints: true }, 'checkpoints');
  f.founder({ ml: U }); f.allocation(4 * U);
  f.until(() => f.modelSlice.trainingRuns['training-checkpoints'].status === 'complete');
  const run = f.modelSlice.trainingRuns['training-checkpoints'];
  assert.equal(run.completedWork, 12 * U); assert.equal(run.checkpointOverheadCompleted, 2 * U); assert.equal(run.physicalWork, 14 * U);
  assert.equal(run.checkpointModelIds!.length, 10); assert.equal(f.modelSlice.versions[run.outputModelId].capabilityBps.conversation, 4800);
  assert.equal(f.modelSlice.versions['checkpoint-training-checkpoints-1000'].capabilityBps.conversation, 4080);
  assertWave2LabState(f.state, CONTENT);
});

function addReleasedFixtures(f: Lab2Fixture): void {
  for (const index of [1, 2]) {
    const id = 'fixture-release-' + index, reportId = 'fixture-report-' + index;
    f.modelSlice.versions[id] = { ...structuredClone(CONTENT.seedModel), id, status: 'released', scenarioStart: true, evaluationReportId: reportId };
    f.modelSlice.reports[reportId] = { id: reportId, companyId: f.id, modelId: id, week: f.state.week, heldOut: true, scenarioStart: true,
      capabilityBps: structuredClone(CONTENT.seedModel.capabilityBps), reliabilityBps: CONTENT.seedModel.reliabilityBps, basicChatEligible: false,
      cases: Array.from({ length: 20 }, (_, n) => ({ id: `${reportId}-${n}`, domain: 'conversation', difficultyBps: 0, passed: false })), passedCases: 0 };
  }
}
test('W2-L09: foundation gate needs distinct broad evidence, releases, researcher time and its larger workspace', () => {
  const f = new Lab2Fixture(), broad = f.prepare('broad-corpus-1'), behavior = f.prepare('specialist-conversation-1');
  const options = { baseModelId: CONTENT.seedModel.id, packetId: broad, packetIds: [broad, behavior], recipeId: 'medium-foundation' };
  assert.match(getTrainingPreview(f.state, f.id, options).reason!.message, /Test and release two different model versions/);
  addReleasedFixtures(f); assert.equal(getTrainingPreview(f.state, f.id, options).reason?.code, 'MISSING_STAFF');
  f.founder({ research: U });
  const preview = getTrainingPreview(f.state, f.id, options); assert.equal(preview.reason, undefined);
  assert.equal(preview.workCUw, 240 * U); assert.equal(preview.memoryMU, 24 * U); assert.equal(preview.preparationStaff, 6 * U); assert.equal(preview.feeCents, 2_000_000);
  f.accept({ kind: 'start_training', ...options }, 'foundation'); f.allocation(4 * U);
  for (let i = 0; i < 6; i++) {
    f.step();
    const run = f.modelSlice.trainingRuns['training-foundation'];
    assert.equal(run.completedWork, 0);
    const phase = trainingRunProgress(run);
    if (i < 5) {
      assert.match(phase.detail, /Stage 1 of 2 · Design foundation/);
      assert.ok(phase.progressBps > 0, 'Design progress is visible before any GPU updates');
    } else {
      assert.match(phase.detail, /Stage 2 of 2 · Train new version/);
      assert.equal(phase.progressBps, 0);
    }
  }
  f.founder({ ml: U }); f.step();
  assert.equal(f.modelSlice.trainingRuns['training-foundation'].completedWork, 0, 'Four cloud CU cannot fit a 24 MU training workspace.');
  assert.match(f.modelSlice.trainingRuns['training-foundation'].lastBottleneck, /memory/i);
  const corpus = getCorpusEvidence(f.state, f.id, [broad, broad, broad]); assert.equal(corpus.broadUnits, 500);
  assert.equal(getTrainingPreview(f.state, f.id, { ...options, recipeId: 'large-foundation', packetIds: [broad, broad, behavior] }).reason?.code, 'MISSING_STAFF');
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L10: calibration has finite behavior gains and reports retain release evidence and correct denominators', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-conversation-1'); f.asyncResearch('R5A');
  const baseId = f.train(packetId, CONTENT.firstTraining.id, CONTENT.seedModel.id, 'base');
  const calibrated = f.train(packetId, 'calibration-curriculum', baseId, 'calibrated');
  assert.deepEqual(f.modelSlice.versions[calibrated].capabilityBps, f.modelSlice.versions[baseId].capabilityBps);
  assert.equal(f.modelSlice.versions[calibrated].reliabilityBps, f.modelSlice.versions[baseId].reliabilityBps);
  assert.equal(f.modelSlice.versions[calibrated].behavior!.confidentErrorBps, 550);
  f.accept({ kind: 'evaluate_model', modelId: calibrated }, 'basic'); f.founder({ research: U }); f.allocation(4 * U); f.step();
  const basicPointer = f.modelSlice.versions[calibrated].evaluationReportId;
  f.accept({ kind: 'evaluate_model', modelId: calibrated, suiteId: 'behavior-cases-1' }, 'behavior');
  const replay = new Lab2Fixture(); replay.state = JSON.parse(JSON.stringify(f.state)) as GameState;
  f.step(); replay.step();
  const report = f.modelSlice.reports['report-evaluation-behavior'];
  assert.equal(report.cases.length, 100); assert.equal(report.outcomes!.eligibleCases, 90); assert.equal(report.outcomes!.correctPolicyRefusals, 10);
  assert.equal(report.outcomes!.usefulAnswers + report.outcomes!.confidentErrors + report.outcomes!.falseRefusals + report.outcomes!.clarifications, 90);
  assert.equal(f.modelSlice.versions[calibrated].evaluationReportId, basicPointer);
  assert.deepEqual(report, replay.modelSlice.reports[report.id]); assert.deepEqual(f.state.random, replay.state.random);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'evaluate_model', modelId: calibrated, suiteId: 'behavior-cases-1' }), CONTENT)?.code, 'NO_IMPROVEMENT');
  assertWave2LabState(f.state, CONTENT);
});

test('W2-L11: saved-plan validation rejects free compute, changed evidence, rerolls and manufactured model gains', () => {
  const f = new Lab2Fixture(), packetId = f.prepare('specialist-documents-1');
  f.accept({ kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'document-adaptation', profile: 'balanced' }, 'validated');
  f.founder({ ml: U }); f.allocation(4 * U); f.until(() => f.modelSlice.trainingRuns['training-validated'].status === 'complete');
  assertWave2LabState(f.state, CONTENT);
  for (const tamper of [
    (state: GameState) => { state.slices.models.trainingRuns['training-validated'].requiredWork -= U; },
    (state: GameState) => { state.slices.models.trainingRuns['training-validated'].plan!.corpus.distinctUnits += 120; },
    (state: GameState) => { state.slices.models.trainingRuns['training-validated'].plan!.savedAdjustments.documents += 1; },
    (state: GameState) => { state.slices.models.versions['model-validated'].capabilityBps.documents += 1; },
  ]) { const bad = structuredClone(f.state); tamper(bad); assert.throws(() => assertWave2LabState(bad, CONTENT)); }
});


test('W2-L12: an authentic Wave 1 candidate cannot restart after migration adds source provenance', () => {
  const restored = deserializeState(readFileSync(join(__dirname, 'fixtures/wave1-snapshot.json'), 'utf8'));
  assert.ok(restored.ok, restored.ok ? '' : restored.error);
  if (!restored.ok) return;
  const state = restored.state, run = Object.values(state.slices.models.trainingRuns).find(item => item.companyId === state.playerCompanyId)!;
  assert.equal(run.plan, undefined); assert.equal(run.status, 'complete');
  const payload = { kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: run.packetId };
  const command = { id: 'migrated-repeat', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload };
  assert.equal(lab.validateCommand!(state, command, CONTENT)?.code, 'NO_IMPROVEMENT');
  assert.equal(getTrainingPreview(state, state.playerCompanyId, payload).reason?.code, 'NO_IMPROVEMENT');
  const ambitious = getTrainingPreview(state, state.playerCompanyId, { ...payload, profile: 'ambitious' });
  assert.equal(ambitious.reason, undefined, 'An explicitly higher target tier is a distinct finite candidate.');
});

test('Model design discoveries unlock distinct paid blueprints with measured strengths and tradeoffs', () => {
  const f = new Lab2Fixture();
  const baseModelId = CONTENT.seedModel.id;
  for (const [method, recipeId, comparison, domain, tradeoff] of [
    ['D1', 'support-desk', 'compact-conversation-adaptation', 'conversation', 'documents'],
    ['D2', 'document-extractor', 'document-adaptation', 'documents', 'conversation'],
    ['D3', 'tool-dispatcher', 'coding-tools-adaptation', 'tools', 'coding'],
  ] as const) {
    const packetId = f.prepare('specialist-' + domain + '-1');
    const choice = { baseModelId, packetId, recipeId };
    assert.match(getTrainingPreview(f.state, f.id, choice).reason!.message, new RegExp(method));
    f.asyncResearch(method);
    const selected = getTrainingPreview(f.state, f.id, choice);
    const standard = getTrainingPreview(f.state, f.id, { ...choice, recipeId: comparison });
    assert.equal(selected.reason, undefined);
    assert.ok(selected.capabilityRange.minimum[domain] > standard.capabilityRange.minimum[domain]);
    assert.ok(selected.capabilityRange.minimum[tradeoff] < standard.capabilityRange.minimum[tradeoff]);
    const modelId = f.train(packetId, recipeId, baseModelId);
    const model = f.modelSlice.versions[modelId];
    assert.deepEqual(model.capabilityBps, selected.capabilityRange.minimum);
    assert.equal(model.reliabilityBps, selected.reliabilityRange.minimum);
    assert.ok(f.facts.some(item => item.sourceId === model.trainingRunId && item.amountCents === selected.feeCents));
  }
  assertWave2LabState(f.state, CONTENT);
});

test('Workspace research trades actual training work for memory and preserves the trained model across options', () => {
  const f = new Lab2Fixture(), packetId = f.prepare();
  const choice = { baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'support-desk' };
  f.asyncResearch('D1');
  assert.match(getTrainingPreview(f.state, f.id, { ...choice, workspace: 'recompute' }).reason!.message, /Activation recomputation/);
  f.asyncResearch('D5'); f.asyncResearch('D6');
  const standard = getTrainingPreview(f.state, f.id, choice);
  const low = getTrainingPreview(f.state, f.id, { ...choice, workspace: 'recompute' });
  const fast = getTrainingPreview(f.state, f.id, { ...choice, workspace: 'large-batch' });
  assert.equal(low.memoryMU, 3 * U); assert.equal(low.workCUw, 20 * U);
  assert.equal(fast.memoryMU, 6 * U); assert.equal(fast.workCUw, 13_600_000_000);
  assert.deepEqual(fast.capabilityRange, low.capabilityRange);
  assert.deepEqual(fast.capabilityRange, standard.capabilityRange);
  f.accept({ kind: 'start_training', ...choice, workspace: 'large-batch' }, 'wide');
  const run = f.modelSlice.trainingRuns['training-wide'];
  assert.equal(run.requiredWork, fast.workCUw); assert.equal(run.requiredMemory, fast.memoryMU);
  assert.equal(run.plan?.workspace, 'large-batch');
  assert.equal(run.plan?.residentMU, 2 * U);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', ...choice, workspace: 'recompute' }), CONTENT)?.code, 'ALREADY_ACTIVE');
  f.founder({ ml: U }); f.allocation(4 * U);
  f.until(() => f.modelSlice.trainingRuns[run.id].status === 'complete');
  assertWave2LabState(f.state, CONTENT);
  const edited = structuredClone(f.state);
  edited.slices.models.trainingRuns[run.id].plan!.workspace = 'recompute';
  assert.throws(() => assertWave2LabState(edited, CONTENT), /workspace|work/i);
});

test('Compact foundation earns its own compact lineage and fits the opening cloud after design', () => {
  const f = new Lab2Fixture();
  const broad = f.prepare('broad-corpus-1'), behavior = f.prepare('specialist-conversation-1');
  const choice = { baseModelId: CONTENT.seedModel.id, recipeId: 'compact-foundation', packetId: broad, packetIds: [broad, behavior] };
  f.asyncResearch('D4');
  assert.match(getTrainingPreview(f.state, f.id, choice).reason!.message, /two different model versions/);
  addReleasedFixtures(f); f.founder({ research: U });
  const preview = getTrainingPreview(f.state, f.id, choice);
  assert.equal(preview.memoryMU, 6 * U); assert.equal(preview.workCUw, 96 * U);
  assert.equal(preview.reason, undefined);
  const reference = f.modelSlice.versions['fixture-release-1'];
  const strongReference = { ...reference,
    capabilityBps: { conversation: 8000, documents: 8000, coding: 8000, tools: 8000 }, reliabilityBps: 9600 };
  const compare = structuredClone(f.state);
  compare.slices.models.versions[reference.id] = strongReference;
  const independent = { ...choice, baseModelId: reference.id };
  const sameFoundation = getTrainingPreview(compare, f.id, independent);
  assert.deepEqual(sameFoundation.capabilityRange, preview.capabilityRange);
  assert.ok(Object.values(sameFoundation.capabilityRange.maximum).every(score => score < 8000));
  assert.ok(sameFoundation.reliabilityRange.maximum < strongReference.reliabilityBps);
  assert.equal(sameFoundation.reason, undefined);
  assert.equal(lab.validateCommand!(compare, f.command({ kind: 'start_training', ...independent }), CONTENT), undefined);
  f.accept({ kind: 'start_training', ...choice }, 'compact-root');
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', ...independent }), CONTENT)?.code, 'ALREADY_ACTIVE');
  f.allocation(4 * U);
  f.until(() => f.modelSlice.trainingRuns['training-compact-root'].preparationCompleted === 2 * U);
  f.founder({ ml: U }); f.until(() => f.modelSlice.trainingRuns['training-compact-root'].status === 'complete');
  const model = f.modelSlice.versions['model-compact-root'];
  assert.equal(model.family, 'compact'); assert.equal(model.residentMU, 2 * U);
  assert.match(f.modelSlice.trainingRuns['training-compact-root'].plan!.lineageId, /^foundation-/);
  assertWave2LabState(f.state, CONTENT);
});
