import type { GameState } from './types';

export interface SaveSummary {
  id: string;
  seed: number;
  round: number;
  savedAt: string;
}

export interface GamePersistence {
  save(id: string, state: GameState): Promise<void>;
  load(id: string): Promise<GameState | undefined>;
  list(): Promise<SaveSummary[]>;
  remove(id: string): Promise<void>;
}

const PREFIX = 'aetherfall-save:';

export function validateGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameState>;
  return candidate.version === 1 &&
    typeof candidate.seed === 'number' &&
    typeof candidate.round === 'number' &&
    Array.isArray(candidate.players) && candidate.players.length === 2 &&
    Boolean(candidate.tiles) &&
    Array.isArray(candidate.armies) &&
    Array.isArray(candidate.settlements);
}

export class LocalGamePersistence implements GamePersistence {
  async save(id: string, state: GameState): Promise<void> {
    localStorage.setItem(`${PREFIX}${id}`, JSON.stringify({ state, savedAt: new Date().toISOString() }));
  }

  async load(id: string): Promise<GameState | undefined> {
    const raw = localStorage.getItem(`${PREFIX}${id}`);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { state: unknown };
      return validateGameState(parsed.state) ? parsed.state : undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<SaveSummary[]> {
    const result: SaveSummary[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '') as { state: GameState; savedAt: string };
        if (validateGameState(parsed.state)) result.push({ id: key.slice(PREFIX.length), seed: parsed.state.seed, round: parsed.state.round, savedAt: parsed.savedAt });
      } catch {
        // A damaged save is ignored rather than blocking the save menu.
      }
    }
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(`${PREFIX}${id}`);
  }
}

export function exportSave(state: GameState): string {
  return JSON.stringify({ game: 'Aetherfall Realms', exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importSave(json: string): GameState {
  const parsed = JSON.parse(json) as { state?: unknown } | GameState;
  const candidate = 'state' in parsed ? parsed.state : parsed;
  if (!validateGameState(candidate)) throw new Error('This file is not a compatible Aetherfall Realms save.');
  return candidate;
}
