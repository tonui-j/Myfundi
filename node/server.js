const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcryptjs");
const fs = require("fs/promises");
const path = require("path");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { ROOT_DIR, DATA_DIR, createDbConnection, bootstrapDatabase, DB_CONFIG } = require("./db");

const sessionPool = require("mysql2/promise").createPool(DB_CONFIG);
const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000, // prune expired sessions every 15 min
    expiration: 7 * 24 * 60 * 60 * 1000      // session TTL: 7 days
  },
  sessionPool
);

const app = express();
const PORT = Number(process.env.PORT || 8000);
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "myfundi-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

function normalizeRole(roleRaw) {
  const role = String(roleRaw || "customer").trim().toLowerCase();
  if (role === "worker") return "worker";
  if (role === "client" || role === "user" || role === "customer") return "customer";
  return "customer";
}

function text(res, statusCode, body) {
  res.status(statusCode).type("text/plain").send(body);
}

async function createWorkerProfile(conn, workerData) {
  const [columns] = await conn.query("SHOW COLUMNS FROM workers");
  const names = new Set(columns.map((column) => String(column.Field || "").toLowerCase()));
  const defaults = {
    user_id: null,
    username: null,
    email: null,
    password_hash: null,
    profile_image: null,
    name: "",
    skill: "General Worker",
    location: "Kajiado",
    rating: 0,
    reviews: JSON.stringify([]),
    price_per_hour: 0,
    bio: "New worker profile. Update details from your dashboard.",
    portfolio: JSON.stringify([]),
    verified: 0,
    availability: JSON.stringify([])
  };
  const payload = { ...defaults, ...workerData };

  const fields = Object.keys(payload).filter((field) => names.has(field));
  const values = fields.map((field) => payload[field]);
  const placeholders = fields.map(() => "?").join(", ");

  const [result] = await conn.execute(
    `INSERT INTO workers (${fields.join(", ")}) VALUES (${placeholders})`,
    values
  );
  return Number(result.insertId);
}

async function findAccountByLogin(conn, identifier) {
  const [clientRows] = await conn.execute(
    "SELECT id, username, email, display_name, password_hash, role, profile_image, created_at FROM clients WHERE username = ? OR email = ? LIMIT 1",
    [identifier, identifier]
  );
  if (clientRows.length) {
    return { source: "clients", account: clientRows[0] };
  }

  const [workerRows] = await conn.execute(
    `SELECT id, username, email, name, password_hash, profile_image, created_at
     FROM workers
     WHERE username = ? OR email = ?
     LIMIT 1`,
    [identifier, identifier]
  );
  if (workerRows.length) {
    return {
      source: "workers",
      account: {
        ...workerRows[0],
        display_name: workerRows[0].name,
        role: "worker"
      }
    };
  }

  return null;
}

