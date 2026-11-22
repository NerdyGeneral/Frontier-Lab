'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Database, FlaskConical, Pause, Play, Route } from 'lucide-react';
import type { CapabilityDomain, CommandPayload, EvaluationSuiteId, GameState, TrainingProfile } from '../contracts/types';
import type { DevelopmentPlan, DevelopmentPlanSpec, DevelopmentTrainingOrder } from '../contracts/development-plans';
import { CONTENT } from '../content/catalog';
import { EVALUATION_SUITES, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { developmentFeeSpent, developmentPreviewState, developmentQuote, developmentFeasibility, developmentLeadOptions, developmentLeadName, developmentCapacityShare, unfinishedDevelopmentPlans, pinDevelopmentGoal } from '../modules/development-plans';
import { developmentObjectiveChallenge } from '../contracts/development-objectives';
import { DEVELOPMENT_ACTIVE_LIMIT } from '../contracts/development-plans';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { DevelopmentProjectResult } from './development-project-result';
import { getModelDesignForBase, getModelDesignForecast, getAISystemForecastModel } from '../modules/model-design';
import { packetOwnedBy } from '../modules/lab-planner';
import { hasResearch } from '../modules/research';
import { formatMoney } from '../core/math';
import { ActionControl, Metric, Metrics, parseFixed, Section } from './components';
import { aiSystemChoiceSummary, aiSystemName } from './ai-system-designer';
import { ModelDesigner } from './model-designer';
import { useStudioDevelopmentSelection, useStudioTaskActions } from './studio-interaction-context';
import { buildDevelopmentTrainingOrder } from './development-plan-draft';
import { customizationOptionName, inheritModelDesignDraft } from './model-design-draft';
import { ModelBlueprintTools } from './model-blueprint-tools';
import { useModelWorkspace } from './model-workspace-context';
import type { DelegatedTrainingDraft, ModelBlueprint } from '../persistence/model-workspace';
import { DevelopmentWorkspaceHeader, DevelopmentGoalSummary } from './development-workspace';
import { recommendedDesignEvaluation } from '../core/model-evaluation-goal';
import { isCapabilitySuite } from '../modules/evaluation-classification';

const STAGES = [{ id: 'prepare', label: 'Prepare data', Icon: Database }, { id: 'train', label: 'Train model', Icon: FlaskConical }, { id: 'evaluate', label: 'Evaluate', Icon: ClipboardCheck }, { id: 'challenge', label: 'Paid challenge', Icon: ClipboardCheck }, { id: 'review', label: 'Your decision', Icon: Check }] as const;
interface Props { game: GameState; canAct: boolean; onQueue: (payload: CommandPayload) => void; onRun?: () => void; paused?: boolean }

function PlanCard({ plan, game, canAct, onQueue, onRun, paused }: Props & { plan: DevelopmentPlan }) {
  const [budget, setBudget] = useState(String(plan.feeBudgetCents / 100));
  const [reserve, setReserve] = useState(String(plan.cashReserveCents / 100));
  const [deadline, setDeadline] = useState(String(Math.max(game.week + 16, plan.deadlineWeek)));
  const [editing, setEditing] = useState(false);
  const finished = plan.status === 'review' || plan.status === 'cancelled';
  const stages = STAGES.filter(item => item.id !== 'challenge' || !!developmentObjectiveChallenge(plan.objective));
  const stage = stages.findIndex(item => item.id === plan.stage);
  const connected = hasConnectedCompanyRules(game.contentVersion);
  const [leadStaffId, setLeadStaffId] = useState(plan.leadStaffId ?? 'founder');
  const [capacityShareBps, setCapacityShareBps] = useState(developmentCapacityShare(plan));
  const feeBudgetCents = parseFixed(budget, 2), cashReserveCents = parseFixed(reserve, 2), deadlineWeek = Number(deadline);
  const revised: CommandPayload | null = feeBudgetCents !== null && cashReserveCents !== null && Number.isSafeInteger(deadlineWeek)
    ? { kind: 'revise_development_plan', planId: plan.id, feeBudgetCents, cashReserveCents, deadlineWeek, ...(connected ? { leadStaffId, capacityShareBps } : {}) } : null;
  const report = plan.reportId ? game.slices.models.reports[plan.reportId] : null;
  const savedDesign = plan.training.modelDesign;
  return <article className={'development-plan-card status-' + plan.status} aria-label={plan.name}>
    <header><div><span className="strategy-eyebrow">DEVELOPMENT PLAN · {plan.status === 'review' ? 'READY FOR YOUR DECISION' : plan.status.toUpperCase()}</span><h3>{plan.name}</h3></div><span className="development-deadline">Week {plan.deadlineWeek}<small>deadline</small></span></header>
    <ol className="development-stages" aria-label="Development stages">{stages.map((item, index) => <li key={item.id} className={index < stage || plan.status === 'review' ? 'is-complete' : index === stage ? 'is-current' : ''} aria-current={index === stage ? 'step' : undefined}><item.Icon size={17} /><span>{item.label}</span></li>)}</ol>
    <p className={plan.status === 'blocked' ? 'callout warning' : 'development-plan-message'} role={plan.status === 'blocked' ? 'status' : undefined}>{plan.message}</p>
    {savedDesign && !report && <p className="small-note"><strong>Saved model design: {savedDesign.name}.</strong>{' '}{savedDesign.parameterMillions / 1000}B parameters · {savedDesign.sparsityBps / 100}% sparse{savedDesign.system && <> · {aiSystemName(savedDesign.system)} · {aiSystemChoiceSummary(savedDesign.system)}</>}
      {savedDesign.customization && <> · {customizationOptionName('attention', savedDesign.customization.attention)} · {customizationOptionName('contextWindow', savedDesign.customization.contextWindow)} · {customizationOptionName('precision', savedDesign.customization.precision)} · {customizationOptionName('objective', savedDesign.customization.objective)} · {customizationOptionName('behavior', savedDesign.customization.behavior)}</>}.</p>}
    <Metrics><Metric label="Project fees">{formatMoney(developmentFeeSpent(game, plan))}<small> of {formatMoney(plan.feeBudgetCents)}</small></Metric><Metric label="Cash reserve">{formatMoney(plan.cashReserveCents)}</Metric><Metric label="Test">{EVALUATION_SUITES.find(s => s.id === plan.suiteId)?.name ?? plan.suiteId}</Metric></Metrics>
    <p className="small-note"><strong>Responsible: {developmentLeadName(game, plan)}</strong> · {developmentCapacityShare(plan) / 100}% of each available development resource. Shared lab capacity remains authoritative.</p>
    {plan.objective && !report && <DevelopmentGoalSummary game={game} goal={plan.objective} compact />}
    {report && <DevelopmentProjectResult plan={plan} game={game} canAct={canAct} onQueue={onQueue} />}
    {!finished && <><div className="strategy-actions">
      {plan.status === 'running' && onRun && <button type="button" className="primary-action" onClick={onRun} disabled={!canAct || !paused}><Play size={15} />{paused ? 'Run until a decision' : 'Running until a decision'}</button>}
      <ActionControl game={game} payload={{ kind: 'set_development_plan_paused', planId: plan.id, paused: plan.status === 'running' }} label={plan.status === 'running' ? 'Pause plan' : 'Resume plan'} canAct={canAct} onQueue={onQueue} compact />
      <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit limits</button>
      <ActionControl game={game} payload={{ kind: 'cancel_development_plan', planId: plan.id }} label="Stop plan · keep outputs" canAct={canAct} onQueue={onQueue} compact />
    </div>{editing && <div className="development-limit-editor"><div className="form-grid"><label>Project-fee budget ($)<input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label><label>Cash reserve ($)<input inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} /></label><label>Deadline week<input type="number" min={game.week + 2} max={game.week + 520} value={deadline} onChange={e => setDeadline(e.target.value)} /></label></div>{connected && <ProjectResponsibility game={game} leadStaffId={leadStaffId} capacityShareBps={capacityShareBps} onLead={setLeadStaffId} onShare={setCapacityShareBps} />}<ActionControl game={game} payload={revised} label="Save limits and resume" canAct={canAct} onQueue={onQueue} /></div>}</>}
    <p className="small-note">The fee limit covers preparation and training setup. Rent, salaries and metered compute continue separately. Cash-reserve checks include known weekly base costs; market revenue and variable costs can change.</p>
  </article>;
}

