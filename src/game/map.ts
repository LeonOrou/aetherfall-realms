import { TERRAINS, UNITS } from './data';
import { hexDistance, hexKey, hexesInRadius } from './hex';
import { SeededRng } from './rng';
import type { Army, GameState, HexCoord, HexTile, PlayerId, SiteType, TerrainType, WorldSite } from './types';

const SITE_NAMES: Record<SiteType, readonly string[]> = {
  ruins: ['Sunken Archive', 'Ashen Vault', 'Starlit Barrow'],
  village: ['Mossbell Hamlet', 'Amberford', 'Willow Kin'],
  lair: ['Hollowfang Den', 'Gloam Nest', 'Briar Maw'],
  shrine: ['Moonwell', 'Shrine of Echoes', 'Cyan Menhir'],
  landmark: ['The Skyglass Spire']
};

function chooseTerrain(rng: SeededRng): TerrainType {
  const roll = rng.next();
  if (roll < 0.34) return 'grassland';
  if (roll < 0.55) return 'forest';
  if (roll < 0.69) return 'hills';
  if (roll < 0.76) return 'mountain';
  if (roll < 0.83) return 'lake';
  if (roll < 0.90) return 'swamp';
  if (roll < 0.96) return 'crystal';
  return 'wasteland';
}

function markVisible(state: GameState, playerId: PlayerId, center: HexCoord, radius: number): void {
  for (const coord of hexesInRadius(center, radius)) {
    const tile = state.tiles[hexKey(coord)];
    if (!tile) continue;
    if (!tile.discoveredBy.includes(playerId)) tile.discoveredBy.push(playerId);
    if (!tile.visibleBy.includes(playerId)) tile.visibleBy.push(playerId);
  }
}

export function refreshVisibility(state: GameState, playerId: PlayerId): void {
  for (const tile of Object.values(state.tiles)) {
    tile.visibleBy = tile.visibleBy.filter((id) => id !== playerId);
  }
  for (const army of state.armies.filter((candidate) => candidate.playerId === playerId && !candidate.defeated)) {
    const bonus = army.unitType === 'scout' || army.unitType === 'adept' ? 1 : 0;
    const hillBonus = state.tiles[hexKey(army.coord)]?.terrain === 'hills' ? 1 : 0;
    markVisible(state, playerId, army.coord, 2 + bonus + hillBonus);
  }
  for (const settlement of state.settlements.filter((candidate) => candidate.playerId === playerId)) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    markVisible(state, playerId, settlement.coord, player?.discoveries.includes('astronomy') ? 3 : 2);
  }
}

function makeArmy(id: string, playerId: PlayerId | 'monsters', unitType: Army['unitType'], coord: HexCoord, name: string): Army {
  const unit = UNITS[unitType];
  return {
    id,
    playerId,
    unitType,
    coord: { ...coord },
    hp: unit.hp,
    maxHp: unit.hp,
    moves: unit.moves,
    maxMoves: unit.moves,
    strength: unit.strength,
    name,
    defeated: false
  };
}

function findStart(tiles: Record<string, HexTile>, preferred: HexCoord): HexCoord {
  const candidates = Object.values(tiles)
    .filter((tile) => TERRAINS[tile.terrain].passable && tile.terrain !== 'wasteland')
    .sort((a, b) => hexDistance(a.coord, preferred) - hexDistance(b.coord, preferred));
  return candidates[0].coord;
}

export function createInitialState(seed: number, mode: 'single' | 'hotseat' = 'single', width = 12, height = 10): GameState {
  const rng = new SeededRng(seed);
  const tiles: Record<string, HexTile> = {};
  for (let r = 0; r < height; r += 1) {
    for (let q = 0; q < width; q += 1) {
      const coord = { q, r };
      const terrain = chooseTerrain(rng);
      tiles[hexKey(coord)] = {
        coord,
        terrain,
        elevation: terrain === 'mountain' ? 3 : terrain === 'hills' ? 2 : terrain === 'lake' ? 0 : 1,
        discoveredBy: [],
        visibleBy: []
      };
    }
  }

  const start1 = findStart(tiles, { q: 1, r: Math.floor(height / 2) });
  const start2 = findStart(tiles, { q: width - 2, r: Math.floor(height / 2) });
  for (const start of [start1, start2]) {
    const tile = tiles[hexKey(start)];
    tile.terrain = 'grassland';
    tile.elevation = 1;
    for (const coord of hexesInRadius(start, 1)) {
      const neighbor = tiles[hexKey(coord)];
      if (neighbor?.terrain === 'mountain' || neighbor?.terrain === 'lake') neighbor.terrain = 'grassland';
    }
  }

  const sites: WorldSite[] = [];
  const siteTypes: SiteType[] = ['ruins', 'ruins', 'village', 'village', 'lair', 'lair', 'lair', 'shrine', 'shrine', 'landmark'];
  const available = Object.values(tiles).filter((tile) =>
    TERRAINS[tile.terrain].passable &&
    hexDistance(tile.coord, start1) > 2 &&
    hexDistance(tile.coord, start2) > 2
  );
  for (const type of siteTypes) {
    if (available.length === 0) break;
    const index = rng.int(0, available.length - 1);
    const tile = available.splice(index, 1)[0];
    const id = `site-${sites.length + 1}`;
    tile.siteId = id;
    sites.push({
      id,
      type,
      coord: { ...tile.coord },
      name: rng.pick(SITE_NAMES[type]),
      resolvedBy: [],
      danger: type === 'lair' ? rng.int(7, 11) : 0
    });
  }

  const state: GameState = {
    version: 1,
    seed,
    rngState: rng.getState(),
    nextId: 20,
    width,
    height,
    round: 1,
    maxRounds: 30,
    currentPlayerIndex: 0,
    mode,
    status: 'playing',
    players: [
      { id: 'p1', name: 'Verdant Concord', color: 0x65d5b3, human: true, resources: { food: 8, materials: 16, knowledge: 4, mana: 12 }, discoveries: [], discoveryProgress: 0, relics: [], defeatedMonsters: 0, landmarks: 0 },
      { id: 'p2', name: mode === 'single' ? 'Emberbound Court' : 'Amber Kin', color: 0xf0a25e, human: mode === 'hotseat', resources: { food: 8, materials: 16, knowledge: 4, mana: 12 }, discoveries: [], discoveryProgress: 0, relics: [], defeatedMonsters: 0, landmarks: 0 }
    ],
    tiles,
    sites,
    armies: [
      makeArmy('army-1', 'p1', 'scout', start1, 'Dawnseekers'),
      makeArmy('army-2', 'p1', 'guardian', hexesInRadius(start1, 1).find((coord) => tiles[hexKey(coord)] && TERRAINS[tiles[hexKey(coord)].terrain].passable && hexKey(coord) !== hexKey(start1)) ?? start1, 'Mossguard'),
      makeArmy('army-3', 'p2', 'scout', start2, 'Ashrunners'),
      makeArmy('army-4', 'p2', 'guardian', hexesInRadius(start2, 1).find((coord) => tiles[hexKey(coord)] && TERRAINS[tiles[hexKey(coord)].terrain].passable && hexKey(coord) !== hexKey(start2)) ?? start2, 'Cinder Ward')
    ],
    settlements: []
  };

  for (const site of sites.filter((candidate) => candidate.type === 'lair')) {
    state.armies.push(makeArmy(`monster-${site.id}`, 'monsters', 'monster', site.coord, site.name));
  }
  refreshVisibility(state, 'p1');
  refreshVisibility(state, 'p2');
  return state;
}
