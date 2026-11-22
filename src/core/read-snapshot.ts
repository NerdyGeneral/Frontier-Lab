import type { GameState, SliceKey } from '../contracts/types';
import { freezeDeep } from './canonical';

/** Object.freeze does not protect Map/Set/Date internals. The existing state
 * boundary can admit these in extra fields, so preserve fresh-copy isolation
 * for them instead of treating a frozen outer object as immutable data. */
export function canReuseReadSnapshot(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  const prototype = Object.getPrototypeOf(value);
  if (!Object.isFrozen(value) || (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)) return false;
  return Object.values(value).every(canReuseReadSnapshot);
}

/** Private to one engine operation. applyResult replaces each written slice
 * with an owned clone, so its identity is a safe lifetime for a frozen view.
 * Mutable coordinator fields are copied on every read, including random draws,
 * queue changes and receipts made without changing the public revision. */
export function createReadSnapshot(): (state: GameState) => Readonly<GameState> {
  const slices = new WeakMap<object, object>();
  return state => {
    const { slices: current, ...coordinator } = state;
    const snapshot: GameState = { ...structuredClone(coordinator), slices: { ...current } };
    for (const key of Object.keys(current) as SliceKey[]) {
      let copy = slices.get(current[key]);
      if (!copy) {
        copy = freezeDeep(structuredClone(current[key]));
        if (canReuseReadSnapshot(copy)) slices.set(current[key], copy);
      }
      Object.assign(snapshot.slices, { [key]: copy });
    }
    return freezeDeep(snapshot);
  };
}
