import type { ModelCustomization, ModelCustomizationEffects, ModelCustomizationField } from '../contracts/model-customization';

export const DEFAULT_MODEL_CUSTOMIZATION: ModelCustomization = {
  version: 1, attention: 'standard', contextWindow: 'standard', precision: 'full', objective: 'generalist', behavior: 'balanced',
};
export interface CustomizationOption<Value extends string = string> {
  value: Value;
  name: string;
  description: string;
  requiredResearch?: string;
  effects: Partial<Omit<ModelCustomizationEffects, 'skillBps'>> & { skillBps?: Partial<ModelCustomizationEffects['skillBps']> };
}
type Options = { [Field in ModelCustomizationField]: readonly CustomizationOption<ModelCustomization[Field]>[] };

/** Authored simulation tradeoffs, not claims about real-world model benchmarks. */
export const MODEL_CUSTOMIZATION_OPTIONS: Options = {
  attention: [
    { value: 'standard', name: 'Standard attention', description: 'Keep the general-purpose architecture with its original costs and skill balance.', effects: {} },
    { value: 'grouped-query', name: 'Grouped-query attention', requiredResearch: 'M1', description: 'Use 15% less training workspace and 10% less serving work. Training needs 5% more compute for the same fit; reasoning and multimodal capacity fall 2%.', effects: { workspaceMemoryBps: 8500, hardwareServingBps: 9000, computeIntensityBps: 10500, skillBps: { reasoning: 9800, multimodal: 9800 }, setupFeeBps: 10500 } },
    { value: 'sliding-window', name: 'Sliding-window attention', requiredResearch: 'M2', description: 'Use 25% less training workspace, 15% less serving work and 5% less training compute. Long-context capacity falls 8%; documents and reasoning fall 3%.', effects: { workspaceMemoryBps: 7500, hardwareServingBps: 8500, computeIntensityBps: 9500, skillBps: { longContext: 9200, documents: 9700, reasoning: 9700 }, setupFeeBps: 10500 } },
    { value: 'hybrid', name: 'Hybrid attention', requiredResearch: 'M3', description: 'Gain 5% reasoning, 8% long-context and 3% tool capacity. Use 10% more model memory, 20% more workspace and 15% more training compute; serving costs 10% more. Conversation and multimodal capacity fall 3% and 5%.', effects: { residentMemoryBps: 11000, workspaceMemoryBps: 12000, hardwareServingBps: 11000, computeIntensityBps: 11500, skillBps: { reasoning: 10500, longContext: 10800, tools: 10300, conversation: 9700, multimodal: 9500 }, setupFeeBps: 12500 } },
  ],
  contextWindow: [
    { value: 'standard', name: 'Standard context', description: 'Keep the original evidence, memory and processing requirements.', effects: {} },
    { value: 'extended', name: 'Extended context', requiredResearch: 'M4', description: 'Gain 10% long-context and 3% document capacity. Use 15% more evidence and training compute, 10% more model memory and serving work, and 15% more workspace. Coding capacity falls 1%.', effects: { skillBps: { longContext: 11000, documents: 10300, coding: 9900 }, evidenceBps: 11500, computeIntensityBps: 11500, residentMemoryBps: 11000, workspaceMemoryBps: 11500, hardwareServingBps: 11000, setupFeeBps: 11000 } },
    { value: 'ultra', name: 'Ultra context', requiredResearch: 'M5', description: 'Gain 18% long-context and 5% document capacity. Use 35% more evidence, 40% more training compute and workspace, 25% more model memory and 30% more serving work. Conversation and coding fall 3%; tools fall 2%.', effects: { skillBps: { longContext: 11800, documents: 10500, conversation: 9700, coding: 9700, tools: 9800 }, evidenceBps: 13500, computeIntensityBps: 14000, residentMemoryBps: 12500, workspaceMemoryBps: 14000, hardwareServingBps: 13000, setupFeeBps: 12500 } },
  ],
  precision: [
    { value: 'full', name: 'Full precision', description: 'Keep full skill capacity, reliability and the original model memory.', effects: {} },
    { value: 'int8', name: '8-bit design', requiredResearch: 'M6', description: 'Use 35% less model memory and 15% less serving work. Skill capacity falls 1.5% and the reliability target falls one point; fitting the design needs 10% more training compute.', effects: { residentMemoryBps: 6500, hardwareServingBps: 8500, computeIntensityBps: 11000, reliabilityDeltaBps: -100, setupFeeBps: 11000, skillBps: { conversation: 9850, documents: 9850, coding: 9850, tools: 9850, reasoning: 9850, longContext: 9850, multimodal: 9850 } } },
    { value: 'int4', name: '4-bit design', requiredResearch: 'M7', description: 'Use 60% less model memory and 30% less serving work. Skill capacity falls 6% and the reliability target falls three points; fitting the design needs 25% more training compute.', effects: { residentMemoryBps: 4000, hardwareServingBps: 7000, computeIntensityBps: 12500, reliabilityDeltaBps: -300, setupFeeBps: 12000, skillBps: { conversation: 9400, documents: 9400, coding: 9400, tools: 9400, reasoning: 9400, longContext: 9400, multimodal: 9400 } } },
  ],
  objective: [
    { value: 'generalist', name: 'Generalist', description: 'Keep a broad skill balance. Your data weights still choose which skills receive training.', effects: {} },
    { value: 'reasoning', name: 'Reasoning specialist', requiredResearch: 'M8', description: 'Gain 12% reasoning and 4% coding capacity, with 4% less conversation and multimodal capacity. Needs 20% more evidence, 25% more training compute and 15% more serving work.', effects: { skillBps: { reasoning: 11200, coding: 10400, conversation: 9600, multimodal: 9600 }, evidenceBps: 12000, computeIntensityBps: 12500, runtimeServingBps: 11500 } },
    { value: 'agentic', name: 'Tool and workflow specialist', requiredResearch: 'M9', description: 'Gain 9% tool, 6% coding and 4% reasoning capacity, with 6% less conversation and 4% less multimodal capacity. Needs 15% more evidence, 18% more training compute and 12% more serving work.', effects: { skillBps: { tools: 10900, coding: 10600, reasoning: 10400, conversation: 9400, multimodal: 9600 }, evidenceBps: 11500, computeIntensityBps: 11800, runtimeServingBps: 11200 } },
    { value: 'grounded', name: 'Document-grounded specialist', requiredResearch: 'M10', description: 'Gain 8% document and 6% long-context capacity, with 4% less conversation and 5% less coding capacity. Needs 25% more evidence, 15% more training compute and 5% more serving work. Retrieval and evidence checks remain separate.', effects: { skillBps: { documents: 10800, longContext: 10600, conversation: 9600, coding: 9500 }, evidenceBps: 12500, computeIntensityBps: 11500, runtimeServingBps: 10500 } },
    { value: 'multimodal', name: 'Multimodal specialist', requiredResearch: 'M11', description: 'Gain 12% multimodal and 4% long-context capacity, with 6% less coding and tool capacity. Needs 30% more evidence, 25% more training compute and 18% more serving work.', effects: { skillBps: { multimodal: 11200, longContext: 10400, coding: 9400, tools: 9400 }, evidenceBps: 13000, computeIntensityBps: 12500, runtimeServingBps: 11800 } },
  ],
  behavior: [
    { value: 'balanced', name: 'Keep starting behavior', description: 'Preserve the starting model’s behavior while training its skills. A foundation uses the original behavior baseline.', effects: {} },
    { value: 'careful', name: 'Careful', requiredResearch: 'M12', description: 'Train toward 60% fewer confident errors but 60% more false refusals than the lineage baseline. Requires 100 behavior cases; quality and completed work determine the earned change.', effects: {} },
    { value: 'expressive', name: 'Expressive', requiredResearch: 'M13', description: 'Train toward 55% fewer false refusals but 50% more confident errors than the lineage baseline. Requires 100 behavior cases; quality and completed work determine the earned change. Existing policy refusal limits remain.', effects: {} },
  ],
};
