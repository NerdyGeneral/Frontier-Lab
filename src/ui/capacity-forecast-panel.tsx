'use client';

import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import { useMemo, useState } from 'react';
import { CAPACITY_FORECAST_RULES as RULES } from '../content/wave6-forecast';
import { CONTENT } from '../content/catalog';
import type { CapacityForecastRow, CapacityForecastScenario } from '../contracts/wave6-forecast';
import { formatMoney, formatUnits } from '../core/math';
import { capacityForecastAvailability, getCapacityForecast } from '../modules/capacity-forecast';
import { ActionControl, Metric, Metrics, parseFixed, ROLE_LABELS, Section } from './components';
import type { PanelProps } from './panels';
import { BatchQueueSummary } from './batch-inference-panel';

const pct = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';

function RowDetails({ row }: { row: CapacityForecastRow }) {
  return <details className="inline-details"><summary>Week {row.week} resources and bottlenecks</summary>
    <Metrics>
      <Metric label="Paid accounts / trials">{row.paidAccounts} / {row.trialAccounts}</Metric>
      <Metric label="Dedicated services / licenses">{row.privateCommitments} / {row.licenseCommitments}</Metric>
      <Metric label="Public / private demand">{formatUnits(row.publicWorkCUw)} / {formatUnits(row.privateWorkCUw)} CUw</Metric>
      <Metric label="GPU work at current settings">{formatUnits(row.physicalWorkCUw)} CUw</Metric>
      <Metric label="Extra capacity held for service">{formatUnits(row.headroomCU)} CU</Metric>
      <Metric label="Owned GPU service cost">{formatMoney(row.ownedServiceWorkCents)} / week</Metric>
    </Metrics>
    <p className="small-note">GPU work and its cost reflect what your current settings can actually support. Cloud rent, salaries, and fixed upkeep are extra.</p>
    {row.requests.map(request => <div className="receipt-row" key={request.requestId}>
      <p className="small-heading">{request.label} · {request.fits ? 'Fits' : 'Short on resources'}</p>
      <p className="small-note">{formatUnits(request.grantedWorkCUw)} / {formatUnits(request.requestedWorkCUw)} CUw; {formatUnits(request.grantedMemoryMU)} / {formatUnits(request.requestedMemoryMU)} MU in one compatible hardware pool. {request.poolName ? 'Placed in ' + request.poolName + '.' : 'No suitable hardware pool.'}</p>
      {!request.fits && <p className="bottleneck">{request.reason || 'Increase the available resources to run this job.'}</p>}
    </div>)}
    {row.staff.length > 0 && <table className="compact-table"><caption>Weekly point requirements</caption><thead><tr><th>Role</th><th>Needed</th><th>Available</th></tr></thead><tbody>{row.staff.map(staff => <tr key={staff.role}><td>{WORK_POINT_LABELS[staff.role]}</td><td>{formatWorkPoints(staff.requiredFte)} points / week</td><td>{formatWorkPoints(staff.grantedFte)} points / week</td></tr>)}</tbody></table>}
    {!row.staffFits && <p className="bottleneck">{row.staff.filter(staff => staff.shortfallFte > 0).map(staff => `${WORK_POINT_LABELS[staff.role]} needs ${formatWorkPoints(staff.shortfallFte)} more points / week assigned.`).join(' ')} Renting more GPUs will not fix a staff shortage.</p>}
    <p className="small-note">{row.cloudPlan.reason}</p>
    {row.cloudPlan.totalCloudCU !== null && <Metrics>
      <Metric label="Suggested total cloud rental">{formatUnits(row.cloudPlan.totalCloudCU)} CU</Metric>
      <Metric label="Suggested serving limit">{formatUnits(row.cloudPlan.servingAllocationCU!)} CU</Metric>
      <Metric label="Additional cloud rent">{formatMoney(row.cloudPlan.additionalRentCents!)} / week</Metric>
    </Metrics>}
  </details>;
}

function Scenario({ scenario, selectedWeek, onSelect }: { scenario: CapacityForecastScenario; selectedWeek: number; onSelect: (week: number) => void }) {
  const selected = scenario.rows.find(row => row.week === selectedWeek) ?? scenario.rows[0];
  return <details className="inline-details" open={scenario.id === 'base'}><summary>{scenario.name} · {pct(scenario.growthBps)} net growth / week</summary>
    <p className={scenario.firstPressureWeek === null ? 'small-note' : 'bottleneck'}>{scenario.firstPressureWeek === null ? 'Your resources cover customer demand for all twelve weeks in this forecast.' : `First resource shortage: Week ${scenario.firstPressureWeek}.`}</p>
    <table className="compact-table"><caption>{scenario.name}: twelve-week customer-service plan</caption><thead><tr><th>Week</th><th>Demand</th><th>Capacity fit</th><th>Extra cloud</th></tr></thead><tbody>{scenario.rows.map(row => <tr key={row.week}>
      <td>{row.week}</td><td>{formatUnits(row.requestedWorkCUw)} CUw</td>
      <td>{pct(row.weakestCapacityBps)}{!row.staffFits && <span className="small-note" style={{ display: 'block' }}>Staff short</span>}</td>
      <td>{row.cloudPlan.additionalCU === null ? 'No cloud fit' : row.cloudPlan.additionalCU === 0 ? row.cloudPlan.usesSpareAllocation ? 'Reallocate' : 'None' : <>{formatUnits(row.cloudPlan.additionalCU)} CU<span className="small-note" style={{ display: 'block' }}>+{formatMoney(row.cloudPlan.additionalRentCents!)} / wk</span></>}</td>
    </tr>)}</tbody></table>
    <p className="small-note">Capacity fit shows the share of work you can support for your most limited job, including spare service capacity and memory. Extra cloud covers GPUs only; check staff shortages separately.</p>
    <label className="line-control wide-select" htmlFor={'forecast-week-' + scenario.id}>Inspect week<select id={'forecast-week-' + scenario.id} value={selected.week} onChange={event => onSelect(Number(event.target.value))}>{scenario.rows.map(row => <option key={row.week} value={row.week}>Week {row.week}{!row.fits ? ' · constrained' : ''}</option>)}</select></label>
    <RowDetails key={selected.week} row={selected} />
  </details>;
}

