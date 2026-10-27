/*
 * Écran du Master (PC ou tablette) : salon avec QR code, table de jeu, Purple,
 * pause, arbitrage des signalements, fin de manche.
 */
/* global qrcode */
import { Hub } from './host.js';
import { MAX_PLAYERS, MIN_PLAYERS, TARGET_SCORE, currentSeat, nameOf } from './engine.js';
import { joinUrl } from './net.js';
import { loadHost } from './store.js';
import {
  esc, avatar, card, deck, scoreRing, tag, statusDot, bacBadge, logText, sips, cardLong,
  EventToaster, modal, snack, stepper, toggle, ERROR_TEXT, FAULT_TEXT,
} from './ui.js';
import { purpleBoard, purpleButtons } from './screen-player.js';

export function hostScreen(nav, resume) {
  const toaster = new EventToaster();
  let lastRound = null;
  let starterUntil = 0;
  let starterTimer = null;
  let menuFor = null;

  const hub = new Hub((h) => {
    if (h.lastError) { snack(ERROR_TEXT[h.lastError] ?? h.lastError); h.lastError = null; }
    const s = h.state;
    if (s && s.phase.type !== 'lobby') toaster.update(s.log);
    // Tirage d'amorce affiché 3 s au début de chaque manche (sauf manche déjà entamée à l'ouverture).
    if (s && s.roundNumber !== lastRound) {
      const sinceStart = s.log.slice(s.log.map((e) => e.event).lastIndexOf('ROUND_START') + 1);
      if (lastRound !== null || !sinceStart.some((e) => e.event === 'PLAY')) {
        if (s.roundNumber > 0) {
          starterUntil = Date.now() + 3_200;
          clearTimeout(starterTimer);
          starterTimer = setTimeout(() => nav.refresh(), 3_300);
        }
      }
      lastRound = s.roundNumber;
    }
    nav.refresh();
  });
  hub.start('Soirée 98', resume ? loadHost() : null);

  /* ------------------------------ Salon ------------------------------ */

  function lobby(s) {
    const url = joinUrl(hub.code);
    let qrSvg = '';
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 6, margin: 1, scalable: true });
    } catch { /* bibliothèque QR indisponible : le code suffit */ }
    const statusLine = hub.status === 'ready'
      ? statusDot('Table ouverte, en attente des joueurs', 'var(--green)')
      : statusDot(esc(hub.statusText || 'Ouverture de la table…'), hub.status === 'error' ? 'var(--red)' : 'var(--amber)');
    const seats = s.seats.map((seat, i) => `<div class="player-row">${avatar(seat.name, i)}<div class="grow name">${esc(seat.name)}</div>
        ${seat.isBot ? statusDot('Bot', 'var(--blue)') : seat.connected ? statusDot('Prêt', 'var(--green)') : statusDot('Connexion…', 'var(--amber)')}
        <button class="icon-btn" data-act="kick" data-arg="${esc(seat.id)}" title="Retirer">✕</button></div>`).join('');
    const o = s.options;
    const opt = (title, hint, key) => `<div class="row" style="padding:8px 0"><div class="grow"><b>${title}</b><div class="tiny muted">${hint}</div></div>${toggle(o[key], `opt:${key}`)}</div>`;
    return `<div class="lobby">
      <div class="panel col" style="gap:12px">
        <div class="qr">${qrSvg || '<div class="muted">QR indisponible</div>'}</div>
        <h3 class="center">Scanne pour rejoindre</h3>
        <p class="tiny muted center" style="margin:0">Avec l'appareil photo du téléphone, ou sur la page d'accueil avec ce code :</p>
        <div class="code-big">${esc(hub.code)}</div>
        <div class="tiny faint center" style="word-break:break-all">${esc(url)}</div>
        <div class="center">${statusLine}</div>
      </div>
      <div class="col" style="gap:12px">
        <div class="row"><div class="grow"><h1 style="font-size:36px">Le 98</h1><div class="muted">${esc(s.roomName)} · en attente des joueurs</div></div>
          <span class="pill">👤 ${s.seats.length} / ${MAX_PLAYERS} joueurs</span>
          <button class="icon-btn" data-act="quit" title="Quitter">⏻</button></div>
        ${seats || '<div class="panel muted">Personne pour l\'instant. Scanne le QR code avec ton téléphone !</div>'}
        <button class="btn small" data-act="addBot" ${s.seats.length >= MAX_PLAYERS ? 'disabled' : ''}>＋ Ajouter un bot</button>
        <button class="btn primary block" data-act="start" ${s.seats.length < MIN_PLAYERS ? 'disabled' : ''}>⚡ ${s.seats.length < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs` : 'Lancer la manche'}</button>
      </div>
      <div class="panel">
        <h3 style="margin-bottom:6px">Options de jeu</h3>
        ${opt('Pioche manuelle', 'Chaque joueur doit appuyer sur « Piocher ». Oubli = 1 gorgée et main réduite.', 'manualDraw')}
        ${opt('Annonce du score', 'Le joueur saisit le nouveau score. Erreur de calcul = 1 gorgée.', 'announceScore')}
        ${opt('Quitter une dizaine fait boire', 'Exemple officiel : 80 + 9 = 89, on boit 8.', 'leavingTenCounts')}
        <div class="row" style="padding:8px 0"><div class="grow"><b>Tournée générale</b><div class="tiny muted">Gorgées pour tous si l'amorce est un Roi ou un 10.</div></div>
          ${stepper(o.generalRoundSips, 1, 20, 'generalSips')}</div>
      </div>
    </div>`;
  }

  /* ---------------------------- Table de jeu ---------------------------- */

  function activeId(s) {
    const p = s.phase;
    if (p.type === 'turn') return currentSeat(s)?.id;
    if (p.type === 'distribute' || p.type === 'partner') return p.playerId;
    if (p.type === 'purple') return p.purple.activeId;
    return null;
  }

  function topBar(s) {
    const p = s.phase;
    const id = activeId(s);
    const idx = s.seats.findIndex((x) => x.id === id);
    const label = p.type === 'turn' ? `Au tour de ${esc(nameOf(s, id))}`
      : p.type === 'distribute' ? `${esc(nameOf(s, id))} distribue ${sips(p.sips)}`
      : p.type === 'partner' ? `${esc(nameOf(s, id))} choisit son acolyte`
      : p.type === 'purple' ? `${esc(nameOf(s, id))} joue le Purple` : '';
    return `<div class="host-top"><span class="pill">Manche ${s.roundNumber}</span>
      ${label ? `<span class="pill green">${idx >= 0 ? avatar(s.seats[idx].name, idx, 22) : ''}${label}</span>` : '<span></span>'}
      <button class="icon-btn" data-act="pause" title="Mettre en pause">⏸</button></div>`;
  }

  function disconnectedNotice(s, playerId) {
    const seat = s.seats.find((x) => x.id === playerId);
    if (!seat || seat.connected || seat.isBot) return '';
    return `<div class="panel" style="border-color:rgba(242,92,92,.5);margin-top:10px"><div style="color:var(--red)">${esc(seat.name)} est déconnecté. On attend sa reconnexion…</div>
      <button class="btn small" style="margin-top:8px" data-act="toBot" data-arg="${esc(seat.id)}">Remplacer par un bot</button></div>`;
  }

  function center(s) {
    const p = s.phase;
    if (p.type === 'purple') {
      return `<h1 style="color:var(--green);font-size:40px">LE PURPLE</h1><div class="tiny muted">Le Master fait office de croupier.</div>
        ${purpleBoard(p.purple, (id) => nameOf(s, id), 90)}
        <div class="tiny muted">Le joueur annonce sur son téléphone, ou directement ici :</div>
        ${purpleButtons(p.purple, 'guessFor')}`;
    }
    if (p.type === 'distribute') {
      const king = [...s.log].reverse().find((e) => e.event === 'KING' || e.event === 'LANDED')?.event === 'KING';
      return `${tag(king ? 'Roi' : 'Dizaine pile', 'var(--amber)')}<div class="big-score" style="font-size:110px">${s.score}</div>
        <h2>${esc(nameOf(s, p.playerId))} distribue ${sips(p.sips)}</h2><div class="tiny muted">Il répartit sur son téléphone</div>
        <div class="indeterminate" style="margin-top:8px"></div>${disconnectedNotice(s, p.playerId)}`;
    }
    if (p.type === 'partner') {
      const others = s.seats.filter((x) => x.id !== p.playerId);
      return `${tag('98 pile !', 'var(--red)')}<div class="big-score" style="font-size:110px">98</div>
        <h2>${esc(nameOf(s, p.playerId))} choisit son acolyte</h2><div class="tiny muted">Le choix peut aussi se faire ici :</div>
        <div class="row wrap" style="justify-content:center">${others.map((o) => `<button class="btn small" data-act="partnerFor" data-arg="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div>
        ${disconnectedNotice(s, p.playerId)}`;
    }
    const last = s.lastPlay;
    return `<div class="row" style="gap:48px;align-items:center">
        <div class="col" style="align-items:center">
          <div class="row" style="gap:16px">${deck(94)}${card(s.discard[s.discard.length - 1], { w: 110 })}</div>
          <div class="tiny muted">${last ? `${esc(nameOf(s, last.playerId))} a posé ${cardLong(last.card)}` : `Pioche : ${s.drawPile.length} cartes`}</div>
        </div>
        ${scoreRing(s.score, 250, s.clockwise ? '↻ Sens horaire' : '↺ Sens anti-horaire')}
      </div>${disconnectedNotice(s, currentSeat(s)?.id)}`;
  }

  function side(s) {
    const journal = `<div class="panel"><div class="label">Journal</div>${s.log.slice(-7).reverse().map((e) => `<div class="log-line">${logText(e)}</div>`).join('')}</div>`;
    if (s.phase.type === 'purple') return journal; // le score n'a plus d'importance pendant le Purple
    const margin = Math.max(0, TARGET_SCORE - s.score);
    const nextTen = (Math.floor(s.score / 10) + 1) * 10;
    const watch = nextTen < TARGET_SCORE
      ? `<b>Dizaine ${nextTen} à surveiller</b><div class="tiny muted">Un ${nextTen - s.score} fait distribuer ${sips(nextTen / 10)}</div>`
      : `<b>98 à surveiller</b><div class="tiny muted">Un ${margin} envoie au Purple</div>`;
    return `<div class="panel"><div class="row tiny"><span class="grow muted">Avant le 98</span><b style="color:var(--amber)">${margin} de marge</b></div>
        <div class="progress" style="margin:10px 0 6px"><div style="width:${(s.score / TARGET_SCORE) * 100}%"></div></div>
        <div class="row tiny faint" style="justify-content:space-between"><span>0</span><span>${s.score}</span><span>98</span></div></div>
      <div class="panel row" style="align-items:flex-start"><span style="color:var(--blue)">💧</span><div>${watch}</div></div>
      ${journal}`;
  }

  function chips(s) {
    const act = activeId(s);
    return `<div class="chips">${s.seats.map((seat, i) => `<div class="chip ${seat.id === act ? 'active' : ''} ${seat.connected || seat.isBot ? '' : 'off'}" data-act="menu" data-arg="${esc(seat.id)}">
      ${avatar(seat.name, i, 28)}<div><div><b>${seat.isBot ? '🤖 ' : ''}${esc(seat.name)}</b></div>
      <div class="sub">${sips(seat.sipsDrunk)} · ${seat.hand.length} cartes${seat.pendingDraw ? ' · doit piocher' : ''}</div></div>
      ${seat.bacLevel ? bacBadge(seat.bacLevel) : ''}</div>`).join('')}</div>`;
  }

  function table(s) {
    return `<div class="host">${topBar(s)}
      <div class="host-main"><div class="host-center">${center(s)}</div><div class="host-side">${side(s)}</div></div>
      ${chips(s)}</div>${overlays(s)}`;
  }

  /* ------------------------------ Calques ------------------------------ */

  function overlays(s) {
    if (s.report) {
      const r = s.report;
      const ri = s.seats.findIndex((x) => x.id === r.reporterId), ai = s.seats.findIndex((x) => x.id === r.accusedId);
      const rn = esc(nameOf(s, r.reporterId)), an = esc(nameOf(s, r.accusedId));
      return `<div class="overlay"><div class="panel hi col center" style="max-width:560px;width:100%;padding:26px;gap:12px">
        <div>${tag('⏸ Jeu figé · arbitrage', 'var(--amber)')}</div>
        <div class="row" style="justify-content:center;gap:14px">${avatar(rn, ri, 44)}<span style="color:var(--amber);font-size:22px">⚑</span>${avatar(an, ai, 44)}</div>
        <h2>${rn} signale ${an}</h2><div class="muted">${FAULT_TEXT[r.kind]}</div>
        <div class="row" style="gap:10px;margin-top:8px">
          <button class="btn primary grow" style="flex-direction:column;min-height:64px" data-act="judge" data-arg="1">Valider (+1 ${an})<span class="tiny" style="opacity:.7">${an} boit une gorgée</span></button>
          <button class="btn red grow" style="flex-direction:column;min-height:64px" data-act="judge" data-arg="0">Rejeter (+1 ${rn})<span class="tiny" style="opacity:.8">Signalement abusif</span></button>
        </div></div></div>`;
    }
    if (s.paused) {
      const id = activeId(s);
      return `<div class="overlay"><div class="col center" style="gap:10px">
        <div class="badge" style="--c:var(--text);width:64px;height:64px">⏸</div>
        <h1>Partie en pause</h1><div class="muted">Score ${s.score}, au tour de ${esc(nameOf(s, id))}</div>
        <div class="row" style="justify-content:center;margin-top:14px">
          <button class="btn primary" style="min-width:180px" data-act="resume">▶ Reprendre</button>
          <button class="btn" style="min-width:180px" data-act="quit">Quitter la partie</button></div></div></div>`;
    }
    if (Date.now() < starterUntil && s.phase.type !== 'lobby') {
      const starter = [...s.log].reverse().find((e) => e.event === 'STARTER');
      const general = [...s.log].reverse().find((e) => e.event === 'GENERAL_ROUND' || e.event === 'ROUND_START')?.event === 'GENERAL_ROUND';
      if (!starter) return '';
      return `<div class="overlay"><div class="col" style="align-items:center;gap:22px">
        ${general ? `<div style="background:var(--amber);color:#231600;border-radius:14px;padding:14px 30px;text-align:center"><h2>☆ Tournée générale ! ☆</h2><div class="small">Tout le monde boit !</div></div>` : '<h1>Tirage d\'amorce</h1>'}
        <div class="row" style="gap:56px;align-items:center">
          <div class="col" style="align-items:center">${deck(90)}<span class="tiny muted">Pioche : ${s.drawPile.length} cartes</span></div>
          ${card(starter.card, { w: 130, style: 'transform:rotate(-4deg)' })}
          <div class="col" style="align-items:center;gap:4px"><span class="small muted">Score de départ</span>
            <div class="big-score">${starter.value}</div>${tag('✓ Carte valide')}</div>
        </div></div></div>`;
    }
    return '';
  }

  function roundOver(s) {
    const sm = s.phase.summary;
    const result = sm.noLoser ? 'Plus personne ne pouvait jouer : manche nulle.'
      : sm.exhaustionWinnerId ? `Paquet épuisé : la chance sourit à ${esc(nameOf(s, sm.exhaustionWinnerId))} !`
      : `Purple joué par : ${sm.purpleIds.map((id) => esc(nameOf(s, id))).join(', ')}`;
    const rows = s.seats.map((seat, i) => ({ seat, i })).sort((a, b) => b.seat.round.sipsDrunk - a.seat.round.sipsDrunk)
      .map(({ seat, i }) => `<div class="player-row ${sm.savedIds.includes(seat.id) ? 'active' : ''}">${avatar(seat.name, i)}
        <div class="grow"><div class="name">${esc(seat.name)}</div><div class="tiny muted">${seat.round.sipsGiven} données · ${seat.round.cardsPlayed} cartes posées</div></div>
        <b style="color:var(--blue);font-size:22px">💧 ${seat.round.sipsDrunk}</b></div>`).join('');
    return `<div class="screen"><div class="col" style="max-width:620px;margin:0 auto;align-items:stretch;gap:10px">
      <div class="center">${tag(`Manche ${sm.roundNumber} terminée`, 'var(--muted)')}</div>
      <div class="big-score center">${sm.finalScore}</div><h2 class="center">${result}</h2>
      <div class="section">Récapitulatif de la manche</div>${rows}
      <div class="row" style="margin-top:14px"><button class="btn primary grow" data-act="start">⚡ Manche suivante</button><button class="btn grow" data-act="quit">Terminer la partie</button></div>
      <p class="tiny faint center">Pensez à boire de l'eau entre les manches. Personne ne conduit après la soirée.</p>
    </div></div>`;
  }

  /* ------------------------------ Menus ------------------------------ */

  function openMenu(playerId, el) {
    const s = hub.state;
    const seat = s.seats.find((x) => x.id === playerId);
    if (!seat) return;
    menuFor = playerId;
    const r = el.getBoundingClientRect();
    const box = document.getElementById('menu');
    box.innerHTML = `<div class="menu" style="left:${Math.min(r.left, innerWidth - 260)}px;bottom:${innerHeight - r.top + 8}px">
      <button data-act="penalty">Faute : soufflage (+1 gorgée)</button>
      ${seat.id.startsWith('bot-') ? '' : `<button data-act="toggleBot">${seat.isBot ? 'Rendre la main au joueur' : 'Remplacer par un bot'}</button>`}
    </div>`;
  }
  const closeMenu = () => { document.getElementById('menu').innerHTML = ''; menuFor = null; };

  function confirmQuit() {
    modal.show('quit', `<h2>Quitter la partie ?</h2><p class="muted">Les joueurs seront déconnectés et la partie terminée.</p>
      <div class="col"><button class="btn danger block" data-act="endGame">Terminer la partie</button>
      <button class="btn block" data-act="closeModal">Annuler</button></div>`);
  }

  return {
    render() {
      const s = hub.state;
      if (!s) return '<div class="screen center muted">Ouverture de la table…</div>';
      if (s.phase.type === 'lobby') return lobby(s);
      if (s.phase.type === 'roundOver') return roundOver(s);
      return table(s);
    },
    actions: {
      addBot: () => hub.addBot(),
      kick: (id) => hub.removeSeat(id),
      start: () => hub.startRound(),
      pause: () => hub.setPaused(true),
      resume: () => hub.setPaused(false),
      judge: (v) => hub.resolveReport(v === '1'),
      toBot: (id) => hub.setBot(id, true),
      partnerFor: (id) => { const p = hub.state.phase; if (p.type === 'partner') hub.actFor(p.playerId, { type: 'partner', partnerId: id }); },
      guessFor: (arg) => { const p = hub.state.phase; if (p.type === 'purple') hub.actFor(p.purple.activeId, { type: 'guess', guess: JSON.parse(arg) }); },
      generalSips: (d) => hub.updateOptions({ ...hub.state.options, generalRoundSips: Math.max(1, Math.min(20, hub.state.options.generalRoundSips + +d)) }),
      menu: (id, el) => (menuFor === id ? closeMenu() : openMenu(id, el)),
      penalty: () => { const id = menuFor; closeMenu(); hub.penalty(id); },
      toggleBot: () => { const id = menuFor; closeMenu(); const seat = hub.state.seats.find((x) => x.id === id); if (seat) hub.setBot(id, !seat.isBot); },
      quit: () => confirmQuit(),
      closeModal: () => modal.hide(),
      endGame: () => { modal.hide(); hub.stop(true); nav.home(); },
    },
    onInput(el) {
      const act = el.dataset.act || '';
      if (act.startsWith('opt:')) hub.updateOptions({ ...hub.state.options, [act.slice(4)]: el.checked });
    },
    onOutsideClick() { if (menuFor) closeMenu(); },
    destroy() { clearTimeout(starterTimer); },
    /** Empêche la fermeture accidentelle de l'onglet du Master pendant une partie. */
    beforeUnload: () => hub.state && hub.state.seats.length > 0,
  };
}
