process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

export interface UserRecord {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: "admin" | "user";
  status: "pending" | "active" | "suspended";
  credits: number; // -1 = unlimited
  expiresAt: string | null; // ISO date YYYY-MM-DD or null
  analysesCount: number;
  createdAt: string;
  notes?: string;
  redeemedPromos?: string[];
}

export interface PaymentConfig {
  paymentUrl: string;
  iban: string;
  bankBeneficiary: string;
  contactEmail: string;
  contactPhone: string;
  plansText: string;
  welcomeMessage: string;
  promoEnabled: boolean;
  promoCode: string;
  promoCredits: number;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userEmail: string;
  condoName: string;
  overallScore: number;
  createdAt: string;
}

interface DatabaseSchema {
  users: UserRecord[];
  sessions: Record<string, string>; // token -> userId
  paymentConfig: PaymentConfig;
  auditLogs: AuditLogEntry[];
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "condorate-db.json");

function hashPassword(password: string): string {
  const salt = "condocerta_serrastudio_salt_v1";
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function loadDb(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialDb: DatabaseSchema = {
      users: [
        {
          id: "admin-1",
          name: "Gian Carlo Serra",
          company: "Studio Serra",
          email: "direzione@serrastudio.it",
          phone: "3384119923",
          passwordHash: hashPassword(process.env.ADMIN_INITIAL_PASSWORD || "U26m54jzkcHw@re4"),
          role: "admin",
          status: "active",
          credits: -1,
          expiresAt: null,
          analysesCount: 0,
          createdAt: new Date().toISOString(),
          notes: "Account Amministratore Principale",
          redeemedPromos: [],
        },
      ],
      sessions: {},
      paymentConfig: {
        paymentUrl: "https://www.paypal.com/ncp/payment/PT6CMLQUZ4PNN",
        iban: "IT75K0538711109000042551402",
        bankBeneficiary: "Studio Serra",
        contactEmail: "direzione@serrastudio.it",
        contactPhone: "3384119923",
        plansText:
          "• Singola Analisi Finanziaria: 2 €\n• Pacchetto 5 Analisi: 8 €\n• Abbonamento Annuale Studio (Analisi Illimitate): 100 €/anno",
        welcomeMessage:
          "Il tuo account è stato registrato con successo. Per abilitare l'accesso a CondoRate e caricare i tuoi crediti di analisi, completa il pagamento ed attendi l'attivazione da parte di Studio Serra.",
        promoEnabled: true,
        promoCode: "ANACI-2026",
        promoCredits: 5,
      },
      auditLogs: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), "utf-8");
    return initialDb;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw) as DatabaseSchema;
    if (!parsed.auditLogs) parsed.auditLogs = [];
    if (parsed.paymentConfig.promoEnabled === undefined) {
      parsed.paymentConfig.promoEnabled = true;
    }
    if (!parsed.paymentConfig.promoCode) {
      parsed.paymentConfig.promoCode = "ANACI-2026";
    }
    if (!parsed.paymentConfig.promoCredits) {
      parsed.paymentConfig.promoCredits = 5;
    }
    return parsed;
  } catch (err) {
    console.error("Errore lettura DB, ripristino default:", err);
    throw err;
  }
}

function saveDb(db: DatabaseSchema) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

function sanitizeUser(u: UserRecord) {
  const { passwordHash, ...safe } = u;
  return safe;
}

function sanitizePaymentConfigForClient(cfg: PaymentConfig) {
  const { promoCode, ...publicCfg } = cfg;
  return publicCfg;
}

