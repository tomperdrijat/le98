/*
 * Moteur de règles du 98 — portage JavaScript fidèle de NinetyEightEngine.kt (version Android).
 *
 * Machine à états pure (aucun accès au DOM ni au réseau) :
 *   lobby --startRound--> turn
 *   turn --play--> turn | distribute | partner | purple
 *   distribute --distribute--> turn
 *   partner --partner--> purple
 *   purple --guess*--> roundOver
 *   roundOver --startRound--> turn
 *
 * Chaque fonction reçoit un état (objet JSON) et renvoie { state, events, error }.
 * L'état d'entrée n'est jamais modifié : on travaille sur une copie profonde.
 * En cas d'action illégale, l'état d'origine est renvoyé avec un code d'erreur.
 */

export const HAND_SIZE = 4;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const TARGET_SCORE = 98;
export const KING_SCORE = 80;
export const KING_SIPS = 8;
export const LOG_CAPACITY = 80;

/* Valeurs des rangs : As = 1 … 10, Valet = 11, Dame = 12, Roi = 13, Joker = 0. */
export const JACK = 11, QUEEN = 12, KING = 13, JOKER = 0;
export const SUITS = ['H', 'D', 'C', 'S']; // cœur, carreau, trèfle, pique

export const isJoker = (c) => c.r === JOKER;
export const isRed = (c) => c.s === 'H' || c.s === 'D';
export const isNumeric = (c) => c.r >= 1 && c.r <= 10;

/* ------------------------------ Hasard ------------------------------ */

/** Générateur pseudo-aléatoire déterministe (mulberry32) : utile pour les tests. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Paquet de 54 cartes : 52 cartes + 2 Jokers, identifiants 0..53. */
export function standard54() {
  const cards = [];
  let id = 0;
  for (const s of SUITS) for (let r = 1; r <= 13; r++) cards.push({ id: id++, r, s });
  cards.push({ id: id++, r: JOKER, s: null });
  cards.push({ id: id, r: JOKER, s: null });
  return cards;
}

/* ------------------------------ État ------------------------------ */

/**
 * Options par défaut : règles de base, toutes les variantes décochées.
 *  - manualDraw false : la pioche est automatique ;
 *  - announceScore false : pas de score à annoncer ;
 *  - leavingTenCounts false : on ne boit qu'en DÉPASSANT une dizaine (88 → 92 : boit 9),
 *    jamais en la quittant (90 → 93 : rien).
 */
export function defaultOptions() {
  return { manualDraw: false, announceScore: false, generalRoundSips: 5, leavingTenCounts: false };
}

export function newGame(sessionUid, roomName, options = defaultOptions()) {
  return {
    sessionUid, roomName, seats: [], options,
    roundNumber: 0, drawPile: [], discard: [], score: 0, clockwise: true,
    currentIndex: 0, starterIndex: 0, phase: { type: 'lobby' },
    lastPlay: null, log: [], drinkSeq: 0, version: 0,
    paused: false, report: null,
  };
}

function newSeat(id, name, isBot) {
  return {
    id, name, isBot, connected: true, hand: [], handLimit: HAND_SIZE, pendingDraw: false,
    sipsDrunk: 0, sipsGiven: 0, round: roundStats(), bac: null, bacLevel: null,
  };
}

const roundStats = () => ({ cardsPlayed: 0, tensLanded: 0, kingsPlayed: 0, sipsDrunk: 0, sipsGiven: 0, purpleFails: 0 });

export const seatOf = (state, id) => state.seats.find((s) => s.id === id) || null;
export const nameOf = (state, id) => seatOf(state, id)?.name ?? '?';
export const currentSeat = (state) => state.seats[state.currentIndex] || null;
export const isFrozen = (state) => state.paused || state.report != null;
export const topCard = (state) => state.discard[state.discard.length - 1] || null;
export const purpleStep = (p) => p.revealed.length + 1;

const clone = (o) => JSON.parse(JSON.stringify(o));
const ok = (state, events = []) => ({ state, events, error: null });
const fail = (state, error) => ({ state, events: [], error });
const bump = (state) => { state.version++; return state; };

