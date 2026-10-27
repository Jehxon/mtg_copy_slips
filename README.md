# Copy Slips

Imprime des **fiches de copie** pour Magic: The Gathering : un rectangle de la
taille d'une carte, rempli de miniatures du texte d'une carte (nom, coût, type
avec la mention « Jeton copie », texte, force/endurance). On le glisse dans la
sleeve, derrière la carte : quand la carte est copiée, la représentation exacte
de la copie est déjà sous la main.

## Lancer l'outil

Seul **Python 3.9 ou plus récent** est nécessaire, sans aucun paquet à installer.

- **Windows** : double-cliquez sur `lancer.bat`. Sinon, ouvrez un terminal dans ce dossier et tapez `py app.py`.
- **Linux** : `./lancer.sh` ou `python3 app.py`.

Le navigateur s'ouvre sur l'outil (adresse `http://127.0.0.1:8765/`). Laissez
la fenêtre du terminal ouverte pendant l'utilisation et fermez-la pour arrêter.
Une connexion internet est nécessaire pour récupérer les cartes. Elles sont
ensuite gardées en cache.

## Utilisation

1. **Importer** : collez le lien d'un deck Archidekt (public ou non répertorié),
   ou une liste texte (exports Archidekt, Moxfield, MTG Arena, MTGO…).
2. **Cartes** : cochez les cartes que vous copiez. Les boutons « Créatures »,
   « Éphémères & rituels », « Auras » et « Mutation » ajoutent des groupes entiers.
   Cliquez sur une carte pour régler :
   - le **nombre de copies par rectangle**. En « Auto », l'outil met le plus de
     miniatures possible sans passer sous la taille de police minimale. La liste
     déroulante indique la police obtenue pour chaque nombre ;
   - le **nombre de rectangles** à imprimer (par défaut, la quantité dans le deck) ;
   - la **face** des cartes double face, split ou aventure (une seule ou toutes) ;
   - l'**illustration** : encadré (prend la place libre), bandeau derrière le titre,
     cadre autour du texte, ou fond estompé ;
   - la **copie de capacité** : cochez une ou plusieurs capacités pour n'imprimer
     qu'elles, avec la mention « Copie de capacité ».
3. **Réglages** : langue (anglais Oracle ou français), police, tailles minimale
   et maximale, texte de rappel, taille des rectangles, rectangles vierges, papier.
4. **Imprimer / PDF** : voir ci-dessous.

Tout est enregistré automatiquement, deck par deck (sélection et réglages). Le
bouton ↻ recharge un deck Archidekt modifié en conservant vos réglages. Un clic
sur un rectangle de l'aperçu ouvre la carte correspondante.

### Rectangles vierges

Pour que les cartes copiées ne se distinguent pas au toucher, l'outil ajoute
par défaut un rectangle vierge pour chaque carte du deck non imprimée.
Glissez-les derrière toutes les autres cartes. Vous pouvez aussi choisir un
nombre fixe, ou compléter la dernière page.

## Impression

L'aperçu est exactement ce qui sera imprimé. Cliquez sur **Imprimer / PDF**, puis :

- utilisez de préférence **Chrome, Edge ou Chromium** ;
- choisissez la destination « Enregistrer au format PDF » ou votre imprimante ;
- réglez l'échelle sur **100 % / taille réelle**, jamais « Ajuster à la page » ;
- laissez les marges sur « Aucune » ou « Par défaut ».

Faites une page de test et mesurez un rectangle à la règle (63 × 88 mm par défaut).
Les rectangles d'une page se touchent : découpez le long des traits de coupe
dans les marges, au massicot ou au cutter et à la règle. Les pointillés
séparent les miniatures à l'intérieur d'un rectangle.

Un papier fin (80 g/m²) se glisse plus facilement dans une sleeve déjà occupée.

## Fichiers

- `app.py` : serveur local (Python, bibliothèque standard uniquement).
- `web/` : interface (HTML, CSS, JavaScript sans compilation).
- `data/decks/` : decks sauvegardés (JSON).
- `data/cache/` : données et images Scryfall. Vous pouvez supprimer ce dossier
  sans risque : il se reconstruit tout seul.

## Crédits

Données et images des cartes : [Scryfall](https://scryfall.com). Magic: The
Gathering et ses illustrations sont la propriété de Wizards of the Coast. Usage
personnel uniquement.
Polices Barlow Semi Condensed et Crimson Pro : SIL Open Font License (voir `web/fonts/`).
