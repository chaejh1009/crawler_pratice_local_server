import { createHash, createHmac } from "node:crypto";

import {
  DEFAULT_MEMORY_CAR_COUNT,
  SAMPLE_MANUFACTURERS,
  SAMPLE_LOCATIONS,
  createCarSeedContext,
  createFallbackBusinessAreas,
  createFallbackEmployees,
  createSampleCar,
  createSampleCars,
  normalizeBusinessAreaRecord,
  normalizeEmployeeRecord,
} from "./sample-data.mjs";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const DEFAULT_CURSOR_LIMIT = 100;
const MAX_CURSOR_LIMIT = 500;
const DEFAULT_SYNTHETIC_DEALER_PUBLIC_ID_SECRET = "autodata-memory-only-synthetic-secret-v1";

const SORT_ALIASES = Object.freeze({
  newest: "newest",
  latest: "newest",
  price_asc: "price_asc",
  price_desc: "price_desc",
  mileage_asc: "mileage_asc",
  year_desc: "year_desc",
});

const SORT_SQL = Object.freeze({
  newest: "l.created_at DESC, l.id DESC",
  price_asc: "l.price ASC, l.id ASC",
  price_desc: "l.price DESC, l.id DESC",
  mileage_asc: "l.mileage_km ASC, l.id ASC",
  year_desc: "l.model_year DESC, l.mileage_km ASC, l.id DESC",
});

const CAR_SELECT = `
  SELECT
    l.id,
    l.listing_number AS listingNumber,
    l.title,
    l.description,
    l.trim_name AS trimName,
    l.model_year AS modelYear,
    l.first_registration AS firstRegistration,
    l.mileage_km AS mileageKm,
    l.fuel_type AS fuelType,
    l.transmission,
    l.price,
    l.currency,
    l.color,
    l.displacement_cc AS displacementCc,
    l.accident_count AS accidentCount,
    l.owner_change_count AS ownerChangeCount,
    l.inspection_status AS inspectionStatus,
    l.status,
    l.created_at AS createdAt,
    l.updated_at AS updatedAt,
    b.id AS brandId,
    b.name AS brandName,
    b.slug AS brandSlug,
    b.country AS brandCountry,
    m.id AS modelId,
    m.name AS modelName,
    m.slug AS modelSlug,
    m.body_type AS modelBodyType,
    loc.id AS locationId,
    loc.province AS locationProvince,
    loc.city AS locationCity,
    loc.slug AS locationSlug,
    e.emp_no AS dealerEmpNo,
    e.emp_name AS dealerEmpName,
    e.dept_name AS dealerDeptName,
    e.position_name AS dealerPositionName,
    a.area_id AS businessAreaId,
    a.area_name AS businessAreaName,
    a.parent_area_id AS parentAreaId,
    pa.area_name AS parentAreaName
  FROM vehicle_listings l
  INNER JOIN vehicle_models m ON m.id = l.model_id
  INNER JOIN vehicle_brands b ON b.id = m.brand_id
  INNER JOIN locations loc ON loc.id = l.location_id
  INNER JOIN employees e ON e.emp_no = l.dealer_emp_no
  INNER JOIN business_areas a ON a.area_id = l.business_area_id
  LEFT JOIN business_areas pa ON pa.area_id = a.parent_area_id`;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function nonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nullableBoolean(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === 1 || ["true", "1"].includes(String(value).toLowerCase())) return true;
  if (value === false || value === 0 || ["false", "0"].includes(String(value).toLowerCase())) return false;
  return null;
}

