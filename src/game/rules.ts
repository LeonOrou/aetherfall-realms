import { BUILDINGS, DISCOVERIES, SPELLS, TERRAINS, UNITS, ZERO_RESOURCES } from './data';
import { hexDistance, hexKey, hexNeighbors, hexesInRadius, sameHex } from './hex';
import { refreshVisibility } from './map';
import { SeededRng } from './rng';
import type {
  Army,
  BuildingType,
  CommandResult,
  GameCommand,
  GameEvent,
  GameState,
  HexCoord,
  HexTile,
  PlayerId,
  ResourcePool,
  ScoreBreakdown,
  Settlement,
  UnitType
} from './types';

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function currentPlayer(state: GameState) {
  return state.players[state.currentPlayerIndex];
}

function fail(state: GameState, error: string): CommandResult {
  return { ok: false, state, events: [], error };
}

function effectiveTerrain(tile: HexTile, round: number) {
  if (tile.forestUntil && tile.forestUntil >= round) return TERRAINS.forest;
  return TERRAINS[tile.terrain];
}

function isPassable(tile: HexTile, round: number): boolean {
  return effectiveTerrain(tile, round).passable || (tile.terrain === 'lake' && Boolean(tile.frozenUntil && tile.frozenUntil >= round));
}

function addResources(target: ResourcePool, addition: ResourcePool): void {
  target.food += addition.food;
  target.materials += addition.materials;
  target.knowledge += addition.knowledge;
  target.mana += addition.mana;
}

function nextId(state: GameState, prefix: string): string {
  const id = `${prefix}-${state.nextId}`;
  state.nextId += 1;
  return id;
}

function playerArmy(state: GameState, armyId: string): Army | undefined {
  return state.armies.find((army) => army.id === armyId && army.playerId === currentPlayer(state).id && !army.defeated);
}

function enemyAt(state: GameState, coord: HexCoord, attacker: Army): Army | undefined {
  return state.armies.find((army) => !army.defeated && sameHex(army.coord, coord) && army.playerId !== attacker.playerId);
}

function terrainStrength(state: GameState, army: Army): number {
  const tile = state.tiles[hexKey(army.coord)];
  let bonus = effectiveTerrain(tile, state.round).defense;
  if (army.unitType === 'ranger' && effectiveTerrain(tile, state.round).id === 'forest') bonus += 3;
  const player = state.players.find((candidate) => candidate.id === army.playerId);
  if (player?.discoveries.includes('metalworking')) bonus += 2;
  const nearbyWalls = state.settlements.some((settlement) =>
    settlement.playerId === army.playerId && settlement.buildings.includes('walls') && hexDistance(settlement.coord, army.coord) <= 1
  );
  if (nearbyWalls) bonus += 3;
  return army.strength + bonus;
}

export interface CombatPrediction {
  attackerPower: number;
  defenderPower: number;
  likely: 'victory' | 'close' | 'defeat';
  attackerDamageRange: [number, number];
  defenderDamageRange: [number, number];
}

export function predictRangedAttack(state: GameState, attackerId: string): [number, number] | undefined {
  const attacker = state.armies.find((army) => army.id === attackerId && !army.defeated && army.unitType === 'ranger');
  if (!attacker) return undefined;
  const base = Math.max(3, Math.round(terrainStrength(state, attacker) * 0.7));
  return [Math.max(2, base - 1), base + 1];
}

