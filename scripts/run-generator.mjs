import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GENERATION_COUNT,
  MAX_GENERATION_COUNT,
  generateDataBatch,
  listRecoverableGenerationRuns,
  safeErrorMessage,
} from "../server/data-generator.mjs";

export const DEFAULT_GENERATION_INTERVAL_MS = 3_600_000;

function readArgument(argv, name) {
  const inlinePrefix = `--${name}=`;
  const inline = argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveInteger(value, fallback, name, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new TypeError(`${name} 값은 1 이상 ${maximum} 이하의 정수여야 합니다.`);
  }
  return number;
}

function nonNegativeInteger(value, fallback, name, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new TypeError(`${name} 값은 0 이상 ${maximum} 이하의 정수여야 합니다.`);
  }
  return number;
}

export function utcSlotRunKey(now, intervalMs) {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError("UTC slot을 만들 날짜가 올바르지 않습니다.");
  const slotStart = Math.floor(timestamp / intervalMs) * intervalMs;
  return `scheduled:${intervalMs}:${new Date(slotStart).toISOString()}`;
}

function nextSlotDelay(nowMs, intervalMs) {
  const nextSlot = (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
  return Math.max(1, nextSlot - nowMs);
}

function printHelp(logger) {
  logger.log("사용법: node scripts/run-generator.mjs [--count 1000] [--interval-ms 3600000]");
  logger.log("시작 즉시 미완료 run을 재조정한 뒤 현재 UTC slot을 실행하고, 이후 UTC 경계마다 반복합니다.");
}

export async function runGenerationWithRetry({
  env = process.env,
  count,
  runKey,
  requireExistingRun = false,
  now,
  logger = console,
  maxAttempts = 3,
  retryDelayMs = 5_000,
  generateBatch = generateDataBatch,
  wait = (delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
  shouldStop = () => false,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await generateBatch({ env, count, runKey, now, logger, requireExistingRun });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || shouldStop()) throw error;
      logger.warn?.(
        `생성 재시도 대기: run=${runKey}, attempt=${attempt}/${maxAttempts}, ${safeErrorMessage(error, env)}`,
      );
      await wait(retryDelayMs);
      if (shouldStop()) throw error;
    }
  }
  throw lastError;
}

