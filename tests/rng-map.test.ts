import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/game/map';
import { SeededRng } from '../src/game/rng';

describe('seeded world generation', () => {
  it('replays the same random stream', () => {
    const first = new SeededRng(4815);
    const second = new SeededRng(4815);
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(Array.from({ length: 12 }, () => second.next()));
  });

  it('creates byte-equivalent states for the same seed and mode', () => {
    expect(createInitialState(99881, 'hotseat')).toEqual(createInitialState(99881, 'hotseat'));
  });

  it('creates different maps for different seeds', () => {
    const first = Object.values(createInitialState(1).tiles).map((tile) => tile.terrain);
    const second = Object.values(createInitialState(2).tiles).map((tile) => tile.terrain);
    expect(first).not.toEqual(second);
  });
});
