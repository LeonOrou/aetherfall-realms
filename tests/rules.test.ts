import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey } from '../src/game/hex';
import { createInitialState } from '../src/game/map';
import { applyCommand, calculateScore } from '../src/game/rules';
import type { GameCommand } from '../src/game/types';

describe('deterministic rules engine', () => {
  it('does not mutate state when a command is invalid', () => {
    const state = createInitialState(23);
    const snapshot = JSON.stringify(state);
    const result = applyCommand(state, { type: 'MOVE_ARMY', armyId: 'army-1', to: { q: 99, r: 99 } });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('produces identical states from identical commands', () => {
    const first = createInitialState(88, 'hotseat');
    const second = createInitialState(88, 'hotseat');
    const scout = first.armies.find((army) => army.id === 'army-1')!;
    const neighbor = Object.values(first.tiles).find((tile) =>
      Math.max(Math.abs(tile.coord.q - scout.coord.q), Math.abs(tile.coord.r - scout.coord.r)) <= 1 &&
      hexKey(tile.coord) !== hexKey(scout.coord) &&
      !['lake', 'mountain'].includes(tile.terrain)
    )!;
    const commands: GameCommand[] = [
      { type: 'MOVE_ARMY', armyId: 'army-1', to: neighbor.coord },
      { type: 'CHOOSE_DISCOVERY', discoveryId: 'cultivation' },
      { type: 'END_TURN' }
    ];
    let stateA = first;
    let stateB = second;
    for (const command of commands) {
      const resultA = applyCommand(stateA, command);
      const resultB = applyCommand(stateB, command);
      expect(resultA.ok).toBe(resultB.ok);
      stateA = resultA.state;
      stateB = resultB.state;
    }
    expect(stateA).toEqual(stateB);
  });

  it('founds a settlement through a validated command', () => {
    const state = createInitialState(41);
    const result = applyCommand(state, { type: 'FOUND_SETTLEMENT', armyId: 'army-1' });
    expect(result.ok).toBe(true);
    expect(result.state.settlements).toHaveLength(1);
    expect(result.state.settlements[0].playerId).toBe('p1');
    expect(result.state.players[0].resources.materials).toBe(6);
    expect(result.events[0].type).toBe('SETTLEMENT_FOUNDED');
  });

  it('lets a ranger strike within two hexes without retaliation', () => {
    const state = createInitialState(414);
    const ranger = state.armies.find((army) => army.id === 'army-1')!;
    ranger.unitType = 'ranger';
    ranger.strength = 9;
    ranger.moves = 2;
    const targetTile = Object.values(state.tiles).find((tile) => hexDistance(tile.coord, ranger.coord) === 2)!;
    const monster = state.armies.find((army) => army.playerId === 'monsters')!;
    monster.coord = { ...targetTile.coord };
    const startingHp = monster.hp;
    const result = applyCommand(state, { type: 'RANGED_ATTACK', armyId: ranger.id, target: monster.coord });
    expect(result.ok).toBe(true);
    expect(result.state.armies.find((army) => army.id === ranger.id)?.hp).toBe(ranger.hp);
    expect(result.state.armies.find((army) => army.id === monster.id)?.hp).toBeLessThan(startingHp);
    expect(result.events[0]).toMatchObject({ type: 'COMBAT', attackerDamage: 0 });
  });

  it('finishes after thirty complete hot-seat rounds and scores both realms', () => {
    let state = createInitialState(700, 'hotseat');
    for (let turn = 0; turn < 60; turn += 1) {
      const result = applyCommand(state, { type: 'END_TURN' });
      expect(result.ok).toBe(true);
      state = result.state;
    }
    expect(state.status).toBe('finished');
    expect(state.scores?.p1.total).toBe(calculateScore(state, 'p1').total);
    expect(state.winnerId).toMatch(/^p[12]$/);
  });
});
