/*
 * Stockage local du navigateur (localStorage) : profil, consommations, table du Master.
 * Rien ne quitte l'appareil, sauf le pseudo et le niveau d'alcoolémie (si partagé) envoyés au Master.
 */
import { bacAt, level, msUntilBelow, gramsForSips, LEGAL_LIMIT, PROBATION_LIMIT } from './widmark.js';

const KEY_PROFILE = 'app98.profile';
const KEY_INTAKES = 'app98.intakes';
const KEY_HOST = 'app98.host';
const DAY = 24 * 3_600_000;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible (navigation privée) */ }
}

export function randomId(len = 12) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

/* ------------------------------ Profil ------------------------------ */

export function loadProfile() { return read(KEY_PROFILE, null); }

export function saveProfile(p) {
  const profile = {
    uid: p.uid || randomId(16), pseudo: p.pseudo.trim().slice(0, 20), weightKg: p.weightKg, sex: p.sex,
    probation: !!p.probation, sipMl: p.sipMl ?? 20, abv: p.abv ?? 5, shareBac: p.shareBac ?? true,
  };
  write(KEY_PROFILE, profile);
  return profile;
}

/* -------------------------- Consommations -------------------------- */

/** Enregistre des gorgées reçues en partie ; false si déjà comptées (même partie, même numéro). */
export function recordSips(profile, sessionUid, seq, sips) {
  const now = Date.now();
  const list = read(KEY_INTAKES, []).filter((i) => now - i.t < DAY);
  const key = `${sessionUid}:${seq}`;
  if (list.some((i) => i.key === key)) return false;
  list.push({ t: now, grams: gramsForSips(sips, profile.sipMl, profile.abv), key });
  write(KEY_INTAKES, list);
  return true;
}

export function clearIntakes() { write(KEY_INTAKES, []); }

/** Alcoolémie estimée maintenant, niveau et temps avant de repasser sous la limite. */
export function bacStatus(profile) {
  if (!profile) return null;
  const body = { weightKg: profile.weightKg, sex: profile.sex };
  const bac = bacAt(read(KEY_INTAKES, []), body, Date.now());
  const limit = profile.probation ? PROBATION_LIMIT : LEGAL_LIMIT;
  return { bac, level: level(bac, limit), limit, msUntilLegal: msUntilBelow(bac, limit, body) };
}

/* ------------------------- Table du Master ------------------------- */

/** Sauvegarde de la table (code + état complet) pour reprendre après un rechargement de page. */
export function loadHost() { return read(KEY_HOST, null); }
export function saveHost(code, state) { write(KEY_HOST, { code, state, savedAt: Date.now() }); }
export function clearHost() { try { localStorage.removeItem(KEY_HOST); } catch { /* ignore */ } }
