import { AI_SYSTEMS_CONTENT_VERSION } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION } from './model-customization-version';
import { STRATEGY_CONTENT_VERSION } from './strategy-version';
import { initializeMarketOpportunities } from '../modules/market-opportunities';
import { advanceDevelopmentPlans, developmentPlanForCommand, developmentStageAdmission } from '../modules/development-plans';
import { PHASES, RESOURCE_SCALE, SCHEMA_VERSION } from '../contracts/types';
import type { CommandPayload, CommandQuote, DiagnosticResult, DomainModule, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, Phase, PhaseRecord, PreviewResult, Rejection, ResourceFrame, SliceKey, SubmitResult, TickResult } from '../contracts/types';
import { initializeOrigin } from './campaign-origins';
import type { CampaignOrigin, CampaignRules } from '../contracts/wave4-campaign';
import { initializeWave2Fields } from './wave2-state';
import { withPassiveWorkforce } from '../modules/workforce';
import { CONTENT } from '../content/catalog';
import { validateContent } from '../content/validate';
import { canonicalStateHash, freezeDeep } from './canonical';
import { createDefaultModules } from './foundation-modules';
import { checkedAdd, checkedInteger, mulDiv } from './math';
import { COMMAND_KINDS, assertCommandShape } from './command-shape';
import { STUDIO_PLAN_CONFLICT_KINDS } from '../contracts/wave25-studio';
import { getWeeklyBaseCost, reservedCash } from './selectors';
import { drawNamed } from './random';
import { canReuseReadSnapshot, createReadSnapshot } from './read-snapshot';
import { collectResourceResult } from './resources';
import { assertSerializableStateValue, validateState as validateStateAgainst } from './validation';

