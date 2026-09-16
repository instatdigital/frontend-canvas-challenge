import { createContext, useContext } from 'react';
import type { Attempt, Scenario } from '../generation/GenerationManager';
import type { CanvasNodeData } from '../graph/model';

export type EditorContextValue = {
  updateNodeData: (nodeId: string, data: CanvasNodeData) => void;
  removeNode: (nodeId: string) => void;
  setScenario: (nodeId: string, scenario: Scenario) => void;
  scenarioFor: (nodeId: string) => Scenario;
  generate: (nodeId: string) => void;
  retryError: (nodeId: string) => void;
  attemptFor: (nodeId: string) => Attempt | undefined;
  attemptForResult: (nodeId: string) => Attempt | undefined;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (value === null) throw new Error('EditorContext недоступен');
  return value;
}
