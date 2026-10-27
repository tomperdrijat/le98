/*
 * Téléphone du joueur — portage de PlayerClient.kt.
 * Aucune règle ici : on affiche la vue reçue du Master et on lui envoie les intentions du joueur.
 *
 * Reconnexion automatique : sur iPhone, Safari coupe la connexion quand l'écran se verrouille ;
 * au retour sur la page, on se reconnecte et le Master nous rend notre place (même identifiant).
 */
/* global Peer */
import { PEER_PREFIX, HEARTBEAT_MS, TIMEOUT_MS, PROTOCOL_VERSION, peerOptions, peerErrorText } from './net.js';
import { recordSips, bacStatus } from './store.js';

const MAX_ATTEMPTS = 60;

export class Client {
  /**
   * @param profile profil local (uid, pseudo, poids…)
   * @param code    code de la table
   * @param listener appelé à chaque changement ; reçoit (client, event?) — event = gorgées ou erreur
   */
  constructor(profile, code, listener) {
    this.profile = profile;
    this.code = code;
    this.listener = listener;
    this.status = 'connecting'; // connecting | connected | reconnecting | rejected | ended | failed
    this.statusText = '';
    this.view = null;
    this.sessionUid = null;
    this.rejectReason = null;
    this.attempt = 0;
    this.terminal = false;
    this.onVisible = () => { if (document.visibilityState === 'visible') this.wake(); };
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
  }

  notify(event = null) { this.listener?.(this, event); }

  start() {
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => this.connect());
    this.peer.on('disconnected', () => { if (!this.peer.destroyed && !this.terminal) setTimeout(() => this.peer.reconnect(), 1_000); });
    this.peer.on('error', (err) => {
      this.statusText = peerErrorText(err);
      if (err.type === 'peer-unavailable') this.retryLater();
      else if (err.type === 'browser-incompatible') { this.terminal = true; this.status = 'failed'; }
      this.notify();
    });
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
    this.bacTimer = setInterval(() => this.reportBac(), 60_000);
    this.notify();
  }

  connect() {
    if (this.terminal || !this.peer || this.peer.destroyed) return;
    if (this.peer.disconnected) { this.peer.reconnect(); return; }
    this.conn?.close();
    this.status = this.attempt === 0 ? 'connecting' : 'reconnecting';
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    this.lastSeen = Date.now();
    conn.on('open', () => {
      this.lastSeen = Date.now();
      conn.send({ type: 'hello', protocol: PROTOCOL_VERSION, uid: this.profile.uid, pseudo: this.profile.pseudo });
    });
    conn.on('data', (msg) => { this.lastSeen = Date.now(); this.onMessage(msg); });
    conn.on('close', () => { if (this.conn === conn) this.retryLater(); });
    conn.on('error', () => { if (this.conn === conn) this.retryLater(); });
    // Pas de réponse en 10 s : on retente.
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => { if (this.conn === conn && !conn.open) this.retryLater(); }, 10_000);
    this.notify();
  }

  retryLater() {
    if (this.terminal) return;
    clearTimeout(this.retryTimer);
    this.attempt++;
    if (this.attempt > MAX_ATTEMPTS) { this.status = 'failed'; this.notify(); return; }
    this.status = 'reconnecting';
    this.notify();
    this.retryTimer = setTimeout(() => this.connect(), Math.min(1_000 * this.attempt, 5_000));
  }

  /** Retour sur la page (écran déverrouillé, Wi-Fi revenu) : reconnexion immédiate si besoin. */
  wake() {
    if (this.terminal) return;
    if (!this.conn?.open || Date.now() - this.lastSeen > TIMEOUT_MS) {
      this.attempt = Math.max(1, this.attempt);
      clearTimeout(this.retryTimer);
      this.connect();
    }
  }

  tick() {
    if (!this.conn?.open) return;
    if (Date.now() - this.lastSeen > TIMEOUT_MS) { this.conn.close(); this.retryLater(); return; }
    this.conn.send({ type: 'ping' });
  }

  sendMsg(msg) {
    try { if (this.conn?.open) { this.conn.send(msg); return true; } } catch { /* perdue */ }
    return false;
  }

  send(action) { this.sendMsg({ type: 'action', action }); }
  report(accusedId, kind) { this.sendMsg({ type: 'report', accusedId, kind }); }

  leave() {
    this.terminal = true;
    this.sendMsg({ type: 'leave' });
    this.destroy();
  }

  destroy() {
    clearInterval(this.heartbeat);
    clearInterval(this.bacTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.openTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    setTimeout(() => this.peer?.destroy(), 300);
  }

  onMessage(msg) {
    switch (msg?.type) {
      case 'welcome':
        this.attempt = 0;
        this.sessionUid = msg.sessionUid;
        this.status = 'connected';
        this.statusText = '';
        this.reportBac();
        break;
      case 'view': this.view = msg.view; break;
      case 'drink': {
        const isNew = this.sessionUid ? recordSips(this.profile, this.sessionUid, msg.seq, msg.sips) : true;
        this.reportBac();
        if (isNew) { this.notify({ type: 'drink', sips: msg.sips, reason: msg.reason, fromName: msg.fromName }); return; }
        break;
      }
      case 'error': this.notify({ type: 'error', error: msg.error }); return;
      case 'rejected': this.terminal = true; this.status = 'rejected'; this.rejectReason = msg.reason; this.destroy(); break;
      case 'ended': this.terminal = true; this.status = 'ended'; this.destroy(); break;
      case 'ping': this.sendMsg({ type: 'pong' }); return;
      default: return;
    }
    this.notify();
  }

  /** Alcoolémie (Widmark) partagée avec le Master si le joueur l'a autorisé. */
  reportBac() {
    const st = bacStatus(this.profile);
    if (!st) return;
    this.sendMsg(this.profile.shareBac ? { type: 'bac', bac: st.bac, level: st.level } : { type: 'bac', bac: null, level: null });
  }
}
