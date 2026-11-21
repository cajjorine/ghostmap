# Carte Fantôme : fonctionnalités terminées

Reprises de [TODO.md](TODO.md) et adaptées au jeu actuel : 3 cartes par jour, énigmes dans `src/data/puzzles.json`,
stats et partage par le moteur commun. Faites le 21 novembre 2026.

---

## 5. Score sur 100

### Barème (celui de TODO.md)
| Partie | Maximum | Calcul |
|---|---|---|
| Essais | 60 | 60 au 1ᵉʳ essai, 48, 36, 24, puis 12 au 5ᵉ |
| Exploration | 20 | 20 × part des lumières repérées au moment de la bonne réponse |
| Rapidité | 20 | 20 en moins d'1 minute, puis dégressif jusqu'à 0 à 5 minutes |

- **Défaite** : « X ». Les réponses « brûlantes » ne coûtent rien.
- **Chronomètre** : il ne compte que le temps de jeu réel (page visible, règles fermées, globe chargé). Il est
  sauvegardé, donc un rechargement ou un onglet oublié ne pénalise pas.
- **Parties d'avant le score** : elles reçoivent un score « essais + exploration » sur 80, ramené à 100.

### Affichage
- En fin de carte, le score compte de 0 à sa valeur, avec un petit tic sonore, puis le détail sur trois lignes.
- Sur la dernière carte du jour : le **total de la journée sur 300** et le **record** (meilleur total, gardé dans le navigateur).
- **Partage** : une ligne par carte avec son score, puis le total.
  ```
  Ghostmap #1 3/5
  🟥🟩⬛⬛⬛ 82
  🟩⬛⬛⬛⬛ 97
  🟥🟥🟥🟥🟥 X
  Total : 179/300
  https://ghostmap.cajjorine.workers.dev
  ```
  La 1ʳᵉ ligne (`3/5`) et l'adresse viennent du moteur commun. Pour y mettre le score à la place, il faudrait modifier le socle.

---

## 4. Fin de carte plus spectaculaire

### Déroulé (environ 6 secondes)
1. **Respiration** : léger flash, le panneau s'efface.
2. **Vague** : les lumières restantes s'allument en onde depuis l'endroit regardé.
3. **Tournée** : la caméra vole vers 1 à 4 groupes de pays, choisis automatiquement (les plus importants, puis les
   plus éloignés entre eux). À chaque arrêt, elle zoome un peu, les **noms des pays apparaissent** (5 au plus,
   dans la langue choisie) et une note retentit.
4. **Final** : retour en vue large, rotation lente et pulsation qui court de pays en pays. En cas de victoire : accord final et confettis.
5. **Panneau de résultat** : il revient, et le score défile.

- **Défaite** : même tournée, en plus doux. Les pays deviennent bleu pâle, sans confettis, avec des notes graves.
- **Passer** : un toucher n'importe où termine le spectacle tout de suite.
- **Moins d'animations** (réglage de l'appareil) : le spectacle est sauté.

---

## 3. Cartes en dégradé

### Principe
Chaque pays a une valeur. Plus elle est grande, plus le pays est clair **et haut** au-dessus du globe. On découvre les
pays en tournant la Terre, comme d'habitude, et on devine ce qui est mesuré.

- **5 niveaux** de couleur et de hauteur. S'il y a 5 valeurs distinctes ou moins, chacune a son niveau. Sinon, les
  niveaux sont répartis sur une échelle linéaire, ou logarithmique avec `"scale": "log"`.
- **Légende sans chiffres** sous le compteur pendant la partie : « moins → plus ».
- **À la fin** : un classement dans le panneau (10 premiers, valeur, unité, source). C'est plus lisible sur téléphone
  que le toucher pays par pays prévu dans TODO.md.

### Format dans `puzzles.json`
```json
{
  "type": "gradient",
  "title": "Les vainqueurs de la Coupe du monde de rugby",
  "values": { "Afrique du Sud": 4, "Nouvelle-Zélande": 3, "Australie": 2, "Royaume-Uni": 1 },
  "unit": "titres",
  "source": "World Rugby, éditions de 1987 à 2023",
  "hints": ["…"], "fact": "…", "answers": ["…"], "near": [],
  "en": { "title": "…", "unit": "titles", "source": "…", "hints": [], "fact": "…", "answers": [], "near": [] }
}
```
- `values` remplace `countries` : noms de pays en français → valeur.
- `unit` et `source` sont **obligatoires**, dans les deux langues. Une carte chiffrée sans source ne doit pas être publiée.
- `scale: "log"` est facultatif, pour les valeurs très écartées.

