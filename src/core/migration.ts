import { CONNECTED_COMPANY_CONTENT_VERSION, containsConnectedCompanyFeatures } from './connected-company-version';
import { AI_SYSTEMS_CONTENT_VERSION, containsAISystemsFeatures } from './ai-systems-version';
import { GAMEPLAY_POLISH_CONTENT_VERSION, containsGameplayPolishFeatures } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION, containsModelCustomizationFeatures } from './model-customization-version';
import { initializeMarketOpportunities } from '../modules/market-opportunities';
import { STRATEGY_CONTENT_VERSION, containsStrategyFeatures } from './strategy-version';
import { containsModelDesignFeatures } from './model-design-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { containsCampusFeatures } from './wave28-version';
import { SILICON_CONTENT_VERSION } from '../content/silicon-market';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { containsSyntheticFeatures } from './wave26-version';
import { containsStudioReleaseFeatures } from './wave27-version';
import { RELEASE_CAMPAIGN_VERSION } from '../contracts/wave4-campaign';
import { CODING_AGENT_ORDER } from '../content/wave3-agents';
import type { GameContent, GameState, RoleAllocation } from '../contracts/types';
import { SCHEMA_VERSION } from '../contracts/types';
import type { LegacyGameState } from './legacy-validation';
import { validateLegacyState } from './legacy-validation';
import { initializeWave2Fields } from './wave2-state';
import { validateLegacyWave1State } from './legacy-wave1-validation';
import { validateState } from './validation';
import { initializeWave3Fields } from './wave3-state';
import { validateLegacyWave2State } from './legacy-wave2-validation';
import { validateLegacyWave3State } from './legacy-wave3-validation';
import { initializeWave4Fields } from './wave4-state';

export const LEGACY_SCHEMA_VERSION = 1;
export const LEGACY_CONTENT_VERSION = '0.1.0';
export const WAVE1_CONTENT_VERSION = '0.2.0';
export const WAVE2_CONTENT_VERSION = '0.3.0';
export const WAVE3_CONTENT_VERSION = '0.4.0';
export const WAVE4_CONTENT_VERSION = '0.5.0';
export const WAVE5_CONTENT_VERSION = '0.6.0';
export const WAVE6_CONTENT_VERSION = '0.7.0';
export const WAVE7_CONTENT_VERSION = '0.8.0';
export const WAVE8_CONTENT_VERSION = '0.9.0';
export const WAVE9_CONTENT_VERSION = '0.10.0';
export const WAVE10_CONTENT_VERSION = '0.11.0';
export const WAVE11_CONTENT_VERSION = '0.12.0';
export const WAVE12_CONTENT_VERSION = '0.13.0';
export const WAVE13_CONTENT_VERSION = '0.14.0';
export const WAVE14_CONTENT_VERSION = '0.15.0';
export const WAVE15_CONTENT_VERSION = '0.16.0';
export const WAVE16_CONTENT_VERSION = '0.17.0';
export const WAVE17_CONTENT_VERSION = '0.18.0';
export const WAVE18_CONTENT_VERSION = '0.21.0';
export const WAVE19_CONTENT_VERSION = '0.20.0';
function containsSiliconExpansion(state: GameState): boolean {
  const compute = state.slices?.compute;
  return !!compute && (Object.hasOwn(compute, 'hardwareSales')
    || Object.values(compute.chipBatches ?? {}).some(batch => Object.hasOwn(batch, 'foundry'))
    || (state.queuedCommands ?? []).some(command => command.payload?.kind === 'accept_hardware_order'
      || (command.payload?.kind === 'order_chip_batch' && Object.hasOwn(command.payload, 'foundry'))));
}

export type MigrationResult = { ok: true; state: GameState; migratedFrom: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22 | 24 | 27 | 28 | 29 | 30 | 33 | 34 | 35 | 36 | 37 } | { ok: false; error: string };