function normalizeListOptions(options = {}) {
  return {
    page: positiveInteger(options.page, 1, 100_000),
    pageSize: positiveInteger(options.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    q: String(options.q ?? "").trim().slice(0, 100),
    brand: String(options.brand ?? "").trim().toLowerCase().slice(0, 80),
    fuel: String(options.fuel ?? "").trim().slice(0, 32),
    status: String(options.status ?? "").trim().toUpperCase().slice(0, 16),
    location: String(options.location ?? "").trim().toLowerCase().slice(0, 100),
    minPrice: nullableNumber(options.minPrice),
    maxPrice: nullableNumber(options.maxPrice),
    minYear: nullableNumber(options.minYear),
    maxYear: nullableNumber(options.maxYear),
    maxMileage: nullableNumber(options.maxMileage),
    accidentFree: nullableBoolean(options.accidentFree),
    sort: SORT_ALIASES[String(options.sort ?? "newest").toLowerCase()] ?? "newest",
  };
}

function normalizeDatasetLimit(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function maskName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "담당자";
  const characters = Array.from(text);
  return `${characters[0]}${"○".repeat(Math.max(1, Math.min(2, characters.length - 1)))}`;
}

function normalizeDealerPublicIdSecret(value) {
  const secret = String(value ?? "");
  if (secret.length < 32) {
    throw new Error("DEALER_PUBLIC_ID_SECRET은 예측 불가능한 32자 이상의 값이어야 합니다.");
  }
  return secret;
}

function dealerCode(employeeNo, secret) {
  const pseudonym = createHmac("sha256", normalizeDealerPublicIdSecret(secret))
    .update(`autodata-public-dealer-v1\0${String(employeeNo ?? "")}`, "utf8")
    .digest("hex")
    .slice(0, 10);
  return `DLR-${pseudonym}`;
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "");
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toISOString();
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function mapSampleCar(car, dealerPublicIdSecret) {
  const status = String(car.status ?? "AVAILABLE").toUpperCase();
  return {
    id: Number(car.id),
    listingNumber: car.listingNumber ?? car.listingNo,
    title: car.title,
    description: car.description,
    brand: car.brand ?? car.manufacturer,
    model: car.model,
    trim: car.trim ?? car.grade,
    modelYear: Number(car.modelYear),
    firstRegistration: car.firstRegistration ?? car.firstRegistrationDate,
    mileageKm: Number(car.mileageKm),
    fuelType: car.fuelName ?? car.fuelType,
    transmission: car.transmissionName ?? car.transmission,
    price: Number(car.price),
    currency: car.currency ?? "KRW",
    color: car.color,
    displacementCc: Number(car.displacementCc ?? 0),
    accidentCount: Number(car.accidentCount ?? 0),
    ownerChangeCount: Number(car.ownerChangeCount ?? 0),
    inspectionStatus: car.inspectionStatus ?? "점검완료",
    status,
    location: {
      id: Number(car.location?.id),
      province: car.location?.province ?? car.location?.sido,
      city: car.location?.city ?? car.location?.sigungu,
      slug: car.location?.slug,
    },
    dealer: {
      code: dealerCode(car.dealer?.employeeNo, dealerPublicIdSecret),
      displayName: car.dealer?.displayName ?? "인증딜러",
      department: car.dealer?.departmentName ?? "영업팀",
      position: car.dealer?.positionName ?? "담당자",
    },
    businessArea: {
      id: car.businessArea?.id,
      name: car.businessArea?.name,
      parent: car.businessArea?.parentAreaId
        ? { id: car.businessArea.parentAreaId, name: car.businessArea.parentAreaName }
        : null,
    },
    createdAt: toIsoString(car.createdAt ?? car.registeredAt),
    updatedAt: toIsoString(car.updatedAt ?? car.registeredAt),
  };
}

function mapMysqlCar(row, dealerPublicIdSecret) {
  return {
    id: Number(row.id),
    listingNumber: row.listingNumber,
    title: row.title,
    description: row.description,
    brand: {
      id: Number(row.brandId),
      name: row.brandName,
      slug: row.brandSlug,
      country: row.brandCountry,
    },
    model: {
      id: Number(row.modelId),
      name: row.modelName,
      slug: row.modelSlug,
      bodyType: row.modelBodyType,
    },
    trim: row.trimName,
    modelYear: Number(row.modelYear),
    firstRegistration: String(row.firstRegistration).slice(0, 10),
    mileageKm: Number(row.mileageKm),
    fuelType: row.fuelType,
    transmission: row.transmission,
    price: Number(row.price),
    currency: row.currency,
    color: row.color,
    displacementCc: Number(row.displacementCc),
    accidentCount: Number(row.accidentCount),
    ownerChangeCount: Number(row.ownerChangeCount),
    inspectionStatus: row.inspectionStatus,
    status: row.status,
    location: {
      id: Number(row.locationId),
      province: row.locationProvince,
      city: row.locationCity,
      slug: row.locationSlug,
    },
    dealer: {
      code: dealerCode(row.dealerEmpNo, dealerPublicIdSecret),
      displayName: maskName(row.dealerEmpName),
      department: row.dealerDeptName,
      position: row.dealerPositionName,
    },
    businessArea: {
      id: row.businessAreaId,
      name: row.businessAreaName,
      parent: row.parentAreaId ? { id: row.parentAreaId, name: row.parentAreaName } : null,
    },
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "null")); }
  catch { return null; }
}

function mapMysqlChange(row) {
  return {
    seq: Number(row.seq),
    eventId: row.event_id,
    runId: Number(row.run_id),
    runKey: row.run_key ?? null,
    operation: row.operation,
    listingId: Number(row.listing_id),
    listingNumber: row.listing_number,
    entityVersion: Number(row.entity_version),
    occurredAt: toIsoString(row.occurred_at),
    sourceChecksum: row.source_checksum,
    payload: parseJsonObject(row.payload_json),
  };
}

function mapMysqlGenerationRunEvent(row) {
  const eventId = Number(row.event_id);
  return {
    // Keep `id` as the cursor field for existing after_id/until_id clients.
    id: eventId,
    eventId,
    runId: Number(row.run_id),
    runKey: row.run_key,
    status: row.status,
    requestedCount: Number(row.requested_count),
    sequenceStart: Number(row.sequence_start),
    sequenceEnd: Number(row.sequence_end),
    mysqlCount: Number(row.mysql_count),
    mongoCount: Number(row.mongo_count),
    errorMessage: row.error_message || null,
    startedAt: toIsoString(row.started_at),
    finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    occurredAt: toIsoString(row.occurred_at),
  };
}

