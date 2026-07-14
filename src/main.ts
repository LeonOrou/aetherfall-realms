import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';
import { runAiTurn } from './game/ai';
import { BUILDINGS, DISCOVERIES, SPELLS, TERRAINS, UNITS } from './game/data';
import { hexDistance, hexKey, sameHex } from './game/hex';
import { createInitialState } from './game/map';
import { exportSave, importSave, LocalGamePersistence } from './game/persistence';
import { applyCommand, calculateScore, currentPlayer, predictCombat, predictRangedAttack } from './game/rules';
import { hashSeed } from './game/rng';
import type { BuildingType, DiscoveryId, GameCommand, GameEvent, GameState, HexCoord, SpellId, UnitType } from './game/types';
import { eventBus } from './scenes/EventBus';
import { WorldScene } from './scenes/WorldScene';
import './styles/main.css';

registerSW({ immediate: true });

const assetBase = `${import.meta.env.BASE_URL}assets`;
document.documentElement.style.setProperty('--terrain-art-url', `url("${assetBase}/game/terrain-props.webp")`);
document.documentElement.style.setProperty('--title-art-url', `url("${assetBase}/title-diorama.webp")`);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <button class="brand" id="open-help" aria-label="Open game guide">
        <span class="brand-mark">✦</span><span><strong>Aetherfall</strong><small>Realms</small></span>
      </button>
      <div class="resources" aria-label="Resources">
        <span title="Food"><i class="resource-dot food"></i><b id="food">0</b></span>
        <span title="Materials"><i class="resource-dot materials"></i><b id="materials">0</b></span>
        <span title="Knowledge"><i class="resource-dot knowledge"></i><b id="knowledge">0</b></span>
        <span title="Mana"><i class="resource-dot mana"></i><b id="mana">0</b></span>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="open-research" title="Discoveries (R)">⌘<span>Discoveries</span></button>
        <button class="icon-button" id="open-save" title="Save and load (S)">◇<span>Save</span></button>
        <button class="icon-button install-button hidden" id="install-app">＋<span>Install</span></button>
      </div>
    </header>

    <main class="play-area">
      <section class="map-wrap" aria-label="Game map">
        <div id="game-canvas"></div>
        <div class="map-vignette"></div>
        <div class="turn-card" id="turn-card">
          <span id="player-name">Verdant Concord</span>
          <strong>Round <span id="round">1</span><small>/ 30</small></strong>
          <span id="research-status">No discovery selected</span>
        </div>
        <div class="map-hint" id="map-hint">Drag to pan · wheel or pinch to zoom · select a hex</div>
        <div class="ai-badge hidden" id="ai-badge"><span></span>The rival realm is moving…</div>
      </section>

      <aside class="info-panel" id="info-panel" aria-live="polite"></aside>
    </main>

    <footer class="command-dock">
      <div class="event-line" id="event-line">The aether stirs. Choose a path.</div>
      <button class="primary end-turn" id="end-turn">End turn <kbd>E</kbd></button>
    </footer>
  </div>

  <div class="start-screen" id="start-screen">
    <div class="start-shade"></div>
    <div class="start-card">
      <span class="eyebrow">A compact fantasy strategy game</span>
      <h1>Aetherfall <em>Realms</em></h1>
      <p>Explore a living hex world, raise settlements, awaken old magic, and shape a realm in thirty brisk turns.</p>
      <label class="seed-field">World seed <input id="seed-input" value="skyglass" maxlength="32" /></label>
      <div class="start-actions">
        <button class="primary large" data-start="single">New solo realm</button>
        <button class="secondary large" data-start="hotseat">Local hot-seat</button>
      </div>
      <button class="text-button hidden" id="continue-game">Continue saved realm</button>
      <small>Runs offline after the first visit · saves stay on this device</small>
    </div>
  </div>

  <div class="modal-layer hidden" id="modal-layer" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-card">
      <header><div><span class="eyebrow" id="modal-eyebrow">Realm ledger</span><h2 id="modal-title"></h2></div><button class="close-button" id="close-modal" aria-label="Close">×</button></header>
      <div class="modal-body" id="modal-body"></div>
    </div>
  </div>
  <input class="hidden" type="file" id="import-input" accept="application/json,.json" />
  <div class="toast" id="toast" role="status"></div>
