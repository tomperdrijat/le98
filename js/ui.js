/*
 * Briques d'interface partagées par le Master et le téléphone : textes, cartes, pastilles,
 * anneau de score, cartes d'événement, fenêtres. Tout est produit en HTML (chaînes) ;
 * les clics sont captés par délégation via l'attribut data-act (voir app.js).
 */
import { JACK, QUEEN, KING, JOKER, isRed, isJoker, TARGET_SCORE } from './engine.js';

/* ------------------------------ Outils ------------------------------ */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);

export const PLAYER_COLORS = ['#7072f0', '#4c9bf5', '#f5a524', '#ec5f9c', '#27c2b0', '#2ed47a', '#a77bf3', '#f25c5c'];
export const playerColor = (i) => PLAYER_COLORS[((i % 8) + 8) % 8];

export const sips = (n) => `${n} gorgée${n > 1 ? 's' : ''}`;
export const sipsWord = (n) => (n > 1 ? 'gorgées' : 'gorgée');

/* ------------------------------ Cartes ------------------------------ */

const SUIT_SYMBOL = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME = { H: 'cœur', D: 'carreau', C: 'trèfle', S: 'pique' };
export const rankLabel = (r) => ({ 1: 'A', [JACK]: 'V', [QUEEN]: 'D', [KING]: 'R', [JOKER]: '★' })[r] ?? String(r);
const RANK_NAME = { 1: 'As', [JACK]: 'Valet', [QUEEN]: 'Dame', [KING]: 'Roi' };
export const cardShort = (c) => (isJoker(c) ? 'Joker' : `${rankLabel(c.r)}${SUIT_SYMBOL[c.s]}`);
export const cardLong = (c) => (isJoker(c) ? 'le Joker' : `${c.r === 1 ? "l'" : 'le '}${RANK_NAME[c.r] ?? c.r} de ${SUIT_NAME[c.s]}`);
export { SUIT_SYMBOL, SUIT_NAME };

/** Carte dessinée en HTML/CSS. opts : { w, back, sel, locked, act, arg, style } */
export function card(c, opts = {}) {
  const w = opts.w ?? 70;
  const cls = ['pcard'];
  const attrs = `style="--w:${w}px;${opts.style ?? ''}"${opts.act ? ` data-act="${opts.act}" data-arg="${esc(opts.arg)}"` : ''}`;
  if (!c || opts.back) return `<div class="pcard back" ${attrs}><span>98</span></div>`;
  if (opts.sel) cls.push('sel');
  if (opts.locked) cls.push('locked');
  if (isJoker(c)) {
    return `<div class="${cls.join(' ')} joker" ${attrs}><span class="jk t">JOKER</span><span class="pip">★</span><span class="jk b">JOKER</span></div>`;
  }
  if (isRed(c)) cls.push('red');
  const idx = `${rankLabel(c.r)}<small>${SUIT_SYMBOL[c.s]}</small>`;
  return `<div class="${cls.join(' ')}" ${attrs}><span class="idx tl">${idx}</span><span class="pip">${SUIT_SYMBOL[c.s]}</span><span class="idx br">${idx}</span></div>`;
}

export const deck = (w) => `<div class="deck" style="--w:${w}px">${card(null, { w })}${card(null, { w })}${card(null, { w })}</div>`;

/** Main en éventail : les cartes se chevauchent et pivotent ; la carte choisie remonte. */
export function fan(cards, selectedId, enabled, maxWidth) {
  const n = Math.max(1, cards.length);
  const w = Math.min(110, Math.floor(maxWidth / (0.7 * n + 0.6)));
  const step = w * 0.72;
  const total = step * (n - 1) + w;
  const center = (n - 1) / 2;
  const items = cards.map((c, i) => {
    const angle = (i - center) * 7;
    const lift = c.id === selectedId ? -26 : Math.abs(i - center) * 6;
    const style = `left:${step * i}px;transform:translateY(${lift}px) rotate(${angle}deg);z-index:${c.id === selectedId ? 20 : i}`;
    return card(c, { w, sel: c.id === selectedId, locked: !enabled, act: enabled ? 'pick' : null, arg: c.id, style });
  });
  return `<div class="fan" style="--w:${w}px;width:${total}px">${items.join('')}</div>`;
}

/* ------------------------------ Joueurs ------------------------------ */

