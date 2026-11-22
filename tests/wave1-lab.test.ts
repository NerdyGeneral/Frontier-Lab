import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainResult, GameCommand, GameState, LedgerFact, ModuleContext, Phase, ResourceFrame, RoleAllocation } from '../src/contracts/types';
import { createInitialState } from '../src/core/engine';
import { drawNamed } from '../src/core/random';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule, finiteOutcome } from '../src/modules/lab';

const lab = createLabModule(CONTENT);
const company = createCompanyModule(CONTENT);
const compute = createComputeModule(CONTENT);
const packetId = CONTENT.starterData.id;
const baseModelId = CONTENT.seedModel.id;
const emptyRoles = (): RoleAllocation => ({ research: 0, ml: 0, data: 0, infrastructure: 0, commercial: 0, hardware: 0 });

/** Focused lab fixture; the real workforce and compute owners issue its grants. */
class LabFixture {
  state = createInitialState();
  facts: LedgerFact[] = [];
  resources: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
  get packet() { return this.state.slices.data.packets[packetId]; }
  get fleet() { return this.state.slices.compute.fleets[this.state.playerCompanyId]; }
  get models() { return this.state.slices.models; }
  get reports() { return Object.values(this.models.reports).filter(report => report.companyId === this.state.playerCompanyId); }
  context(phase: Phase): ModuleContext {
    return {
      week: this.state.week, phase, content: CONTENT, facts: this.facts, resources: this.resources,
      random: { draw: key => {
        const draw = drawNamed(this.state, 'lab:' + key);
        this.state.random = draw.state.random;
        return draw.value;
      } },
    };
  }
  update(result: DomainResult): void {
    Object.assign(this.state.slices, structuredClone(result.updates ?? {}));
    this.facts.push(...(result.facts ?? []));
  }
  command(payload: CommandPayload, id: string): GameCommand {
    return { id, companyId: this.state.playerCompanyId, issuedForWeek: this.state.week + 1, payload };
  }
  accept(payload: CommandPayload, id: string): void {
    const command = this.command(payload, id);
    assert.equal(lab.validateCommand!(this.state, command, CONTENT), undefined);
    this.update(lab.applyCommand!(this.state, command, CONTENT));
  }
  founder(roles: Partial<RoleAllocation>): void {
    this.state.slices.company.founderAssignments[this.state.playerCompanyId] = { ...emptyRoles(), ...roles };
  }
  step(): void {
    this.state.week += 1;
    this.resources = { requests: [], computeGrants: [], staffGrants: [] };
    const requestResult = lab.handlers.reserve!(this.state, this.context('reserve'));
    this.resources.requests = requestResult.workRequests ?? [];
    const staff = company.grantResources!(this.state, this.context('reserve'));
    this.update(staff); this.resources.staffGrants = staff.staffGrants ?? [];
    const gpu = compute.grantResources!(this.state, this.context('reserve'));
    this.update(gpu); this.resources.computeGrants = gpu.computeGrants ?? [];
    this.update(lab.handlers.execute!(this.state, this.context('execute')));
    this.update(lab.handlers.resolve!(this.state, this.context('resolve')));
  }
  prepared(units = 100): void {
    this.packet.rawUnits = units; this.packet.readyUnits = units; this.packet.prepared = true;
  }
  beginTraining(id = 'adapt'): string {
    this.accept({ kind: 'start_training', baseModelId, packetId }, id);
    return 'training-' + id;
  }
}

function trained(units = 100): LabFixture {
  const fixture = new LabFixture(); fixture.prepared(units); fixture.founder({ ml: U / 2 }); fixture.beginTraining();
  for (let i = 0; i < 6; i++) fixture.step();
  return fixture;
}

test('W1-L01: finite attainment respects independent work, evidence, quality, and ceilings', () => {
  const input = { anchorBps: 4000, targetBps: 5000, completedWork: 12 * U, requiredWork: 12 * U, relevantEvidence: 100 * U, requiredEvidence: 100 * U, qualityBps: 8000 };
  assert.equal(finiteOutcome(input), 4800);
  assert.equal(finiteOutcome({ ...input, completedWork: 6 * U }), 4400);
  assert.equal(finiteOutcome({ ...input, relevantEvidence: 50 * U }), 4400);
  assert.equal(finiteOutcome({ ...input, completedWork: 24 * U, relevantEvidence: 200 * U }), 4800);
  assert.equal(finiteOutcome({ ...input, qualityBps: 0 }), 4000);
  assert.equal(finiteOutcome({ ...input, completedWork: 0 }), 4000);
  assert.equal(finiteOutcome({ ...input, targetBps: 9000, ceilingBps: 7000, qualityBps: 10000 }), 7000);
  assert.equal(finiteOutcome({ ...input, targetBps: 3000 }), 3200, 'Absolute targets also represent a regression without unsafe signed multiplication.');
  assert.throws(() => finiteOutcome({ ...input, requiredWork: 0 }));
  assert.throws(() => finiteOutcome({ ...input, qualityBps: 10001 }));
  assert.throws(() => finiteOutcome({ ...input, completedWork: Number.MAX_SAFE_INTEGER + 1 }));
});