/* --------------------------- Transaction --------------------------- */

/** Copie de travail + événements produits (gorgées, fin de manche). */
class Tx {
  constructor(state, random) {
    this.s = clone(state);
    this.events = [];
    this.random = random;
  }
  seat(id) { return seatOf(this.s, id); }
  log(entry) {
    this.s.log.push(entry);
    if (this.s.log.length > LOG_CAPACITY) this.s.log = this.s.log.slice(-LOG_CAPACITY);
  }
  drink(id, sips, reason, fromName = null) {
    if (sips <= 0) return;
    const seat = this.seat(id);
    seat.sipsDrunk += sips;
    seat.round.sipsDrunk += sips;
    this.s.drinkSeq += 1;
    this.events.push({ type: 'drink', seq: this.s.drinkSeq, playerId: id, sips, reason, fromName });
  }
  /** Repioche une carte (la défausse est remélangée si la pioche est vide). */
  drawFor(id) {
    const seat = this.seat(id);
    if (!seat) return;
    if (seat.hand.length >= seat.handLimit) { seat.pendingDraw = false; return; }
    if (this.s.drawPile.length === 0 && this.s.discard.length > 1) {
      const last = this.s.discard[this.s.discard.length - 1];
      this.s.drawPile = shuffle(this.s.discard.slice(0, -1), this.random);
      this.s.discard = [last];
    }
    if (this.s.drawPile.length === 0) { seat.pendingDraw = false; return; }
    seat.hand.push(this.s.drawPile.shift());
    seat.pendingDraw = false;
  }
  /** Joueur suivant dans le sens en vigueur, en sautant ceux qui ne peuvent plus jouer. */
  advanceTurn() {
    const n = this.s.seats.length;
    const step = this.s.clockwise ? 1 : -1;
    let idx = this.s.currentIndex;
    for (let k = 0; k < n; k++) {
      idx = (((idx + step) % n) + n) % n;
      const seat = this.s.seats[idx];
      if (seat.hand.length > 0 || (seat.pendingDraw && seat.handLimit > 0)) {
        this.s.currentIndex = idx;
        this.s.phase = { type: 'turn' };
        return;
      }
    }
    // Plus personne ne peut jouer (mains vides suite aux fautes) : manche nulle.
    this.log({ event: 'NO_PLAYABLE' });
    this.endRound({ roundNumber: this.s.roundNumber, finalScore: this.s.score, purpleIds: [], savedIds: [], noLoser: true });
  }
  startPurple(participants) {
    const deck = shuffle(standard54(), this.random);
    this.log({ event: 'PURPLE_START', player: nameOf(this.s, participants[0]), other: participants[1] ? nameOf(this.s, participants[1]) : null });
    for (const seat of this.s.seats) { seat.hand = []; seat.pendingDraw = false; }
    this.s.drawPile = [];
    this.s.phase = {
      type: 'purple',
      purple: {
        participants, activeId: participants[0], saved: [], deck, deckCount: deck.length,
        revealed: [], lastCard: null, lastGuess: null, lastSuccess: null, lastPlayerId: null,
      },
    };
  }
  endRound(summary) {
    this.log({ event: 'ROUND_OVER', value: summary.roundNumber });
    this.s.phase = { type: 'roundOver', summary };
    this.events.push({ type: 'roundEnded', summary });
  }
  finish() { return ok(bump(this.s), this.events); }
}

/* ============================== Moteur ============================== */

export class Engine {
  constructor(random = Math.random) { this.random = random; }

  /* ----------------------------- Salon ----------------------------- */

  addSeat(state, id, name, isBot = false) {
    if (state.phase.type !== 'lobby') return fail(state, 'WRONG_PHASE');
    if (seatOf(state, id)) return fail(state, 'DUPLICATE_PLAYER');
    if (state.seats.length >= MAX_PLAYERS) return fail(state, 'TOO_MANY_PLAYERS');
    const s = clone(state);
    s.seats.push(newSeat(id, uniqueName(state, (name || '').trim() || 'Joueur'), isBot));
    return ok(bump(s));
  }

