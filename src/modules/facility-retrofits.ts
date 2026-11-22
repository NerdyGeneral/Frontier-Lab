import { formatWorkPoints } from './workforce-points';
import { CONTENT } from '../content/catalog';
import { FACILITY_RETROFITS, FACILITY_RETROFIT_RULES, facilityRetrofitDefinition } from '../content/wave8-retrofits';
import type { CommandQuote, ComputeSlice, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import type { FacilityRetrofit } from '../contracts/wave8-retrofits';
import { RIVAL_STARTS } from '../core/wave2-state';
import { checkedAdd, formatMoney, formatUnits } from '../core/math';

export const FACILITY_RETROFIT_COMMANDS = ['start_facility_retrofit', 'set_facility_retrofit_paused'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const records = (compute: Readonly<ComputeSlice>): FacilityRetrofit[] => Object.values(compute.facilityRetrofits ?? {});
const workId = (id: string) => `facility-retrofit-work:${id}`;

/** New player applications need earned, available research; authored rival knowledge remains a scenario asset. */
export function facilityRetrofitResearchReady(state: Readonly<GameState>, companyId: string, atWeek = state.week): boolean {
  const known = state.slices.research.completedByCompany[companyId]
    ?? (companyId === state.playerCompanyId ? state.slices.research.completed : []);
  if (!known.includes(FACILITY_RETROFIT_RULES.requiredResearch)) return false;
  const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId
    && item.researchId === FACILITY_RETROFIT_RULES.requiredResearch);
  if (project) return project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek;
  return companyId !== state.playerCompanyId && RIVAL_STARTS.some(item => `rival-${item.id}` === companyId
    && item.research.includes(FACILITY_RETROFIT_RULES.requiredResearch));
}

/** Read-only effects avoid importing compute-pools: that module is the physical consumer of these receipts. */
export function getActiveFacilityRetrofitEffects(state: Readonly<GameState>, companyId: string, facilityId?: string) {
  let powerUnits = 0, coolingUnits = 0, weeklyCents = 0, operatingStaff = 0;
  for (const project of records(state.slices.compute)) {
    if (project.companyId !== companyId || project.status !== 'active' || (facilityId !== undefined && project.facilityId !== facilityId)) continue;
    const definition = facilityRetrofitDefinition(project.kind);
    if (project.kind === 'power-feed') powerUnits = Math.max(powerUnits, definition.envelopeUnits);
    else coolingUnits = Math.max(coolingUnits, definition.envelopeUnits);
    weeklyCents = checkedAdd(weeklyCents, definition.weeklyCents);
    operatingStaff = checkedAdd(operatingStaff, definition.operatingStaff);
  }
  return { powerUnits, coolingUnits, weeklyCents, operatingStaff };
}

export function validateFacilityRetrofitCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload, company = state.slices.company.companies[command.companyId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (company.arrearsCents > 0) return reject('ARREARS', 'Resolve unpaid bills before changing a site retrofit.');
  if (p.kind === 'start_facility_retrofit') {
    if (!FACILITY_RETROFITS.some(item => item.kind === p.retrofitKind)) return reject('INVALID_COMMAND', 'Choose a power feed extension or a cooling loop expansion.');
    if (!facilityRetrofitResearchReady(state, command.companyId)) return reject('NOT_READY', 'Research Enterprise operations (R12) before commissioning site extensions.');
    const site = Object.hasOwn(state.slices.compute.facilities, p.facilityId) ? state.slices.compute.facilities[p.facilityId] : undefined;
    if (!site || site.companyId !== command.companyId || site.status !== 'active') return reject('NOT_READY', 'Choose one of your operational owned data centers. Colocation and unfinished sites cannot receive this extension.');
    if (records(state.slices.compute).some(item => item.companyId === command.companyId && item.facilityId === site.id && item.kind === p.retrofitKind)
      || state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId
        && item.payload.kind === 'start_facility_retrofit' && item.payload.facilityId === site.id && item.payload.retrofitKind === p.retrofitKind)) {
      return reject('ALREADY_ACTIVE', 'This site already has that extension or a queued project. Resume its saved work.');
    }
    return;
  }
  if (p.kind === 'set_facility_retrofit_paused') {
    const project = state.slices.compute.facilityRetrofits && Object.hasOwn(state.slices.compute.facilityRetrofits, p.retrofitId)
      ? state.slices.compute.facilityRetrofits[p.retrofitId] : undefined;
    if (!project || project.companyId !== command.companyId) return reject('NOT_READY', 'Choose one of your site extension projects.');
    if (project.status !== 'building') return reject('NO_IMPROVEMENT', 'The extension work is complete; it is commissioning or already active.');
    if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether the site extension is paused.');
    if (project.paused === p.paused) return reject('ALREADY_ACTIVE', p.paused ? 'The extension is already paused.' : 'The extension is already running.');
    return;
  }
  return reject('INVALID_COMMAND', 'This is not a facility retrofit command.');
}

