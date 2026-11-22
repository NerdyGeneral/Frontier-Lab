'use client';

import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import { useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronRight, Clock3, Compass, Cpu, Database, FlaskConical, Focus, GitBranch, Layers3, List, LockKeyhole, Network, Pause, Play, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { CommandPayload, ComputePool, GameState, ResearchDefinition, ResearchViewItem, RoleAllocation } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { EFFICIENCY_RULES, SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import { formatMoney, formatUnits, mulDiv } from '../core/index';
import { reservedCash } from '../core/selectors';
import { getCompatibleComputePools, getPoolMultiplierBps } from '../modules/compute-pools';
import { hasCapabilityEvaluation } from '../modules/model-runtime';
import { createResearchModule, getResearchView } from '../modules/research';
import { getAvailableRoleCapacity, STAFF_ROLES } from '../modules/workforce';
import { ActionControl, isQueued, ROLE_LABELS } from './components';
import { getUiCommandPreview } from './command-preview';
import { DESIGN_RECIPES, TRAINING_WORKSPACES } from '../content/model-designs';
import { CUSTOMIZATION_RESEARCH, CUSTOMIZATION_RESEARCH_GROUPS, CUSTOMIZATION_RESEARCH_IDS, isCustomizationResearch } from '../content/model-customization-research';
import { researchApplicationLink } from './guide-links';
import { AI_SYSTEM_RESEARCH, AI_SYSTEM_RESEARCH_GROUPS, AI_SYSTEM_RESEARCH_IDS } from '../content/ai-systems';
import { useModelWorkspace } from './model-workspace-context';
import { developmentGoalName, developmentGoalResearch } from './development-goals';
import { ModelResearchPanel } from './model-research-panel';
import { ResearchProgramsPanel } from './research-programs-panel';
import { getModelResearchLevel } from '../modules/model-research';
import { humanizeDesignRequirement } from './model-design-insights';

export interface StudioResearchTreeProps {
  game: GameState;
  canAct: boolean;
  onQueue: (payload: CommandPayload) => void;
  onOpenPanel: (panelId: string, researchId?: string) => void;
  /** The shared task host owns the focused method menu; the map stays mounted. */
  onOpenMethod?: (researchId: string) => void;
  /** Opens the custom editor, preserving any retained design draft. */
  onOpenDesigner?: () => void;
  /** Inspection stays available while the ordinary catalog remains gated. */
  catalogLock?: string | null;
  selection?: { intentId: number; researchId: string } | null;
}

const LANES = [
  { id: 'data', name: 'Data & learning', short: 'Data', icon: Database, ids: ['R2', 'R2A', 'R4', 'R4B', 'R4C', 'S1', 'S2', 'D1', 'D2', 'M8', 'M11'] },
  { id: 'evaluation', name: 'Evaluation & alignment', short: 'Evaluation', icon: FlaskConical, ids: ['R1', 'R1A', 'R5', 'R5A', 'R10A', 'S3', 'M12', 'M13', 'A9', 'A10', 'A11', 'A12'] },
  { id: 'models', name: 'Models & serving', short: 'Models', icon: Layers3, ids: ['R3', 'R3B', 'R7', 'R7A', 'R8', 'R8A', 'R13', 'R14', 'D4', 'D5', 'D6', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'A1', 'A2', 'A3', 'A4'] },
  { id: 'agents', name: 'Retrieval & agents', short: 'Agents', icon: Network, ids: ['R6', 'R6A', 'R9', 'R9A', 'R10', 'R11', 'R11A', 'R15', 'D3', 'M9', 'M10', 'A5', 'A6', 'A7', 'A8'] },
  { id: 'operations', name: 'Operations & silicon', short: 'Operations', icon: Cpu, ids: ['R12', 'R12A', 'R16', 'S4', 'S5', 'S6'] },
] as const;
const CUSTOMIZATION_ICONS = { attention: Network, 'context-precision': Cpu, objectives: FlaskConical, behavior: Sparkles } as const;
const CUSTOMIZATION_LANES = CUSTOMIZATION_RESEARCH_GROUPS.map(group => ({ ...group, icon: CUSTOMIZATION_ICONS[group.id] }));
const SYSTEM_LANES = AI_SYSTEM_RESEARCH_GROUPS.map(group => ({ ...group, icon: group.id === 'experts' ? Network : group.id === 'stateful' ? Layers3 : FlaskConical }));
const isSystemResearch = (id: string) => (AI_SYSTEM_RESEARCH_IDS as readonly string[]).includes(id);
type ResearchScope = 'all' | 'customization' | 'systems';

type TreeStatus = ResearchViewItem['status'] | 'queued' | 'blocked';
type StatusFilter = 'all' | 'available' | 'active' | 'complete' | 'locked';
type TreeNode = Omit<ResearchViewItem, 'status'> & { definition: ResearchDefinition; status: TreeStatus; gate: string | null; lane: number };
type Position = { x: number; y: number; row: number; lane: number };
type Estimate = { label: string; weeks: number | null; explanation: string; roleFte: number; weeklyWork: number; poolName: string | null };
type ResearchCapacity = { roles: RoleAllocation; pools: readonly ComputePool[]; researchCU: number; suspended: boolean };
type ApplicationState = { summary: string; detail: string; entries?: { name: string; status: string; staff?: string; work?: string; note?: string }[] };
const NODE_WIDTH = 188;
const NODE_HEIGHT = 124;
const LANE_WIDTH = 216;
const ROW_HEIGHT = 166;
const GRAPH_TOP = 24;
const STATUS_LABELS: Record<TreeStatus, string> = { planned: 'Planned', locked: 'Locked', available: 'Available', running: 'Researching', paused: 'Paused', pending: 'Ready next week', complete: 'Researched', queued: 'Start queued', blocked: 'Blocked' };
const laneFor = (id: string) => Math.max(0, LANES.findIndex(lane => (lane.ids as readonly string[]).includes(id)));
const percentage = (value: number, total: number) => Math.min(100, Math.max(0, Math.round(value / Math.max(1, total) * 100)));
const validateResearchCommand = createResearchModule(CONTENT).validateCommand!;

/** Read-only graph gates reuse the domain validator without cloning the whole save.
 * The selected action still receives the complete, authoritative engine preview. */
export function getStudioResearchTreeNodes(game: GameState): TreeNode[] {
  const companyId = game.playerCompanyId;
  const company = game.slices.company.companies[companyId];
  const uncommittedCash = company.cashCents - reservedCash(game, companyId);
  const queuedResearch = new Set(game.queuedCommands.flatMap(command => command.companyId === companyId && command.payload.kind === 'start_research' ? [command.payload.researchId] : []));
  return getResearchView(game, companyId, CONTENT).map(item => {
    const definition = CONTENT.research.find(definition => definition.id === item.id)!;
    const queued = queuedResearch.has(item.id);
    let gate: string | null = null;
    if (!item.project && item.status !== 'complete' && !queued) {
      const command = { id: 'preview', companyId, issuedForWeek: game.week + 1, payload: { kind: 'start_research', researchId: item.id } as const };
      gate = company.arrearsCents > 0
        ? 'Unpaid bills have stopped the lab. You can review this run, download your save, or start a new lab.'
        : validateResearchCommand(game, command, CONTENT)?.message
          ?? (item.feeCents > uncommittedCash ? 'You need more available cash. Other queued choices have already set some aside.' : null);
    }
    const status = queued ? 'queued' : item.status === 'available' && gate ? 'blocked' : item.status;
    return { ...item, definition, status, gate, lane: laneFor(item.id) };
  });
}

/** Each estimate considers one role in isolation. Competing projects can change
 * next week's grants, so this is a readiness explanation, not an admission gate. */
export function getStudioResearchCapacity(game: GameState): ResearchCapacity {
  const companyId = game.playerCompanyId;
  return {
    roles: Object.fromEntries(STAFF_ROLES.map(role => [role, getAvailableRoleCapacity(game, companyId, role)])) as RoleAllocation,
    pools: getCompatibleComputePools(game, companyId, { category: 'research', workloadKind: 'general' }, CONTENT),
    researchCU: game.slices.compute.fleets[companyId]?.allocation.research ?? 0,
    suspended: game.slices.company.companies[companyId].arrearsCents > 0,
  };
}

export function getStudioResearchReadiness(node: Pick<ResearchViewItem, 'role' | 'requiredWork' | 'requiredStaff' | 'project'>, capacity: ResearchCapacity) {
  const estimate = estimateResearch(node, capacity.roles, capacity.pools, capacity.researchCU, capacity.suspended);
  const staffRemaining = Math.max(0, (node.project?.requiredStaff ?? node.requiredStaff) - (node.project?.completedStaff ?? 0));
  const computeRemaining = Math.max(0, (node.project?.requiredWork ?? node.requiredWork) - (node.project?.completedWork ?? 0));
  const needsStaff = staffRemaining > 0 && capacity.roles[node.role] <= 0;
  const needsCompute = computeRemaining > 0 && (capacity.researchCU <= 0 || estimate.weeklyWork <= 0);
  const label = capacity.suspended ? 'Unpaid bills have stopped the lab'
    : needsStaff && needsCompute ? 'Needs staff and compute'
      : needsStaff ? 'Needs ' + WORK_POINT_LABELS[node.role] + ' points'
        : needsCompute ? capacity.researchCU <= 0 ? 'Needs research compute' : 'Needs suitable GPUs'
          : 'Resources assigned';
  return { estimate, staffRemaining, computeRemaining, needsStaff, needsCompute, ready: !capacity.suspended && !needsStaff && !needsCompute, label };
}

/** Catalog order within each dependency branch keeps the next link stable.
 * The result includes all ancestors once, with prerequisites before dependants. */
export function getStudioResearchPrerequisiteChain(nodes: readonly TreeNode[], researchId: string): TreeNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>([researchId]);
  const chain: TreeNode[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    node.definition.requires.forEach(visit);
    chain.push(node);
  };
  byId.get(researchId)?.definition.requires.forEach(visit);
  return chain;
}

/** Dependencies determine vertical order; a lane never overlaps two cards. */
function graphLayout(nodes: readonly TreeNode[], laneCount: number = LANES.length) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ranks = new Map<string, number>();
  const rank = (id: string, visiting = new Set<string>()): number => {
    if (ranks.has(id)) return ranks.get(id)!;
    if (visiting.has(id)) return 0;
    const next = new Set(visiting).add(id);
    const parents = byId.get(id)?.definition.requires.filter(parent => byId.has(parent)) ?? [];
    const value = parents.length ? Math.max(...parents.map(parent => rank(parent, next))) + 1 : 0;
    ranks.set(id, value);
    return value;
  };
  nodes.forEach(node => rank(node.id));
  const ordered = [...nodes].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)! || a.lane - b.lane || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const nextRow = Array.from({ length: laneCount }, () => 0);
  const positions = new Map<string, Position>();
  for (const node of ordered) {
    const parents = node.definition.requires.map(id => positions.get(id)).filter((position): position is Position => !!position);
    const row = Math.max(nextRow[node.lane], ...parents.map(parent => parent.row + 1), 0);
    positions.set(node.id, { lane: node.lane, row, x: node.lane * LANE_WIDTH + 14, y: GRAPH_TOP + row * ROW_HEIGHT });
    nextRow[node.lane] = row + 1;
  }
  return { positions, ordered: [...ordered].sort((a, b) => positions.get(a.id)!.row - positions.get(b.id)!.row || a.lane - b.lane), width: laneCount * LANE_WIDTH, height: Math.max(1, ...nextRow) * ROW_HEIGHT + GRAPH_TOP };
}