test('W1-L02: data preparation uses actual data staff, charges once, and preserves paused progress', () => {
  const f = new LabFixture();
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', baseModelId, packetId }, 'raw'), CONTENT)?.code, 'NOT_READY');
  const original = structuredClone(f.state);
  const prepCommand = f.command({ kind: 'prepare_data', packetId }, 'prepare');
  assert.equal(lab.quoteCommand!(f.state, prepCommand, CONTENT).upfrontCostCents, 100_000);
  const started = lab.applyCommand!(f.state, prepCommand, CONTENT);
  assert.deepEqual(f.state, original, 'Admission must not mutate the input snapshot.');
  f.update(started);
  f.founder({}); f.step();
  assert.equal(f.state.slices.data.preparationJobs['preparation-prepare'].completedStaff, 0);
  assert.match(f.state.slices.data.preparationJobs['preparation-prepare'].lastBottleneck, /Data points/i);
  f.founder({ data: U }); f.step();
  assert.equal(f.state.slices.data.preparationJobs['preparation-prepare'].completedStaff, U);
  assert.equal(f.packet.readyUnits, 0, 'A half-prepared packet cannot train a model.');
  assert.deepEqual(f.resources.computeGrants.map(g => g.physicalCUw), [0]);
  f.accept({ kind: 'set_job_paused', jobId: 'preparation-prepare', paused: true }, 'pause-prep');
  f.step();
  assert.equal(f.resources.requests.length, 0);
  assert.equal(f.state.slices.data.preparationJobs['preparation-prepare'].completedStaff, U);
  f.accept({ kind: 'set_job_paused', jobId: 'preparation-prepare', paused: false }, 'resume-prep');
  f.step();
  assert.equal(f.packet.prepared, true); assert.equal(f.packet.readyUnits, 100);
  assert.equal(f.state.slices.data.preparationJobs['preparation-prepare'].status, 'complete');
  f.step();
  assert.equal(f.facts.length, 1); assert.equal(f.facts[0].amountCents, 100_000);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'prepare_data', packetId }, 'again'), CONTENT)?.code, 'NO_IMPROVEMENT');
});

test('W1-L03: training cannot invent ML coverage or partial workspace and uses capped grants once', () => {
  const f = new LabFixture(); f.prepared(); const runId = f.beginTraining(); f.founder({});
  f.step();
  assert.equal(f.models.trainingRuns[runId].completedWork, 0);
  assert.match(f.models.trainingRuns[runId].lastBottleneck, /ML/i);
  f.founder({ ml: U / 4 }); f.step();
  assert.equal(f.resources.requests[0].normalizedWorkCUw, 12 * U);
  assert.equal(f.resources.requests[0].staffDemand?.[0].staffWeeks, 3 * U);
  assert.equal(f.resources.computeGrants[0].physicalCUw, U);
  assert.equal(f.models.trainingRuns[runId].completedWork, U, 'Supervision was applied by the compute owner; the lab must not apply it again.');
  assert.equal(f.models.trainingRuns[runId].physicalWork, U);
  f.fleet.cloudCU = U; f.fleet.memoryMU = 2 * U; f.fleet.allocation.development = U;
  f.step();
  assert.equal(f.resources.computeGrants[0].physicalCUw, 0);
  assert.equal(f.resources.computeGrants[0].memoryMU, 0);
  assert.equal(f.models.trainingRuns[runId].completedWork, U);
  assert.match(f.models.trainingRuns[runId].lastBottleneck, /memory/i);
});