class EngineError extends Error { code: Rejection['code']; constructor(code: Rejection['code'], message: string) { super(message); this.code = code; } }
const reason = (e: unknown): Rejection => ({ code: e instanceof EngineError ? e.code : 'INVARIANT_FAILED', message: e instanceof Error ? e.message : 'The weekly step could not be completed.' });
export function validateState(state: GameState, content: GameContent = CONTENT): Rejection[] { return validateStateAgainst(state, content); }
export function createInitialState(content: GameContent = CONTENT, rules: CampaignRules = 'classic', origin: CampaignOrigin = 'garage'): GameState {
  const errors = validateContent(content); if (errors.length) throw new EngineError('INVALID_CONTENT', errors.join(' '));
  const o = content.opening;
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION, contentVersion: content.version, buildVersion: content.buildVersion,
    revision: 0, week: 0, nextId: 2, seed: o.seed, playerCompanyId: o.companyId, random: {},
    slices: {
      company: { companies: { [o.companyId]: { id: o.companyId, name: o.companyName, cashCents: o.cashCents, arrearsCents: 0, founderOwnershipBps: 10000, founderFte: RESOURCE_SCALE, activeStaff: 0, earnedRevenueCents: 0, totalOperatingExpenseCents: 0, lastWeek: { revenueCents: 0, operatingExpenseCents: 0, cashChangeCents: 0 } } }, ledger: [], postedFacts: {}, staff: {}, founderAssignments: { [o.companyId]: { research: 0, ml: 0, data: RESOURCE_SCALE, infrastructure: 0, commercial: 0, hardware: 0 } }, lastStaff: {} },
      compute: { fleets: { [o.companyId]: { companyId: o.companyId, cloudCU: o.cloudCU, ownedCU: 0, memoryMU: o.memoryMU, occupiedMemoryMU: 0, allocation: structuredClone(o.allocation), lastWork: { serving: 0, development: 0, research: 0 }, reservedCU: 0, deliveredEquipmentIds: [], inventory: {}, lastBottleneck: '', lastReservedMemoryMU: 0, lastGrants: [], variableCostCarry: 0 } }, racks: {}, facilities: {}, chipDesigns: {}, chipBatches: {}, fabricProjects: {}, servingHistory: {} },
      models: { versions: { [content.seedModel.id]: structuredClone(content.seedModel) }, trainingRuns: {}, evaluationRuns: {}, reports: {}, applicationRuns: {} },
      data: { packets: { [content.starterData.id]: structuredClone(content.starterData) }, preparationJobs: {} },
      research: { completed: [], active: [], completedByCompany: {}, projects: {}, systemRollouts: {}, assistantsByCompany: {} }, products: { activeIds: [], offers: {}, deployments: {}, contracts: {}, lastUsage: {}, invoices: [], retrievalInstalls: {}, commercialContracts: {}, commercialInvoices: [], efficiencyInstalls: {} },
      markets: { companyTrustBps: {}, carries: {}, shopperCarry: {}, rivals: {}, returnedNextWeek: {}, payingConsumers: 0, waitlistRemaining: o.waitlist, activeRivalIds: [], trials: [], cohorts: [], trustBps: 5000, acquisitionCarry: 0, conversionCarry: 0, churnCarry: 0, reachCarry: 0, nextTrialId: 1, lastGained: 0, lastLost: 0, lastTrialCount: 0, lastExplanation: 'A one-time waitlist is ready when Basic Chat launches.' }, agents: { activeJobIds: [], jobs: {}, actionReceipts: {}, invoices: [], claims: {}, totalsByCompany: {} },
      campaign: { milestones: ['company-founded'], endingStreaks: { frontier: 0, platform: 0, specialist: 0 }, history: [], endings: {}, ...(rules === 'release' ? { rules } : {}) },
    },
    queuedCommands: [], commandReceipts: {}, scheduled: [], journal: [{ id: 'event-1', week: 0, category: 'system', message: 'Company founded. Seed 0 is ready for inspection. The lab clock is paused.' }], lastTick: null,
  };
  initializeWave2Fields(state, content);
  initializeOrigin(state, origin);
  if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version)) initializeMarketOpportunities(state);
  const invalid = validateState(state, content); if (invalid.length) throw new EngineError('INVALID_CONTENT', invalid[0].message);
  return rules === 'release' ? withPassiveWorkforce(state) : state;
}
function checkModules(modules: readonly DomainModule[]): void {
  const ids = new Set<string>(), owners = new Map<string, string>(), commandOwners = new Set<string>();
  const slices = ['company', 'compute', 'models', 'data', 'research', 'products', 'markets', 'agents', 'campaign'];
  for (const m of modules) {
    if (!m.id || m.id.length > 80 || ids.has(m.id)) throw new EngineError('DUPLICATE_MODULE', 'Module IDs must be unique and at most 80 characters.'); ids.add(m.id);
    for (const slice of m.owns) { if (!slices.includes(slice) || owners.has(slice)) throw new EngineError('DUPLICATE_MODULE', `${slice} has an invalid or duplicate state owner.`); owners.set(slice, m.id); }
    for (const kind of m.commandKinds ?? []) { if (commandOwners.has(kind)) throw new EngineError('DUPLICATE_MODULE', `${kind} already has a command owner.`); commandOwners.add(kind); }
    if (m.grantResources && !m.owns.includes('company') && !m.owns.includes('compute')) throw new EngineError('FOREIGN_SLICE_WRITE', 'Only company and compute owners may provide resource grants.');
  }
}
function validatePayload(payload: CommandPayload): Rejection | undefined {
  if (!payload || typeof payload !== 'object' || !COMMAND_KINDS.includes(payload.kind)) return { code: 'INVALID_COMMAND', message: 'This command is not available.' };
}
function commandQuote(state: Readonly<GameState>, command: GameCommand, content: GameContent, modules: readonly DomainModule[]): CommandQuote {
  const owner = modules.find(m => m.commandKinds?.includes(command.payload.kind));
  const quote = owner?.quoteCommand?.(state, command, content) ?? { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'This change takes effect at the next weekly boundary.' };
  checkedInteger(quote.upfrontCostCents, 'Upfront quote'); checkedInteger(quote.weeklyCostDeltaCents, 'Recurring quote', false);
  return quote;
}
interface CommandAssessment { rejection?: Rejection; quote?: CommandQuote }
function assessCommand(state: GameState, command: GameCommand, content: GameContent, modules: readonly DomainModule[], availableCash?: number): CommandAssessment {
  const rejected = (rejection: Rejection): CommandAssessment => ({ rejection });
  const malformed = validatePayload(command.payload); if (malformed) return rejected(malformed);
  const planAdmission = developmentStageAdmission(state, command, content, availableCash); if (planAdmission) return rejected(planAdmission);
  if (!Object.hasOwn(state.slices.company.companies, command.companyId)) return rejected({ code: 'UNKNOWN_COMPANY', message: 'The company does not exist.' });
  if (state.slices.company.companies[command.companyId].arrearsCents) return rejected({ code: 'ARREARS', message: 'The company has unpaid bills. Inspect or export this run, or start a new lab.' });
  if (STUDIO_PLAN_CONFLICT_KINDS.includes(command.payload.kind)) {
    const conflict = state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId
      && STUDIO_PLAN_CONFLICT_KINDS.includes(other.payload.kind)
      && (command.payload.kind === 'apply_studio_plan' || other.payload.kind === 'apply_studio_plan'));
    if (conflict) return rejected({ code: 'ALREADY_ACTIVE', message: 'Settle the queued staffing or compute changes before applying another Studio plan. Existing changes are not replaced.' });
  }
  if (command.payload.kind === 'apply_studio_plan') {
    const staged = stageStudioPlan(state, command, content, modules, availableCash);
    return { rejection: staged.rejection, quote: staged.quote };
  }
  const owner = modules.find(m => m.commandKinds?.includes(command.payload.kind));
  if (!owner?.applyCommand) return rejected({ code: 'INVALID_COMMAND', message: 'This action has no registered implementation.' });
  // One immutable read view and one checked quote per assessment. This is never
  // retained across public calls; every submission still revalidates admission.
  const snapshot = freezeDeep(structuredClone(state));
  const reusable = canReuseReadSnapshot(snapshot);
  const rejection = owner.validateCommand?.(snapshot, structuredClone(command), content);
  if (rejection) return rejected(rejection);
  const quote = commandQuote(reusable ? snapshot : freezeDeep(structuredClone(state)), command, content, modules);
  const authorizedStage = developmentPlanForCommand(state, command.id)?.steps.find(step => step.commandId === command.id);
  if (authorizedStage && authorizedStage.feeCents !== quote.upfrontCostCents) return rejected({ code: 'NOT_READY', message: 'The stage fee changed after scheduling. Review the plan limits and resume to use the new quote.' });
  const available = availableCash ?? state.slices.company.companies[command.companyId].cashCents - reservedCash(state, command.companyId);
  if (quote.upfrontCostCents > available) return { quote, rejection: { code: 'INSUFFICIENT_FUNDS', message: 'There is not enough uncommitted cash for this action. Queued fees already reserve part of your funds.' } };
  return { quote };
}
function event(state: GameState, category: GameState['journal'][number]['category'], message: string): void {
  const id = 'event-' + state.nextId; state.nextId = checkedAdd(state.nextId, 1);
  state.journal.push({ id, week: state.week, category, message }); state.journal = state.journal.slice(-120);
}
function applyResult(state: GameState, module: DomainModule, result: DomainResult, facts: LedgerFact[], allowFacts = true): void {
  assertSerializableStateValue(result);
  if (result.updates) for (const key of Object.keys(result.updates) as SliceKey[]) {
    if (!module.owns.includes(key)) throw new EngineError('FOREIGN_SLICE_WRITE', `${module.id} cannot update ${key}.`);
    Object.assign(state.slices, { [key]: structuredClone(result.updates[key]) });
  }
  for (const f of result.facts ?? []) {
    if (!allowFacts) throw new EngineError('INVALID_FACT', 'Facts cannot be added after settlement.');
    if (!f.id || !f.sourceId || ['__proto__', 'constructor', 'prototype'].includes(f.id) || !Object.hasOwn(state.slices.company.companies, f.companyId) || f.week !== state.week || !Number.isSafeInteger(f.amountCents) || f.amountCents < 0 || !['expense', 'receipt'].includes(f.kind) || !['rent', 'overhead', 'operating', 'revenue', 'capital', 'financing'].includes(f.category)) throw new EngineError('INVALID_FACT', 'An economic fact is invalid.');
    const same = facts.find(x => x.id === f.id); if (same && canonicalStateHash(same) !== canonicalStateHash(f)) throw new EngineError('INVALID_FACT', 'A fact ID was reused for a different charge.');
    facts.push(structuredClone(f));
  }
  for (const msg of result.messages ?? []) if (!msg.companyId || msg.companyId === state.playerCompanyId || msg.public) event(state, msg.category, msg.message);
  for (const s of result.schedule ?? []) {
    if (!Number.isSafeInteger(s.dueWeek) || s.dueWeek <= state.week || state.scheduled.some(x => x.id === s.id)) throw new EngineError('INVARIANT_FAILED', 'New work must be scheduled for a unique future boundary.');
    state.scheduled.push(structuredClone(s));
  }
  for (const id of result.fulfilledScheduleIds ?? []) {
    const s = state.scheduled.find(x => x.id === id);
    if (!s || s.dueWeek !== state.week || !module.owns.includes(s.kind === 'model_release' ? 'models' : 'compute')) throw new EngineError('FOREIGN_SLICE_WRITE', 'Only the owner can complete a due scheduled item.');
    state.scheduled = state.scheduled.filter(x => x.id !== id);
  }
}

