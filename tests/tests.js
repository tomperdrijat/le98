/*
 * Tests du moteur web — portage des tests JUnit de l'appli Android
 * (NinetyEightEngineTest, PauseAndReportTest, BotSimulationTest, WidmarkTest).
 * Ouvrir tests/index.html dans le navigateur (via un serveur local) pour les lancer.
 */
import {
  Engine, newGame, seededRandom, tensEffect, intervalOf, seatOf, defaultOptions,
  JACK, QUEEN, KING, JOKER,
} from '../js/engine.js';
import { BotBrain } from '../js/bot.js';
import * as W from '../js/widmark.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} attendu ${b}, obtenu ${a}`);
}
function close(actual, expected, tol, what = '') {
  if (Math.abs(actual - expected) > tol) throw new Error(`${what} attendu ≈${expected}, obtenu ${actual}`);
}
function yes(cond, what = 'condition') { if (!cond) throw new Error(`${what} fausse`); }

/* --------------------------- Aides --------------------------- */

const engine = new Engine(seededRandom(42));
let nextId = 100;
const c = (r, s = 'S') => ({ id: nextId++, r, s: r === JOKER ? null : s });
const NAMES = ['Alice', 'Bob', 'Clara', 'David'];

/** État « en cours de tour » construit à la main pour des tests déterministes. */
function state(score, hands, { current = 0, options = { ...defaultOptions(), manualDraw: false, announceScore: true }, pile } = {}) {
  const s = newGame('test', 'Test', options);
  s.seats = hands.map((h, i) => ({
    id: `p${i}`, name: NAMES[i], isBot: false, connected: true, hand: h, handLimit: 4, pendingDraw: false,
    sipsDrunk: 0, sipsGiven: 0, bac: null, bacLevel: null,
    round: { cardsPlayed: 0, tensLanded: 0, kingsPlayed: 0, sipsDrunk: 0, sipsGiven: 0, purpleFails: 0 },
  }));
  Object.assign(s, {
    roundNumber: 1, drawPile: pile ?? Array.from({ length: 20 }, () => c(2, 'H')),
    discard: [c(7, 'H')], score, currentIndex: current, phase: { type: 'turn' },
  });
  return s;
}
const drinks = (o) => o.events.filter((e) => e.type === 'drink');
const play = (cardId, extra = {}) => ({ type: 'play', cardId, ...extra });
const purpleState = (base, participants, deck) => ({
  ...base,
  phase: { type: 'purple', purple: { participants, activeId: participants[0], saved: [], deck, deckCount: deck.length, revealed: [], lastCard: null, lastGuess: null, lastSuccess: null, lastPlayerId: null } },
});
const guess = (g) => ({ type: 'guess', guess: g });

/* ======================= Règles du 98 ======================= */

test('dépassement de dizaine : 28 + 5 boit 3', () => {
  const five = c(5);
  const o = engine.apply(state(28, [[five], [c(2)], [c(2)]]), 'p0', play(five.id, { announced: 33 }));
  eq(o.error, null); eq(o.state.score, 33);
  const d = drinks(o); eq(d.length, 1); eq(d[0].playerId, 'p0'); eq(d[0].sips, 3); eq(d[0].reason, 'CROSSED_TEN');
  eq(o.state.currentIndex, 1);
});

test('exemple du livret : 7 + 8 boit 1, puis 15 + 5 distribue 2', () => {
  const eight = c(8), five = c(5, 'D');
  const s = state(7, [[eight], [five], [c(3)], [c(3)]]);
  const o1 = engine.apply(s, 'p0', play(eight.id, { announced: 15 }));
  eq(o1.state.score, 15); eq(drinks(o1)[0].sips, 1);
  const o2 = engine.apply(o1.state, 'p1', play(five.id, { announced: 20 }));
  eq(o2.state.score, 20); eq(o2.state.phase, { type: 'distribute', playerId: 'p1', sips: 2 });
  const o3 = engine.apply(o2.state, 'p1', { type: 'distribute', sips: { p0: 1, p3: 1 } });
  eq(o3.error, null); eq(drinks(o3).length, 2);
  yes(drinks(o3).every((d) => d.reason === 'GIVEN' && d.fromName === 'Bob'), 'gorgées données par Bob');
  eq(o3.state.currentIndex, 2); eq(seatOf(o3.state, 'p1').sipsGiven, 2);
});