function compareCars(sort) {
  switch (sort) {
    case "price_asc": return (a, b) => a.price - b.price || a.id - b.id;
    case "price_desc": return (a, b) => b.price - a.price || b.id - a.id;
    case "mileage_asc": return (a, b) => a.mileageKm - b.mileageKm || a.id - b.id;
    case "year_desc": return (a, b) => b.modelYear - a.modelYear || a.mileageKm - b.mileageKm || b.id - a.id;
    case "newest":
    default: return (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
  }
}

function carMatches(car, query) {
  if (query.brand && car.brand.slug !== query.brand && String(car.brand.id) !== query.brand) return false;
  if (query.fuel && car.fuelType !== query.fuel) return false;
  if (query.status && car.status !== query.status) return false;
  if (query.location && car.location.slug !== query.location && String(car.location.id) !== query.location) return false;
  if (query.minPrice !== null && car.price < query.minPrice) return false;
  if (query.maxPrice !== null && car.price > query.maxPrice) return false;
  if (query.minYear !== null && car.modelYear < query.minYear) return false;
  if (query.maxYear !== null && car.modelYear > query.maxYear) return false;
  if (query.maxMileage !== null && car.mileageKm > query.maxMileage) return false;
  if (query.accidentFree === true && car.accidentCount !== 0) return false;
  if (query.accidentFree === false && car.accidentCount === 0) return false;
  if (query.q) {
    const haystack = [car.title, car.description, car.brand.name, car.model.name, car.trim]
      .join(" ").toLocaleLowerCase("ko");
    if (!haystack.includes(query.q.toLocaleLowerCase("ko"))) return false;
  }
  return true;
}

export function createMemoryRepository({
  count = DEFAULT_MEMORY_CAR_COUNT,
  employees = createFallbackEmployees(),
  businessAreas,
  dealerPublicIdSecret = DEFAULT_SYNTHETIC_DEALER_PUBLIC_ID_SECRET,
} = {}) {
  const normalizedDealerSecret = normalizeDealerPublicIdSecret(dealerPublicIdSecret);
  const normalizedEmployees = employees.map(normalizeEmployeeRecord).filter(Boolean);
  const normalizedAreas = (businessAreas ?? createFallbackBusinessAreas(undefined, normalizedEmployees))
    .map(normalizeBusinessAreaRecord).filter(Boolean);
  const carSeedContext = createCarSeedContext({
    employees: normalizedEmployees,
    businessAreas: normalizedAreas,
  });
  const rawCars = createSampleCars(positiveInteger(count, DEFAULT_MEMORY_CAR_COUNT), carSeedContext);
  const cars = rawCars.map((car) => mapSampleCar(car, normalizedDealerSecret));
  const carById = new Map(cars.map((car) => [car.id, car]));
  const employeeByNo = new Map(normalizedEmployees.map((employee) => [employee.employeeNo, employee]));
  const areaCounts = new Map();
  const brandCounts = new Map();
  const locationCounts = new Map();
  let availableCount = 0;
  let closed = false;
  for (const car of cars) {
    brandCounts.set(car.brand.id, (brandCounts.get(car.brand.id) ?? 0) + 1);
    locationCounts.set(car.location.id, (locationCounts.get(car.location.id) ?? 0) + 1);
    areaCounts.set(car.businessArea.id, (areaCounts.get(car.businessArea.id) ?? 0) + 1);
    if (car.status === "AVAILABLE") availableCount += 1;
  }
  const areaById = new Map(normalizedAreas.map((area) => [area.id, area]));
  const memoryRun = Object.freeze({
    id: 1,
    runKey: "memory-bootstrap",
    status: "SUCCESS",
    requestedCount: cars.length,
    sequenceStart: cars.at(0)?.id ?? 0,
    sequenceEnd: cars.at(-1)?.id ?? 0,
    mysqlCount: 0,
    mongoCount: 0,
    errorMessage: null,
    startedAt: cars.at(0)?.createdAt ?? new Date(0).toISOString(),
    finishedAt: cars.at(-1)?.updatedAt ?? new Date(0).toISOString(),
  });
  const generationRunEvents = [
    Object.freeze({
      ...memoryRun,
      id: 1,
      eventId: 1,
      runId: memoryRun.id,
      storage: "memory",
      memoryCount: 0,
      status: "RUNNING",
      mysqlCount: 0,
      mongoCount: 0,
      errorMessage: null,
      finishedAt: null,
      occurredAt: memoryRun.startedAt,
    }),
    Object.freeze({
      ...memoryRun,
      id: 2,
      eventId: 2,
      runId: memoryRun.id,
      storage: "memory",
      memoryCount: cars.length,
      occurredAt: memoryRun.finishedAt,
    }),
  ];
  const changes = cars.map((car, index) => {
    const serialized = JSON.stringify(car);
    return Object.freeze({
      seq: index + 1,
      eventId: sha256(`memory-bootstrap:${car.listingNumber}`),
      runId: memoryRun.id,
      runKey: memoryRun.runKey,
      operation: "UPSERT",
      listingId: car.id,
      listingNumber: car.listingNumber,
      entityVersion: 1,
      occurredAt: car.updatedAt,
      sourceChecksum: sha256(serialized),
      payload: car,
    });
  });
  const completedRunKeys = new Map([[memoryRun.runKey, memoryRun]]);
  let generationRunCount = 1;

  function assertOpen() {
    if (closed) throw new Error("The memory repository is closed.");
  }

  return {
    async health() {
      return closed
        ? { ok: false, source: "memory", error: "Repository is closed." }
        : { ok: true, source: "memory", datasetEpoch: "memory-v1" };
    },
    async getDatasetEpoch() {
      assertOpen();
      return "memory-v1";
    },
    async getStats() {
      assertOpen();
      return {
        carCount: cars.length,
        availableCount,
        brandCount: SAMPLE_MANUFACTURERS.length,
        locationCount: SAMPLE_LOCATIONS.length,
        employeeCount: normalizedEmployees.length,
        businessAreaCount: normalizedAreas.length,
        changeCount: changes.length,
        pendingChangeCount: 0,
        generationRunCount,
        incompleteGenerationRunCount: 0,
        generationRunEventCount: generationRunEvents.length,
        latestGenerationRunEventId: generationRunEvents.at(-1)?.eventId ?? 0,
        latestChangeSeq: changes.at(-1)?.seq ?? 0,
        latestDataUpdatedAt: changes.at(-1)?.occurredAt ?? null,
        datasetEpoch: "memory-v1",
        source: "memory",
      };
    },
    async listBrands() {
      assertOpen();
      return SAMPLE_MANUFACTURERS.map((brand) => ({ ...brand, carCount: brandCounts.get(brand.id) ?? 0 }));
    },
    async listLocations() {
      assertOpen();
      return SAMPLE_LOCATIONS.map((location) => ({
        id: location.id,
        province: location.province ?? location.sido,
        city: location.city ?? location.sigungu,
        slug: location.slug,
        carCount: locationCounts.get(location.id) ?? 0,
      }));
    },
    async listBusinessAreas(options = {}) {
      assertOpen();
      const page = positiveInteger(options.page, 1, 100_000);
      const pageSize = positiveInteger(options.pageSize, 20, MAX_PAGE_SIZE);
      const q = String(options.q ?? "").trim().toLocaleLowerCase("ko");
      const parentId = String(options.parentId ?? "").trim();
      const rows = normalizedAreas.filter((area) => {
        if (parentId && area.parentAreaId !== parentId) return false;
        return !q || [area.id, area.name].join(" ").toLocaleLowerCase("ko").includes(q);
      });
      const offset = (page - 1) * pageSize;
      return {
        items: rows.slice(offset, offset + pageSize).map((area) => {
          const manager = employeeByNo.get(area.managerEmployeeNo);
          const parent = area.parentAreaId ? areaById.get(area.parentAreaId) : null;
          return {
            id: area.id,
            name: area.name,
            parent: parent ? { id: parent.id, name: parent.name } : null,
            manager: manager ? {
              code: dealerCode(manager.employeeNo, normalizedDealerSecret),
              displayName: maskName(manager.name),
            } : null,
            carCount: areaCounts.get(area.id) ?? 0,
            registeredAt: String(area.registeredAt).slice(0, 10),
          };
        }),
        total: rows.length,
      };
    },
    async listCars(options = {}) {
      assertOpen();
      const query = normalizeListOptions(options);
      const datasetLimit = normalizeDatasetLimit(options.datasetLimit);
      const publicDataset = datasetLimit === null ? cars : cars.slice(-datasetLimit);
      const filtered = publicDataset.filter((car) => carMatches(car, query)).sort(compareCars(query.sort));
      const offset = (query.page - 1) * query.pageSize;
      return { items: filtered.slice(offset, offset + query.pageSize), total: filtered.length };
    },
    async getCarWatermark() {
      assertOpen();
      return cars.at(-1)?.id ?? 0;
    },
    async listCarsAfterId({ afterId = 0, untilId, limit = DEFAULT_CURSOR_LIMIT } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterId);
      const watermark = cars.at(-1)?.id ?? 0;
      const normalizedUntil = Math.min(nonNegativeInteger(untilId, watermark), watermark);
      const normalizedLimit = positiveInteger(limit, DEFAULT_CURSOR_LIMIT, MAX_CURSOR_LIMIT);
      const rows = cars
        .filter((car) => car.id > normalizedAfter && car.id <= normalizedUntil)
        .slice(0, normalizedLimit + 1);
      const hasMore = rows.length > normalizedLimit;
      return { items: hasMore ? rows.slice(0, normalizedLimit) : rows, hasMore };
    },
    async getChangeWatermark() {
      assertOpen();
      return changes.at(-1)?.seq ?? 0;
    },
    async listChangesAfterSeq({ afterSeq = 0, untilSeq, limit = DEFAULT_CURSOR_LIMIT } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterSeq);
      const watermark = changes.at(-1)?.seq ?? 0;
      const normalizedUntil = Math.min(nonNegativeInteger(untilSeq, watermark), watermark);
      const normalizedLimit = positiveInteger(limit, DEFAULT_CURSOR_LIMIT, MAX_CURSOR_LIMIT);
      const rows = changes.filter((change) => change.seq > normalizedAfter && change.seq <= normalizedUntil).slice(0, normalizedLimit + 1);
      const hasMore = rows.length > normalizedLimit;
      return { items: hasMore ? rows.slice(0, normalizedLimit) : rows, hasMore };
    },
    async getGenerationRunWatermark() {
      assertOpen();
      return generationRunEvents.at(-1)?.eventId ?? 0;
    },
    async listGenerationRunsAfterId({ afterId = 0, untilId, limit = 100 } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterId);
      const watermark = generationRunEvents.at(-1)?.eventId ?? 0;
      const normalizedUntil = Math.min(nonNegativeInteger(untilId, watermark), watermark);
      const normalizedLimit = positiveInteger(limit, 100, 100);
      const rows = generationRunEvents
        .filter((event) => event.eventId > normalizedAfter && event.eventId <= normalizedUntil)
        .slice(0, normalizedLimit + 1);
      const hasMore = rows.length > normalizedLimit;
      return { items: hasMore ? rows.slice(0, normalizedLimit) : rows, hasMore };
    },
    async getCar(id, options = {}) {
      assertOpen();
      const normalized = Number(id);
      if (!Number.isSafeInteger(normalized) || normalized <= 0) return null;
      const datasetLimit = normalizeDatasetLimit(options.datasetLimit);
      if (datasetLimit !== null && !cars.slice(-datasetLimit).some((car) => car.id === normalized)) return null;
      return carById.get(normalized) ?? null;
    },
    async appendSyntheticCars({ count: requestedCount = 28, runKey, now = new Date() } = {}) {
      assertOpen();
      const batchCount = positiveInteger(requestedCount, 28, 10_000);
      const generatedAt = now instanceof Date ? now : new Date(now);
      if (Number.isNaN(generatedAt.getTime())) throw new TypeError("생성 시각이 올바르지 않습니다.");
      const normalizedRunKey = String(runKey ?? `memory:${generatedAt.toISOString()}`).trim();
      if (!normalizedRunKey) throw new TypeError("runKey는 비어 있을 수 없습니다.");
      const completed = completedRunKeys.get(normalizedRunKey);
      if (completed) {
        if (completed.requestedCount !== batchCount) throw new Error("같은 runKey를 다른 count로 재사용할 수 없습니다.");
        return { skipped: true, runKey: normalizedRunKey, insertedCount: 0, carCount: cars.length };
      }

      const runId = generationRunCount + 1;
      const sequenceStart = cars.length + 1;
      const sequenceEnd = cars.length + batchCount;
      const startedAt = generatedAt.toISOString();
      generationRunEvents.push(Object.freeze({
        id: generationRunEvents.length + 1,
        eventId: generationRunEvents.length + 1,
        runId,
        runKey: normalizedRunKey,
        storage: "memory",
        memoryCount: 0,
        status: "RUNNING",
        requestedCount: batchCount,
        sequenceStart,
        sequenceEnd,
        mysqlCount: 0,
        mongoCount: 0,
        errorMessage: null,
        startedAt,
        finishedAt: null,
        occurredAt: startedAt,
      }));

      for (let offset = 0; offset < batchCount; offset += 1) {
        const timestamp = new Date(generatedAt.getTime() + offset).toISOString();
        const rawCar = createSampleCar(cars.length, carSeedContext);
        const car = mapSampleCar({ ...rawCar, createdAt: timestamp, updatedAt: timestamp }, normalizedDealerSecret);
        cars.push(car);
        carById.set(car.id, car);
        brandCounts.set(car.brand.id, (brandCounts.get(car.brand.id) ?? 0) + 1);
        locationCounts.set(car.location.id, (locationCounts.get(car.location.id) ?? 0) + 1);
        areaCounts.set(car.businessArea.id, (areaCounts.get(car.businessArea.id) ?? 0) + 1);
        if (car.status === "AVAILABLE") availableCount += 1;
        const serialized = JSON.stringify(car);
        changes.push(Object.freeze({
          seq: changes.length + 1,
          eventId: sha256(`${normalizedRunKey}:${car.listingNumber}`),
          runId,
          runKey: normalizedRunKey,
          operation: "UPSERT",
          listingId: car.id,
          listingNumber: car.listingNumber,
          entityVersion: 1,
          occurredAt: car.updatedAt,
          sourceChecksum: sha256(serialized),
          payload: car,
        }));
      }

      const finishedAt = new Date(generatedAt.getTime() + Math.max(1, batchCount)).toISOString();
      const completedRun = Object.freeze({
        id: generationRunEvents.length + 1,
        eventId: generationRunEvents.length + 1,
        runId,
        runKey: normalizedRunKey,
        storage: "memory",
        memoryCount: batchCount,
        status: "SUCCESS",
        requestedCount: batchCount,
        sequenceStart,
        sequenceEnd,
        mysqlCount: 0,
        mongoCount: 0,
        errorMessage: null,
        startedAt,
        finishedAt,
        occurredAt: finishedAt,
      });
      generationRunEvents.push(completedRun);
      completedRunKeys.set(normalizedRunKey, completedRun);
      generationRunCount = runId;
      return { skipped: false, runKey: normalizedRunKey, insertedCount: batchCount, carCount: cars.length };
    },
    async close() { closed = true; },
  };
}