  removeSeat(state, id) {
    if (state.phase.type !== 'lobby') return fail(state, 'WRONG_PHASE');
    const s = clone(state);
    s.seats = s.seats.filter((x) => x.id !== id);
    return ok(bump(s));
  }

  /* ------------------------- Début de manche ------------------------- */

  /** Mélange, distribue 4 cartes, retourne la carte d'amorce. */
  startRound(state) {
    const type = state.phase.type;
    if (type !== 'lobby' && type !== 'roundOver') return fail(state, 'WRONG_PHASE');
    if (state.seats.length < MIN_PLAYERS) return fail(state, 'NOT_ENOUGH_PLAYERS');
    if (state.seats.length > MAX_PLAYERS) return fail(state, 'TOO_MANY_PLAYERS');

    const tx = new Tx(state, this.random);
    const s = tx.s;
    const firstRound = type === 'lobby';
    s.roundNumber += 1;
    // Le premier joueur est « à gauche du donneur » : le donneur tourne à chaque manche.
    const starter = firstRound ? 0 : (state.starterIndex + 1) % state.seats.length;

    const deck = shuffle(standard54(), this.random);
    for (const seat of s.seats) {
      seat.hand = deck.splice(0, HAND_SIZE);
      seat.handLimit = HAND_SIZE;
      seat.pendingDraw = false;
      seat.round = roundStats();
    }
    // Carte d'amorce : ni Valet, ni Dame, ni Joker (remise sous le paquet).
    let starterCard = deck.shift();
    while (starterCard.r === JACK || starterCard.r === QUEEN || isJoker(starterCard)) {
      deck.push(starterCard);
      starterCard = deck.shift();
    }
    const startScore = starterCard.r === KING ? KING_SCORE : starterCard.r;

    Object.assign(s, {
      drawPile: deck, discard: [starterCard], score: startScore, clockwise: true,
      currentIndex: starter, starterIndex: starter, phase: { type: 'turn' }, lastPlay: null,
    });
    tx.log({ event: 'ROUND_START', value: s.roundNumber });
    tx.log({ event: 'STARTER', card: starterCard, value: startScore });

    // Amorce Roi (80) ou 10 : tournée générale avant le premier coup.
    if (starterCard.r === KING || starterCard.r === 10) {
      const sips = Math.max(1, state.options.generalRoundSips);
      tx.log({ event: 'GENERAL_ROUND', value: sips });
      for (const seat of s.seats) tx.drink(seat.id, sips, 'GENERAL_ROUND');
    }
    return tx.finish();
  }

  /* ----------------------------- Actions ----------------------------- */

  apply(state, playerId, action) {
    if (!seatOf(state, playerId)) return fail(state, 'UNKNOWN_PLAYER');
    if (isFrozen(state)) return fail(state, 'GAME_FROZEN');
    switch (action.type) {
      case 'play': return this.play(state, playerId, action);
      case 'draw': return this.draw(state, playerId);
      case 'distribute': return this.distribute(state, playerId, action.sips || {});
      case 'partner': return this.choosePartner(state, playerId, action.partnerId);
      case 'guess': return this.purpleGuess(state, playerId, action.guess);
      default: return fail(state, 'WRONG_PHASE');
    }
  }

  /* ------------------------ Pause & arbitrage ------------------------ */

  setPaused(state, paused) {
    const type = state.phase.type;
    if (type === 'lobby' || type === 'roundOver') return fail(state, 'WRONG_PHASE');
    if (state.paused === paused) return ok(state);
    const tx = new Tx(state, this.random);
    tx.s.paused = paused;
    tx.log({ event: paused ? 'PAUSED' : 'RESUMED' });
    return tx.finish();
  }

  /** Un joueur signale une faute : la partie est figée jusqu'à l'arbitrage du Master. */
  reportFault(state, reporterId, accusedId, kind) {
    if (!seatOf(state, reporterId) || !seatOf(state, accusedId)) return fail(state, 'UNKNOWN_PLAYER');
    if (reporterId === accusedId || !FAULT_KINDS.includes(kind)) return fail(state, 'INVALID_REPORT');
    const type = state.phase.type;
    if (type === 'lobby' || type === 'roundOver') return fail(state, 'WRONG_PHASE');
    if (isFrozen(state)) return fail(state, 'GAME_FROZEN');
    const tx = new Tx(state, this.random);
    tx.s.report = { reporterId, accusedId, kind };
    tx.log({ event: 'REPORT', player: nameOf(state, reporterId), other: nameOf(state, accusedId), value: FAULT_KINDS.indexOf(kind) });
    return tx.finish();
  }

