# Architecture de Score

L’application est une PWA statique sans dépendance ni compilation.

- `index.html` contient les écrans accessibles, la boîte de confirmation vocale et les métadonnées iOS/PWA.
- `styles.css` définit le thème sombre, les composants tactiles et l’adaptation aux safe areas de l’iPhone.
- `app.js` regroupe l’état, le routage interne, le rendu, la persistance, le parseur vocal et les événements.
- `manifest.webmanifest` décrit l’installation de l’application.
- `sw.js` met en cache l’application pour le fonctionnement hors ligne.
- `icons/` contient les icônes iOS et PWA.

## Modèle de données

La partie active est enregistrée sous `score.current.v1`; l’historique sous `score.history.v1`. Une partie utilise le mode `rounds` avec un tableau `rounds`, ou le mode `cumulative` avec un tableau `totals`. Les entrées archivées sont des instantanés complets et l’historique est limité à 100 parties.

## Principes d’évolution

- Maintenir la compatibilité avec les données version 1 ou prévoir une migration avant toute modification du schéma.
- Ne jamais supprimer la partie active si l’archivage a échoué.
- Toute saisie vocale de scores doit passer par l’écran de vérification avant d’altérer l’état.
- Incrémenter `CACHE_NAME` dans `sw.js` lorsqu’un nouveau déploiement doit invalider l’ancien cache.
- Conserver des zones tactiles de 44 px et des champs à 16 px minimum.
