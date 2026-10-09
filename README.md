# Pacific Chase

Course nautique en temps réel dans le Pacifique — jeu amateur navigateur (PC & mobile), client/serveur, ~20 joueurs.

Le serveur fait **autorité** : il simule la météo, la mer, le courant, les balises et votre navire en continu (même déconnecté, le navire continue de naviguer). Le client n'envoie que des intentions (cap, voiles, moteur, plongée, antenne) et affiche ce que le joueur connaît : position **estimée**, incertitude, relevés radio et détections visuelles.

## L'univers du jeu — la Grande Course du Pacifique

### Le monde en 2060

Le Vendée Globe a connu en son temps un engouement immense et fut l'événement sportif mondial numéro un. Depuis, les multinationales ont pris une place majeure : elles gouvernent le monde. Les populations, ultra-connectées, nourries au toujours-plus-grand et au spectaculaire, ont besoin d'un vrai show pour rester diverties.

### Le show : la Grande Course du Pacifique

MaxMedia, l'une des entreprises mondiales les plus influentes, a décidé de créer le plus grand show télévisé au monde dans le Pacifique : une course nautique mettant en scène des marins sélectionnés, partis en mer pour capturer successivement des objectifs — des balises disséminées sur des milliers de kilomètres d'océan.

Le vainqueur est celui qui capture le plus de balises et revient au port d'origine. La récompense : **100 millions d'euros**.

Les courses sont longues — plusieurs semaines — et les risques immenses : la météo, les pénuries de ressources, la perte en mer.

### La face officielle de la course

MaxMedia tient à apparaître irréprochable. La course offre à ses participants des services publics, exacts et gratuits :

- Des **prévisions météo** à plusieurs jours d'horizon, accessibles à quai, aux avant-postes et aux balises via le **NETWORK** — à condition de se connecter, donc de révéler son identité et sa position.
- Les **balises de course**, qui pulsent leur signal sur les ondes, emportent chacune un code, et restent en mer une fois capturées.
- La **Patrouille de sécurité**, chargée d'encadrer la course et de protéger les marins en cas de problème. Sa position est publiée : transparence oblige.
- Les **bulletins de zones d'exclusion**, mis à jour périodiquement : de grandes zones dangereuses que la compagnie demande d'éviter, justifiées par des raisons d'ordre administratif — opérations hydrographiques, champs de débris sous-marins, exercices militaires.
- La **newsletter**, le journal des courses et les « statistiques de course ».

Le public, lui, garde les racines du savoir sportif : il ne tolère **aucune forme d'anti-jeu**.

### Les coulisses

Mais d'autres ennemis existent, plus sournois. Les participants rusent, usant de tous les stratagèmes pour déstabiliser leurs adversaires sans éveiller les soupçons du public — ni ceux de la production.

Et la production, justement, ferme parfois les yeux : le spectacle, par moment, a besoin d'être stimulé.

### Ce que la caméra ne montre pas

Sous le show, la Grande Course du Pacifique est une opération. MaxMedia étudie quelque chose dans ces eaux — et la course est son instrument.

- **Une course-outil.** Chaque navire sélectionné embarque des instruments qui mesurent en permanence des dizaines de paramètres. Les marins croient remonter des statistiques de course et environnementales. En réalité, chaque connexion au NETWORK — à chaque escale de balise, de port ou d'avant-poste — exfiltre les relevés vers la compagnie. La donnée est le produit. Et les balises elles-mêmes ne sont pas des trophées : ce sont des stations de mesure déguisées en prix sportifs.

- **La Bête.** Les opérations profondes antérieures de la compagnie ont dérangé quelque chose dans ces fonds. Cela remonte, attiré par le bruit des coques et des moteurs — et il ne porte pas de code. Ceux qui font trop de bruit peuvent l'attirer ; ceux qui le rencontrent peuvent repartir amoindris : une antenne arrachée, un mât fouetté, des provisions raquées. MaxMedia ne l'a jamais nommée. Les bulletins parlent d'avarie.

- **La Patrouille.** Officiellement, elle encadre la course et protège les marins. Officieusement, elle traque la Bête — et navigue au moyen des données mêmes que la flotte lui fournit malgré elle. Sa position publique n'est pas un mensonge : c'est une transparence à sens unique.

- **Les zones d'exclusion.** Officiellement : des dangers génériques, des prétextes administratifs interchangeables. Officieusement : la position probable de la Bête — la meilleure estimation sincère de la compagnie, calculée sur les relevés de la flotte, masquée sous une étiquette ennuyeuse.

