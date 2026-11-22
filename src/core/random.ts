import type { GameState } from '../contracts/types';
import { hashText } from './canonical';

/** Seeded, saved named streams for game outcomes, not cryptography. */
export function drawNamed(state: GameState, key: string): { state: GameState; value: number } {
  if (!key || key.length > 160 || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid random stream key.');
  const existing = Object.hasOwn(state.random, key) ? state.random[key] : undefined;
  let x = existing?.state ?? (parseInt(hashText(state.seed + ':' + key), 16) || 0x9e3779b9);
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  return { state: { ...state, random: { ...state.random, [key]: { state: x, draws: (existing?.draws ?? 0) + 1 } } }, value: x / 4294967296 };
}
