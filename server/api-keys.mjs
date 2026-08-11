import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_TOKEN_PREFIX = "ucar_v1_";
export const API_KEY_HEADER = "x-api-key";

const KEY_ID_BYTES = 8;
const KEY_SECRET_BYTES = 32;
const KEY_ID_PATTERN = "[0-9a-f]{16}";
const KEY_SECRET_PATTERN = "[A-Za-z0-9_-]{43}";
const API_KEY_PATTERN = new RegExp(
  `^${API_KEY_TOKEN_PREFIX}(${KEY_ID_PATTERN})_(${KEY_SECRET_PATTERN})$`,
);
const API_KEY_PREFIX_PATTERN = new RegExp(`^${API_KEY_TOKEN_PREFIX}${KEY_ID_PATTERN}$`);
const MAX_PRESENTED_KEY_LENGTH = 128;
const DUMMY_HASH = createHash("sha256").update("ucar-invalid-api-key").digest();
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function kstParts(value) {
  const date = normalizeDate(value) ?? new Date();
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
  };
}

function nextKstDate(dateLabel) {
  const start = Date.parse(`${dateLabel}T00:00:00+09:00`);
  return new Date(start + DAY_MS + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function dailyWindow(dateLabel) {
  const nextDate = nextKstDate(dateLabel);
  return {
    activeFrom: `${dateLabel}T00:00:00+09:00`,
    expiresAt: `${nextDate}T00:00:00+09:00`,
    nextDate,
  };
}

function normalizeName(value, fallback = "classroom key") {
  const name = String(value ?? fallback).trim();
  if (!name || name.length > 120 || /[\r\n\0]/.test(name)) {
    throw new TypeError("API key name must contain 1 to 120 printable characters.");
  }
  return name;
}

function normalizeHash(value) {
  if (Buffer.isBuffer(value)) {
    return value.length === 32 ? Buffer.from(value) : null;
  }
  if (value instanceof Uint8Array) {
    return value.byteLength === 32 ? Buffer.from(value) : null;
  }
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }
  return null;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid API key timestamp.");
  return date;
}

function recordValue(record, camelName, snakeName) {
  return record?.[camelName] ?? record?.[snakeName];
}

function normalizeStoredRecord(record, fallbackId) {
  if (!record || typeof record !== "object") {
    throw new TypeError("API key record must be an object.");
  }

  const keyPrefix = String(recordValue(record, "keyPrefix", "key_prefix") ?? "");
  if (!API_KEY_PREFIX_PATTERN.test(keyPrefix)) {
    throw new TypeError("API key record has an invalid key prefix.");
  }

  const keyHash = normalizeHash(recordValue(record, "keyHash", "key_hash"));
  if (!keyHash) throw new TypeError("API key record must contain a 32-byte SHA-256 hash.");

  return {
    id: record.id ?? fallbackId,
    name: normalizeName(record.name),
    keyPrefix,
    keyHash,
    createdAt: normalizeDate(recordValue(record, "createdAt", "created_at")) ?? new Date(),
    lastUsedAt: normalizeDate(recordValue(record, "lastUsedAt", "last_used_at")),
    revokedAt: normalizeDate(recordValue(record, "revokedAt", "revoked_at")),
  };
}

function publicRecord(record, { includeHash = false } = {}) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    ...(includeHash ? { keyHash: Buffer.from(record.keyHash) } : {}),
    createdAt: record.createdAt ? new Date(record.createdAt) : null,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
  };
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }

  const lowerName = name.toLowerCase();
  const direct = headers[lowerName] ?? headers[name];
  if (Array.isArray(direct)) return direct.length === 1 ? direct[0] : null;
  return direct;
}

export function parseApiKey(rawKey) {
  if (typeof rawKey !== "string" || rawKey.length > MAX_PRESENTED_KEY_LENGTH) return null;
  const match = API_KEY_PATTERN.exec(rawKey);
  if (!match) return null;
  return {
    keyPrefix: `${API_KEY_TOKEN_PREFIX}${match[1]}`,
  };
}

export function isApiKeyPrefix(value) {
  return typeof value === "string" && API_KEY_PREFIX_PATTERN.test(value);
}

export function hashApiKey(rawKey) {
  if (typeof rawKey !== "string") throw new TypeError("API key must be a string.");
  return createHash("sha256").update(rawKey, "utf8").digest();
}

export function verifyApiKeyHash(rawKey, expectedHash) {
  if (typeof rawKey !== "string" || rawKey.length > MAX_PRESENTED_KEY_LENGTH) return false;
  const actualHash = hashApiKey(rawKey);
  const normalizedExpectedHash = normalizeHash(expectedHash);
  const comparisonHash = normalizedExpectedHash ?? DUMMY_HASH;
  const matches = timingSafeEqual(actualHash, comparisonHash);
  return normalizedExpectedHash !== null && matches;
}

