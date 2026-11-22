'use client';

import { ModelChallengeReportDetails } from './model-challenges-panel';

import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import type { TrainingWorkspace } from '../contracts/wave2-lab';
import { DESIGN_RECIPES, TRAINING_WORKSPACES } from '../content/model-designs';
import { useEffect, useState } from 'react';
import type { CapabilityDomain, CommandPayload, DataPacket, EvaluationSuiteId, GameState, TrainingProfile } from '../contracts/types';
import { SCORE_SCALE } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { DATA_CATALOG, EVALUATION_SUITES, TRAINING_PROFILES, TRAINING_RECIPES } from '../content/wave2-lab';
import { VARIANT_RULES } from '../content/wave4-research';
import { formatMoney, formatUnits } from '../core/index';
import { getTrainingPreview, packetSources } from '../modules/lab-planner';
import type { TrainingOptions } from '../modules/lab-planner';
import type { DevelopmentProjectDraft, ManualTrainingDraft, ModelBlueprint } from '../persistence/model-workspace';
import { useModelWorkspace } from './model-workspace-context';
import { recommendedDesignEvaluation } from '../core/model-evaluation-goal';
import { ModelBlueprintTools } from './model-blueprint-tools';
import { getAvailableRoleCapacity } from '../modules/workforce';
import { getResearchView, hasResearch } from '../modules/research';
import { getAppliedResearchView } from '../modules/applied-research';
import { ActionControl, Metric, Metrics, ROLE_LABELS, Section } from './components';
import type { PanelProps } from './panels';
import { researchApplicationLink } from './guide-links';
import { DataQualityPanel } from './data-quality-panel';
import { IndependentHoldoutDetails } from './independent-holdout-details';
import { ModelVersionHistoryChart, TrainingBaselineChart, TrainingForecastChart } from './model-development-charts';
import { trainingBaseUnavailableReason } from '../core/studio-tasks';
import { useContinueTraining } from './studio-interaction-context';
import { ModelPolicyDetails, PolicyHoldoutDetails } from './policy-details';
import { modelAdapterReceipt } from '../modules/adapter-bank';
import { REPLAY_FOCUS_DOMAINS } from '../content/wave15-replay';
import type { ReplayTrainingChoice } from '../contracts/wave15-replay';
import type { TrainingCurriculumChoice } from '../contracts/wave17-curriculum';
import { ReplayReceiptDetails, ReplayTrainingControls } from './replay-training-controls';
import { TrainingCurriculumControls, TrainingCurriculumDetails } from './training-curriculum-controls';
import { TrainingExperimentsPanel } from './training-experiments-panel';
import { inheritedModelRights } from '../modules/model-runtime';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { eligibleModel } from '../modules/product-models';
import { policyReleaseRejection } from '../modules/policy-holdouts';
import { useOpenTrainingDataLibrary, useStudioDataSelection, useStudioModelSelection, useStudioTaskActions, useStudioTaskMode, useStudioTrainingSelection } from './studio-interaction-context';
import { StudioDecisionLayout } from './studio-decision-layout';
import { latestTrainingBase, suggestedTrainingPacket, trainingGoal, TrainingGoalChoices, TrainingStepTitle } from './training-setup';
import { getTrainingDevelopment } from '../modules/model-development';
import type { ModelDesignSpec } from '../contracts/model-design';
import { CUSTOM_MODEL_RECIPES } from '../contracts/model-design';
import { getModelDesignForBase } from '../modules/model-design';
import { ModelDesigner, ModelDesignForecast, ModelDesignDecisionSummary } from './model-designer';
import { applyModelDesignResearch, inheritModelDesignDraft } from './model-design-draft';
import { ModelProfile } from './model-profile';
import { AdvancedSkillsPanel } from './advanced-skills-panel';
import { ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE, ADVANCED_SKILL_LABELS } from '../content/advanced-skills';
import { DevelopmentWorkspaceHeader } from './development-workspace';
import { DataCatalog } from './data-catalog';
import type { AdvancedDomain } from '../contracts/advanced-skills';

const SCORE_LABELS = { conversation: 'Conversation', documents: 'Documents', coding: 'Coding', tools: 'Tool use' };
const ALL_SCORE_LABELS = { ...SCORE_LABELS, ...ADVANCED_SKILL_LABELS };
const BEHAVIOR_LABELS = { useful: 'Useful answer', 'confident-error': 'Confident error', 'false-refusal': 'False refusal', clarification: 'Clarification', 'correct-policy-refusal': 'Correct policy refusal' };
const score = (value: number) => String(value / SCORE_SCALE);
const ownPackets = (game: GameState): DataPacket[] => Object.values(game.slices.data.packets).filter(packet =>
  packet.companyId === game.playerCompanyId || (!packet.companyId && packet.id === CONTENT.starterData.id));