/** Add only Wave 1 records. Economic history, time, identities and random streams stay intact. */
export function migrateWave0State(input: unknown, content: GameContent): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsModelDesignFeatures(input)) return { ok: false, error: 'Custom model designs and advanced skill records were unavailable in this historical save.' };
  if (SCHEMA_VERSION !== 5 || ![WAVE18_CONTENT_VERSION, RELEASE_CAMPAIGN_VERSION, SILICON_CONTENT_VERSION, SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) {
    return { ok: false, error: 'This build does not support the requested Wave 0 migration target.' };
  }
  const legacy = input as LegacyGameState;
  if (legacy && (containsSiliconExpansion(legacy as GameState) || containsSyntheticFeatures(legacy) || containsStudioReleaseFeatures(legacy) || containsCampusFeatures(legacy))) return { ok: false, error: 'Silicon expansion records are unavailable in that build.' };
  if (legacy?.slices?.campaign && Object.hasOwn(legacy.slices.campaign, 'rules')) return { ok: false, error: 'The campaign rules do not belong to this build.' };
  const invalidLegacy = validateLegacyState(legacy, { version: LEGACY_CONTENT_VERSION, research: content.research });
  if (invalidLegacy.length) return { ok: false, error: 'The Wave 0 save failed validation: ' + invalidLegacy[0].message };
  if (containsWave8Features(legacy as GameState) || containsWave9Features(legacy as GameState) || containsWave10Features(legacy as GameState) || containsWave11Features(legacy as GameState) || containsWave12Features(legacy as GameState) || containsWave13Features(legacy as GameState) || containsWave14Features(legacy as GameState) || containsWave15Features(legacy as GameState) || containsWave16Features(legacy as GameState) || containsWave17Features(legacy as GameState) || containsWave19Features(legacy as GameState) || containsWave18Features(legacy as GameState)) return { ok: false, error: 'The Wave 0 save contains methods or receipts that were unavailable in that build.' };
  const prior = structuredClone(legacy);
  const founderAssignments: Record<string, RoleAllocation> = Object.fromEntries(
    Object.values(prior.slices.company.companies).map(company => [company.id, {
      research: 0, ml: 0, data: company.founderFte, infrastructure: 0, commercial: 0, hardware: 0,
    }]),
  );
  const state = {
    ...prior,
    schemaVersion: 2,
    contentVersion: WAVE1_CONTENT_VERSION,
    buildVersion: '0.2.0',
    queuedCommands: prior.queuedCommands.map(command => ({ ...command, reservedCents: 0 })),
    slices: {
      ...prior.slices,
      company: { ...prior.slices.company, staff: {}, founderAssignments, lastStaff: {} },
      compute: {
        fleets: Object.fromEntries(Object.entries(prior.slices.compute.fleets).map(([id, fleet]) => [id, {
          ...fleet, lastBottleneck: '', lastReservedMemoryMU: fleet.occupiedMemoryMU, lastGrants: [],
        }])),
      },
      models: { ...prior.slices.models, trainingRuns: {}, evaluationRuns: {}, reports: {} },
      data: { ...prior.slices.data, preparationJobs: {} },
      products: { ...prior.slices.products, offers: {}, deployments: {}, contracts: {}, lastUsage: {}, invoices: [] },
      markets: {
        ...prior.slices.markets,
        trials: [], cohorts: [], trustBps: 5000,
        acquisitionCarry: 0, conversionCarry: 0, churnCarry: 0, reachCarry: 0,
        nextTrialId: 1, lastGained: 0, lastLost: 0, lastTrialCount: 0,
        lastExplanation: 'A one-time waitlist is ready when Basic Chat launches.',
      },
    },
  };
  const migrated = migrateWave1State(state, content);
  return migrated.ok ? { ...migrated, migratedFrom: 1 } : migrated;
}

/** Validate the original Wave 1 representation before adding any Wave 2 fields. */
export function migrateWave1State(input: unknown, content: GameContent): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsModelDesignFeatures(input)) return { ok: false, error: 'Custom model designs and advanced skill records were unavailable in this historical save.' };
  const legacy = input as GameState;
  if (legacy && (containsSiliconExpansion(legacy as GameState) || containsSyntheticFeatures(legacy) || containsStudioReleaseFeatures(legacy) || containsCampusFeatures(legacy))) return { ok: false, error: 'Silicon expansion records are unavailable in that build.' };
  if (legacy?.slices?.campaign && Object.hasOwn(legacy.slices.campaign, 'rules')) return { ok: false, error: 'The campaign rules do not belong to this build.' };
  const errors = validateLegacyWave1State(legacy, { ...content, version: WAVE1_CONTENT_VERSION, buildVersion: WAVE1_CONTENT_VERSION });
  if (errors.length) return { ok: false, error: 'The Wave 1 save failed validation: ' + errors[0].message };
  if (containsWave8Features(legacy) || containsWave9Features(legacy) || containsWave10Features(legacy) || containsWave11Features(legacy) || containsWave12Features(legacy) || containsWave13Features(legacy) || containsWave14Features(legacy) || containsWave15Features(legacy) || containsWave16Features(legacy) || containsWave17Features(legacy) || containsWave19Features(legacy) || containsWave18Features(legacy)) return { ok: false, error: 'The Wave 1 save contains methods or receipts that were unavailable in that build.' };
  const state = structuredClone(legacy);
  state.schemaVersion = SCHEMA_VERSION; state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) initializeMarketOpportunities(state);
  initializeWave2Fields(state, content);
  initializeWave3Fields(state);
  initializeWave4Fields(state);
  const invalid = validateState(state, content);
  if (invalid.length) return { ok: false, error: 'The upgraded save failed validation: ' + invalid[0].message };
  return { ok: true, state, migratedFrom: 2 };
}

