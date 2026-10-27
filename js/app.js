/*
 * Point d'entrée : navigation entre les écrans, délégation des clics (attribut data-act)
 * et calque des fenêtres. Une seule page : index.html?t=CODE ouvre directement la table CODE.
 */
import { homeScreen, profileScreen } from './screen-home.js';
import { hostScreen } from './screen-host.js';
import { playerScreen } from './screen-player.js';
import { loadProfile } from './store.js';
import { normalizeCode } from './net.js';
import { modal } from './ui.js';

const root = document.getElementById('app');
let screen = null;

function setQuery(code) {
  const url = new URL(location.href);
  url.search = code ? `?t=${code}` : '';
  history.replaceState(null, '', url);
}

function mount(next) {
  screen?.destroy?.();
  modal.hide();
  document.getElementById('toasts').innerHTML = '';
  document.getElementById('menu').innerHTML = '';
  screen = next;
  refresh();
  window.scrollTo(0, 0);
}

function refresh() {
  if (!screen) return;
  root.innerHTML = screen.render();
  if (!screen.modal) return; // fenêtres gérées directement par l'écran
  const m = screen.modal();
  if (!m) modal.hide();
  else if (modal.key !== m.key) modal.show(m.key, m.html, { raw: m.raw });
  else if (m.live) modal.refresh(m.html);
}

const nav = {
  refresh,
  home() { setQuery(null); mount(homeScreen(nav)); },
  host(resume) { setQuery(null); mount(hostScreen(nav, resume)); },
  profile(onDone) { mount(profileScreen(nav, onDone)); },
  join(code) {
    setQuery(code);
    if (loadProfile()) mount(playerScreen(nav, code));
    else mount(profileScreen(nav, (saved) => (saved ? mount(playerScreen(nav, code)) : nav.home())));
  },
};

/* ------------------------- Délégation d'événements ------------------------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) { screen?.onOutsideClick?.(); return; }
  const act = el.dataset.act;
  if (act === '__modal-back') {
    // Clic sur le fond sombre (pas dans la fenêtre) : fermeture si l'écran l'autorise.
    if (e.target !== el) return;
    if (screen?.onModalDismiss?.(modal.key)) { modal.hide(); refresh(); }
    return;
  }
  if (el.tagName === 'INPUT') return; // interrupteurs : traités par l'événement « change »
  e.preventDefault();
  if (screen?.onAction?.(act, el.dataset.arg, el)) return;
  screen?.actions?.[act]?.(el.dataset.arg, el, e);
});

const onInput = (e) => screen?.onInput?.(e.target);
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);

document.addEventListener('submit', (e) => {
  e.preventDefault();
  screen?.onSubmit?.(e.target);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'code') screen?.actions?.join?.();
});

window.addEventListener('beforeunload', (e) => {
  if (screen?.beforeUnload?.()) { e.preventDefault(); e.returnValue = ''; }
});

/* ------------------------------ Démarrage ------------------------------ */

if (typeof window.Peer === 'undefined') {
  root.innerHTML = '<div class="screen center muted">Impossible de charger la bibliothèque de connexion (lib/peerjs.min.js).</div>';
} else {
  const code = normalizeCode(new URLSearchParams(location.search).get('t'));
  if (code) nav.join(code);
  else nav.home();
}
