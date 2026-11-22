'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useId, useState } from 'react';
import type { CommandPayload } from '../contracts/types';
import type { AgentJobView, AgentMode, AgentTool, AgentVerification, AgentView } from '../contracts/wave3-agents';
import { CONTENT } from '../content/catalog';
import { AGENT_TOOLS, CODING_AGENT_ORDER } from '../content/wave3-agents';
import { formatMoney, formatUnits } from '../core/index';
import { agentMeetsOrder, agentOrderTools, getAgentView, getAgentWorkflowEstimate } from '../modules/agents';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole, Section } from './components';
import type { PanelProps } from './panels';
import { AgentRecoveryControl, AgentRecoverySystem } from './agent-recovery-controls';

const TOOL_NAME = Object.fromEntries(AGENT_TOOLS.map(tool => [tool.id, tool.name])) as Record<AgentTool, string>;
const MODE_NAME: Record<AgentMode, string> = { draft: 'Draft for review', approval: 'Act after approval', bounded: 'Act within limits' };
const VERIFICATION_NAME: Record<AgentVerification, string> = { basic: 'Basic check', independent: 'Independent checks' };
const count = (value: number) => value.toLocaleString('en-US');

/** Intake IDs include their four-week cycle. Retained drafts must recover an
 * expired intake or unavailable model explicitly instead of choosing another. */
export function resolveAgentOrderSelection(agents: AgentView, orderId: string, modelId: string, coding = false) {
  const order = (coding ? agents.codingOrders : agents.orders).find(item => item.id === orderId);
  const model = agents.models.find(item => item.id === modelId);
  const problem = !order
    ? orderId ? 'This order is no longer available. Choose a new order; your permissions and limits are still set.' : 'Choose an order to see its costs and requirements.'
    : !model ? modelId ? 'This model is no longer available for agent work. Choose another tested model; your permissions and limits are still set.' : 'Choose an evaluated model before accepting an agent order.'
      : undefined;
  return { order, model, problem };
}