export const avatar = (name, i, size = 30) =>
  `<span class="avatar" style="--c:${playerColor(i)};--s:${size}px">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;

export const tag = (text, color = 'var(--green)') => `<span class="tag" style="--c:${color}">${text}</span>`;
export const statusDot = (text, color) => `<span class="row tiny" style="gap:6px;color:${color}"><span class="dot" style="--c:${color}"></span>${text}</span>`;

const BAC = {
  OK: ['Sous la limite', 'var(--green)'], OVER_LIMIT: ['Au-dessus de la limite : ne conduis pas', 'var(--amber)'],
  OFFENCE: ['Délit routier (≥ 0,8 g/L)', 'var(--red)'], DANGER: ['Danger : intoxication sévère', '#a77bf3'],
};
export const bacText = (level) => (BAC[level] ?? BAC.OK)[0];
export const bacColor = (level) => (BAC[level] ?? BAC.OK)[1];
export const bacBadge = (level, bac = null) =>
  `<span class="tag" style="--c:${bacColor(level)}"><span class="dot" style="--c:${bacColor(level)}"></span>${bac != null ? `${bac.toFixed(2).replace('.', ',')} g/L` : bacText(level)}</span>`;

/* ------------------------------- Score ------------------------------- */

export const scoreColor = (s) => (s >= 90 ? 'var(--red)' : s >= 80 ? 'var(--amber)' : 'var(--green)');

/** Anneau de score : l'arc se remplit vers 98 et passe du vert à l'ambre puis au rouge. */
export function scoreRing(score, size, caption = '') {
  const r = 47, len = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / TARGET_SCORE));
  return `<div class="ring" style="--size:${size}px">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--border)" stroke-width="2.2"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="2.2" stroke-linecap="round"
      stroke-dasharray="${len * frac} ${len}"/></svg>
    <div><div class="val">${score}</div>${caption ? `<div class="cap">${caption}</div>` : ''}</div></div>`;
}

/* ----------------------------- Textes ----------------------------- */

export const FAULT_TEXT = { DRAW: 'Oubli de pioche', CALC: 'Erreur de calcul', HINT: 'Soufflage' };

export const REASON_TEXT = {
  GENERAL_ROUND: 'Tournée générale', CROSSED_TEN: 'Dépassement de dizaine', GIVEN: 'Distribution',
  FAULT_DRAW: 'Oubli de pioche', FAULT_CALC: 'Erreur de calcul', FAULT_HINT: 'Soufflage',
  PURPLE_FAIL: 'Échec au Purple', FALSE_REPORT: 'Signalement abusif',
};

export const ERROR_TEXT = {
  WRONG_PHASE: 'Action impossible à ce moment de la partie.', NOT_YOUR_TURN: "Ce n'est pas ton tour.",
  UNKNOWN_PLAYER: 'Joueur inconnu.', CARD_NOT_IN_HAND: "Cette carte n'est plus dans ta main.",
  MISSING_CHOICE: 'Choisis une option pour cette carte.', INVALID_JOKER_SCORE: 'Le Joker doit fixer un score entre 0 et 98.',
  INVALID_DISTRIBUTION: 'Distribution invalide.', INVALID_PARTNER: 'Acolyte invalide.', INVALID_GUESS: 'Annonce invalide pour cette étape.',
  NOTHING_TO_DRAW: 'Rien à piocher.', NOT_ENOUGH_PLAYERS: 'Il faut au moins 3 joueurs.', TOO_MANY_PLAYERS: '8 joueurs maximum.',
  DUPLICATE_PLAYER: 'Ce joueur est déjà à la table.', GAME_FROZEN: 'La partie est en pause ou en arbitrage.', INVALID_REPORT: 'Signalement impossible.',
};

export const REJECT_TEXT = {
  PROTOCOL: "Version de l'appli différente de celle du Master : recharge la page.",
  GAME_IN_PROGRESS: 'Une partie est déjà en cours à cette table.', ROOM_FULL: 'La table est complète (8 joueurs).',
  KICKED: 'Le Master t\'a retiré de la table.',
};

/** Phrase du journal à partir d'une entrée du moteur. */
export function logText(e) {
  const p = esc(e.player ?? ''), o = esc(e.other ?? ''), v = e.value ?? 0, c = e.card ? cardShort(e.card) : '';
  switch (e.event) {
    case 'ROUND_START': return `— Manche ${v} —`;
    case 'STARTER': return `Carte d'amorce : ${c}, score de départ ${v}`;
    case 'GENERAL_ROUND': return `Tournée générale ! Tout le monde boit ${sips(v)}`;
    case 'PLAY': return `${p} pose ${c} → ${v}`;
    case 'REVERSE': return 'Dame : le sens s\'inverse';
    case 'CROSSED': return `${p} franchit une dizaine et boit ${v}`;
    case 'LANDED': return `${p} tombe sur une dizaine pile et distribue ${v}`;
    case 'KING': return `Roi ! ${p} ramène le score à 80 et distribue ${v}`;
    case 'GAVE': return `${p} donne ${v} à ${o}`;
    case 'FAULT_DRAW': return `${p} a oublié de piocher : 1 gorgée et main réduite`;
    case 'FAULT_CALC': return `${p} a annoncé ${v} : erreur de calcul, 1 gorgée`;
    case 'FAULT_HINT': return `${p} a soufflé : 1 gorgée`;
    case 'KAMIKAZE': return `Joker kamikaze de ${p} : 98 pile !`;
    case 'OVER_98': return `${p} dépasse 98 (${v}) : direction le Purple`;
    case 'EXACT_98': return `${p} atteint 98 pile !`;
    case 'PARTNER': return `${p} embarque ${o} dans le Purple`;
    case 'PURPLE_START': return e.other ? `Purple en duel : ${p} et ${o}` : `Le Purple commence pour ${p}`;
    case 'PURPLE_SUCCESS': return `${p} réussit l'étape ${v} (${c})`;
    case 'PURPLE_FAIL': return `${p} échoue à l'étape ${v} (${c}) : 1 gorgée, retour à l'étape 1`;
    case 'PURPLE_JOKER': return 'Joker tiré : écarté sans incidence';
    case 'PURPLE_SAVED': return `${p} est sauvé !`;
    case 'PURPLE_EXHAUSTED': return `Paquet épuisé : ${p} est déclaré vainqueur`;
    case 'ROUND_OVER': return `Fin de la manche ${v}`;
    case 'NO_PLAYABLE': return 'Plus aucun joueur ne peut jouer';
    case 'PAUSED': return 'Partie mise en pause';
    case 'RESUMED': return 'La partie reprend';
    case 'REPORT': return `${p} signale une faute de ${o}`;
    case 'REPORT_ACCEPTED': return `Faute validée : ${p} boit 1 gorgée`;
    case 'REPORT_REJECTED': return `Signalement rejeté : ${p} boit 1 gorgée`;
    default: return '';
  }
}