export function DevelopmentPlansPanel(props: Props) {
  const { game, canAct, onQueue } = props;
  const owner = game.playerCompanyId;
  const workspace = useModelWorkspace();
  const selection = useStudioDevelopmentSelection();
  const actions = useStudioTaskActions();
  const [restoredDraftEpoch, setRestoredDraftEpoch] = useState(-1);
  const draftReady = !workspace || (workspace.ready && restoredDraftEpoch === workspace.epoch);
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  const [importedTraining, setImportedTraining] = useState<DevelopmentTrainingOrder | null>(null);
  const models = Object.values(game.slices.models.versions).filter(model => model.companyId === owner);
  const packets = Object.values(game.slices.data.packets).filter(packet => packetOwnedBy(packet, owner, owner) && packet.rawUnits);
  const [name, setName] = useState('Next model release');
  const [baseId, setBaseId] = useState(models[0]?.id ?? '');
  const base = models.find(model => model.id === baseId);
  const [selected, setSelected] = useState<string[]>(packets[0] ? [packets[0].id] : []);
  const [method, setMethod] = useState(CONTENT.firstTraining.id);
  const recipe = TRAINING_RECIPES.find(item => item.id === method);
  const [profile, setProfile] = useState<TrainingProfile>('balanced');
  const [teacherId, setTeacherId] = useState('');
  const [teacherDomain, setTeacherDomain] = useState<CapabilityDomain>('conversation');
  const [design, setDesign] = useState(() => getModelDesignForBase(models[0] ?? CONTENT.seedModel));
  const [suiteId, setSuiteId] = useState<EvaluationSuiteId>('basic-conversation-1');
  const [budget, setBudget] = useState('5000');
  const [reserve, setReserve] = useState('5000');
  const [duration, setDuration] = useState('32');
  const [showHistory, setShowHistory] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [leadStaffId, setLeadStaffId] = useState('founder');
  const [capacityShareBps, setCapacityShareBps] = useState(10000);
  const connected = hasConnectedCompanyRules(game.contentVersion);
  if (workspace?.ready && restoredDraftEpoch !== workspace.epoch) {
    const saved = workspace.delegated;
    if (saved) {
      setName(saved.name); setBaseId(saved.baseId); setSelected([...saved.selected]); setMethod(saved.method); setProfile(saved.profile);
      setTeacherId(saved.teacherId); setTeacherDomain(saved.teacherDomain); setDesign(structuredClone(saved.design)); setSuiteId(saved.suiteId);
      setBudget(saved.budget); setReserve(saved.reserve); setDuration(saved.duration); setLeadStaffId(saved.leadStaffId ?? 'founder'); setCapacityShareBps(saved.capacityShareBps ?? 10000); setImportedTraining(saved.importedTraining && structuredClone(saved.importedTraining));
    }
    setRestoredDraftEpoch(workspace.epoch);
  }
  const loadBlueprint = (blueprint: ModelBlueprint) => {
    const order = structuredClone(blueprint.training);
    if (blueprint.objective) workspace?.setDevelopmentGoal(blueprint.objective);
    setName(blueprint.name); setBaseId(order.baseModelId); setSelected(order.packetIds ?? [order.packetId]);
    setMethod(order.modelDesign ? 'custom' : order.recipeId ?? CONTENT.firstTraining.id); setProfile(order.profile ?? 'balanced');
    if (order.modelDesign) setDesign(structuredClone(order.modelDesign));
    setTeacherId(order.teacherModelId ?? ''); setTeacherDomain(order.teacherDomain ?? 'conversation');
    setSuiteId(blueprint.suiteId ?? recommendedDesignEvaluation(order).suiteId); setImportedTraining(order);
  };
  if (draftReady && selection && selection.intentId !== appliedIntent) { loadBlueprint(selection.blueprint); setAppliedIntent(selection.intentId); }
  const savedDraftText = JSON.stringify({ name, baseId, selected, method, profile, teacherId, teacherDomain, design, suiteId,
    budget, reserve, duration, importedTraining, ...(connected ? { leadStaffId, capacityShareBps } : {}) } satisfies DelegatedTrainingDraft);
  useEffect(() => {
    if (workspace?.ready && restoredDraftEpoch === workspace.epoch) workspace.setDraft('delegated', JSON.parse(savedDraftText) as DelegatedTrainingDraft);
  }, [savedDraftText, workspace?.ready, workspace?.epoch, workspace?.setDraft, restoredDraftEpoch]);
  const active = unfinishedDevelopmentPlans(game);
  const plans = Object.values(game.slices.models.developmentPlans ?? {}).filter(plan => plan.companyId === owner).sort((a, b) => b.createdWeek - a.createdWeek);
  const latestReview = plans.find(plan => plan.status === 'review') ?? null;
  const history = plans.filter(plan => !active.includes(plan) && plan !== latestReview);
  const archive = Object.values(game.slices.models.developmentPlanArchive ?? {}).sort((a, b) => b.createdWeek - a.createdWeek || a.id.localeCompare(b.id));
  const objective = connected ? pinDevelopmentGoal(game, workspace?.developmentGoal) : undefined;
  const objectiveChallenge = developmentObjectiveChallenge(objective);
  useEffect(() => { if (objectiveChallenge && !isCapabilitySuite(suiteId)) setSuiteId('basic-conversation-1'); }, [objectiveChallenge, suiteId]);
  const feeBudgetCents = parseFixed(budget, 2), cashReserveCents = parseFixed(reserve, 2), weeks = Number(duration);
  const training = importedTraining ?? buildDevelopmentTrainingOrder({ base, packetIds: selected, method, profile, design, teacherModelId: teacherId, teacherDomain });
  const spec: DevelopmentPlanSpec | null = training && feeBudgetCents !== null && cashReserveCents !== null && Number.isSafeInteger(weeks)
    ? { name, training, suiteId, feeBudgetCents, cashReserveCents, deadlineWeek: game.week + weeks, ...(objective ? { objective } : {}), ...(connected ? { leadStaffId, capacityShareBps } : {}) } : null;
  const preview = useMemo(() => { try { return spec ? developmentQuote(game, spec, CONTENT) : null; } catch { return null; } }, [active, game, spec]);
  const prepared = useMemo(() => method === 'custom' && spec ? developmentPreviewState(game, spec) : game, [active, method, game, spec]);
  const feasibility = useMemo(() => { try { return spec ? developmentFeasibility(game, spec, CONTENT) : null; } catch { return null; } }, [game, spec]);
  const delegatedForecast = training?.modelDesign && preview ? getAISystemForecastModel(training.modelDesign,
    getModelDesignForecast(prepared, owner, training.baseModelId, training.packetIds ?? [training.packetId], training.modelDesign),
    { capabilityBps: preview.training.capabilityRange.minimum, advancedCapabilities: preview.training.advancedCapabilityRange?.minimum, reliabilityBps: preview.training.reliabilityRange.minimum }) : undefined;
  const evaluationAdvice = training ? recommendedDesignEvaluation(training) : null;
  const suggestedSuite = EVALUATION_SUITES.find(s => s.id === evaluationAdvice?.suiteId);
  const evaluationResearch = suggestedSuite?.requiredResearch && !hasResearch(game, owner, suggestedSuite.requiredResearch)
    ? CONTENT.research.find(node => node.id === suggestedSuite.requiredResearch) : undefined;
  const editCurrentTraining = actions?.editTraining && training ? () => actions.editTraining?.({ id: 'delegated-design', name, training, suiteId }) : undefined;
  const queuedPlan = game.queuedCommands.some(command => command.companyId === owner && command.payload.kind === 'start_development_plan');
  return <Section title="Develop a model · delegated" id="development-plans" className="development-plans-panel">
    <DevelopmentWorkspaceHeader game={game} mode="delegated" canAct={canAct} onManual={editCurrentTraining} />
    <div className="strategy-intro"><Route size={22} /><div><h3>Choose the work. Delegate the handoffs.</h3><p>Each project keeps its objective, data and design through paid preparation, training and testing. Systems targets add the matching paid challenge. Senior leads can own parallel projects within your shared capacity; commercial delivery stays your decision.</p></div></div>
    {latestReview && <PlanCard key={latestReview.id} {...props} plan={latestReview} />}
    {active.map(plan => <PlanCard key={plan.id} {...props} plan={plan} />)}
    {connected && active.length > 0 && active.length < DEVELOPMENT_ACTIVE_LIMIT && !showBuilder && <button type="button" onClick={() => { setShowBuilder(true); const availableLead = developmentLeadOptions(game).find(lead => !active.some(plan => (plan.leadStaffId ?? 'founder') === lead.id)); setLeadStaffId(availableLead?.id ?? 'founder'); setCapacityShareBps(Math.max(1000, 10000 - active.reduce((sum, plan) => sum + developmentCapacityShare(plan), 0))); }}>Plan another project</button>}
    {(active.length === 0 || connected && showBuilder) && <div className="development-plan-builder">
      {latestReview && <h3>Plan another model</h3>}
      <ModelBlueprintTools training={training} suiteId={suiteId} canAct={canAct} onLoad={loadBlueprint} />
      {connected && <ProjectResponsibility game={game} leadStaffId={leadStaffId} capacityShareBps={capacityShareBps} onLead={setLeadStaffId} onShare={setCapacityShareBps} />}
      <div className="form-grid"><label>Project name<input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>{!importedTraining && <label>Starting model<select value={base?.id ?? ''} onChange={e => { setBaseId(e.target.value); const model = models.find(m => m.id === e.target.value); if (model) setDesign(current => inheritModelDesignDraft(current, model)); }}>{!base && <option value="">Choose an available model</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>}</div>
      {importedTraining ? <section className="development-imported-design" aria-label="Training design from workbench">
        <h4>{importedTraining.modelDesign?.name || TRAINING_RECIPES.find(r => r.id === importedTraining.recipeId)?.name || 'Training plan'}</h4>
        <p className="small-note">Starting model: {game.slices.models.versions[importedTraining.baseModelId]?.name || 'Unavailable model'}. Sources: {(importedTraining.packetIds ?? [importedTraining.packetId]).map(id => game.slices.data.packets[id]?.name || 'Unavailable data').join(', ')}.</p>
        {importedTraining.modelDesign && <p className="small-note">{importedTraining.modelDesign.mode === 'foundation' ? 'New foundation' : 'Continued training'} · {importedTraining.modelDesign.parameterMillions / 1000}B parameters · {importedTraining.modelDesign.sparsityBps / 100}% sparse · {(importedTraining.modelDesign.computeBudgetCUw / 1e9).toFixed(1)} CUw budget.</p>}
        {importedTraining.modelDesign?.system && <p className="small-note"><strong>{aiSystemName(importedTraining.modelDesign.system)}</strong> · {aiSystemChoiceSummary(importedTraining.modelDesign.system)}</p>}
        <p className="small-note">All training choices are retained, including any workspace, checkpoints, replay or curriculum. Choose Manual above to edit this design, then return to Delegated.</p>
      </section> : <>
      <fieldset className="development-datasets"><legend>Training sources</legend><p>Selected raw data is prepared automatically. Owned prepared sources are reused.</p>{packets.map(packet => <label key={packet.id}><input type="checkbox" checked={selected.includes(packet.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, packet.id] : ids.filter(id => id !== packet.id))} /><span><strong>{packet.name}</strong><small>{packet.prepared ? 'Ready to use' : 'Needs preparation'} · Quality {packet.qualityBps / 100}% · {packet.rawUnits.toLocaleString()} units</small></span></label>)}<a href="#data">Browse all datasets and skill coverage</a></fieldset>
      <label className="development-method">Training method<select value={method} onChange={e => setMethod(e.target.value)}><option value="custom">Design a custom model</option>{TRAINING_RECIPES.filter(item => !item.id.startsWith('custom-model-')).map(recipe => <option key={recipe.id} value={recipe.id} disabled={!!recipe.requiredResearch && !hasResearch(game, owner, recipe.requiredResearch)}>{recipe.name}{recipe.requiredResearch && !hasResearch(game, owner, recipe.requiredResearch) ? ' · requires ' + (CONTENT.research.find(node => node.id === recipe.requiredResearch)?.name ?? recipe.requiredResearch) : ''}</option>)}</select></label>
      {method !== 'custom' && <><p className="small-note">{recipe?.description}</p>{(recipe?.kind === 'adaptation' || recipe?.kind === 'foundation') && <label className="development-method">Training approach<select value={profile} onChange={e => setProfile(e.target.value as TrainingProfile)}>{Object.entries(TRAINING_PROFILES).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><span className="small-note">{TRAINING_PROFILES[profile].description}</span></label>}</>}
      {recipe?.kind === 'distillation' && <div className="form-grid"><label>Teacher model<select value={teacherId} onChange={e => setTeacherId(e.target.value)}><option value="">Choose a tested teacher</option>{models.filter(model => model.id !== base?.id).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Skill to distill<select value={teacherDomain} onChange={e => setTeacherDomain(e.target.value as CapabilityDomain)}>{(['conversation', 'documents', 'coding', 'tools'] as const).map(domain => <option key={domain} value={domain}>{domain[0].toUpperCase() + domain.slice(1)}</option>)}</select></label></div>}
      {recipe?.kind === 'synthetic' && <p className="callout">Select exactly one accepted, audited synthetic dataset above. This method reuses that packet’s reviewed target skill; choose a student different from its teacher.</p>}
      {method === 'custom' && base && <ModelDesigner game={prepared} baseModelId={base.id} packetIds={selected} value={design} onChange={setDesign} canAct={canAct} />}
      </>}
      {importedTraining && delegatedForecast && <DevelopmentGoalSummary game={prepared} projected model={delegatedForecast} />}
      {evaluationAdvice && (!objectiveChallenge || isCapabilitySuite(evaluationAdvice.suiteId)) && <div className="development-evaluation-advice"><p><strong>Recommended test: {suggestedSuite?.name}.</strong> {evaluationAdvice.reason}</p>
        {evaluationResearch && <p>Unlock {evaluationResearch.name} to use this test. {actions?.openResearch && <button type="button" className="training-text-action" onClick={() => actions.openResearch?.(evaluationResearch.id)}>View {evaluationResearch.name}</button>}</p>}
        {suiteId !== evaluationAdvice.suiteId && <button type="button" disabled={!canAct || !!evaluationResearch} onClick={() => setSuiteId(evaluationAdvice.suiteId)}>Use {suggestedSuite?.name}</button>}
      </div>}
      {objectiveChallenge && <p className="small-note">The saved objective adds its paid systems challenge after this capability baseline. Advanced and behavior diagnostics remain available separately.</p>}
      <div className="form-grid"><label>Final evaluation<select value={suiteId} onChange={e => setSuiteId(e.target.value as EvaluationSuiteId)}>{EVALUATION_SUITES.filter(s => ['basic-conversation-1', 'expanded-capabilities-1', 'advanced-capabilities-1', 'behavior-cases-1'].includes(s.id)).map(s => <option key={s.id} value={s.id} disabled={!!objectiveChallenge && !isCapabilitySuite(s.id) || !!s.requiredResearch && !hasResearch(game, owner, s.requiredResearch)}>{s.name}{objectiveChallenge && !isCapabilitySuite(s.id) ? ' · separate diagnostic after the project' : ''}{s.requiredResearch && !hasResearch(game, owner, s.requiredResearch) ? ' · requires ' + (CONTENT.research.find(node => node.id === s.requiredResearch)?.name ?? s.requiredResearch) : ''}</option>)}</select></label><label>Finish within (weeks)<input type="number" min="3" max="520" value={duration} onChange={e => setDuration(e.target.value)} /></label><label>Project-fee budget ($)<input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label><label>Keep cash reserve ($)<input inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} /></label></div>
      {preview && <div className="development-forecast"><Metrics><Metric label="Expected setup fees">{formatMoney(preview.totalFeeCents)}</Metric><Metric label="Training work">{(preview.training.workCUw / 1e9).toFixed(2)} CUw</Metric><Metric label="Training memory">{(preview.training.memoryMU / 1e9).toFixed(2)} MU</Metric><Metric label="Current base bills">{formatMoney(preview.weeklyBaseCostCents)} / week</Metric></Metrics><p>Actual duration depends on your available staff and development compute. <a href="#compute">Review capacity</a> before choosing a deadline.</p></div>}
      {feasibility && <section className="development-feasibility" aria-label="Project feasibility"><h4>Can this project reach its target?</h4><Metrics><Metric label="Planning duration">{feasibility.nominalWeeks === null ? 'Capacity needed' : `${feasibility.nominalWeeks}–${feasibility.cautiousWeeks} weeks`}</Metric><Metric label="Operating cost estimate">{feasibility.operatingLowCents === null || feasibility.operatingHighCents === null ? 'Capacity needed' : `${formatMoney(feasibility.operatingLowCents)}–${formatMoney(feasibility.operatingHighCents)}`}</Metric></Metrics><p className="small-note">Setup fees are separate. This planning range uses current team shares, weekly company bills and estimated metered work. Revenue, competing jobs, hardware speed and future changes can alter the result.{feasibility.includesChallenge ? ' The paid systems challenge is included.' : ''}</p>{feasibility.issues.length > 0 && <ul>{feasibility.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}</section>}
      <p className="small-note">Your design and data choices are retained. Every stage uses the normal paid simulation and checks its prerequisites again. The plan stops for your review after its baseline and any objective challenge.</p>
      <ActionControl game={game} payload={spec ? { kind: 'start_development_plan', ...spec } : null} label="Schedule development plan" canAct={canAct} onQueue={onQueue} emptyReason="Choose a model, data, budget and deadline." taskAction="development-plan" />
      {queuedPlan && props.onRun && <div className="development-run-next"><p>Your plan is scheduled. Continue until its result or a limit needs your decision.</p><button type="button" className="primary-action" disabled={!canAct || !props.paused} onClick={props.onRun}><Play size={16} aria-hidden="true" />{props.paused ? 'Resume clock · run this plan' : 'Running until a decision'}</button></div>}
    </div>}
    {archive.length > 0 && <details className="inline-details"><summary>Archived project history ({archive.length})</summary><p className="small-note">Finished projects are compacted automatically. Their paid models, reports and work receipts remain available.</p><ol>{archive.map(item => <li key={item.id}><strong>{item.name}</strong> · Week {item.createdWeek}–{item.endedWeek} · {item.status === 'review' ? 'Completed' : 'Stopped'} · {formatMoney(item.feeSpentCents)} in fees{item.reportId && <a href="#models"> · Review saved model and reports</a>}</li>)}</ol></details>}
    {history.length > 0 && <div className="development-history"><h3>Saved plans and results</h3>{(showHistory ? history : history.slice(0, 5)).map(plan => <PlanCard key={plan.id} {...props} plan={plan} />)}{history.length > 5 && <button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>{showHistory ? 'Show recent plans' : `Show all ${history.length} saved plans`}</button>}</div>}
  </Section>;
}

function ProjectResponsibility({ game, leadStaffId, capacityShareBps, onLead, onShare }: {
  game: GameState; leadStaffId: string; capacityShareBps: number; onLead: (id: string) => void; onShare: (share: number) => void;
}) {
  const leads = developmentLeadOptions(game);
  return <section className="development-responsibility" aria-label="Project responsibility"><div className="form-grid">
    <label>Responsible lead<select value={leadStaffId} onChange={event => onLead(event.target.value)}>{!leads.some(lead => lead.id === leadStaffId) && <option value={leadStaffId}>Unavailable lead · reassign</option>}{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label>
    <label>Team and compute share<select value={capacityShareBps} onChange={event => onShare(Number(event.target.value))}>{Array.from({ length: 19 }, (_, index) => 1000 + index * 500).map(share => <option key={share} value={share}>{share / 100}%</option>)}</select></label>
  </div><p className="small-note">Each lead owns one unfinished project. A ready Senior data, model or research specialist can lead another. Shares cap actual weekly staff and compute requests and must total at most 100%; they do not create capacity. Paused projects keep their reserved share until you edit or stop them.</p></section>;
}
