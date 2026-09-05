# Score

Score est une application web mobile de tableau de scores pour jeux de société. Elle fonctionne sans installation, sans dépendance et hors ligne après le premier chargement. Les parties en cours et l’historique restent uniquement dans le navigateur.

## Publier avec GitHub Pages

1. Envoyez les fichiers de ce dépôt sur GitHub, sur la branche principale.
2. Dans le dépôt GitHub, ouvrez **Settings → Pages**.
3. Sous **Build and deployment**, choisissez **Deploy from a branch**.
4. Sélectionnez la branche principale et le dossier **/ (root)**, puis cliquez sur **Save**.
5. Ouvrez l’adresse indiquée par GitHub après le déploiement.

L’application doit être servie en HTTPS pour activer le service worker et la reconnaissance vocale.

## Ajouter à l’écran d’accueil d’un iPhone

1. Ouvrez l’adresse de l’application dans **Safari**.
2. Touchez le bouton **Partager**.
3. Choisissez **Sur l’écran d’accueil**.
4. Vérifiez le nom « Score », puis touchez **Ajouter**.

Après une première ouverture en ligne, l’interface et les parties restent disponibles hors ligne. La reconnaissance vocale directe dépend toutefois du navigateur et d’une connexion réseau. Si elle ne démarre pas, touchez **La dictée ne démarre pas ? Saisir le texte**, puis utilisez le micro du clavier de l’iPhone : le texte passe par le même écran de vérification avant d’être ajouté aux scores.

## Développement local

Servez simplement la racine avec un serveur HTTP, par exemple `python3 -m http.server 8000`, puis ouvrez `http://localhost:8000`. Aucun build ni `npm install` n’est nécessaire.
