import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { loadEnvFile } from "node:process";

import { createApp } from "./app.mjs";
import {
  createDailyApiKeyProvider,
  createApiKeyService,
  createMemoryApiKeyStoreFromEnv,
  createMysqlApiKeyStore,
  ensureApiKeysTable,
} from "./api-keys.mjs";
import { createRepositoryFromEnv, mysqlConnectionOptions } from "./repository.mjs";
import {
  DEFAULT_AUTO_GENERATION_BATCH_SIZE,
  DEFAULT_AUTO_GENERATION_INTERVAL_MS,
  startPeriodicMemoryGenerator,
} from "./periodic-memory-generator.mjs";
import { runScheduler } from "../scripts/run-generator.mjs";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT는 1~65535 사이의 정수여야 합니다.");
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function booleanSetting(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (["true", "1", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(String(value).toLowerCase())) return false;
  throw new Error("AUTO_GENERATE는 true 또는 false여야 합니다.");
}

const repository = await createRepositoryFromEnv(process.env);
const startupHealth = await repository.health();
const dailyApiKeyProvider = createDailyApiKeyProvider({
  secret: process.env.DAILY_API_KEY_SECRET || process.env.DEALER_PUBLIC_ID_SECRET,
});

async function createApiKeyRuntime() {
  if (startupHealth.source !== "mysql") {
    const store = createMemoryApiKeyStoreFromEnv(process.env);
    return { service: createApiKeyService({ store, dailyApiKeyProvider }), close: () => store.close() };
  }

  const mysql = await import("mysql2/promise");
  const createPool = mysql.createPool ?? mysql.default?.createPool;
  const pool = createPool(mysqlConnectionOptions(process.env));
  await ensureApiKeysTable(pool);
  const store = createMysqlApiKeyStore(pool);
  return { service: createApiKeyService({ store, dailyApiKeyProvider }), close: () => pool.end() };
}

const apiKeyRuntime = await createApiKeyRuntime();
const server = createServer(createApp({
  repository,
  apiKeyService: apiKeyRuntime.service,
  dailyApiKeyProvider,
  apiRateLimit: {
    limit: positiveInteger(process.env.API_RATE_LIMIT_PER_MINUTE, 60, 100_000),
    windowMs: 60_000,
  },
  apiPreAuthRateLimit: {
    limit: positiveInteger(process.env.API_PREAUTH_RATE_LIMIT_PER_MINUTE, 120, 100_000),
    windowMs: 60_000,
  },
  htmlRateLimit: {
    limit: positiveInteger(process.env.HTML_RATE_LIMIT_PER_MINUTE, 120, 100_000),
    windowMs: 60_000,
  },
}));

function startGenerationRuntime() {
  if (!booleanSetting(process.env.AUTO_GENERATE, true)) {
    console.log("  주기 데이터 생성: 비활성화 (AUTO_GENERATE=false)\n");
    return { close: async () => {} };
  }
  const batchSize = positiveInteger(process.env.GENERATOR_BATCH_SIZE, DEFAULT_AUTO_GENERATION_BATCH_SIZE, 10_000);
  const intervalMs = positiveInteger(process.env.GENERATOR_INTERVAL_MS, DEFAULT_AUTO_GENERATION_INTERVAL_MS, 7 * 24 * 60 * 60 * 1_000);

  if (startupHealth.source !== "mysql") {
    const runtime = startPeriodicMemoryGenerator({ repository, batchSize, intervalMs });
    console.log(`  주기 데이터 생성: ${runtime.batchSize}건 / ${Math.round(runtime.intervalMs / 1000)}초 (하루 약 ${runtime.expectedPerDay.toLocaleString("ko-KR")}건, 재시작 시 초기화)\n`);
    return runtime;
  }

  const signals = new EventEmitter();
  signals.exit = () => {};
  const schedulerTask = runScheduler({
    env: { ...process.env, GENERATOR_BATCH_SIZE: String(batchSize), GENERATOR_INTERVAL_MS: String(intervalMs) },
    signals,
    wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  }).catch((error) => {
    console.error(`주기 생성기 종료: ${error instanceof Error ? error.message : String(error)}`);
  });
  console.log(`  주기 데이터 생성: ${batchSize}건 / ${Math.round(intervalMs / 1000)}초 (하루 약 ${Math.round((86_400_000 / intervalMs) * batchSize).toLocaleString("ko-KR")}건, MySQL·MongoDB)\n`);
  return {
    async close() {
      signals.emit("SIGTERM");
      await schedulerTask;
    },
  };
}

let generationRuntime = { close: async () => {} };

function isPrivateIpv4(value) {
  const octets = value.split(".").map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && (octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168));
}

function lanAddresses() {
  if (!["0.0.0.0", "::"].includes(host)) {
    return ["127.0.0.1", "localhost"].includes(host) ? [] : [`http://${host}:${port}`];
  }

  const virtualInterface = /^(utun|awdl|llw|docker|br-|vbox|vmnet|tailscale)/i;
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => (
      address.family === "IPv4"
      && !address.internal
      && isPrivateIpv4(address.address)
    ));
  const physicalCandidates = candidates.filter((address) => !virtualInterface.test(address.name));

  return (physicalCandidates.length > 0 ? physicalCandidates : candidates)
    .map((address) => `http://${address.address}:${port}`);
}

server.listen(port, host, () => {
  console.log(`\n  AutoData Lab이 실행 중입니다.`);
  console.log(`  내 컴퓨터: http://localhost:${port}`);
  for (const address of lanAddresses()) console.log(`  같은 Wi-Fi 후보: ${address}`);
  console.log(`  데이터 소스: ${startupHealth.source}\n`);
  console.log("  공개 일일 API 키: /api/v1/public-key (한국시간 자정 자동 교체)\n");
  generationRuntime = startGenerationRuntime();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} 신호를 받아 서버를 종료합니다.`);
  server.close(async () => {
    await generationRuntime.close();
    await Promise.allSettled([repository.close(), apiKeyRuntime.close()]);
    process.exit(0);
  });
  const shutdownTimeoutMs = positiveInteger(process.env.GENERATOR_SHUTDOWN_TIMEOUT_MS, 60_000, 10 * 60_000) + 5_000;
  setTimeout(() => process.exit(1), shutdownTimeoutMs).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
