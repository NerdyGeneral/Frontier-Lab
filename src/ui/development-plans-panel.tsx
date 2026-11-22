'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Database, FlaskConical, Pause, Play, Route } from 'lucide-react';
import type { CapabilityDomain, CommandPayload, EvaluationSuiteId, GameState, TrainingProfile } from '../contracts/types';
import type { DevelopmentPlan, DevelopmentPlanSpec, DevelopmentTrainingOrder } from '../contracts/development-plans';
import { CONTENT } from '../content/catalog';
import { EVALUATION_SUITES, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { activeDevelopmentPlan, developmentFeeSpent, developmentPreviewState, developmentQuote } from '../modules/development-plans';
import { getModelDesignForBase } from '../modules/model-design';
import { packetOwnedBy } from '../modules/lab-planner';
import { hasResearch } from '../modules/research';
import { formatMoney } from '../core/math';
import { ActionControl, Metric, Metrics, parseFixed, Section } from './components';
import { ModelDesigner } from './model-designer';
import { useContinueTraining, useStudioDevelopmentSelection, useStudioTaskActions } from './studio-interaction-context';
import { buildDevelopmentTrainingOrder } from './development-plan-draft';
import { customizationOptionName, inheritModelDesignDraft } from './model-design-draft';
import { ModelProfile } from './model-profile';
import { ModelBlueprintTools } from './model-blueprint-tools';
import { useModelWorkspace } from './model-workspace-context';
import type { DelegatedTrainingDraft, ModelBlueprint } from '../persistence/model-workspace';
import { recommendedDesignEvaluation } from '../core/model-evaluation-goal';

const STAGES = [{ id: 'prepare', label: 'Prepare data', Icon: Database }, { id: 'train', label: 'Train model', Icon: FlaskConical }, { id: 'evaluate', label: 'Evaluate', Icon: ClipboardCheck }, { id: 'review', label: 'Your decision', Icon: Check }] as const;
interface Props { game: GameState; canAct: boolean; onQueue: (payload: CommandPayload) => void; onRun?: () => void; paused?: boolean }

function PlanCard({ plan, game, canAct, onQueue, onRun, paused }: Props & { plan: DevelopmentPlan }) {
  const [budget, setBudget] = useState(String(plan.feeBudgetCents / 100));
  const [reserve, setReserve] = useState(String(plan.cashReserveCents / 100));
  const [deadline, setDeadline] = useState(String(Math.max(game.week + 16, plan.deadlineWeek)));
  const [editing, setEditing] = useState(false);
  const finished = plan.status === 'review' || plan.status === 'cancelled';
  const stage = STAGES.findIndex(item => item.id === plan.stage);
  const feeBudgetCents = parseFixed(budget, 2), cashReserveCents = parseFixed(reserve, 2), deadlineWeek = Number(deadline);
  const revised: CommandPayload | null = feeBudgetCents !== null && cashReserveCents !== null && Number.isSafeInteger(deadlineWeek)
    ? { kind: 'revise_development_plan', planId: plan.id, feeBudgetCents, cashReserveCents, deadlineWeek } : null;
  const report = plan.reportId ? game.slices.models.reports[plan.reportId] : null;
  const resultModel = report ? game.slices.models.versions[report.modelId] : undefined;
  const savedDesign = plan.training.modelDesign;
  const actions = useStudioTaskActions(), continueTraining = useContinueTraining();
  return <article className={'development-plan-card status-' + plan.status} aria-label={plan.name}>
    <header><div><span className="strategy-eyebrow">DEVELOPMENT PLAN · {plan.status === 'review' ? 'READY FOR YOUR DECISION' : plan.status.toUpperCase()}</span><h3>{plan.name}</h3></div><span className="development-deadline">Week {plan.deadlineWeek}<small>deadline</small></span></header>
    <ol className="development-stages" aria-label="Development stages">{STAGES.map((item, index) => <li key={item.id} className={index < stage || plan.status === 'review' ? 'is-complete' : index === stage ? 'is-current' : ''} aria-current={index === stage ? 'step' : undefined}><item.Icon size={17} /><span>{item.label}</span></li>)}</ol>
    <p className={plan.status === 'blocked' ? 'callout warning' : 'development-plan-message'} role={plan.status === 'blocked' ? 'status' : undefined}>{plan.message}</p>
    {savedDesign && !resultModel && <p className="small-note"><strong>Saved model design: {savedDesign.name}.</strong>{' '}{savedDesign.parameterMillions / 1000}B parameters · {savedDesign.sparsityBps / 100}% sparse
      {savedDesign.customization && <> · {customizationOptionName('attention', savedDesign.customization.attention)} · {customizationOptionName('contextWindow', savedDesign.customization.contextWindow)} · {customizationOptionName('precision', savedDesign.customization.precision)} · {customizationOptionName('objective', savedDesign.customization.objective)} · {customizationOptionName('behavior', savedDesign.customization.behavior)}</>}.</p>}
    <Metrics><Metric label="Project fees">{formatMoney(developmentFeeSpent(game, plan))}<small> of {formatMoney(plan.feeBudgetCents)}</small></Metric><Metric label="Cash reserve">{formatMoney(plan.cashReserveCents)}</Metric><Metric label="Test">{EVALUATION_SUITES.find(s => s.id === plan.suiteId)?.name ?? plan.suiteId}</Metric></Metrics>
    {report && <div className="development-result"><h4>{game.slices.models.versions[report.modelId]?.name}</h4><p>{report.passedCases} / {report.cases.length} held-out cases passed · Reliability {(report.reliabilityBps / 100).toFixed(1)}%.</p><p>{EVALUATION_SUITES.find(s => s.id === plan.suiteId)?.name} completed. {report.advancedCapabilities ? 'Compare the specialist scores below with the customer requirements you are targeting.' : report.outcomes ? 'Review useful answers, mistakes and refusals before choosing a release.' : report.basicChatEligible ? 'The model qualifies for Basic Chat. Review its report and choose how to release it.' : 'Review its measured skills and the requirements of your intended product.'}</p>{report.advancedCapabilities && <Metrics>{Object.entries(report.advancedCapabilities).map(([skill,value]) => <Metric key={skill} label={skill === 'longContext' ? 'Long context' : skill === 'multimodal' ? 'Multimodal' : 'Reasoning'}>{(value / 100).toFixed(1)}%</Metric>)}</Metrics>}{report.outcomes && <Metrics><Metric label="Useful answers">{report.outcomes.usefulAnswers}</Metric><Metric label="Confident errors">{report.outcomes.confidentErrors}</Metric><Metric label="Unnecessary refusals">{report.outcomes.falseRefusals}</Metric></Metrics>}<div className="strategy-actions">{actions?.reviewReport ? <button type="button" onClick={() => actions.reviewReport?.(report.id)}>Review model and report</button> : <a href="#models">Review model and report</a>}{report.basicChatEligible && actions ? <button type="button" onClick={() => actions.launchBasicChat(report.modelId, report.id)}>Choose a release</button> : !report.basicChatEligible && continueTraining ? <button type="button" onClick={() => continueTraining(report.modelId)}>Plan an improvement</button> : <a href={report.basicChatEligible ? '#product' : '#lab-projects'}>{report.basicChatEligible ? 'Choose a release' : 'Plan an improvement'}</a>}</div></div>}
    {resultModel && <ModelProfile model={resultModel} compact />}
    {!finished && <><div className="strategy-actions">
      {plan.status === 'running' && onRun && <button type="button" className="primary-action" onClick={onRun} disabled={!canAct || !paused}><Play size={15} />{paused ? 'Run until a decision' : 'Running until a decision'}</button>}
      <ActionControl game={game} payload={{ kind: 'set_development_plan_paused', planId: plan.id, paused: plan.status === 'running' }} label={plan.status === 'running' ? 'Pause plan' : 'Resume plan'} canAct={canAct} onQueue={onQueue} compact />
      <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit limits</button>
      <ActionControl game={game} payload={{ kind: 'cancel_development_plan', planId: plan.id }} label="Stop plan · keep outputs" canAct={canAct} onQueue={onQueue} compact />
    </div>{editing && <div className="development-limit-editor"><div className="form-grid"><label>Project-fee budget ($)<input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label><label>Cash reserve ($)<input inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} /></label><label>Deadline week<input type="number" min={game.week + 2} max={game.week + 520} value={deadline} onChange={e => setDeadline(e.target.value)} /></label></div><ActionControl game={game} payload={revised} label="Save limits and resume" canAct={canAct} onQueue={onQueue} /></div>}</>}
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
  if (workspace?.ready && restoredDraftEpoch !== workspace.epoch) {
    const saved = workspace.delegated;
    if (saved) {
      setName(saved.name); setBaseId(saved.baseId); setSelected([...saved.selected]); setMethod(saved.method); setProfile(saved.profile);
      setTeacherId(saved.teacherId); setTeacherDomain(saved.teacherDomain); setDesign(structuredClone(saved.design)); setSuiteId(saved.suiteId);
      setBudget(saved.budget); setReserve(saved.reserve); setDuration(saved.duration); setImportedTraining(saved.importedTraining && structuredClone(saved.importedTraining));
    }
    setRestoredDraftEpoch(workspace.epoch);
  }
  const loadBlueprint = (blueprint: ModelBlueprint) => {
    const order = structuredClone(blueprint.training);
    setName(blueprint.name); setBaseId(order.baseModelId); setSelected(order.packetIds ?? [order.packetId]);
    setMethod(order.modelDesign ? 'custom' : order.recipeId ?? CONTENT.firstTraining.id); setProfile(order.profile ?? 'balanced');
    if (order.modelDesign) setDesign(structuredClone(order.modelDesign));
    setTeacherId(order.teacherModelId ?? ''); setTeacherDomain(order.teacherDomain ?? 'conversation');
    setSuiteId(blueprint.suiteId ?? recommendedDesignEvaluation(order).suiteId); setImportedTraining(order);
  };
  if (draftReady && selection && selection.intentId !== appliedIntent) { loadBlueprint(selection.blueprint); setAppliedIntent(selection.intentId); }
  const savedDraftText = JSON.stringify({ name, baseId, selected, method, profile, teacherId, teacherDomain, design, suiteId,
    budget, reserve, duration, importedTraining } satisfies DelegatedTrainingDraft);
  useEffect(() => {
    if (workspace?.ready && restoredDraftEpoch === workspace.epoch) workspace.setDraft('delegated', JSON.parse(savedDraftText) as DelegatedTrainingDraft);
  }, [savedDraftText, workspace?.ready, workspace?.epoch, workspace?.setDraft, restoredDraftEpoch]);
  const active = activeDevelopmentPlan(game);
  const plans = Object.values(game.slices.models.developmentPlans ?? {}).filter(plan => plan.companyId === owner).sort((a, b) => b.createdWeek - a.createdWeek);
  const latestReview = !active && plans[0]?.status === 'review' ? plans[0] : null;
  const history = plans.filter(plan => plan !== active && plan !== latestReview);
  const feeBudgetCents = parseFixed(budget, 2), cashReserveCents = parseFixed(reserve, 2), weeks = Number(duration);
  const training = importedTraining ?? buildDevelopmentTrainingOrder({ base, packetIds: selected, method, profile, design, teacherModelId: teacherId, teacherDomain });
  const spec: DevelopmentPlanSpec | null = training && feeBudgetCents !== null && cashReserveCents !== null && Number.isSafeInteger(weeks)
    ? { name, training, suiteId, feeBudgetCents, cashReserveCents, deadlineWeek: game.week + weeks } : null;
  const preview = useMemo(() => { try { return !active && spec ? developmentQuote(game, spec, CONTENT) : null; } catch { return null; } }, [active, game, spec]);
  const prepared = useMemo(() => !active && method === 'custom' && spec ? developmentPreviewState(game, spec) : game, [active, method, game, spec]);
  const evaluationAdvice = training ? recommendedDesignEvaluation(training) : null;
  const suggestedSuite = EVALUATION_SUITES.find(s => s.id === evaluationAdvice?.suiteId);
  const evaluationResearch = suggestedSuite?.requiredResearch && !hasResearch(game, owner, suggestedSuite.requiredResearch)
    ? CONTENT.research.find(node => node.id === suggestedSuite.requiredResearch) : undefined;
  const editCurrentTraining = actions?.editTraining && training ? () => actions.editTraining?.({ id: 'delegated-design', name, training, suiteId }) : undefined;
  return <Section title="Development plans" id="development-plans" className="development-plans-panel">
    <div className="strategy-intro"><Route size={22} /><div><h3>Choose the work. Delegate the handoffs.</h3><p>One plan prepares your selected sources, trains your chosen model and runs a held-out evaluation. Time pauses when the result or a limit needs your decision.</p></div></div>
    {latestReview && <PlanCard key={latestReview.id} {...props} plan={latestReview} />}
    {active ? <PlanCard key={active.id} {...props} plan={active} /> : <div className="development-plan-builder">
      {latestReview && <h3>Plan another model</h3>}
      <ModelBlueprintTools training={training} suiteId={suiteId} canAct={canAct} onLoad={loadBlueprint} onEdit={editCurrentTraining} />
      <div className="form-grid"><label>Project name<input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>{!importedTraining && <label>Starting model<select value={base?.id ?? ''} onChange={e => { setBaseId(e.target.value); const model = models.find(m => m.id === e.target.value); if (model) setDesign(current => inheritModelDesignDraft(current, model)); }}>{!base && <option value="">Choose an available model</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>}</div>
      {importedTraining ? <section className="development-imported-design" aria-label="Training design from workbench">
        <h4>{importedTraining.modelDesign?.name || TRAINING_RECIPES.find(r => r.id === importedTraining.recipeId)?.name || 'Training plan'}</h4>
        <p className="small-note">Starting model: {game.slices.models.versions[importedTraining.baseModelId]?.name || 'Unavailable model'}. Sources: {(importedTraining.packetIds ?? [importedTraining.packetId]).map(id => game.slices.data.packets[id]?.name || 'Unavailable data').join(', ')}.</p>
        {importedTraining.modelDesign && <p className="small-note">{importedTraining.modelDesign.mode === 'foundation' ? 'New foundation' : 'Continued training'} · {importedTraining.modelDesign.parameterMillions / 1000}B parameters · {importedTraining.modelDesign.sparsityBps / 100}% sparse · {(importedTraining.modelDesign.computeBudgetCUw / 1e9).toFixed(1)} CUw budget.</p>}
        <p className="small-note">All training choices are retained, including any workspace, checkpoints, replay or curriculum. Use “Edit in training workbench” to change this design, then delegate it again.</p>
      </section> : <>
      <fieldset className="development-datasets"><legend>Training sources</legend><p>Selected raw data is prepared automatically. Owned prepared sources are reused.</p>{packets.map(packet => <label key={packet.id}><input type="checkbox" checked={selected.includes(packet.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, packet.id] : ids.filter(id => id !== packet.id))} /><span><strong>{packet.name}</strong><small>{packet.prepared ? 'Ready to use' : 'Needs preparation'} · Quality {packet.qualityBps / 100}% · {packet.rawUnits.toLocaleString()} units</small></span></label>)}<a href="#data">Browse all datasets and skill coverage</a></fieldset>
      <label className="development-method">Training method<select value={method} onChange={e => setMethod(e.target.value)}><option value="custom">Design a custom model</option>{TRAINING_RECIPES.filter(item => !item.id.startsWith('custom-model-')).map(recipe => <option key={recipe.id} value={recipe.id} disabled={!!recipe.requiredResearch && !hasResearch(game, owner, recipe.requiredResearch)}>{recipe.name}{recipe.requiredResearch && !hasResearch(game, owner, recipe.requiredResearch) ? ' · requires ' + (CONTENT.research.find(node => node.id === recipe.requiredResearch)?.name ?? recipe.requiredResearch) : ''}</option>)}</select></label>
      {method !== 'custom' && <><p className="small-note">{recipe?.description}</p>{(recipe?.kind === 'adaptation' || recipe?.kind === 'foundation') && <label className="development-method">Training approach<select value={profile} onChange={e => setProfile(e.target.value as TrainingProfile)}>{Object.entries(TRAINING_PROFILES).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><span className="small-note">{TRAINING_PROFILES[profile].description}</span></label>}</>}
      {recipe?.kind === 'distillation' && <div className="form-grid"><label>Teacher model<select value={teacherId} onChange={e => setTeacherId(e.target.value)}><option value="">Choose a tested teacher</option>{models.filter(model => model.id !== base?.id).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Skill to distill<select value={teacherDomain} onChange={e => setTeacherDomain(e.target.value as CapabilityDomain)}>{(['conversation', 'documents', 'coding', 'tools'] as const).map(domain => <option key={domain} value={domain}>{domain[0].toUpperCase() + domain.slice(1)}</option>)}</select></label></div>}
      {recipe?.kind === 'synthetic' && <p className="callout">Select exactly one accepted, audited synthetic dataset above. This method reuses that packet’s reviewed target skill; choose a student different from its teacher.</p>}
      {method === 'custom' && base && <ModelDesigner game={prepared} baseModelId={base.id} packetIds={selected} value={design} onChange={setDesign} canAct={canAct} />}
      </>}
      {evaluationAdvice && <div className="development-evaluation-advice"><p><strong>Recommended test: {suggestedSuite?.name}.</strong> {evaluationAdvice.reason}</p>
        {evaluationResearch && <p>Unlock {evaluationResearch.name} to use this test. {actions?.openResearch && <button type="button" className="training-text-action" onClick={() => actions.openResearch?.(evaluationResearch.id)}>View {evaluationResearch.name}</button>}</p>}
        {suiteId !== evaluationAdvice.suiteId && <button type="button" disabled={!canAct || !!evaluationResearch} onClick={() => setSuiteId(evaluationAdvice.suiteId)}>Use {suggestedSuite?.name}</button>}
      </div>}
      <div className="form-grid"><label>Final evaluation<select value={suiteId} onChange={e => setSuiteId(e.target.value as EvaluationSuiteId)}>{EVALUATION_SUITES.filter(s => ['basic-conversation-1', 'expanded-capabilities-1', 'advanced-capabilities-1', 'behavior-cases-1'].includes(s.id)).map(s => <option key={s.id} value={s.id} disabled={!!s.requiredResearch && !hasResearch(game, owner, s.requiredResearch)}>{s.name}{s.requiredResearch && !hasResearch(game, owner, s.requiredResearch) ? ' · requires ' + (CONTENT.research.find(node => node.id === s.requiredResearch)?.name ?? s.requiredResearch) : ''}</option>)}</select></label><label>Finish within (weeks)<input type="number" min="3" max="520" value={duration} onChange={e => setDuration(e.target.value)} /></label><label>Project-fee budget ($)<input inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} /></label><label>Keep cash reserve ($)<input inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} /></label></div>
      {preview && <div className="development-forecast"><Metrics><Metric label="Expected setup fees">{formatMoney(preview.totalFeeCents)}</Metric><Metric label="Training work">{(preview.training.workCUw / 1e9).toFixed(2)} CUw</Metric><Metric label="Training memory">{(preview.training.memoryMU / 1e9).toFixed(2)} MU</Metric><Metric label="Current base bills">{formatMoney(preview.weeklyBaseCostCents)} / week</Metric></Metrics><p>Actual duration depends on your available staff and development compute. <a href="#compute">Review capacity</a> before choosing a deadline.</p></div>}
      <p className="small-note">Your design and data choices are retained. Every stage uses the normal paid simulation and checks its prerequisites again. The plan stops for your review after the test.</p>
      <ActionControl game={game} payload={spec ? { kind: 'start_development_plan', ...spec } : null} label="Start development plan" canAct={canAct} onQueue={onQueue} emptyReason="Choose a model, data, budget and deadline." taskAction="development-plan" />
    </div>}
    {history.length > 0 && <div className="development-history"><h3>Saved plans and results</h3>{(showHistory ? history : history.slice(0, 5)).map(plan => <PlanCard key={plan.id} {...props} plan={plan} />)}{history.length > 5 && <button type="button" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>{showHistory ? 'Show recent plans' : `Show all ${history.length} saved plans`}</button>}</div>}
  </Section>;
}
