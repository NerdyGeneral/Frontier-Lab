'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { AgentJob } from '../contracts/wave3-agents';
import { formatUnits } from '../core/math';
import { AGENT_RECOVERY } from '../content/wave7-agents';
import { agentRecoveryBlock, agentRecoveryRequirements } from '../modules/agents';
import { systemRollout } from '../modules/applied-research';
import { hasResearch } from '../modules/research';
import { ActionControl, Metric, Metrics, parseFixed, parseWhole } from './components';
import type { PanelProps } from './panels';
type AgentControlProps = Pick<PanelProps, 'game' | 'canAct' | 'onQueue'>;

export function AgentRecoverySystem({ game, canAct, onQueue }: AgentControlProps) {
  const researched = hasResearch(game, game.playerCompanyId, AGENT_RECOVERY.research);
  const rollout = systemRollout(game, game.playerCompanyId, 'action-receipts');
  return <details className="inline-details"><summary>Recover interrupted jobs</summary>
    <p className="small-note">Completed customer actions are recorded so they cannot happen twice. Research and install Action receipts (R9A) to continue a paused job or one stopped by its budget. Recovery uses compute, counts earlier work toward the total limits, and allows up to two restarts.</p>
    {!researched ? <p className="small-note">Complete R9A in Research to prepare the recovery system.</p> : !rollout ? <ActionControl game={game} payload={{ kind: 'start_system_rollout', method: 'action-receipts' }} label="Install job recovery" canAct={canAct} onQueue={onQueue} /> : rollout.status !== 'active' ? <><Metrics><Metric label="Design setup work">{formatWorkPoints(rollout.completedStaff)} / {formatWorkPoints(rollout.requiredStaff)} points</Metric><Metric label="Development work">{formatUnits(rollout.completedWork)} / {formatUnits(rollout.requiredWork)} CUw</Metric>{rollout.readyWeek !== null && <Metric label="Activation">Week {rollout.readyWeek}</Metric>}</Metrics><p className="bottleneck">{rollout.lastBottleneck}</p></> : <p className="small-note">Job recovery is installed. Pause an unfinished job, or open one stopped by a work or step limit. You can also resume a paused job without using recovery.</p>}
    <p className="small-note">Recovery keeps the model, permissions, test results, retry limit, and customer terms. Earlier work stays spent, but there is no new order fee. Completed actions and payments cannot repeat. Reopening a failed job moves its customer outcome back to pending; the failed attempt remains in its history.</p>
  </details>;
}

export function AgentRecoveryControl({ game, canAct, onQueue, job }: AgentControlProps & { job: AgentJob }) {
  const needs = agentRecoveryRequirements(job);
  const [steps, setSteps] = useState(String(Math.min(24, Math.max(needs.minimumSteps, job.steps + 10))));
  const [budget, setBudget] = useState(String(Math.min(32, Math.ceil(Math.max(needs.minimumBudget, job.configuration.workBudget + U) / (U / 100)) / 100)));
  if (systemRollout(game, game.playerCompanyId, 'action-receipts')?.status !== 'active' || agentRecoveryBlock(job)) return null;
  const maxSteps = parseWhole(steps), workBudget = parseFixed(budget, 9);
  const payload = maxSteps !== null && workBudget !== null ? { kind: 'recover_agent_job' as const, jobId: job.id, maxSteps, workBudget } : null;
  return <details className="inline-details"><summary>Restart from saved progress</summary>
    <p className="small-note">Restart {(job.recovery?.generation ?? 0) + 1} of {AGENT_RECOVERY.maximumHandoffs}. Recovery uses {formatUnits(needs.recoveryWork)} serving CUw, needs {formatUnits(needs.memory)} connected MU, and one step before returning to the saved {job.stage} stage.</p>
    <label className="line-control" htmlFor={job.id + '-recovery-steps'}>Total step limit<input id={job.id + '-recovery-steps'} type="number" min={needs.minimumSteps} max="24" step="1" value={steps} onChange={event => setSteps(event.target.value)} disabled={!canAct} /></label>
    <label className="line-control" htmlFor={job.id + '-recovery-budget'}>Total work budget<span className="unit-input"><input id={job.id + '-recovery-budget'} type="number" min={needs.minimumBudget / U} max="32" step="0.01" value={budget} onChange={event => setBudget(event.target.value)} disabled={!canAct} /><span>CUw</span></span></label>
    <p className="small-note">The limits include the {job.steps} completed steps and {formatUnits(job.spentWork)} CUw already spent. Set limits of at least {needs.minimumSteps} total steps and {formatUnits(needs.minimumBudget)} CUw to keep the original allowance and cover recovery and the saved stage{job.stage === 'action' ? ' plus its mandatory audit' : ''}. You pay for work as it runs. Leave room for later stages and retries.</p>
    <ActionControl game={game} payload={payload} label="Restart this job" canAct={canAct} onQueue={onQueue} />
  </details>;
}
