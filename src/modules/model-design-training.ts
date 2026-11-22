import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameContent, GameState, ModelVersion, Rejection } from '../contracts/types';
import type { CapabilityScores, TrainingPlan, TrainingRecipe } from '../contracts/wave2-lab';
import type { ModelDesignReceipt } from '../contracts/model-design';
import { CUSTOM_MODEL_RECIPES } from '../contracts/model-design';
import type { PlannedTraining, TrainingOptions } from './lab-planner';
import { BASE_BEHAVIOR, DOMAINS, getCorpusEvidence, lineageId, packetOwnedBy } from './lab-planner';
import { createAdvancedTrainingReceipt } from './advanced-skills';
import { getModelDesignForecast, getModelDesignForBase, modelDesignRejection, modelDesignShapeRejection } from './model-design';
import { getCompatibleComputePools } from './compute-pools';
import { canonicalStateHash } from '../core/canonical';
import { mulDiv } from '../core/math';
import { buildCustomizationBehaviorTraining, isDefaultModelCustomization } from './model-customization';

function rootModel(state: Readonly<GameState>, model: ModelVersion): ModelVersion {
  let current = model; const seen = new Set<string>();
  while (current.parentModelId && !seen.has(current.id)) {
    seen.add(current.id); const parent = state.slices.models.versions[current.parentModelId];
    if (!parent || parent.companyId !== model.companyId) break; current = parent;
  }
  return current;
}
export function buildCustomTrainingPlan(state: Readonly<GameState>, companyId: string, options: TrainingOptions, content: GameContent, atWeek = state.week,
  foundationRights: TrainingPlan['foundationRights'] | null = 'independent'): PlannedTraining {
  const base = state.slices.models.versions[options.baseModelId] ?? content.seedModel;
  const spec = structuredClone(modelDesignShapeRejection(options.modelDesign) ? getModelDesignForBase(base) : options.modelDesign!);
  const packetIds = options.packetIds?.length ? options.packetIds : [options.packetId];
  const forecast = getModelDesignForecast(state, companyId, options.baseModelId, packetIds, spec, atWeek);
  const corpus = getCorpusEvidence(state, companyId, packetIds), foundation = spec.mode === 'foundation';
  const independentFoundation = foundation && foundationRights === 'independent';
  const root = rootModel(state, base);
  const customization = forecast.customization ? structuredClone(forecast.customization) : undefined;
  if (customization) {
    const initial = foundation ? BASE_BEHAVIOR : base.behavior ?? BASE_BEHAVIOR;
    const behaviorTraining = buildCustomizationBehaviorTraining(customization.choices, foundation ? BASE_BEHAVIOR : root.behavior ?? BASE_BEHAVIOR,
      initial, !foundation && base.policy ? initial.falseRefusalBps : 0);
    if (behaviorTraining) customization.behaviorTraining = behaviorTraining;
  }
  const receipt: ModelDesignReceipt = { spec, researchLevel: forecast.researchLevel, frontierRating: forecast.frontierRating,
    ...(forecast.researchFocus ? { researchFocus: forecast.researchFocus } : {}),
    ...(customization ? { customization } : {}),
    servingWorkBps: forecast.servingWorkBps, requiredEvidence: forecast.requiredEvidence,
    ceilings: forecast.ceilings, advancedCeilings: forecast.advancedCeilings };
  const advanced = createAdvancedTrainingReceipt(state, base.id, corpus.packetIds, forecast.advancedTargets, forecast.advancedCeilings, forecast.requiredEvidence, foundation);
  const { name: _name, ...engineeringChoices } = structuredClone(spec);
  if (engineeringChoices.customization && isDefaultModelCustomization(engineeringChoices.customization)) delete engineeringChoices.customization;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = Object.values(spec.dataMix).reduce((a, b) => gcd(a, b), 0) || 1;
  engineeringChoices.dataMix = Object.fromEntries(Object.entries(spec.dataMix).map(([key, value]) => [key, value / divisor])) as typeof spec.dataMix;
  const identity = 'custom-design-' + canonicalStateHash({ companyId, lineage: foundation ? spec.family : lineageId(state, base),
    ...(independentFoundation ? { foundationRights: 'independent' } : {}),
    spec: engineeringChoices, researchLevel: forecast.researchLevel, ...(forecast.researchFocus ? { researchFocus: forecast.researchFocus } : {}), corpus: corpus.fingerprint, advancedCorpus: advanced.corpus.fingerprint });
  const foundationAnchor: CapabilityScores = foundation ? { conversation: 2000, documents: 2000, coding: 1000, tools: 1000 }
    : structuredClone(base.foundationAnchor ?? root.capabilityBps);
  const plan: TrainingPlan = {
    modelDesign: receipt, advanced,
    ...(independentFoundation ? { foundationRights: 'independent' as const } : {}),
    recipeName: spec.name.trim(), kind: spec.mode, profile: 'balanced', profileApplied: false,
    family: spec.family, architecture: spec.sparsityBps ? 'sparse' : 'dense', residentMU: forecast.residentMU,
    lineageId: foundation ? 'foundation-' + identity : (lineageId(state, base) ?? base.id), identity, corpus,
    targets: forecast.targets, ceilings: forecast.ceilings, savedAdjustments: { conversation: 0, documents: 0, coding: 0, tools: 0 },
    requiredEvidence: forecast.requiredEvidence, reliabilityTargetBps: forecast.reliabilityTargetBps,
    behaviorAnchor: structuredClone(root.behavior ?? BASE_BEHAVIOR),
    behaviorTarget: structuredClone(foundation ? BASE_BEHAVIOR : (base.behavior ?? BASE_BEHAVIOR)),
    preparationRequired: forecast.preparationStaff, checkpointOverheadRequired: 0,
    checkpoints: [{ atBps: 5000, overheadWork: 0 }, { atBps: 10000, overheadWork: 0 }],
    methods: customization?.researchIds ?? [], foundationAnchor,
    ...(!foundation ? { parentScores: { capabilityBps: structuredClone(base.capabilityBps), reliabilityBps: base.reliabilityBps } } : {}),
    ...(!foundation && base.policy ? { inheritedPolicy: structuredClone(base.policy) } : {}),
    ...(!foundation && base.planner ? { planner: structuredClone(base.planner) } : {}),
  };
  const selected = state.slices.data.packets[options.packetId] ?? content.starterData;
  const evidence = { ...structuredClone(selected), companyId, name: corpus.packetIds.length > 1 ? 'Custom design training corpus' : selected.name,
    rawUnits: corpus.distinctUnits, readyUnits: corpus.distinctUnits, prepared: true,
    sourceIds: corpus.sourceIds, behaviorUnits: corpus.behaviorUnits, broadUnits: corpus.broadUnits,
    qualityBps: corpus.behaviorQualityBps || Math.max(...Object.values(corpus.qualityBps)), rights: corpus.rights,
    coverageBps: Object.fromEntries(DOMAINS.map(domain => [domain, corpus.distinctUnits ? Math.min(10000, mulDiv(corpus.relevantUnits[domain], 10000, corpus.distinctUnits * U)) : 0])) as CapabilityScores,
  };
  delete evidence.deduplication; delete evidence.feedback; delete evidence.policy; delete evidence.synthetic; delete evidence.advancedCoverageBps;
  const recipe: TrainingRecipe = { id: `custom-model-${spec.mode}`, name: spec.name.trim(), kind: spec.mode,
    ...(foundation ? { family: spec.family } : {}), workCUw: forecast.workCUw, feeCents: forecast.feeCents,
    preparationStaff: forecast.preparationStaff, targets: forecast.targets, relevantUnits: forecast.requiredEvidence / U,
    minimumBroadUnits: 0, reliabilityTargetBps: forecast.reliabilityTargetBps, description: 'A model calculated from your engineering choices.' };
  return { plan, recipe, requiredWork: forecast.workCUw, requiredMemory: forecast.requiredMemory,
    anchorScores: structuredClone(foundationAnchor), anchorReliabilityBps: foundation ? 7000 : base.reliabilityBps, evidence };
}

