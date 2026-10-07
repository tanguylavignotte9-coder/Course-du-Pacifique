// Authentification amateur : comptes créés par l'administrateur (vous),
// mots de passe hachés (scrypt), token de session aléatoire.
import crypto from "node:crypto";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex"));
}
export const newToken = () => crypto.randomBytes(24).toString("hex");

export class Auth {
  constructor(store) {
    this.store = store; // data.accounts: { [name]: {salt, hash} }
    if (!this.store.data.accounts) this.store.data.accounts = {};
    if (!this.store.data.tokens) this.store.data.tokens = {};
  }
  createAccount(name, password) {
    const id = name.trim().toLowerCase();
    if (!id || id.length < 2) throw new Error("nom trop court");
    if (this.store.data.accounts[id]) throw new Error("compte existant");
    const { salt, hash } = hashPassword(password);
    this.store.data.accounts[id] = { salt, hash };
    this.store.save();
    return id;
  }
  login(name, password) {
    const id = name.trim().toLowerCase();
    const acc = this.store.data.accounts[id];
    if (!acc || !verifyPassword(password, acc.salt, acc.hash)) return null;
    const token = newToken();
    this.store.data.tokens[token] = id;
    this.store.save();
    return token;
  }
  accountOf(token) {
    return this.store.data.tokens[token] || null;
  }
  logout(token) {
    delete this.store.data.tokens[token];
    this.store.save();
  }
}