export function predictCombat(state: GameState, attackerId: string, defenderId: string): CombatPrediction | undefined {
  const attacker = state.armies.find((army) => army.id === attackerId && !army.defeated);
  const defender = state.armies.find((army) => army.id === defenderId && !army.defeated);
  if (!attacker || !defender) return undefined;
  const attackerPower = terrainStrength(state, attacker) * (attacker.hp / attacker.maxHp);
  const defenderPower = terrainStrength(state, defender) * (defender.hp / defender.maxHp);
  const ratio = attackerPower / Math.max(1, defenderPower);
  const defenderBase = Math.max(2, Math.round(5 * ratio));
  const attackerBase = Math.max(1, Math.round(5 / Math.max(0.4, ratio)));
  return {
    attackerPower: Math.round(attackerPower * 10) / 10,
    defenderPower: Math.round(defenderPower * 10) / 10,
    likely: ratio > 1.2 ? 'victory' : ratio < 0.82 ? 'defeat' : 'close',
    attackerDamageRange: [Math.max(1, attackerBase - 1), attackerBase + 1],
    defenderDamageRange: [Math.max(2, defenderBase - 1), defenderBase + 1]
  };
}

function resolveCombat(state: GameState, attacker: Army, defender: Army, events: GameEvent[]): void {
  const prediction = predictCombat(state, attacker.id, defender.id);
  if (!prediction) return;
  const rng = new SeededRng(state.rngState);
  const attackerDamage = Math.max(1, Math.round((prediction.attackerDamageRange[0] + prediction.attackerDamageRange[1]) / 2 * (0.9 + rng.next() * 0.2)));
  const defenderDamage = Math.max(2, Math.round((prediction.defenderDamageRange[0] + prediction.defenderDamageRange[1]) / 2 * (0.9 + rng.next() * 0.2)));
  state.rngState = rng.getState();
  attacker.hp = Math.max(0, attacker.hp - attackerDamage);
  defender.hp = Math.max(0, defender.hp - defenderDamage);
  attacker.defeated = attacker.hp === 0;
  defender.defeated = defender.hp === 0;
  if (defender.defeated && !attacker.defeated) {
    attacker.coord = { ...defender.coord };
    if (defender.playerId === 'monsters') {
      currentPlayer(state).defeatedMonsters += 1;
    }
  }
  const outcome = defender.defeated ? `${defender.name} was defeated.` : attacker.defeated ? `${attacker.name} was defeated.` : 'Both forces remain in the field.';
  events.push({ type: 'COMBAT', attackerId: attacker.id, defenderId: defender.id, attackerDamage, defenderDamage, message: outcome });
}

function handleMove(state: GameState, command: Extract<GameCommand, { type: 'MOVE_ARMY' }>, events: GameEvent[]): string | undefined {
  const army = playerArmy(state, command.armyId);
  if (!army) return 'Select one of your active armies.';
  const tile = state.tiles[hexKey(command.to)];
  if (!tile) return 'That hex lies beyond the known world.';
  if (hexDistance(army.coord, command.to) !== 1) return 'Armies move to an adjacent hex.';
  const cost = tile.terrain === 'lake' && tile.frozenUntil && tile.frozenUntil >= state.round ? 1 : effectiveTerrain(tile, state.round).moveCost;
  if (!isPassable(tile, state.round)) return 'That terrain is impassable.';
  if (army.moves < cost) return 'This army has no movement left for that terrain.';
  const friendly = state.armies.some((candidate) => !candidate.defeated && candidate.id !== army.id && candidate.playerId === army.playerId && sameHex(candidate.coord, command.to));
  if (friendly) return 'Only one friendly army may occupy a hex.';
  army.moves -= cost;
  const defender = enemyAt(state, command.to, army);
  if (defender) {
    resolveCombat(state, army, defender, events);
  } else {
    const from = { ...army.coord };
    army.coord = { ...command.to };
    events.push({ type: 'ARMY_MOVED', armyId: army.id, from, to: { ...command.to } });
  }
  refreshVisibility(state, currentPlayer(state).id);
  return undefined;
}

