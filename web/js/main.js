// Copy Slips : état de l'application, interface et orchestration.
import * as api from './api.js';
import { parseDeckText } from './parse.js';
import {
  setSymbols, buildContent, miniHTML, faceCount, faceData, displayName, abilityList,
  cardGroup, frontType, colorStyle, escapeHTML, GROUPS,
} from './mini.js';
import { initMeasure, computeLayout, layoutFor, availableCounts } from './fit.js';
import { renderPages, pageGrid, PAPERS } from './pages.js';

const DEFAULTS = Object.freeze({
  lang: 'en',
  font: 'barlow',
  minFont: 6,
  maxFont: 10,
  reminder: 'hide',
  maxCopies: 9,
  art: 'none',
  artStrength: 0.3,
  colorFrames: true,
  slipW: 63,
  slipH: 88,
  innerCuts: true,
  blanksMode: 'auto',
  blanksCount: 0,
  fillPage: false,
  paper: 'a4',
  slipGap: 0,
  slipBorders: true,
  cropMarks: true,
});
const DEFAULT_OPTS = Object.freeze({ copies: 'auto', slips: null, face: 0, art: 'default', reminder: 'default', abilities: [] });

const FONTS = {
  barlow: '"Barlow Semi Condensed", "Arial Narrow", sans-serif',
  crimson: '"Crimson Pro", Georgia, serif',
};
const ART_LABELS = { none: 'Aucune', top: 'Encadré', band: 'Bandeau', frame: 'Cadre', bg: 'Fond estompé' };
const REMINDER_LABELS = { hide: 'Masqué', show: 'Affiché' };
const LS_LAST = 'copyslips.lastDeck';
const LS_ZOOM = 'copyslips.zoom';

const state = {
  deck: null, // { slug, name, source }
  S: { ...DEFAULTS },
  cards: [], // [{ key, id, name, qty, selected, opts }]
  data: new Map(), // id Scryfall -> carte simplifiée (+ .fr)
  results: new Map(), // key -> { layout, html }
  open: null, // key de la carte dont l'éditeur est ouvert
  filter: '',
  onlySelected: false,
  decks: [],
  zoom: 'fit',
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmt = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : ce n'est qu'un confort */
  }
}

// --------------------------------------------------------------------------- notifications

let toastTimer = 0;
function toast(msg, kind = '', ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

async function withBusy(btn, fn) {
  btn.classList.add('busy');
  btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error', 7000);
  } finally {
    btn.classList.remove('busy');
    btn.disabled = false;
  }
}

// --------------------------------------------------------------------------- cartes

const cardOf = (c) => (c.id ? state.data.get(c.id) : null);
const nameOf = (c) => displayName(cardOf(c), state.S.lang) || c.name;
const slipCount = (c) => c.opts.slips ?? c.qty;

function sortedCards() {
  return state.cards
    .map((c) => ({ c, g: cardOf(c) ? cardGroup(cardOf(c)) : 99, n: fold(nameOf(c)) }))
    .sort((a, b) => a.g - b.g || a.n.localeCompare(b.n))
    .map((x) => x.c);
}

function computeAll() {
  const S = state.S;
  const results = new Map();
  for (const c of state.cards) {
    const card = cardOf(c);
    if (!c.selected || !card) continue;
    const content = buildContent(card, c.opts, S);
    const layout = computeLayout(miniHTML(content, false), c.opts.copies, S);
    results.set(c.key, { layout, html: miniHTML(content, true) });
  }
  state.results = results;
}

function slipPlan() {
  const S = state.S;
  const slips = [];
  for (const c of sortedCards()) {
    const r = state.results.get(c.key);
    if (!r) continue;
    for (let i = 0; i < slipCount(c); i++) slips.push({ key: c.key, ...r });
  }
  const printed = slips.length;
  const total = state.cards.reduce((n, c) => n + c.qty, 0);
  let blanks = 0;
  if (S.blanksMode === 'auto') blanks = Math.max(0, total - printed);
  else if (S.blanksMode === 'fixed') blanks = Math.max(0, Math.round(S.blanksCount) || 0);
  const per = pageGrid(S).per;
  const rest = (printed + blanks) % per;
  if (S.fillPage && rest) blanks += per - rest;
  for (let i = 0; i < blanks; i++) slips.push({ blank: true });
  return { slips, printed, blanks, per };
}

