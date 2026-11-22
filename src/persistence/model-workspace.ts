import type { CapabilityDomain, EvaluationSuiteId, TrainingProfile } from '../contracts/types';
import type { TrainingWorkspace } from '../contracts/wave2-lab';
import type { ModelDesignSpec } from '../contracts/model-design';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import type { DevelopmentGoal } from '../contracts/development-objectives';
import { isDevelopmentGoal } from '../contracts/development-objectives';
export type { DevelopmentGoal } from '../contracts/development-objectives';
export { isDevelopmentGoal } from '../contracts/development-objectives';
import type { ReplayTrainingChoice } from '../contracts/wave15-replay';
import type { TrainingCurriculumChoice } from '../contracts/wave17-curriculum';
import { assertCommandShape } from '../core/command-shape';
import { modelDesignShapeRejection } from '../modules/model-design';
import type { ResultsPersistence, ResultsSessionMode, SavedByteBinding } from './studio-results';

export const MODEL_WORKSPACE_KEY = 'frontier-lab.model-workspace.v1';
export const MODEL_WORKSPACE_LIMIT = 128 * 1024;
export const BLUEPRINT_LIMIT = 12;
export interface ManualTrainingDraft {
  recipeId: string; designRoute: 'custom' | 'methods' | null; designDraft: ModelDesignSpec | null;
  baseId: string | null; packetId: string | null; explicitPacket: boolean; extraPackets: string[];
  profile: TrainingProfile | 'reference'; workspace: TrainingWorkspace | ''; automated: boolean; asAdapter: boolean;
  retentionMode: 'none' | 'replay' | 'curriculum'; replayChoice: ReplayTrainingChoice; curriculumChoice: TrainingCurriculumChoice;
  architecture: 'dense' | 'sparse'; teacherId: string; teacherDomain: CapabilityDomain;
  trainingView: 'guided' | 'advanced'; designOpen: boolean;
  /** The project being edited survives a manual/delegated round trip and reload. */
  project?: DevelopmentProjectDraft;
}
export interface DelegatedTrainingDraft {
  name: string; baseId: string; selected: string[]; method: string; profile: TrainingProfile;
  teacherId: string; teacherDomain: CapabilityDomain; design: ModelDesignSpec; suiteId: EvaluationSuiteId;
  budget: string; reserve: string; duration: string;
  leadStaffId?: string; capacityShareBps?: number;
  /** A manual handoff preserves every advanced option until explicitly edited. */
  importedTraining: DevelopmentTrainingOrder | null;
}
export interface DevelopmentProjectDraft {
  name: string; suiteId: EvaluationSuiteId; budget: string; reserve: string; duration: string;
  leadStaffId?: string; capacityShareBps?: number;
  objective?: DevelopmentGoal | null;
}
export interface ModelBlueprint { id: string; name: string; training: DevelopmentTrainingOrder; suiteId?: EvaluationSuiteId; objective?: DevelopmentGoal }
export interface ModelWorkspaceData {
  manual: ManualTrainingDraft | null; delegated: DelegatedTrainingDraft | null; blueprints: ModelBlueprint[];
  /** A planning objective shared by manual work, delegated work and research.
   * This is optional so historical browser drafts remain byte-compatible. */
  developmentGoal?: DevelopmentGoal | null;
}
export interface ModelWorkspaceSnapshot extends ModelWorkspaceData { ready: boolean; epoch: number; notice: string; persistent: boolean }
export interface ModelWorkspacePersistence extends ResultsPersistence { hashSync?(bytes: string): SavedByteBinding }
interface Envelope { version: 1; playerId: string; timelineToken: string; binding: SavedByteBinding; data: ModelWorkspaceData }
type Session = { playerId: string; mode: ResultsSessionMode; savedBytes?: string };
const empty = (): ModelWorkspaceData => ({ manual: null, delegated: null, blueprints: [], developmentGoal: undefined });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every(x => text(x));
const oneOf = (v: unknown, choices: readonly unknown[]) => choices.includes(v);
const domains = ['conversation', 'documents', 'coding', 'tools'];
const suites = ['basic-conversation-1', 'expanded-capabilities-1', 'advanced-capabilities-1', 'behavior-cases-1'];
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === keys.sort().join();
function design(v: unknown): v is ModelDesignSpec {
  if (!object(v) || !text(v.name, 48) || !object(v.dataMix)) return false;
  // A blank name or zeroed mix is a legitimate unfinished form, never a command.
  const mix = Object.values(v.dataMix).every(n => n === 0) ? { ...v.dataMix, conversation: 1 } : v.dataMix;
  return !modelDesignShapeRejection({ ...v, name: v.name.trim() || 'Untitled', dataMix: mix });
}
function replay(v: unknown): v is ReplayTrainingChoice {
  return object(v) && exact(v, ['domain', 'shareBps', 'packetIds']) && oneOf(v.domain, domains)
    && Number.isSafeInteger(v.shareBps) && (v.shareBps as number) >= 0 && (v.shareBps as number) <= 10000 && ids(v.packetIds);
}
function curriculum(v: unknown): v is TrainingCurriculumChoice {
  return object(v) && exact(v, ['shareBps', 'tracks']) && Number.isSafeInteger(v.shareBps)
    && (v.shareBps as number) >= 0 && (v.shareBps as number) <= 10000 && Array.isArray(v.tracks) && v.tracks.length === 2
    && v.tracks.every(t => object(t) && exact(t, ['domain', 'packetIds']) && oneOf(t.domain, domains) && ids(t.packetIds));
}
export function isTrainingBlueprintOrder(value: unknown): value is DevelopmentTrainingOrder {
  if (!object(value) || value.kind !== 'start_training'
    || Object.keys(value).some(k => !['kind','baseModelId','packetId','packetIds','recipeId','modelDesign','profile','workspace','continueFromParent','automatedCheckpoints','teacherModelId','teacherDomain','architecture','asAdapter','replay','curriculum'].includes(k))) return false;
  try { assertCommandShape(value as unknown as DevelopmentTrainingOrder); return true; } catch { return false; }
}
export function isManualTrainingDraft(v: unknown): v is ManualTrainingDraft {
  return object(v) && exact(v, ['recipeId','designRoute','designDraft','baseId','packetId','explicitPacket','extraPackets','profile','workspace','automated','asAdapter','retentionMode','replayChoice','curriculumChoice','architecture','teacherId','teacherDomain','trainingView','designOpen', ...(Object.hasOwn(v, 'project') ? ['project'] : [])])
    && text(v.recipeId) && oneOf(v.designRoute, ['custom','methods',null]) && (v.designDraft === null || design(v.designDraft))
    && (v.baseId === null || text(v.baseId)) && (v.packetId === null || text(v.packetId)) && ids(v.extraPackets)
    && typeof v.explicitPacket === 'boolean' && typeof v.automated === 'boolean' && typeof v.asAdapter === 'boolean' && typeof v.designOpen === 'boolean'
    && oneOf(v.profile, ['reference','stable','balanced','ambitious']) && oneOf(v.workspace, ['','recompute','large-batch'])
    && oneOf(v.retentionMode, ['none','replay','curriculum']) && replay(v.replayChoice) && curriculum(v.curriculumChoice)
    && oneOf(v.architecture, ['dense','sparse']) && text(v.teacherId) && oneOf(v.teacherDomain, domains) && oneOf(v.trainingView, ['guided','advanced'])
    && (!Object.hasOwn(v, 'project') || isDevelopmentProjectDraft(v.project));
}
export function isDevelopmentProjectDraft(v: unknown): v is DevelopmentProjectDraft {
  return object(v) && exact(v, ['name','suiteId','budget','reserve','duration', ...['leadStaffId','capacityShareBps','objective'].filter(key => Object.hasOwn(v, key))])
    && text(v.name,60) && oneOf(v.suiteId, suites) && text(v.budget,40) && text(v.reserve,40) && text(v.duration,40)
    && (v.leadStaffId === undefined || text(v.leadStaffId) && !!v.leadStaffId)
    && (v.capacityShareBps === undefined || Number.isSafeInteger(v.capacityShareBps) && (v.capacityShareBps as number) >= 1000 && (v.capacityShareBps as number) <= 10000 && (v.capacityShareBps as number) % 500 === 0)
    && (v.objective === undefined || v.objective === null || isDevelopmentGoal(v.objective));
}
export function isDelegatedTrainingDraft(v: unknown): v is DelegatedTrainingDraft {
  return object(v) && exact(v, ['name','baseId','selected','method','profile','teacherId','teacherDomain','design','suiteId','budget','reserve','duration','importedTraining', ...['leadStaffId','capacityShareBps'].filter(key => Object.hasOwn(v,key))])
    && text(v.name,60) && text(v.baseId) && ids(v.selected) && text(v.method) && oneOf(v.profile, ['stable','balanced','ambitious'])
    && text(v.teacherId) && oneOf(v.teacherDomain, domains) && design(v.design) && oneOf(v.suiteId, suites)
    && text(v.budget,40) && text(v.reserve,40) && text(v.duration,40)
    && (v.leadStaffId === undefined || text(v.leadStaffId) && !!v.leadStaffId)
    && (v.capacityShareBps === undefined || Number.isSafeInteger(v.capacityShareBps) && (v.capacityShareBps as number) >= 1000 && (v.capacityShareBps as number) <= 10000 && (v.capacityShareBps as number) % 500 === 0)
    && (v.importedTraining === null || isTrainingBlueprintOrder(v.importedTraining));
}
/** Pure, version-independent metadata validation for portable save envelopes.
 * It admits no commands or assets; loaded drafts still face normal admission. */
