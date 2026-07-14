import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/game/map';
import { exportSave, importSave, validateGameState } from '../src/game/persistence';

describe('portable saves', () => {
  it('round-trips a game as JSON', () => {
    const state = createInitialState(551, 'hotseat');
    expect(importSave(exportSave(state))).toEqual(state);
  });

  it('rejects incompatible JSON shapes', () => {
    expect(validateGameState({ version: 9, players: [] })).toBe(false);
    expect(() => importSave('{"surprise":"dragon"}')).toThrow(/not a compatible/i);
  });
});
