'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { BatchJob, BatchOrderId, BatchView } from '../contracts/wave14-batch';
import { BATCH_ORDER_BY_ID, BATCH_RULES } from '../content/wave14-batch';
import { formatMoney, formatUnits } from '../core/math';
import { batchMeter, batchPlacementAtWeek, batchTariffEstimateCents, getBatchView } from '../modules/batch-inference';
import { ActionControl, Metric, Metrics } from './components';
import { BatchJobPlanning, BatchPlanningPanel, BatchPoolSelect, batchPoolName } from './batch-planning-panel';
import type { PanelProps } from './panels';

const count = (value: number) => value.toLocaleString('en-US');
const ongoing = (job: BatchJob) => job.status === 'active' || job.status === 'paused';

function BatchOrderForm({ productId, batchView, planningVisible, ...props }: PanelProps & { productId: string; batchView: BatchView; planningVisible: boolean }) {
  const { game, canAct, onQueue } = props;
  const [orderId, setOrderId] = useState<BatchOrderId>('archive-tagging');
  const [modelId, setModelId] = useState('');
  const [weeklyCap, setWeeklyCap] = useState(8 * U);
  const [poolId, setPoolId] = useState('auto');
  const order = BATCH_ORDER_BY_ID[orderId];
  const models = batchView.models.filter(model => model.eligibleOrders.includes(orderId));
  const publicModelId = game.slices.products.offers[productId]?.publicModelId;
  const candidate = models.find(model => model.id === modelId) ?? models.find(model => model.id === publicModelId) ?? models[models.length - 1];
  const model = candidate && game.slices.models.versions[candidate.id];
  const meter = model ? batchMeter(game, model.id, orderId) : null;
  const work = meter ? meter.workPerRequestCUw * order.requests : 0;
  const minimumWeeks = Math.ceil(work / weeklyCap);
  const offer = batchView.board.find(item => item.id === orderId)!;
  return <div className="system-application" role="group" aria-label="Choose a batch order">
    <label className="line-control wide-select" htmlFor={productId + '-batch-order'}>Order<select id={productId + '-batch-order'} value={orderId} disabled={!canAct} onChange={event => setOrderId(event.target.value as BatchOrderId)}>
      {batchView.board.map(item => <option key={item.id} value={item.id}>{item.name} · {item.remainingClaims} remaining</option>)}
    </select></label>
    <p className="small-note">{order.description}</p>
    <p className="small-note">Requires an evaluated {order.domain} score of {order.minimumScoreBps / 100} and reliability {order.minimumReliabilityBps / 100}, the required policy tests, and hosted-use rights.</p>
    <label className="line-control wide-select" htmlFor={productId + '-batch-model'}>Batch model<select id={productId + '-batch-model'} value={candidate?.id ?? ''} disabled={!canAct || !models.length} onChange={event => setModelId(event.target.value)}>
      {!models.length && <option value="">Evaluate a qualifying model</option>}
      {models.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}</option>)}
    </select></label>
    <label className="line-control wide-select" htmlFor={productId + '-batch-cap'}>Work limit / week<select id={productId + '-batch-cap'} value={weeklyCap} disabled={!canAct} onChange={event => setWeeklyCap(Number(event.target.value))}>
      {BATCH_RULES.weeklyWorkCapsCUw.map(cap => <option key={cap} value={cap}>{formatUnits(cap)} model CUw</option>)}
    </select></label>
    <BatchPoolSelect game={game} meter={meter} id={productId + '-batch-pool'} value={poolId} onChange={setPoolId} disabled={!canAct} />
    <Metrics>
      <Metric label="Requests / delivery window">{count(order.requests)} / {order.windowWeeks} weeks</Metric>
      <Metric label="Payment for the full order">{formatMoney(offer.quotedCents)}</Metric>
      <Metric label="Input / output per million tokens">{formatMoney(order.inputPriceCentsPerMillion)} / {formatMoney(order.outputPriceCentsPerMillion)}</Metric>
      {meter && <><Metric label="Total model work">{formatUnits(work)} CUw</Metric>
        <Metric label="Memory for this job">{formatUnits(meter.memoryMU)} MU</Metric>
        <Metric label="Fastest possible completion">{minimumWeeks} weeks</Metric></>}
      <Metric label="Handling while running">5 Business points / week</Metric>
    </Metrics>
    {meter && minimumWeeks > order.windowWeeks && <p className="bottleneck">This model needs at least {minimumWeeks} weeks at the selected limit. Only work completed within the {order.windowWeeks}-week window can earn payment. Choose a higher limit or a qualifying faster model to finish the whole order.</p>}
    <ActionControl game={game} payload={candidate ? { kind: 'accept_batch_job', productId, orderId, modelId: candidate.id, weeklyWorkCapCUw: weeklyCap, ...(poolId === 'auto' ? {} : { poolId }) } : null}
      label="Accept batch order" canAct={canAct} onQueue={onQueue} emptyReason="Evaluate a model that meets this order’s capability, policy, and rights requirements." />
    <p className="small-note">This estimate assumes the job gets its full work allowance every week. Live services go first. Staff shortages, memory, and spare serving compute can slow the job. Accepting locks in the model, work limit, token rates, and deadline.</p>
    {candidate && <BatchPlanningPanel {...props} visible={planningVisible} options={{ productId, orderId, modelId: candidate.id, weeklyWorkCapCUw: weeklyCap }} poolId={poolId} onPoolChange={setPoolId} />}
  </div>;
}

