---
name: puzzle-content
description: Générer, compléter ou vérifier les énigmes de src/data/puzzles.json d'un mini-jeu quotidien. À utiliser quand on demande d'ajouter des énigmes, de remplir le calendrier ou de vérifier le stock restant.
---

# Contenu des énigmes

## Fonctionnement
- `puzzles.json` est un tableau ordonné. Le jour N après `launchDate` (`src/config.ts`) joue l'entrée `N % longueur`.
- **On n'insère jamais d'énigme au milieu, et on n'en supprime pas** : ça décalerait toutes les énigmes à venir
  et casserait la partie du jour pour les joueurs déjà connectés. On ajoute **toujours à la fin**.
- Pour corriger une énigme, on modifie son contenu sans déplacer l'entrée.

## Stock
- Jours écoulés = (aujourd'hui − `launchDate`) en jours. Stock restant = longueur − jours écoulés − 1.
- Garde au moins 60 jours d'avance. Si le stock tombe à 0, le jeu recommence au début (un avertissement s'affiche dans la console).

## Qualité
- Vérifie chaque fait : une énigme fausse est pire qu'une énigme facile.
- Pas de doublon de réponse sur une fenêtre de 90 jours.
- Varie la difficulté sur la semaine (plus facile le lundi, plus dur le week-end, par exemple).
- Respecte exactement le type `P` attendu par `src/game/game.ts`.
- Le fichier est obfusqué au build, mais reste lisible par un développeur motivé : n'y mets rien de secret.