`;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

class AetherfallApp {
  private state: GameState = createInitialState(hashSeed('skyglass'));
  private readonly persistence = new LocalGamePersistence();
  private readonly game: Phaser.Game;
  private selected?: HexCoord;
  private selectedArmyId?: string;
  private pendingSpell?: SpellId;
  private events: string[] = [];
  private installPrompt?: Event & { prompt: () => Promise<void> };

  constructor() {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas',
      backgroundColor: '#101720',
      scene: [WorldScene],
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: '100%', height: '100%' },
      render: { antialias: true, roundPixels: true },
      input: { activePointers: 3 }
    });
    this.bindEvents();
    void this.prepareStartScreen();
  }

  private bindEvents(): void {
    eventBus.on('hex-selected', (coord: HexCoord) => this.selectHex(coord));
    document.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((button) => button.addEventListener('click', () => {
      this.newGame(button.dataset.start === 'hotseat' ? 'hotseat' : 'single');
    }));
    getElement('continue-game').addEventListener('click', () => void this.continueGame());
    getElement('end-turn').addEventListener('click', () => this.execute({ type: 'END_TURN' }));
    getElement('open-research').addEventListener('click', () => this.openResearch());
    getElement('open-save').addEventListener('click', () => this.openSaveMenu());
    getElement('open-help').addEventListener('click', () => this.openHelp());
    getElement('close-modal').addEventListener('click', () => this.closeModal());
    getElement('modal-layer').addEventListener('click', (event) => {
      if (event.target === getElement('modal-layer')) this.closeModal();
    });
    getElement<HTMLInputElement>('import-input').addEventListener('change', (event) => void this.handleImport(event));
    getElement('info-panel').addEventListener('click', (event) => this.handlePanelAction(event));
    getElement('install-app').addEventListener('click', () => void this.installPrompt?.prompt());
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPrompt = event as Event & { prompt: () => Promise<void> };
      getElement('install-app').classList.remove('hidden');
    });
    window.addEventListener('keydown', (event) => this.handleKey(event));
  }

  private async prepareStartScreen(): Promise<void> {
    const saved = await this.persistence.load('autosave');
    getElement('continue-game').classList.toggle('hidden', !saved);
  }

  private newGame(mode: 'single' | 'hotseat'): void {
    const seedText = getElement<HTMLInputElement>('seed-input').value.trim() || String(Date.now());
    this.state = createInitialState(hashSeed(seedText), mode);
    this.selected = undefined;
    this.selectedArmyId = undefined;
    this.pendingSpell = undefined;
    this.events = ['Your scouts arrive at the edge of an uncharted realm.'];
    getElement('start-screen').classList.add('hidden');
    void this.persistence.save('autosave', this.state);
    this.render();
  }

  private async continueGame(): Promise<void> {
    const saved = await this.persistence.load('autosave');
    if (!saved) return;
    this.state = saved;
    getElement('start-screen').classList.add('hidden');
    this.events = [`Realm restored at round ${saved.round}.`];
    this.render();
  }

  private scene(): WorldScene | undefined {
    return this.game.scene.getScene('WorldScene') as WorldScene | undefined;
  }

  private selectHex(coord: HexCoord): void {
    if (this.state.status !== 'playing' || !currentPlayer(this.state).human) return;
    this.selected = coord;
    const ownArmy = this.state.armies.find((army) => !army.defeated && army.playerId === currentPlayer(this.state).id && sameHex(army.coord, coord));
    if (ownArmy) this.selectedArmyId = ownArmy.id;
    this.render();
  }

  private execute(command: GameCommand): void {
    const endingPlayer = currentPlayer(this.state);
    const result = applyCommand(this.state, command);
    if (!result.ok) {
      this.toast(result.error ?? 'That action is not available.');
      return;
    }
    this.state = result.state;
    this.describeEvents(result.events);
    this.pendingSpell = undefined;
    if (this.selectedArmyId && !this.state.armies.some((army) => army.id === this.selectedArmyId && !army.defeated)) this.selectedArmyId = undefined;
    void this.persistence.save('autosave', this.state);
    this.render();

    if (this.state.status === 'finished') {
      this.openScore();
      return;
    }
    if (command.type === 'END_TURN') {
      if (currentPlayer(this.state).human) {
        this.openHandoff(endingPlayer.name, currentPlayer(this.state).name);
      } else {
        this.runAi();
      }
    }
  }

  private runAi(): void {
    getElement('ai-badge').classList.remove('hidden');
    getElement<HTMLButtonElement>('end-turn').disabled = true;
    window.setTimeout(() => {
      const result = runAiTurn(this.state);
      this.state = result.state;
      this.describeEvents(result.events);
      void this.persistence.save('autosave', this.state);
      getElement('ai-badge').classList.add('hidden');
      getElement<HTMLButtonElement>('end-turn').disabled = false;
      this.selected = undefined;
      this.selectedArmyId = undefined;
      this.render();
      if (this.state.status === 'finished') this.openScore();
    }, 480);
  }

  private describeEvents(gameEvents: GameEvent[]): void {
    for (const event of gameEvents) {
      let description = '';
      if (event.type === 'ARMY_MOVED') description = 'An army advances into new ground.';
      if (event.type === 'COMBAT') description = event.message;
      if (event.type === 'SETTLEMENT_FOUNDED') description = 'A new banner rises over the frontier.';
      if (event.type === 'CONSTRUCTION_QUEUED') description = `${event.itemId} added to the construction queue.`;
      if (event.type === 'CONSTRUCTION_COMPLETED') description = `${event.itemId} completed.`;
      if (event.type === 'DISCOVERY_CHOSEN') description = `Research begun: ${DISCOVERIES[event.discoveryId].name}.`;
      if (event.type === 'DISCOVERY_COMPLETED') description = `Discovery completed: ${DISCOVERIES[event.discoveryId].name}!`;
      if (event.type === 'SPELL_CAST' || event.type === 'SITE_RESOLVED') description = event.message;
      if (event.type === 'GAME_FINISHED') description = `${this.state.players.find((player) => player.id === event.winnerId)?.name} wins the age.`;
      if (description) this.events.unshift(description);
    }
    this.events = this.events.slice(0, 8);
  }

  private render(): void {
    const player = currentPlayer(this.state);
    getElement('food').textContent = String(player.resources.food);
    getElement('materials').textContent = String(player.resources.materials);
    getElement('knowledge').textContent = String(player.resources.knowledge);
    getElement('mana').textContent = String(player.resources.mana);
    getElement('player-name').textContent = player.name;
    getElement('round').textContent = String(Math.min(this.state.round, this.state.maxRounds));
    const research = player.activeDiscovery ? DISCOVERIES[player.activeDiscovery] : undefined;
    getElement('research-status').textContent = research ? `${research.name} · ${player.discoveryProgress}/${research.cost}` : 'No discovery selected';
    getElement('event-line').textContent = this.events[0] ?? 'Select a hex to inspect it.';
    getElement<HTMLButtonElement>('end-turn').disabled = !player.human || this.state.status !== 'playing';
    this.renderInfoPanel();
    this.scene()?.setState(this.state, this.selected);
  }

  private renderInfoPanel(): void {
    const panel = getElement('info-panel');
    if (!this.selected) {
      panel.innerHTML = `
        <div class="panel-empty">
          <span class="compass">✧</span>
          <h2>Chart the realm</h2>
          <p>Select a revealed hex. Your scouts can move, explore sites, cast spells and establish a foothold.</p>
          <div class="quick-keys"><span><kbd>R</kbd> Discoveries</span><span><kbd>S</kbd> Save</span><span><kbd>E</kbd> End turn</span></div>
        </div>`;
      return;
    }
    const tile = this.state.tiles[hexKey(this.selected)];
    const player = currentPlayer(this.state);
    if (!tile?.discoveredBy.includes(player.id)) {
      panel.innerHTML = `<div class="panel-empty"><span class="compass">?</span><h2>Uncharted mist</h2><p>Move closer or cast Far Sight to reveal this land.</p></div>`;
      return;
    }
    const terrain = tile.forestUntil && tile.forestUntil >= this.state.round ? TERRAINS.forest : TERRAINS[tile.terrain];
    const site = this.state.sites.find((candidate) => candidate.id === tile.siteId);
    const settlement = this.state.settlements.find((candidate) => sameHex(candidate.coord, this.selected!));
    const armies = this.state.armies.filter((army) => !army.defeated && sameHex(army.coord, this.selected!));
    const ownArmy = armies.find((army) => army.playerId === player.id);
    const activeArmy = this.state.armies.find((army) => army.id === this.selectedArmyId && !army.defeated);
    const targetEnemy = armies.find((army) => army.playerId !== player.id);
    const prediction = activeArmy && targetEnemy ? predictCombat(this.state, activeArmy.id, targetEnemy.id) : undefined;
    const rangedPrediction = activeArmy?.unitType === 'ranger' && targetEnemy && hexDistance(activeArmy.coord, this.selected) <= 2 ? predictRangedAttack(this.state, activeArmy.id) : undefined;
    const yieldValue = terrain.yield;
    const actions: string[] = [];

    if (rangedPrediction) {
      actions.push(`<button class="primary full" data-action="ranged">Ranged strike · ${rangedPrediction.join('–')} damage · no retaliation</button>`);
    } else if (activeArmy && !sameHex(activeArmy.coord, this.selected) && hexDistance(activeArmy.coord, this.selected) === 1) {
      actions.push(`<button class="primary full" data-action="move">${targetEnemy ? `Attack · ${prediction?.likely ?? 'unknown'}` : `Move here · cost ${terrain.moveCost}`}</button>`);
    }
    if (ownArmy) {
      if (site && !site.resolvedBy.includes(player.id)) actions.push('<button class="primary full" data-action="site">Explore site</button>');
      if (ownArmy.unitType === 'scout') {
        actions.push('<button class="secondary" data-action="found">Found settlement · 10</button>');
        actions.push('<button class="secondary" data-action="outpost">Raise outpost · 6</button>');
      }
      actions.push('<button class="secondary full" data-action="spells">Cast terrain spell</button>');
    }
    if (settlement?.playerId === player.id && !settlement.outpost) actions.push('<button class="primary full" data-action="build">Construction</button>');
    if (this.pendingSpell && activeArmy) {
      const spell = SPELLS[this.pendingSpell];
      actions.unshift(`<button class="magic full" data-action="cast">Cast ${spell.name} here · ${spell.cost} mana</button>`);
    }

    const predictionHtml = prediction && !rangedPrediction ? `<div class="prediction ${prediction.likely}"><span>Battle forecast</span><strong>${prediction.likely}</strong><small>Your power ${prediction.attackerPower} · enemy ${prediction.defenderPower}<br>Expected damage: you ${prediction.attackerDamageRange.join('–')} · enemy ${prediction.defenderDamageRange.join('–')}</small></div>` : '';
    panel.innerHTML = `
      <div class="panel-scroll">
        <div class="terrain-hero terrain-${terrain.id}"><span>${terrain.name}</span><small>Hex ${tile.coord.q}, ${tile.coord.r}</small></div>
        <div class="yield-row"><span title="Food">● ${yieldValue.food}</span><span title="Materials">◆ ${yieldValue.materials}</span><span title="Knowledge">✦ ${yieldValue.knowledge}</span><span title="Mana">✧ ${yieldValue.mana}</span></div>
        <p class="description">${terrain.description}</p>
        ${site ? `<section class="info-block"><span class="eyebrow">${site.type}</span><h3>${site.name}</h3><p>${site.resolvedBy.includes(player.id) ? 'Already explored by your realm.' : site.type === 'lair' ? 'A dangerous guardian watches this place.' : 'An opportunity waits here.'}</p></section>` : ''}
        ${settlement ? `<section class="info-block"><span class="eyebrow">${settlement.outpost ? 'Outpost' : `Settlement · population ${settlement.population}`}</span><h3>${settlement.name}</h3><p>${settlement.queue ? `Building ${settlement.queue.itemId}: ${settlement.queue.progress}/${settlement.queue.cost}` : settlement.outpost ? 'Claims the surrounding frontier.' : 'Construction queue is open.'}</p>${settlement.buildings.length ? `<div class="tag-row">${settlement.buildings.map((item) => `<span>${BUILDINGS[item].name}</span>`).join('')}</div>` : ''}</section>` : ''}
        ${armies.map((army) => `<section class="info-block army-card ${army.playerId === player.id ? 'friendly' : 'hostile'}"><span class="eyebrow">${army.playerId === 'monsters' ? 'Monster' : UNITS[army.unitType].name}</span><h3>${army.name}</h3><p>Health ${army.hp}/${army.maxHp} · Strength ${army.strength} · Moves ${army.moves}/${army.maxMoves}</p></section>`).join('')}
        ${predictionHtml}
      </div>
      <div class="context-actions">${actions.join('') || '<small>No contextual actions on this hex.</small>'}</div>`;
  }

  private handlePanelAction(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!button || !this.selected) return;
    const action = button.dataset.action;
    if (action === 'move' && this.selectedArmyId) this.execute({ type: 'MOVE_ARMY', armyId: this.selectedArmyId, to: this.selected });
    if (action === 'ranged' && this.selectedArmyId) this.execute({ type: 'RANGED_ATTACK', armyId: this.selectedArmyId, target: this.selected });
    if (action === 'site' && this.selectedArmyId) this.execute({ type: 'INTERACT_WITH_SITE', armyId: this.selectedArmyId });
    if (action === 'found' && this.selectedArmyId) this.execute({ type: 'FOUND_SETTLEMENT', armyId: this.selectedArmyId });
    if (action === 'outpost' && this.selectedArmyId) this.execute({ type: 'FOUND_OUTPOST', armyId: this.selectedArmyId });
    if (action === 'build') this.openBuildMenu();
    if (action === 'spells') this.openSpellMenu();
    if (action === 'cast' && this.selectedArmyId && this.pendingSpell) this.execute({ type: 'CAST_SPELL', spellId: this.pendingSpell, armyId: this.selectedArmyId, target: this.selected });
  }

  private openResearch(): void {
    const player = currentPlayer(this.state);
    const branches = ['Craft', 'Lore', 'Arcana'] as const;
    this.openModal('Discovery web', branches.map((branch) => `
      <section class="branch"><h3>${branch}</h3><div class="card-grid">
        ${(Object.keys(DISCOVERIES) as DiscoveryId[]).filter((id) => DISCOVERIES[id].branch === branch).map((id) => {
          const discovery = DISCOVERIES[id];
          const known = player.discoveries.includes(id);
          const locked = discovery.requires.some((requirement) => !player.discoveries.includes(requirement));
          const active = player.activeDiscovery === id;
          return `<button class="choice-card ${known ? 'known' : ''} ${active ? 'active' : ''}" data-discovery="${id}" ${known || locked ? 'disabled' : ''}><span>${known ? 'Known' : active ? 'Researching' : `${discovery.cost} knowledge`}</span><strong>${discovery.name}</strong><small>${discovery.description}</small>${locked ? `<i>Requires ${discovery.requires.map((item) => DISCOVERIES[item].name).join(' + ')}</i>` : ''}</button>`;
        }).join('')}
      </div></section>`).join(''), 'Shape your people');
    document.querySelectorAll<HTMLButtonElement>('[data-discovery]').forEach((button) => button.addEventListener('click', () => {
      this.execute({ type: 'CHOOSE_DISCOVERY', discoveryId: button.dataset.discovery as DiscoveryId });
      this.closeModal();
    }));
  }

  private openBuildMenu(): void {
    if (!this.selected) return;
    const player = currentPlayer(this.state);
    const settlement = this.state.settlements.find((candidate) => sameHex(candidate.coord, this.selected!) && candidate.playerId === player.id);
    if (!settlement) return;
    const buildingCards = (Object.keys(BUILDINGS) as BuildingType[]).map((id) => {
      const item = BUILDINGS[id];
      const disabled = settlement.queue || settlement.buildings.includes(id) || player.resources.materials < item.cost;
      return `<button class="choice-card" data-build-kind="building" data-build="${id}" ${disabled ? 'disabled' : ''}><span>${item.cost} materials</span><strong>${item.name}</strong><small>${item.description}</small></button>`;
    }).join('');
    const unitCards = (['scout', 'guardian', 'ranger', 'adept'] as UnitType[]).map((id) => {
      const item = UNITS[id];
      return `<button class="choice-card" data-build-kind="unit" data-build="${id}" ${settlement.queue || player.resources.materials < item.cost ? 'disabled' : ''}><span>${item.cost} materials</span><strong>${item.name}</strong><small>${item.description}</small></button>`;
    }).join('');
    this.openModal(`${settlement.name} construction`, `<section class="branch"><h3>Buildings</h3><div class="card-grid">${buildingCards}</div></section><section class="branch"><h3>Recruit</h3><div class="card-grid">${unitCards}</div></section>`, settlement.queue ? 'Queue occupied' : 'Choose one project');
    document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((button) => button.addEventListener('click', () => {
      this.execute({ type: 'QUEUE_CONSTRUCTION', settlementId: settlement.id, kind: button.dataset.buildKind as 'building' | 'unit', itemId: button.dataset.build as BuildingType | UnitType });
      this.closeModal();
    }));
  }

  private openSpellMenu(): void {
    const player = currentPlayer(this.state);
    const html = `<div class="spell-grid">${(Object.keys(SPELLS) as SpellId[]).map((id) => {
      const spell = SPELLS[id];
      const locked = spell.discovery && !player.discoveries.includes(spell.discovery);
      return `<button class="spell-card school-${spell.school.toLowerCase()}" data-spell="${id}" ${locked ? 'disabled' : ''}><span>${spell.school} · ${spell.cost} mana</span><strong>${spell.name}</strong><small>${spell.description}</small>${locked ? `<i>Requires ${DISCOVERIES[spell.discovery!].name}</i>` : ''}</button>`;
    }).join('')}</div><p class="modal-note">Choose a spell, then select a target within three hexes and confirm it in the map panel.</p>`;
    this.openModal('Terrain magic', html, 'Five schools, visible consequences');
    document.querySelectorAll<HTMLButtonElement>('[data-spell]').forEach((button) => button.addEventListener('click', () => {
      this.pendingSpell = button.dataset.spell as SpellId;
      this.closeModal();
      this.toast(`Select a target for ${SPELLS[this.pendingSpell].name}.`);
      this.render();
    }));
  }

  private openSaveMenu(): void {
    this.openModal('Save the realm', `
      <div class="save-actions">
        <button class="primary large" id="save-now">Save on this device</button>
        <button class="secondary large" id="export-save">Export save as JSON</button>
        <button class="secondary large" id="import-save">Import JSON save</button>
        <button class="danger-text" id="return-title">Return to title</button>
      </div>
      <p class="modal-note">The autosave updates after every valid action. Exported saves are portable between browsers.</p>`, 'Local and portable');
    getElement('save-now').addEventListener('click', () => void this.persistence.save('manual', this.state).then(() => this.toast('Realm saved.')));
    getElement('export-save').addEventListener('click', () => this.exportGame());
    getElement('import-save').addEventListener('click', () => getElement<HTMLInputElement>('import-input').click());
    getElement('return-title').addEventListener('click', () => { this.closeModal(); getElement('start-screen').classList.remove('hidden'); void this.prepareStartScreen(); });
  }

  private exportGame(): void {
    const blob = new Blob([exportSave(this.state)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `aetherfall-round-${this.state.round}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    this.toast('Portable save prepared.');
  }

  private async handleImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.state = importSave(await file.text());
      await this.persistence.save('autosave', this.state);
      this.closeModal();
      getElement('start-screen').classList.add('hidden');
      this.selected = undefined;
      this.selectedArmyId = undefined;
      this.events = ['A realm was imported successfully.'];
      this.render();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : 'The save could not be imported.');
    } finally {
      input.value = '';
    }
  }

  private openHelp(): void {
    this.openModal('How to play', `
      <div class="guide-grid">
        <section><b>1</b><div><h3>Explore</h3><p>Select your scout, then an adjacent hex. Confirm movement in the side panel. Fog clears around armies.</p></div></section>
        <section><b>2</b><div><h3>Settle</h3><p>Scouts found settlements for 10 materials or reusable territory-claiming outposts for 6.</p></div></section>
        <section><b>3</b><div><h3>Grow</h3><p>Population works nearby tiles automatically. Queue one building or troop group per settlement.</p></div></section>
        <section><b>4</b><div><h3>Discover</h3><p>Choose Craft, Lore or Arcana research. Knowledge is invested automatically at each turn end.</p></div></section>
        <section><b>5</b><div><h3>Shape the map</h3><p>Cast from a selected army: reveal land, grow forest, freeze water, scorch enemies, or haunt wasteland.</p></div></section>
        <section><b>6</b><div><h3>Score</h3><p>After 30 rounds, population, territory, discoveries, relics, landmarks, monsters and settlements decide the winner.</p></div></section>
      </div>
      <p class="modal-note">Desktop: drag and wheel. Mobile: one-finger pan and pinch zoom. Keyboard: E end turn, R discoveries, S save, Esc cancel.</p>`, 'Field guide');
  }

  private openHandoff(from: string, to: string): void {
    if (this.state.mode !== 'hotseat') return;
    this.openModal(`Pass to ${to}`, `<div class="handoff"><span class="handoff-orb"></span><p>${from} has ended their turn. Hide the map, pass the device, then let ${to} continue.</p><button class="primary large" id="accept-handoff">Begin ${to}'s turn</button></div>`, 'Hot-seat handoff', false);
    getElement('accept-handoff').addEventListener('click', () => { this.closeModal(true); this.selected = undefined; this.selectedArmyId = undefined; this.render(); });
  }

  private openScore(): void {
    const p1 = this.state.scores?.p1 ?? calculateScore(this.state, 'p1');
    const p2 = this.state.scores?.p2 ?? calculateScore(this.state, 'p2');
    const winner = this.state.players.find((player) => player.id === this.state.winnerId);
    const scoreTable = (score: typeof p1) => `<span>${score.population}</span><span>${score.territory}</span><span>${score.discoveries}</span><span>${score.relicsAndLandmarks}</span><span>${score.monsters}</span><span>${score.settlements}</span><strong>${score.total}</strong>`;
    this.openModal(`${winner?.name ?? 'A realm'} shapes the age`, `<div class="score-table"><div class="score-labels"><span>Population</span><span>Territory</span><span>Discoveries</span><span>Relics & landmarks</span><span>Monsters</span><span>Settlements</span><strong>Total</strong></div><div><h3>${this.state.players[0].name}</h3>${scoreTable(p1)}</div><div><h3>${this.state.players[1].name}</h3>${scoreTable(p2)}</div></div><button class="primary large centered" id="score-title">Return to title</button>`, 'Thirty rounds complete', false);
    getElement('score-title').addEventListener('click', () => { this.closeModal(true); getElement('start-screen').classList.remove('hidden'); });
  }

  private openModal(title: string, html: string, eyebrow = 'Realm ledger', closeable = true): void {
    getElement('modal-title').textContent = title;
    getElement('modal-eyebrow').textContent = eyebrow;
    getElement('modal-body').innerHTML = html;
    getElement('close-modal').classList.toggle('hidden', !closeable);
    getElement('modal-layer').classList.remove('hidden');
  }

  private closeModal(force = false): void {
    if (!force && getElement('close-modal').classList.contains('hidden')) return;
    getElement('modal-layer').classList.add('hidden');
  }

  private handleKey(event: KeyboardEvent): void {
    if (!getElement('start-screen').classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      if (!getElement('close-modal').classList.contains('hidden')) this.closeModal();
      this.pendingSpell = undefined;
      this.render();
      return;
    }
    if (!getElement('modal-layer').classList.contains('hidden')) return;
    if (event.key.toLowerCase() === 'e') this.execute({ type: 'END_TURN' });
    if (event.key.toLowerCase() === 'r') this.openResearch();
    if (event.key.toLowerCase() === 's') this.openSaveMenu();
  }

  private toast(message: string): void {
    const toast = getElement('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2600);
  }
}

new AetherfallApp();
