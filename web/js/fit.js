// Calibrage : choix de la grille de miniatures dans un rectangle et de la
// plus grande taille de police qui laisse tout le texte visible.
//
// La mesure se fait dans le navigateur, sur une miniature réelle placée hors
// écran : c'est le même moteur qui imprimera, donc ce qui tient ici tient
// sur le papier.

export const PAD = 1.2; // marge intérieure du rectangle (mm)
export const GAP = 1.0; // espace entre deux miniatures (mm)
const MIN_W = 19; // largeur minimale d'une miniature (mm) : en dessous, une ligne ne contient que 2-3 mots
const SAFETY_W = 0.2; // marge de sécurité de la mesure (mm), contre les écarts d'arrondi écran/impression
const SAFETY_H = 0.3;
const MIN_H = 8.5; // hauteur minimale d'une miniature (mm)

let root = null;
const cache = new Map();

export function initMeasure(el) {
  root = el;
}

export function clearFitCache() {
  cache.clear();
}

function probe(html, w, h) {
  root.innerHTML = `<div class="mini-cell" style="width:${w - SAFETY_W}mm;height:${h - SAFETY_H}mm;--h:${h}mm">${html}</div>`;
  return root.firstElementChild.firstElementChild;
}

function fits(mini, fs) {
  mini.style.setProperty('--fs', `${fs}pt`);
  const box = mini.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(mini).borderBottomWidth) || 0;
  const bottom = mini.lastElementChild.getBoundingClientRect().bottom;
  return bottom <= box.bottom - border + 0.25 && mini.scrollWidth <= mini.clientWidth + 1;
}

/** Plus grande police (pt, au dixième) entre min et max qui tient dans w×h mm. */
export function bestFont(html, w, h, S) {
  const key = `${S.font}|${S.minFont}|${S.maxFont}|${w.toFixed(2)}x${h.toFixed(2)}|${html}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mini = probe(html, w, h);
  let res;
  if (!fits(mini, S.minFont)) {
    res = { fs: S.minFont, ok: false };
  } else if (fits(mini, S.maxFont)) {
    res = { fs: S.maxFont, ok: true };
  } else {
    let lo = S.minFont;
    let hi = S.maxFont;
    while (hi - lo > 0.05) {
      const mid = (lo + hi) / 2;
      if (fits(mini, mid)) lo = mid;
      else hi = mid;
    }
    res = { fs: Math.floor(lo * 10) / 10, ok: true };
  }
  root.innerHTML = '';
  cache.set(key, res);
  return res;
}

/** Toutes les grilles possibles (lignes × colonnes) dans un rectangle. */
export function gridCandidates(S) {
  const W = S.slipW - 2 * PAD;
  const H = S.slipH - 2 * PAD;
  const out = [];
  for (let c = 1; c <= 4; c++) {
    for (let r = 1; r <= 10; r++) {
      const cw = (W - (c - 1) * GAP) / c;
      const ch = (H - (r - 1) * GAP) / r;
      if (cw >= MIN_W && ch >= MIN_H) out.push({ r, c, n: r * c, cw, ch });
    }
  }
  return out;
}

export function availableCounts(S, limit = 16) {
  return [...new Set(gridCandidates(S).map((g) => g.n))].filter((n) => n <= limit).sort((a, b) => a - b);
}

function better(a, b) {
  if (!b) return true;
  if (a.ok !== b.ok) return a.ok;
  if (a.fs !== b.fs) return a.fs > b.fs;
  return a.cw * a.ch > b.cw * b.ch;
}

/** Meilleure grille pour exactement n miniatures (ou null si impossible). */
export function layoutFor(html, n, S) {
  let best = null;
  for (const g of gridCandidates(S)) {
    if (g.n !== n) continue;
    const cand = { ...g, ...bestFont(html, g.cw, g.ch, S) };
    if (better(cand, best)) best = cand;
  }
  return best;
}

/**
 * copies = 'auto' : le plus de miniatures possible (au plus S.maxCopies)
 * avec une police au moins égale à S.minFont. Sinon, le nombre demandé.
 */
export function computeLayout(html, copies, S) {
  if (copies !== 'auto') {
    const fixed = layoutFor(html, Number(copies), S);
    if (fixed) return fixed;
  }
  const counts = availableCounts(S, Math.max(1, S.maxCopies)).reverse();
  for (const n of counts) {
    const l = layoutFor(html, n, S);
    if (l?.ok) return l;
  }
  return layoutFor(html, 1, S) || { r: 1, c: 1, n: 1, cw: S.slipW - 2 * PAD, ch: S.slipH - 2 * PAD, fs: S.minFont, ok: false };
}
