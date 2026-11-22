'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import type { ComputeCostReport } from '../contracts/wave8-costs';
import { COMPUTE_COST_RULES as RULES } from '../content/wave8-costs';
import { formatMoney, formatUnits } from '../core/math';
import { getComputeCostView } from '../modules/compute-costs';
import { getPoolWorkCostRate } from '../modules/compute-pools';
import { ActionControl, Metric, Metrics, Section } from './components';
import type { PanelProps } from './panels';
import { useStudioWorkbenchPresentation } from './studio-workbench-context';

const pct = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';

function SettledReport({ report }: { report: ComputeCostReport }) {
  const totals = report.totals;
  const targets = new Map(report.targets.map(target => [target.id, target]));
  const activities = report.activities.filter(activity => activity.revenueCents || activity.attributedComputeCents || activity.physicalWorkCUw);
  return <>
    <Metrics>
      <Metric label="Billed compute and infrastructure">{formatMoney(totals.totalComputeCents)}</Metric>
      <Metric label="Assigned to workloads">{formatMoney(totals.attributedComputeCents)}</Metric>
      <Metric label="Unused and shared compute">{formatMoney(totals.sharedComputeCents)}</Metric>
    </Metrics>
    <p className="small-note">Actual costs for Week {report.week}: cloud rent, owned GPU use, and fixed upkeep.</p>
    <details className="inline-details"><summary>Products and internal work</summary>
      {activities.length ? <div className="table-scroll"><table className="compact-table"><caption>Week {report.week} · revenue and assigned compute</caption>
        <thead><tr><th>Activity</th><th>Earned</th><th>Compute</th><th>Contribution</th></tr></thead>
        <tbody>{activities.map(activity => {
          const target = targets.get(activity.targetId)!;
          const customer = target.kind !== 'internal';
          return <tr key={activity.targetId}><td>{target.name}<span className="table-subline">{formatUnits(activity.physicalWorkCUw)} physical CUw</span></td>
            <td>{customer ? formatMoney(activity.revenueCents) : '—'}</td><td>{formatMoney(activity.attributedComputeCents)}</td><td>{customer ? formatMoney(activity.contributionCents) : '—'}</td></tr>;
        })}</tbody>
      </table></div> : <p className="small-note">No GPU work or customer revenue this week. Cloud rent and hardware upkeep still cost money.</p>}
      <p className="small-note">Contribution is revenue minus this work’s compute cost. Salaries, shared infrastructure, unused cloud, support, and other expenses still come out of that amount. Batch and agent jobs may pay later, so one week does not show their full profit.</p>
    </details>
    <details className="inline-details"><summary>Unused capacity and pool costs</summary>
      {report.pools.map(pool => {
        const usage = report.poolUsage.find(item => item.poolId === pool.id)!;
        if (!pool.nominalCU && !usage.physicalWorkCUw) return null;
        return <div className="receipt-row" key={pool.id}>
          <p className="small-heading">{pool.name}<span className="status-inline">{pool.ownership === 'cloud' ? 'Rented' : 'Owned'}</span></p>
          <Metrics>
            <Metric label="Total / usable capacity">{formatUnits(pool.nominalCU)} / {formatUnits(pool.capacityCU)} CU</Metric>
            <Metric label="GPU work completed">{formatUnits(usage.physicalWorkCUw)} CUw</Metric>
            <Metric label="Spare capacity held for service">{formatUnits(usage.headroomCUw)} CU</Metric>
            <Metric label="Available but unused capacity">{formatUnits(usage.unusedCapacityCU)} CU</Metric>
            <Metric label="Capacity unavailable for use">{formatUnits(usage.unavailableCapacityCU)} CU</Metric>
            <Metric label="Occupied / usable memory">{formatUnits(usage.chargedMemoryMU)} / {formatUnits(pool.memoryMU)} MU</Metric>
            <Metric label="Assigned pool cost">{formatMoney(usage.attributedCloudRentCents + usage.attributedOwnedVariableCents)}</Metric>
            {pool.ownership === 'owned' && <Metric label="Base GPU use cost / CUw">{formatMoney(pool.variableCentsPerCUw)}</Metric>}
            {pool.specialization?.profile === 'serving' && <Metric label="Eligible serving cost / CUw">{formatMoney(getPoolWorkCostRate(pool, { category: 'serving' }))}</Metric>}
          </Metrics>
          {pool.ownership === 'owned' && <p className="small-note">Staff {pct(pool.staffCoverageBps)} · power {pct(pool.powerCoverageBps)} · cooling {pct(pool.coolingCoverageBps)}. Fixed rack and site upkeep is recorded as a shared company cost below.</p>}
          {pool.bottleneck && <p className="bottleneck">{pool.bottleneck}</p>}
        </div>;
      })}
      <p className="small-note">GPU work uses energy. Serving also keeps spare capacity ready without using it for work. Parked racks, unfinished sites, and shortages of staff, power, or cooling can make capacity unavailable. These figures describe the selected week.</p>
    </details>
    <details className="inline-details"><summary>Company cost breakdown</summary>
      <Metrics>
        <Metric label="Cloud rent charged">{formatMoney(totals.cloudRentCents)}</Metric>
        <Metric label="Billed owned GPU use">{formatMoney(totals.ownedVariableCents)}</Metric>
        <Metric label="Fixed infrastructure upkeep">{formatMoney(totals.ownedFixedCents)}</Metric>
        <Metric label="Total compute and infrastructure">{formatMoney(totals.totalComputeCents)}</Metric>
      </Metrics>
      <p className="small-heading">Shared part of that total</p>
      <Metrics>
        <Metric label="Unused cloud reservation">{formatMoney(totals.unallocatedCloudCents)}</Metric>
        <Metric label="Small costs carried from earlier weeks">{formatMoney(totals.sharedCarryCents)}</Metric>
        <Metric label="Fixed infrastructure upkeep">{formatMoney(totals.ownedFixedCents)}</Metric>
        <Metric label="Shared compute subtotal">{formatMoney(totals.sharedComputeCents)}</Metric>
      </Metrics>
      <p className="small-note">Shared costs are included in the total above.</p>
      <Metrics>
        <Metric label="Company earned revenue">{formatMoney(totals.companyRevenueCents)}</Metric>
        <Metric label="Other operating expenses">{formatMoney(totals.otherOperatingCents)}</Metric>
        <Metric label="All operating expenses">{formatMoney(totals.companyOperatingCents)}</Metric>
        <Metric label="Company operating surplus">{formatMoney(totals.operatingSurplusCents)}</Metric>
        <Metric label="Separate capital purchases">{formatMoney(totals.capitalOutlayCents)}</Metric>
      </Metrics>
      <p className="small-note">Other running costs include salaries, overhead, support, research fees, and service penalties. Equipment purchases reduce cash but are listed separately from operating profit. Charges include any amount still unpaid.</p>
    </details>
    <details className="inline-details"><summary>How costs are split</summary>
      {RULES.policy.map(item => <p className="small-note" key={item}>{item}</p>)}
      <p className="small-note">Tiny GPU costs brought forward: {(report.variableCostCarryIn / 1_000_000_000).toFixed(6)}¢; carried forward: {(report.variableCostCarryOut / 1_000_000_000).toFixed(6)}¢. Memory held without GPU work stays in shared rental costs.</p>
    </details>
  </>;
}

