'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Eye, RefreshCw, Server, Users, Wallet } from 'lucide-react';
import { CONTENT } from '../content/catalog';
import type { Allocation, GameState, StaffRole } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { StudioBoundaryView, StudioPlanDraft, StudioPlanPreview, StudioRequestView } from '../contracts/wave25-studio';
import { STUDIO_PLAN_MAX_HIRES, STUDIO_PLAN_MAX_HIRES_PER_ROLE } from '../contracts/wave25-studio';
import { createStudioPlanDraft, previewStudioPlan } from '../core/studio-planning';
import { formatMoney, formatUnits } from '../core/math';
import { getComputePools } from '../modules/compute-pools';
import { careerOutput, careerSalary } from '../modules/staff-careers';
import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import { parseFixed, parseWhole, ROLE_LABELS } from './components';

const FOUNDER_ROLES: readonly StaffRole[] = ['data', 'ml', 'research', 'infrastructure', 'commercial'];
const ALL_ROLES: readonly StaffRole[] = [...FOUNDER_ROLES, 'hardware'];
const ALLOCATIONS: readonly (keyof Allocation)[] = ['serving', 'development', 'research'];
const ALLOCATION_LABELS: Record<keyof Allocation, string> = { serving: 'Serving', development: 'Development', research: 'Research' };

type FormDraft = {
  hires: Record<StaffRole, string>;
  cloud: string;
  allocation: Record<keyof Allocation, string>;
};

export interface StudioPlannerProps {
  game: GameState;
  canAct: boolean;
  paused: boolean;
  onApplyPlan: (draft: StudioPlanDraft, expectedSourceHash: string) => { accepted: boolean; message?: string };
  /** Context describes the selected constraint; it never changes draft values. */
  context?: { title: string; reason: string } | null;
}

function formFromPlan(plan: StudioPlanDraft): FormDraft {
  return {
    hires: Object.fromEntries(ALL_ROLES.map(role => [role, String(plan.hires[role] ?? 0)])) as FormDraft['hires'],
    cloud: String(plan.cloudCU / U),
    allocation: Object.fromEntries(ALLOCATIONS.map(category => [category, String(plan.allocation[category] / U)])) as FormDraft['allocation'],
  };
}

function parseForm(form: FormDraft, game: GameState): StudioPlanDraft | null {
  const cloud = parseWhole(form.cloud);
  const serving = parseFixed(form.allocation.serving, 9);
  const development = parseFixed(form.allocation.development, 9);
  const research = parseFixed(form.allocation.research, 9);
  const hires = Object.fromEntries(ALL_ROLES.map(role => [role, parseWhole(form.hires[role])])) as Record<StaffRole, number | null>;
  if (cloud === null || !Number.isSafeInteger(cloud * U) || serving === null || development === null || research === null || Object.values(hires).some(value => value === null)) return null;
  return { ...createStudioPlanDraft(game), hires: hires as Record<StaffRole, number>, cloudCU: cloud * U, allocation: { serving, development, research } };
}

type Review = { result: StudioPlanPreview; game: GameState; draft: StudioPlanDraft; signature: string };

function ComparedValue({ before, after, money = false, points = false, unit = '' }: { before: number; after: number; money?: boolean; points?: boolean; unit?: string }) {
  const format = money ? formatMoney : points ? formatWorkPoints : formatUnits;
  return <span className="studio-planner-compared"><span>{format(before)}{unit}</span><ArrowRight size={12} aria-label="changes to" /><strong>{format(after)}{unit}</strong></span>;
}

function isConstrained(request: StudioRequestView): boolean {
  return request.grantedWork < request.requestedWork || request.grantedMemory < request.requestedMemory
    || request.staff.some(staff => staff.granted < staff.requested);
}

