import { FACILITY_SPECIALIZATION_RULES as RULES, FACILITY_PROFILES, facilityProfileDefinition } from '../content/wave28-facilities';
import type { ComputePool, GameContent, GameState } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { FacilitySpecialization } from '../contracts/wave28-facilities';
import { facilityPoolSpecialization, facilitySpecializationCommandShapeReason, facilitySpecializationResearchReady, facilitySpecializationWorkId, getFacilitySpecializationAtWeek } from '../modules/facility-specialization';
import { getPoolMultiplierBps, getPoolWorkCapacityCU, getRackHardware, poolSupportsWorkload, usesCrossRackTraining } from '../modules/compute-pools';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'Facility specialization identity is invalid.'); }

export function assertWave28FacilityCommand(payload: unknown): void {
  const reason = facilitySpecializationCommandShapeReason(payload); if (reason) throw new Error(reason);
}

/** Historical records must bind the profile active at that exact boundary.
 * Absence is also checked, so an imported cost pool cannot erase a tradeoff. */
export function assertFacilityPoolSpecialization(state: GameState, pool: ComputePool, week: number): void {
  checkedInteger(week); check(week <= state.week, 'A facility profile cannot appear in a future compute receipt.');
  const project = pool.ownership === 'owned' && pool.location !== 'colocation' ? getFacilitySpecializationAtWeek(state, pool.location, week) : null;
  if (!project) { check(pool.specialization === undefined, 'A compute pool invented an unearned or premature facility profile.'); return; }
  check(project.companyId === pool.companyId && same(pool.specialization, facilityPoolSpecialization(project)),
    'A historical compute pool changed or removed its exact paid facility profile effects.');
}

function assertWorkPool(state: GameState, pool: ComputePool, project: FacilitySpecialization, week: number, content: GameContent): void {
  record(pool, 'Specialization qualification pool'); id(pool.id); id(pool.hardwareId); id(pool.location);
  check(pool.companyId === project.companyId && ['cloud', 'owned'].includes(pool.ownership), 'Qualification used a foreign compute pool.');
  let hardware = content.hardware.find(item => item.id === pool.hardwareId);
  if (!hardware) {
    const rack = Object.values(state.slices.compute.racks).find(item => item.companyId === project.companyId && item.hardwareId === pool.hardwareId);
    if (rack) hardware = getRackHardware(state, rack, content);
  }
  check(hardware, 'Qualification pool has no authored or paid qualified hardware.');
  for (const value of [pool.nominalCU, pool.capacityCU, pool.memoryMU, pool.rackCount, pool.singleRackCU, pool.singleRackMemoryMU,
    pool.trainingBps, pool.servingBps, pool.variableCentsPerCUw, pool.staffCoverageBps, pool.powerCoverageBps, pool.coolingCoverageBps]) checkedInteger(value);
  check(pool.capacityCU <= pool.nominalCU && pool.singleRackCU <= pool.capacityCU && pool.singleRackMemoryMU <= pool.memoryMU
    && [pool.staffCoverageBps, pool.powerCoverageBps, pool.coolingCoverageBps].every(value => value <= 10000), 'Qualification pool exceeded its physical envelope.');
  if (pool.ownership === 'cloud') check(pool.id === 'general-cloud' && pool.location === 'cloud' && pool.hardwareId === 'general'
    && pool.trainingBps === 10000 && pool.servingBps === 10000 && pool.variableCentsPerCUw === 0
    && pool.memoryMU === mulDiv(pool.capacityCU, hardware.memoryMUPerCU, U), 'Qualification changed the general cloud hardware.');
  else check(pool.id === `owned:${pool.location}:${pool.hardwareId}`
    && (pool.location === 'colocation' || state.slices.compute.facilities[pool.location]?.companyId === project.companyId)
    && pool.trainingBps === Math.round(hardware.trainingMultiplier * 10000) && pool.servingBps === Math.round(hardware.servingMultiplier * 10000)
    && pool.variableCentsPerCUw === hardware.variableCentsPerCUw && pool.memoryMU === mulDiv(pool.capacityCU, hardware.memoryMUPerCU, U),
  'Qualification changed its owned hardware, location or conversion.');
  assertFacilityPoolSpecialization(state, pool, week);
}