function handleRangedAttack(state: GameState, command: Extract<GameCommand, { type: 'RANGED_ATTACK' }>, events: GameEvent[]): string | undefined {
  const army = playerArmy(state, command.armyId);
  if (!army || army.unitType !== 'ranger') return 'Only rangers can make ranged attacks.';
  if (army.moves < 1) return 'This ranger has no action left.';
  if (hexDistance(army.coord, command.target) > 2 || hexDistance(army.coord, command.target) < 1) return 'Rangers can strike targets up to two hexes away.';
  const defender = enemyAt(state, command.target, army);
  if (!defender) return 'There is no hostile target on that hex.';
  const range = predictRangedAttack(state, army.id)!;
  const rng = new SeededRng(state.rngState);
  const defenderDamage = rng.int(range[0], range[1]);
  state.rngState = rng.getState();
  army.moves -= 1;
  defender.hp = Math.max(0, defender.hp - defenderDamage);
  defender.defeated = defender.hp === 0;
  if (defender.defeated && defender.playerId === 'monsters') currentPlayer(state).defeatedMonsters += 1;
  events.push({
    type: 'COMBAT',
    attackerId: army.id,
    defenderId: defender.id,
    attackerDamage: 0,
    defenderDamage,
    message: defender.defeated ? `${army.name} defeated ${defender.name} from range.` : `${army.name} struck from range without retaliation.`
  });
  refreshVisibility(state, currentPlayer(state).id);
  return undefined;
}

