import { DESIGN_RESEARCH_IDS } from '../content/model-designs';
import { isCustomizationResearch } from '../content/model-customization-research';

/** Preserve the chosen invention while crossing from the tree to its retained
 * training form. Other research destinations do not alter a training draft. */
export function createResearchTrainingSelection(panelId: string, researchId: string | undefined, intentId: number):
  { intentId: number; designResearchId: string } | null {
  return panelId === 'lab-projects' && researchId && (DESIGN_RESEARCH_IDS.includes(researchId) || isCustomizationResearch(researchId) || /^A([1-9]|1[0-2])$/.test(researchId))
    ? { intentId, designResearchId: researchId } : null;
}