async function usernameOrEmailExists(conn, username, email) {
  const [clientRows] = await conn.execute(
    "SELECT id FROM clients WHERE username = ? OR email = ? LIMIT 1",
    [username, email]
  );
  if (clientRows.length) return true;

  const [workerRows] = await conn.execute(
    "SELECT id FROM workers WHERE username = ? OR email = ? LIMIT 1",
    [username, email]
  );
  return workerRows.length > 0;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function parseTextList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAvailabilityStatus(list) {
  const lowered = list.map((item) => String(item || "").trim().toLowerCase());
  if (lowered.includes("unavailable")) return "unavailable";
  if (lowered.includes("available")) return "available";
  return "available";
}

function withAvailabilityStatus(list, status) {
  const cleaned = list.filter((item) => {
    const value = String(item || "").trim().toLowerCase();
    return value !== "available" && value !== "unavailable";
  });
  return [status, ...cleaned];
}

async function getCurrentWorker(conn, sessionUserId) {
  const id = Number(sessionUserId);
  const [rows] = await conn.execute(
    `SELECT id, user_id, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, rejection_reason, availability, created_at
     FROM workers
     WHERE id = ? OR user_id = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [id, id, id]
  );
  return rows.length ? rows[0] : null;
}

async function getCurrentClient(conn, sessionUserId) {
  const [rows] = await conn.execute(
    `SELECT id, username, display_name, email, password_hash, role, profile_image, created_at
     FROM clients
     WHERE id = ?
     LIMIT 1`,
    [Number(sessionUserId)]
  );
  return rows.length ? rows[0] : null;
}

async function emailInUseByOtherAccount(conn, email, clientId) {
  const [clientRows] = await conn.execute(
    "SELECT id FROM clients WHERE email = ? AND id <> ? LIMIT 1",
    [email, Number(clientId)]
  );
  if (clientRows.length) return true;

  const [workerRows] = await conn.execute("SELECT id FROM workers WHERE email = ? LIMIT 1", [email]);
  return workerRows.length > 0;
}

function mapWorker(row) {
  return {
    id: Number(row.id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    name: row.name,
    skill: row.skill,
    location: row.location,
    rating: Number(row.rating || 0),
    reviews: parseJsonArray(row.reviews),
    price_per_hour: Number(row.price_per_hour || 0),
    bio: row.bio || "",
    portfolio: parseJsonArray(row.portfolio),
    verified: Boolean(Number(row.verified || 0)),
    rejection_reason: row.rejection_reason || "",
    availability: parseJsonArray(row.availability),
    created_at: row.created_at
  };
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_error) {
    return [];
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function requireAdmin(req, res, next) {
  if (!req.session.user_id || req.session.role !== "admin") {
    res.redirect("/index.html");
    return;
  }
  next();
}

function requireAdminApi(req, res, next) {
  if (!req.session.user_id || req.session.role !== "admin") {
    res.status(403).json({ error: "Forbidden - admin required" });
    return;
  }
  next();
}

function requireCustomer(req, res, next) {
  if (!req.session.user_id || req.session.role !== "customer") {
    res.status(403).json({ error: "Forbidden - client login required" });
    return;
  }
  next();
}

async function logAudit(conn, adminId, action, targetType, targetId, detail) {
  try {
    await conn.execute(
      "INSERT INTO audit_logs (admin_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)",
      [Number(adminId), String(action), targetType || null, targetId ? Number(targetId) : null, detail || null]
    );
  } catch (_error) {
    // Never let audit logging break a main operation
  }
}

app.post(["/api/auth/register", "/api/register"], async (req, res) => {
  const conn = await createDbConnection();
  try {
    await conn.beginTransaction();

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim();
    const display = String(req.body.display_name || username).trim();
    const requestedRole = String(req.body.role || "").trim().toLowerCase();
    const role = normalizeRole(req.body.role);

    if (!username || !password || !email) {
      await conn.rollback();
      text(res, 400, "Missing required fields");
      return;
    }

    if (requestedRole === "admin") {
      await conn.rollback();
      text(res, 403, "Admin accounts can only be created directly in the database");
      return;
    }

    const existing = await usernameOrEmailExists(conn, username, email);
    if (existing) {
      await conn.rollback();
      text(res, 400, "Username or email already exists");
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    let userId;

    if (role === "worker") {
      userId = await createWorkerProfile(conn, {
        username,
        email,
        password_hash: hash,
        name: display
      });
    } else {
      const [insertResult] = await conn.execute(
        "INSERT INTO clients (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
        [username, display, email, hash, "customer"]
      );
      userId = Number(insertResult.insertId);
    }

    await conn.commit();

    req.session.user_id = userId;
    req.session.username = username;
    req.session.role = role;
    req.session.account_source = role === "worker" ? "workers" : "clients";

    text(res, 200, `Registered and logged in as ${username}`);
  } catch (error) {
    await conn.rollback();
    console.error("Registration failed:", error);
    text(res, 500, "Failed to create account");
  } finally {
    await conn.end();
  }
});

app.post(["/api/auth/login", "/api/login"], async (req, res) => {
  const conn = await createDbConnection();
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      text(res, 400, "Missing credentials");
      return;
    }

    const foundAccount = await findAccountByLogin(conn, username);
    if (!foundAccount) {
      text(res, 401, "Invalid username or password");
      return;
    }

    const { source, account: found } = foundAccount;
    const ok = await bcrypt.compare(password, found.password_hash || "");
    if (!ok) {
      text(res, 401, "Invalid username or password");
      return;
    }

    req.session.user_id = Number(found.id);
    req.session.username = found.username;
    req.session.role = found.role || "customer";
    req.session.account_source = source;

    text(res, 200, "Login successful");
  } finally {
    await conn.end();
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const conn = await createDbConnection();
  const genericMessage = "If that email is registered you will receive a reset link shortly";
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      text(res, 200, genericMessage);
      return;
    }

    const [rows] = await conn.execute(
      "SELECT id, email FROM clients WHERE email = ? LIMIT 1",
      [email]
    );
    if (rows.length) {
      const client = rows[0];
      const token = crypto.randomBytes(32).toString("hex");
      await conn.execute(
        "INSERT INTO password_reset_tokens (client_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))",
        [Number(client.id), token]
      );

      const appUrl = process.env.APP_URL || "http://localhost:8000";
      const resetLink = `${appUrl}/reset-password.html?token=${token}`;
      await mailer.sendMail({
        from: "MyFundi Support <myfundisupport@gmail.com>",
        to: client.email,
        subject: "Reset Your MyFundi Password",
        text:
          "A request was made to reset your MyFundi password.\n\n" +
          `Use this link to set a new password: ${resetLink}\n\n` +
          "This link expires in 1 hour.\n\n" +
          "If you did not request this, you can ignore this email.",
        html:
          "<p>A request was made to reset your MyFundi password.</p>" +
          `<p><a href="${resetLink}">Reset your password</a></p>` +
          "<p>This link expires in 1 hour.</p>" +
          "<p>If you did not request this, you can ignore this email.</p>"
      });
    }

    text(res, 200, genericMessage);
  } catch (error) {
    console.error("Forgot password request failed:", error);
    text(res, 200, genericMessage);
  } finally {
    await conn.end();
  }
});

app.get("/api/auth/verify-reset-token", async (req, res) => {
  const conn = await createDbConnection();
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      res.json({ valid: false, error: "Token is invalid or has expired" });
      return;
    }

    const [rows] = await conn.execute(
      "SELECT id FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1",
      [token]
    );
    if (!rows.length) {
      res.json({ valid: false, error: "Token is invalid or has expired" });
      return;
    }

    res.json({ valid: true });
  } finally {
    await conn.end();
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const conn = await createDbConnection();
  let inTransaction = false;
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");

    if (!token) {
      text(res, 400, "Token is invalid or has expired");
      return;
    }
    if (password.length < 6) {
      text(res, 400, "Password must be at least 6 characters.");
      return;
    }

    const [rows] = await conn.execute(
      "SELECT client_id FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1",
      [token]
    );
    if (!rows.length) {
      text(res, 400, "Token is invalid or has expired");
      return;
    }

    const clientId = Number(rows[0].client_id);
    const hash = await bcrypt.hash(password, 10);

    await conn.beginTransaction();
    inTransaction = true;
    const [updateClient] = await conn.execute(
      "UPDATE clients SET password_hash = ? WHERE id = ?",
      [hash, clientId]
    );
    if (!updateClient.affectedRows) {
      await conn.rollback();
      text(res, 400, "Token is invalid or has expired");
      return;
    }

    await conn.execute("UPDATE password_reset_tokens SET used = 1 WHERE token = ?", [token]);
    await conn.commit();
    inTransaction = false;

    text(res, 200, "Password reset successfully. You can now log in.");
  } catch (error) {
    if (inTransaction) await conn.rollback();
    console.error("Password reset failed:", error);
    text(res, 500, "Failed to reset password");
  } finally {
    await conn.end();
  }
});

app.get(["/api/auth/session", "/api/session"], (req, res) => {
  const logged = Boolean(req.session.user_id);
  res.json({
    logged_in: logged,
      username: logged ? req.session.username || null : null,
    role: logged ? req.session.role || "customer" : null
  });
});

app.get(["/api/auth/profile", "/api/profile"], async (req, res) => {
  if (!req.session.user_id) {
    res.status(401).json({ logged_in: false, error: "Unauthorized" });
    return;
  }

  const conn = await createDbConnection();
  try {
    const source = req.session.account_source || (req.session.role === "worker" ? "workers" : "clients");
    const [rows] = source === "workers"
      ? await conn.execute(
          `SELECT id, username, name AS display_name, email, 'worker' AS role, profile_image, created_at
           FROM workers
           WHERE id = ?
           LIMIT 1`,
          [Number(req.session.user_id)]
        )
      : await conn.execute(
          `SELECT id, username, display_name, email, role, profile_image, created_at
           FROM clients
           WHERE id = ?
           LIMIT 1`,
          [Number(req.session.user_id)]
        );

    if (!rows.length) {
      res.status(404).json({ logged_in: true, error: "User not found" });
      return;
    }

    const user = rows[0];
    res.json({
      logged_in: true,
      user: {
        id: Number(user.id),
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image,
        created_at: user.created_at
      }
    });
  } finally {
    await conn.end();
  }
});

app.get("/api/worker/profile", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      res.status(404).json({ error: "Worker profile not found" });
      return;
    }

    res.json(mapWorker(worker));
  } finally {
    await conn.end();
  }
});

app.post("/api/worker/profile/update", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const skill = String(req.body.skill || "").trim();
  const location = String(req.body.location || "").trim();
  const pricePerHour = Number(req.body.price_per_hour || 0);
  const bio = String(req.body.bio || "").trim();
  const availability = JSON.stringify(parseTextList(req.body.availability));
  const portfolio = JSON.stringify(parseTextList(req.body.portfolio));

  if (!skill || !location) {
    text(res, 400, "Skill and location are required");
    return;
  }

  if (!Number.isFinite(pricePerHour) || pricePerHour < 0) {
    text(res, 400, "Invalid price per hour");
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      text(res, 404, "Worker profile not found");
      return;
    }

    const [result] = await conn.execute(
      `UPDATE workers
       SET skill = ?, location = ?, price_per_hour = ?, bio = ?, availability = ?, portfolio = ?
       WHERE id = ?`,
      [
        skill,
        location,
        pricePerHour,
        bio,
        availability,
        portfolio,
        Number(worker.id)
      ]
    );

    if (!result.affectedRows) {
      text(res, 404, "Worker profile not found");
      return;
    }

    text(res, 200, "Worker profile updated");
  } finally {
    await conn.end();
  }
});

app.post("/api/worker/availability", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const requested = String(req.body.available ?? "").trim().toLowerCase();
  const isAvailable = requested === "true" || requested === "1" || requested === "available";

  const conn = await createDbConnection();
  try {
    const workerRow = await getCurrentWorker(conn, req.session.user_id);
    if (!workerRow) {
      text(res, 404, "Worker profile not found");
      return;
    }

    const worker = mapWorker(workerRow);
    const availability = JSON.stringify(
      withAvailabilityStatus(worker.availability, isAvailable ? "available" : "unavailable")
    );

    await conn.execute("UPDATE workers SET availability = ? WHERE id = ?", [availability, Number(worker.id)]);
    res.json({
      ok: true,
      availability: JSON.parse(availability),
      status: isAvailable ? "available" : "unavailable"
    });
  } finally {
    await conn.end();
  }
});

app.get("/api/worker/bookings", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      res.status(404).json({ error: "Worker profile not found" });
      return;
    }

    const [rows] = await conn.execute(
      `SELECT id, worker_id, booking_date, booking_time, client_name, client_phone, description, client_email, service_address, status, created_at
       FROM bookings
       WHERE worker_id = ?
       ORDER BY created_at DESC`,
      [Number(worker.id)]
    );
    res.json(
      rows.map((booking) => ({
        id: Number(booking.id),
        worker_id: Number(booking.worker_id),
        client_name: booking.client_name,
        client_phone: booking.client_phone,
        client_email: booking.client_email || "",
        service_address: booking.service_address || "",
        date: booking.booking_date,
        time: booking.booking_time,
        description: booking.description,
        status: booking.status,
        created_at: booking.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.post("/api/worker/bookings/:id/status", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const bookingId = Number(req.params.id);
  const requestedStatus = String(req.body.status || "").trim().toLowerCase();
  const nextStatus = requestedStatus === "accept" ? "approved" : requestedStatus === "decline" ? "declined" : requestedStatus;
  if (!bookingId || !["approved", "declined"].includes(nextStatus)) {
    text(res, 400, "Invalid booking status request");
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      text(res, 404, "Worker profile not found");
      return;
    }

    const [result] = await conn.execute(
      "UPDATE bookings SET status = ? WHERE id = ? AND worker_id = ?",
      [nextStatus, bookingId, Number(worker.id)]
    );

    if (!result.affectedRows) {
      text(res, 404, "Booking not found");
      return;
    }

    text(res, 200, `Booking ${nextStatus}`);
  } finally {
    await conn.end();
  }
});

app.patch("/api/bookings/:id/complete", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const bookingId = Number(req.params.id);
  if (!bookingId) {
    text(res, 400, "Invalid booking ID");
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      text(res, 404, "Worker profile not found");
      return;
    }

    const [rows] = await conn.execute(
      "SELECT id, worker_id, status FROM bookings WHERE id = ? LIMIT 1",
      [bookingId]
    );
    if (!rows.length) {
      text(res, 404, "Booking not found");
      return;
    }

    const booking = rows[0];
    if (Number(booking.worker_id) !== Number(worker.id)) {
      text(res, 403, "Only the assigned worker can complete this booking");
      return;
    }

    const currentStatus = String(booking.status || "").toLowerCase();
    if (currentStatus !== "approved") {
      text(res, 400, `Only approved bookings can be completed (current status: ${currentStatus || "unknown"})`);
      return;
    }

    const [result] = await conn.execute(
      "UPDATE bookings SET status = 'completed' WHERE id = ? AND worker_id = ? AND status = 'approved'",
      [bookingId, Number(worker.id)]
    );
    if (!result.affectedRows) {
      text(res, 409, "Booking status changed before completion. Please refresh and try again.");
      return;
    }

    text(res, 200, "Booking marked as completed");
  } finally {
    await conn.end();
  }
});

app.get("/api/client/bookings", requireCustomer, async (req, res) => {
  const conn = await createDbConnection();
  try {
    const clientId = Number(req.session.user_id);
    const [rows] = await conn.execute(
      `SELECT b.id, b.worker_id, w.name AS worker_name, b.booking_date, b.booking_time, b.description, b.status, b.created_at, w.reviews AS worker_reviews
       FROM bookings b
       JOIN workers w ON w.id = b.worker_id
       WHERE b.client_id = ?
       ORDER BY b.created_at DESC`,
      [clientId]
    );

    const bookings = rows.map((booking) => {
      const reviews = parseJsonArray(booking.worker_reviews);
      const reviewed = reviews.some(
        (entry) =>
          Number(entry?.booking_id || 0) === Number(booking.id) &&
          Number(entry?.client_id || 0) === clientId
      );
      const status = String(booking.status || "").toLowerCase();

      return {
        id: Number(booking.id),
        worker_id: Number(booking.worker_id),
        worker_name: booking.worker_name,
        date: booking.booking_date,
        time: booking.booking_time,
        description: booking.description,
        status,
        created_at: booking.created_at,
        reviewed,
        can_review: !reviewed && ["approved", "completed"].includes(status)
      };
    });

    res.json(bookings);
  } finally {
    await conn.end();
  }
});

app.post("/api/client/bookings/:id/cancel", requireCustomer, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!bookingId) {
    text(res, 400, "Invalid booking ID");
    return;
  }

  const conn = await createDbConnection();
  try {
    const clientId = Number(req.session.user_id);
    const [result] = await conn.execute(
      "UPDATE bookings SET status = 'declined' WHERE id = ? AND client_id = ? AND status = 'pending'",
      [bookingId, clientId]
    );
    if (result.affectedRows) {
      text(res, 200, "Booking cancelled");
      return;
    }

    const [rows] = await conn.execute(
      "SELECT id, status FROM bookings WHERE id = ? AND client_id = ? LIMIT 1",
      [bookingId, clientId]
    );
    if (!rows.length) {
      text(res, 404, "Booking not found");
      return;
    }

    text(res, 400, `Only pending bookings can be cancelled (current status: ${rows[0].status})`);
  } finally {
    await conn.end();
  }
});

app.post("/api/client/disputes", requireCustomer, async (req, res) => {
  const bookingId = Number(req.body.booking_id);
  const againstWorkerId = Number(req.body.against_worker_id);
  const description = String(req.body.description || "").trim();
  const clientId = Number(req.session.user_id);

  if (!bookingId || !againstWorkerId || !description) {
    text(res, 400, "booking_id, against_worker_id, and description are required");
    return;
  }

  const conn = await createDbConnection();
  try {
    const [bookingRows] = await conn.execute(
      `SELECT id, status
       FROM bookings
       WHERE id = ? AND client_id = ? AND worker_id = ?
       LIMIT 1`,
      [bookingId, clientId, againstWorkerId]
    );
    if (!bookingRows.length) {
      text(res, 404, "Booking not found");
      return;
    }

    const bookingStatus = String(bookingRows[0].status || "").toLowerCase();
    if (!["approved", "completed"].includes(bookingStatus)) {
      text(res, 400, "Disputes can only be raised on approved/completed bookings");
      return;
    }

    await conn.execute(
      `INSERT INTO disputes (booking_id, raised_by_client_id, against_worker_id, description)
       VALUES (?, ?, ?, ?)`,
      [bookingId, clientId, againstWorkerId, description]
    );
    text(res, 200, "Dispute created");
  } finally {
    await conn.end();
  }
});

app.get("/api/client/disputes", requireCustomer, async (req, res) => {
  const conn = await createDbConnection();
  try {
    const clientId = Number(req.session.user_id);
    const [rows] = await conn.execute(
      `SELECT d.id, d.booking_id, d.against_worker_id, d.description, d.status, d.created_at,
              w.name AS worker_name
       FROM disputes d
       LEFT JOIN workers w ON w.id = d.against_worker_id
       WHERE d.raised_by_client_id = ?
       ORDER BY d.created_at DESC`,
      [clientId]
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        booking_id: row.booking_id == null ? null : Number(row.booking_id),
        against_worker_id: Number(row.against_worker_id),
        worker_name: row.worker_name,
        description: row.description,
        status: row.status,
        created_at: row.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.get("/api/worker/disputes", async (req, res) => {
  if (!req.session.user_id || req.session.role !== "worker") {
    res.status(403).json({ error: "Forbidden - worker login required" });
    return;
  }

  const conn = await createDbConnection();
  try {
    const worker = await getCurrentWorker(conn, req.session.user_id);
    if (!worker) {
      res.status(404).json({ error: "Worker profile not found" });
      return;
    }

    const [rows] = await conn.execute(
      `SELECT d.id, d.booking_id, d.raised_by_client_id, d.description, d.status, d.created_at,
              c.display_name AS client_name
       FROM disputes d
       LEFT JOIN clients c ON c.id = d.raised_by_client_id
       WHERE d.against_worker_id = ?
       ORDER BY d.created_at DESC`,
      [Number(worker.id)]
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        booking_id: row.booking_id == null ? null : Number(row.booking_id),
        raised_by_client_id: row.raised_by_client_id == null ? null : Number(row.raised_by_client_id),
        client_name: row.client_name,
        description: row.description,
        status: row.status,
        created_at: row.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.post("/api/worker/:id/review", requireCustomer, async (req, res) => {
  const workerId = Number(req.params.id);
  const rating = Number(req.body.rating);
  const reviewText = String(req.body.review || req.body.text || "").trim();
  const requestedBookingId = Number(req.body.booking_id || req.body.bookingId || 0);
  const clientId = Number(req.session.user_id);

  if (!workerId) {
    text(res, 400, "Invalid worker ID");
    return;
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    text(res, 400, "Rating must be an integer between 1 and 5");
    return;
  }

  if (!reviewText) {
    text(res, 400, "Review text is required");
    return;
  }

  const conn = await createDbConnection();
  try {
    await conn.beginTransaction();

    const client = await getCurrentClient(conn, clientId);
    if (!client || client.role !== "customer") {
      await conn.rollback();
      text(res, 403, "Client account not found");
      return;
    }

    const [workerRows] = await conn.execute(
      "SELECT id, reviews FROM workers WHERE id = ? LIMIT 1",
      [workerId]
    );
    if (!workerRows.length) {
      await conn.rollback();
      text(res, 404, "Worker not found");
      return;
    }
    const worker = workerRows[0];

    const bookingParams = requestedBookingId
      ? [requestedBookingId, workerId, clientId]
      : [workerId, clientId];
    const bookingSql = requestedBookingId
      ? `SELECT id, status
         FROM bookings
         WHERE id = ? AND worker_id = ? AND client_id = ?
         LIMIT 1`
      : `SELECT id, status
         FROM bookings
         WHERE worker_id = ? AND client_id = ? AND status IN ('approved', 'completed')
         ORDER BY created_at DESC
         LIMIT 1`;
    const [bookingRows] = await conn.execute(bookingSql, bookingParams);
    if (!bookingRows.length) {
      await conn.rollback();
      text(res, 403, "No eligible completed booking found for this review");
      return;
    }
    const booking = bookingRows[0];
    if (!["approved", "completed"].includes(String(booking.status || "").toLowerCase())) {
      await conn.rollback();
      text(res, 403, "You can only review after an approved/completed booking");
      return;
    }

    const existingReviews = parseJsonArray(worker.reviews);
    const alreadyReviewed = existingReviews.some(
      (entry) =>
        Number(entry?.booking_id || 0) === Number(booking.id) &&
        Number(entry?.client_id || 0) === clientId
    );
    if (alreadyReviewed) {
      await conn.rollback();
      text(res, 400, "You already reviewed this booking");
      return;
    }

    existingReviews.push({
      booking_id: Number(booking.id),
      client_id: clientId,
      client_name: client.display_name || client.username || "Client",
      rating,
      review: reviewText,
      created_at: new Date().toISOString()
    });

    const ratings = existingReviews
      .map((entry) => Number(entry?.rating))
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
    const averageRating = ratings.length
      ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2))
      : 0;

    await conn.execute("UPDATE workers SET reviews = ?, rating = ? WHERE id = ?", [
      JSON.stringify(existingReviews),
      averageRating,
      workerId
    ]);

    await conn.commit();
    res.json({
      ok: true,
      message: "Review submitted",
      rating: averageRating
    });
  } catch (error) {
    await conn.rollback();
    console.error("Failed to save review:", error);
    text(res, 500, "Failed to save review");
  } finally {
    await conn.end();
  }
});

app.post("/api/client/profile/update", requireCustomer, async (req, res) => {
  const displayName = String(req.body.display_name || "").trim();
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const currentPassword = String(req.body.current_password || "");
  const nextPassword = String(req.body.new_password || req.body.password || "");

  if (!displayName || !email) {
    text(res, 400, "Display name and email are required");
    return;
  }

  if (nextPassword && !currentPassword) {
    text(res, 400, "Current password is required to change password");
    return;
  }

  if (nextPassword && nextPassword.length < 6) {
    text(res, 400, "New password must be at least 6 characters");
    return;
  }

  const conn = await createDbConnection();
  try {
    await conn.beginTransaction();

    const client = await getCurrentClient(conn, req.session.user_id);
    if (!client || client.role !== "customer") {
      await conn.rollback();
      text(res, 404, "Client account not found");
      return;
    }

    const currentEmail = String(client.email || "")
      .trim()
      .toLowerCase();
    if (email !== currentEmail) {
      const emailConflict = await emailInUseByOtherAccount(conn, email, client.id);
      if (emailConflict) {
        await conn.rollback();
        text(res, 400, "Email already exists");
        return;
      }
    }

    let passwordHash = null;
    if (nextPassword) {
      const passwordMatches = await bcrypt.compare(currentPassword, client.password_hash || "");
      if (!passwordMatches) {
        await conn.rollback();
        text(res, 401, "Current password is incorrect");
        return;
      }
      passwordHash = await bcrypt.hash(nextPassword, 10);
    }

    const params = passwordHash
      ? [displayName, email, passwordHash, Number(client.id)]
      : [displayName, email, Number(client.id)];
    const sql = passwordHash
      ? "UPDATE clients SET display_name = ?, email = ?, password_hash = ? WHERE id = ?"
      : "UPDATE clients SET display_name = ?, email = ? WHERE id = ?";
    await conn.execute(sql, params);

    await conn.commit();
    text(res, 200, "Profile updated");
  } catch (error) {
    await conn.rollback();
    console.error("Failed to update client profile:", error);
    text(res, 500, "Failed to update profile");
  } finally {
    await conn.end();
  }
});

app.get(["/api/auth/logout", "/api/logout"], (req, res) => {
  req.session.destroy(() => {
    res.redirect("/index.html");
  });
});

app.get("/api/workers", async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, user_id, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, availability, created_at
       FROM workers
       ORDER BY verified DESC, rating DESC`
    );
    res.json(rows.map(mapWorker));
  } finally {
    await conn.end();
  }
});