function AgentOrderForm({ game, canAct, onQueue, agents, coding = false }: PanelProps & { agents: AgentView; coding?: boolean }) {
  const id = useId();
  const orders = coding ? agents.codingOrders : agents.orders;
  const codingTools = agentOrderTools(CODING_AGENT_ORDER);
  const [orderId, setOrderId] = useState(orders.find(order => !order.claimed)?.id ?? '');
  const defaultModel = (coding && agents.models.filter(model => agentMeetsOrder(CODING_AGENT_ORDER, model)).at(-1)) || agents.models.at(-1);
  const [modelId, setModelId] = useState(defaultModel?.id ?? '');
  const [mode, setMode] = useState<AgentMode>(coding ? 'approval' : 'draft');
  const [verification, setVerification] = useState<AgentVerification>(coding ? 'independent' : 'basic');
  const [tools, setTools] = useState<AgentTool[]>(() => coding ? codingTools : ['read_ticket', 'search_docs', 'send_reply']);
  const [maxSteps, setMaxSteps] = useState(coding ? '24' : '12');
  const [maxRetries, setMaxRetries] = useState('1');
  const [workBudget, setWorkBudget] = useState(coding ? '10' : '1');
  const { order, model, problem } = resolveAgentOrderSelection(agents, orderId, modelId, coding);
  const steps = parseWhole(maxSteps), retries = parseWhole(maxRetries), budget = parseFixed(workBudget, 9);
  const payload: CommandPayload | null = order && model && steps !== null && retries !== null && budget !== null
    ? { kind: 'start_agent_job', orderId: order.id, modelId: model.id, mode, verification, tools, maxSteps: steps, maxRetries: retries, workBudget: budget } : null;
  const estimate = order && model && payload?.kind === 'start_agent_job' ? getAgentWorkflowEstimate(order, model, payload) : null;
  function toggleTool(tool: AgentTool, allowed: boolean) {
    setTools(current => allowed ? [...current, tool] : current.filter(item => item !== tool));
  }
  return <div className="agent-order-form">
    <label className="line-control wide-select" htmlFor={id + "-order"}>{coding ? "Coding order" : "Support order"}<select id={id + "-order"} value={orderId} onChange={event => setOrderId(event.target.value)} disabled={!canAct || !orders.length}><option value="">{orders.length ? 'Choose a current order' : 'No open orders'}</option>{orderId && !order && <option value={orderId}>Saved order unavailable · {orderId}</option>}{orders.map(item => <option key={item.id} value={item.id}>{item.name}{item.claimed ? ' · already claimed' : ''}</option>)}</select></label>
    {order && <><p className="small-note">{order.description} {order.caseCount} cases. Available Week {order.availableWeek} through Week {order.expiresWeek}.</p><Metrics><Metric label="Payment for a reviewed draft">{formatMoney(order.draftFeeCents)}</Metric><Metric label="Payment for verified work">{formatMoney(order.outcomeFeeCents)}</Metric><Metric label="Failed-action penalty">{formatMoney(order.failurePenaltyCents)}</Metric></Metrics><p className="small-note">Needs {order.readTools.map(tool => TOOL_NAME[tool]).join(', ')}; the proposed action is {TOOL_NAME[order.actionTool].toLowerCase()}. {order.coding ? `Minimum coding / tools / reliability: ${order.coding.minCodingBps / 100} / ${order.minToolsBps / 100} / ${order.coding.minReliabilityBps / 100}.` : `Minimum conversation / documents / tools: ${order.minConversationBps / 100} / ${order.minDocumentsBps / 100} / ${order.minToolsBps / 100}.`}</p></>}
    <label className="line-control wide-select" htmlFor={id + "-model"}>Evaluated model<select id={id + "-model"} value={modelId} onChange={event => setModelId(event.target.value)} disabled={!canAct || !agents.models.length}><option value="">{agents.models.length ? 'Choose an evaluated model' : 'Evaluate an owned model first'}</option>{modelId && !model && <option value={modelId}>Saved model unavailable · {modelId}</option>}{agents.models.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}</option>)}</select></label>
    {problem && <p className="small-note blocked-explanation" role="status">{problem}</p>}
    {model && <p className="small-note">Conversation {model.capabilityBps.conversation / 100}, documents {model.capabilityBps.documents / 100}, coding {model.capabilityBps.coding / 100}, tools {model.capabilityBps.tools / 100}; reliability {model.reliabilityBps / 100}. Model memory: {formatUnits(model.residentMU)} MU.</p>}
    <label className="line-control wide-select" htmlFor={id + "-mode"}>Operating mode<select id={id + "-mode"} value={mode} onChange={event => { const next = event.target.value as AgentMode; setMode(next); if (next === 'bounded') setVerification('independent'); }} disabled={!canAct}><option value="draft">Draft for review</option><option value="approval">Act after approval</option><option value="bounded" disabled={!agents.boundedUnlocked}>Act within limits{!agents.boundedUnlocked ? ' · requires R11' : ''}</option></select></label>
    <label className="line-control wide-select" htmlFor={id + "-verification"}>Verification<select id={id + "-verification"} value={verification} onChange={event => setVerification(event.target.value as AgentVerification)} disabled={!canAct}><option value="basic" disabled={coding || mode === 'bounded'}>Basic check</option><option value="independent" disabled={!agents.independentUnlocked}>Independent checks{!agents.independentUnlocked ? ' · requires R10' : ''}</option></select></label>
    <details className="inline-details"><summary>Permissions and limits</summary><fieldset className="plain-fieldset"><legend>Allowed tools for this order</legend>{AGENT_TOOLS.filter(tool => coding === codingTools.includes(tool.id)).map(tool => <label className="checkbox-control" key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} disabled={!canAct} onChange={event => toggleTool(tool.id, event.target.checked)} /><span>{tool.name}<span className="table-subline">{tool.kind === 'write' ? 'Changes customer work · ' : tool.kind === 'test' ? 'Test environment only · ' : 'Read only · '}{tool.description}</span></span></label>)}</fieldset>
      <label className="line-control" htmlFor={id + "-step-limit"}>Maximum steps<input id={id + "-step-limit"} type="number" min="4" max="24" step="1" value={maxSteps} onChange={event => setMaxSteps(event.target.value)} disabled={!canAct} /></label>
      <label className="line-control" htmlFor={id + "-retry-limit"}>Maximum retries<input id={id + "-retry-limit"} type="number" min="0" max="2" step="1" value={maxRetries} onChange={event => setMaxRetries(event.target.value)} disabled={!canAct} /></label>
      <label className="line-control" htmlFor={id + "-work-limit"}>Total work budget<span className="unit-input"><input id={id + "-work-limit"} type="number" min="0.01" max="32" step="0.01" value={workBudget} onChange={event => setWorkBudget(event.target.value)} disabled={!canAct} /><span>CUw</span></span></label>
      <p className="small-note">The budget covers model calls, tools, checks, and retries. Work stops when a limit is reached. Once started, the model and permissions stay fixed. R9A recovery lets you raise the total work and step limits, up to the maximum shown.</p>
    </details>
    {estimate && <details className="inline-details"><summary>Estimated resources</summary><Metrics><Metric label="Work for one attempt">{formatUnits(estimate.work)} CUw</Metric><Metric label="Minimum successful steps">{estimate.steps}</Metric><Metric label="Business staff review">{formatWorkPoints(estimate.staff)} points</Metric><Metric label="Peak connected memory">{formatUnits(estimate.peakMemory)} MU</Metric></Metrics><p className="small-note">{estimate.note}</p></details>}
    <ActionControl game={game} payload={payload} label={coding ? "Accept coding order" : "Accept support order"} canAct={canAct} onQueue={onQueue} emptyReason={problem} />
    <p className="small-note">You earn either the draft payment or the verified-work payment. Drafts need Commercial staff review before delivery. To act for the customer, the agent needs permission to use the action tool. The verified-work payment requires independent checks and a successful result.</p>
  </div>;
}