/** This is a solo, unassisted estimate, not a simulation of next week's grants. */
function estimateResearch(node: Pick<ResearchViewItem, 'role' | 'requiredWork' | 'requiredStaff' | 'project'>, roleCapacity: RoleAllocation, pools: readonly ComputePool[], researchCU: number, suspended: boolean): Estimate {
  const remainingWork = Math.max(0, node.requiredWork - (node.project?.completedWork ?? 0));
  const remainingStaff = Math.max(0, node.requiredStaff - (node.project?.completedStaff ?? 0));
  const roleFte = roleCapacity[node.role];
  let weeklyWork = 0;
  let poolName: string | null = null;
  for (const pool of pools) {
    const physical = Math.min(researchCU, pool.capacityCU);
    const single = pool.ownership === 'owned' ? Math.min(physical, pool.singleRackCU) : physical;
    const singleWork = mulDiv(single, getPoolMultiplierBps(pool, 'research', false, CONTENT, 'general'), 10_000);
    const connectedWork = pool.ownership === 'owned' && pool.rackCount > 1
      ? mulDiv(physical, getPoolMultiplierBps(pool, 'research', true, CONTENT, 'general'), 10_000) : 0;
    const capacity = Math.max(singleWork, connectedWork);
    if (capacity > weeklyWork) { weeklyWork = capacity; poolName = pool.name; }
  }
  const context = { roleFte, weeklyWork, poolName };
  if (suspended) return { ...context, weeks: null, label: 'Operations suspended', explanation: 'Unpaid bills have stopped the lab, so there is no finish estimate.' };
  if (remainingStaff > 0 && roleFte <= 0) return { ...context, weeks: null, label: 'No ' + WORK_POINT_LABELS[node.role] + ' points', explanation: 'Recruit a specialist who produces ' + WORK_POINT_LABELS[node.role] + ' points. New hires contribute after onboarding.' };
  if (remainingWork > 0 && researchCU <= 0) return { ...context, weeks: null, label: 'No research compute assigned', explanation: 'Assign some compute to research to see a finish estimate.' };
  if (remainingWork > 0 && weeklyWork <= 0) return { ...context, weeks: null, label: 'No suitable GPUs online', explanation: 'No suitable GPU pool is ready for this research. Check its capacity, staff, power, and cooling.' };
  const weeks = Math.max(remainingStaff > 0 ? Math.ceil(remainingStaff / roleFte) : 0, remainingWork > 0 ? Math.ceil(remainingWork / weeklyWork) : 0);
  return { ...context, weeks, label: weeks ? '≈' + weeks + ' work ' + (weeks === 1 ? 'week' : 'weeks') : 'Both meters complete', explanation: 'Estimate assumes this is your only project, using all available ' + WORK_POINT_LABELS[node.role].toLowerCase() + ' points and the best suitable GPU pool within your research limit. Other projects, queued changes, and research assistance may change the timing. The discovery unlocks the week after the work finishes.' };
}