test('distribution invalide refusée', () => {
  const five = c(5);
  const o = engine.apply(state(15, [[five], [c(2)], [c(2)]]), 'p0', play(five.id, { announced: 20 }));
  eq(engine.apply(o.state, 'p0', { type: 'distribute', sips: { p1: 3 } }).error, 'INVALID_DISTRIBUTION');
  eq(engine.apply(o.state, 'p0', { type: 'distribute', sips: { p0: 2 } }).error, 'INVALID_DISTRIBUTION');
  eq(engine.apply(o.state, 'p1', { type: 'distribute', sips: { p0: 2 } }).error, 'NOT_YOUR_TURN');
});

test('la Dame inverse le sens et garde le score', () => {
  const queen = c(QUEEN, 'C');
  const o = engine.apply(state(20, [[c(2)], [c(2)], [queen], [c(2)]], { current: 2 }), 'p2', play(queen.id, { announced: 20 }));
  eq(o.state.score, 20); eq(o.state.clockwise, false); eq(o.state.currentIndex, 1);
  eq(drinks(o).length, 0); eq(o.state.phase, { type: 'turn' });
});

test('Valet −10 en redescendant ne fait pas boire', () => {
  const jack = c(JACK);
  const o = engine.apply(state(89, [[jack], [c(2)], [c(2)]]), 'p0', play(jack.id, { jackPlus: false, announced: 79 }));
  eq(o.state.score, 79); eq(drinks(o).length, 0);
});

test('Valet sans choix refusé', () => {
  const jack = c(JACK);
  eq(engine.apply(state(20, [[jack], [c(2)], [c(2)]]), 'p0', play(jack.id)).error, 'MISSING_CHOICE');
});

test('Valet −10 ne descend pas sous zéro', () => {
  const jack = c(JACK);
  eq(engine.apply(state(4, [[jack], [c(2)], [c(2)]]), 'p0', play(jack.id, { jackPlus: false, announced: 0 })).state.score, 0);
});

test('Roi : score à 80 et distribue 8, même en redescendant', () => {
  const king = c(KING, 'D');
  const o = engine.apply(state(95, [[king], [c(2)], [c(2)]]), 'p0', play(king.id, { announced: 80 }));
  eq(o.state.score, 80); eq(o.state.phase, { type: 'distribute', playerId: 'p0', sips: 8 }); eq(drinks(o).length, 0);
});

test('80 + 9 boit 8', () => {
  const nine = c(9);
  eq(drinks(engine.apply(state(80, [[nine], [c(2)], [c(2)]]), 'p0', play(nine.id, { announced: 89 })))[0].sips, 8);
});

test('Joker sur une dizaine : distribue sans pénalité', () => {
  const joker = c(JOKER);
  const o = engine.apply(state(12, [[joker], [c(2)], [c(2)]]), 'p0', play(joker.id, { jokerScore: 70 }));
  eq(o.state.score, 70); eq(o.state.phase, { type: 'distribute', playerId: 'p0', sips: 7 }); eq(drinks(o).length, 0);
});

test('Joker : score invalide', () => {
  const joker = c(JOKER);
  eq(engine.apply(state(12, [[joker], [c(2)], [c(2)]]), 'p0', play(joker.id, { jokerScore: 99 })).error, 'INVALID_JOKER_SCORE');
});

test('Joker kamikaze 98, choix de l\'acolyte, Purple en duel', () => {
  const joker = c(JOKER);
  const o = engine.apply(state(79, [[c(2)], [joker], [c(2)], [c(2)]], { current: 1 }), 'p1', play(joker.id, { jokerScore: 98 }));
  eq(o.state.phase, { type: 'partner', playerId: 'p1' }); eq(o.state.log.at(-1).event, 'KAMIKAZE');
  eq(engine.apply(o.state, 'p1', { type: 'partner', partnerId: 'p1' }).error, 'INVALID_PARTNER');
  const o2 = engine.apply(o.state, 'p1', { type: 'partner', partnerId: 'p3' });
  const p = o2.state.phase.purple;
  eq(p.participants, ['p1', 'p3']); eq(p.activeId, 'p1'); eq(p.deck.length, 54);
  yes(o2.state.seats.every((x) => x.hand.length === 0), 'mains vidées');
});