export function generateApiKey({ name = "classroom key", randomBytesFn = randomBytes } = {}) {
  const keyId = Buffer.from(randomBytesFn(KEY_ID_BYTES)).toString("hex");
  const secret = Buffer.from(randomBytesFn(KEY_SECRET_BYTES)).toString("base64url");
  const keyPrefix = `${API_KEY_TOKEN_PREFIX}${keyId}`;
  const rawKey = `${keyPrefix}_${secret}`;

  if (!API_KEY_PATTERN.test(rawKey)) {
    throw new Error("The random byte source returned an invalid API key payload.");
  }

  return {
    name: normalizeName(name),
    rawKey,
    keyPrefix,
    keyHash: hashApiKey(rawKey),
  };
}

export function createDailyApiKeyProvider({ secret, now = () => new Date() } = {}) {
  const normalizedSecret = String(secret ?? "");
  if (normalizedSecret.length < 32) {
    throw new Error("DAILY_API_KEY_SECRET must contain at least 32 characters.");
  }

  function keyForDate(dateLabel) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateLabel))) {
      throw new TypeError("Daily API key date must use YYYY-MM-DD.");
    }
    const keyId = createHmac("sha256", normalizedSecret)
      .update(`autodata-lab:daily-key-id:v1:${dateLabel}`)
      .digest()
      .subarray(0, KEY_ID_BYTES)
      .toString("hex");
    const keySecret = createHmac("sha256", normalizedSecret)
      .update(`autodata-lab:daily-key-secret:v1:${dateLabel}`)
      .digest()
      .toString("base64url");
    const keyPrefix = `${API_KEY_TOKEN_PREFIX}${keyId}`;
    return {
      date: dateLabel,
      rawKey: `${keyPrefix}_${keySecret}`,
      keyPrefix,
    };
  }

  function publicKeyRecord(dateLabel) {
    const key = keyForDate(dateLabel);
    const window = dailyWindow(dateLabel);
    return {
      date: dateLabel,
      api_key: key.rawKey,
      key_prefix: key.keyPrefix,
      active_from: window.activeFrom,
      expires_at: window.expiresAt,
    };
  }

  function getPublicSchedule(at = now()) {
    const currentTime = normalizeDate(at) ?? new Date();
    const currentKst = kstParts(currentTime);
    const window = dailyWindow(currentKst.date);
    const expiresAtMs = Date.parse(window.expiresAt);
    return {
      timezone: "Asia/Seoul",
      server_time: new Date(currentTime.getTime() + KST_OFFSET_MS).toISOString().replace("Z", "+09:00"),
      rotation: "daily_at_00:00",
      seconds_until_rotation: Math.max(0, Math.ceil((expiresAtMs - currentTime.getTime()) / 1_000)),
      next_key_published_from: `${currentKst.date}T23:00:00+09:00`,
      current: publicKeyRecord(currentKst.date),
      next: currentKst.hour >= 23 ? publicKeyRecord(window.nextDate) : null,
    };
  }

  async function authenticateRawKey(rawKey) {
    const usedAt = normalizeDate(now()) ?? new Date();
    const currentDate = kstParts(usedAt).date;
    const current = keyForDate(currentDate);
    const actualHash = typeof rawKey === "string" && rawKey.length <= MAX_PRESENTED_KEY_LENGTH
      ? hashApiKey(rawKey)
      : DUMMY_HASH;
    const matches = timingSafeEqual(actualHash, hashApiKey(current.rawKey));
    if (!parseApiKey(rawKey) || !matches) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      principal: {
        id: `daily:${currentDate}`,
        name: `public daily key ${currentDate}`,
        keyPrefix: current.keyPrefix,
      },
      usedAt,
    };
  }

  return {
    keyForDate,
    getPublicSchedule,
    authenticateRawKey,
  };
}

export function parseApiKeyCredential(source) {
  const headers = source?.headers ?? source;
  const headerKey = headerValue(headers, API_KEY_HEADER);
  const authorization = headerValue(headers, "authorization");
  const hasHeaderKey = headerKey !== undefined;
  const hasAuthorization = authorization !== undefined;

  if (hasHeaderKey && hasAuthorization) return { ok: false, reason: "ambiguous" };
  if (!hasHeaderKey && !hasAuthorization) return { ok: false, reason: "missing" };

  if (hasHeaderKey) {
    if (typeof headerKey !== "string") return { ok: false, reason: "malformed" };
    const rawKey = headerKey.trim();
    return rawKey ? { ok: true, rawKey, scheme: "x-api-key" } : { ok: false, reason: "malformed" };
  }

  if (typeof authorization !== "string") return { ok: false, reason: "malformed" };
  const match = /^Bearer[\t ]+([^\t ]+)[\t ]*$/i.exec(authorization);
  return match
    ? { ok: true, rawKey: match[1], scheme: "bearer" }
    : { ok: false, reason: "malformed" };
}

