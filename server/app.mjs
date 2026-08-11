import { readFile } from "node:fs/promises";

import { parseApiKey, parseApiKeyCredential } from "./api-keys.mjs";

import {
  renderCarDetailPage,
  renderCarListPage,
  renderChangeLogPage,
  renderCrawlPolicyPage,
  renderDocsPage,
  renderErrorPage,
  renderGenerationRunsPage,
  renderHomePage,
  renderLearningGuidePage,
} from "./templates.mjs";

const STATIC_FILES = new Map([
  ["/styles.css", { path: new URL("../public/styles.css", import.meta.url), type: "text/css; charset=utf-8" }],
  ["/app.js", { path: new URL("../public/app.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
]);
const SORT_VALUES = new Set(["newest", "price_asc", "price_desc", "mileage_asc", "year_desc"]);
const STATUS_VALUES = new Set(["AVAILABLE", "RESERVED", "SOLD"]);
const FUEL_VALUES = new Set(["가솔린", "디젤", "하이브리드", "전기", "LPG"]);

class HttpError extends Error {
  constructor(status, code, message, details, headers = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

function parseInteger(value, fallback, { name, min, max }) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new HttpError(400, "INVALID_QUERY", `${name} 값은 정수여야 합니다.`, { field: name });
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, "INVALID_QUERY", `${name} 값은 ${min} 이상 ${max} 이하여야 합니다.`, { field: name, min, max });
  }
  return number;
}

function parseOptionalInteger(searchParams, name, min, max) {
  return parseInteger(searchParams.get(name), undefined, { name, min, max });
}

function parseBoolean(value, name) {
  if (value === null || value === "") return undefined;
  if (["true", "1"].includes(value.toLowerCase())) return true;
  if (["false", "0"].includes(value.toLowerCase())) return false;
  throw new HttpError(400, "INVALID_QUERY", `${name} 값은 true 또는 false여야 합니다.`, { field: name });
}

function parseSlug(value, name, maximum = 100) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text && (text.length > maximum || !/^(?:[a-z0-9-]+|[1-9]\d*)$/.test(text))) {
    throw new HttpError(400, "INVALID_QUERY", `${name} 값은 숫자 ID 또는 영문 slug여야 합니다.`, { field: name });
  }
  return text;
}

export function parseCarListQuery(searchParams, { defaultPageSize = 20 } = {}) {
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length > 100) throw new HttpError(400, "INVALID_QUERY", "q 값은 100자 이하여야 합니다.", { field: "q", maxLength: 100 });
  const sort = (searchParams.get("sort") ?? "newest").toLowerCase();
  if (!SORT_VALUES.has(sort)) throw new HttpError(400, "INVALID_QUERY", "지원하지 않는 sort 값입니다.", { field: "sort", allowed: [...SORT_VALUES] });
  const status = (searchParams.get("status") ?? "").trim().toUpperCase();
  if (status && !STATUS_VALUES.has(status)) throw new HttpError(400, "INVALID_QUERY", "지원하지 않는 status 값입니다.", { field: "status", allowed: [...STATUS_VALUES] });
  const fuel = (searchParams.get("fuel") ?? "").trim();
  if (fuel && !FUEL_VALUES.has(fuel)) throw new HttpError(400, "INVALID_QUERY", "지원하지 않는 fuel 값입니다.", { field: "fuel", allowed: [...FUEL_VALUES] });

  const minPrice = parseOptionalInteger(searchParams, "min_price", 0, 1_000_000_000);
  const maxPrice = parseOptionalInteger(searchParams, "max_price", 0, 1_000_000_000);
  const minYear = parseOptionalInteger(searchParams, "min_year", 1990, 2030);
  const maxYear = parseOptionalInteger(searchParams, "max_year", 1990, 2030);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new HttpError(400, "INVALID_QUERY", "min_price는 max_price보다 클 수 없습니다.", { fields: ["min_price", "max_price"] });
  }
  if (minYear !== undefined && maxYear !== undefined && minYear > maxYear) {
    throw new HttpError(400, "INVALID_QUERY", "min_year는 max_year보다 클 수 없습니다.", { fields: ["min_year", "max_year"] });
  }
  return {
    page: parseInteger(searchParams.get("page"), 1, { name: "page", min: 1, max: 100_000 }),
    pageSize: parseInteger(searchParams.get("page_size"), defaultPageSize, { name: "page_size", min: 1, max: 100 }),
    q,
    brand: parseSlug(searchParams.get("brand"), "brand", 80),
    location: parseSlug(searchParams.get("location"), "location"),
    fuel,
    status,
    minPrice,
    maxPrice,
    minYear,
    maxYear,
    maxMileage: parseOptionalInteger(searchParams, "max_mileage", 0, 1_000_000),
    accidentFree: parseBoolean(searchParams.get("accident_free"), "accident_free"),
    sort,
  };
}

function baseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Powered-By": "AutoData-Lab",
  };
}

function apiHeaders(contentType = "application/json; charset=utf-8") {
  return {
    ...baseHeaders(contentType),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-API-Key, Authorization",
    "Access-Control-Expose-Headers": "X-API-Key-Prefix, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  };
}

export function createFixedWindowRateLimiter({
  limit = 60,
  windowMs = 60_000,
  maxBuckets = 10_000,
  now = () => Date.now(),
} = {}) {
  const normalizedLimit = Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 60;
  const normalizedWindow = Number.isSafeInteger(Number(windowMs)) && Number(windowMs) >= 1_000 ? Number(windowMs) : 60_000;
  const normalizedMaxBuckets = Number.isSafeInteger(Number(maxBuckets)) && Number(maxBuckets) > 0 ? Number(maxBuckets) : 10_000;
  const buckets = new Map();
  let nextSweepAt = 0;

  function removeExpired(current) {
    for (const [key, bucket] of buckets) {
      if (current >= bucket.resetAt) buckets.delete(key);
    }
  }

  function makeRoom(current) {
    if (current >= nextSweepAt || buckets.size >= normalizedMaxBuckets) {
      removeExpired(current);
      nextSweepAt = current + normalizedWindow;
    }
    while (buckets.size >= normalizedMaxBuckets) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  return {
    consume(key) {
      const current = now();
      const bucketKey = String(key || "anonymous");
      let bucket = buckets.get(bucketKey);
      if (!bucket || current >= bucket.resetAt) {
        if (!bucket) makeRoom(current);
        bucket = { count: 0, resetAt: current + normalizedWindow };
        buckets.set(bucketKey, bucket);
      }
      const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - current) / 1_000));
      if (bucket.count >= normalizedLimit) {
        return { allowed: false, limit: normalizedLimit, remaining: 0, resetSeconds };
      }
      bucket.count += 1;
      return { allowed: true, limit: normalizedLimit, remaining: normalizedLimit - bucket.count, resetSeconds };
    },
    get size() { return buckets.size; },
  };
}

function rateLimitHeaders(result) {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.resetSeconds),
    ...(result.allowed ? {} : { "Retry-After": String(result.resetSeconds) }),
  };
}

function send(res, status, body, headers = {}, method = "GET") {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  const buffer = Buffer.from(payload);
  res.writeHead(status, { "Content-Length": buffer.byteLength, ...headers });
  res.end(method === "HEAD" ? undefined : buffer);
}

function sendJson(res, status, value, method = "GET", headers = {}) {
  send(res, status, value, { ...apiHeaders(), ...headers }, method);
}

function sendHtml(res, status, html, method = "GET", headers = {}) {
  send(res, status, html, { ...baseHeaders("text/html; charset=utf-8"), ...headers }, method);
}

function requestBaseUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https" ? "https" : "http";
  const host = req.headers.host || "localhost:4000";
  try { return new URL(`${protocol}://${host}`).origin; }
  catch { return `${protocol}://localhost:4000`; }
}

function pageUrl(url, page) {
  const target = new URL(url);
  target.searchParams.set("page", String(page));
  return `${target.pathname}${target.search}`;
}