test('W1-L04: six real development grants produce the finite model, preserve midpoint and reusable data', () => {
  const f = new LabFixture(); f.prepared(); f.founder({ ml: U / 2 });
  const packetBefore = structuredClone(f.packet), seedBefore = structuredClone(f.models.versions[baseModelId]);
  const runId = f.beginTraining();
  for (let i = 0; i < 3; i++) f.step();
  const checkpointId = f.models.trainingRuns[runId].checkpointModelId!;
  const checkpointBefore = structuredClone(f.models.versions[checkpointId]);
  assert.equal(checkpointBefore.capabilityBps.conversation, 4400);
  assert.equal(checkpointBefore.reliabilityBps, 7800);
  assert.equal(f.models.trainingRuns[runId].completedWork, 6 * U);
  f.accept({ kind: 'set_job_paused', jobId: runId, paused: true }, 'pause-model');
  f.step();
  assert.equal(f.resources.requests.length, 0);
  assert.equal(f.models.trainingRuns[runId].completedWork, 6 * U);
  f.state = JSON.parse(JSON.stringify(f.state)) as GameState;
  assert.equal(f.models.trainingRuns[runId].checkpointModelId, checkpointId);
  f.accept({ kind: 'set_job_paused', jobId: runId, paused: false }, 'resume-model');
  for (let i = 0; i < 3; i++) f.step();
  const run = f.models.trainingRuns[runId], model = f.models.versions[run.outputModelId];
  assert.equal(run.status, 'complete'); assert.equal(run.completedWork, 12 * U); assert.equal(run.physicalWork, 12 * U);
  assert.deepEqual(model.capabilityBps, { conversation: 4800, documents: 3056, coding: 2000, tools: 2080 });
  assert.equal(model.reliabilityBps, 8600); assert.equal(model.status, 'checkpoint');
  assert.deepEqual(f.models.versions[checkpointId], checkpointBefore);
  assert.deepEqual(f.models.versions[baseModelId], seedBefore);
  assert.deepEqual(f.packet, packetBefore);
  assert.equal(model.parentModelId, baseModelId); assert.equal(model.trainingRunId, runId);
  assert.equal(f.reports.length, 0, 'Training completion does not invent evaluation evidence.');
});

test('W1-L05: repeated or renamed evidence cannot compound training and run evidence is snapshotted', () => {
  const f = trained();
  for (const baseId of [baseModelId, 'model-adapt']) {
    assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', baseModelId: baseId, packetId }, 'repeat-' + baseId), CONTENT)?.code, 'NO_IMPROVEMENT');
  }
  const copied = { ...structuredClone(f.packet), id: 'copied-packet', name: 'A different display name' };
  f.state.slices.data.packets[copied.id] = copied;
  f.models.versions['model-adapt'].name = 'Renamed model';
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'start_training', baseModelId: 'model-adapt', packetId: copied.id }, 'rename-retry'), CONTENT)?.code, 'NO_IMPROVEMENT');
  const partial = new LabFixture(); partial.prepared(50); partial.founder({ ml: U / 2 }); partial.beginTraining();
  partial.packet.rawUnits = 100; partial.packet.readyUnits = 100; partial.packet.qualityBps = 10000;
  for (let i = 0; i < 6; i++) partial.step();
  assert.equal(partial.models.versions['model-adapt'].capabilityBps.conversation, 4400);
  assert.equal(partial.models.versions['model-adapt'].reliabilityBps, 7800);
  assert.equal(partial.models.trainingRuns['training-adapt'].evidence.readyUnits, 50);
});

test('W1-L06: unfinished duplicate jobs, wrong model lineage, and unlicensed data are rejected', () => {
  const f = new LabFixture(); f.prepared(); f.beginTraining();
  const again = f.command({ kind: 'start_training', baseModelId, packetId }, 'again');
  assert.equal(lab.validateCommand!(f.state, again, CONTENT)?.code, 'ALREADY_ACTIVE');
  f.accept({ kind: 'set_job_paused', jobId: 'training-adapt', paused: true }, 'pause');
  assert.equal(lab.validateCommand!(f.state, again, CONTENT)?.code, 'ALREADY_ACTIVE');
  const other = new LabFixture(); other.prepared();
  other.models.versions.unrelated = { ...structuredClone(CONTENT.seedModel), id: 'unrelated' };
  assert.equal(lab.validateCommand!(other.state, other.command({ kind: 'start_training', baseModelId: 'unrelated', packetId }, 'wrong-lineage'), CONTENT)?.code, 'NOT_READY');
  other.packet.rights.hosted = false;
  assert.equal(lab.validateCommand!(other.state, other.command({ kind: 'start_training', baseModelId, packetId }, 'wrong-license'), CONTENT)?.code, 'NOT_READY');
  other.packet.rights.hosted = true;
  other.state.queuedCommands.push(other.command({ kind: 'start_training', baseModelId, packetId }, 'queued'));
  assert.equal(lab.validateCommand!(other.state, other.command({ kind: 'start_training', baseModelId, packetId }, 'second-queued'), CONTENT)?.code, 'ALREADY_ACTIVE');
});