export function extractApiKey(source) {
  const credential = parseApiKeyCredential(source);
  return credential.ok ? credential.rawKey : null;
}

export function readRawApiKeysFromEnv(env = process.env) {
  const variableNames = ["UCAR_API_KEY", "UCAR_API_KEYS", "API_KEY", "API_KEYS"];
  const rawKeys = [];

  for (const variableName of variableNames) {
    const configured = env[variableName];
    if (configured === undefined || configured === null || configured === "") continue;
    const values = String(configured).split(/[\s,]+/).filter(Boolean);
    for (const rawKey of values) {
      if (!parseApiKey(rawKey)) {
        throw new Error(`${variableName} contains an invalid ucar_v1 API key.`);
      }
      rawKeys.push(rawKey);
    }
  }

  return [...new Set(rawKeys)];
}

export function createMemoryApiKeyStore({ rawKeys = [], records = [] } = {}) {
  const recordsByPrefix = new Map();
  const recordsById = new Map();
  let nextId = 1;

  function put(record) {
    const normalized = normalizeStoredRecord(record, nextId);
    if (recordsByPrefix.has(normalized.keyPrefix)) {
      throw new Error(`Duplicate API key prefix: ${normalized.keyPrefix}`);
    }
    if (recordsById.has(String(normalized.id))) {
      throw new Error(`Duplicate API key id: ${normalized.id}`);
    }
    recordsByPrefix.set(normalized.keyPrefix, normalized);
    recordsById.set(String(normalized.id), normalized);
    const numericId = Number(normalized.id);
    nextId = Number.isSafeInteger(numericId) && numericId >= nextId ? numericId + 1 : nextId + 1;
    return publicRecord(normalized);
  }

  for (const rawKey of rawKeys) {
    const parsed = parseApiKey(rawKey);
    if (!parsed) throw new TypeError("Memory API key has an invalid format.");
    put({
      name: `environment key ${parsed.keyPrefix}`,
      keyPrefix: parsed.keyPrefix,
      keyHash: hashApiKey(rawKey),
    });
  }
  for (const record of records) put(record);

  return {
    source: "memory",

    async findByPrefix(keyPrefix) {
      return publicRecord(recordsByPrefix.get(keyPrefix), { includeHash: true });
    },

    async markUsed(id, usedAt = new Date()) {
      const record = recordsById.get(String(id));
      if (!record || record.revokedAt) return false;
      record.lastUsedAt = normalizeDate(usedAt) ?? new Date();
      return true;
    },

    async create(record) {
      return put(record);
    },

    async revokeByPrefix(keyPrefix, revokedAt = new Date()) {
      const record = recordsByPrefix.get(keyPrefix);
      if (!record) return false;
      record.revokedAt ??= normalizeDate(revokedAt) ?? new Date();
      return true;
    },

    async list() {
      return [...recordsByPrefix.values()].map((record) => publicRecord(record));
    },

    async close() {},
  };
}

export function createMemoryApiKeyStoreFromEnv(env = process.env) {
  return createMemoryApiKeyStore({ rawKeys: readRawApiKeysFromEnv(env) });
}

