import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generateDataBatch,
  resetGeneratedMongoData,
  safeErrorMessage,
  toPublicListingDocument,
} from "../server/data-generator.mjs";
import {
  createCarSeedContext,
  createFallbackBusinessAreas,
  createFallbackEmployees,
  createSampleCar,
} from "../server/sample-data.mjs";
import { runGenerationWithRetry, utcSlotRunKey } from "../scripts/run-generator.mjs";

test("generator public documents omit internal employee identifiers", () => {
  const employees = createFallbackEmployees(20);
  const businessAreas = createFallbackBusinessAreas(100, employees);
  const context = createCarSeedContext({ employees, businessAreas });
  const car = createSampleCar(50_000, context);
  const employeeByNo = new Map(employees.map((employee) => [employee.employeeNo, employee]));
  const document = toPublicListingDocument(
    car,
    employeeByNo,
    "test-only-dealer-public-id-secret-0000000000000000",
  );

  assert.equal(document.id, 50_001);
  assert.equal(document.listingNumber, "UC-00050001");
  assert.match(document.dealer.code, /^DLR-[a-f0-9]{10}$/);
  assert.doesNotMatch(JSON.stringify(document), /employeeNo|EMP\d{4,}|전화|"vin"/i);
});

test("generator errors redact credentials and connection strings", () => {
  const secret = "super-secret-password";
  const message = safeErrorMessage(
    new Error(`cannot connect to mongodb://crawler:${secret}@db.local:27017/crawl_lab?token=abc123`),
    { MONGO_PASSWORD: secret },
  );
  assert.doesNotMatch(message, new RegExp(secret));
  assert.doesNotMatch(message, /crawler:/);
  assert.doesNotMatch(message, /token=abc123/);
  assert.doesNotMatch(message, /db\.local/);
  assert.match(message, /REDACTED/);
});

test("invalid run keys fail before opening database connections", async () => {
  await assert.rejects(
    generateDataBatch({ count: 1, runKey: "unsafe key with spaces" }),
    /runKey.*ASCII/i,
  );
});

test("MongoDB reset requires an explicit UUID dataset epoch before connecting", async () => {
  await assert.rejects(
    resetGeneratedMongoData({ datasetEpoch: "not-an-epoch" }),
    /datasetEpoch UUID/i,
  );
});

test("scheduled generation retries the same logical run with a bounded attempt count", async () => {
  const calls = [];
  const waits = [];
  const result = await runGenerationWithRetry({
    count: 25,
    runKey: "scheduled:test-slot",
    now: new Date("2026-08-10T00:00:00.000Z"),
    maxAttempts: 3,
    retryDelayMs: 10,
    logger: { warn() {} },
    generateBatch: async (options) => {
      calls.push({ count: options.count, runKey: options.runKey });
      if (calls.length < 3) throw new Error("temporary database outage");
      return { runKey: options.runKey, mysqlCount: options.count, mongoCount: options.count };
    },
    wait: async (delayMs) => { waits.push(delayMs); },
  });

  assert.equal(result.runKey, "scheduled:test-slot");
  assert.deepEqual(calls, [
    { count: 25, runKey: "scheduled:test-slot" },
    { count: 25, runKey: "scheduled:test-slot" },
    { count: 25, runKey: "scheduled:test-slot" },
  ]);
  assert.deepEqual(waits, [10, 10]);
});

test("hourly scheduler keys are deterministic UTC slots", () => {
  assert.equal(
    utcSlotRunKey(new Date("2026-08-11T09:59:59.999Z"), 3_600_000),
    "scheduled:3600000:2026-08-11T09:00:00.000Z",
  );
});
