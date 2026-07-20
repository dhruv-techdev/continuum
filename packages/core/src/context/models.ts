/**
 * Model token budget presets.
 *
 * Each preset reserves space for the system prompt and
 * the model's response, so the context budget is the
 * usable portion of the total context window.
 */

export interface ModelPreset {
  id: string;
  name: string;
  /** Total context window in tokens */
  contextWindow: number;
  /** Reserved for system prompt */
  systemReserve: number;
  /** Reserved for model response */
  responseReserve: number;
  /** Usable budget for context injection */
  usableBudget: number;
}

const PRESETS_RAW: Array<Omit<ModelPreset, 'usableBudget'>> = [
  { id: 'claude-haiku', name: 'Claude Haiku', contextWindow: 200000, systemReserve: 2000, responseReserve: 4096 },
  { id: 'claude-sonnet', name: 'Claude Sonnet', contextWindow: 200000, systemReserve: 2000, responseReserve: 8192 },
  { id: 'claude-opus', name: 'Claude Opus', contextWindow: 200000, systemReserve: 2000, responseReserve: 16384 },
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, systemReserve: 2000, responseReserve: 4096 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, systemReserve: 2000, responseReserve: 4096 },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, systemReserve: 2000, responseReserve: 4096 },
  { id: 'gemini-pro', name: 'Gemini Pro', contextWindow: 1000000, systemReserve: 2000, responseReserve: 8192 },
  { id: 'gemini-flash', name: 'Gemini Flash', contextWindow: 1000000, systemReserve: 2000, responseReserve: 8192 },
  { id: 'llama-70b', name: 'Llama 70B', contextWindow: 128000, systemReserve: 1000, responseReserve: 4096 },
  { id: 'llama-8b', name: 'Llama 8B', contextWindow: 128000, systemReserve: 1000, responseReserve: 2048 },
  { id: 'mistral-large', name: 'Mistral Large', contextWindow: 128000, systemReserve: 1000, responseReserve: 4096 },
  { id: 'small', name: 'Small context (8k)', contextWindow: 8192, systemReserve: 500, responseReserve: 2048 },
  { id: 'medium', name: 'Medium context (32k)', contextWindow: 32768, systemReserve: 1000, responseReserve: 4096 },
  { id: 'large', name: 'Large context (128k)', contextWindow: 131072, systemReserve: 2000, responseReserve: 8192 },
];

export const MODEL_PRESETS: ModelPreset[] = PRESETS_RAW.map((p) => ({
  ...p,
  usableBudget: p.contextWindow - p.systemReserve - p.responseReserve,
}));

export function getModelPreset(idOrName: string): ModelPreset | null {
  const lower = idOrName.toLowerCase();
  return MODEL_PRESETS.find(
    (p) => p.id === lower || p.name.toLowerCase() === lower,
  ) ?? null;
}

export function getUsableBudget(
  contextWindow: number,
  systemReserve = 2000,
  responseReserve = 4096,
): number {
  return Math.max(0, contextWindow - systemReserve - responseReserve);
}

export function listPresetIds(): string[] {
  return MODEL_PRESETS.map((p) => p.id);
}