function suggestedDesignPacket(packets: DataPacket[], design: ModelDesignSpec) {
  const relevance = (packet: DataPacket) => Object.entries(design.dataMix).reduce((sum, [domain, weight]) => sum + weight *
    (domain in SCORE_LABELS ? packet.coverageBps[domain as CapabilityDomain] : packet.advancedCoverageBps?.[domain as AdvancedDomain] ?? 0), 0)
    * packet.readyUnits * packet.qualityBps;
  return packets.filter(packet => packet.prepared).sort((a, b) => relevance(b) - relevance(a) || a.id.localeCompare(b.id))[0] ?? packets[0];
}
export function DataPanel({ game, view, canAct, onQueue }: PanelProps) {
  const packets = ownPackets(game);
  const [packetId, setPacketId] = useState(CONTENT.starterData.id);
  const [catalogId, setCatalogId] = useState(DATA_CATALOG[0].id);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const selection = useStudioDataSelection();
  const taskActions = useStudioTaskActions();
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  const [explicitSelection, setExplicitSelection] = useState(false);
  const [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const incoming = selection !== null && selection.intentId !== appliedIntent;
  const incomingPacket = incoming && selection.view !== 'catalog';
  const requestedId = incomingPacket ? selection.packetId : packetId;
  const packet = packets.find(item => item.id === requestedId) ?? (incomingPacket || explicitSelection ? undefined : packets[0]);
  const showCatalog = incoming ? selection.view === 'catalog' : catalogOpen;
  // Consume navigation once; the existing local state owns later player edits.
  if (incoming) {
    if (selection.view !== 'catalog') {
      setPacketId(selection.packetId ?? ''); setExplicitSelection(true); setSelectionProblem(selection.unavailableReason);
    }
    setCatalogOpen(selection.view === 'catalog'); setAppliedIntent(selection.intentId);
  }
  const choosePacket = (id: string) => { setPacketId(id); setExplicitSelection(true); setSelectionProblem(undefined); };
  const dataTabs = <div className="data-workspace-tabs" role="group" aria-label="Data workspace">
    <button type="button" aria-pressed={!showCatalog} onClick={() => setCatalogOpen(false)}>My datasets · {packets.length}</button>
    <button type="button" aria-pressed={showCatalog} onClick={() => setCatalogOpen(true)}>Data catalog · {DATA_CATALOG.length} sources</button>
  </div>;
  if (showCatalog) return <Section title="Data" id="data">{dataTabs}<DataCatalog game={game} catalogId={catalogId} onSelect={setCatalogId} canAct={canAct} onQueue={onQueue} /></Section>;
  if (!packet) return <Section title="Data" id="data">{dataTabs}
    <p className="small-note" role={incoming || explicitSelection ? 'status' : undefined}>{(incoming ? selection.unavailableReason : selectionProblem)
      ?? (incoming || explicitSelection ? 'This dataset is unavailable. Choose another to continue.' : 'Your lab has no training data yet.')}</p>
    {packets.length > 0 && <label className="line-control wide-select" htmlFor="inspect-data">Choose a dataset<select id="inspect-data" value="" onChange={event => choosePacket(event.target.value)}><option value="">Select an available dataset</option>{packets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
  </Section>;
  if (taskActions) {
    const preparation = Object.values(game.slices.data.preparationJobs).find(job => job.companyId === game.playerCompanyId && job.packetId === packet.id && job.status !== 'complete');
    const scheduled = game.queuedCommands.some(command => command.companyId === game.playerCompanyId && command.payload.kind === 'prepare_data' && command.payload.packetId === packet.id);
    const dataCapacity = getAvailableRoleCapacity(game, game.playerCompanyId, 'data');
    const waitingForStaff = !!preparation && (dataCapacity === 0 || (preparation.lastProgress === 0 && !!preparation.lastBottleneck));
    const status = packet.prepared ? 'Ready for training' : preparation ? preparation.status === 'paused' ? 'Preparation paused' : waitingForStaff ? 'Waiting for Data points' : preparation.lastBottleneck ? 'Limited Data points' : preparation.lastProgress > 0 ? 'Preparation in progress' : 'Waiting to begin' : scheduled ? 'Scheduled' : 'Needs preparation';
    return <Section title="Data" id="data" className="studio-data-task">{dataTabs}
      <div className="studio-data-layout">
        <div className="studio-data-setup">
          <h3>Choose your dataset</h3>
          <p className="small-note studio-data-intro">Prepare examples your model can learn from. Preparing data does not train a model.</p>
          {packets.length > 1 && <label className="line-control wide-select" htmlFor="inspect-data">Dataset<select id="inspect-data" value={packet.id} onChange={event => choosePacket(event.target.value)}>{packets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <div className="studio-data-selected" data-selected-packet={packet.id}>
            <h4>{packet.name}</h4>
            <span className="studio-data-state" data-ready={packet.prepared}>{status}</span>
            <Metrics><Metric label="Raw data">{packet.rawUnits} units</Metric><Metric label="Training-ready data">{packet.readyUnits} units</Metric><Metric label="Quality">{score(packet.qualityBps)} / 100</Metric></Metrics>
          </div>
          {packet.policy && <p className="small-note studio-data-license">{packet.policy.pairs} matched allowed/restricted pairs. These teach which requests to allow or refuse; they do not count as skill, general, or behavior data.</p>}
          {packet.feedback && <p className="small-note studio-data-license">Customer feedback from a completed {packet.feedback.mode} review. The customers’ consent and model licenses still apply. Feedback trains specific skills; it does not add general data for a foundation model.</p>}
          <details className="inline-details studio-data-details"><summary>Skills covered, sources, and licenses</summary>
            <Metrics>{Object.entries(SCORE_LABELS).map(([domain, label]) => <Metric label={label + ' coverage'} key={domain}>{score(packet.coverageBps[domain as keyof typeof SCORE_LABELS])}%</Metric>)}{packet.advancedCoverageBps && ADVANCED_DOMAINS.map(domain => <Metric label={ADVANCED_SKILL_LABELS[domain] + ' coverage'} key={domain}>{score(packet.advancedCoverageBps![domain])}%</Metric>)}<Metric label="Behavior examples">{packet.behaviorUnits ?? 0} units</Metric><Metric label="General training data">{packet.broadUnits ?? 0} units</Metric><Metric label="Hosted use">{packet.rights.hosted ? 'Allowed' : 'Unavailable'}</Metric><Metric label="Weight distribution">{packet.rights.weights ? 'Allowed' : 'Unavailable'}</Metric><Metric label="Feedback reuse">{packet.rights.feedback ? 'Allowed' : 'Not included'}</Metric></Metrics>
            <p className="small-note">{packet.parentPacketId ? 'Derived from ' + (game.slices.data.packets[packet.parentPacketId]?.name ?? 'an earlier dataset') + '. Its underlying sources remain the same.' : 'Each source counts once when you combine datasets.'}</p>
            {packet.policy && <p className="small-note">These pairs contain {packet.policy.pairs * 2} labeled cases. Curation improves their quality without adding new pairs.</p>}
          </details>
          <section className="data-quality-options" aria-label="Data quality tools"><h4>Improve data quality</h4>
            {packet.prepared && <details className="inline-details"><summary>Curate this dataset</summary><p className="small-note">Curation creates a better-quality version of this data. Research Data curation first.</p><ActionControl game={game} payload={{ kind: 'curate_data', packetId: packet.id }} label="Start curation" canAct={canAct} onQueue={onQueue} /></details>}
            <DataQualityPanel game={game} packet={packet} canAct={canAct} onQueue={onQueue} />
          </section>
        </div>
        <aside className="studio-data-summary" aria-label="Preparation cost and requirements">
          <h3>{packet.prepared ? 'Ready to use' : 'Cost and requirements'}</h3>
          {!packet.prepared && <ActionControl game={game} payload={{ kind: 'prepare_data', packetId: packet.id }} label="Prepare data" taskAction="prepare-data" canAct={canAct} onQueue={onQueue} />}
          {packet.prepared ? <p className="small-note">Choose this dataset in a training plan. You can reuse it; copies and repeated runs do not add new examples.</p> : <>
            <div className="studio-data-readiness" data-waiting={dataCapacity === 0}>
              <strong>{dataCapacity > 0 ? 'Data points available' : 'Waiting for Data points'}</strong>
              <p className="small-note">{dataCapacity > 0 ? 'Up to ' + formatWorkPoints(dataCapacity) + ' Data points per week. Your team contributes automatically.' : 'You can schedule this work now, but it will wait until your team produces Data points. Check when your next specialist finishes onboarding.'}</p>
              <button type="button" className="studio-surface-button" onClick={taskActions.reviewResources}>Review staff plan</button>
            </div>
            {preparation && <div className="studio-data-progress"><p className="small-note">{formatWorkPoints(preparation.completedStaff)} of {formatWorkPoints(preparation.requiredStaff)} Data points complete.</p><progress value={preparation.completedStaff} max={preparation.requiredStaff} aria-label="Selected dataset preparation progress" />{preparation.lastBottleneck && preparation.status !== 'paused' && <p className="small-note">{preparation.lastBottleneck}</p>}</div>}
            <div className="studio-data-next"><h4>What happens next</h4><p className="small-note">{preparation ? preparation.status === 'paused' ? 'This project is paused. Open the Training bench and resume it from the project list.' : waitingForStaff ? 'Check the staff plan. This project needs Data points to continue.' : 'The team’s Data points prepare this dataset each week. Use it for training once preparation finishes.' : scheduled ? 'Preparation is scheduled for Week ' + (game.week + 1) + '. Advance time when you are ready for staff to begin.' : 'Prepare data to schedule work for Week ' + (game.week + 1) + '. Data points are applied each week; the finished data is reusable for training.'}</p></div>
          </>}
        </aside>
      </div>
    </Section>;
  }
  return <Section title="Data" id="data">{dataTabs}
    {packets.length > 1 && <label className="line-control wide-select" htmlFor="inspect-data">Dataset<select id="inspect-data" value={packet.id} onChange={event => choosePacket(event.target.value)}>{packets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <p className="small-heading">{packet.name}<span className="status-inline">{packet.prepared ? 'Ready' : 'Unprepared'}</span></p>
    <Metrics><Metric label="Raw data">{packet.rawUnits} units</Metric><Metric label="Training-ready data">{packet.readyUnits} units</Metric><Metric label="Quality">{score(packet.qualityBps)} / 100</Metric></Metrics>
    {!packet.prepared && <ActionControl game={game} payload={{ kind: 'prepare_data', packetId: packet.id }} label="Prepare data" canAct={canAct} onQueue={onQueue} />}
    <p className="small-note">{packet.prepared ? 'You can reuse prepared data. Making copies or repeating a run does not add new examples.' : 'Your founder and ready specialists contribute Data points as the weeks pass.'}</p>
    <details className="inline-details"><summary>Skills covered, sources, and licenses</summary>
      <Metrics>{Object.entries(SCORE_LABELS).map(([domain, label]) => <Metric label={label + ' coverage'} key={domain}>{score(packet.coverageBps[domain as keyof typeof SCORE_LABELS])}%</Metric>)}{packet.advancedCoverageBps && ADVANCED_DOMAINS.map(domain => <Metric label={ADVANCED_SKILL_LABELS[domain] + ' coverage'} key={domain}>{score(packet.advancedCoverageBps![domain])}%</Metric>)}<Metric label="Behavior examples">{packet.behaviorUnits ?? 0} units</Metric><Metric label="General training data">{packet.broadUnits ?? 0} units</Metric><Metric label="Hosted use">{packet.rights.hosted ? 'Allowed' : 'Unavailable'}</Metric><Metric label="Weight distribution">{packet.rights.weights ? 'Allowed' : 'Unavailable'}</Metric><Metric label="Feedback reuse">{packet.rights.feedback ? 'Allowed' : 'Not included'}</Metric></Metrics>
      <p className="small-note">{packet.parentPacketId ? 'Derived from ' + (game.slices.data.packets[packet.parentPacketId]?.name ?? 'an earlier dataset') + '. Its underlying sources remain the same.' : 'Each source counts once when you combine datasets.'}</p>
    </details>
    {packet.policy && <p className="small-note">{packet.policy.pairs} matched allowed/restricted pairs · {packet.policy.pairs * 2} labeled cases. Use these pairs to teach which requests to allow or refuse. They do not count as skill, general, or behavior training data. Curation improves their quality without adding new pairs.</p>}
    {packet.feedback && <p className="small-note">Customer feedback from a completed {packet.feedback.mode} review. The customers’ consent and model licenses still apply after curation and training. Feedback helps train specific skills; it does not add general data for building a foundation model. <a href="#lab-projects">Train a candidate</a> to apply it.</p>}
    {packet.prepared && <details className="inline-details"><summary>Curate this dataset</summary><p className="small-note">Curation creates a better-quality version of this data. Research Data curation first.</p><ActionControl game={game} payload={{ kind: 'curate_data', packetId: packet.id }} label="Start curation" canAct={canAct} onQueue={onQueue} /></details>}
    <DataQualityPanel game={game} packet={packet} canAct={canAct} onQueue={onQueue} />

  </Section>;
}

export function LabPanel({ game, view, canAct, onQueue }: PanelProps) {
  const modelWorkspace = useModelWorkspace();
  const [restoredDraftEpoch, setRestoredDraftEpoch] = useState(-1);
  const draftReady = !modelWorkspace || (modelWorkspace.ready && restoredDraftEpoch === modelWorkspace.epoch);
  const versions = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId && !trainingBaseUnavailableReason(game, model.id));
  const packets = ownPackets(game);
  const applied = getAppliedResearchView(game, game.playerCompanyId, CONTENT);
  const [recipeId, setRecipeId] = useState(TRAINING_RECIPES[0].id);
  const [designRoute, setDesignRoute] = useState<'custom' | 'methods' | null>(null);
  const [designDraft, setDesignDraft] = useState<ModelDesignSpec | null>(null);
  const hasCompletedModel = Object.values(game.slices.models.trainingRuns).some(run => run.companyId === game.playerCompanyId && run.status === 'complete');
  const customMode = designRoute === 'custom' || (designRoute === null && hasCompletedModel);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [packetId, setPacketId] = useState<string | null>(null);
  const openDataLibrary = useOpenTrainingDataLibrary();
  const trainingSelection = useStudioTrainingSelection();
  const selection = trainingSelection && 'packetId' in trainingSelection ? trainingSelection : null;
  const taskActions = useStudioTaskActions();
  const focusedTraining = useStudioTaskMode() === 'train-model';
  const [trainingView, setTrainingView] = useState<'guided' | 'advanced'>('guided');
  const [designOpen, setDesignOpen] = useState(false);
  const changeTrainingView = (mode: 'guided' | 'advanced') => { setTrainingView(mode); setDesignOpen(mode === 'advanced'); };
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  const [explicitPacket, setExplicitPacket] = useState(false);
  const [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const incoming = draftReady && selection !== null && selection.intentId !== appliedIntent;
  if (incoming) {
    setPacketId(selection.packetId ?? ''); setExplicitPacket(true);
    setSelectionProblem(selection.unavailableReason); setAppliedIntent(selection.intentId);
  }
  const [extraPackets, setExtraPackets] = useState<string[]>([]);
  const [profile, setProfile] = useState<TrainingProfile | 'reference'>('reference');
  const [workspace, setWorkspace] = useState<TrainingWorkspace | ''>('');
  const [automated, setAutomated] = useState(false);
  const [asAdapter, setAsAdapter] = useState(false);
  const [retentionMode, setRetentionMode] = useState<'none' | 'replay' | 'curriculum'>('none');
  const [replayChoice, setReplayChoice] = useState<ReplayTrainingChoice>({ domain: 'coding', shareBps: 5000, packetIds: [] });
  const [curriculumChoice, setCurriculumChoice] = useState<TrainingCurriculumChoice>({ shareBps: 5000,
    tracks: [{ domain: 'documents', packetIds: [] }, { domain: 'coding', packetIds: [] }] });
  const [architecture, setArchitecture] = useState<'dense' | 'sparse'>('dense');
  const [teacherId, setTeacherId] = useState('');
  const [teacherDomain, setTeacherDomain] = useState<CapabilityDomain>('conversation');
  const [projectDraft, setProjectDraft] = useState<DevelopmentProjectDraft | null>(null);
  if (modelWorkspace?.ready && restoredDraftEpoch !== modelWorkspace.epoch) {
    const saved = modelWorkspace.manual;
    setProjectDraft(saved?.project ? structuredClone(saved.project) : null);
    if (saved) {
      setRecipeId(saved.recipeId); setDesignRoute(saved.designRoute); setDesignDraft(saved.designDraft && structuredClone(saved.designDraft));
      setBaseId(saved.baseId); setPacketId(saved.packetId); setExplicitPacket(saved.explicitPacket); setExtraPackets([...saved.extraPackets]);
      setProfile(saved.profile); setWorkspace(saved.workspace); setAutomated(saved.automated); setAsAdapter(saved.asAdapter);
      setRetentionMode(saved.retentionMode); setReplayChoice(structuredClone(saved.replayChoice)); setCurriculumChoice(structuredClone(saved.curriculumChoice));
      setArchitecture(saved.architecture); setTeacherId(saved.teacherId); setTeacherDomain(saved.teacherDomain);
      setTrainingView(saved.trainingView); setDesignOpen(saved.designOpen);
    }
    setRestoredDraftEpoch(modelWorkspace.epoch);
  }
  if (draftReady && trainingSelection && 'designer' in trainingSelection && trainingSelection.intentId !== appliedIntent) {
    setDesignRoute('custom'); setAppliedIntent(trainingSelection.intentId);
  }
  const savedDraftText = JSON.stringify({ recipeId, designRoute, designDraft, baseId, packetId, explicitPacket, extraPackets,
    profile, workspace, automated, asAdapter, retentionMode, replayChoice, curriculumChoice, architecture, teacherId,
    teacherDomain, trainingView, designOpen, ...(projectDraft ? { project: projectDraft } : {}) } satisfies ManualTrainingDraft);
  useEffect(() => {
    if (modelWorkspace?.ready && restoredDraftEpoch === modelWorkspace.epoch) modelWorkspace.setDraft('manual', JSON.parse(savedDraftText) as ManualTrainingDraft);
  }, [savedDraftText, modelWorkspace?.ready, modelWorkspace?.epoch, modelWorkspace?.setDraft, restoredDraftEpoch]);
  const recipe = TRAINING_RECIPES.find(item => item.id === recipeId) ?? TRAINING_RECIPES[0];
  if (draftReady && trainingSelection && 'designResearchId' in trainingSelection && trainingSelection.intentId !== appliedIntent) {
    const designBase = (baseId === null ? latestTrainingBase(game, versions) : versions.find(model => model.id === baseId)) ?? CONTENT.seedModel;
    const custom = applyModelDesignResearch(designDraft ?? getModelDesignForBase(designBase), trainingSelection.designResearchId);
    if (custom) {
      setDesignRoute('custom'); setDesignDraft(custom);
    } else {
      setDesignRoute('methods');
      const blueprint = DESIGN_RECIPES.find(item => item.requiredResearch === trainingSelection.designResearchId);
      if (blueprint) setRecipeId(blueprint.id);
      const workspaceId = (Object.keys(TRAINING_WORKSPACES) as TrainingWorkspace[]).find(key => TRAINING_WORKSPACES[key].researchId === trainingSelection.designResearchId);
      if (workspaceId) {
        setWorkspace(workspaceId); setDesignOpen(true);
        if (!['adaptation', 'foundation'].includes(recipe.kind)) setRecipeId(TRAINING_RECIPES[0].id);
      }
    }
    setAppliedIntent(trainingSelection.intentId);
  }
  const incomingParent = draftReady && trainingSelection && 'baseModelId' in trainingSelection && trainingSelection.intentId !== appliedIntent ? trainingSelection : null;
  if (incomingParent) {
    setProjectDraft(null);
    setBaseId(incomingParent.baseModelId ?? '');
    const parent = versions.find(model => model.id === incomingParent.baseModelId);
    setDesignDraft(parent ? getModelDesignForBase(parent) : null);
    setDesignRoute(parent?.trainingRunId ? 'custom' : 'methods');
    if (recipe.kind === 'foundation' || recipe.kind === 'distillation') setRecipeId(CONTENT.firstTraining.id);
    setAsAdapter(false);
    setAppliedIntent(incomingParent.intentId);
  }
  const methodRecipes = TRAINING_RECIPES.filter(item => !(CUSTOM_MODEL_RECIPES as readonly string[]).includes(item.id));
  const visibleRecipes = taskActions && trainingView === 'guided' ? methodRecipes.filter(item => trainingGoal(item) === trainingGoal(recipe)) : methodRecipes;
  const missingResearch = recipe.requiredResearch && !hasResearch(game, game.playerCompanyId, recipe.requiredResearch)
    ? CONTENT.research.find(item => item.id === recipe.requiredResearch)?.name ?? recipe.requiredResearch : undefined;
  const profileApplies = recipe.kind === 'adaptation' || recipe.kind === 'foundation';
  const checkpointsApply = recipe.kind !== 'synthetic';
  const latestBase = latestTrainingBase(game, versions);
  const base = baseId === null ? latestBase : versions.find(model => model.id === baseId);
  const modelDesign = designDraft ?? getModelDesignForBase(base ?? CONTENT.seedModel);
  const foundationMode = customMode ? modelDesign.mode === 'foundation' : recipe.kind === 'foundation';
  const chooseBase = (id: string) => {
    setBaseId(id);
    const selected = versions.find(model => model.id === id);
    if (selected && (!designDraft || designDraft.mode === 'adaptation')) {
      setDesignDraft(current => current ? inheritModelDesignDraft(current, selected) : getModelDesignForBase(selected));
    }
  };
  const choosePacket = (id: string) => {
    if (base && baseId === null) setBaseId(base.id);
    setPacketId(id); setExplicitPacket(true); setSelectionProblem(undefined);
  };
  const chooseRecipe = (id: string) => {
    if (base && baseId === null) setBaseId(base.id);
    const nextRecipe = TRAINING_RECIPES.find(item => item.id === id);
    if (packetId === null && nextRecipe) setPacketId(suggestedTrainingPacket(packets, nextRecipe)?.id ?? null);
    setRecipeId(id);
  };
  const baseRun = base?.trainingRunId ? game.slices.models.trainingRuns[base.trainingRunId] : undefined;
  const teachers = applied.teachers.filter(model => model.transferRights && model.id !== base?.id);
  const teacher = teachers.find(model => model.id === teacherId) ?? teachers[teachers.length - 1];
  const effectiveArchitecture = recipe.kind === 'foundation' ? architecture : recipe.kind === 'distillation' ? 'dense' : base?.architecture ?? 'dense';
  const adapterInstalled = applied.rollouts.some(rollout => rollout.method === 'adapter-bank' && rollout.status === 'active');
  const adapterApplies = adapterInstalled && recipe.kind === 'adaptation' && effectiveArchitecture === 'dense';
  const packet = incoming ? packets.find(item => item.id === selection.packetId)
    : packetId === null ? customMode ? suggestedDesignPacket(packets, modelDesign) : suggestedTrainingPacket(packets, recipe) : packets.find(item => item.id === packetId);
  const packetIds = packet ? [packet.id, ...extraPackets.filter(id => id !== packet.id && packets.some(item => item.id === id && item.prepared))] : [];
  const pinDraftInputs = () => {
    if (baseId === null && base) setBaseId(base.id);
    if (packetId === null && packet) setPacketId(packet.id);
  };
  const preparedExtras = packets.filter(item => item.prepared && item.id !== packet?.id);
  const parentPackets = baseRun?.plan?.corpus.packetIds ?? (baseRun ? [baseRun.packetId] : []);
  const previousSources = baseRun ? new Set(baseRun.plan?.corpus.sourceIds ?? packetSources(baseRun.evidence)) : null;
  const selectedSources = packet ? packetSources(packet) : [];
  const newSources = previousSources ? selectedSources.filter(source => !previousSources.has(source)).length : 0;
  const missingParentPackets = parentPackets.filter(id => preparedExtras.some(item => item.id === id) && !packetIds.includes(id));
  const replayUnlocked = hasResearch(game, game.playerCompanyId, 'R4C');
  const replayFocus = REPLAY_FOCUS_DOMAINS[recipe.id];
  const replayAvailable = !!replayFocus && !(asAdapter && adapterApplies);
  const replayDomains = (Object.keys(SCORE_LABELS) as CapabilityDomain[]).filter(domain => !replayFocus?.includes(domain));
  const primarySources = new Set(packetIds.flatMap(id => packetSources(game.slices.data.packets[id])));
  const replayPackets = packets.filter(item => item.prepared && !packetSources(item).some(source => primarySources.has(source)));
  const effectiveReplay: ReplayTrainingChoice = { ...replayChoice,
    domain: replayDomains.includes(replayChoice.domain) ? replayChoice.domain : replayDomains[0],
    packetIds: replayChoice.packetIds.filter(id => replayPackets.some(item => item.id === id)) };
  const effectiveRetention = replayUnlocked && replayAvailable ? retentionMode : 'none';
  const firstCurriculumDomain = replayDomains.includes(curriculumChoice.tracks[0].domain) ? curriculumChoice.tracks[0].domain : replayDomains[0];
  const secondCurriculumDomain = replayDomains.includes(curriculumChoice.tracks[1].domain) && curriculumChoice.tracks[1].domain !== firstCurriculumDomain
    ? curriculumChoice.tracks[1].domain : replayDomains.find(domain => domain !== firstCurriculumDomain)!;
  const firstCurriculumPackets = curriculumChoice.tracks[0].packetIds.filter(id => replayPackets.some(item => item.id === id));
  const firstCurriculumSources = new Set(firstCurriculumPackets.flatMap(id => packetSources(game.slices.data.packets[id])));
  const effectiveCurriculum: TrainingCurriculumChoice = { ...curriculumChoice, tracks: [
    { domain: firstCurriculumDomain, packetIds: firstCurriculumPackets },
    { domain: secondCurriculumDomain, packetIds: curriculumChoice.tracks[1].packetIds.filter(id => replayPackets.some(item => item.id === id && !packetSources(item).some(source => firstCurriculumSources.has(source)))) },
  ] };
  const referenceEligible = recipe.id === 'compact-conversation-adaptation' && base?.id === CONTENT.seedModel.id
    && !!packet && packetSources(packet).join(',') === packetSources(CONTENT.starterData).join(',')
    && packet.rawUnits === CONTENT.starterData.rawUnits && packet.qualityBps === CONTENT.starterData.qualityBps
    && Object.keys(SCORE_LABELS).every(domain => packet.coverageBps[domain as keyof typeof SCORE_LABELS] === CONTENT.starterData.coverageBps[domain as keyof typeof SCORE_LABELS])
    && packetIds.length === 1;
  const effectiveProfile = !profileApplies || (profile === 'reference' && !referenceEligible) ? 'balanced' : profile;
  const choices: TrainingOptions | null = base && packet ? customMode ? {
    baseModelId: base.id, packetId: packet.id, packetIds,
    recipeId: modelDesign.mode === 'foundation' ? 'custom-model-foundation' : 'custom-model-adaptation',
    modelDesign,
  } : { baseModelId: base.id, packetId: packet.id, recipeId: recipe.id, packetIds,
    ...(recipe.kind === 'adaptation' && base.trainingRunId && !(asAdapter && adapterApplies) ? { continueFromParent: true as const } : {}),
    ...(workspace && profileApplies ? { workspace } : {}),
    ...(profileApplies && effectiveProfile !== 'reference' ? { profile: effectiveProfile } : {}),
    ...(checkpointsApply ? { automatedCheckpoints: automated } : {}),
    ...(recipe.kind === 'foundation' ? { architecture: effectiveArchitecture } : {}),
    ...(asAdapter && adapterApplies ? { asAdapter: true } : {}),
    ...(effectiveRetention === 'replay' ? { replay: effectiveReplay } : {}),
    ...(effectiveRetention === 'curriculum' ? { curriculum: effectiveCurriculum } : {}),
    ...(recipe.kind === 'distillation' ? { teacherDomain, ...(teacher ? { teacherModelId: teacher.id } : {}) } : {}) } : null;
  const payload: CommandPayload | null = choices ? { kind: 'start_training', ...choices } : null;
  const forecast = choices ? getTrainingPreview(game, game.playerCompanyId, choices) : null;
  const development = !customMode && choices && forecast ? getTrainingDevelopment(game, choices, forecast) : null;
  const retentionPending = !!((choices?.replay && !forecast?.replay) || (choices?.curriculum && !forecast?.curriculum));
  const baseRights = base ? inheritedModelRights(game, base.id, CONTENT) : null;
  const active = view.labJobs.filter(job => job.status !== 'complete');
  const completed = view.labJobs.filter(job => job.status === 'complete');
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === game.playerCompanyId);
  const useExperiment = (options: TrainingOptions) => {
    choosePacket(options.packetId); setBaseId(options.baseModelId);
    setExtraPackets((options.packetIds ?? []).filter(id => id !== options.packetId));
    if (options.modelDesign) { setDesignRoute('custom'); setDesignDraft(structuredClone(options.modelDesign)); return; }
    setDesignRoute('methods'); setRecipeId(options.recipeId ?? CONTENT.firstTraining.id);
    setWorkspace(options.workspace ?? '');
    setProfile(options.profile ?? 'reference'); setAutomated(!!options.automatedCheckpoints); setAsAdapter(!!options.asAdapter);
    setArchitecture(options.architecture ?? 'dense'); setTeacherId(options.teacherModelId ?? ''); setTeacherDomain(options.teacherDomain ?? 'conversation');
    setRetentionMode(options.curriculum ? 'curriculum' : options.replay ? 'replay' : 'none');
    if (options.replay) setReplayChoice(structuredClone(options.replay));
    if (options.curriculum) setCurriculumChoice(structuredClone(options.curriculum));
  };
  const loadBlueprint = (blueprint: ModelBlueprint, project?: DevelopmentProjectDraft) => {
    useExperiment(structuredClone(blueprint.training));
    const previous = projectDraft ?? modelWorkspace?.delegated;
    setProjectDraft(project ? structuredClone(project) : {
      name: blueprint.name, suiteId: blueprint.suiteId ?? recommendedDesignEvaluation(blueprint.training).suiteId,
      budget: previous?.budget ?? '5000', reserve: previous?.reserve ?? '5000', duration: previous?.duration ?? '32',
      ...(previous?.leadStaffId ? { leadStaffId: previous.leadStaffId } : {}),
      ...(previous?.capacityShareBps !== undefined ? { capacityShareBps: previous.capacityShareBps } : {}),
      objective: blueprint.objective ?? null,
    });
  };
  if (draftReady && trainingSelection && 'blueprint' in trainingSelection && trainingSelection.intentId !== appliedIntent) {
    loadBlueprint(trainingSelection.blueprint, trainingSelection.project);
    setAppliedIntent(trainingSelection.intentId);
  }
  const allocation = game.slices.compute.fleets[game.playerCompanyId]?.allocation;
  const stalledCompute = forecast && packet?.prepared && allocation && (!customMode && recipe.kind === 'distillation' && allocation.serving === 0
    ? 'The teacher needs serving compute to generate examples before training can begin.'
    : allocation.development === 0 ? 'No development compute is assigned. The queued run will wait for GPUs.' : null);
  const canBrowseData = view.progress.dataReady || packets.length > 1;
  const browseData = canBrowseData && (openDataLibrary
    ? <button type="button" className="training-text-action" onClick={() => { if (base && baseId === null) setBaseId(base.id); openDataLibrary(); }}>Browse data catalog</button>
    : <a href="#data">Browse data catalog</a>);
  return <Section title="Develop a model" id="lab-projects">
    <DevelopmentWorkspaceHeader game={game} mode="manual" canAct={canAct}
      onDelegate={draftReady && taskActions?.delegateTraining && payload?.kind === 'start_training' ? () => {
        pinDraftInputs();
        taskActions.delegateTraining?.(payload, projectDraft ? { ...projectDraft, objective: modelWorkspace ? modelWorkspace.developmentGoal ?? null : projectDraft.objective ?? null } : undefined);
      } : undefined} />
    <div className="model-design-route" role="group" aria-label="Training approach">
      <button type="button" aria-pressed={customMode} onClick={() => { pinDraftInputs(); setDesignRoute('custom'); }}>Design your own<small>Shape architecture, skills and responses</small></button>
      <button type="button" aria-pressed={!customMode} onClick={() => { pinDraftInputs(); setDesignRoute('methods'); }}>Training methods<small>Guided training and specialist methods</small></button>
    </div>
    <ModelBlueprintTools training={payload?.kind === 'start_training' ? payload : null} suiteId={projectDraft?.suiteId} canAct={canAct}
      onLoad={blueprint => loadBlueprint(blueprint)} />
    <StudioDecisionLayout focused={focusedTraining} className="studio-training-task training-builder" decisionSummary={customMode && base ? <ModelDesignDecisionSummary game={game} baseModelId={base.id} packetIds={packetIds} value={modelDesign} /> : undefined} summaryLabel="Training forecast and requirements" summary={<>
      <TrainingStepTitle step={4}>Preview this run</TrainingStepTitle>
      {customMode ? base ? <ModelDesignForecast game={game} baseModelId={base.id} packetIds={packetIds} value={modelDesign} />
        : <p className="training-outlook">Choose an available starting model to design its next version.</p> : <>
      {base && <p className="training-forecast-context">{base.name}<span aria-hidden="true"> · </span>{recipe.name}</p>}
      {development?.forecastUsable && !retentionPending && development.rows.length > 0
        ? <TrainingForecastChart rows={development.rows} baselineLabel={recipe.kind === 'foundation' ? 'Reference model' : 'Starting version'} />
        : base && <TrainingBaselineChart model={base} />}
      {development?.explanation ? <p className="training-outlook">{development.explanation}</p>
        : <p className="training-outlook">Choose a starting model and prepared data to preview the next version.</p>}
      {development?.nextAction === 'data' && browseData}
      {development?.nextAction === 'recipe' && <a className="training-text-action" href="#training-recipe" onClick={event => { event.preventDefault(); document.getElementById('training-recipe')?.focus(); }}>Change training method</a>}
      {base && development?.nextAction === 'evaluate' && taskActions && <button type="button" className="training-text-action" onClick={() => taskActions.evaluateModel(base.id)}>Evaluate this version</button>}
      {forecast && <div className="training-run-cost">
        <Metrics><Metric label="Setup fee">{formatMoney(forecast.feeCents)}</Metric><Metric label={retentionPending ? 'Compute before replay' : 'Training compute'}>{formatUnits(forecast.workCUw)} CUw</Metric><Metric label="Memory needed">{formatUnits(forecast.memoryMU)} MU</Metric>{forecast.preparationStaff > 0 && <Metric label="Architecture design">{formatWorkPoints(forecast.preparationStaff)} Research points</Metric>}{forecast.checkpointOverheadWork > 0 && <Metric label="Checkpoint overhead">{formatUnits(forecast.checkpointOverheadWork)} CUw</Metric>}</Metrics>
      </div>}
      </>}
      <ActionControl game={game} payload={payload} label={focusedTraining ? 'Review training run' : 'Start training'} taskAction="train-model" canAct={canAct} onQueue={onQueue} emptyReason={!base ? 'Choose a starting version.' : 'Choose training data for this run.'} />
      <p className="small-note">Staff contribute Design points automatically. After training, test the new version to see whether it is ready to release.</p>
      {stalledCompute && <p className="studio-journey-warning small-note">{stalledCompute}</p>}
      {taskActions ? <button type="button" className="training-text-action" onClick={taskActions.reviewResources}>Review staff and compute</button> : stalledCompute && <a href="#compute">Set development and serving compute</a>}
      {!customMode && forecast && <details className="inline-details training-technical"><summary>Training requirements and evidence</summary>
        <Metrics><Metric label="Potential Design output">{formatWorkPoints(getAvailableRoleCapacity(game, game.playerCompanyId, 'ml'))} points / week</Metric><Metric label="Distinct data">{forecast.corpus.distinctUnits} units</Metric><Metric label="Broad data">{forecast.corpus.broadUnits} units</Metric></Metrics>
      {retentionPending && <p className="small-note">Run the paid Expanded capabilities test on the base model and choose suitable replay data to see the full costs and skill estimates.</p>}
      {forecast.replay && <><ReplayReceiptDetails replay={forecast.replay} title="Projected replay" /><p className="small-note">Candidate rights: hosted use {baseRights?.hosted && forecast.corpus.rights.hosted && forecast.replay.corpus.rights.hosted ? 'allowed' : 'unavailable'}; weight distribution {baseRights?.weights && forecast.corpus.rights.weights && forecast.replay.corpus.rights.weights ? 'allowed' : 'unavailable'}.</p></>}
      {forecast.curriculum && <><TrainingCurriculumDetails curriculum={forecast.curriculum} title="Projected curriculum" /><p className="small-note">Candidate rights: hosted use {baseRights?.hosted && forecast.corpus.rights.hosted && forecast.curriculum.tracks.every(track => track.corpus.rights.hosted) ? 'allowed' : 'unavailable'}; weight distribution {baseRights?.weights && forecast.corpus.rights.weights && forecast.curriculum.tracks.every(track => track.corpus.rights.weights) ? 'allowed' : 'unavailable'}.</p></>}
      {forecast.policy && <div><p className="small-heading">Projected refusal tradeoff</p><Metrics><Metric label="Distinct policy pairs">{forecast.policy.distinctPairs} / 100</Metric><Metric label="Pair quality">{score(forecast.policy.qualityBps)}%</Metric><Metric label="Unnecessary refusals after training">{score(forecast.policy.falseRefusalBps)}%</Metric><Metric label="Restricted compliance after training">{score(forecast.policy.unsafeComplianceBps)}%</Metric></Metrics><p className="small-note">Boundary discrimination takes more training work but preserves more helpful answers. Conservative refusal aims to block more restricted requests, while also refusing more allowed requests. Both have fixed targets for this model; repeating or switching between them cannot stack gains. Run capability and policy tests after training.</p></div>}
        {forecast.notes.map(note => <p className="small-note" key={note}>{note}</p>)}
      </details>}
    </>}>
    <div className="training-form-controls" onChangeCapture={pinDraftInputs}>
    <div className="training-form-start">
      <section className="training-step" aria-label="Starting version">
        <TrainingStepTitle step={1}>{foundationMode ? 'Choose a reference model' : 'Choose a starting version'}</TrainingStepTitle>
        <label className="line-control wide-select" htmlFor="training-base">{foundationMode ? 'Reference model' : 'Parent model'}<select id="training-base" value={base?.id ?? ''} onChange={event => chooseBase(event.target.value)} disabled={!canAct || !versions.length}>{!base && <option value="">Select an available model</option>}{versions.map(model => <option key={model.id} value={model.id}>{model.name} · {model.family}</option>)}</select></label>
        {!base ? <p className="small-note" role="status">This model is unavailable for further training. Choose an available starting version.</p>
          : <p className="small-note">{foundationMode ? 'A foundation starts a new model family. Use this version as a comparison.' : 'A completed run saves a separate version. You can keep using ' + base.name + ' or train another branch from it.'}</p>}
      </section>
      {!customMode && <section className="training-step" aria-label="Training goal">
        <div className="training-step-header"><TrainingStepTitle step={2}>Choose a training goal</TrainingStepTitle>
          {taskActions && <div className="studio-training-view" role="group" aria-label="Training view"><button type="button" aria-pressed={trainingView === 'guided'} onClick={() => changeTrainingView('guided')}>Guided</button><button type="button" aria-pressed={trainingView === 'advanced'} onClick={() => changeTrainingView('advanced')}>Advanced</button></div>}
        </div>
        {taskActions && trainingView === 'guided' && <TrainingGoalChoices game={game} recipe={recipe} canAct={canAct} onChange={chooseRecipe} />}
        <label className="line-control wide-select" htmlFor="training-recipe">{taskActions ? 'Training method' : 'Training recipe'}<select id="training-recipe" value={recipe.id} onChange={event => chooseRecipe(event.target.value)} disabled={!canAct}>{visibleRecipes.map(item => <option key={item.id} value={item.id}>{item.name}{item.requiredResearch && !hasResearch(game, game.playerCompanyId, item.requiredResearch) ? ' · requires ' + (CONTENT.research.find(entry => entry.id === item.requiredResearch)?.name ?? item.requiredResearch) : ''}</option>)}</select></label>
        <p className="small-note">{recipe.description}</p>
        {missingResearch && <p className="studio-journey-warning small-note">Research <strong>{missingResearch}</strong> to unlock this method.</p>}
    {recipe.kind === 'distillation' && <div className="training-preview">
      <label className="line-control wide-select" htmlFor="distillation-teacher">Teacher model<select id="distillation-teacher" value={teacher?.id ?? ''} disabled={!canAct || !teachers.length} onChange={event => setTeacherId(event.target.value)}>{!teachers.length && <option value="">Evaluate a teacher with transfer rights</option>}{teachers.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <label className="line-control wide-select" htmlFor="distillation-domain">Transfer domain<select id="distillation-domain" value={teacherDomain} disabled={!canAct} onChange={event => setTeacherDomain(event.target.value as CapabilityDomain)}>{Object.entries(SCORE_LABELS).map(([domain, label]) => <option key={domain} value={domain}>{label}</option>)}</select></label>
      {teacher && <Metrics><Metric label="Teacher domain score">{score(teacher.capabilityBps[teacherDomain])}</Metric><Metric label="Weight transfer rights">Allowed</Metric></Metrics>}
      <p className="small-note">Choose a compact dense student model and a qualified teacher. The teacher needs a score of at least 60 in the chosen skill, and at least 10 points more than the student’s saved starting score. The teacher uses serving compute to generate examples before the student begins training.</p>
    </div>}
      </section>}
      <section className="training-step" aria-label="Training examples">
        <TrainingStepTitle step={customMode ? 2 : 3}>Choose training data</TrainingStepTitle>
        <label className="line-control wide-select" htmlFor="training-data">Primary dataset<select id="training-data" value={packet?.id ?? ''} onChange={event => choosePacket(event.target.value)} disabled={!canAct || !packets.length}>{!packet && <option value="">Select an available dataset</option>}{packets.map(item => <option key={item.id} value={item.id}>{item.name}{item.prepared ? '' : ' · unprepared'}</option>)}</select></label>
        {!packet && <p className="small-note" role="status">{(incoming ? selection.unavailableReason : selectionProblem) ?? (incoming || explicitPacket ? 'This dataset is unavailable. Choose another to continue.' : 'Acquire a dataset before starting training.')}</p>}
        {packet && <div className={'training-packet ' + (packet.prepared ? 'is-ready' : 'is-unprepared')} data-training-packet={packet.id}>
          <p className="small-heading">{packet.prepared ? 'Data ready for training' : 'Prepare this dataset first'}</p>
          <p className="small-note">{packet.prepared ? packet.readyUnits + ' prepared units · ' + score(packet.qualityBps) + '% quality' : packet.name + ' needs preparation first. Your training plan will be here when you return.'}</p>
          {packet.prepared && previousSources && <p className="training-source-note">{newSources === 0 ? 'The parent run used the same data source.' : newSources === selectedSources.length ? 'New training data for this version.' : 'Includes new examples and sources used by the parent run.'}</p>}
          {!packet.prepared && (taskActions ? <button type="button" className="training-text-action" disabled={!canAct} onClick={() => { pinDraftInputs(); taskActions.prepareData(packet.id); }}>Prepare this dataset</button> : <a href="#data">Prepare this dataset</a>)}
        </div>}
        {packet && preparedExtras.length > 0 && <section className="inline-details training-mix" aria-label="Additional training datasets"><h4>Add prepared datasets · {packetIds.length - 1} selected</h4>
          <fieldset className="plain-fieldset"><legend>Include prepared examples from</legend>{preparedExtras.map(item => <label className="checkbox-control" key={item.id}><input type="checkbox" checked={extraPackets.includes(item.id)} disabled={!canAct} onChange={event => setExtraPackets(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span>{item.name}</span></label>)}</fieldset>
        </section>}
        {packet && missingParentPackets.length > 0 && <button type="button" className="training-text-action" disabled={!canAct} onClick={() => { pinDraftInputs(); setExtraPackets(current => [...new Set([...current, ...missingParentPackets])]); }}>Include data from the parent run ({missingParentPackets.length})</button>}
        {development?.nextAction !== 'data' && browseData}
      </section>
      {customMode && base && <section className="training-step" aria-label="Custom model design">
        <TrainingStepTitle step={3}>Design your model</TrainingStepTitle>
        <ModelDesigner game={game} baseModelId={base.id} packetIds={packetIds} value={modelDesign} onChange={setDesignDraft} canAct={canAct} showForecast={false} />
      </section>}
    </div>
    {!customMode && <details className="inline-details" open={taskActions ? designOpen : undefined} onToggle={taskActions ? event => setDesignOpen(event.currentTarget.open) : undefined}><summary>{taskActions ? 'Advanced settings · model design and training method' : 'Model design and training method'}</summary>
      <Metrics><Metric label="Model family">{recipe.family ?? base?.family ?? '—'}</Metric><Metric label="Architecture">{effectiveArchitecture === 'sparse' ? 'Sparse' : 'Dense'}</Metric></Metrics>
      {recipe.kind === 'foundation' && <label className="line-control wide-select" htmlFor="training-architecture">New foundation design<select id="training-architecture" value={architecture} disabled={!canAct} onChange={event => setArchitecture(event.target.value as 'dense' | 'sparse')}><option value="dense">Dense</option><option value="sparse" disabled={!applied.available.sparse}>Sparse{applied.available.sparse ? '' : ' · requires Sparse architecture'}</option></select></label>}
      <p className="small-note">{recipe.kind === 'distillation' ? 'Distillation teaches one skill to a compact dense student. Its model family sets the maximum score, and both models’ licenses must allow distribution.' : 'Adaptation improves an existing model while keeping its family and design. Foundation training creates a new design with its own skill limits, memory needs, and running costs.'}</p>
      {effectiveArchitecture === 'sparse' && <p className="small-note">Sparse models need less compute but more memory. To train, test, or run one, you need suitable GPUs connected by a fast fabric network.</p>}
      {applied.available.adapterBank && <><label className="checkbox-control"><input type="checkbox" checked={asAdapter && adapterApplies} onChange={event => setAsAdapter(event.target.checked)} disabled={!canAct || !adapterApplies} /><span>Train as an adapter</span></label><p className="small-note">{!adapterInstalled ? 'Install the adapter bank under Applied research first. ' : ''}Dense adaptation can create a specialist adapter for this base model, using 0.25 MU of extra memory. Compatible public products can share the base model on one GPU pool. Training, testing, and customer requests still cost resources.</p></>}
    {profileApplies && <label className="line-control wide-select" htmlFor="training-workspace">Training workspace
      <select id="training-workspace" value={workspace} disabled={!canAct} onChange={event => setWorkspace(event.target.value as TrainingWorkspace | '')}>
        <option value="">Standard workspace</option>
        {Object.entries(TRAINING_WORKSPACES).map(([id, design]) => {
          const unlocked = hasResearch(game, game.playerCompanyId, design.researchId);
          const researchName = CONTENT.research.find(item => item.id === design.researchId)?.name;
          return <option key={id} value={id} disabled={!unlocked}>{design.name} · {design.detail}{unlocked ? '' : ' · research ' + researchName}</option>;
        })}
      </select>
    </label>}
      {recipe.kind !== 'synthetic' && <label className="line-control" htmlFor="training-profile">Training profile<select id="training-profile" value={effectiveProfile} onChange={event => setProfile(event.target.value as TrainingProfile | 'reference')} disabled={!canAct || !profileApplies}>{referenceEligible && <option value="reference">Starter profile</option>}{Object.entries(TRAINING_PROFILES).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label>}
      <p className="small-note">{!profileApplies ? 'This method has fixed targets.' : effectiveProfile === 'reference' ? 'The starter profile has a fixed outcome. The preview shows the scores for the selected data.' : TRAINING_PROFILES[effectiveProfile].description}</p>
      {checkpointsApply && <label className="checkbox-control"><input type="checkbox" checked={automated} onChange={event => setAutomated(event.target.checked)} disabled={!canAct || !hasResearch(game, game.playerCompanyId, 'R3')} /><span>Automated checkpoints {hasResearch(game, game.playerCompanyId, 'R3') ? '' : '· requires Checkpoint automation'}</span></label>}
      <p className="small-note">Checkpoints save models partway through training and cost extra compute. Repeating the same training plan gives the same result.</p>
      {replayUnlocked && <>
        <label className="line-control" htmlFor="training-retention">Skill retention<select id="training-retention" value={effectiveRetention} disabled={!canAct || !replayAvailable} onChange={event => setRetentionMode(event.target.value as 'none' | 'replay' | 'curriculum')}><option value="none">None · ordinary training</option><option value="replay">Preserve one skill</option><option value="curriculum">Preserve two skills</option></select></label>
        {!replayAvailable && <p className="small-note">Skill retention is available for ordinary conversation, document, and coding/tool adaptations. Turn off adapter training to use it.</p>}
        {replayAvailable && effectiveRetention === 'none' && <p className="small-note">Replay can preserve one or two tested skills while you teach another. Each skill you keep needs separate data and extra training work.</p>}
        {effectiveRetention === 'replay' && <ReplayTrainingControls enabled available value={effectiveReplay} domains={replayDomains} packets={replayPackets} canAct={canAct} onEnabled={enabled => setRetentionMode(enabled ? 'replay' : 'none')} onChange={setReplayChoice} showToggle={false} />}
        {effectiveRetention === 'curriculum' && <TrainingCurriculumControls value={effectiveCurriculum} domains={replayDomains} packets={replayPackets} canAct={canAct} onChange={setCurriculumChoice} />}
      </>}
      {!replayUnlocked && hasResearch(game, game.playerCompanyId, 'R4') && <p className="small-note"><a href="#research">Research Replay curricula</a> to preserve one or two evaluated skills while adapting another.</p>}
    </details>}
    {!customMode && <div className="studio-training-experiments"><TrainingExperimentsPanel game={game} choices={choices} canAct={canAct} onUse={useExperiment} /></div>}
    </div>
    </StudioDecisionLayout>
    <div className="studio-training-records" hidden={focusedTraining}>
    {active.length ? <div className="project-list">{active.map(job => <div className="project-row" key={job.id}>
      <div className="project-heading"><strong>{job.title}</strong><span>{job.status === 'paused' ? 'Paused' : score(job.progressBps) + '%'}</span></div>
      <progress value={job.progressBps} max={10000} aria-label={job.title + ' progress'} />
      <p className="small-note">{job.detail}</p>
      {job.bottleneck && <p className="bottleneck">{job.bottleneck}</p>}
      <ActionControl game={game} payload={{ kind: 'set_job_paused', jobId: job.id, paused: job.status !== 'paused' }} label={(job.status === 'paused' ? 'Resume ' : 'Pause ') + job.title.toLowerCase()} canAct={canAct} onQueue={onQueue} compact />
    </div>)}</div> : <p className="small-note">No lab project is running.</p>}
    {completed.length > 0 && <details className="inline-details"><summary>Completed projects · {completed.length}</summary><ul className="completed-projects">{completed.slice(-6).reverse().map(job => <li key={job.id}><strong>{job.title}</strong><p className="small-note">{job.detail}</p></li>)}</ul></details>}
    <details className="inline-details"><summary>Training checkpoints and work</summary>
      {runs.length ? runs.slice(-4).reverse().map(run => <div className="checkpoint-row" key={run.id}><strong>{game.slices.models.versions[run.outputModelId]?.name ?? run.plan?.recipeName ?? CONTENT.firstTraining.name}</strong><Metrics><Metric label="Effective work">{formatUnits(run.completedWork)} / {formatUnits(run.requiredWork)} CUw</Metric><Metric label="Physical work consumed">{formatUnits(run.physicalWork)} CUw</Metric><Metric label="Saved checkpoint">{formatUnits(run.checkpointWork)} CUw</Metric>{run.plan?.deduplication && <><Metric label="Update budget before cleanup">{formatUnits(run.plan.deduplication.originalWorkCUw)} CUw</Metric><Metric label="Update work saved by cleanup">{formatUnits(run.plan.deduplication.savedWorkCUw)} CUw</Metric></>}{run.plan?.teacher && <><Metric label="Teacher generation">{formatUnits(run.teacherWorkCompleted ?? 0)} / {formatUnits(run.plan.teacher.requiredWork)} serving CUw</Metric><Metric label="Teacher physical work">{formatUnits(run.teacherPhysicalWork ?? 0)} CUw</Metric><Metric label="Transfer domain">{SCORE_LABELS[run.plan.teacher.domain]}</Metric></>}</Metrics>{run.plan?.replay && <ReplayReceiptDetails replay={run.plan.replay} title="Saved replay plan" />}{run.plan?.curriculum && <TrainingCurriculumDetails curriculum={run.plan.curriculum} title="Saved curriculum plan" />}<p className="small-note">{run.checkpointModelId ? 'You can inspect the saved checkpoint model.' : 'Checkpoint and final versions appear here as the run advances.'}</p></div>) : <p className="small-note">Pausing keeps completed progress and frees resources for other work. Actual GPU use is tracked separately from training progress.</p>}
    </details>
    </div>
  </Section>;
}

export function ModelsPanel({ game, canAct, onQueue }: PanelProps) {
  const versions = Object.values(game.slices.models.versions)
    .filter(model => model.companyId === game.playerCompanyId)
    .sort((a, b) => (b.createdWeek ?? 0) - (a.createdWeek ?? 0) || a.id.localeCompare(b.id));
  const continueTraining = useContinueTraining();
  const [chosenId, setChosenId] = useState('');
  const [suiteId, setSuiteId] = useState<EvaluationSuiteId>('basic-conversation-1');
  const selection = useStudioModelSelection();
  const taskActions = useStudioTaskActions();
  const focusedEvaluation = useStudioTaskMode() === 'evaluate-model';
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  const [explicitSelection, setExplicitSelection] = useState(false);
  const [chosenReportId, setChosenReportId] = useState<string | undefined>();
  const [selectionProblem, setSelectionProblem] = useState<string | undefined>();
  const incoming = selection !== null && selection.intentId !== appliedIntent;
  const requestedId = incoming ? selection.modelId : chosenId;
  const requestedReportId = incoming ? selection.reportId : chosenReportId;
  const requestedReport = requestedReportId ? game.slices.models.reports[requestedReportId] : undefined;
  const validRequestedReport = requestedReport?.companyId === game.playerCompanyId && requestedReport.modelId === requestedId ? requestedReport : undefined;
  const effectiveSuiteId = incoming && validRequestedReport ? validRequestedReport.suiteId : suiteId;
  const selected = requestedId ? versions.find(model => model.id === requestedId) : incoming || explicitSelection ? undefined : latestTrainingBase(game, versions);
  const suite = EVALUATION_SUITES.find(item => item.id === effectiveSuiteId) ?? EVALUATION_SUITES[0];
  if (incoming) {
    setChosenId(selection.modelId ?? ''); setExplicitSelection(true);
    setChosenReportId(selection.reportId); setSelectionProblem(selection.unavailableReason);
    if (validRequestedReport) setSuiteId(validRequestedReport.suiteId ?? 'basic-conversation-1');
    setAppliedIntent(selection.intentId);
  }
  const chooseModel = (id: string) => { setChosenId(id); setExplicitSelection(true); setChosenReportId(undefined); setSelectionProblem(undefined); };
  if (!selected) return <Section title="Models" id="models"><p className="small-note" role={incoming || explicitSelection ? 'status' : undefined}>{(incoming ? selection.unavailableReason : selectionProblem) ?? (incoming || explicitSelection ? 'This model is unavailable. Choose another to continue.' : 'Your lab has no models yet.')}</p>{versions.length > 0 && <label className="line-control model-select" htmlFor="inspect-model">Choose a model<select id="inspect-model" value="" onChange={event => chooseModel(event.target.value)}><option value="">Select an available model</option>{versions.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>}</Section>;
  const reports = Object.values(game.slices.models.reports).filter(report => report.companyId === game.playerCompanyId && report.modelId === selected.id);
  const report = requestedReportId ? reports.find(item => item.id === requestedReportId && (item.suiteId ?? 'basic-conversation-1') === suite.id) : reports.find(item => (item.suiteId ?? 'basic-conversation-1') === suite.id);
  const advancedReport = reports.find(item => item.suiteId === ADVANCED_EVALUATION_SUITE.id);
  const selectedRun = selected.trainingRunId ? game.slices.models.trainingRuns[selected.trainingRunId] : undefined;
  const advancedBaseline = selectedRun?.plan?.kind !== 'foundation' && selected.parentModelId ? game.slices.models.versions[selected.parentModelId] : undefined;
  const capabilityReport = !!report && isCapabilitySuite(report.suiteId);
  const reportQualifies = capabilityReport && !!report?.basicChatEligible;
  const basicChatEligible = reportQualifies && eligibleModel(game, selected.id, game.playerCompanyId, 'basic-chat');
  const policyBlock = reportQualifies && !basicChatEligible ? policyReleaseRejection(game, selected.id) : undefined;
  const basicChat = Object.values(game.slices.products.offers).find(product => product.companyId === game.playerCompanyId && product.kind === 'basic-chat');
  const adapter = modelAdapterReceipt(game, selected.id);
  const replay = selected.trainingRunId ? game.slices.models.trainingRuns[selected.trainingRunId]?.plan?.replay : undefined;
  const curriculum = selected.trainingRunId ? game.slices.models.trainingRuns[selected.trainingRunId]?.plan?.curriculum : undefined;
  const trainingUnavailable = trainingBaseUnavailableReason(game, selected.id);
  const sourceId = selected.runtimeVariant?.sourceModelId ?? adapter?.baseModelId;
  const trainingSource = trainingUnavailable && sourceId && !trainingBaseUnavailableReason(game, sourceId)
    ? game.slices.models.versions[sourceId] : undefined;
  return <Section title="Models" id="models">
    <StudioDecisionLayout focused={focusedEvaluation} className="studio-evaluation-task" summaryLabel={report ? 'Selected test result' : 'Test cost and requirements'} summary={<>
      <p className="small-heading">{report ? 'Selected test result' : 'Test cost and requirements'}</p>{!report && <Metrics><Metric label="Research points required">{formatWorkPoints(suite.researchStaff)}</Metric><Metric label="Potential Research output">{formatWorkPoints(getAvailableRoleCapacity(game, game.playerCompanyId, 'research'))} points / week</Metric></Metrics>}
      {selected.id === CONTENT.seedModel.id && <p className="small-note">Seed 0 already has its free tutorial report. Train a new model, then return to test it.</p>}
      {selected.id !== CONTENT.seedModel.id && <>
      {!report && <ActionControl game={game} payload={{ kind: 'evaluate_model', modelId: selected.id, suiteId: suite.id }} label="Evaluate model" taskAction="evaluate-model" canAct={canAct} onQueue={onQueue} />}
      {report && (report.challenge ? <ModelChallengeReportDetails report={report} model={selected} /> : report.policy ? <PolicyHoldoutDetails report={report} /> : report.holdout ? <IndependentHoldoutDetails report={report} /> : <div className="evaluation-report"><p className="small-heading">Held-out report · Week {report.week}</p><Metrics><Metric label="Cases passed">{report.passedCases} / {report.cases.length}</Metric><Metric label="Basic Chat release">{basicChatEligible ? 'Eligible' : !capabilityReport ? 'Capability report required' : reportQualifies ? 'Additional release requirement' : 'Requirements not met'}</Metric>{report.outcomes && <><Metric label="Useful answers">{report.outcomes.usefulAnswers}</Metric><Metric label="Confident errors">{report.outcomes.confidentErrors}</Metric><Metric label="False refusals">{report.outcomes.falseRefusals}</Metric><Metric label="Clarifications">{report.outcomes.clarifications}</Metric><Metric label="Correct policy refusals">{report.outcomes.correctPolicyRefusals}</Metric></>}</Metrics><p className="small-note">Testing measures this model. It does not improve it, and repeating the same test will not change the result.</p>{report.suiteId === ADVANCED_EVALUATION_SUITE.id && <AdvancedSkillsPanel model={selected} report={report} title="Held-out advanced skills" />}<details className="inline-details"><summary>Evaluation cases</summary><ol className="case-list">{report.cases.map((item, index) => <li key={item.id}><span>{index + 1}. {ALL_SCORE_LABELS[item.domain]}</span><span>{item.outcome ? BEHAVIOR_LABELS[item.outcome] : item.passed ? 'Passed' : 'Failed'}</span></li>)}</ol></details></div>)}
      {taskActions && report && basicChatEligible && <div className="studio-journey-next" data-launch-model={selected.id} data-launch-report={report.id}>
        <p className="studio-journey-eyebrow">Capability evaluation complete</p><p className="small-heading">{basicChat ? 'Review your Basic Chat product' : 'Ready to review Basic Chat'}</p>
        <p className="small-note">{basicChat ? selected.name + ' has passed the skill requirements. Open Basic Chat to check the model it currently uses.' : 'This capability report qualifies ' + selected.name + ' for Basic Chat. Set the price and check the resources needed before confirming the launch.'}</p>
        <div className="studio-journey-actions"><button type="button" className="studio-surface-button studio-surface-primary" disabled={!canAct && !basicChat} onClick={() => taskActions.launchBasicChat(selected.id, report.id)}>{basicChat ? 'Open Basic Chat' : 'Review Basic Chat launch'}</button></div>
      </div>}
      {taskActions && report && !capabilityReport && <div className="studio-journey-callout"><p className="small-heading">Check skill test results</p><p className="small-note">This {suite.name.toLowerCase()} report does not qualify a Basic Chat release. Open a capability report for {selected.name} to review that next step.</p><div className="studio-journey-actions"><button type="button" className="studio-surface-button" onClick={() => { setSuiteId('basic-conversation-1'); setChosenReportId(undefined); }}>Review Basic conversation</button></div></div>}
      {taskActions && report && capabilityReport && !basicChatEligible && <div className="studio-journey-warning"><p className="small-heading">Basic Chat requirements remain</p><p className="small-note">{policyBlock?.message ?? (reportQualifies ? 'This model still needs to meet some Basic Chat launch requirements.' : 'This model’s test scores are too low for Basic Chat. Train a stronger model; repeating this test will not improve the result.')}</p></div>}
      </>}
      {taskActions && !report && selected.id !== CONTENT.seedModel.id && <div className="studio-decision-resource-help"><p className="small-note">Testing measures this model; it does not train it. Review resources if the test is waiting for staff or compute.</p><button type="button" className="studio-surface-button" onClick={taskActions.reviewResources}>Review staff and compute</button></div>}
    </>}>
    {versions.length > 1 && <label className="line-control model-select" htmlFor="inspect-model">Model version<select id="inspect-model" value={selected.id} onChange={event => chooseModel(event.target.value)}>{versions.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>}
    {requestedReportId && !validRequestedReport && <p className="small-note" role="status">This model’s report is unavailable. Choose a test to continue.</p>}
    <p className="model-name">{selected.name} <span className="muted">/ {selected.family}, {selected.architecture}</span></p>
    <ModelProfile model={selected} compact={focusedEvaluation} />
    {selected.runtimeVariant && <p className="small-note">{VARIANT_RULES[selected.runtimeVariant.kind].name} from {game.slices.models.versions[selected.runtimeVariant.sourceModelId]?.name ?? 'its original model'}. This version has its own skill tradeoffs. Test it before release.</p>}
    {adapter && <p className="small-note">Adapter on the frozen base {game.slices.models.versions[adapter.baseModelId]?.name}. Base weights: {formatUnits(adapter.baseResidentMU)} MU; specialization: {formatUnits(adapter.adapterMemoryMU)} MU. Test each model separately. Compatible public products can share the base model only on the same GPU pool.</p>}
    {selected.planner && <p className="small-note">Trained planner: {score(10000 - selected.planner.currentRepeatBps)}% lower avoidable-repeat chance in bounded workflows. Required reads, checking, permission limits and actual answer quality keep their ordinary rules.</p>}
    {selected.id !== CONTENT.seedModel.id && <>
      <label className="line-control wide-select" htmlFor="evaluation-suite">Evaluation suite<select id="evaluation-suite" value={suite.id} onChange={event => { setSuiteId(event.target.value as EvaluationSuiteId); setChosenReportId(undefined); }} disabled={!canAct}>{EVALUATION_SUITES.map(item => <option key={item.id} value={item.id}>{item.name}{item.requiredResearch && !hasResearch(game, game.playerCompanyId, item.requiredResearch) ? ' · locked' : ''}</option>)}</select></label>
      <p className="small-note">{suite.description}</p>
    </>}
    <ModelVersionHistoryChart game={game} model={selected} />
    {report?.suiteId !== ADVANCED_EVALUATION_SUITE.id && <AdvancedSkillsPanel model={selected} report={advancedReport} baseline={advancedBaseline} />}
    {continueTraining && <div className="model-continue-training">
      {trainingUnavailable ? <>
        <p>{trainingUnavailable}</p>
        {trainingSource && <button type="button" className="studio-surface-button" onClick={() => continueTraining(trainingSource.id)}>Train from {trainingSource.name}</button>}
      </> : <>
        <p>{selected.id === CONTENT.seedModel.id ? 'Use this starting model to train your first version.' : 'Build another version from ' + selected.name + '. You can compare the expected gains before starting.'}</p>
        <button type="button" className="studio-surface-button" onClick={() => continueTraining(selected.id)}>{selected.id === CONTENT.seedModel.id ? 'Train from Seed 0' : 'Continue training this model'}</button>
      </>}
    </div>}
    {selected.id === CONTENT.seedModel.id && <details className="inline-details"><summary>Test Seed 0 · tutorial report</summary><p className="small-note">This starter report is free. Seed 0 can handle some conversation, but is weaker at documents, coding, and tools. Prepare data, train a better model, and test it on unfamiliar cases before launching Basic Chat.</p></details>}

    <details className="inline-details studio-model-records" open={!focusedEvaluation}><summary>Model details and training history</summary>
    <ModelPolicyDetails game={game} model={selected} />
    {replay && <ReplayReceiptDetails replay={replay} title="Skill replay details" />}
    {curriculum && <TrainingCurriculumDetails curriculum={curriculum} title="Training plan details" />}
    <details className="inline-details"><summary>Behavior and version details</summary><Metrics><Metric label="Status">{selected.status}</Metric><Metric label="Resident memory">{formatUnits(selected.residentMU)} MU</Metric>{selected.runtimeVariant && <Metric label="Serving work versus original">{score(selected.runtimeVariant.servingWorkBps)}%</Metric>}{selected.behavior && <><Metric label="Confident-error tendency">{score(selected.behavior.confidentErrorBps)}%</Metric><Metric label="False-refusal tendency">{score(selected.behavior.falseRefusalBps)}%</Metric></>}{selected.createdWeek !== undefined && <Metric label="Created">Week {selected.createdWeek}</Metric>}</Metrics><p className="small-note">{selected.source}</p><p className="small-note">These tendencies describe the model. Behavior tests show how it handles unfamiliar cases. Viewing another model does not change the one serving your customers.</p></details>
    </details>
    </StudioDecisionLayout>
  </Section>;
}

export function ResearchPanel({ game, canAct, onQueue }: PanelProps) {
  const research = getResearchView(game, game.playerCompanyId, CONTENT);
  const available = research.filter(item => item.status === 'available');
  const active = research.filter(item => ['running', 'paused', 'pending'].includes(item.status));
  const complete = research.filter(item => item.status === 'complete');
  const locked = research.filter(item => item.implemented && item.status === 'locked');
  const renderOption = (item: (typeof research)[number]) => <div className="research-option" key={item.id}><p className="small-heading">{item.name}</p><p className="small-note">{item.description}</p><ActionControl game={game} payload={{ kind: 'start_research', researchId: item.id }} label={'Research ' + item.name.toLowerCase()} canAct={canAct} onQueue={onQueue} /></div>;
  return <Section title="Research" id="research">
    <p className="guide-actions"><a href="#research-programs">Open Research programs</a><span className="small-note">Run systems experiments or invest in model architecture.</span></p>
    <p className="small-note">Discoveries unlock new projects. Your team supplies the points. Set a research compute limit so the GPUs can work alongside them.</p>
    {active.map(item => <div className="project-row" key={item.id}><div className="project-heading"><strong>{item.name}</strong><span>{item.status === 'pending' ? 'Available next week' : item.status === 'paused' ? 'Paused' : score(item.progressBps) + '%'}</span></div><progress value={item.progressBps} max={10000} aria-label={item.name + ' progress'} />{item.project && <><Metrics><Metric label="Research work">{formatUnits(item.project.completedWork)} / {formatUnits(item.requiredWork)} CUw</Metric><Metric label={WORK_POINT_LABELS[item.role] + ' points'}>{formatWorkPoints(item.project.completedStaff)} / {formatWorkPoints(item.requiredStaff)} points</Metric></Metrics>{item.project.lastBottleneck && <p className="bottleneck">{item.project.lastBottleneck}</p>}{item.status !== 'pending' && <ActionControl game={game} payload={{ kind: 'set_research_paused', projectId: item.project.id, paused: item.status !== 'paused' }} label={(item.status === 'paused' ? 'Resume ' : 'Pause ') + item.name.toLowerCase()} canAct={canAct} onQueue={onQueue} compact />}</>}</div>)}
    {available.slice(0, 5).map(renderOption)}
    {available.length > 5 && <details className="inline-details"><summary>More available research · {available.length - 5}</summary>{available.slice(5).map(renderOption)}</details>}
    {!available.length && !active.length && <p className="small-note">{locked.length ? 'Meet the requirements below to open another method.' : 'You have completed all available research.'}</p>}
    {locked.length > 0 && <details className="inline-details"><summary>Next research branches · {locked.length}</summary><ul className="research-preview">{locked.map(item => {
      const prerequisites = item.missingPrerequisites.filter(id => CONTENT.research.some(entry => entry.id === id));
      const evidenceRequirements = item.missingPrerequisites.filter(id => !CONTENT.research.some(entry => entry.id === id));
      return <li key={item.id}><strong>{item.name}</strong><span className="small-note">{prerequisites.length > 0 ? 'Requires ' + prerequisites.map(id => CONTENT.research.find(entry => entry.id === id)!.name).join(', ') + '. ' : ''}{formatMoney(item.feeCents)} entry fee.</span>{evidenceRequirements.map(requirement => <span className="small-note" key={requirement}>{requirement}</span>)}<span className="small-note">{item.description}</span></li>;
    })}</ul></details>}
    {complete.length > 0 && <details className="inline-details"><summary>Completed research · {complete.length}</summary><ul className="research-preview">{complete.map(item => {
      const application = researchApplicationLink(item.id);
      return <li key={item.id}><strong>{item.name}</strong><span className="small-note">{item.description}</span>{application && <p className="guide-actions"><a href={application.href}>{application.label}</a></p>}</li>;
    })}</ul></details>}
  </Section>;
}
