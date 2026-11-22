'use client';

import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { GameState } from '../contracts/types';
import { browserSnapshotMatches } from '../persistence/wave0-browser';
import { hashSavedSnapshot, newResultsTimelineToken } from '../persistence/studio-results';
import { hashSavedSnapshotSync } from '../persistence/saved-snapshot-hash';
import type { ResultsSessionMode } from '../persistence/studio-results';
import { MODEL_WORKSPACE_KEY, ModelWorkspaceController } from '../persistence/model-workspace';
import type { ModelWorkspaceSnapshot } from '../persistence/model-workspace';

export interface ModelWorkspace extends ModelWorkspaceSnapshot {
  setDraft: ModelWorkspaceController['setDraft'];
  saveBlueprint: ModelWorkspaceController['saveBlueprint'];
  setDevelopmentGoal: ModelWorkspaceController['setDevelopmentGoal'];
}
const Context = createContext<ModelWorkspace | null>(null);
export const ModelWorkspaceProvider = Context.Provider;
export function useModelWorkspace() { return useContext(Context); }
type OpenInput = { game: GameState; mode: ResultsSessionMode; savedBytes?: string };

/** This controller lives outside the retained/remountable task forms. */
export function useModelWorkspaceController() {
  const ref = useRef<ModelWorkspaceController | null>(null);
  if (!ref.current) ref.current = new ModelWorkspaceController({
    read: () => window.localStorage.getItem(MODEL_WORKSPACE_KEY),
    write: value => window.localStorage.setItem(MODEL_WORKSPACE_KEY, value),
    remove: () => window.localStorage.removeItem(MODEL_WORKSPACE_KEY),
    snapshotMatches: browserSnapshotMatches, hash: hashSavedSnapshot, hashSync: hashSavedSnapshotSync, token: newResultsTimelineToken,
  });
  const controller = ref.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const actions = useMemo(() => ({
    open: ({ game, ...input }: OpenInput) => controller.open({ ...input, playerId: game.playerCompanyId }),
    replace: ({ game, ...input }: OpenInput) => controller.replace({ ...input, playerId: game.playerCompanyId }),
    saved: controller.saved, suspend: controller.suspend,
  }), [controller]);
  const workspace = useMemo<ModelWorkspace>(() => ({ ...state, setDraft: controller.setDraft, saveBlueprint: controller.saveBlueprint, setDevelopmentGoal: controller.setDevelopmentGoal }), [state, controller]);
  return { workspace, ...actions };
}
