import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { deserializeState } from '../src/core/snapshot';
import { getComputePools, getPoolWorkCostRate } from '../src/modules/compute-pools';
import { assertFacilityTariffGrant, assertFacilityTariffPool, facilityTariffBinding, validatedFacilityRate } from '../src/modules/facility-tariffs';
import { rehearsalReceiptKey } from '../src/modules/release-rehearsals';
import { runtimeGuardrailReceiptKey } from '../src/modules/runtime-guardrails';
import { batchReceiptKey } from '../src/modules/batch-inference';
import { syntheticReceiptKey } from '../src/modules/synthetic-data';
import { getFacilityFixture } from './fixtures/wave28-facilities';

const inference = { category: 'development' as const, workloadKind: 'inference' as const };
const general = { category: 'development' as const, workloadKind: 'general' as const };
const keys = [rehearsalReceiptKey, runtimeGuardrailReceiptKey, batchReceiptKey, syntheticReceiptKey];

test('W28-T01: paid serving profiles apply only to eligible owned inference and preserve legacy tariff keys', () => {
  const fixture = getFacilityFixture(), state = fixture.servingActive;
  const pool = getComputePools(state).find(item => item.location === fixture.facilityId)!;
  assert.equal(pool.specialization?.id, fixture.servingId);
  const base = { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps: pool.servingBps, rateCentsPerCUw: pool.variableCentsPerCUw };
  for (const key of keys) assert.equal(key(base), canonicalStateHash(base), 'Every historical key remains byte-equivalent.');
  const receipt = { ...base, rateCentsPerCUw: getPoolWorkCostRate(pool, inference), ...facilityTariffBinding(pool, inference) };
  assert.equal(receipt.rateCentsPerCUw, Math.floor(base.rateCentsPerCUw * 0.9));
  assert.equal(validatedFacilityRate(state, receipt, state.playerCompanyId, base.rateCentsPerCUw, state.week, state.week, inference, pool.id), receipt.rateCentsPerCUw);
  for (const key of keys) {
    assert.notEqual(key(receipt), key(base));
    assert.notEqual(key(receipt), key({ ...receipt, facilityTariff: { ...receipt.facilityTariff!, specializationId: 'different-paid-retrofit' } }));
    assert.notEqual(key(receipt), key({ ...receipt, facilityTariff: { ...receipt.facilityTariff!, poolId: 'owned:another-site:' + pool.hardwareId } }));
  }
  assert.deepEqual(facilityTariffBinding(pool, general), {});
  assert.equal(getPoolWorkCostRate(pool, general), base.rateCentsPerCUw);
  assert.equal(getPoolWorkCostRate(pool, { category: 'development', workloadKind: 'training' }), base.rateCentsPerCUw);
  const cloud = getComputePools(state).find(item => item.ownership === 'cloud')!;
  assert.deepEqual(facilityTariffBinding(cloud, inference), {});
});

test('W28-T02: historical discounted receipts survive switching but cannot move to another pool, company or week', () => {
  const fixture = getFacilityFixture(), original = fixture.servingActive, current = fixture.trainingActive;
  const pool = getComputePools(original).find(item => item.location === fixture.facilityId)!;
  const receipt = { hardwareId: pool.hardwareId, ownership: pool.ownership, ...facilityTariffBinding(pool, inference) };
  const rate = (first: number, last = first, proof = receipt, companyId = current.playerCompanyId) =>
    validatedFacilityRate(current, proof, companyId, pool.variableCentsPerCUw, first, last, inference, pool.id);
  assert.equal(rate(original.week, fixture.trainingReady.week), getPoolWorkCostRate(pool, inference));
  assert.throws(() => rate(original.week - 1));
  assert.throws(() => rate(original.week, current.week));
  assert.throws(() => rate(current.week));
  assert.throws(() => rate(original.week, original.week, receipt, 'foreign-company'));
  assert.throws(() => rate(original.week, original.week, { ...receipt, facilityTariff: { ...receipt.facilityTariff!, poolId: 'owned:colocation:' + pool.hardwareId } }));
  assert.throws(() => assertFacilityTariffPool(receipt, 'owned:colocation:' + pool.hardwareId));
  const discounted = { ...receipt, rateCentsPerCUw: getPoolWorkCostRate(pool, inference) };
  assert.doesNotThrow(() => assertFacilityTariffGrant(current, discounted, current.playerCompanyId, pool.id, original.week, inference));
  const stripped = { hardwareId: pool.hardwareId, ownership: pool.ownership, rateCentsPerCUw: pool.variableCentsPerCUw };
  assert.throws(() => assertFacilityTariffGrant(current, stripped, current.playerCompanyId, pool.id, original.week, inference), /missing/);
  assert.doesNotThrow(() => assertFacilityTariffGrant(current, stripped, current.playerCompanyId, pool.id, original.week - 1, inference));
  assert.throws(() => validatedFacilityRate(current, receipt, current.playerCompanyId, pool.variableCentsPerCUw, original.week, original.week, general));
  assert.throws(() => validatedFacilityRate(current, { hardwareId: pool.hardwareId, ownership: pool.ownership }, current.playerCompanyId, pool.variableCentsPerCUw, original.week, original.week, inference, pool.id), /missing/);
  const currentPool = getComputePools(current).find(item => item.id === pool.id)!;
  assert.deepEqual(facilityTariffBinding(currentPool, inference), {});
  assert.equal(getPoolWorkCostRate(currentPool, inference), pool.variableCentsPerCUw);
  assert.equal(validatedFacilityRate(current, { hardwareId: 'general', ownership: 'cloud' }, current.playerCompanyId, CONTENT.opening.rentCentsPerCUWeek, current.week, current.week, inference, 'general-cloud'), CONTENT.opening.rentCentsPerCUWeek);
});

test('W28-T03: removing paid facility proof from an actual rehearsal cannot restore the base tariff under a valid checksum', () => {
  const state = getFacilityFixture().servingActive;
  const queued = submitCommand(state, { kind: 'start_release_rehearsal', productId: 'product:natural-business-command-8', candidateModelId: 'model-natural-business-command-4' });
  assert.equal(queued.accepted, true, queued.reason?.message);
  const stepped = advanceWeek(queued.state); assert.equal(stepped.accepted, true, stepped.reason?.message);
  assert.deepEqual(validateState(stepped.state), []);
  const forged = structuredClone(stepped.state), rehearsal = forged.slices.products.releaseRehearsals!['release-rehearsal:' + queued.commandId];
  for (const arm of Object.values(rehearsal.arms)) {
    const oldKey = arm.latestGrant!.receiptKey, receipt = arm.workReceipts[oldKey];
    assert.equal(receipt.rateCentsPerCUw, 6750); assert.ok(receipt.facilityTariff);
    delete receipt.facilityTariff; receipt.rateCentsPerCUw = 7500;
    const newKey = rehearsalReceiptKey(receipt); delete arm.workReceipts[oldKey]; arm.workReceipts[newKey] = receipt;
    arm.latestGrant!.receiptKey = newKey;
  }
  assert.ok(validateState(forged).some(error => /facility|profile/i.test(error.message)));
  const imported = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: forged.schemaVersion,
    contentVersion: forged.contentVersion, checksum: canonicalStateHash(forged), state: forged }));
  assert.equal(imported.ok, false);
});
