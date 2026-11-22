import { TRAINING_RECIPES } from '../content/wave2-lab';
import { trainingBaseUnavailableReason } from '../modules/lab-planner';
import { CONTENT } from '../content/catalog';
import type { CommandPayload, EvaluationReport, GameState, TrainingRun } from '../contracts/types';
import { evaluationSuite } from '../modules/lab-evaluation';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { eligibleModel } from '../modules/product-models';
import { policyReleaseRejection } from '../modules/policy-holdouts';
import type { StudioProject } from './studio';
import { modelScoreHighlights } from './model-score-highlights';
import { getModelDevelopmentRows } from '../modules/model-development';
import { trainingRunProgress } from './selectors';
import { formatUnits } from './math';

/** Session-only navigation focus. Accepted decisions refer to their actual
 * command IDs; this is never serialized into the simulation or its saves. */
export interface StudioJourneyFocus {
  packetId?: string;
  trainingRunId?: string;
  candidateId?: string;
  reportId?: string;
  command?: { id: string; effectiveWeek: number; payload: CommandPayload };
}

export type StudioJourneyAction =
  | { kind: 'prepare'; packetId: string }
  | { kind: 'train'; packetId?: string }
  | { kind: 'continue-training'; baseModelId: string }
  | { kind: 'evaluate'; modelId: string }
  | { kind: 'report'; reportId: string }
  | { kind: 'launch'; modelId: string; reportId?: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'resources' }
  | { kind: 'product' }
  | { kind: 'choose' };

export interface StudioJourney {
  stage: 'prepare' | 'train' | 'evaluate' | 'launch' | 'deployed' | 'sale';
  status: 'ready' | 'queued' | 'working' | 'waiting' | 'blocked' | 'complete' | 'unavailable' | 'rejected' | 'choose';
  title: string;
  detail: string;
  progressBps?: number;
  projectId?: string;
  candidateId?: string;
  packetId?: string;
  reportId?: string;
  primary: { label: string; action: StudioJourneyAction };
  secondary?: { label: string; action: StudioJourneyAction };
  candidates?: { id: string; name: string }[];
}

type OpeningPayload = Extract<CommandPayload, { kind: 'prepare_data' | 'start_training' | 'evaluate_model' | 'deploy_product' }>;
const isOpeningPayload = (payload: CommandPayload): payload is OpeningPayload =>
  payload.kind === 'prepare_data' || payload.kind === 'start_training' || payload.kind === 'evaluate_model'
  || (payload.kind === 'deploy_product' && (payload.productKind ?? 'basic-chat') === 'basic-chat');
const resources: StudioJourney['primary'] = { label: 'Review people and compute', action: { kind: 'resources' } };
const choose: StudioJourney['primary'] = { label: 'Choose a model', action: { kind: 'choose' } };
const progress = (completed: number, required: number) => required > 0 ? Math.max(0, Math.min(10000, Math.floor(completed * 10000 / required))) : 10000;
const commandStage = (payload: OpeningPayload): StudioJourney['stage'] => payload.kind === 'prepare_data' ? 'prepare'
  : payload.kind === 'start_training' ? 'train' : payload.kind === 'evaluate_model' ? 'evaluate' : 'launch';

/** Derived opening guidance only. Reading it does not queue work, advance time,
 * alter a draft, or clone the complete GameState. The task's ordinary command
 * preview remains authoritative for price, memory, rights and other gates. */
