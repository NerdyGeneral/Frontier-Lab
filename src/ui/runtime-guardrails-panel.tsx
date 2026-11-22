'use client';

import { formatWorkPoints } from '../modules/workforce-points';
import { useState } from 'react';
import type { RuntimeGuardrailInstallation, RuntimeGuardrailProfile } from '../contracts/wave12-guardrails';
import { RUNTIME_GUARDRAIL_PROFILES as PROFILES, RUNTIME_GUARDRAIL_RULES as RULES } from '../content/wave12-guardrails';
import { formatUnits } from '../core/math';
import { getRuntimeGuardrailView } from '../modules/runtime-guardrails';
import { ActionControl, Metric, Metrics } from './components';
import type { PanelProps } from './panels';

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';

function AuditReport({ installation, game }: { installation: RuntimeGuardrailInstallation } & Pick<PanelProps, 'game'>) {
  const audit = installation.audit;
  if (!audit) return null;
  const name = (id: string) => game.slices.models.versions[id]?.name ?? id;
  return <div className="system-application">
    <p className="small-heading">{PROFILES[installation.profile].name} audit · Week {installation.availableWeek}</p>
    <p className="small-note">{name(installation.binding.primary.modelId)}{installation.binding.secondary ? ' + ' + name(installation.binding.secondary.modelId) : ''}. Compares the same 50 allowed and 50 restricted requests with and without the checker.</p>
    <div className="table-scroll"><table className="compact-table"><thead><tr><th>Test cases</th><th>Model only</th><th>With checker</th></tr></thead><tbody>
      <tr><td>Useful allowed answers / 50</td><td>{audit.baseline.usefulAnswers}</td><td>{audit.guarded.usefulAnswers}</td></tr>
      <tr><td>False refusals / 50 allowed</td><td>{audit.baseline.falseRefusals}</td><td>{audit.guarded.falseRefusals}</td></tr>
      <tr><td>Confident errors / 50 allowed</td><td>{audit.baseline.confidentErrors}</td><td>{audit.guarded.confidentErrors}</td></tr>
      <tr><td>Clarifications / 50 allowed</td><td>{audit.baseline.clarifications}</td><td>{audit.guarded.clarifications}</td></tr>
      <tr><td>Correct restricted refusals / 50</td><td>{audit.baseline.correctPolicyRefusals}</td><td>{audit.guarded.correctPolicyRefusals}</td></tr>
      <tr><td>Restricted requests answered / 50</td><td>{audit.baseline.unsafeCompliances}</td><td>{audit.guarded.unsafeCompliances}</td></tr>
    </tbody></table></div>
    <details className="inline-details"><summary>Audit setup and costs</summary>
      <Metrics>
        <Metric label="Primary / routed cases">{audit.primaryCases} / {audit.secondaryCases}</Metric>
        <Metric label="Development work paid">{formatUnits(installation.completedWork)} CUw</Metric>
        <Metric label="Physical GPU work paid">{formatUnits(installation.physicalWork)} CUw</Metric>
        <Metric label="Design staff work paid">{formatWorkPoints(installation.completedStaff)} points</Metric>
        <Metric label="Audit model work / with checker">{formatUnits(audit.baselineStandardWorkCUw)} / {formatUnits(audit.guardedStandardWorkCUw)} CUw</Metric>
      </Metrics>
      <p className="small-note">Setup includes this audit. The last row estimates compute for 100 standard requests with the selected models and features. It includes routing costs before cache savings and is not an extra setup charge. Both routed models need their own paid capability and policy tests.</p>
      <p className="small-note">The test cases stay the same across profiles, models, and repeated setups. Passing them does not guarantee every live response. The checker does not retrain either model.</p>
    </details>
  </div>;
}