### Cartes écrites
Placées en tête du jour 2 (entrées 4 à 6), pour pouvoir les tester tout de suite :
- les 16 plus grands pays par superficie (CIA World Factbook, échelle log) ;
- les vainqueurs de la Coupe du monde de rugby (World Rugby, 1987–2023) ;
- les médailles d'or aux JO de Paris 2024, pays en ayant au moins 5 (CIO).

---

## Menu des modes de jeu

- À l'ouverture, un menu propose trois modes, avec l'avancement du jour pour chacun (« 3 cartes », « 2/3 jouées »,
  « ✓ 214/300 », « 🔒 Après le Classique »). Si une partie Classique est en cours, on la reprend directement.
- Le bouton ☰ (en haut à gauche) ramène au menu. Il est désactivé pendant le spectacle de fin de carte.
- **Seul le Classique** alimente les statistiques et le modal de fin du moteur (un seul résultat par jour).
  Points et Retrouve-les ont leur propre sauvegarde du jour (clés `points` et `find`), leur record
  (`bestPoints`, `bestFind`) et un bouton **Partager**.

---

## 1. Mode « Retrouve-les »

### Déroulé
- La réponse s'affiche, le globe est éteint. On le fait tourner et on **touche** les pays concernés.
- **Bon pays** : il s'allume (onde, halo, note). **Mauvais pays** : il clignote en bleu pâle et coûte une erreur.
  Le nom du pays touché s'affiche à chaque fois (« Pérou : non. »).
- **5 erreurs** permises. **Objectif** : tous les pays, ou 12 si la liste est plus longue.
- **Petites îles** : un toucher dans l'eau compte s'il tombe à moins de 3° (environ 300 km) d'une petite cible pas encore trouvée.
  Sinon : « Dans l'eau ! », sans pénalité.
- **« J'abandonne »** : fin de la carte.
- **Fin** : les pays manquants s'allument en bleu pâle, la tournée de caméra montre les noms, puis le panneau donne
  le score, les pays manquants (20 au plus) et l'anecdote.

### Choix
- Il reprend les **3 cartes Classique du jour** et ne se débloque qu'une fois le Classique terminé, pour ne rien
  dévoiler. Le jeu démarrant le 21 novembre 2026, il n'y avait pas encore de cartes passées à rejouer.
- **Score sur 100** : 100 × trouvés / objectif, moins 5 par erreur (minimum 0).
- **Partage** :
  ```
  Ghostmap · Retrouve-les #1
  🟩 8/8 · 1 ✗ · 95
  🟥 5/12 · 5 ✗ · 17
  🟩 6/6 · 0 ✗ · 100
  Total : 212/300
  https://ghostmap.cajjorine.workers.dev
  ```

### Technique
- Un toucher compte s'il est bref (moins de 350 ms) et sans glisser (moins de 8 px) : faire tourner le globe ne touche rien.
- Le pays touché est trouvé par un rayon lancé contre le maillage des terres (table « triangle → pays »), seulement
  au moment du toucher. Un pays de la face cachée est ignoré.
- L'allumage automatique des cibles est coupé dans ce mode.

---

## 2. Cartes de points (mode « Points »)

### Déroulé
- Même mécanique que le Classique (5 essais, indices, score sur 100, spectacle de fin), avec des **lieux** à la place
  des pays : chacun a un halo et une **colonne de lumière** qui s'allume quand on tourne la Terre vers lui.
- Les noms des lieux n'apparaissent qu'à la fin (tournée de caméra et liste dans le panneau).
- 3 cartes par jour, file à part.

### Format dans `puzzles.json`
```json
{
  "type": "points",
  "title": "Des capitales construites de toutes pièces",
  "points": [
    { "n": "Brasília", "lat": -15.79, "lng": -47.88 },
    { "n": "Pékin", "en": "Beijing", "lat": 39.90, "lng": 116.40 }
  ],
  "hints": ["…"], "fact": "…", "answers": ["…"], "near": [],
  "en": { "title": "…", "hints": [], "fact": "…", "answers": [], "near": [] }
}
```
- `n` : nom français ; `en` : nom anglais s'il diffère.
- Les cartes de points sont **ajoutées à la fin** du fichier. Le Classique les ignore : son ordre ne bouge pas.

