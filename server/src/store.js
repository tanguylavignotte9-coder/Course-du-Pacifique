import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Persistance JSON simple : courses, joueurs, états. Écriture atomique
// (fichier temporaire + rename) pour survivre à un arrêt brutal du PC.
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "save.json");
    fs.mkdirSync(dir, { recursive: true });
    this.data = { races: {}, tokens: {} };
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      } catch {
        console.error("[store] save.json illisible — nouvelle base");
      }
    }
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

// Charge les modules ESM du moteur partagé dynamiquement dans store.js n'est
// pas nécessaire : le monde est reconstruit depuis sa graine (deterministe),
// seules les balises actives et les états joueurs sont persistés.
