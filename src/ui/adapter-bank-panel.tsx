'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { ADAPTER_BANK_RULES } from '../content/wave7-adapters';
import { SYSTEM_RULES } from '../content/wave4-research';
import { formatUnits } from '../core/math';
import { getAdapterBankView } from '../modules/adapter-bank';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

export function AdapterBankPanel({ game, canAct, onQueue }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'>) {
  const bank = getAdapterBankView(game), rule = SYSTEM_RULES['adapter-bank'];
  if (!bank.researched && !bank.rollout && !bank.groups.length) return null;
  const status = bank.available ? 'Installed' : bank.rollout?.status === 'ready' ? 'Available next week' : bank.rollout ? 'Installing' : 'Ready to install';
  return <details className="inline-details" id="adapter-bank">
    <summary>Adapter bank · {status}</summary>
    <p className="small-note">Train several specialist adapters from one unchanged dense model. Public products on the same GPU pool can share that base model, using an extra {formatUnits(ADAPTER_BANK_RULES.adapterMemoryMU)} MU for each adapter.</p>
    {!bank.rollout && <>
      <Metrics><Metric label="Design installation effort">{formatWorkPoints(rule.staff)} points</Metric><Metric label="Development installation work">{formatUnits(rule.work)} CUw</Metric></Metrics>
      <ActionControl game={game} payload={{ kind: 'start_system_rollout', method: 'adapter-bank' }} label="Install adapter bank" canAct={canAct} onQueue={onQueue} />
    </>}
    {bank.rollout && bank.rollout.status !== 'active' && <>
      <Metrics><Metric label="Design installation effort">{formatWorkPoints(bank.rollout.completedStaff)} / {formatWorkPoints(bank.rollout.requiredStaff)} points</Metric><Metric label="Development installation work">{formatUnits(bank.rollout.completedWork)} / {formatUnits(bank.rollout.requiredWork)} CUw</Metric>{bank.rollout.readyWeek !== null && <Metric label="Available from">Week {bank.rollout.readyWeek}</Metric>}</Metrics>
      {bank.rollout.lastBottleneck && <p className="bottleneck">{bank.rollout.lastBottleneck}</p>}
    </>}
    {bank.available && <p className="small-note">In the <a href="#lab-projects">Lab</a>, select a dense adaptation recipe and enable “Train as an adapter.” Test each finished model before release. The licenses for its training data and base model still apply.</p>}
    {bank.available && !bank.groups.length && <p className="empty-note">No adapters finished yet. Saved models use GPU memory only while a job or product is using them.</p>}
    {bank.groups.map(group => <div className="checkpoint-row" key={group.baseModelId}>
      <p className="small-heading">{group.baseName}<span className="status-inline">Frozen base · {formatUnits(group.baseMemoryMU)} MU</span></p>
      <div className="table-scroll"><table className="compact-table"><thead><tr><th>Adapter</th><th>Test results</th><th>Active public products</th></tr></thead><tbody>{group.adapters.map(model => <tr key={model.id}>
        <td>{model.name}<span className="table-subline">{model.hosted ? 'Hosted use allowed' : 'Hosted use restricted'} · {model.weights ? 'Weight license allowed' : 'Weight license restricted'}</span></td>
        <td>{model.evaluated ? 'Evaluated' : 'Evaluation required'}</td>
        <td>{model.activeProducts.join(', ') || 'None in this bank'}</td>
      </tr>)}</tbody></table></div>
      {group.activeProducts > 0 && <>
        <Metrics><Metric label="Separate product weight copies">{formatUnits(group.independentMemoryMU)} MU</Metric><Metric label="Weights if these products share one pool">{formatUnits(group.sharedMemoryMU)} MU</Metric></Metrics>
        <p className="small-note">A second GPU pool needs its own copy of the base model. Open Compute to see memory use after placement.</p>
      </>}
    </div>)}
    <p className="small-note">Customer requests, spare capacity, conversation memory, caches, and document indexes still use their usual resources. Training and testing need a full workspace. Private deployments, alternate model formats, and routed model pairs each need their own model memory. Build new adapters from an original dense model; one adapter cannot be the base for another.</p>
  </details>;
}
