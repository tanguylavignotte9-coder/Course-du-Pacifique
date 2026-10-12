import fs from "node:fs";
import path from "node:path";

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
  // Sauvegarde ASYNCHRONE COALESCÉE — save() ne bloque plus l'event loop.
  // Avant : chaque commande joueur (~10/s pendant un drag de roue ou de
  // manette) déclenchait un writeFileSync + renameSync de TOUTE la base.
  // Sur un disque scanné par un antivirus, chaque écriture bloque des
  // dizaines de ms : l'event loop sature, la file de commandes WS grossit
  // sans fin et l'interface entière paraît figée (socket ouvert, mais plus
  // rien n'est traité). Ici : au plus UNE écriture en vol ; les appels
  // pendant l'écriture marquent la base sale et la boucle la re-flushe
  // (l'état le plus récent gagne toujours). L'atomicité tmp + rename est
  // conservée : un arrêt brutal laisse toujours un save.json sain.
  save() {
    this._dirty = true;
    if (this._saving) return; // écriture en vol : la boucle re-flushera
    this._saving = true;
    const flush = async () => {
      while (this._dirty) {
        this._dirty = false;
        const tmp = this.file + ".tmp";
        await fs.promises.writeFile(tmp, JSON.stringify(this.data));
        await fs.promises.rename(tmp, this.file);
      }
      this._saving = false;
    };
    flush().catch((err) => {
      this._saving = false;
      console.error("[store] échec de sauvegarde :", err);
    });
  }
}

// Charge les modules ESM du moteur partagé dynamiquement dans store.js n'est
// pas nécessaire : le monde est reconstruit depuis sa graine (deterministe),
// seules les balises actives et les états joueurs sont persistés.
