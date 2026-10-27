/*
 * Accueil (créer une table / rejoindre) et profil du joueur.
 */
import { esc, avatar, bacBadge, snack } from './ui.js';
import { loadProfile, saveProfile, loadHost, bacStatus } from './store.js';
import { normalizeCode } from './net.js';

/** Accueil : logo, « Créer une table sur cet écran », « Rejoindre », profil. */
export function homeScreen(nav) {
  let code = '';
  return {
    render() {
      const profile = loadProfile();
      const saved = loadHost();
      const st = profile ? bacStatus(profile) : null;
      return `<div class="screen"><div class="narrow col" style="gap:12px">
        <div class="row" style="justify-content:space-between;min-height:40px">
          ${profile ? `<button class="pill" data-act="profile">${avatar(profile.pseudo, 0, 22)} ${esc(profile.pseudo)}</button>${st && st.bac > 0 ? bacBadge(st.level, st.bac) : ''}` : '<span></span>'}
        </div>
        <div style="height:28px"></div>
        <div class="logo">98</div>
        <h1 class="center" style="font-size:34px">Le 98</h1>
        <p class="center muted" style="margin:0">Jeux de cartes de soirée</p>
        <div style="height:28px"></div>

        <button class="btn primary block" data-act="host">＋ Créer une table sur cet écran</button>
        <p class="tiny faint center" style="margin:-4px 0 6px">Pour l'ordinateur ou la tablette posée au centre : c'est le Master.</p>
        ${saved && saved.state?.phase?.type !== 'lobby' ? `<button class="btn block" data-act="resume">↻ Reprendre la table ${esc(saved.code)}</button>` : ''}

        <div class="panel col" style="margin-top:10px">
          <div class="label">Rejoindre une table</div>
          <input class="field code" id="code" maxlength="8" placeholder="CODE" value="${esc(code)}" autocomplete="off" autocapitalize="characters">
          <button class="btn block" data-act="join">Rejoindre</button>
          <p class="tiny faint" style="margin:0">Le plus simple : scanne le QR code affiché par le Master avec l'appareil photo.</p>
        </div>

        <button class="btn ghost" data-act="profile">${profile ? 'Mon profil' : 'Créer mon profil'}</button>
        <p class="tiny faint center" style="margin-top:20px">L'abus d'alcool est dangereux pour la santé. Les alcoolémies affichées sont des estimations
          et ne remplacent jamais un éthylotest. Ne prends jamais le volant après avoir bu. Réservé aux adultes.</p>
      </div></div>`;
    },
    actions: {
      host: () => nav.host(false),
      resume: () => nav.host(true),
      profile: () => nav.profile(() => nav.home()),
      join: () => {
        code = normalizeCode(document.getElementById('code').value);
        if (code.length < 4) { snack('Saisis le code affiché par le Master.'); return; }
        nav.join(code);
      },
    },
    onInput(el) { if (el.id === 'code') code = el.value; },
  };
}

/** Profil : pseudo, sexe, poids, permis probatoire, partage de l'alcoolémie. Stocké sur l'appareil. */
export function profileScreen(nav, onDone) {
  const p = loadProfile() ?? { pseudo: '', weightKg: 70, sex: 'MALE', probation: false, sipMl: 20, abv: 5, shareBac: true };
  const draft = { ...p };
  const sexBtn = (v, label) => `<button class="${draft.sex === v ? 'on' : ''}" data-act="sex" data-arg="${v}">${label}</button>`;
  return {
    render() {
      return `<div class="screen"><div class="narrow col" style="gap:8px">
        <div class="row"><button class="icon-btn" data-act="back">‹</button><h2>Ton profil</h2></div>
        <p class="muted small">Pour estimer ton taux d'alcool pendant la partie. Rien ne quitte ton téléphone, sauf ton pseudo.</p>
        <div class="label" style="margin-top:8px">Pseudo</div>
        <input class="field" id="pseudo" maxlength="20" value="${esc(draft.pseudo)}" placeholder="Ton pseudo" autocomplete="nickname">
        <div class="label" style="margin-top:10px">Sexe biologique</div>
        <div class="segment" id="sex">${sexBtn('MALE', 'Homme')}${sexBtn('FEMALE', 'Femme')}${sexBtn('OTHER', 'Autre')}</div>
        <p class="tiny faint" style="margin:2px 0 0">Seulement pour le coefficient de Widmark (r = 0,70 / 0,60 / 0,65).</p>
        <div class="label" style="margin-top:10px">Poids</div>
        <div class="panel center">
          <div style="font-size:42px;font-weight:700;letter-spacing:-.04em"><span id="w">${draft.weightKg}</span> <span class="muted" style="font-size:18px">kg</span></div>
          <input type="range" id="weight" min="40" max="150" value="${draft.weightKg}">
          <div class="row tiny faint" style="justify-content:space-between"><span>40</span><span>150</span></div>
        </div>
        <div class="panel row" style="margin-top:6px"><div class="grow"><b>Jeune conducteur</b><div class="tiny muted">Seuil légal de 0,2 g/L au lieu de 0,5 g/L.</div></div>
          <label class="switch"><input type="checkbox" id="probation" ${draft.probation ? 'checked' : ''}><span></span></label></div>
        <div class="panel row"><div class="grow"><b>Partager mon niveau avec la table</b><div class="tiny muted">Une pastille de couleur à côté de ton nom, jamais tes données.</div></div>
          <label class="switch"><input type="checkbox" id="share" ${draft.shareBac ? 'checked' : ''}><span></span></label></div>
        <div class="panel col" style="margin-top:6px">
          <div class="row"><div class="grow small">Volume d'une gorgée : <b id="sipv">${draft.sipMl}</b> mL</div></div>
          <input type="range" id="sip" min="10" max="40" value="${draft.sipMl}">
          <div class="row"><div class="grow small">Degré de la boisson (%)</div><input class="field" id="abv" inputmode="decimal" value="${draft.abv}" style="width:90px;min-height:40px;text-align:center"></div>
        </div>
        <button class="btn primary block" data-act="save" style="margin-top:12px">Enregistrer</button>
        <p class="tiny faint center">🔒 Stocké uniquement sur ce téléphone</p>
      </div></div>`;
    },
    actions: {
      back: () => onDone(false),
      sex: (v) => {
        draft.sex = v;
        for (const b of document.querySelectorAll('#sex button')) b.classList.toggle('on', b.dataset.arg === v);
      },
      save: () => {
        draft.pseudo = document.getElementById('pseudo').value.trim();
        const abv = parseFloat(String(document.getElementById('abv').value).replace(',', '.'));
        if (!draft.pseudo) { snack('Choisis un pseudo.'); return; }
        if (!(abv >= 0 && abv <= 100)) { snack('Degré de la boisson invalide.'); return; }
        saveProfile({ ...draft, abv });
        onDone(true);
      },
    },
    onInput(el) {
      if (el.id === 'weight') { draft.weightKg = +el.value; document.getElementById('w').textContent = el.value; }
      if (el.id === 'sip') { draft.sipMl = +el.value; document.getElementById('sipv').textContent = el.value; }
      if (el.id === 'probation') draft.probation = el.checked;
      if (el.id === 'share') draft.shareBac = el.checked;
    },
  };
}
