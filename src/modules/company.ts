import { RESOURCE_SCALE } from '../contracts/types';
import type { CompanySlice, DomainModule, GameCommand, GameContent, GameState, LedgerFact, Rejection, RoleAllocation, StaffGrant } from '../contracts/types';
import { checkedAdd, formatMoney } from '../core/math';
import { compareStaffPriority, emptyRoleAllocation, getWeeklyStaffSupply, usesPassiveWorkforce, isQuarterFte, STAFF_ROLES } from './workforce';
import { staffDisplayName, canChooseStaffSpecialty, CAREER_RANKS, careerLevel, careerSalary, SPECIALTY_BONUS, STAFF_CAREER_PATHS, settleStaffCareers } from './staff-careers';
import { formatWorkPoints, getEmployeeWorkOutput, getStaffPointProfile, WORK_POINT_LABELS } from './workforce-points';

export { getPayrollCents, getWorkforce } from './workforce';

function rejection(code: Rejection['code'], message: string): Rejection { return { code, message }; }
function expense(command: GameCommand, week: number, id: string, amountCents: number, label: string): LedgerFact {
  return { id, companyId: command.companyId, week, sourceId: command.id, category: 'operating', amountCents, label, kind: 'expense' };
}
function readyCount(company: CompanySlice, companyId: string, week: number): number {
  return Object.values(company.staff).filter(member => member.companyId === companyId && member.readyWeek <= week).length;
}

function pointOutputSummary(output: RoleAllocation): string {
  return STAFF_ROLES.filter(role => output[role] > 0).sort((a, b) => output[b] - output[a] || a.localeCompare(b))
    .map(role => `${formatWorkPoints(output[role])} ${WORK_POINT_LABELS[role]}`).join(', ') || '0';
}

/** Only recurring, week-qualified namespaces may expire. Unknown IDs remain proofs. */
function periodicNamespaces(state: Readonly<GameState>): Set<string> {
  const namespaces = new Set<string>();
  for (const companyId of Object.keys(state.slices.company.companies)) {
    for (const suffix of ['overhead', 'cloud-rent', 'owned-fixed', 'owned-variable']) namespaces.add(`${companyId}:${suffix}`);
  }
  for (const member of Object.values(state.slices.company.staff)) namespaces.add(`${member.id}:payroll`);
  for (const product of Object.values(state.slices.products.offers)) namespaces.add(`invoice:${product.id}`);
  return namespaces;
}

function periodicWeek(factId: string, namespaces: ReadonlySet<string>): number | null {
  const separator = factId.lastIndexOf(':'), namespace = factId.slice(0, separator), suffix = factId.slice(separator + 1);
  // Hired staff use this namespace even after dismissal removes the member record.
  const formerPayroll = namespace.startsWith('staff:') && namespace.endsWith(':payroll');
  const wave3Receipt = namespace.startsWith('business-invoice:business:') || namespace.startsWith('invoice:agent:') || namespace.startsWith('agent-penalty:') || namespace.startsWith('assurance-invoice:');
  if ((!namespaces.has(namespace) && !formerPayroll && !wave3Receipt) || !/^[1-9]\d*$/.test(suffix)) return null;
  const week = Number(suffix);
  return Number.isSafeInteger(week) ? week : null;
}

