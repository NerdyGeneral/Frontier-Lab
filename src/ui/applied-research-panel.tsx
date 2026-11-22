'use client';

import { formatWorkPoints, workUnitsToPoints, WORK_POINTS_PER_UNIT } from '../modules/workforce-points';
import { useState } from 'react';
import type { CommandPayload } from '../contracts/types';
import type { AppliedResearchView, ModelApplicationRun, ModelVariantKind, ProductEfficiencyInstall, SystemRollout, SystemRolloutKind } from '../contracts/wave4-research';
import { CONTENT } from '../content/catalog';
import { ASSISTANCE, EFFICIENCY_RULES, PREFIX_CACHE, ROUTING, SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import { formatUnits } from '../core/index';
import { getAppliedResearchView } from '../modules/applied-research';
import { getProductEfficiencyView } from '../modules/product-efficiency';
import { ActionControl, Metric, Metrics, parseFixed, Section } from './components';
import type { PanelProps } from './panels';
import { AdapterBankPanel } from './adapter-bank-panel';

const percent = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const MODEL_LABELS = { compression: 'Compressed deployment', 'memory-format': 'Compact memory format' };

function VariantForm({ game, canAct, onQueue, applied }: PanelProps & { applied: AppliedResearchView }) {
  const evaluatedIds = new Set(applied.teachers.map(model => model.id));
  const models = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId && !model.runtimeVariant && evaluatedIds.has(model.id));
  const [modelId, setModelId] = useState(models[models.length - 1]?.id ?? '');
  const [kind, setKind] = useState<ModelVariantKind>('compression');
  const model = models.find(item => item.id === modelId) ?? models[models.length - 1];
  const variant = kind === 'memory-format' && !applied.available.memoryFormat ? 'compression' : kind;
  const rule = VARIANT_RULES[variant];
  return <div>
    <label className="line-control wide-select" htmlFor="variant-source">Source model<select id="variant-source" value={model?.id ?? ''} onChange={event => setModelId(event.target.value)} disabled={!canAct || !models.length}>{!models.length && <option value="">Evaluate a source model first</option>}{models.map(item => <option key={item.id} value={item.id}>{item.name} · {item.family}</option>)}</select></label>
    <label className="line-control wide-select" htmlFor="variant-method">Deployment format<select id="variant-method" value={variant} onChange={event => setKind(event.target.value as ModelVariantKind)} disabled={!canAct}><option value="compression">Compressed deployment</option>{applied.available.memoryFormat && <option value="memory-format">Compact memory format</option>}</select></label>
    <Metrics><Metric label="Serving work versus original">{percent(rule.servingWorkBps)}</Metric><Metric label="Model memory versus original">{percent(rule.memoryBps)}</Metric><Metric label="Task-score penalty">{rule.scorePenaltyBps / 100} points</Metric><Metric label="Design application work">{formatWorkPoints(rule.staff)} points</Metric><Metric label="Development work">{formatUnits(rule.work)} CUw</Metric></Metrics>
    <ActionControl game={game} payload={model ? { kind: 'create_model_variant', modelId: model.id, variant } : null} label="Create deployment variant" canAct={canAct} onQueue={onQueue} />
    <p className="small-note">This creates a separate model version. Test it before release. Use the original model for any later training.</p>
  </div>;
}