export function validateCustomTrainingOptions(state: Readonly<GameState>, companyId: string, options: TrainingOptions, content: GameContent): Rejection | undefined {
  const spec = options.modelDesign;
  const shape = modelDesignShapeRejection(spec); if (shape) return shape;
  if (options.recipeId !== `custom-model-${spec!.mode}`) return { code: 'INVALID_COMMAND', message: 'The custom model design and its training mode must match.' };
  if (options.profile !== undefined || options.workspace !== undefined || options.replay !== undefined || options.curriculum !== undefined
    || options.asAdapter || options.automatedCheckpoints || options.teacherModelId !== undefined || options.teacherDomain !== undefined
    || options.continueFromParent !== undefined || options.architecture !== undefined) return { code: 'INVALID_COMMAND', message: 'The custom design already sets architecture, compute and skill balance. Use the design controls for this run.' };
  const invalid = modelDesignRejection(state, companyId, options.baseModelId, spec!); if (invalid) return invalid;
  const ids = options.packetIds?.length ? options.packetIds : [options.packetId];
  if (!ids.includes(options.packetId) || new Set(ids).size !== ids.length || ids.length > 32) return { code: 'INVALID_COMMAND', message: 'Choose up to 32 distinct datasets including the primary dataset.' };
  if (ids.some(id => { const p = state.slices.data.packets[id]; return !p || !p.prepared || !p.readyUnits || !packetOwnedBy(p, companyId, state.playerCompanyId); })) return { code: 'NOT_READY', message: 'Prepare each selected dataset before training this design.' };
  const planned = buildCustomTrainingPlan(state, companyId, options, content);
  if (spec!.customization && spec!.customization.behavior !== 'balanced' && planned.plan.corpus.behaviorUnits < 100)
    return { code: 'NOT_READY', message: 'Choose at least 100 reviewed behavior cases before training a careful or expressive model.' };
  const objective = spec!.customization?.objective;
  const objectiveDomains = objective === 'reasoning' ? ['reasoning'] : objective === 'agentic' ? ['tools', 'coding'] : objective === 'grounded' ? ['documents', 'longContext'] : objective === 'multimodal' ? ['multimodal'] : [];
  if (objectiveDomains.length && !objectiveDomains.some(domain => spec!.dataMix[domain as keyof NonNullable<typeof spec>['dataMix']] > 0
    && ((planned.plan.corpus.relevantUnits as Record<string, number>)[domain] ?? (planned.plan.advanced!.corpus.relevantUnits as Record<string, number>)[domain] ?? 0) > 0))
    return { code: 'NOT_READY', message: 'Give the selected training objective a positive data weight and prepared examples for its target skill.' };
  const focusedCore = DOMAINS.some(d => spec!.dataMix[d] > 0 && planned.plan.corpus.relevantUnits[d] > 0);
  const focusedAdvanced = Object.entries(planned.plan.advanced!.corpus.relevantUnits).some(([d, value]) => spec!.dataMix[d as keyof NonNullable<typeof spec>['dataMix']] > 0 && value > 0);
  if (!focusedCore && !focusedAdvanced) return { code: 'NOT_READY', message: 'Your selected data has no examples for the skills receiving training weight. Add suitable data or change the mix.' };
  if (spec!.sparsityBps && !getCompatibleComputePools(state, companyId, { modelArchitecture: 'sparse', workloadKind: 'training', requiresFastFabric: true }, content)
    .some(pool => pool.capacityCU >= 16 * U && pool.memoryMU >= planned.requiredMemory)) return { code: 'MISSING_MEMORY', message: `This sparse design needs compatible fast fabric, at least 16 CU, and ${planned.requiredMemory / U} MU of workspace in one pool.` };
}
export function isCustomTrainingRecipe(recipeId: string): boolean { return (CUSTOM_MODEL_RECIPES as readonly string[]).includes(recipeId); }
