const fs = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const DB_CONFIG = process.env.DATABASE_URL
  ? {
      uri: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "myfundi"
    };

const CREATE_CLIENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS clients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    profile_image VARCHAR(255) NULL,
    role ENUM('admin','customer') NOT NULL DEFAULT 'customer',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`;

const CREATE_WORKERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS workers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NULL,
    username VARCHAR(80) NULL,
    email VARCHAR(160) NULL,
    password_hash VARCHAR(255) NULL,
    profile_image VARCHAR(255) NULL,
    name VARCHAR(120) NOT NULL,
    skill VARCHAR(80) NOT NULL,
    location VARCHAR(120) NOT NULL,
    rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    reviews TEXT NULL,
    price_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    bio TEXT NULL,
    portfolio TEXT NULL,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    availability TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_workers_username (username),
    UNIQUE KEY uq_workers_email (email),
    KEY idx_workers_skill (skill),
    KEY idx_workers_location (location),
    KEY idx_workers_verified (verified)
  )
`;

const CREATE_BOOKINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS bookings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    worker_id BIGINT UNSIGNED NOT NULL,
    client_id BIGINT UNSIGNED NULL,
    booking_date DATE NOT NULL,
    booking_time TIME NOT NULL,
    client_name VARCHAR(120) NOT NULL,
    client_phone VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    status ENUM('pending','approved','declined','completed') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_bookings_worker_id (worker_id),
    KEY idx_bookings_status (status)
  )
`;

const CREATE_ROLES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS roles (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`;

const CREATE_PERMISSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS permissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`;

const CREATE_ROLE_PERMISSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
      FOREIGN KEY (role_id) REFERENCES roles(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission
      FOREIGN KEY (permission_id) REFERENCES permissions(id)
      ON DELETE CASCADE ON UPDATE CASCADE
  )
`;

async function ignoreDuplicateColumn(promise) {
  try {
    await promise;
  } catch (error) {
    if (error && error.code === "ER_DUP_FIELDNAME") return;
    throw error;
  }
}

async function ignoreErrors(promise, codes) {
  try {
    await promise;
  } catch (error) {
    if (error && codes.includes(error.code)) return;
    throw error;
  }
}

function isMissingTableError(error, tableName) {
  if (!error) return false;

  const code = String(error.code || "");
  const errno = Number(error.errno || 0);
  const sqlState = String(error.sqlState || "");
  const message = String(error.sqlMessage || error.message || "").toLowerCase();

  const missingTableCode =
    code === "ER_NO_SUCH_TABLE" ||
    errno === 1146 ||
    errno === 1932 ||
    sqlState === "42S02";
  if (!missingTableCode) return false;

  const normalizedTable = String(tableName || "").toLowerCase();
  if (!normalizedTable) return true;

  return (
    message.includes(`.${normalizedTable}`) ||
    message.includes(`'${normalizedTable}'`) ||
    message.includes("doesn't exist")
  );
}

function isTablespaceExistsError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const errno = Number(error.errno || 0);
  return code === "ER_TABLESPACE_EXISTS" || errno === 1813;
}

async function cleanupOrphanedTablespaceFiles(conn, tableName) {
  const [rows] = await conn.query("SHOW VARIABLES LIKE 'datadir'");
  const dataDir = String(rows?.[0]?.Value || rows?.[0]?.value || "").trim();
  if (!dataDir) return;

  const dbName = String(DB_CONFIG.database || "").trim();
  if (!dbName) return;

  const dbDir = path.join(dataDir, dbName);
  const staleFiles = [`${tableName}.ibd`, `${tableName}.cfg`, `${tableName}.cfp`];

  for (const file of staleFiles) {
    const filePath = path.join(dbDir, file);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "EISDIR")) continue;
      if (error && (error.code === "EPERM" || error.code === "EACCES")) {
        const permissionError = new Error(
          `MySQL table file cleanup needs elevated permission: ${filePath}. ` +
          "Delete the stale file (or run with sufficient permissions), then restart the server.",
          { cause: error }
        );
        permissionError.code = "ER_TABLESPACE_CLEANUP_DENIED";
        throw permissionError;
      }
      throw error;
    }
  }
}