function filterSummary(query) {
  return {
    q: query.q || null,
    brand: query.brand || null,
    fuel: query.fuel || null,
    status: query.status || null,
    location: query.location || null,
    min_price: query.minPrice ?? null,
    max_price: query.maxPrice ?? null,
    min_year: query.minYear ?? null,
    max_year: query.maxYear ?? null,
    max_mileage: query.maxMileage ?? null,
    accident_free: query.accidentFree ?? null,
  };
}

function errorPayload(error) {
  return { error: { code: error.code ?? "INTERNAL_ERROR", message: error.message ?? "요청을 처리하지 못했습니다.", ...(error.details ? { details: error.details } : {}) } };
}

async function requireDatasetReady(repository) {
  try {
    return await repository.getDatasetEpoch();
  } catch (cause) {
    const error = new HttpError(
      503,
      "DATASET_NOT_READY",
      "데이터셋 seed가 완료되지 않았습니다. 잠시 후 다시 요청하세요.",
    );
    error.cause = cause;
    throw error;
  }
}

async function resolveDatasetEpoch(url, repository) {
  const datasetEpoch = await requireDatasetReady(repository);
  const requestedEpoch = url.searchParams.get("dataset_epoch");
  if (requestedEpoch !== null && requestedEpoch !== datasetEpoch) {
    throw new HttpError(
      409,
      "DATASET_EPOCH_CHANGED",
      "데이터셋이 재시드되었습니다. 이전 checkpoint를 새 namespace로 초기화하세요.",
      { requested: requestedEpoch, current: datasetEpoch },
    );
  }
  return datasetEpoch;
}

function isTransientStorageError(error) {
  const code = String(error?.code ?? "");
  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST", "POOL_CLOSED"].includes(code)
    || /queue limit reached|pool is closed/i.test(String(error?.message ?? ""));
}

function requestClientKey(req) {
  // The classroom server is not configured with a trusted reverse proxy.
  // Trusting a caller-supplied X-Forwarded-For would let clients evade the
  // HTML limit and create unbounded limiter keys.
  return req.socket?.remoteAddress || "local-client";
}

