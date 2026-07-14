import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/game/ai';
import { createInitialState } from '../src/game/map';
import { applyCommand, currentPlayer } from '../src/game/rules';

describe('rival command AI', () => {
  it('uses valid commands and returns the turn to the human', () => {
    const initial = createInitialState(90210, 'single');
    const humanEnd = applyCommand(initial, { type: 'END_TURN' });
    expect(humanEnd.ok).toBe(true);
    const first = runAiTurn(humanEnd.state);
    const second = runAiTurn(humanEnd.state);
    expect(first).toEqual(second);
    expect(currentPlayer(first.state).id).toBe('p1');
    expect(first.state.round).toBe(2);
    expect(first.events.some((event) => event.type === 'SETTLEMENT_FOUNDED')).toBe(true);
  });

  it('can complete a full deterministic match without invalid state', () => {
    let state = createInitialState(1138, 'single');
    for (let round = 0; round < 30 && state.status === 'playing'; round += 1) {
      const humanEnd = applyCommand(state, { type: 'END_TURN' });
      expect(humanEnd.ok).toBe(true);
      state = humanEnd.state;
      if (state.status === 'playing') state = runAiTurn(state).state;
    }
    expect(state.status).toBe('finished');
    expect(state.scores?.p1.total).toBeTypeOf('number');
    expect(state.scores?.p2.total).toBeTypeOf('number');
  });
});
