import type { GameContent, GameState } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash } from '../core/canonical';
import { deserializeState, serializeState } from '../core/snapshot';
import type { SnapshotResult } from '../core/snapshot';
import { isModelWorkspaceData, modelWorkspaceDataForExport } from './model-workspace';
import type { ModelWorkspaceData } from './model-workspace';

export const MAX_PORTABLE_SAVE_BYTES = 3_000_000;
export type PortableSaveResult = SnapshotResult extends infer T ? T extends { ok: true } ? T & { workspace?: ModelWorkspaceData } : T : never;

/** The game remains an ordinary, independently validated save. Planning metadata
 * travels beside it and cannot authorize work or change paid engine receipts. */
export function serializePortableSave(game: GameState, workspace: ModelWorkspaceData, content: GameContent = CONTENT): string {
  const data = modelWorkspaceDataForExport(workspace);
  if (!isModelWorkspaceData(data)) throw new Error('Your planning workspace could not be checked for export.');
  const snapshot: unknown = JSON.parse(serializeState(game, content, { compress: true }));
  const payload = { snapshot, workspace: data };
  const text = JSON.stringify({ format: 'frontier-lab-workspace', version: 1, checksum: canonicalStateHash(payload), ...payload });
  if (new TextEncoder().encode(text).length > MAX_PORTABLE_SAVE_BYTES) throw new Error('This game and planning workspace exceed the 3 MB portable save limit.');
  return text;
}

export function deserializePortableSave(text: string, content: GameContent = CONTENT): PortableSaveResult {
  try {
    if (typeof text !== 'string' || text.length > MAX_PORTABLE_SAVE_BYTES || new TextEncoder().encode(text).length > MAX_PORTABLE_SAVE_BYTES)
      return { ok: false, error: 'Choose a Frontier Lab save smaller than 3 MB.' };
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { format?: unknown }).format !== 'frontier-lab-workspace')
      return deserializeState(text, content);
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).sort().join() !== 'checksum,format,snapshot,version,workspace' || value.version !== 1 || !isModelWorkspaceData(value.workspace))
      return { ok: false, error: 'The portable planning workspace is invalid or unsupported.' };
    if (value.checksum !== canonicalStateHash({ snapshot: value.snapshot, workspace: value.workspace }))
      return { ok: false, error: 'The portable save checksum does not match.' };
    const result = deserializeState(JSON.stringify(value.snapshot), content);
    return result.ok ? { ...result, workspace: modelWorkspaceDataForExport(value.workspace) } : result;
  } catch { return { ok: false, error: 'This file is not a valid Frontier Lab save.' }; }
}
