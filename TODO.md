# Carte Fantôme : nouvelles fonctionnalités

Six ajouts retenus le 21 novembre 2026. Le score sur 100 (5), la fin de carte spectaculaire (4) et les cartes
en dégradé (3) sont faits : voir [DONE.md](DONE.md). Il reste :

1. Mode « Retrouve-les »
2. Cartes de points
6. Statistiques de tous les joueurs

Pour chacun, cette fiche donne : le principe, comment on joue, ce qui change dans `cartes.txt` et dans l'atelier, comment le construire, les questions à trancher et l'effort.

---

## Vue d'ensemble

| # | Fonctionnalité | Effort | Serveur ? | Dépend de |
|---|---|---|---|---|
| 1 | Mode « Retrouve-les » | moyen | non | — |
| 2 | Cartes de points | moyen | non | — |
| 6 | Statistiques de tous les joueurs | moyen | **oui** | score (fait) |

**Ordre conseillé : 1 → 2 → 6.**
- « Retrouve-les » double le contenu sans écrire une carte de plus.
- Les points demandent d'enrichir le format des cartes.
- Les statistiques arrivent en dernier, car elles exigent un serveur.

**Effort :** *rapide* = quelques heures ; *moyen* = une à deux grosses sessions.

---

## 1. Mode « Retrouve-les »

### Principe
C'est le jeu à l'envers. On donne la réponse, par exemple « Les pays champions du monde de football », et le globe est entièrement éteint. Le joueur touche les pays qu'il pense concernés.

### Comment on joue
- Un compteur indique l'objectif : « 3 / 8 trouvés ».
- **Bon pays** : il s'allume avec l'effet habituel (onde, halo, note qui monte).
- **Mauvais pays** : il clignote brièvement en gris-bleu et coûte une erreur. On a droit à 5 erreurs, comme les 5 essais du mode normal.
- **Listes longues** : au-delà de 12 pays, l'objectif devient « trouve-en 12 ». Pour « on roule à gauche », ce serait 12 sur 71. Chaque pays trouvé en plus rapporte un bonus.
- **Petites îles** : un toucher dans l'océan compte s'il tombe près d'une cible minuscule (Malte, Maurice, Barbade…). Un rayon d'environ 300 km autour de l'île est à régler en testant.
- **« J'abandonne »** : révèle les pays manquants, qui s'allument en orange pâle.
- **Fin** : la liste des pays trouvés et ratés, avec leurs noms.

### Quand y jouer
- **Sur les cartes déjà jouées** en mode normal, pour ne rien dévoiler des cartes à venir. On y accède depuis la fin de partie ou depuis un futur album.
- **En option**, comme manche bonus après la 5ᵉ carte du jour.

### Format des cartes
- Rien d'obligatoire : toutes les cartes existantes marchent telles quelles.
- Une ligne facultative fixe l'objectif : `Retrouve : 10`.

### Technique
- Activer les clics sur le globe dans ce mode : `onPolygonClick` et `onGlobeClick` pour les touchers dans l'océan. L'atelier fait déjà la même chose.
- Pas de survol sur téléphone ; les clics seuls coûtent peu.
- Partage : `Retrouve-les · Carte 3 : 8/8, 1 erreur`.

### À trancher
- Limite d'erreurs ou chronomètre ?
- Faut-il montrer le nom du pays touché à chaque essai ? C'est plus pédagogique, mais aussi plus facile.

**Effort : moyen.**

---

## 2. Cartes de points

### Principe
Ce sont des points lumineux qui s'allument, plus seulement des pays : villes, volcans, stades, sommets, monuments. Ça ouvre une énorme réserve de sujets. Exemples :
- les capitales construites de toutes pièces ;
- les villes hôtes des JO d'hiver ;
- les plus hauts sommets de chaque continent.

### Comment on joue
- Exactement comme aujourd'hui : les points s'allument quand on tourne la Terre vers eux, et on devine ce qu'ils ont en commun.
- Chaque point a une petite colonne de lumière, pour rester visible même de loin.
- Une carte peut mélanger pays et points.

### Format des cartes
Une ligne par point, avec un nom (montré seulement à la fin) et des coordonnées :

