# Le 98 — version web

Jouer au 98 avec ses amis **depuis n'importe quel téléphone (iPhone compris)**, sans rien installer.

- L'**écran du PC** (ou d'une tablette) sert de **Master** : c'est la table, le paquet et l'arbitre.
- Chaque joueur **scanne le QR code** affiché par le Master avec l'appareil photo de son téléphone. La partie s'ouvre dans Safari ou Chrome.
- **100 % gratuit** : le site est hébergé par **GitHub Pages**, sans serveur à payer et sans nom de domaine à acheter.

---

## 1. Publier le site sur GitHub (une seule fois, 10 minutes)

### a) Créer un compte GitHub
1. Va sur <https://github.com/signup> et crée un compte gratuit.
2. Ton **nom d'utilisateur** apparaîtra dans l'adresse du site : choisis-le bien (ex. `tompe`).

### b) Créer le dépôt
1. En haut à droite : **+** → **New repository**.
2. **Repository name** : `le98` (ce nom apparaîtra aussi dans l'adresse).
3. Coche **Public** (obligatoire pour GitHub Pages gratuit).
4. Ne coche rien d'autre → **Create repository**.

### c) Envoyer les fichiers (sans ligne de commande)
1. Sur la page du dépôt vide, clique sur le lien **« uploading an existing file »**.
2. Ouvre le dossier `App98-Web` dans l'Explorateur Windows, **sélectionne tout son contenu**
   (`index.html`, `css`, `js`, `lib`, `tests`, `README.md`, `.nojekyll`) et **glisse-le** dans la page.
   - Glisse bien le *contenu* du dossier, pas le dossier `App98-Web` lui-même :
     `index.html` doit se retrouver à la racine du dépôt.
   - Le fichier `.nojekyll` est caché par Windows : *Affichage → Afficher → Éléments masqués*. S'il manque, ce n'est pas grave.
3. En bas : **Commit changes**.

### d) Activer GitHub Pages
1. Dans le dépôt : **Settings** → menu de gauche **Pages**.
2. **Source** : *Deploy from a branch*. **Branch** : `main`, dossier `/ (root)` → **Save**.
3. Attends 1 à 2 minutes, puis recharge la page : l'adresse du site s'affiche, par exemple
   **`https://tompe.github.io/le98/`**

C'est l'adresse à ouvrir sur le PC, et l'adresse que contiendra le QR code.

### Mettre à jour le site plus tard
Dépôt → **Add file → Upload files** → glisse les fichiers modifiés (ils remplacent les anciens) → **Commit changes**. Le site se met à jour en 1 à 2 minutes. Sur les téléphones, recharge la page pour voir la nouvelle version.

---

## 2. Jouer

1. **Sur le PC** : ouvre `https://<ton-pseudo>.github.io/le98/` → **Créer une table sur cet écran**.
   Un QR code et un code à 5 lettres s'affichent. Mets la page en plein écran (`F11`).
2. **Sur chaque téléphone** : ouvre l'**appareil photo**, vise le QR code et touche le lien.
   Ou ouvre l'adresse du site et tape le code dans « Rejoindre une table ».
   La première fois, le joueur crée son profil (pseudo, poids, sexe) : il reste enregistré sur son téléphone.
3. Sur le PC : **Lancer la manche** (au moins 3 joueurs ; ajoute des bots si vous êtes moins nombreux).

Pendant la partie :
- **⏸** sur le PC met tout le monde en pause.
- **« Signaler une faute »** sur un téléphone fige la partie ; le Master **valide** (l'accusé boit) ou **rejette** (le dénonciateur boit).
- Un clic sur la pastille d'un joueur, sur le PC, permet de le **remplacer par un bot** (s'il s'est absenté) ou de lui donner une faute de soufflage.
- Si un téléphone se verrouille ou perd le réseau, il **se reconnecte tout seul** et retrouve sa place.
- Si la page du PC est fermée par erreur : rouvre le site → **Reprendre la table**. Les téléphones se reconnectent automatiquement.

### Conseils réseau
- Le plus fiable : **tout le monde sur le même Wi-Fi** que le PC.
- Ça marche aussi en 4G/5G, mais certains réseaux mobiles bloquent les connexions directes. Si un ami n'arrive pas à se connecter, qu'il passe sur le Wi-Fi, ou partage la connexion d'un téléphone avec le PC.
- Il faut un accès à Internet au moment de la connexion (mise en relation). Ensuite, les données de jeu passent en direct entre le PC et les téléphones.

---

## 3. Tester sur ton PC avant de publier

Double-clique sur **`lancer-en-local.bat`** : un petit serveur démarre et le navigateur s'ouvre sur `http://localhost:8098`.
Pour simuler un joueur, ouvre un deuxième onglet avec le lien affiché sous le QR code.
Tests automatiques du moteur de jeu : `http://localhost:8098/tests/` (39 tests : règles, pause, signalement, Widmark, 2 700 manches jouées par des bots).

> Ouvrir directement `index.html` en double-cliquant ne marche pas : les navigateurs bloquent les modules JavaScript en `file://`. Il faut passer par le serveur local, ou par GitHub Pages.

---

## 4. Comment ça marche (pour le rapport du projet)

| Élément | Choix | Pourquoi |
|---|---|---|
| Hébergement | GitHub Pages | Gratuit, HTTPS fourni (obligatoire pour WebRTC sur iPhone), aucun serveur à maintenir |
| Réseau | WebRTC via **PeerJS** | Connexion directe navigateur ↔ navigateur ; le serveur public PeerJS ne sert qu'à la mise en relation |
| Topologie | Client-serveur, le **PC est le serveur** | Comme la tablette dans la version Android : seul détenteur de l'état, il envoie à chaque joueur une **vue filtrée** (sa main uniquement) |
| Règles | `js/engine.js` | Portage fidèle du moteur Kotlin de l'appli Android (même machine à états, mêmes tests) |
| Bots | `js/bot.js` | Portage de `BotBrain.kt` |
| Alcoolémie | `js/widmark.js` | Formule de Widmark, calculée sur le téléphone ; seul le niveau (couleur) est partagé |
| Fiabilité | battement de cœur 5 s, coupure détectée à 20 s, reconnexion automatique, gorgées numérotées (jamais comptées deux fois), sauvegarde de la table dans le navigateur du PC | |
| QR code | qrcode-generator | Généré localement, contient l'adresse du site + `?t=CODE` |

### Arborescence
```
index.html            page unique
css/style.css         charte graphique (identique à l'appli Android)
js/app.js             navigation entre les écrans
js/engine.js          moteur de règles du 98
js/bot.js             joueurs virtuels
js/widmark.js         estimation de l'alcoolémie
js/store.js           stockage local (profil, consommations, sauvegarde de la table)
js/net.js             réglages de connexion (PeerJS, STUN)
js/host.js            logique du Master (PC)
js/client.js          logique du téléphone
js/screen-*.js        écrans : accueil/profil, Master, joueur
js/ui.js              composants : cartes, pastilles, anneau de score, fenêtres
lib/                  PeerJS 1.5.4 et qrcode-generator 1.4.4 (licences MIT), embarqués
tests/                tests du moteur, à ouvrir dans le navigateur
```

L'abus d'alcool est dangereux pour la santé. Les alcoolémies affichées sont des estimations et ne remplacent jamais un éthylotest. Ne prends jamais le volant après avoir bu.
