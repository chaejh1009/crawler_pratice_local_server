export const DEFAULT_AUTO_GENERATION_BATCH_SIZE = 28;
export const DEFAULT_AUTO_GENERATION_INTERVAL_MS = 4 * 60 * 1_000;

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new TypeError(`주기 생성 설정은 1 이상 ${maximum} 이하의 정수여야 합니다.`);
  }
  return number;
}

export function expectedDailyGeneration({
  batchSize = DEFAULT_AUTO_GENERATION_BATCH_SIZE,
  intervalMs = DEFAULT_AUTO_GENERATION_INTERVAL_MS,
} = {}) {
  return Math.round((24 * 60 * 60 * 1_000 / intervalMs) * batchSize);
}

export function startPeriodicMemoryGenerator({
  repository,
  batchSize = DEFAULT_AUTO_GENERATION_BATCH_SIZE,
  intervalMs = DEFAULT_AUTO_GENERATION_INTERVAL_MS,
  clock = () => new Date(),
  logger = console,
} = {}) {
  if (typeof repository?.appendSyntheticCars !== "function") {
    throw new TypeError("메모리 저장소가 주기 생성 적재를 지원하지 않습니다.");
  }
  const normalizedBatchSize = positiveInteger(batchSize, DEFAULT_AUTO_GENERATION_BATCH_SIZE, 10_000);
  const normalizedIntervalMs = positiveInteger(intervalMs, DEFAULT_AUTO_GENERATION_INTERVAL_MS, 7 * 24 * 60 * 60 * 1_000);
  let timer = null;
  let activeRun = null;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    const nowMs = clock().getTime();
    const nextSlotMs = (Math.floor(nowMs / normalizedIntervalMs) + 1) * normalizedIntervalMs;
    timer = setTimeout(async () => {
      timer = null;
      const slot = new Date(nextSlotMs);
      const runKey = `memory-scheduled:${normalizedIntervalMs}:${slot.toISOString()}`;
      activeRun = repository.appendSyntheticCars({ count: normalizedBatchSize, runKey, now: slot });
      try {
        const result = await activeRun;
        logger.log?.(`메모리 주기 생성 ${result.skipped ? "건너뜀" : "완료"}: run=${runKey}, 추가=${result.insertedCount}건, 전체=${result.carCount}건`);
      } catch (error) {
        logger.error?.(`메모리 주기 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        activeRun = null;
        schedule();
      }
    }, Math.max(1, nextSlotMs - nowMs));
  }

  schedule();
  return {
    batchSize: normalizedBatchSize,
    intervalMs: normalizedIntervalMs,
    expectedPerDay: expectedDailyGeneration({ batchSize: normalizedBatchSize, intervalMs: normalizedIntervalMs }),
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (activeRun) await activeRun.catch(() => {});
    },
  };
}
