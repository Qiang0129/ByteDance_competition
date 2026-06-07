import { createContext } from 'react';
import type { LlmTriggerStreamResult } from '../../api/labeler';

export interface LlmTriggerUiState {
  generating: boolean;
  streamText: string;
  result: LlmTriggerStreamResult | null;
  error: string;
}

export type LlmTriggerStateUpdater =
  | Partial<LlmTriggerUiState>
  | ((previous: LlmTriggerUiState) => LlmTriggerUiState);

export interface LlmTriggerStateContextValue {
  states: Record<string, LlmTriggerUiState>;
  updateState: (fieldName: string, updater: LlmTriggerStateUpdater) => void;
}

export const EMPTY_LLM_TRIGGER_STATE: LlmTriggerUiState = {
  generating: false,
  streamText: '',
  result: null,
  error: '',
};

export const LlmTriggerStateContext = createContext<LlmTriggerStateContextValue | null>(null);
