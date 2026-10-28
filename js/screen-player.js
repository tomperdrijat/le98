/*
 * Écran du joueur (téléphone) : connexion, main en éventail, Valet / Joker / annonce,
 * distribution, Purple, « Tu bois », pause, signalement de faute.
 */
import { Client } from './client.js';
import { JACK, QUEEN, KING, TARGET_SCORE, isJoker, purpleStep, FAULT_KINDS } from './engine.js';
import { bacStatus, loadProfile } from './store.js';
import {
  esc, avatar, card, fan, tag, bacBadge, bacText, bacColor, sips, sipsWord, cardLong, SUIT_SYMBOL,
  EventToaster, PurpleReveal, snack, stepper, ERROR_TEXT, REJECT_TEXT, REASON_TEXT, FAULT_TEXT,
} from './ui.js';

/* ------------------- Purple (partagé avec le Master) ------------------- */

const STEP_TITLE = { 1: 'Rouge ou noir ?', 2: 'Plus grand, plus petit ou égal à la 1re carte ?', 3: 'À l\'intérieur, à l\'extérieur ou égal aux bornes ?', 4: 'Quelle enseigne ?' };

export function purpleBoard(p, nameOf, w) {
  const step = purpleStep(p);
  const cards = [0, 1, 2, 3].map((i) => card(p.revealed[i] ?? null, { w, back: i >= p.revealed.length })).join('');
  const last = p.lastCard && p.lastPlayerId
    ? `<div class="row" style="justify-content:center"><span class="small">Tirage de ${esc(nameOf(p.lastPlayerId))} :</span>${card(p.lastCard, { w: Math.round(w * 0.6) })}
       <b style="color:${p.lastSuccess ? 'var(--green)' : 'var(--red)'}">${p.lastSuccess ? 'Réussi !' : 'Raté, 1 gorgée'}</b></div>` : '';
  return `<div class="col" style="align-items:center;gap:8px">
    <h2>${esc(nameOf(p.activeId))} · étape ${step}/4</h2>
    <div style="color:var(--green);font-weight:600">${STEP_TITLE[step]}</div>
    <div class="row" style="gap:${Math.round(w * 0.12)}px">${cards}</div>${last}
    <div class="tiny muted">Paquet : ${p.deckCount} cartes</div>
    ${p.saved.length ? `<div style="color:var(--green)">Sauvé : ${p.saved.map((id) => esc(nameOf(id))).join(', ')}</div>` : ''}
  </div>`;
}

export function purpleButtons(p, act) {
  const b = (label, guess, cls = '') => `<button class="btn ${cls}" style="min-width:110px" data-act="${act}" data-arg='${JSON.stringify(guess)}'>${label}</button>`;
  switch (purpleStep(p)) {
    case 1: return `<div class="row wrap" style="justify-content:center">${b('Rouge', { kind: 'color', red: true }, 'red')}${b('Noir', { kind: 'color', red: false })}</div>`;
    case 2: return `<div class="row wrap" style="justify-content:center">${['HIGHER', 'EQUAL', 'LOWER'].map((v) => b({ HIGHER: 'Plus grand', EQUAL: 'Égal', LOWER: 'Plus petit' }[v], { kind: 'compare', value: v })).join('')}</div>`;
    case 3: return `<div class="row wrap" style="justify-content:center">${['INSIDE', 'EQUAL', 'OUTSIDE'].map((v) => b({ INSIDE: 'Intérieur', EQUAL: 'Égal', OUTSIDE: 'Extérieur' }[v], { kind: 'interval', value: v })).join('')}</div>`;
    default: return `<div class="row wrap" style="justify-content:center">${['H', 'D', 'C', 'S'].map((s) => b(`${SUIT_SYMBOL[s]} ${{ H: 'Cœur', D: 'Carreau', C: 'Trèfle', S: 'Pique' }[s]}`, { kind: 'suit', suit: s }, s === 'H' || s === 'D' ? 'red' : '')).join('')}</div>`;
  }
}