// --------------------------------------------------------------------------- rendu

let frame = 0;
let saveRequested = false;
function update({ save = true } = {}) {
  if (save) saveRequested = true;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    computeAll();
    renderPreview();
    renderList();
    if (saveRequested) {
      saveRequested = false;
      scheduleSave();
    }
  });
}

function applyGlobals() {
  const root = document.documentElement.style;
  root.setProperty('--mini-font', FONTS[state.S.font] || FONTS.barlow);
  root.setProperty('--veil', String(1 - state.S.artStrength));
  const P = PAPERS[state.S.paper] || PAPERS.a4;
  $('#page-size').textContent = `@page { size: ${P.w}mm ${P.h}mm; margin: 0; }`;
}

function currentZoom() {
  if (state.zoom !== 'fit') return state.zoom;
  const P = PAPERS[state.S.paper] || PAPERS.a4;
  const box = $('#preview-scroll');
  const px = 96 / 25.4;
  const z = Math.min((box.clientWidth - 56) / (P.w * px), (box.clientHeight - 90) / (P.h * px));
  return Math.max(0.2, Math.min(1.6, z));
}

function applyZoom() {
  const z = currentZoom();
  document.documentElement.style.setProperty('--zoom', z.toFixed(3));
  $('#zoom').value = z;
}

function renderPreview() {
  const pagesEl = $('#pages');
  $('#preview-empty').hidden = !!state.deck;
  if (!state.deck) {
    pagesEl.innerHTML = '';
    $('#stats').textContent = '';
    return;
  }
  const plan = slipPlan();
  const n = renderPages(pagesEl, plan.slips, state.S);
  $('#stats').innerHTML = plan.slips.length
    ? `<b>${plural(n, 'page', 'pages')}</b> · ${plural(plan.printed, 'rectangle imprimé', 'rectangles imprimés')}`
      + ` · ${plural(plan.blanks, 'vierge', 'vierges')} · ${plan.per} par page`
    : 'Cochez des cartes dans la liste pour les ajouter à la feuille.';
  applyZoom();
}

