'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useMemo, useState } from 'react';
import { CONTENT } from '../content/catalog';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { BatchJob, BatchMeter } from '../contracts/wave14-batch';
import type { BatchPlacementForecastOptions, BatchPlacementScenario } from '../contracts/wave16-planning';
import { formatMoney, formatUnits } from '../core/math';
import { batchInvoiceAmount, batchPlacementAtWeek } from '../modules/batch-inference';
import { getBatchPlacementForecast } from '../modules/batch-planning';
import { getComputePools, poolSupportsWorkload } from '../modules/compute-pools';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole } from './components';
import type { PanelProps } from './panels';

const count = (value: number) => value.toLocaleString('en-US');
const unitsInput = (value: number) => String(value / U);

export function batchPoolName(game: PanelProps['game'], poolId: string): string {
  if (poolId === 'auto') return 'Automatic';
  const current = getComputePools(game).find(pool => pool.id === poolId);
  if (current) return current.name;
  const previous = game.slices.compute.costReports?.[game.playerCompanyId]?.flatMap(report => report.pools).find(pool => pool.id === poolId);
  return previous?.name ?? 'Unavailable pool';
}

/** This selector describes admission readiness; the allocator still decides actual free resources. */
export function BatchPoolSelect({ game, meter, id, value, onChange, disabled = false }: Pick<PanelProps, 'game'> & {
  meter: Pick<BatchMeter, 'memoryMU' | 'executionHints'> | null;
  id: string;
  value: string;
  onChange: (poolId: string) => void;
  disabled?: boolean;
}) {
  const choices = getComputePools(game).map(pool => {
    const reason = !meter ? 'Choose a model first.'
      : !poolSupportsWorkload(pool, { category: 'serving', ...meter.executionHints }) ? 'This hardware does not support the selected model.'
        : pool.memoryMU < meter.memoryMU ? `Needs ${formatUnits(meter.memoryMU)} MU; this pool has ${formatUnits(pool.memoryMU)} MU.`
          : pool.capacityCU <= 0 ? pool.bottleneck || 'No usable capacity in this pool.' : null;
    return { pool, reason };
  });
  const chosen = choices.find(choice => choice.pool.id === value);
  return <>
    <label className="line-control wide-select" htmlFor={id}>GPU pool<select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled || !meter}>
      <option value="auto">Automatic · most available compute</option>
      {value !== 'auto' && !chosen && <option value={value} disabled>{batchPoolName(game, value)} · unavailable</option>}
      {choices.map(({ pool, reason }) => <option key={pool.id} value={pool.id} disabled={!!reason}>{pool.name}{reason ? ' · unavailable' : ` · ${formatUnits(pool.capacityCU)} CU / ${formatUnits(pool.memoryMU)} MU`}</option>)}
    </select></label>
    {value !== 'auto' && chosen?.reason && <p className="bottleneck">{chosen.reason}</p>}
    <p className="small-note">Each batch uses one connected GPU pool. Automatic placement picks the pool that can do the most work that week. Choosing a specific pool makes the job wait for space there.</p>
  </>;
}

function ScenarioDetails({ scenario, priorEarnedCents, horizonWeeks }: { scenario: BatchPlacementScenario; priorEarnedCents: number; horizonWeeks: number }) {
  const futureRevenue = scenario.projectedInvoiceCents - priorEarnedCents;
  const afterExtraCompute = futureRevenue - scenario.additionalCloudReservationCents - scenario.ownedVariableCents;
  return <>
    <p className="small-heading">{scenario.poolName}</p>
    {scenario.reason && <p className="bottleneck">{scenario.reason}</p>}
    <Metrics>
      <Metric label="Expected total completed requests">{count(scenario.completedRequests)}</Metric>
      <Metric label="Expected final invoice / credit">{formatMoney(scenario.projectedInvoiceCents)} / {formatMoney(scenario.projectedCreditsCents)}</Metric>
      <Metric label="Remaining GPU work">{formatUnits(scenario.physicalWorkCUw)} CUw</Metric>
      <Metric label="Remaining model work">{formatUnits(scenario.effectiveWorkCUw)} CUw</Metric>
      <Metric label="Remaining staff work">{formatWorkPoints(scenario.commercialStaffWeeks)} points</Metric>
      <Metric label="Future revenue from unfinished work">{formatMoney(futureRevenue)}</Metric>
      <Metric label={`Extra cloud rent · ${horizonWeeks} weeks`}>{formatMoney(scenario.additionalCloudReservationCents)}</Metric>
      <Metric label="Future owned-GPU usage">{formatMoney(scenario.ownedVariableCents)}</Metric>
      <Metric label="After extra rent and owned usage">{formatMoney(afterExtraCompute)}</Metric>
    </Metrics>
    <p className="small-note">This amount excludes existing cloud rent, staff pay, and fixed site costs. Extra cloud rent covers the full forecast period, even if the job finishes early. Count that rent once when several jobs share a plan. It continues until you change the reservation. Reducing rented compute lowers the bill; those savings are not job revenue.</p>
    <details className="inline-details"><summary>Weekly delivery and cost details</summary>
      <Metrics><Metric label="Cloud work share already within rent">{formatMoney(scenario.cloudWorkRentCents)}</Metric></Metrics>
      <p className="small-note">This is the job’s share of cloud rent you already pay. Usage costs are estimates before weekly rounding. The figures below cover remaining work only.</p>
      <div className="table-scroll"><table className="compact-table"><caption>{scenario.poolName}: conditional weekly delivery</caption><thead><tr><th>Week / pool</th><th>Requests</th><th>Physical GPU</th><th>Handling</th></tr></thead><tbody>
        {scenario.rows.map(row => <tr key={row.week}>
          <td>{row.week}{row.paused ? ' · paused' : ''}<span className="table-subline">{row.actualPoolName ?? 'No compute assigned'}</span>{row.bottleneck && <span className="table-subline">{row.bottleneck}</span>}</td>
          <td>{count(row.completedRequests)}<span className="table-subline">{count(row.cumulativeRequests)} total</span></td>
          <td>{formatUnits(row.physicalWorkCUw)} CUw<span className="table-subline">{formatUnits(row.effectiveWorkCUw)} / {formatUnits(row.requestedWorkCUw)} model CUw</span></td>
          <td>{formatWorkPoints(row.staffGranted)} / {formatWorkPoints(row.staffRequested)} points / week</td>
        </tr>)}
      </tbody></table></div>
    </details>
  </>;
}