export function RuntimeGuardrailsPanel({ productId, ...props }: PanelProps & { productId: string }) {
  const { game, canAct, onQueue } = props;
  const view = getRuntimeGuardrailView(game, productId);
  const [profile, setProfile] = useState<RuntimeGuardrailProfile>('balanced');
  const [inspectionId, setInspectionId] = useState('');
  const history = Object.values(game.slices.products.runtimeGuardrails ?? {}).filter(item => item.productId === productId)
    .sort((a, b) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id));
  if (!view.researched && !history.length) return null;
  const rule = PROFILES[profile], installed = view.installation, pending = view.pending;
  const audits = history.filter(item => item.audit);
  const inspected = audits.find(item => item.id === inspectionId) ?? audits[0];
  const usage = view.usage;
  return <details className="inline-details"><summary>Runtime guardrails</summary>
    <p className="small-note">Check responses before they reach customers. Stricter settings catch more restricted answers in policy tests, but also block more valid answers. Every check uses GPU work.</p>
    <p className={installed && !view.capturedInputsMatch && installed.status === 'active' ? 'bottleneck' : 'small-note'} role="status">{view.status}</p>
    {installed?.status === 'active' && <>
      <Metrics><Metric label="Installed profile">{PROFILES[installed.profile].name}</Metric><Metric label="Checker status">{view.active ? 'Checking responses' : !view.capturedInputsMatch ? 'Setup changed' : installed.enabled ? 'Product offline' : 'Disabled'}</Metric></Metrics>
      <ActionControl game={game} payload={{ kind: 'set_runtime_guardrail_enabled', productId, enabled: !installed.enabled }} label={installed.enabled ? 'Disable runtime guardrails' : 'Enable runtime guardrails'} canAct={canAct} onQueue={onQueue} compact />
    </>}
    {pending && <div className="system-application">
      <p className="small-heading">{PROFILES[pending.profile].name} rollout<span className="status-inline">{pending.status === 'ready' ? 'Available Week ' + pending.availableWeek : 'Building'}</span></p>
      <Metrics><Metric label="Development work">{formatUnits(pending.completedWork)} / {formatUnits(pending.requiredWork)} CUw</Metric><Metric label="Design implementation">{formatWorkPoints(pending.completedStaff)} / {formatWorkPoints(pending.requiredStaff)} points</Metric><Metric label="Separate rollout memory">{formatUnits(pending.memoryMU)} MU</Metric></Metrics>
      <p className="small-note" role="status">{pending.lastBottleneck}</p>
      {view.active && <p className="small-note">The current checker stays active until its replacement is ready.</p>}
    </div>}
    {!pending && <>
      <label className="line-control wide-select" htmlFor={productId + '-guardrail-profile'}>Guardrail profile<select id={productId + '-guardrail-profile'} value={profile} onChange={event => setProfile(event.target.value as RuntimeGuardrailProfile)} disabled={!canAct}>
        <option value="balanced">Balanced</option><option value="strict">Strict</option>
      </select></label>
      <Metrics><Metric label="Added work / 1,000 requests">{formatUnits(rule.workPerRequestCUw * 1000)} CUw</Metric><Metric label="Extra resident memory">{formatUnits(rule.memoryMU)} MU</Metric><Metric label="Restricted answers caught">{percent(rule.unsafeCatchBps)}</Metric><Metric label="Useful answers blocked">{percent(rule.allowedBlockBps)}</Metric></Metrics>
      <ActionControl game={game} payload={{ kind: 'install_runtime_guardrail', productId, profile }} label="Install and audit guardrails" canAct={canAct} onQueue={onQueue} />
      <p className="small-note">Setup and testing need {formatUnits(RULES.requiredWork)} development CUw and {formatWorkPoints(RULES.requiredStaff)} Design points, at most 1 CUw and 20 Design points per week. The checker activates at the start of the following week. See its test results below.</p>
    </>}
    {usage && <div className="usage-summary"><p className="small-heading">Live checking · Week {view.usageWeek}</p>
      <Metrics><Metric label="Completed checks">{usage.checkedRequests.toLocaleString('en-US')}</Metric><Metric label="Uncompleted requested checks">{usage.uncheckedRequests.toLocaleString('en-US')}</Metric><Metric label="Effective checking work">{formatUnits(usage.checkWorkCUw)} CUw</Metric><Metric label="Extra chance of refusing valid work">{percent(usage.addedFalseRefusalBps)}</Metric><Metric label="Additional false refusals">{usage.additionalFalseRefusals.toLocaleString('en-US')}</Metric></Metrics>
      <p className="small-note">Checks are included in serving compute and GPU running costs. You cannot charge customers extra tokens for them. If compute runs short, fewer requests finish, reducing API revenue or creating subscription credits.</p>
    </div>}
    {inspected && <>
      {audits.length > 1 && <label className="line-control wide-select" htmlFor={productId + '-guardrail-audit'}>Inspect guardrail audit<select id={productId + '-guardrail-audit'} value={inspected.id} onChange={event => setInspectionId(event.target.value)}>
        {audits.map(item => <option key={item.id} value={item.id}>{PROFILES[item.profile].name} · Week {item.availableWeek}</option>)}
      </select></label>}
      <AuditReport installation={inspected} game={game} />
    </>}
    <details className="inline-details"><summary>What the checker covers</summary>
      <p className="small-note">Regular Chat and API customers make allowed requests. Blocking valid answers can make customers leave or give negative feedback. Restricted requests appear in the separate policy audit. Correctly refusing those requests does not create ordinary negative feedback.</p>
      <p className="small-note">The audit covers the main model, routed model, and conversation options you tested. Changing any of them disables the checker until you pay for a new setup and audit. Replacing a model also needs a fresh audit. Disabling the checker frees its compute and memory next week.</p>
      <p className="small-note">Changing the checker means you need a new release comparison. Preparing a release locks these settings until you finish or discard it. The model still needs its own capability and policy tests. This checker does not grant agent permissions or cover downloaded models and private contracts. You can keep up to {RULES.maximumPerProduct} paid setups per product and {RULES.maximumHistory} in total.</p>
    </details>
  </details>;
}