  /** Validé : l'accusé boit 1 gorgée. Rejeté : le dénonciateur boit 1 gorgée. */
  resolveReport(state, accepted) {
    const report = state.report;
    if (!report) return fail(state, 'WRONG_PHASE');
    const tx = new Tx(state, this.random);
    tx.s.report = null;
    const k = FAULT_KINDS.indexOf(report.kind);
    if (accepted) {
      tx.log({ event: 'REPORT_ACCEPTED', player: nameOf(state, report.accusedId), other: nameOf(state, report.reporterId), value: k });
      tx.drink(report.accusedId, 1, { DRAW: 'FAULT_DRAW', CALC: 'FAULT_CALC', HINT: 'FAULT_HINT' }[report.kind]);
    } else {
      tx.log({ event: 'REPORT_REJECTED', player: nameOf(state, report.reporterId), other: nameOf(state, report.accusedId), value: k });
      tx.drink(report.reporterId, 1, 'FALSE_REPORT');
    }
    return tx.finish();
  }

  /** Faute de soufflage saisie par le Master : 1 gorgée. */
  hintPenalty(state, playerId) {
    if (!seatOf(state, playerId)) return fail(state, 'UNKNOWN_PLAYER');
    if (state.phase.type === 'lobby') return fail(state, 'WRONG_PHASE');
    const tx = new Tx(state, this.random);
    tx.log({ event: 'FAULT_HINT', player: nameOf(state, playerId) });
    tx.drink(playerId, 1, 'FAULT_HINT');
    return tx.finish();
  }

  /** Remplace un joueur (ex. déconnecté) par un bot, ou l'inverse. */
  setBot(state, playerId, isBot) {
    const seat = seatOf(state, playerId);
    if (!seat) return fail(state, 'UNKNOWN_PLAYER');
    const tx = new Tx(state, this.random);
    tx.seat(playerId).isBot = isBot;
    if (isBot && seat.pendingDraw) tx.drawFor(playerId); // un bot pioche toujours immédiatement
    return tx.finish();
  }

  setConnected(state, playerId, connected) {
    const seat = seatOf(state, playerId);
    if (!seat || seat.connected === connected) return state;
    const s = clone(state);
    seatOf(s, playerId).connected = connected;
    return bump(s);
  }

  setBac(state, playerId, bac, level) {
    if (!seatOf(state, playerId)) return state;
    const s = clone(state);
    Object.assign(seatOf(s, playerId), { bac, bacLevel: level });
    return bump(s);
  }

  /* ------------------------------ Poser ------------------------------ */