function toFullTextQuery(query) {
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  return tokens.map((token) => `+${token}*`).join(" ");
}

function createMysqlRepository(pool, dealerPublicIdSecret) {
  const normalizedDealerSecret = normalizeDealerPublicIdSecret(dealerPublicIdSecret);
  let closed = false;
  function assertOpen() { if (closed) throw new Error("The MySQL repository is closed."); }
  return {
    async health() {
      if (closed) return { ok: false, source: "mysql", error: "Repository is closed." };
      const startedAt = Date.now();
      try {
        const [rows] = await pool.execute(
          `SELECT ds.dataset_epoch AS datasetEpoch,
                  ds.status AS datasetStatus,
                  (SELECT COUNT(*) FROM generation_runs WHERE status <> 'SUCCESS') AS incompleteGenerationRunCount
             FROM dataset_state ds WHERE ds.id = 1`,
        );
        if (!rows.length) throw new Error("dataset_state가 없습니다. db:seed를 다시 실행하세요.");
        if (String(rows[0].datasetStatus) !== "READY") {
          throw new Error("dataset_state가 READY가 아닙니다. db:seed를 완료하세요.");
        }
        return {
          ok: true,
          source: "mysql",
          latencyMs: Date.now() - startedAt,
          datasetEpoch: String(rows[0].datasetEpoch),
          incompleteGenerationRunCount: Number(rows[0].incompleteGenerationRunCount),
        };
      } catch (error) {
        return { ok: false, source: "mysql", error: error instanceof Error ? error.message : String(error) };
      }
    },
    async getDatasetEpoch() {
      assertOpen();
      const [rows] = await pool.execute(
        "SELECT dataset_epoch AS datasetEpoch FROM dataset_state WHERE id = 1 AND status = 'READY' LIMIT 1",
      );
      if (!rows.length) throw new Error("dataset_state가 없습니다. db:seed를 다시 실행하세요.");
      return String(rows[0].datasetEpoch);
    },
    async getStats() {
      assertOpen();
      const [[rows], [stateRows]] = await Promise.all([
        pool.execute(`SELECT
        (SELECT COUNT(*) FROM vehicle_listings) AS carCount,
        (SELECT COUNT(*) FROM vehicle_listings WHERE status = 'AVAILABLE') AS availableCount,
        (SELECT COUNT(*) FROM vehicle_brands) AS brandCount,
        (SELECT COUNT(*) FROM locations) AS locationCount,
        (SELECT COUNT(*) FROM employees) AS employeeCount,
        (SELECT COUNT(*) FROM business_areas) AS businessAreaCount,
        (SELECT COUNT(*) FROM listing_change_log c INNER JOIN generation_runs r ON r.id = c.run_id WHERE r.status = 'SUCCESS') AS changeCount,
        (SELECT COUNT(*) FROM listing_change_log c INNER JOIN generation_runs r ON r.id = c.run_id WHERE r.status <> 'SUCCESS') AS pendingChangeCount,
        (SELECT COUNT(*) FROM generation_runs) AS generationRunCount,
        (SELECT COUNT(*) FROM generation_runs WHERE status <> 'SUCCESS') AS incompleteGenerationRunCount,
        (SELECT COUNT(*) FROM generation_run_events) AS generationRunEventCount,
        (SELECT COALESCE(MAX(event_id), 0) FROM generation_run_events) AS latestGenerationRunEventId,
        (SELECT COALESCE(MAX(c.seq), 0) FROM listing_change_log c INNER JOIN generation_runs r ON r.id = c.run_id WHERE r.status = 'SUCCESS') AS latestChangeSeq,
        (SELECT MAX(c.occurred_at) FROM listing_change_log c INNER JOIN generation_runs r ON r.id = c.run_id WHERE r.status = 'SUCCESS') AS latestDataUpdatedAt`),
        pool.execute("SELECT dataset_epoch AS datasetEpoch FROM dataset_state WHERE id = 1 AND status = 'READY' LIMIT 1"),
      ]);
      if (!stateRows.length) throw new Error("dataset_state가 없습니다. db:seed를 다시 실행하세요.");
      return Object.fromEntries(Object.entries(rows[0])
        .filter(([key]) => key !== "latestDataUpdatedAt")
        .map(([key, value]) => [key, Number(value)]).concat([
          ["latestDataUpdatedAt", rows[0].latestDataUpdatedAt ? toIsoString(rows[0].latestDataUpdatedAt) : null],
          ["datasetEpoch", String(stateRows[0].datasetEpoch)],
          ["source", "mysql"],
        ]));
    },
    async listBrands() {
      assertOpen();
      const [rows] = await pool.execute(`SELECT b.id, b.name, b.slug, b.country, COUNT(l.id) AS carCount
        FROM vehicle_brands b LEFT JOIN vehicle_models m ON m.brand_id = b.id
        LEFT JOIN vehicle_listings l ON l.model_id = m.id
        GROUP BY b.id, b.name, b.slug, b.country ORDER BY b.id`);
      return rows.map((row) => ({ ...row, id: Number(row.id), carCount: Number(row.carCount) }));
    },
    async listLocations() {
      assertOpen();
      const [rows] = await pool.execute(`SELECT loc.id, loc.province, loc.city, loc.slug, COUNT(l.id) AS carCount
        FROM locations loc LEFT JOIN vehicle_listings l ON l.location_id = loc.id
        GROUP BY loc.id, loc.province, loc.city, loc.slug ORDER BY loc.id`);
      return rows.map((row) => ({ ...row, id: Number(row.id), carCount: Number(row.carCount) }));
    },
    async listBusinessAreas(options = {}) {
      assertOpen();
      const page = positiveInteger(options.page, 1, 100_000);
      const pageSize = positiveInteger(options.pageSize, 20, MAX_PAGE_SIZE);
      const q = String(options.q ?? "").trim();
      const parentId = String(options.parentId ?? "").trim();
      const conditions = [];
      const parameters = [];
      if (q) { conditions.push("(a.area_id LIKE ? OR a.area_name LIKE ?)"); parameters.push(`%${q}%`, `%${q}%`); }
      if (parentId) { conditions.push("a.parent_area_id = ?"); parameters.push(parentId); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [countResult, listResult] = await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total FROM business_areas a ${where}`, parameters),
        pool.execute(`SELECT a.area_id, a.area_name, a.parent_area_id, p.area_name AS parent_area_name,
          a.registered_at, e.emp_no, e.emp_name, e.dept_name, e.position_name, e.is_active,
          COUNT(l.id) AS car_count
          FROM business_areas a LEFT JOIN business_areas p ON p.area_id = a.parent_area_id
          INNER JOIN employees e ON e.emp_no = a.manager_emp_no
          LEFT JOIN vehicle_listings l ON l.business_area_id = a.area_id
          ${where}
          GROUP BY a.area_id, a.area_name, a.parent_area_id, p.area_name, a.registered_at,
            e.emp_no, e.emp_name, e.dept_name, e.position_name, e.is_active
          ORDER BY a.area_id LIMIT ? OFFSET ?`, [...parameters, pageSize, (page - 1) * pageSize]),
      ]);
      return {
        total: Number(countResult[0][0].total),
        items: listResult[0].map((row) => ({
          id: row.area_id,
          name: row.area_name,
          parent: row.parent_area_id ? { id: row.parent_area_id, name: row.parent_area_name } : null,
          manager: {
            code: dealerCode(row.emp_no, normalizedDealerSecret),
            displayName: maskName(row.emp_name),
          },
          carCount: Number(row.car_count),
          registeredAt: String(row.registered_at).slice(0, 10),
        })),
      };
    },
    async listCars(options = {}) {
      assertOpen();
      const query = normalizeListOptions(options);
      const datasetLimit = normalizeDatasetLimit(options.datasetLimit);
      const conditions = [];
      const parameters = [];
      if (datasetLimit !== null) {
        conditions.push(`l.id IN (
          SELECT public_vehicle_listing.id
          FROM (SELECT id FROM vehicle_listings ORDER BY id DESC LIMIT ${datasetLimit}) AS public_vehicle_listing
        )`);
      }
      const fullText = toFullTextQuery(query.q);
      if (fullText) { conditions.push("MATCH(l.title, l.description) AGAINST (? IN BOOLEAN MODE)"); parameters.push(fullText); }
      else if (query.q) conditions.push("0 = 1");
      if (query.brand) {
        if (/^[1-9]\d*$/.test(query.brand)) { conditions.push("b.id = ?"); parameters.push(Number(query.brand)); }
        else { conditions.push("b.slug = ?"); parameters.push(query.brand); }
      }
      if (query.fuel) { conditions.push("l.fuel_type = ?"); parameters.push(query.fuel); }
      if (query.status) { conditions.push("l.status = ?"); parameters.push(query.status); }
      if (query.location) {
        if (/^[1-9]\d*$/.test(query.location)) { conditions.push("loc.id = ?"); parameters.push(Number(query.location)); }
        else { conditions.push("loc.slug = ?"); parameters.push(query.location); }
      }
      if (query.minPrice !== null) { conditions.push("l.price >= ?"); parameters.push(query.minPrice); }
      if (query.maxPrice !== null) { conditions.push("l.price <= ?"); parameters.push(query.maxPrice); }
      if (query.minYear !== null) { conditions.push("l.model_year >= ?"); parameters.push(query.minYear); }
      if (query.maxYear !== null) { conditions.push("l.model_year <= ?"); parameters.push(query.maxYear); }
      if (query.maxMileage !== null) { conditions.push("l.mileage_km <= ?"); parameters.push(query.maxMileage); }
      if (query.accidentFree !== null) { conditions.push(query.accidentFree ? "l.accident_count = 0" : "l.accident_count > 0"); }
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const [countResult, listResult] = await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total FROM vehicle_listings l
          INNER JOIN vehicle_models m ON m.id = l.model_id INNER JOIN vehicle_brands b ON b.id = m.brand_id
          INNER JOIN locations loc ON loc.id = l.location_id${where}`, parameters),
        pool.execute(`${CAR_SELECT}${where} ORDER BY ${SORT_SQL[query.sort]} LIMIT ? OFFSET ?`, [
          ...parameters, query.pageSize, (query.page - 1) * query.pageSize,
        ]),
      ]);
      return { total: Number(countResult[0][0].total), items: listResult[0].map((row) => mapMysqlCar(row, normalizedDealerSecret)) };
    },
    async getCarWatermark() {
      assertOpen();
      const [rows] = await pool.execute("SELECT COALESCE(MAX(id), 0) AS watermark FROM vehicle_listings");
      return Number(rows[0].watermark);
    },
    async listCarsAfterId({ afterId = 0, untilId = Number.MAX_SAFE_INTEGER, limit = DEFAULT_CURSOR_LIMIT } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterId);
      const normalizedUntil = nonNegativeInteger(untilId, Number.MAX_SAFE_INTEGER);
      const normalizedLimit = positiveInteger(limit, DEFAULT_CURSOR_LIMIT, MAX_CURSOR_LIMIT);
      const [rows] = await pool.query(
        `${CAR_SELECT} WHERE l.id > ? AND l.id <= ? ORDER BY l.id LIMIT ?`,
        [normalizedAfter, normalizedUntil, normalizedLimit + 1],
      );
      const hasMore = rows.length > normalizedLimit;
      return { items: (hasMore ? rows.slice(0, normalizedLimit) : rows).map((row) => mapMysqlCar(row, normalizedDealerSecret)), hasMore };
    },
    async getChangeWatermark() {
      assertOpen();
      const [rows] = await pool.execute(`SELECT COALESCE(MAX(change_event.seq), 0) AS watermark
        FROM listing_change_log change_event
        INNER JOIN generation_runs gr ON gr.id = change_event.run_id
        WHERE gr.status = 'SUCCESS'`);
      return Number(rows[0].watermark);
    },
    async listChangesAfterSeq({ afterSeq = 0, untilSeq = Number.MAX_SAFE_INTEGER, limit = DEFAULT_CURSOR_LIMIT } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterSeq);
      const normalizedUntil = nonNegativeInteger(untilSeq, Number.MAX_SAFE_INTEGER);
      const normalizedLimit = positiveInteger(limit, DEFAULT_CURSOR_LIMIT, MAX_CURSOR_LIMIT);
      const [rows] = await pool.query(`SELECT c.seq, c.event_id, c.run_id, r.run_key, c.operation,
        c.listing_id, c.listing_number, c.entity_version, c.occurred_at, c.payload_json, c.source_checksum
        FROM listing_change_log c INNER JOIN generation_runs r ON r.id = c.run_id
        WHERE r.status = 'SUCCESS' AND c.seq > ? AND c.seq <= ? ORDER BY c.seq LIMIT ?`, [normalizedAfter, normalizedUntil, normalizedLimit + 1]);
      const hasMore = rows.length > normalizedLimit;
      return { items: (hasMore ? rows.slice(0, normalizedLimit) : rows).map(mapMysqlChange), hasMore };
    },
    async getGenerationRunWatermark() {
      assertOpen();
      const [rows] = await pool.execute("SELECT COALESCE(MAX(event_id), 0) AS watermark FROM generation_run_events");
      return Number(rows[0].watermark);
    },
    async listGenerationRunsAfterId({ afterId = 0, untilId = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
      assertOpen();
      const normalizedAfter = nonNegativeInteger(afterId);
      const normalizedUntil = nonNegativeInteger(untilId, Number.MAX_SAFE_INTEGER);
      const normalizedLimit = positiveInteger(limit, 100, 100);
      const [rows] = await pool.query(`SELECT
        gre.event_id,
        gre.run_id,
        gr.run_key,
        gre.status,
        gr.requested_count,
        gr.sequence_start,
        gr.sequence_end,
        gre.mysql_count,
        gre.mongo_count,
        gre.error_message,
        gr.started_at,
        gre.finished_at,
        gre.occurred_at
        FROM generation_run_events gre
        INNER JOIN generation_runs gr ON gr.id = gre.run_id
        WHERE gre.event_id > ? AND gre.event_id <= ?
        ORDER BY gre.event_id LIMIT ?`, [normalizedAfter, normalizedUntil, normalizedLimit + 1]);
      const hasMore = rows.length > normalizedLimit;
      return { items: (hasMore ? rows.slice(0, normalizedLimit) : rows).map(mapMysqlGenerationRunEvent), hasMore };
    },
    async getCar(id, options = {}) {
      assertOpen();
      const normalized = Number(id);
      if (!Number.isSafeInteger(normalized) || normalized <= 0) return null;
      const datasetLimit = normalizeDatasetLimit(options.datasetLimit);
      const publicBoundary = datasetLimit === null ? "" : ` AND l.id IN (
        SELECT public_vehicle_listing.id
        FROM (SELECT id FROM vehicle_listings ORDER BY id DESC LIMIT ${datasetLimit}) AS public_vehicle_listing
      )`;
      const [rows] = await pool.execute(`${CAR_SELECT} WHERE l.id = ?${publicBoundary} LIMIT 1`, [normalized]);
      return rows.length ? mapMysqlCar(rows[0], normalizedDealerSecret) : null;
    },
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}

