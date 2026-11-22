import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { hasResearch } from '../src/modules/research';
import { systemRollout } from '../src/modules/applied-research';
import { getCapacityForecast } from '../src/modules/capacity-forecast';
import { getTrainingPreview } from '../src/modules/lab-planner';

test('W6-O01: a published, naturally funded business adopts all three methods through ordinary commands', () => {
  const source = readFileSync(join(__dirname, 'fixtures/wave5-snapshot.json'), 'utf8');
  const loaded = deserializeState(source); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  let state = loaded.state;
  const owner = state.playerCompanyId, commands: { week: number; id: string; payload: CommandPayload }[] = [];
  const queue = (payload: CommandPayload) => {
    const result = submitCommand(state, payload); assert.ok(result.accepted, result.reason?.message); state = result.state;
    commands.push({ week: state.week, id: result.commandId!, payload }); return result.commandId!;
  };
  const step = () => {
    const pending = state.queuedCommands.filter(command => command.companyId === owner).map(command => command.id);
    const result = advanceWeek(state); assert.ok(result.accepted, result.reason?.message); state = result.state;
    for (const id of pending) assert.equal(state.commandReceipts[id].status, 'accepted', state.commandReceipts[id].reason?.message);
    assert.equal(state.slices.company.companies[owner].arrearsCents, 0);
  };
  const until = (done: () => boolean, limit = 40) => { for (let n = 0; n < limit && !done(); n++) step(); assert.ok(done(), 'Ordinary paid work failed to complete.'); };
  const product = Object.values(state.slices.products.offers).find(offer => offer.companyId === owner && offer.kind === 'business-docs')!;
  assert.ok(product);
  const packet = Object.values(state.slices.data.packets).find(data => data.name === 'Documents specialist pack · curated r1')!;
  const broad = Object.values(state.slices.data.packets).find(data => data.name === 'Broad corpus · edition 1 · curated r2')!;
  assert.ok(packet && broad);
  queue({ kind: 'set_cloud_capacity', cu: 112 * U }); step();
  queue({ kind: 'allocate_compute', serving: 100 * U, development: 6 * U, research: 6 * U });
  for (const researchId of ['R2A', 'R6A', 'R12A']) queue({ kind: 'start_research', researchId });
  until(() => ['R2A', 'R6A', 'R12A'].every(id => hasResearch(state, owner, id)));
  queue({ kind: 'start_system_rollout', method: 'deduplication' });
  queue({ kind: 'start_system_rollout', method: 'capacity-forecast' });
  queue({ kind: 'install_retrieval', productId: product.id, packetId: packet.id });
  until(() => systemRollout(state, owner, 'deduplication')?.status === 'active'
    && systemRollout(state, owner, 'capacity-forecast')?.status === 'active'
    && state.slices.products.retrievalInstalls[product.id]?.status === 'active');
  queue({ kind: 'install_product_efficiency', productId: product.id, method: 'evidence-links' });
  until(() => !!state.slices.products.lastUsage[product.id]?.evidence);
  // Secondary Data points now cover this old company's original shortage. Create a real
  // upkeep constraint before buying the additional team, using accepted allocations.
  for (const member of staffContributors(state, 'data')) queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  queue({ kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: U, hardware: 0 } });
  step();
  const understaffed = structuredClone(state.slices.products.lastUsage[product.id].evidence!);
  assert.equal(understaffed.freshnessBps, 0);
  assert.ok(understaffed.checkedRequests > 0 && understaffed.withheldRequests > 0);
  for (let n = 0; n < 5; n++) queue({ kind: 'hire_staff', role: 'data' });
  until(() => state.slices.products.lastUsage[product.id].evidence!.freshnessBps === 10000);
  const staffed = structuredClone(state.slices.products.lastUsage[product.id].evidence!);
  assert.ok(staffed.supportBps > understaffed.supportBps, 'Paid data upkeep must improve actual evidence support.');
  const cleanupCommand = queue({ kind: 'deduplicate_data', packetId: broad.id });
  const cleanedId = 'deduplicated-' + cleanupCommand;
  until(() => !!state.slices.data.packets[cleanedId]?.prepared);
  const cleanPreview = getTrainingPreview(state, owner, { baseModelId: CONTENT.seedModel.id, packetId: cleanedId, recipeId: CONTENT.firstTraining.id });
  const dirtyPreview = getTrainingPreview(state, owner, { baseModelId: CONTENT.seedModel.id, packetId: broad.id, recipeId: CONTENT.firstTraining.id });
  assert.ok(cleanPreview && dirtyPreview && cleanPreview.workCUw < dirtyPreview.workCUw);
  const beforePlan = canonicalStateHash(state), forecast = getCapacityForecast(state);
  assert.equal(canonicalStateHash(state), beforePlan); assert.equal(forecast.scenarios.length, 2);
  assert.equal(forecast.scenarios[0].rows.length, 12);
  assert.ok(forecast.scenarios[0].rows.every(row => row.licenseCommitments >= 1));
  assert.deepEqual(validateState(state), []);
  const restored = deserializeState(serializeState(state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.equal(canonicalStateHash(restored.state), beforePlan);
  const company = state.slices.company.companies[owner], usage = state.slices.products.lastUsage[product.id];
  const receipt = { provenance: 'Ordinary-command continuation of the published natural business campaign; no player state grants.',
    sourceCommit: '0dea6af3946645d25e33b81430b86edf380cebcd', sourceWeek: 252, sourceChecksum: JSON.parse(source).checksum,
    endWeek: state.week, checksum: canonicalStateHash(state), cashCents: company.cashCents,
    revenueCents: company.lastWeek.revenueCents, operatingExpenseCents: company.lastWeek.operatingExpenseCents,
    commands, productId: product.id, cleanedId, understaffed, staffed, settledEvidence: usage.evidence,
    trainingWorkBeforeCUw: dirtyPreview.workCUw, trainingWorkAfterCUw: cleanPreview.workCUw,
    forecast: forecast.scenarios.map(scenario => ({ name: scenario.name, growthBps: scenario.growthBps,
      firstPressureWeek: scenario.firstPressureWeek, firstWeek: scenario.rows[0], lastWeek: scenario.rows.at(-1) })) };
  for (const [path, value] of [[process.env.OPERATIONS_CAMPAIGN_EXPORT, serializeState(state)],
    [process.env.OPERATIONS_CAMPAIGN_RECEIPT, JSON.stringify(receipt, null, 2) + '\n']] as const) if (path) {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value);
  }
});