/** Validate an authentic Wave 2 save before adding the empty Wave 3 records. */
export function migrateWave2State(input: unknown, content: GameContent): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsModelDesignFeatures(input)) return { ok: false, error: 'Custom model designs and advanced skill records were unavailable in this historical save.' };
  const legacy = input as GameState;
  if (legacy && (containsSiliconExpansion(legacy as GameState) || containsSyntheticFeatures(legacy) || containsStudioReleaseFeatures(legacy) || containsCampusFeatures(legacy))) return { ok: false, error: 'Silicon expansion records are unavailable in that build.' };
  if (legacy?.slices?.campaign && Object.hasOwn(legacy.slices.campaign, 'rules')) return { ok: false, error: 'The campaign rules do not belong to this build.' };
  const priorContent = { ...content, version: WAVE2_CONTENT_VERSION, buildVersion: WAVE2_CONTENT_VERSION,
    research: content.research.map(node => ({ ...node, implemented: ['R1','R2','R3','R4','R5','R1A','R5A'].includes(node.id) })) };
  const errors = validateLegacyWave2State(legacy, priorContent);
  if (errors.length) return { ok: false, error: 'The Wave 2 save failed validation: ' + errors[0].message };
  if (containsWave8Features(legacy) || containsWave9Features(legacy) || containsWave10Features(legacy) || containsWave11Features(legacy) || containsWave12Features(legacy) || containsWave13Features(legacy) || containsWave14Features(legacy) || containsWave15Features(legacy) || containsWave16Features(legacy) || containsWave17Features(legacy) || containsWave19Features(legacy) || containsWave18Features(legacy)) return { ok: false, error: 'The Wave 2 save contains methods or receipts that were unavailable in that build.' };
  const state = structuredClone(legacy);
  state.schemaVersion = SCHEMA_VERSION; state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) initializeMarketOpportunities(state);
  initializeWave3Fields(state);
  initializeWave4Fields(state);
  const invalid = validateState(state, content);
  if (invalid.length) return { ok: false, error: 'The upgraded save failed validation: ' + invalid[0].message };
  return { ok: true, state, migratedFrom: 3 };
}

/** Validate the published Wave 3 representation before adding empty Wave 4 records. */
export function migrateWave3State(input: unknown, content: GameContent): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsModelDesignFeatures(input)) return { ok: false, error: 'Custom model designs and advanced skill records were unavailable in this historical save.' };
  const legacy = input as GameState;
  if (legacy && (containsSiliconExpansion(legacy as GameState) || containsSyntheticFeatures(legacy) || containsStudioReleaseFeatures(legacy) || containsCampusFeatures(legacy))) return { ok: false, error: 'Silicon expansion records are unavailable in that build.' };
  if (legacy?.slices?.campaign && Object.hasOwn(legacy.slices.campaign, 'rules')) return { ok: false, error: 'The campaign rules do not belong to this build.' };
  const priorContent = { ...content, version: WAVE3_CONTENT_VERSION, buildVersion: WAVE3_CONTENT_VERSION,
    research: content.research.map(node => ({ ...node, implemented: ['R1','R2','R3','R4','R5','R6','R9','R10','R11','R12','R1A','R5A'].includes(node.id) })) };
  const errors = validateLegacyWave3State(legacy, priorContent);
  if (errors.length) return { ok: false, error: 'The Wave 3 save failed validation: ' + errors[0].message };
  if (containsWave8Features(legacy) || containsWave9Features(legacy) || containsWave10Features(legacy) || containsWave11Features(legacy) || containsWave12Features(legacy) || containsWave13Features(legacy) || containsWave14Features(legacy) || containsWave15Features(legacy) || containsWave16Features(legacy) || containsWave17Features(legacy) || containsWave19Features(legacy) || containsWave18Features(legacy)) return { ok: false, error: 'The Wave 3 save contains methods or receipts that were unavailable in that build.' };
  const state = structuredClone(legacy);
  state.schemaVersion = SCHEMA_VERSION; state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) initializeMarketOpportunities(state);
  initializeWave4Fields(state);
  const invalid = validateState(state, content);
  if (invalid.length) return { ok: false, error: 'The upgraded save failed validation: ' + invalid[0].message };
  return { ok: true, state, migratedFrom: 4 };
}