export async function ensureApiKeysTable(executor) {
  if (!executor || typeof executor.execute !== "function") {
    throw new TypeError("A MySQL executor with execute() is required.");
  }
  await executor.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      key_prefix VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      key_hash BINARY(32) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_used_at DATETIME(3) NULL,
      revoked_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_api_keys_prefix (key_prefix),
      UNIQUE KEY uq_api_keys_hash (key_hash),
      KEY idx_api_keys_active (revoked_at, id)
    ) ENGINE = InnoDB
      DEFAULT CHARACTER SET = utf8mb4
      COLLATE = utf8mb4_0900_ai_ci`);
}

export function createMysqlApiKeyStore(executor) {
  if (!executor || typeof executor.execute !== "function") {
    throw new TypeError("A MySQL executor with execute() is required.");
  }

  return {
    source: "mysql",

    async findByPrefix(keyPrefix) {
      const [rows] = await executor.execute(
        `SELECT id, name, key_prefix AS keyPrefix, key_hash AS keyHash,
                created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
           FROM api_keys
          WHERE key_prefix = ?
          LIMIT 1`,
        [keyPrefix],
      );
      return rows.length === 0 ? null : normalizeStoredRecord(rows[0], rows[0].id);
    },

    async markUsed(id, usedAt = new Date()) {
      const [result] = await executor.execute(
        `UPDATE api_keys
            SET last_used_at = ?
          WHERE id = ? AND revoked_at IS NULL`,
        [normalizeDate(usedAt) ?? new Date(), id],
      );
      if (result.affectedRows > 0) return true;

      // Updating twice inside the same millisecond can be reported as zero
      // changed rows by MySQL. Distinguish that from a concurrently revoked key.
      const [activeRows] = await executor.execute(
        "SELECT 1 AS active FROM api_keys WHERE id = ? AND revoked_at IS NULL LIMIT 1",
        [id],
      );
      return activeRows.length > 0;
    },

    async create(record) {
      const normalized = normalizeStoredRecord(record);
      const [result] = await executor.execute(
        `INSERT INTO api_keys (name, key_prefix, key_hash, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalized.name,
          normalized.keyPrefix,
          normalized.keyHash,
          normalized.createdAt,
          normalized.lastUsedAt,
          normalized.revokedAt,
        ],
      );
      return { ...publicRecord(normalized), id: result.insertId };
    },

    async revokeByPrefix(keyPrefix, revokedAt = new Date()) {
      const [result] = await executor.execute(
        `UPDATE api_keys
            SET revoked_at = ?
          WHERE key_prefix = ? AND revoked_at IS NULL`,
        [normalizeDate(revokedAt) ?? new Date(), keyPrefix],
      );
      return result.affectedRows > 0;
    },

    async list() {
      const [rows] = await executor.execute(
        `SELECT id, name, key_prefix AS keyPrefix,
                created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
           FROM api_keys
          ORDER BY id ASC`,
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        createdAt: normalizeDate(row.createdAt),
        lastUsedAt: normalizeDate(row.lastUsedAt),
        revokedAt: normalizeDate(row.revokedAt),
      }));
    },

    async close() {},
  };
}

export function createApiKeyService({ store, dailyApiKeyProvider, now = () => new Date(), markUsedIntervalMs = 60_000 } = {}) {
  if (!store || typeof store.findByPrefix !== "function" || typeof store.markUsed !== "function") {
    throw new TypeError("An API key store with findByPrefix() and markUsed() is required.");
  }

  const normalizedMarkInterval = Number.isSafeInteger(Number(markUsedIntervalMs))
    && Number(markUsedIntervalMs) >= 0
    ? Number(markUsedIntervalMs)
    : 60_000;
  const lastMarkedAtById = new Map();

  async function authenticateRawKey(rawKey) {
    if (dailyApiKeyProvider?.authenticateRawKey) {
      const dailyResult = await dailyApiKeyProvider.authenticateRawKey(rawKey);
      if (dailyResult.ok) return dailyResult;
    }
    const parsed = parseApiKey(rawKey);
    const actualHash = typeof rawKey === "string" && rawKey.length <= MAX_PRESENTED_KEY_LENGTH
      ? hashApiKey(rawKey)
      : DUMMY_HASH;
    const record = parsed ? await store.findByPrefix(parsed.keyPrefix) : null;
    const expectedHash = normalizeHash(record?.keyHash) ?? DUMMY_HASH;
    const hashMatches = timingSafeEqual(actualHash, expectedHash);

    if (!parsed || !record || !hashMatches || record.revokedAt) {
      return { ok: false, reason: "invalid" };
    }

    const usedAt = normalizeDate(now()) ?? new Date();
    const recordId = String(record.id);
    const lastMarkedAt = lastMarkedAtById.get(recordId) ?? 0;
    const shouldMark = usedAt.getTime() - lastMarkedAt >= normalizedMarkInterval;
    const wasActive = shouldMark ? await store.markUsed(record.id, usedAt) : true;
    if (!wasActive) return { ok: false, reason: "invalid" };
    if (shouldMark) lastMarkedAtById.set(recordId, usedAt.getTime());

    return {
      ok: true,
      principal: {
        id: record.id,
        name: record.name,
        keyPrefix: record.keyPrefix,
      },
      usedAt,
    };
  }

  return {
    authenticateRawKey,

    async authenticate(source) {
      const credential = parseApiKeyCredential(source);
      if (!credential.ok) return credential;
      const result = await authenticateRawKey(credential.rawKey);
      return result.ok ? { ...result, scheme: credential.scheme } : result;
    },
  };
}

export const createApiKeyAuthenticator = createApiKeyService;
