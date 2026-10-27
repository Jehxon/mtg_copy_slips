#!/usr/bin/env python3
"""Copy Slips : serveur local de l'outil.

Utilise uniquement la bibliothèque standard de Python (3.9+).
Lancement :  python app.py        options : --port 8765  --no-browser

Rôle du serveur :
  - servir l'interface web (dossier web/) ;
  - relayer les appels à Archidekt et Scryfall (en respectant leurs limites) ;
  - mettre en cache les données de cartes, traductions et images (data/cache/) ;
  - sauvegarder les decks et leurs réglages (data/decks/).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
DECKS_DIR = DATA_DIR / "decks"

USER_AGENT = "CopySlips/1.0 (outil local d'impression de fiches de copie MTG)"
SCRYFALL = "https://api.scryfall.com"
ARCHIDEKT = "https://archidekt.com/api/decks/{id}/"
ASSET_HOSTS = ("scryfall.io", "scryfall.com")
CACHE_DAYS = 30
MAX_BODY = 5 * 1024 * 1024

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".ico": "image/x-icon",
}

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,80}$")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------------- fichiers

def read_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    # Sous Windows, le remplacement échoue si le fichier est ouvert en lecture
    # au même instant par une autre requête : on réessaie brièvement.
    for attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 9:
                os.remove(tmp)
                raise
            time.sleep(0.05)


_locks: dict = {}
_locks_guard = threading.Lock()


def lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def write_json(path: Path, obj) -> None:
    _atomic_write(path, json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8"))


def is_fresh(path: Path, days: float = CACHE_DAYS) -> bool:
    try:
        return time.time() - path.stat().st_mtime < days * 86400
    except OSError:
        return False


# --------------------------------------------------------------------------- réseau

def http_request(url: str, payload=None, accept: str = "application/json", timeout: float = 30) -> bytes:
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


class Scryfall:
    """Client Scryfall qui respecte la limite d'environ 10 requêtes par seconde."""

    MIN_INTERVAL = 0.11

    def __init__(self):
        self._lock = threading.Lock()
        self._next = 0.0

    def _throttle(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._next - now
            self._next = max(now, self._next) + self.MIN_INTERVAL
        if wait > 0:
            time.sleep(wait)

    def call(self, path: str, payload=None):
        """Renvoie le JSON décodé, ou None si Scryfall répond 404."""
        url = SCRYFALL + path
        for attempt in range(3):
            self._throttle()
            try:
                return json.loads(http_request(url, payload))
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code == 429 and attempt < 2:
                    time.sleep(1 + attempt)
                    continue
                raise ApiError(502, f"Scryfall a répondu avec l'erreur {e.code}.")
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise ApiError(502, f"Scryfall est injoignable ({e}). Vérifiez la connexion internet.")
        raise ApiError(502, "Scryfall est surchargé, réessayez dans un instant.")


# --------------------------------------------------------------------------- cartes

FACE_FIELDS = ("name", "mana_cost", "type_line", "oracle_text", "power", "toughness", "loyalty", "defense")
WUBRG = "WUBRG"


def norm_name(name: str) -> str:
    return " ".join(str(name).replace("’", "'").lower().split())


def _art(obj: dict):
    return (obj.get("image_uris") or {}).get("art_crop")


def trim_card(raw: dict) -> dict:
    """Ne garde d'une carte Scryfall que ce dont l'outil a besoin."""
    faces = raw.get("card_faces") or []
    card = {k: raw.get(k) for k in ("id", "oracle_id", "name", "layout", "set", "collector_number", "cmc", "color_identity")}
    card.update({k: raw.get(k) for k in FACE_FIELDS})
    card["colors"] = raw.get("colors")
    card["art"] = _art(raw) or (_art(faces[0]) if faces else None)
    card["faces"] = []
    for f in faces:
        face = {k: f.get(k) for k in FACE_FIELDS}
        face["colors"] = f.get("colors") if f.get("colors") is not None else raw.get("colors")
        face["art"] = _art(f) or card["art"]
        card["faces"].append(face)
    if card["colors"] is None:
        seen = {c for f in card["faces"] for c in (f.get("colors") or [])}
        card["colors"] = [c for c in WUBRG if c in seen]
    if not card["oracle_id"] and faces:
        card["oracle_id"] = faces[0].get("oracle_id")
    if not card["type_line"] and faces:
        card["type_line"] = " // ".join(f.get("type_line") or "" for f in faces)
    return card


def card_names(card: dict) -> set:
    names = {card["name"], card["name"].split(" // ")[0]}
    names.update(f["name"] for f in card.get("faces") or [] if f.get("name"))
    return {norm_name(n) for n in names if n}


def _scryfall_identifier(ident: dict) -> dict:
    if ident.get("id"):
        return {"id": ident["id"]}
    if ident.get("set") and ident.get("collector_number"):
        return {"set": ident["set"], "collector_number": ident["collector_number"]}
    # Scryfall ne reconnaît pas « Fire // Ice » mais trouve « Fire ».
    name = ident["name"].split(" // ")[0]
    if ident.get("set"):
        return {"name": name, "set": ident["set"]}
    return {"name": name}


def _matches(ident: dict, card: dict) -> bool:
    if ident.get("id"):
        return card["id"] == ident["id"]
    if ident.get("set") and ident["set"].lower() != (card.get("set") or ""):
        return False
    if ident.get("set") and ident.get("collector_number"):
        if card.get("collector_number") != ident["collector_number"]:
            return False
        # Une édition/numéro erronés désignent une autre carte : on refuse,
        # le second essai se fera par le nom seul.
        return not ident.get("name") or norm_name(ident["name"]) in card_names(card)
    return norm_name(ident.get("name", "")) in card_names(card)


class CardStore:
    def __init__(self, scry: Scryfall):
        self.scry = scry
        self.dir = CACHE_DIR / "cards"
        self.index_path = CACHE_DIR / "names.json"
        self.lock = threading.Lock()
        self.names = read_json(self.index_path, {}) or {}

    def _load(self, card_id: str):
        if not card_id or not UUID_RE.match(card_id):
            return None
        path = self.dir / f"{card_id}.json"
        return read_json(path) if is_fresh(path) else None

    def _remember(self, cards: list) -> None:
        for card in cards:
            write_json(self.dir / f"{card['id']}.json", card)
        with self.lock:
            for card in cards:
                for n in card_names(card):
                    self.names[n] = card["id"]
            write_json(self.index_path, self.names)

    def _fetch(self, idents: dict, results: list) -> None:
        keys = list(idents)
        for start in range(0, len(keys), 75):
            chunk = keys[start:start + 75]
            body = {"identifiers": [_scryfall_identifier(idents[i]) for i in chunk]}
            resp = self.scry.call("/cards/collection", body) or {}
            found = [trim_card(c) for c in resp.get("data", [])]
            self._remember(found)
            for i in chunk:
                results[i] = next((c for c in found if _matches(idents[i], c)), None)

    def get(self, identifiers: list) -> dict:
        results = [None] * len(identifiers)
        pending = {}
        for i, ident in enumerate(identifiers):
            if not isinstance(ident, dict) or not (ident.get("id") or ident.get("name")):
                continue
            cid = ident.get("id")
            if not cid and not ident.get("set"):
                cid = self.names.get(norm_name(ident["name"]))
            card = self._load(cid)
            if card:
                results[i] = card
            else:
                pending[i] = ident
        if pending:
            self._fetch(pending, results)
            # Second essai par le nom seul (impression inconnue, ID obsolète…).
            retry = {i: {"name": ident["name"]} for i, ident in pending.items()
                     if results[i] is None and ident.get("name") and (ident.get("id") or ident.get("set"))}
            if retry:
                self._fetch(retry, results)
        return {"cards": results}


def _pick(prints: list, getter):
    for p in prints:
        try:
            value = getter(p)
        except (IndexError, KeyError, TypeError):
            value = None
        if value:
            return value
    return None


_EN_WORDS = re.compile(r"\b(the|you|your|target|this|when|whenever|each|and|of|card|cards|creature)\b", re.I)
_FR_WORDS = re.compile(r"\b(le|la|les|vous|votre|de|des|du|un|une|cette|chaque|ciblée?s?|carte|cartes)\b", re.I)


def _french_text(text):
    """Certaines impressions « françaises » récentes ont leur texte en anglais : on les écarte."""
    if text and len(_FR_WORDS.findall(text)) >= len(_EN_WORDS.findall(text)):
        return text
    return None


def build_french(prints: list) -> dict:
    """Assemble nom, type et texte français à partir des impressions (la plus récente d'abord)."""
    if not prints:
        return {}
    fr = {
        "name": _pick(prints, lambda p: p.get("printed_name")),
        "type_line": _pick(prints, lambda p: p.get("printed_type_line")),
        "oracle_text": _pick(prints, lambda p: _french_text(p.get("printed_text"))),
    }
    n_faces = max(len(p.get("card_faces") or []) for p in prints)
    if n_faces:
        fr["faces"] = [{
            "name": _pick(prints, lambda p, i=i: p["card_faces"][i].get("printed_name")),
            "type_line": _pick(prints, lambda p, i=i: p["card_faces"][i].get("printed_type_line")),
            "oracle_text": _pick(prints, lambda p, i=i: _french_text(p["card_faces"][i].get("printed_text"))),
        } for i in range(n_faces)]
    return fr


def _oracle_id(card: dict):
    return card.get("oracle_id") or ((card.get("card_faces") or [{}])[0]).get("oracle_id")


class FrenchStore:
    BATCH = 20  # cartes par recherche Scryfall

    def __init__(self, scry: Scryfall):
        self.scry = scry
        self.dir = CACHE_DIR / "fr-v2"  # v2 : textes anglais écartés (l'ancien cache est ignoré)

    def get_many(self, oracle_ids: list) -> dict:
        out = {}
        missing = []
        for oid in dict.fromkeys(oracle_ids):
            if not isinstance(oid, str) or not UUID_RE.match(oid):
                continue
            path = self.dir / f"{oid}.json"
            cached = read_json(path) if is_fresh(path) else None
            if cached is not None:
                out[oid] = cached
            else:
                missing.append(oid)

        # Une seule recherche pour plusieurs cartes : « lang:fr (oracleid:A or oracleid:B …) ».
        for start in range(0, len(missing), self.BATCH):
            chunk = missing[start:start + self.BATCH]
            query = urllib.parse.urlencode({
                "q": "lang:fr (" + " or ".join(f"oracleid:{oid}" for oid in chunk) + ")",
                "unique": "prints", "order": "released", "dir": "desc",
            })
            prints = []
            path = f"/cards/search?{query}"
            for _ in range(10):  # pagination (175 impressions par page)
                resp = self.scry.call(path) or {}
                prints.extend(resp.get("data", []))
                if not resp.get("has_more") or not resp.get("next_page"):
                    break
                path = resp["next_page"].removeprefix(SCRYFALL)
            for oid in chunk:
                fr = build_french([p for p in prints if _oracle_id(p) == oid])
                write_json(self.dir / f"{oid}.json", fr)
                out[oid] = fr
        return out


def get_symbols(scry: Scryfall) -> dict:
    path = CACHE_DIR / "symbology.json"
    data = read_json(path) if is_fresh(path) else None
    if data is None:
        resp = scry.call("/symbology") or {}
        data = {s["symbol"]: s["svg_uri"] for s in resp.get("data", []) if s.get("svg_uri")}
        if data:
            write_json(path, data)
    return data


def get_asset(url: str):
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in ASSET_HOSTS):
        raise ApiError(400, "Adresse d'image non autorisée.")
    ext = os.path.splitext(parsed.path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".svg"):
        raise ApiError(400, "Type d'image non pris en charge.")
    path = CACHE_DIR / "assets" / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ext)
    with lock_for(path.name):  # une seule requête si la même image est demandée plusieurs fois
        if not path.exists():
            try:
                data = http_request(url, accept="*/*", timeout=60)
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise ApiError(502, f"Image indisponible ({e}).")
            _atomic_write(path, data)
        return path, MIME[ext], path.read_bytes()


