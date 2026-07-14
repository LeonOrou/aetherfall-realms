export type PlayerId = 'p1' | 'p2';
export type ActorId = PlayerId | 'monsters';

export interface HexCoord { q: number; r: number }

export type TerrainType =
  | 'grassland'
  | 'forest'
  | 'hills'
  | 'mountain'
  | 'lake'
  | 'swamp'
  | 'crystal'
  | 'wasteland';

export type SiteType = 'ruins' | 'village' | 'lair' | 'shrine' | 'landmark';
export type UnitType = 'scout' | 'guardian' | 'ranger' | 'adept' | 'monster';
export type BuildingType = 'granary' | 'sawmill' | 'workshop' | 'observatory' | 'shrine' | 'walls';
export type DiscoveryId = 'cultivation' | 'roads' | 'metalworking' | 'medicine' | 'astronomy' | 'runes' | 'elemental' | 'ley-lines';
export type SpellId = 'far-sight' | 'verdant-bloom' | 'frostway' | 'cinder-scar' | 'soul-beacon';

export interface ResourcePool {
  food: number;
  materials: number;
  knowledge: number;
  mana: number;
}

export interface HexTile {
  coord: HexCoord;
  terrain: TerrainType;
  elevation: number;
  ownerId?: PlayerId;
  siteId?: string;
  discoveredBy: PlayerId[];
  visibleBy: PlayerId[];
  frozenUntil?: number;
  forestUntil?: number;
  empoweredUntil?: number;
  hauntedUntil?: number;
}

export interface WorldSite {
  id: string;
  type: SiteType;
  coord: HexCoord;
  name: string;
  resolvedBy: PlayerId[];
  danger: number;
}

export interface Army {
  id: string;
  playerId: ActorId;
  unitType: UnitType;
  coord: HexCoord;
  hp: number;
  maxHp: number;
  moves: number;
  maxMoves: number;
  strength: number;
  name: string;
  defeated: boolean;
}

export interface QueueItem {
  kind: 'building' | 'unit';
  itemId: BuildingType | UnitType;
  progress: number;
  cost: number;
}

export interface Settlement {
  id: string;
  playerId: PlayerId;
  coord: HexCoord;
  name: string;
  population: number;
  foodStored: number;
  buildings: BuildingType[];
  queue?: QueueItem;
  outpost: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: number;
  human: boolean;
  resources: ResourcePool;
  discoveries: DiscoveryId[];
  activeDiscovery?: DiscoveryId;
  discoveryProgress: number;
  relics: string[];
  defeatedMonsters: number;
  landmarks: number;
}

export interface ScoreBreakdown {
  population: number;
  territory: number;
  discoveries: number;
  relicsAndLandmarks: number;
  monsters: number;
  settlements: number;
  total: number;
}

export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  nextId: number;
  width: number;
  height: number;
  round: number;
  maxRounds: number;
  currentPlayerIndex: number;
  mode: 'single' | 'hotseat';
  status: 'playing' | 'finished';
  winnerId?: PlayerId;
  players: PlayerState[];
  tiles: Record<string, HexTile>;
  sites: WorldSite[];
  armies: Army[];
  settlements: Settlement[];
  scores?: Record<PlayerId, ScoreBreakdown>;
}

export type GameCommand =
  | { type: 'MOVE_ARMY'; armyId: string; to: HexCoord }
  | { type: 'RANGED_ATTACK'; armyId: string; target: HexCoord }
  | { type: 'FOUND_SETTLEMENT'; armyId: string }
  | { type: 'FOUND_OUTPOST'; armyId: string }
  | { type: 'QUEUE_CONSTRUCTION'; settlementId: string; kind: 'building' | 'unit'; itemId: BuildingType | UnitType }
  | { type: 'CHOOSE_DISCOVERY'; discoveryId: DiscoveryId }
  | { type: 'CAST_SPELL'; spellId: SpellId; armyId?: string; target: HexCoord }
  | { type: 'INTERACT_WITH_SITE'; armyId: string }
  | { type: 'END_TURN' };

export type GameEvent =
  | { type: 'ARMY_MOVED'; armyId: string; from: HexCoord; to: HexCoord }
  | { type: 'COMBAT'; attackerId: string; defenderId: string; attackerDamage: number; defenderDamage: number; message: string }
  | { type: 'SETTLEMENT_FOUNDED'; settlementId: string; coord: HexCoord }
  | { type: 'CONSTRUCTION_QUEUED'; settlementId: string; itemId: string }
  | { type: 'CONSTRUCTION_COMPLETED'; settlementId: string; itemId: string }
  | { type: 'DISCOVERY_CHOSEN'; discoveryId: DiscoveryId }
  | { type: 'DISCOVERY_COMPLETED'; discoveryId: DiscoveryId }
  | { type: 'SPELL_CAST'; spellId: SpellId; coord: HexCoord; message: string }
  | { type: 'SITE_RESOLVED'; siteId: string; message: string }
  | { type: 'TURN_ENDED'; playerId: PlayerId; round: number }
  | { type: 'GAME_FINISHED'; winnerId: PlayerId };

export interface CommandResult {
  ok: boolean;
  state: GameState;
  events: GameEvent[];
  error?: string;
}

export interface Definition<T extends string> {
  id: T;
  name: string;
  description: string;
}