function ApplicationRow({ game, canAct, onQueue, application }: PanelProps & { application: ModelApplicationRun }) {
  const source = game.slices.models.versions[application.sourceModelId];
  const output = game.slices.models.versions[application.outputModelId];
  return <article className="project-row" aria-label={MODEL_LABELS[application.variant] + ' of ' + (source?.name ?? 'model')}>
    <div className="project-heading"><strong>{MODEL_LABELS[application.variant]}</strong><span>{application.status === 'paused' ? 'Paused' : application.status === 'complete' ? 'Ready to evaluate' : 'Applying'}</span></div>
    <p className="small-note">{source?.name ?? 'Original model'}{output ? ' → ' + output.name : ''}</p>
    <Metrics><Metric label="Design application effort">{formatWorkPoints(application.completedStaff)} / {formatWorkPoints(application.requiredStaff)} points</Metric><Metric label="Development work">{formatUnits(application.completedWork)} / {formatUnits(application.requiredWork)} CUw</Metric><Metric label="Physical GPU work">{formatUnits(application.physicalWork)} CUw</Metric></Metrics>
    {application.lastBottleneck && <p className="bottleneck">{application.lastBottleneck}</p>}
    {application.status !== 'complete' && <ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: application.id, paused: application.status !== 'paused' }} label={(application.status === 'paused' ? 'Resume ' : 'Pause ') + MODEL_LABELS[application.variant].toLowerCase()} canAct={canAct} onQueue={onQueue} compact />}
  </article>;
}

function RolloutStatus({ rollout }: { rollout: SystemRollout | ProductEfficiencyInstall }) {
  return <div className="rollout-status">
    <Metrics><Metric label="Design installation work">{formatWorkPoints(rollout.completedStaff)} / {formatWorkPoints(rollout.requiredStaff)} points</Metric><Metric label="Development compute">{formatUnits(rollout.completedWork)} / {formatUnits(rollout.requiredWork)} CUw</Metric>{rollout.readyWeek !== null && <Metric label="Available from">Week {rollout.readyWeek}</Metric>}</Metrics>
    {rollout.lastBottleneck && <p className="bottleneck">{rollout.lastBottleneck}</p>}
  </div>;
}

function SystemApplication({ game, view, canAct, onQueue, applied, method }: PanelProps & { applied: AppliedResearchView; method: SystemRolloutKind }) {
  const rollout = applied.rollouts.find(item => item.method === method);
  const rule = SYSTEM_RULES[method];
  return <div className="system-application">
    <p className="small-heading">{rule.name}<span className="status-inline">{rollout?.status === 'active' ? 'Installed' : rollout?.status === 'ready' ? 'Available next week' : rollout ? 'Installing' : 'Ready to apply'}</span></p>
    <p className="small-note">{method === 'run-supervisor' ? 'Manage larger training runs with predictable staffing needs based on familiar methods and rack groups. The training still needs GPUs to do the work.' : 'A tested model with coding and tool skills can help with research. It uses serving compute and commercial review staff, shared with your other projects.'}</p>
    {!rollout && <ActionControl game={game} payload={{ kind: 'start_system_rollout', method }} label={'Install ' + rule.name.toLowerCase()} canAct={canAct} onQueue={onQueue} />}
    {rollout && rollout.status !== 'active' && <RolloutStatus rollout={rollout} />}
    {method === 'research-assistant' && rollout?.status === 'active' && <AssistantForm game={game} view={view} canAct={canAct} onQueue={onQueue} applied={applied} />}
  </div>;
}