# --------------------------------------------------------------------------- Archidekt

def get_archidekt(ref: str) -> dict:
    ref = (ref or "").strip()
    m = re.search(r"archidekt\.com/(?:api/)?decks/(\d+)", ref) or re.fullmatch(r"(\d+)", ref)
    if not m:
        raise ApiError(400, "Lien Archidekt non reconnu (attendu : https://archidekt.com/decks/123456/…).")
    deck_id = m.group(1)
    try:
        raw = json.loads(http_request(ARCHIDEKT.format(id=deck_id)))
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            raise ApiError(404, "Deck Archidekt introuvable. Vérifiez qu'il est public ou non répertorié.")
        raise ApiError(502, f"Archidekt a répondu avec l'erreur {e.code}.")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ApiError(502, f"Archidekt est injoignable ({e}).")

    excluded = {c.get("name") for c in raw.get("categories") or [] if c.get("includedInDeck") is False}
    cards = []
    for entry in raw.get("cards") or []:
        if entry.get("deletedAt"):
            continue
        cats = entry.get("categories") or []
        if cats and cats[0] in excluded:
            continue
        card = entry.get("card") or {}
        oracle = card.get("oracleCard") or {}
        if not oracle.get("name"):
            continue
        cards.append({
            "id": card.get("uid"),
            "name": oracle["name"],
            "qty": int(entry.get("quantity") or 1),
            "category": cats[0] if cats else "",
        })
    return {"id": int(deck_id), "name": raw.get("name") or f"Deck {deck_id}", "cards": cards}