  play(state, playerId, action) {
    if (state.phase.type !== 'turn') return fail(state, 'WRONG_PHASE');
    const seat = currentSeat(state);
    if (!seat) return fail(state, 'WRONG_PHASE');
    if (seat.id !== playerId) return fail(state, 'NOT_YOUR_TURN');
    const card = seat.hand.find((c) => c.id === action.cardId);
    if (!card) return fail(state, 'CARD_NOT_IN_HAND');

    const old = state.score;
    let next;
    if (isNumeric(card)) next = old + card.r;
    else if (card.r === JACK) {
      if (action.jackPlus == null) return fail(state, 'MISSING_CHOICE');
      next = action.jackPlus ? old + 10 : Math.max(0, old - 10);
    } else if (card.r === QUEEN) next = old;
    else if (card.r === KING) next = KING_SCORE;
    else {
      if (action.jokerScore == null) return fail(state, 'MISSING_CHOICE');
      if (!(action.jokerScore >= 0 && action.jokerScore <= TARGET_SCORE)) return fail(state, 'INVALID_JOKER_SCORE');
      next = action.jokerScore;
    }

    const tx = new Tx(state, this.random);
    const name = seat.name;

    // 1) Oubli de pioche : tout autre joueur qui n'a pas repioché avant ce coup est sanctionné.
    for (const forgot of state.seats.filter((x) => x.id !== playerId && x.pendingDraw)) {
      const f = tx.seat(forgot.id);
      f.pendingDraw = false;
      f.handLimit = f.hand.length;
      tx.log({ event: 'FAULT_DRAW', player: forgot.name });
      tx.drink(forgot.id, 1, 'FAULT_DRAW');
    }

    // 2) La carte quitte la main et rejoint la pile.
    const me = tx.seat(playerId);
    me.hand = me.hand.filter((c) => c.id !== card.id);
    me.round.cardsPlayed += 1;
    if (card.r === KING) me.round.kingsPlayed += 1;
    tx.s.discard.push(card);
    tx.s.score = next;
    tx.s.lastPlay = { playerId, card, oldScore: old, newScore: next };
    tx.log({ event: 'PLAY', player: name, card, value: next });

    // 3) Repioche : immédiate (mode auto ou bot), sinon le joueur doit appuyer sur « Piocher ».
    if (!state.options.manualDraw || seat.isBot) tx.drawFor(playerId);
    else me.pendingDraw = true;

    // 4) Dame : inversion du sens.
    if (card.r === QUEEN) {
      tx.s.clockwise = !tx.s.clockwise;
      tx.log({ event: 'REVERSE', player: name });
    }

    // 5) Erreur de calcul (le Joker fixe lui-même le score : pas d'annonce).
    if (state.options.announceScore && !isJoker(card) && action.announced != null && action.announced !== next) {
      tx.log({ event: 'FAULT_CALC', player: name, value: action.announced });
      tx.drink(playerId, 1, 'FAULT_CALC');
    }

    // 6) Règle des dizaines.
    const effect = tensEffect(card, old, next, state.options.leavingTenCounts);
    if (effect.crossedSips > 0) {
      tx.log({ event: 'CROSSED', player: name, value: effect.crossedSips });
      tx.drink(playerId, effect.crossedSips, 'CROSSED_TEN');
    }

    // 7) Fin de manche ?
    if (next > TARGET_SCORE) {
      tx.log({ event: 'OVER_98', player: name, value: next });
      tx.startPurple([playerId]);
      return tx.finish();
    }
    if (next === TARGET_SCORE) {
      tx.log({ event: isJoker(card) ? 'KAMIKAZE' : 'EXACT_98', player: name });
      tx.s.phase = { type: 'partner', playerId };
      return tx.finish();
    }

    // 8) Distribution (dizaine pile, Roi, Joker sur une dizaine).
    if (effect.distributeSips > 0) {
      tx.log({ event: card.r === KING ? 'KING' : 'LANDED', player: name, value: effect.distributeSips });
      tx.seat(playerId).round.tensLanded += 1;
      tx.s.phase = { type: 'distribute', playerId, sips: effect.distributeSips };
      return tx.finish();
    }

    tx.advanceTurn();
    return tx.finish();
  }

  /* ----------------------------- Piocher ----------------------------- */

  draw(state, playerId) {
    const type = state.phase.type;
    if (type === 'lobby' || type === 'roundOver' || type === 'purple') return fail(state, 'WRONG_PHASE');
    if (!seatOf(state, playerId).pendingDraw) return fail(state, 'NOTHING_TO_DRAW');
    const tx = new Tx(state, this.random);
    tx.drawFor(playerId);
    return tx.finish();
  }

  /* ---------------------------- Distribuer ---------------------------- */

