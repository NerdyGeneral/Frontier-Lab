/** Frozen schema-4 validation for authentic Wave 3 saves. */
import { RESOURCE_SCALE } from '../contracts/types';
import type { GameContent, GameState } from '../contracts/types';
import { getComputePools, getInfrastructureOperatingStaff, getInstalledOwnedCU, infrastructureOperationsId } from '../modules/compute-pools';
import { checkedInteger, mulDiv } from './math';

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`); }
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value), `${label} is invalid.`);
}
function note(value: unknown): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Infrastructure explanation is invalid.'); }

/** Authored costs, paid-stage provenance and independent construction/delivery meters. */
export function assertWave2InfrastructureState(state: GameState, content: GameContent): void {
  const { compute, company } = state.slices, c = content.infrastructure;
  record(compute.racks, 'Hardware racks'); record(compute.facilities, 'Facility projects');
  const paidIds = new Set<string>();
  const past = (week: number, label: string) => { checkedInteger(week, label); check(week <= state.week, `${label} is in the future.`); };
  const payment = (id: string, companyId: string, sourceId: string, amount: number) => {
    identifier(id, 'Capital payment');
    check(!paidIds.has(id), 'An infrastructure capital payment was reused.'); paidIds.add(id);
    check(company.postedFacts[id] === true, 'Infrastructure capital work has no settled payment.');
    const entry = company.ledger.find(item => item.id === id);
    if (entry) check(entry.companyId === companyId && entry.sourceId === sourceId && entry.category === 'capital'
      && entry.kind === 'expense' && entry.amountCents === amount && entry.unpaidCents === 0, 'Infrastructure capital payment does not match its project.');
  };
  const companyIds = new Set(Object.keys(company.companies));
  for (const [id, site] of Object.entries(compute.facilities)) {
    record(site, 'Facility'); identifier(id, 'Facility ID'); check(site.id === id && companyIds.has(site.companyId), 'Facility identity or ownership is invalid.');
    check(typeof site.name === 'string' && site.name.trim().length > 0 && site.name.length <= 48, 'Facility name is invalid.');
    check(['building', 'commissioning', 'active'].includes(site.status) && typeof site.paused === 'boolean', 'Facility status is invalid.');
    past(site.startedWeek, 'Facility start'); checkedInteger(site.stageIndex, 'Facility stage'); note(site.lastBottleneck);
    check(site.stageIndex <= c.stages.length && Array.isArray(site.stages) && site.stages.length === c.stages.length, 'Facility stage sequence is invalid.');
    for (let index = 0; index < c.stages.length; index++) {
      const stage = site.stages[index], definition = c.stages[index]; record(stage, 'Facility stage');
      for (const amount of [stage.paidCents, stage.elapsedWeeks, stage.completedStaff]) checkedInteger(amount, 'Facility stage meter');
      check(stage.elapsedWeeks <= definition.elapsedWeeks && stage.completedStaff <= definition.staffWeeks, 'Facility stage progress exceeds its authored requirement.');
      if (stage.paidCents === 0) {
        check(stage.paymentId === null && stage.startedWeek === null && stage.elapsedWeeks === 0 && stage.completedStaff === 0 && stage.completedWeek === null,
          'An unfunded stage cannot advance or contain a payment.');
        check(index >= site.stageIndex, 'An earlier facility stage is unfunded.');
        continue;
      }
      check(stage.paidCents === definition.costCents && stage.paymentId !== null, 'Facility stage payment differs from its authored cost.');
      payment(stage.paymentId!, site.companyId, site.id, definition.costCents);
      check(stage.startedWeek !== null, 'Funded facility stage has no start boundary.'); past(stage.startedWeek!, 'Stage start');
      check(index <= site.stageIndex, 'A later construction stage began before its predecessor.');
      check(stage.elapsedWeeks <= state.week - stage.startedWeek! + 1, 'Construction received more elapsed weeks than have passed.');
      if (index === 0) check(stage.startedWeek === site.startedWeek, 'Site reservation does not match the facility start.');
      else check(site.stages[index - 1].completedWeek !== null && stage.startedWeek! > site.stages[index - 1].completedWeek!, 'Construction stages overlap their critical path.');
      if (index < site.stageIndex) {
        check(stage.elapsedWeeks === definition.elapsedWeeks && stage.completedStaff === definition.staffWeeks && stage.completedWeek !== null, 'A preceding facility stage has unfinished work.');
        past(stage.completedWeek!, 'Stage completion');
        check(stage.completedWeek! >= stage.startedWeek! + definition.elapsedWeeks - 1, 'A construction stage finished before its elapsed requirement.');
      } else check(stage.completedWeek === null, 'The current construction stage already has a completion boundary.');
    }
    if (site.status === 'building') {
      check(site.stageIndex < c.stages.length && site.readyWeek === null, 'An unfinished facility has a commissioning boundary.');
    } else {
      check(site.stageIndex === c.stages.length && !site.paused && site.readyWeek !== null, 'Completed facility has an invalid construction state.');
      const finished = site.stages.at(-1)!.completedWeek!;
      check(site.readyWeek === finished + 1, 'Facility commissioning must follow acceptance at the next boundary.');
      if (site.status === 'commissioning') check(site.readyWeek === state.week + 1, 'Facility commissioning is overdue or too distant.');
      else past(site.readyWeek!, 'Site commissioning');
    }
    const slots = Object.values(compute.racks).filter(rack => rack.location === site.id).length * c.rackCU;
    check(slots <= c.siteSlotsCU, 'Facility accelerator slots are oversold by installed or incoming racks.');
  }
  for (const [id, rack] of Object.entries(compute.racks)) {
    record(rack, 'Hardware rack'); identifier(id, 'Rack ID'); check(rack.id === id && companyIds.has(rack.companyId), 'Rack identity or ownership is invalid.');
    check(['ordered', 'inventory', 'installing', 'installed', 'parked'].includes(rack.status), 'Rack status is invalid.');
    check(['general', 'memory-rich', 'training'].includes(rack.hardwareId), 'Rack hardware class is not executable in this wave.');
    const hardware = content.hardware.find(item => item.id === rack.hardwareId); check(hardware, 'Rack hardware is missing from content.');
    check(rack.location === 'colocation' || compute.facilities[rack.location]?.companyId === rack.companyId, 'Rack placement refers to a missing or foreign site.');
    past(rack.orderedWeek, 'Rack order'); checkedInteger(rack.arrivalWeek, 'Rack arrival'); checkedInteger(rack.completedInstallStaff, 'Installation work');
    checkedInteger(rack.purchaseCents, 'Rack purchase'); note(rack.lastBottleneck);
    check(rack.arrivalWeek === rack.orderedWeek + c.deliveryWeeks, 'Rack delivery does not match its lead time.');
    check(rack.purchaseCents === mulDiv(c.rackCU, hardware!.purchaseCentsPerCU, RESOURCE_SCALE), 'Rack purchase price differs from its authored class.');
    check(rack.completedInstallStaff <= c.installationStaffWeeks, 'Rack installation work exceeds its requirement.');
    check(id.startsWith('rack-'), 'Hardware rack is missing its purchase command identity.');
    payment(`capital:${id.slice(5)}`, rack.companyId, id, rack.purchaseCents);
    const fleet = compute.fleets[rack.companyId], deliveries = state.scheduled.filter(item => item.kind === 'equipment_delivery' && item.targetId === id);
    if (rack.status === 'ordered') {
      check(rack.arrivalWeek > state.week && deliveries.length === 1 && !fleet.deliveredEquipmentIds.includes(id) && !fleet.inventory[id], 'Ordered rack has an invalid delivery state.');
      const delivery = deliveries[0];
      check(delivery.companyId === rack.companyId && delivery.dueWeek === rack.arrivalWeek && delivery.quantityCU === c.rackCU
        && delivery.memoryMU === mulDiv(c.rackCU, hardware!.memoryMUPerCU, RESOURCE_SCALE), 'Rack delivery quantities do not match the purchased class.');
    } else check(rack.arrivalWeek <= state.week && fleet.deliveredEquipmentIds.includes(id) && deliveries.length === 0, 'Delivered rack has missing or repeated delivery evidence.');
    if (rack.status === 'inventory') {
      const stock = fleet.inventory[id];
      check(stock && stock.cu === c.rackCU && stock.memoryMU === mulDiv(c.rackCU, hardware!.memoryMUPerCU, RESOURCE_SCALE)
        && stock.arrivedWeek === rack.arrivalWeek, 'Delivered rack inventory does not match its hardware.');
    } else check(!fleet.inventory[id], 'A rack cannot be installed and counted as loose inventory.');
    if (rack.status === 'ordered' || rack.status === 'inventory') {
      check(rack.installationStartedWeek === null && rack.completedInstallStaff === 0 && rack.readyWeek === null && rack.installedWeek === null, 'Uninstalled inventory has installation progress.');
    } else {
      check(rack.installationStartedWeek !== null, 'Installation has no start boundary.'); past(rack.installationStartedWeek!, 'Installation start');
      check(rack.installationStartedWeek! > rack.arrivalWeek, 'Installation cannot start before delivered inventory is available to plan.');
      if (rack.status === 'installing') {
        check(rack.installedWeek === null, 'An unfinished installation has an installed date.');
        if (rack.readyWeek === null) check(rack.completedInstallStaff < c.installationStaffWeeks, 'Finished installation has no next-boundary activation.');
        else check(rack.completedInstallStaff === c.installationStaffWeeks && rack.readyWeek === state.week + 1
          && rack.readyWeek > rack.installationStartedWeek!, 'Installation activation boundary is invalid.');
      } else {
        check(rack.completedInstallStaff === c.installationStaffWeeks && rack.readyWeek !== null && rack.installedWeek === rack.readyWeek,
          'Installed rack does not have complete installation evidence.');
        past(rack.installedWeek!, 'Rack installation'); check(rack.installedWeek! > rack.installationStartedWeek!, 'A rack became usable in its installation week.');
      }
    }
  }
  for (const companyId of companyIds) {
    const racks = Object.values(compute.racks).filter(rack => rack.companyId === companyId), sites = Object.values(compute.facilities).filter(site => site.companyId === companyId);
    check(racks.length <= c.maxRacksPerCompany && sites.length <= c.maxFacilitiesPerCompany, 'Company infrastructure exceeds its supported collection limits.');
    const fleet = compute.fleets[companyId]; checkedInteger(fleet.variableCostCarry, 'Variable cost carry');
    check(fleet.variableCostCarry < RESOURCE_SCALE, 'Owned GPU cost carry exceeds its denominator.');
    check(fleet.ownedCU === getInstalledOwnedCU(state, companyId, content), 'Owned fleet capacity does not reconcile with installed racks.');
    const required = getInfrastructureOperatingStaff(state, companyId, content);
    // Stored diagnostics may describe the just-settled week before an insolvency.
    // The resource boundary separately validates actual current staff coverage.
    const pools = getComputePools(state, companyId, content, [{ requestId: infrastructureOperationsId(companyId), grants: [{ role: 'infrastructure', staffWeeks: required }] }]);
    const maximumMemory = pools.reduce((sum, pool) => sum + pool.memoryMU, 0);
    check(fleet.memoryMU <= maximumMemory, 'Fleet memory exceeds commissioned, nonparked hardware and cloud memory.');
  }
}