function BoundaryComparison({ baseline, proposed }: { baseline: StudioBoundaryView; proposed: StudioBoundaryView }) {
  const staffDemand = (boundary: StudioBoundaryView, role: StaffRole) => boundary.requests.reduce((sum, request) => sum + request.staff.filter(staff => staff.role === role).reduce((total, staff) => total + staff.requested, 0), 0);
  const roles = ALL_ROLES.filter(role => baseline.workforce.capacity[role] > 0 || proposed.workforce.capacity[role] > 0 || staffDemand(proposed, role) > 0);
  const signedCount = proposed.commitments.privateHosted + proposed.commitments.customerHosted + proposed.commitments.assured;
  const constrainedJobs = proposed.requests.filter(isConstrained);
  const staffConstrained = roles.some(role => staffDemand(proposed, role) > proposed.workforce.granted[role]);
  const serviceConstrained = constrainedJobs.some(request => request.liveServing || request.category === 'serving');
  const poolsConstrained = proposed.requests.some(request => request.requestedMemory > request.largestCompatibleMemory)
    || proposed.pools.some(pool => pool.nominalCU > 0 && (pool.capacityCU < pool.nominalCU || pool.staffCoverageBps < 10000
      || pool.powerCoverageBps < 10000 || pool.coolingCoverageBps < 10000));
  const rows = [
    { label: 'Cash after next week', before: baseline.cashCents, after: proposed.cashCents },
    ...(baseline.arrearsCents > 0 || proposed.arrearsCents > 0 ? [{ label: 'Unpaid bills after next week', before: baseline.arrearsCents, after: proposed.arrearsCents }] : []),
    { label: 'Weekly base costs', before: baseline.weeklyBaseCostCents, after: proposed.weeklyBaseCostCents },
    { label: 'Employee payroll', before: baseline.payrollCents, after: proposed.payrollCents },
    { label: 'Cloud rent', before: baseline.cloudRentCents, after: proposed.cloudRentCents },
    { label: 'Next-week revenue', before: baseline.revenueCents, after: proposed.revenueCents },
    { label: 'Next-week operating expenses', before: baseline.operatingExpenseCents, after: proposed.operatingExpenseCents },
  ];
  return <div className="studio-planner-comparison">
    <p className="studio-planner-note">Compare next week with your <strong>current plan → new plan</strong>. Both estimates include actions you have already queued.</p>
    <details className="studio-planner-detail" open={proposed.arrearsCents > 0}><summary>Cash & ongoing costs{proposed.arrearsCents > 0 && <span>Unpaid bills forecast</span>}</summary><dl className="studio-planner-compare-metrics">{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd><ComparedValue before={row.before} after={row.after} money /></dd></div>)}</dl><p className="studio-planner-note">Base costs include salaries and cloud rent. Total running costs also include GPU use and other charges for that week.</p></details>

    <details className="studio-planner-detail" open={staffConstrained}><summary>Weekly points and planned work{staffConstrained && <span>Staff shortage</span>}</summary><p className="studio-planner-note">{proposed.workforce.ready} ready employee{proposed.workforce.ready === 1 ? '' : 's'} · {proposed.workforce.onboarding} onboarding. Point totals include the founder. Active jobs draw from the same weekly supply.</p><div className="table-scroll"><table className="studio-planner-table"><caption>Week {proposed.week} workforce: current plan versus proposed plan</caption><thead><tr><th scope="col">Role</th><th scope="col">Available points</th><th scope="col">Needed points</th><th scope="col">Allocated points</th></tr></thead><tbody>{roles.map(role => <tr key={role} className={staffDemand(proposed, role) > proposed.workforce.granted[role] ? 'is-constrained' : ''}><th scope="row">{WORK_POINT_LABELS[role]}</th><td><ComparedValue before={baseline.workforce.capacity[role]} after={proposed.workforce.capacity[role]} points /></td><td>{formatWorkPoints(staffDemand(proposed, role))}</td><td><ComparedValue before={baseline.workforce.granted[role]} after={proposed.workforce.granted[role]} points /></td></tr>)}</tbody></table></div><p className="studio-planner-note">Active jobs draw matching points automatically. Training still needs GPUs and memory; allocated supervision alone does not complete it. Unused points expire at the end of the week.</p></details>

    {signedCount > 0 && <details className="studio-planner-detail" open={serviceConstrained}><summary>Customer contracts <span>{signedCount} signed{serviceConstrained ? ' · Service capacity constrained' : ''}</span></summary><div className="studio-planner-commitments" aria-label="Customer contracts"><p>{proposed.commitments.privateHosted} private-hosted · {proposed.commitments.customerHosted} customer-hosted · {proposed.commitments.assured} assured API</p><dl><div><dt>Reserved delivery work</dt><dd>{formatUnits(proposed.commitments.reservedWorkCUw)} CUw</dd></div><div><dt>Business points for support</dt><dd>{formatWorkPoints(proposed.commitments.supportFte)} points / week</dd></div></dl><p className="studio-planner-note">The forecast includes these contracts. Check that each service has enough resources before cutting its capacity.</p></div></details>}

    <details className="studio-planner-detail" open={constrainedJobs.length > 0}><summary>Resources by job <span>{constrainedJobs.length ? constrainedJobs.length + ' constrained · ' : ''}{proposed.requests.length} request{proposed.requests.length === 1 ? '' : 's'}</span></summary>
      {proposed.requests.length ? <div className="studio-planner-requests">{proposed.requests.map(request => {
        const before = baseline.requests.find(item => item.id === request.id);
        const constrained = isConstrained(request);
        return <article className={'studio-planner-request ' + (constrained ? 'is-constrained' : '')} key={request.id}>
          <div className="studio-planner-request-heading"><h4>{request.label}</h4><span>{request.liveServing ? 'Live service' : ALLOCATION_LABELS[request.category] ?? request.category}</span></div>
          <dl className="studio-planner-compare-metrics"><div><dt>Work needed / available</dt><dd>{formatUnits(request.requestedWork)} / <strong>{formatUnits(request.grantedWork)} CUw</strong></dd></div><div><dt>Work with current plan</dt><dd>{before ? formatUnits(before.grantedWork) + ' CUw' : 'New request'}</dd></div><div><dt>Physical GPU work</dt><dd>{formatUnits(request.physicalWork)} CUw</dd></div><div><dt>Memory needed / available</dt><dd>{formatUnits(request.requestedMemory)} / <strong>{formatUnits(request.grantedMemory)} MU</strong></dd></div><div><dt>Connected pool</dt><dd>{request.poolName ?? 'No suitable hardware pool'}</dd></div></dl>
          {request.staff.length > 0 && <ul className="studio-planner-request-staff">{request.staff.map(staff => <li key={staff.role}><span>{WORK_POINT_LABELS[staff.role]}</span><strong>{formatWorkPoints(staff.granted)} / {formatWorkPoints(staff.requested)} points allocated</strong></li>)}</ul>}
          {request.reason && <p className={constrained ? 'studio-planner-request-reason' : 'studio-planner-note'}>{request.reason}</p>}
          {request.requestedMemory > request.largestCompatibleMemory && <p className="studio-planner-request-reason">This workload needs {formatUnits(request.requestedMemory)} MU together. The largest compatible pool provides {formatUnits(request.largestCompatibleMemory)} MU; separate pools cannot combine their memory.</p>}
        </article>;
      })}</div> : <p className="studio-planner-note">No active jobs need resources next week. Extra capacity will be ready for your next project.</p>}
    </details>

    <details className="studio-planner-detail" open={poolsConstrained}><summary>Connected compute pools{poolsConstrained && <span>Capacity or memory constraint</span>}</summary><div className="studio-planner-pools">{proposed.pools.map(pool => {
      const before = baseline.pools.find(item => item.id === pool.id);
      return <article className="studio-planner-pool" key={pool.id}><div className="studio-planner-request-heading"><h4>{pool.name}</h4><span>{pool.ownership === 'cloud' ? 'Cloud' : 'Owned'}</span></div><dl className="studio-planner-compare-metrics"><div><dt>Usable capacity</dt><dd><ComparedValue before={before?.capacityCU ?? 0} after={pool.capacityCU} unit=" CU" /></dd></div><div><dt>Total capacity</dt><dd>{formatUnits(pool.nominalCU)} CU</dd></div><div><dt>Connected memory</dt><dd>{formatUnits(pool.memoryMU)} MU</dd></div></dl>{pool.ownership === 'owned' && <div className="studio-planner-coverage">{([{ label: 'Staff', value: pool.staffCoverageBps }, { label: 'Power', value: pool.powerCoverageBps }, { label: 'Cooling', value: pool.coolingCoverageBps }] as const).map(coverage => <div key={coverage.label}><span>{coverage.label}<strong>{Number((coverage.value / 100).toFixed(1))}%</strong></span><progress value={coverage.value} max={10000} aria-label={pool.name + ' ' + coverage.label.toLowerCase() + ' coverage'} /></div>)}</div>}{pool.bottleneck && <p className="studio-planner-request-reason">{pool.bottleneck}</p>}</article>;
    })}</div><p className="studio-planner-note">Capacity depends on ready racks, enough staff, power, and cooling. Each job must fit in one compatible hardware pool. Parked racks and racks awaiting delivery or installation cannot work.</p></details>
  </div>;
}

