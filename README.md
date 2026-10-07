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

Les comptes sont créés par l'administrateur (pas d'inscription publique). Utilitaire dédié :

```bash
npm run accounts                      # menu interactif
npm run accounts -- list              # lister les comptes
npm run accounts -- create alice      # créer (mot de passe demandé, masqué)
npm run accounts -- passwd alice      # changer le mot de passe (sessions révoquées)
npm run accounts -- delete alice      # supprimer un compte
npm run accounts -- secret            # générer le secret admin
```

Le mot de passe peut aussi être passé en argument (`create alice "monmdp"`) pour l'automatisation. Les comptes sont stockés dans `data/save.json` (mots de passe hachés scrypt, jamais en clair).

Créer un compte ne déconnecte pas le serveur : les créations sont visibles immédiatement au prochain login.

## Temps de jeu

Le temps de jeu est le **temps réel** calé sur l'heure de Paris (fuseau de la machine serveur) : le serveur prend l'heure système au lancement de la course et simule par pas d'au plus 5 minutes de jeu. Pour le debug, `TIME_MULT=60 npm start` accélère ×60.

## Réseau

En local : `http://localhost:8080`. Pour vos joueurs à distance, exposez le port 8080 de votre PC via votre box (redirection de port) — le protocole est `http` + `ws` ; un reverse-proxy HTTPS devant est recommandé si vous passez par un nom de domaine.

## Notes de conception

- Capture et livraison : **500 m** (zone d'accostage et d'amarrage, point de départ inclus).
- 21 balises (10 communes, 6 rares, 4 légendaires, 1 inconnue), pulsations radio toutes les 30 min de jeu, phase aléatoire par balise.
- Navigation à l'estime : le client ne voit jamais la position vraie ; le serveur ne renvoie que les objets détectés (azimut/distance) et l'estimé avec son incertitude.
- Défauts d'instruments fixes par navire (déviation compas, erreur de loch) — propres à chaque joueur.
