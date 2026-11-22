import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameState, ResourceFrame, StaffMember, WorkRequest } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { getGameView } from '../src/core/selectors';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { canChooseStaffSpecialty, careerLevel, careerOutput, careerSalary, settleStaffCareers, STAFF_CAREER_PATHS } from '../src/modules/staff-careers';
import { getPayrollCents, withPassiveWorkforce } from '../src/modules/workforce';
import { getStaffPointProfile } from '../src/modules/workforce-points';
import { createPlayerOnlyState } from './fixtures/player-only';

const point = U / 20;
function request(companyId: string, id: string, role: StaffMember['role'], points: number): WorkRequest {
  return { id, taskId: id, companyId, category: 'development', poolId: 'auto', normalizedWorkCUw: 0,
    memoryMU: 0, priority: 5, staffDemand: [{ role, staffWeeks: points * point }] };
}
function queue(state: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}
function step(state: GameState, modules?: DomainModule[]) {
  const result = advanceWeek(state, CONTENT, modules);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}
function reload(state: GameState) {
  const result = deserializeState(serializeState(state));
  assert.ok(result.ok, result.ok ? undefined : result.error);
  return result.state;
}

test('experience shares include secondary work, exclude founder time, cap supervision to actual compute, and survive retry', () => {
  const game = withPassiveWorkforce(createPlayerOnlyState()), company = game.slices.company, owner = game.playerCompanyId;
  const mk = (id: string, role: StaffMember['role'], readyWeek = 2): StaffMember => ({ id, role, companyId: owner, hiredWeek: 0, readyWeek, assignedFte: U });
  company.staff = { b: mk('b', 'data'), a: mk('a', 'data'), c: mk('c', 'ml'), d: mk('d', 'data', 6) };
  const data = request(owner, 'data', 'data', 39), design = request(owner, 'design', 'ml', 70);
  design.supervision = { role: 'ml', workPerStaffWeek: 4 * U };
  const frame: ResourceFrame = { requests: [data, design], staffGrants: [data, design].map(r => ({ requestId: r.id, grants: r.staffDemand! })),
    computeGrants: [{ requestId: design.id, physicalCUw: 4 * U, hardwareEffectiveCUw: 4 * U, memoryMU: 0, poolId: 'auto' }] };
  settleStaffCareers(company, owner, 3, frame);
  // Data generated per person: 30/30/5. Design: 10/10/30. Only 20 Design points ran.
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => (company.staff[id].career?.experience ?? 0) / point), [22, 22, 15, 0]);
  const after = structuredClone(company);
  settleStaffCareers(company, owner, 3, frame);
  assert.deepEqual(company, after);
  settleStaffCareers(company, owner, 4, { ...frame, requests: [design], computeGrants: [] });
  assert.deepEqual(company, after);
  const allStaff = request(owner, 'all-data', 'data', 100);
  settleStaffCareers(company, owner, 5, { requests: [allStaff], staffGrants: [{ requestId: allStaff.id, grants: allStaff.staffDemand! }], computeGrants: [] });
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => (company.staff[id].career?.experience ?? 0) / point), [52, 52, 20, 0]);
});