# --------------------------------------------------------------------------- decks sauvegardés

def deck_path(slug: str) -> Path:
    if not SLUG_RE.match(slug or ""):
        raise ApiError(400, "Nom de deck invalide.")
    return DECKS_DIR / f"{slug}.json"


def list_decks() -> list:
    decks = []
    for path in sorted(DECKS_DIR.glob("*.json")):
        data = read_json(path)
        if not isinstance(data, dict):
            continue
        decks.append({"slug": path.stem, "name": data.get("name") or path.stem, "updated": path.stat().st_mtime})
    decks.sort(key=lambda d: d["updated"], reverse=True)
    return decks


# --------------------------------------------------------------------------- serveur HTTP

SCRY = Scryfall()
CARDS = CardStore(SCRY)
FRENCH = FrenchStore(SCRY)


class Handler(BaseHTTPRequestHandler):
    server_version = "CopySlips/1.0"

    def log_message(self, fmt, *args):  # console silencieuse
        pass

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    # -- réponses
    def _send(self, status: int, body: bytes, ctype: str, cache: str = "no-cache") -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _json(self, obj, status: int = 200) -> None:
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), MIME[".json"])

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Requête trop volumineuse.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            raise ApiError(400, "JSON invalide.")

    # -- routage
    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path.startswith("/api/"):
                self._api(method, parsed.path[5:].strip("/"), query)
            elif method == "GET":
                self._static(urllib.parse.unquote(parsed.path))
            else:
                raise ApiError(405, "Méthode non autorisée.")
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except Exception as e:  # noqa: BLE001 : on veut toujours répondre au navigateur
            traceback.print_exc()
            self._json({"error": f"Erreur interne : {e}"}, 500)

    def _api(self, method: str, route: str, query: dict) -> None:
        q = lambda k: (query.get(k) or [""])[0]  # noqa: E731
        if method == "GET" and route == "symbols":
            return self._json(get_symbols(SCRY))
        if method == "GET" and route == "asset":
            _, ctype, data = get_asset(q("u"))
            return self._send(200, data, ctype, cache="max-age=31536000, immutable")
        if method == "GET" and route == "archidekt":
            return self._json(get_archidekt(q("ref")))
        if method == "POST" and route == "cards":
            idents = self._body().get("identifiers") or []
            if not isinstance(idents, list) or len(idents) > 1000:
                raise ApiError(400, "Liste de cartes invalide.")
            return self._json(CARDS.get(idents))
        if method == "POST" and route == "fr":
            ids = self._body().get("oracle_ids") or []
            if not isinstance(ids, list) or len(ids) > 200:
                raise ApiError(400, "Liste invalide.")
            return self._json(FRENCH.get_many(ids))
        if route == "decks" and method == "GET":
            return self._json(list_decks())
        if route.startswith("decks/"):
            path = deck_path(route[6:])
            if method == "GET":
                data = read_json(path)
                if data is None:
                    raise ApiError(404, "Deck introuvable.")
                return self._json(data)
            if method == "PUT":
                body = self._body()
                if not isinstance(body, dict):
                    raise ApiError(400, "Deck invalide.")
                write_json(path, body)
                return self._json({"ok": True})
            if method == "DELETE":
                path.unlink(missing_ok=True)
                return self._json({"ok": True})
        raise ApiError(404, "Route inconnue.")

    def _static(self, path: str) -> None:
        if path in ("", "/"):
            path = "/index.html"
        target = (WEB_DIR / path.lstrip("/")).resolve()
        if WEB_DIR not in target.parents or not target.is_file():
            raise ApiError(404, "Fichier introuvable.")
        ctype = MIME.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    parser = argparse.ArgumentParser(description="Copy Slips : fiches de copie pour Magic: The Gathering.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="ne pas ouvrir le navigateur")
    args = parser.parse_args()

    DECKS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f"Aucun port libre entre {args.port} et {args.port + 19}.")

    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Copy Slips est lancé : {url}")
    print("Laissez cette fenêtre ouverte pendant l'utilisation. Ctrl+C (ou fermer la fenêtre) pour arrêter.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