test('dépasser 98 envoie seul au Purple et boit la dizaine 90', () => {
  const ten = c(10);
  const o = engine.apply(state(89, [[ten], [c(2)], [c(2)]]), 'p0', play(ten.id, { announced: 99 }));
  eq(o.state.phase.purple.participants, ['p0']); eq(drinks(o)[0].sips, 9);
});

test('erreur de calcul : 1 gorgée, score rectifié', () => {
  const three = c(3);
  const o = engine.apply(state(41, [[three], [c(2)], [c(2)]]), 'p0', play(three.id, { announced: 45 }));
  eq(o.state.score, 44); eq(drinks(o).length, 1); eq(drinks(o)[0].reason, 'FAULT_CALC');
});

test('oubli de pioche : gorgée et main réduite', () => {
  const opts = { ...defaultOptions(), manualDraw: true, announceScore: false };
  const a = c(2), b = c(3);
  const s = state(1, [[a, c(4), c(4), c(4)], [b, c(4), c(4), c(4)], [c(2)]], { options: opts });
  const o1 = engine.apply(s, 'p0', play(a.id));
  yes(seatOf(o1.state, 'p0').pendingDraw, 'pioche en attente'); eq(seatOf(o1.state, 'p0').hand.length, 3);
  const o2 = engine.apply(o1.state, 'p1', play(b.id));
  const alice = seatOf(o2.state, 'p0');
  eq(alice.pendingDraw, false); eq(alice.handLimit, 3);
  eq(drinks(o2).find((d) => d.playerId === 'p0').reason, 'FAULT_DRAW');
  const o3 = engine.apply(o2.state, 'p1', { type: 'draw' });
  eq(seatOf(o3.state, 'p1').hand.length, 4);
  eq(engine.apply(o3.state, 'p0', { type: 'draw' }).error, 'NOTHING_TO_DRAW');
});

test('pas son tour', () => {
  const two = c(2);
  eq(engine.apply(state(10, [[c(2)], [two], [c(2)]]), 'p1', play(two.id)).error, 'NOT_YOUR_TURN');
});

test('démarrage de manche : 4 cartes, amorce valide, 54 cartes conservées (200 graines)', () => {
  for (let seed = 0; seed < 200; seed++) {
    const eng = new Engine(seededRandom(seed));
    let s = newGame('x', 'x');
    for (const id of ['a', 'b', 'c']) s = eng.addSeat(s, id, id.toUpperCase()).state;
    const o = eng.startRound(s);
    eq(o.error, null);
    const st = o.state;
    yes(st.seats.every((x) => x.hand.length === 4), 'mains de 4');
    eq(st.discard.length, 1);
    const starter = st.discard[0];
    yes(![JACK, QUEEN, JOKER].includes(starter.r), 'amorce valide');
    const all = [...st.seats.flatMap((x) => x.hand), ...st.drawPile, ...st.discard];
    eq(all.length, 54); eq(new Set(all.map((x) => x.id)).size, 54);
    if (starter.r === KING) { eq(st.score, 80); eq(drinks(o).length, 3); }
    else if (starter.r === 10) { eq(st.score, 10); yes(drinks(o).every((d) => d.reason === 'GENERAL_ROUND'), 'tournée'); }
    else { eq(st.score, starter.r); eq(drinks(o).length, 0); }
  }
});

test('pas assez de joueurs', () => {
  let s = newGame('x', 'x');
  s = engine.addSeat(s, 'a', 'A').state;
  s = engine.addSeat(s, 'b', 'B').state;
  eq(engine.startRound(s).error, 'NOT_ENOUGH_PLAYERS');
});

test('noms en double rendus uniques', () => {
  let s = newGame('x', 'x');
  s = engine.addSeat(s, 'a', 'Tom').state;
  s = engine.addSeat(s, 'b', 'tom').state;
  eq(seatOf(s, 'b').name, 'tom 2');
  eq(engine.addSeat(s, 'a', 'Autre').error, 'DUPLICATE_PLAYER');
});

test('soufflage : pénalité manuelle', () => {
  const o = engine.hintPenalty(state(10, [[c(2)], [c(2)], [c(2)]]), 'p2');
  eq(drinks(o)[0].reason, 'FAULT_HINT'); eq(seatOf(o.state, 'p2').sipsDrunk, 1);
});

