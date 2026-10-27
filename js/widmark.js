/*
 * Estimation de l'alcoolémie par la formule de Widmark — portage de Widmark.kt.
 *
 *     C(t) = A / (r × P) − β × t
 *
 *  A : alcool pur ingéré (g) = volume (mL) × degré (%) / 100 × 0,789
 *  r : coefficient de diffusion (0,70 homme, 0,60 femme, 0,65 autre)
 *  P : masse corporelle (kg) ; β : élimination (g/L/h), 0,15 par défaut
 *
 * Calcul incrémental prise par prise, absorption supposée instantanée : hypothèse PRUDENTE
 * (on surestime juste après la prise). ⚠ Estimation statistique, ne remplace pas un éthylotest.
 */

export const ETHANOL_DENSITY = 0.789;
export const DEFAULT_ELIMINATION = 0.15;
export const LEGAL_LIMIT = 0.5;
export const PROBATION_LIMIT = 0.2;
export const OFFENCE_LIMIT = 0.8;
export const DANGER_LIMIT = 2.0;
export const SEX_R = { MALE: 0.7, FEMALE: 0.6, OTHER: 0.65 };

const HOUR = 3_600_000;

export const gramsOf = (volumeMl, abv) => Math.max(0, volumeMl) * Math.max(0, abv) / 100 * ETHANOL_DENSITY;
export const gramsForSips = (sips, sipVolumeMl, abv) => gramsOf(sips * sipVolumeMl, abv);

/** body = { weightKg, sex: 'MALE'|'FEMALE'|'OTHER', elimination } ; intakes = [{ t, grams }] */
export function bacAt(intakes, body, atMs) {
  const r = SEX_R[body.sex] ?? SEX_R.OTHER;
  const beta = body.elimination ?? DEFAULT_ELIMINATION;
  const decay = (bac, ms) => Math.max(0, bac - beta * (ms / HOUR));
  let bac = 0;
  let last = null;
  for (const i of intakes.filter((x) => x.t <= atMs).sort((a, b) => a.t - b.t)) {
    if (last != null) bac = decay(bac, i.t - last);
    bac += i.grams / (r * body.weightKg);
    last = i.t;
  }
  if (last != null) bac = decay(bac, atMs - last);
  return bac;
}

/** Durée (ms) avant de repasser sous le seuil, sans nouvelle prise ; +1 min de marge prudente. */
export function msUntilBelow(bac, threshold, body) {
  if (bac < threshold) return 0;
  const hours = (bac - threshold) / (body.elimination ?? DEFAULT_ELIMINATION);
  return Math.round(hours * HOUR) + 60_000;
}

export function level(bac, drivingLimit) {
  if (bac >= DANGER_LIMIT) return 'DANGER';
  if (bac >= OFFENCE_LIMIT) return 'OFFENCE';
  if (bac >= drivingLimit) return 'OVER_LIMIT';
  return 'OK';
}