### Cartes écrites (15, soit 5 jours)
- Jour 1 : les 7 nouvelles merveilles, des volcans célèbres, des capitales construites de toutes pièces.
- Jour 2 : le plus haut sommet de chaque continent, des détroits, les villes des JO d'hiver.
- Jour 3 : les plus hauts gratte-ciel, des bases de lancement spatial, de grands barrages.
- Jour 4 : les villes de la Coupe du monde 2026, des cratères d'impact, des canaux maritimes.
- Jour 5 : des chutes d'eau, des villes de traités, des sièges d'organisations internationales.

Au-delà du jour 5, elles recommencent au début : **à compléter**.

---

## 6. Statistiques de tous les joueurs

> Exception à la règle « 100 % statique » de CLAUDE.md, validée le 21 novembre 2026.

### Ce qui s'affiche en fin de carte (Classique)
- « Tous les joueurs (1 234) », puis « 62 % ont trouvé cette carte · 2,8 essais en moyenne ».
- « Ton score fait mieux que 78 % des joueurs » (si la carte est gagnée ; les perdants comptent comme en dessous).
- La répartition des résultats : barres de 1 à 5 essais, plus « X », avec ta barre en corail.
- La réponse fausse la plus fréquente.
- Sur la dernière carte du jour : « 1 234 parties jouées aujourd'hui ».

### Fonctionnement
- **Envoi** : quand le panneau de fin d'une carte Classique s'affiche, le navigateur envoie une seule fois
  `card` (`c<jour>.<place>`, par exemple `c12.0`), gagné ou perdu, essais, score, durée de jeu et réponses
  fausses (raccourcies à 40 caractères, sans accents côté serveur). Il retient ensuite qu'il l'a envoyé
  (clé `sent`). Rien n'est envoyé depuis `npm run dev` : seulement depuis l'adresse publiée.
- **Serveur** : `worker/index.ts`, branché dans `wrangler.jsonc`. Seules les adresses `/api/*` passent par lui
  (`run_worker_first`) ; le reste du site est servi comme avant. Base Cloudflare D1, tables créées
  automatiquement au premier appel.
  - `POST /api/result` : valide et enregistre (essais 1–5, score 0–100, durée plafonnée à 1 h, 5 réponses fausses au plus).
  - `GET /api/stats?card=c12.0` : chiffres agrégés, mis en cache une minute.
- **Panne** : si l'API ne répond pas en 5 secondes, ou si la base n'est pas branchée (503), le bloc ne s'affiche pas.

### Garde-fous
- **Pas de pourcentages sous 30 joueurs** sur une carte.
- **Réponse fausse affichée** seulement si au moins 20 joueurs l'ont donnée, et si elle ne contient aucun mot
  de la liste interdite (`BANNED` dans `worker/index.ts`).
- **Anti-abus** : 20 envois par minute au plus par adresse. Le compteur est tenu en mémoire du Worker, sur une
  empreinte de l'adresse jamais écrite en base ; c'est une limite approximative (par instance).
- **Vie privée** : ni compte, ni identifiant joueur, ni adresse IP en base. Une phrase l'explique dans les règles.

### Bonus : régler les mots-clés des cartes
Les réponses refusées les plus fréquentes d'une carte :
```
npx wrangler d1 execute ghostmap-stats --remote --command "SELECT guess, n FROM wrongs WHERE card = 'c12.0' ORDER BY n DESC LIMIT 30"
```
Sur toutes les cartes : retirer le `WHERE` et ajouter `card` au `SELECT`.

### Mise en service
Voir [TODO.md](TODO.md) : la base doit être créée et son identifiant ajouté à `wrangler.jsonc`.

---

## Fichiers
- `src/game/game.ts` : menu des modes, Classique et Points, score, chronomètre, enchaînement de la fin de carte,
  cartes en dégradé (niveaux, légende, classement).
- `src/game/find.ts` : le mode Retrouve-les.
- `src/game/stats.ts` : envoi des résultats et bloc des statistiques de tous les joueurs.
- `worker/index.ts` : l'API des statistiques (Worker + D1) ; `wrangler.jsonc` la branche.
- `src/game/globe.ts` : hauteurs et couleurs par niveau, couleur de défaite, tournée de la caméra, étiquettes, pulsation,
  pays touché, clignotement d'erreur, pays manquants, colonnes de lumière des lieux.
- `src/game/i18n.ts` : nouveaux textes FR/EN.
- `src/data/puzzles.json` : 3 cartes en dégradé, 15 cartes de points.
- `src/styles/main.css`, `index.html` (règles).
