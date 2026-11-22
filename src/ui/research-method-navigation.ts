import type { GameState } from '../contracts/types';
import { resolveStudioIntent } from '../core/studio-tasks';
import type { GameSectionVisibility } from './guide-links';
import { getStudioPanelLock } from './studio-navigation';

/** Discovery inspection is available before the paid research catalog opens.
 * This target never changes a visibility gate or admits a research command. */
export function getResearchMethodNavigation(game: GameState, sections: GameSectionVisibility, researchId: string) {
  const resolved = resolveStudioIntent(game, { kind: 'research-method', researchId });
  if (!resolved.ok) return { kind: 'unavailable' as const, reason: resolved.reason };
  const catalogLock = getStudioPanelLock('research', sections);
  return catalogLock
    ? { kind: 'tree' as const, researchId, catalogLock, focusId: 'research-tree-details' as const }
    : { kind: 'task' as const, researchId };
}