test('séquences de gorgées strictement croissantes', () => {
  const five = c(5);
  const o = engine.apply(state(28, [[five], [c(2)], [c(2)]]), 'p0', play(five.id, { announced: 34 }));
  eq(drinks(o).map((d) => d.seq), [1, 2]); eq(o.state.drinkSeq, 2);
});

test('quitter une dizaine : option stricte', () => {
  const nine = c(9);
  const strict = { ...defaultOptions(), manualDraw: false, leavingTenCounts: false };
  eq(drinks(engine.apply(state(80, [[nine], [c(2)], [c(2)]], { options: strict }), 'p0', play(nine.id, { announced: 89 }))).length, 0);
});

test('tensEffect', () => {
  eq(tensEffect(c(5), 30, 35).crossedSips, 3);
  eq(tensEffect(c(5), 30, 35, false).crossedSips, 0);
  eq(tensEffect(c(10), 20, 30).crossedSips, 0);
  eq(tensEffect(c(10), 20, 30).distributeSips, 3);
  eq(tensEffect(c(5), 28, 33).crossedSips, 3);
  eq(tensEffect(c(10), 35, 45).crossedSips, 4);
  eq(tensEffect(c(10), 40, 50).distributeSips, 5);
  eq(tensEffect(c(10), 40, 50).crossedSips, 0);
  eq(tensEffect(c(JACK), 50, 40).crossedSips, 0);
  eq(tensEffect(c(JACK), 50, 40).distributeSips, 4);
});

test('Purple solo complet', () => {
  const deck = [{ id: 1, r: JOKER, s: null }, { id: 2, r: 10, s: 'H' }, { id: 3, r: 10, s: 'D' }, { id: 4, r: KING, s: 'C' }, { id: 5, r: 4, s: 'H' }];
  let s = purpleState(state(99, [[], [], []]), ['p0'], deck);
  s = engine.apply(s, 'p0', guess({ kind: 'color', red: true })).state;
  eq(s.phase.purple.revealed.length + 1, 2);
  s = engine.apply(s, 'p0', guess({ kind: 'compare', value: 'EQUAL' })).state;
  s = engine.apply(s, 'p0', guess({ kind: 'interval', value: 'OUTSIDE' })).state;
  const o = engine.apply(s, 'p0', guess({ kind: 'suit', suit: 'H' }));
  eq(o.state.phase.type, 'roundOver'); eq(o.state.phase.summary.savedIds, ['p0']);
  eq(o.state.phase.summary.exhaustionWinnerId ?? null, null);
});

test('Purple : mauvaise étape refusée', () => {
  const s = purpleState(state(99, [[], [], []]), ['p0'], [{ id: 2, r: 10, s: 'H' }]);
  eq(engine.apply(s, 'p0', guess({ kind: 'suit', suit: 'H' })).error, 'INVALID_GUESS');
  eq(engine.apply(s, 'p1', guess({ kind: 'color', red: true })).error, 'NOT_YOUR_TURN');
});

test('Purple duel : l\'échec passe la main, égalité ratée, épuisement', () => {
  const deck = [{ id: 1, r: KING, s: 'S' }, { id: 2, r: 3, s: 'D' }, { id: 3, r: 1, s: 'C' }, { id: 4, r: 10, s: 'H' }, { id: 5, r: 10, s: 'C' }];
  let s = purpleState(state(98, [[], [], [], []]), ['p1', 'p3'], deck);
  s = engine.apply(s, 'p1', guess({ kind: 'color', red: false })).state;
  s = engine.apply(s, 'p1', guess({ kind: 'compare', value: 'LOWER' })).state;
  const failed = engine.apply(s, 'p1', guess({ kind: 'interval', value: 'INSIDE' }));
  eq(drinks(failed)[0].reason, 'PURPLE_FAIL');
  s = failed.state;
  eq(s.phase.purple.activeId, 'p3'); eq(s.phase.purple.revealed.length, 0);
  s = engine.apply(s, 'p3', guess({ kind: 'color', red: true })).state;
  const failed2 = engine.apply(s, 'p3', guess({ kind: 'compare', value: 'HIGHER' }));
  eq(drinks(failed2).length, 1);
  s = failed2.state;
  eq(s.phase.purple.activeId, 'p1'); eq(s.phase.purple.deckCount, 0);
  const end = engine.apply(s, 'p1', guess({ kind: 'color', red: true }));
  eq(end.state.phase.summary.exhaustionWinnerId, 'p1'); eq(drinks(end).length, 0);
  eq(end.events.filter((e) => e.type === 'roundEnded').length, 1);
});