function AssistantForm({ game, canAct, onQueue, applied }: PanelProps & { applied: AppliedResearchView }) {
  const candidates = applied.teachers;
  const current = applied.assistant;
  const [modelId, setModelId] = useState(current?.modelId ?? candidates[candidates.length - 1]?.id ?? '');
  const [staff, setStaff] = useState(String(workUnitsToPoints(current?.maxAssistedFte ?? 1_000_000_000)));
  const model = candidates.find(item => item.id === modelId) ?? candidates[candidates.length - 1];
  const parsedPoints = parseFixed(staff, 9);
  const staffUnits = parsedPoints !== null && parsedPoints % WORK_POINTS_PER_UNIT === 0 ? parsedPoints / WORK_POINTS_PER_UNIT : null;
  const payload: CommandPayload | null = model && staffUnits !== null ? { kind: 'configure_research_assistant', modelId: model.id, maxAssistedFte: staffUnits, enabled: true } : null;
  return <div>
    <label className="line-control wide-select" htmlFor="research-assistant-model">Assistant model<select id="research-assistant-model" value={model?.id ?? ''} disabled={!canAct || !candidates.length} onChange={event => setModelId(event.target.value)}>{!candidates.length && <option value="">Evaluate a coding and tools model</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name} · coding {item.capabilityBps.coding / 100}, tools {item.capabilityBps.tools / 100}</option>)}</select></label>
    <label className="line-control" htmlFor="assistant-fte">Maximum Research points assisted<span className="unit-input"><input id="assistant-fte" type="number" min="5" max={workUnitsToPoints(ASSISTANCE.maximumFte)} step="5" value={staff} disabled={!canAct} onChange={event => setStaff(event.target.value)} /><span>points / week</span></span></label>
    <ActionControl game={game} payload={payload} label={current?.enabled ? 'Update research assistance' : 'Enable research assistance'} canAct={canAct} onQueue={onQueue} extraDisabled={!!current?.enabled && model?.id === current.modelId && staffUnits === current.maxAssistedFte} />
    <p className="small-note">Requires test scores of coding 65 and tools 60. For each 20 Research points assisted, it uses {formatUnits(ASSISTANCE.workPerFte)} serving CUw, adjusted for the model’s execution format, plus {formatWorkPoints(ASSISTANCE.reviewPerFte)} Business points for review. Successful assistance supplies up to {percent(ASSISTANCE.bonusBps)} extra staff progress on eligible research. The research itself still needs compute.</p>
    {current && <details className="inline-details"><summary>Assistance meter · Week {current.lastWeek}</summary><Metrics><Metric label="Status">{current.enabled ? 'Enabled' : 'Disabled'}</Metric><Metric label="Research points assisted">{formatWorkPoints(current.assistedStaff)} points</Metric><Metric label="Extra Research points">{formatWorkPoints(current.bonusStaff)} points</Metric><Metric label="Serving work / requested">{formatUnits(current.executedWork)} / {formatUnits(current.requestedWork)} CUw</Metric><Metric label="Physical GPU work">{formatUnits(current.physicalWork)} CUw</Metric><Metric label="Business review">{formatWorkPoints(current.reviewStaff)} points</Metric></Metrics>{current.lastBottleneck && <p className="bottleneck">{current.lastBottleneck}</p>}{current.enabled && <ActionControl game={game} payload={{ kind: 'configure_research_assistant', modelId: current.modelId, maxAssistedFte: current.maxAssistedFte, enabled: false }} label="Disable research assistance" canAct={canAct} onQueue={onQueue} compact />}</details>}
  </div>;
}