/** Score obtenu par une carte « simple » (aperçu sur le bouton) ; null si un choix est nécessaire. */
function simpleResult(c, score) {
  if (c.r >= 1 && c.r <= 10) return score + c.r;
  if (c.r === QUEEN) return score;
  if (c.r === KING) return 80;
  return null;
}

const BAC_ORDER = ['OK', 'OVER_LIMIT', 'OFFENCE', 'DANGER'];

/* ============================== Écran ============================== */

export function playerScreen(nav, code) {
  const profile = loadProfile();
  const toaster = new EventToaster();
  const reveal = new PurpleReveal();
  const notices = []; // gorgées à afficher (« Tu bois »), une fenêtre à la fois
  let noticeCounter = 0;
  let selected = null; // id de la carte choisie
  let pending = null; // coup en préparation { card, jackPlus, jokerScore, stage }
  let jokerValue = 50;
  let given = {}; // distribution en cours
  let givenKey = null;
  let reporting = null; // { accused, kind }
  let confirmLeave = false;
  let bacAlert = null;
  let alerted = 'OK';

  const client = new Client(profile, code, (c, event) => {
    if (event?.type === 'drink') {
      notices.push({ ...event, nid: ++noticeCounter }); // id unique : deux « 2 gorgées » s'affichent l'une après l'autre
      if (navigator.vibrate) navigator.vibrate(300);
    } else if (event?.type === 'error') snack(ERROR_TEXT[event.error] ?? event.error);
    const v = c.view;
    if (v) {
      toaster.update(v.log);
      reveal.update(v.log);
      // La carte choisie disparaît si elle n'est plus jouable.
      const myTurn = v.phase.type === 'turn' && v.currentPlayerId === v.me;
      if (!myTurn || !v.myHand.some((x) => x.id === selected)) selected = null;
      if (pending && (!myTurn || !v.myHand.some((x) => x.id === pending.card.id))) pending = null;
    }
    // Alerte de prévention quand l'alcoolémie franchit un seuil.
    const st = bacStatus(profile);
    if (st && BAC_ORDER.indexOf(st.level) > BAC_ORDER.indexOf(alerted)) bacAlert = st;
    if (st) alerted = st.level;
    nav.refresh();
  });
  client.start();

  const nameOf = (v, id) => v.seats.find((x) => x.id === id)?.name ?? '?';
  const indexOf = (v, id) => v.seats.findIndex((x) => x.id === id);

  /* ------------------------------ États ------------------------------ */

  function ended(text) {
    return `<div class="screen"><div class="narrow col center" style="padding-top:30vh;gap:18px">
      <h2>${text}</h2><button class="btn primary block" data-act="home">Retour à l'accueil</button></div></div>`;
  }

  function connecting() {
    const txt = client.status === 'reconnecting' ? 'Connexion perdue, reconnexion…' : `Connexion à la table ${esc(code)}…`;
    return `<div class="screen"><div class="narrow col center" style="padding-top:30vh;gap:14px">
      <div class="indeterminate" style="margin:0 auto"></div><h3>${txt}</h3>
      ${client.statusText ? `<div class="small muted">${esc(client.statusText)}</div>` : ''}
      <button class="btn ghost" data-act="home">Annuler</button></div></div>`;
  }

  function lobby(v) {
    return `<div class="screen"><div class="narrow col" style="align-items:center;gap:10px;padding-top:6vh">
      <div class="round-badge">✓</div><h1>Connecté</h1><div class="muted">Table « ${esc(v.roomName)} »</div>
      <div class="panel" style="width:100%;margin-top:14px"><div class="row"><div class="label grow">Joueurs à la table</div><span class="tiny muted">${v.seats.length} / 8</span></div>
        ${v.seats.map((s, i) => `<div class="row" style="padding:6px 0">${avatar(s.name, i, 26)}<b class="grow">${esc(s.name)}</b>
          <span class="tiny muted">${s.id === v.me ? 'toi' : s.isBot ? 'bot' : ''}</span></div>`).join('')}</div>
      <div class="small muted row" style="margin-top:10px">En attente du lancement <span class="indeterminate" style="width:40px"></span></div>
      <button class="btn block" style="margin-top:20px" data-act="leave">Quitter la table</button></div></div>`;
  }

  function statusPill(v, myTurn) {
    const p = v.phase;
    const me = nameOf(v, v.me);
    if (myTurn) return `<span class="pill green"><span class="dot"></span>C'est ton tour, ${esc(me)}</span>`;
    const who = p.type === 'distribute' || p.type === 'partner' ? p.playerId : v.currentPlayerId;
    if (!who) return '';
    const i = indexOf(v, who);
    const label = p.type === 'distribute' ? (who === v.me ? `Tu distribues ${sips(p.sips)}` : `${esc(nameOf(v, who))} distribue ${sips(p.sips)}`)
      : p.type === 'partner' ? `${esc(nameOf(v, who))} choisit son acolyte` : `Au tour de ${esc(nameOf(v, who))}`;
    return `<span class="pill">${i >= 0 ? avatar(nameOf(v, who), i, 20) : ''}${label}</span>`;
  }

  function board(v) {
    const p = v.phase;
    const myTurn = p.type === 'turn' && v.currentPlayerId === v.me;
    const me = v.seats.find((s) => s.id === v.me);
    const st = bacStatus(profile);
    let mid;
    if (p.type === 'purple') {
      mid = `${purpleBoard(p.purple, (id) => nameOf(v, id), 58)}
        ${p.purple.activeId === v.me ? purpleButtons(p.purple, 'guess') : `<div class="muted">${esc(nameOf(v, p.purple.activeId))} joue le Purple</div>`}`;
    } else {
      mid = `<div class="small muted">Score actuel</div><div class="big-score">${v.score}</div>
        <div class="small muted">${v.clockwise ? '↻ Sens horaire' : '↺ Sens anti-horaire'}</div>
        <div style="margin-top:12px">${statusPill(v, myTurn)}</div>
        <div class="tiny faint">${myTurn ? 'Touche une carte pour la choisir' : '🔒 Tes cartes sont verrouillées'}</div>
        ${p.type === 'roundOver' ? '<div class="muted center" style="margin-top:14px">Manche terminée. En attente du Master…</div>' : ''}`;
    }
    const inHand = ['turn', 'distribute', 'partner'].includes(p.type);
    const sel = selected != null ? v.myHand.find((x) => x.id === selected) : null;
    let bottom = '';
    if (inHand) {
      if (sel && myTurn) {
        const preview = v.options.announceScore ? null : simpleResult(sel, v.score);
        bottom += `<button class="btn primary block" data-act="play">Poser ${cardLong(sel)}${preview != null ? ` <span style="opacity:.6">${v.score} → ${preview}</span>` : ''}</button>`;
      }
      if (v.myPendingDraw && v.myHand.length < v.myHandLimit) bottom += '<button class="btn amber block" data-act="draw">🂠 Piocher</button>';
      if (v.myHandLimit < 4) bottom += `<div class="tiny center" style="color:var(--red)">Main réduite à ${v.myHandLimit} cartes (oubli de pioche)</div>`;
      bottom += fan(v.myHand, selected, myTurn, Math.min(innerWidth - 32, 520));
    }
    if (p.type !== 'roundOver' && v.seats.length > 1) bottom += '<button class="btn danger small block" data-act="report">⚑ Signaler une faute</button>';

    return `<div class="player">
      <div class="player-top"><button class="icon-btn" data-act="leave">‹</button><span class="pill">Manche ${v.roundNumber}</span>
        <span class="grow"></span>${st ? bacBadge(st.level, st.bac) : ''}<span class="pill"><span style="color:var(--blue)">💧</span>${me?.sipsDrunk ?? 0}</span></div>
      ${client.status !== 'connected' ? `<div style="margin-top:8px">${tag('Connexion perdue, reconnexion automatique…', 'var(--red)')}</div>` : ''}
      <div class="player-mid">${mid}</div>
      <div class="player-bottom">${bottom}</div>
    </div>${frozen(v)}`;
  }

  function frozen(v) {
    if (v.report) {
      const r = v.report;
      const rn = nameOf(v, r.reporterId), an = nameOf(v, r.accusedId);
      return `<div class="overlay"><div class="col center" style="gap:10px">
        <div>${tag('⏸ Jeu figé', 'var(--amber)')}</div>
        <div class="row" style="justify-content:center;gap:12px">${avatar(rn, indexOf(v, r.reporterId), 40)}<span style="color:var(--amber);font-size:20px">⚑</span>${avatar(an, indexOf(v, r.accusedId), 40)}</div>
        <h2>${esc(rn)} accuse ${esc(an)}</h2><div class="muted">${FAULT_TEXT[r.kind]}</div>
        <b style="margin-top:14px">Le Master décide…</b><div class="indeterminate" style="--c:var(--amber);margin:0 auto;width:140px"></div></div></div>`;
    }
    if (v.paused) {
      return `<div class="overlay"><div class="col center" style="gap:8px"><div class="badge">⏸</div><h1>Partie en pause</h1>
        <div class="muted">Le Master a mis la partie en pause.</div><div class="tiny faint">🔒 Ta main reste en place</div></div></div>`;
    }
    return '';
  }

  /* ------------------------------ Fenêtres ------------------------------ */

  function drinkModal(n, v) {
    const canDraw = v && v.myPendingDraw && v.myHand.length < v.myHandLimit;
    const drawBtn = canDraw ? '<button class="btn amber block" data-act="drinkDraw">🂠 Piocher</button>' : '';
    if (n.reason === 'GENERAL_ROUND') {
      return { key: `drink-${n.nid}`, raw: true, html: `<div class="full-amber">
        <div class="round-badge" style="--c:#231600;color:var(--amber)">★</div><h1 style="font-size:36px">Tournée générale !</h1>
        <h3>Tout le monde boit !</h3><div>${sips(n.sips)}</div>
        <button class="btn block" style="max-width:420px;margin-top:30px;background:#231600;color:var(--amber);border:0" data-act="drinkOk">OK</button></div>` };
    }
    const from = n.fromName;
    const i = v ? v.seats.findIndex((s) => s.name === from) : -1;
    const color = from ? 'var(--blue)' : 'var(--amber)';
    return { key: `drink-${n.nid}-${canDraw ? 'd' : ''}`, html: `<div class="col center" style="gap:6px">
      ${from ? `${avatar(from, Math.max(0, i), 36)}<div class="muted">${esc(from)} te donne</div>` : `<div>${tag(REASON_TEXT[n.reason] ?? '', 'var(--amber)')}</div><div class="muted">Tu bois</div>`}
      <div style="font-size:76px;font-weight:800;line-height:1;color:${color}">${n.sips}</div><b>${sipsWord(n.sips)}</b>
      <div class="drops">${'💧'.repeat(Math.min(10, n.sips))}</div>
      <button class="btn primary block" style="margin-top:12px" data-act="drinkOk">${from ? 'OK, je bois' : 'OK'}</button>${drawBtn}</div>` };
  }

  function playModal(v) {
    const c = pending.card;
    if (c.r === JACK && pending.jackPlus == null) {
      const show = !v.options.announceScore;
      return { key: `jack-${c.id}`, html: `<div class="col center" style="gap:10px">${card(c, { w: 72, style: 'margin:0 auto;transform:rotate(-6deg)' })}
        <h2>Valet</h2><div class="small muted">Choisis ton effet</div>
        <div class="jack-tiles"><button style="background:var(--green)" data-act="jack" data-arg="1">↑<br>+10${show ? `<div class="tiny">${v.score} → ${v.score + 10}</div>` : ''}</button>
          <button style="background:var(--blue)" data-act="jack" data-arg="0">↓<br>−10${show ? `<div class="tiny">${v.score} → ${Math.max(0, v.score - 10)}</div>` : ''}</button></div>
        <button class="btn block small" data-act="cancelPlay">Annuler</button></div>` };
    }
    if (isJoker(c) && pending.jokerScore == null) {
      if (pending.stage === 'kamikaze') {
        return { key: `kamikaze-${c.id}`, html: `<div class="col center" style="gap:10px"><div class="badge" style="--c:var(--red)">⚠</div><h2>Kamikaze ?</h2>
          <p class="muted">Le score passe à 98. La manche s'arrête. Tu pars au Purple avec un acolyte de ton choix.</p>
          <div class="row"><button class="btn grow" data-act="jokerBack">Non</button><button class="btn red grow" data-act="kamikaze">Oui, kamikaze</button></div></div>` };
      }
      return { key: `joker-${c.id}`, live: true, html: `<div class="col center" style="gap:10px">${card(c, { w: 64, style: 'margin:0 auto;transform:rotate(-6deg)' })}<h2>Joker</h2>
        <button class="btn red block" style="flex-direction:column;min-height:62px" data-act="kamikazeAsk">⚠ Kamikaze (98 pile)<span class="tiny" style="opacity:.85">Fin de manche immédiate. Tu pars au Purple avec un acolyte.</span></button>
        <div class="small muted">ou fixe un score libre</div>
        <div class="row" style="justify-content:center">${stepper(jokerValue, 0, TARGET_SCORE - 1, 'jokerStep')}</div>
        <div style="font-size:54px;font-weight:800">${jokerValue}</div>
        <div class="quick"><button data-act="jokerAdd" data-arg="-10">−10</button><button data-act="jokerAdd" data-arg="10">+10</button>
          <button data-act="jokerSet" data-arg="50">50</button><button data-act="jokerSet" data-arg="70">70</button></div>
        <div class="tiny faint">Sur une dizaine pile, tu distribues ; 98 = kamikaze.</div>
        <button class="btn primary block" data-act="jokerOk">Fixer le score à ${jokerValue}</button>
        <button class="btn block small" data-act="cancelPlay">Annuler</button></div>` };
    }
    // Annonce du score : le joueur calcule lui-même (erreur = 1 gorgée).
    return { key: `announce-${c.id}-${pending.jackPlus}`, html: `<form class="col center" style="gap:10px" data-submit="announce">${card(c, { w: 72, style: 'margin:0 auto' })}
      <h2>Annonce le score</h2><input class="field center" id="announce" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="Nouveau score" style="font-size:28px;font-weight:700" autocomplete="off">
      <button class="btn primary block" type="submit">Valider</button><button class="btn block small" type="button" data-act="cancelPlay">Annuler</button></form>` };
  }

  function distributeModal(v, total) {
    const left = total - Object.values(given).reduce((a, b) => a + b, 0);
    const rows = v.seats.map((s, i) => (s.id === v.me ? '' : `<div class="player-row">${avatar(s.name, i)}<div class="grow"><div class="name">${esc(s.name)}</div>
      <div class="drops">${'💧'.repeat(given[s.id] || 0)}</div></div>${stepper(given[s.id] || 0, 0, (given[s.id] || 0) + Math.max(0, left), `give:${s.id}`)}</div>`)).join('');
    return { key: `distribute-${givenKey}`, live: true, html: `<div class="col" style="gap:10px">
      <div>${tag(`Dizaine pile : ${v.score}`, 'var(--amber)')}</div><h2>Distribue tes gorgées</h2>
      <div class="panel row" style="background:rgba(46,212,122,.06);border-color:rgba(46,212,122,.4)">
        <b style="font-size:30px;color:var(--green)">${total - left}</b><span style="color:var(--green)">/${total}</span>
        <div><b>gorgées réparties</b><div class="tiny muted">Reste à donner : ${left}</div></div></div>
      ${rows}<button class="btn primary block" data-act="giveOk" ${left !== 0 ? 'disabled' : ''}>✓ Valider la distribution</button></div>` };
  }

  function partnerModal(v) {
    return { key: 'partner', html: `<div class="col" style="gap:10px"><div>${tag('98 pile !', 'var(--red)')}</div><h2>Choisis ton acolyte pour le Purple</h2>
      ${v.seats.map((s, i) => (s.id === v.me ? '' : `<button class="player-row" style="cursor:pointer;color:inherit" data-act="partner" data-arg="${esc(s.id)}">${avatar(s.name, i)}<b class="grow" style="text-align:left">${esc(s.name)}</b></button>`)).join('')}</div>` };
  }

  function reportModal(v) {
    const line = (label, on, act, arg, extra = '') => `<div class="radio-line ${on ? 'on' : ''}" data-act="${act}" data-arg="${esc(arg)}"><i></i><b class="grow">${label}</b>${extra}</div>`;
    return { key: 'report', live: true, html: `<div class="col" style="gap:8px"><h2>Signaler une faute</h2>
      <div class="label">Qui a fait une faute ?</div>
      ${v.seats.map((s, i) => (s.id === v.me ? '' : line(esc(s.name), reporting.accused === s.id, 'repWho', s.id, avatar(s.name, i, 22)))).join('')}
      <div class="label" style="margin-top:8px">Motif</div>
      ${FAULT_KINDS.map((k) => line(FAULT_TEXT[k], reporting.kind === k, 'repKind', k)).join('')}
      <button class="btn red block" style="margin-top:10px" data-act="repSend" ${reporting.accused ? '' : 'disabled'}>⚑ Envoyer le signalement</button>
      <button class="btn block small" data-act="repCancel">Annuler</button></div>` };
  }

  /* ------------------------------ Actions ------------------------------ */

  function playNow(extra = {}) {
    const p = { ...pending, ...extra };
    const v = client.view;
    if (p.card.r === JACK && p.jackPlus == null) { pending = p; return nav.refresh(); }
    if (isJoker(p.card) && p.jokerScore == null) { pending = p; return nav.refresh(); }
    if (v.options.announceScore && !isJoker(p.card) && extra.announced == null) { pending = { ...p, stage: 'announce' }; return nav.refresh(); }
    client.send({ type: 'play', cardId: p.card.id, jackPlus: p.jackPlus ?? null, jokerScore: p.jokerScore ?? null, announced: extra.announced ?? null });
    pending = null;
    selected = null;
    nav.refresh();
  }

  return {
    render() {
      if (client.status === 'rejected') return ended(REJECT_TEXT[client.rejectReason] ?? 'Connexion refusée.');
      if (client.status === 'ended') return ended('La partie est terminée.');
      if (client.status === 'failed') return ended(esc(client.statusText || 'Impossible de joindre la table.'));
      const v = client.view;
      if (!v) return connecting();
      if (v.phase.type === 'lobby') return lobby(v);
      return board(v);
    },
    /** Fenêtre à afficher (une seule à la fois, par ordre de priorité). */
    modal() {
      const v = client.view;
      if (notices.length) return drinkModal(notices[0], v);
      if (bacAlert) {
        const until = bacAlert.msUntilLegal > 0 ? `<br>Retour estimé sous la limite dans ${Math.ceil(bacAlert.msUntilLegal / 60_000)} min.` : '';
        return { key: `bac-${bacAlert.level}`, html: `<div class="col center" style="gap:10px"><div class="badge" style="--c:${bacColor(bacAlert.level)}">⚠</div>
          <h2 style="color:${bacColor(bacAlert.level)}">${bacText(bacAlert.level)}</h2>
          <p class="muted">Tu ne dois pas prendre le volant. Fais-toi raccompagner, prends un taxi ou dors sur place.${until}</p>
          <p class="tiny muted">Bois de l'eau, mange quelque chose et passe à une boisson sans alcool : la partie continue quand même !</p>
          <button class="btn primary block" data-act="bacOk">OK</button></div>` };
      }
      if (confirmLeave) {
        return { key: 'leave', html: `<h2>Quitter la table ?</h2><p class="muted">Tu pourras revenir avec le même lien : tu retrouveras ta place.</p>
          <div class="col"><button class="btn danger block" data-act="leaveOk">Quitter</button><button class="btn block" data-act="leaveCancel">Annuler</button></div>` };
      }
      if (!v || v.paused || v.report) return null;
      if (reporting) return reportModal(v);
      if (pending) return playModal(v);
      const p = v.phase;
      if (p.type === 'distribute' && p.playerId === v.me) {
        const key = `${v.roundNumber}-${JSON.stringify(v.lastPlay)}`;
        if (givenKey !== key) { givenKey = key; given = {}; }
        return distributeModal(v, p.sips);
      }
      if (p.type === 'partner' && p.playerId === v.me) return partnerModal(v);
      return null;
    },
    actions: {
      home: () => { client.destroy(); nav.home(); },
      leave: () => { confirmLeave = true; nav.refresh(); },
      leaveCancel: () => { confirmLeave = false; nav.refresh(); },
      leaveOk: () => { client.leave(); nav.home(); },
      pick: (id) => { selected = selected === +id ? null : +id; nav.refresh(); },
      play: () => {
        const c = client.view.myHand.find((x) => x.id === selected);
        if (c) { pending = { card: c }; playNow(); }
      },
      draw: () => client.send({ type: 'draw' }),
      jack: (v) => playNow({ jackPlus: v === '1' }),
      jokerStep: (d) => { jokerValue = Math.max(0, Math.min(TARGET_SCORE - 1, jokerValue + +d)); nav.refresh(); },
      jokerAdd: (d) => { jokerValue = Math.max(0, Math.min(TARGET_SCORE - 1, jokerValue + +d)); nav.refresh(); },
      jokerSet: (v) => { jokerValue = +v; nav.refresh(); },
      jokerOk: () => playNow({ jokerScore: jokerValue }),
      kamikazeAsk: () => { pending = { ...pending, stage: 'kamikaze' }; nav.refresh(); },
      jokerBack: () => { pending = { ...pending, stage: null }; nav.refresh(); },
      kamikaze: () => playNow({ jokerScore: TARGET_SCORE }),
      cancelPlay: () => { pending = null; nav.refresh(); },
      guess: (arg) => client.send({ type: 'guess', guess: JSON.parse(arg) }),
      partner: (id) => client.send({ type: 'partner', partnerId: id }),
      giveOk: () => client.send({ type: 'distribute', sips: given }),
      drinkOk: () => { notices.shift(); nav.refresh(); },
      drinkDraw: () => { client.send({ type: 'draw' }); notices.shift(); nav.refresh(); },
      bacOk: () => { bacAlert = null; nav.refresh(); },
      report: () => { reporting = { accused: null, kind: 'DRAW' }; nav.refresh(); },
      repWho: (id) => { reporting.accused = id; nav.refresh(); },
      repKind: (k) => { reporting.kind = k; nav.refresh(); },
      repSend: () => { if (reporting.accused) client.report(reporting.accused, reporting.kind); reporting = null; nav.refresh(); },
      repCancel: () => { reporting = null; nav.refresh(); },
    },
    onAction(act, arg) {
      if (act.startsWith('give:')) {
        const id = act.slice(5);
        given[id] = Math.max(0, (given[id] || 0) + +arg);
        nav.refresh();
        return true;
      }
      return false;
    },
    onSubmit(form) {
      if (form.dataset.submit !== 'announce') return;
      const n = parseInt(document.getElementById('announce').value, 10);
      if (Number.isInteger(n)) playNow({ announced: n });
    },
    onModalDismiss(key) {
      if (key?.startsWith('drink-')) { notices.shift(); return true; }
      if (key?.startsWith('jack-') || key?.startsWith('joker-') || key?.startsWith('announce-')) { pending = null; return true; }
      if (key === 'report') { reporting = null; return true; }
      if (key === 'leave') { confirmLeave = false; return true; }
      if (key?.startsWith('bac-')) { bacAlert = null; return true; }
      return false; // distribution et acolyte : choix obligatoires
    },
    destroy() { client.destroy(); reveal.clear(); },
  };
}