/** The reviewed forecast stays separate from the editable draft. Rendering this
 * summary never recomputes the boundary or submits any of its changes. */
export function StudioPlannerReview({ preview, stale = false, companyChanged = false, applied = false, canAct, paused, previewing = false, onApply }: {
  preview: StudioPlanPreview; stale?: boolean; companyChanged?: boolean; applied?: boolean;
  canAct: boolean; paused: boolean; previewing?: boolean; onApply: () => void;
}) {
  const proposed = preview.proposed;
  const constrainedJobs = proposed?.requests.filter(isConstrained) ?? [];
  const services = proposed?.requests.filter(request => request.liveServing) ?? [];
  const constrainedServices = services.filter(isConstrained);
  return <>
    <div className="studio-planner-preview-heading"><h3>Week {preview.effectiveWeek} forecast</h3><span className={'studio-planner-review-state ' + (applied ? 'is-ready' : stale ? 'is-stale' : preview.valid ? 'is-ready' : 'is-blocked')}>{applied ? 'Queued' : stale ? 'Review needed' : preview.valid ? 'Ready to apply' : 'Plan blocked'}</span></div>
    {stale && !applied && <p className="studio-planner-alert" role="status"><RefreshCw size={16} />{companyChanged ? 'The company changed. Preview again before applying.' : 'Your inputs changed. Preview again to update these estimates.'}</p>}
    {!preview.valid && <p className="studio-planner-alert" role="status"><AlertTriangle size={17} />{preview.reason ?? 'This plan cannot be applied.'}</p>}
    <div className="studio-planner-costs studio-planner-summary" role="group" aria-label="Plan impact">
      <div><Wallet size={17} /><span>Upfront cost<strong>{formatMoney(preview.upfrontCostCents)}</strong></span></div>
      <div><Clock3 size={17} /><span>Weekly cost change<strong>{preview.weeklyCostDeltaCents > 0 ? '+' : ''}{formatMoney(preview.weeklyCostDeltaCents)}</strong></span></div>
      <div><Wallet size={17} /><span>Cash after next week<strong>{proposed ? formatMoney(proposed.cashCents) : 'Unavailable'}</strong>{proposed && proposed.arrearsCents > 0 && <small>{formatMoney(proposed.arrearsCents)} unpaid bills</small>}</span></div>
      <div>{constrainedJobs.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>Constrained jobs<strong>{proposed ? constrainedJobs.length : 'Unavailable'}</strong>{proposed && <small>of {proposed.requests.length} scheduled requests</small>}</span></div>
      <div><Server size={17} /><span>Live service capacity<strong>{!proposed ? 'Unavailable' : services.length ? (services.length - constrainedServices.length) + ' / ' + services.length + ' covered' : 'None active'}</strong></span></div>
    </div>
    {preview.warnings.length > 0 && <div className="studio-planner-warnings"><h4><AlertTriangle size={16} />What this plan affects</h4><ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    <div className="studio-planner-apply"><p>Queue all changes for Week {preview.effectiveWeek}. The game stays paused until you resume or step forward.</p><button type="button" className="studio-primary" onClick={onApply} disabled={!preview.valid || stale || !canAct || !paused || previewing || applied}><CheckCircle2 size={16} />{applied ? 'Plan queued' : 'Apply plan for Week ' + preview.effectiveWeek}</button></div>
    {preview.changes.length > 0 && <details className="studio-planner-changes"><summary>{preview.changes.length} planned change{preview.changes.length === 1 ? '' : 's'}</summary><ul>{preview.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></details>}
    {preview.baseline && proposed && <BoundaryComparison baseline={preview.baseline} proposed={proposed} />}
  </>;
}

/** A planning draft is local UI state; only the reviewed atomic command reaches the campaign. */
export function StudioPlanner({ game, canAct, paused, onApplyPlan, context }: StudioPlannerProps) {
  const [form, setForm] = useState<FormDraft>(() => formFromPlan(createStudioPlanDraft(game)));
  const [draftSource, setDraftSource] = useState(game);
  const [review, setReview] = useState<Review | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState(false);
  const previewTimer = useRef<number | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => () => { if (previewTimer.current !== null) window.clearTimeout(previewTimer.current); }, []);

  const draft = useMemo(() => parseForm(form, game), [form, game]);
  const signature = useMemo(() => JSON.stringify(form), [form]);
  const stale = !!review && (review.game !== game || review.signature !== signature);
  const company = game.slices.company.companies[game.playerCompanyId];
  const fleet = game.slices.compute.fleets[game.playerCompanyId];
  const pools = useMemo(() => getComputePools(game, game.playerCompanyId, CONTENT), [game]);
  const usableOwnedCU = pools.filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0);
  const members = Object.values(game.slices.company.staff).filter(member => member.companyId === game.playerCompanyId).sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
  const completedResearch = game.slices.research.completedByCompany[game.playerCompanyId] ?? [];
  const eligibleHire = (role: typeof CONTENT.staff[number]) => !role.availableOnResearchEntry || completedResearch.includes(role.availableOnResearchEntry)
    || Object.values(game.slices.research.projects).some(project => project.companyId === game.playerCompanyId && project.researchId === role.availableOnResearchEntry);
  const inputsLocked = !canAct || previewing || applied;

  function refresh() {
    if (previewing) return;
    setForm(formFromPlan(createStudioPlanDraft(game))); setDraftSource(game); setReview(null); setMessage('Draft refreshed from your company.'); setApplied(false);
  }

  function preview() {
    if (!draft || !canAct || !paused || previewing || applied) return;
    const reviewedDraft = structuredClone(draft), reviewedGame = game, reviewedSignature = signature;
    setPreviewing(true); setMessage('');
    previewTimer.current = window.setTimeout(() => {
      try {
        const result = previewStudioPlan(reviewedGame, reviewedDraft, CONTENT);
        setReview({ result, game: reviewedGame, draft: reviewedDraft, signature: reviewedSignature });
        requestAnimationFrame(() => previewRef.current?.focus({ preventScroll: true }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'This plan could not be previewed. Your company is unchanged.');
      } finally { setPreviewing(false); previewTimer.current = null; }
    }, 0);
  }

  function apply() {
    if (!review || stale || !review.result.valid || !canAct || !paused || applied) return;
    const result = onApplyPlan(review.draft, review.result.sourceHash);
    setMessage(result.message ?? (result.accepted ? `Plan queued for Week ${review.result.effectiveWeek}.` : 'This plan could not be applied. Review it again.'));
    if (result.accepted) setApplied(true);
  }

  return <section className="studio-planner" aria-label="Workforce and compute plan" aria-busy={previewing}>
    <div className="studio-planner-heading"><div><h2>Plan resources</h2><p>Adjust hiring and compute, then check next week’s cost and capacity.</p></div><button type="button" onClick={refresh} disabled={previewing || !canAct}><RefreshCw size={14} />Reset to current settings</button></div>
    {context && <aside className="studio-planner-context" aria-label="Selected resource constraint"><p className="studio-journey-eyebrow">REVIEW RESOURCES FOR</p><h3>{context.title}</h3><p>{context.reason}</p><p className="studio-planner-note">Your earlier choices are kept while you plan. Review the costs before confirming hires or compute changes.</p></aside>}
    {!paused && <p className="studio-planner-alert" role="status"><Clock3 size={16} />Pause the game to preview or confirm this plan. Your choices will stay here.</p>}
    {draftSource !== game && (!review || review.game !== game) && !applied && <p className="studio-planner-note" role="status">Your company has changed since you started planning. Preview again to keep your edits, or reset to use the current settings.</p>}
    {applied && <p className="studio-planner-success" role="status"><CheckCircle2 size={18} /><span>{message} Reset to current settings to make another plan.</span></p>}

    <div className="studio-planner-editors">
      <section className="studio-planner-card" aria-labelledby="studio-plan-people-title">
        <div className="studio-planner-card-title"><Users size={19} /><div><h3 id="studio-plan-people-title">People</h3><p>Your team generates points for active projects each week.</p></div></div>
        <p className="studio-planner-note">The founder automatically contributes up to {formatWorkPoints(company.founderFte)} points per week wherever the team needs help.</p>
        {members.length > 0 && <details className="studio-planner-detail"><summary>Employee output <span>{members.length} on payroll</span></summary>
          {members.map((member, index) => <div className="studio-planner-input-row" key={member.id}><span>{ROLE_LABELS[member.role]} {index + 1}
            <small>{member.readyWeek > game.week ? 'Onboarding · ready Week ' + member.readyWeek : 'Ready'} · {formatMoney(careerSalary(member, CONTENT.staff.find(role => role.id === member.role)!.weeklyCents))}/week</small>
            <small>{Object.entries(careerOutput(member)).filter(([, amount]) => amount > 0).map(([role, amount]) => formatWorkPoints(amount) + ' ' + WORK_POINT_LABELS[role as StaffRole]).join(' · ')} points / week{member.readyWeek > game.week ? ' after onboarding' : ''}</small>
          </span></div>)}
        </details>}
        <details className="studio-planner-hiring"><summary>Add people <span>Recruitment & onboarding</span></summary><p className="studio-planner-note">Hires generate their full specialty profile automatically after onboarding. Salaries begin on hiring, including onboarding. Plan up to {STUDIO_PLAN_MAX_HIRES_PER_ROLE} hires per role and {STUDIO_PLAN_MAX_HIRES} total.</p>{CONTENT.staff.map(role => <label className="studio-planner-input-row" htmlFor={'studio-plan-hire-' + role.id} key={role.id}><span>{role.name}<small>{eligibleHire(role) ? `${formatMoney(role.recruitmentCents)} recruiting · ${formatMoney(role.weeklyCents)}/week · ${role.onboardingWeeks} weeks onboarding` : 'Requires Chip feasibility research'}</small></span><span className="studio-planner-unit"><input id={'studio-plan-hire-' + role.id} type="number" min="0" max={STUDIO_PLAN_MAX_HIRES_PER_ROLE} step="1" inputMode="numeric" value={form.hires[role.id]} disabled={inputsLocked || !eligibleHire(role)} onChange={event => setForm(current => ({ ...current, hires: { ...current.hires, [role.id]: event.target.value } }))} /><span>hires</span></span></label>)}</details>
      </section>

      <section className="studio-planner-card" aria-labelledby="studio-plan-compute-title">
        <div className="studio-planner-card-title"><Server size={19} /><div><h3 id="studio-plan-compute-title">Compute</h3><p>Rent GPUs, then choose how much each type of work can use.</p></div></div>
        <dl className="studio-planner-current-capacity"><div><dt>Current rented capacity</dt><dd>{formatUnits(fleet.cloudCU)} CU</dd></div><div><dt>Currently usable owned capacity</dt><dd>{formatUnits(usableOwnedCU)} CU</dd></div><div><dt>Memory occupied / total</dt><dd>{formatUnits(fleet.occupiedMemoryMU)} / {formatUnits(fleet.memoryMU)} MU</dd></div></dl>
        <fieldset className="studio-planner-fieldset"><legend>Cloud rental</legend><label className="studio-planner-input-row" htmlFor="studio-plan-cloud"><span>Total rented capacity<small>Available from the start of next week</small></span><span className="studio-planner-unit"><input id="studio-plan-cloud" type="number" min="0" max={CONTENT.firstSale.maxCloudCU / U} step="1" inputMode="numeric" value={form.cloud} disabled={inputsLocked} onChange={event => setForm(current => ({ ...current, cloud: event.target.value }))} /><span>CU</span></span></label><p className="studio-planner-note">You pay rent on all rented capacity, even when it sits idle.</p></fieldset>
        <fieldset className="studio-planner-fieldset"><legend>Maximum compute for each type of work</legend>{ALLOCATIONS.map(category => <label className="studio-planner-input-row" htmlFor={'studio-plan-allocation-' + category} key={category}><span>{ALLOCATION_LABELS[category]}<small>{category === 'serving' ? 'Customers and signed contracts' : category === 'development' ? 'Training, testing, and installing upgrades' : 'Discovery and research work'}</small><small>Current {formatUnits(fleet.allocation[category])} CU · last work {formatUnits(fleet.lastWork[category])} CUw</small></span><span className="studio-planner-unit"><input id={'studio-plan-allocation-' + category} type="number" min="0" step="0.25" inputMode="decimal" value={form.allocation[category]} disabled={inputsLocked} onChange={event => setForm(current => ({ ...current, allocation: { ...current.allocation, [category]: event.target.value } }))} /><span>CU</span></span></label>)}</fieldset>
        <div className="studio-planner-units"><h4>What the units mean</h4><p><strong>CU</strong> measures GPU capacity. <strong>CUw</strong> measures compute work over time. <strong>MU</strong> measures memory. A job needs enough memory in one compatible hardware pool.</p></div>
      </section>
    </div>

    <div className="studio-planner-preview-controls"><div><p>See what happens next week.</p><span>Includes queued actions and customer contracts.</span></div><button type="button" className="studio-primary" disabled={!draft || !canAct || !paused || previewing || applied} onClick={preview}><Eye size={16} />{previewing ? 'Calculating…' : 'Preview Week ' + (game.week + 1)}<ArrowRight size={15} /></button></div>
    {!draft && <p className="studio-planner-error" role="status">Use whole numbers for rented CU and new hires. All values must be zero or higher.</p>}
    {message && !applied && <p className="studio-planner-note" role="status">{message}</p>}

    {review && <section className={'studio-planner-preview ' + (stale && !applied ? 'is-stale' : '')} ref={previewRef} tabIndex={-1} aria-label={'Plan preview for Week ' + review.result.effectiveWeek}>
      <StudioPlannerReview preview={review.result} stale={stale} companyChanged={review.game !== game} applied={applied} canAct={canAct} paused={paused} previewing={previewing} onApply={apply} />
    </section>}
  </section>;
}