export function ComputeCostsPanel({ game, canAct, onQueue }: PanelProps) {
  const view = getComputeCostView(game);
  const focused = useStudioWorkbenchPresentation() === 'studio';
  const [open, setOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const report = view.reports.find(item => item.week === selectedWeek) ?? view.latest;
  const rollout = view.rollout;
  const reportContent = report && (focused || open) && <>
    <label className="line-control" htmlFor="compute-cost-week">Week<select id="compute-cost-week" value={report.week} onChange={event => setSelectedWeek(Number(event.target.value))}>
      {view.reports.map(item => <option key={item.week} value={item.week}>Week {item.week}</option>)}
    </select></label>
    <SettledReport report={report} />
  </>;
  return <Section title="Compute costs" id="compute-costs">
    <p className="small-note">See GPU bills, unused rentals, and each product’s contribution for the last eight completed weeks.</p>
    {!view.researched ? <p className="planned-note">Research Capacity forecast (R12A), then install cost accounting here. <a href="#research">Review research</a>.</p>
      : !rollout ? <ActionControl game={game} payload={{ kind: 'start_system_rollout', method: 'cost-accounting' }} label="Install cost accounting" canAct={canAct} onQueue={onQueue} />
        : rollout.status !== 'active' ? <div className="project-row"><div className="project-heading"><strong>Cost accounting rollout</strong><span>{rollout.status === 'ready' ? 'Ready next week' : 'Installing'}</span></div>
          <progress value={Math.min(rollout.completedStaff / rollout.requiredStaff, rollout.completedWork / rollout.requiredWork) * 10000} max={10000} aria-label="Cost accounting rollout progress" />
          <p className="small-note">{formatWorkPoints(rollout.completedStaff)} / {formatWorkPoints(rollout.requiredStaff)} Design points; {formatUnits(rollout.completedWork)} / {formatUnits(rollout.requiredWork)} development CUw.</p>
          {rollout.lastBottleneck && <p className="bottleneck">{rollout.lastBottleneck}</p>}
        </div>
          : report ? focused ? <div className="compute-cost-report" aria-label={'Compute costs for Week ' + report.week}>{reportContent}</div>
            : <details className="inline-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>View compute costs · Week {report.week}</summary>{reportContent}</details>
            : <p className="small-note">Your first report arrives after the next week ends. Reports start when cost accounting is installed.</p>}
  </Section>;
}
