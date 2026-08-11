import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryRepository, createRepositoryFromEnv } from "../server/repository.mjs";

test("environment-backed repositories fail closed without a dealer HMAC secret", async () => {
  await assert.rejects(
    createRepositoryFromEnv({ DATA_SOURCE: "memory", MEMORY_CAR_COUNT: "1" }),
    /DEALER_PUBLIC_ID_SECRET.*32/,
  );
});

test("dealer aliases are stable per secret and unlinkable across secrets", async () => {
  const first = createMemoryRepository({
    count: 1,
    dealerPublicIdSecret: "a".repeat(32),
  });
  const sameSecret = createMemoryRepository({
    count: 1,
    dealerPublicIdSecret: "a".repeat(32),
  });
  const otherSecret = createMemoryRepository({
    count: 1,
    dealerPublicIdSecret: "b".repeat(32),
  });

  try {
    const [firstCar, sameCar, otherCar] = await Promise.all([
      first.getCar(1),
      sameSecret.getCar(1),
      otherSecret.getCar(1),
    ]);
    assert.match(firstCar.dealer.code, /^DLR-[a-f0-9]{10}$/);
    assert.equal(firstCar.dealer.code, sameCar.dealer.code);
    assert.notEqual(firstCar.dealer.code, otherCar.dealer.code);
    assert.doesNotMatch(JSON.stringify(firstCar), /employeeNo|EMP\d{4,}/i);
  } finally {
    await Promise.all([first.close(), sameSecret.close(), otherSecret.close()]);
  }
});

test("generation run feed advances by append-only status event IDs", async () => {
  const repository = createMemoryRepository({
    count: 3,
    dealerPublicIdSecret: "event-feed-test-secret-value-0001",
  });
  try {
    assert.equal(await repository.getGenerationRunWatermark(), 2);
    const firstSnapshot = await repository.listGenerationRunsAfterId({
      afterId: 0,
      untilId: 999_999,
      limit: 10,
    });
    assert.deepEqual(firstSnapshot.items.map((event) => event.id), [1, 2]);
    assert.deepEqual(firstSnapshot.items.map((event) => event.runId), [1, 1]);
    assert.deepEqual(firstSnapshot.items.map((event) => event.status), ["RUNNING", "SUCCESS"]);

    const resumed = await repository.listGenerationRunsAfterId({ afterId: 1, untilId: 2, limit: 10 });
    assert.deepEqual(resumed.items.map((event) => event.status), ["SUCCESS"]);
    assert.equal(resumed.hasMore, false);
  } finally {
    await repository.close();
  }
});
