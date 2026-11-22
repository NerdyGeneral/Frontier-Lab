import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { CAMPAIGN_ORIGINS, originStaffId } from '../src/content/campaign-origins';
import { advanceWeek, createInitialState, submitCommand, validateState } from '../src/core/engine';
import { getWeeklyBaseCost } from '../src/core/selectors';
import { deserializeState, serializeState } from '../src/core/snapshot';
import type { CampaignOrigin } from '../src/contracts/wave4-campaign';

test('default and explicit garage replay the original opening without a scenario record', () => {
  const before = createInitialState(CONTENT, 'release');
  assert.deepEqual(createInitialState(CONTENT, 'release', 'garage'), before);
  assert.equal(before.slices.campaign.origin, undefined);
  assert.equal(before.seed, CONTENT.opening.seed);
  assert.equal(before.slices.company.companies[before.playerCompanyId].cashCents, 4_800_000);
  assert.throws(() => createInitialState(CONTENT, 'classic', 'university'));
});

test('origins have authored opening budgets, payroll, competitive positions and no unearned revenue', () => {
  const seeds = new Set<string>();
  for (const origin of ['garage', 'university', 'consultancy'] as const) {
    const game = createInitialState(CONTENT, 'release', origin);
    const { company, research, markets, campaign } = game.slices;
    const player = company.companies[game.playerCompanyId];
    const definition = CAMPAIGN_ORIGINS[origin];
    assert.equal(player.cashCents, definition.cashCents);
    assert.equal(player.activeStaff, definition.crew.length);
    assert.equal(player.earnedRevenueCents, 0);
    assert.equal(getWeeklyBaseCost(game), { garage: 100_000, university: 170_000, consultancy: 130_000 }[origin]);
    assert.deepEqual(research.completedByCompany[player.id], definition.knowledge);
    for (const role of definition.crew) assert.equal(company.staff[originStaffId(origin, role)].readyWeek, 0);
    assert.equal(markets.cohorts.find(cohort => cohort.id === 'rival-atlas-cohort-casual')!.count, origin === 'university' ? 173 : 113);
    assert.equal(markets.cohorts.find(cohort => cohort.id === 'rival-harbor-cohort-business')!.count, origin === 'consultancy' ? 12 : 8);
    const pilot = campaign.customerBriefs?.['consultancy-pilot'];
    if (origin === 'consultancy') {
      assert.equal(pilot?.deadlineWeek, 8);
      assert.equal(pilot?.status, 'active');
    } else assert.equal(pilot, undefined);
    seeds.add(game.seed);

    const prepared = submitCommand(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'first-project');
    assert.ok(prepared.accepted, prepared.reason?.message);
    const loaded = deserializeState(serializeState(prepared.state));
    assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
    const firstWeek = advanceWeek(prepared.state);
    assert.ok(firstWeek.accepted, firstWeek.reason?.message);
    assert.deepEqual(advanceWeek(loaded.state), firstWeek);
    assert.deepEqual(validateState(firstWeek.state), []);
    assert.ok(firstWeek.state.slices.company.lastStaff[player.id].granted.data > 0);
  }
  assert.equal(seeds.size, 3);
});

test('only the selected origin supplies earned starting research and fully onboarded employees', () => {
  const spinout = createInitialState(CONTENT, 'release', 'university');
  const fabricated = structuredClone(spinout);
  fabricated.slices.research.completed.push('R3');
  fabricated.slices.research.completedByCompany[fabricated.playerCompanyId].push('R3');
  assert.match(validateState(fabricated)[0].message, /completed project/i);
  const staffId = originStaffId('university', 'research');
  spinout.slices.company.staff['duplicate-researcher'] = { ...spinout.slices.company.staff[staffId], id: 'duplicate-researcher' };
  assert.match(validateState(spinout)[0].message, /onboarding/i);

  const garage = createInitialState(CONTENT, 'release');
  garage.slices.campaign.origin = 'university';
  assert.match(validateState(garage)[0].message, /origin seed/i);
  garage.slices.campaign.origin = 'unknown' as CampaignOrigin;
  assert.match(validateState(garage)[0].message, /origin is invalid/i);
});