test('Purple duel : le premier sauvé, l\'autre continue seul', () => {
  const deck = [{ id: 1, r: 7, s: 'C' }, { id: 2, r: JACK, s: 'S' }, { id: 3, r: 9, s: 'H' }, { id: 4, r: 4, s: 'H' }, { id: 5, r: 2, s: 'H' }];
  let s = purpleState(state(98, [[], [], [], []]), ['p1', 'p3'], deck);
  s = engine.apply(s, 'p1', guess({ kind: 'color', red: false })).state;
  s = engine.apply(s, 'p1', guess({ kind: 'compare', value: 'HIGHER' })).state;
  s = engine.apply(s, 'p1', guess({ kind: 'interval', value: 'INSIDE' })).state;
  s = engine.apply(s, 'p1', guess({ kind: 'suit', suit: 'H' })).state;
  eq(s.phase.purple.saved, ['p1']); eq(s.phase.purple.activeId, 'p3');
  s = engine.apply(s, 'p3', guess({ kind: 'color', red: true })).state;
  eq(s.phase.purple.activeId, 'p3'); eq(s.phase.purple.revealed.length + 1, 2);
});

test('intervalle', () => {
  eq(intervalOf(1, 3, 13), 'OUTSIDE'); eq(intervalOf(9, 7, 11), 'INSIDE'); eq(intervalOf(7, 7, 11), 'EQUAL');
  eq(intervalOf(13, 10, 10), 'OUTSIDE'); eq(intervalOf(10, 10, 10), 'EQUAL');
});

/* ======================= Pause & signalement ======================= */

const pauseState = () => state(40, [[c(2), c(3)], [c(2), c(3)], [c(2), c(3)]]);

test('en pause aucune carte ne peut être posée, puis reprise', () => {
  const paused = engine.setPaused(pauseState(), true);
  eq(paused.state.paused, true); eq(paused.state.log.at(-1).event, 'PAUSED');
  const card = paused.state.seats[0].hand[0];
  eq(engine.apply(paused.state, 'p0', play(card.id, { announced: 42 })).error, 'GAME_FROZEN');
  const resumed = engine.setPaused(paused.state, false);
  eq(resumed.state.paused, false);
  eq(engine.apply(resumed.state, 'p0', play(card.id, { announced: 42 })).error, null);
});

test('pas de pause dans le salon', () => {
  eq(engine.setPaused({ ...pauseState(), phase: { type: 'lobby' } }, true).error, 'WRONG_PHASE');
});

test('signalement validé : l\'accusé boit 1 gorgée', () => {
  const r = engine.reportFault(pauseState(), 'p0', 'p1', 'DRAW');
  eq(r.state.report, { reporterId: 'p0', accusedId: 'p1', kind: 'DRAW' }); eq(drinks(r).length, 0);
  const ruled = engine.resolveReport(r.state, true);
  eq(ruled.state.report, null);
  eq(drinks(ruled).map((d) => [d.playerId, d.sips, d.reason]), [['p1', 1, 'FAULT_DRAW']]);
  eq(ruled.state.log.at(-1).event, 'REPORT_ACCEPTED');
});

test('signalement rejeté : le dénonciateur boit', () => {
  const r = engine.reportFault(pauseState(), 'p2', 'p0', 'CALC').state;
  const ruled = engine.resolveReport(r, false);
  eq(drinks(ruled).map((d) => [d.playerId, d.reason]), [['p2', 'FALSE_REPORT']]);
  eq(ruled.state.log.at(-1).event, 'REPORT_REJECTED');
});

test('signalements invalides', () => {
  const s = pauseState();
  eq(engine.reportFault(s, 'p0', 'p0', 'HINT').error, 'INVALID_REPORT');
  eq(engine.reportFault(s, 'p0', 'inconnu', 'HINT').error, 'UNKNOWN_PLAYER');
  const pending = engine.reportFault(s, 'p0', 'p1', 'HINT').state;
  eq(engine.reportFault(pending, 'p2', 'p1', 'DRAW').error, 'GAME_FROZEN');
  eq(engine.resolveReport(s, true).error, 'WRONG_PHASE');
});

