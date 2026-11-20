# CLAUDE.md — Mini-jeu quotidien

> Fichier synchronisé depuis `daily-games-factory/shared/`. Ne pas l'éditer ici :
> modifie la version centrale puis lance `./sync-shared.sh`.

## Le projet
Mini-jeu web quotidien (type Wordle) : une énigme par jour, jouable en moins de 5 minutes,
sans compte. 100 % statique : pas de backend, pas de base de données, pas d'API.
Hébergé sur Cloudflare Workers (static assets), déployé automatiquement à chaque push sur `main`.

## Règles de travail (non négociables)
1. **Aucun test.** N'écris pas de tests, n'ajoute pas de framework de test, n'en exécute pas.
   La seule vérification autorisée est `npm run build` (typecheck + build).
2. **Plan d'exécution obligatoire avant toute tâche lourde** : nouvelle fonctionnalité,
   refactor, modification de plus de 3 fichiers, changement du moteur ou de la config de build.
   Présente le plan (fichiers touchés, approche, risques) et **attends ma validation** avant d'écrire du code.
   Les petites corrections ciblées n'ont pas besoin de plan.
3. **Focus sur le code métier** : `src/game/`, `src/data/`, `src/styles/`, le contenu des règles dans `index.html`.
   Pas de refactor opportuniste, pas d'abstraction « pour plus tard », pas de fichiers de doc non demandés.
4. **Ne modifie pas le socle commun** sauf demande explicite : `src/engine/`, `src/ui/`, `src/main.ts`,
   `src/vite-env.d.ts`, `vite.config.ts`, `.github/workflows/`. Il est partagé entre tous les jeux et écrasé
   par `./sync-shared.sh --engine`. Si une capacité manque au socle, signale-le au lieu de bricoler localement.
5. **Zéro dépendance runtime.** Les devDependencies doivent rester minimales.

## Commandes
- `npm run dev` : serveur local
- `npm run build` : typecheck + build dans `dist/`
- Déploiement : `git push` sur `main` (GitHub Actions → `wrangler deploy`)

## Architecture
- `src/config.ts` : identité du jeu (id, titre, URL, date de lancement, nombre d'essais)
- `src/engine/` : moteur partagé (date locale, graine, stockage, stats, partage)
- `src/ui/` : modals, toast, compte à rebours, vue de fin de partie
- `src/game/game.ts` : **le jeu**, qui implémente l'interface `GameModule` (`src/engine/types.ts`)
- `src/data/puzzles.json` : énigmes ordonnées. Jour N = entrée `N % longueur`. Le fichier est obfusqué au build.
- `src/main.ts` : assemble le tout

Le skill `daily-game-conventions` détaille le contrat moteur/jeu.