/* ------------------------- Cartes d'événement ------------------------- */

const EVENT_STYLE = {
  CROSSED: ['💧', 'var(--amber)', 'Dizaine franchie'], LANDED: ['💧', 'var(--green)', 'Dizaine pile'],
  KING: ['★', 'var(--green)', 'Roi'], REVERSE: ['↻', 'var(--blue)', 'Dame'], GENERAL_ROUND: ['★', 'var(--amber)', 'Tournée générale !'],
  FAULT_DRAW: ['⚠', 'var(--red)', 'Faute'], FAULT_CALC: ['⚠', 'var(--red)', 'Faute'], FAULT_HINT: ['⚠', 'var(--red)', 'Faute'],
  KAMIKAZE: ['⚠', 'var(--red)', 'Kamikaze'], EXACT_98: ['★', 'var(--red)', '98 pile !'], OVER_98: ['⚠', 'var(--red)', 'Dépassement de 98'],
  REPORT_ACCEPTED: ['✓', 'var(--green)', 'Faute validée'], REPORT_REJECTED: ['✕', 'var(--amber)', 'Signalement rejeté'],
};
const PRIORITY = ['REPORT_ACCEPTED', 'REPORT_REJECTED', 'EXACT_98', 'KAMIKAZE', 'OVER_98', 'GENERAL_ROUND', 'KING', 'LANDED', 'CROSSED', 'REVERSE', 'FAULT_DRAW', 'FAULT_CALC', 'FAULT_HINT'];

/** Entrées ajoutées à la fin du journal depuis prev (le journal est tronqué par le début). */
function newEntries(prev, now) {
  if (!prev || prev.length === 0) return now;
  const last = JSON.stringify(prev[prev.length - 1]);
  for (let i = now.length - 1; i >= 0; i--) if (JSON.stringify(now[i]) === last) return now.slice(i + 1);
  return now.slice(-1);
}

const TOAST_MS = 3_000;
const TOAST_QUEUE_MAX = 3;

/**
 * Suit le journal et affiche les événements marquants l'un après l'autre (3 s chacun).
 * Quand les coups s'enchaînent vite (bots), les cartes font la queue au lieu de se remplacer ;
 * au-delà de 3 en attente, les plus anciennes sont abandonnées pour ne pas prendre de retard.
 */
export class EventToaster {
  constructor() { this.prev = null; this.timer = null; this.queue = []; this.showing = false; }
  reset() { this.prev = null; this.queue = []; }
  update(log) {
    const prev = this.prev;
    this.prev = log;
    if (prev == null) return; // les entrées présentes à l'ouverture ne sont pas rejouées
    const fresh = newEntries(prev, log).filter((e) => EVENT_STYLE[e.event]);
    if (fresh.length === 0) return;
    fresh.sort((a, b) => PRIORITY.indexOf(a.event) - PRIORITY.indexOf(b.event));
    this.queue.push(fresh[0]);
    if (this.queue.length > TOAST_QUEUE_MAX) this.queue.splice(0, this.queue.length - TOAST_QUEUE_MAX);
    if (!this.showing) this.next();
  }
  next() {
    const box = document.getElementById('toasts');
    const entry = this.queue.shift();
    if (!entry) { this.showing = false; box.innerHTML = ''; return; }
    this.showing = true;
    const [icon, color, title] = EVENT_STYLE[entry.event];
    box.innerHTML = `<div class="toast" style="--c:${color}"><div class="badge" style="--c:${color}">${icon}</div>
      <div><h3>${title}</h3><div class="muted small">${logText(entry)}</div></div></div>`;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), TOAST_MS);
  }
}