```
=== Les capitales construites de toutes pièces
Type : points
Point : Brasília, -15.79, -47.88
Point : Canberra, -35.28, 149.13
Point : Abuja, 9.08, 7.40
Point : Naypyidaw, 19.76, 96.08
Point : Islamabad, 33.69, 73.05
Indice : Aucune n'existait il y a deux siècles
Réponse : capital + construi/cree/artificiel/nouvelle/planifi
```

- **Plus tard** : reconnaître directement les noms de grandes villes (`Points : Brasília, Canberra, Abuja`). Il faudrait une liste de villes, par exemple les « populated places » de Natural Earth (domaine public). Les noms français seraient à compléter.

### Atelier
- Un interrupteur « Pays / Points ».
- En mode Points, un clic sur le globe pose un point à cet endroit et l'atelier demande son nom. On peut aussi coller une liste `nom, lat, lng`.

### Technique
- Couche de points de globe.gl (ou les halos existants) et petites colonnes lumineuses.
- La découverte « quand le point entre dans le champ » réutilise le code actuel, avec une seule position par point.
- Compatible avec « Retrouve-les » : un toucher compte s'il tombe assez près du point.

**Effort : moyen.**

---

## 6. Statistiques de tous les joueurs

### Ce qu'on affiche en fin de partie
- « 62 % des joueurs ont trouvé cette carte », avec le nombre moyen d'essais.
- Ta place : « Ton score fait mieux que 78 % des joueurs ».
- La répartition des résultats (barres de 1 à 5, plus « raté »).
- **La réponse fausse la plus fréquente** (« le thé », « le Commonwealth »…). C'est drôle et très partageable.
- En bas de page : « 1 234 parties jouées aujourd'hui ».

### Fonctionnement
1. À la fin de chaque carte, le navigateur envoie **une seule fois** un petit résumé : identifiant de la carte, gagné ou perdu, nombre d'essais, score, durée, lumières vues, réponses fausses (raccourcies, sans accents).
2. Le serveur additionne tout par carte.
3. L'écran de fin demande les chiffres de la carte. Ils sont mis en cache une minute pour tenir la charge.

### Briques possibles
- **Supabase** : base de données et API prêtes à l'emploi.
- **Cloudflare Worker + D1** : très léger, et pratique si le site est déjà sur Cloudflare Pages.
- Au début, les offres gratuites de ces services devraient suffire ; vérifier leurs limites au moment de choisir.

### Contraintes
- **Ne marche pas dans la page claude.ai.** Elle bloque les appels vers d'autres serveurs, et sa base intégrée exige que chaque joueur ait un compte claude.ai. Il faut donc d'abord héberger le jeu soi-même (voir `todo.md`).
- **Vie privée** : pas de compte et pas d'identifiant joueur. Le navigateur se souvient seulement qu'il a déjà envoyé le résultat de cette carte. Pas d'adresse IP en base. Ajouter une ligne dans la politique de confidentialité.
- **Réponses fausses** : elles sont tapées librement, donc elles peuvent contenir n'importe quoi. N'afficher qu'une réponse donnée par au moins 20 joueurs, passée dans une liste de mots interdits.
- **Pas de pourcentages sous 30 joueurs** sur une carte : trop peu fiables.
- **Anti-abus** : limiter le nombre d'envois par minute côté serveur.
- **Si le serveur ne répond pas**, le bloc de statistiques ne s'affiche pas et le jeu continue normalement.

### Bonus pour toi
Les réponses refusées, classées par fréquence, servent aussi à **améliorer les mots-clés** de chaque carte. C'est le meilleur outil pour régler les lignes `Réponse`, `Brûlant` et `Presque`.

**Effort : moyen, plus la mise en place de l'hébergement.**

---

## Récapitulatif des changements du format `cartes.txt`

Toutes les nouvelles lignes sont facultatives : les cartes actuelles continuent de marcher sans rien toucher.

| Ligne | Pour | Exemple |
|---|---|---|
| `Type :` | choisir le genre de carte | `devinette` (par défaut), `points` |
| `Point :` | cartes de points | `Point : Canberra, -35.28, 149.13` |
| `Retrouve :` | mode « Retrouve-les » | `Retrouve : 10` |
