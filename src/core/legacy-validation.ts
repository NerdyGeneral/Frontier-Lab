import type { ComputeFleet, ComputeWave1Fields, DomainSlices, GameCommand, GameContent, GameState, Rejection } from '../contracts/types';
import { PHASES } from '../contracts/types';
const SCHEMA_VERSION = 1;

/** The published Wave 0 shape, before any workforce, lab, or sales records existed. */
export type LegacyGameState = Omit<GameState, 'slices' | 'queuedCommands'> & {
  slices: {
    company: Pick<DomainSlices['company'], 'companies' | 'ledger' | 'postedFacts'>;
    compute: { fleets: Record<string, Omit<ComputeFleet, keyof ComputeWave1Fields>> };
    models: Pick<DomainSlices['models'], 'versions'>;
    data: Pick<DomainSlices['data'], 'packets'>;
    research: DomainSlices['research'];
    products: Pick<DomainSlices['products'], 'activeIds'>;
    markets: Pick<DomainSlices['markets'], 'payingConsumers' | 'waitlistRemaining' | 'activeRivalIds'>;
    agents: DomainSlices['agents'];
    campaign: DomainSlices['campaign'];
  };
  queuedCommands: (Omit<GameCommand, 'payload' | 'reservedCents'> & {
    payload: Extract<GameCommand['payload'], { kind: 'rename_company' | 'allocate_compute' }>;
  })[];
};