/** Optional Wave 6 records and commands were impossible in a published Wave 4/5 save. */
function containsWave6Features(state: GameState): boolean {
  const methods = new Set(['R2A', 'R6A', 'R12A']);
  return Object.values(state.slices.research.completedByCompany).some(ids => ids.some(id => methods.has(id)))
    || Object.values(state.slices.research.projects).some(project => methods.has(project.researchId))
    || Object.values(state.slices.research.systemRollouts).some(rollout => ['deduplication', 'capacity-forecast'].includes(rollout.method))
    || Object.values(state.slices.data.packets).some(packet => Object.hasOwn(packet, 'deduplication'))
    || Object.values(state.slices.data.preparationJobs).some(job => job.kind === 'deduplicate')
    || Object.values(state.slices.models.trainingRuns).some(run => Object.hasOwn(run.evidence, 'deduplication') || (run.plan && (Object.hasOwn(run.plan, 'deduplication') || run.plan.methods.includes('R2A'))))
    || Object.values(state.slices.products.efficiencyInstalls).some(install => install.kind === 'evidence-links' || Object.hasOwn(install, 'retrievalId') || Object.hasOwn(install, 'evidencePacketId'))
    || Object.values(state.slices.products.lastUsage).some(usage => Object.hasOwn(usage, 'evidence'))
    || state.queuedCommands.some(({ payload: p }) => p.kind === 'deduplicate_data'
      || (p.kind === 'start_research' && methods.has(p.researchId))
      || (p.kind === 'start_system_rollout' && ['deduplication', 'capacity-forecast'].includes(p.method))
      || ((p.kind === 'install_product_efficiency' || p.kind === 'set_product_efficiency_enabled') && p.method === 'evidence-links'));
}

/** New optional receipts cannot be smuggled into an older content header. */
function containsWave7Features(state: GameState): boolean {
  const methods = new Set(['R4B', 'R9A', 'R10A', 'R11A']);
  const owns = (value: object, key: string) => Object.hasOwn(value, key);
  return Object.values(state.slices.research.completedByCompany).some(ids => ids.some(id => methods.has(id)))
    || Object.values(state.slices.research.projects).some(project => methods.has(project.researchId))
    || Object.values(state.slices.research.systemRollouts).some(rollout => ['adapter-bank', 'action-receipts'].includes(rollout.method))
    || Object.values(state.slices.models.versions).some(model => owns(model, 'planner'))
    || Object.values(state.slices.models.trainingRuns).some(run => run.recipeId === 'planner-curriculum'
      || (run.plan && (owns(run.plan, 'adapter') || owns(run.plan, 'planner') || run.plan.methods.some(id => methods.has(id)))))
    || Object.values(state.slices.models.evaluationRuns).some(run => run.suiteId === 'independent-holdouts-1' || owns(run, 'holdout'))
    || Object.values(state.slices.models.reports).some(report => report.suiteId === 'independent-holdouts-1' || owns(report, 'holdout') || report.cases.some(item => owns(item, 'holdout')))
    || Object.values(state.slices.agents.jobs).some(job => owns(job, 'recovery') || owns(job, 'handedOffTo') || owns(job.model, 'planner') || job.status === 'handed-off'
      || job.stage === 'recover' || job.history.some(item => item.stage === 'recover'))
    || state.queuedCommands.some(({ payload: p }) => p.kind === 'recover_agent_job'
      || (p.kind === 'start_training' && (owns(p, 'asAdapter') || p.recipeId === 'planner-curriculum'))
      || (p.kind === 'evaluate_model' && p.suiteId === 'independent-holdouts-1')
      || (p.kind === 'start_research' && methods.has(p.researchId))
      || (p.kind === 'start_system_rollout' && ['adapter-bank', 'action-receipts'].includes(p.method)));
}