/* -------------------------- Tirage du Purple -------------------------- */

export const REVEAL_MS = 3_000;
const GUESS_TEXT = {
  HIGHER: 'Plus grand', LOWER: 'Plus petit', EQUAL: 'Égal', INSIDE: 'Intérieur', OUTSIDE: 'Extérieur',
};

/** Annonce du Purple en toutes lettres : « Rouge », « Plus grand », « ♥ Cœur »… */
export function guessText(g) {
  if (!g) return '';
  if (g.kind === 'color') return g.red ? 'Rouge' : 'Noir';
  if (g.kind === 'suit') return `${SUIT_SYMBOL[g.suit]} ${SUIT_NAME[g.suit].replace(/^./, (c) => c.toUpperCase())}`;
  return GUESS_TEXT[g.value] ?? '';
}

/**
 * Montre en grand, pendant 3 s, chaque carte tirée au Purple : qui a annoncé quoi,
 * la carte sortie et le verdict. Sans ça, un échec renvoie aussitôt à l'étape 1
 * et on ne comprend pas pourquoi on a perdu.
 */
export class PurpleReveal {
  constructor() { this.prev = null; this.queue = []; this.timer = null; this.showing = false; }
  update(log) {
    const prev = this.prev;
    this.prev = log;
    if (prev == null) return;
    for (const e of newEntries(prev, log)) {
      if (e.event === 'PURPLE_SUCCESS' || e.event === 'PURPLE_FAIL') this.queue.push(e);
    }
    if (!this.showing) this.next();
  }
  next() {
    const box = document.getElementById('reveal');
    const e = this.queue.shift();
    if (!e) { this.showing = false; box.innerHTML = ''; return; }
    this.showing = true;
    const ok = e.event === 'PURPLE_SUCCESS';
    const color = ok ? 'var(--green)' : 'var(--red)';
    box.innerHTML = `<div class="overlay reveal"><div class="col center" style="gap:12px;align-items:center">
      <div class="muted">${esc(e.player)} · étape ${e.value}/4</div>
      <h2>Annonce : ${guessText(e.guess)}</h2>
      ${card(e.card, { w: 150, style: 'margin:6px auto' })}
      <div class="tag" style="--c:${color};font-size:22px;padding:6px 18px">${ok ? '✓ Réussi !' : '✕ Raté : 1 gorgée'}</div>
      ${ok ? '' : '<div class="small muted">Retour à l\'étape 1</div>'}
    </div></div>`;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), REVEAL_MS);
  }
  clear() { clearTimeout(this.timer); this.queue = []; this.showing = false; const box = document.getElementById('reveal'); if (box) box.innerHTML = ''; }
}

/* ----------------------------- Fenêtres ----------------------------- */

let snackTimer = null;
export function snack(text) {
  const el = document.getElementById('snack');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.add('hidden'), 3_500);
}

/**
 * Calque de fenêtre géré à part de l'écran principal : il n'est redessiné que si sa clé change
 * (ou sur demande), ce qui préserve la saisie en cours (ex. score annoncé).
 */
export const modal = {
  key: null,
  /** raw = contenu plein écran déjà mis en forme (ex. tournée générale), sans boîte de dialogue. */
  show(key, html, { raw = false } = {}) {
    const root = document.getElementById('modal');
    if (this.key === key && root.firstChild) return;
    this.key = key;
    root.innerHTML = raw ? html : `<div class="modal-back" data-act="__modal-back"><div class="modal">${html}</div></div>`;
    root.querySelector('input')?.focus();
  },
  /** Redessine le contenu de la fenêtre courante (compteurs, choix) sans changer de clé. */
  refresh(html) {
    const box = document.querySelector('#modal .modal');
    if (box) box.innerHTML = html;
  },
  hide(key = null) {
    if (key && this.key !== key) return;
    this.key = null;
    document.getElementById('modal').innerHTML = '';
  },
};

export function stepper(value, min, max, act) {
  return `<div class="stepper"><button data-act="${act}" data-arg="-1" ${value <= min ? 'disabled' : ''}>−</button>
    <b>${value}</b><button class="plus" data-act="${act}" data-arg="1" ${value >= max ? 'disabled' : ''}>+</button></div>`;
}

export const toggle = (checked, act) =>
  `<label class="switch"><input type="checkbox" data-act="${act}" ${checked ? 'checked' : ''}><span></span></label>`;
