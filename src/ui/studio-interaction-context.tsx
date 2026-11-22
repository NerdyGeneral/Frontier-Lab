'use client';

import { createContext, useContext } from 'react';
import type { CommandPayload, GameState, StaffRole } from '../contracts/types';
import type { StudioTaskId } from '../core/studio-tasks';
import type { DevelopmentProjectDraft, ModelBlueprint } from '../persistence/model-workspace';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import type { ProductKind } from '../contracts/wave2-market';

/** The active task selects a presentation within an existing retained owner.
 * It never owns editable values or replaces the form's draft. */
const TaskModeContext = createContext<StudioTaskId | null>(null);
export const StudioTaskModeProvider = TaskModeContext.Provider;
export function useStudioTaskMode() { return useContext(TaskModeContext); }

/** A stable dispatcher keeps context updates from waking hidden retained forms.
 * Returning false preserves the ordinary inline/Classic command path. */
export type StudioCommandReview = (payload: CommandPayload, label: string, quotedState?: GameState) => boolean;
const CommandReviewContext = createContext<StudioCommandReview | null>(null);
export const StudioCommandReviewProvider = CommandReviewContext.Provider;
export function useStudioCommandReview() { return useContext(CommandReviewContext); }

/** Explicit navigation is consumed once by the model workbench. An unavailable
 * target is intentional and must never silently select the newest candidate. */
export interface StudioModelSelection {
  intentId: number;
  modelId: string | null;
  reportId?: string;
  unavailableReason?: string;
}
const ModelSelectionContext = createContext<StudioModelSelection | null>(null);
export const StudioModelSelectionProvider = ModelSelectionContext.Provider;
export function useStudioModelSelection() { return useContext(ModelSelectionContext); }

/** Exact, one-shot selections for the existing data, training and launch forms.
 * These are navigation intents, never a second owner of the editable draft. */
export interface StudioDataSelection {
  intentId: number;
  packetId?: string | null;
  view?: 'catalog';
  unavailableReason?: string;
}
const DataSelectionContext = createContext<StudioDataSelection | null>(null);
export const StudioDataSelectionProvider = DataSelectionContext.Provider;
export function useStudioDataSelection() { return useContext(DataSelectionContext); }
export type StudioTrainingSelection = StudioDataSelection
  | { intentId: number; designResearchId: string }
  | { intentId: number; designer: 'custom' }
  | { intentId: number; blueprint: ModelBlueprint; project?: DevelopmentProjectDraft }
  | { intentId: number; baseModelId: string | null; unavailableReason?: string };
export type StudioDevelopmentSelection = { intentId: number; blueprint: ModelBlueprint; project?: DevelopmentProjectDraft };
const DevelopmentSelectionContext = createContext<StudioDevelopmentSelection | null>(null);
export const StudioDevelopmentSelectionProvider = DevelopmentSelectionContext.Provider;
export function useStudioDevelopmentSelection() { return useContext(DevelopmentSelectionContext); }

interface DevelopmentNavigation {
  continueTraining: (baseModelId: string) => void;
  openDataLibrary: () => void;
}
const DevelopmentNavigationContext = createContext<DevelopmentNavigation | null>(null);
export const DevelopmentNavigationProvider = DevelopmentNavigationContext.Provider;
export function useContinueTraining() { return useContext(DevelopmentNavigationContext)?.continueTraining; }
export function useOpenTrainingDataLibrary() { return useContext(DevelopmentNavigationContext)?.openDataLibrary; }

const TrainingSelectionContext = createContext<StudioTrainingSelection | null>(null);
export const StudioTrainingSelectionProvider = TrainingSelectionContext.Provider;
export function useStudioTrainingSelection() { return useContext(TrainingSelectionContext); }

export interface StudioLaunchSelection extends StudioModelSelection { productKind?: ProductKind }
const LaunchSelectionContext = createContext<StudioLaunchSelection | null>(null);
export const StudioLaunchSelectionProvider = LaunchSelectionContext.Provider;
export function useStudioLaunchSelection() { return useContext(LaunchSelectionContext); }

/** An exact staffing request changes the retained People form once. A missing
 * employee stays unavailable until the player explicitly chooses another. */
export interface StudioStaffingSelection {
  intentId: number;
  mode: 'hire' | 'assign';
  role?: StaffRole;
  staffId?: string | null;
  reason?: string;
  unavailableReason?: string;
}
const StaffingSelectionContext = createContext<StudioStaffingSelection | null>(null);
export const StudioStaffingSelectionProvider = StaffingSelectionContext.Provider;
export function useStudioStaffingSelection() { return useContext(StaffingSelectionContext); }

/** Stable dispatchers keep hidden retained workbenches asleep. The shell owns
 * navigation and the bounded return link; the forms keep their existing state. */
export interface StudioTaskActions {
  prepareData: (packetId: string) => void;
  evaluateModel: (modelId: string) => void;
  launchBasicChat: (modelId: string, reportId?: string) => void;
  openProductForModel?: (kind: 'developer-api' | 'business-docs', modelId: string, reportId?: string) => void;
  reviewReport?: (reportId: string) => void;
  reviewResources: () => void;
  hireStaff: (role?: StaffRole, reason?: string) => void;
  assignStaff: (staffId?: string, reason?: string) => void;
  openTask?: (taskId: StudioTaskId) => void;
  openResearch?: (researchId: string) => void;
  openModelDesigner?: () => void;
  delegateTraining?: (training: DevelopmentTrainingOrder, project?: DevelopmentProjectDraft) => void;
  editTraining?: (blueprint: ModelBlueprint, project?: DevelopmentProjectDraft) => void;
}
const TaskActionsContext = createContext<StudioTaskActions | null>(null);
export const StudioTaskActionsProvider = TaskActionsContext.Provider;
export function useStudioTaskActions() { return useContext(TaskActionsContext); }