export function isModelWorkspaceData(value: unknown): value is ModelWorkspaceData {
  if (!object(value) || !exact(value, ['manual', 'delegated', 'blueprints', ...(Object.hasOwn(value, 'developmentGoal') ? ['developmentGoal'] : [])])
    || (value.developmentGoal !== undefined && value.developmentGoal !== null && !isDevelopmentGoal(value.developmentGoal))
    || (value.manual !== null && !isManualTrainingDraft(value.manual)) || (value.delegated !== null && !isDelegatedTrainingDraft(value.delegated))
    || !Array.isArray(value.blueprints) || value.blueprints.length > BLUEPRINT_LIMIT) return false;
  const seen = new Set<string>();
  for (const b of value.blueprints) {
    if (!object(b) || !exact(b, ['id','name','training', ...['suiteId','objective'].filter(key => Object.hasOwn(b,key))])
      || !text(b.id) || !b.id || seen.has(b.id) || !text(b.name,48) || !b.name.trim() || !isTrainingBlueprintOrder(b.training)
      || (b.suiteId !== undefined && !oneOf(b.suiteId,suites)) || (b.objective !== undefined && !isDevelopmentGoal(b.objective))) return false;
    seen.add(b.id);
  }
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= MODEL_WORKSPACE_LIMIT; } catch { return false; }
}
export function modelWorkspaceDataForExport(value: ModelWorkspaceData): ModelWorkspaceData {
  const { manual, delegated, blueprints, developmentGoal } = value;
  return structuredClone({ manual, delegated, blueprints, ...(developmentGoal !== undefined ? { developmentGoal } : {}) });
}
export function parseModelWorkspace(textValue: string | null): Envelope | null {
  if (!textValue || new TextEncoder().encode(textValue).length > MODEL_WORKSPACE_LIMIT) return null;
  try {
    const v: unknown = JSON.parse(textValue);
    if (!object(v) || !exact(v,['version','playerId','timelineToken','binding','data']) || v.version !== 1 || !text(v.playerId,512)
      || typeof v.timelineToken !== 'string' || !/^[a-f0-9]{32}$/.test(v.timelineToken) || !object(v.binding)
      || !exact(v.binding,['algorithm','digest','byteLength']) || v.binding.algorithm !== 'SHA-256'
      || typeof v.binding.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.binding.digest) || !Number.isSafeInteger(v.binding.byteLength) || (v.binding.byteLength as number) < 1
      || !isModelWorkspaceData(v.data)) return null;
    return v as unknown as Envelope;
  } catch { return null; }
}