export function quoteFacilityRetrofitCommand(_state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_facility_retrofit') {
    const d = facilityRetrofitDefinition(p.retrofitKind);
    return { upfrontCostCents: d.purchaseCents, weeklyCostDeltaCents: 0,
      summary: `${d.name}: ${formatMoney(d.purchaseCents)} now, ${d.requiredWeeks} elapsed weeks and ${formatWorkPoints(d.requiredStaff)} Operations points. At the following activation boundary, the site's ${d.envelopeName.toLowerCase()} limit rises to ${formatUnits(d.envelopeUnits)} units and upkeep increases by ${formatMoney(d.weeklyCents)}/week plus ${formatWorkPoints(d.operatingStaff)} Operations points per week. Rack slots and hardware stay separate.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: p.kind === 'set_facility_retrofit_paused' && p.paused
      ? 'Pause both elapsed and staff-work progress next week. Paid fees and completed work remain.'
      : 'Resume the saved site extension next week. Both elapsed time and infrastructure work must finish.' };
}

export function applyFacilityRetrofitCommand(state: Readonly<GameState>, command: GameCommand, _content: GameContent = CONTENT): DomainResult {
  const compute = structuredClone(state.slices.compute), p = command.payload, facts: LedgerFact[] = [];
  let message = '';
  if (p.kind === 'start_facility_retrofit') {
    const d = facilityRetrofitDefinition(p.retrofitKind), id = `facility-retrofit-${command.id}`, paymentId = `facility-retrofit-capital:${id}`;
    compute.facilityRetrofits ??= {};
    compute.facilityRetrofits[id] = { id, companyId: command.companyId, facilityId: p.facilityId, kind: p.retrofitKind,
      status: 'building', paused: false, startedWeek: state.week, requiredWeeks: d.requiredWeeks, elapsedWeeks: 0,
      requiredStaff: d.requiredStaff, completedStaff: 0, completedWeek: null, readyWeek: null,
      purchaseCents: d.purchaseCents, paymentId, lastBottleneck: 'Funded; elapsed time and infrastructure staff work are required.' };
    facts.push({ id: paymentId, companyId: command.companyId, week: state.week, sourceId: id,
      category: 'capital', amountCents: d.purchaseCents, label: `${state.slices.compute.facilities[p.facilityId].name}: ${d.name}`, kind: 'expense' });
    message = `${d.name} funded. Existing site capacity continues while elapsed time and installation effort complete.`;
  } else if (p.kind === 'set_facility_retrofit_paused') {
    const project = compute.facilityRetrofits![p.retrofitId];
    project.paused = p.paused;
    project.lastBottleneck = p.paused ? 'Extension paused; paid work and elapsed progress are retained.' : 'Extension resumed.';
    message = `${facilityRetrofitDefinition(project.kind).name} ${p.paused ? 'paused' : 'resumed'}.`;
  }
  return { updates: { compute }, facts, messages: [{ companyId: command.companyId, category: 'project', message }] };
}

export function facilityRetrofitCommit(_state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of records(compute)) {
    if (project.status !== 'ready' || project.readyWeek === null || project.readyWeek > context.week) continue;
    project.status = 'active'; project.lastBottleneck = '';
    const d = facilityRetrofitDefinition(project.kind);
    messages.push({ companyId: project.companyId, category: 'delivery',
      message: `${compute.facilities[project.facilityId].name}: ${d.name} commissioned. ${d.envelopeName} limit is now ${formatUnits(d.envelopeUnits)} units; extension upkeep and operating staff begin this week.` });
  }
  return messages;
}

export function facilityRetrofitRequests(state: Readonly<GameState>, _content: GameContent = CONTENT): WorkRequest[] {
  return records(state.slices.compute).filter(project => project.status === 'building' && !project.paused).map(project => ({
    id: workId(project.id), companyId: project.companyId, taskId: project.id, category: 'development', normalizedWorkCUw: 0,
    memoryMU: 0, priority: FACILITY_RETROFIT_RULES.requestPriority, poolId: 'auto',
    staffDemand: [{ role: 'infrastructure', staffWeeks: Math.max(0, project.requiredStaff - project.completedStaff) }],
  }));
}

export function advanceFacilityRetrofits(state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): void {
  for (const project of records(compute)) {
    if (project.status !== 'building' || project.paused) continue;
    if (state.slices.company.companies[project.companyId].arrearsCents > 0) {
      project.lastBottleneck = 'Unpaid bills; extension work is suspended.'; continue;
    }
    const staff = context.resources.staffGrants.find(grant => grant.requestId === workId(project.id))?.grants
      .find(grant => grant.role === 'infrastructure')?.staffWeeks ?? 0;
    const required = project.requiredStaff - project.completedStaff;
    if (staff > required) throw new Error('Site extension staff grant exceeds its remaining paid work.');
    project.completedStaff = checkedAdd(project.completedStaff, staff);
    project.elapsedWeeks = Math.min(project.requiredWeeks, project.elapsedWeeks + 1);
    project.lastBottleneck = project.completedStaff < project.requiredStaff
      ? 'Operations points reach retrofits after operating coverage, rack installation and construction.'
      : project.elapsedWeeks < project.requiredWeeks ? 'Staff work is complete; the physical extension still needs elapsed weeks.' : '';
  }
}

export function resolveFacilityRetrofits(_state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of records(compute)) {
    if (project.status !== 'building' || project.paused || project.elapsedWeeks < project.requiredWeeks || project.completedStaff < project.requiredStaff) continue;
    project.status = 'ready'; project.completedWeek = context.week; project.readyWeek = context.week + 1;
    project.lastBottleneck = `Work complete; the extension commissions in week ${project.readyWeek}.`;
    messages.push({ companyId: project.companyId, category: 'project',
      message: `${facilityRetrofitDefinition(project.kind).name} finished its elapsed and staff-work requirements. The site envelope and upkeep change next week.` });
  }
  return messages;
}

export function getFacilityRetrofitsView(state: Readonly<GameState>, facilityId: string, companyId = state.playerCompanyId) {
  const site = state.slices.compute.facilities[facilityId];
  return { researched: facilityRetrofitResearchReady(state, companyId), operational: site?.companyId === companyId && site.status === 'active',
    effects: getActiveFacilityRetrofitEffects(state, companyId, facilityId),
    choices: FACILITY_RETROFITS.map(definition => ({ ...definition,
      project: records(state.slices.compute).find(project => project.companyId === companyId && project.facilityId === facilityId && project.kind === definition.kind) ?? null })) };
}