export function getStudioResearchApplication(game: GameState, id: string): ApplicationState {
  const companyId = game.playerCompanyId;
  if (isSystemResearch(id)) {
    const definition = AI_SYSTEM_RESEARCH.find(item => item.id === id)!;
    const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.plan?.modelDesign?.system?.researchIds.includes(id));
    return { summary: runs.length ? `${runs.length} system designs · ${runs.filter(run => run.status === 'complete').length} completed` : 'Build a new AI foundation',
      detail: definition.description + ' Use the model designer to compare the operating cost, memory, retention and verification tradeoffs. A discovery unlocks a choice for future paid models.' };
  }
  if (isCustomizationResearch(id)) {
    const definition = CUSTOMIZATION_RESEARCH.find(item => item.id === id)!;
    const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.plan?.modelDesign && run.plan.methods.includes(id));
    return { summary: runs.length ? runs.length + ' custom designs · ' + runs.filter(run => run.status === 'complete').length + ' completed' : 'Choose in the model designer',
      detail: definition.description + ' Research unlocks the option. A new paid training run earns its effects; existing models keep their saved design.' };
  }
  const recipe = DESIGN_RECIPES.find(item => item.requiredResearch === id);
  const workspace = Object.values(TRAINING_WORKSPACES).find(item => item.researchId === id);
  if (recipe || workspace) {
    const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.plan?.methods.includes(id));
    const name = recipe?.name ?? workspace!.name;
    const detail = recipe?.description ?? (workspace!.detail + ' on adaptations and foundations. Choose this workspace when planning the run.');
    const usage = runs.length ? runs.length + (runs.length === 1 ? ' run' : ' runs') : 'Choose in Train a model';
    return { summary: name + ' · ' + usage, detail };
  }
  const methods = Object.entries(SYSTEM_RULES).filter(([, rule]) => rule.research === id);
  if (methods.length) {
    const rollouts = Object.values(game.slices.research.systemRollouts).filter(rollout => rollout.companyId === companyId && methods.some(([method]) => method === rollout.method));
    const installed = rollouts.filter(rollout => rollout.status === 'active').length;
    const assistant = id === 'R15' ? game.slices.research.assistantsByCompany[companyId] : null;
    return {
      summary: installed ? installed + ' system' + (installed === 1 ? '' : 's') + ' installed' : rollouts.length ? 'Installation in progress' : 'Separate installation required',
      detail: assistant ? 'Research assistance is ' + (assistant.enabled ? 'enabled' : 'disabled') + '; it supplied ' + formatWorkPoints(assistant.bonusStaff) + ' extra points in Week ' + assistant.lastWeek + '.' : 'Research unlocks these systems. Installing them takes additional staff work and compute.',
      entries: methods.map(([method, rule]) => {
        const rollout = rollouts.find(item => item.method === method);
        return { name: rule.name, status: !rollout ? 'Not installed' : rollout.status === 'active' ? 'Installed' : rollout.status === 'ready' ? 'Activates Week ' + rollout.readyWeek : 'Installing',
          staff: formatWorkPoints(rollout?.completedStaff ?? 0) + ' / ' + formatWorkPoints(rollout?.requiredStaff ?? rule.staff) + ' Design points',
          work: formatUnits(rollout?.completedWork ?? 0) + ' / ' + formatUnits(rollout?.requiredWork ?? rule.work) + ' development CUw',
          ...(rollout?.lastBottleneck ? { note: rollout.lastBottleneck } : {}) };
      }),
    };
  }
  const variantKind = Object.entries(VARIANT_RULES).find(([, rule]) => rule.research === id)?.[0];
  if (variantKind) {
    const runs = Object.values(game.slices.models.applicationRuns).filter(run => run.companyId === companyId && run.variant === variantKind);
    const completed = runs.filter(run => run.status === 'complete');
    const evaluated = completed.filter(run => hasCapabilityEvaluation(game, run.outputModelId));
    return { summary: completed.length + ' saved variants · ' + evaluated.length + ' evaluated', detail: (runs.length - completed.length) + ' projects still in progress. Test each new version before releasing it. Research leaves your live models as they are.' };
  }
  const efficiencyKind = Object.entries(EFFICIENCY_RULES).find(([, rule]) => rule.research === id)?.[0];
  if (efficiencyKind) {
    const installs = Object.values(game.slices.products.efficiencyInstalls).filter(item => item.companyId === companyId && item.kind === efficiencyKind);
    const current = installs.filter(item => {
      const product = game.slices.products.offers[item.productId];
      return item.status === 'active' && item.enabled && product && game.slices.products.deployments[product.deploymentId]?.modelId === item.modelId
        && (item.kind !== 'evidence-links' || Object.values(game.slices.products.retrievalInstalls).some(retrieval => retrieval.id === item.retrievalId && retrieval.productId === item.productId && retrieval.status === 'active'));
    });
    return { summary: current.length + ' installations in use', detail: installs.length + ' installations in total; ' + installs.filter(item => item.status !== 'active').length + ' still being built or waiting to activate. Each one works with the product and model it was built for.' };
  }
  const suite = { R1: 'expanded-capabilities-1', R1A: 'behavior-cases-1', R10A: 'independent-holdouts-1' }[id];
  if (suite) {
    const reports = Object.values(game.slices.models.reports).filter(report => report.companyId === companyId && report.suiteId === suite);
    const runs = Object.values(game.slices.models.evaluationRuns).filter(run => run.companyId === companyId && run.suiteId === suite && run.status !== 'complete');
    return { summary: reports.length + ' test reports · ' + runs.length + ' unfinished evaluations', detail: 'Run this test on a model to see how it performs on unfamiliar cases. Testing measures the model; training improves it.' };
  }
  if (id === 'R2') {
    const jobs = Object.values(game.slices.data.preparationJobs).filter(job => job.companyId === companyId && job.kind === 'curate');
    return { summary: jobs.filter(job => job.status === 'complete').length + ' curation jobs completed', detail: jobs.filter(job => job.status !== 'complete').length + ' curation jobs still in progress. Each revised dataset keeps its quality score and source history.' };
  }
  if (id === 'R6') {
    const installs = Object.values(game.slices.products.retrievalInstalls).filter(item => item.companyId === companyId);
    return { summary: installs.filter(item => item.status === 'active').length + ' active retrieval indexes', detail: installs.filter(item => item.status !== 'active').length + ' indexes still being built or waiting to activate. Each product needs its own upkeep and good source data.' };
  }
  if (['R9', 'R10', 'R11'].includes(id)) {
    const jobs = Object.values(game.slices.agents.jobs).filter(job => job.companyId === companyId && (id !== 'R10' || job.configuration.verification === 'independent') && (id !== 'R11' || job.configuration.mode === 'bounded'));
    return { summary: jobs.length + ' workflow jobs · ' + jobs.filter(job => job.status === 'complete').length + ' completed', detail: id === 'R10' ? 'These jobs use an independent checker. An agent saying it is done is different from a checked result that earns payment.' : id === 'R11' ? 'These jobs let the agent act within set limits. Each has its own model, allowed tools, step limit, and compute budget.' : 'Each workflow costs work points and compute, follows its tool permissions, and records what happened.' };
  }
  if (id === 'R12') {
    const contracts = Object.values(game.slices.products.commercialContracts).filter(contract => contract.companyId === companyId);
    return { summary: contracts.filter(contract => contract.status === 'active').length + ' active business contracts', detail: contracts.filter(contract => contract.status === 'building' || contract.status === 'ready').length + ' contracts being prepared for delivery. This discovery also unlocks facility projects and release preparation.' };
  }
  if (id === 'R16') {
    const designs = Object.values(game.slices.compute.chipDesigns).filter(design => design.companyId === companyId);
    return { summary: designs.length + ' chip designs · ' + designs.filter(design => design.status === 'validated').length + ' validated', detail: 'Design the chip, test a prototype, order production, then install it. Each step has its own cost.' };
  }
  if (id === 'R14') {
    const projects = Object.values(game.slices.compute.fabricProjects).filter(project => project.companyId === companyId);
    const active = projects.filter(project => project.status === 'active');
    const racks = Object.values(game.slices.compute.racks).filter(rack => rack.companyId === companyId && rack.status === 'installed' && active.some(project => project.location === rack.location));
    const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.plan?.methods.includes('R14'));
    return { summary: active.length + ' active fast-fabric projects · ' + racks.length + ' installed racks at those locations', detail: projects.filter(project => project.status !== 'active').length + ' network upgrades still in progress. ' + runs.length + ' sparse training runs recorded, ' + runs.filter(run => run.status === 'complete').length + ' completed. Each run still needs suitable GPUs and enough free capacity.' };
  }
  if (id === 'S1' || id === 'S2') {
    const jobs = Object.values(game.slices.data.syntheticJobs ?? {}).filter(job => job.companyId === companyId);
    const complete = jobs.filter(job => job.phase === 'complete').length;
    const waiting = jobs.filter(job => job.phase === 'awaiting-review').length;
    const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.recipeId === 'targeted-synthetic');
    return { summary: id === 'S1' ? jobs.length + ' teacher-generation ' + (jobs.length === 1 ? 'job' : 'jobs') + ' · ' + waiting + ' awaiting paid review' : complete + ' audited synthetic ' + (complete === 1 ? 'packet' : 'packets') + ' released', detail: (id === 'S2' ? runs.length + ' targeted synthetic training ' + (runs.length === 1 ? 'run' : 'runs') + ', ' + runs.filter(run => run.status === 'complete').length + ' completed. ' : '') + 'Generate cases, pay for review, remove overlap, then train a model. Each step has its own work and results. Research unlocks the process; it does not create the data.' };
  }
  if (id === 'S3') {
    const canaries = Object.values(game.slices.products.canaryReleases ?? {}).filter(item => item.companyId === companyId);
    return { summary: canaries.length + ' saved canaries · ' + canaries.filter(item => item.status === 'qualified').length + ' qualified for promotion', detail: 'Prepare a release, then test it on 1%, 5%, or 10% of eligible public requests. Set a minimum sample, compute budget, and stop rule. The old and new versions get separate test results. Research unlocks these controls; customers must still use the product.' };
  }
  if (id === 'S4') {
    const orders = Object.values(game.slices.products.privateApplianceOrders ?? {}).filter(item => item.companyId === companyId);
    return { summary: orders.length ? orders.filter(item => item.acceptedWeek !== null).length + ' accepted private appliance · ' + orders.filter(item => item.acceptedWeek === null).length + ' in delivery' : 'One named buyer · separate fabrication and delivery', detail: 'Cedar Records needs a qualified model and runtime plus two compatible accelerator racks. You earn the bundle payment when the customer accepts it. The license and ongoing support have their own terms.' };
  }
  if (id === 'S5') {
    const profiles = Object.values(game.slices.compute.facilitySpecializations ?? {}).filter(item => item.companyId === companyId);
    return { summary: profiles.filter(item => item.status === 'active').length + ' specialized sites · ' + profiles.filter(item => item.status === 'building' || item.status === 'ready').length + ' retrofits in progress', detail: 'Choose one site upgrade at a time: cheaper eligible customer service with less training capacity, or faster training across compatible racks with less serving capacity. A replacement takes effect after the upgrade work finishes.' };
  }
  if (id === 'S6') {
    const designs = Object.values(game.slices.compute.chipDesigns).filter(item => item.companyId === companyId && item.successor);
    return { summary: designs.length + ' successor designs · ' + designs.filter(item => item.status === 'validated').length + ' qualified', detail: 'Choose a qualified first-generation chip to build on. Add +1 MU per useful CU or +10% compatible throughput. Pay for the new design and prototype, then order chips to install or sell to an eligible buyer.' };
  }
  const runs = Object.values(game.slices.models.trainingRuns).filter(run => run.companyId === companyId && run.plan?.methods.includes(id));
  return { summary: runs.length + ' training runs using this method · ' + runs.filter(run => run.status === 'complete').length + ' completed', detail: 'Each training plan lists the methods it uses. A new run still needs suitable data, staff, compute, and a test of the finished model.' };
}