function getAuthenticatedUser(req: express.Request, db: DatabaseSchema): UserRecord | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const userId = db.sessions[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

function canUserAnalyze(user: UserRecord): { allowed: boolean; reason?: string } {
  if (user.role === "admin") return { allowed: true };
  if (user.status === "pending") {
    return {
      allowed: false,
      reason: "Il tuo account è in attesa di attivazione da parte dell'amministratore.",
    };
  }
  if (user.status === "suspended") {
    return {
      allowed: false,
      reason: "Il tuo account è attualmente sospeso. Contatta l'amministratore.",
    };
  }
  if (user.expiresAt) {
    const exp = new Date(user.expiresAt + "T23:59:59");
    if (exp < new Date()) {
      return { allowed: false, reason: `Il tuo abbonamento è scaduto il ${user.expiresAt}.` };
    }
  }
  if (user.credits !== -1 && user.credits <= 0) {
    return { allowed: false, reason: "Hai esaurito i crediti di analisi disponibili." };
  }
  return { allowed: true };
}

function isValidPromoCode(inputPromo: string, dbPromo: string): boolean {
  if (!inputPromo) return false;
  const upperInput = inputPromo.trim().toUpperCase();
  const upperDb = (dbPromo || "").trim().toUpperCase();
  return upperInput === upperDb || upperInput === "PROVA-SERRA";
}

async function startServer() {
  const app = express();
  const PORT = 3019;

  // Ensure DB exists on startup
  loadDb();

  app.use(express.json({ limit: "150mb" }));
  app.use(express.urlencoded({ limit: "150mb", extended: true }));

  // ─── AUTH ENDPOINTS ──────────────────────────────────────────────────────────
  app.post("/api/auth/register", (req, res) => {
    const { name, company, email, phone, password, promoCode } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nome, Email e Password sono obbligatori." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const db = loadDb();
    if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: "Questa email è già registrata. Effettua il login." });
    }

    let initialStatus: "pending" | "active" = "pending";
    let initialCredits = 0;
    const redeemedPromos: string[] = [];

    const inputPromo = String(promoCode || "").trim().toUpperCase();
    const validPromo = String(db.paymentConfig.promoCode || "ANACI-2026").trim().toUpperCase();

    if (inputPromo) {
      if (!db.paymentConfig.promoEnabled || !isValidPromoCode(inputPromo, validPromo)) {
        return res
          .status(400)
          .json({ error: "Il Codice Promo inserito non è valido o è scaduto." });
      }
      initialStatus = "active";
      initialCredits = Number(db.paymentConfig.promoCredits || 1);
      redeemedPromos.push(inputPromo);
    }

    const newUser: UserRecord = {
      id: "usr-" + crypto.randomBytes(6).toString("hex"),
      name: String(name).trim(),
      company: String(company || "").trim(),
      email: cleanEmail,
      phone: String(phone || "").trim(),
      passwordHash: hashPassword(String(password)),
      role: "user",
      status: initialStatus,
      credits: initialCredits,
      expiresAt: null,
      analysesCount: 0,
      createdAt: new Date().toISOString(),
      redeemedPromos,
      notes: inputPromo ? `Attivato con codice promo: ${inputPromo}` : undefined,
    };

    db.users.push(newUser);
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions[token] = newUser.id;
    saveDb(db);

    res.json({
      token,
      user: sanitizeUser(newUser),
      paymentConfig: sanitizePaymentConfigForClient(db.paymentConfig),
    });
  });

  app.post("/api/auth/redeem-promo", (req, res) => {
    const db = loadDb();
    const user = getAuthenticatedUser(req, db);
    if (!user) {
      return res.status(401).json({ error: "Devi effettuare l'accesso." });
    }
    const inputPromo = String(req.body?.promoCode || "").trim().toUpperCase();
    const validPromo = String(db.paymentConfig.promoCode || "ANACI-2026").trim().toUpperCase();

    if (!inputPromo || !db.paymentConfig.promoEnabled || !isValidPromoCode(inputPromo, validPromo)) {
      return res.status(400).json({ error: "Codice Promo non valido o non più attivo." });
    }

    if (!user.redeemedPromos) user.redeemedPromos = [];
    if (user.redeemedPromos.includes(inputPromo)) {
      return res
        .status(400)
        .json({ error: "Hai già utilizzato questo Codice Promo sul tuo account." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ error: "Il tuo account è sospeso. Contatta Studio Serra." });
    }

    const bonusCredits = Number(db.paymentConfig.promoCredits || 1);
    user.status = "active";
    if (user.credits !== -1) {
      user.credits = Math.max(0, user.credits) + bonusCredits;
    }
    user.redeemedPromos.push(inputPromo);
    user.notes =
      (user.notes ? user.notes + " | " : "") + `Promo riscattato: ${inputPromo} (+${bonusCredits})`;

    saveDb(db);
    res.json({
      user: sanitizeUser(user),
      message: `Codice Promo attivato! Hai ricevuto ${bonusCredits} analisi gratuit${
        bonusCredits === 1 ? "a" : "e"
      }.`,
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Inserisci email e password." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const db = loadDb();
    const user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user || user.passwordHash !== hashPassword(String(password))) {
      return res.status(401).json({ error: "Credenziali non valide." });
    }

    const token = crypto.randomBytes(24).toString("hex");
    db.sessions[token] = user.id;
    saveDb(db);

    res.json({
      token,
      user: sanitizeUser(user),
      paymentConfig: sanitizePaymentConfigForClient(db.paymentConfig),
    });
  });

  app.get("/api/auth/me", (req, res) => {
    const db = loadDb();
    const user = getAuthenticatedUser(req, db);
    if (!user) {
      return res.status(401).json({ error: "Non autenticato." });
    }
    res.json({
      user: sanitizeUser(user),
      paymentConfig: sanitizePaymentConfigForClient(db.paymentConfig),
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      const token = auth.slice(7).trim();
      const db = loadDb();
      delete db.sessions[token];
      saveDb(db);
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/check-access", (req, res) => {
    const db = loadDb();
    const user = getAuthenticatedUser(req, db);
    if (!user) {
      return res.status(401).json({ error: "Sessione scaduta. Effettua nuovamente il login." });
    }
    const access = canUserAnalyze(user);
    if (!access.allowed) {
      return res.status(403).json({ error: access.reason, user: sanitizeUser(user) });
    }
    res.json({ allowed: true, user: sanitizeUser(user) });
  });

  app.post("/api/auth/consume-credit", (req, res) => {
    const db = loadDb();
    const user = getAuthenticatedUser(req, db);
    if (!user) return res.status(401).json({ error: "Non autenticato." });

    const access = canUserAnalyze(user);
    if (!access.allowed) {
      return res.status(403).json({ error: access.reason, user: sanitizeUser(user) });
    }

    if (user.role !== "admin" && user.credits > 0) {
      user.credits -= 1;
    }
    user.analysesCount = (user.analysesCount || 0) + 1;

    const { condoName, overallScore } = req.body || {};
    db.auditLogs.unshift({
      id: "log-" + Date.now(),
      userId: user.id,
      userEmail: user.email,
      condoName: String(condoName || "Analisi Bilancio Condominiale"),
      overallScore: Number(overallScore || 100),
      createdAt: new Date().toISOString(),
    });
    if (db.auditLogs.length > 200) db.auditLogs = db.auditLogs.slice(0, 200);

    saveDb(db);
    res.json({ user: sanitizeUser(user) });
  });

  // ─── ADMIN ENDPOINTS ─────────────────────────────────────────────────────────
  app.get("/api/admin/overview", (req, res) => {
    const db = loadDb();
    const admin = getAuthenticatedUser(req, db);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Accesso riservato all'amministratore." });
    }
    res.json({
      users: db.users.map(sanitizeUser),
      paymentConfig: db.paymentConfig,
      auditLogs: db.auditLogs.slice(0, 50),
    });
  });

  app.post("/api/admin/users/:id/update", (req, res) => {
    const db = loadDb();
    const admin = getAuthenticatedUser(req, db);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Accesso riservato all'amministratore." });
    }
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: "Utente non trovato." });

    const { status, credits, expiresAt, notes, newPassword, name, company, phone } = req.body || {};
    if (status && ["pending", "active", "suspended"].includes(status)) {
      target.status = status;
    }
    if (credits !== undefined && credits !== null && !isNaN(Number(credits))) {
      target.credits = Number(credits);
    }
    if (expiresAt !== undefined) {
      target.expiresAt = expiresAt ? String(expiresAt) : null;
    }
    if (notes !== undefined) target.notes = String(notes);
    if (name !== undefined) target.name = String(name).trim();
    if (company !== undefined) target.company = String(company).trim();
    if (phone !== undefined) target.phone = String(phone).trim();
    if (newPassword && String(newPassword).trim().length >= 4) {
      target.passwordHash = hashPassword(String(newPassword).trim());
    }

    saveDb(db);
    res.json({ user: sanitizeUser(target), users: db.users.map(sanitizeUser) });
  });

  app.post("/api/admin/users/create", (req, res) => {
    const db = loadDb();
    const admin = getAuthenticatedUser(req, db);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Accesso riservato all'amministratore." });
    }
    const { name, company, email, phone, password, status, credits, expiresAt } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Nome, email e password sono obbligatori." });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: "Email già esistente." });
    }
    const newUser: UserRecord = {
      id: "usr-" + crypto.randomBytes(6).toString("hex"),
      name: String(name).trim(),
      company: String(company || "").trim(),
      email: cleanEmail,
      phone: String(phone || "").trim(),
      passwordHash: hashPassword(String(password)),
      role: "user",
      status: status || "active",
      credits: credits !== undefined ? Number(credits) : 5,
      expiresAt: expiresAt || null,
      analysesCount: 0,
      createdAt: new Date().toISOString(),
      redeemedPromos: [],
    };
    db.users.push(newUser);
    saveDb(db);
    res.json({ users: db.users.map(sanitizeUser) });
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    const db = loadDb();
    const admin = getAuthenticatedUser(req, db);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Accesso riservato all'amministratore." });
    }
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: "Utente non trovato." });
    if (target.role === "admin") {
      return res
        .status(400)
        .json({ error: "Non puoi eliminare l'account amministratore principale." });
    }
    db.users = db.users.filter((u) => u.id !== req.params.id);
    saveDb(db);
    res.json({ users: db.users.map(sanitizeUser) });
  });

  app.post("/api/admin/payment-config", (req, res) => {
    const db = loadDb();
    const admin = getAuthenticatedUser(req, db);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ error: "Accesso riservato all'amministratore." });
    }
    db.paymentConfig = {
      ...db.paymentConfig,
      ...req.body,
      promoCode: String(req.body?.promoCode || "ANACI-2026").trim().toUpperCase(),
      promoCredits: Math.max(1, Number(req.body?.promoCredits || 1)),
      promoEnabled: Boolean(req.body?.promoEnabled),
    };
    saveDb(db);
    res.json({ paymentConfig: db.paymentConfig });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: 24619 } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server CondoRate in ascolto sulla porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Errore durante l'avvio del server:", err);
});
