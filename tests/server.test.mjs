import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createApp, createFixedWindowRateLimiter } from "../server/app.mjs";
import { createApiKeyService, createDailyApiKeyProvider, createMemoryApiKeyStore, generateApiKey } from "../server/api-keys.mjs";
import { createMemoryRepository } from "../server/repository.mjs";
import { expectedDailyGeneration } from "../server/periodic-memory-generator.mjs";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const generatedKey = generateApiKey({
  name: "test key",
  randomBytesFn(size) { return Buffer.alloc(size, 7); },
});

let repository;
let server;
let baseUrl;
const dailyNow = new Date("2026-08-11T13:30:00.000Z"); // 2026-08-11 22:30 KST
const dailyApiKeyProvider = createDailyApiKeyProvider({
  secret: "server-test-daily-api-key-secret-0001",
  now: () => dailyNow,
});

before(async () => {
  repository = createMemoryRepository({ count: 240 });
  const keyStore = createMemoryApiKeyStore({ rawKeys: [generatedKey.rawKey] });
  const apiKeyService = createApiKeyService({ store: keyStore, dailyApiKeyProvider });
  server = createServer(createApp({ repository, apiKeyService, dailyApiKeyProvider, logger: silentLogger }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  await repository?.close?.();
});

function request(path, init = {}) {
  return fetch(new URL(path, baseUrl), init);
}

function apiRequest(path, init = {}) {
  return request(path, {
    ...init,
    headers: { "X-API-Key": generatedKey.rawKey, ...(init.headers ?? {}) },
  });
}

async function readJson(response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  return response.json();
}

async function readHtml(response) {
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("home and learning pages clearly use the used-car domain", async () => {
  const homeResponse = await request("/");
  assert.equal(homeResponse.status, 200);
  const home = await readHtml(homeResponse);
  assert.match(home, /<title>중고차 수집 실습 홈 · AutoData Lab<\/title>/);
  assert.match(home, /href="\/cars"/);
  assert.match(home, /직원·업무영역 CSV/);

  const guideResponse = await request("/learning-guide");
  assert.equal(guideResponse.status, 200);
  const guide = await readHtml(guideResponse);
  assert.match(guide, /AREA.*업무\/조직 영역/s);
  assert.match(guide, /BeautifulSoup/);
});

test("HTML car list exposes stable crawling selectors and pagination", async () => {
  const response = await request("/cars?page=2&page_size=5");
  assert.equal(response.status, 200);
  const html = await readHtml(response);
  assert.match(html, /data-car-list/);
  const cards = html.match(/<article\b[^>]*\bdata-car-id="[^"]+"[^>]*>/gi) ?? [];
  assert.equal(cards.length, 5);
  assert.ok(cards.every((card) => /\bcar-card\b/i.test(card)));
  assert.match(html, /data-field="title"/);
  assert.match(html, /data-field="price"/);
  assert.match(html, /data-field="mileage"/);
  assert.match(html, /rel="next"/);
});

test("HTML car board defaults to 20 rows and publishes a crawl start URL", async () => {
  const response = await request("/cars");
  assert.equal(response.status, 200);
  const html = await readHtml(response);
  assert.match(html, /class="board-list"/);
  assert.match(html, /data-public-result-limit="10000"/);
  assert.match(html, /토큰 없이 공개된 최대 10,000건/);
  assert.match(html, /HTML CRAWL START URL/);
  assert.match(html, /\/cars\?page=1&amp;page_size=20/);
  const rows = html.match(/<article\b[^>]*\bboard-list__row\b[^>]*\bdata-car-id="[^"]+"[^>]*>/gi) ?? [];
  assert.equal(rows.length, 20);
  assert.match(html, /<strong>1<\/strong> \/ 12 페이지/);
  assert.match(html, /rel="next"[^>]+page=2[^>]+page_size=20/);
});

test("public HTML repository scope is fixed to the first 10,000 cars while keyed API scope stays complete", async () => {
  const largeRepository = createMemoryRepository({ count: 10_025 });
  try {
    const publicLastPage = await largeRepository.listCars({
      page: 100,
      pageSize: 100,
      sort: "newest",
      datasetLimit: 10_000,
    });
    assert.equal(publicLastPage.total, 10_000);
    assert.equal(publicLastPage.items.length, 100);
    assert.ok(publicLastPage.items.every((car) => car.id <= 10_000));

    const publicOverflow = await largeRepository.listCars({
      page: 101,
      pageSize: 100,
      datasetLimit: 10_000,
    });
    assert.equal(publicOverflow.total, 10_000);
    assert.equal(publicOverflow.items.length, 0);
    assert.equal(await largeRepository.getCar(10_001, { datasetLimit: 10_000 }), null);

    const authenticatedScope = await largeRepository.listCars({ page: 1, pageSize: 100 });
    assert.equal(authenticatedScope.total, 10_025);
    assert.ok(await largeRepository.getCar(10_001));

    const before = await largeRepository.getStats();
    const generated = await largeRepository.appendSyntheticCars({
      count: 28,
      runKey: "test:scheduled:2026-08-11T14:00:00.000Z",
      now: new Date("2026-08-11T14:00:00.000Z"),
    });
    assert.equal(generated.insertedCount, 28);
    const afterGeneration = await largeRepository.getStats();
    assert.equal(afterGeneration.carCount, before.carCount + 28);
    assert.equal(afterGeneration.changeCount, before.changeCount + 28);
    assert.equal(afterGeneration.generationRunCount, before.generationRunCount + 1);
    assert.equal(afterGeneration.generationRunEventCount, before.generationRunEventCount + 2);
    assert.equal(expectedDailyGeneration(), 10_080);

    const repeated = await largeRepository.appendSyntheticCars({
      count: 28,
      runKey: "test:scheduled:2026-08-11T14:00:00.000Z",
      now: new Date("2026-08-11T14:00:00.000Z"),
    });
    assert.equal(repeated.skipped, true);
    assert.equal((await largeRepository.getStats()).carCount, afterGeneration.carCount);

    const stillPubliclyLimited = await largeRepository.listCars({ page: 1, pageSize: 100, datasetLimit: 10_000 });
    assert.equal(stillPubliclyLimited.total, 10_000);
    assert.equal(await largeRepository.getCar(10_026, { datasetLimit: 10_000 }), null);
  } finally {
    await largeRepository.close();
  }
});

test("API documentation exposes a keyed multi-page crawler", async () => {
  const response = await request("/docs#api-explorer");
  assert.equal(response.status, 200);
  const html = await readHtml(response);
  assert.match(html, /data-api-key/);
  assert.match(html, /data-toggle-secret/);
  assert.match(html, /data-api-crawl/);
  assert.match(html, /data-api-stop/);
  assert.match(html, /data-api-max-pages/);
  assert.match(html, /data-api-download/);
  assert.match(html, /name="page_size" type="number" value="20"/);
  assert.match(html, /links\.next/);
  assert.match(html, /오늘의 공개 API 키/);
  assert.match(html, new RegExp(dailyApiKeyProvider.keyForDate("2026-08-11").rawKey));
});

test("public daily key endpoint requires no key and authenticates only the current KST date", async () => {
  const keyResponse = await request("/api/v1/public-key");
  assert.equal(keyResponse.status, 200);
  const schedule = (await readJson(keyResponse)).data;
  assert.equal(schedule.timezone, "Asia/Seoul");
  assert.equal(schedule.current.date, "2026-08-11");
  assert.equal(schedule.next, null);

  const response = await request("/api/v1/cars?page_size=3", {
    headers: { "X-API-Key": schedule.current.api_key },
  });
  assert.equal(response.status, 200);
  assert.equal((await readJson(response)).data.length, 3);
});

test("crawl policy and robots define the classroom-only collection boundary", async () => {
  const [policyResponse, robotsResponse] = await Promise.all([request("/crawl-policy"), request("/robots.txt")]);
  assert.equal(policyResponse.status, 200);
  const policy = await readHtml(policyResponse);
  assert.match(policy, /제3자 사이트/);
  assert.match(policy, /robots 허용만으로 충분하지 않습니다/);
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /Allow: \/changes/);
  assert.match(robots, /Allow: \/api\/v1\/public-key/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Crawl-delay: 1/);
});

test("HTML change log exposes stable selectors and a frozen high-water mark", async () => {
  const response = await request("/changes?after_seq=0&limit=5");
  assert.equal(response.status, 200);
  const html = await readHtml(response);
  assert.match(html, /data-change-list/);
  assert.match(html, /data-snapshot-until="240"/);
  assert.match(html, /data-dataset-epoch="memory-v1"/);
  const cards = html.match(/<article\b[^>]*\bdata-change-event\b[^>]*>/gi) ?? [];
  assert.equal(cards.length, 5);
  assert.match(html, /data-field="listing-number"/);
  assert.match(html, /rel="next"[^>]+until_seq=240/);
});

test("formal API requires a key and rejects an invalid key", async () => {
  const missingResponse = await request("/api/v1/cars");
  assert.equal(missingResponse.status, 401);
  assert.equal((await readJson(missingResponse)).error.code, "API_KEY_REQUIRED");
  assert.match(missingResponse.headers.get("www-authenticate") ?? "", /Bearer/);

  const invalidResponse = await request("/api/v1/cars", { headers: { "X-API-Key": "not-a-key" } });
  assert.equal(invalidResponse.status, 403);
  assert.equal((await readJson(invalidResponse)).error.code, "API_KEY_INVALID");
});

test("Bearer authentication is supported without exposing the raw key", async () => {
  const response = await request("/api/v1/stats", {
    headers: { Authorization: `Bearer ${generatedKey.rawKey}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-api-key-prefix"), generatedKey.keyPrefix);
  assert.doesNotMatch(JSON.stringify(await readJson(response)), new RegExp(generatedKey.rawKey));
});

test("car list API returns a paginated envelope", async () => {
  const response = await apiRequest("/api/v1/cars?page=2&page_size=5");
  assert.equal(response.status, 200);
  const payload = await readJson(response);
  assert.equal(payload.data.length, 5);
  assert.deepEqual(
    { page: payload.meta.page, page_size: payload.meta.page_size, returned: payload.meta.returned },
    { page: 2, page_size: 5, returned: 5 },
  );
  assert.equal(payload.meta.total, 240);
  assert.equal(payload.meta.total_pages, 48);
  assert.equal(payload.meta.sort, "newest");
  assert.equal(typeof payload.links.next, "string");
  assert.equal(typeof payload.links.previous, "string");
});

test("cursor API walks cars by primary key without OFFSET", async () => {
  const firstResponse = await apiRequest("/api/v1/cars/cursor?after_id=0&limit=7");
  assert.equal(firstResponse.status, 200);
  const first = await readJson(firstResponse);
  assert.deepEqual(first.data.map((car) => car.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(first.meta, { dataset_epoch: "memory-v1", after_id: 0, until_id: 240, limit: 7, returned: 7, has_more: true });
  assert.equal(first.links.next, "/api/v1/cars/cursor?after_id=7&until_id=240&limit=7&dataset_epoch=memory-v1");

  const final = await readJson(await apiRequest("/api/v1/cars/cursor?after_id=238&until_id=9999&limit=5"));
  assert.deepEqual(final.data.map((car) => car.id), [239, 240]);
  assert.equal(final.meta.until_id, 240);
  assert.equal(final.meta.has_more, false);
  assert.equal(final.links.next, null);
});

test("change API freezes a snapshot and advances an append-only sequence cursor", async () => {
  const first = await readJson(await apiRequest("/api/v1/changes?after_seq=0&limit=7"));
  assert.deepEqual(first.data.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(first.meta.until_seq, 240);
  assert.equal(first.meta.has_more, true);
  assert.equal(first.meta.dataset_epoch, "memory-v1");
  assert.equal(first.links.next, "/api/v1/changes?after_seq=7&until_seq=240&limit=7&dataset_epoch=memory-v1");
  assert.ok(first.data.every((event) => event.operation === "UPSERT" && event.sourceChecksum.length === 64));

  const final = await readJson(await apiRequest("/api/v1/changes?after_seq=238&until_seq=240&limit=7"));
  assert.deepEqual(final.data.map((event) => event.seq), [239, 240]);
  assert.equal(final.meta.has_more, false);
  assert.equal(final.links.next, null);

  const clamped = await readJson(await apiRequest("/api/v1/changes?after_seq=238&until_seq=999999&limit=7"));
  assert.equal(clamped.meta.until_seq, 240);
  assert.deepEqual(clamped.data.map((event) => event.seq), [239, 240]);

  const staleEpoch = await apiRequest("/api/v1/changes?after_seq=0&dataset_epoch=old-dataset");
  assert.equal(staleEpoch.status, 409);
  assert.equal((await readJson(staleEpoch)).error.code, "DATASET_EPOCH_CHANGED");
});

test("generation run status transitions are crawlable as an append-only event feed", async () => {
  const [htmlResponse, apiResponse] = await Promise.all([
    request("/generation-runs"),
    apiRequest("/api/v1/generation-runs?after_id=0"),
  ]);
  assert.equal(htmlResponse.status, 200);
  const html = await readHtml(htmlResponse);
  assert.match(html, /data-generation-run-list/);
  assert.match(html, /data-run-id="1"/);
  assert.match(html, /data-event-id="1"/);
  assert.match(html, /data-event-id="2"/);
  const payload = await readJson(apiResponse);
  assert.deepEqual(payload.data.map((event) => event.id), [1, 2]);
  assert.deepEqual(payload.data.map((event) => event.eventId), [1, 2]);
  assert.deepEqual(payload.data.map((event) => event.runId), [1, 1]);
  assert.deepEqual(payload.data.map((event) => event.status), ["RUNNING", "SUCCESS"]);
  assert.ok(payload.data.every((event) => event.runKey === "memory-bootstrap"));
  assert.equal(payload.meta.until_id, 2);
  assert.equal(payload.meta.dataset_epoch, "memory-v1");

  const terminal = await readJson(await apiRequest("/api/v1/generation-runs?after_id=1&until_id=2&limit=1"));
  assert.deepEqual(terminal.data.map((event) => event.status), ["SUCCESS"]);
  assert.equal(terminal.data[0].id, 2);
  assert.equal(terminal.links.next, null);

  const clamped = await readJson(await apiRequest("/api/v1/generation-runs?after_id=1&until_id=999999&limit=10"));
  assert.equal(clamped.meta.until_id, 2);
  assert.deepEqual(clamped.data.map((event) => event.id), [2]);
});

test("fixed-window limiter returns a bounded 429 retry contract", () => {
  let current = 1_000;
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1_000, now: () => current });
  assert.deepEqual(limiter.consume("class-a"), { allowed: true, limit: 2, remaining: 1, resetSeconds: 1 });
  assert.deepEqual(limiter.consume("class-a"), { allowed: true, limit: 2, remaining: 0, resetSeconds: 1 });
  assert.deepEqual(limiter.consume("class-a"), { allowed: false, limit: 2, remaining: 0, resetSeconds: 1 });
  current = 2_000;
  assert.equal(limiter.consume("class-a").allowed, true);

  let cappedNow = 5_000;
  const capped = createFixedWindowRateLimiter({
    limit: 2,
    windowMs: 1_000,
    maxBuckets: 2,
    now: () => cappedNow,
  });
  capped.consume("attacker-prefix-a");
  capped.consume("attacker-prefix-b");
  capped.consume("attacker-prefix-c");
  assert.equal(capped.size, 2);
  cappedNow = 7_000;
  capped.consume("new-window-prefix");
  assert.equal(capped.size, 1);
});

test("API returns 429 and Retry-After after the configured key limit", async () => {
  const limitedRepository = createMemoryRepository({ count: 5 });
  const limitedStore = createMemoryApiKeyStore({ rawKeys: [generatedKey.rawKey] });
  const limitedServer = createServer(createApp({
    repository: limitedRepository,
    apiKeyService: createApiKeyService({ store: limitedStore }),
    logger: silentLogger,
    apiRateLimit: { limit: 1, windowMs: 60_000 },
  }));
  try {
    await new Promise((resolve, reject) => {
      limitedServer.once("error", reject);
      limitedServer.listen(0, "127.0.0.1", resolve);
    });
    const address = limitedServer.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/v1/stats`;
    const init = { headers: { "X-API-Key": generatedKey.rawKey } };
    assert.equal((await fetch(url, init)).status, 200);
    const limited = await fetch(url, init);
    assert.equal(limited.status, 429);
    assert.equal((await readJson(limited)).error.code, "RATE_LIMITED");
    assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
    assert.equal(limited.headers.get("ratelimit-remaining"), "0");
  } finally {
    if (limitedServer.listening) {
      await new Promise((resolve, reject) => limitedServer.close((error) => (error ? reject(error) : resolve())));
    }
    await limitedRepository.close();
    await limitedStore.close();
  }
});

test("invalid credentials are bounded before repeated authentication work", async () => {
  const limitedRepository = createMemoryRepository({ count: 5 });
  const limitedStore = createMemoryApiKeyStore({ rawKeys: [generatedKey.rawKey] });
  const limitedServer = createServer(createApp({
    repository: limitedRepository,
    apiKeyService: createApiKeyService({ store: limitedStore }),
    logger: silentLogger,
    apiPreAuthRateLimit: { limit: 1, windowMs: 60_000 },
  }));
  try {
    await new Promise((resolve, reject) => {
      limitedServer.once("error", reject);
      limitedServer.listen(0, "127.0.0.1", resolve);
    });
    const address = limitedServer.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/v1/stats`;
    const init = { headers: { "X-API-Key": "not-a-key" } };
    assert.equal((await fetch(url, init)).status, 403);
    const limited = await fetch(url, init);
    assert.equal(limited.status, 429);
    assert.equal((await readJson(limited)).error.code, "RATE_LIMITED");
    assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
  } finally {
    if (limitedServer.listening) {
      await new Promise((resolve, reject) => limitedServer.close((error) => (error ? reject(error) : resolve())));
    }
    await limitedRepository.close();
    await limitedStore.close();
  }
});

test("car filters and sorting operate on domain fields", async () => {
  const baseline = await readJson(await apiRequest("/api/v1/cars?brand=hyundai&status=AVAILABLE&page_size=100"));
  assert.ok(baseline.data.length > 2);
  const minPrice = Math.min(...baseline.data.map((car) => car.price));
  const maxPrice = Math.max(...baseline.data.map((car) => car.price));
  const params = new URLSearchParams({
    brand: "hyundai",
    status: "AVAILABLE",
    min_price: String(minPrice),
    max_price: String(maxPrice),
    max_mileage: "330000",
    sort: "price_asc",
    page_size: "100",
  });
  const payload = await readJson(await apiRequest(`/api/v1/cars?${params}`));
  assert.ok(payload.data.length > 0);
  assert.ok(payload.data.every((car) => car.brand.slug === "hyundai" && car.status === "AVAILABLE"));
  const prices = payload.data.map((car) => car.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(payload.meta.filters.brand, "hyundai");
});

test("detail API omits private employee identifiers", async () => {
  const response = await apiRequest("/api/v1/cars/1");
  assert.equal(response.status, 200);
  const payload = await readJson(response);
  assert.equal(payload.data.id, 1);
  assert.equal(typeof payload.data.listingNumber, "string");
  assert.equal(typeof payload.data.dealer.code, "string");
  assert.equal(typeof payload.data.businessArea.id, "string");
  assert.doesNotMatch(JSON.stringify(payload), /employeeNo|EMP\d{4,}/i);
});

test("brand, location, business-area and stats resources match the domain", async () => {
  const [brands, locations, areas, stats] = await Promise.all([
    apiRequest("/api/v1/brands").then(readJson),
    apiRequest("/api/v1/locations").then(readJson),
    apiRequest("/api/v1/business-areas?page_size=3").then(readJson),
    apiRequest("/api/v1/stats").then(readJson),
  ]);
  assert.ok(brands.data.some((brand) => brand.slug === "hyundai"));
  assert.ok(locations.data.some((location) => location.province === "서울특별시"));
  assert.equal(areas.data.length, 3);
  assert.deepEqual(Object.keys(areas.data[0].manager).sort(), ["code", "displayName"]);
  assert.equal(stats.data.source, "memory");
  assert.equal(stats.data.carCount, 240);
  assert.equal(stats.data.employeeCount, 3000);
  assert.ok(stats.data.businessAreaCount > 0);
});

test("health and OPTIONS stay public", async () => {
  const health = await request("/healthz");
  assert.equal(health.status, 200);
  assert.equal((await readJson(health)).ok, true);

  const options = await request("/api/v1/cars", {
    method: "OPTIONS",
    headers: { Origin: "http://127.0.0.1:8888", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  assert.match(options.headers.get("access-control-allow-headers") ?? "", /X-API-Key/i);
  assert.match(options.headers.get("access-control-allow-headers") ?? "", /Authorization/i);
});

test("failed public health checks do not expose raw database errors", async () => {
  const sensitiveError = "SELECT dataset_state failed for crawl_lab at db.internal";
  const logged = [];
  const failedServer = createServer(createApp({
    repository: {
      async health() { return { ok: false, source: "mysql", error: sensitiveError }; },
    },
    logger: { ...silentLogger, error(...args) { logged.push(args.join(" ")); } },
  }));
  try {
    await new Promise((resolve, reject) => {
      failedServer.once("error", reject);
      failedServer.listen(0, "127.0.0.1", resolve);
    });
    const address = failedServer.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    const body = await readJson(response);
    assert.equal(response.status, 503);
    assert.deepEqual(body, { ok: false, source: "mysql", error: "DATASTORE_UNAVAILABLE" });
    assert.doesNotMatch(JSON.stringify(body), /dataset_state|crawl_lab|db\.internal/);
    assert.match(logged.join("\n"), /dataset_state/);
  } finally {
    if (failedServer.listening) {
      await new Promise((resolve, reject) => failedServer.close((error) => (error ? reject(error) : resolve())));
    }
  }
});

test("all dataset API and HTML routes fail closed while a seed is incomplete", async () => {
  const resettingRepository = createMemoryRepository({ count: 5 });
  resettingRepository.getDatasetEpoch = async () => {
    throw new Error("dataset_state status RESETTING in crawl_lab");
  };
  const keyStore = createMemoryApiKeyStore({ rawKeys: [generatedKey.rawKey] });
  const resettingServer = createServer(createApp({
    repository: resettingRepository,
    apiKeyService: createApiKeyService({ store: keyStore }),
    logger: silentLogger,
  }));
  try {
    await new Promise((resolve, reject) => {
      resettingServer.once("error", reject);
      resettingServer.listen(0, "127.0.0.1", resolve);
    });
    const address = resettingServer.address();
    assert.ok(address && typeof address === "object");
    const resetBaseUrl = `http://127.0.0.1:${address.port}`;
    const apiResponse = await fetch(`${resetBaseUrl}/api/v1/cars`, {
      headers: { "X-API-Key": generatedKey.rawKey },
    });
    assert.equal(apiResponse.status, 503);
    assert.equal((await readJson(apiResponse)).error.code, "DATASET_NOT_READY");

    const htmlResponse = await fetch(`${resetBaseUrl}/cars`);
    assert.equal(htmlResponse.status, 503);
    assert.doesNotMatch(await readHtml(htmlResponse), /crawl_lab|RESETTING/);
    assert.equal((await fetch(`${resetBaseUrl}/docs`)).status, 200);
  } finally {
    if (resettingServer.listening) {
      await new Promise((resolve, reject) => resettingServer.close((error) => (error ? reject(error) : resolve())));
    }
    await Promise.allSettled([resettingRepository.close(), keyStore.close()]);
  }
});

test("authenticated invalid and unknown requests use JSON errors", async () => {
  const invalid = await apiRequest("/api/v1/cars?page=0&max_mileage=nope");
  assert.equal(invalid.status, 400);
  assert.equal((await readJson(invalid)).error.code, "INVALID_QUERY");

  const unknown = await apiRequest("/api/v1/not-a-route");
  assert.equal(unknown.status, 404);
  assert.equal((await readJson(unknown)).error.code, "ENDPOINT_NOT_FOUND");
});

test("unsupported methods and legacy product links are handled explicitly", async () => {
  const method = await request("/api/v1/cars", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD, OPTIONS");

  const legacy = await request("/products?page=2", { redirect: "manual" });
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get("location"), "/cars?page=2");
});