export function CapacityForecastPanel({ game, canAct, onQueue }: PanelProps) {
  const status = capacityForecastAvailability(game);
  const [open, setOpen] = useState(false);
  const [baseGrowth, setBaseGrowth] = useState(String(RULES.defaultBaseGrowthBps / 100));
  const [stressGrowth, setStressGrowth] = useState(String(RULES.defaultStressGrowthBps / 100));
  const [baseWeek, setBaseWeek] = useState(game.week + 1), [stressWeek, setStressWeek] = useState(game.week + RULES.horizonWeeks);
  const baseGrowthBps = parseFixed(baseGrowth, 2), stressGrowthBps = parseFixed(stressGrowth, 2);
  const valid = baseGrowthBps !== null && stressGrowthBps !== null && baseGrowthBps <= RULES.maximumGrowthBps && stressGrowthBps <= RULES.maximumGrowthBps && stressGrowthBps >= baseGrowthBps;
  const forecast = useMemo(() => open && status.available && valid
    ? getCapacityForecast(game, { baseGrowthBps: baseGrowthBps!, stressGrowthBps: stressGrowthBps! }, CONTENT) : null,
  [open, status.available, valid, game, baseGrowthBps, stressGrowthBps]);
  const rollout = status.rollout;
  return <Section title="Capacity forecast" id="capacity-forecast">
    <p className="small-note">Check whether your staff, GPUs, and memory can handle the next twelve weeks of customers and contracts.</p>
    <BatchQueueSummary game={game} />
    {!status.researched ? <p className="planned-note">Research Capacity forecast (R12A) under Enterprise operations, then install it here. <a href="#research">Review research</a>.</p>
      : !rollout ? <ActionControl game={game} payload={{ kind: 'start_system_rollout', method: 'capacity-forecast' }} label="Install capacity forecast" canAct={canAct} onQueue={onQueue} />
        : rollout.status !== 'active' ? <div className="project-row"><div className="project-heading"><strong>Forecast rollout</strong><span>{rollout.status === 'ready' ? 'Ready next week' : 'Installing'}</span></div>
          <progress value={Math.min(rollout.completedStaff / rollout.requiredStaff, rollout.completedWork / rollout.requiredWork) * 10000} max={10000} aria-label="Capacity forecast rollout progress" />
          <p className="small-note">{formatWorkPoints(rollout.completedStaff)} / {formatWorkPoints(rollout.requiredStaff)} Design points; {formatUnits(rollout.completedWork)} / {formatUnits(rollout.requiredWork)} development CUw.</p>
          {rollout.lastBottleneck && <p className="bottleneck">{rollout.lastBottleneck}</p>}
        </div> : <details className="inline-details" onToggle={event => setOpen(event.currentTarget.open)}><summary>Plan the next twelve weeks</summary>
          <label className="line-control" htmlFor="forecast-base-growth">Expected customer growth<span className="unit-input"><input id="forecast-base-growth" type="number" min="0" max="10" step="0.25" value={baseGrowth} onChange={event => setBaseGrowth(event.target.value)} />% / week</span></label>
          <label className="line-control" htmlFor="forecast-stress-growth">Higher-growth scenario<span className="unit-input"><input id="forecast-stress-growth" type="number" min="0" max="10" step="0.25" value={stressGrowth} onChange={event => setStressGrowth(event.target.value)} />% / week</span></label>
          {!valid && <p className="invalid-preview" role="status">Enter 0–10% growth per week. The higher-growth scenario must be at least as high as the expected rate.</p>}
          {forecast && <>
            <Metrics><Metric label="Current cloud rental">{formatUnits(forecast.currentCloudCU)} CU · {formatMoney(forecast.currentCloudRentCents)} / week</Metric><Metric label="Development / research kept aside">{formatUnits(forecast.developmentAllocationCU)} / {formatUnits(forecast.researchAllocationCU)} CU</Metric></Metrics>
            <p className="small-note">This forecast uses today’s hardware and ready staff, with resources set aside for signed contracts. It excludes future deliveries, hires, construction, and queued changes. Previewing costs nothing.</p>
            <Scenario scenario={forecast.scenarios[0]} selectedWeek={baseWeek} onSelect={setBaseWeek} />
            <Scenario scenario={forecast.scenarios[1]} selectedWeek={stressWeek} onSelect={setStressWeek} />
            <details className="inline-details"><summary>Forecast assumptions and limits</summary><ul>{forecast.assumptions.map(assumption => <li key={assumption} className="small-note">{assumption}</li>)}</ul></details>
          </>}
        </details>}
  </Section>;
}