async function createTableWithRecovery(conn, tableName, createSql) {
  try {
    await conn.query(createSql);
  } catch (error) {
    if (!isTablespaceExistsError(error)) throw error;
    await cleanupOrphanedTablespaceFiles(conn, tableName);
    await conn.query(createSql);
  }
}

async function ensureTableIsUsable(conn, tableName, createSql) {
  await createTableWithRecovery(conn, tableName, createSql);

  try {
    await conn.query(`SHOW COLUMNS FROM ${tableName}`);
  } catch (error) {
    if (!isMissingTableError(error, tableName)) throw error;

    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
    await createTableWithRecovery(conn, tableName, createSql);
    await conn.query(`SHOW COLUMNS FROM ${tableName}`);
  }
}

async function normalizeClientsSchema(conn) {
  const [columns] = await conn.query("SHOW COLUMNS FROM clients");
  const names = new Set(columns.map((c) => String(c.Field || "").toLowerCase()));
  const roleColumn = columns.find((c) => String(c.Field || "").toLowerCase() === "role");

  if (!names.has("username")) {
    await conn.query("ALTER TABLE clients ADD COLUMN username VARCHAR(80) NULL");
    if (names.has("user_name")) {
      await conn.query("UPDATE clients SET username = user_name WHERE username IS NULL OR username = ''");
    } else if (names.has("name")) {
      await conn.query("UPDATE clients SET username = name WHERE username IS NULL OR username = ''");
    }
  }

  if (!names.has("display_name")) {
    await conn.query("ALTER TABLE clients ADD COLUMN display_name VARCHAR(120) NULL");
    if (names.has("full_name")) {
      await conn.query("UPDATE clients SET display_name = full_name WHERE display_name IS NULL OR display_name = ''");
    } else if (names.has("name")) {
      await conn.query("UPDATE clients SET display_name = name WHERE display_name IS NULL OR display_name = ''");
    }
  }

  if (!names.has("email")) {
    await conn.query("ALTER TABLE clients ADD COLUMN email VARCHAR(160) NULL");
  }

  if (!names.has("password_hash")) {
    await conn.query("ALTER TABLE clients ADD COLUMN password_hash VARCHAR(255) NULL");
  }

  if (!names.has("role")) {
    await conn.query("ALTER TABLE clients ADD COLUMN role ENUM('admin','customer') NOT NULL DEFAULT 'customer'");
  } else {
    const roleType = String(roleColumn?.Type || "").toLowerCase();
    const hasExpectedRoles =
      roleType.includes("'admin'") &&
      roleType.includes("'customer'");

    if (!hasExpectedRoles) {
      await conn.query("ALTER TABLE clients MODIFY COLUMN role ENUM('admin','customer') NOT NULL DEFAULT 'customer'");
    }
  }

  await conn.query("UPDATE clients SET username = CONCAT('user', id) WHERE username IS NULL OR username = ''");
  await conn.query("UPDATE clients SET display_name = username WHERE display_name IS NULL OR display_name = ''");
  await conn.query("UPDATE clients SET role = 'customer' WHERE role IS NULL OR role = '' OR role = 'worker'");

  await ignoreErrors(conn.query("CREATE UNIQUE INDEX idx_clients_username ON clients(username)"), [
    "ER_DUP_KEYNAME",
    "ER_DUP_ENTRY"
  ]);
  await ignoreErrors(conn.query("CREATE UNIQUE INDEX idx_clients_email ON clients(email)"), [
    "ER_DUP_KEYNAME",
    "ER_DUP_ENTRY"
  ]);
}

async function normalizeWorkersSchema(conn) {
  const [columns] = await conn.query("SHOW COLUMNS FROM workers");
  const names = new Set(columns.map((c) => String(c.Field || "").toLowerCase()));

  if (!names.has("username")) {
    await conn.query("ALTER TABLE workers ADD COLUMN username VARCHAR(80) NULL");
  }

  if (!names.has("email")) {
    await conn.query("ALTER TABLE workers ADD COLUMN email VARCHAR(160) NULL");
  }

  if (!names.has("password_hash")) {
    await conn.query("ALTER TABLE workers ADD COLUMN password_hash VARCHAR(255) NULL");
  }

  if (!names.has("profile_image")) {
    await conn.query("ALTER TABLE workers ADD COLUMN profile_image VARCHAR(255) NULL");
  }

  await ignoreErrors(conn.query("CREATE UNIQUE INDEX idx_workers_username ON workers(username)"), [
    "ER_DUP_KEYNAME",
    "ER_DUP_ENTRY"
  ]);
  await ignoreErrors(conn.query("CREATE UNIQUE INDEX idx_workers_email ON workers(email)"), [
    "ER_DUP_KEYNAME",
    "ER_DUP_ENTRY"
  ]);
}

