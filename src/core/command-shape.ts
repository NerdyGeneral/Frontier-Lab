import { productPortfolioShapeRejection, isProductWorkloadId, validProductName } from '../modules/product-workloads';
import { assertCompanyProgressionCommand } from './company-progression-validation';
import { assertStrategicVarietyCommand } from './strategic-variety-validation';
import { DEVELOPMENT_PLAN_COMMANDS } from '../contracts/development-plans';
import { assertDevelopmentPlanCommand } from './development-plan-validation';
import { modelDesignShapeRejection } from '../modules/model-design';
import { TRAINING_WORKSPACES } from '../content/model-designs';
import { OPTIONAL_BRIEF_IDS } from '../contracts/customer-briefs';
import { assertReplayTrainingChoice } from './wave15-replay-validation';
import { assertTrainingCurriculumChoice } from './wave17-curriculum-validation';
import { assertAssuranceCommand } from './wave13-assurance-validation';
import { assertBatchCommand } from './wave14-batch-validation';
import type { CommandPayload, StaffRole } from '../contracts/types';
import { HARDWARE_BUYERS, isChipFoundry } from '../content/silicon-market';
import { AGENT_TOOLS } from '../content/wave3-agents';
import { STUDIO_PLAN_KINDS, STUDIO_PLAN_MAX_COMMANDS, STUDIO_PLAN_MAX_HIRES, STUDIO_PLAN_MAX_HIRES_PER_ROLE } from '../contracts/wave25-studio';
import { assertFeedbackCommand } from './wave10-feedback-validation';
import { assertFeedbackReviewCommand } from './wave10-feedback-review-validation';
import { assertWave27ApplianceCommand } from './wave27-appliance-validation';
import { assertWave28FacilityCommand } from './wave28-facilities-validation';

