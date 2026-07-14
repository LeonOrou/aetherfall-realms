import type { GameCommand, GameState } from './types';

export interface VersionedSnapshot {
  gameId: string;
  state: GameState;
  version: number;
  commandCount: number;
}

export interface SubmitResult {
  accepted: boolean;
  snapshot?: VersionedSnapshot;
  reason?: 'conflict' | 'invalid' | 'forbidden';
}

/**
 * A future server adapter must authenticate the actor and validate commands
 * server-side. The browser never gets to declare its own next state.
 */
export interface MultiplayerBackend {
  createGame(seed: number, invitedPlayerIds: string[]): Promise<VersionedSnapshot>;
  getGame(gameId: string): Promise<VersionedSnapshot>;
  submitCommand(gameId: string, expectedVersion: number, command: GameCommand): Promise<SubmitResult>;
  subscribe(gameId: string, onSnapshot: (snapshot: VersionedSnapshot) => void): () => void;
}