async function normalizeBookingsSchema(conn) {
  const [columns] = await conn.query("SHOW COLUMNS FROM bookings");
  const names = new Set(columns.map((c) => String(c.Field || "").toLowerCase()));
  const statusColumn = columns.find((c) => String(c.Field || "").toLowerCase() === "status");

  if (!names.has("client_id")) {
    await conn.query("ALTER TABLE bookings ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER worker_id");
  }

  const statusType = String(statusColumn?.Type || "").toLowerCase();
  const hasCompletedStatus =
    statusType.includes("'pending'") &&
    statusType.includes("'approved'") &&
    statusType.includes("'declined'") &&
    statusType.includes("'completed'");
  if (!hasCompletedStatus) {
    await conn.query(
      "ALTER TABLE bookings MODIFY COLUMN status ENUM('pending','approved','declined','completed') NOT NULL DEFAULT 'pending'"
    );
  }

  await ignoreErrors(conn.query("CREATE INDEX idx_bookings_client_id ON bookings(client_id)"), [
    "ER_DUP_KEYNAME"
  ]);
}

async function createDbConnection() {
  const conn = process.env.DATABASE_URL
    ? await mysql.createConnection(process.env.DATABASE_URL)
    : await mysql.createConnection(DB_CONFIG);
  await conn.query("SET NAMES utf8mb4");
  return conn;
}

