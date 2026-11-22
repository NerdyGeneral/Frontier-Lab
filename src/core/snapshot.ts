import { GAMEPLAY_POLISH_CONTENT_VERSION, containsGameplayPolishFeatures } from './gameplay-polish-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION, containsModelCustomizationFeatures } from './model-customization-version';
import { migrateModelDevelopmentState, migrateStrategyState, migrateModelCustomizationState } from './migration';
import { STRATEGY_CONTENT_VERSION, containsStrategyFeatures } from './strategy-version';
import { containsModelDesignFeatures } from './model-design-version';
import { MODEL_DESIGN_CONTENT_VERSION } from '../contracts/model-design';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../content/wave29';
import { CAMPUS_CONTENT_VERSION } from '../content/wave28';
import { containsCampusFeatures } from './wave28-version';
import type { GameContent, GameState } from '../contracts/types';
import { SCHEMA_VERSION } from '../contracts/types';
import { RELEASE_CAMPAIGN_VERSION } from '../contracts/wave4-campaign';
import { SILICON_CONTENT_VERSION } from '../content/silicon-market';
import { SYNTHETIC_CONTENT_VERSION } from '../content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../content/wave27';
import { containsSyntheticFeatures } from './wave26-version';
import { containsStudioReleaseFeatures } from './wave27-version';
import { migrateWave23State, migrateWave26State, migrateWave27State, migrateWave28State, migrateWave29State } from './migration';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash } from './canonical';
import { validateState } from './validation';
import { gzipSync } from 'fflate';
import { decodeBase64, encodeBase64, gunzipBounded } from './bounded-gzip';
import { LEGACY_CONTENT_VERSION, LEGACY_SCHEMA_VERSION, migrateWave0State, migrateWave1State, migrateWave2State, migrateWave3State, migrateWave4State, migrateWave5State, migrateWave6State, migrateWave7State, migrateWave8State, migrateWave9State, migrateWave10State, migrateWave11State, migrateWave12State, migrateWave13State, migrateWave14State, migrateWave15State, migrateWave16State, migrateWave17State, migrateWave18State, migrateWave19State, migrateWave21State, WAVE1_CONTENT_VERSION, WAVE2_CONTENT_VERSION, WAVE3_CONTENT_VERSION, WAVE4_CONTENT_VERSION, WAVE5_CONTENT_VERSION, WAVE6_CONTENT_VERSION, WAVE7_CONTENT_VERSION, WAVE8_CONTENT_VERSION, WAVE9_CONTENT_VERSION, WAVE10_CONTENT_VERSION, WAVE11_CONTENT_VERSION, WAVE12_CONTENT_VERSION, WAVE13_CONTENT_VERSION, WAVE14_CONTENT_VERSION, WAVE15_CONTENT_VERSION, WAVE16_CONTENT_VERSION, WAVE17_CONTENT_VERSION, WAVE18_CONTENT_VERSION, WAVE19_CONTENT_VERSION } from './migration';

export type SnapshotResult = { ok: true; state: GameState; migratedFrom?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22 | 24 | 27 | 28 | 29 | 30 | 33 | 34 | 35 } | { ok: false; error: string };
export const MAX_SNAPSHOT_BYTES = 2_000_000;
export const MAX_DECODED_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const COMPRESSED_FORMAT = 'frontier-lab-compressed';
const snapshotEncoder = new TextEncoder();
export class SnapshotTooLargeError extends Error {
  constructor(bound: 'encoded' | 'decoded' = 'encoded') {
    super(bound === 'decoded'
      ? 'This lab exceeds the 32 MiB decoded save limit. The previous saved copy is unchanged.'
      : 'This lab cannot fit within the 2 MB compressed save-file limit. The previous saved copy is unchanged.');
    this.name = 'SnapshotTooLargeError';
  }
}

function snapshotEnvelope(state: GameState, content: GameContent, checksum: string) {
  return { format: 'frontier-lab', schemaVersion: SCHEMA_VERSION, contentVersion: content.version, checksum, state };
}

function decodedSnapshotBytes(compact: string): Uint8Array {
  if (compact.length > MAX_DECODED_SNAPSHOT_BYTES) throw new SnapshotTooLargeError('decoded');
  const bytes = snapshotEncoder.encode(compact);
  if (bytes.byteLength > MAX_DECODED_SNAPSHOT_BYTES) throw new SnapshotTooLargeError('decoded');
  return bytes;
}

function compressedSnapshot(bytes: Uint8Array): string {
  const payload = encodeBase64(gzipSync(bytes, { level: 6, mtime: 0 }));
  const packed = JSON.stringify({ format: COMPRESSED_FORMAT, version: 1, encoding: 'gzip-base64', decodedBytes: bytes.byteLength, payload });
  // All wrapper fields and base64 are ASCII, so code units equal UTF-8 bytes.
  if (packed.length > MAX_SNAPSHOT_BYTES) throw new SnapshotTooLargeError();
  return packed;
}

