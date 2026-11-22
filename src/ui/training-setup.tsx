import type { ReactNode } from 'react';
import { Blocks, Brain, Code2, Files, GraduationCap, MessageCircle } from 'lucide-react';
import type { DataPacket, GameState, ModelVersion } from '../contracts/types';
import { TRAINING_RECIPES } from '../content/wave2-lab';
import { hasResearch } from '../modules/research';
import type { TrainingRecipe } from '../contracts/wave2-lab';

export const TRAINING_GOALS = [
  { id: 'conversation', label: 'Conversation', icon: MessageCircle },
  { id: 'documents', label: 'Documents', icon: Files },
  { id: 'coding', label: 'Coding & tools', icon: Code2 },
  { id: 'behavior', label: 'Reliability & behavior', icon: Brain },
  { id: 'model', label: 'Build a foundation', icon: Blocks },
  { id: 'teacher', label: 'Learn from a teacher', icon: GraduationCap },
] as const;

export function trainingGoal(recipe: TrainingRecipe) {
  if (recipe.kind === 'foundation') return 'model';
  if (recipe.kind === 'distillation' || recipe.kind === 'synthetic') return 'teacher';
  if (recipe.kind !== 'adaptation') return 'behavior';
  if (recipe.id === 'document-adaptation' || recipe.id === 'document-extractor') return 'documents';
  if (recipe.id === 'coding-tools-adaptation' || recipe.id === 'tool-dispatcher') return 'coding';
  return 'conversation';
}

export function latestTrainingBase(game: GameState, versions: ModelVersion[]) {
  const completed = versions.filter(model => model.trainingRunId && game.slices.models.trainingRuns[model.trainingRunId]?.outputModelId === model.id);
  return completed.sort((a, b) => (b.createdWeek ?? 0) - (a.createdWeek ?? 0) || a.id.localeCompare(b.id))[0] ?? versions.find(model => !model.trainingRunId) ?? versions[0];
}

function relevantExamples(packet: DataPacket, recipe: TrainingRecipe) {
  if (recipe.kind === 'policy') return packet.policy ? packet.readyUnits : 0;
  if (recipe.kind === 'synthetic') return packet.synthetic ? packet.readyUnits : 0;
  if (recipe.kind === 'foundation') return packet.broadUnits ?? 0;
  if (['behavior', 'planning', 'calibration'].includes(recipe.kind)) return packet.behaviorUnits ?? 0;
  const coverage = packet.coverageBps;
  const goal = trainingGoal(recipe);
  const relevant = goal === 'documents' ? coverage.documents : goal === 'coding' ? recipe.id === 'tool-dispatcher' ? coverage.tools : coverage.tools + coverage.coding : coverage.conversation;
  return packet.readyUnits * relevant / 10_000;
}

// Choose a prepared packet suitable for the opening draft. An explicit selection always wins.
export function suggestedTrainingPacket(packets: DataPacket[], recipe: TrainingRecipe) {
  return packets.filter(packet => packet.prepared).sort((a, b) =>
    relevantExamples(b, recipe) * b.qualityBps - relevantExamples(a, recipe) * a.qualityBps || a.id.localeCompare(b.id))[0] ?? packets[0];
}

export function TrainingStepTitle({ step, children }: { step: number; children: ReactNode }) {
  return <h3 className="training-step-title"><span className="training-step-number" aria-label={'Step ' + step}>{step}</span>{children}</h3>;
}

export function TrainingGoalChoices({ game, recipe, canAct, onChange }: { game: GameState; recipe: TrainingRecipe; canAct: boolean; onChange: (id: string) => void }) {
  const active = trainingGoal(recipe);
  return <div className="training-goal-choices" role="group" aria-label="Training purpose">
    {TRAINING_GOALS.map(goal => {
      const methods = TRAINING_RECIPES.filter(item => trainingGoal(item) === goal.id);
      const available = methods.find(item => !item.requiredResearch || hasResearch(game, game.playerCompanyId, item.requiredResearch));
      return <button key={goal.id} type="button" aria-pressed={active === goal.id} disabled={!canAct}
        onClick={() => { if (active !== goal.id) onChange((available ?? methods[0]).id); }}>
        <goal.icon aria-hidden="true" strokeWidth={1.6} size={17} /><span>{goal.label}{!available && <small>Needs research</small>}</span>
      </button>;
    })}
  </div>;
}
