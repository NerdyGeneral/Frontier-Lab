export type RoutingPolicy = 'economy' | 'balanced' | 'quality';
export type ProductAudience = 'broad' | 'value' | 'professional';
export interface ProductStrategy {
  audience: ProductAudience;
  routingPolicy: RoutingPolicy;
  updatedWeek: number;
  commandId: string;
}
export type ChapterId = 'first-product' | 'efficient-portfolio' | 'advanced-specialist' | 'frontier-lab';
export interface ChapterProof {
  week: number;
  productId: string;
  modelId: string;
  reportIds: string[];
  paidAccounts: number;
  billedCents: number;
  fulfillmentBps: number;
  revenueCents: number;
  operatingExpenseCents: number;
  routingPolicy: RoutingPolicy;
  strategyCommandId: string | null;
  routingInstallationId: string | null;
  secondaryModelId: string | null;
}
export interface ChapterAchievement {
  id: ChapterId;
  selectedWeek: number;
  selectionCommandId: string;
  completedWeek: number;
  proof: ChapterProof[];
}
export interface ChapterProgress {
  active: ChapterId | null;
  selectedWeek: number;
  selectionCommandId: string;
  streak: number;
  progress: ChapterProof[];
  completed: Partial<Record<ChapterId, ChapterAchievement>>;
}
export type StrategicVarietyCommand =
  | { kind: 'set_product_strategy'; productId: string; audience: ProductAudience; routingPolicy: RoutingPolicy }
  | { kind: 'select_chapter'; chapterId: ChapterId };