function fail(message: string): never { throw new Error(message); }
function integer(v: unknown, label: string, nonnegative = true): void { if (typeof v !== 'number' || !Number.isSafeInteger(v) || (nonnegative && v < 0)) fail(label + ' must be a safe integer in range.'); }
function record(v: unknown, label: string): asserts v is Record<string, unknown> { if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(label + ' must be a record.'); }
function exactKeys(v: object, keys: readonly string[], label: string): void { if (Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) fail(label + ' does not match the published Wave 0 shape.'); }
function list(v: unknown, label: string, max = 10000): asserts v is unknown[] { if (!Array.isArray(v) || v.length > max) fail(label + ' is missing or too large.'); }
function id(v: unknown, label: string): void { if (typeof v !== 'string' || v.length < 1 || v.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(v)) fail(label + ' is invalid.'); }
function text(v: unknown, label: string, max = 2000): void { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) fail(label + ' is invalid.'); }
function choice(v: unknown, options: readonly string[], label: string): void { if (typeof v !== 'string' || !options.includes(v)) fail(label + ' is invalid.'); }
function ids(v: unknown, label: string): void { list(v, label); v.forEach(x => id(x, label)); if (new Set(v).size !== v.length) fail(label + ' contains duplicates.'); }
function scores(v: unknown, label: string): void {
  record(v, label);
  const keys = ['conversation', 'documents', 'coding', 'tools'];
  if (Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) fail(label + ' needs all four capability domains.');
  for (const key of keys) { integer(v[key], label); if ((v[key] as number) > 10000) fail(label + ' exceeds 100%.'); }
}
export function assertSerializableStateValue(v: unknown, depth = 0): void {
  if (depth > 30) fail('State nesting is too deep.');
  if (typeof v === 'number') integer(v, 'Stored number', false);
  else if (typeof v === 'string' && v.length > 2000) fail('Stored text is too long.');
  else if (Array.isArray(v)) { if (v.length > 10000) fail('State collection is too large.'); v.forEach(x => assertSerializableStateValue(x, depth + 1)); }
  else if (v && typeof v === 'object') { const entries = Object.entries(v); if (entries.length > 10000) fail('State record is too large.'); for (const [k, x] of entries) { id(k, 'Record key'); assertSerializableStateValue(x, depth + 1); } }
  else if (v === undefined || typeof v === 'function' || typeof v === 'bigint' || typeof v === 'symbol') fail('State contains an unsupported value.');
}
export function validateLegacyState(state: LegacyGameState, content: Pick<GameContent, 'version' | 'research'>): Rejection[] {
  try {
    record(state, 'State'); assertSerializableStateValue(state);
    if (state.schemaVersion !== SCHEMA_VERSION || state.contentVersion !== content.version) return [{ code: 'INVALID_VERSION', message: 'This snapshot uses an unsupported schema or content version.' }];
    integer(state.week, 'Week'); integer(state.revision, 'Revision'); integer(state.nextId, 'ID counter');
    if (state.nextId < 1 || state.week > 1000000) fail('Week or ID counter is outside supported limits.');
    id(state.playerCompanyId, 'Player company'); id(state.seed, 'Seed'); id(state.buildVersion, 'Build version');
    record(state.random, 'Random state');
    for (const s of Object.values(state.random)) { integer(s.state, 'Random state'); integer(s.draws, 'Draw count'); if (s.state === 0 || s.state > 4294967295) fail('Random state is out of range.'); }
    record(state.slices, 'Domain slices');
    const expected = ['company', 'compute', 'models', 'data', 'research', 'products', 'markets', 'agents', 'campaign'];
    if (Object.keys(state.slices).sort().join(',') !== expected.sort().join(',')) fail('Domain slices are missing or unknown.');
    for (const k of expected) record(state.slices[k as keyof typeof state.slices], k);
    const cs = state.slices.company; record(cs.companies, 'Companies'); record(cs.postedFacts, 'Posted facts'); list(cs.ledger, 'Ledger', 200);
    exactKeys(cs, ['companies', 'ledger', 'postedFacts'], 'Legacy company');
    exactKeys(state.slices.compute, ['fleets'], 'Legacy compute');
    exactKeys(state.slices.models, ['versions'], 'Legacy models');
    exactKeys(state.slices.data, ['packets'], 'Legacy data');
    exactKeys(state.slices.products, ['activeIds'], 'Legacy products');
    exactKeys(state.slices.markets, ['payingConsumers', 'waitlistRemaining', 'activeRivalIds'], 'Legacy markets');
    if (!Object.hasOwn(cs.companies, state.playerCompanyId)) fail('Player company does not exist.');
    for (const [key, c] of Object.entries(cs.companies)) {
      if (c.id !== key) fail('Company identity is invalid.'); text(c.name, 'Company name', 48);
      for (const v of [c.cashCents, c.arrearsCents, c.founderFte, c.activeStaff, c.earnedRevenueCents, c.totalOperatingExpenseCents]) integer(v, 'Company value');
      integer(c.founderOwnershipBps, 'Ownership'); if (c.founderOwnershipBps > 10000) fail('Ownership exceeds 100%.');
      record(c.lastWeek, 'Weekly totals'); integer(c.lastWeek.revenueCents, 'Weekly revenue'); integer(c.lastWeek.operatingExpenseCents, 'Weekly expense'); integer(c.lastWeek.cashChangeCents, 'Cash change', false);
    }
    for (const [key, v] of Object.entries(cs.postedFacts)) { id(key, 'Fact ID'); if (v !== true) fail('Invalid fact receipt.'); }
    const ledgerIds = new Set<string>();
    for (const e of cs.ledger) {
      id(e.id, 'Ledger ID'); id(e.sourceId, 'Ledger source'); text(e.label, 'Ledger label');
      if (!Object.hasOwn(cs.companies, e.companyId) || !Object.hasOwn(cs.postedFacts, e.id) || ledgerIds.has(e.id)) fail('Ledger reference is invalid.'); ledgerIds.add(e.id);
      choice(e.kind, ['expense', 'receipt'], 'Ledger kind'); choice(e.category, ['rent', 'overhead', 'operating', 'revenue', 'capital', 'financing'], 'Ledger category');
      for (const n of [e.amountCents, e.paidCents, e.unpaidCents, e.week]) integer(n, 'Ledger quantity');
      if (e.paidCents + e.unpaidCents !== e.amountCents || e.week > state.week || (e.kind === 'receipt' && e.unpaidCents !== 0)) fail('Ledger payment does not reconcile.');
    }
    record(state.slices.compute.fleets, 'Fleets');
    if (Object.keys(state.slices.compute.fleets).sort().join(',') !== Object.keys(cs.companies).sort().join(',')) fail('Fleet and company records do not match.');
    for (const key of Object.keys(cs.companies)) {
      const f = state.slices.compute.fleets[key]; if (!f || f.companyId !== key) fail('Each company needs its fleet record.');
      exactKeys(f, ['companyId', 'cloudCU', 'ownedCU', 'memoryMU', 'occupiedMemoryMU', 'allocation', 'lastWork', 'reservedCU', 'deliveredEquipmentIds', 'inventory'], 'Legacy fleet');
      for (const n of [f.cloudCU, f.ownedCU, f.memoryMU, f.occupiedMemoryMU, f.reservedCU]) integer(n, 'Fleet quantity');
      record(f.allocation, 'Allocation'); record(f.lastWork, 'Executed work');
      for (const k of ['serving', 'development', 'research'] as const) { integer(f.allocation[k], 'Allocation'); integer(f.lastWork[k], 'Executed work'); }
      const total = f.cloudCU + f.ownedCU;
      if (!Number.isSafeInteger(total) || f.allocation.serving + f.allocation.development + f.allocation.research > total || f.reservedCU > total || f.occupiedMemoryMU > f.memoryMU) fail('Fleet resources are over-allocated.');
      if (f.lastWork.serving + f.lastWork.development + f.lastWork.research > total) fail('Executed work exceeds physical capacity.');
      ids(f.deliveredEquipmentIds, 'Delivered equipment'); record(f.inventory, 'Equipment inventory');
      if (new Set(f.deliveredEquipmentIds).size !== f.deliveredEquipmentIds.length) fail('Duplicate delivery receipt.');
      for (const [eid, stock] of Object.entries(f.inventory)) { id(eid, 'Equipment ID'); if (!f.deliveredEquipmentIds.includes(eid)) fail('Inventory has no delivery receipt.'); integer(stock.cu, 'Inventory CU'); integer(stock.memoryMU, 'Inventory memory'); integer(stock.arrivedWeek, 'Arrival week'); if (stock.arrivedWeek > state.week) fail('Equipment has not arrived yet.'); }
    }
    record(state.slices.models.versions, 'Models');
    for (const [key, m] of Object.entries(state.slices.models.versions)) {
      if (m.id !== key || !Object.hasOwn(cs.companies, m.companyId) || !['checkpoint', 'evaluated', 'released'].includes(m.status)) fail('Model identity or status is invalid.');
      text(m.name, 'Model name'); text(m.source, 'Model source'); choice(m.family, ['compact', 'medium', 'large'], 'Model family'); choice(m.architecture, ['dense', 'sparse'], 'Model architecture');
      scores(m.capabilityBps, 'Model capabilities'); integer(m.reliabilityBps, 'Model reliability'); if (m.reliabilityBps > 10000) fail('Model reliability exceeds its scale.');
      integer(m.residentMU, 'Model memory');
    }
    record(state.slices.data.packets, 'Data packets');
    for (const [key, d] of Object.entries(state.slices.data.packets)) {
      if (d.id !== key) fail('Data identity mismatch.'); text(d.name, 'Data name'); integer(d.rawUnits, 'Raw data'); integer(d.readyUnits, 'Prepared data');
      if (typeof d.prepared !== 'boolean' || d.readyUnits > d.rawUnits || (!d.prepared && d.readyUnits > 0)) fail('Data readiness is inconsistent.');
      scores(d.coverageBps, 'Data coverage'); integer(d.qualityBps, 'Data quality'); if (d.qualityBps > 10000) fail('Data quality exceeds 100%.');
      record(d.rights, 'Data rights'); for (const key of ['hosted', 'weights', 'feedback'] as const) if (typeof d.rights[key] !== 'boolean') fail('Data rights must be explicit.');
    }
    ids(state.slices.research.completed, 'Completed research'); ids(state.slices.research.active, 'Research projects');
    const researchIds = new Set(content.research.map(r => r.id));
    if ([...state.slices.research.completed, ...state.slices.research.active].some(r => !researchIds.has(r))) fail('Research reference is unknown.');
    ids(state.slices.products.activeIds, 'Product IDs'); ids(state.slices.agents.activeJobIds, 'Agent IDs'); ids(state.slices.markets.activeRivalIds, 'Rival IDs');
    integer(state.slices.markets.payingConsumers, 'Paying customers'); integer(state.slices.markets.waitlistRemaining, 'Waitlist');
    ids(state.slices.campaign.milestones, 'Milestones'); record(state.slices.campaign.endingStreaks, 'Ending streaks'); for (const key of ['frontier', 'platform', 'specialist'] as const) integer(state.slices.campaign.endingStreaks[key], 'Ending streak');
    list(state.queuedCommands, 'Command queue', 128); record(state.commandReceipts, 'Command receipts');
    const queuedIds = new Set<string>();
    for (const cmd of state.queuedCommands) {
      exactKeys(cmd, ['id', 'companyId', 'issuedForWeek', 'payload'], 'Legacy command');
      id(cmd.id, 'Command ID'); if (!Object.hasOwn(cs.companies, cmd.companyId) || queuedIds.has(cmd.id) || Object.hasOwn(state.commandReceipts, cmd.id)) fail('Duplicate or invalid queued command.'); queuedIds.add(cmd.id);
      integer(cmd.issuedForWeek, 'Command week'); if (cmd.issuedForWeek <= state.week) fail('A queued command is already overdue.');
      if (!cmd.payload || !['rename_company', 'allocate_compute'].includes(cmd.payload.kind)) fail('Unknown queued command.');
      if (cmd.payload.kind === 'rename_company') text(cmd.payload.name, 'Queued name', 48);
      else if (cmd.payload.kind === 'allocate_compute') for (const key of ['serving', 'development', 'research'] as const) integer(cmd.payload[key], 'Queued allocation');
    }
    for (const [key, receipt] of Object.entries(state.commandReceipts)) {
      if (key !== receipt.id || !['accepted', 'rejected'].includes(receipt.status)) fail('Command receipt is invalid.'); integer(receipt.week, 'Receipt week'); if (receipt.week > state.week) fail('Receipt is from a future week.');
      if (receipt.status === 'rejected') { record(receipt.reason, 'Command rejection'); text(receipt.reason.code, 'Rejection code'); text(receipt.reason.message, 'Rejection message'); }
    }
    list(state.scheduled, 'Scheduled work'); const scheduleIds = new Set<string>();
    for (const s of state.scheduled) { id(s.id, 'Schedule ID'); id(s.targetId, 'Schedule target'); if (!cs.companies[s.companyId] || scheduleIds.has(s.id)) fail('Schedule reference is invalid.'); scheduleIds.add(s.id); integer(s.dueWeek, 'Due week'); if (s.dueWeek <= state.week) fail('Scheduled item is overdue.'); if (!['equipment_delivery', 'model_release'].includes(s.kind)) fail('Unknown scheduled item.'); if (s.kind === 'model_release' && (!Object.hasOwn(state.slices.models.versions, s.targetId) || state.slices.models.versions[s.targetId].companyId !== s.companyId)) fail('Model release must belong to the scheduled company.'); if (s.kind === 'equipment_delivery') { integer(s.quantityCU, 'Delivery CU'); integer(s.memoryMU, 'Delivery memory'); } }
    list(state.journal, 'Journal', 120); for (const j of state.journal) { id(j.id, 'Journal ID'); integer(j.week, 'Journal week'); text(j.message, 'Journal message'); choice(j.category, ['system', 'command', 'finance', 'delivery'], 'Journal category'); if (j.week > state.week) fail('Journal entry is from a future week.'); }
    if (state.lastTick !== null) {
      const t = state.lastTick; record(t, 'Last weekly report'); integer(t.week, 'Report week');
      if (t.week !== state.week) fail('Last weekly report has the wrong week.');
      for (const value of [t.chargedCents, t.receivedCents, t.scheduledCount]) integer(value, 'Report quantity');
      list(t.phases, 'Weekly phases', 7);
      if (t.phases.length !== PHASES.length) fail('Weekly report needs all seven phases.');
      for (let index = 0; index < PHASES.length; index++) { const phase = t.phases[index]; if (phase.phase !== PHASES[index]) fail('Weekly phase order is invalid.'); integer(phase.facts, 'Phase facts'); integer(phase.events, 'Phase events'); }
    } else if (state.week > 0) fail('A settled week needs its report.');
    return [];
  } catch (e) { return [{ code: 'INVALID_STATE', message: e instanceof Error ? e.message : 'The snapshot is not valid.' }]; }
}
