// Contenu et rendu HTML d'une miniature de carte.
import { assetUrl } from './api.js';

let SYMBOLS = {};
export function setSymbols(map) {
  SYMBOLS = map || {};
}

const LABELS = {
  en: { token: 'Copy token', copy: 'Copy', ability: 'Ability copy' },
  fr: { token: 'Jeton copie', copy: 'Copie', ability: 'Copie de capacité' },
};

// accent : bordure et pastilles ; tint : fond de l'en-tête.
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

export const GROUPS = [
  ['Creature', 'Créatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Battle', 'Batailles'],
  ['Instant', 'Éphémères'],
  ['Sorcery', 'Rituels'],
  ['Enchantment', 'Enchantements'],
  ['Artifact', 'Artefacts'],
  ['Land', 'Terrains'],
];

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Découpe un groupe {…} en symboles connus. Certaines impressions (surtout
 * françaises récentes) écrivent {RRR} pour {R}{R}{R}, {2WW} pour {2}{W}{W},
 * ou {(u/p)} pour {U/P}. Renvoie null si le groupe n'est pas reconnu.
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

// Ponctuation collée à une suite de symboles (y compris l'espace français avant « : »).
const SYM_TRAIL = /^(?:\s?[:;!?»]|[.,)\]”])+/;
const SYM_LEAD = /[(«“]\s?$/;

/**
 * Texte avec les {X} remplacés par les symboles Scryfall (en couleur). Chaque
 * suite de symboles forme un bloc insécable avec sa ponctuation, pour ne jamais
 * couper « {R}{R}{R}. » en fin de ligne.
 */
export function symbolsHTML(text) {
  const items = [];
  const parts = String(text ?? '')
    .replace(/\{\(\}([0-9a-z])\/([0-9a-z])\)\}/gi, '{$1/$2}') // forme cassée « {(}w/b)} »
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

/** Données d'une face, dans la langue choisie (repli sur l'anglais). */
export function faceData(card, i, lang) {
  const multi = card.faces?.length > 0;
  const f = multi ? card.faces[i] : card;
  let fr = lang === 'fr' && card.fr ? (multi ? card.fr.faces?.[i] : card.fr) : null;
  // Pas de texte français (vieilles impressions seulement) : tout en anglais, pour rester cohérent.
  if (fr && !fr.oracle_text && f.oracle_text) fr = null;
  // Scryfall donne parfois « A // B » comme nom de chaque face d'une carte split.
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

/** Liste des paragraphes (capacités) d'une carte, pour l'éditeur. */
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

/** Modèle de la miniature : tout ce qui est affiché, sans la mise en page. */
export function buildContent(card, opts, S) {
  const lang = S.lang;
  const n = faceCount(card);
  const selected = opts.abilities?.length ? new Set(opts.abilities) : null;
  // En copie de capacité, on prend les capacités cochées quelle que soit leur face.
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
 * HTML d'une miniature. withArt=false sert à la mesure du texte : la mise en
 * page est identique, seules les images de fond sont omises.
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
    const paras = f.paras.length || !stat ? f.paras : [{ html: '', bullet: false }];
    h += '<div class="mini-body">';
    paras.forEach((p, j) => {
      const space = stat && j === paras.length - 1 ? `<span class="stat-space">${escapeHTML(stat)}</span>` : '';
      h += `<p${p.bullet ? ' class="bullet"' : ''}>${p.html}${space}</p>`;
    });
    h += '</div>';
    if (stat) h += `<div class="mini-stat${f.loyalty && !f.power ? ' loyalty' : ''}">${escapeHTML(stat)}</div>`;
    h += '</div>';
  });
  return h + '</div>';
}
