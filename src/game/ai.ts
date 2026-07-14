import { BUILDINGS, DISCOVERIES, TERRAINS, UNITS } from './data';
import { hexDistance, hexKey, hexNeighbors, sameHex } from './hex';
import { applyCommand, currentPlayer } from './rules';
import type { DiscoveryId, GameCommand, GameEvent, GameState, HexCoord } from './types';

function issue(state: GameState, command: GameCommand, events: GameEvent[]): GameState {
  const result = applyCommand(state, command);
  if (!result.ok) return state;
  events.push(...result.events);
  return result.state;
}

function availableDiscovery(state: GameState): DiscoveryId | undefined {
  const player = currentPlayer(state);
  return (Object.keys(DISCOVERIES) as DiscoveryId[]).find((id) => {
    const discovery = DISCOVERIES[id];
    return !player.discoveries.includes(id) && discovery.requires.every((requirement) => player.discoveries.includes(requirement));
  });
}

function targetForArmy(state: GameState, armyId: string): HexCoord | undefined {
  const player = currentPlayer(state);
  const army = state.armies.find((candidate) => candidate.id === armyId)!;
  const enemies = state.armies
    .filter((candidate) => !candidate.defeated && candidate.playerId !== player.id && candidate.playerId !== 'monsters')
    .sort((a, b) => hexDistance(army.coord, a.coord) - hexDistance(army.coord, b.coord));
  const sites = state.sites
    .filter((site) => !site.resolvedBy.includes(player.id))
    .sort((a, b) => hexDistance(army.coord, a.coord) - hexDistance(army.coord, b.coord));
  const unknown = Object.values(state.tiles)
    .filter((tile) => !tile.discoveredBy.includes(player.id) && TERRAINS[tile.terrain].passable)
    .sort((a, b) => hexDistance(army.coord, a.coord) - hexDistance(army.coord, b.coord));
  if (army.unitType !== 'scout' && enemies[0] && hexDistance(army.coord, enemies[0].coord) <= 5) return enemies[0].coord;
  return sites[0]?.coord ?? unknown[0]?.coord ?? enemies[0]?.coord;
}

function bestStep(state: GameState, armyId: string, target: HexCoord): HexCoord | undefined {
  const army = state.armies.find((candidate) => candidate.id === armyId)!;
  return hexNeighbors(army.coord)
    .filter((coord) => {
      const tile = state.tiles[hexKey(coord)];
      if (!tile) return false;
      const frozenLake = tile.terrain === 'lake' && tile.frozenUntil && tile.frozenUntil >= state.round;
      const occupiedFriendly = state.armies.some((candidate) => !candidate.defeated && candidate.id !== army.id && candidate.playerId === army.playerId && sameHex(candidate.coord, coord));
      return !occupiedFriendly && (TERRAINS[tile.terrain].passable || Boolean(frozenLake));
    })
    .sort((a, b) => hexDistance(a, target) - hexDistance(b, target))[0];
}

export function runAiTurn(initial: GameState): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  const player = currentPlayer(state);
  if (player.human || state.status !== 'playing') return { state, events };

  if (!player.activeDiscovery) {
    const discovery = availableDiscovery(state);
    if (discovery) state = issue(state, { type: 'CHOOSE_DISCOVERY', discoveryId: discovery }, events);
  }

  const scouts = state.armies.filter((army) => army.playerId === player.id && army.unitType === 'scout' && !army.defeated);
  const ownSettlements = state.settlements.filter((settlement) => settlement.playerId === player.id && !settlement.outpost);
  const canExpandHere = scouts[0] && ownSettlements.every((settlement) => hexDistance(settlement.coord, scouts[0].coord) >= 3);
  if (ownSettlements.length < 2 && canExpandHere && player.resources.materials >= 10) {
    state = issue(state, { type: 'FOUND_SETTLEMENT', armyId: scouts[0].id }, events);
  }

  for (const settlement of state.settlements.filter((candidate) => candidate.playerId === player.id && !candidate.outpost && !candidate.queue)) {
    const needsExpansionScout = state.settlements.filter((candidate) => candidate.playerId === player.id && !candidate.outpost).length < 2 &&
      !state.armies.some((army) => army.playerId === player.id && army.unitType === 'scout' && !army.defeated);
    if (needsExpansionScout && player.resources.materials >= UNITS.scout.cost) {
      state = issue(state, { type: 'QUEUE_CONSTRUCTION', settlementId: settlement.id, kind: 'unit', itemId: 'scout' }, events);
      continue;
    }
    const missing = (Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]).find((id) => !settlement.buildings.includes(id) && player.resources.materials >= BUILDINGS[id].cost);
    if (missing) {
      state = issue(state, { type: 'QUEUE_CONSTRUCTION', settlementId: settlement.id, kind: 'building', itemId: missing }, events);
    } else if (player.resources.materials >= UNITS.guardian.cost) {
      state = issue(state, { type: 'QUEUE_CONSTRUCTION', settlementId: settlement.id, kind: 'unit', itemId: 'guardian' }, events);
    }
  }

  const armyIds = state.armies.filter((army) => army.playerId === player.id && !army.defeated).map((army) => army.id);
  for (const armyId of armyIds) {
    for (let move = 0; move < 3; move += 1) {
      const army = state.armies.find((candidate) => candidate.id === armyId && !candidate.defeated);
      if (!army || army.moves <= 0) break;
      if (army.unitType === 'ranger') {
        const rangedTarget = state.armies.find((candidate) => !candidate.defeated && candidate.playerId !== player.id && hexDistance(candidate.coord, army.coord) <= 2);
        if (rangedTarget) {
          state = issue(state, { type: 'RANGED_ATTACK', armyId, target: rangedTarget.coord }, events);
          continue;
        }
      }
      const site = state.sites.find((candidate) => sameHex(candidate.coord, army.coord) && !candidate.resolvedBy.includes(player.id));
      if (site) state = issue(state, { type: 'INTERACT_WITH_SITE', armyId }, events);
      const target = targetForArmy(state, armyId);
      if (!target) break;
      const step = bestStep(state, armyId, target);
      if (!step) break;
      const previous = state;
      state = issue(state, { type: 'MOVE_ARMY', armyId, to: step }, events);
      if (state === previous) break;
    }
  }

  state = issue(state, { type: 'END_TURN' }, events);
  return { state, events };
}