app.get("/api/workers/:id", async (req, res) => {
  const conn = await createDbConnection();
  try {
    const workerId = Number(req.params.id);
    if (!workerId) {
      res.status(400).json({ error: "Invalid worker ID" });
      return;
    }

    const [rows] = await conn.execute(
      `SELECT id, user_id, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, availability, created_at
       FROM workers
       WHERE id = ?
       LIMIT 1`,
      [workerId]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Worker not found" });
      return;
    }
    res.json(mapWorker(rows[0]));
  } finally {
    await conn.end();
  }
});

app.post("/api/bookings", async (req, res) => {
  const conn = await createDbConnection();
  try {
    const needed = ["worker_id", "date", "time", "client_name", "client_phone", "description"];
    for (const key of needed) {
      if (!req.body[key]) {
        text(res, 400, `Missing field: ${key}`);
        return;
      }
    }

    const workerId = Number(req.body.worker_id);
    const date = String(req.body.date).trim();
    const time = String(req.body.time).trim();
    const clientName = String(req.body.client_name).trim();
    const clientPhone = String(req.body.client_phone).trim();
    const description = String(req.body.description).trim();
    const clientEmail = String(req.body.client_email || "").trim();
    const serviceAddress = String(req.body.service_address || "").trim();
    const clientId = req.session.user_id && req.session.role === "customer" ? Number(req.session.user_id) : null;
    const status = "pending";

    const [workerRows] = await conn.execute("SELECT id FROM workers WHERE id = ? LIMIT 1", [workerId]);
    if (!workerRows.length) {
      text(res, 404, "Worker not found");
      return;
    }

    const [insertResult] = await conn.execute(
      `INSERT INTO bookings (worker_id, client_id, booking_date, booking_time, client_name, client_phone, description, client_email, service_address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [workerId, clientId, date, time, clientName, clientPhone, description, clientEmail, serviceAddress, status]
    );

    const bookingId = Number(insertResult.insertId);
    const booking = {
      id: bookingId,
      worker_id: workerId,
      client_id: clientId,
      date,
      time,
      client_name: clientName,
      client_phone: clientPhone,
      description,
      client_email: clientEmail,
      service_address: serviceAddress,
      status,
      created_at: new Date().toISOString()
    };

    const bookingsFile = path.join(DATA_DIR, "bookings.json");
    const all = await readJsonArray(bookingsFile);
    all.push(booking);
    await writeJson(bookingsFile, all);

    text(res, 200, `Booking saved. ID: ${bookingId}`);
  } catch (_error) {
    text(res, 500, "Failed to save booking");
  } finally {
    await conn.end();
  }
});

app.post(["/api/workers/verify", "/api/admin/workers/verify"], async (req, res) => {
  if (!req.session.user_id || req.session.role !== "admin") {
    text(res, 403, "Forbidden - admin required");
    return;
  }

  const id = Number(req.body.id);
  if (!id) {
    text(res, 400, "Invalid request");
    return;
  }

  const conn = await createDbConnection();
  try {
    const [result] = await conn.execute("UPDATE workers SET verified = 1 WHERE id = ?", [id]);
    if (!result.affectedRows) {
      text(res, 404, "Worker not found");
      return;
    }

    const workersFile = path.join(DATA_DIR, "workers.json");
    const list = await readJsonArray(workersFile);
    const updated = list.map((w) => (Number(w.id) === id ? { ...w, verified: true } : w));
    await writeJson(workersFile, updated);

    await logAudit(conn, req.session.user_id, "worker.verify", "worker", id, "Worker verified");
    text(res, 200, `Worker verified: ${id}`);
  } finally {
    await conn.end();
  }
});

app.get("/api/admin", requireAdminApi, (req, res) => {
  res.json({
    ok: true,
    role: req.session.role,
    username: req.session.username || null
  });
});

app.get("/api/admin/stats", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [clientRows] = await conn.execute("SELECT COUNT(*) AS total FROM clients WHERE role = 'customer'");
    const [workerRows] = await conn.execute("SELECT COUNT(*) AS total FROM workers");
    const [bookingRows] = await conn.execute("SELECT COUNT(*) AS total FROM bookings");
    const [pendingRows] = await conn.execute("SELECT COUNT(*) AS total FROM workers WHERE verified = 0");

    res.json({
      clients: Number(clientRows?.[0]?.total || 0),
      workers: Number(workerRows?.[0]?.total || 0),
      bookings: Number(bookingRows?.[0]?.total || 0),
      pending_verifications: Number(pendingRows?.[0]?.total || 0)
    });
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/clients", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, username, display_name, email, role, created_at
       FROM clients
       ORDER BY created_at DESC`
    );
    res.json(
      rows.map((client) => ({
        id: Number(client.id),
        username: client.username,
        display_name: client.display_name,
        email: client.email,
        role: client.role,
        created_at: client.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.delete("/api/admin/clients/:id", requireAdminApi, async (req, res) => {
  const clientId = Number(req.params.id);
  if (!clientId) {
    text(res, 400, "Invalid client ID");
    return;
  }
  if (clientId === Number(req.session.user_id)) {
    text(res, 400, "You cannot delete your own admin account");
    return;
  }

  const conn = await createDbConnection();
  try {
    await conn.beginTransaction();

    const [targetRows] = await conn.execute("SELECT id, role FROM clients WHERE id = ? LIMIT 1", [clientId]);
    if (!targetRows.length) {
      await conn.rollback();
      text(res, 404, "Client not found");
      return;
    }
    if (String(targetRows[0].role) === "admin") {
      await conn.rollback();
      text(res, 400, "Admin accounts cannot be deleted from dashboard");
      return;
    }

    await conn.execute("UPDATE bookings SET client_id = NULL WHERE client_id = ?", [clientId]);
    await conn.execute("DELETE FROM clients WHERE id = ?", [clientId]);

    await conn.commit();
    await logAudit(conn, req.session.user_id, "client.delete", "client", clientId, "Client account deleted");
    text(res, 200, "Client deleted");
  } catch (error) {
    await conn.rollback();
    console.error("Failed to delete client:", error);
    text(res, 500, "Failed to delete client");
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/workers", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, name, skill, location, verified, created_at
       FROM workers
       ORDER BY created_at DESC`
    );
    res.json(
      rows.map((worker) => ({
        id: Number(worker.id),
        name: worker.name,
        skill: worker.skill,
        location: worker.location,
        verified: Boolean(Number(worker.verified || 0)),
        created_at: worker.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.delete("/api/admin/workers/:id", requireAdminApi, async (req, res) => {
  const workerId = Number(req.params.id);
  if (!workerId) {
    text(res, 400, "Invalid worker ID");
    return;
  }

  const conn = await createDbConnection();
  try {
    await conn.beginTransaction();

    const [deleteResult] = await conn.execute("DELETE FROM workers WHERE id = ?", [workerId]);
    if (!deleteResult.affectedRows) {
      await conn.rollback();
      text(res, 404, "Worker not found");
      return;
    }

    await conn.execute("DELETE FROM bookings WHERE worker_id = ?", [workerId]);
    await conn.commit();
    await logAudit(conn, req.session.user_id, "worker.delete", "worker", workerId, "Worker and bookings deleted");
    text(res, 200, "Worker deleted");
  } catch (error) {
    await conn.rollback();
    console.error("Failed to delete worker:", error);
    text(res, 500, "Failed to delete worker");
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/pending-workers", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, user_id, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, availability, created_at
       FROM workers
       WHERE verified = 0
       ORDER BY created_at DESC`
    );
    res.json(rows.map(mapWorker));
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/bookings", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT b.id, b.worker_id, w.name AS worker_name, b.client_id, b.client_name, b.booking_date, b.booking_time, b.description, b.status, b.created_at
       FROM bookings b
       LEFT JOIN workers w ON w.id = b.worker_id
       ORDER BY b.created_at DESC`
    );
    const bookings = rows.map((b) => ({
      id: Number(b.id),
      worker_id: Number(b.worker_id),
      worker_name: b.worker_name || `Worker #${Number(b.worker_id)}`,
      client_id: b.client_id == null ? null : Number(b.client_id),
      date: b.booking_date,
      time: b.booking_time,
      client_name: b.client_name,
      description: b.description,
      status: b.status,
      created_at: b.created_at
    }));
    res.json(bookings);
  } finally {
    await conn.end();
  }
});

app.patch("/api/admin/bookings/:id/status", requireAdminApi, async (req, res) => {
  const bookingId = Number(req.params.id);
  const status = String(req.body.status || "")
    .trim()
    .toLowerCase();
  if (!bookingId) {
    text(res, 400, "Invalid booking ID");
    return;
  }
  if (!["pending", "approved", "declined", "completed"].includes(status)) {
    text(res, 400, "Invalid booking status");
    return;
  }

  const conn = await createDbConnection();
  try {
    const [result] = await conn.execute("UPDATE bookings SET status = ? WHERE id = ?", [status, bookingId]);
    if (!result.affectedRows) {
      text(res, 404, "Booking not found");
      return;
    }
    await logAudit(
      conn,
      req.session.user_id,
      "booking.status.update",
      "booking",
      bookingId,
      `Status updated to ${status}`
    );
    text(res, 200, `Booking status updated to ${status}`);
  } finally {
    await conn.end();
  }
});

app.post("/api/admin/workers/:id/reject", requireAdminApi, async (req, res) => {
  const workerId = Number(req.params.id);
  const reason = String(req.body.reason || "").trim();
  if (!workerId) {
    text(res, 400, "Invalid worker ID");
    return;
  }

  const conn = await createDbConnection();
  try {
    const [result] = await conn.execute(
      "UPDATE workers SET verified = 0, rejection_reason = ? WHERE id = ?",
      [reason || null, workerId]
    );
    if (!result.affectedRows) {
      text(res, 404, "Worker not found");
      return;
    }

    await logAudit(
      conn,
      req.session.user_id,
      "worker.reject",
      "worker",
      workerId,
      reason ? `Worker rejected: ${reason}` : "Worker rejected"
    );
    text(res, 200, "Worker rejected");
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/disputes", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT d.id, d.booking_id, d.raised_by_client_id, d.against_worker_id, d.description, d.status, d.created_at,
              c.display_name AS client_name, w.name AS worker_name
       FROM disputes d
       LEFT JOIN clients c ON c.id = d.raised_by_client_id
       LEFT JOIN workers w ON w.id = d.against_worker_id
       ORDER BY d.created_at DESC`
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        booking_id: row.booking_id == null ? null : Number(row.booking_id),
        raised_by_client_id: row.raised_by_client_id == null ? null : Number(row.raised_by_client_id),
        against_worker_id: Number(row.against_worker_id),
        description: row.description,
        status: row.status,
        created_at: row.created_at,
        client_name: row.client_name,
        worker_name: row.worker_name
      }))
    );
  } finally {
    await conn.end();
  }
});

app.post("/api/admin/disputes", requireAdminApi, async (req, res) => {
  const bookingIdRaw = req.body.booking_id;
  const raisedByClientIdRaw = req.body.raised_by_client_id;
  const againstWorkerId = Number(req.body.against_worker_id);
  const description = String(req.body.description || "").trim();

  const bookingId = bookingIdRaw == null || bookingIdRaw === "" ? null : Number(bookingIdRaw);
  const raisedByClientId =
    raisedByClientIdRaw == null || raisedByClientIdRaw === "" ? null : Number(raisedByClientIdRaw);

  if (!againstWorkerId || !description) {
    text(res, 400, "against_worker_id and description are required");
    return;
  }
  if (bookingIdRaw != null && bookingIdRaw !== "" && !Number.isFinite(bookingId)) {
    text(res, 400, "Invalid booking_id");
    return;
  }
  if (raisedByClientIdRaw != null && raisedByClientIdRaw !== "" && !Number.isFinite(raisedByClientId)) {
    text(res, 400, "Invalid raised_by_client_id");
    return;
  }

  const conn = await createDbConnection();
  try {
    await conn.execute(
      `INSERT INTO disputes (booking_id, raised_by_client_id, against_worker_id, description)
       VALUES (?, ?, ?, ?)`,
      [bookingId, raisedByClientId, againstWorkerId, description]
    );
    text(res, 200, "Dispute created");
  } finally {
    await conn.end();
  }
});

app.patch("/api/admin/disputes/:id/status", requireAdminApi, async (req, res) => {
  const disputeId = Number(req.params.id);
  const status = String(req.body.status || "")
    .trim()
    .toLowerCase();

  if (!disputeId) {
    text(res, 400, "Invalid dispute ID");
    return;
  }
  if (!["open", "reviewing", "resolved"].includes(status)) {
    text(res, 400, "Invalid dispute status");
    return;
  }

  const conn = await createDbConnection();
  try {
    const [result] = await conn.execute("UPDATE disputes SET status = ? WHERE id = ?", [status, disputeId]);
    if (!result.affectedRows) {
      text(res, 404, "Dispute not found");
      return;
    }

    await logAudit(
      conn,
      req.session.user_id,
      "dispute.status.update",
      "dispute",
      disputeId,
      `Status updated to ${status}`
    );
    text(res, 200, `Dispute status updated to ${status}`);
  } finally {
    await conn.end();
  }
});

app.get("/api/admin/audit-logs", requireAdminApi, async (_req, res) => {
  const conn = await createDbConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT id, admin_id, action, target_type, target_id, detail, created_at
       FROM audit_logs
       ORDER BY created_at DESC`
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        admin_id: Number(row.admin_id),
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id == null ? null : Number(row.target_id),
        detail: row.detail,
        created_at: row.created_at
      }))
    );
  } finally {
    await conn.end();
  }
});

app.get("/admin", requireAdmin, (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "admin.html"));
});

app.get("/admin.html", requireAdmin, (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "admin.html"));
});

app.use(express.static(ROOT_DIR));

app.listen(PORT, async () => {
  const conn = await createDbConnection();
  try {
    await bootstrapDatabase(conn);
  } finally {
    await conn.end();
  }

  try {
    await sessionStore.createDatabaseTable();
    console.log("Session store: sessions table ready");
  } catch (error) {
    console.error("Session store: failed to initialise sessions table:", error);
  }

  console.log(`MyFundi Node server running at http://localhost:${PORT}`);
});

