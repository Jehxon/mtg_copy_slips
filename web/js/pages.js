// Lays slips out on pages and renders the pages' HTML.
import { PAD, GAP } from './fit.js';

export const PAPERS = {
  a4: { w: 210, h: 297, label: 'A4' },
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
};
const MIN_MARGIN = 6; // non-printable area of most printers (mm)
const MARK_LEN = 5;

const r3 = (x) => Math.round(x * 1000) / 1000;

/** The grid of slips that fits on a page, centered. */
export function pageGrid(S) {
  const P = PAPERS[S.paper] || PAPERS.a4;
  const g = S.slipGap;
  const cols = Math.max(1, Math.floor((P.w - 2 * MIN_MARGIN + g) / (S.slipW + g)));
  const rows = Math.max(1, Math.floor((P.h - 2 * MIN_MARGIN + g) / (S.slipH + g)));
  const gw = cols * S.slipW + (cols - 1) * g;
  const gh = rows * S.slipH + (rows - 1) * g;
  return { P, cols, rows, per: cols * rows, ox: (P.w - gw) / 2, oy: (P.h - gh) / 2, gw, gh };
}

function marksSVG(G, S) {
  const { P, cols, rows, ox, oy, gw, gh } = G;
  const xs = new Set();
  const ys = new Set();
  for (let c = 0; c < cols; c++) {
    const x = ox + c * (S.slipW + S.slipGap);
    xs.add(r3(x)).add(r3(x + S.slipW));
  }
  for (let r = 0; r < rows; r++) {
    const y = oy + r * (S.slipH + S.slipGap);
    ys.add(r3(y)).add(r3(y + S.slipH));
  }
  let lines = '';
  if (S.slipBorders) {
    for (const x of xs) lines += `<line class="b" x1="${x}" y1="${r3(oy)}" x2="${x}" y2="${r3(oy + gh)}"/>`;
    for (const y of ys) lines += `<line class="b" x1="${r3(ox)}" y1="${y}" x2="${r3(ox + gw)}" y2="${y}"/>`;
  }
  if (S.cropMarks) {
    const lenY = Math.max(0, Math.min(MARK_LEN, oy - 4.5));
    const lenX = Math.max(0, Math.min(MARK_LEN, ox - 4.5));
    for (const x of xs) {
      if (lenY) lines += `<line class="m" x1="${x}" y1="${r3(oy - 1.5 - lenY)}" x2="${x}" y2="${r3(oy - 1.5)}"/>`
        + `<line class="m" x1="${x}" y1="${r3(oy + gh + 1.5)}" x2="${x}" y2="${r3(oy + gh + 1.5 + lenY)}"/>`;
    }
    for (const y of ys) {
      if (lenX) lines += `<line class="m" x1="${r3(ox - 1.5 - lenX)}" y1="${y}" x2="${r3(ox - 1.5)}" y2="${y}"/>`
        + `<line class="m" x1="${r3(ox + gw + 1.5)}" y1="${y}" x2="${r3(ox + gw + 1.5 + lenX)}" y2="${y}"/>`;
    }
  }
  return `<svg class="marks" width="${P.w}mm" height="${P.h}mm" viewBox="0 0 ${P.w} ${P.h}">`
    + '<style>.b{stroke:#c4c4c4;stroke-width:.12}.m{stroke:#222;stroke-width:.15}</style>'
    + `${lines}</svg>`;
}

function innerCuts(L) {
  let h = '';
  for (let k = 1; k < L.c; k++) h += `<div class="icut v" style="left:${r3(PAD + k * L.cw + (k - 0.5) * GAP)}mm"></div>`;
  for (let k = 1; k < L.r; k++) h += `<div class="icut h" style="top:${r3(PAD + k * L.ch + (k - 0.5) * GAP)}mm"></div>`;
  return h;
}

function slipHTML(slip, i, G, S) {
  const col = i % G.cols;
  const row = Math.floor(i / G.cols);
  const x = r3(G.ox + col * (S.slipW + S.slipGap));
  const y = r3(G.oy + row * (S.slipH + S.slipGap));
  const pos = `left:${x}mm;top:${y}mm;width:${S.slipW}mm;height:${S.slipH}mm`;
  if (slip.blank) return `<div class="slip blank" style="${pos}"></div>`;

  const L = slip.layout;
  const grid = `padding:${PAD}mm;gap:${GAP}mm;grid-template-columns:repeat(${L.c},${r3(L.cw)}mm);`
    + `grid-template-rows:repeat(${L.r},${r3(L.ch)}mm);--fs:${L.fs}pt;--h:${r3(L.ch)}mm`;
  return `<div class="slip" data-key="${slip.key}" style="${pos};${grid}">`
    + slip.html.repeat(L.n)
    + (S.innerCuts ? innerCuts(L) : '')
    + '</div>';
}

/** Fills `container` with the pages; returns the page count. */
export function renderPages(container, slips, S) {
  const G = pageGrid(S);
  const pages = [];
  for (let i = 0; i < slips.length; i += G.per) pages.push(slips.slice(i, i + G.per));
  const marks = marksSVG(G, S);
  container.innerHTML = pages
    .map((page, p) => `<div class="page-wrap" style="width:calc(${G.P.w}mm * var(--zoom));height:calc(${G.P.h}mm * var(--zoom))">`
      + `<div class="page" style="width:${G.P.w}mm;height:${G.P.h}mm">`
      + page.map((s, i) => slipHTML(s, i, G, S)).join('')
      + marks
      + `</div><div class="page-num">Page ${p + 1} / ${pages.length}</div></div>`)
    .join('');
  return pages.length;
}