  distribute(state, playerId, sips) {
    const phase = state.phase;
    if (phase.type !== 'distribute') return fail(state, 'WRONG_PHASE');
    if (phase.playerId !== playerId) return fail(state, 'NOT_YOUR_TURN');
    const entries = Object.entries(sips);
    const clean = entries.filter(([, n]) => n > 0);
    const valid = clean.every(([id]) => id !== playerId && seatOf(state, id)) &&
      entries.every(([, n]) => Number.isInteger(n) && n >= 0) &&
      clean.reduce((t, [, n]) => t + n, 0) === phase.sips;
    if (!valid) return fail(state, 'INVALID_DISTRIBUTION');

    const tx = new Tx(state, this.random);
    const giver = nameOf(state, playerId);
    for (const [target, n] of clean) {
      tx.log({ event: 'GAVE', player: giver, other: nameOf(state, target), value: n });
      tx.drink(target, n, 'GIVEN', giver);
    }
    const me = tx.seat(playerId);
    me.sipsGiven += phase.sips;
    me.round.sipsGiven += phase.sips;
    tx.s.phase = { type: 'turn' };
    tx.advanceTurn();
    return tx.finish();
  }

  /* ---------------------------- Acolyte 98 ---------------------------- */

  choosePartner(state, playerId, partnerId) {
    const phase = state.phase;
    if (phase.type !== 'partner') return fail(state, 'WRONG_PHASE');
    if (phase.playerId !== playerId) return fail(state, 'NOT_YOUR_TURN');
    if (partnerId === playerId || !seatOf(state, partnerId)) return fail(state, 'INVALID_PARTNER');
    const tx = new Tx(state, this.random);
    tx.log({ event: 'PARTNER', player: nameOf(state, playerId), other: nameOf(state, partnerId) });
    tx.startPurple([playerId, partnerId]);
    return tx.finish();
  }

  /* ------------------------------ Purple ------------------------------ */

  purpleGuess(state, playerId, guess) {
    if (state.phase.type !== 'purple') return fail(state, 'WRONG_PHASE');
    const p = state.phase.purple;
    if (p.activeId !== playerId) return fail(state, 'NOT_YOUR_TURN');
    const step = purpleStep(p);
    const expected = { 1: 'color', 2: 'compare', 3: 'interval', 4: 'suit' }[step];
    if (!guess || guess.kind !== expected) return fail(state, 'INVALID_GUESS');

    const tx = new Tx(state, this.random);
    const name = nameOf(state, playerId);
    const np = tx.s.phase.purple;

    // Tirage : les Jokers sont écartés sans incidence.
    let drawn = null;
    while (np.deck.length > 0) {
      const c = np.deck.shift();
      if (isJoker(c)) { tx.log({ event: 'PURPLE_JOKER' }); continue; }
      drawn = c;
      break;
    }

    // Paquet épuisé : la chance l'emporte, le joueur actif gagne, fin immédiate.
    if (!drawn) {
      tx.log({ event: 'PURPLE_EXHAUSTED', player: name });
      tx.endRound({
        roundNumber: state.roundNumber, finalScore: state.score, purpleIds: p.participants,
        savedIds: [...new Set([...p.saved, playerId])], exhaustionWinnerId: playerId,
      });
      return tx.finish();
    }

    const success = isGuessCorrect(guess, drawn, p.revealed);
    Object.assign(np, { deckCount: np.deck.length, lastCard: drawn, lastGuess: guess, lastSuccess: success, lastPlayerId: playerId });

    if (success) {
      tx.log({ event: 'PURPLE_SUCCESS', player: name, value: step, card: drawn, guess });
      np.revealed.push(drawn);
      if (np.revealed.length >= 4) {
        tx.log({ event: 'PURPLE_SAVED', player: name });
        np.saved.push(playerId);
        const remaining = p.participants.filter((id) => !np.saved.includes(id));
        if (remaining.length === 0) {
          tx.endRound({
            roundNumber: state.roundNumber, finalScore: state.score, purpleIds: p.participants,
            savedIds: np.saved.slice(), kamikaze: p.participants.length === 2,
          });
          return tx.finish();
        }
        np.revealed = [];
        np.activeId = remaining[0];
      }
    } else {
      tx.log({ event: 'PURPLE_FAIL', player: name, value: step, card: drawn, guess });
      tx.drink(playerId, 1, 'PURPLE_FAIL');
      tx.seat(playerId).round.purpleFails += 1;
      // Duel : la main passe à l'autre joueur s'il n'est pas encore sauvé.
      const other = p.participants.find((id) => id !== playerId && !p.saved.includes(id));
      np.revealed = [];
      np.activeId = other ?? playerId;
    }
    return tx.finish();
  }
}

