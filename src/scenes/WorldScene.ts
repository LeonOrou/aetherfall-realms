import Phaser from 'phaser';
import { TERRAINS } from '../game/data';
import { axialToWorld, hexKey, sameHex } from '../game/hex';
import type { Army, GameState, HexCoord, HexTile, PlayerId, Settlement, WorldSite } from '../game/types';
import { eventBus } from './EventBus';

const HEX_SIZE = 42;
const ELEVATION_STEP = 6;
const WORLD_OFFSET_X = 100;
const WORLD_OFFSET_Y = 110;

function vertices(size: number, yOffset = 0): Phaser.Geom.Point[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Phaser.Math.DegToRad(60 * index - 30);
    return new Phaser.Geom.Point(Math.cos(angle) * size, Math.sin(angle) * size + yOffset);
  });
}

function shade(color: number, factor: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(Math.round(c.red * factor), Math.round(c.green * factor), Math.round(c.blue * factor));
}

export class WorldScene extends Phaser.Scene {
  private state?: GameState;
  private board?: Phaser.GameObjects.Container;
  private selected?: HexCoord;
  private centered = false;
  private dragOrigin?: { x: number; y: number; scrollX: number; scrollY: number };
  private dragged = false;
  private pinchDistance = 0;

  constructor() {
    super('WorldScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#101720');
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragOrigin = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
      this.dragged = false;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));
    this.input.on('pointerup', () => {
      this.dragOrigin = undefined;
      this.pinchDistance = 0;
      this.time.delayedCall(0, () => { this.dragged = false; });
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const camera = this.cameras.main;
      const oldZoom = camera.zoom;
      const nextZoom = Phaser.Math.Clamp(oldZoom - dy * 0.0008, 0.45, 1.65);
      camera.setZoom(nextZoom);
    });
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.cameras.resize(size.width, size.height));
    if (this.state) this.drawState();
  }

  setState(state: GameState, selected?: HexCoord): void {
    this.state = state;
    this.selected = selected;
    if (this.sys.isActive()) this.drawState();
  }

  focus(coord: HexCoord): void {
    const position = axialToWorld(coord, HEX_SIZE);
    this.cameras.main.pan(position.x + WORLD_OFFSET_X, position.y + WORLD_OFFSET_Y, 260, 'Sine.easeInOut');
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const pointers = this.input.manager.pointers.filter((candidate) => candidate.isDown);
    if (pointers.length >= 2) {
      const distance = Phaser.Math.Distance.Between(pointers[0].x, pointers[0].y, pointers[1].x, pointers[1].y);
      if (this.pinchDistance > 0) {
        const camera = this.cameras.main;
        camera.setZoom(Phaser.Math.Clamp(camera.zoom * (distance / this.pinchDistance), 0.45, 1.65));
      }
      this.pinchDistance = distance;
      this.dragged = true;
      return;
    }
    if (!pointer.isDown || !this.dragOrigin) return;
    const dx = pointer.x - this.dragOrigin.x;
    const dy = pointer.y - this.dragOrigin.y;
    if (Math.abs(dx) + Math.abs(dy) > 7) this.dragged = true;
    if (this.dragged) {
      const camera = this.cameras.main;
      camera.scrollX = this.dragOrigin.scrollX - dx / camera.zoom;
      camera.scrollY = this.dragOrigin.scrollY - dy / camera.zoom;
    }
  }

  private drawState(): void {
    if (!this.state) return;
    this.board?.destroy(true);
    this.board = this.add.container(0, 0);
    const player = this.state.players[this.state.currentPlayerIndex];
    const sortedTiles = Object.values(this.state.tiles).sort((a, b) => {
      const ay = axialToWorld(a.coord, HEX_SIZE).y;
      const by = axialToWorld(b.coord, HEX_SIZE).y;
      return ay - by || a.coord.q - b.coord.q;
    });
    for (const tile of sortedTiles) this.drawTile(tile, player.id);
    for (const settlement of this.state.settlements) this.drawSettlement(settlement, player.id);
    for (const army of this.state.armies) this.drawArmy(army, player.id);

    const worldWidth = HEX_SIZE * Math.sqrt(3) * (this.state.width + this.state.height / 2) + 260;
    const worldHeight = HEX_SIZE * 1.5 * this.state.height + 260;
    this.cameras.main.setBounds(-80, -80, worldWidth, worldHeight);
    if (!this.centered) {
      const army = this.state.armies.find((candidate) => candidate.playerId === player.id && !candidate.defeated);
      if (army) {
        const position = axialToWorld(army.coord, HEX_SIZE);
        this.cameras.main.centerOn(position.x + WORLD_OFFSET_X, position.y + WORLD_OFFSET_Y);
      }
      this.centered = true;
    }
  }

  private tilePosition(tile: HexTile): { x: number; y: number } {
    const position = axialToWorld(tile.coord, HEX_SIZE);
    return {
      x: position.x + WORLD_OFFSET_X,
      y: position.y + WORLD_OFFSET_Y - tile.elevation * ELEVATION_STEP
    };
  }

  private drawTile(tile: HexTile, playerId: PlayerId): void {
    if (!this.state || !this.board) return;
    const position = this.tilePosition(tile);
    const discovered = tile.discoveredBy.includes(playerId);
    const visible = tile.visibleBy.includes(playerId);
    const definition = tile.forestUntil && tile.forestUntil >= this.state.round ? TERRAINS.forest : TERRAINS[tile.terrain];
    const topColor = discovered ? definition.color : 0x1c2530;
    const depth = 7 + tile.elevation * 2;
    const top = vertices(HEX_SIZE - 1);
    const lower = vertices(HEX_SIZE - 1, depth);
    const graphics = this.add.graphics();
    graphics.setPosition(position.x, position.y);
    graphics.fillStyle(discovered ? definition.sideColor : 0x121820, 1);
    graphics.fillPoints([top[1], top[2], lower[2], lower[1]], true);
    graphics.fillStyle(shade(discovered ? definition.sideColor : 0x121820, 0.75), 1);
    graphics.fillPoints([top[2], top[3], lower[3], lower[2]], true);
    graphics.fillStyle(topColor, 1);
    graphics.fillPoints(top, true);
    graphics.lineStyle(tile.ownerId ? 2.5 : 1.2, tile.ownerId === 'p1' ? 0x65d5b3 : tile.ownerId === 'p2' ? 0xf0a25e : 0x0d131a, tile.ownerId ? 0.85 : 0.55);
    graphics.strokePoints(top, true);
    if (!visible && discovered) {
      graphics.fillStyle(0x0a1018, 0.52);
      graphics.fillPoints(top, true);
    }
    if (this.selected && sameHex(this.selected, tile.coord)) {
      graphics.lineStyle(4, 0xffdd83, 1);
      graphics.strokePoints(vertices(HEX_SIZE - 4), true);
    }
    this.board.add(graphics);

    const zone = this.add.zone(position.x, position.y, HEX_SIZE * 1.72, HEX_SIZE * 1.5)
      .setInteractive(new Phaser.Geom.Polygon(top), Phaser.Geom.Polygon.Contains);
    zone.on('pointerup', () => {
      if (!this.dragged) eventBus.emit('hex-selected', { ...tile.coord });
    });
    this.board.add(zone);
    if (discovered) this.drawTerrainFeature(tile, position.x, position.y, visible);
    if (tile.siteId && discovered) {
      const site = this.state.sites.find((candidate) => candidate.id === tile.siteId);
      if (site) this.drawSite(site, position.x, position.y, visible);
    }
    if (tile.frozenUntil && tile.frozenUntil >= this.state.round) this.drawRuneGlow(position.x, position.y, 0xaeefff);
    if (tile.hauntedUntil && tile.hauntedUntil >= this.state.round) this.drawRuneGlow(position.x, position.y, 0xb26cff);
  }

  private drawTerrainFeature(tile: HexTile, x: number, y: number, visible: boolean): void {
    if (!this.board || !visible) return;
    const feature = this.add.graphics();
    feature.setPosition(x, y - 5);
    const variant = Math.abs(tile.coord.q * 31 + tile.coord.r * 17) % 3;
    if (tile.terrain === 'forest' || tile.forestUntil) {
      for (const offset of [-15, 0, 15]) {
        feature.fillStyle(0x243f31, 1);
        feature.fillTriangle(offset - 8, 8, offset, -18 - variant * 2, offset + 8, 8);
        feature.fillStyle(0x634d31, 1);
        feature.fillRect(offset - 2, 7, 4, 8);
      }
    } else if (tile.terrain === 'mountain') {
      feature.fillStyle(0x646b75, 1);
      feature.fillTriangle(-21, 13, -3, -30, 13, 13);
      feature.fillStyle(0xbcc1c8, 1);
      feature.fillTriangle(-10, -14, -3, -30, 3, -14);
      feature.fillStyle(0x707781, 1);
      feature.fillTriangle(1, 13, 18, -18, 29, 13);
    } else if (tile.terrain === 'hills') {
      feature.fillStyle(0x756040, 1);
      feature.fillEllipse(-10, 4, 30, 18);
      feature.fillStyle(0xc0a672, 1);
      feature.fillEllipse(12, 5, 24, 14);
    } else if (tile.terrain === 'lake') {
      feature.lineStyle(2, 0x9edce6, 0.65);
      feature.beginPath(); feature.arc(0, 2, 18 + variant * 2, 0.2, 2.8); feature.strokePath();
      feature.beginPath(); feature.arc(0, 7, 27, 3.3, 5.7); feature.strokePath();
    } else if (tile.terrain === 'crystal') {
      for (const [ox, height] of [[-12, 21], [0, 32], [13, 18]] as [number, number][]) {
        feature.fillStyle(0x8ee7f0, 0.85);
        feature.fillTriangle(ox - 7, 11, ox, -height, ox + 7, 11);
        feature.lineStyle(1, 0xd8fbff, 0.8);
        feature.lineBetween(ox, -height, ox, 11);
      }
    } else if (tile.terrain === 'swamp') {
      feature.fillStyle(0x3e5b4d, 0.7);
      feature.fillEllipse(0, 6, 48, 16);
      feature.lineStyle(2, 0xa8c69c, 0.65);
      feature.lineBetween(-13, 4, -13, -10); feature.lineBetween(-13, -8, -7, -14);
      feature.lineBetween(15, 5, 15, -8); feature.lineBetween(15, -5, 21, -11);
    } else if (tile.terrain === 'wasteland') {
      feature.lineStyle(2, 0x4a3440, 0.8);
      feature.lineBetween(-22, -2, -8, 4); feature.lineBetween(-8, 4, 1, -4);
      feature.lineBetween(4, 10, 13, 1); feature.lineBetween(13, 1, 25, 4);
    } else {
      feature.fillStyle(0xd0b45c, 0.8);
      for (let offset = -12; offset <= 12; offset += 8) feature.fillRect(offset, -2 + variant, 2, 14);
    }
    this.board.add(feature);
  }

  private drawSite(site: WorldSite, x: number, y: number, visible: boolean): void {
    if (!this.board || !visible) return;
    const marker = this.add.graphics();
    marker.setPosition(x + 22, y - 20);
    const color = site.type === 'lair' ? 0xdc665f : site.type === 'shrine' ? 0x77ddeb : site.type === 'landmark' ? 0xf4ca70 : 0xd3c5a2;
    marker.fillStyle(0x111923, 0.92);
    marker.fillCircle(0, 0, 10);
    marker.lineStyle(2, color, 1);
    marker.strokeCircle(0, 0, 10);
    if (site.type === 'ruins') marker.fillRect(-4, -6, 8, 12);
    else if (site.type === 'village') marker.fillTriangle(-6, 2, 0, -6, 6, 2);
    else if (site.type === 'lair') marker.fillTriangle(-6, 4, 0, -7, 6, 4);
    else if (site.type === 'shrine') marker.fillCircle(0, 0, 4);
    else marker.fillRect(-2, -7, 4, 14);
    this.board.add(marker);
  }

  private drawSettlement(settlement: Settlement, playerId: PlayerId): void {
    if (!this.state || !this.board) return;
    const tile = this.state.tiles[hexKey(settlement.coord)];
    if (!tile?.discoveredBy.includes(playerId)) return;
    const visible = tile.visibleBy.includes(playerId) || settlement.playerId === playerId;
    if (!visible) return;
    const position = this.tilePosition(tile);
    const building = this.add.graphics();
    building.setPosition(position.x, position.y - 12);
    const color = settlement.playerId === 'p1' ? 0x65d5b3 : 0xf0a25e;
    if (settlement.outpost) {
      building.fillStyle(0x5d4836, 1); building.fillRect(-2, -25, 4, 28);
      building.fillStyle(color, 1); building.fillTriangle(2, -24, 19, -18, 2, -12);
    } else {
      building.fillStyle(0x5f5549, 1); building.fillRect(-18, -10, 36, 20);
      building.fillStyle(0x2e3440, 1); building.fillTriangle(-23, -10, 0, -31, 23, -10);
      building.fillStyle(0xffd478, 1); building.fillRect(-4, -5, 8, 9);
      building.lineStyle(2, color, 1); building.strokeRect(-18, -10, 36, 20);
    }
    this.board.add(building);
    const name = this.add.text(position.x, position.y + 22, settlement.outpost ? settlement.name : `${settlement.name} · ${settlement.population}`, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px', color: '#fff7da', backgroundColor: '#111923cc', padding: { x: 5, y: 3 }
    }).setOrigin(0.5, 0).setResolution(2);
    this.board.add(name);
  }

  private drawArmy(army: Army, playerId: PlayerId): void {
    if (!this.state || !this.board || army.defeated) return;
    const tile = this.state.tiles[hexKey(army.coord)];
    if (!tile) return;
    const visible = army.playerId === playerId || tile.visibleBy.includes(playerId);
    if (!visible) return;
    const position = this.tilePosition(tile);
    const miniature = this.add.container(position.x - 18, position.y - 14);
    const flag = this.add.graphics();
    const color = army.playerId === 'p1' ? 0x65d5b3 : army.playerId === 'p2' ? 0xf0a25e : 0xd65454;
    flag.fillStyle(0x402f25, 1); flag.fillRect(-1, -19, 3, 29);
    flag.fillStyle(color, 1); flag.fillTriangle(2, -18, 18, -13, 2, -7);
    flag.lineStyle(1, 0xffffff, 0.5); flag.lineBetween(2, -18, 2, -7);
    const base = this.add.ellipse(4, 10, 29, 10, 0x0a0e13, 0.6);
    miniature.add([base, flag]);
    if (army.unitType === 'adept' || army.playerId === 'monsters') {
      const glow = this.add.circle(7, -6, 5, army.playerId === 'monsters' ? 0xff625d : 0x9beeff, 0.5);
      miniature.add(glow);
      this.tweens.add({ targets: glow, alpha: 0.15, scale: 1.5, duration: 900, yoyo: true, repeat: -1 });
    }
    const hpWidth = 26 * (army.hp / army.maxHp);
    const healthBg = this.add.rectangle(4, 17, 28, 4, 0x171b21).setOrigin(0.5);
    const health = this.add.rectangle(-10, 17, hpWidth, 3, army.hp / army.maxHp > 0.45 ? 0x7bd38d : 0xe16a5b).setOrigin(0, 0.5);
    miniature.add([healthBg, health]);
    this.board.add(miniature);
  }

  private drawRuneGlow(x: number, y: number, color: number): void {
    if (!this.board) return;
    const glow = this.add.ellipse(x, y + 3, 54, 24, color, 0.18);
    this.tweens.add({ targets: glow, alpha: 0.06, scaleX: 1.15, scaleY: 1.15, duration: 1100, yoyo: true, repeat: -1 });
    this.board.add(glow);
  }
}
