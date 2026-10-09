#!/usr/bin/env node
// ============================================================
// Pacific Chase — utilitaire de gestion des comptes joueurs
//
// Usage interactif :      npm run accounts
// Usage en une ligne :
//   node server/src/accounts-cli.js create alice "motdepasse"
//   node server/src/accounts-cli.js list
//   node server/src/accounts-cli.js passwd alice "nouveaumdp"
//   node server/src/accounts-cli.js delete alice
//   node server/src/accounts-cli.js secret          (régénère le secret admin)
// ============================================================
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import readline from "node:readline";
import { Store } from "./store.js";
import { Auth, hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const store = new Store(path.join(ROOT, "data"));
const auth = new Auth(store);

const [,, cmd, ...args] = process.argv;

const ask = (question, hidden = false) =>
  new Promise((resolve) => {
    if (hidden) {
      // Lecture masquée : on coupe l'écho du terminal
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      process.stdout.write(question);
      let buf = "";
      const onData = (ch) => {
        if (ch[0] === 13 || ch[0] === 10) { // Entrée
          stdin.setRawMode?.(false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buf);
        } else if (ch[0] === 3) { // Ctrl+C
          process.exit(1);
        } else if (ch[0] === 127) { // Retour arrière
          buf = buf.slice(0, -1);
        } else {
          buf += ch.toString();
        }
      };
      stdin.on("data", onData);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
    }
  });

function ensureSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  console.log(`Aucun secret admin défini : définissez la variable d'environnement ADMIN_SECRET.`);
  return null;
}

function list() {
  const accounts = Object.keys(store.data.accounts || {});
  if (accounts.length === 0) {
    console.log("Aucun compte joueur. Créez-en un avec : npm run accounts -- create <nom>");
    return;
  }
  console.log(`\nComptes joueurs (${accounts.length}) :`);
  for (const a of accounts.sort()) {
    const tokens = Object.entries(store.data.tokens || {}).filter(([, id]) => id === a).length;
    console.log(`  · ${a}${tokens > 0 ? "  (connecté)" : ""}`);
  }
  console.log("");
}

function doCreate(name, password) {
  try {
    const id = auth.createAccount(name, password);
    console.log(`✅ Compte créé : ${id}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}

function doPasswd(name, password) {
  const id = name.trim().toLowerCase();
  const acc = store.data.accounts[id];
  if (!acc) {
    console.error(`❌ Compte inconnu : ${id}`);
    process.exitCode = 1;
    return;
  }
  const { salt, hash } = hashPassword(password);
  store.data.accounts[id] = { salt, hash };
  // Révoque les sessions du compte
  for (const [t, owner] of Object.entries(store.data.tokens || {})) {
    if (owner === id) delete store.data.tokens[t];
  }
  store.save();
  console.log(`✅ Mot de passe changé pour ${id} (sessions révoquées)`);
}

function doDelete(name) {
  const id = name.trim().toLowerCase();
  if (!store.data.accounts[id]) {
    console.error(`❌ Compte inconnu : ${id}`);
    process.exitCode = 1;
    return;
  }
  for (const [t, owner] of Object.entries(store.data.tokens || {})) {
    if (owner === id) delete store.data.tokens[t];
  }
  delete store.data.accounts[id];
  delete store.data.races?.default?.players?.[id];
  store.save();
  console.log(`🗑️  Compte supprimé : ${id} (état du navire conservé dans la course : ${store.data.races?.default?.players?.[id] ? "oui" : "non"})`);
}

async function main() {
  switch (cmd) {
    case "create": {
      const name = args[0] || (await ask("Nom du marin : "));
      let password = args[1];
      if (!password) password = await ask("Mot de passe : ", true);
      if (!password || password.length < 4) {
        console.error("❌ Mot de passe trop court (4 caractères minimum)");
        process.exitCode = 1;
        return;
      }
      doCreate(name, password);
      return;
    }
    case "list":
      list();
      return;
    case "passwd": {
      const name = args[0] || (await ask("Compte : "));
      let password = args[1];
      if (!password) password = await ask("Nouveau mot de passe : ", true);
      doPasswd(name, password);
      return;
    }
    case "delete": {
      let name = args[0] || (await ask("Compte à supprimer : "));
      if (args.length === 0) {
        const confirm = await ask(`Supprimer vraiment « ${name} » ? (oui/non) : `);
        if (confirm.toLowerCase() !== "oui") return console.log("Annulé.");
      }
      doDelete(name);
      return;
    }
    case "secret": {
      const s = ensureSecret();
      console.log(s ? "Secret admin défini via ADMIN_SECRET." : "Aucun secret admin défini : définissez la variable d'environnement ADMIN_SECRET.");
      return;
    }
    case undefined:
    case "help":
    default:
      console.log(`
Pacific Chase — gestion des comptes joueurs

  npm run accounts                       menu interactif
  npm run accounts -- list               lister les comptes
  npm run accounts -- create <nom> [mdp] créer un compte (mdp masqué si omis)
  npm run accounts -- passwd <nom> [mdp] changer le mot de passe
  npm run accounts -- delete <nom>       supprimer un compte
  npm run accounts -- secret             générer/afficher le secret admin
`);
      return;
  }
}

// Menu interactif (aucun argument)
async function interactive() {
  console.log("\n⚓ Pacific Chase — gestion des comptes\n");
  list();
  const choice = await ask(
    "Action : (c)réer · (l)ister · (p)assword · (s)upprimer · (q)uitter : "
  );
  switch (choice.toLowerCase()[0]) {
    case "c": {
      const name = await ask("Nom du marin : ");
      const password = await ask("Mot de passe : ", true);
      doCreate(name, password);
      break;
    }
    case "l":
      list();
      break;
    case "p": {
      const name = await ask("Compte : ");
      const password = await ask("Nouveau mot de passe : ", true);
      doPasswd(name, password);
      break;
    }
    case "s": {
      const name = await ask("Compte à supprimer : ");
      const confirm = await ask(`Supprimer vraiment « ${name} » ? (oui/non) : `);
      if (confirm.toLowerCase() === "oui") doDelete(name);
      else console.log("Annulé.");
      break;
    }
    default:
      console.log("Au revoir.");
  }
}

if (cmd === undefined) interactive().then(() => process.exit(0));
else main();
