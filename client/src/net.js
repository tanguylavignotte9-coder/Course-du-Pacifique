// Connexion au serveur : login REST + WebSocket persistant.
// Le client n'envoie que des COMMANDES (intentions) ; le serveur fait
// autorité et pousse des snapshots complets de l'état connu du joueur.
export function login(name, password) {
  return fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("Identifiants invalides"))));
}

export class GameSocket {
  constructor(onSnapshot, onStatus) {
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.ws = null;
    this.closedByUser = false;
  }
  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.onStatus("connected");
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "snapshot") this.onSnapshot(msg.data);
    };
    this.ws.onclose = () => {
      this.onStatus("disconnected");
      if (!this.closedByUser) setTimeout(() => this.connect(), 3000);
    };
  }
  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  command(data) {
    this.send({ type: "command", data });
  }
  close() {
    this.closedByUser = true;
    this.ws && this.ws.close();
  }
}
