# Pacific Chase

Course nautique en temps réel dans le Pacifique — jeu amateur navigateur (PC & mobile), client/serveur, ~20 joueurs.

Le serveur fait **autorité** : il simule la météo, la mer, le courant, les balises et votre navire en continu (même déconnecté, le navire continue de naviguer). Le client n'envoie que des intentions (cap, voiles, moteur, plongée, antenne) et affiche ce que le joueur connaît : position **estimée**, incertitude, relevés radio et détections visuelles.

## Structure

```
shared/engine.js   Moteur de simulation partagé (monde, météo fBm, tick, radio, vision)
shared/engine.test.js  Tests node:test
server/            Serveur Express + WebSocket (autoritaire, persistance JSON)
client/            Front React + Vite + Tailwind
data/              Sauvegardes (créé au premier lancement) — non versionné
```

## Démarrage (votre PC)

**En un clic** : double-cliquez `Start Pacific Chase.bat` (Windows) ou lancez `./start.sh` (macOS/Linux). Le script installe et build si nécessaire, démarre le serveur sur http://localhost:8080 et ouvre le navigateur.

Manuellement :

```bash
npm install
npm run build        # build du client
npm start            # serveur sur http://localhost:8080
```

En développement (rechargement à chaud du client) :

```bash
npm run dev          # serveur sur :8080
npm run dev --workspace client   # vite sur :5173 (proxy /api et /ws vers :8080)
```

## Comptes joueurs

Les comptes sont créés par l'administrateur (pas d'inscription publique).

**Interface web (recommandée)** : démarrez le serveur puis ouvrez **http://localhost:8080/admin**. Entrez le secret admin (voir ci-dessous) et gérez les comptes avec des boutons : créer, changer mot de passe, supprimer. Le secret est demandé au premier usage — il est alors généré automatiquement et affiché dans la console du serveur (`data/admin-secret.txt`).

**En ligne de commande** (alternative) :

```bash
npm run accounts                      # menu interactif
npm run accounts -- list              # lister les comptes
npm run accounts -- create alice      # créer (mot de passe demandé, masqué)
npm run accounts -- passwd alice      # changer le mot de passe (sessions révoquées)
npm run accounts -- delete alice      # supprimer un compte
```

Les mots de passe sont hachés (scrypt) dans `data/save.json`, jamais stockés en clair. Créations et suppressions sont effectives immédiatement, sans redémarrage du serveur.

## Temps de jeu

Le temps de jeu est le **temps réel** calé sur l'heure de Paris (fuseau de la machine serveur) : le serveur prend l'heure système au lancement de la course et simule par pas d'au plus 5 minutes de jeu. Pour le debug, `TIME_MULT=60 npm start` accélère ×60.

## Accès distant pour vos joueurs (tunnel Cloudflare, gratuit)

Pas de port ouvert sur votre box : le tunnel Cloudflare sort en HTTPS et sert votre serveur local sur une URL publique.

1. Installez `cloudflared` (une fois) : [téléchargements cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) — Windows : téléchargez le `.exe` et mettez-le dans votre PATH (ou dans le dossier du projet). macOS : `brew install cloudflared`.
2. Double-cliquez `Ouvrir acces distant.bat` (Windows) ou lancez `./ouvrir-acces-distant.sh` (macOS/Linux).
3. Le script démarre le jeu s'il ne tourne pas, puis affiche une URL du type **`https://xxx-xxx-xxx.trycloudflare.com`** — c'est celle que vous donnez à vos joueurs (elle change à chaque redémarrage du tunnel ; un tunnel « nommé » fixe existe aussi, voir la doc Cloudflare).
4. Les joueurs ouvrent cette URL dans leur navigateur (PC ou mobile) et se connectent avec leur compte.

Notes :
- HTTPS et WebSocket (wss) fonctionnent automatiquement à travers le tunnel — le client s'adapte au domaine visité.
- Tant que le script tourne, l'accès est ouvert ; fermez-le pour couper l'accès distant (le jeu continue en local).
- La page d'administration `/admin` est aussi accessible à distance : ne partagez **que l'URL joueurs** avec vos joueurs, et gardez le secret admin pour vous.
- Ce service « quick tunnel » de Cloudflare ne demande aucun compte pour démarrer ; pour un nom de domaine fixe, il faut un compte Cloudflare gratuit et un tunnel nommé.

## Notes de conception

- Capture et livraison : **500 m** (zone d'accostage et d'amarrage, point de départ inclus).
- 21 balises (10 communes, 6 rares, 4 légendaires, 1 inconnue), pulsations radio toutes les 30 min de jeu, phase aléatoire par balise.
- Navigation à l'estime : le client ne voit jamais la position vraie ; le serveur ne renvoie que les objets détectés (azimut/distance) et l'estimé avec son incertitude.
- Défauts d'instruments fixes par navire (déviation compas, erreur de loch) — propres à chaque joueur.
