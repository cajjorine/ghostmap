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

## Fichiers
- `src/game/game.ts` : score, chronomètre, enchaînement de la fin de carte, cartes en dégradé (niveaux, légende, classement).
- `src/game/globe.ts` : hauteurs et couleurs par niveau, couleur de défaite, tournée de la caméra, étiquettes, pulsation.
- `src/game/i18n.ts` : nouveaux textes FR/EN.
- `src/data/puzzles.json` : 3 cartes en dégradé.
- `src/styles/main.css`, `index.html` (règles).