- **La rumeur de la flotte.** Le public voit le show. La flotte, elle, entend des choses dans la nuit : un chant sans identité, le tonnerre d'un engagement lointain, une zone qui se déplace comme quelque chose de vivant. Le journal des courses porte les contradictions : des pannes qui n'en sont pas, des avaries qui tombent trop bien. Et personne — ni la newsletter, ni la Patrouille, ni le jeu — ne confirmera jamais rien. **Chaque marin ne connaît que ce qu'il a déduit lui-même.**

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

**Interface web (recommandée)** : définissez la variable d'environnement `ADMIN_SECRET` avant de démarrer le serveur, puis ouvrez **http://localhost:8080/admin**. Entrez ce secret et gérez les comptes avec des boutons : créer, changer mot de passe, supprimer. Le secret n'est jamais généré automatiquement ni affiché dans la console. Si votre installation contient déjà un `data/admin-secret.txt` (versions antérieures), il reste lu tel quel — sinon `ADMIN_SECRET` est le seul moyen de le définir.

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

1. Double-cliquez **`Ouvrir acces distant.bat`** (Windows) ou lancez **`./ouvrir-acces-distant.sh`** (macOS/Linux). C'est tout.
2. Le script fait tout automatiquement : il **télécharge `cloudflared`** s'il est absent (dans le dossier du projet, sans installation), démarre le jeu s'il ne tourne pas, ouvre le tunnel, puis affiche bien lisiblement l'URL du type **`https://xxx-xxx-xxx.trycloudflare.com`** et l'ouvre dans votre navigateur pour vérification.
3. Cette URL est celle que vous donnez à vos joueurs — elle est aussi enregistrée dans `data/tunnel-url.txt` (elle change à chaque ouverture du tunnel).
4. Pour couper l'accès distant : double-cliquez **`Fermer acces distant.bat`** (ou `./fermer-acces-distant.sh`). Le jeu continue en local.

Notes :
- HTTPS et WebSocket (wss) fonctionnent automatiquement à travers le tunnel — le client s'adapte au domaine visité.
- Tant que le script tourne, l'accès est ouvert ; fermez-le pour couper l'accès distant (le jeu continue en local).
- La page d'administration `/admin` est aussi accessible à distance : ne partagez **que l'URL joueurs** avec vos joueurs, et gardez le secret admin pour vous.
- Ce service « quick tunnel » de Cloudflare ne demande aucun compte pour démarrer ; pour un nom de domaine fixe, il faut un compte Cloudflare gratuit et un tunnel nommé.

## Notes de conception

- Échelle fictive : **1° = 50 km** (sur Terre, 1° ≈ 111 km) — carte de 3000 × 3000 km. Toutes les unités du jeu sont en **km et km/h**.
- Capture et livraison : **500 m** (zone d'accostage et d'amarrage, point de départ inclus).
- **40 balises** (20 communes, 10 rares, 5 légendaires, 5 inconnues), pulsation radio **horaire**, phase aléatoire par balise ; décroissance du signal : 100 % à la balise, 0 % à **1000 km**.
- **10 îles**, **5 avant-postes** sur 5 îles distinctes (placement le plus écarté possible).
- Contraintes de placement par rareté (km) : distances minimales au port, aux avant-postes et entre balises (règle du seuil le plus strict).
- Navigation à l'estime : le client ne voit jamais la position vraie ; le serveur ne renvoie que les objets détectés (azimut/distance) et l'estimé avec son incertitude.
- Défauts d'instruments fixes par navire (déviation compas, erreur de loch) — propres à chaque joueur.

## Règles de codage

> Toute valeur de réglage du jeu (distances, vitesses, durées, seuils, pourcentages, coûts) est définie comme une constante nommée et exportée, en UN SEUL point du code (`shared/engine.js` pour le moteur, `index.js` pour le serveur quand la valeur est purement serveur). Interdiction d'écrire un littéral de réglage ailleurs que dans sa définition. Les tests importent les constantes au lieu de les copier en dur. Un changement de réglage = un changement de ligne.

Exemple — modifier la vitesse maximale de coque :

```js
// Avant : littéral dispersé dans speedKmh()
v = Math.min(v, 37.04);

// Après : une seule définition dans shared/engine.js, utilisée partout
export const VMAX_KMH = 45;   // vitesse max de coque (km/h)
// ... dans speedKmh() :
v = Math.min(v, VMAX_KMH);
```

Changer `VMAX_KMH` change le jeu entier — un réglage, une ligne.
