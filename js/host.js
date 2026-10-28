/*
 * Master (écran du PC) — portage de HubServer.kt.
 *
 *  - Seul détenteur de l'état de vérité : toutes les actions passent par le moteur.
 *  - Chaque téléphone reçoit une vue filtrée (sa main, jamais celles des autres).
 *  - Gorgées envoyées à chaque joueur (mises en attente s'il est déconnecté).
 *  - Sauvegarde locale après chaque coup : un rechargement de page reprend la partie.
 */
/* global Peer */
import { Engine, newGame, defaultOptions, seatOf, isFrozen, MAX_PLAYERS, viewFor } from './engine.js';
import { BotBrain } from './bot.js';
import { PEER_PREFIX, HEARTBEAT_MS, TIMEOUT_MS, PROTOCOL_VERSION, peerOptions, peerErrorText, newTableCode } from './net.js';
import { saveHost, clearHost, randomId } from './store.js';

/** Rythme des bots : assez lent pour qu'on suive la partie et lise chaque carte d'événement. */
const BOT_DELAY_MS = 2_500;
/** Au Purple, on laisse d'abord la carte tirée affichée (3 s) avant l'annonce suivante. */
const BOT_DELAY_PURPLE_MS = 3_500;
/** Délai laissé à un humain qui doit encore piocher avant qu'un bot ne joue (sinon pénalité injuste). */
const BOT_DELAY_HUMAN_DRAW_MS = 4_000;
const BOT_PREFIX = 'bot-';

export class Hub {
  /** listener(hub) est appelé à chaque changement (état, statut réseau, erreur). */
  constructor(listener) {
    this.listener = listener;
    this.engine = new Engine();
    this.brain = new BotBrain();
    this.state = null;
    this.code = null;
    this.status = 'starting'; // starting | ready | error
    this.statusText = '';
    this.lastError = null;
    this.conns = new Map(); // connexion -> { playerId, lastSeen }
    this.byPlayer = new Map(); // playerId -> connexion
    this.pending = new Map(); // playerId -> messages en attente
    this.botTimer = null;
    this.botCounter = 0;
    this.attempts = 0;
  }

  notify() { this.listener?.(this); }

  /* ============================ Démarrage ============================ */

  start(roomName, resume = null) {
    if (resume) {
      // Après reprise, tous les humains sont considérés déconnectés jusqu'à leur retour.
      this.code = resume.code;
      this.state = { ...resume.state, seats: resume.state.seats.map((s) => (s.isBot ? s : { ...s, connected: false })) };
    } else {
      this.code = newTableCode();
      this.state = newGame(randomId(12), roomName || 'Soirée 98', defaultOptions());
    }
    this.botCounter = this.state.seats.filter((s) => s.isBot).length;
    this.openPeer();
    this.heartbeat = setInterval(() => this.tickHeartbeat(), HEARTBEAT_MS);
    this.scheduleBots();
    this.notify();
  }

