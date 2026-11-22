import { FACILITY_RETROFITS, FACILITY_RETROFIT_RULES, facilityRetrofitDefinition } from '../content/wave8-retrofits';
import type { CommandPayload, GameContent, GameState } from '../contracts/types';
import { facilityRetrofitResearchReady } from '../modules/facility-retrofits';
import { checkedInteger } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }

export function assertFacilityRetrofitCommand(payload: CommandPayload): void {
  if (payload.kind === 'start_facility_retrofit') {
    identifier(payload.facilityId, 'Site extension location');
    check(FACILITY_RETROFITS.some(item => item.kind === payload.retrofitKind), 'Site extension type is invalid.');
  } else if (payload.kind === 'set_facility_retrofit_paused') {
    identifier(payload.retrofitId, 'Site extension project');
    check(typeof payload.paused === 'boolean', 'Site extension pause choice is invalid.');
  }
}

/** Independent receipt checks prevent unpaid envelopes, duplicate upgrades and early activation. */
export function assertWave8RetrofitsState(state: GameState, content: GameContent): void {
  const { compute, company } = state.slices;
  if (compute.facilityRetrofits === undefined) return;
  record(compute.facilityRetrofits, 'Facility retrofits');
  const entries = Object.entries(compute.facilityRetrofits), pairs = new Set<string>(), payments = new Set<string>();
  check(entries.length <= Object.keys(company.companies).length * content.infrastructure.maxFacilitiesPerCompany * FACILITY_RETROFIT_RULES.maxTypesPerFacility,
    'Facility retrofit collection exceeds the supported site and type limits.');
  const past = (value: number, label: string): void => { checkedInteger(value, label); check(value <= state.week, `${label} is in the future.`); };
  for (const [key, project] of entries) {
    record(project, 'Facility retrofit'); identifier(key, 'Facility retrofit ID'); identifier(project.companyId, 'Facility retrofit owner'); identifier(project.facilityId, 'Facility retrofit site');
    check(project.id === key && key.startsWith('facility-retrofit-') && Object.hasOwn(company.companies, project.companyId), 'Facility retrofit identity or ownership is invalid.');
    check(FACILITY_RETROFITS.some(item => item.kind === project.kind), 'Facility retrofit type is not authored.');
    const d = facilityRetrofitDefinition(project.kind), site = compute.facilities[project.facilityId];
    check(site?.companyId === project.companyId && site.status === 'active' && site.readyWeek !== null, 'Facility retrofit needs an operational owned site.');
    const pair = `${project.companyId}:${project.facilityId}:${project.kind}`;
    check(!pairs.has(pair), 'A site cannot receive the same extension more than once.'); pairs.add(pair);
    check(['building', 'ready', 'active'].includes(project.status) && typeof project.paused === 'boolean', 'Facility retrofit status is invalid.');
    past(project.startedWeek, 'Facility retrofit start');
    check(site!.readyWeek! <= project.startedWeek, 'Facility retrofit started before site commissioning.');
    check(facilityRetrofitResearchReady(state, project.companyId, project.startedWeek), 'Facility retrofit started before Enterprise operations research was available.');
    for (const n of [project.requiredWeeks, project.elapsedWeeks, project.requiredStaff, project.completedStaff, project.purchaseCents]) checkedInteger(n, 'Facility retrofit quantity');
    check(project.requiredWeeks === d.requiredWeeks && project.requiredStaff === d.requiredStaff && project.purchaseCents === d.purchaseCents,
      'Facility retrofit requirements or price changed from its authored project.');
    check(project.elapsedWeeks <= project.requiredWeeks && project.elapsedWeeks <= state.week - project.startedWeek + 1
      && project.completedStaff <= project.requiredStaff, 'Facility retrofit progress exceeds its elapsed time or required work.');
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(project.lastBottleneck), 'Facility retrofit explanation is invalid.');
    identifier(project.paymentId, 'Facility retrofit payment');
    check(project.paymentId === `facility-retrofit-capital:${key}` && !payments.has(project.paymentId), 'Facility retrofit payment identity was changed or reused.');
    payments.add(project.paymentId);
    check(company.postedFacts[project.paymentId] === true, 'Facility retrofit has no settled capital payment.');
    const payment = company.ledger.find(item => item.id === project.paymentId);
    if (payment) check(payment.companyId === project.companyId && payment.sourceId === key && payment.week === project.startedWeek
      && payment.kind === 'expense' && payment.category === 'capital' && payment.amountCents === d.purchaseCents
      && payment.paidCents === d.purchaseCents && payment.unpaidCents === 0, 'Facility retrofit payment does not match its funded project.');
    const finished = project.elapsedWeeks === project.requiredWeeks && project.completedStaff === project.requiredStaff;
    if (project.status === 'building') {
      check(!finished && project.completedWeek === null && project.readyWeek === null, 'Unfinished site extension has completion or activation evidence.');
    } else {
      check(finished && !project.paused && project.completedWeek !== null, 'Finished site extension has incomplete or paused work.');
      past(project.completedWeek!, 'Facility retrofit completion');
      check(project.completedWeek! >= project.startedWeek + project.requiredWeeks - 1
        && project.readyWeek === project.completedWeek! + 1, 'Facility retrofit completion violates its elapsed or activation boundary.');
      check(project.status === 'ready' ? project.readyWeek === state.week + 1 : project.readyWeek! <= state.week,
        'Facility retrofit supplies an envelope before or after its proper activation boundary.');
    }
  }
}