/** Even empty optional records belong to Wave 8, not to a published older save. */
function containsWave8Features(state: GameState): boolean {
  const compute = state.slices.compute;
  const commands = new Set(['start_facility_retrofit', 'set_facility_retrofit_paused', 'start_rack_relocation', 'set_rack_relocation_paused']);
  return ['facilityRetrofits', 'rackRelocations', 'costReports'].some(key => Object.hasOwn(compute, key))
    || Object.values(compute.racks ?? {}).some(rack => Object.hasOwn(rack, 'purchaseLocation'))
    || Object.values(state.slices.research.systemRollouts ?? {}).some(rollout => rollout.method === 'cost-accounting')
    || state.queuedCommands.some(({ payload: p }) => commands.has(p.kind)
      || (p.kind === 'start_system_rollout' && p.method === 'cost-accounting'));
}

/** Staged release records and actions cannot be represented by earlier builds. */
function containsWave9Features(state: GameState): boolean {
  const commands = new Set(['start_release_rehearsal', 'set_release_rehearsal_paused', 'start_prepared_release',
    'set_prepared_release_paused', 'discard_prepared_release', 'promote_prepared_release', 'start_release_rollback']);
  return ['releaseRehearsals', 'preparedReleases'].some(key => Object.hasOwn(state.slices.products, key))
    || state.queuedCommands.some(({ payload }) => commands.has(payload.kind));
}

/** Product feedback has separate provenance; the older rights.feedback flag is unchanged. */
function containsWave10Features(state: GameState): boolean {
  const commands = new Set(['start_feedback_study', 'cancel_feedback_study', 'start_feedback_review', 'set_feedback_review_paused']);
  return ['feedbackStudies', 'feedbackReviews'].some(key => Object.hasOwn(state.slices.data, key))
    || Object.values(state.slices.data.packets).some(packet => Object.hasOwn(packet, 'feedback'))
    || Object.values(state.slices.models.trainingRuns ?? {}).some(run => Object.hasOwn(run.evidence, 'feedback'))
    || state.queuedCommands.some(({ payload }) => commands.has(payload.kind));
}

/** Policy behavior and its frozen evidence require an explicit Wave 11 action. */
function containsWave11Features(state: GameState): boolean {
  const recipes = new Set(['policy-boundary-discrimination', 'policy-conservative-refusal']);
  const suite = 'policy-boundaries-1', catalog = 'policy-boundary-pairs-1';
  const policyPacket = (packet: GameState['slices']['data']['packets'][string]) => Object.hasOwn(packet, 'policy')
    || packet.catalogId === catalog || (packet.sourceIds ?? []).includes(catalog);
  return Object.values(state.slices.models.versions).some(model => Object.hasOwn(model, 'policy'))
    || Object.values(state.slices.data.packets).some(policyPacket)
    || Object.values(state.slices.models.trainingRuns ?? {}).some(run => recipes.has(run.recipeId)
      || policyPacket(run.evidence)
      || (run.plan && (Object.hasOwn(run.plan, 'policy') || Object.hasOwn(run.plan, 'inheritedPolicy') || String(run.plan.kind) === 'policy'
        || run.plan.corpus.sourceIds.includes(catalog))))
    || Object.values(state.slices.models.evaluationRuns ?? {}).some(run => Object.hasOwn(run, 'policy') || String(run.suiteId) === suite)
    || Object.values(state.slices.models.reports ?? {}).some(report => Object.hasOwn(report, 'policy') || String(report.suiteId) === suite
      || report.cases.some(item => Object.hasOwn(item, 'policy')))
    || state.queuedCommands.some(({ payload }) => (payload.kind === 'start_training' && recipes.has(payload.recipeId ?? ''))
      || (payload.kind === 'evaluate_model' && String(payload.suiteId) === suite)
      || (payload.kind === 'buy_data' && payload.catalogId === catalog));
}

/** Runtime guardrail installation, serving and frozen evidence require explicit Wave 12 adoption. */
function containsWave12Features(state: GameState): boolean {
  const products = state.slices.products;
  const commands = new Set(['install_runtime_guardrail', 'set_runtime_guardrail_enabled']);
  return Object.hasOwn(products, 'runtimeGuardrails')
    || Object.values(products.lastUsage ?? {}).some(usage => Object.hasOwn(usage, 'guardrail'))
    || Object.values(products.releaseRehearsals ?? {}).some(rehearsal => Object.hasOwn(rehearsal.configuration, 'guardrail'))
    || Object.values(state.slices.data.feedbackStudies ?? {}).some(study => study.weeks.some(row => Object.hasOwn(row.paidUsage, 'guardrail')))
    || state.queuedCommands.some(({ payload }) => commands.has(payload.kind));
}

