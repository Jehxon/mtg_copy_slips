// Content and HTML rendering of a card mini.
import { assetUrl } from './api.js';

let SYMBOLS = {};
export function setSymbols(map) {
  SYMBOLS = map || {};
}

// Labels printed on the minis, in the card language.
const LABELS = {
  en: { token: 'Copy token', copy: 'Copy', ability: 'Ability copy', illus: 'Illus.' },
  fr: { token: 'Jeton copie', copy: 'Copie', ability: 'Copie de capacité', illus: 'Ill.' },
};

// accent: border and badges; tint: header background.
const PALETTE = {
  W: { accent: '#c2a960', tint: '#f8f2df' },
  U: { accent: '#2f77b6', tint: '#deebf7' },
  B: { accent: '#4b4446', tint: '#e4e0de' },
  R: { accent: '#c8452c', tint: '#f9e0d9' },
  G: { accent: '#2e8449', tint: '#dcefe0' },
  M: { accent: '#b8932a', tint: '#f5ecce' },
  C: { accent: '#87939b', tint: '#eaeef0' },
  L: { accent: '#93745a', tint: '#efe7dd' },
};
const NEUTRAL = { accent: '#6b6b6b', tint: '#eeeeee' };

// [type to look for in the type line, group heading in the card list]
export const GROUPS = [
  ['Creature', 'Creatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Battle', 'Battles'],
  ['Instant', 'Instants'],
  ['Sorcery', 'Sorceries'],
  ['Enchantment', 'Enchantments'],
  ['Artifact', 'Artifacts'],
  ['Land', 'Lands'],
];

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Splits a {…} group into known symbols. Some printings (mostly recent French
 * ones) write {RRR} for {R}{R}{R}, {2WW} for {2}{W}{W}, or {(u/p)} for {U/P}.
 * Returns null if the group isn't recognized.
 */
function symbolTokens(group) {
  if (SYMBOLS[group]) return [group];
  const inner = group.slice(1, -1).replace(/[()\s]/g, '').toUpperCase();
  if (SYMBOLS[`{${inner}}`]) return [`{${inner}}`];
  const parts = inner.match(/[0-9A-Z]\/[0-9A-Z](?:\/P)?|\d+|[A-Z]/g);
  if (!parts || parts.join('') !== inner) return null;
  const syms = parts.map((p) => `{${p}}`);
  return syms.every((s) => SYMBOLS[s]) ? syms : null;
}

// Punctuation glued to a run of symbols (including the French space before ":").
const SYM_TRAIL = /^(?:\s?[:;!?»]|[.,)\]”])+/;
const SYM_LEAD = /[(«“]\s?$/;

/**
 * Text with each {X} replaced by its (colored) Scryfall symbol. Each run of
 * symbols forms an unbreakable block with its punctuation, so "{R}{R}{R}." is
 * never split at the end of a line.
 */
export function symbolsHTML(text) {
  const items = [];
  const parts = String(text ?? '')
    .replace(/\{\(\}([0-9a-z])\/([0-9a-z])\)\}/gi, '{$1/$2}') // broken "{(}w/b)}" form
    .split(/(\{[^{}]+\})/);
  for (const part of parts) {
    const syms = part.startsWith('{') ? symbolTokens(part) : null;
    const last = items[items.length - 1];
    if (syms && last?.syms) last.syms.push(...syms);
    else if (syms) items.push({ syms, lead: '', trail: '' });
    else if (part) items.push({ text: part });
  }
  items.forEach((it, i) => {
    if (!it.syms) return;
    const prev = items[i - 1];
    const next = items[i + 1];
    const lead = prev?.text?.match(SYM_LEAD);
    if (lead) {
      it.lead = lead[0];
      prev.text = prev.text.slice(0, -lead[0].length);
    }
    const trail = next?.text?.match(SYM_TRAIL);
    if (trail) {
      it.trail = trail[0];
      next.text = next.text.slice(trail[0].length);
    }
  });
  return items
    .map((it) => (it.syms
      ? `<span class="syms">${escapeHTML(it.lead)}${it.syms
        .map((s) => `<img class="sym" src="${assetUrl(SYMBOLS[s])}" alt="${escapeHTML(s)}">`)
        .join('')}${escapeHTML(it.trail)}</span>`
      : escapeHTML(it.text)))
    .join('');
}

