// Appels au serveur local (app.py).

async function request(method, url, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(url, init);
  } catch {
    throw new Error("Le serveur local ne répond pas. Est-ce que app.py tourne toujours ?");
  }
  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* réponse vide */
  }
  if (!resp.ok) throw new Error(data?.error || `Erreur ${resp.status}`);
  return data;
}

// Échappe aussi ' ( ) pour pouvoir placer l'adresse dans un url('…') CSS.
export const assetUrl = (url) => '/api/asset?u='
  + encodeURIComponent(url).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const symbols = () => request('GET', '/api/symbols');
export const archidekt = (ref) => request('GET', '/api/archidekt?ref=' + encodeURIComponent(ref));
export const cards = (identifiers) => request('POST', '/api/cards', { identifiers });
export const french = (oracleIds) => request('POST', '/api/fr', { oracle_ids: oracleIds });

export const listDecks = () => request('GET', '/api/decks');
export const getDeck = (slug) => request('GET', '/api/decks/' + encodeURIComponent(slug));
export const saveDeck = (slug, deck) => request('PUT', '/api/decks/' + encodeURIComponent(slug), deck);
export const deleteDeck = (slug) => request('DELETE', '/api/decks/' + encodeURIComponent(slug));