/** Assurance contracts and their billing history require explicit Wave 13 adoption. */
function containsWave13Features(state: GameState): boolean {
  const commands = new Set(['sign_assurance_contract', 'requalify_assurance_contract', 'cancel_assurance_contract']);
  return ['assuranceContracts', 'assuranceInvoices'].some(key => Object.hasOwn(state.slices.products, key))
    || state.queuedCommands.some(({ payload }) => commands.has(payload.kind));
}

/** Paid scheduling, finite batch jobs and their receipts require explicit Wave 14 adoption. */
function containsWave14Features(state: GameState): boolean {
  const commands = new Set(['install_batch_scheduler', 'accept_batch_job', 'set_batch_job_paused', 'cancel_batch_job']);
  return ['batchSchedulers', 'batchJobs', 'batchInvoices'].some(key => Object.hasOwn(state.slices.products, key))
    || state.queuedCommands.some(({ payload }) => commands.has(payload.kind));
}

/** Replay choices and paid R4C knowledge were absent from every earlier content build. */
function containsWave15Features(state: GameState): boolean {
  // Traverse retained command and evidence shapes as well as live plans. Even an
  // empty or false optional replay property cannot be hidden under an old header.
  const hasNewEvidence = (value: unknown): boolean => value !== null && typeof value === 'object'
    && Object.entries(value).some(([key, child]) => key === 'replay'
      || (key === 'researchId' && child === 'R4C') || hasNewEvidence(child));
  const research = state.slices.research;
  return hasNewEvidence(state)
    || (research.completed ?? []).includes('R4C') || (research.active ?? []).includes('R4C')
    || Object.values(research.completedByCompany ?? {}).some(ids => ids.includes('R4C'))
    || Object.values(state.slices.models.trainingRuns ?? {}).some(run => run.plan?.methods.includes('R4C'));
}

/** Placement receipts and atomic rental plans require explicit Wave 16 adoption. */
function containsWave16Features(state: GameState): boolean {
  const visit = (value: unknown): boolean => value !== null && typeof value === 'object'
    && (Object.hasOwn(value, 'placementHistory')
      || (('kind' in value) && (value.kind === 'set_batch_capacity' || value.kind === 'set_batch_job_placement'
        || (value.kind === 'accept_batch_job' && Object.hasOwn(value, 'poolId'))))
      || Object.values(value).some(visit));
  return visit(state);
}

/** Two-track receipts and choices were not available under earlier headers. */
function containsWave17Features(state: GameState): boolean {
  const visit = (value: unknown): boolean => value !== null && typeof value === 'object'
    && (Object.hasOwn(value, 'curriculum') || Object.values(value).some(visit));
  return visit(state);
}

/** Coding intakes, permissions and stage evidence were absent from the published Wave 17 format. */
function containsWave19Features(state: GameState): boolean {
  const codingTools = new Set([...CODING_AGENT_ORDER.readTools, 'run_sandbox_tests', CODING_AGENT_ORDER.actionTool]);
  const visit = (value: unknown): boolean => !!value && typeof value === 'object' &&
    Object.entries(value).some(([key, child]) => (key === 'orderId' && typeof child === 'string' && child.startsWith(CODING_AGENT_ORDER.id + '@'))
      || (key === 'templateId' && child === CODING_AGENT_ORDER.id)
      || (key === 'stage' && child === 'sandbox')
      || (key === 'tools' && Array.isArray(child) && child.some(tool => codingTools.has(tool))) || visit(child));
  return Object.keys(state.slices.agents?.claims ?? {}).some(key => key.endsWith(':' + CODING_AGENT_ORDER.id)) || visit(state);
}

/** Persistent consumer sessions were added after the published Wave 19 release. */
function containsWave18Features(state: GameState): boolean {
  const visit = (value: unknown): boolean => !!value && typeof value === 'object' &&
    (Object.hasOwn(value, 'sessionProfile') || Object.hasOwn(value, 'sessionHistory') || Object.hasOwn(value, 'consumerSessions')
      || ('kind' in value && value.kind === 'set_consumer_sessions') || Object.values(value).some(visit));
  return visit(state);
}

