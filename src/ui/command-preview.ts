import { CONTENT } from '../content/catalog';
import type { CommandPayload, GameContent, GameState, PreviewResult } from '../contracts/types';
import { canonicalStringify, freezeDeep } from '../core/canonical';
import { previewCommand } from '../core/engine';

const MAX_PREVIEWS_PER_STATE = 256;
const previews = new WeakMap<GameState, WeakMap<GameContent, Map<string, PreviewResult>>>();

/** UI game snapshots are replaced after every command and weekly boundary.
 * Share authoritative display quotes only for the same snapshot, content and
 * complete payload. Submission still goes through submitCommand revalidation.
 * Weak keys release old snapshots; the bounded map also limits draft history. */
export function getUiCommandPreview(game: GameState, payload: CommandPayload, content: GameContent = CONTENT): PreviewResult {
  let key: string;
  try {
    // Includes nested values, optional fields and every transaction child.
    // An actionKey identifies queue conflicts and is deliberately insufficient.
    key = canonicalStringify(payload);
  } catch {
    // Invalid drafts must retain the engine's own rejection behavior. They
    // cannot safely share a serialized cache key, so evaluate them directly.
    return previewCommand(game, payload, content);
  }
  let byContent = previews.get(game);
  if (!byContent) { byContent = new WeakMap(); previews.set(game, byContent); }
  let byPayload = byContent.get(content);
  if (!byPayload) { byPayload = new Map(); byContent.set(content, byPayload); }
  const saved = byPayload.get(key);
  if (saved) return saved;
  const result = freezeDeep(previewCommand(game, payload, content));
  if (byPayload.size >= MAX_PREVIEWS_PER_STATE) {
    const oldest = byPayload.keys().next().value;
    if (oldest !== undefined) byPayload.delete(oldest);
  }
  byPayload.set(key, result);
  return result;
}
