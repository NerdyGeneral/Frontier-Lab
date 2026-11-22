import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../src/content/catalog';
import type { CommandPayload, GameState } from '../../src/contracts/types';
import { submitCommand } from '../../src/core/engine';
import { deserializeState } from '../../src/core/snapshot';
import { facilitySpecializationResearchReady, getFacilitySpecializationAtWeek } from '../../src/modules/facility-specialization';
import { NaturalBusinessCampaign } from './wave5-business';

export interface FacilityReadyFixture {
  state: GameState; facilityId: string; originalWeek: number; originalChecksum: string;
  commands: NaturalBusinessCampaign['commands']; milestones: NaturalBusinessCampaign['milestones']; minimumCashCents: number;
}
export type FacilityFixtureStage = 'beforeRetrofit' | 'building' | 'ready' | 'servingActive' | 'switching' | 'trainingReady' | 'trainingActive';
export interface FacilityFixture extends Omit<FacilityReadyFixture, 'state'> {
  servingId: string; trainingId: string;
  beforeRetrofit: GameState; building: GameState; ready: GameState; servingActive: GameState;
  switching: GameState; trainingReady: GameState; trainingActive: GameState;
}
export interface FacilityTrainingFixture {
  profile: 'serving' | 'training'; facilityId: string; runId: string;
  beforeTraining: GameState; working: GameState; commands: NaturalBusinessCampaign['commands'];
  milestones: NaturalBusinessCampaign['milestones']; minimumCashCents: number;
}
export interface FacilityPublicServingFixture {
  facilityId: string; rackId: string; relocationId: string;
  beforeChange: GameState; constrained: GameState; efficient: GameState;
  constrainedCommands: NaturalBusinessCampaign['commands']; efficientCommands: NaturalBusinessCampaign['commands'];
}
let readyCache: FacilityReadyFixture | undefined;
let flowCache: FacilityFixture | undefined;
const trainingCache = new Map<'serving' | 'training', FacilityTrainingFixture>();
let publicServingCache: FacilityPublicServingFixture | undefined;

/** Uses the same command IDs as the application, so exported stages are also
 * a deterministic browser oracle. No company or resource readiness is injected. */
class ApplicationCampaign extends NaturalBusinessCampaign {
  override queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload, CONTENT);
    assert.equal(result.accepted, true, `Week ${this.week}, ${payload.kind}: ${result.reason?.message}`);
    const id = result.commandId!;
    this.commands.push({ week: this.week, id, payload: structuredClone(payload) }); this.state = result.state;
    return id;
  }
}

/** Published W579 company pays for S5 with its real site and staff. */
export function getFacilityReadyFixture(): FacilityReadyFixture {
  if (!readyCache) {
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const raw = readFileSync(join(directory, 'wave27-appliance-published.json'), 'utf8'), loaded = deserializeState(raw);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    const run = new ApplicationCampaign(loaded.state, 'wave28-facility-ready'); run.mark('Published W579 company');
    assert.equal(run.state.queuedCommands.length, 0, 'Published seed must have a settled reviewed queue.');
    const site = Object.values(run.state.slices.compute.facilities).find(item => item.companyId === run.state.playerCompanyId && item.status === 'active');
    assert.ok(site, 'The published company must have a commissioned owned facility.');
    run.founder('infrastructure'); run.step(); run.discover('S5'); run.mark('Paid Facility specialization available');
    assert.equal(facilitySpecializationResearchReady(run.state), true);
    assert.equal(run.state.slices.compute.facilitySpecializations, undefined, 'Research alone must not install a free site profile.');
    readyCache = { state: run.state, facilityId: site.id, originalWeek: loaded.state.week, originalChecksum: JSON.parse(raw).checksum,
      commands: run.commands, milestones: run.milestones, minimumCashCents: run.minimumCashCents };
  }
  return structuredClone(readyCache);
}

/** Two separately funded ordinary retrofits prove old-profile continuity and
 * a single, later boundary at which benefit and tradeoff change together. */