export function mysqlConnectionOptions(env = process.env) {
  const common = {
    waitForConnections: true,
    connectionLimit: positiveInteger(env.DB_CONNECTION_LIMIT, 10, 100),
    maxIdle: positiveInteger(env.DB_MAX_IDLE, 10, 100),
    idleTimeout: positiveInteger(env.DB_IDLE_TIMEOUT_MS, 60_000),
    queueLimit: positiveInteger(env.DB_QUEUE_LIMIT, 200, 10_000),
    connectTimeout: positiveInteger(env.DB_CONNECT_TIMEOUT_MS, 5_000),
    enableKeepAlive: true,
    timezone: "Z",
    dateStrings: true,
  };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql://.");
    return { ...common, host: url.hostname, port: positiveInteger(Number(url.port), 3306, 65_535), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) };
  }
  return { ...common, host: env.DB_HOST || "127.0.0.1", port: positiveInteger(Number(env.DB_PORT), 3306, 65_535), user: env.DB_USER || "crawler", password: env.DB_PASSWORD ?? "crawler", database: env.DB_NAME || "crawl_lab" };
}

async function connectMysqlRepository(env, dealerPublicIdSecret) {
  const mysql = await import("mysql2/promise");
  const createPool = mysql.createPool ?? mysql.default?.createPool;
  const pool = createPool(mysqlConnectionOptions(env));
  try { await pool.execute("SELECT 1 AS ok"); return createMysqlRepository(pool, dealerPublicIdSecret); }
  catch (error) { await pool.end().catch(() => {}); throw error; }
}

