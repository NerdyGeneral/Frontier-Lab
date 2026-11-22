import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { qualifiesForEnding } from '../src/modules/campaign-progress';
import { playNaturalBusiness } from './fixtures/wave5-business';

test('W5-B01: an ordinary company earns platform and specialist endings with real customers and a renewing license', () => {
  const run = playNaturalBusiness(process.env.FRONTIER_CAMPAIGN_REPORT ? receipt => console.log(JSON.stringify(receipt)) : undefined);
  const { lab, consumerModelId, apiModelId, businessModelId } = run;
  const { state } = lab, { platform, specialist } = state.slices.campaign.endings;
  assert.ok(platform && specialist);
  for (const ending of [platform, specialist]) {
    assert.equal(ending.proof.length, 12);
    for (const [index, row] of ending.proof.entries()) {
      assert.equal(row.week, ending.achievedWeek - 11 + index);
      assert.equal(qualifiesForEnding(row, ending.id), true);
      assert.equal(row.arrearsCents, 0);
      assert.ok(row.cashCents >= row.baseCostCents * 8);
      assert.ok(row.operatingExpenseCents > 0, 'Rented GPUs and employed staff remain paid during the proof.');
      assert.ok(row.serviceBps >= 9800);
    }
  }
  assert.ok(platform.proof.every(row => row.consumerAccounts >= 600 && row.developerAccounts >= 60 && row.trustBps >= 7500));
  assert.ok(specialist.proof.every(row => row.businessOrganizations >= 12 && row.specialistModelId === businessModelId && row.sustainedContracts === 1));
  assert.ok(lab.week <= 300, 'The natural route must remain a bounded campaign rather than an unlimited idle grind.');
  assert.ok(lab.minimumCashCents > 0, 'Every ordinary week must remain solvent, including the opening and capital projects.');

  const business = state.slices.models.versions[businessModelId];
  assert.equal(business.family, 'medium');
  assert.equal(business.scenarioStart, undefined);
  assert.ok(business.capabilityBps.documents >= 6500 && business.reliabilityBps >= 9200);
  const foundation = Object.values(state.slices.models.trainingRuns).find(run => run.companyId === state.playerCompanyId && run.recipeId === 'medium-foundation');
  assert.ok(foundation?.plan);
  assert.equal(foundation.status, 'complete');
  assert.equal(foundation.completedWork, 240 * U);
  assert.equal(foundation.requiredMemory, 24 * U);
  assert.equal(foundation.preparationCompleted, 6 * U);
  assert.equal(foundation.plan.corpus.broadUnits, 500);
  assert.ok(Object.values(foundation.plan.corpus.qualityBps).every(quality => quality === 9500));
  for (const modelId of [consumerModelId, apiModelId, businessModelId]) {
    const model = state.slices.models.versions[modelId];
    assert.equal(state.slices.models.trainingRuns[model.trainingRunId!].status, 'complete');
    assert.equal(model.status, 'released');
    assert.ok(model.behavior && model.behavior.confidentErrorBps < 1000, 'Each paid service uses its own calibrated evaluated version.');
    assert.ok(Object.values(state.slices.models.reports).some(report => report.modelId === modelId && report.suiteId === 'expanded-capabilities-1' && report.heldOut));
  }

  const contracts = Object.values(state.slices.products.commercialContracts).filter(contract => contract.companyId === state.playerCompanyId);
  assert.equal(contracts.length, 1, 'One continuously delivered named commitment must be sufficient.');
  const license = contracts[0];
  assert.equal(license.customerId, 'vector-studio');
  assert.equal(license.modelId, apiModelId);
  assert.equal(license.contractKind, 'customer-hosted');
  assert.equal(license.rights.weights, true);
  assert.ok(license.termIndex > 1);
  assert.equal(license.autoRenew, true);
  assert.equal(license.breachWeeks, 0);
  assert.equal(license.lifetimeCreditsCents, 0);
  assert.ok(license.lifetimeBilledCents > 12 * license.weeklyPriceCents);
  assert.equal(license.lastUsage?.physicalWorkCUw, 0, 'Customers provide inference compute for the fixed-weight license.');
  const proofWeeks = new Set(specialist.proof.map(row => row.week));
  const renewalProof = lab.contractWeeks.filter(row => proofWeeks.has(row.week) && row.termIndex > 1 && row.termWeeksServed < 4);
  assert.ok(renewalProof.length > 0, 'The twelve-week proof must cross a real renewal without erasing earned tenure.');
  assert.ok(renewalProof.every(row => row.billedCents === license.weeklyPriceCents && row.serviceBps >= 9800));
  const termStarts = lab.contractWeeks.filter((row, index) => index === 0 || row.termIndex !== lab.contractWeeks[index - 1].termIndex);
  for (const [index, row] of termStarts.entries()) {
    assert.equal(row.week, row.termStartedWeek);
    assert.equal(row.termWeeksServed, 1);
    assert.equal(row.termEndsWeek! - row.termStartedWeek!, 12);
    if (index) assert.equal(row.termStartedWeek, termStarts[index - 1].termEndsWeek);
  }
  const actualProofRenewals = termStarts.filter(row => row.termIndex > 1 && proofWeeks.has(row.week));
  assert.ok(actualProofRenewals.length > 0, 'A real term boundary, not only a young term, must fall inside the specialist proof.');

  assert.equal(Object.keys(state.slices.markets.rivals).length, 3);
  assert.ok(Object.values(state.slices.markets.rivals).every(rival => rival.lastActionWeek > 0));
  assert.ok(lab.commands.some(command => command.payload.kind === 'hire_staff') && lab.commands.some(command => command.payload.kind === 'curate_data'));
  assert.deepEqual(validateState(state), []);
  const loaded = deserializeState(serializeState(state));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(state));
  const afterOriginal = advanceWeek(state), afterReload = advanceWeek(loaded.state);
  assert.equal(afterOriginal.accepted, true);
  assert.equal(afterReload.accepted, true);
  assert.equal(canonicalStateHash(afterOriginal.state), canonicalStateHash(afterReload.state));
  assert.deepEqual(afterReload.state.slices.campaign.endings, state.slices.campaign.endings);
  const evidence = {
    result: 'natural-business',
    source: { entry: 'createInitialState(CONTENT)', seed: state.seed, buildVersion: state.buildVersion,
      contentVersion: state.contentVersion, schemaVersion: state.schemaVersion, initialCashCents: CONTENT.opening.cashCents,
      directStateMutation: false, externalFunding: false,
      rivals: Object.values(state.slices.markets.rivals).map(rival => ({ companyId: rival.companyId,
        lastActionWeek: rival.lastActionWeek, withdrawn: rival.withdrawn })) },
    reproduce: { test: 'npm test -- wave5-business', strategy: 'playNaturalBusiness()',
      exports: 'Set BUSINESS_CAMPAIGN_EXPORT to an absolute snapshot path and BUSINESS_CAMPAIGN_RECEIPT to an absolute metrics path.' },
    commands: lab.commands.length,
    commandKinds: lab.commands.reduce<Record<string, number>>((counts, command) => {
      counts[command.payload.kind] = (counts[command.payload.kind] ?? 0) + 1; return counts;
    }, {}),
    minimumCashCents: lab.minimumCashCents,
    cloudCU: lab.fleet.cloudCU / U,
    finalWeek: state.slices.campaign.history.at(-1),
    models: [consumerModelId, apiModelId, businessModelId].map(modelId => {
      const model = state.slices.models.versions[modelId];
      return { modelId, family: model.family, capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, behavior: model.behavior };
    }),
    foundation: { recipe: foundation.recipeId, usefulTrainingCUw: foundation.completedWork / U,
      physicalTrainingCUw: foundation.physicalWork / U, workspaceMU: foundation.requiredMemory / U,
      preparationStaffWeeks: foundation.preparationCompleted! / U, broadUnits: foundation.plan.corpus.broadUnits,
      qualityBps: foundation.plan.corpus.qualityBps },
    license: { customerId: license.customerId, contractKind: license.contractKind, modelId: license.modelId,
      signedWeek: license.signedWeek, weeklyPriceCents: license.weeklyPriceCents, lifetimeBilledCents: license.lifetimeBilledCents,
      lifetimeCreditsCents: license.lifetimeCreditsCents, playerInferenceWorkCUw: license.lastUsage!.physicalWorkCUw / U,
      terms: termStarts.map(row => ({ termIndex: row.termIndex, firstDeliveredWeek: row.termStartedWeek,
        scheduledLastDeliveryWeek: row.termEndsWeek! - 1, deliveredThroughWeek: Math.min(state.week, row.termEndsWeek! - 1), nextRenewalWeek: row.termEndsWeek })),
      actualRenewalWeeksInsideSpecialistProof: actualProofRenewals.map(row => row.week),
      maturitySensitiveProofWeeks: renewalProof.map(row => ({ week: row.week, termIndex: row.termIndex, termWeeksServed: row.termWeeksServed })),
      explanation: 'A successful term renews every 12 weeks. Term weeks 1–3 retain maturity earned by the prior fully delivered term. The actual renewal boundary is distinct from these maturity-sensitive weeks.' },
    endings: [platform, specialist].map(ending => ({ id: ending.id, achievedWeek: ending.achievedWeek,
      proofWindow: { firstWeek: ending.proof[0].week, lastWeek: ending.proof.at(-1)!.week, consecutiveWeeks: ending.proof.length },
      proof: ending.proof.map(row => ({ week: row.week, revenueCents: row.revenueCents, operatingExpenseCents: row.operatingExpenseCents,
        cashCents: row.cashCents, reserveRequiredCents: row.baseCostCents * 8, consumers: row.consumerAccounts,
        developers: row.developerAccounts, businesses: row.businessOrganizations, serviceBps: row.serviceBps,
        trustBps: row.trustBps, sustainedContracts: row.sustainedContracts })) })),
    stages: lab.milestones.map(({ consumers, developers, businesses, ...stage }) => ({ ...stage,
      nextWeekConsumerCohorts: consumers, nextWeekDeveloperCohorts: developers, nextWeekBusinessCohorts: businesses })),
    checkpoint: { week: state.week, checksum: canonicalStateHash(state), format: 'frontier-lab' },
  };
  if (process.env.FRONTIER_CAMPAIGN_REPORT) console.log(JSON.stringify(evidence));
  if (process.env.BUSINESS_CAMPAIGN_EXPORT) {
    mkdirSync(dirname(process.env.BUSINESS_CAMPAIGN_EXPORT), { recursive: true });
    writeFileSync(process.env.BUSINESS_CAMPAIGN_EXPORT, serializeState(state));
  }
  if (process.env.BUSINESS_CAMPAIGN_RECEIPT) {
    mkdirSync(dirname(process.env.BUSINESS_CAMPAIGN_RECEIPT), { recursive: true });
    writeFileSync(process.env.BUSINESS_CAMPAIGN_RECEIPT, JSON.stringify(evidence, null, 2) + '\n');
  }
});