export function faceCount(card) {
  return card.faces?.length || 1;
}

export function frontType(card) {
  return card.faces?.[0]?.type_line || card.type_line || '';
}

export function cardGroup(card) {
  const type = frontType(card);
  const i = GROUPS.findIndex(([k]) => type.includes(k));
  return i < 0 ? GROUPS.length : i;
}

/** Data for one face, in the chosen language (falls back to English). */
export function faceData(card, i, lang) {
  const multi = card.faces?.length > 0;
  const f = multi ? card.faces[i] : card;
  let fr = lang === 'fr' && card.fr ? (multi ? card.fr.faces?.[i] : card.fr) : null;
  // No French text (old printings only): keep the whole card in English, for consistency.
  if (fr && !fr.oracle_text && f.oracle_text) fr = null;
  // Scryfall sometimes gives "A // B" as the name of each face of a split card.
  const frName = multi && fr?.name?.includes(' // ') ? fr.name.split(' // ')[i] : fr?.name;
  return {
    name: frName || f.name,
    type: fr?.type_line || f.type_line || '',
    text: fr?.oracle_text || f.oracle_text || '',
    enType: f.type_line || '',
    cost: f.mana_cost || '',
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    defense: f.defense,
    colors: f.colors || card.colors || [],
    art: f.art || card.art,
    artist: f.artist || card.artist,
  };
}

export function displayName(card, lang) {
  if (!card) return '';
  if (lang === 'fr' && card.fr) {
    if (card.faces?.length && card.fr.faces) {
      const names = card.fr.faces.map((f, i) => f.name || card.faces[i]?.name);
      if (names[0]?.includes(' // ')) return names[0];
      if (names.every(Boolean)) return names.join(' // ');
    }
    if (card.fr.name) return card.fr.name;
  }
  return card.name;
}

const LOYALTY_RE = /^([+−\-]?(?:\d+|X))\s?:\s*/;

function paragraph(text, reminder, planeswalker) {
  let t = text;
  let prefix = '';
  if (planeswalker) {
    const m = t.match(LOYALTY_RE);
    if (m) {
      prefix = `<span class="loy">${escapeHTML(m[1])}</span>`;
      t = t.slice(m[0].length);
    }
  }
  let html = '';
  for (const part of t.split(/(\([^()]*\))/)) {
    if (!part) continue;
    if (part.startsWith('(') && part.endsWith(')')) {
      if (reminder === 'show') html += `<i class="rem">${symbolsHTML(part)}</i>`;
    } else {
      html += symbolsHTML(part);
    }
  }
  html = html.replace(/ {2,}/g, ' ').trim();
  if (!html && !prefix) return null;
  return { html: prefix + html, bullet: t.startsWith('•') };
}

/** A card's paragraphs (abilities), for the card editor. */
export function abilityList(card, lang) {
  const out = [];
  for (let i = 0; i < faceCount(card); i++) {
    const f = faceData(card, i, lang);
    f.text.split('\n').forEach((t, j) => {
      const p = paragraph(t, 'hide', /Planeswalker/.test(f.enType));
      if (p) out.push({ key: `${i}:${j}`, face: f.name, html: p.html });
    });
  }
  return out;
}