  openPeer() {
    this.peer?.destroy();
    this.status = 'starting';
    const peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.attempts = 0;
      this.status = 'ready';
      this.statusText = '';
      this.notify();
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // Perte du service de mise en relation : les connexions établies continuent, on se réenregistre.
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 2_000);
    });
    peer.on('error', (err) => {
      this.statusText = peerErrorText(err);
      if (err.type === 'unavailable-id' && this.attempts < 10) {
        // Code encore réservé (ancienne page du Master pas encore libérée) : on réessaie.
        this.attempts++;
        setTimeout(() => this.openPeer(), 3_000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.status = 'error';
        setTimeout(() => this.openPeer(), 5_000);
      }
      this.notify();
    });
  }

  stop(endGame) {
    for (const conn of this.conns.keys()) {
      try { conn.send({ type: 'ended' }); } catch { /* déjà fermée */ }
      setTimeout(() => conn.close(), 300);
    }
    clearInterval(this.heartbeat);
    clearTimeout(this.botTimer);
    setTimeout(() => this.peer?.destroy(), 500);
    if (endGame) clearHost();
    this.conns.clear();
    this.byPlayer.clear();
  }

  /* ============================== Réseau ============================== */

  accept(conn) {
    this.conns.set(conn, { playerId: null, lastSeen: Date.now() });
    conn.on('data', (msg) => {
      const entry = this.conns.get(conn);
      if (entry) entry.lastSeen = Date.now();
      this.onMessage(conn, msg);
    });
    conn.on('close', () => this.onClosed(conn));
    conn.on('error', () => this.onClosed(conn));
  }

  send(conn, msg) {
    try { if (conn.open) { conn.send(msg); return true; } } catch { /* connexion perdue */ }
    return false;
  }

  onMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const playerId = this.conns.get(conn)?.playerId;
    switch (msg.type) {
      case 'hello': return this.onHello(conn, msg);
      case 'ping': return this.send(conn, { type: 'pong' });
      case 'leave': return conn.close();
      case 'action':
        if (playerId) this.mutate((s) => this.engine.apply(s, playerId, msg.action), conn);
        return;
      case 'report':
        if (playerId) this.mutate((s) => this.engine.reportFault(s, playerId, msg.accusedId, msg.kind), conn);
        return;
      case 'bac':
        if (playerId && this.state) this.publish(this.engine.setBac(this.state, playerId, msg.bac ?? null, msg.level ?? null));
        return;
      default:
    }
  }

  onHello(conn, hello) {
    if (hello.protocol !== PROTOCOL_VERSION) return this.reject(conn, 'PROTOCOL');
    const uid = String(hello.uid || '').slice(0, 40);
    if (!uid || uid.startsWith(BOT_PREFIX)) return this.reject(conn, 'PROTOCOL');
    const s = this.state;
    const existing = seatOf(s, uid);
    let next;
    if (existing) {
      // Reconnexion : on retrouve sa place, même si un bot l'avait remplacé entre-temps.
      const reclaimed = existing.isBot ? this.engine.setBot(s, uid, false).state : s;
      next = this.engine.setConnected(reclaimed, uid, true);
    } else if (s.phase.type !== 'lobby') {
      return this.reject(conn, 'GAME_IN_PROGRESS');
    } else if (s.seats.length >= MAX_PLAYERS) {
      return this.reject(conn, 'ROOM_FULL');
    } else {
      const o = this.engine.addSeat(s, uid, String(hello.pseudo || 'Joueur').slice(0, 20));
      if (o.error) return this.reject(conn, 'ROOM_FULL');
      next = o.state;
    }
    // Une éventuelle ancienne connexion du même joueur est fermée.
    const old = this.byPlayer.get(uid);
    if (old && old !== conn) { this.conns.delete(old); old.close(); }
    this.conns.get(conn).playerId = uid;
    this.byPlayer.set(uid, conn);
    this.send(conn, { type: 'welcome', sessionUid: next.sessionUid, roomName: next.roomName, playerId: uid });
    for (const m of this.pending.get(uid) || []) this.send(conn, m);
    this.pending.delete(uid);
    this.publish(next);
  }

  reject(conn, reason) {
    this.send(conn, { type: 'rejected', reason });
    setTimeout(() => conn.close(), 300);
  }

  onClosed(conn) {
    const entry = this.conns.get(conn);
    this.conns.delete(conn);
    const playerId = entry?.playerId;
    if (!playerId || this.byPlayer.get(playerId) !== conn) return; // déjà remplacée
    this.byPlayer.delete(playerId);
    const s = this.state;
    if (!s) return;
    this.publish(s.phase.type === 'lobby' ? this.engine.removeSeat(s, playerId).state : this.engine.setConnected(s, playerId, false));
  }

  tickHeartbeat() {
    const now = Date.now();
    for (const [conn, entry] of this.conns) {
      if (now - entry.lastSeen > TIMEOUT_MS) conn.close(); // connexion morte
      else this.send(conn, { type: 'ping' });
    }
  }

  sendTo(playerId, msg) {
    const conn = this.byPlayer.get(playerId);
    if (!conn || !this.send(conn, msg)) {
      if (!this.pending.has(playerId)) this.pending.set(playerId, []);
      this.pending.get(playerId).push(msg);
    }
  }

  /* ======================= Mutations de l'état ======================= */

  /** Applique une transition du moteur. Renvoie le code d'erreur éventuel. */
  mutate(fn, replyTo = null) {
    if (!this.state) return 'WRONG_PHASE';
    const o = fn(this.state);
    if (o.error) {
      if (replyTo) this.send(replyTo, { type: 'error', error: o.error });
      else { this.lastError = o.error; this.notify(); }
      return o.error;
    }
    this.handleEvents(o);
    this.publish(o.state);
    return null;
  }

  publish(next) {
    this.state = next;
    for (const [playerId, conn] of this.byPlayer) this.send(conn, { type: 'view', view: viewFor(next, playerId) });
    if (next.roundNumber > 0) saveHost(this.code, next);
    this.scheduleBots();
    this.notify();
  }

  handleEvents(outcome) {
    for (const e of outcome.events) {
      if (e.type !== 'drink') continue;
      const seat = seatOf(outcome.state, e.playerId);
      if (seat && !seat.isBot) this.sendTo(e.playerId, { type: 'drink', seq: e.seq, sips: e.sips, reason: e.reason, fromName: e.fromName });
    }
  }

  /* ============================== Bots ============================== */

  scheduleBots() {
    if (this.botTimer) return;
    const s = this.state;
    if (!s || isFrozen(s)) return; // pause ou arbitrage : les bots attendent aussi
    if (!s.seats.some((x) => x.isBot && this.brain.decide(s, x.id))) return;
    const humanMustDraw = s.seats.some((x) => !x.isBot && x.connected && x.pendingDraw);
    const delay = humanMustDraw ? BOT_DELAY_HUMAN_DRAW_MS : s.phase.type === 'purple' ? BOT_DELAY_PURPLE_MS : BOT_DELAY_MS;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const cur = this.state;
      if (!cur || isFrozen(cur)) return;
      for (const bot of cur.seats.filter((x) => x.isBot)) {
        const action = this.brain.decide(cur, bot.id);
        if (!action) continue;
        const o = this.engine.apply(cur, bot.id, action);
        if (!o.error) { this.handleEvents(o); this.publish(o.state); }
        return;
      }
    }, delay);
  }

  /* ========================= Commandes du Master ========================= */

  addBot() {
    this.botCounter++;
    return this.mutate((s) => this.engine.addSeat(s, BOT_PREFIX + randomId(8), `Bot ${this.botCounter}`, true));
  }

  removeSeat(playerId) {
    const conn = this.byPlayer.get(playerId);
    if (conn) {
      this.byPlayer.delete(playerId);
      this.conns.delete(conn);
      this.reject(conn, 'KICKED');
    }
    return this.mutate((s) => this.engine.removeSeat(s, playerId));
  }

  startRound() { return this.mutate((s) => this.engine.startRound(s)); }
  setPaused(paused) { return this.mutate((s) => this.engine.setPaused(s, paused)); }
  resolveReport(accepted) { return this.mutate((s) => this.engine.resolveReport(s, accepted)); }
  penalty(playerId) { return this.mutate((s) => this.engine.hintPenalty(s, playerId)); }
  setBot(playerId, isBot) { return this.mutate((s) => this.engine.setBot(s, playerId, isBot)); }
  /** Action jouée depuis l'écran du Master à la place d'un joueur (Purple, acolyte). */
  actFor(playerId, action) { return this.mutate((s) => this.engine.apply(s, playerId, action)); }

  updateOptions(options) {
    const s = this.state;
    if (s && (s.phase.type === 'lobby' || s.phase.type === 'roundOver')) this.publish({ ...s, options, version: s.version + 1 });
  }

  rename(name) {
    const s = this.state;
    if (s && s.phase.type === 'lobby' && name.trim()) this.publish({ ...s, roomName: name.trim().slice(0, 30), version: s.version + 1 });
  }
}
