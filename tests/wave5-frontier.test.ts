import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { DATA_CATALOG, TRAINING_RECIPES } from '../src/content/wave2-lab';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { qualifiesForEnding } from '../src/modules/campaign-progress';
import { openNaturalBusiness } from './fixtures/wave5-business';
import { continueToFrontier } from './fixtures/wave5-frontier';

test('W5-F01: a command-driven company earns the frontier ending from the ordinary opening with rivals', () => {
  const opening = openNaturalBusiness().funded(30_000_000);
  const run = continueToFrontier(opening.state, process.env.FRONTIER_CAMPAIGN_REPORT ? receipt => console.log(JSON.stringify(receipt)) : undefined);
  const { state, modelId } = run, ending = state.slices.campaign.endings.frontier;
  assert.ok(ending);
  assert.equal(ending.proof.length, 8);
  for (const [index, week] of ending.proof.entries()) {
    assert.equal(week.week, ending.achievedWeek - 7 + index);
    assert.equal(qualifiesForEnding(week, 'frontier'), true);
    assert.equal(week.frontierModelId, modelId);
    assert.equal(week.arrearsCents, 0);
    assert.ok(week.developerAccounts > 0, 'The trained frontier must actually bill paid API customers.');
  }
  const model = state.slices.models.versions[modelId];
  const foundation = Object.values(state.slices.models.trainingRuns).find(run => run.companyId === state.playerCompanyId && run.recipeId === 'large-foundation');
  const behavior = Object.values(state.slices.models.reports).find(report => report.modelId === modelId && report.suiteId === 'behavior-cases-1');
  assert.equal(model.family, 'large');
  assert.equal(model.scenarioStart, undefined);
  assert.equal(state.slices.models.trainingRuns[model.trainingRunId!].status, 'complete');
  assert.ok(Math.min(...Object.values(model.capabilityBps)) >= 8000);
  assert.ok(model.reliabilityBps >= 9200);
  assert.ok(foundation && foundation.plan);
  assert.equal(foundation.status, 'complete');
  assert.equal(foundation.plan.profile, 'stable');
  assert.equal(foundation.requiredWork, 990 * U);
  assert.equal(foundation.completedWork, foundation.requiredWork);
  assert.ok(foundation.physicalWork > 0);
  assert.equal(foundation.requiredMemory, 72 * U);
  assert.equal(foundation.preparationCompleted, 20 * U);
  assert.equal(foundation.plan.corpus.broadUnits, 1500);
  assert.ok(Object.values(foundation.plan.corpus.qualityBps).every(quality => quality === 9500));
  assert.ok(behavior?.outcomes && behavior.outcomes.confidentErrors <= 5);
  assert.ok(run.minimumCashCents > 0);
  assert.equal(Object.values(state.slices.markets.rivals).length, 3);
  assert.ok(Object.values(state.slices.markets.rivals).every(rival => rival.lastActionWeek > 0), 'All authored rivals must have taken ordinary competitive actions.');
  assert.ok(opening.commands.length > 0 && run.commands.some(command => command.payload.kind === 'order_rack'));
  assert.deepEqual(validateState(state), []);
  const loaded = deserializeState(serializeState(state));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(state));
  const afterOriginal = advanceWeek(state), afterReload = advanceWeek(loaded.state);
  assert.equal(afterOriginal.accepted, true);
  assert.equal(afterReload.accepted, true);
  assert.equal(canonicalStateHash(afterOriginal.state), canonicalStateHash(afterReload.state));
  assert.deepEqual(afterReload.state.slices.campaign.endings.frontier, ending);
  const company = state.slices.company.companies[state.playerCompanyId];
  const playerRacks = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === state.playerCompanyId);
  const commands = [...opening.commands, ...run.commands];
  const evidence = {
    result: 'natural-frontier', source: { entry: 'createInitialState(CONTENT)', seed: state.seed,
      buildVersion: state.buildVersion, contentVersion: state.contentVersion, schemaVersion: state.schemaVersion,
      initialCashCents: CONTENT.opening.cashCents, rivals: Object.values(state.slices.markets.rivals).map(rival => ({
        companyId: rival.companyId, lastActionWeek: rival.lastActionWeek, withdrawn: rival.withdrawn,
      })), directStateMutation: false, externalFunding: false },
    reproduce: { test: 'npm test -- wave5-frontier', opening: 'openNaturalBusiness().funded(30_000_000)',
      continuation: 'continueToFrontier(opening.state)',
      exports: 'Set FRONTIER_CAMPAIGN_EXPORT to an absolute snapshot path and FRONTIER_CAMPAIGN_RECEIPT to an absolute metrics path.' },
    openingWeek: opening.week, achievedWeek: ending.achievedWeek,
    commands: commands.length, commandKinds: commands.reduce<Record<string, number>>((counts, command) => {
      counts[command.payload.kind] = (counts[command.payload.kind] ?? 0) + 1; return counts;
    }, {}),
    finances: { minimumContinuationCashCents: run.minimumCashCents, finalCashCents: company.cashCents,
      finalRevenueCents: company.lastWeek.revenueCents, finalOperatingExpenseCents: company.lastWeek.operatingExpenseCents,
      totalEarnedRevenueCents: company.earnedRevenueCents, totalOperatingExpenseCents: company.totalOperatingExpenseCents,
      purchasedHardwareCents: playerRacks.reduce((sum, rack) => sum + rack.purchaseCents, 0),
      purchasedDataCents: commands.reduce((sum, command) => {
        const payload = command.payload;
        return sum + (payload.kind === 'buy_data' ? DATA_CATALOG.find(item => item.id === payload.catalogId)!.feeCents : 0);
      }, 0),
      foundationEntryFeeCents: TRAINING_RECIPES.find(recipe => recipe.id === 'large-foundation')!.feeCents },
    hardware: { generalRacks: playerRacks.filter(rack => rack.hardwareId === 'general').length,
      memoryRichRacks: playerRacks.filter(rack => rack.hardwareId === 'memory-rich').length,
      ownedCU: state.slices.compute.fleets[state.playerCompanyId].ownedCU / U,
      cloudCU: state.slices.compute.fleets[state.playerCompanyId].cloudCU / U },
    modelId, capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps,
    modeledBehavior: model.behavior, heldOutBehavior: behavior.outcomes,
    foundation: { physicalTrainingCUw: foundation.physicalWork / U, usefulTrainingCUw: foundation.completedWork / U,
      workspaceMU: foundation.requiredMemory / U, preparationStaffWeeks: foundation.preparationCompleted! / U,
      broadUnits: foundation.plan.corpus.broadUnits, qualityBps: foundation.plan.corpus.qualityBps },
    stages: run.receipts.map(receipt => ({ ...receipt, cloudCU: receipt.cloudCU / U, ownedCU: receipt.ownedCU / U })),
    checkpoint: { week: state.week, checksum: canonicalStateHash(state), format: 'frontier-lab' },
    proof: ending.proof.map(row => ({ week: row.week, revenueCents: row.revenueCents, operatingExpenseCents: row.operatingExpenseCents,
      cashCents: row.cashCents, reserveRequiredCents: row.baseCostCents * 8, consumers: row.consumerAccounts,
      developers: row.developerAccounts, serviceBps: row.serviceBps })),
  };
  if (process.env.FRONTIER_CAMPAIGN_REPORT) console.log(JSON.stringify(evidence));
  if (process.env.FRONTIER_CAMPAIGN_EXPORT) {
    mkdirSync(dirname(process.env.FRONTIER_CAMPAIGN_EXPORT), { recursive: true });
    writeFileSync(process.env.FRONTIER_CAMPAIGN_EXPORT, serializeState(state));
  }
  if (process.env.FRONTIER_CAMPAIGN_RECEIPT) {
    mkdirSync(dirname(process.env.FRONTIER_CAMPAIGN_RECEIPT), { recursive: true });
    writeFileSync(process.env.FRONTIER_CAMPAIGN_RECEIPT, JSON.stringify(evidence, null, 2) + '\n');
  }
});