async function handleStatic(req, res, pathname) {
  const asset = STATIC_FILES.get(pathname);
  if (!asset) return false;
  const body = await readFile(asset.path);
  send(res, 200, body, { "Content-Type": asset.type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" }, req.method);
  return true;
}

async function requireApiKey(req, apiKeyService) {
  if (!apiKeyService || typeof apiKeyService.authenticate !== "function") {
    throw new HttpError(503, "API_AUTH_UNAVAILABLE", "API 키 인증 서비스가 준비되지 않았습니다.");
  }
  const result = await apiKeyService.authenticate(req);
  if (!result.ok) {
    if (result.reason === "missing") {
      throw new HttpError(401, "API_KEY_REQUIRED", "X-API-Key 또는 Bearer API 키가 필요합니다.", undefined, { "WWW-Authenticate": "Bearer realm=\"AutoData Lab API\"" });
    }
    throw new HttpError(403, "API_KEY_INVALID", "API 키가 올바르지 않거나 폐기되었습니다.");
  }
  return result.principal;
}

async function handleApi(req, res, url, repository, apiKeyService, rateLimit) {
  const { pathname } = url;
  if (req.method === "OPTIONS") { res.writeHead(204, apiHeaders()); res.end(); return; }
  const principal = await requireApiKey(req, apiKeyService);
  const authenticatedHeaders = { "X-API-Key-Prefix": principal.keyPrefix, ...rateLimitHeaders(rateLimit) };
  await requireDatasetReady(repository);

  if (pathname === "/api/v1/changes") {
    const afterSeq = parseInteger(url.searchParams.get("after_seq"), 0, { name: "after_seq", min: 0, max: Number.MAX_SAFE_INTEGER });
    const requestedUntil = url.searchParams.get("until_seq");
    const [watermark, datasetEpoch] = await Promise.all([
      repository.getChangeWatermark(),
      resolveDatasetEpoch(url, repository),
    ]);
    const untilSeq = requestedUntil === null
      ? watermark
      : Math.min(parseInteger(requestedUntil, 0, { name: "until_seq", min: 0, max: Number.MAX_SAFE_INTEGER }), watermark);
    if (untilSeq < afterSeq) throw new HttpError(400, "INVALID_QUERY", "until_seq는 after_seq보다 작을 수 없습니다.", { fields: ["after_seq", "until_seq"] });
    const limit = parseInteger(url.searchParams.get("limit"), 100, { name: "limit", min: 1, max: 500 });
    const { items, hasMore } = await repository.listChangesAfterSeq({ afterSeq, untilSeq, limit });
    const lastSeq = items.at(-1)?.seq ?? afterSeq;
    const next = hasMore ? `/api/v1/changes?after_seq=${lastSeq}&until_seq=${untilSeq}&limit=${limit}&dataset_epoch=${encodeURIComponent(datasetEpoch)}` : null;
    sendJson(res, 200, {
      data: items,
      meta: { dataset_epoch: datasetEpoch, after_seq: afterSeq, until_seq: untilSeq, limit, returned: items.length, has_more: hasMore },
      links: { self: `${pathname}${url.search}`, next },
    }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/generation-runs") {
    const afterId = parseInteger(url.searchParams.get("after_id"), 0, { name: "after_id", min: 0, max: Number.MAX_SAFE_INTEGER });
    const requestedUntil = url.searchParams.get("until_id");
    const [watermark, datasetEpoch] = await Promise.all([
      repository.getGenerationRunWatermark(),
      resolveDatasetEpoch(url, repository),
    ]);
    const untilId = requestedUntil === null
      ? watermark
      : Math.min(parseInteger(requestedUntil, 0, { name: "until_id", min: 0, max: Number.MAX_SAFE_INTEGER }), watermark);
    if (untilId < afterId) throw new HttpError(400, "INVALID_QUERY", "until_id는 after_id보다 작을 수 없습니다.", { fields: ["after_id", "until_id"] });
    const limit = parseInteger(url.searchParams.get("limit"), 50, { name: "limit", min: 1, max: 100 });
    const { items, hasMore } = await repository.listGenerationRunsAfterId({ afterId, untilId, limit });
    const lastId = items.at(-1)?.id ?? afterId;
    const next = hasMore ? `/api/v1/generation-runs?after_id=${lastId}&until_id=${untilId}&limit=${limit}&dataset_epoch=${encodeURIComponent(datasetEpoch)}` : null;
    sendJson(res, 200, {
      data: items,
      meta: { dataset_epoch: datasetEpoch, after_id: afterId, until_id: untilId, limit, returned: items.length, has_more: hasMore },
      links: { self: `${pathname}${url.search}`, next },
    }, req.method, authenticatedHeaders);
    return;
  }

  if (pathname === "/api/v1/cars/cursor") {
    const afterId = parseInteger(url.searchParams.get("after_id"), 0, { name: "after_id", min: 0, max: Number.MAX_SAFE_INTEGER });
    const requestedUntil = url.searchParams.get("until_id");
    const [watermark, datasetEpoch] = await Promise.all([
      repository.getCarWatermark(),
      resolveDatasetEpoch(url, repository),
    ]);
    const untilId = requestedUntil === null
      ? watermark
      : Math.min(parseInteger(requestedUntil, 0, { name: "until_id", min: 0, max: Number.MAX_SAFE_INTEGER }), watermark);
    if (untilId < afterId) throw new HttpError(400, "INVALID_QUERY", "until_id는 after_id보다 작을 수 없습니다.", { fields: ["after_id", "until_id"] });
    const limit = parseInteger(url.searchParams.get("limit"), 100, { name: "limit", min: 1, max: 500 });
    const { items, hasMore } = await repository.listCarsAfterId({ afterId, untilId, limit });
    const lastId = items.at(-1)?.id ?? null;
    const next = hasMore && lastId !== null ? `/api/v1/cars/cursor?after_id=${lastId}&until_id=${untilId}&limit=${limit}&dataset_epoch=${encodeURIComponent(datasetEpoch)}` : null;
    sendJson(res, 200, { data: items, meta: { dataset_epoch: datasetEpoch, after_id: afterId, until_id: untilId, limit, returned: items.length, has_more: hasMore }, links: { self: `${pathname}${url.search}`, next } }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/cars") {
    const query = parseCarListQuery(url.searchParams);
    const { items, total } = await repository.listCars(query);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    sendJson(res, 200, {
      data: items,
      meta: { page: query.page, page_size: query.pageSize, total, total_pages: totalPages, returned: items.length, sort: query.sort, filters: filterSummary(query) },
      links: { self: `${pathname}${url.search}`, next: query.page < totalPages ? pageUrl(url, query.page + 1) : null, previous: query.page > 1 ? pageUrl(url, query.page - 1) : null },
    }, req.method, authenticatedHeaders);
    return;
  }
  const carMatch = pathname.match(/^\/api\/v1\/cars\/(\d+)$/);
  if (carMatch) {
    const car = await repository.getCar(Number(carMatch[1]));
    if (!car) throw new HttpError(404, "CAR_NOT_FOUND", "해당 중고차 매물을 찾을 수 없습니다.");
    sendJson(res, 200, { data: car }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/brands") {
    sendJson(res, 200, { data: await repository.listBrands() }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/locations") {
    sendJson(res, 200, { data: await repository.listLocations() }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/business-areas") {
    const page = parseInteger(url.searchParams.get("page"), 1, { name: "page", min: 1, max: 100_000 });
    const pageSize = parseInteger(url.searchParams.get("page_size"), 20, { name: "page_size", min: 1, max: 100 });
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length > 100) throw new HttpError(400, "INVALID_QUERY", "q 값은 100자 이하여야 합니다.", { field: "q" });
    const parentId = (url.searchParams.get("parent_id") ?? "").trim();
    if (parentId.length > 32 || /[^A-Za-z0-9_-]/.test(parentId)) throw new HttpError(400, "INVALID_QUERY", "parent_id 형식이 올바르지 않습니다.", { field: "parent_id" });
    const { items, total } = await repository.listBusinessAreas({ page, pageSize, q, parentId });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    sendJson(res, 200, { data: items, meta: { page, page_size: pageSize, total, total_pages: totalPages, returned: items.length }, links: { self: `${pathname}${url.search}`, next: page < totalPages ? pageUrl(url, page + 1) : null, previous: page > 1 ? pageUrl(url, page - 1) : null } }, req.method, authenticatedHeaders);
    return;
  }
  if (pathname === "/api/v1/stats") {
    sendJson(res, 200, { data: await repository.getStats() }, req.method, authenticatedHeaders);
    return;
  }
  throw new HttpError(404, "ENDPOINT_NOT_FOUND", "요청한 API 엔드포인트가 없습니다.");
}

async function handlePage(req, res, url, repository) {
  const { pathname } = url;
  const baseUrl = requestBaseUrl(req);
  const isDatasetPage = pathname === "/"
    || pathname === "/cars"
    || pathname.startsWith("/cars/")
    || pathname === "/changes"
    || pathname === "/generation-runs"
    || pathname === "/learning-guide";
  if (isDatasetPage) await requireDatasetReady(repository);
  if (pathname === "/") {
    const [stats, brands] = await Promise.all([repository.getStats(), repository.listBrands()]);
    sendHtml(res, 200, renderHomePage({ stats, brands, baseUrl }), req.method);
    return;
  }
  if (pathname === "/cars") {
    const query = parseCarListQuery(url.searchParams, { defaultPageSize: 24 });
    const [{ items, total }, brands, locations] = await Promise.all([repository.listCars(query), repository.listBrands(), repository.listLocations()]);
    sendHtml(res, 200, renderCarListPage({ items, total, query, brands, locations }), req.method);
    return;
  }
  if (pathname === "/changes") {
    const afterSeq = parseInteger(url.searchParams.get("after_seq"), 0, { name: "after_seq", min: 0, max: Number.MAX_SAFE_INTEGER });
    const requestedUntil = url.searchParams.get("until_seq");
    const [watermark, datasetEpoch] = await Promise.all([
      repository.getChangeWatermark(),
      resolveDatasetEpoch(url, repository),
    ]);
    const untilSeq = requestedUntil === null
      ? watermark
      : Math.min(parseInteger(requestedUntil, 0, { name: "until_seq", min: 0, max: Number.MAX_SAFE_INTEGER }), watermark);
    if (untilSeq < afterSeq) throw new HttpError(400, "INVALID_QUERY", "until_seq는 after_seq보다 작을 수 없습니다.");
    const limit = parseInteger(url.searchParams.get("limit"), 24, { name: "limit", min: 1, max: 100 });
    const { items, hasMore } = await repository.listChangesAfterSeq({ afterSeq, untilSeq, limit });
    sendHtml(res, 200, renderChangeLogPage({ items, afterSeq, untilSeq, datasetEpoch, limit, hasMore }), req.method);
    return;
  }
  if (pathname === "/generation-runs") {
    const afterId = parseInteger(url.searchParams.get("after_id"), 0, { name: "after_id", min: 0, max: Number.MAX_SAFE_INTEGER });
    const requestedUntil = url.searchParams.get("until_id");
    const [watermark, datasetEpoch] = await Promise.all([
      repository.getGenerationRunWatermark(),
      resolveDatasetEpoch(url, repository),
    ]);
    const untilId = requestedUntil === null
      ? watermark
      : Math.min(parseInteger(requestedUntil, 0, { name: "until_id", min: 0, max: Number.MAX_SAFE_INTEGER }), watermark);
    if (untilId < afterId) throw new HttpError(400, "INVALID_QUERY", "until_id는 after_id보다 작을 수 없습니다.");
    const limit = parseInteger(url.searchParams.get("limit"), 24, { name: "limit", min: 1, max: 100 });
    const { items, hasMore } = await repository.listGenerationRunsAfterId({ afterId, untilId, limit });
    sendHtml(res, 200, renderGenerationRunsPage({ items, afterId, untilId, datasetEpoch, limit, hasMore }), req.method);
    return;
  }
  const carMatch = pathname.match(/^\/cars\/(\d+)$/);
  if (carMatch) {
    const car = await repository.getCar(Number(carMatch[1]));
    if (!car) throw new HttpError(404, "CAR_NOT_FOUND", "해당 중고차 매물을 찾을 수 없습니다.");
    sendHtml(res, 200, renderCarDetailPage({ car }), req.method);
    return;
  }
  if (pathname === "/docs") { sendHtml(res, 200, renderDocsPage({ baseUrl }), req.method); return; }
  if (pathname === "/learning-guide") {
    sendHtml(res, 200, renderLearningGuidePage({ baseUrl, stats: await repository.getStats() }), req.method);
    return;
  }
  if (pathname === "/crawl-policy") { sendHtml(res, 200, renderCrawlPolicyPage({ baseUrl }), req.method); return; }
  if (pathname === "/products" || pathname.startsWith("/products/")) {
    const target = pathname.replace(/^\/products/, "/cars");
    res.writeHead(301, { Location: `${target}${url.search}`, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  if (pathname === "/robots.txt") {
    send(res, 200, "User-agent: *\nAllow: /cars\nAllow: /changes\nAllow: /generation-runs\nAllow: /crawl-policy\nDisallow: /api/\nCrawl-delay: 1\n", baseHeaders("text/plain; charset=utf-8"), req.method);
    return;
  }
  if (pathname === "/favicon.ico") { res.writeHead(204, { "Cache-Control": "public, max-age=86400" }); res.end(); return; }
  throw new HttpError(404, "PAGE_NOT_FOUND", "요청한 페이지를 찾을 수 없습니다.");
}

export function createApp({
  repository,
  apiKeyService,
  logger = console,
  apiRateLimit,
  apiPreAuthRateLimit,
  htmlRateLimit,
}) {
  if (!repository) throw new TypeError("repository is required");
  const apiLimiter = createFixedWindowRateLimiter({ limit: 60, windowMs: 60_000, ...apiRateLimit });
  const apiPreAuthLimiter = createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, ...apiPreAuthRateLimit });
  const htmlLimiter = createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, ...htmlRateLimit });
  return async function app(req, res) {
    const startedAt = performance.now();
    const method = req.method || "GET";
    const rawUrl = req.url || "/";
    let url;
    let logPath = "<invalid-url>";
    let isApi = rawUrl.startsWith("/api/") || rawUrl.startsWith("/healthz");
    res.once("finish", () => logger.info?.(`${method} ${logPath} ${res.statusCode} ${(performance.now() - startedAt).toFixed(1)}ms`));
    try {
      try { url = new URL(rawUrl, "http://localhost"); }
      catch { throw new HttpError(400, "INVALID_REQUEST_URL", "요청 URL 형식이 올바르지 않습니다."); }
      logPath = url.pathname.replace(/[\r\n]/g, "");
      isApi = url.pathname.startsWith("/api/") || url.pathname === "/healthz";
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) throw new HttpError(405, "METHOD_NOT_ALLOWED", "GET 요청만 지원합니다.", undefined, { Allow: "GET, HEAD, OPTIONS" });
      if (await handleStatic(req, res, url.pathname)) return;
      if (url.pathname === "/healthz") {
        const health = await repository.health();
        if (!health.ok) {
          logger.error?.("Repository health check failed", health.error);
          sendJson(res, 503, { ok: false, source: health.source ?? "unknown", error: "DATASTORE_UNAVAILABLE" }, method);
        } else {
          sendJson(res, 200, health, method);
        }
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        let credentialRateLimit = { allowed: true, limit: 60, remaining: 60, resetSeconds: 60 };
        if (method !== "OPTIONS") {
          const clientKey = requestClientKey(req);
          const preAuthRateLimit = apiPreAuthLimiter.consume(clientKey);
          if (!preAuthRateLimit.allowed) {
            throw new HttpError(
              429,
              "RATE_LIMITED",
              "인증 요청 한도를 초과했습니다. Retry-After 이후 다시 요청하세요.",
              undefined,
              rateLimitHeaders(preAuthRateLimit),
            );
          }

          const credential = parseApiKeyCredential(req);
          const parsedKey = credential.ok ? parseApiKey(credential.rawKey) : null;
          if (parsedKey) {
            credentialRateLimit = apiLimiter.consume(parsedKey.keyPrefix);
            if (!credentialRateLimit.allowed) {
              throw new HttpError(
                429,
                "RATE_LIMITED",
                "API 요청 한도를 초과했습니다. Retry-After 이후 다시 요청하세요.",
                undefined,
                rateLimitHeaders(credentialRateLimit),
              );
            }
          }
        }
        await handleApi(req, res, url, repository, apiKeyService, credentialRateLimit);
      } else {
        const isCrawlableDataset = url.pathname.startsWith("/cars")
          || url.pathname === "/changes"
          || url.pathname === "/generation-runs";
        if (isCrawlableDataset) {
          const rateLimit = htmlLimiter.consume(requestClientKey(req));
          for (const [name, value] of Object.entries(rateLimitHeaders(rateLimit))) res.setHeader(name, value);
          if (!rateLimit.allowed) {
            throw new HttpError(429, "RATE_LIMITED", "HTML 요청 한도를 초과했습니다. Retry-After 이후 다시 요청하세요.", undefined, rateLimitHeaders(rateLimit));
          }
        }
        await handlePage(req, res, url, repository);
      }
    } catch (error) {
      const normalized = error instanceof HttpError
        ? error
        : isTransientStorageError(error)
          ? new HttpError(503, "SERVICE_UNAVAILABLE", "데이터 저장소가 혼잡하거나 연결되지 않았습니다.")
          : new HttpError(500, "INTERNAL_ERROR", "서버에서 요청을 처리하지 못했습니다.");
      if (normalized.status >= 500) logger.error?.(error);
      const headers = normalized.headers ?? {};
      if (isApi) sendJson(res, normalized.status, errorPayload(normalized), method, headers);
      else sendHtml(res, normalized.status, renderErrorPage({ status: normalized.status, message: normalized.message }), method, headers);
    }
  };
}