async function bootstrapDatabase(conn) {
  await ensureTableIsUsable(conn, "clients", CREATE_CLIENTS_TABLE_SQL);
  await normalizeClientsSchema(conn);

  await ignoreDuplicateColumn(conn.query("ALTER TABLE clients ADD COLUMN profile_image VARCHAR(255) NULL"));

  await ensureTableIsUsable(conn, "workers", CREATE_WORKERS_TABLE_SQL);
  await normalizeWorkersSchema(conn);

  await ensureTableIsUsable(conn, "bookings", CREATE_BOOKINGS_TABLE_SQL);
  await normalizeBookingsSchema(conn);
  await ignoreDuplicateColumn(conn.query("ALTER TABLE bookings ADD COLUMN client_email VARCHAR(160) NULL"));
  await ignoreDuplicateColumn(conn.query("ALTER TABLE bookings ADD COLUMN service_address TEXT NULL"));

  await ensureTableIsUsable(conn, "roles", CREATE_ROLES_TABLE_SQL);
  await ensureTableIsUsable(conn, "permissions", CREATE_PERMISSIONS_TABLE_SQL);
  await ensureTableIsUsable(conn, "role_permissions", CREATE_ROLE_PERMISSIONS_TABLE_SQL);

  await ignoreDuplicateColumn(conn.query("ALTER TABLE workers ADD COLUMN rejection_reason VARCHAR(255) NULL"));

  await ensureTableIsUsable(
    conn,
    "disputes",
    `
      CREATE TABLE IF NOT EXISTS disputes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id BIGINT UNSIGNED NULL,
        raised_by_client_id BIGINT UNSIGNED NULL,
        against_worker_id BIGINT UNSIGNED NOT NULL,
        description TEXT NOT NULL,
        status ENUM('open','reviewing','resolved') NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_disputes_status (status)
      )
    `
  );

  await ensureTableIsUsable(
    conn,
    "audit_logs",
    `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        admin_id BIGINT UNSIGNED NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50) NULL,
        target_id BIGINT UNSIGNED NULL,
        detail TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_logs_admin_id (admin_id)
      )
    `
  );

  await ensureTableIsUsable(conn, "password_reset_tokens", `
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id BIGINT UNSIGNED NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_reset_tokens_token (token),
      KEY idx_reset_tokens_client_id (client_id)
    )
  `);

  await conn.query(`
    INSERT IGNORE INTO roles (code, name) VALUES
      ('admin', 'Administrator'),
      ('customer', 'Customer'),
      ('worker', 'Worker')
  `);

  await conn.query(`
    INSERT IGNORE INTO permissions (code, description) VALUES
      ('auth.register', 'Create an account'),
      ('auth.login', 'Log into the system'),
      ('profile.view.self', 'View own profile'),
      ('booking.create', 'Create a booking request'),
      ('worker.profile.create.self', 'Create worker profile during registration'),
      ('admin.dashboard.view', 'View admin dashboard'),
      ('admin.worker.verify', 'Verify worker accounts'),
      ('admin.booking.view', 'View all bookings')
  `);

  await conn.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','booking.create')
    WHERE r.code = 'customer'
  `);

  await conn.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','worker.profile.create.self')
    WHERE r.code = 'worker'
  `);

  await conn.query(`
    INSERT IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','admin.dashboard.view','admin.worker.verify','admin.booking.view')
    WHERE r.code = 'admin'
  `);

  const [admins] = await conn.execute("SELECT id FROM clients WHERE role = 'admin' LIMIT 1");
  if (!admins.length) {
    const adminUsername = String(process.env.ADMIN_USERNAME || "").trim();
    const adminDisplayName = String(process.env.ADMIN_DISPLAY_NAME || "Administrator").trim() || "Administrator";
    const adminEmail = String(process.env.ADMIN_EMAIL || "")
      .trim()
      .toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || "");
    const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();

    let hash = adminPasswordHash;
    if (!hash && adminPassword) {
      const bcrypt = require("bcryptjs");
      hash = await bcrypt.hash(adminPassword, 10);
    }

    if (adminUsername && adminEmail && hash) {
      await conn.execute(
        "INSERT INTO clients (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
        [adminUsername, adminDisplayName, adminEmail, hash, "admin"]
      );
    }
  }

  const [legacyWorkerAccounts] = await conn.query(`
    SELECT c.id, c.username, c.display_name, c.email, c.password_hash, c.profile_image
    FROM clients c
    WHERE c.role = 'worker'
  `);
  for (const worker of legacyWorkerAccounts) {
    await conn.execute(
      `INSERT INTO workers
        (user_id, username, email, password_hash, profile_image, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, availability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username = COALESCE(workers.username, VALUES(username)),
         email = COALESCE(workers.email, VALUES(email)),
         password_hash = COALESCE(workers.password_hash, VALUES(password_hash)),
         profile_image = COALESCE(workers.profile_image, VALUES(profile_image)),
         name = COALESCE(NULLIF(workers.name, ''), VALUES(name))`,
      [
        Number(worker.id),
        worker.username,
        worker.email,
        worker.password_hash,
        worker.profile_image,
        worker.display_name,
        "General Worker",
        "Kajiado",
        0,
        JSON.stringify([]),
        0,
        "New worker profile. Update details from your dashboard.",
        JSON.stringify([]),
        0,
        JSON.stringify([])
      ]
    );
  }
  await conn.query("UPDATE clients SET role = 'customer' WHERE role = 'worker'");

  const [workersCountRows] = await conn.query("SELECT COUNT(*) AS c FROM workers");
  const workersCount = Number(workersCountRows?.[0]?.c || 0);
  if (workersCount > 0) return;

  const workersFile = path.join(DATA_DIR, "workers.json");
  try {
    const raw = await fs.readFile(workersFile, "utf8");
    const workers = JSON.parse(raw);
    for (const w of workers) {
      const id = Number(w.id || 0);
      const name = String(w.name || "").trim();
      const skill = String(w.skill || "").trim();
      const location = String(w.location || "").trim();
      if (!id || !name || !skill || !location) continue;

      await conn.execute(
        `INSERT INTO workers
          (id, name, skill, location, rating, reviews, price_per_hour, bio, portfolio, verified, availability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          id,
          name,
          skill,
          location,
          Number(w.rating || 0),
          JSON.stringify(Array.isArray(w.reviews) ? w.reviews : []),
          Number(w.price_per_hour || 0),
          String(w.bio || ""),
          JSON.stringify(Array.isArray(w.portfolio) ? w.portfolio : []),
          w.verified ? 1 : 0,
          JSON.stringify(Array.isArray(w.availability) ? w.availability : [])
        ]
      );
    }
  } catch (_error) {
    // Keep startup alive if JSON seed file does not exist or is invalid.
  }
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  createDbConnection,
  bootstrapDatabase,
  DB_CONFIG
};