/** Drafts are local UI metadata, bound to the exact saved lab. They never submit
 * commands, alter owned assets, or overwrite a save from another tab. */
export class ModelWorkspaceController {
  private state: ModelWorkspaceSnapshot = { ...empty(), ready: false, epoch: 0, notice: '', persistent: false };
  private listeners = new Set<() => void>();
  private mode: ResultsSessionMode = 'acquiring';
  private session = 0; private receipt = 0; private playerId = ''; private token = '';
  private binding: SavedByteBinding | null = null; private bytes: string | null = null; private latestBytes: string | null = null;
  private initialization = Promise.resolve();
  constructor(private io: ModelWorkspacePersistence) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<ModelWorkspaceSnapshot>) { this.state = { ...this.state, ...next }; this.listeners.forEach(l => l()); }
  suspend = () => { this.session++; this.receipt++; this.mode = 'acquiring'; this.binding = null; this.bytes = null; this.publish({ ready: false, persistent: false }); };
  replace = (input: Session) => this.open(input, true);
  open = (input: Session, replacing = false) => {
    const session = ++this.session; this.receipt++; this.mode = input.mode; this.playerId = input.playerId;
    this.binding = null; this.bytes = null; this.latestBytes = input.savedBytes ?? null;
    try { this.token = this.io.token(); } catch { this.token = ''; }
    this.publish({ ...empty(), ready: false, epoch: this.state.epoch + 1, persistent: false, notice: '' });
    let stored: Envelope | null = null;
    if (input.mode === 'owner') {
      if (replacing || !input.savedBytes) { try { this.io.remove(); } catch { try { this.io.write(''); } catch { /* Keep the new draft in this tab. */ } } }
      else { try { stored = parseModelWorkspace(this.io.read()); } catch { /* A draft must never block opening a lab. */ } }
    }
    if (input.mode !== 'owner' || !input.savedBytes || !this.token) {
      this.publish({ ready: true, notice: input.mode === 'observer' ? 'Draft changes are unavailable in this viewing tab.' : 'Drafts are kept in this tab until the lab is saved.' });
      this.initialization = Promise.resolve(); return;
    }
    const bytes = input.savedBytes;
    this.initialization = this.io.hash(bytes).then(binding => {
      if (session !== this.session || this.mode !== 'owner') return;
      if (!this.io.snapshotMatches(this.latestBytes ?? bytes)) { this.publish({ ready: true, notice: 'Drafts are kept in this tab.' }); return; }
      if (!replacing && stored?.playerId === this.playerId && stored.binding.digest === binding.digest && stored.binding.byteLength === binding.byteLength) {
        this.token = stored.timelineToken; this.publish(structuredClone(stored.data));
      }
      this.binding = binding; this.bytes = bytes; this.publish({ ready: true }); this.persist();
    }).catch(() => { if (session === this.session) this.publish({ ready: true, notice: 'Drafts are kept in this tab.' }); });
  };
  saved = (bytes: string) => {
    if (this.mode !== 'owner' || !this.token) return Promise.resolve();
    const session = this.session, receipt = ++this.receipt; this.latestBytes = bytes;
    if (this.state.ready && (this.io.hashSync || this.bytes === bytes && this.binding)) {
      try {
        if (!this.io.snapshotMatches(bytes)) return Promise.resolve();
        const binding = this.bytes === bytes && this.binding ? this.binding : this.io.hashSync!(bytes);
        if (session !== this.session || receipt !== this.receipt || this.mode !== 'owner' || !this.io.snapshotMatches(bytes)) return Promise.resolve();
        this.bytes = bytes; this.binding = binding; this.persist();
      } catch { if (session === this.session && receipt === this.receipt) this.publish({ persistent: false, notice: 'Drafts are kept in this tab.' }); }
      return Promise.resolve();
    }
    return this.initialization.then(() => this.io.hash(bytes)).then(binding => {
      if (session !== this.session || receipt !== this.receipt || this.mode !== 'owner' || !this.io.snapshotMatches(bytes)) return;
      this.bytes = bytes; this.binding = binding; this.persist();
    }).catch(() => { if (session === this.session && receipt === this.receipt) this.publish({ persistent: false, notice: 'Drafts are kept in this tab.' }); });
  };
  private persist() {
    if (this.mode !== 'owner' || !this.state.ready || !this.binding || !this.bytes || !this.token) return;
    try {
      if (!this.io.snapshotMatches(this.bytes)) return;
      const { manual, delegated, blueprints, developmentGoal } = this.state;
      const encoded = JSON.stringify({ version: 1, playerId: this.playerId, timelineToken: this.token, binding: this.binding, data: { manual, delegated, blueprints, ...(developmentGoal !== undefined ? { developmentGoal } : {}) } });
      if (!parseModelWorkspace(encoded)) throw new Error('Draft limit');
      this.io.write(encoded);
      if (!this.state.persistent || this.state.notice) this.publish({ persistent: true, notice: '' });
    } catch { if (this.state.persistent || this.state.notice !== 'Drafts are kept in this tab. Browser storage is unavailable.') this.publish({ persistent: false, notice: 'Drafts are kept in this tab. Browser storage is unavailable.' }); }
  }
  setDraft = <K extends 'manual' | 'delegated'>(kind: K, draft: ModelWorkspaceData[K]) => {
    if (!this.state.ready || !['owner','memory'].includes(this.mode)) return;
    if (draft !== null && !(kind === 'manual' ? isManualTrainingDraft(draft) : isDelegatedTrainingDraft(draft))) return;
    if (JSON.stringify(this.state[kind]) === JSON.stringify(draft)) return;
    this.publish({ [kind]: structuredClone(draft) }); this.persist();
  };
  setDevelopmentGoal = (goal: DevelopmentGoal | null) => {
    if (!this.state.ready || !['owner', 'memory'].includes(this.mode) || (goal !== null && !isDevelopmentGoal(goal))) return;
    if (JSON.stringify(this.state.developmentGoal) === JSON.stringify(goal)) return;
    this.publish({ developmentGoal: goal && structuredClone(goal) }); this.persist();
  };
  restoreData = async (data: unknown): Promise<boolean> => {
    const session = this.session;
    if (!isModelWorkspaceData(data)) return false;
    await this.initialization;
    if (session !== this.session || !this.state.ready || !['owner','memory'].includes(this.mode)) return false;
    this.publish({ ...modelWorkspaceDataForExport(data), epoch: this.state.epoch + 1 }); this.persist(); return true;
  };
  saveBlueprint = (name: string, training: DevelopmentTrainingOrder, suiteId?: EvaluationSuiteId): string | null => {
    if (!this.state.ready || !['owner','memory'].includes(this.mode)) return 'Wait for this lab to finish opening.';
    if (!text(name,48) || !name.trim()) return 'Give the blueprint a name of 1–48 characters.';
    if (!isTrainingBlueprintOrder(training) || (suiteId && !oneOf(suiteId,suites))) return 'Complete the model and data choices before saving a blueprint.';
    const existing = this.state.blueprints.find(b => b.name.toLowerCase() === name.trim().toLowerCase());
    if (!existing && this.state.blueprints.length >= BLUEPRINT_LIMIT) return 'You have 12 blueprints. Reuse an existing name to replace one.';
    const blueprint: ModelBlueprint = { id: existing?.id ?? 'blueprint-' + this.state.blueprints.length + '-' + this.state.epoch, name: name.trim(), training: structuredClone(training), ...(suiteId ? { suiteId } : {}), ...(this.state.developmentGoal ? { objective: structuredClone(this.state.developmentGoal) } : {}) };
    this.publish({ blueprints: existing ? this.state.blueprints.map(b => b.id === existing.id ? blueprint : b) : [...this.state.blueprints, blueprint] }); this.persist(); return null;
  };
}