export const FAULT_KINDS = ['DRAW', 'CALC', 'HINT'];

/* ------------------------- Règles pures ------------------------- */

function uniqueName(state, wanted) {
  const taken = new Set(state.seats.map((s) => s.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  let i = 2;
  while (taken.has(`${wanted} ${i}`.toLowerCase())) i++;
  return `${wanted} ${i}`;
}

const landing = (score) => (score >= 10 && score <= 90 && score % 10 === 0 ? score / 10 : 0);

/**
 * Règle des dizaines.
 *  - Dépassement (montée, cartes « normales ») : boit le chiffre de chaque dizaine franchie.
 *  - leavingCounts (défaut, exemple officiel « 80 + 9 = 89 → boit 8 ») : quitter vers le haut
 *    une dizaine sur laquelle on était compte aussi, sauf si on atterrit sur une dizaine pile.
 *  - Dizaine pile (10..90) : distribue le chiffre de la dizaine.
 *  - Roi : score à 80 et 8 gorgées à distribuer. Joker : distribue si dizaine pile. Dame : rien.
 */
export function tensEffect(card, old, next, leavingCounts = true) {
  if (card.r === QUEEN) return { crossedSips: 0, distributeSips: 0 };
  if (card.r === KING) return { crossedSips: 0, distributeSips: KING_SIPS };
  if (isJoker(card)) return { crossedSips: 0, distributeSips: landing(next) };
  let crossed = 0;
  const lands = landing(next) > 0;
  if (next > old) {
    if (leavingCounts && !lands && old % 10 === 0 && old >= 10 && old <= 90) crossed += old / 10;
    for (let t = (Math.floor(old / 10) + 1) * 10; t < next; t += 10) {
      if (t >= 10 && t <= 90) crossed += t / 10;
    }
  }
  return { crossedSips: crossed, distributeSips: landing(next) };
}

/** Évaluation des annonces du Purple (As = 1, Valet = 11, Dame = 12, Roi = 13). */
export function isGuessCorrect(guess, drawn, revealed) {
  switch (guess.kind) {
    case 'color': return isRed(drawn) === guess.red;
    case 'compare': {
      const ref = revealed[0].r;
      const actual = drawn.r > ref ? 'HIGHER' : drawn.r < ref ? 'LOWER' : 'EQUAL';
      return actual === guess.value;
    }
    case 'interval': return guess.value === intervalOf(drawn.r, revealed[0].r, revealed[1].r);
    case 'suit': return drawn.s === guess.suit;
    default: return false;
  }
}

export function intervalOf(v, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (v === lo || v === hi) return 'EQUAL';
  if (v > lo && v < hi) return 'INSIDE';
  return 'OUTSIDE';
}

/* --------------------------- Vue joueur --------------------------- */

/**
 * Ce qu'un joueur a le droit de voir : sa main et les infos publiques de la table,
 * jamais la pioche, les mains adverses ni le paquet du Purple.
 */
export function viewFor(state, playerId) {
  const me = seatOf(state, playerId);
  const phase = state.phase.type === 'purple'
    ? { type: 'purple', purple: { ...state.phase.purple, deck: [] } }
    : state.phase;
  return {
    version: state.version,
    me: playerId,
    roomName: state.roomName,
    seats: state.seats.map((s) => ({
      id: s.id, name: s.name, isBot: s.isBot, connected: s.connected, cardCount: s.hand.length,
      pendingDraw: s.pendingDraw, sipsDrunk: s.sipsDrunk, bacLevel: s.bacLevel,
    })),
    myHand: me ? me.hand : [],
    myHandLimit: me ? me.handLimit : 0,
    myPendingDraw: me ? me.pendingDraw : false,
    score: state.score,
    topCard: topCard(state),
    clockwise: state.clockwise,
    currentPlayerId: state.phase.type === 'turn' ? currentSeat(state)?.id ?? null : null,
    roundNumber: state.roundNumber,
    drawPileCount: state.drawPile.length,
    phase,
    options: state.options,
    lastPlay: state.lastPlay,
    log: state.log.slice(-12),
    paused: state.paused,
    report: state.report,
  };
}