function AgentJobRow({ game, canAct, onQueue, current }: PanelProps & { current: AgentJobView }) {
  const { job } = current;
  const title = current.title + ' · accepted Week ' + job.acceptedWeek;
  const decision = job.humanDecision === 'approved' ? 'Approved' : job.humanDecision === 'rejected' ? 'Rejected' : job.humanDecision === 'pending' ? 'Awaiting decision' : 'Not requested';
  const checker = job.checkerPassed === true ? 'Passed' : job.checkerPassed === false ? 'Failed' : 'No completed result';
  const continuation = job.handedOffTo ? game.slices.agents.jobs[job.handedOffTo]?.recovery : undefined;
  return <article className="project-row agent-job" aria-label={title}>
    <div className="project-heading"><strong>{current.title}</strong><span>{job.status === 'awaiting-approval' ? 'Review' : job.status === 'handed-off' ? 'Continued' : job.status}</span></div>
    <p className="small-note">{job.model.name} · {MODE_NAME[job.configuration.mode]} · accepted Week {job.acceptedWeek}</p>
    {job.model.planner && <p className="small-note">Planner training: {((10000 - job.model.planner.currentRepeatBps) / 100).toFixed(1)}% lower chance of repeating an unnecessary lookup. The agent still needs supporting information, checks, and the correct permissions.</p>}
    {job.recovery && <p className="small-note">Recovery {job.recovery.generation} · continued Week {job.recovery.startedWeek} · same customer order and total work used.</p>}
    {continuation && <p className="small-note">Continued in recovery {continuation.generation} · Week {continuation.startedWeek}. This entry shows where the earlier attempt stopped.</p>}
    <p className="agent-stage">{job.terms.coding && job.stage === "draft" ? "Write the requested patch" : current.stageLabel}</p>
    {job.status === 'running' || job.status === 'paused' ? <progress max={10000} value={current.progressBps} aria-label={current.title + ' current stage progress'} /> : null}
    <Metrics><Metric label="Steps / limit">{job.steps} / {job.configuration.maxSteps}</Metric><Metric label="Work / budget">{formatUnits(job.spentWork)} / {formatUnits(job.configuration.workBudget)} CUw</Metric><Metric label="Agent reports">{job.claimedComplete ? 'Complete' : 'Not finished'}</Metric><Metric label="Result verified">{job.verifiedOutcome ? 'Yes' : 'No'}</Metric></Metrics>
    {job.lastBottleneck && <p className="bottleneck">{job.lastBottleneck}</p>}
    {current.canReview && <div className="agent-review" role="group" aria-label={'Review ' + title}><p className="small-heading">Your approval is needed</p><p className="small-note">{job.configuration.mode === 'draft' ? 'Approve this draft for Commercial staff review and delivery. Draft mode sends a proposal; it does not carry out the customer action.' : 'Proposed action: ' + TOOL_NAME[job.terms.actionTool].toLowerCase() + ' for ' + job.terms.caseCount + ' assigned cases. Approval allows this action after Commercial staff review. The result must then pass an audit.'}</p><ActionControl compact game={game} payload={{ kind: 'review_agent_job', jobId: job.id, decision: 'approve' }} label={'Approve · ' + current.title} canAct={canAct} onQueue={onQueue} /><ActionControl compact game={game} payload={{ kind: 'review_agent_job', jobId: job.id, decision: 'reject' }} label={'Reject · ' + current.title} canAct={canAct} onQueue={onQueue} /></div>}
    <details className="inline-details"><summary>Work, checks, and results</summary><Metrics><Metric label="Actual model / tool calls">{job.modelCalls} / {job.toolCalls}</Metric><Metric label="Check / audit calls">{job.checkerRuns}</Metric><Metric label="Checker result">{checker}</Metric><Metric label="Human decision">{decision}</Metric><Metric label="Draft delivered">{job.deliveredDraft ? 'Yes' : 'No'}</Metric><Metric label="Customer action completed">{job.actionApplied ? 'Yes' : 'No'}</Metric><Metric label="Retries / limit">{job.retries} / {job.configuration.maxRetries}</Metric><Metric label="Blocked permissions">{job.permissionBlocks}</Metric><Metric label="Input / output tokens">{count(job.inputTokens)} / {count(job.outputTokens)}</Metric><Metric label="Physical GPU work">{formatUnits(job.physicalWork)} CUw</Metric><Metric label="Business staff review">{formatWorkPoints(job.reviewStaff)} points</Metric><Metric label="Current stage work needed">{formatUnits(current.stageRequiredWork)} CUw</Metric><Metric label="Current stage staff needed">{formatWorkPoints(current.stageRequiredStaff)} points</Metric><Metric label="Connected stage memory">{formatUnits(current.stageMemory)} MU</Metric></Metrics><p className="small-note">Attempts and failed checks still use resources. Follow each step here: the agent’s progress, its checks, your approval, and the completed customer action.</p></details>
    <details className="inline-details"><summary>Permissions and payment</summary><p className="small-note">{MODE_NAME[job.configuration.mode]} · {VERIFICATION_NAME[job.configuration.verification]}. Allowed: {job.configuration.tools.map(tool => TOOL_NAME[tool]).join(', ') || 'No tools'}.</p><Metrics><Metric label="Order setup cost">{formatMoney(job.terms.setupCents)}</Metric><Metric label={current.billingLabel}>{formatMoney(current.expectedBillCents)}</Metric><Metric label="Billed so far">{formatMoney(job.billedCents)}</Metric><Metric label="Penalties">{formatMoney(job.penaltyCents)}</Metric></Metrics><p className="small-note">GPU rent, staff pay, and owned-GPU running costs are paid by your company. You earn the quoted payment only when the draft is delivered or the completed work is verified.</p></details>
    {job.history.length > 0 && <details className="inline-details"><summary>Job history</summary><ol className="agent-history">{job.history.map(record => <li key={record.index}><strong>Week {record.completedWeek} · {record.stage}</strong><span className="small-note">{record.note}</span><span className="table-subline">{record.calls} calls · {formatUnits(record.work)} CUw · attempt {record.attempt + 1}</span></li>)}</ol></details>}
    {(current.canPause || current.canCancel) && <details className="inline-details"><summary>Manage this job</summary>{current.canPause && <ActionControl compact game={game} payload={{ kind: 'set_agent_job_paused', jobId: job.id, paused: job.status !== 'paused' }} label={(job.status === 'paused' ? 'Resume' : 'Pause') + ' · ' + current.title} canAct={canAct} onQueue={onQueue} />}{current.canCancel && <ActionControl compact game={game} payload={{ kind: 'cancel_agent_job', jobId: job.id }} label={'Cancel · ' + current.title} canAct={canAct} onQueue={onQueue} />}<p className="small-note">Stopping the job keeps any completed customer action and costs already paid.</p></details>}
    <AgentRecoveryControl game={game} canAct={canAct} onQueue={onQueue} job={job} />
  </article>;
}