/* ======================= Simulation de bots ======================= */

test('des centaines de manches jouées par des bots se terminent sans erreur', () => {
  for (let seed = 0; seed < 150; seed++) {
    for (let players = 3; players <= 8; players++) {
      const random = seededRandom(seed * 31 + players);
      const eng = new Engine(random);
      const brain = new BotBrain(random);
      let s = newGame('sim', 'sim', { ...defaultOptions(), manualDraw: seed % 2 === 0 });
      for (let i = 0; i < players; i++) s = eng.addSeat(s, `b${i}`, `Bot ${i}`, true).state;
      for (let round = 0; round < 3; round++) {
        const start = eng.startRound(s);
        if (start.error) throw new Error(`startRound ${start.error} seed=${seed}`);
        s = start.state;
        let steps = 0;
        while (s.phase.type !== 'roundOver') {
          if (['turn', 'distribute', 'partner'].includes(s.phase.type)) {
            const all = [...s.seats.flatMap((x) => x.hand), ...s.drawPile, ...s.discard];
            if (all.length !== 54 || new Set(all.map((x) => x.id)).size !== 54) throw new Error(`cartes perdues seed=${seed}`);
          }
          let actor = null, action = null;
          for (const seat of s.seats) { action = brain.decide(s, seat.id); if (action) { actor = seat.id; break; } }
          if (!actor) throw new Error(`blocage seed=${seed} joueurs=${players} phase=${s.phase.type}`);
          const o = eng.apply(s, actor, action);
          if (o.error) throw new Error(`action refusée ${o.error} seed=${seed} ${JSON.stringify(action)}`);
          s = o.state;
          if (++steps > 5000) throw new Error(`manche infinie seed=${seed}`);
        }
        eq(s.phase.summary.roundNumber, round + 1, 'numéro de manche');
      }
    }
  }
});

/* ============================ Widmark ============================ */

const HOUR = 3_600_000;
const man70 = { weightKg: 70, sex: 'MALE' };

test('Widmark : 25 cl de bière à 5 % = 9,86 g', () => {
  close(W.gramsOf(250, 5), 9.8625, 1e-4);
  close(W.gramsForSips(10, 20, 5), W.gramsOf(200, 5), 1e-9);
});
test('Widmark : verre standard, homme 70 kg', () => close(W.bacAt([{ t: 0, grams: 10 }], man70, 0), 10 / (0.7 * 70), 1e-9));
test('Widmark : élimination 0,15 g/L/h', () => {
  const peak = 40 / (0.7 * 70);
  close(W.bacAt([{ t: 0, grams: 40 }], man70, HOUR), peak - 0.15, 1e-9);
  close(W.bacAt([{ t: 0, grams: 40 }], man70, 10 * HOUR), 0, 1e-9);
});
test('Widmark : prises successives et futures', () => {
  close(W.bacAt([{ t: 0, grams: 10 }, { t: 5 * HOUR, grams: 10 }], { weightKg: 60, sex: 'FEMALE' }, 5 * HOUR), 10 / (0.6 * 60), 1e-9);
  close(W.bacAt([{ t: HOUR, grams: 10 }], man70, 0), 0, 1e-9);
});
test('Widmark : temps avant le seuil et niveaux', () => {
  eq(W.msUntilBelow(0.8, 0.5, man70), 2 * HOUR + 60_000);
  eq(W.msUntilBelow(0.3, 0.5, man70), 0);
  eq([W.level(0.1, 0.2), W.level(0.25, 0.2), W.level(0.5, 0.5), W.level(0.8, 0.5), W.level(2.1, 0.5)], ['OK', 'OVER_LIMIT', 'OVER_LIMIT', 'OFFENCE', 'DANGER']);
});

/* ============================ Rapport ============================ */

const failed = results.filter((r) => !r.ok);
const out = document.getElementById('out');
out.innerHTML = `<h1>${failed.length === 0 ? '✅' : '❌'} ${results.length - failed.length} / ${results.length} tests réussis</h1>` +
  results.map((r) => `<div class="${r.ok ? 'ok' : 'ko'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ` — ${r.msg}`}</div>`).join('');
document.title = `${results.length - failed.length}/${results.length} tests`;
window.testResults = { total: results.length, failed: failed.map((r) => `${r.name}: ${r.msg}`) };