/** Preserve the schema 5 records; new methods require future ordinary commands. */
function migrateSchema5Content(input: unknown, content: GameContent, sourceVersion: string, wave: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 21 | 23 | 26 | 27 | 28 | 29): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsModelDesignFeatures(input)) return { ok: false, error: 'Custom model designs and advanced skill records were unavailable in this historical save.' };
  const legacy = input as GameState;
  const errors = validateState(legacy, { ...content, version: sourceVersion, buildVersion: sourceVersion });
  if (errors.length) return { ok: false, error: `The Wave ${wave} save failed validation: ` + errors[0].message };
  if ((wave < 6 && containsWave6Features(legacy)) || (wave < 7 && containsWave7Features(legacy))
    || (wave < 8 && containsWave8Features(legacy)) || (wave < 9 && containsWave9Features(legacy))
    || (wave < 10 && containsWave10Features(legacy)) || (wave < 11 && containsWave11Features(legacy))
    || (wave < 12 && containsWave12Features(legacy)) || (wave < 13 && containsWave13Features(legacy))
    || (wave < 14 && containsWave14Features(legacy)) || (wave < 15 && containsWave15Features(legacy)) || (wave < 16 && containsWave16Features(legacy)) || (wave < 17 && containsWave17Features(legacy)) || (wave < 21 && sourceVersion !== WAVE18_CONTENT_VERSION && ((wave < 19 && containsWave19Features(legacy)) || containsWave18Features(legacy)))) return { ok: false, error: `The Wave ${wave} save contains methods or receipts that were unavailable in that build.` };
  const state = structuredClone(legacy);
  state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) initializeMarketOpportunities(state);
  const invalid = validateState(state, content);
  if (invalid.length) return { ok: false, error: 'The upgraded save failed validation: ' + invalid[0].message };
  return { ok: true, state, migratedFrom: (wave + 1) as Extract<MigrationResult, { ok: true }>['migratedFrom'] };
}

export function migrateWave4State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE4_CONTENT_VERSION, 4); }
export function migrateWave5State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE5_CONTENT_VERSION, 5); }
export function migrateWave6State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE6_CONTENT_VERSION, 6); }
export function migrateWave7State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE7_CONTENT_VERSION, 7); }
export function migrateWave8State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE8_CONTENT_VERSION, 8); }
export function migrateWave9State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE9_CONTENT_VERSION, 9); }
export function migrateWave10State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE10_CONTENT_VERSION, 10); }

export function migrateWave11State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE11_CONTENT_VERSION, 11); }

export function migrateWave12State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE12_CONTENT_VERSION, 12); }

export function migrateWave13State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE13_CONTENT_VERSION, 13); }

export function migrateWave14State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE14_CONTENT_VERSION, 14); }

export function migrateWave15State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE15_CONTENT_VERSION, 15); }

export function migrateWave16State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE16_CONTENT_VERSION, 16); }

export function migrateWave17State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE17_CONTENT_VERSION, 17); }

export function migrateWave19State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE19_CONTENT_VERSION, 19); }

export function migrateWave18State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WAVE18_CONTENT_VERSION, 18); }

export function migrateWave21State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, RELEASE_CAMPAIGN_VERSION, 21); }
export function migrateWave23State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, SILICON_CONTENT_VERSION, 23); }

export function migrateWave26State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, SYNTHETIC_CONTENT_VERSION, 26); }

export function migrateWave27State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, STUDIO_RELEASE_CONTENT_VERSION, 27); }

/** Existing people, progress, grants and queued choices are retained exactly.
 * Specialist point profiles begin only when a future week allocates work. */
export function migrateWave28State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, CAMPUS_CONTENT_VERSION, 28); }

/** Preserve every earned model, frozen plan and economic record from the uploaded build. */
export function migrateWave29State(input: unknown, content: GameContent): MigrationResult { return migrateSchema5Content(input, content, WORKFORCE_POINTS_CONTENT_VERSION, 29); }

/** Upgrade the published seven-skill build without rewriting paid model provenance. */
export function migrateModelDevelopmentState(input: unknown, content: GameContent): MigrationResult {
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  if (containsStrategyFeatures(input)) return { ok: false, error: 'Strategy records were unavailable in the prior build.' };
  const old = input as GameState;
  const errors = validateState(old, { ...content, version: MODEL_DESIGN_CONTENT_VERSION, buildVersion: old.buildVersion });
  if (errors.length) return { ok: false, error: 'The previous save failed validation: ' + errors[0].message };
  const state = structuredClone(old); state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  initializeMarketOpportunities(state);
  const invalid = validateState(state, content);
  return invalid.length ? { ok: false, error: invalid[0].message } : { ok: true, state, migratedFrom: 33 };
}