test('real weekly boundaries earn promotions, charge the new salary from next week and persist exactly one permanent choice', () => {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  const owner = game.playerCompanyId, staffId = 'staff:engineer';
  const modules: DomainModule[] = [createCompanyModule(CONTENT), createComputeModule(CONTENT), {
    id: 'career-project', owns: [], handlers: { reserve: () => ({ workRequests: [request(owner, 'career-work', 'data', 60)] }) },
  }];
  game = step(queue(game, { kind: 'hire_staff', role: 'data' }, 'engineer'));
  const employee = () => game.slices.company.staff[staffId];
  const choice = { kind: 'specialize_staff', staffId, specialty: 'breadth' } as const;
  assert.equal(submitCommand(game, choice, CONTENT).accepted, false);
  game = step(game, modules);
  assert.equal(employee().career, undefined, 'onboarding earns no experience');
  game = step(game);
  assert.equal(employee().career, undefined, 'idle ready week earns no experience');
  const idleSave = reload(game);
  assert.deepEqual(idleSave, game);
  assert.equal(idleSave.slices.company.staff[staffId].career, undefined, 'opening an older save creates no past career work');
  for (let i = 0; i < 4; i++) game = step(game, modules);
  assert.equal(employee().career!.experience, 120 * point);
  assert.equal(canChooseStaffSpecialty(employee()), true);
  const basePay = CONTENT.staff.find(role => role.id === 'data')!.weeklyCents;
  const salaryCharged = () => game.slices.company.ledger.find(f => f.id === staffId + ':payroll:' + game.week)!.amountCents;
  assert.equal(salaryCharged(), basePay);
  assert.equal(getGameView(game).payrollCents, careerSalary(employee(), basePay));
  assert.equal(getPayrollCents(game, owner, CONTENT), basePay * 1.02);
  game = queue(game, choice, 'career-choice');
  assert.equal(submitCommand(game, { ...choice, specialty: 'depth' }, CONTENT).accepted, false);
  assert.deepEqual(step(reload(game), modules), step(game, modules));
  game = step(game, modules);
  assert.equal(salaryCharged(), basePay * 1.02);
  assert.equal(employee().career!.specialty, 'breadth');
  assert.equal(careerOutput(employee()).infrastructure, 6 * point);
  assert.equal(careerOutput(employee()).data, 32 * point);
  assert.equal(submitCommand(game, { ...choice, specialty: 'depth' }, CONTENT).accepted, false);
  for (let i = 0; i < 7; i++) game = step(game, modules);
  assert.equal(careerLevel(employee().career!.experience), 2);
  assert.equal(salaryCharged(), basePay * 1.02);
  game = step(game, modules);
  assert.equal(salaryCharged(), basePay * 1.05);
  assert.equal(careerOutput(employee()).data, 34 * point);
  assert.deepEqual(validateState(game), []);
  const forged = structuredClone(game);
  forged.slices.company.staff[staffId].career!.experience = point;
  assert.ok(validateState(forged).length);
  game = step(queue(game, { kind: 'dismiss_staff', staffId }, 'severance'), modules);
  assert.equal(game.slices.company.ledger.find(f => f.id === 'dismiss:severance')!.amountCents, basePay * 1.05 * 2);
  assert.equal(employee(), undefined);
});

test('each role has two distinct automatic specialties and the veteran output advantage persists', () => {
  for (const [role, paths] of Object.entries(STAFF_CAREER_PATHS)) {
    const member: StaffMember = { id: role, companyId: 'lab', role: role as StaffMember['role'], assignedFte: U, readyWeek: 2, hiredWeek: 0 };
    const base = getStaffPointProfile(member.role);
    assert.deepEqual(careerOutput(member), base);
    assert.notEqual(paths.depth.role, paths.breadth.role);
    for (const specialty of ['depth', 'breadth'] as const) {
      member.career = { experience: 360 * point, lastEarned: point, earnedWeek: 20, specialty };
      const expected = { ...base };
      expected[member.role] += 4 * point;
      expected[paths[specialty].role] += 6 * point;
      assert.deepEqual(careerOutput(member), expected);
    }
  }
});

test('a real starter-data job credits just the points the employee contributed', () => {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  game = step(queue(game, { kind: 'hire_staff', role: 'data' }, 'prep-engineer'));
  game = step(game);
  game = step(queue(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'real-data'));
  const staff = game.slices.company.staff['staff:prep-engineer'];
  const actual = game.slices.company.lastStaff[game.playerCompanyId].granted.data;
  assert.ok(actual > 0);
  assert.equal(staff.career?.experience, Math.min(actual, careerOutput(staff).data));
  assert.equal(staff.career?.earnedWeek, game.week);
  assert.deepEqual(reload(game), game);
});