export function getStudioJourney(game: GameState, focus: StudioJourneyFocus, projects: readonly StudioProject[]): StudioJourney {
  const owner = game.playerCompanyId;
  const own = <T extends { companyId: string }>(record: Record<string, T>, id: string) => {
    const item = Object.hasOwn(record, id) ? record[id] : undefined;
    return item?.companyId === owner ? item : undefined;
  };
  const packet = (id: string) => {
    const item = Object.hasOwn(game.slices.data.packets, id) ? game.slices.data.packets[id] : undefined;
    return item && (item.companyId === owner || (!item.companyId && item.id === CONTENT.starterData.id)) ? item : undefined;
  };
  const basicChat = Object.values(game.slices.products.offers).find(item => item.companyId === owner && item.kind === 'basic-chat');
  const ownedCommands = game.queuedCommands.filter(item => item.companyId === owner);
  const ownedRuns = Object.values(game.slices.models.trainingRuns).filter(item => item.companyId === owner);
  const ownedEvaluations = Object.values(game.slices.models.evaluationRuns).filter(item => item.companyId === owner);
  const availableCandidates = () => {
    const completed = ownedRuns.filter(item => item.status === 'complete' && own(game.slices.models.versions, item.outputModelId))
      .sort((a, b) => (a.completedWeek ?? a.startedWeek) - (b.completedWeek ?? b.startedWeek) || a.id.localeCompare(b.id));
    return [...new Set(completed.map(item => item.outputModelId))].map(id => ({ id, name: game.slices.models.versions[id].name }));
  };
  const reportsFor = (modelId: string) => Object.values(game.slices.models.reports)
    .filter(item => item.companyId === owner && item.modelId === modelId)
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
  const unavailable = (stage: StudioJourney['stage'], detail: string, candidateId?: string): StudioJourney => {
    const candidates = availableCandidates();
    // Leave the chooser empty even if the previous model still exists: selecting
    // that same model again must be an explicit way to discard a missing report.
    if (candidates.length) return { stage, status: 'unavailable', title: 'Choose an available result', detail,
      candidates, primary: choose };
    const model = candidateId ? own(game.slices.models.versions, candidateId) : undefined;
    return { stage, status: 'unavailable', title: 'This result is unavailable', detail,
      ...(model ? { candidateId: model.id } : {}),
      primary: model ? { label: 'Review the selected model', action: { kind: 'evaluate', modelId: model.id } }
        : { label: 'Plan a training run', action: { kind: 'train' } },
    };
  };
  const projectJourney = (stage: StudioJourney['stage'], title: string, id: string,
    fallback: { detail: string; progressBps: number; paused?: boolean; bottleneck?: string },
    target: Pick<StudioJourney, 'candidateId' | 'packetId'> = {}): StudioJourney => {
    const listed = projects.find(item => item.id === id);
    // This helper is entered only for unfinished underlying records. A stale
    // completed presentation summary cannot turn them into a finished result.
    const project = listed?.status === 'complete' ? undefined : listed;
    const status = fallback.paused ? 'waiting' : project?.status === 'idle' ? 'ready'
      : project?.status ?? (fallback.bottleneck ? 'blocked' : 'waiting');
    const detail = fallback.paused ? 'This project is paused. Open its progress view to resume it.'
      : [project?.detail ?? fallback.detail, project?.bottleneck ?? fallback.bottleneck].filter(Boolean).join(' · ');
    return { stage, status, title, detail, projectId: id, progressBps: project?.progressBps ?? fallback.progressBps, ...target,
      primary: { label: 'View this project', action: { kind: 'project', projectId: id } },
      ...(!fallback.paused && (status === 'blocked' || status === 'waiting') ? { secondary: resources } : {}),
    };
  };

  function firstTrialCapacity() {
    const current = game.slices.compute.fleets[owner].allocation.serving;
    let queued: { serving: number; week: number } | undefined;
    for (const command of ownedCommands) {
      const changes = command.payload.kind === 'apply_studio_plan' ? command.payload.commands : [command.payload];
      for (const change of changes) {
        if (change.kind === 'allocate_compute') queued = { serving: change.serving, week: command.issuedForWeek };
      }
    }
    if (queued && queued.serving === 0) return { needsPlan: false,
      detail: `Your queued plan sets Serving to 0 CU in Week ${queued.week}. Once it takes effect, set Serving above 0 CU in the compute planner so customers can try Basic Chat.` };
    if (current > 0) return null;
    if (queued) return { needsPlan: false,
      detail: `Serving is currently 0 CU. Your plan for ${formatUnits(queued.serving)} serving CU is queued for Week ${queued.week}. Advance the week to apply it.` };
    return { needsPlan: true, detail: 'Serving is set to 0 CU, so customers cannot try Basic Chat. Set Serving above 0 CU in the compute planner. If your GPUs are fully allocated, move some capacity from Development or Research.' };
  }

  function deploymentJourney(deploymentId: string): StudioJourney {
    const deployment = own(game.slices.products.deployments, deploymentId);
    if (!deployment) return unavailable('launch', 'This launch is no longer available. Open the product to check its current status.');
    const product = own(game.slices.products.offers, deployment.productId);
    if (!product || product.kind !== 'basic-chat') return unavailable('launch', 'This action is for a different product. Choose your Basic Chat product to continue.');
    const target = { candidateId: deployment.modelId, projectId: deployment.id };
    if (deployment.status === 'building') return projectJourney('launch', 'Getting Basic Chat ready', deployment.id, {
      detail: 'Your ML team is preparing the launch.', progressBps: progress(deployment.completedStaff, deployment.requiredStaff), bottleneck: deployment.lastBottleneck,
    }, { candidateId: deployment.modelId });
    const viewProduct: StudioJourney['primary'] = { label: 'View Basic Chat', action: { kind: 'product' } };
    const planServing: StudioJourney['primary'] = { label: 'Set serving compute', action: { kind: 'resources' } };
    if (deployment.status === 'ready') {
      const capacity = firstTrialCapacity();
      const opening = deployment.readyWeek === null ? 'Launch work is finished. An opening week has not been set yet.' : `Basic Chat opens in Week ${deployment.readyWeek}.`;
      return { stage: 'launch', status: 'waiting', title: 'Basic Chat is ready to open',
        detail: `${opening} ${capacity?.detail ?? 'Your first sale comes when a customer pays to use it.'}`,
        ...target, progressBps: 10000, primary: capacity?.needsPlan ? planServing : viewProduct, secondary: capacity?.needsPlan ? viewProduct : resources };
    }
    if (game.slices.company.companies[owner].earnedRevenueCents > 0) return { stage: 'sale', status: 'complete',
      title: 'Your first sale!', detail: 'A customer has paid to use your product. Keep an eye on demand, compute and service quality as your lab grows.',
      ...target, progressBps: 10000, primary: viewProduct };
    if (product.status === 'paused') return { stage: 'deployed', status: 'waiting', title: 'Basic Chat is deployed and paused',
      detail: 'Resume Basic Chat to let customers try it. Paid use can follow after their trials.', ...target, progressBps: 10000, primary: viewProduct };
    const capacity = firstTrialCapacity();
    if (capacity) return { stage: 'deployed', status: capacity.needsPlan ? 'blocked' : 'waiting',
      title: capacity.needsPlan ? 'Basic Chat needs serving compute' : 'Serving compute change queued', detail: capacity.detail,
      ...target, progressBps: 10000, primary: capacity.needsPlan ? planServing : viewProduct, secondary: capacity.needsPlan ? viewProduct : undefined };
    return { stage: 'deployed', status: 'complete', title: 'Basic Chat is live',
      detail: 'Basic Chat is open. Leave enough compute for free trials. Customers who subscribe can start paying in a later week.',
      ...target, progressBps: 10000, primary: viewProduct, secondary: resources };
  }

  function candidateJourney(modelId: string, reportId?: string): StudioJourney {
    const model = own(game.slices.models.versions, modelId);
    if (!model) return unavailable('evaluate', 'This model is no longer available. Choose another model.', modelId);
    let report: EvaluationReport | undefined;
    if (reportId) {
      report = own(game.slices.models.reports, reportId);
      if (!report || report.modelId !== modelId) return unavailable('evaluate', 'This report is unavailable or belongs to another model. Choose a report for this model.', modelId);
    }
    if (!report) {
      const pending = ownedCommands.find(item => item.payload.kind === 'evaluate_model' && item.payload.modelId === modelId && isCapabilitySuite(item.payload.suiteId));
      if (pending) return commandJourney({ id: pending.id, effectiveWeek: pending.issuedForWeek, payload: pending.payload });
      const running = ownedEvaluations.find(item => item.modelId === modelId && item.status !== 'complete' && isCapabilitySuite(item.suiteId));
      if (running) return evaluationJourney(running.id);
      const available = reportsFor(modelId).filter(item => isCapabilitySuite(item.suiteId));
      report = available.find(item => item.basicChatEligible) ?? available[0];
    }
    if (!report) {
      const run = model.trainingRunId ? own(game.slices.models.trainingRuns, model.trainingRunId) : undefined;
      const base = run ? own(game.slices.models.versions, run.baseModelId) : undefined;
      const changes = base && run ? modelScoreHighlights(getModelDevelopmentRows(base, model, run.plan?.kind)) : undefined;
      const comparison = changes?.gain ?? changes?.loss;
      return { stage: 'evaluate', status: 'ready', title: `Test ${model.name}`,
        detail: [comparison && base ? `${comparison} compared with ${base.name}.` : '', 'Run a held-out test to see how this version performs on unfamiliar examples.'].filter(Boolean).join(' '),
        candidateId: model.id, primary: { label: 'Test this model', action: { kind: 'evaluate', modelId: model.id } } };
    }
    if (!isCapabilitySuite(report.suiteId)) return { stage: 'evaluate', status: 'ready', title: 'Basic Chat needs a skill test',
      detail: `${evaluationSuite(report.suiteId)?.name ?? 'This evaluation'} does not qualify a Basic Chat launch. Choose a capability evaluation for ${model.name}.`,
      candidateId: model.id, reportId: report.id,
      primary: { label: 'Test this model', action: { kind: 'evaluate', modelId: model.id } },
      secondary: { label: 'View this report', action: { kind: 'report', reportId: report.id } } };
    if (!report.basicChatEligible) return { stage: 'evaluate', status: 'blocked', title: 'This model needs more training',
      detail: `${model.name} has evaluated conversation ${report.capabilityBps.conversation / 100} and reliability ${report.reliabilityBps / 100}. Basic Chat needs ${CONTENT.firstSale.minConversationBps / 100} and ${CONTENT.firstSale.minReliabilityBps / 100}. Testing again does not raise these scores.`,
      candidateId: model.id, reportId: report.id,
      primary: trainingBaseUnavailableReason(game, model.id)
        ? { label: 'Choose a trainable version', action: { kind: 'train' } }
        : { label: 'Improve this version', action: { kind: 'continue-training', baseModelId: model.id } },
      secondary: { label: 'Review this evaluation', action: { kind: 'report', reportId: report.id } } };
    if (basicChat) return { stage: 'launch', status: 'ready', title: 'Basic Chat already exists',
      detail: `${model.name} passed its skill test. Open Basic Chat to review the serving model and release requirements.`,
      candidateId: model.id, reportId: report.id, primary: { label: 'Open existing Basic Chat', action: { kind: 'product' } } };
    const eligible = eligibleModel(game, model.id, owner, 'basic-chat');
    const policyReason = policyReleaseRejection(game, model.id)?.message;
    return { stage: 'launch', status: eligible ? 'ready' : 'blocked', title: eligible ? `${model.name} passed the Basic Chat skill requirements` : 'Check what this model needs to launch',
      detail: eligible ? ['Set a price and chat allowance, then check the launch costs.', firstTrialCapacity()?.detail].filter(Boolean).join(' ')
        : policyReason ?? 'This model is not ready for Basic Chat yet. Open the launch menu to see what it needs.',
      candidateId: model.id, reportId: report.id,
      primary: { label: eligible ? 'Prepare Basic Chat' : 'Review Basic Chat requirements', action: { kind: 'launch', modelId: model.id, reportId: report.id } },
      secondary: { label: 'View this report', action: { kind: 'report', reportId: report.id } } };
  }

  function trainingJourney(runId: string): StudioJourney {
    const run = own(game.slices.models.trainingRuns, runId);
    if (!run) return unavailable('train', 'This training run is no longer available. Choose another run.');
    if (run.status === 'complete') return candidateJourney(run.outputModelId);
    return projectJourney('train', `${run.plan?.recipeName ?? CONTENT.firstTraining.name} in progress`, run.id,
      { ...trainingRunProgress(run), paused: run.status === 'paused', bottleneck: run.lastBottleneck },
      { packetId: run.packetId, candidateId: run.outputModelId });
  }

  function evaluationJourney(runId: string): StudioJourney {
    const run = own(game.slices.models.evaluationRuns, runId);
    if (!run) return unavailable('evaluate', 'This test is no longer available. Choose another test or report.');
    const model = own(game.slices.models.versions, run.modelId);
    if (!model) return unavailable('evaluate', 'The model for this test is no longer available.', run.modelId);
    if (run.status === 'complete') return run.reportId ? candidateJourney(run.modelId, run.reportId)
      : unavailable('evaluate', 'This test is finished, but its report is unavailable. Choose another report.', run.modelId);
    return projectJourney('evaluate', `Evaluating ${model.name} · ${evaluationSuite(run.suiteId)?.name ?? 'Held-out evaluation'}`, run.id,
      { detail: 'Testing needs development compute and Research points.', progressBps: Math.min(progress(run.completedWork, run.requiredWork), progress(run.completedStaff, run.requiredStaff)),
        paused: run.status === 'paused', bottleneck: run.lastBottleneck }, { candidateId: model.id });
  }

  function dataJourney(packetId: string): StudioJourney {
    const data = packet(packetId);
    if (!data) return { stage: 'prepare', status: 'unavailable', title: 'Choose an available dataset',
      detail: 'This dataset is no longer available. Choose another dataset.',
      packetId, primary: { label: 'Choose training data', action: { kind: 'train' } } };
    const pending = ownedCommands.find(item => item.payload.kind === 'prepare_data' && item.payload.packetId === packetId);
    if (pending) return commandJourney({ id: pending.id, effectiveWeek: pending.issuedForWeek, payload: pending.payload });
    const job = Object.values(game.slices.data.preparationJobs).find(item => item.companyId === owner && item.packetId === data.id && item.status !== 'complete');
    if (job) return projectJourney('prepare', `Preparing ${data.name}`, job.id,
      { detail: 'Your data team needs time to prepare this dataset.', progressBps: progress(job.completedStaff, job.requiredStaff), paused: job.status === 'paused', bottleneck: job.lastBottleneck }, { packetId });
    if (data.prepared) return { stage: 'train', status: 'ready', title: `${data.name} is ready for training`,
      detail: 'Choose what to train, pick a method, and check the model, data and cost before starting.',
      packetId, primary: { label: 'Train with this dataset', action: { kind: 'train', packetId } } };
    return { stage: 'prepare', status: 'ready', title: 'Prepare your training data',
      detail: `${data.name} needs to be prepared before training. Check the cost and Data points, then finish preparation to make the data usable.`,
      packetId, primary: { label: 'Prepare this dataset', action: { kind: 'prepare', packetId } } };
  }

  function commandJourney(command: NonNullable<StudioJourneyFocus['command']>): StudioJourney {
    if (game.queuedCommands.some(item => item.id === command.id && item.companyId !== owner)) {
      return unavailable('prepare', 'This action belongs to another company. Choose a task from your own lab.');
    }
    const pending = ownedCommands.find(item => item.id === command.id);
    const payload = pending?.payload ?? command.payload;
    if (!isOpeningPayload(payload)) return unavailable('prepare', 'This action is outside the first-launch guide. Choose a step from the guide to continue.');
    const stage = commandStage(payload);
    const receipt = Object.hasOwn(game.commandReceipts, command.id) ? game.commandReceipts[command.id] : undefined;
    const recovery: StudioJourney['primary'] = payload.kind === 'prepare_data' ? { label: 'Review this dataset', action: { kind: 'prepare', packetId: payload.packetId } }
      : payload.kind === 'start_training' ? { label: 'Review training setup', action: { kind: 'train', packetId: payload.packetId } }
        : payload.kind === 'evaluate_model' ? { label: 'Review this model', action: { kind: 'evaluate', modelId: payload.modelId } }
          : { label: 'Review Basic Chat launch', action: { kind: 'launch', modelId: payload.modelId } };
    if (receipt?.status === 'rejected') return { stage, status: 'rejected', title: `Could not start in Week ${receipt.week}`,
      detail: receipt.reason?.message ?? 'The requirements were not met, so this project could not start. Check the problem and try again.', primary: recovery };
    const projectId = payload.kind === 'prepare_data' ? 'preparation-' + command.id : payload.kind === 'start_training' ? 'training-' + command.id
      : payload.kind === 'evaluate_model' ? 'evaluation-' + command.id : 'deployment:' + command.id;
    const actual = payload.kind === 'prepare_data' ? own(game.slices.data.preparationJobs, projectId)
      : payload.kind === 'start_training' ? own(game.slices.models.trainingRuns, projectId)
        : payload.kind === 'evaluate_model' ? own(game.slices.models.evaluationRuns, projectId) : own(game.slices.products.deployments, projectId);
    if (pending || (!actual && !receipt && game.week < command.effectiveWeek)) {
      const effectiveWeek = pending?.issuedForWeek ?? command.effectiveWeek;
      const label = payload.kind === 'prepare_data' ? 'Data preparation' : payload.kind === 'start_training' ? 'Training' : payload.kind === 'evaluate_model' ? 'Evaluation' : 'Basic Chat deployment';
      let detail = 'Your plan is queued. Work can start next week once its requirements are checked. Resume the game or advance one week when you’re ready.';
      if (payload.kind === 'start_training') {
        const source = own(game.slices.models.versions, payload.baseModelId)?.name ?? 'the selected model';
        const method = TRAINING_RECIPES.find(item => item.id === (payload.recipeId ?? CONTENT.firstTraining.id));
        const base = method?.kind === 'foundation' ? `using ${source} as a reference` : `from ${source}`;
        detail = `${method?.name ?? 'Training'} ${base} will use ${packet(payload.packetId)?.name ?? 'the selected dataset'}. Advance to Week ${effectiveWeek} to start. Follow the run in Projects.`;
      }
      return { stage, status: 'queued', title: `${label} queued for Week ${effectiveWeek}`,
        detail,
        ...(payload.kind === 'prepare_data' || payload.kind === 'start_training' ? { packetId: payload.packetId } : { candidateId: payload.modelId }), primary: resources };
    }
    if (!actual) return { stage, status: 'unavailable', title: 'This project is unavailable',
      detail: 'The planned week has passed, but this project could not be found. Open its menu to check what happened.', primary: recovery };
    if (payload.kind === 'prepare_data') return dataJourney(payload.packetId);
    if (payload.kind === 'start_training') return trainingJourney(projectId);
    if (payload.kind === 'evaluate_model') return evaluationJourney(projectId);
    return deploymentJourney(projectId);
  }

  // Explicit acceptance/rejection and target identity always precede inferred
  // progress. Clear command focus when the player chooses a different result.
  if (focus.command) return commandJourney(focus.command);
  if (focus.reportId) {
    const report = own(game.slices.models.reports, focus.reportId);
    if (!report || (focus.candidateId && focus.candidateId !== report.modelId)) return unavailable('evaluate', 'This report is unavailable or belongs to another model. Choose a report for the model you selected.', focus.candidateId);
    return candidateJourney(report.modelId, report.id);
  }
  if (focus.trainingRunId) return trainingJourney(focus.trainingRunId);
  if (focus.candidateId) return candidateJourney(focus.candidateId);
  if (focus.packetId) return dataJourney(focus.packetId);
  if (basicChat) return deploymentJourney(basicChat.deploymentId);

  const priority = { prepare_data: 0, start_training: 1, evaluate_model: 2, deploy_product: 3 };
  const pending = ownedCommands.filter(item => isOpeningPayload(item.payload))
    .sort((a, b) => priority[(b.payload as OpeningPayload).kind] - priority[(a.payload as OpeningPayload).kind] || a.issuedForWeek - b.issuedForWeek || a.id.localeCompare(b.id))[0];
  if (pending) return commandJourney({ id: pending.id, effectiveWeek: pending.issuedForWeek, payload: pending.payload });
  const evaluation = ownedEvaluations.find(item => item.status !== 'complete' && isCapabilitySuite(item.suiteId));
  if (evaluation) return evaluationJourney(evaluation.id);
  const candidates = availableCandidates();
  if (candidates.length > 1) return { stage: 'evaluate', status: 'choose', title: 'Choose a model to continue',
    detail: 'You have several trained models. Choose one to test or launch, and the guide will follow it.', candidates, primary: choose };
  if (candidates.length === 1) return candidateJourney(candidates[0].id);
  const training = ownedRuns.find((item: TrainingRun) => item.status !== 'complete');
  if (training) return trainingJourney(training.id);
  return dataJourney(focus.packetId ?? CONTENT.starterData.id);
}