/** The expansion changes only version metadata. Every existing paid design stays frozen. */
export function migrateStrategyState(input: unknown, content: GameContent): MigrationResult {
  if (![MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) return { ok: false, error: 'This build cannot upgrade the strategy save to that version.' };
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  if (containsModelCustomizationFeatures(input)) return { ok: false, error: 'Model customization records were unavailable in this historical save.' };
  const old = input as GameState;
  const errors = validateState(old, { ...content, version: STRATEGY_CONTENT_VERSION, buildVersion: old?.buildVersion });
  if (errors.length) return { ok: false, error: 'The previous save failed validation: ' + errors[0].message };
  const state = structuredClone(old);
  state.contentVersion = content.version;
  state.buildVersion = content.buildVersion;
  const invalid = validateState(state, content);
  return invalid.length ? { ok: false, error: invalid[0].message } : { ok: true, state, migratedFrom: 34 };
}

/** A 0.35 lab keeps its exact paid model plans, research, announced calendar and
 * current rival plans. New commissions and future rival campaigns are opt-in play. */
export function migrateModelCustomizationState(input: unknown, content: GameContent): MigrationResult {
  if (![GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) return { ok: false, error: 'This build cannot upgrade the model customization save to that version.' };
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems designs, discoveries and customer evidence were unavailable in this historical save.' };
  if (containsGameplayPolishFeatures(input)) return { ok: false, error: 'Specialist commissions and varied campaign schedules were unavailable in this historical save.' };
  const old = input as GameState;
  const errors = validateState(old, { ...content, version: MODEL_CUSTOMIZATION_CONTENT_VERSION, buildVersion: old?.buildVersion });
  if (errors.length) return { ok: false, error: 'The previous save failed validation: ' + errors[0].message };
  const state = structuredClone(old); state.contentVersion = content.version; state.buildVersion = content.buildVersion;
  const invalid = validateState(state, content);
  return invalid.length ? { ok: false, error: invalid[0].message } : { ok: true, state, migratedFrom: 35 };
}

/** Upgrade 0.36 without changing any paid design, report, reserve or market plan. */
export function migrateGameplayPolishState(input: unknown, content: GameContent): MigrationResult {
  if (![AI_SYSTEMS_CONTENT_VERSION, CONNECTED_COMPANY_CONTENT_VERSION].includes(content.version)) return { ok: false, error: 'This build cannot upgrade the gameplay save to that version.' };
  if (containsAISystemsFeatures(input)) return { ok: false, error: 'AI Systems records were unavailable in this historical save.' };
  const old = input as GameState;
  const errors = validateState(old, { ...content, version: GAMEPLAY_POLISH_CONTENT_VERSION, buildVersion: old?.buildVersion });
  if (errors.length) return { ok: false, error: 'The previous save failed validation: ' + errors[0].message };
  const state = structuredClone(old);
  state.contentVersion = content.version;
  state.buildVersion = content.buildVersion;
  const invalid = validateState(state, content);
  return invalid.length ? { ok: false, error: invalid[0].message } : { ok: true, state, migratedFrom: 36 };
}

/** Upgrade AI Systems without rewriting paid designs, contracts, tests or queues.
 * Connected mechanics are introduced only through newly authorized work. */
export function migrateAISystemsState(input: unknown, content: GameContent): MigrationResult {
  if (content.version !== CONNECTED_COMPANY_CONTENT_VERSION) return { ok: false, error: 'This build cannot upgrade the AI Systems save to that version.' };
  if (containsConnectedCompanyFeatures(input)) return { ok: false, error: 'Connected Company records were unavailable in this historical save.' };
  const old = input as GameState;
  const errors = validateState(old, { ...content, version: AI_SYSTEMS_CONTENT_VERSION, buildVersion: old?.buildVersion });
  if (errors.length) return { ok: false, error: 'The previous save failed validation: ' + errors[0].message };
  const state = structuredClone(old);
  state.contentVersion = content.version;
  state.buildVersion = content.buildVersion;
  const invalid = validateState(state, content);
  return invalid.length ? { ok: false, error: invalid[0].message } : { ok: true, state, migratedFrom: 37 };
}
