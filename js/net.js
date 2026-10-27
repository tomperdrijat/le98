/*
 * Connexion directe navigateur ↔ navigateur (WebRTC) avec PeerJS.
 *
 *  - Le serveur PeerJS public et gratuit sert uniquement à la mise en relation (« signalisation ») :
 *    il ne voit pas passer les données de jeu.
 *  - Une fois la connexion établie, Master et téléphones se parlent en direct (DataChannel).
 *  - Les serveurs STUN publics de Google aident à traverser les box Internet.
 *
 * Le Master s'enregistre sous l'identifiant « app98-<CODE> » ; les joueurs s'y connectent.
 */

/* global Peer */

export const PEER_PREFIX = 'app98-';
export const HEARTBEAT_MS = 5_000;
export const TIMEOUT_MS = 20_000;
export const PROTOCOL_VERSION = 1;

/*
 * Serveurs ICE. Pour les réseaux très fermés (certains réseaux mobiles), on peut ajouter ici
 * un serveur TURN (ex. compte gratuit chez un fournisseur TURN) : { urls, username, credential }.
 */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export const peerOptions = () => ({ debug: 1, config: { iceServers: ICE_SERVERS } });

/** Code de table lisible (sans 0/O ni 1/I) : 5 caractères. */
export function newTableCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export const normalizeCode = (code) => (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/** Lien d'invitation : la page actuelle avec ?t=CODE (marche en local comme sur GitHub Pages). */
export function joinUrl(code) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('t', code);
  return url.toString();
}

/** Texte d'erreur PeerJS compréhensible. */
export function peerErrorText(err) {
  switch (err?.type) {
    case 'browser-incompatible': return 'Ce navigateur ne gère pas les connexions directes (WebRTC). Essaie Safari ou Chrome à jour.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'Connexion au service de mise en relation impossible. Vérifie Internet.';
    case 'peer-unavailable': return 'Table introuvable : vérifie le code, ou que l\'écran du Master est bien ouvert.';
    case 'unavailable-id': return 'Ce code de table est encore réservé, nouvel essai…';
    default: return `Erreur de connexion (${err?.type || err?.message || 'inconnue'}).`;
  }
}