export function AppliedResearchPanel(props: PanelProps) {
  const { game } = props;
  const applied = getAppliedResearchView(game, game.playerCompanyId, CONTENT);
  const active = applied.applications.filter(application => application.status !== 'complete');
  if (!Object.values(applied.available).some(Boolean) && !applied.applications.length && !applied.rollouts.length) return null;
  return <Section title="Applied research" id="applied-research">
    <p className="small-note">Put your discoveries to work. Choose an upgrade and provide development compute. The team contributes points until the upgrade is ready.</p>
    <AdapterBankPanel {...props} />
    {active.length > 0 && <div className="project-list">{active.map(application => <ApplicationRow key={application.id} {...props} application={application} />)}</div>}
    {(applied.available.compression || applied.available.memoryFormat) && <details className="inline-details"><summary>Create a deployment variant</summary><VariantForm {...props} applied={applied} /></details>}
    {applied.variants.length > 0 && <details className="inline-details"><summary>Saved deployment variants · {applied.variants.length}</summary>{applied.variants.map(variant => <div className="checkpoint-row" key={variant.id}><p className="small-heading">{variant.name}</p><Metrics><Metric label="Source">{variant.sourceName}</Metric><Metric label="Serving work versus original">{percent(variant.servingWorkBps)}</Metric><Metric label="Resident weights">{formatUnits(variant.residentMU)} MU</Metric><Metric label="Capability evaluation">{variant.evaluated ? 'Completed' : 'Required before release'}</Metric></Metrics></div>)}</details>}
    {(applied.available.supervisor || applied.rollouts.some(item => item.method === 'run-supervisor')) && <details className="inline-details"><summary>Training supervision</summary><SystemApplication {...props} applied={applied} method="run-supervisor" /></details>}
    {(applied.available.assistant || applied.rollouts.some(item => item.method === 'research-assistant')) && <details className="inline-details"><summary>Research assistance</summary><SystemApplication {...props} applied={applied} method="research-assistant" /></details>}
    {(applied.available.distillation || applied.available.sparse) && <p className="small-note">{applied.available.distillation ? 'Distillation is available as a training recipe in the Lab. ' : ''}{applied.available.sparse ? 'Sparse architecture is available for new foundation runs; it needs connected fast fabric.' : ''}</p>}
    {applied.available.deduplication && <p className="small-note">Install deduplication and clean prepared revisions under <a href="#data">Data</a>.</p>}
    {applied.available.evidenceLinks && <p className="small-note">Install source-support checks beside <a href="#business-commitments">Business Documents and retrieval</a>.</p>}
    {applied.available.capacityForecast && <p className="small-note">Install the planning tool and compare twelve weeks of growth under <a href="#compute">Compute</a>.</p>}
    {applied.available.actionReceipts && <p className="small-note">Install action recovery and resume interrupted jobs under <a href="#agents">Agents</a>.</p>}
    {applied.available.independentHoldouts && <p className="small-note">Run the independent test after a capability test under <a href="#models">Models</a>.</p>}
    {applied.available.budgetedPlanner && <p className="small-note">Apply the budgeted planner curriculum to prepared behavior cases in the <a href="#lab-projects">Lab</a>.</p>}
    {(applied.available.routing || applied.available.prefixCache) && <p className="small-note">Apply routing and prefix caching under each live product’s Serving efficiency controls.</p>}
  </Section>;
}

