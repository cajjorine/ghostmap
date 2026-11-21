# Carte Fantôme : nouvelles fonctionnalités

Six ajouts retenus le 21 novembre 2026. Le score sur 100 (5), la fin de carte spectaculaire (4), les cartes
en dégradé (3), le mode « Retrouve-les » (1) et les cartes de points (2) sont faits : voir [DONE.md](DONE.md). Il reste :

6. Statistiques de tous les joueurs

Pour chacun, cette fiche donne : le principe, comment on joue, ce qui change dans `cartes.txt` et dans l'atelier, comment le construire, les questions à trancher et l'effort.

---

## Vue d'ensemble

| # | Fonctionnalité | Effort | Serveur ? | Dépend de |
|---|---|---|---|---|
| 6 | Statistiques de tous les joueurs | moyen | **oui** | score (fait) |

Les statistiques demandent un serveur, ce qui sort du cadre actuel (site 100 % statique).

**Effort :** *rapide* = quelques heures ; *moyen* = une à deux grosses sessions.

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
