# Carte Fantôme : reste à faire

Les six ajouts retenus le 21 novembre 2026 sont codés : voir [DONE.md](DONE.md).

## Pour activer les statistiques de tous les joueurs
1. Créer la base, une seule fois : `npx wrangler d1 create ghostmap-stats`.
2. Copier l'identifiant renvoyé dans `wrangler.jsonc` (ligne `d1_databases`, à décommenter).
3. Vérifier que le jeton Cloudflare de GitHub Actions (`CLOUDFLARE_API_TOKEN`) a le droit **D1 : modifier**.
4. Noter dans `daily-games-factory/shared/CLAUDE.md` l'exception à la règle « 100 % statique » pour Ghostmap,
   sinon `./sync-shared.sh` l'effacera.

Tant que la base n'est pas branchée, l'API répond 503 et le jeu n'affiche simplement pas le bloc.

## Contenu
- Écrire d'autres cartes de points : il n'y en a que 15 (5 jours), ensuite elles recommencent au début.