/** Route a bounded transaction through the ordinary slice owners on a private candidate.
 * The caller publishes this candidate only when every member passes revalidation. */
function stageStudioPlan(state: GameState, command: GameCommand, content: GameContent, modules: readonly DomainModule[], availableCash?: number, priorFacts: readonly LedgerFact[] = []) {
  const quote: CommandQuote = { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Apply the reviewed staffing and compute plan together at the next weekly boundary.' };
  const candidate = structuredClone(state), facts = structuredClone(priorFacts) as LedgerFact[];
  const rejected = (rejection: Rejection) => ({ state, facts: [...priorFacts], quote, rejection });
  try {
    assertCommandShape(command.payload);
    if (command.payload.kind !== 'apply_studio_plan') return rejected({ code: 'INVALID_COMMAND', message: 'Choose a supported Studio plan.' });
    candidate.queuedCommands = candidate.queuedCommands.filter(other => other.id !== command.id);
    const initialAvailable = availableCash ?? candidate.slices.company.companies[command.companyId].cashCents - reservedCash(candidate, command.companyId);
    for (const [index, payload] of command.payload.commands.entries()) {
      const member: GameCommand = { id: `${command.id}:plan:${index}`, companyId: command.companyId, issuedForWeek: command.issuedForWeek, payload: structuredClone(payload) };
      const assessment = assessCommand(candidate, member, content, modules, initialAvailable - quote.upfrontCostCents);
      if (assessment.rejection) return rejected({ ...assessment.rejection, message: `Studio plan change ${index + 1} (${payload.kind}): ${assessment.rejection.message} No part of this plan was applied.` });
      const memberQuote = assessment.quote!;
      const owner = modules.find(module => module.commandKinds?.includes(payload.kind))!;
      const result = owner.applyCommand!(freezeDeep(structuredClone(candidate)), member, content);
      const cost = (result.facts ?? []).filter(fact => fact.kind === 'expense').reduce((total, fact) => checkedAdd(total, fact.amountCents), 0);
      if (cost !== memberQuote.upfrontCostCents) throw new EngineError('INVALID_FACT', 'The Studio plan charge does not match its validated quote.');
      collectResourceResult({ requests: [], staffGrants: [], computeGrants: [] }, owner, result, 'closed', candidate, content);
      applyResult(candidate, owner, result, facts);
      quote.upfrontCostCents = checkedAdd(quote.upfrontCostCents, memberQuote.upfrontCostCents);
      quote.weeklyCostDeltaCents = checkedAdd(quote.weeklyCostDeltaCents, memberQuote.weeklyCostDeltaCents);
    }
    return { state: candidate, facts, quote, rejection: undefined };
  } catch (error) { return rejected(reason(error)); }
}
export function previewCommand(state: GameState, payload: CommandPayload, content: GameContent = CONTENT): PreviewResult {
  const f = state.slices.compute.fleets[state.playerCompanyId];
  const weekly = getWeeklyBaseCost(state, content);
  let r: Rejection | undefined, quote: CommandQuote = { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: '' };
  const command = { id: 'preview', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload };
  const modules = createDefaultModules(content);
  try { const assessment = assessCommand(state, command, content, modules); r = assessment.rejection; if (!r || r.code === 'INSUFFICIENT_FUNDS') quote = assessment.quote ?? quote; } catch (e) { r = reason(e); }
  return { accepted: !r, ...(r ? { reason: r } : {}), sourceRevision: state.revision, summary: r?.message ?? quote.summary, weeklyCostCents: weekly, upfrontCostCents: quote.upfrontCostCents, weeklyCostDeltaCents: quote.weeklyCostDeltaCents, cashAfterCommitmentsCents: state.slices.company.companies[state.playerCompanyId].cashCents - reservedCash(state) - quote.upfrontCostCents, availableCU: f.cloudCU + f.ownedCU, ...(payload.kind === 'allocate_compute' ? { allocation: { serving: payload.serving, development: payload.development, research: payload.research } } : {}) };
}
export function submitCommand(state: GameState, payload: CommandPayload, content: GameContent = CONTENT, explicitId?: string): SubmitResult {
  try {
    const invalid = validateState(state, content); if (invalid.length) return { state, accepted: false, reason: invalid[0] };
    const id = explicitId ?? `command-${state.nextId}`;
    if (typeof id !== 'string' || !id.length || id.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(id)) return { state, accepted: false, reason: { code: 'INVALID_COMMAND', message: 'The command ID is invalid or too long.' } };
    if (Object.hasOwn(state.commandReceipts, id) || state.queuedCommands.some(c => c.id === id)) return { state, accepted: false, reason: { code: 'DUPLICATE_COMMAND', message: 'This command has already been queued or applied.' } };
    if (state.queuedCommands.length >= 128) return { state, accepted: false, reason: { code: 'QUEUE_FULL', message: 'Apply the queued changes before adding more.' } };
    const command: GameCommand = { id, companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: structuredClone(payload) };
    const modules = createDefaultModules(content);
    const assessment = assessCommand(state, command, content, modules); if (assessment.rejection) return { state, accepted: false, reason: assessment.rejection };
    const quote = assessment.quote!; command.reservedCents = quote.upfrontCostCents;
    const next = structuredClone(state); next.nextId = checkedAdd(next.nextId, 1); next.revision = checkedAdd(next.revision, 1); next.queuedCommands.push(command);
    event(next, 'command', 'Queued: ' + quote.summary);
    const errors = validateState(next, content); if (errors.length) throw new EngineError('INVARIANT_FAILED', errors[0].message);
    return { state: next, accepted: true, commandId: id };
  } catch (e) { return { state, accepted: false, reason: reason(e) }; }
}
export function advanceWeek(state: GameState, content: GameContent = CONTENT, modules: readonly DomainModule[] = createDefaultModules(content)): TickResult {
  try {
    const invalid = validateState(state, content); if (invalid.length) return { state, accepted: false, reason: invalid[0] };
    if (state.slices.company.companies[state.playerCompanyId].arrearsCents > 0) return { state, accepted: false, reason: { code: 'ARREARS', message: 'The clock is paused because expenses are unpaid. Export or restart this run.' } };
    checkModules(modules);
    const next = structuredClone(state); next.week = checkedAdd(next.week, 1); next.revision = checkedAdd(next.revision, 1);
    const facts: LedgerFact[] = [], phases: PhaseRecord[] = [], readSnapshot = createReadSnapshot();
    const resources: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] };
    const contextFor = (m: DomainModule, phase: Phase): ModuleContext => freezeDeep({ week: next.week, phase, content: structuredClone(content), facts: structuredClone(facts), resources: structuredClone(resources), random: { draw: (key: string) => {
      const draw = drawNamed(next, m.id + ':' + key);
      next.random = draw.state.random;
      return draw.value;
    } } });
    for (const phase of PHASES) {
      const beforeFacts = facts.length, beforeEvents = next.nextId;
      const ordered = phase === 'settle' ? [...modules].sort((a, b) => Number(a.owns.includes('company')) - Number(b.owns.includes('company'))) : modules;
      for (const m of ordered) {
        const handler = m.handlers[phase]; if (!handler) continue;
        const snapshot = readSnapshot(next);
        const ctx = contextFor(m, phase);
        const result = handler(snapshot, ctx);
        collectResourceResult(resources, m, result, phase === 'reserve' ? 'request' : 'closed', next, content);
        applyResult(next, m, result, facts, phase !== 'market' && phase !== 'plan');
        if (result.commands?.length) {
          if (phase !== 'plan' || !m.owns.includes('markets')) throw new EngineError('FOREIGN_SLICE_WRITE', 'Only the market planner may propose rival commands.');
          for (const planned of result.commands) {
            if (planned.companyId === next.playerCompanyId || !next.slices.markets.rivals[planned.companyId] || next.queuedCommands.length >= 128) continue;
            const command: GameCommand = { id: 'rival-command-' + next.nextId, companyId: planned.companyId, issuedForWeek: next.week + 1, payload: structuredClone(planned.payload) };
            const assessment = assessCommand(next, command, content, modules);
            if (assessment.rejection) continue;
            command.reservedCents = assessment.quote!.upfrontCostCents;
            next.nextId = checkedAdd(next.nextId, 1); next.queuedCommands.push(command);
          }
        }
      }
      if (phase === 'reserve') {
        const grantOwners = [...modules].filter(m => m.grantResources).sort((a, b) => Number(b.owns.includes('company')) - Number(a.owns.includes('company')));
        for (const m of grantOwners) {
          const result = m.grantResources!(readSnapshot(next), contextFor(m, phase));
          collectResourceResult(resources, m, result, 'grant', next, content);
          applyResult(next, m, result, facts);
        }
      }
      if (phase === 'commit') {
        const stopPriority = (command: GameCommand) => command.payload.kind === 'cancel_development_plan' || command.payload.kind === 'set_development_plan_paused' && command.payload.paused ? 0 : 1;
        const due = next.queuedCommands.filter(c => c.issuedForWeek <= next.week).sort((a, b) => stopPriority(a) - stopPriority(b)); next.queuedCommands = next.queuedCommands.filter(c => c.issuedForWeek > next.week);
        for (const command of due) {
          if (Object.hasOwn(next.commandReceipts, command.id)) continue;
          const committed = facts.filter(f => f.companyId === command.companyId && f.kind === 'expense' && !Object.hasOwn(next.slices.company.postedFacts, f.id)).reduce((sum, f) => checkedAdd(sum, f.amountCents), 0);
          const available = next.slices.company.companies[command.companyId].cashCents - committed - reservedCash(next, command.companyId);
          if (command.payload.kind === 'apply_studio_plan') {
            const staged = stageStudioPlan(next, command, content, modules, available, facts);
            if (staged.rejection) {
              next.commandReceipts[command.id] = { id: command.id, week: next.week, status: 'rejected', reason: staged.rejection };
              if (command.companyId === next.playerCompanyId) event(next, 'command', staged.rejection.message);
            } else {
              Object.assign(next, staged.state);
              facts.splice(0, facts.length, ...staged.facts);
              next.commandReceipts[command.id] = { id: command.id, week: next.week, status: 'accepted' };
              if (command.companyId === next.playerCompanyId) event(next, 'command', 'The reviewed Studio plan applied in full.');
            }
            continue;
          }
          const assessment = assessCommand(next, command, content, modules, available);
          if (assessment.rejection) { next.commandReceipts[command.id] = { id: command.id, week: next.week, status: 'rejected', reason: assessment.rejection }; if (command.companyId === next.playerCompanyId) event(next, 'command', assessment.rejection.message); continue; }
          const owner = modules.find(m => m.commandKinds?.includes(command.payload.kind))!;
          const quote = assessment.quote!;
          const result = owner.applyCommand!(readSnapshot(next), command, content);
          const cost = (result.facts ?? []).filter(f => f.kind === 'expense').reduce((sum, f) => checkedAdd(sum, f.amountCents), 0);
          if (cost !== quote.upfrontCostCents) throw new EngineError('INVALID_FACT', 'The command charge does not match its validated quote.');
          collectResourceResult(resources, owner, result, 'closed', next, content);
          applyResult(next, owner, result, facts);
          next.commandReceipts[command.id] = { id: command.id, week: next.week, status: 'accepted' };
        }
      }
      phases.push({ phase, facts: facts.length - beforeFacts, events: next.nextId - beforeEvents });
    }
    advanceDevelopmentPlans(next, content, command => assessCommand(next, command, content, modules), message => event(next, 'project', message));
    const newlyPosted = next.slices.company.ledger.filter(f => !Object.hasOwn(state.slices.company.postedFacts, f.id));
    next.lastTick = { week: next.week, phases, chargedCents: newlyPosted.filter(f => f.kind === 'expense').reduce((a, f) => a + f.amountCents, 0), receivedCents: newlyPosted.filter(f => f.kind === 'receipt').reduce((a, f) => a + f.amountCents, 0), scheduledCount: next.scheduled.length };
    const errors = validateState(next, content); if (errors.length) throw new EngineError('INVARIANT_FAILED', errors[0].message);
    return { state: next, accepted: true };
  } catch (e) { return { state, accepted: false, reason: reason(e) }; }
}
export function runDiagnostics(state: GameState, content: GameContent = CONTENT): DiagnosticResult {
  const liveHash = canonicalStateHash(state), checks: DiagnosticResult['checks'] = [];
  const contentErrors = validateContent(content), stateErrors = validateState(state, content);
  checks.push({ name: 'Catalog and state', passed: contentErrors.length === 0 && stateErrors.length === 0, detail: contentErrors[0] ?? stateErrors[0]?.message ?? 'Versions, quantities, references and research prerequisites are valid.' });
  let a = createInitialState(content), b = createInitialState(content), ok = true;
  const openingBills = new Set<string>();
  let openingBillCount = 0;
  for (let i = 0; i < 20; i++) {
    const ra = advanceWeek(a, content), rb = advanceWeek(b, content);
    if (!ra.accepted || !rb.accepted) { ok = false; break; }
    a = ra.state; b = rb.state;
    for (const entry of a.slices.company.ledger) {
      if (entry.week === a.week && (entry.id === `${a.playerCompanyId}:cloud-rent:${a.week}` || entry.id === `${a.playerCompanyId}:overhead:${a.week}`)) {
        openingBills.add(entry.id); openingBillCount += 1;
      }
    }
  }
  checks.push({ name: 'Deterministic replay', passed: ok && canonicalStateHash(a) === canonicalStateHash(b), detail: 'Two isolated 20-week opening runs produce the same saved-state fingerprint.' });
  const c = a.slices.company.companies[a.playerCompanyId];
  const expected = content.opening.cashCents - 20 * (mulDiv(content.opening.cloudCU, content.opening.rentCentsPerCUWeek, RESOURCE_SCALE) + content.opening.overheadCentsPerWeek);
  checks.push({ name: 'Single financial ledger', passed: ok && c.cashCents === expected && c.totalOperatingExpenseCents === content.opening.cashCents - expected && openingBillCount === 40 && openingBills.size === 40, detail: 'Twenty weeks charge twenty rent bills and twenty overhead bills, exactly once.' });
  const previewHash = canonicalStateHash(state); previewCommand(state, { kind: 'allocate_compute', serving: 0, development: content.opening.cloudCU, research: 0 }, content);
  checks.push({ name: 'Read-only forecasts', passed: canonicalStateHash(state) === previewHash, detail: 'Inspecting a quote leaves money, pending commands and saved randomness unchanged.' });
  const bad = submitCommand(state, { kind: 'allocate_compute', serving: -1, development: 0, research: 0 }, content);
  checks.push({ name: 'Atomic rejection', passed: !bad.accepted && canonicalStateHash(bad.state) === liveHash, detail: 'An invalid allocation is rejected without changing the company.' });
  return { ok: checks.every(c => c.passed), checks, fingerprint: liveHash };
}
