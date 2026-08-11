import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GENERATION_COUNT,
  MAX_GENERATION_COUNT,
  generateDataBatch,
  safeErrorMessage,
} from "../server/data-generator.mjs";

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

function printHelp(logger) {
  logger.log("사용법: node scripts/generate-data.mjs [--count 1000] [--run-key manual:2026-08-10T12:00:00.000Z]");
  logger.log("같은 run-key를 다시 사용하면 미완료 실행은 멱등 재시도되고 SUCCESS 실행은 건너뜁니다.");
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  now = new Date(),
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
  const runKey = readArgument(argv, "run-key")
    ?? env.GENERATOR_RUN_KEY
    ?? `manual:${now.toISOString()}`;

  logger.log(`생성 실행을 시작합니다: run=${runKey}, 요청=${count.toLocaleString("ko-KR")}건`);
  const result = await generateDataBatch({ env, count, runKey, now, logger });
  if (result.skipped) {
    logger.log(`이미 완료된 실행을 건너뛰었습니다: run=${result.runKey}, MySQL=${result.mysqlCount}, MongoDB=${result.mongoCount}`);
  } else {
    logger.log(`생성 완료: run=${result.runKey}, MySQL=${result.mysqlCount}, MongoDB=${result.mongoCount}`);
  }
  return result;
}

async function runCli() {
  try {
    loadEnvFile(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return main();
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
  runCli().catch((error) => {
    console.error(`생성 실패: ${safeErrorMessage(error, process.env)}`);
    process.exitCode = 1;
  });
}