export function AgentsPanel(props: PanelProps) {
  const { game } = props;
  const agents: AgentView = getAgentView(game, game.playerCompanyId, CONTENT);
  const jobs = agents.jobs.filter(current => current.job.companyId === game.playerCompanyId);
  const awaiting = jobs.filter(current => current.job.status === 'awaiting-approval');
  const running = jobs.filter(current => current.job.status === 'running' || current.job.status === 'paused');
  const finished = jobs.filter(current => ['complete', 'failed', 'cancelled', 'handed-off'].includes(current.job.status));
  const invoices = agents.invoices.filter(invoice => invoice.companyId === game.playerCompanyId).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id));
  const receipts = agents.receipts.filter(receipt => receipt.companyId === game.playerCompanyId).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id));
  return <Section title="Agent services" id="agents">
    {agents.unlocked ? <><Metrics><Metric label="Reviewed drafts / verified outcomes">{agents.totals.deliveredDrafts} / {agents.totals.verifiedOutcomes}</Metric><Metric label="Agent revenue">{formatMoney(agents.totals.revenueCents)}</Metric><Metric label="Service penalties">{formatMoney(agents.totals.penaltyCents)}</Metric></Metrics>
      {awaiting.length > 0 && <div className="agent-approval-queue"><h3 className="subsection-heading">Approval queue · {awaiting.length}</h3>{awaiting.map(current => <AgentJobRow key={current.job.id} {...props} current={current} />)}</div>}
      {running.length > 0 && <div className="project-list">{running.map(current => <AgentJobRow key={current.job.id} {...props} current={current} />)}</div>}
      <details className="inline-details" open={!jobs.length || undefined}><summary>Support order board</summary><p className="small-note">You can accept each order once. New orders arrive every four weeks. Next refresh: Week {agents.nextCycleWeek}. Agent work shares your serving allocation and connected memory.</p><AgentOrderForm {...props} agents={agents} /></details>
      {agents.codingOrders.length > 0 && <details className="inline-details"><summary>Coding order board</summary><p className="small-note">New coding jobs arrive every four weeks. Smoke tests use serving compute and catch basic problems; a patch can pass them and still miss the customer’s request. Independent checks, permission to publish, and the customer audit are separate steps.</p><AgentOrderForm {...props} agents={agents} coding /></details>}
      <AgentRecoverySystem {...props} />
      {finished.length > 0 && <details className="inline-details"><summary>Completed and stopped jobs · {finished.length}</summary>{finished.map(current => <AgentJobRow key={current.job.id} {...props} current={current} />)}</details>}
      {(invoices.length > 0 || receipts.length > 0) && <details className="inline-details"><summary>Invoices and action receipts</summary>{invoices.slice(0, 6).map(invoice => <div className="receipt-row" key={invoice.id}><strong>Week {invoice.week} · {formatMoney(invoice.amountCents)}</strong><span className="table-subline">{invoice.basis === 'verified-outcome' ? 'Verified outcome' : 'Reviewed draft'} · {invoice.caseCount} cases</span></div>)}{receipts.slice(0, 6).map(receipt => <div className="receipt-row" key={receipt.id}><strong>Week {receipt.week} · {TOOL_NAME[receipt.tool]}</strong><span className="table-subline">{receipt.caseCount} cases · authorized by {receipt.authorizedBy === 'human' ? 'human decision' : 'bounded policy'}</span><span className="record-id">{receipt.id}</span></div>)}</details>}
    </> : <p className="small-note">Research Defined workflows (R9) to accept support work. It follows evaluation and retrieval, then uses an evaluated model, explicit tools, and bounded work.</p>}
    <details className="inline-details"><summary>Review and autonomy methods</summary><p className="small-note">{agents.independentUnlocked ? 'Independent verification (R10) is available.' : 'Research Outcome verification (R10) to add independent checks and outcome billing.'} {agents.boundedUnlocked ? 'Bounded autonomy (R11) is available.' : 'Research Bounded agents (R11) to let agents choose actions within the permissions you set.'}</p><p className="small-note">Support jobs, coding jobs, and their actions run inside the game. Permissions limit what an agent can do, but it can still make mistakes.</p></details>
  </Section>;
}
