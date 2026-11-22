'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import { RELEASE_REHEARSAL_RULES as RULES, RELEASE_REHEARSAL_SCOPE } from '../content/wave9-rehearsals';
import type { ReleaseRehearsal } from '../contracts/wave9-rehearsals';
import { formatMoney, formatUnits } from '../core/math';
import { facilityRetrofitResearchReady } from '../modules/facility-retrofits';
import { getQualifiedReleaseRehearsal, rehearsalTariffEstimateCents, releaseCandidateReason } from '../modules/release-rehearsals';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

function RehearsalReport({ rehearsal, game, canAct, onQueue }: Pick<PanelProps, 'game' | 'canAct' | 'onQueue'> & { rehearsal: ReleaseRehearsal }) {
  const name = (id: string) => game.slices.models.versions[id]?.name ?? id;
  const available = rehearsal.status === 'complete', qualified = available && getQualifiedReleaseRehearsal(game, rehearsal.productId, rehearsal.candidateModelId)?.id === rehearsal.id;
  return <div className="system-application">
    <p className="small-heading">{name(rehearsal.sourceModelId)} → {name(rehearsal.candidateModelId)}<span className="status-inline">{available ? 'Reviewed' : rehearsal.status === 'ready' ? 'Available Week ' + rehearsal.availableWeek : rehearsal.paused ? 'Paused' : 'Comparing'}</span></p>
    <Metrics>
      <Metric label="Design review">{formatWorkPoints(rehearsal.completedStaff)} / {formatWorkPoints(rehearsal.requiredStaff)} points</Metric>
      <Metric label="Started">Week {rehearsal.startedWeek}</Metric>
    </Metrics>
    <div className="table-scroll"><table className="compact-table"><thead><tr><th>Same standard workload</th><th>Source model</th><th>New model</th></tr></thead><tbody>
      <tr><td>Development work / required</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{formatUnits(rehearsal.arms[key].completedWork)} / {formatUnits(rehearsal.arms[key].requiredWork)} CUw</td>)}</tr>
      <tr><td>Separate resident workspace</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{formatUnits(rehearsal.arms[key].memoryMU)} MU</td>)}</tr>
      <tr><td>Actual physical GPU work</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{formatUnits(rehearsal.arms[key].physicalWork)} CUw</td>)}</tr>
      <tr><td>Estimated GPU cost</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{formatMoney(rehearsalTariffEstimateCents(rehearsal.arms[key]))}</td>)}</tr>
      {available && <>
        <tr><td>Useful answers / {RULES.cases}</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{rehearsal.arms[key].outcomes!.useful}</td>)}</tr>
        <tr><td>Confident errors</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{rehearsal.arms[key].outcomes!.confidentError}</td>)}</tr>
        <tr><td>False refusals</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{rehearsal.arms[key].outcomes!.falseRefusal}</td>)}</tr>
        <tr><td>Clarification / uncertainty</td>{(['source', 'candidate'] as const).map(key => <td key={key}>{rehearsal.arms[key].outcomes!.clarification}</td>)}</tr>
      </>}
    </tbody></table></div>
    <p className="small-note">GPU work shows what each model used. The cost estimate includes its share of cloud rent or owned-GPU running costs, before staff pay and shared site costs. Find the final charges in <a href="#compute-costs">Compute cost accounting</a> under Development work.</p>
    {available ? <p className="small-note">{qualified ? 'This comparison qualifies the new model for release preparation with the current product settings.' : 'This older comparison no longer qualifies for a new release. A model, product setting, or hosting requirement has changed.'} These are test results; live results may differ.</p>
      : <><p className="small-note" role="status">{rehearsal.lastBottleneck}</p>{rehearsal.status === 'running' && <ActionControl game={game} payload={{ kind: 'set_release_rehearsal_paused', rehearsalId: rehearsal.id, paused: !rehearsal.paused }} label={rehearsal.paused ? 'Resume model comparison' : 'Pause model comparison'} canAct={canAct} onQueue={onQueue} compact />}</>}
  </div>;
}

export function ReleaseRehearsalPanel({ productId, ...props }: PanelProps & { productId: string }) {
  const { game, canAct, onQueue } = props, product = game.slices.products.offers[productId];
  const history = Object.values(game.slices.products.releaseRehearsals ?? {}).filter(item => item.productId === productId)
    .sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
  const candidates = Object.values(game.slices.models.versions).filter(model => !releaseCandidateReason(game, game.playerCompanyId, productId, model.id));
  const [candidateId, setCandidateId] = useState('');
  const candidate = candidates.find(model => model.id === candidateId) ?? candidates[0];
  if (!product || (!facilityRetrofitResearchReady(game, game.playerCompanyId) && !history.length)) return null;
  return <details className="inline-details"><summary>Rehearse a model release</summary>
    <p className="small-note">Test a new model before preparing its launch. Customers keep using the current model while the comparison uses shared development compute and ML staff.</p>
    <p className="small-note">{RELEASE_REHEARSAL_SCOPE}</p>
    {!history.some(item => item.status !== 'complete') && <>
      <label className="line-control wide-select" htmlFor={productId + '-rehearsal-candidate'}>New model<select id={productId + '-rehearsal-candidate'} value={candidate?.id ?? ''} onChange={event => setCandidateId(event.target.value)} disabled={!canAct || !candidates.length}>
        {!candidates.length && <option value="">Choose a tested model with hosting rights</option>}
        {candidates.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
      </select></label>
      <ActionControl game={game} payload={candidate ? { kind: 'start_release_rehearsal', productId, candidateModelId: candidate.id } : null} label="Compare models" canAct={canAct} onQueue={onQueue} emptyReason="The new model needs its own capability test, hosted-use rights, and enough connected memory. It must also meet this product’s launch requirements." />
    </>}
    {history.map(rehearsal => <RehearsalReport {...props} rehearsal={rehearsal} key={rehearsal.id} />)}
    <p className="small-note">Uses 20 Design points and compute for both models. Pausing keeps your progress. Every comparison uses the same cases, even after renaming a model or restarting. You can keep up to {RULES.maximumPerProduct} comparisons per product. Old results no longer used by a release are replaced when space is needed.</p>
  </details>;
}