/** The mini's model: everything it shows, without the layout. */
export function buildContent(card, opts, S) {
  const lang = S.lang;
  const n = faceCount(card);
  const selected = opts.abilities?.length ? new Set(opts.abilities) : null;
  // For an ability copy, take the ticked abilities whatever face they're on.
  const faceIdx = opts.face === 'all' || selected ? [...Array(n).keys()] : [Math.min(Number(opts.face) || 0, n - 1)];
  const reminder = opts.reminder && opts.reminder !== 'default' ? opts.reminder : S.reminder;

  const faces = [];
  for (const i of faceIdx) {
    const f = faceData(card, i, lang);
    const pw = /Planeswalker/.test(f.enType);
    const paras = f.text
      .split('\n')
      .map((t, j) => (selected && !selected.has(`${i}:${j}`) ? null : paragraph(t, reminder, pw)))
      .filter(Boolean);
    if (selected && !paras.length) continue;
    faces.push({ ...f, paras });
  }
  if (!faces.length) faces.push({ ...faceData(card, faceIdx[0], lang), paras: [] });

  const first = faces[0];
  const kind = selected ? 'ability' : /\b(Instant|Sorcery)\b/.test(first.enType) ? 'copy' : 'token';
  const art = opts.art && opts.art !== 'default' ? opts.art : S.art;
  return {
    kind,
    label: LABELS[lang]?.[kind] || LABELS.en[kind],
    faces,
    colors: first.colors,
    enType: first.enType,
    art: first.art ? art : 'none',
    artUrl: first.art,
    artist: first.artist,
    lang,
    colorFrames: S.colorFrames,
  };
}

export function colorStyle(colors, enType, colorFrames = true) {
  if (!colorFrames) return { ...NEUTRAL, tintbg: NEUTRAL.tint };
  const cs = (colors || []).filter((c) => PALETTE[c]);
  if (cs.length === 0) {
    const p = /\bLand\b/.test(enType) ? PALETTE.L : PALETTE.C;
    return { ...p, tintbg: p.tint };
  }
  if (cs.length === 1) return { ...PALETTE[cs[0]], tintbg: PALETTE[cs[0]].tint };
  return {
    ...PALETTE.M,
    tintbg: `linear-gradient(90deg, ${cs.map((c) => PALETTE[c].tint).join(', ')})`,
  };
}

function statText(f) {
  if (f.power != null && f.toughness != null) return `${f.power}/${f.toughness}`;
  return f.loyalty || f.defense || '';
}

/**
 * HTML of a mini. withArt=false is used to measure the text: the layout is
 * identical, only the background images are left out.
 */
export function miniHTML(ct, withArt = true) {
  const col = colorStyle(ct.colors, ct.enType, ct.colorFrames);
  let style = `--accent:${col.accent};--tint:${col.tint};--tintbg:${col.tintbg}`;
  if (withArt && ct.art !== 'none') style += `;--art:url('${assetUrl(ct.artUrl)}')`;
  const ability = ct.kind === 'ability';

  let h = `<div class="mini art-${ct.art}" lang="${ct.lang}" style="${style}">`;
  ct.faces.forEach((f, i) => {
    h += '<div class="mini-face"><div class="mini-head"><div class="mini-title">';
    h += `<span class="mini-name">${escapeHTML(f.name)}</span>`;
    if (f.cost && !ability) h += `<span class="mini-cost">${symbolsHTML(f.cost)}</span>`;
    h += '</div><div class="mini-type">';
    if (i === 0) h += `<span class="mini-label">${escapeHTML(ct.label)}</span>`;
    if (!ability) h += escapeHTML(f.type);
    h += '</div></div>';
    if (i === 0 && ct.art === 'top') h += '<div class="mini-artbox"></div>';

    const stat = ability ? '' : statText(f);
    const space = stat ? `<span class="stat-space">${escapeHTML(stat)}</span>` : '';
    // Art credit (required by Scryfall), on the last line like on real cards.
    const credit = i === 0 && ct.art !== 'none' && ct.artist
      ? `${LABELS[ct.lang]?.illus || LABELS.en.illus} ${ct.artist} · © WotC`
      : '';
    const paras = f.paras.length || !stat || credit ? f.paras : [{ html: '', bullet: false }];
    h += '<div class="mini-body">';
    paras.forEach((p, j) => {
      const end = !credit && j === paras.length - 1 ? space : '';
      h += `<p${p.bullet ? ' class="bullet"' : ''}>${p.html}${end}</p>`;
    });
    if (credit) h += `<p class="mini-credit">${escapeHTML(credit)}${space}</p>`;
    h += '</div>';
    if (stat) h += `<div class="mini-stat${f.loyalty && !f.power ? ' loyalty' : ''}">${escapeHTML(stat)}</div>`;
    h += '</div>';
  });
  return h + '</div>';
}