type PlanningProps = PanelProps & {
  options: BatchPlacementForecastOptions;
  poolId: string;
  onPoolChange: (poolId: string) => void;
  visible?: boolean;
};

export function BatchPlanningPanel({ options, poolId, onPoolChange, visible = true, game, canAct, onQueue }: PlanningProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ cloud: string; serving: string } | null>(null);
  const [comparison, setComparison] = useState<{ cloudCU: number; servingCU: number } | null>(null);
  const fleet = game.slices.compute.fleets[game.playerCompanyId];
  const cloudText = draft?.cloud ?? unitsInput(fleet.cloudCU), servingText = draft?.serving ?? unitsInput(fleet.allocation.serving);
  const cloudWhole = parseWhole(cloudText), parsedServing = parseFixed(servingText, 9);
  const parsedCloud = cloudWhole !== null && Number.isSafeInteger(cloudWhole * U) ? cloudWhole * U : null;
  const validInput = parsedCloud !== null && parsedCloud <= CONTENT.firstSale.maxCloudCU && parsedServing !== null;
  const cloudCU = comparison?.cloudCU ?? fleet.cloudCU, servingCU = comparison?.servingCU ?? fleet.allocation.serving;
  const changedInputs = parsedCloud !== cloudCU || parsedServing !== servingCU;
  const { jobId, productId, orderId, modelId, weeklyWorkCapCUw } = options;
  const forecast = useMemo(() => open && visible ? getBatchPlacementForecast(game,
    { jobId, productId, orderId, modelId, weeklyWorkCapCUw, cloudCU, servingCU }, CONTENT) : null,
  [open, visible, game, jobId, productId, orderId, modelId, weeklyWorkCapCUw, cloudCU, servingCU]);
  const selected = forecast?.scenarios.find(scenario => scenario.poolId === poolId) ?? forecast?.scenarios[0];
  const job = jobId ? game.slices.products.batchJobs?.[jobId] : undefined;
  const priorEarnedCents = job ? batchInvoiceAmount(job.terms, job.completedRequests) : 0;
  const id = (jobId ?? productId ?? 'batch') + '-plan';
  const setCapacityDraft = (field: 'cloud' | 'serving', value: string) => setDraft(current => ({
    cloud: current?.cloud ?? unitsInput(fleet.cloudCU), serving: current?.serving ?? unitsInput(fleet.allocation.serving), [field]: value,
  }));
  return <details className="inline-details" onToggle={event => setOpen(event.currentTarget.open)}><summary>Placement and cost forecast</summary>
    <p className="small-note">See how a batch fits around current jobs, memory, and staff. Estimates assume those workloads stay the same. Comparing plans costs nothing.</p>
    <p className="small-note">Keep enough cash for weekly bills. This forecast assumes you can pay them throughout the job.</p>
    <label className="line-control" htmlFor={id + '-cloud'}>Total cloud reservation<span className="unit-input"><input id={id + '-cloud'} type="number" min="0" max={CONTENT.firstSale.maxCloudCU / U} step="1" value={cloudText} onChange={event => setCapacityDraft('cloud', event.target.value)} />CU</span></label>
    <label className="line-control" htmlFor={id + '-serving'}>Total serving allocation<span className="unit-input"><input id={id + '-serving'} type="number" min="0" step="0.25" value={servingText} onChange={event => setCapacityDraft('serving', event.target.value)} />CU</span></label>
    <p className="small-note">Development keeps {formatUnits(fleet.allocation.development)} CU and research keeps {formatUnits(fleet.allocation.research)} CU. Serving still shares the physical pools with their work.</p>
    <div className="save-buttons">
      <button type="button" disabled={!validInput || !changedInputs} onClick={() => { if (validInput) setComparison({ cloudCU: parsedCloud!, servingCU: parsedServing! }); }}>Compare capacity</button>
      <button type="button" disabled={draft === null && comparison === null} onClick={() => { setDraft(null); setComparison(null); }}>Use current capacity</button>
    </div>
    {!validInput && <p className="invalid-preview" role="status">Enter a whole cloud reservation from 0 to {formatUnits(CONTENT.firstSale.maxCloudCU)} CU and a nonnegative serving allocation.</p>}
    {changedInputs && validInput && <p className="small-note" role="status">Inputs changed. Compare capacity to update the estimates below.</p>}
    {forecast && <>
      <p className="small-note">Comparison: {formatUnits(forecast.selectedCapacity.cloudCU)} cloud CU, {formatUnits(forecast.selectedCapacity.servingCU)} serving CU, and {formatMoney(forecast.selectedCapacity.cloudRentCentsPerWeek)} total cloud rent per week.</p>
      {!forecast.capacityPlanValid && <p className="bottleneck">{forecast.capacityPlanReason}</p>}
      {!forecast.available ? <p className="planned-note">{forecast.reason}</p> : <>
        <p className="small-note">Weeks {forecast.startWeek}–{forecast.deadlineWeek} · {forecast.horizonWeeks} remaining weeks. The invoice includes work already completed; cost projections cover only future work.</p>
        {forecast.paused && <p className="bottleneck">This job is paused. The forecast keeps it paused while its deadline continues. Resume the job and refresh the comparison to plan further delivery.</p>}
        <div className="table-scroll"><table className="compact-table"><caption>Placement comparison at the selected capacity</caption><thead><tr><th>Pool</th><th>Completed / delivery</th><th>Final invoice</th></tr></thead><tbody>
          {forecast.scenarios.map(scenario => <tr key={scenario.poolId}>
            <td>{scenario.poolName}{scenario.poolId === poolId && <span className="table-subline">Selected</span>}{!scenario.compatible && <span className="table-subline">{scenario.reason ?? 'Incompatible'}</span>}</td>
            <td>{count(scenario.completedRequests)}<span className="table-subline">{scenario.completionWeek !== null ? `Done Week ${scenario.completionWeek}` : `${count(scenario.remainingRequests)} unfinished`}</span></td>
            <td>{formatMoney(scenario.projectedInvoiceCents)}<span className="table-subline">{formatMoney(scenario.projectedCreditsCents)} credit</span></td>
          </tr>)}
        </tbody></table></div>
        <label className="line-control wide-select" htmlFor={id + '-pool'}>Inspect / select pool<select id={id + '-pool'} value={selected?.poolId ?? 'auto'} onChange={event => onPoolChange(event.target.value)}>
          {forecast.poolOptions.map(pool => <option key={pool.poolId} value={pool.poolId} disabled={pool.poolId !== 'auto' && !pool.compatible}>{pool.poolName}{pool.compatible ? '' : ' · no current fit'}</option>)}
        </select></label>
        {selected && <ScenarioDetails scenario={selected} priorEarnedCents={priorEarnedCents} horizonWeeks={forecast.horizonWeeks} />}
        {!job && <p className="small-note">Choose a pool here, then use “Accept batch order” above when ready.</p>}
      </>}
      {job && <>
        {!forecast.available && <BatchPoolSelect game={game} meter={job.meter} id={id + '-fallback-pool'} value={poolId} onChange={onPoolChange} disabled={!canAct} />}
        <ActionControl game={game} payload={{ kind: 'set_batch_job_placement', jobId: job.id, poolId }} label="Change batch GPU pool" canAct={canAct} onQueue={onQueue} extraDisabled={poolId === batchPlacementAtWeek(job)} />
      </>}
      {forecast.capacityPlanValid && !changedInputs && (cloudCU !== fleet.cloudCU || servingCU !== fleet.allocation.serving) && <ActionControl game={game}
        payload={{ kind: 'set_batch_capacity', cloudCU, servingCU }} label="Apply compared capacity" canAct={canAct} onQueue={onQueue} />}
      <p className="small-note">Apply capacity and GPU-pool changes separately. Capacity changes take effect next week and affect the whole company. Accept orders and resume paused jobs separately; other work can still use the same pool.</p>
      <details className="inline-details"><summary>Forecast assumptions</summary><ul>{forecast.assumptions.map(assumption => <li key={assumption} className="small-note">{assumption}</li>)}</ul></details>
    </>}
  </details>;
}

export function BatchJobPlanning({ job, visible, ...props }: PanelProps & { job: BatchJob; visible?: boolean }) {
  const current = batchPlacementAtWeek(job);
  const [choice, setChoice] = useState<{ current: string; selected: string } | null>(null);
  const selected = choice?.current === current ? choice.selected : current;
  return <BatchPlanningPanel {...props} visible={visible} options={{ jobId: job.id }} poolId={selected}
    onPoolChange={poolId => setChoice({ current, selected: poolId })} />;
}
