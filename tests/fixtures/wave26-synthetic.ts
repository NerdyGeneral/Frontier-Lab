import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../src/content/catalog';
import { SYNTHETIC_RULES } from '../../src/content/wave26-synthetic';
import type { GameState } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import { deserializeState } from '../../src/core/snapshot';
import { getSyntheticView } from '../../src/modules/synthetic-data';
import { NaturalBusinessCampaign } from './wave5-business';

export interface SyntheticReadyFixture {
  state: GameState;
  teacherModelId: string;
  sourcePacketId: string;
  domain: 'documents';
  commands: NaturalBusinessCampaign['commands'];
  milestones: NaturalBusinessCampaign['milestones'];
  inheritedQueuedCommands: GameState['queuedCommands'];
  originalWeek: number;
  originalChecksum: string;
  minimumCashCents: number;
}

export type SyntheticStage = 'beforeGeneration' | 'generating' | 'generated' | 'reviewing' | 'accepted' | 'training' | 'trained' | 'evaluated';
export interface SyntheticFixture extends Omit<SyntheticReadyFixture, 'state'> {
  beforeGeneration: GameState;
  generating: GameState;
  generated: GameState;
  reviewing: GameState;
  accepted: GameState;
  training: GameState;
  trained: GameState;
  evaluated: GameState;
  jobId: string;
  packetId: string;
  modelId: string;
  trainingRunId: string;
  capabilityReportId: string;
  independentReportId: string;
}

let readyFixture: SyntheticReadyFixture | undefined;
let completedFixture: SyntheticFixture | undefined;

/** Continue the published business with ordinary commands. No balance, research,
 * model, employee or work grant is injected into these states. */
export function getSyntheticReadyFixture(): SyntheticReadyFixture {
  if (!readyFixture) {
    // The acceptance runner emits fixtures to a CommonJS tree; direct tsx runs
    // use the repository as their working directory.
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const raw = readFileSync(join(directory, 'wave16-snapshot.json'), 'utf8');
    const loaded = deserializeState(raw);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    const originalWeek = loaded.state.week;
    const inheritedQueuedCommands = structuredClone(loaded.state.queuedCommands);
    const run = new NaturalBusinessCampaign(loaded.state, 'wave26-synthetic-ready');
    run.mark('Published Wave 16 company');
    run.step();
    run.mark('Published queued batch changes settled');

    // The inherited queue raises serving from 144 to 160 CU. Preserve that
    // allocation and rent the real extra 16 CU needed by this research path.
    const serving = run.fleet.allocation.serving;
    const requiredCloud = Math.max(96 * U, run.fleet.cloudCU, serving + 16 * U - run.fleet.ownedCU);
    if (run.fleet.cloudCU < requiredCloud) {
      run.queue({ kind: 'set_cloud_capacity', cu: requiredCloud });
      run.step();
    }
    run.queue({ kind: 'allocate_compute', serving, development: 8 * U, research: 8 * U });
    run.founder('research');
    run.step();
    run.mark('Development and research capacity reserved');
    run.discover('S1'); run.mark('Synthetic provenance S1 available');
    run.discover('S2'); run.mark('Targeted synthetic curriculum S2 available');

    const view = getSyntheticView(run.state);
    const teacher = view.teachers.filter(item => item.eligibleDomains.includes('documents'))
      .sort((a, b) => b.capabilityBps.documents - a.capabilityBps.documents || a.residentMU - b.residentMU || a.id.localeCompare(b.id))[0];
    const source = view.sources.filter(item => item.eligible && !run.state.slices.data.packets[item.id].feedback && !run.state.slices.data.packets[item.id].synthetic)
      .sort((a, b) => b.coverageBps.documents - a.coverageBps.documents || b.qualityBps - a.qualityBps || a.id.localeCompare(b.id))[0];
    assert.ok(teacher, 'The published company has no qualified documents teacher.');
    assert.ok(source, 'The published company has no eligible prepared human source.');
    assert.ok(view.canGenerate && view.canReview && view.canTrain, 'Both paid synthetic methods must be available.');
    readyFixture = { state: run.state, teacherModelId: teacher.id, sourcePacketId: source.id, domain: 'documents',
      commands: run.commands, milestones: run.milestones, inheritedQueuedCommands,
      originalWeek, originalChecksum: JSON.parse(raw).checksum, minimumCashCents: run.minimumCashCents };
  }
  return structuredClone(readyFixture);
}

