// Lecture d'une liste de deck au format texte (Archidekt, Moxfield, MTGA, MTGO…).

const SKIP_SECTION = /^(sideboard|side ?board|maybeboard|maybe|considering|tokens?|jetons?|réserve)$/i;
const KEEP_SECTION = /^(deck|main ?deck|mainboard|main|commander|commandant|companion|compagnon)$/i;

/**
 * Renvoie [{ name, qty, set, cn }] : les doublons sont fusionnés et les
 * sections hors deck (sideboard, maybeboard, jetons) sont ignorées.
 */
export function parseDeckText(text) {
  const out = new Map();
  let skipping = false;

  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // En-têtes de section : « Sideboard », « Commander: », « // Maybeboard »…
    const header = line.replace(/[:\s]+$/, '').replace(/\s*\(\d+\)$/, '');
    if (!/^\d/.test(line)) {
      if (SKIP_SECTION.test(header)) { skipping = true; continue; }
      if (KEEP_SECTION.test(header)) { skipping = false; continue; }
    }
    if (/^SB:/i.test(line)) continue;
    if (skipping) continue;

    let qty = 1;
    const q = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (q) {
      qty = parseInt(q[1], 10);
      line = q[2];
    }

    // Annotations des différents sites : *F*, [Catégorie], ^Tag^, #tag…
    line = line
      .replace(/\s+\*[^*]*\*/g, '')
      .replace(/\s+\[[^\]]*\]/g, '')
      .replace(/\s+\^[^^]*\^/g, '')
      .replace(/\s+#\S+/g, '')
      .trim();

    let set = null;
    let cn = null;
    const s = line.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?$/);
    if (s) {
      line = s[1];
      set = s[2].toLowerCase();
      cn = s[3] || null;
    }

    const name = line.replace(/\s+\/\s+/g, ' // ').replace(/\s+/g, ' ').trim();
    if (!name || qty <= 0) continue;

    const key = name.toLowerCase();
    const prev = out.get(key);
    if (prev) prev.qty += qty;
    else out.set(key, { name, qty, set, cn });
  }
  return [...out.values()];
}
