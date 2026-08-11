import assert from "node:assert/strict";
import { test } from "node:test";

import { createDailyApiKeyProvider } from "../server/api-keys.mjs";
import { renderDocsPage } from "../server/templates.mjs";

const secret = "daily-api-key-unit-test-secret-value-0001";

test("daily API key rotates at KST midnight and publishes tomorrow at 23:00", async () => {
  let currentTime = new Date("2026-08-11T13:59:59.000Z"); // 22:59:59 KST
  const provider = createDailyApiKeyProvider({ secret, now: () => currentTime });

  const beforePublication = provider.getPublicSchedule();
  assert.equal(beforePublication.current.date, "2026-08-11");
  assert.equal(beforePublication.next, null);

  currentTime = new Date("2026-08-11T14:00:00.000Z"); // 23:00 KST
  const afterPublication = provider.getPublicSchedule();
  assert.equal(afterPublication.current.api_key, beforePublication.current.api_key);
  assert.equal(afterPublication.server_time, "2026-08-11T23:00:00.000+09:00");
  assert.equal(afterPublication.seconds_until_rotation, 3_600);
  assert.equal(afterPublication.next.date, "2026-08-12");
  assert.equal(afterPublication.next.active_from, "2026-08-12T00:00:00+09:00");
  assert.equal((await provider.authenticateRawKey(afterPublication.next.api_key)).ok, false);

  currentTime = new Date("2026-08-11T15:00:00.000Z"); // 00:00 KST next day
  const afterMidnight = provider.getPublicSchedule();
  assert.equal(afterMidnight.current.api_key, afterPublication.next.api_key);
  assert.equal((await provider.authenticateRawKey(beforePublication.current.api_key)).ok, false);
  assert.equal((await provider.authenticateRawKey(afterMidnight.current.api_key)).ok, true);
});

test("API documentation discloses tomorrow's key only when the schedule publishes it", () => {
  const provider = createDailyApiKeyProvider({ secret });
  const before = provider.getPublicSchedule(new Date("2026-08-11T13:59:59.000Z"));
  const after = provider.getPublicSchedule(new Date("2026-08-11T14:00:00.000Z"));
  const tomorrowKey = provider.keyForDate("2026-08-12").rawKey;

  assert.doesNotMatch(renderDocsPage({ dailyKeySchedule: before }), new RegExp(tomorrowKey));
  assert.match(renderDocsPage({ dailyKeySchedule: after }), new RegExp(tomorrowKey));
});

test("daily API keys are deterministic for a date but separated by secret", () => {
  const first = createDailyApiKeyProvider({ secret });
  const same = createDailyApiKeyProvider({ secret });
  const other = createDailyApiKeyProvider({ secret: "another-daily-api-key-secret-value-0002" });

  assert.equal(first.keyForDate("2026-08-11").rawKey, same.keyForDate("2026-08-11").rawKey);
  assert.notEqual(first.keyForDate("2026-08-11").rawKey, first.keyForDate("2026-08-12").rawKey);
  assert.notEqual(first.keyForDate("2026-08-11").rawKey, other.keyForDate("2026-08-11").rawKey);
  assert.match(first.keyForDate("2026-08-11").rawKey, /^ucar_v1_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
});

test("daily API key provider rejects a weak server secret", () => {
  assert.throws(() => createDailyApiKeyProvider({ secret: "too-short" }), /at least 32/);
});