/** Cache the real paid path once per acceptance process, returning independent
 * clones so rejection/rollback tests cannot modify another test's evidence. */
export function getSyntheticFixture(onStage?: (stage: SyntheticStage, state: GameState) => void): SyntheticFixture {
  if (!completedFixture) {
    const ready = getSyntheticReadyFixture();
    const run = new NaturalBusinessCampaign(ready.state, 'wave26-synthetic-flow');
    const stages = {} as Record<SyntheticStage, GameState>;
    const capture = (name: SyntheticStage, label: string) => {
      run.mark(label);
      stages[name] = structuredClone(run.state);
      onStage?.(name, structuredClone(run.state));
    };
    capture('beforeGeneration', 'Qualified teacher and source before generation');
    const generationCommand = run.queue({ kind: 'start_synthetic_generation', teacherModelId: ready.teacherModelId,
      sourcePacketId: ready.sourcePacketId, domain: ready.domain });
    const jobId = 'synthetic-job:' + generationCommand;
    run.step();
    capture('generating', 'Teacher generation admitted with actual work grants');
    run.until(state => state.slices.data.syntheticJobs?.[jobId].phase === 'awaiting-review', 40, 'paid teacher generation');
    capture('generated', 'Teacher generation complete; review not yet funded');

    run.queue({ kind: 'start_synthetic_review', jobId });
    run.step();
    capture('reviewing', 'Paid Data review admitted');
    run.until(state => state.slices.data.syntheticJobs?.[jobId].phase === 'complete', 40, 'paid data review and independent audit');
    const packetId = run.state.slices.data.syntheticJobs![jobId].outputPacketId;
    assert.ok(run.state.slices.data.packets[packetId].readyUnits >= SYNTHETIC_RULES.trainingEvidence);
    capture('accepted', 'Audited synthetic packet delivered');

    const trainingCommand = run.queue({ kind: 'start_training', baseModelId: CONTENT.seedModel.id,
      packetId, recipeId: SYNTHETIC_RULES.recipeId });
    const trainingRunId = 'training-' + trainingCommand;
    run.step();
    capture('training', 'Targeted student curriculum admitted');
    run.until(state => state.slices.models.trainingRuns[trainingRunId]?.status === 'complete', 40, 'targeted synthetic student');
    const modelId = run.state.slices.models.trainingRuns[trainingRunId].outputModelId;
    capture('trained', 'Targeted student complete before evaluation');

    run.evaluate(modelId, 'expanded-capabilities-1');
    run.evaluate(modelId, 'independent-holdouts-1');
    capture('evaluated', 'Paid capability and independent reports complete');
    const reports = Object.values(run.state.slices.models.reports).filter(report => report.companyId === run.state.playerCompanyId && report.modelId === modelId);
    const capabilityReport = reports.find(report => report.suiteId === 'expanded-capabilities-1');
    const independentReport = reports.find(report => report.suiteId === 'independent-holdouts-1');
    assert.ok(capabilityReport && independentReport?.holdout);
    completedFixture = { ...stages, teacherModelId: ready.teacherModelId, sourcePacketId: ready.sourcePacketId, domain: ready.domain,
      jobId, packetId, modelId, trainingRunId, capabilityReportId: capabilityReport.id, independentReportId: independentReport.id,
      commands: [...ready.commands, ...run.commands], milestones: [...ready.milestones, ...run.milestones],
      inheritedQueuedCommands: ready.inheritedQueuedCommands, originalWeek: ready.originalWeek, originalChecksum: ready.originalChecksum,
      minimumCashCents: Math.min(ready.minimumCashCents, run.minimumCashCents) };
  }
  return structuredClone(completedFixture);
}