function BatchJobReceipt({ job, batchView, planningVisible, ...props }: PanelProps & { job: BatchJob; batchView: BatchView; planningVisible: boolean }) {
  const { game, canAct, onQueue } = props;
  const invoice = batchView.invoices.find(item => item.jobId === job.id);
  const last = job.usageHistory[job.usageHistory.length - 1];
  return <div className="system-application" role="group" aria-label={job.terms.name + ' batch job'}>
    <p className="small-heading">{job.terms.name}<span className="status-inline">{job.status} · order {job.claim}</span></p>
    <Metrics>
      <Metric label="Job model">{game.slices.models.versions[job.model.modelId]?.name}</Metric>
      <Metric label="Delivery window">Weeks {job.acceptedWeek}–{job.deadlineWeek}</Metric>
      <Metric label="Completed requests">{count(job.completedRequests)} / {count(job.terms.requests)}</Metric>
      <Metric label="Model work completed">{formatUnits(job.completedWork)} / {formatUnits(job.requiredWork)} CUw</Metric>
      <Metric label="Requested weekly limit">{formatUnits(job.weeklyWorkCapCUw)} CUw</Metric>
      <Metric label="Physical GPU work so far">{formatUnits(job.physicalWork)} CUw</Metric>
      <Metric label="Estimated GPU cost so far">{formatMoney(batchTariffEstimateCents(job))}</Metric>
      <Metric label="Business staff work used">{formatWorkPoints(job.commercialStaffSpent)} points</Metric>
      {invoice && <><Metric label="Credit for unfinished work">{formatMoney(invoice.creditsCents)}</Metric><Metric label="Final earned bill">{formatMoney(invoice.amountCents)}</Metric></>}
    </Metrics>
    <p className="small-note">GPU placement: <strong style={{ overflowWrap: 'anywhere' }}>{batchPoolName(game, batchPlacementAtWeek(job))}</strong>.</p>
    <p className={ongoing(job) && job.lastBottleneck ? 'bottleneck' : 'small-note'} role="status">{job.lastBottleneck}</p>
    {last && <p className="small-note">Week {last.week}: {count(last.completedRequests)} requests completed; {formatUnits(last.executedWorkCUw)} CUw processed with {formatWorkPoints(last.staffGranted)} Business points / week. {last.explanation}</p>}
    {ongoing(job) && <BatchJobPlanning {...props} job={job} visible={planningVisible} />}
    {ongoing(job) && <details className="inline-details"><summary>Pause or end this batch</summary>
      <ActionControl game={game} payload={{ kind: 'set_batch_job_paused', jobId: job.id, paused: job.status !== 'paused' }} label={job.status === 'paused' ? 'Resume batch job' : 'Pause batch job'} canAct={canAct} onQueue={onQueue} compact />
      <ActionControl game={game} payload={{ kind: 'cancel_batch_job', jobId: job.id }} label="End job and collect payment" canAct={canAct} onQueue={onQueue} compact />
      <p className="small-note">Pausing frees the job’s GPUs and handling staff, but the deadline keeps counting down. Ending the job pays for completed requests and stops further work.</p>
    </details>}
    <details className="inline-details"><summary>Work and payment history</summary>
      <Metrics><Metric label="Completed input / output tokens">{count(job.inputTokens)} / {count(job.outputTokens)}</Metric><Metric label="Quoted whole-order bill">{formatMoney(job.quotedCents)}</Metric><Metric label="Separate memory">{formatUnits(job.meter.memoryMU)} MU</Metric></Metrics>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Week</th><th>Requests</th><th>GPU work</th><th>Handling</th></tr></thead><tbody>
        {job.usageHistory.map(row => <tr key={row.week}><td>{row.week}{row.paused ? ' · paused' : ''}<span className="table-subline">{row.poolId ? batchPoolName(game, row.poolId) : 'No compute assigned'}</span></td><td>{count(row.completedRequests)}</td><td>{formatUnits(row.physicalWorkCUw)} CUw</td><td>{formatWorkPoints(row.staffGranted)} points / week</td></tr>)}
      </tbody></table></div>
      {!!job.placementHistory?.length && <details className="inline-details"><summary>Placement choices</summary>
        {job.placementHistory.map(choice => <p className="small-note" key={choice.commandId}>Week {choice.week}: {batchPoolName(game, choice.poolId)}. The original model, work limit, and deadline remain fixed.</p>)}
      </details>}
      <p className="small-note">You are paid once when the job finishes, expires, or is ended. Only completed requests earn payment. Partial work carries into later active weeks. Unfinished requests are credited with no extra fine.</p>
      <p className="small-note">The GPU estimate uses the work done on each pool. It includes that job’s share of cloud rent or owned-GPU running costs. Staff pay, fixed site costs, and rounding are separate. See Compute costs for the weekly breakdown.</p>
    </details>
  </div>;
}