function rowHTML(c) {
  const card = cardOf(c);
  const r = state.results.get(c.key);
  const name = nameOf(c);
  const col = card ? colorStyle(card.colors, frontType(card)) : null;
  let badge = '';
  if (!card) {
    badge = '<span class="badge warn" title="Carte introuvable sur Scryfall : vérifiez son nom.">introuvable</span>';
  } else if (r) {
    const L = r.layout;
    const title = L.ok
      ? `${plural(L.n, 'miniature', 'miniatures')} par rectangle (grille ${L.c}×${L.r}), texte en ${fmt(L.fs)} pt`
      : 'Texte trop long : il sera coupé. Choisissez moins de copies ou baissez la taille minimale.';
    badge = `<span class="badge${L.ok ? '' : ' warn'}" title="${title}">×${L.n} · ${fmt(L.fs)} pt</span>`;
  }
  return `<div class="row${c.selected ? ' sel' : ''}${state.open === c.key ? ' open' : ''}" data-key="${escapeHTML(c.key)}">`
    + `<input type="checkbox" data-act="toggle"${c.selected ? ' checked' : ''}${card ? '' : ' disabled'} aria-label="Imprimer ${escapeHTML(name)}">`
    + `<button class="row-main" data-act="open"${card ? '' : ' disabled'}>`
    + `<span class="pip" style="background:${col ? col.accent : '#d0d0d0'}"></span>`
    + `<span class="row-name">${escapeHTML(name)}</span>`
    + (c.qty > 1 ? `<span class="row-qty">×${c.qty}</span>` : '')
    + (card ? '<svg class="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '')
    + `</button>${badge}</div>`;
}

function options(list, current) {
  return list.map(([v, label]) => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${label}</option>`).join('');
}

function editorHTML(c) {
  const card = cardOf(c);
  const S = state.S;
  const sig = miniHTML(buildContent(card, c.opts, S), false);
  const auto = computeLayout(sig, 'auto', S);

  const copyOpts = [['auto', `Auto : ${plural(auto.n, 'copie', 'copies')} · ${fmt(auto.fs)} pt`]];
  for (const n of availableCounts(S, Math.max(16, S.maxCopies))) {
    const l = layoutFor(sig, n, S);
    copyOpts.push([n, `${plural(n, 'copie', 'copies')} · ${l.ok ? `${fmt(l.fs)} pt` : 'texte coupé'}`]);
  }

  const nFaces = faceCount(card);
  const faceOpts = [...Array(nFaces).keys()].map((i) => [i, escapeHTML(faceData(card, i, S.lang).name)]);
  faceOpts.push(['all', 'Toutes les faces']);

  const hasArt = !!(card.art || card.faces?.some((f) => f.art));
  const artOpts = [['default', `Par défaut (${ART_LABELS[S.art]})`], ...Object.entries(ART_LABELS)];
  const remOpts = [['default', `Par défaut (${REMINDER_LABELS[S.reminder]})`], ['hide', 'Masquer'], ['show', 'Afficher']];

  const r = state.results.get(c.key);
  const warn = r && !r.layout.ok
    ? `<p class="ed-warn">Le texte ne tient pas, même en ${fmt(S.minFont)} pt : il sera coupé. Choisissez moins de copies, masquez le texte de rappel ou baissez la taille minimale.</p>`
    : '';

  const selected = new Set(c.opts.abilities || []);
  const abilities = abilityList(card, S.lang)
    .map((a) => `<label class="ab"><input type="checkbox" data-ability="${a.key}"${selected.has(a.key) ? ' checked' : ''}>`
      + `<span>${nFaces > 1 ? `<span class="ab-face">${escapeHTML(a.face)} : </span>` : ''}${a.html}</span></label>`)
    .join('');

  return `<div class="editor" data-key="${escapeHTML(c.key)}"><div class="ed-grid">`
    + `<label class="ed-field">Copies par rectangle<select data-opt="copies">${options(copyOpts, c.opts.copies)}</select></label>`
    + `<label class="ed-field">Rectangles à imprimer<input type="number" min="0" max="50" step="1" data-opt="slips" value="${slipCount(c)}"></label>`
    + (nFaces > 1 ? `<label class="ed-field wide">Face<select data-opt="face">${options(faceOpts, c.opts.face)}</select></label>` : '')
    + `<label class="ed-field">Illustration<select data-opt="art"${hasArt ? '' : ' disabled'}>${options(artOpts, c.opts.art)}</select></label>`
    + `<label class="ed-field">Texte de rappel<select data-opt="reminder">${options(remOpts, c.opts.reminder)}</select></label>`
    + `</div>${warn}`
    + (abilities ? `<div class="ed-sub">Copie de capacité <small>· cochez pour n'imprimer que ces capacités</small></div>${abilities}` : '')
    + '<div class="ed-actions"><button class="btn ghost small" data-act="locate">Voir dans l\'aperçu</button>'
    + '<button class="btn ghost small" data-act="reset">Réglages par défaut</button></div></div>';
}

function renderList() {
  const el = $('#card-list');
  const nSel = state.cards.filter((c) => c.selected).length;
  $('#tab-count').textContent = nSel ? String(nSel) : '';
  if (!state.deck) {
    el.innerHTML = '<div class="empty-list">Aucun deck ouvert.<br><button class="btn primary" data-goto="import">Importer un deck</button></div>';
    return;
  }
  const q = fold(state.filter.trim());
  const groups = new Map();
  for (const c of sortedCards()) {
    if (state.onlySelected && !c.selected) continue;
    if (q && !fold(`${c.name} ${nameOf(c)}`).includes(q)) continue;
    const card = cardOf(c);
    const g = card ? cardGroup(card) : -1;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  let html = '';
  for (const [g, list] of groups) {
    const label = g === -1 ? 'Introuvables' : g < GROUPS.length ? GROUPS[g][1] : 'Autres';
    html += `<div class="group-head"><span>${label}</span><span>${list.reduce((n, c) => n + c.qty, 0)}</span></div>`;
    for (const c of list) {
      html += rowHTML(c);
      if (state.open === c.key && cardOf(c)) html += editorHTML(c);
    }
  }
  el.innerHTML = html || '<div class="empty-list">Aucune carte ne correspond.</div>';
}

function renderDeckBar() {
  const sel = $('#deck-select');
  const first = state.decks.length ? 'Choisir un deck…' : 'Aucun deck sauvegardé';
  sel.innerHTML = `<option value="">${first}</option>`
    + state.decks.map((d) => `<option value="${escapeHTML(d.slug)}">${escapeHTML(d.name)}</option>`).join('');
  sel.value = state.deck?.slug || '';
  $('#deck-meta').hidden = !state.deck;
  $('#btn-delete').hidden = !state.deck;
  $('#btn-refresh').hidden = state.deck?.source?.type !== 'archidekt';
  $('#merge-field').hidden = !state.deck;
  if (state.deck) $('#deck-name').value = state.deck.name;
}

function syncSettingsForm() {
  for (const el of $$('[data-setting]')) {
    const v = state.S[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  $('#blanks-count-field').hidden = state.S.blanksMode !== 'fixed';
}

function setTab(tab) {
  for (const b of $$('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const id of ['cards', 'settings', 'import']) $(`#tab-${id}`).hidden = id !== tab;
}

function highlight(key, on) {
  for (const el of $$(`#pages .slip[data-key="${CSS.escape(key)}"]`)) el.classList.toggle('hl', on);
}

function locate(key) {
  const el = $(`#pages .slip[data-key="${CSS.escape(key)}"]`);
  if (!el) {
    toast("Cette carte n'est pas sur la feuille : cochez-la d'abord.");
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  highlight(key, true);
  setTimeout(() => highlight(key, false), 1600);
}

// --------------------------------------------------------------------------- sauvegarde

let saveTimer = 0;
function setSaveStatus(text, kind = '') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = `save-status ${kind}`;
}

function deckJSON() {
  return {
    version: 1,
    name: state.deck.name,
    source: state.deck.source,
    settings: state.S,
    cards: state.cards.map(({ id, name, qty, selected, opts }) => ({ id, name, qty, selected, opts })),
  };
}

function scheduleSave() {
  if (!state.deck) return;
  setSaveStatus('Modifié');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!state.deck) return;
  try {
    await api.saveDeck(state.deck.slug, deckJSON());
    setSaveStatus('Enregistré', 'ok');
  } catch (e) {
    setSaveStatus('Non enregistré');
    toast(e.message, 'error', 6000);
  }
}

function makeSlug(name) {
  const base = fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deck';
  const used = new Set(state.decks.map((d) => d.slug));
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

// --------------------------------------------------------------------------- import

/** Résout une liste d'entrées ({id?, name, qty, set?, cn?, selected?, opts?}) via Scryfall. */
async function resolveEntries(entries) {
  const idents = entries.map((e) => (e.id
    ? { id: e.id, name: e.name }
    : { name: e.name, ...(e.set ? { set: e.set } : {}), ...(e.cn ? { collector_number: e.cn } : {}) }));
  const res = await api.cards(idents);
  const out = new Map();
  const missing = [];
  entries.forEach((e, i) => {
    const card = res.cards[i];
    if (card) state.data.set(card.id, card);
    else missing.push(e.name);
    const key = card ? card.id : `missing:${fold(e.name)}`;
    const prev = out.get(key);
    if (prev) {
      prev.qty += e.qty || 1;
      return;
    }
    out.set(key, {
      key,
      id: card ? card.id : null,
      name: card ? card.name : e.name,
      qty: e.qty || 1,
      selected: !!e.selected && !!card,
      opts: { ...DEFAULT_OPTS, ...(e.opts || {}) },
    });
  });
  return { cards: [...out.values()], missing };
}

async function importDeck(name, entries, source, merge) {
  if (!entries.length) throw new Error('La liste est vide.');
  const { cards, missing } = await resolveEntries(entries);
  if (merge && state.deck) {
    const old = new Map(state.cards.map((c) => [fold(c.name), c]));
    for (const c of cards) {
      const o = old.get(fold(c.name));
      if (o) {
        c.selected = o.selected && !!cardOf(c);
        c.opts = { ...o.opts };
      }
    }
    state.deck.source = source;
  } else {
    await saveNow();
    state.decks = await api.listDecks();
    state.deck = { slug: makeSlug(name), name, source };
  }
  state.cards = cards;
  state.open = null;
  lsSet(LS_LAST, state.deck.slug);
  await saveNow();
  state.decks = await api.listDecks();
  renderDeckBar();
  setTab('cards');
  update({ save: false });

  const found = cards.filter((c) => c.id).length;
  if (missing.length) {
    const list = missing.slice(0, 4).join(', ') + (missing.length > 4 ? '…' : '');
    toast(`${plural(found, 'carte importée', 'cartes importées')}. Introuvables : ${list}`, 'error', 9000);
  } else {
    toast(`${plural(found, 'carte importée', 'cartes importées')}. Cochez celles que vous copiez.`);
  }
  if (state.S.lang === 'fr') ensureFrench();
}

async function importArchidekt(ref, merge) {
  const deck = await api.archidekt(ref);
  const entries = deck.cards.map((c) => ({ id: c.id, name: c.name, qty: c.qty }));
  const source = { type: 'archidekt', id: deck.id, url: `https://archidekt.com/decks/${deck.id}` };
  await importDeck(deck.name, entries, source, merge);
}

async function openDeck(slug) {
  await saveNow();
  const d = await api.getDeck(slug);
  const { cards } = await resolveEntries(d.cards || []);
  state.S = { ...DEFAULTS, ...(d.settings || {}) };
  state.deck = { slug, name: d.name || slug, source: d.source || null };
  state.cards = cards;
  state.open = null;
  state.filter = '';
  $('#card-search').value = '';
  lsSet(LS_LAST, slug);
  syncSettingsForm();
  applyGlobals();
  renderDeckBar();
  setTab('cards');
  update({ save: false });
  if (state.S.lang === 'fr') ensureFrench();
}

let frenchRun = null;
function ensureFrench() {
  if (!frenchRun) frenchRun = loadFrench().finally(() => { frenchRun = null; });
  return frenchRun;
}

async function loadFrench() {
  const ids = [];
  // Les cartes cochées d'abord : ce sont elles qui apparaissent dans l'aperçu.
  for (const c of [...state.cards].sort((a, b) => b.selected - a.selected)) {
    const d = cardOf(c);
    if (d && d.fr === undefined && d.oracle_id && !ids.includes(d.oracle_id)) ids.push(d.oracle_id);
  }
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 20) {
    if (state.S.lang !== 'fr') return;
    toast(`Chargement des textes français… ${i} / ${ids.length}`, '', 0);
    let res;
    try {
      res = await api.french(ids.slice(i, i + 20));
    } catch (e) {
      toast(e.message, 'error', 7000);
      return;
    }
    for (const d of state.data.values()) if (d.oracle_id in res) d.fr = res[d.oracle_id] || null;
    update({ save: false });
  }
  toast('Textes français chargés.');
}

// --------------------------------------------------------------------------- impression

async function printNow() {
  const plan = slipPlan();
  if (!state.deck || !plan.slips.length) {
    toast('Rien à imprimer : cochez des cartes ou activez les rectangles vierges.');
    return;
  }
  await saveNow();
  toast("Préparation de l'impression…", '', 0);
  const arts = new Set();
  for (const r of state.results.values()) {
    const m = r.html.match(/url\('([^']+)'\)/);
    if (m) arts.add(m[1]);
  }
  await Promise.all([
    ...$$('#pages img').map((img) => (img.complete ? null : img.decode().catch(() => {}))),
    ...[...arts].map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {});
    }),
  ]);
  $('#toast').classList.remove('show');
  window.print();
}

// --------------------------------------------------------------------------- événements

function parseOpt(name, value) {
  if (name === 'copies') return value === 'auto' ? 'auto' : Number(value);
  if (name === 'face') return value === 'all' ? 'all' : Number(value);
  return value;
}

function quickSelect(kind) {
  for (const c of state.cards) {
    const d = cardOf(c);
    if (!d) continue;
    const type = frontType(d);
    const text = [d.oracle_text, ...(d.faces || []).map((f) => f.oracle_text)].join('\n');
    if (kind === 'none') c.selected = false;
    else if (kind === 'all' && !/\bBasic\b/.test(type)) c.selected = true;
    else if (kind === 'creature' && /\bCreature\b/.test(type)) c.selected = true;
    else if (kind === 'spell' && /\b(Instant|Sorcery)\b/.test(type)) c.selected = true;
    else if (kind === 'aura' && /\bAura\b/.test(type)) c.selected = true;
    else if (kind === 'mutate' && /\bMutate\b/.test(text)) c.selected = true;
  }
  update();
}

function bindEvents() {
  // Onglets et raccourcis « aller à ».
  for (const b of $$('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) setTab(go.dataset.goto);
  });

  // Decks.
  $('#deck-select').addEventListener('change', async (e) => {
    const slug = e.target.value;
    if (!slug) {
      e.target.value = state.deck?.slug || '';
      return;
    }
    try {
      await openDeck(slug);
    } catch (err) {
      toast(err.message, 'error', 7000);
      renderDeckBar();
    }
  });
  $('#deck-name').addEventListener('change', async (e) => {
    const name = e.target.value.trim();
    if (!state.deck || !name) {
      renderDeckBar();
      return;
    }
    state.deck.name = name;
    await saveNow();
    state.decks = await api.listDecks();
    renderDeckBar();
  });
  $('#btn-delete').addEventListener('click', async () => {
    if (!state.deck || !window.confirm(`Supprimer le deck « ${state.deck.name} » et ses réglages ?`)) return;
    clearTimeout(saveTimer);
    const slug = state.deck.slug;
    state.deck = null;
    state.cards = [];
    state.results = new Map();
    lsSet(LS_LAST, null);
    try {
      await api.deleteDeck(slug);
      state.decks = await api.listDecks();
    } catch (err) {
      toast(err.message, 'error');
    }
    setSaveStatus('');
    renderDeckBar();
    setTab('import');
    update({ save: false });
  });
  $('#btn-refresh').addEventListener('click', (e) => {
    const src = state.deck?.source;
    if (src?.type !== 'archidekt') return;
    withBusy(e.currentTarget, () => importArchidekt(src.url, true));
  });

  // Import.
  $('#btn-arch').addEventListener('click', (e) => {
    const ref = $('#arch-url').value.trim();
    if (!ref) {
      toast('Collez le lien du deck Archidekt.');
      return;
    }
    withBusy(e.currentTarget, () => importArchidekt(ref, false));
  });
  $('#arch-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-arch').click();
  });
  $('#btn-text').addEventListener('click', (e) => {
    const entries = parseDeckText($('#text-list').value);
    const merge = !!state.deck && $('#text-merge').checked;
    const name = $('#text-name').value.trim() || (merge ? state.deck.name : 'Deck importé');
    withBusy(e.currentTarget, () => importDeck(name, entries, { type: 'text' }, merge));
  });

  // Liste des cartes.
  $('#card-search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderList();
  });
  $('#only-selected').addEventListener('change', (e) => {
    state.onlySelected = e.target.checked;
    renderList();
  });
  for (const b of $$('[data-quick]')) b.addEventListener('click', () => quickSelect(b.dataset.quick));

  const list = $('#card-list');
  const entryOf = (el) => {
    const key = el.closest('[data-key]')?.dataset.key;
    return state.cards.find((c) => c.key === key);
  };
  list.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act || act.tagName === 'INPUT') return;
    const c = entryOf(act);
    if (!c) return;
    if (act.dataset.act === 'open') {
      state.open = state.open === c.key ? null : c.key;
      renderList();
    } else if (act.dataset.act === 'locate') {
      locate(c.key);
    } else if (act.dataset.act === 'reset') {
      c.opts = { ...DEFAULT_OPTS };
      update();
    }
  });
  list.addEventListener('change', (e) => {
    const el = e.target;
    const c = entryOf(el);
    if (!c) return;
    if (el.dataset.act === 'toggle') {
      c.selected = el.checked;
    } else if (el.dataset.opt === 'slips') {
      const n = Math.round(Number(el.value));
      c.opts.slips = Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : null;
      if (c.opts.slips === c.qty) c.opts.slips = null;
    } else if (el.dataset.opt) {
      c.opts[el.dataset.opt] = parseOpt(el.dataset.opt, el.value);
    } else if (el.dataset.ability) {
      const set = new Set(c.opts.abilities || []);
      if (el.checked) set.add(el.dataset.ability);
      else set.delete(el.dataset.ability);
      c.opts.abilities = [...set];
    } else {
      return;
    }
    update();
  });
  let hovered = null;
  list.addEventListener('mouseover', (e) => {
    const key = e.target.closest('.row, .editor')?.dataset.key || null;
    if (key === hovered) return;
    if (hovered) highlight(hovered, false);
    hovered = key;
    if (key) highlight(key, true);
  });
  list.addEventListener('mouseleave', () => {
    if (hovered) highlight(hovered, false);
    hovered = null;
  });

  // Clic sur un rectangle de l'aperçu : ouvre la carte dans la liste.
  $('#pages').addEventListener('click', (e) => {
    const slip = e.target.closest('.slip[data-key]');
    if (!slip) return;
    state.open = slip.dataset.key;
    state.filter = '';
    $('#card-search').value = '';
    setTab('cards');
    renderList();
    $(`#card-list .row[data-key="${CSS.escape(slip.dataset.key)}"]`)?.scrollIntoView({ block: 'center' });
  });

  // Réglages.
  const settings = $('#settings');
  settings.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const k = el.dataset.setting;
    let v = el.value;
    if (el.type === 'checkbox') {
      v = el.checked;
    } else if (el.type === 'number' || el.type === 'range') {
      v = parseFloat(el.value);
      if (!Number.isFinite(v)) {
        syncSettingsForm();
        return;
      }
      v = Math.min(Math.max(v, parseFloat(el.min)), parseFloat(el.max));
    }
    state.S[k] = v;
    if (k === 'minFont' && state.S.maxFont < v) state.S.maxFont = v;
    if (k === 'maxFont' && state.S.minFont > v) state.S.minFont = v;
    syncSettingsForm();
    applyGlobals();
    if (k === 'lang' && v === 'fr') ensureFrench();
    update();
  });
  settings.addEventListener('input', (e) => {
    // Aperçu immédiat de l'intensité, sans recalcul.
    if (e.target.dataset.setting === 'artStrength') {
      document.documentElement.style.setProperty('--veil', String(1 - parseFloat(e.target.value)));
    }
  });
  $('#btn-reset-settings').addEventListener('click', () => {
    state.S = { ...DEFAULTS };
    syncSettingsForm();
    applyGlobals();
    update();
  });

  // Aperçu.
  $('#zoom').addEventListener('input', (e) => {
    state.zoom = parseFloat(e.target.value);
    lsSet(LS_ZOOM, String(state.zoom));
    applyZoom();
  });
  for (const b of $$('[data-zoom]')) {
    b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      state.zoom = z === 'fit' ? 'fit' : Math.max(0.2, Math.min(1.6, currentZoom() + (z === '+' ? 0.1 : -0.1)));
      lsSet(LS_ZOOM, String(state.zoom));
      applyZoom();
    });
  }
  window.addEventListener('resize', () => {
    if (state.zoom === 'fit') applyZoom();
  });
  $('#btn-print').addEventListener('click', printNow);

  // Dernière sauvegarde si l'onglet est fermé pendant le délai d'enregistrement.
  window.addEventListener('pagehide', () => {
    if (!saveTimer || !state.deck) return;
    fetch(`/api/decks/${encodeURIComponent(state.deck.slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deckJSON()),
      keepalive: true,
    });
  });
}

function loadFonts() {
  const faces = [
    '400 10pt "Barlow Semi Condensed"', 'italic 400 10pt "Barlow Semi Condensed"',
    '600 10pt "Barlow Semi Condensed"', 'italic 600 10pt "Barlow Semi Condensed"',
    '400 10pt "Crimson Pro"', 'italic 400 10pt "Crimson Pro"', '600 10pt "Crimson Pro"',
  ];
  return Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {});
}

async function init() {
  initMeasure($('#measure'));
  bindEvents();
  const z = parseFloat(lsGet(LS_ZOOM));
  state.zoom = Number.isFinite(z) ? z : 'fit';
  syncSettingsForm();
  applyGlobals();
  setTab('import');
  renderDeckBar();
  renderList();
  renderPreview();

  const fonts = loadFonts();
  try {
    setSymbols(await api.symbols());
  } catch (e) {
    toast(`Symboles de mana indisponibles : ${e.message}`, 'error', 7000);
  }
  await fonts;
  try {
    state.decks = await api.listDecks();
  } catch (e) {
    toast(e.message, 'error', 7000);
  }
  renderDeckBar();

  const wanted = new URLSearchParams(location.search).get('deck') || lsGet(LS_LAST);
  if (wanted && state.decks.some((d) => d.slug === wanted)) {
    try {
      await openDeck(wanted);
    } catch (e) {
      toast(e.message, 'error', 7000);
    }
  }
}

init();
