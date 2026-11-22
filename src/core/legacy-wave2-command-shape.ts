/** Frozen schema-3 validation for authentic Wave 2 saves. */
import type { CommandPayload, StaffRole } from '../contracts/types';

export const COMMAND_KINDS: readonly CommandPayload['kind'][] = ['rename_company', 'allocate_compute', 'hire_staff', 'dismiss_staff', 'assign_founder', 'set_staff_allocation', 'set_cloud_capacity', 'prepare_data', 'start_training', 'evaluate_model', 'set_job_paused', 'deploy_product', 'set_product_terms', 'set_product_paused', 'buy_data', 'curate_data', 'start_research', 'set_research_paused', 'order_rack', 'install_rack', 'set_rack_parked', 'start_facility', 'fund_facility_stage', 'set_facility_paused', 'set_product_features', 'upgrade_product'];
export const STAFF_ROLES: readonly StaffRole[] = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];
export function assertCommandShape(payload: CommandPayload): void {
  if (!payload || typeof payload !== 'object' || !COMMAND_KINDS.includes(payload.kind)) throw new Error('Unknown command.');
  const number = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Command quantity must be a nonnegative safe integer.'); };
  const id = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || v.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(v)) throw new Error('Command identifier is invalid.'); };
  switch (payload.kind) {
    case 'rename_company': if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 48 || /[\u0000-\u001f\u007f]/.test(payload.name)) throw new Error('Company name is invalid.'); break;
    case 'allocate_compute': number(payload.serving); number(payload.development); number(payload.research); break;
    case 'hire_staff': if (!STAFF_ROLES.includes(payload.role)) throw new Error('Unknown staff role.'); break;
    case 'dismiss_staff': id(payload.staffId); break;
    case 'assign_founder': if (!payload.allocations || Object.keys(payload.allocations).sort().join() !== [...STAFF_ROLES].sort().join()) throw new Error('All founder roles must be specified.'); STAFF_ROLES.forEach(r => number(payload.allocations[r])); break;
    case 'set_staff_allocation': id(payload.staffId); number(payload.fte); break;
    case 'set_cloud_capacity': number(payload.cu); break;
    case 'prepare_data': id(payload.packetId); break;
    case 'start_training': id(payload.baseModelId); id(payload.packetId); if (payload.recipeId !== undefined) id(payload.recipeId); if (payload.packetIds !== undefined) { if (!Array.isArray(payload.packetIds) || payload.packetIds.length > 100) throw new Error('Invalid training corpus.'); payload.packetIds.forEach(id); } if (payload.profile !== undefined && !['stable','balanced','ambitious'].includes(payload.profile)) throw new Error('Invalid training profile.'); if (payload.automatedCheckpoints !== undefined && typeof payload.automatedCheckpoints !== 'boolean') throw new Error('Invalid checkpoint choice.'); break;
    case 'evaluate_model': id(payload.modelId); if (payload.suiteId !== undefined && !['basic-conversation-1','expanded-capabilities-1','behavior-cases-1'].includes(payload.suiteId)) throw new Error('Invalid evaluation suite.'); break;
    case 'set_job_paused': id(payload.jobId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'deploy_product': id(payload.modelId); number(payload.priceCents); number(payload.allowance); break;
    case 'set_product_terms': id(payload.productId); number(payload.priceCents); number(payload.allowance); break;
    case 'set_product_paused': id(payload.productId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'buy_data': id(payload.catalogId); break;
    case 'curate_data': id(payload.packetId); break;
    case 'start_research': id(payload.researchId); break;
    case 'set_research_paused': id(payload.projectId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'order_rack': id(payload.hardwareId); id(payload.location); break;
    case 'install_rack': id(payload.rackId); break;
    case 'set_rack_parked': id(payload.rackId); if (typeof payload.parked !== 'boolean') throw new Error('Parking flag is invalid.'); break;
    case 'start_facility': break;
    case 'fund_facility_stage': id(payload.facilityId); break;
    case 'set_facility_paused': id(payload.facilityId); if (typeof payload.paused !== 'boolean') throw new Error('Pause flag is invalid.'); break;
    case 'upgrade_product': id(payload.productId); id(payload.modelId); break;
    case 'set_product_features': id(payload.productId); if (!payload.features || Object.keys(payload.features).sort().join() !== ['deepReasoning','extendedContext','memory'].sort().join() || Object.values(payload.features).some(v => typeof v !== 'boolean')) throw new Error('Product features are invalid.'); break;
  }
}