export function createCompanyModule(content: GameContent): DomainModule {
  return {
    id: 'company', owns: ['company'],
    commandKinds: ['rename_company', 'hire_staff', 'specialize_staff', 'dismiss_staff', 'assign_founder', 'set_staff_allocation'],
    validateCommand(state, command) {
      const record = state.slices.company.companies[command.companyId];
      if (!record) return rejection('UNKNOWN_COMPANY', 'The company does not exist.');
      if (record.arrearsCents > 0) return rejection('ARREARS', 'Company changes are paused while bills are unpaid.');
      const payload = command.payload;
      switch (payload.kind) {
        case 'rename_company':
          if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(payload.name)) {
            return rejection('INVALID_NAME', 'Use a company name between 1 and 48 characters.');
          }
          return;
        case 'hire_staff': {
          const definition = content.staff.find(role => role.id === payload.role);
          if (!definition) return rejection('INVALID_COMMAND', 'Choose a recognized staff role.');
          if (payload.role === 'hardware' && !(state.slices.research.completedByCompany[command.companyId] ?? []).includes('R16')
            && !Object.values(state.slices.research.projects).some(project => project.companyId === command.companyId && project.researchId === 'R16')) {
            return rejection('NOT_READY', 'Start Chip feasibility research to recruit hardware specialists. Entry opens hiring before the hardware research work is complete.');
          }
          if (Object.hasOwn(state.slices.company.staff, `staff:${command.id}`)) return rejection('ALREADY_ACTIVE', 'This recruitment has already created an employee.');
          return;
        }
        case 'specialize_staff': {
          const member = Object.hasOwn(state.slices.company.staff, payload.staffId) ? state.slices.company.staff[payload.staffId] : undefined;
          if (!member || member.companyId !== command.companyId || !usesPassiveWorkforce(state, command.companyId)) return rejection('INVALID_COMMAND', 'Choose an employee at your lab.');
          if (!canChooseStaffSpecialty(member)) return rejection('NOT_READY', member.career?.specialty ? 'This employee already chose a career specialty.' : 'This employee needs 120 XP from project work.');
          if (state.queuedCommands.some(c => c.id !== command.id && c.payload.kind === 'specialize_staff' && c.payload.staffId === member.id)) return rejection('ALREADY_ACTIVE', 'A career choice is already queued for this employee.');
          return;
        }
        case 'dismiss_staff':
        case 'set_staff_allocation': {
          const member = Object.hasOwn(state.slices.company.staff, payload.staffId) ? state.slices.company.staff[payload.staffId] : undefined;
          if (!member || member.companyId !== command.companyId) return rejection('INVALID_COMMAND', 'That employee does not belong to this company.');
          if (payload.kind === 'set_staff_allocation' && !isQuarterFte(payload.fte)) return rejection('INVALID_ALLOCATION', 'Assign 0%, 25%, 50%, 75% or 100% of this employee’s time.');
          return;
        }
        case 'assign_founder': {
          const allocations = payload.allocations;
          if (!allocations || typeof allocations !== 'object' || Array.isArray(allocations)
            || Object.keys(allocations).sort().join(',') !== [...STAFF_ROLES].sort().join(',')
            || STAFF_ROLES.some(role => !isQuarterFte(allocations[role]))) {
            return rejection('INVALID_ALLOCATION', 'Assign founder points in steps of 5 for every work type.');
          }
          if (allocations.hardware !== 0) return rejection('NOT_READY', 'Chip design requires a hired hardware specialist. The founder can support the other company roles.');
          const total = STAFF_ROLES.reduce((sum, role) => checkedAdd(sum, allocations[role]), 0);
          if (total > record.founderFte) return rejection('CAPACITY_EXCEEDED', `The founder has ${formatWorkPoints(record.founderFte)} points per week. Reduce another assignment to stay within this total.`);
          return;
        }
        default: return rejection('INVALID_COMMAND', 'This action is not a company command.');
      }
    },
    quoteCommand(state, command) {
      const payload = command.payload;
      if (payload.kind === 'hire_staff') {
        const role = content.staff.find(definition => definition.id === payload.role);
        if (role) return { upfrontCostCents: role.recruitmentCents, weeklyCostDeltaCents: role.weeklyCents,
          summary: `${formatMoney(role.recruitmentCents)} recruiting, then ${formatMoney(role.weeklyCents)} per week from hiring. After ${role.onboardingWeeks} onboarding weeks, this specialist produces ${pointOutputSummary(getStaffPointProfile(role.id))} points per week. Active projects receive matching points each week.` };
      }
      if (payload.kind === 'specialize_staff') {
        const member = state.slices.company.staff[payload.staffId];
        if (member && STAFF_CAREER_PATHS[member.role]?.[payload.specialty]) {
          const path = STAFF_CAREER_PATHS[member.role][payload.specialty];
          return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${path.name} adds ${SPECIALTY_BONUS} ${WORK_POINT_LABELS[path.role]} points every week from next week. This career choice is permanent.` };
        }
      }
      if (payload.kind === 'dismiss_staff') {
        const member = state.slices.company.staff[payload.staffId];
        const role = content.staff.find(definition => definition.id === member?.role);
        if (role && member) {
          const salary = careerSalary(member, role.weeklyCents);
          return { upfrontCostCents: checkedAdd(salary, salary), weeklyCostDeltaCents: -salary,
            summary: `Dismissal costs ${formatMoney(salary * 2)}. Point output and the ${formatMoney(salary)} weekly salary end next week.` };
        }
      }
      if (usesPassiveWorkforce(state, command.companyId) && (payload.kind === 'assign_founder' || payload.kind === 'set_staff_allocation')) {
        return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Your team contributes automatically to active work.' };
      }
      if (payload.kind === 'set_staff_allocation') {
        const member = state.slices.company.staff[payload.staffId];
        if (member) {
          const output = getEmployeeWorkOutput({ ...member, assignedFte: payload.fte }, state.week + 1);
          return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
            summary: `Assign ${payload.fte / RESOURCE_SCALE * 100}% of this employee’s time from next week: ${pointOutputSummary(output)} points per week.${member.readyWeek > state.week + 1 ? ` Output begins in Week ${member.readyWeek}, when onboarding ends.` : ''} Full salary continues. Projects share the points; unused output does not carry over.` };
        }
      }
      return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
        summary: payload.kind === 'rename_company' ? 'The company name changes at the next weekly boundary.'
          : payload.kind === 'set_staff_allocation' ? 'Time allocation changes next week. Full salary continues even when an employee is idle.'
            : `Founder assignments change next week. Share ${formatWorkPoints(state.slices.company.companies[command.companyId].founderFte)} points across the founder’s whole week; unused output does not carry over.` };
    },
    applyCommand(state, command) {
      const next = structuredClone(state.slices.company), payload = command.payload;
      // Old saves may contain queued assignment commands, including inside a
      // paid hiring/compute plan. Acknowledge those commands without throttling
      // employees or overriding the automatic founder.
      if (usesPassiveWorkforce(state, command.companyId) && (payload.kind === 'assign_founder' || payload.kind === 'set_staff_allocation')) {
        return { messages: [{ category: 'command', companyId: command.companyId, message: 'Your team contributes automatically to active work.' }] };
      }
      switch (payload.kind) {
        case 'rename_company':
          next.companies[command.companyId].name = payload.name.trim();
          return { updates: { company: next }, messages: [{ category: 'command', companyId: command.companyId, message: `Company renamed to ${payload.name.trim()}.` }] };
        case 'hire_staff': {
          const role = content.staff.find(definition => definition.id === payload.role)!;
          const id = `staff:${command.id}`;
          next.staff[id] = { id, companyId: command.companyId, role: payload.role, hiredWeek: state.week,
            readyWeek: checkedAdd(state.week, role.onboardingWeeks), assignedFte: RESOURCE_SCALE };
          next.companies[command.companyId].activeStaff = readyCount(next, command.companyId, state.week);
          return { updates: { company: next }, facts: [expense(command, state.week, `recruit:${command.id}`, role.recruitmentCents, `Recruit ${role.name}`)],
            messages: [{ category: 'command', companyId: command.companyId, message: `${role.name} hired. Salary starts now; point output begins in Week ${next.staff[id].readyWeek}.` }] };
        }
        case 'specialize_staff': {
          const member = next.staff[payload.staffId];
          member.career!.specialty = payload.specialty;
          const path = STAFF_CAREER_PATHS[member.role][payload.specialty];
          return { updates: { company: next }, messages: [{ category: 'project', companyId: command.companyId, message: `${path.name} chosen. This employee now generates ${SPECIALTY_BONUS} extra ${WORK_POINT_LABELS[path.role]} points per week.` }] };
        }
        case 'dismiss_staff': {
          const member = next.staff[payload.staffId], role = content.staff.find(definition => definition.id === member.role)!;
          const salary = careerSalary(member, role.weeklyCents);
          delete next.staff[payload.staffId];
          next.companies[command.companyId].activeStaff = readyCount(next, command.companyId, state.week);
          return { updates: { company: next }, facts: [expense(command, state.week, `dismiss:${command.id}`, checkedAdd(salary, salary), `Dismiss ${role.name}`)],
            messages: [{ category: 'command', companyId: command.companyId, message: `${role.name} dismissed. Two weeks of severance charged; no further salary or point output.` }] };
        }
        case 'assign_founder':
          next.founderAssignments[command.companyId] = structuredClone(payload.allocations);
          return { updates: { company: next }, messages: [{ category: 'command', companyId: command.companyId, message: 'Founder time updated. The whole week shares one point budget across the selected work types.' }] };
        case 'set_staff_allocation':
          next.staff[payload.staffId].assignedFte = payload.fte;
          return { updates: { company: next }, messages: [{ category: 'command', companyId: command.companyId, message: 'Employee time updated. Weekly point output follows this percentage; salary is unchanged.' }] };
        default: return {};
      }
    },
    grantResources(state, context) {
      const next = structuredClone(state.slices.company);
      const remaining: Record<string, RoleAllocation> = {};
      for (const id of Object.keys(next.companies)) {
        const { capacity, founderOutput } = state.slices.company.companies[id].arrearsCents > 0
          ? { capacity: emptyRoleAllocation(), founderOutput: emptyRoleAllocation() }
          : getWeeklyStaffSupply(state, id, context.week, context.resources.requests);
        remaining[id] = { ...capacity };
        next.lastStaff[id] = { capacity, granted: emptyRoleAllocation(),
          ...(usesPassiveWorkforce(state, id) ? { founderOutput } : {}) };
      }
      const staffGrants: StaffGrant[] = [];
      // Deferred inference runs after live GPU work, but its real handling staff
      // must be assigned before optional customer acquisition consumes the remainder.
      for (const request of context.resources.requests) if (request.staffPriority !== undefined) {
        const job = state.slices.products.batchJobs?.[request.taskId];
        if (request.staffPriority !== 60 || !job || job.companyId !== request.companyId || request.id !== `batch-serve:${job.id}`) {
          throw new Error('Separate staff priority is reserved for an owned deferred batch workload.');
        }
      }
      const requests = [...context.resources.requests].sort(compareStaffPriority);
      for (const request of requests) {
        if (!request.staffDemand?.length) continue;
        const available = remaining[request.companyId];
        const grants = request.staffDemand.map(demand => {
          const staffWeeks = Math.min(demand.staffWeeks, available[demand.role]);
          available[demand.role] -= staffWeeks;
          next.lastStaff[request.companyId].granted[demand.role] = checkedAdd(next.lastStaff[request.companyId].granted[demand.role], staffWeeks);
          return { role: demand.role, staffWeeks };
        });
        staffGrants.push({ requestId: request.id, grants });
      }
      return { updates: { company: next }, staffGrants };
    },
    handlers: {
      commit(state, context) {
        const next = structuredClone(state.slices.company);
        for (const id of Object.keys(next.companies)) next.companies[id].activeStaff = readyCount(next, id, context.week);
        return { updates: { company: next }, messages: Object.values(next.staff).filter(member => member.readyWeek === context.week).map(member => ({
          category: 'project' as const, companyId: member.companyId, message: `${content.staff.find(role => role.id === member.role)!.name} finished onboarding and can now contribute work points.`,
        })) };
      },
      execute(state, context) {
        const facts: LedgerFact[] = Object.values(state.slices.company.companies).map(company => ({
          id: `${company.id}:overhead:${context.week}`, companyId: company.id, week: context.week, sourceId: 'founder-and-basic-overhead',
          category: 'overhead', amountCents: content.opening.overheadCentsPerWeek, label: 'Founder draw and basic overhead', kind: 'expense',
        }));
        for (const member of Object.values(state.slices.company.staff)) {
          const role = content.staff.find(definition => definition.id === member.role)!;
          if (role.weeklyCents === 0) continue;
          facts.push({ id: `${member.id}:payroll:${context.week}`, companyId: member.companyId, week: context.week, sourceId: member.id,
            category: 'operating', amountCents: careerSalary(member, role.weeklyCents), label: `${role.name} salary${member.readyWeek > context.week ? ' (onboarding)' : ''}`, kind: 'expense' });
        }
        return { facts };
      },
      settle(state, context) {
        const next = structuredClone(state.slices.company);
        const periodic = periodicNamespaces(state);
        for (const company of Object.values(next.companies)) company.lastWeek = { revenueCents: 0, operatingExpenseCents: 0, cashChangeCents: 0 };
        const ordered = [...context.facts].sort((a, b) => Number(a.kind !== 'receipt') - Number(b.kind !== 'receipt') || Number(a.category !== 'capital') - Number(b.category !== 'capital') || a.id.localeCompare(b.id));
        for (const fact of ordered) {
          const datedWeek = periodicWeek(fact.id, periodic);
          if (datedWeek !== null && (datedWeek !== context.week || fact.week !== context.week)) {
            throw new Error('A periodic receipt must use its actual settlement week. Expired charges cannot be replayed as new work.');
          }
          if (Object.hasOwn(next.postedFacts, fact.id)) continue;
          const company = next.companies[fact.companyId];
          let paidCents = fact.amountCents, unpaidCents = 0;
          if (fact.kind === 'receipt') {
            company.cashCents = checkedAdd(company.cashCents, fact.amountCents);
            company.lastWeek.cashChangeCents = checkedAdd(company.lastWeek.cashChangeCents, fact.amountCents);
            if (fact.category === 'revenue') {
              company.earnedRevenueCents = checkedAdd(company.earnedRevenueCents, fact.amountCents);
              company.lastWeek.revenueCents = checkedAdd(company.lastWeek.revenueCents, fact.amountCents);
            }
          } else {
            paidCents = Math.min(company.cashCents, fact.amountCents); unpaidCents = fact.amountCents - paidCents;
            company.cashCents -= paidCents;
            company.lastWeek.cashChangeCents = checkedAdd(company.lastWeek.cashChangeCents, -paidCents);
            company.arrearsCents = checkedAdd(company.arrearsCents, unpaidCents);
            if (fact.category !== 'capital') {
              company.totalOperatingExpenseCents = checkedAdd(company.totalOperatingExpenseCents, fact.amountCents);
              company.lastWeek.operatingExpenseCents = checkedAdd(company.lastWeek.operatingExpenseCents, fact.amountCents);
            }
          }
          next.postedFacts[fact.id] = true;
          next.ledger.push({ ...fact, paidCents, unpaidCents });
        }
        next.ledger = next.ledger.slice(-200);
        const agentJobs = Object.values(state.slices.agents.jobs);
        const retained = new Set([
          ...next.ledger.map(entry => entry.id),
          ...state.slices.products.invoices.map(invoice => invoice.id),
          ...state.slices.products.commercialInvoices.map(invoice => invoice.id),
          ...(state.slices.products.assuranceInvoices ?? []).map(invoice => invoice.id),
          ...(state.slices.products.batchInvoices ?? []).map(invoice => invoice.id),
          ...Object.values(state.slices.products.batchJobs ?? {}).map(job => job.admission.publicInvoiceId),
          ...state.slices.agents.invoices.map(invoice => invoice.id),
          ...Object.values(state.slices.data.feedbackStudies ?? {}).flatMap(study => study.weeks.flatMap(row => row.paidUsage.invoiceId ? [row.paidUsage.invoiceId] : [])),
          ...Object.values(state.slices.compute.costReports ?? {}).flatMap(history => history.flatMap(report => report.ledgerFacts.map(fact => fact.id))),
          ...agentJobs.flatMap(job => [`agent-fee:${job.id}`, ...(job.invoiceId ? [job.invoiceId] : []), ...(job.penaltyCents > 0 && job.completedWeek !== null ? [`agent-penalty:${job.id}:${job.completedWeek}`] : [])]),
        ]);
        for (const id of Object.keys(next.postedFacts)) {
          if (retained.has(id)) continue;
          const datedWeek = periodicWeek(id, periodic);
          if (datedWeek !== null && datedWeek < context.week) delete next.postedFacts[id];
          // Closed order claims and command receipts still prevent replay after its bounded history expires.
          if (id.startsWith('agent-fee:') && !Object.hasOwn(state.slices.agents.jobs, id.slice('agent-fee:'.length))) delete next.postedFacts[id];
        }
        const company = next.companies[state.playerCompanyId];
        const promotions = settleStaffCareers(next, state.playerCompanyId, context.week, context.resources).map(member => {
          const rank = CAREER_RANKS[careerLevel(member.career?.experience)];
          const definition = content.staff.find(role => role.id === member.role)!;
          return { category: 'project' as const, companyId: member.companyId, message: `${staffDisplayName(member)} (${definition.name}) reached ${rank.name}. Starting next week, +${rank.primaryBonus} ${WORK_POINT_LABELS[member.role]} points and ${formatMoney(careerSalary(member, definition.weeklyCents))} weekly pay.${canChooseStaffSpecialty(member) ? ' Choose a specialty in Team output.' : ''}` };
        });
        return { updates: { company: next }, messages: [...promotions, { category: 'finance', message: company.arrearsCents > 0
          ? 'Unpaid expenses recorded. The company clock has stopped.'
          : `Week ${context.week} settled: ${formatMoney(company.lastWeek.revenueCents)} earned revenue and ${formatMoney(company.lastWeek.operatingExpenseCents)} expenses.` }] };
      },
    },
  };
}