/** A capacity check for an already validated engine result. It does not replace
 * validation when a state is saved. Ordinary weeks need only a compact size pass. */
export function assertSnapshotCapacity(state: GameState, content: GameContent = CONTENT): void {
  const envelope = snapshotEnvelope(state, content, '00000000');
  const bytes = decodedSnapshotBytes(JSON.stringify(envelope));
  if (bytes.byteLength <= MAX_SNAPSHOT_BYTES) return;
  // The checksum has a fixed width, but its real bytes matter to compressed size.
  envelope.checksum = canonicalStateHash(state);
  compressedSnapshot(decodedSnapshotBytes(JSON.stringify(envelope)));
}

export function serializeState(state: GameState, content: GameContent = CONTENT, options: { compress?: boolean } = {}): string {
  const invalid = validateState(state, content); if (invalid.length) throw new Error(invalid[0].message);
  const envelope = snapshotEnvelope(state, content, canonicalStateHash(state));
  const compact = JSON.stringify(envelope), bytes = decodedSnapshotBytes(compact);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) return compressedSnapshot(bytes);
  // Keep every existing small save byte-for-byte, including its whitespace.
  const pretty = JSON.stringify(envelope, null, 2);
  const text = snapshotEncoder.encode(pretty).byteLength <= MAX_SNAPSHOT_BYTES ? pretty : compact;
  if (!options.compress) return text;
  // A quota retry may also compress a small save. Incompressible small inputs
  // remain valid ordinary JSON instead of acquiring a stricter size limit.
  try {
    const packed = compressedSnapshot(bytes);
    return packed.length < snapshotEncoder.encode(text).byteLength ? packed : text;
  } catch (error) {
    if (!(error instanceof SnapshotTooLargeError)) throw error;
    return text;
  }
}
export function deserializeState(text: string, content: GameContent = CONTENT): SnapshotResult {
  try {
    if (typeof text !== 'string' || text.length > MAX_SNAPSHOT_BYTES || new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) return { ok: false, error: 'Choose a Frontier Lab snapshot smaller than 2 MB.' };
    let data = JSON.parse(text);
    if (data?.format === COMPRESSED_FORMAT) {
      if (data.version !== 1 || data.encoding !== 'gzip-base64' || typeof data.payload !== 'string' || Object.keys(data).length !== 5) return { ok: false, error: 'This compressed snapshot format is not supported by this build.' };
      if (!Number.isSafeInteger(data.decodedBytes) || data.decodedBytes < 1 || data.decodedBytes > MAX_DECODED_SNAPSHOT_BYTES) return { ok: false, error: 'This compressed snapshot exceeds the 32 MiB decoded save limit or declares an invalid length.' };
      const compressed = decodeBase64(data.payload, MAX_SNAPSHOT_BYTES);
      const unpacked = gunzipBounded(compressed, data.decodedBytes, MAX_DECODED_SNAPSHOT_BYTES);
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unpacked));
    }
    if (data?.format !== 'frontier-lab') return { ok: false, error: 'This snapshot format is not supported by this build.' };
    // Verify the original state before migration can add or replace any field.
    if (typeof data.checksum !== 'string' || canonicalStateHash(data.state) !== data.checksum) return { ok: false, error: 'The snapshot checksum does not match. Your current company has not changed.' };
    if (data.contentVersion !== GAMEPLAY_POLISH_CONTENT_VERSION && containsGameplayPolishFeatures(data.state)) return { ok: false, error: 'Specialist commissions and varied campaign schedules do not belong to this historical save version.' };
    if (![MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsModelCustomizationFeatures(data.state)) return { ok: false, error: 'Model customization and its research do not belong to this historical save version.' };
    if (![STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsStrategyFeatures(data.state)) return { ok: false, error: 'Development plans and strategy evidence do not belong to this historical save version.' };
    if (![MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsModelDesignFeatures(data.state)) return { ok: false, error: 'Custom model designs, advanced skills and architecture iterations do not belong to this historical save version.' };
    if (![CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsCampusFeatures(data.state)) return { ok: false, error: 'Campus profiles and successor silicon do not belong to this historical save version.' };
    if (![SYNTHETIC_CONTENT_VERSION, STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsSyntheticFeatures(data.state)) return { ok: false, error: 'Synthetic methods and receipts do not belong to this historical save version.' };
    if (![STUDIO_RELEASE_CONTENT_VERSION, CAMPUS_CONTENT_VERSION, WORKFORCE_POINTS_CONTENT_VERSION, MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(data.contentVersion) && containsStudioReleaseFeatures(data.state)) return { ok: false, error: 'Release telemetry and private appliances do not belong to this historical save version.' };
    if (data.schemaVersion === LEGACY_SCHEMA_VERSION && data.contentVersion === LEGACY_CONTENT_VERSION) {
      return migrateWave0State(data.state, content);
    }
    if (data.schemaVersion === 2 && data.contentVersion === WAVE1_CONTENT_VERSION) return migrateWave1State(data.state, content);
    if (data.schemaVersion === 3 && data.contentVersion === WAVE2_CONTENT_VERSION) return migrateWave2State(data.state, content);
    if (data.schemaVersion === 4 && data.contentVersion === WAVE3_CONTENT_VERSION) return migrateWave3State(data.state, content);
    if (content.version !== WAVE4_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE4_CONTENT_VERSION) return migrateWave4State(data.state, content);
    if (content.version !== WAVE5_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE5_CONTENT_VERSION) return migrateWave5State(data.state, content);
    if (content.version !== WAVE6_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE6_CONTENT_VERSION) return migrateWave6State(data.state, content);
    if (content.version !== WAVE7_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE7_CONTENT_VERSION) return migrateWave7State(data.state, content);
    if (content.version !== WAVE8_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE8_CONTENT_VERSION) return migrateWave8State(data.state, content);
    if (content.version !== WAVE9_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE9_CONTENT_VERSION) return migrateWave9State(data.state, content);
    if (content.version !== WAVE10_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE10_CONTENT_VERSION) return migrateWave10State(data.state, content);
    if (content.version !== WAVE11_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE11_CONTENT_VERSION) return migrateWave11State(data.state, content);
    if (content.version !== WAVE12_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE12_CONTENT_VERSION) return migrateWave12State(data.state, content);
    if (content.version !== WAVE13_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE13_CONTENT_VERSION) return migrateWave13State(data.state, content);
    if (content.version !== WAVE14_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE14_CONTENT_VERSION) return migrateWave14State(data.state, content);
    if (content.version !== WAVE15_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE15_CONTENT_VERSION) return migrateWave15State(data.state, content);
    if (content.version !== WAVE16_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE16_CONTENT_VERSION) return migrateWave16State(data.state, content);
    if (content.version !== WAVE17_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE17_CONTENT_VERSION) return migrateWave17State(data.state, content);
    if (content.version !== WAVE18_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE18_CONTENT_VERSION) return migrateWave18State(data.state, content);
    if (content.version !== WAVE19_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === WAVE19_CONTENT_VERSION) return migrateWave19State(data.state, content);
    if (content.version !== RELEASE_CAMPAIGN_VERSION && data.schemaVersion === 5 && data.contentVersion === RELEASE_CAMPAIGN_VERSION) return migrateWave21State(data.state, content);
    if (content.version !== SILICON_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === SILICON_CONTENT_VERSION) return migrateWave23State(data.state, content);
    if (content.version !== SYNTHETIC_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === SYNTHETIC_CONTENT_VERSION) return migrateWave26State(data.state, content);
    if (content.version !== STUDIO_RELEASE_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === STUDIO_RELEASE_CONTENT_VERSION) return migrateWave27State(data.state, content);
    if (content.version !== CAMPUS_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === CAMPUS_CONTENT_VERSION) return migrateWave28State(data.state, content);
    if ([MODEL_DESIGN_CONTENT_VERSION, STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) && data.schemaVersion === 5 && data.contentVersion === WORKFORCE_POINTS_CONTENT_VERSION) return migrateWave29State(data.state, content);
    if ([STRATEGY_CONTENT_VERSION, MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) && data.schemaVersion === 5 && data.contentVersion === MODEL_DESIGN_CONTENT_VERSION) return migrateModelDevelopmentState(data.state, content);
    if ([MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION].includes(content.version) && data.schemaVersion === 5 && data.contentVersion === STRATEGY_CONTENT_VERSION) return migrateStrategyState(data.state, content);
    if (content.version === GAMEPLAY_POLISH_CONTENT_VERSION && data.schemaVersion === 5 && data.contentVersion === MODEL_CUSTOMIZATION_CONTENT_VERSION) return migrateModelCustomizationState(data.state, content);
    if (data.schemaVersion !== SCHEMA_VERSION || data.contentVersion !== content.version) return { ok: false, error: 'This snapshot schema or content version is not supported by this build.' };
    const errors = validateState(data.state, content); if (errors.length) return { ok: false, error: errors[0].message };
    return { ok: true, state: data.state as GameState };
  } catch { return { ok: false, error: 'This file is not a valid Frontier Lab snapshot.' }; }
}