export function BatchInferencePanel({ productId, ...props }: PanelProps & { productId?: string }) {
  const { game, canAct, onQueue } = props;
  const [planningVisible, setPlanningVisible] = useState(false);
  const view = getBatchView(game);
  const scheduler = view.scheduler;
  const jobs = productId ? view.jobs.filter(job => job.productId === productId) : view.jobs;
  const acceptsOrders = !!productId && view.products.some(product => product.id === productId && product.available);
  if (!view.researched && !scheduler && !jobs.length) return null;
  const active = jobs.filter(ongoing), ended = jobs.filter(job => !ongoing(job));
  return <details className="inline-details" onToggle={event => setPlanningVisible(event.currentTarget.open)}><summary>Batch inference</summary>
    <p className="small-note">Earn money from extra work for your developer customers. Batch jobs use spare serving compute and memory after live services and other GPU work. Commercial staff handle existing jobs before seeking new customers.</p>
    {!scheduler ? <ActionControl game={game} payload={{ kind: 'install_batch_scheduler' }} label="Install batch scheduler" canAct={canAct} onQueue={onQueue} />
      : scheduler.status !== 'active' ? <div className="project-row"><p className="small-heading">Batch scheduler<span className="status-inline">{scheduler.status}</span></p>
        <Metrics><Metric label="Implementation work">{formatUnits(scheduler.completedWork)} / {formatUnits(scheduler.requiredWork)} CUw</Metric><Metric label="Design staff effort">{formatWorkPoints(scheduler.completedStaff)} / {formatWorkPoints(scheduler.requiredStaff)} points</Metric>{scheduler.availableWeek !== null && <Metric label="Available">Week {scheduler.availableWeek}</Metric>}</Metrics>
        <p className="small-note">{scheduler.lastBottleneck}</p>
      </div> : <>
        <div className="table-scroll"><table className="compact-table"><caption>Available batch orders</caption><thead><tr><th>Order</th><th>Window</th><th>Full bill</th></tr></thead><tbody>{view.board.map(order => <tr key={order.id}><td>{order.name}<span className="table-subline">{count(order.requests)} requests · {order.remainingClaims} remaining</span></td><td>{order.windowWeeks} weeks</td><td>{formatMoney(order.quotedCents)}</td></tr>)}</tbody></table></div>
        {acceptsOrders && productId ? <BatchOrderForm {...props} productId={productId} batchView={view} planningVisible={planningVisible} />
          : <p className="planned-note">Batch orders unlock when your Developer API is active and has paying customers with a recent paid token invoice. {productId ? 'Serve paid API requests to make this order board available.' : 'Deploy the API above, then serve paying customers to use this scheduler.'}</p>}
      </>}
    {active.map(job => <BatchJobReceipt key={job.id} {...props} job={job} batchView={view} planningVisible={planningVisible} />)}
    {ended.length > 0 && <details className="inline-details"><summary>Past batch orders · {ended.length}</summary>{ended.map(job => <BatchJobReceipt key={job.id} {...props} job={job} batchView={view} planningVisible={planningVisible} />)}</details>}
    <details className="inline-details"><summary>How batch jobs work</summary>
      <p className="small-note">Each order uses one tested model with hosted-use rights and its own memory. Public API routing, conversation options, caches, and response checkers do not apply to batch jobs. Changing or pausing the API leaves accepted jobs as they are. Batch requests are allowed tasks; completing them earns money, not training data or new customers.</p>
      <p className="small-note">The scheduler costs {formatMoney(BATCH_RULES.schedulerFeeCents)}, two development CUw, and 40 Design points, capped at 1 CUw and 20 Design points per week. Up to three orders of each type are available, including cancelled or expired orders. Completed jobs stay in the history.</p>
    </details>
  </details>;
}

export function BatchQueueSummary({ game }: Pick<PanelProps, 'game'>) {
  const view = getBatchView(game);
  if (!view.activeJobs) return null;
  const jobs = view.jobs.filter(ongoing);
  return <details className="inline-details"><summary>Batch jobs waiting · {view.activeJobs}</summary>
    <Metrics><Metric label="Remaining one-time work">{formatUnits(view.remainingWorkCUw)} CUw</Metric><Metric label="Running weekly work limits">{formatUnits(view.requestedWeeklyCapCUw)} CUw</Metric><Metric label="Maximum handling demand">{formatWorkPoints(view.maximumCommercialStaff)} Business points / week</Metric></Metrics>
    {jobs.map(job => <p className="small-note" key={job.id}>{job.terms.name}: {formatUnits(job.requiredWork - job.completedWork)} CUw remain; due Week {job.deadlineWeek}{job.status === 'paused' ? ' · paused' : ''}.</p>)}
    <p className="small-note">These jobs use spare serving capacity after weekly customer service. The twelve-week customer forecast covers recurring contracts. Compare batch GPU choices, delivery, and costs in <a href="#developer-api">Developer API → Batch inference → Placement and cost forecast</a>.</p>
  </details>;
}