export const COMMAND_KINDS: readonly CommandPayload['kind'][] = ['configure_product_offer', 'retire_product', 'start_research_experiment', 'set_product_strategy', 'select_chapter', ...DEVELOPMENT_PLAN_COMMANDS, 'start_model_research', 'set_model_research_paused', 'accept_systems_brief', 'accept_customer_brief', 'start_facility_specialization', 'set_facility_specialization_paused', 'start_chip_successor', 'start_release_canary', 'stop_release_canary', 'accept_private_appliance_order', 'start_synthetic_generation', 'start_synthetic_review', 'set_synthetic_job_paused', 'apply_studio_plan', 'set_consumer_sessions', 'set_batch_capacity', 'set_batch_job_placement', 'install_batch_scheduler', 'accept_batch_job', 'set_batch_job_paused', 'cancel_batch_job', 'sign_assurance_contract', 'requalify_assurance_contract', 'cancel_assurance_contract', 'install_runtime_guardrail', 'set_runtime_guardrail_enabled', 'start_feedback_study', 'cancel_feedback_study', 'start_feedback_review', 'set_feedback_review_paused', 'rename_company', 'allocate_compute', 'hire_staff', 'specialize_staff', 'dismiss_staff', 'assign_founder', 'set_staff_allocation', 'set_cloud_capacity', 'prepare_data', 'start_training', 'evaluate_model', 'set_job_paused', 'deploy_product', 'set_product_terms', 'set_product_paused', 'buy_data', 'curate_data', 'deduplicate_data', 'start_research', 'set_research_paused', 'order_rack', 'install_rack', 'set_rack_parked', 'start_facility', 'fund_facility_stage', 'set_facility_paused', 'set_product_features', 'upgrade_product', 'start_agent_job', 'set_agent_job_paused', 'review_agent_job', 'recover_agent_job', 'cancel_agent_job', 'install_retrieval', 'sign_business_contract', 'set_business_renewal', 'create_model_variant', 'install_product_efficiency', 'set_product_efficiency_enabled', 'start_system_rollout', 'configure_research_assistant', 'start_chip_design', 'start_chip_prototype', 'set_chip_project_paused', 'order_chip_batch', 'accept_hardware_order', 'install_fast_fabric', 'set_fabric_paused', 'start_facility_retrofit', 'set_facility_retrofit_paused', 'start_rack_relocation', 'set_rack_relocation_paused', 'start_release_rehearsal', 'set_release_rehearsal_paused', 'start_prepared_release', 'set_prepared_release_paused', 'discard_prepared_release', 'promote_prepared_release', 'start_release_rollback'];
export const STAFF_ROLES: readonly StaffRole[] = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];
export function assertCommandShape(payload: CommandPayload): void {
  if (!payload || typeof payload !== 'object' || !COMMAND_KINDS.includes(payload.kind)) throw new Error('Unknown command.');
  const number = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Command quantity must be a nonnegative safe integer.'); };
  const id = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || v.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(v)) throw new Error('Command identifier is invalid.'); };
  if ((DEVELOPMENT_PLAN_COMMANDS as readonly string[]).includes(payload.kind)) { assertDevelopmentPlanCommand(payload); return; }
  if (payload.kind === 'set_product_strategy' || payload.kind === 'select_chapter') { assertStrategicVarietyCommand(payload); return; }
  if (payload.kind === 'start_research_experiment') { assertCompanyProgressionCommand(payload); return; }
  if (payload.kind === 'configure_product_offer' || payload.kind === 'retire_product') { const error = productPortfolioShapeRejection(payload); if (error) throw new Error(error.message); return; }
  switch (payload.kind) {
    case 'accept_systems_brief':
      id(payload.offerId); id(payload.modelId);
      if (!['kind,modelId,offerId', 'kind,modelId,offerId,terms'].includes(Object.keys(payload).sort().join())) throw new Error('Choose a systems offer and its delivery model.');
      break;
    case 'accept_customer_brief':
      if (!OPTIONAL_BRIEF_IDS.includes(payload.briefId) || Object.keys(payload).sort().join() !== 'briefId,kind') throw new Error('Choose an available customer brief.');
      break;
    case 'start_facility_specialization': case 'set_facility_specialization_paused': assertWave28FacilityCommand(payload); break;
    case 'start_chip_successor':
      id(payload.parentDesignId);
      if (Object.keys(payload).sort().join() !== 'improvement,kind,name,parentDesignId'
        || !['memory', 'throughput'].includes(payload.improvement)
        || typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 48
        || /[\u0000-\u001f\u007f]/.test(payload.name)) throw new Error('Choose a qualified first-generation parent, a name and one frozen memory or throughput target.');
      break;
    case 'start_release_canary':
      id(payload.releaseId); number(payload.sampleFloor); number(payload.budgetCUw);
      if (![100, 500, 1000].includes(payload.shareBps) || payload.sampleFloor < 100 || payload.sampleFloor > 10000
        || payload.budgetCUw <= 0 || payload.budgetCUw > 32_000_000_000
        || Object.keys(payload).sort().join() !== 'budgetCUw,kind,releaseId,sampleFloor,shareBps') throw new Error('Choose a 1%, 5% or 10% canary, a sample floor of 100–10,000 requests, and a positive compute budget up to 32 CUw.');
      break;
    case 'stop_release_canary':
      id(payload.canaryId); if (Object.keys(payload).sort().join() !== 'canaryId,kind') throw new Error('Choose one canary to stop.');
      break;
    case 'accept_private_appliance_order': assertWave27ApplianceCommand(payload); break;
    case 'start_synthetic_generation':
      id(payload.teacherModelId); id(payload.sourcePacketId);
      if (!['conversation', 'documents', 'coding', 'tools'].includes(payload.domain)
        || Object.keys(payload).sort().join() !== 'domain,kind,sourcePacketId,teacherModelId') throw new Error('Choose only an owned teacher, licensed source and target domain.');
      break;
    case 'start_synthetic_review':
      id(payload.jobId); if (Object.keys(payload).sort().join() !== 'jobId,kind') throw new Error('Choose one synthetic job to review.');
      break;
    case 'set_synthetic_job_paused':
      id(payload.jobId); if (typeof payload.paused !== 'boolean' || Object.keys(payload).sort().join() !== 'jobId,kind,paused') throw new Error('Choose a synthetic job and explicit pause state.');
      break;
    case 'apply_studio_plan': {
      if (Object.keys(payload).sort().join() !== 'commands,kind' || !Array.isArray(payload.commands)
        || payload.commands.length < 1 || payload.commands.length > STUDIO_PLAN_MAX_COMMANDS
        || payload.commands.some(command => !command || !(STUDIO_PLAN_KINDS as readonly string[]).includes(command.kind))) throw new Error('A Studio plan must contain 1 to 64 supported staffing and compute changes.');
      const keys = { assign_founder: 'allocations,kind', set_staff_allocation: 'fte,kind,staffId', hire_staff: 'kind,role', set_cloud_capacity: 'cu,kind', allocate_compute: 'development,kind,research,serving' };
      const assignments = new Set<string>(), hires = new Map<StaffRole, number>();
      payload.commands.forEach(command => {
        if (Object.keys(command).sort().join() !== keys[command.kind]) throw new Error('A Studio plan change contains an unknown or missing field.');
        assertCommandShape(command);
        if (command.kind === 'hire_staff') hires.set(command.role, (hires.get(command.role) ?? 0) + 1);
        else {
          const key = command.kind === 'set_staff_allocation' ? command.kind + ':' + command.staffId : command.kind;
          if (assignments.has(key)) throw new Error('Each assignment or capacity setting may appear only once in a Studio plan.');
          assignments.add(key);
        }
      });
      if ([...hires.values()].some(count => count > STUDIO_PLAN_MAX_HIRES_PER_ROLE)
        || [...hires.values()].reduce((sum, count) => sum + count, 0) > STUDIO_PLAN_MAX_HIRES) throw new Error('A Studio plan supports up to eight hires per role and sixteen hires in total.');
      break;
    }
    case 'set_batch_capacity': number(payload.cloudCU); number(payload.servingCU); if (Object.keys(payload).sort().join() !== ['cloudCU', 'kind', 'servingCU'].join()) throw new Error('Batch capacity plan contains an unknown or missing field.'); break;
    case 'set_batch_job_placement': case 'install_batch_scheduler': case 'accept_batch_job': case 'set_batch_job_paused': case 'cancel_batch_job': assertBatchCommand(payload); break;
    case 'sign_assurance_contract': case 'requalify_assurance_contract': case 'cancel_assurance_contract': assertAssuranceCommand(payload); break;
    case 'install_runtime_guardrail': id(payload.productId); if (!['balanced', 'strict'].includes(payload.profile)) throw new Error('Choose a supported runtime guardrail profile.'); break;
    case 'set_runtime_guardrail_enabled': id(payload.productId); if (typeof payload.enabled !== 'boolean') throw new Error('Guardrail enabled flag is invalid.'); break;
    case 'start_feedback_study': case 'cancel_feedback_study': assertFeedbackCommand(payload); break;
    case 'start_feedback_review': case 'set_feedback_review_paused': assertFeedbackReviewCommand(payload); break;
    case 'rename_company': if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(payload.name)) throw new Error('Company name is invalid.'); break;
    case 'allocate_compute': number(payload.serving); number(payload.development); number(payload.research); break;
    case 'hire_staff': if (!STAFF_ROLES.includes(payload.role)) throw new Error('Unknown staff role.'); break;
    case 'specialize_staff':
      id(payload.staffId);
      if (!['depth', 'breadth'].includes(payload.specialty) || Object.keys(payload).sort().join() !== 'kind,specialty,staffId') throw new Error('Choose an employee and one of their two career specialties.');
      break;
    case 'dismiss_staff': id(payload.staffId); break;
    case 'assign_founder': if (!payload.allocations || Object.keys(payload.allocations).sort().join() !== [...STAFF_ROLES].sort().join()) throw new Error('All founder roles must be specified.'); STAFF_ROLES.forEach(r => number(payload.allocations[r])); break;
    case 'set_staff_allocation': id(payload.staffId); number(payload.fte); break;
    case 'set_cloud_capacity': number(payload.cu); break;
    case 'prepare_data': id(payload.packetId); break;
    case 'start_training': id(payload.baseModelId); id(payload.packetId); if (payload.recipeId !== undefined) id(payload.recipeId); if (payload.packetIds !== undefined) { if (!Array.isArray(payload.packetIds) || payload.packetIds.length > 100) throw new Error('Invalid training corpus.'); payload.packetIds.forEach(id); } if (payload.profile !== undefined && !['stable','balanced','ambitious'].includes(payload.profile)) throw new Error('Invalid training profile.'); if (payload.asAdapter !== undefined && typeof payload.asAdapter !== 'boolean') throw new Error('Invalid adapter choice.'); if (payload.automatedCheckpoints !== undefined && typeof payload.automatedCheckpoints !== 'boolean') throw new Error('Invalid checkpoint choice.'); if (payload.teacherModelId !== undefined) id(payload.teacherModelId); if (payload.teacherDomain !== undefined && !['conversation','documents','coding','tools'].includes(payload.teacherDomain)) throw new Error('Invalid teacher domain.'); if (payload.architecture !== undefined && !['dense','sparse'].includes(payload.architecture)) throw new Error('Invalid training architecture.');
      if (payload.modelDesign !== undefined) { const rejection = modelDesignShapeRejection(payload.modelDesign); if (rejection) throw new Error(rejection.message); }
      if (payload.continueFromParent !== undefined && payload.continueFromParent !== true) throw new Error('Invalid parent training choice.');
      if (payload.workspace !== undefined && !Object.hasOwn(TRAINING_WORKSPACES, payload.workspace)) throw new Error('Unknown training workspace.');
      if (payload.replay !== undefined) assertReplayTrainingChoice(payload.replay);
      if (payload.curriculum !== undefined) {
        assertTrainingCurriculumChoice(payload.curriculum);
        if (payload.replay !== undefined) throw new Error('Choose one-skill replay or a two-skill curriculum, not both.');
      }
      break;
    case 'evaluate_model': id(payload.modelId); if (payload.suiteId !== undefined && !['systems-cost-1','systems-memory-1','systems-retention-1','systems-verification-1','challenge-applied-1','challenge-frontier-1','challenge-horizon-1','advanced-capabilities-1','basic-conversation-1','expanded-capabilities-1','behavior-cases-1','independent-holdouts-1','policy-boundaries-1'].includes(payload.suiteId)) throw new Error('Invalid evaluation suite.'); break;
    case 'set_job_paused': id(payload.jobId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'deploy_product': id(payload.modelId); number(payload.priceCents); number(payload.allowance); if (payload.name !== undefined && !validProductName(payload.name)) throw new Error('Choose a product name of 1–48 characters.'); if (payload.workload !== undefined && !isProductWorkloadId(payload.workload)) throw new Error('Choose a listed customer workload.'); break;
    case 'set_product_terms': id(payload.productId); number(payload.priceCents); number(payload.allowance); break;
    case 'set_product_paused': id(payload.productId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'buy_data': id(payload.catalogId); break;
    case 'curate_data': case 'deduplicate_data': id(payload.packetId); break;
    case 'start_model_research': if (Object.keys(payload).some(key => !['kind', 'focus'].includes(key)) || (payload.focus !== undefined && !['balanced', 'capability', 'efficiency', 'reliability'].includes(payload.focus))) throw new Error('Choose an available research focus. Cost and level are calculated.'); break;
    case 'set_model_research_paused': id(payload.projectId); if (typeof payload.paused !== 'boolean' || Object.keys(payload).sort().join() !== 'kind,paused,projectId') throw new Error('Choose a project and pause state.'); break;
    case 'start_research': id(payload.researchId); break;
    case 'set_research_paused': id(payload.projectId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'order_rack': id(payload.hardwareId); id(payload.location); break;
    case 'install_rack': id(payload.rackId); break;
    case 'set_rack_parked': id(payload.rackId); if (typeof payload.parked !== 'boolean') throw new Error('Parking flag is invalid.'); break;
    case 'start_facility': break;
    case 'start_facility_retrofit': id(payload.facilityId); if (!['power-feed', 'cooling-loop'].includes(payload.retrofitKind)) throw new Error('Unknown facility extension.'); break;
    case 'set_facility_retrofit_paused': id(payload.retrofitId); if (typeof payload.paused !== 'boolean') throw new Error('Facility extension pause flag is invalid.'); break;
    case 'start_rack_relocation': id(payload.rackId); id(payload.destination); break;
    case 'set_rack_relocation_paused': id(payload.relocationId); if (typeof payload.paused !== 'boolean') throw new Error('Rack relocation pause flag is invalid.'); break;
    case 'fund_facility_stage': id(payload.facilityId); break;
    case 'set_facility_paused': id(payload.facilityId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'start_release_rehearsal': case 'start_prepared_release': id(payload.productId); id(payload.candidateModelId); break;
    case 'set_release_rehearsal_paused': id(payload.rehearsalId); if (typeof payload.paused !== 'boolean') throw new Error('Rehearsal pause flag is invalid.'); break;
    case 'set_prepared_release_paused': id(payload.releaseId); if (typeof payload.paused !== 'boolean') throw new Error('Release preparation pause flag is invalid.'); break;
    case 'discard_prepared_release': case 'promote_prepared_release': case 'start_release_rollback': id(payload.releaseId); break;
    case 'upgrade_product': id(payload.productId); id(payload.modelId); break;
    case 'set_consumer_sessions': id(payload.productId); if (!['off', 'brief', 'extended'].includes(payload.profile) || Object.keys(payload).sort().join() !== 'kind,productId,profile') throw new Error('Consumer session policy is invalid.'); break;
    case 'set_product_features': id(payload.productId); if (!payload.features || Object.keys(payload.features).sort().join() !== ['deepReasoning','extendedContext','memory'].sort().join() || Object.values(payload.features).some(v => typeof v !== 'boolean')) throw new Error('Product features are invalid.'); break;
    case 'start_agent_job':
      id(payload.orderId); id(payload.modelId); number(payload.maxSteps); number(payload.maxRetries); number(payload.workBudget);
      if (!['draft','approval','bounded'].includes(payload.mode) || !['basic','independent'].includes(payload.verification)) throw new Error('Agent mode or verification choice is invalid.');
      if (!Array.isArray(payload.tools) || payload.tools.length > AGENT_TOOLS.length || new Set(payload.tools).size !== payload.tools.length || payload.tools.some(tool => !AGENT_TOOLS.some(allowed => allowed.id === tool))) throw new Error('Choose a unique allowlist of supported agent tools.');
      break;
    case 'set_agent_job_paused': id(payload.jobId); if (typeof payload.paused !== 'boolean') throw new Error('Agent pause flag is invalid.'); break;
    case 'review_agent_job': id(payload.jobId); if (!['approve','reject'].includes(payload.decision)) throw new Error('Agent review decision is invalid.'); break;
    case 'recover_agent_job': id(payload.jobId); number(payload.maxSteps); number(payload.workBudget); if (payload.maxSteps < 4 || payload.maxSteps > 24 || payload.workBudget < 10_000_000 || payload.workBudget > 32_000_000_000) throw new Error('Recovery ceilings must be 4–24 steps and 0.01–32 CUw.'); break;
    case 'cancel_agent_job': id(payload.jobId); break;
    case 'install_retrieval': id(payload.productId); id(payload.packetId); break;
    case 'sign_business_contract': id(payload.customerId); id(payload.modelId); if (!['private-hosted','customer-hosted'].includes(payload.contractKind)) throw new Error('Business hosting choice is invalid.'); if (payload.packetId !== undefined) id(payload.packetId); break;
    case 'set_business_renewal': id(payload.contractId); if (typeof payload.renew !== 'boolean') throw new Error('Renewal flag is invalid.'); break;
    case 'create_model_variant': id(payload.modelId); if (!['compression','memory-format'].includes(payload.variant)) throw new Error('Unknown deployment variant.'); break;
    case 'install_product_efficiency': id(payload.productId); if (!['routing','prefix-cache','evidence-links'].includes(payload.method)) throw new Error('Unknown product efficiency method.'); if (payload.secondaryModelId !== undefined) id(payload.secondaryModelId); break;
    case 'set_product_efficiency_enabled': id(payload.productId); if (!['routing','prefix-cache','evidence-links'].includes(payload.method) || typeof payload.enabled !== 'boolean') throw new Error('Invalid product efficiency choice.'); break;
    case 'start_system_rollout': if (!['run-supervisor','research-assistant','deduplication','capacity-forecast','adapter-bank','action-receipts','cost-accounting'].includes(payload.method)) throw new Error('Unknown system rollout.'); break;
    case 'configure_research_assistant': id(payload.modelId); number(payload.maxAssistedFte); if (payload.maxAssistedFte > 4_000_000_000 || typeof payload.enabled !== 'boolean') throw new Error('Research assistant scope is invalid.'); break;
    case 'start_chip_design':
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(payload.name)) throw new Error('Chip name is invalid.');
      if (!payload.spec || Object.keys(payload.spec).sort().join() !== ['architecture','target','memory'].sort().join()
        || !['dense','sparse'].includes(payload.spec.architecture) || !['inference','training'].includes(payload.spec.target) || !['balanced','wide'].includes(payload.spec.memory)) throw new Error('Chip specification is invalid.');
      break;
    case 'start_chip_prototype': id(payload.designId); id(payload.modelId); break;
    case 'set_chip_project_paused': id(payload.designId); if (typeof payload.paused !== 'boolean') throw new Error('Chip pause flag is invalid.'); break;
    case 'order_chip_batch':
      id(payload.designId); id(payload.location);
      if (![1,2,4].includes(payload.racks)) throw new Error('Choose one, two or four production racks.');
      if (Object.hasOwn(payload, 'foundry') && !isChipFoundry(payload.foundry)) throw new Error('Unknown foundry route.');
      break;
    case 'accept_hardware_order':
      id(payload.designId);
      if (!Object.hasOwn(HARDWARE_BUYERS, payload.buyerId) || !isChipFoundry(payload.foundry)
        || Object.keys(payload).sort().join() !== 'buyerId,designId,foundry,kind') throw new Error('Hardware buyer or foundry is invalid.');
      break;
    case 'install_fast_fabric': id(payload.location); break;
    case 'set_fabric_paused': id(payload.fabricId); if (typeof payload.paused !== 'boolean') throw new Error('Fabric pause flag is invalid.'); break;
  }
}