async function memoryOptionsFromEnv(env, logger, dealerPublicIdSecret) {
  const options = {
    count: positiveInteger(Number(env.MEMORY_CAR_COUNT), DEFAULT_MEMORY_CAR_COUNT),
    dealerPublicIdSecret,
  };
  try {
    const { loadCsvSources } = await import("./csv-data.mjs");
    const csv = await loadCsvSources({ env, strict: false });
    if (csv?.employees?.length && csv?.businessAreas?.length) {
      options.employees = csv.employees;
      options.businessAreas = csv.businessAreas;
      logger.info?.(`CSV 연계: 직원 ${csv.employees.length.toLocaleString("ko-KR")}건, 업무영역 ${csv.businessAreas.length.toLocaleString("ko-KR")}건`);
    }
  } catch (error) {
    logger.warn?.(`CSV를 읽지 못해 내장 관계 데이터로 시작합니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  return options;
}

export async function createRepositoryFromEnv(env = process.env, { logger = console } = {}) {
  const dealerPublicIdSecret = normalizeDealerPublicIdSecret(env.DEALER_PUBLIC_ID_SECRET);
  const configured = env.DATA_SOURCE ?? (env.DATABASE_URL ? "mysql" : "memory");
  const mode = String(configured).trim().toLowerCase();
  if (mode === "mysql") {
    try { return await connectMysqlRepository(env, dealerPublicIdSecret); }
    catch (error) { throw new Error(`MySQL 저장소에 연결하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  if (mode === "memory") return createMemoryRepository(await memoryOptionsFromEnv(env, logger, dealerPublicIdSecret));
  if (mode === "auto") {
    try { return await connectMysqlRepository(env, dealerPublicIdSecret); }
    catch (error) {
      logger.warn?.(`DATA_SOURCE=auto: MySQL 연결 실패로 메모리 모드를 사용합니다: ${error instanceof Error ? error.message : String(error)}`);
      return createMemoryRepository(await memoryOptionsFromEnv(env, logger, dealerPublicIdSecret));
    }
  }
  throw new Error(`Unsupported DATA_SOURCE "${configured}". Use memory, mysql, or auto.`);
}