test('W1-L07: held-out evaluation requires both meters and retains deterministic evidence without score gains', () => {
  const f = trained(), modelBefore = structuredClone(f.models.versions['model-adapt']);
  f.accept({ kind: 'evaluate_model', modelId: 'model-adapt' }, 'test'); f.founder({}); f.step();
  const run = f.models.evaluationRuns['evaluation-test'];
  assert.equal(run.completedWork, 2 * U); assert.equal(run.completedStaff, 0); assert.equal(run.status, 'running');
  assert.equal(f.reports.length, 0);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'evaluate_model', modelId: 'model-adapt' }, 'duplicate'), CONTENT)?.code, 'ALREADY_ACTIVE');
  f.founder({ research: U / 2 }); f.fleet.allocation.development = 0;
  const replay = new LabFixture(); replay.state = JSON.parse(JSON.stringify(f.state)) as GameState;
  f.step(); replay.step();
  assert.equal(f.resources.computeGrants[0].physicalCUw, 0, 'Finished GPU work is not charged twice while research catches up.');
  assert.equal(f.models.evaluationRuns['evaluation-test'].status, 'complete');
  const report = f.reports[0];
  assert.equal(report.heldOut, true); assert.equal(report.cases.length, 20); assert.equal(new Set(report.cases.map(c => c.id)).size, 20);
  assert.deepEqual(report.capabilityBps, modelBefore.capabilityBps); assert.equal(report.reliabilityBps, modelBefore.reliabilityBps);
  assert.equal(report.passedCases, report.cases.filter(c => c.passed).length); assert.equal(report.basicChatEligible, true);
  assert.deepEqual(f.models.versions['model-adapt'].capabilityBps, modelBefore.capabilityBps);
  assert.equal(f.models.versions['model-adapt'].reliabilityBps, modelBefore.reliabilityBps);
  assert.deepEqual(f.models.reports, replay.models.reports); assert.deepEqual(f.state.random, replay.state.random);
  assert.equal(Object.values(f.state.random).reduce((sum, stream) => sum + stream.draws, 0), 40);
  const draws = structuredClone(f.state.random), reportBefore = structuredClone(report);
  assert.equal(lab.validateCommand!(f.state, f.command({ kind: 'evaluate_model', modelId: 'model-adapt' }, 'reroll'), CONTENT)?.code, 'NO_IMPROVEMENT');
  f.step();
  assert.deepEqual(f.state.random, draws); assert.deepEqual(f.models.reports[report.id], reportBefore);
});

test('W1-L08: research can finish before GPU evaluation and a midpoint report cannot pass the Chat gate', () => {
  const f = new LabFixture(); f.prepared(); f.founder({ ml: U / 2 }); f.beginTraining();
  for (let i = 0; i < 3; i++) f.step();
  const checkpointId = f.models.trainingRuns['training-adapt'].checkpointModelId!;
  f.accept({ kind: 'evaluate_model', modelId: checkpointId }, 'midpoint-test');
  f.founder({ research: U / 2 }); f.fleet.allocation.development = 0; f.step();
  assert.equal(f.models.evaluationRuns['evaluation-midpoint-test'].completedStaff, U / 2);
  assert.equal(f.models.evaluationRuns['evaluation-midpoint-test'].completedWork, 0);
  assert.equal(f.reports.length, 0);
  f.founder({ ml: U / 2 }); f.fleet.allocation.development = 2 * U; f.step();
  const report = f.reports[0];
  assert.equal(report.basicChatEligible, false); assert.equal(report.capabilityBps.conversation, 4400);
  assert.equal(f.models.trainingRuns['training-adapt'].completedWork, 6 * U, 'Evaluation has priority over training in the shared development allocation.');
  assert.equal(f.models.trainingRuns['training-adapt'].status, 'running');
});

test('W1-L09: model releases consume only the due owned boundary item', () => {
  const f = trained();
  const dueWeek = f.state.week + 1;
  f.state.scheduled = [
    { id: 'due-release', companyId: f.state.playerCompanyId, dueWeek, kind: 'model_release', targetId: 'model-adapt' },
    { id: 'future-release', companyId: f.state.playerCompanyId, dueWeek: dueWeek + 1, kind: 'model_release', targetId: baseModelId },
  ];
  assert.deepEqual(lab.handlers.commit!(f.state, f.context('commit')), {});
  f.state.week = dueWeek;
  const before = structuredClone(f.state), result = lab.handlers.commit!(f.state, f.context('commit'));
  assert.deepEqual(f.state, before); assert.deepEqual(result.fulfilledScheduleIds, ['due-release']);
  assert.equal(result.updates?.models?.versions['model-adapt'].status, 'released');
  assert.equal(result.updates?.models?.versions[baseModelId].status, 'checkpoint');
  f.state.scheduled[0].companyId = 'another-company';
  assert.throws(() => lab.handlers.commit!(f.state, f.context('commit')), /belong/i);
});