export async function runScheduler({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  clock = () => new Date(),
  signals = process,
  generateBatch = generateDataBatch,
  listRecoverableRuns = listRecoverableGenerationRuns,
  wait,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp(logger);
    return { help: true };
  }

  const count = positiveInteger(
    readArgument(argv, "count") ?? env.GENERATOR_COUNT ?? env.GENERATOR_BATCH_SIZE,
    DEFAULT_GENERATION_COUNT,
    "count",
    MAX_GENERATION_COUNT,
  );
  const intervalMs = positiveInteger(
    readArgument(argv, "interval-ms") ?? env.GENERATOR_INTERVAL_MS,
    DEFAULT_GENERATION_INTERVAL_MS,
    "interval-ms",
    7 * 24 * 60 * 60 * 1_000,
  );
  const maxAttempts = positiveInteger(
    readArgument(argv, "max-attempts") ?? env.GENERATOR_MAX_ATTEMPTS,
    3,
    "max-attempts",
    10,
  );
  const retryDelayMs = nonNegativeInteger(
    readArgument(argv, "retry-delay-ms") ?? env.GENERATOR_RETRY_DELAY_MS,
    5_000,
    "retry-delay-ms",
    5 * 60 * 1_000,
  );
  const reconcileLimit = positiveInteger(
    env.GENERATOR_RECONCILE_LIMIT,
    10,
    "GENERATOR_RECONCILE_LIMIT",
    100,
  );
  const shutdownTimeoutMs = positiveInteger(
    env.GENERATOR_SHUTDOWN_TIMEOUT_MS,
    60_000,
    "GENERATOR_SHUTDOWN_TIMEOUT_MS",
    10 * 60_000,
  );

  let stopping = false;
  let timer = null;
  let forceShutdownTimer = null;
  let activeRun = null;
  let stopResolved = false;
  let resolveStopped;
  const stopped = new Promise((resolveStoppedPromise) => {
    resolveStopped = resolveStoppedPromise;
  });

  function finishStopping() {
    if (!stopResolved) {
      stopResolved = true;
      resolveStopped();
    }
  }

  async function executeCurrentSlot() {
    if (stopping || activeRun) return;
    const now = clock();
    const runKey = utcSlotRunKey(now, intervalMs);
    activeRun = (async () => {
      let recoverableRuns = [];
      try {
        recoverableRuns = await listRecoverableRuns({ env, limit: reconcileLimit });
      } catch (error) {
        logger.warn?.(`미완료 run 조회 실패: ${safeErrorMessage(error, env)}`);
      }

      for (const pendingRun of recoverableRuns) {
        if (stopping) return null;
        try {
          const recovered = await runGenerationWithRetry({
            env,
            count: pendingRun.requestedCount,
            runKey: pendingRun.runKey,
            requireExistingRun: true,
            now,
            logger,
            maxAttempts,
            retryDelayMs,
            generateBatch,
            wait,
            shouldStop: () => stopping,
          });
          logger.log(
            `미완료 run 복구 ${recovered.skipped ? "확인" : "완료"}: run=${recovered.runKey}, MySQL=${recovered.mysqlCount}, MongoDB=${recovered.mongoCount}`,
          );
        } catch (error) {
          logger.error(`미완료 run 복구 실패: run=${pendingRun.runKey}, ${safeErrorMessage(error, env)}`);
        }
      }

      if (stopping) return null;
      return runGenerationWithRetry({
        env,
        count,
        runKey,
        now,
        logger,
        maxAttempts,
        retryDelayMs,
        generateBatch,
        wait,
        shouldStop: () => stopping,
      });
    })();
    try {
      const result = await activeRun;
      if (!result) return;
      const verb = result.skipped ? "건너뜀" : "완료";
      logger.log(
        `주기 생성 ${verb}: run=${result.runKey}, MySQL=${result.mysqlCount}, MongoDB=${result.mongoCount}`,
      );
    } catch (error) {
      logger.error(`주기 생성 실패: run=${runKey}, ${safeErrorMessage(error, env)}`);
    } finally {
      activeRun = null;
      if (stopping) finishStopping();
    }
  }

  function scheduleNextSlot() {
    if (stopping) return;
    const delay = nextSlotDelay(clock().getTime(), intervalMs);
    timer = setTimeout(async () => {
      timer = null;
      await executeCurrentSlot();
      scheduleNextSlot();
    }, delay);
  }

  function requestShutdown(signal) {
    if (stopping) {
      logger.error?.(`${signal} 신호를 다시 받아 생성기를 즉시 종료합니다.`);
      if (typeof signals.exit === "function") signals.exit(1);
      else finishStopping();
      return;
    }
    stopping = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger.log(`${signal} 신호를 받아 생성기를 종료합니다${activeRun ? ". 현재 실행이 끝날 때까지 기다립니다." : "."}`);
    if (!activeRun) {
      finishStopping();
      return;
    }
    forceShutdownTimer = setTimeout(() => {
      logger.error?.(`생성기가 ${shutdownTimeoutMs}ms 안에 종료되지 않아 즉시 종료합니다. 다음 시작에서 미완료 run을 재조정합니다.`);
      if (typeof signals.exit === "function") signals.exit(1);
      else finishStopping();
    }, shutdownTimeoutMs);
    forceShutdownTimer.unref?.();
  }

  const onSigint = () => requestShutdown("SIGINT");
  const onSigterm = () => requestShutdown("SIGTERM");
  signals.on("SIGINT", onSigint);
  signals.on("SIGTERM", onSigterm);

  logger.log(
    `주기 생성기를 시작합니다: ${count.toLocaleString("ko-KR")}건 / ${intervalMs.toLocaleString("ko-KR")}ms`,
  );
  try {
    await executeCurrentSlot();
    if (!stopping) scheduleNextSlot();
    await stopped;
    return { stopped: true };
  } finally {
    if (timer) clearTimeout(timer);
    if (forceShutdownTimer) clearTimeout(forceShutdownTimer);
    signals.off("SIGINT", onSigint);
    signals.off("SIGTERM", onSigterm);
  }
}

async function runCli() {
  try {
    loadEnvFile(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return runScheduler();
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
  runCli().catch((error) => {
    console.error(`주기 생성기 종료: ${safeErrorMessage(error, process.env)}`);
    process.exitCode = 1;
  });
}
