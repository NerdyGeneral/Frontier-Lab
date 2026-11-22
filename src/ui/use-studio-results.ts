'use client';

import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { GameState } from '../contracts/types';
import { selectStudioResults } from '../core/studio-results';
import { browserSnapshotMatches } from '../persistence/wave0-browser';
import {
  hashSavedSnapshot, newResultsTimelineToken, STUDIO_RESULTS_KEY, StudioResultsController,
} from '../persistence/studio-results';
import type { ResultsSessionMode, ResultsSnapshot } from '../persistence/studio-results';

export interface StudioResultsInbox extends ResultsSnapshot {
  markReviewed(keys: readonly string[]): void;
  dismiss(key: string): void;
  restore(key: string): void;
}

type OpenSession = { game: GameState; mode: ResultsSessionMode; savedBytes?: string };
const identity = (game: GameState) => ({ playerId: game.playerCompanyId, week: game.week, entries: selectStudioResults(game) });

/** The lab controller owns this hook, outside the remountable Studio shell.
 * All browser access is deferred until the session is opened on the client. */
export function useStudioResults() {
  const controllerRef = useRef<StudioResultsController | null>(null);
  if (!controllerRef.current) controllerRef.current = new StudioResultsController({
    read: () => window.localStorage.getItem(STUDIO_RESULTS_KEY),
    write: text => window.localStorage.setItem(STUDIO_RESULTS_KEY, text),
    remove: () => window.localStorage.removeItem(STUDIO_RESULTS_KEY),
    snapshotMatches: browserSnapshotMatches,
    hash: hashSavedSnapshot,
    token: newResultsTimelineToken,
  });
  const controller = controllerRef.current;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const actions = useMemo(() => ({
    openSession: ({ game, mode, savedBytes }: OpenSession) => controller.open({ ...identity(game), mode, savedBytes }),
    replace: ({ game, mode, savedBytes }: OpenSession) => controller.replace({ ...identity(game), mode, savedBytes }),
    observe: (game: GameState) => controller.observe(identity(game)),
    saved: controller.saved,
    suspend: controller.suspend,
  }), [controller]);
  const inbox = useMemo<StudioResultsInbox>(() => ({ ...state,
    markReviewed: controller.markReviewed, dismiss: controller.dismiss, restore: controller.restore,
  }), [state, controller]);
  return { inbox, ...actions };
}
