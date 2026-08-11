import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import {
  createMysqlApiKeyStore,
  ensureApiKeysTable,
  generateApiKey,
  isApiKeyPrefix,
} from "../server/api-keys.mjs";

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function readArgument(name) {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function connectionOptions(env) {
  const common = {
    timezone: "Z",
    connectTimeout: positiveInteger(env.DB_CONNECT_TIMEOUT_MS, 5_000),
  };

  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (url.protocol !== "mysql:") {
      throw new Error("DATABASE_URL must use the mysql:// protocol.");
    }
    return {
      ...common,
      host: url.hostname,
      port: positiveInteger(url.port, 3_306, 65_535),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
  }

  return {
    ...common,
    host: env.DB_HOST || "127.0.0.1",
    port: positiveInteger(env.DB_PORT, 3_306, 65_535),
    user: env.DB_USER || "crawler",
    password: env.DB_PASSWORD ?? "crawler",
    database: env.DB_NAME || "crawl_lab",
  };
}

function usage() {
  return `중고차 수업용 API 키 발급

사용법:
  node scripts/create-api-key.mjs --name "1반 수집 실습"
  node scripts/create-api-key.mjs create --source mysql --name "1반 수집 실습"
  node scripts/create-api-key.mjs revoke --source mysql --prefix ucar_v1_0123456789abcdef
  DATA_SOURCE=mysql node scripts/create-api-key.mjs --name "1반 수집 실습"
  node scripts/create-api-key.mjs --source memory --name "임시 키"

옵션:
  --name <이름>           키 식별 이름 (최대 120자)
  --source memory|mysql  저장 방식 (기본값: DATA_SOURCE 또는 memory)
  --prefix <prefix>      revoke할 공개 식별 prefix (원문 키가 아님)
  --help                  도움말

memory 모드는 발급된 원문 키를 UCAR_API_KEY 또는 UCAR_API_KEYS 환경 변수로
서버에 전달합니다. mysql 모드는 api_keys 테이블에 SHA-256 해시와 prefix만
저장합니다. 원문 키는 어느 모드에서도 이 명령이 끝날 때 한 번만 표시됩니다.`;
}

function normalizeSource(value, env) {
  const configured = String(value ?? env.DATA_SOURCE ?? (env.DATABASE_URL ? "mysql" : "memory"))
    .trim()
    .toLowerCase();
  if (configured === "auto") return env.DATABASE_URL ? "mysql" : "memory";
  if (!["memory", "mysql"].includes(configured)) {
    throw new Error(`Unsupported API key source "${configured}". Use memory or mysql.`);
  }
  return configured;
}

async function connectMysql(env) {
  let mysql;
  try {
    mysql = await import("mysql2/promise");
  } catch (error) {
    throw new Error("MySQL API key creation requires mysql2. Run npm install first.", {
      cause: error,
    });
  }
  const createConnection = mysql.createConnection ?? mysql.default?.createConnection;
  if (typeof createConnection !== "function") {
    throw new Error("The installed mysql2 package does not expose createConnection().");
  }
  return createConnection(connectionOptions(env));
}

export async function createApiKey({ env = process.env, name, source } = {}) {
  const normalizedSource = normalizeSource(source, env);
  const generated = generateApiKey({ name: name ?? "classroom key" });

  if (normalizedSource === "mysql") {
    const connection = await connectMysql(env);
    try {
      await ensureApiKeysTable(connection);
      const store = createMysqlApiKeyStore(connection);
      const record = await store.create({
        name: generated.name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
      });
      return {
        source: normalizedSource,
        id: record.id,
        name: record.name,
        keyPrefix: record.keyPrefix,
        rawKey: generated.rawKey,
      };
    } finally {
      await connection.end();
    }
  }

  return {
    source: normalizedSource,
    id: null,
    name: generated.name,
    keyPrefix: generated.keyPrefix,
    rawKey: generated.rawKey,
  };
}

export async function revokeApiKey({ env = process.env, keyPrefix, source } = {}) {
  const normalizedSource = normalizeSource(source, env);
  if (!isApiKeyPrefix(keyPrefix)) {
    throw new Error("A valid ucar_v1 API key prefix is required for revocation.");
  }

  if (normalizedSource === "memory") {
    return {
      source: normalizedSource,
      keyPrefix,
      revoked: false,
      requiresRestart: true,
    };
  }

  const connection = await connectMysql(env);
  try {
    await ensureApiKeysTable(connection);
    const store = createMysqlApiKeyStore(connection);
    return {
      source: normalizedSource,
      keyPrefix,
      revoked: await store.revokeByPrefix(keyPrefix),
      requiresRestart: false,
    };
  } finally {
    await connection.end();
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }

  try {
    loadEnvFile(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const command = ["create", "revoke"].includes(process.argv[2]) ? process.argv[2] : "create";
  if (command === "revoke") {
    const result = await revokeApiKey({
      keyPrefix: readArgument("prefix"),
      source: readArgument("source"),
    });

    if (result.source === "memory") {
      console.log(`memory 모드에서는 CLI가 실행 중인 서버 환경을 바꿀 수 없습니다.`);
      console.log(`${result.keyPrefix}에 해당하는 값을 UCAR_API_KEY/UCAR_API_KEYS에서 제거한 뒤 서버를 재시작하세요.`);
      return;
    }
    if (!result.revoked) {
      throw new Error(`API key prefix ${result.keyPrefix} was not found or was already revoked.`);
    }
    console.log(`API 키 폐기 완료: ${result.keyPrefix}`);
    return;
  }

  const result = await createApiKey({
    name: readArgument("name") ?? process.env.API_KEY_NAME,
    source: readArgument("source"),
  });

  console.log(`API 키 발급 완료 (${result.source})`);
  if (result.id !== null && result.id !== undefined) console.log(`ID: ${result.id}`);
  console.log(`이름: ${result.name}`);
  console.log(`식별 prefix: ${result.keyPrefix}`);
  console.log("원문 키 (지금 한 번만 표시):");
  console.log(result.rawKey);
  if (result.source === "memory") {
    console.log("서버 시작 전에 위 값을 UCAR_API_KEY 환경 변수에 설정하세요.");
  } else {
    console.log("DB에는 원문이 아니라 SHA-256 해시와 식별 prefix만 저장되었습니다.");
  }
}

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
