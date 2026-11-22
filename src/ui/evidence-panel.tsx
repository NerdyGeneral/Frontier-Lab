'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { EVIDENCE_LINKS } from '../content/wave6-evidence';
import { formatUnits } from '../core/math';
import { getEvidenceCheckView } from '../modules/retrieval-evidence';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const count = (value: number) => value.toLocaleString('en-US');

export function EvidencePanel({ game, canAct, onQueue, productId }: PanelProps & { productId: string }) {
  const view = getEvidenceCheckView(game, productId), installation = view.installation, usage = view.usage;
  const needsRollout = !installation || installation.status === 'active' && !view.capturedInputsMatch;
  return <details className="inline-details"><summary>Evidence links and withheld answers</summary>
    <p className="small-note">Check answers against this product’s documents. If the sources do not support an answer, the model asks for clarification or withholds it. A citation can still be wrong, and these checks do not improve the model itself.</p>
    <p className="small-note">{view.status}</p>
    {!view.researched ? <p className="planned-note">Research Evidence links (R6A), then install the checker for an active document index.</p> : <>
      {needsRollout && <ActionControl game={game} payload={{ kind: 'install_product_efficiency', productId, method: 'evidence-links' }} label={installation ? 'Rebuild checker for this model and data' : 'Install evidence checks'} canAct={canAct} onQueue={onQueue} />}
      {installation && <>
        <Metrics>
          <Metric label="Checker status">{installation.status === 'active' ? view.active ? 'Active' : view.capturedInputsMatch ? 'Disabled' : 'Inputs changed' : installation.status}</Metric>
          {installation.status !== 'active' && <>
            <Metric label="Design implementation effort">{formatWorkPoints(installation.completedStaff)} / {formatWorkPoints(installation.requiredStaff)} points</Metric>
            <Metric label="Development work">{formatUnits(installation.completedWork)} / {formatUnits(installation.requiredWork)} CUw</Metric>
            {installation.readyWeek !== null && <Metric label="Activation">Week {installation.readyWeek}</Metric>}
          </>}
          <Metric label="Model used">{game.slices.models.versions[installation.modelId]?.name ?? installation.modelId}</Metric>
          <Metric label="Source data used">{game.slices.data.packets[installation.evidencePacketId ?? '']?.name ?? 'No document index'}</Metric>
        </Metrics>
        {installation.lastBottleneck && <p className="bottleneck">{installation.lastBottleneck}</p>}
        {installation.status === 'active' && view.capturedInputsMatch && <ActionControl game={game} payload={{ kind: 'set_product_efficiency_enabled', productId, method: 'evidence-links', enabled: !installation.enabled }} label={installation.enabled ? 'Disable evidence checks' : 'Enable evidence checks'} canAct={canAct} onQueue={onQueue} />}
      </>}
    </>}
    {usage && <div className="usage-block"><p className="small-heading">Citation checks · Week {view.usageWeek}</p><Metrics>
      <Metric label="Fully checked queries">{count(usage.checkedRequests)}</Metric>
      <Metric label="Supported by the index">{count(usage.supportedRequests)}</Metric>
      <Metric label="Withheld / clarification">{count(usage.withheldRequests)}</Metric>
      <Metric label="Requests not fully checked">{count(usage.uncheckedRequests)}</Metric>
      <Metric label="Checking work within service">{formatUnits(usage.checkWorkCUw)} CUw</Metric>
      <Metric label="Source freshness when checked">{percent(usage.freshnessBps)}</Metric>
      <Metric label="Estimated source support">{percent(usage.supportBps)}</Metric>
    </Metrics><p className="small-note">Only completed requests count here. The checking work is already included in this product’s compute use and GPU bill.</p></div>}
    <details className="inline-details"><summary>Checking costs and customer tradeoffs</summary>
      <p className="small-note">Installation requires 20 Design points and one development CUw. Each enabled query then adds 0.00002 CUw after routing and caching. Data upkeep, model inference, session memory, and index memory still apply.</p>
      <p className="small-note">Support depends on the installed evidence’s quality, document coverage, and actual upkeep freshness. Withholding reduces confidently wrong outputs but also leaves customers without answers. It adds up to {EVIDENCE_LINKS.maximumWithheldChurnBps / 100} percentage points of customer loss at renewal, scaled by the withheld share. A good trust week needs at least {EVIDENCE_LINKS.trustSupportFloorBps / 100}% of completed checks to have source support, alongside the normal service and reliability checks.</p>
      <p className="small-note">Completed subscription requests are billed under the product’s terms, including requests that end in clarification. Unsupported answers earn no extra success payment. Replacing the model or document index means installing a new checker. Existing private deployments and customer-hosted licenses keep their agreed terms.</p>
    </details>
  </details>;
}