export function getFacilityFixture(onStage?: (stage: FacilityFixtureStage, state: GameState) => void): FacilityFixture {
  if (!flowCache) {
    const ready = getFacilityReadyFixture(), run = new ApplicationCampaign(ready.state, 'wave28-facility-flow');
    const stages = {} as Pick<FacilityFixture, FacilityFixtureStage>;
    const save = (stage: FacilityFixtureStage) => { stages[stage] = structuredClone(run.state); onStage?.(stage, structuredClone(run.state)); };
    save('beforeRetrofit');
    const servingCommand = run.queue({ kind: 'start_facility_specialization', facilityId: ready.facilityId, profile: 'serving' });
    const servingId = 'facility-specialization:' + servingCommand;
    run.step(); save('building');
    run.until(state => state.slices.compute.facilitySpecializations![servingId].status === 'ready', 16, 'Paid serving profile qualification'); save('ready');
    run.step(); assert.equal(getFacilitySpecializationAtWeek(run.state, ready.facilityId)?.id, servingId);
    run.mark('Serving profile benefit and training ceiling active'); save('servingActive');
    const trainingCommand = run.queue({ kind: 'start_facility_specialization', facilityId: ready.facilityId, profile: 'training' });
    const trainingId = 'facility-specialization:' + trainingCommand;
    run.step(); save('switching');
    run.until(state => state.slices.compute.facilitySpecializations![trainingId].status === 'ready', 16, 'Separately paid training replacement'); save('trainingReady');
    assert.equal(getFacilitySpecializationAtWeek(run.state, ready.facilityId)?.id, servingId);
    run.step(); assert.equal(getFacilitySpecializationAtWeek(run.state, ready.facilityId)?.id, trainingId);
    run.mark('Training profile benefit and serving ceiling active'); save('trainingActive');
    const { state: _state, ...metadata } = ready; void _state;
    flowCache = { ...metadata, ...stages, servingId, trainingId, commands: [...ready.commands, ...run.commands],
      milestones: [...ready.milestones, ...run.milestones], minimumCashCents: Math.min(ready.minimumCashCents, run.minimumCashCents) };
  } else if (onStage) for (const stage of ['beforeRetrofit', 'building', 'ready', 'servingActive', 'switching', 'trainingReady', 'trainingActive'] as const)
    onStage(stage, structuredClone(flowCache[stage]));
  return structuredClone(flowCache);
}

/** An additional paid foundation needs 24 MU, so its first actual update must
 * span connected racks. Both profile branches use the same evidence and recipe;
 * the campaign keeps ordinary Chat, API and enterprise obligations running. */
export function getFacilityTrainingFixture(profile: 'serving' | 'training' = 'training'): FacilityTrainingFixture {
  if (!trainingCache.has(profile)) {
    const base = getFacilityFixture(), beforeTraining = profile === 'serving' ? base.servingActive : base.trainingActive;
    const run = new ApplicationCampaign(beforeTraining, 'wave28-facility-training');
    run.founder('research');
    const commandId = run.queue({ kind: 'start_training', recipeId: 'medium-foundation', baseModelId: CONTENT.seedModel.id,
      packetId: 'curated-natural-business-command-124', packetIds: ['curated-natural-business-command-124',
        'curated-natural-business-command-111', 'curated-natural-business-command-54'], profile: 'ambitious' });
    const runId = 'training-' + commandId;
    run.until(state => !!state.slices.models.trainingRuns[runId]
      && state.slices.models.trainingRuns[runId].preparationCompleted === state.slices.models.trainingRuns[runId].plan!.preparationRequired,
    10, 'Paid foundation design with actual research staff');
    run.founder('ml');
    run.until(state => (state.slices.models.trainingRuns[runId]?.completedWork ?? 0) > 0, 12, 'Actual compatible cross-rack foundation update');
    run.mark('Paid research design followed by real cross-rack training');
    trainingCache.set(profile, { profile, facilityId: base.facilityId, runId, beforeTraining, working: run.state,
      commands: run.commands, milestones: run.milestones, minimumCashCents: run.minimumCashCents });
  }
  return structuredClone(trainingCache.get(profile)!);
}

/** Two independent ordinary continuations expose placement, not free profile
 * capacity. Cloud reduction alone strands some Chat demand. A separately paid
 * move of the existing eighth rack creates one large enough owned pool. */
export function getFacilityPublicServingFixture(): FacilityPublicServingFixture {
  if (!publicServingCache) {
    const base = getFacilityFixture(), beforeChange = base.servingActive;
    const constrained = new ApplicationCampaign(beforeChange, 'wave28-facility-cloud-constrained');
    constrained.queue({ kind: 'allocate_compute', serving: 128_000_000_000, development: 0, research: 0 }); constrained.step();
    constrained.queue({ kind: 'set_cloud_capacity', cu: 64_000_000_000 }); constrained.step();

    const efficient = new ApplicationCampaign(beforeChange, 'wave28-facility-cloud-efficient');
    const rack = Object.values(efficient.state.slices.compute.racks).find(item => item.companyId === efficient.state.playerCompanyId
      && item.location === 'colocation' && item.status === 'installed' && item.hardwareId === 'training');
    assert.ok(rack, 'The paid seed must retain its existing eighth training GPU rack in colocation.');
    const moveId = efficient.queue({ kind: 'start_rack_relocation', rackId: rack.id, destination: base.facilityId });
    const relocationId = 'rack-relocation:' + moveId;
    efficient.until(state => state.slices.compute.racks[rack.id].location === base.facilityId
      && state.slices.compute.racks[rack.id].status === 'installed', 10, 'Paid relocation of the existing eighth rack');
    efficient.queue({ kind: 'allocate_compute', serving: 128_000_000_000, development: 0, research: 0 }); efficient.step();
    efficient.queue({ kind: 'set_cloud_capacity', cu: 64_000_000_000 }); efficient.step();
    publicServingCache = { facilityId: base.facilityId, rackId: rack.id, relocationId, beforeChange,
      constrained: constrained.state, efficient: efficient.state, constrainedCommands: constrained.commands, efficientCommands: efficient.commands };
  }
  return structuredClone(publicServingCache);
}