function handleFoundSettlement(state: GameState, command: Extract<GameCommand, { type: 'FOUND_SETTLEMENT' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const army = playerArmy(state, command.armyId);
  if (!army || army.unitType !== 'scout') return 'A scout is required to found a settlement.';
  if (player.resources.materials < 10) return 'Founding requires 10 materials.';
  if (state.settlements.some((settlement) => hexDistance(settlement.coord, army.coord) < 3)) return 'Settlements need at least three hexes of breathing room.';
  const tile = state.tiles[hexKey(army.coord)];
  if (!isPassable(tile, state.round) || tile.terrain === 'wasteland') return 'This is not safe settlement ground.';
  player.resources.materials -= 10;
  army.defeated = true;
  const id = nextId(state, 'settlement');
  const names = player.id === 'p1' ? ['Greenwake', 'Larkspire', 'Mosslight'] : ['Amberhold', 'Cinderrest', 'Sungate'];
  const settlement: Settlement = {
    id,
    playerId: player.id,
    coord: { ...army.coord },
    name: names[state.settlements.filter((candidate) => candidate.playerId === player.id).length % names.length],
    population: 1,
    foodStored: 0,
    buildings: [],
    outpost: false
  };
  state.settlements.push(settlement);
  for (const coord of hexesInRadius(settlement.coord, 1)) {
    const claimed = state.tiles[hexKey(coord)];
    if (claimed && !claimed.ownerId) claimed.ownerId = player.id;
  }
  events.push({ type: 'SETTLEMENT_FOUNDED', settlementId: id, coord: { ...army.coord } });
  refreshVisibility(state, player.id);
  return undefined;
}

function handleFoundOutpost(state: GameState, command: Extract<GameCommand, { type: 'FOUND_OUTPOST' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const army = playerArmy(state, command.armyId);
  if (!army || army.unitType !== 'scout') return 'A scout is required to establish an outpost.';
  if (player.resources.materials < 6) return 'An outpost requires 6 materials.';
  if (state.settlements.some((settlement) => hexDistance(settlement.coord, army.coord) < 2)) return 'This location is already covered by a nearby settlement.';
  const tile = state.tiles[hexKey(army.coord)];
  if (!isPassable(tile, state.round)) return 'An outpost cannot be built here.';
  player.resources.materials -= 6;
  const id = nextId(state, 'outpost');
  state.settlements.push({
    id,
    playerId: player.id,
    coord: { ...army.coord },
    name: `Waystone ${state.settlements.filter((candidate) => candidate.playerId === player.id && candidate.outpost).length + 1}`,
    population: 0,
    foodStored: 0,
    buildings: [],
    outpost: true
  });
  for (const coord of hexesInRadius(army.coord, 1)) {
    const claimed = state.tiles[hexKey(coord)];
    if (claimed && !claimed.ownerId) claimed.ownerId = player.id;
  }
  events.push({ type: 'SETTLEMENT_FOUNDED', settlementId: id, coord: { ...army.coord } });
  return undefined;
}

function handleQueue(state: GameState, command: Extract<GameCommand, { type: 'QUEUE_CONSTRUCTION' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const settlement = state.settlements.find((candidate) => candidate.id === command.settlementId && candidate.playerId === player.id);
  if (!settlement) return 'Choose one of your settlements.';
  if (settlement.queue) return 'That settlement is already building something.';
  const definition = command.kind === 'building' ? BUILDINGS[command.itemId as BuildingType] : UNITS[command.itemId as UnitType];
  if (!definition || command.itemId === 'monster') return 'Unknown construction.';
  if (command.kind === 'building' && settlement.buildings.includes(command.itemId as BuildingType)) return 'That building is already present.';
  if (player.resources.materials < definition.cost) return `This requires ${definition.cost} materials.`;
  player.resources.materials -= definition.cost;
  settlement.queue = { kind: command.kind, itemId: command.itemId, progress: 0, cost: definition.cost };
  events.push({ type: 'CONSTRUCTION_QUEUED', settlementId: settlement.id, itemId: command.itemId });
  return undefined;
}

function handleDiscovery(state: GameState, command: Extract<GameCommand, { type: 'CHOOSE_DISCOVERY' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const discovery = DISCOVERIES[command.discoveryId];
  if (player.discoveries.includes(command.discoveryId)) return 'That discovery is already known.';
  if (discovery.requires.some((requirement) => !player.discoveries.includes(requirement))) return 'Its prerequisite discoveries are still missing.';
  player.activeDiscovery = command.discoveryId;
  player.discoveryProgress = 0;
  events.push({ type: 'DISCOVERY_CHOSEN', discoveryId: command.discoveryId });
  return undefined;
}

function casterInRange(state: GameState, armyId: string | undefined, target: HexCoord): Army | undefined {
  if (!armyId) return undefined;
  const army = playerArmy(state, armyId);
  return army && hexDistance(army.coord, target) <= 3 ? army : undefined;
}

function handleSpell(state: GameState, command: Extract<GameCommand, { type: 'CAST_SPELL' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const spell = SPELLS[command.spellId];
  const tile = state.tiles[hexKey(command.target)];
  if (!tile) return 'Magic cannot reach beyond the map.';
  if (!casterInRange(state, command.armyId, command.target)) return 'Select an army within three hexes as the caster.';
  if (spell.discovery && !player.discoveries.includes(spell.discovery)) return `${spell.name} requires ${DISCOVERIES[spell.discovery].name}.`;
  const discount = player.discoveries.includes('elemental') && ['verdant-bloom', 'frostway', 'cinder-scar'].includes(spell.id) ? 2 : 0;
  const cost = Math.max(1, spell.cost - discount);
  if (player.resources.mana < cost) return `${spell.name} requires ${cost} mana.`;

  let message = '';
  if (spell.id === 'far-sight') {
    for (const coord of hexesInRadius(command.target, 3)) {
      const revealed = state.tiles[hexKey(coord)];
      if (revealed) {
        if (!revealed.discoveredBy.includes(player.id)) revealed.discoveredBy.push(player.id);
        if (!revealed.visibleBy.includes(player.id)) revealed.visibleBy.push(player.id);
      }
    }
    message = 'The mist parts around a distant point.';
  } else if (spell.id === 'verdant-bloom') {
    if (!['grassland', 'swamp', 'wasteland'].includes(tile.terrain)) return 'Verdant Bloom needs open or wounded ground.';
    tile.forestUntil = state.round + 3;
    message = 'A young enchanted forest rises for three rounds.';
  } else if (spell.id === 'frostway') {
    if (tile.terrain !== 'lake') return 'Frostway must target water.';
    tile.frozenUntil = state.round + 2;
    message = 'The water becomes a glittering road of ice.';
  } else if (spell.id === 'cinder-scar') {
    if (tile.terrain === 'forest') tile.terrain = 'grassland';
    const target = state.armies.find((army) => !army.defeated && sameHex(army.coord, command.target) && army.playerId !== player.id);
    if (target) {
      target.hp = Math.max(0, target.hp - 5);
      target.defeated = target.hp === 0;
    }
    message = target ? 'Fire scars the land and strikes the occupying force.' : 'Fire scars the land.';
  } else {
    if (tile.terrain !== 'wasteland') return 'Soul Beacon must be anchored in an ancient wasteland.';
    tile.hauntedUntil = state.round + 4;
    message = 'Old whispers illuminate the dead ground.';
  }
  player.resources.mana -= cost;
  events.push({ type: 'SPELL_CAST', spellId: spell.id, coord: { ...command.target }, message });
  return undefined;
}

function handleSite(state: GameState, command: Extract<GameCommand, { type: 'INTERACT_WITH_SITE' }>, events: GameEvent[]): string | undefined {
  const player = currentPlayer(state);
  const army = playerArmy(state, command.armyId);
  if (!army) return 'Choose one of your armies.';
  const tile = state.tiles[hexKey(army.coord)];
  const site = state.sites.find((candidate) => candidate.id === tile.siteId);
  if (!site) return 'There is no site here.';
  if (site.resolvedBy.includes(player.id)) return 'Your people have already explored this site.';
  if (site.type === 'lair' && state.armies.some((candidate) => !candidate.defeated && candidate.playerId === 'monsters' && sameHex(candidate.coord, site.coord))) {
    return 'The lair guardian must be defeated first.';
  }
  const rewards = ZERO_RESOURCES();
  let message = '';
  if (site.type === 'ruins') {
    rewards.knowledge = 8;
    rewards.mana = 3;
    player.relics.push(`Relic of ${site.name}`);
    message = `Recovered a relic and 8 knowledge from ${site.name}.`;
  } else if (site.type === 'village') {
    rewards.food = 8;
    rewards.materials = 6;
    message = `${site.name} shared food and materials.`;
  } else if (site.type === 'shrine') {
    rewards.mana = 10;
    message = `${site.name} granted 10 mana.`;
  } else if (site.type === 'landmark') {
    rewards.knowledge = 6;
    player.landmarks += 1;
    message = `${site.name} was charted for future generations.`;
  } else {
    rewards.materials = 8;
    rewards.mana = 4;
    message = `The cleared ${site.name} yielded strange spoils.`;
  }
  addResources(player.resources, rewards);
  site.resolvedBy.push(player.id);
  events.push({ type: 'SITE_RESOLVED', siteId: site.id, message });
  return undefined;
}

function settlementYield(state: GameState, settlement: Settlement): ResourcePool {
  const result = ZERO_RESOURCES();
  const nearby = hexesInRadius(settlement.coord, 1)
    .map((coord) => state.tiles[hexKey(coord)])
    .filter((tile): tile is HexTile => Boolean(tile))
    .sort((a, b) => hexDistance(a.coord, settlement.coord) - hexDistance(b.coord, settlement.coord));
  for (const tile of nearby.slice(0, Math.min(nearby.length, settlement.population + 1))) {
    const yieldValue = { ...effectiveTerrain(tile, state.round).yield };
    if (tile.empoweredUntil && tile.empoweredUntil >= state.round) {
      yieldValue.knowledge += 1;
      yieldValue.mana += 1;
    }
    if (tile.hauntedUntil && tile.hauntedUntil >= state.round) {
      yieldValue.knowledge += 2;
      yieldValue.mana += 2;
    }
    if (settlement.buildings.includes('sawmill') && effectiveTerrain(tile, state.round).id === 'forest') yieldValue.materials += 1;
    addResources(result, yieldValue);
  }
  if (settlement.buildings.includes('granary')) result.food += 2;
  if (settlement.buildings.includes('observatory')) result.knowledge += 2;
  if (settlement.buildings.includes('shrine')) result.mana += 2;
  return result;
}

function completeConstruction(state: GameState, settlement: Settlement, events: GameEvent[]): void {
  if (!settlement.queue) return;
  const production = 4 + (settlement.buildings.includes('workshop') ? 2 : 0) + Math.floor(settlement.population / 2);
  settlement.queue.progress += production;
  if (settlement.queue.progress < settlement.queue.cost) return;
  const item = settlement.queue;
  if (item.kind === 'building') {
    settlement.buildings.push(item.itemId as BuildingType);
  } else {
    const unit = UNITS[item.itemId as UnitType];
    const spawn = hexNeighbors(settlement.coord).find((coord) => {
      const tile = state.tiles[hexKey(coord)];
      return tile && isPassable(tile, state.round) && !state.armies.some((army) => !army.defeated && sameHex(army.coord, coord));
    });
    if (!spawn) return;
    const player = state.players.find((candidate) => candidate.id === settlement.playerId);
    const moveBonus = player?.discoveries.includes('roads') ? 1 : 0;
    state.armies.push({
      id: nextId(state, 'army'),
      playerId: settlement.playerId,
      unitType: item.itemId as UnitType,
      coord: { ...spawn },
      hp: unit.hp,
      maxHp: unit.hp,
      moves: unit.moves + moveBonus,
      maxMoves: unit.moves + moveBonus,
      strength: unit.strength,
      name: `${settlement.name} ${unit.name}`,
      defeated: false
    });
  }
  events.push({ type: 'CONSTRUCTION_COMPLETED', settlementId: settlement.id, itemId: item.itemId });
  settlement.queue = undefined;
}

function processEconomy(state: GameState, playerId: PlayerId, events: GameEvent[]): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const settlement of state.settlements.filter((candidate) => candidate.playerId === playerId)) {
    if (settlement.outpost) continue;
    const income = settlementYield(state, settlement);
    addResources(player.resources, income);
    settlement.foodStored += income.food;
    const growthNeed = Math.max(12, settlement.population * 12 - (player.discoveries.includes('cultivation') ? 3 : 0));
    if (settlement.foodStored >= growthNeed && settlement.population < 6) {
      settlement.foodStored -= growthNeed;
      settlement.population += 1;
    }
    completeConstruction(state, settlement, events);
    for (const coord of hexesInRadius(settlement.coord, settlement.population >= 4 ? 2 : 1)) {
      const tile = state.tiles[hexKey(coord)];
      if (tile && (!tile.ownerId || tile.ownerId === playerId)) tile.ownerId = playerId;
    }
  }

  if (player.activeDiscovery) {
    const investment = Math.min(6, player.resources.knowledge);
    player.resources.knowledge -= investment;
    player.discoveryProgress += investment;
    const discovery = DISCOVERIES[player.activeDiscovery];
    if (player.discoveryProgress >= discovery.cost) {
      player.discoveries.push(discovery.id);
      events.push({ type: 'DISCOVERY_COMPLETED', discoveryId: discovery.id });
      player.activeDiscovery = undefined;
      player.discoveryProgress = 0;
    }
  }

  const heal = player.discoveries.includes('medicine') ? 3 : 1;
  for (const army of state.armies.filter((candidate) => candidate.playerId === playerId && !candidate.defeated)) {
    army.hp = Math.min(army.maxHp, army.hp + heal);
  }
}

function monsterPhase(state: GameState, events: GameEvent[]): void {
  const rng = new SeededRng(state.rngState);
  for (const monster of state.armies.filter((army) => army.playerId === 'monsters' && !army.defeated)) {
    const nearby = state.armies
      .filter((army) => army.playerId !== 'monsters' && !army.defeated && hexDistance(army.coord, monster.coord) <= 3)
      .sort((a, b) => a.hp - b.hp || hexDistance(a.coord, monster.coord) - hexDistance(b.coord, monster.coord));
    const target = nearby[0];
    const options = hexNeighbors(monster.coord).filter((coord) => {
      const tile = state.tiles[hexKey(coord)];
      return tile && isPassable(tile, state.round);
    });
    if (target && hexDistance(monster.coord, target.coord) === 1) {
      resolveCombat(state, monster, target, events);
    } else if (target && options.length) {
      options.sort((a, b) => hexDistance(a, target.coord) - hexDistance(b, target.coord));
      monster.coord = { ...options[0] };
    } else if (options.length && rng.next() < 0.35) {
      monster.coord = { ...rng.pick(options) };
    }
    monster.strength = UNITS.monster.strength + Math.floor(state.round / 8);
  }
  state.rngState = rng.getState();
}

export function calculateScore(state: GameState, playerId: PlayerId): ScoreBreakdown {
  const settlements = state.settlements.filter((candidate) => candidate.playerId === playerId && !candidate.outpost);
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const breakdown = {
    population: settlements.reduce((sum, settlement) => sum + settlement.population * 5, 0),
    territory: Object.values(state.tiles).filter((tile) => tile.ownerId === playerId).length,
    discoveries: player.discoveries.length * 8,
    relicsAndLandmarks: player.relics.length * 10 + player.landmarks * 15,
    monsters: player.defeatedMonsters * 6,
    settlements: settlements.length * 12,
    total: 0
  };
  breakdown.total = breakdown.population + breakdown.territory + breakdown.discoveries + breakdown.relicsAndLandmarks + breakdown.monsters + breakdown.settlements;
  return breakdown;
}

function handleEndTurn(state: GameState, events: GameEvent[]): void {
  const endingPlayer = currentPlayer(state);
  processEconomy(state, endingPlayer.id, events);
  events.push({ type: 'TURN_ENDED', playerId: endingPlayer.id, round: state.round });
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  if (state.currentPlayerIndex === 0) {
    state.round += 1;
    monsterPhase(state, events);
  }
  if (state.round > state.maxRounds) {
    const p1 = calculateScore(state, 'p1');
    const p2 = calculateScore(state, 'p2');
    state.scores = { p1, p2 };
    state.winnerId = p1.total >= p2.total ? 'p1' : 'p2';
    state.status = 'finished';
    events.push({ type: 'GAME_FINISHED', winnerId: state.winnerId });
    return;
  }
  const next = currentPlayer(state);
  const moveBonus = next.discoveries.includes('roads') ? 1 : 0;
  for (const army of state.armies.filter((candidate) => candidate.playerId === next.id && !candidate.defeated)) {
    army.maxMoves = UNITS[army.unitType].moves + moveBonus;
    army.moves = army.maxMoves;
  }
  refreshVisibility(state, 'p1');
  refreshVisibility(state, 'p2');
}

export function applyCommand(original: GameState, command: GameCommand): CommandResult {
  if (original.status !== 'playing') return fail(original, 'This match has ended.');
  const state = cloneState(original);
  const events: GameEvent[] = [];
  let error: string | undefined;
  switch (command.type) {
    case 'MOVE_ARMY': error = handleMove(state, command, events); break;
    case 'RANGED_ATTACK': error = handleRangedAttack(state, command, events); break;
    case 'FOUND_SETTLEMENT': error = handleFoundSettlement(state, command, events); break;
    case 'FOUND_OUTPOST': error = handleFoundOutpost(state, command, events); break;
    case 'QUEUE_CONSTRUCTION': error = handleQueue(state, command, events); break;
    case 'CHOOSE_DISCOVERY': error = handleDiscovery(state, command, events); break;
    case 'CAST_SPELL': error = handleSpell(state, command, events); break;
    case 'INTERACT_WITH_SITE': error = handleSite(state, command, events); break;
    case 'END_TURN': handleEndTurn(state, events); break;
  }
  if (error) return fail(original, error);
  return { ok: true, state, events };
}
