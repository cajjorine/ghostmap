---
name: daily-game-conventions
description: Contrat entre le moteur commun et le code d'un mini-jeu quotidien (GameModule, état sauvegardé, fin de partie, grille de partage). À utiliser dès qu'on crée ou modifie la logique d'un jeu dans src/game/.
---

# Conventions d'un mini-jeu quotidien

## Le contrat
`src/game/game.ts` doit exporter `game` (le module), ainsi que les types `Puzzle` et `State` : `src/main.ts` les importe sous ces noms.

Un jeu est un objet qui implémente `GameModule<P, S>` (`src/engine/types.ts`) :
- `P` : le type d'une entrée de `puzzles.json`
- `S` : l'état de la partie du jour, **sérialisable en JSON**

```ts
mount(root: HTMLElement, ctx: GameContext<P, S>, api: GameApi<S>): void
```

- `ctx.puzzle` : l'énigme du jour. `ctx.saved` : l'état sauvegardé, ou `null` pour une nouvelle partie.
- `ctx.status` (`playing` / `won` / `lost`) et `ctx.result` permettent de réafficher une partie terminée.
- `api.save(state)` : à appeler après **chaque** action du joueur (un rechargement de page ne doit rien faire perdre).
- `api.finish(result)` : à appeler **une seule fois**. Le moteur met à jour les stats et ouvre le modal de fin.
- `api.toast(msg)` : message court et éphémère.

Pour un jeu généré de façon procédurale, sans `puzzles.json` : `dailyRng()` (`src/engine/puzzle.ts`)
renvoie un PRNG déterministe, initialisé avec l'id du jeu et la date du jour.

## GameResult
- `grid` : la grille d'emojis partagée. Une ligne par tentative ou une ligne compacte, au plus 6 lignes.
  Elle ne doit **jamais** révéler la réponse.
- `summary` : la phrase affichée dans le modal de fin (par exemple « La réponse était : Japon »). Elle n'est pas partagée.
- `attempts` / `maxAttempts` : ils alimentent la distribution des stats et le score `3/5` (ou `X/5` en cas de défaite).

## Règles UX
- Mobile-first : cibles tactiles d'au moins 44 px, saisie utilisable au clavier virtuel, pas de hover indispensable.
- Une partie dure moins de 5 minutes. Pas de chronomètre stressant, sauf si c'est le cœur du jeu.
- Normalise toujours les saisies (`normalize()` de `src/game/game.ts` : accents, casse, ponctuation).
- Le texte des règles se trouve dans `index.html` (`#rules-modal`) : mets-le à jour avec la mécanique.
- Couleurs : utilise les variables CSS de `main.css` (`--ok`, `--ko`, `--muted`…), le dark mode est automatique.