export function ProductEfficiencyControls(props: PanelProps & { productId: string }) {
  const { game, productId, canAct, onQueue } = props;
  const applied = getAppliedResearchView(game, game.playerCompanyId, CONTENT);
  const efficiency = getProductEfficiencyView(game, productId);
  const product = game.slices.products.offers[productId];
  const model = product ? game.slices.models.versions[game.slices.products.deployments[product.deploymentId]?.modelId] : undefined;
  const candidates = applied.teachers.filter(item => item.id !== model?.id);
  const [secondaryId, setSecondaryId] = useState(efficiency.routing?.secondaryModelId ?? candidates[0]?.id ?? '');
  const secondary = candidates.find(item => item.id === secondaryId) ?? candidates[0];
  if (!model || (!applied.available.routing && !applied.available.prefixCache && !efficiency.routing && !efficiency.prefixCache)) return null;
  const routingCurrent = efficiency.routing?.modelId === model.id;
  const cacheCurrent = efficiency.prefixCache?.modelId === model.id;
  const routingForm = (suffix: string, label: string) => <><label className="line-control wide-select" htmlFor={productId + '-routing-' + suffix}>Secondary model<select id={productId + '-routing-' + suffix} value={secondary?.id ?? ''} onChange={event => setSecondaryId(event.target.value)} disabled={!canAct || !candidates.length}>{!candidates.length && <option value="">Evaluate a second model</option>}{candidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><ActionControl game={game} payload={secondary ? { kind: 'install_product_efficiency', productId, method: 'routing', secondaryModelId: secondary.id } : null} label={label} canAct={canAct} onQueue={onQueue} extraDisabled={routingCurrent && secondary?.id === efficiency.routing?.secondaryModelId} emptyReason="Evaluate a cheaper compatible second model before installing routing." /></>;
  return <details className="inline-details"><summary>Serving efficiency</summary>
    <p className="small-note">{efficiency.summary}</p>
    {(efficiency.routingActive || efficiency.cacheActive) && <Metrics><Metric label="Additional resident memory">{formatUnits(efficiency.additionalMemoryMU)} MU</Metric><Metric label="Effective conversation / documents">{efficiency.effectiveScores.conversation / 100} / {efficiency.effectiveScores.documents / 100}</Metric><Metric label="Effective coding / tools">{efficiency.effectiveScores.coding / 100} / {efficiency.effectiveScores.tools / 100}</Metric><Metric label="Effective reliability">{efficiency.effectiveReliabilityBps / 100}</Metric></Metrics>}
    {(applied.available.routing || efficiency.routing) && <div className="system-application"><p className="small-heading">Request routing</p>
      {routingCurrent && efficiency.routing ? <><p className="small-note">Secondary model: {game.slices.models.versions[efficiency.routing.secondaryModelId ?? '']?.name ?? 'Installed version'}. {percent(efficiency.easyShareBps)} of requests take this path; the primary handles the remainder.</p>{efficiency.routing.status !== 'active' ? <RolloutStatus rollout={efficiency.routing} /> : <><ActionControl game={game} payload={{ kind: 'set_product_efficiency_enabled', productId, method: 'routing', enabled: !efficiency.routing.enabled }} label={efficiency.routing.enabled ? 'Disable request routing' : 'Enable request routing'} canAct={canAct} onQueue={onQueue} compact /><details className="inline-details"><summary>Change the secondary model</summary>{routingForm('change', 'Rebuild routing with this model')}<p className="small-note">Rebuilding takes more staff work and compute. Your main model keeps serving customers while the new routing is installed.</p></details></>}</> : routingForm('secondary', efficiency.routing ? 'Reinstall routing for this model' : 'Install request routing')}
      <p className="small-note">Both models remain in memory. Routing adds {formatUnits(ROUTING.overheadPerRequest * 1000)} CUw per 1,000 requests and combines the two models’ quality and behavior. Installation uses {formatWorkPoints(EFFICIENCY_RULES.routing.staff)} Design points and {formatUnits(EFFICIENCY_RULES.routing.work)} development CUw.</p>
    </div>}
    {(applied.available.prefixCache || efficiency.prefixCache) && <div className="system-application"><p className="small-heading">Prefix cache<span className="status-inline">{efficiency.cacheActive ? efficiency.cacheWarm ? 'Warm' : 'Cold' : cacheCurrent && efficiency.prefixCache?.status === 'active' ? 'Disabled' : ''}</span></p>
      {cacheCurrent && efficiency.prefixCache ? efficiency.prefixCache.status !== 'active' ? <RolloutStatus rollout={efficiency.prefixCache} /> : <ActionControl game={game} payload={{ kind: 'set_product_efficiency_enabled', productId, method: 'prefix-cache', enabled: !efficiency.prefixCache.enabled }} label={efficiency.prefixCache.enabled ? 'Disable prefix cache' : 'Enable prefix cache'} canAct={canAct} onQueue={onQueue} compact /> : <ActionControl game={game} payload={{ kind: 'install_product_efficiency', productId, method: 'prefix-cache' }} label={efficiency.prefixCache ? 'Reinstall cache for this model' : 'Install prefix cache'} canAct={canAct} onQueue={onQueue} />}
      <p className="small-note">Served traffic warms this product’s cache; reserved memory scales with its customers. Up to {percent(PREFIX_CACHE.reusedInputShareBps)} of input is eligible; a hit uses {percent(PREFIX_CACHE.hitWorkBps)} of ordinary input work. Output, reasoning, and token billing keep their normal rules. Entries expire after {PREFIX_CACHE.lifetimeWeeks} weeks without reuse.</p>
    </div>}
  </details>;
}