/** Paid receipts, exact requirements and disjoint activation intervals preserve
 * old profile effects after switches and reject unearned future fields. */
export function assertWave28FacilityState(state: GameState, content: GameContent): void {
  const saved = state.slices.compute.facilitySpecializations; if (saved === undefined) return;
  record(saved, 'Facility specializations');
  const projects = Object.values(saved), sites = new Map<string, FacilitySpecialization[]>(), payments = new Set<string>();
  check(projects.length <= Object.keys(state.slices.company.companies).length * content.infrastructure.maxFacilitiesPerCompany * RULES.maximumHistoryPerSite,
    'Facility specialization history exceeds its supported bound.');
  const fields = ['id', 'companyId', 'facilityId', 'profile', 'startCommandId', 'paymentId', 'purchaseCents', 'previousProfileId', 'status', 'paused',
    'startedWeek', 'requiredWeeks', 'elapsedWeeks', 'requiredStaff', 'completedStaff', 'requiredWork', 'completedWork', 'physicalWork', 'requiredMemory',
    'completedWeek', 'readyWeek', 'activatedWeek', 'retiredWeek', 'grants', 'lastProgress', 'lastBottleneck'].sort().join();
  const grantFields = ['week', 'elapsed', 'requestedWork', 'requestedStaff', 'grantedWork', 'physicalWork', 'grantedStaff', 'requiredMemory', 'grantedMemory', 'pool'].sort().join();
  for (const [key, project] of Object.entries(saved)) {
    record(project, 'Facility specialization'); check(Object.keys(project).sort().join() === fields, 'Facility specialization contains unknown or missing fields.');
    for (const value of [key, project.companyId, project.facilityId, project.startCommandId, project.paymentId]) id(value);
    const site = state.slices.compute.facilities[project.facilityId], command = state.commandReceipts[project.startCommandId];
    check(project.id === key && key === 'facility-specialization:' + project.startCommandId && site?.companyId === project.companyId && site.status === 'active'
      && site.readyWeek !== null && site.readyWeek <= project.startedWeek && command?.status === 'accepted' && command.week === project.startedWeek,
    'Facility specialization has no accepted command or commissioned owned site.');
    check(FACILITY_PROFILES.some(item => item.profile === project.profile) && ['building', 'ready', 'active', 'retired'].includes(project.status)
      && typeof project.paused === 'boolean', 'Facility profile or project status is invalid.');
    const definition = facilityProfileDefinition(project.profile);
    for (const value of [project.purchaseCents, project.startedWeek, project.requiredWeeks, project.elapsedWeeks, project.requiredStaff, project.completedStaff,
      project.requiredWork, project.completedWork, project.physicalWork, project.requiredMemory, project.lastProgress]) checkedInteger(value);
    check(project.startedWeek <= state.week && facilitySpecializationResearchReady(state, project.companyId, project.startedWeek), 'Facility specialization preceded paid S5 availability.');
    check(project.purchaseCents === definition.purchaseCents && project.requiredWeeks === definition.requiredWeeks && project.requiredStaff === definition.requiredStaff
      && project.requiredWork === definition.requiredWork && project.requiredMemory === definition.requiredMemory,
    'Facility specialization changed its authored price, elapsed time, staff or GPU work.');
    check(project.paymentId === 'facility-specialization-capital:' + project.startCommandId && !payments.has(project.paymentId)
      && state.slices.company.postedFacts[project.paymentId] === true, 'Facility specialization omitted or duplicated its settled capital payment.');
    payments.add(project.paymentId);
    const payment = state.slices.company.ledger.find(item => item.id === project.paymentId);
    if (payment) check(payment.companyId === project.companyId && payment.sourceId === project.id && payment.week === project.startedWeek
      && payment.kind === 'expense' && payment.category === 'capital' && payment.amountCents === project.purchaseCents
      && payment.paidCents === project.purchaseCents && payment.unpaidCents === 0, 'Specialization capital payment does not match its accepted project.');
    check(Array.isArray(project.grants) && project.grants.length <= 10000, 'Specialization work receipts are missing or excessive.');
    let work = 0, physical = 0, staff = 0, elapsed = 0, lastWeek = project.startedWeek - 1;
    for (const receipt of project.grants) {
      record(receipt, 'Specialization work receipt'); check(Object.keys(receipt).sort().join() === grantFields, 'Specialization receipt contains unknown or missing fields.');
      for (const value of [receipt.week, receipt.requestedWork, receipt.requestedStaff, receipt.grantedWork, receipt.physicalWork,
        receipt.grantedStaff, receipt.requiredMemory, receipt.grantedMemory]) checkedInteger(value);
      check(receipt.week > lastWeek && receipt.week >= project.startedWeek && receipt.week <= state.week
        && typeof receipt.elapsed === 'boolean' && (receipt.elapsed || receipt.grantedWork > 0 || receipt.grantedStaff > 0),
      'Specialization work was duplicated, recorded in the future or manufactured from idle time.');
      check(receipt.requestedWork === project.requiredWork - work && receipt.requestedStaff === project.requiredStaff - staff
        && receipt.grantedWork <= receipt.requestedWork && receipt.grantedStaff <= receipt.requestedStaff
        && receipt.requiredMemory === (receipt.requestedWork ? project.requiredMemory : 0)
        && (receipt.grantedWork > 0) === (receipt.physicalWork > 0), 'Specialization grant exceeded its remaining paid work.');
      check(receipt.elapsed === (elapsed < project.requiredWeeks), 'Specialization elapsed time was lost or added after its requirement.');
      if (receipt.elapsed) elapsed++;
      if (receipt.grantedWork > 0) {
        check(receipt.pool && receipt.grantedMemory === receipt.requiredMemory, 'Specialization GPU qualification lacks its full connected workspace.');
        assertWorkPool(state, receipt.pool, project, receipt.week, content);
        const request = { category: 'development' as const, workloadKind: 'general' as const };
        check(poolSupportsWorkload(receipt.pool, request) && receipt.physicalWork <= getPoolWorkCapacityCU(receipt.pool, request)
          && receipt.requiredMemory <= receipt.pool.memoryMU, 'Specialization qualification exceeds compatible actual pool capacity.');
        const multiplier = getPoolMultiplierBps(receipt.pool, 'development', usesCrossRackTraining(receipt.pool, 'development', receipt.physicalWork, receipt.requiredMemory), content, 'general');
        check(receipt.grantedWork === Math.min(receipt.requestedWork, mulDiv(receipt.physicalWork, multiplier, 10000)), 'Specialization qualification invented useful GPU work.');
      } else check(receipt.pool === null && receipt.physicalWork === 0 && receipt.grantedMemory === 0, 'Unexecuted specialization work retained a fictitious resource grant.');
      const cost = state.slices.compute.costReports?.[project.companyId]?.find(item => item.week === receipt.week);
      if (cost) {
        const requestId = facilitySpecializationWorkId(project.id), request = cost.resources.requests.find(item => item.id === requestId);
        const grant = cost.resources.computeGrants.find(item => item.requestId === requestId), worker = cost.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'infrastructure')?.staffWeeks ?? 0;
        check(request?.taskId === project.id && request.category === 'development' && request.workloadKind === 'general'
          && request.normalizedWorkCUw === receipt.requestedWork && request.memoryMU === receipt.requiredMemory
          && request.staffDemand?.find(item => item.role === 'infrastructure')?.staffWeeks === receipt.requestedStaff
          && grant?.hardwareEffectiveCUw === receipt.grantedWork && grant.physicalCUw === receipt.physicalWork && grant.memoryMU === receipt.grantedMemory
          && worker === receipt.grantedStaff && (!receipt.pool || same(receipt.pool, cost.pools.find(pool => pool.id === grant.poolId))),
        'Specialization receipts differ from the shared allocator’s retained actual work.');
      }
      work = checkedAdd(work, receipt.grantedWork); physical = checkedAdd(physical, receipt.physicalWork); staff = checkedAdd(staff, receipt.grantedStaff); lastWeek = receipt.week;
    }
    check(project.completedWork === work && project.physicalWork === physical && project.completedStaff === staff && project.elapsedWeeks === elapsed
      && work <= project.requiredWork && staff <= project.requiredStaff && elapsed <= project.requiredWeeks
      && elapsed <= state.week - project.startedWeek + 1, 'Specialization progress differs from its paid grant receipts.');
    const finished = work === project.requiredWork && staff === project.requiredStaff && elapsed === project.requiredWeeks;
    if (project.status === 'building') check(!finished && project.completedWeek === null && project.readyWeek === null
      && project.activatedWeek === null && project.retiredWeek === null, 'Unfinished specialization acquired a completed profile.');
    else {
      check(finished && !project.paused && project.completedWeek === lastWeek && project.readyWeek === lastWeek + 1
        && lastWeek >= project.startedWeek + project.requiredWeeks - 1, 'Specialization completed before its real work or activation boundary.');
      if (project.status === 'ready') check(project.readyWeek === state.week + 1 && project.activatedWeek === null && project.retiredWeek === null,
        'A ready profile bypassed its following activation boundary.');
      else {
        check(project.activatedWeek === project.readyWeek && project.activatedWeek! <= state.week, 'Active profile lacks its exact commissioning boundary.');
        if (project.status === 'active') check(project.retiredWeek === null, 'Active profile was already retired.');
        else { checkedInteger(project.retiredWeek!); check(project.retiredWeek! > project.activatedWeek! && project.retiredWeek! <= state.week, 'Profile retirement is premature or in the future.'); }
      }
    }
    const latest = project.grants.at(-1);
    check(project.lastProgress === (['building', 'ready'].includes(project.status) && !project.paused && latest?.week === state.week ? latest.grantedWork : 0),
      'Specialization animation/progress is not its latest actual work.');
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(project.lastBottleneck), 'Specialization explanation is malformed.');
    if (project.previousProfileId !== null) id(project.previousProfileId);
    const list = sites.get(project.facilityId) ?? []; list.push(project); sites.set(project.facilityId, list);
  }
  for (const history of sites.values()) {
    check(history.length <= RULES.maximumHistoryPerSite && history.filter(project => project.status === 'active').length <= 1
      && history.filter(project => ['building', 'ready'].includes(project.status)).length <= 1, 'A site has overlapping active or pending profiles.');
    for (const project of history) {
      const predecessors = history.filter(other => other.id !== project.id && other.activatedWeek !== null && other.activatedWeek <= project.startedWeek
        && (other.retiredWeek === null || project.startedWeek < other.retiredWeek));
      check(predecessors.length <= 1 && project.previousProfileId === (predecessors[0]?.id ?? null)
        && (!predecessors[0] || predecessors[0].profile !== project.profile), 'Paid profile switching changed or duplicated the retained source profile.');
      if (project.status === 'retired') {
        const successors = history.filter(other => other.previousProfileId === project.id && other.activatedWeek !== null);
        check(successors.length === 1 && successors[0].activatedWeek === project.retiredWeek, 'Profile retirement has no paid replacement activation.');
      }
      if (project.activatedWeek !== null && project.previousProfileId) check(saved[project.previousProfileId]?.retiredWeek === project.activatedWeek,
        'Paid profile activation left the preceding profile running.');
      if (project.activatedWeek !== null) check(!history.some(other => other.id !== project.id && other.activatedWeek !== null
        && other.activatedWeek < (project.retiredWeek ?? state.week + 1) && project.activatedWeek! < (other.retiredWeek ?? state.week + 1)),
      'Facility profile operating intervals overlap.');
    }
  }
}
