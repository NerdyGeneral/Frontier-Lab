import type { GameContent, GameState } from '../contracts/types';
import type { RackRelocation } from '../contracts/wave8-relocation';
import { RACK_RELOCATION_RULES as RULES } from '../content/wave8-relocation';
import { getRackCapacity } from '../modules/compute-pools';
import { facilityRetrofitResearchReady } from '../modules/facility-retrofits';
import { checkedInteger } from './math';

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}

export function assertWave8RackRelocations(state: GameState, content: GameContent): void {
  const { compute, company } = state.slices;
  if (compute.rackRelocations === undefined) {
    check(Object.values(compute.racks).every(rack => rack.purchaseLocation === undefined), 'A relocated purchase destination needs its paid movement history.');
    return;
  }
  record(compute.rackRelocations, 'Rack relocations');
  const projects = Object.values(compute.rackRelocations), paidIds = new Set<string>();
  const past = (week: number, label: string) => { checkedInteger(week, label); check(week <= state.week, `${label} is in the future.`); };
  for (const [id, project] of Object.entries(compute.rackRelocations)) {
    record(project, 'Rack relocation'); identifier(id, 'Rack relocation ID');
    check(id === project.id && id.startsWith('rack-relocation:') && !!company.companies[project.companyId], 'Rack relocation identity or owner is invalid.');
    const rack = compute.racks[project.rackId];
    check(rack && rack.companyId === project.companyId, 'Rack relocation refers to a missing or foreign asset.');
    check(['installed', 'parked'].includes(rack.status) && ['installed', 'parked'].includes(project.restoreStatus), 'Relocation requires installed hardware and a valid return state.');
    check(['moving', 'ready', 'complete'].includes(project.status) && typeof project.paused === 'boolean', 'Rack relocation status is invalid.');
    past(project.startedWeek, 'Rack relocation start');
    check(rack.installedWeek !== null && project.startedWeek > rack.installedWeek, 'Relocation cannot precede the original usable installation.');
    check(facilityRetrofitResearchReady(state, project.companyId, project.startedWeek), 'Rack relocation predates Enterprise operations.');
    for (const location of [project.sourceLocation, project.destination]) {
      identifier(location, 'Rack relocation location');
      check(location === 'colocation' || compute.facilities[location]?.companyId === project.companyId, 'Rack relocation has a foreign or missing location.');
    }
    check(project.sourceLocation !== project.destination, 'Rack relocation must change location.');
    if (project.destination !== 'colocation') {
      const site = compute.facilities[project.destination];
      check(site.status === 'active' && site.readyWeek !== null && site.readyWeek <= project.startedWeek, 'Relocation destination was not operational at admission.');
    }
    check(project.hardwareId === rack.hardwareId && project.usableCU === getRackCapacity(rack, content)
      && project.purchaseCents === rack.purchaseCents && project.originalInstalledWeek === rack.installedWeek, 'Relocation changed the purchased asset, usable yield, price, or original installation.');
    identifier(project.paymentId, 'Rack relocation payment');
    check(project.paymentId === 'rack-relocation-capital:' + id && !paidIds.has(project.paymentId)
      && project.paidCents === RULES.feeCents && company.postedFacts[project.paymentId] === true, 'Rack relocation has missing, repeated, or incorrect payment evidence.');
    paidIds.add(project.paymentId);
    const payment = company.ledger.find(entry => entry.id === project.paymentId);
    if (payment) check(payment.companyId === project.companyId && payment.sourceId === id && payment.week === project.startedWeek
      && payment.kind === 'expense' && payment.category === 'capital' && payment.amountCents === RULES.feeCents && payment.unpaidCents === 0, 'Rack relocation payment differs from its project.');
    check(typeof project.lastBottleneck === 'string' && project.lastBottleneck.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(project.lastBottleneck), 'Rack relocation explanation is invalid.');
    checkedInteger(project.stageIndex, 'Rack relocation stage');
    check(project.stageIndex <= RULES.stages.length && Array.isArray(project.stages) && project.stages.length === RULES.stages.length, 'Rack relocation stage sequence is invalid.');
    for (let index = 0; index < RULES.stages.length; index++) {
      const stage = project.stages[index], rule = RULES.stages[index]; record(stage, 'Rack relocation stage');
      checkedInteger(stage.elapsedWeeks, 'Rack relocation elapsed time'); checkedInteger(stage.completedStaff, 'Rack relocation staff work');
      check(stage.elapsedWeeks <= rule.elapsedWeeks && stage.completedStaff <= rule.staffWeeks, 'Rack relocation progress exceeds its requirement.');
      if (stage.startedWeek === null) {
        check(index >= project.stageIndex && stage.elapsedWeeks === 0 && stage.completedStaff === 0 && stage.completedWeek === null, 'Unstarted relocation work contains progress.');
        continue;
      }
      past(stage.startedWeek, 'Rack relocation stage start');
      check(index <= project.stageIndex && stage.elapsedWeeks <= state.week - stage.startedWeek + 1, 'Rack relocation advanced an unavailable or future stage.');
      if (index === 0) check(stage.startedWeek === project.startedWeek, 'Disconnect stage differs from the relocation start.');
      else check(project.stages[index - 1].completedWeek !== null && stage.startedWeek > project.stages[index - 1].completedWeek!, 'Rack relocation stages overlap their critical path.');
      if (index < project.stageIndex) {
        check(stage.elapsedWeeks === rule.elapsedWeeks && stage.completedStaff === rule.staffWeeks && stage.completedWeek !== null, 'Rack relocation skipped unfinished elapsed time or staff work.');
        past(stage.completedWeek!, 'Rack relocation stage completion');
        check(stage.completedWeek! >= stage.startedWeek + rule.elapsedWeeks - 1, 'Rack relocation finished a stage too early.');
      } else check(stage.completedWeek === null, 'Current relocation stage already has a completion boundary.');
    }
    if (project.status === 'moving') check(project.stageIndex < RULES.stages.length && project.readyWeek === null && project.completedWeek === null, 'Unfinished relocation has an arrival boundary.');
    else {
      check(project.stageIndex === RULES.stages.length && !project.paused && project.readyWeek !== null
        && project.readyWeek === project.stages.at(-1)!.completedWeek! + 1, 'Relocation commissioning must follow completed work at the next boundary.');
      if (project.status === 'ready') check(project.readyWeek === state.week + 1 && project.completedWeek === null, 'Rack relocation is overdue or commissioned too early.');
      else { past(project.readyWeek!, 'Rack relocation commissioning'); check(project.completedWeek === project.readyWeek, 'Rack relocation completion differs from commissioning.'); }
    }
  }
  for (const rack of Object.values(compute.racks)) {
    const history = projects.filter(project => project.rackId === rack.id).sort((a, b) => a.startedWeek - b.startedWeek || a.id.localeCompare(b.id));
    if (!history.length) { check(rack.purchaseLocation === undefined, 'Rack original destination has no relocation provenance.'); continue; }
    identifier(rack.purchaseLocation, 'Rack purchase destination');
    check(history.length <= RULES.maximumMovesPerRack && history[0].sourceLocation === rack.purchaseLocation, 'Rack relocation history exceeds its bound or changed its original destination.');
    let previous: RackRelocation | undefined;
    for (const project of history) {
      if (previous) check(previous.status === 'complete' && previous.completedWeek! < project.startedWeek
        && project.sourceLocation === previous.destination, 'Rack relocation chain overlaps or changes its previous destination.');
      previous = project;
    }
    const last = history.at(-1)!;
    check(rack.location === (last.status === 'complete' ? last.destination : last.sourceLocation), 'Rack location differs from its paid movement history.');
    if (last.status !== 'complete') check(rack.status === 'parked', 'A rack supplies capacity before its relocation is commissioned.');
  }
}