function StatusIcon({ status }: { status: TreeStatus }) {
  const Icon = status === 'complete' ? CheckCheck : status === 'running' ? FlaskConical : status === 'paused' ? Pause : status === 'pending' || status === 'queued' ? Clock3 : status === 'available' ? Sparkles : LockKeyhole;
  return <Icon size={12} aria-hidden="true" />;
}

export function StudioResearchDesignerShortcut({ onOpenDesigner, onOpenPanel }: Pick<StudioResearchTreeProps, 'onOpenDesigner' | 'onOpenPanel'>) {
  return <button type="button" onClick={() => onOpenDesigner ? onOpenDesigner() : onOpenPanel('lab-projects')}>Open model designer</button>;
}

export function StudioResearchTree({ game, canAct, onQueue, onOpenPanel, onOpenMethod, onOpenDesigner, catalogLock, selection }: StudioResearchTreeProps) {
  const uniqueId = useId().replaceAll(':', '');
  const developmentGoal = useModelWorkspace()?.developmentGoal;
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const detailRef = useRef<HTMLElement>(null);
  const fullTreeRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ResearchScope>('all');
  const [laneFilter, setLaneFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<'map' | 'list'>('map');
  const summaryNodes = useMemo(() => getStudioResearchTreeNodes(game), [game]);
  const [selectedId, setSelectedId] = useState(() => summaryNodes.find(node => node.status === 'running' || node.status === 'paused')?.id ?? summaryNodes.find(node => node.status === 'available')?.id ?? summaryNodes[0]?.id ?? 'R1');
  const [consumedSelection, setConsumedSelection] = useState<number | null>(null);
  if (selection && selection.intentId !== consumedSelection) {
    setConsumedSelection(selection.intentId);
    if (summaryNodes.some(node => node.id === selection.researchId)) {
      setSelectedId(selection.researchId); setQuery(''); setLaneFilter('all'); setStatusFilter('all');
      setScope(isSystemResearch(selection.researchId) ? 'systems' : isCustomizationResearch(selection.researchId) ? 'customization' : 'all');
    }
  }
  const selectedSummary = summaryNodes.find(node => node.id === selectedId) ?? summaryNodes[0];
  const selectedPayload = useMemo<CommandPayload | null>(() => !selectedSummary || ['complete', 'pending'].includes(selectedSummary.status) ? null
    : selectedSummary.project ? { kind: 'set_research_paused', projectId: selectedSummary.project.id, paused: selectedSummary.status !== 'paused' }
      : { kind: 'start_research', researchId: selectedSummary.id }, [selectedSummary]);
  const selectedQuote = selectedPayload ? getUiCommandPreview(game, selectedPayload, CONTENT) : null;
  const selectedQueued = selectedPayload ? isQueued(game, selectedPayload) : false;
  const selected = useMemo(() => {
    if (!selectedSummary || !selectedQuote || selectedQueued) return selectedSummary;
    const status = !selectedSummary.project && selectedQuote.accepted ? 'available'
      : selectedSummary.status === 'available' && !selectedQuote.accepted ? 'blocked' : selectedSummary.status;
    return { ...selectedSummary, status, gate: selectedQuote.reason?.message ?? null };
  }, [selectedSummary, selectedQuote, selectedQueued]);
  const nodes = useMemo(() => selected ? summaryNodes.map(node => node.id === selected.id ? selected : node) : summaryNodes, [summaryNodes, selected]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const capacity = useMemo(() => getStudioResearchCapacity(game), [game]);
  const readiness = useMemo(() => new Map(nodes.map(node => [node.id, getStudioResearchReadiness(node, capacity)])), [nodes, capacity]);
  const estimates = useMemo(() => new Map(nodes.map(node => [node.id, readiness.get(node.id)!.estimate])), [nodes, readiness]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const displayLanes = scope === 'customization' ? CUSTOMIZATION_LANES : scope === 'systems' ? SYSTEM_LANES : LANES;
  const inScope = (id: string) => scope === 'all' || (scope === 'systems' ? isSystemResearch(id) : isCustomizationResearch(id));
  const displayLane = (node: TreeNode) => scope === 'customization'
    ? CUSTOMIZATION_LANES.find(lane => (lane.ids as readonly string[]).includes(node.id)) ?? LANES[node.lane]
    : scope === 'systems' ? SYSTEM_LANES.find(lane => (lane.ids as readonly string[]).includes(node.id)) ?? LANES[node.lane] : LANES[node.lane];
  const matches = nodes.filter(node => inScope(node.id)
    && (laneFilter === 'all' || displayLane(node).id === laneFilter)
    && (statusFilter === 'all' || statusFilter === 'available' && node.status === 'available' || statusFilter === 'active' && ['running', 'paused', 'queued', 'pending'].includes(node.status) || statusFilter === 'complete' && node.status === 'complete' || statusFilter === 'locked' && ['locked', 'blocked', 'planned'].includes(node.status))
    && (!normalizedQuery || [node.id, node.name, node.description, displayLane(node).name, WORK_POINT_LABELS[node.role]].join(' ').toLocaleLowerCase().includes(normalizedQuery)));
  const matchIds = new Set(matches.map(node => node.id));
  const filtered = !!normalizedQuery || laneFilter !== 'all' || statusFilter !== 'all';
  const visibleIds = new Set(matchIds);
  const addPrerequisites = (id: string) => {
    for (const prerequisite of byId.get(id)?.definition.requires ?? []) if (!visibleIds.has(prerequisite)
      && inScope(prerequisite)) { visibleIds.add(prerequisite); addPrerequisites(prerequisite); }
  };
  matches.forEach(node => addPrerequisites(node.id));
  const layout = graphLayout(nodes.filter(node => visibleIds.has(node.id)).map(node => scope !== 'all'
    ? { ...node, lane: displayLanes.findIndex(lane => (lane.ids as readonly string[]).includes(node.id)) } : node), displayLanes.length);
  const successors = selected ? nodes.filter(node => node.definition.requires.includes(selected.id)) : [];
  const prerequisiteChain = selected ? getStudioResearchPrerequisiteChain(nodes, selected.id) : [];
  const prerequisiteIds = new Set([selected?.id, ...prerequisiteChain.map(node => node.id)]);
  const relatedIds = new Set([...prerequisiteIds, ...successors.map(node => node.id)]);
  const nextPrerequisite = prerequisiteChain.find(node => node.status !== 'complete');
  const collectionNodes = nodes.filter(node => inScope(node.id));
  const completed = collectionNodes.filter(node => node.status === 'complete').length;
  const active = collectionNodes.filter(node => ['running', 'paused', 'queued', 'pending'].includes(node.status)).length;
  const available = collectionNodes.filter(node => node.status === 'available').length;
  const goalResearchIds = new Set<string>();
  const addGoalPath = (id: string) => { if (goalResearchIds.has(id)) return; goalResearchIds.add(id); byId.get(id)?.definition.requires.forEach(addGoalPath); };
  developmentGoalResearch(developmentGoal).forEach(addGoalPath);
  const availableChoices = collectionNodes.filter(node => node.status === 'available').sort((a, b) => Number(goalResearchIds.has(b.id)) - Number(goalResearchIds.has(a.id)));
  const application = selected ? getStudioResearchApplication(game, selected.id) : null;
  const applicationLink = selected ? researchApplicationLink(selected.id) : undefined;
  const estimate = selected ? estimates.get(selected.id)! : null;

  const focusNode = (id: string, clearFilters = false) => {
    if (clearFilters) { setQuery(''); setLaneFilter('all'); setStatusFilter('all'); }
    if (!inScope(id)) setScope('all');
    setSelectedId(id);
    requestAnimationFrame(() => {
      const mapNode = nodeRefs.current.get('map-' + id);
      const listNode = nodeRefs.current.get('list-' + id);
      const target = mapNode?.getClientRects().length ? mapNode : listNode;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    });
  };
  const selectFromList = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  };
  const handleNodeKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = layout.positions.get(id);
    if (!current) return;
    const candidates = layout.ordered.filter(node => node.id !== id).map(node => ({ id: node.id, position: layout.positions.get(node.id)! }));
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const directional = candidates.filter(({ position }) => vertical ? position.lane === current.lane && (forward ? position.row > current.row : position.row < current.row) : forward ? position.lane > current.lane : position.lane < current.lane);
    directional.sort((a, b) => vertical ? Math.abs(a.position.row - current.row) - Math.abs(b.position.row - current.row) : Math.abs(a.position.lane - current.lane) - Math.abs(b.position.lane - current.lane) || Math.abs(a.position.row - current.row) - Math.abs(b.position.row - current.row));
    const target = event.key === 'Home' ? layout.ordered[0]?.id : event.key === 'End' ? layout.ordered[layout.ordered.length - 1]?.id : directional[0]?.id;
    event.preventDefault();
    if (target) focusNode(target);
  };
  const nodeDetail = (node: TreeNode) => {
    if (node.status === 'complete') return 'Ready to use';
    if (node.status === 'queued') return 'Starts at Week ' + (game.week + 1);
    if (node.status === 'pending') return 'Unlocks Week ' + (node.project?.availableWeek ?? game.week + 1);
    if (node.status === 'running' || node.status === 'paused') return Math.round(node.progressBps / 100) + '% combined research progress';
    if (node.gate) return humanizeDesignRequirement(node.gate);
    const timing = estimates.get(node.id)!;
    return formatMoney(node.feeCents) + ' · ' + (timing.weeks === null ? timing.label : '≈' + timing.weeks + 'w solo estimate');
  };

  if (!selected || !estimate || !application) return <p className="research-tree-empty">No research is available in this catalog.</p>;
  return <section className="research-tree" aria-label="Research pathways" data-view={view} data-scope={scope}>
    <div className="research-tree-intro">
      <div><h2>Research pathways</h2><p>Choose a discovery to see its cost, prerequisites and use.</p></div>
      <dl className="research-tree-totals"><div><dt>Researched</dt><dd>{completed}<span> / {collectionNodes.length}</span></dd></div><div><dt>In progress</dt><dd>{active}</dd></div><div><dt>Available</dt><dd>{available}</dd></div></dl>
    </div>

    <div className="research-tree-scope" role="group" aria-label="Research collection">
      <button type="button" aria-pressed={scope === 'all'} onClick={() => { setScope('all'); setQuery(''); setLaneFilter('all'); setStatusFilter('all'); }}><GitBranch size={16} aria-hidden="true" />All research<span>{nodes.length}</span></button>
      <button type="button" aria-pressed={scope === 'customization'} onClick={() => {
        setScope('customization'); setQuery(''); setLaneFilter('all'); setStatusFilter('all');
        if (!isCustomizationResearch(selected.id)) setSelectedId('M1');
      }}><SlidersHorizontal size={16} aria-hidden="true" />Model customization<span>{CUSTOMIZATION_RESEARCH_IDS.length}</span></button>
      <button type="button" aria-pressed={scope === 'systems'} onClick={() => {
        setScope('systems'); setQuery(''); setLaneFilter('all'); setStatusFilter('all');
        if (!isSystemResearch(selected.id)) setSelectedId('A1');
      }}><Network size={16} aria-hidden="true" />AI systems<span>{AI_SYSTEM_RESEARCH_IDS.length}</span></button>
    </div>
    {scope === 'systems' && <div className="research-tree-customization-intro"><p>Three ways to operate an AI: route specialist experts, preserve a working state, or spend effort searching and verifying. Each path has four discoveries and its own costs.</p><StudioResearchDesignerShortcut onOpenDesigner={onOpenDesigner} onOpenPanel={onOpenPanel} /></div>}
    {developmentGoal && <div className="research-development-goal"><Compass size={16} aria-hidden="true" /><span>Working toward <strong>{developmentGoalName(developmentGoal)}</strong>. Relevant discoveries and prerequisites appear first.</span><StudioResearchDesignerShortcut onOpenDesigner={onOpenDesigner} onOpenPanel={onOpenPanel} /></div>}
    {scope === 'customization' && <div className="research-tree-customization-intro"><p>Choose how your model learns, responds and uses hardware. Select a discovery to see its tradeoff.</p><StudioResearchDesignerShortcut onOpenDesigner={onOpenDesigner} onOpenPanel={onOpenPanel} /></div>}

    {scope === 'all' && <ResearchProgramsPanel game={game} canAct={canAct} onQueue={onQueue} />}
    {scope === 'all' && <details className="research-tree-architecture-program"><summary><span>Architecture program<strong>Level {getModelResearchLevel(game, game.playerCompanyId)}</strong></span><small>Repeatable research · unlock families and improve future designs</small></summary><ModelResearchPanel game={game} canAct={canAct} onQueue={onQueue} /></details>}

    <section className="research-available-now" aria-labelledby={uniqueId + '-available-title'}>
      <div className="research-available-heading"><h3 id={uniqueId + '-available-title'}>Available now</h3><span>{availableChoices.length} {availableChoices.length === 1 ? 'choice' : 'choices'}</span></div>
      {availableChoices.length ? <div className="research-available-grid">{availableChoices.slice(0, 3).map(node => {
        const resources = readiness.get(node.id)!;
        return <article key={node.id} className="research-available-card" data-research-id={node.id} data-ready={resources.ready}>
          <div className="research-available-description"><h4>{node.name}</h4>{developmentGoal && goalResearchIds.has(node.id) && <span className="research-goal-match">For your objective</span>}<p className="research-available-benefit">{node.description.split(/(?<=[.!?])\s/)[0]}</p>
            <p className="research-available-readiness"><strong>{formatMoney(node.feeCents)}</strong><span>{resources.ready ? <Check size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{resources.label}</span></p></div>
          <button type="button" aria-label={'Review ' + node.name.toLowerCase()} onClick={() => onOpenMethod ? onOpenMethod(node.id) : focusNode(node.id, true)}>Review<ArrowRight size={14} aria-hidden="true" /></button>
        </article>;
      })}</div> : <p className="research-available-empty">{completed === collectionNodes.length ? 'Every discovery is researched. Select a method below to put it to work.' : scope === 'customization' ? 'No customization discoveries are unlocked yet. Select any method below to see its prerequisites and the tradeoff it unlocks.' : 'No new discoveries can be scheduled yet. Check the requirements in the full tree, or review your active research.'}</p>}
      {availableChoices.length > 3 && <button type="button" className="research-tree-resource-link" onClick={() => {
        setQuery(''); setLaneFilter('all'); setStatusFilter('available');
        requestAnimationFrame(() => { fullTreeRef.current?.focus({ preventScroll: true }); fullTreeRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); });
      }}>See all {availableChoices.length} available discoveries<ArrowDown size={14} aria-hidden="true" /></button>}
    </section>

    <h3 className="research-tree-full-heading" ref={fullTreeRef} tabIndex={-1}>{scope === 'customization' ? 'Model customization research' : scope === 'systems' ? 'AI systems research' : 'Full research tree'}</h3>

    <div className="research-tree-tools">
      <label className="research-tree-search" htmlFor={uniqueId + '-search'}><Search size={16} aria-hidden="true" /><span className="research-tree-sr-only">Search research</span><input id={uniqueId + '-search'} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a method, role or idea…" /></label>
      <label className="research-tree-filter" htmlFor={uniqueId + '-lane'}><span>Pathway</span><select id={uniqueId + '-lane'} value={laneFilter} onChange={event => setLaneFilter(event.target.value)}><option value="all">All pathways</option>{displayLanes.map(lane => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select></label>
      <label className="research-tree-filter" htmlFor={uniqueId + '-status'}><span>Stage</span><select id={uniqueId + '-status'} value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All stages</option><option value="available">Available</option><option value="active">In progress</option><option value="complete">Researched</option><option value="locked">Locked or blocked</option></select></label>
      <div className="research-tree-view-toggle" role="group" aria-label="Research presentation"><button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}><GitBranch size={14} aria-hidden="true" />Map</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} aria-hidden="true" />List</button></div>
    </div>

    <div className="research-tree-context"><p role="status">{filtered ? matches.length + ' matching ' + (matches.length === 1 ? 'method' : 'methods') : scope === 'customization' ? CUSTOMIZATION_RESEARCH_IDS.length + ' methods across four design pathways' : scope === 'systems' ? '12 discoveries across three operating designs' : nodes.length + ' methods across five pathways'}<span className="research-tree-map-note">{scope !== 'all' ? ' · All prerequisites are linked in the method details and List view.' : filtered && matches.length > 0 ? ' · Required discoveries are also shown.' : ' · Unlock every required discovery first. Select a method to see its cost and start research.'}</span></p><div>{filtered && <button type="button" onClick={() => { setQuery(''); setLaneFilter('all'); setStatusFilter('all'); }}>Clear filters</button>}{matches.length > 0 && filtered && <button type="button" onClick={() => focusNode(matches[0].id)}><Focus size={13} aria-hidden="true" />First match</button>}<a href="#research-tree-details" onClick={event => { event.preventDefault(); detailRef.current?.focus(); detailRef.current?.scrollIntoView({ block: 'nearest' }); }}>Selected method <ArrowDown size={13} aria-hidden="true" /></a></div></div>

    <div className="research-tree-body">
      <div className="research-tree-explorer">
        <div className="research-tree-map-view">
          <div className="research-tree-map-legend"><span><i className="is-complete" />Researched</span><span><i className="is-available" />Available</span><span><i className="is-running" />In progress</span><span><i className="is-locked" />Locked</span><span className="research-tree-keyboard-note">Tab to a method · Arrow keys move · Enter selects</span></div>
          <p className="research-tree-sr-only" id={uniqueId + '-map-help'}>The diagram runs from top to bottom. Use Tab to reach each research button, or arrow keys to move within and between pathways. The List view includes every prerequisite as a text link. Selecting a method highlights its full prerequisite chain and immediate successors.</p>
          <div className="research-tree-map-scroll" tabIndex={0} role="region" aria-label="Scrollable research map" aria-describedby={uniqueId + '-map-help'}>
            {matches.length === 0 ? <div className="research-tree-empty"><Search size={22} aria-hidden="true" /><strong>No matching research</strong><p>Try a method name, role, or a different stage.</p><button type="button" onClick={() => { setScope('all'); setQuery(''); setLaneFilter('all'); setStatusFilter('all'); }}>Show every method</button></div> : <>
              <div className="research-tree-lane-headings" style={{ width: layout.width, gridTemplateColumns: `repeat(${displayLanes.length}, ${LANE_WIDTH}px)` }}>{displayLanes.map((lane, index) => { const Icon = lane.icon; return <div key={lane.id} className={'research-tree-lane-heading lane-' + index}><Icon size={16} aria-hidden="true" /><span>{lane.name}<small>{nodes.filter(node => displayLane(node).id === lane.id && node.status === 'complete').length} / {nodes.filter(node => displayLane(node).id === lane.id).length} researched</small></span></div>; })}</div>
              <div className="research-tree-canvas" style={{ width: layout.width, height: layout.height }}>
                {displayLanes.map((lane, index) => <div key={lane.id} className={'research-tree-lane lane-' + index} style={{ left: index * LANE_WIDTH, width: LANE_WIDTH }} />)}
                <svg className="research-tree-edges" width={layout.width} height={layout.height} aria-hidden="true">
                  <defs><marker id={uniqueId + '-arrow'} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 6 4 L 1 7" fill="none" stroke="context-stroke" strokeWidth="1.4" /></marker></defs>
                  {layout.ordered.flatMap(node => node.definition.requires.map((parentId, edgeIndex) => {
                    const from = layout.positions.get(parentId), to = layout.positions.get(node.id);
                    if (!from || !to) return null;
                    const selectedEdge = prerequisiteIds.has(node.id) && prerequisiteIds.has(parentId) || parentId === selected.id;
                    const parentDone = byId.get(parentId)?.status === 'complete';
                    const x1 = from.x + NODE_WIDTH / 2, y1 = from.y + NODE_HEIGHT;
                    const x2 = to.x + NODE_WIDTH / 2 + (edgeIndex - (node.definition.requires.length - 1) / 2) * 12, y2 = to.y - 4;
                    const bend = y1 + 13 + edgeIndex * 4;
                    const gutter = from.lane < to.lane ? to.lane * LANE_WIDTH + 4 + edgeIndex * 3 : (to.lane + 1) * LANE_WIDTH - 4 - edgeIndex * 3;
                    const path = from.lane === to.lane && to.row === from.row + 1 ? `M ${x1} ${y1} V ${bend} H ${x2} V ${y2}` : `M ${x1} ${y1} V ${bend} H ${gutter} V ${y2 - 12} H ${x2} V ${y2}`;
                    return <path key={parentId + '-' + node.id} data-research-from={parentId} data-research-to={node.id} d={path} className={(selectedEdge ? 'is-selected ' : '') + (parentDone ? 'is-satisfied' : 'is-unmet')} markerEnd={'url(#' + uniqueId + '-arrow)'} />;
                  }))}
                </svg>
                {layout.ordered.map(node => { const position = layout.positions.get(node.id)!; return <button key={node.id} type="button" ref={element => { if (element) nodeRefs.current.set('map-' + node.id, element); else nodeRefs.current.delete('map-' + node.id); }} className={'research-tree-node status-' + node.status + (selected.id === node.id ? ' is-selected' : '') + (relatedIds.has(node.id) && selected.id !== node.id ? ' is-related' : '') + (filtered && !matchIds.has(node.id) ? ' is-context' : '')} style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT } as CSSProperties} aria-pressed={selected.id === node.id} aria-controls="research-tree-details" aria-label={node.id + ': ' + node.name + '. ' + STATUS_LABELS[node.status] + '. ' + nodeDetail(node)} title={nodeDetail(node)} onClick={() => setSelectedId(node.id)} onKeyDown={event => handleNodeKey(event, node.id)}><span className="research-tree-node-top"><span>{node.id}</span><span className={'research-tree-status status-' + node.status}><StatusIcon status={node.status} />{STATUS_LABELS[node.status]}</span></span><strong>{node.name}</strong><span className="research-tree-node-detail">{nodeDetail(node)}</span>{node.project && node.status !== 'complete' && <progress aria-label={node.name + ' combined research progress'} value={node.progressBps} max={10000} />}</button>; })}
              </div>
            </>}
          </div>
          <div className="research-tree-map-footer"><span>Solid arrows: prerequisite researched. Dashed: still required.</span><button type="button" onClick={() => focusNode(selected.id, true)}><Focus size={13} aria-hidden="true" />Find selected</button></div>
        </div>

        <div className="research-tree-list-view">
          <p className="research-tree-mobile-note">Explore each pathway below. Prerequisite links open the related method.</p>
          {!matches.length && <div className="research-tree-empty"><Search size={22} aria-hidden="true" /><strong>No matching research</strong><p>Try another name, role or stage.</p></div>}
          {displayLanes.map(lane => { const laneNodes = matches.filter(node => displayLane(node).id === lane.id); if (!laneNodes.length) return null; const Icon = lane.icon; return <section key={lane.id} className="research-tree-list-lane" aria-labelledby={uniqueId + '-list-' + lane.id}><h3 id={uniqueId + '-list-' + lane.id}><Icon size={16} aria-hidden="true" />{lane.name}<span>{laneNodes.length}</span></h3><div>{laneNodes.map(node => <article key={node.id} className={'research-tree-list-card status-' + node.status + (selected.id === node.id ? ' is-selected' : '')}><button type="button" className="research-tree-list-select" ref={element => { if (element) nodeRefs.current.set('list-' + node.id, element); else nodeRefs.current.delete('list-' + node.id); }} aria-pressed={selected.id === node.id} aria-controls="research-tree-details" onClick={() => selectFromList(node.id)}><span className="research-tree-list-id">{node.id}</span><span><strong>{node.name}</strong><small>{nodeDetail(node)}</small></span><span className={'research-tree-status status-' + node.status}><StatusIcon status={node.status} />{STATUS_LABELS[node.status]}</span><ChevronRight size={15} aria-hidden="true" /></button><div className="research-tree-list-prerequisites"><span>{node.definition.requires.length ? 'Requires all:' : 'No earlier discoveries needed'}</span>{node.definition.requires.map(id => <button type="button" key={id} onClick={() => focusNode(id, true)}>{byId.get(id)?.status === 'complete' && <Check size={11} aria-hidden="true" />}{id} {byId.get(id)?.name ?? ''}</button>)}</div></article>)}</div></section>; })}
        </div>
      </div>

      <aside className="research-tree-details" id="research-tree-details" data-research-method={selected.id} ref={detailRef} tabIndex={-1} aria-labelledby={uniqueId + '-selected-title'}>
        <div className="research-tree-detail-heading"><span className="research-tree-eyebrow">{displayLane(selected).name}</span><div><span className="research-tree-selected-id">{selected.id}</span><span className={'research-tree-status status-' + selected.status}><StatusIcon status={selected.status} />{STATUS_LABELS[selected.status]}</span></div><h3 id={uniqueId + '-selected-title'}>{selected.name}</h3><p>{selected.description}</p></div>
        <div className="research-tree-detail-content">
          {nextPrerequisite && (selected.status === 'locked' || selected.status === 'blocked') && <button type="button" className="research-tree-next-prerequisite" data-research-target={nextPrerequisite.id} onClick={() => focusNode(nextPrerequisite.id, true)}><GitBranch size={16} aria-hidden="true" /><span>Show next prerequisite<strong>{nextPrerequisite.id} · {nextPrerequisite.name}</strong></span><ArrowRight size={15} aria-hidden="true" /></button>}
          <section className="research-tree-detail-block"><h4><GitBranch size={14} aria-hidden="true" />Prerequisites</h4>{selected.definition.requires.length ? <><p>Finish every discovery below. Each unlocks the week after its research is complete.</p><div className="research-tree-prerequisite-links">{selected.definition.requires.map(id => <button type="button" key={id} onClick={() => focusNode(id, true)} className={byId.get(id)?.status === 'complete' ? 'is-satisfied' : ''}>{byId.get(id)?.status === 'complete' ? <CheckCheck size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}<span><small>{id}</small>{byId.get(id)?.name ?? id}</span><ChevronRight size={13} aria-hidden="true" /></button>)}</div></> : <p className="research-tree-entry-note"><Check size={14} aria-hidden="true" />No earlier discoveries needed.</p>}{selected.gate && <p className="research-tree-gate"><LockKeyhole size={14} aria-hidden="true" /><span><strong>What you need first</strong>{humanizeDesignRequirement(selected.gate)}</span></p>}{successors.length > 0 && <details className="research-tree-successors"><summary>Leads to {successors.length} {successors.length === 1 ? 'method' : 'methods'}</summary><div>{successors.map(node => <button type="button" key={node.id} onClick={() => focusNode(node.id, true)}>{node.id} · {node.name}<ArrowRight size={12} aria-hidden="true" /></button>)}</div></details>}</section>

          <section className="research-tree-detail-block research-tree-effort"><h4><FlaskConical size={14} aria-hidden="true" />Research requirements</h4><dl className="research-tree-facts"><div><dt>Entry fee{selected.project ? ' · paid' : ''}</dt><dd>{formatMoney(selected.feeCents)}</dd></div><div><dt>{WORK_POINT_LABELS[selected.role]} effort</dt><dd>{formatWorkPoints(selected.requiredStaff)} points</dd></div><div><dt>Research compute</dt><dd>{formatUnits(selected.requiredWork)} CUw</dd></div></dl>
            {selected.project && <div className="research-tree-meters"><label><span>{WORK_POINT_LABELS[selected.role]} work<strong>{formatWorkPoints(selected.project.completedStaff)} / {formatWorkPoints(selected.requiredStaff)}</strong></span><progress value={selected.project.completedStaff} max={selected.requiredStaff} aria-label={selected.name + ' point progress: ' + percentage(selected.project.completedStaff, selected.requiredStaff) + ' percent'} /></label><label><span>Research work<strong>{formatUnits(selected.project.completedWork)} / {formatUnits(selected.requiredWork)} CUw</strong></span><progress value={selected.project.completedWork} max={selected.requiredWork} aria-label={selected.name + ' compute work: ' + percentage(selected.project.completedWork, selected.requiredWork) + ' percent'} /></label>{selected.project.lastBottleneck && <p className="research-tree-bottleneck">{selected.project.lastBottleneck}</p>}</div>}
            {selected.status === 'complete' ? <p className="research-tree-unlocked"><CheckCheck size={15} aria-hidden="true" />Ready to use{selected.project?.availableWeek !== undefined ? ' in Week ' + selected.project.availableWeek : ''}.</p> : selected.status === 'pending' ? <p className="research-tree-unlocked"><Clock3 size={15} aria-hidden="true" />Both meters complete. Unlocks in Week {selected.project?.availableWeek ?? game.week + 1}.</p> : <details className="research-tree-estimate"><summary><Clock3 size={14} aria-hidden="true" /><span>{estimate.label}{estimate.weeks !== null && estimate.weeks > 0 ? ' · solo estimate' : ''}</span></summary><p>{estimate.explanation}</p><dl><div><dt>Potential {WORK_POINT_LABELS[selected.role].toLowerCase()} output</dt><dd>{formatWorkPoints(estimate.roleFte)} points / week</dd></div><div><dt>Research ceiling</dt><dd>{formatUnits(capacity.researchCU)} CU</dd></div><div><dt>Best single pool rate</dt><dd>{formatUnits(estimate.weeklyWork)} effective CUw/week</dd></div>{estimate.poolName && <div><dt>Compatible pool</dt><dd>{estimate.poolName}</dd></div>}</dl></details>}
            <p className="research-tree-cost-note">Payroll and rented compute continue separately. Both research meters must finish.</p>
            {catalogLock ? <p className="research-tree-gate" role="status"><LockKeyhole size={14} aria-hidden="true" /><span><strong>Before funding research</strong>{catalogLock}</span></p>
              : onOpenMethod ? <button type="button" className="research-tree-open-method" onClick={() => onOpenMethod(selected.id)}>Review method<ArrowRight size={15} aria-hidden="true" /></button>
              : (selected.status === 'running' || selected.status === 'paused') && selected.project ? <ActionControl game={game} payload={{ kind: 'set_research_paused', projectId: selected.project.id, paused: selected.status !== 'paused' }} label={(selected.status === 'paused' ? 'Resume ' : 'Pause ') + selected.name.toLowerCase()} canAct={canAct} onQueue={onQueue} /> : !['complete', 'pending'].includes(selected.status) && <ActionControl game={game} payload={{ kind: 'start_research', researchId: selected.id }} label={'Research ' + selected.name.toLowerCase()} canAct={canAct} onQueue={onQueue} />}
            {estimate.weeks === null && !['complete', 'pending'].includes(selected.status) && <button type="button" className="research-tree-resource-link" onClick={() => onOpenPanel(estimate.roleFte <= 0 ? 'people' : 'compute')}><SlidersHorizontal size={14} aria-hidden="true" />Review {estimate.roleFte <= 0 ? 'team output' : 'compute capacity'}</button>}
          </section>

          <section className="research-tree-detail-block research-tree-application"><h4><Play size={14} aria-hidden="true" />Application</h4><strong>{application.summary}</strong><p>{application.detail}</p>{selected.status !== 'complete' && <p className="research-tree-application-gate">Unlock this discovery before using it.</p>}{application.entries && <ul>{application.entries.map(entry => <li key={entry.name}><div><strong>{entry.name}</strong><span>{entry.status}</span></div><p>{entry.staff}<br />{entry.work}</p>{entry.note && <p className="research-tree-bottleneck">{entry.note}</p>}</li>)}</ul>}{applicationLink && <button type="button" className="research-tree-open-application" onClick={() => onOpenPanel(applicationLink.href.replace(/^#/, ''), selected.id)}>{applicationLink.label}<ArrowRight size={15} aria-hidden="true" /></button>}{selected.id === 'R14' && <button type="button" className="research-tree-resource-link" onClick={() => onOpenPanel('lab-projects')}>Plan a sparse foundation<ArrowRight size={14} aria-hidden="true" /></button>}</section>
        </div>
      </aside>
    </div>
  </section>;
}
