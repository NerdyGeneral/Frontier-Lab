import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/contracts/types';
import { RESOURCE_SCALE as U } from '../../src/contracts/types';
import type { CanaryOptions } from '../../src/contracts/wave27-canary';
import { deserializeState } from '../../src/core/snapshot';
import { canaryUnsupportedReason, getCanaryView } from '../../src/modules/release-canary';
import { getQualifiedReleaseRehearsal } from '../../src/modules/release-rehearsals';
import { activeEfficiency } from '../../src/modules/product-efficiency';
import { currentRuntimeGuardrail } from '../../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './wave5-business';

export type CanaryFixtureKind = 'regression' | 'qualifying' | 'api';
export interface CanaryReadyFixture {
  state: GameState; productId: string; sourceModelId: string; candidateModelId: string; releaseId: string;
  options: CanaryOptions; commands: NaturalBusinessCampaign['commands']; milestones: NaturalBusinessCampaign['milestones'];
  inheritedQueuedCommands: GameState['queuedCommands']; originalWeek: number; originalChecksum: string; minimumCashCents: number;
}
export type CanaryFixtureStage = 'beforeCanary' | 'scheduled' | 'observed' | 'restored';
export interface CanaryFixture extends Omit<CanaryReadyFixture, 'state'> {
  beforeCanary: GameState; scheduled: GameState; observed: GameState; restored: GameState; canaryId: string;
}
const readyCache = new Map<CanaryFixtureKind, CanaryReadyFixture>();
const flowCache = new Map<CanaryFixtureKind, CanaryFixture>();
let baseCache: Omit<CanaryReadyFixture, 'productId' | 'sourceModelId' | 'candidateModelId' | 'releaseId' | 'options'> | undefined;

/** The published company pays for S3, then rehearses and prepares ordinary
 * evaluated models. No cash, model scores, staff, research or grants are added. */
function baseFixture(): NonNullable<typeof baseCache> {
  if (!baseCache) {
    const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests', 'fixtures');
    const raw = readFileSync(join(directory, 'wave16-snapshot.json'), 'utf8'), loaded = deserializeState(raw);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
    const inheritedQueuedCommands = structuredClone(loaded.state.queuedCommands), originalWeek = loaded.state.week;
    const run = new NaturalBusinessCampaign(loaded.state, 'wave27-canary-ready');
    run.mark('Published company'); run.step(); run.mark('Inherited batch queue settled');
    const serving = run.fleet.allocation.serving, cloud = Math.max(run.fleet.cloudCU, serving + 16 * U - run.fleet.ownedCU);
    if (cloud > run.fleet.cloudCU) { run.queue({ kind: 'set_cloud_capacity', cu: cloud }); run.step(); }
    run.queue({ kind: 'allocate_compute', serving, development: 8 * U, research: 8 * U }); run.founder('research'); run.step();
    run.discover('S3'); run.mark('Paid Release telemetry available');
    baseCache = { state: run.state, commands: run.commands, milestones: run.milestones, inheritedQueuedCommands,
      originalWeek, originalChecksum: JSON.parse(raw).checksum, minimumCashCents: run.minimumCashCents };
  }
  return structuredClone(baseCache);
}

export function getCanaryReadyFixture(kind: CanaryFixtureKind = 'regression'): CanaryReadyFixture {
  if (!readyCache.has(kind)) {
    const base = baseFixture(), run = new NaturalBusinessCampaign(base.state, 'wave27-canary-' + kind + '-ready');
    const productId = run.offers().find(item => item.kind === (kind === 'api' ? 'developer-api' : 'basic-chat'))!.id;
    if (kind === 'regression') {
      run.queue({ kind: 'upgrade_product', productId, modelId: 'model-natural-business-command-159' });
      run.until(state => state.slices.products.offers[productId].status === 'active'
        && state.slices.products.deployments[state.slices.products.offers[productId].deploymentId].modelId === 'model-natural-business-command-159', 12, 'Paid stronger incumbent deployment');
      run.mark('Stronger incumbent serving');
    }
    for (const method of ['routing', 'prefix-cache', 'evidence-links'] as const) if (activeEfficiency(run.state, productId, method))
      run.queue({ kind: 'set_product_efficiency_enabled', productId, method, enabled: false });
    if (currentRuntimeGuardrail(run.state, productId)?.enabled) run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: false });
    if (run.state.queuedCommands.length) run.step();
    assert.equal(canaryUnsupportedReason(run.state, productId), undefined);
    const candidateModelId = kind === 'regression' ? 'model-natural-business-command-4'
      : kind === 'api' ? 'variant:wave14-natural-command-2' : 'model-natural-business-command-68';
    const sourceModelId = run.state.slices.products.deployments[run.state.slices.products.offers[productId].deploymentId].modelId;
    run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId });
    run.until(state => !!getQualifiedReleaseRehearsal(state, productId, candidateModelId), 20, 'Paid paired release rehearsal');
    const preparation = run.queue({ kind: 'start_prepared_release', productId, candidateModelId }), releaseId = 'prepared-release:' + preparation;
    run.until(state => getCanaryView(state, productId).releases.some(item => item.releaseId === releaseId && item.eligible), 20, 'Paid prepared release');
    run.mark('Paid prepared candidate before canary');
    readyCache.set(kind, { ...base, state: run.state, productId, sourceModelId, candidateModelId, releaseId,
      options: { releaseId, shareBps: 1000, sampleFloor: 100, budgetCUw: 4 * U },
      commands: [...base.commands, ...run.commands], milestones: [...base.milestones, ...run.milestones], minimumCashCents: Math.min(base.minimumCashCents, run.minimumCashCents) });
  }
  return structuredClone(readyCache.get(kind)!);
}

export function getCanaryFixture(kind: CanaryFixtureKind = 'regression', onStage?: (stage: CanaryFixtureStage, state: GameState) => void): CanaryFixture {
  if (!flowCache.has(kind)) {
    const ready = getCanaryReadyFixture(kind), run = new NaturalBusinessCampaign(ready.state, 'wave27-canary-' + kind + '-flow');
    const stages = {} as Pick<CanaryFixture, CanaryFixtureStage>;
    const save = (stage: CanaryFixtureStage) => { stages[stage] = structuredClone(run.state); onStage?.(stage, structuredClone(run.state)); };
    save('beforeCanary'); const commandId = run.queue({ kind: 'start_release_canary', ...ready.options }), canaryId = 'canary:' + commandId;
    run.step(); save('scheduled');
    run.until(state => ['stopped', 'qualified'].includes(state.slices.products.canaryReleases![canaryId].status), 10, 'Bounded live cohort result');
    save('observed'); run.step(); save('restored');
    const { state: _state, ...metadata } = ready; void _state;
    flowCache.set(kind, { ...metadata, ...stages, canaryId, commands: [...ready.commands, ...run.commands],
      milestones: [...ready.milestones, ...run.milestones], minimumCashCents: Math.min(ready.minimumCashCents, run.minimumCashCents) });
  } else if (onStage) for (const stage of ['beforeCanary', 'scheduled', 'observed', 'restored'] as const) onStage(stage, structuredClone(flowCache.get(kind)![stage]));
  return structuredClone(flowCache.get(kind)!);
}
