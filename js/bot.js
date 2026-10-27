/*
 * IA des joueurs virtuels — portage de BotBrain.kt.
 * Heuristique : éviter de dépasser 98, éviter de franchir des dizaines,
 * viser les dizaines pile, garder Joker et Roi comme cartes de secours.
 */
import {
  JACK, JOKER, KING, KING_SCORE, QUEEN, SUITS, TARGET_SCORE,
  currentSeat, isJoker, purpleStep, seatOf, tensEffect,
} from './engine.js';

export class BotBrain {
  constructor(random = Math.random) { this.random = random; }

  pick(list) { return list[Math.floor(this.random() * list.length)]; }

  /** Action que le bot doit faire maintenant, ou null s'il n'a rien à faire. */
  decide(state, botId) {
    const me = seatOf(state, botId);
    if (!me) return null;
    const phase = state.phase;
    const mustDraw = me.pendingDraw && me.hand.length < me.handLimit;
    switch (phase.type) {
      case 'turn':
        if (mustDraw) return { type: 'draw' };
        if (currentSeat(state)?.id === botId && me.hand.length > 0) return this.choosePlay(state, me);
        return null;
      case 'distribute':
        if (mustDraw) return { type: 'draw' };
        if (phase.playerId === botId) return this.distribute(state, botId, phase.sips);
        return null;
      case 'partner':
        if (phase.playerId !== botId) return null;
        return { type: 'partner', partnerId: this.pick(state.seats.filter((s) => s.id !== botId)).id };
      case 'purple':
        return phase.purple.activeId === botId ? { type: 'guess', guess: this.purpleGuess(phase.purple) } : null;
      default:
        return null;
    }
  }

  choosePlay(state, me) {
    const old = state.score;
    const leaving = state.options.leavingTenCounts;
    const options = [];
    for (const card of me.hand) {
      if (card.r === JACK) {
        options.push(this.evaluate(card, old, old + 10, leaving, { jackPlus: true }));
        options.push(this.evaluate(card, old, Math.max(0, old - 10), leaving, { jackPlus: false }));
      } else if (card.r === JOKER) {
        // Le Joker sert surtout à redescendre : on teste les dizaines basses.
        for (const target of [10, 20, 30, 40, 50]) options.push(this.evaluate(card, old, target, leaving, { jokerScore: target }));
      } else if (card.r === QUEEN) options.push(this.evaluate(card, old, old, leaving));
      else if (card.r === KING) options.push(this.evaluate(card, old, KING_SCORE, leaving));
      else options.push(this.evaluate(card, old, old + card.r, leaving));
    }
    let best = null, bestCost = Infinity;
    for (const o of options) {
      const c = o.cost + this.random() * 0.5;
      if (c < bestCost) { bestCost = c; best = o.action; }
    }
    return best;
  }

  evaluate(card, old, next, leavingCounts, extra = {}) {
    const effect = tensEffect(card, old, next, leavingCounts);
    let cost = 0;
    if (next > TARGET_SCORE) cost += 1000;
    if (next === TARGET_SCORE) cost += 400;
    cost += effect.crossedSips * 3;
    cost -= effect.distributeSips * 1.5;
    cost += next / 25; // rester loin de 98 est plus confortable
    if (card.r === JOKER) cost += 40; // carte de secours
    else if (card.r === KING) cost += old >= 80 ? 2 : 12;
    else if (card.r === QUEEN) cost += 4;
    const action = {
      type: 'play', cardId: card.id, jackPlus: extra.jackPlus ?? null, jokerScore: extra.jokerScore ?? null,
      announced: isJoker(card) ? null : next,
    };
    return { action, cost };
  }

  distribute(state, botId, sips) {
    const others = state.seats.filter((s) => s.id !== botId).map((s) => s.id);
    const map = {};
    for (let i = 0; i < sips; i++) {
      const t = this.pick(others);
      map[t] = (map[t] || 0) + 1;
    }
    return { type: 'distribute', sips: map };
  }

  purpleGuess(p) {
    switch (purpleStep(p)) {
      case 1: return { kind: 'color', red: this.random() < 0.5 };
      case 2: {
        const v = p.revealed[0].r;
        const value = v < 7 ? 'HIGHER' : v > 7 ? 'LOWER' : (this.random() < 0.5 ? 'HIGHER' : 'LOWER');
        return { kind: 'compare', value };
      }
      case 3: {
        const lo = Math.min(p.revealed[0].r, p.revealed[1].r), hi = Math.max(p.revealed[0].r, p.revealed[1].r);
        const inside = Math.max(0, hi - lo - 1), outside = (lo - 1) + (13 - hi);
        return { kind: 'interval', value: inside > outside ? 'INSIDE' : 'OUTSIDE' };
      }
      default: return { kind: 'suit', suit: this.pick(SUITS) };
    }
  }
}
