import type { BuildingType, Definition, DiscoveryId, ResourcePool, SpellId, TerrainType, UnitType } from './types';

export interface TerrainDefinition extends Definition<TerrainType> {
  color: number;
  sideColor: number;
  yield: ResourcePool;
  defense: number;
  moveCost: number;
  passable: boolean;
}

export const TERRAINS: Record<TerrainType, TerrainDefinition> = {
  grassland: { id: 'grassland', name: 'Grassland', description: 'Fertile open country.', color: 0x73965a, sideColor: 0x3f5e3b, yield: { food: 2, materials: 0, knowledge: 0, mana: 0 }, defense: 0, moveCost: 1, passable: true },
  forest: { id: 'forest', name: 'Forest', description: 'Timber and natural cover.', color: 0x42694c, sideColor: 0x294332, yield: { food: 1, materials: 2, knowledge: 0, mana: 0 }, defense: 2, moveCost: 2, passable: true },
  hills: { id: 'hills', name: 'Hills', description: 'Rich stone and long sightlines.', color: 0xa78b5c, sideColor: 0x675237, yield: { food: 0, materials: 2, knowledge: 1, mana: 0 }, defense: 1, moveCost: 2, passable: true },
  mountain: { id: 'mountain', name: 'Mountain', description: 'Impassable ancient peaks.', color: 0x89909a, sideColor: 0x50545d, yield: { food: 0, materials: 3, knowledge: 0, mana: 0 }, defense: 3, moveCost: 99, passable: false },
  lake: { id: 'lake', name: 'Lake', description: 'Deep water, unless frozen by magic.', color: 0x4f92a6, sideColor: 0x315c73, yield: { food: 2, materials: 0, knowledge: 0, mana: 1 }, defense: 0, moveCost: 99, passable: false },
  swamp: { id: 'swamp', name: 'Swamp', description: 'Slow, strange and mana-rich.', color: 0x667c65, sideColor: 0x3e5144, yield: { food: 1, materials: 0, knowledge: 0, mana: 2 }, defense: 1, moveCost: 2, passable: true },
  crystal: { id: 'crystal', name: 'Crystal Field', description: 'A bright knot of aether.', color: 0x7775a7, sideColor: 0x4c496f, yield: { food: 0, materials: 1, knowledge: 1, mana: 3 }, defense: 0, moveCost: 1, passable: true },
  wasteland: { id: 'wasteland', name: 'Ancient Wasteland', description: 'Dangerous ground hiding old relics.', color: 0x8f6e5d, sideColor: 0x574339, yield: { food: 0, materials: 1, knowledge: 2, mana: 1 }, defense: 0, moveCost: 2, passable: true }
};

export interface UnitDefinition extends Definition<UnitType> {
  cost: number;
  strength: number;
  hp: number;
  moves: number;
}

export const UNITS: Record<UnitType, UnitDefinition> = {
  scout: { id: 'scout', name: 'Scout', description: 'Fast explorer; can found a settlement.', cost: 8, strength: 4, hp: 8, moves: 3 },
  guardian: { id: 'guardian', name: 'Guardian', description: 'Durable defensive infantry.', cost: 12, strength: 8, hp: 14, moves: 2 },
  ranger: { id: 'ranger', name: 'Ranger', description: 'Strong in forests.', cost: 14, strength: 9, hp: 10, moves: 2 },
  adept: { id: 'adept', name: 'Adept', description: 'Magical support with wide vision.', cost: 15, strength: 6, hp: 9, moves: 2 },
  monster: { id: 'monster', name: 'Wild Horror', description: 'A territorial creature.', cost: 0, strength: 9, hp: 12, moves: 1 }
};

export interface BuildingDefinition extends Definition<BuildingType> {
  cost: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDefinition> = {
  granary: { id: 'granary', name: 'Granary', description: '+2 food per turn.', cost: 12 },
  sawmill: { id: 'sawmill', name: 'Sawmill', description: '+1 material from worked forests.', cost: 14 },
  workshop: { id: 'workshop', name: 'Workshop', description: '+2 construction per turn.', cost: 16 },
  observatory: { id: 'observatory', name: 'Observatory', description: '+2 knowledge per turn.', cost: 18 },
  shrine: { id: 'shrine', name: 'Arcane Shrine', description: '+2 mana per turn.', cost: 18 },
  walls: { id: 'walls', name: 'Walls', description: 'Settlements defend adjacent armies.', cost: 16 }
};

export interface DiscoveryDefinition extends Definition<DiscoveryId> {
  branch: 'Craft' | 'Lore' | 'Arcana';
  cost: number;
  requires: DiscoveryId[];
}

export const DISCOVERIES: Record<DiscoveryId, DiscoveryDefinition> = {
  cultivation: { id: 'cultivation', name: 'Cultivation', description: 'Settlements grow faster.', branch: 'Craft', cost: 12, requires: [] },
  roads: { id: 'roads', name: 'Roadcraft', description: 'Armies gain +1 move.', branch: 'Craft', cost: 15, requires: ['cultivation'] },
  metalworking: { id: 'metalworking', name: 'Metalworking', description: 'Troops gain +2 strength.', branch: 'Craft', cost: 20, requires: ['cultivation'] },
  medicine: { id: 'medicine', name: 'Medicine', description: 'Armies heal faster each turn.', branch: 'Lore', cost: 14, requires: [] },
  astronomy: { id: 'astronomy', name: 'Astronomy', description: 'Settlements reveal farther.', branch: 'Lore', cost: 19, requires: ['medicine'] },
  runes: { id: 'runes', name: 'Runes', description: 'Unlocks enchanted warfare.', branch: 'Arcana', cost: 14, requires: [] },
  elemental: { id: 'elemental', name: 'Elemental Magic', description: 'Terrain spells cost less.', branch: 'Arcana', cost: 20, requires: ['runes'] },
  'ley-lines': { id: 'ley-lines', name: 'Ley Lines', description: 'Astronomy and runes reveal the world\'s hidden currents.', branch: 'Arcana', cost: 22, requires: ['runes', 'astronomy'] }
};

export interface SpellDefinition extends Definition<SpellId> {
  school: 'Ember' | 'Tide' | 'Grove' | 'Aether' | 'Necromancy';
  cost: number;
  discovery?: DiscoveryId;
}

export const SPELLS: Record<SpellId, SpellDefinition> = {
  'far-sight': { id: 'far-sight', name: 'Far Sight', description: 'Reveal a distant radius for this turn.', school: 'Aether', cost: 6 },
  'verdant-bloom': { id: 'verdant-bloom', name: 'Verdant Bloom', description: 'Grow a temporary forest on open ground.', school: 'Grove', cost: 7 },
  frostway: { id: 'frostway', name: 'Frostway', description: 'Freeze a lake into a temporary crossing.', school: 'Tide', cost: 6 },
  'cinder-scar': { id: 'cinder-scar', name: 'Cinder Scar', description: 'Damage an army and scorch forest into grassland.', school: 'Ember', cost: 9, discovery: 'elemental' },
  'soul-beacon': { id: 'soul-beacon', name: 'Soul Beacon', description: 'Haunt a wasteland, producing mana and knowledge.', school: 'Necromancy', cost: 8, discovery: 'runes' }
};

export const ZERO_RESOURCES = (): ResourcePool => ({ food: 0, materials: 0, knowledge: 0, mana: 0 });
