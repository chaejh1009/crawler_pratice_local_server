import { createHash, createHmac } from "node:crypto";

import { mysqlConnectionOptions } from "./repository.mjs";
import { createCarSeedContext, createSampleCar } from "./sample-data.mjs";

export const DEFAULT_GENERATION_COUNT = 1_000;
export const DEFAULT_GENERATION_BATCH_SIZE = 500;
export const MAX_GENERATION_COUNT = 100_000;

export const GENERATOR_LOCK_NAME = "autodata-generator-v1";
const DEFAULT_LOCK_TIMEOUT_SECONDS = 5;
const MAX_BATCH_SIZE = 1_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const RUN_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function integerInRange(value, fallback, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) return fallback;
  return number;
}

function requireInteger(value, name, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} 값은 ${minimum} 이상 ${maximum} 이하의 정수여야 합니다.`);
  }
  return number;
}

function safeIntegerFromDatabase(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} 값이 JavaScript 안전 정수 범위를 벗어났습니다.`);
  }
  return number;
}

function normalizeRunKey(value) {
  const runKey = String(value ?? "").trim();
  if (!RUN_KEY_PATTERN.test(runKey)) {
    throw new TypeError("runKey는 영문자 또는 숫자로 시작하는 120자 이하의 안전한 ASCII 식별자여야 합니다.");
  }
  return runKey;
}

function dateToIso(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("유효하지 않은 날짜입니다.");
    return value.toISOString();
  }

  const text = String(value ?? "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new TypeError("유효하지 않은 날짜입니다.");
  return date.toISOString();
}

function sqlDateTime(value) {
  return dateToIso(value).replace("T", " ").replace(/Z$/, "").slice(0, 23);
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
  const digest = createHmac("sha256", normalizeDealerPublicIdSecret(secret))
    .update(`autodata-public-dealer-v1\0${String(employeeNo ?? "")}`, "utf8")
    .digest("hex");
  return `DLR-${digest.slice(0, 10)}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function eventIdFor(datasetEpoch, runKey, sequence) {
  return sha256(`autodata-generator-v1\0${datasetEpoch}\0${runKey}\0${sequence}`);
}

function secretsFromEnv(env) {
  const explicitNames = new Set([
    "DATABASE_URL",
    "DB_PASSWORD",
    "MONGO_URI",
    "MONGODB_URI",
    "MONGO_URL",
    "MONGO_PASSWORD",
    "UCAR_API_KEY",
    "UCAR_API_KEYS",
    "API_KEY",
    "API_KEYS",
  ]);

  return Object.entries(env ?? {})
    .filter(([name, value]) => (
      explicitNames.has(name)
      || /(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)$/i.test(name)
    ) && value !== undefined && value !== null && String(value).length >= 4)
    .map(([, value]) => String(value))
    .sort((left, right) => right.length - left.length);
}

export function safeErrorMessage(error, env = process.env) {
  let message = error instanceof Error ? error.message : String(error ?? "알 수 없는 오류");
  for (const secret of secretsFromEnv(env)) message = message.split(secret).join("[REDACTED]");
  message = message
    .replace(/(?:mongodb(?:\+srv)?|mysql):\/\/[^\s]+/gi, "[REDACTED_DB_URI]")
    .replace(/ucar_v1_[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/((?:password|passwd|pwd|token|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[REDACTED_ENDPOINT]")
    .replace(/(getaddrinfo\s+\S+\s+)[A-Za-z0-9.-]+/gi, "$1[REDACTED_HOST]")
    .replace(/((?:ECONNREFUSED|ECONNRESET|ETIMEDOUT)\s+)[A-Za-z0-9.-]+(?::\d+)?/gi, "$1[REDACTED_ENDPOINT]")
    .replace(/[\r\n\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (message || "알 수 없는 오류").slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export function toPublicListingDocument(car, employeeByNo, dealerPublicIdSecret) {
  const employee = employeeByNo.get(car.dealer.employeeNo);
  if (!employee) throw new Error("차량 담당 직원 관계를 공개 문서로 변환하지 못했습니다.");

  return {
    id: Number(car.id),
    listingNumber: car.listingNo,
    title: car.title,
    description: car.description,
    brand: {
      id: Number(car.manufacturer.id),
      name: car.manufacturer.name,
      slug: car.manufacturer.slug,
      country: car.manufacturer.country,
    },
    model: {
      id: Number(car.model.id),
      name: car.model.name,
      slug: car.model.slug,
      bodyType: car.model.bodyType,
    },
    trim: car.grade,
    modelYear: Number(car.modelYear),
    firstRegistration: car.firstRegistrationDate,
    mileageKm: Number(car.mileageKm),
    fuelType: car.fuelName,
    transmission: car.transmissionName,
    price: Number(car.price),
    currency: car.currency,
    color: car.color,
    displacementCc: Number(car.displacementCc),
    accidentCount: Number(car.accidentCount),
    ownerChangeCount: Number(car.ownerChangeCount),
    inspectionStatus: car.inspectionStatus,
    status: car.status,
    location: {
      id: Number(car.location.id),
      province: car.location.province,
      city: car.location.city,
      slug: car.location.slug,
    },
    dealer: {
      code: dealerCode(car.dealer.employeeNo, dealerPublicIdSecret),
      displayName: maskName(employee.name),
      department: employee.departmentName,
      position: employee.positionName,
    },
    businessArea: {
      id: car.businessArea.id,
      name: car.businessArea.name,
      parent: car.businessArea.parentAreaId
        ? { id: car.businessArea.parentAreaId, name: car.businessArea.parentAreaName }
        : null,
    },
    createdAt: dateToIso(car.registeredAt),
    updatedAt: dateToIso(car.updatedAt),
  };
}

async function createMysqlRuntime(env) {
  const mysql = await import("mysql2/promise");
  const createPool = mysql.createPool ?? mysql.default?.createPool;
  if (typeof createPool !== "function") throw new Error("MySQL 드라이버를 초기화하지 못했습니다.");

  const pool = createPool(mysqlConnectionOptions(env));
  try {
    return { pool, connection: await pool.getConnection() };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

export async function listRecoverableGenerationRuns({
  env = process.env,
  limit = 10,
  staleRunningSeconds = env.GENERATOR_STALE_RUN_SECONDS,
} = {}) {
  const normalizedLimit = integerInRange(limit, 10, { maximum: 100 });
  const normalizedStaleSeconds = integerInRange(staleRunningSeconds, 300, { maximum: 86_400 });
  const mysqlRuntime = await createMysqlRuntime(env);
  try {
    const [rows] = await mysqlRuntime.connection.query(
      `SELECT run_key AS runKey, requested_count AS requestedCount, status
       FROM generation_runs
       WHERE status IN ('PARTIAL_FAILED', 'FAILED')
          OR (status = 'RUNNING' AND started_at <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3)))
       ORDER BY sequence_start, id
       LIMIT ?`,
      [normalizedStaleSeconds, normalizedLimit],
    );
    return rows.map((row) => ({
      runKey: String(row.runKey),
      requestedCount: safeIntegerFromDatabase(row.requestedCount, "generation_runs.requested_count"),
      status: String(row.status),
    }));
  } finally {
    mysqlRuntime.connection.release();
    await mysqlRuntime.pool.end().catch(() => {});
  }
}

function mongoOptions(env) {
  return {
    serverSelectionTimeoutMS: integerInRange(env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 5_000, { maximum: 120_000 }),
    connectTimeoutMS: integerInRange(env.MONGO_CONNECT_TIMEOUT_MS, 5_000, { maximum: 120_000 }),
    socketTimeoutMS: integerInRange(env.MONGO_SOCKET_TIMEOUT_MS, 30_000, { maximum: 10 * 60_000 }),
    maxPoolSize: integerInRange(env.MONGO_MAX_POOL_SIZE, 10, { maximum: 100 }),
    writeConcern: { w: "majority" },
  };
}

function mongoConfiguration(env) {
  const databaseName = String(env.MONGO_DB_NAME || env.MONGO_DATABASE || env.DB_NAME || "crawl_lab").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(databaseName)) {
    throw new TypeError("MongoDB 데이터베이스 이름이 올바르지 않습니다.");
  }

  const configuredUri = env.MONGO_URI || env.MONGODB_URI || env.MONGO_URL;
  if (configuredUri) return { uri: String(configuredUri), databaseName };

  const host = String(env.MONGO_HOST || "127.0.0.1");
  const port = integerInRange(env.MONGO_PORT, 27_017, { maximum: 65_535 });
  const username = String(env.MONGO_USER || "");
  const password = String(env.MONGO_PASSWORD || "");
  const authentication = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";
  const authSource = String(env.MONGO_AUTH_SOURCE || (username ? "admin" : databaseName));
  const query = username ? `?authSource=${encodeURIComponent(authSource)}` : "";
  return {
    uri: `mongodb://${authentication}${host}:${port}/${encodeURIComponent(databaseName)}${query}`,
    databaseName,
  };
}

async function createMongoRuntime(env) {
  let mongodb;
  try {
    mongodb = await import("mongodb");
  } catch {
    const error = new Error("MongoDB 드라이버를 불러오지 못했습니다. mongodb 패키지를 설치하세요.");
    error.code = "MONGO_DRIVER_UNAVAILABLE";
    throw error;
  }
  const MongoClient = mongodb.MongoClient ?? mongodb.default?.MongoClient;
  if (typeof MongoClient !== "function") throw new Error("MongoDB 드라이버를 초기화하지 못했습니다.");

  const { uri, databaseName } = mongoConfiguration(env);
  const client = new MongoClient(uri, mongoOptions(env));
  try {
    await client.connect();
    return { client, database: client.db(databaseName) };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

export async function resetGeneratedMongoData({ env = process.env, datasetEpoch } = {}) {
  const normalizedEpoch = String(datasetEpoch ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedEpoch)) {
    throw new TypeError("MongoDB reset에는 유효한 datasetEpoch UUID가 필요합니다.");
  }
  const mongoRuntime = await createMongoRuntime(env);
  try {
    const stateCollection = mongoRuntime.database.collection("dataset_state");
    await stateCollection.replaceOne(
      { _id: "generator-dataset" },
      {
        _id: "generator-dataset",
        datasetEpoch: normalizedEpoch,
        status: "RESETTING",
        updatedAt: new Date().toISOString(),
      },
      { upsert: true },
    );
    const collectionNames = [
      "generation_run_events",
      "generation_runs",
      "listing_change_log",
      "vehicle_listings",
    ];
    const deletedCounts = {};
    for (const collectionName of collectionNames) {
      const result = await mongoRuntime.database.collection(collectionName).deleteMany({});
      deletedCounts[collectionName] = Number(result.deletedCount ?? 0);
    }
    await stateCollection.replaceOne(
      { _id: "generator-dataset" },
      {
        _id: "generator-dataset",
        datasetEpoch: normalizedEpoch,
        status: "READY",
        updatedAt: new Date().toISOString(),
      },
      { upsert: true },
    );
    return {
      databaseName: mongoRuntime.database.databaseName,
      datasetEpoch: normalizedEpoch,
      deletedCounts,
    };
  } finally {
    await mongoRuntime.client.close().catch(() => {});
  }
}

async function acquireGeneratorLock(connection, timeoutSeconds) {
  const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS acquired", [
    GENERATOR_LOCK_NAME,
    timeoutSeconds,
  ]);
  if (Number(rows[0]?.acquired) !== 1) {
    const error = new Error("다른 데이터 생성 작업이 이미 실행 중입니다.");
    error.code = "GENERATOR_BUSY";
    throw error;
  }
}

async function releaseGeneratorLock(connection) {
  await connection.execute("SELECT RELEASE_LOCK(?) AS released", [GENERATOR_LOCK_NAME]);
}

function mapRunRow(row) {
  return {
    id: safeIntegerFromDatabase(row.id, "generation_runs.id"),
    runKey: String(row.runKey),
    status: String(row.status),
    requestedCount: safeIntegerFromDatabase(row.requestedCount, "generation_runs.requested_count"),
    sequenceStart: safeIntegerFromDatabase(row.sequenceStart, "generation_runs.sequence_start"),
    sequenceEnd: safeIntegerFromDatabase(row.sequenceEnd, "generation_runs.sequence_end"),
    mysqlCount: safeIntegerFromDatabase(row.mysqlCount, "generation_runs.mysql_count"),
    mongoCount: safeIntegerFromDatabase(row.mongoCount, "generation_runs.mongo_count"),
    errorMessage: row.errorMessage === null ? null : String(row.errorMessage),
    startedAt: dateToIso(row.startedAt),
    finishedAt: row.finishedAt === null ? null : dateToIso(row.finishedAt),
  };
}

function runTransitionSnapshot(run, {
  status = run.status,
  mysqlCount = run.mysqlCount,
  mongoCount = run.mongoCount,
  errorMessage = run.errorMessage ?? null,
  occurredAt = new Date().toISOString(),
  finishedAt = null,
} = {}) {
  return {
    runId: run.id,
    runKey: run.runKey,
    status,
    requestedCount: run.requestedCount,
    sequenceStart: run.sequenceStart,
    sequenceEnd: run.sequenceEnd,
    mysqlCount,
    mongoCount,
    errorMessage,
    startedAt: run.startedAt,
    finishedAt,
    occurredAt: dateToIso(occurredAt),
  };
}

async function appendGenerationRunEvent(connection, snapshot) {
  const [result] = await connection.execute(
    `INSERT INTO generation_run_events (
       run_id, status, mysql_count, mongo_count, error_message, occurred_at, finished_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.runId,
      snapshot.status,
      snapshot.mysqlCount,
      snapshot.mongoCount,
      snapshot.errorMessage,
      sqlDateTime(snapshot.occurredAt),
      snapshot.finishedAt ? sqlDateTime(snapshot.finishedAt) : null,
    ],
  );
  const eventId = safeIntegerFromDatabase(result.insertId, "generation_run_events.event_id");
  return { ...snapshot, id: eventId, eventId };
}

async function findRun(connection, runKey) {
  const [rows] = await connection.execute(
    `SELECT
       id,
       run_key AS runKey,
       status,
       requested_count AS requestedCount,
       sequence_start AS sequenceStart,
       sequence_end AS sequenceEnd,
       mysql_count AS mysqlCount,
       mongo_count AS mongoCount,
       error_message AS errorMessage,
       started_at AS startedAt,
       finished_at AS finishedAt
     FROM generation_runs
     WHERE run_key = ?
     LIMIT 1`,
    [runKey],
  );
  return rows.length ? mapRunRow(rows[0]) : null;
}

async function prepareRun(connection, { runKey, count, now, requireExistingRun = false }) {
  const existing = await findRun(connection, runKey);
  if (existing) {
    if (existing.requestedCount !== count) {
      throw new Error(
        `같은 runKey가 이미 ${existing.requestedCount}건으로 예약되어 있어 ${count}건으로 다시 실행할 수 없습니다.`,
      );
    }
    if (existing.status === "SUCCESS") return { ...existing, skipped: true };

    const [earliestIncompleteRows] = await connection.query(
      `SELECT run_key AS runKey, status
       FROM generation_runs
       WHERE status <> 'SUCCESS'
       ORDER BY sequence_start, id
       LIMIT 1`,
    );
    if (String(earliestIncompleteRows[0]?.runKey ?? "") !== existing.runKey) {
      const error = new Error(
        `더 이른 미완료 run ${String(earliestIncompleteRows[0]?.runKey)}을 먼저 복구해야 합니다.`,
      );
      error.code = "GENERATOR_RECONCILIATION_ORDER_REQUIRED";
      throw error;
    }

    const resumedRun = { ...existing, status: "RUNNING", errorMessage: null, finishedAt: null, skipped: false };
    await connection.beginTransaction();
    try {
      await connection.execute(
        `UPDATE generation_runs
         SET status = 'RUNNING', error_message = NULL, finished_at = NULL
         WHERE id = ?`,
        [existing.id],
      );
      await appendGenerationRunEvent(connection, runTransitionSnapshot(resumedRun, {
        status: "RUNNING",
        mysqlCount: existing.mysqlCount,
        mongoCount: existing.mongoCount,
        occurredAt: now,
      }));
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    }
    return resumedRun;
  }

  if (requireExistingRun) {
    const error = new Error("복구하려던 run이 더 이상 존재하지 않습니다. 재시드 또는 다른 복구 작업 뒤의 오래된 요청입니다.");
    error.code = "RECOVERY_RUN_NOT_FOUND";
    throw error;
  }

  const [incompleteRows] = await connection.query(
    `SELECT run_key AS runKey, status
     FROM generation_runs
     WHERE status <> 'SUCCESS'
     ORDER BY id
     LIMIT 1`,
  );
  if (incompleteRows.length) {
    const error = new Error(
      `미완료 run ${String(incompleteRows[0].runKey)}(${String(incompleteRows[0].status)})을 먼저 복구해야 새 run을 만들 수 있습니다.`,
    );
    error.code = "GENERATOR_RECONCILIATION_REQUIRED";
    throw error;
  }

  const [rows] = await connection.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(id) FROM vehicle_listings), 0),
       COALESCE((SELECT MAX(sequence_end) FROM generation_runs), 0)
     ) AS maximumSequence`,
  );
  const maximumSequence = safeIntegerFromDatabase(rows[0]?.maximumSequence ?? 0, "maximum sequence");
  const sequenceStart = maximumSequence + 1;
  const sequenceEnd = sequenceStart + count - 1;
  if (!Number.isSafeInteger(sequenceEnd)) {
    throw new Error("생성할 차량 ID가 JavaScript 안전 정수 범위를 벗어났습니다.");
  }

  const startedAt = dateToIso(now);
  await connection.beginTransaction();
  try {
    const [result] = await connection.execute(
      `INSERT INTO generation_runs (
         run_key, status, requested_count, sequence_start, sequence_end,
         mysql_count, mongo_count, error_message, started_at, finished_at
       ) VALUES (?, 'RUNNING', ?, ?, ?, 0, 0, NULL, ?, NULL)`,
      [runKey, count, sequenceStart, sequenceEnd, sqlDateTime(startedAt)],
    );
    const run = {
      id: safeIntegerFromDatabase(result.insertId, "generation_runs.id"),
      runKey,
      status: "RUNNING",
      requestedCount: count,
      sequenceStart,
      sequenceEnd,
      mysqlCount: 0,
      mongoCount: 0,
      errorMessage: null,
      startedAt,
      finishedAt: null,
      skipped: false,
    };
    await appendGenerationRunEvent(connection, runTransitionSnapshot(run, {
      status: "RUNNING",
      occurredAt: startedAt,
    }));
    await connection.commit();
    return run;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

async function loadSeedContext(connection, dealerPublicIdSecret) {
  const [employeeRows, areaRows, datasetRows] = await Promise.all([
    connection.query(
      `SELECT
         emp_no AS employeeNo,
         emp_name AS name,
         dept_name AS departmentName,
         position_name AS positionName,
         hire_date AS hiredAt,
         is_active AS active
       FROM employees
       ORDER BY emp_no`,
    ),
    connection.query(
      `SELECT
         area.area_id AS id,
         area.area_name AS name,
         area.parent_area_id AS parentAreaId,
         parent.area_name AS parentAreaName,
         area.manager_emp_no AS managerEmployeeNo,
         area.registered_at AS registeredAt
       FROM business_areas area
       LEFT JOIN business_areas parent ON parent.area_id = area.parent_area_id
       ORDER BY area.area_id`,
    ),
    connection.query(
      "SELECT dataset_epoch AS datasetEpoch FROM dataset_state WHERE id = 1 AND status = 'READY' LIMIT 1",
    ),
  ]);

  const employees = employeeRows[0];
  const businessAreas = areaRows[0];
  if (employees.length === 0 || businessAreas.length === 0) {
    throw new Error("먼저 MySQL에 직원·업무영역 기준 데이터를 seed해야 합니다.");
  }
  const datasetEpoch = String(datasetRows[0][0]?.datasetEpoch ?? "");
  if (!datasetEpoch) throw new Error("dataset_state가 없습니다. db:seed를 다시 실행하세요.");
  return {
    seedContext: createCarSeedContext({ employees, businessAreas }),
    employeeByNo: new Map(employees.map((employee) => [String(employee.employeeNo), employee])),
    dealerPublicIdSecret,
    datasetEpoch,
  };
}

async function loadDatasetEpoch(connection) {
  const [rows] = await connection.query(
    "SELECT dataset_epoch AS datasetEpoch FROM dataset_state WHERE id = 1 AND status = 'READY' LIMIT 1",
  );
  const datasetEpoch = String(rows[0]?.datasetEpoch ?? "");
  if (!datasetEpoch) throw new Error("dataset_state가 없습니다. db:seed를 다시 실행하세요.");
  return datasetEpoch;
}

function generatedRecord(sequence, run, runtimeContext) {
  const generatedAt = run.startedAt;
  const baseCar = createSampleCar(sequence - 1, runtimeContext.seedContext);
  const car = { ...baseCar, registeredAt: generatedAt, updatedAt: generatedAt };
  const publicDocument = toPublicListingDocument(
    car,
    runtimeContext.employeeByNo,
    runtimeContext.dealerPublicIdSecret,
  );
  const payloadJson = JSON.stringify(publicDocument);
  return {
    car,
    publicDocument,
    payloadJson,
    eventId: eventIdFor(runtimeContext.datasetEpoch, run.runKey, sequence),
    sourceChecksum: sha256(payloadJson),
  };
}

function vehicleValues(record) {
  const { car } = record;
  return [
    car.id,
    car.listingNo,
    car.model.id,
    car.location.id,
    car.dealer.employeeNo,
    car.businessArea.id,
    car.title,
    car.grade,
    car.modelYear,
    car.firstRegistrationDate,
    car.mileageKm,
    car.fuelName,
    car.transmissionName,
    car.price,
    car.currency,
    car.color,
    car.displacementCc,
    car.accidentCount,
    car.ownerChangeCount,
    car.inspectionStatus,
    car.status,
    car.description,
    sqlDateTime(car.registeredAt),
    sqlDateTime(car.updatedAt),
  ];
}

function placeholders(rowCount, columnCount) {
  const row = `(${Array.from({ length: columnCount }, () => "?").join(", ")})`;
  return Array.from({ length: rowCount }, () => row).join(", ");
}

async function insertImmutableVehicleListings(connection, records) {
  if (records.length === 0) return;
  const [existingRows] = await connection.query(
    `SELECT id, listing_number
     FROM vehicle_listings
     WHERE id IN (${records.map(() => "?").join(", ")})
        OR listing_number IN (${records.map(() => "?").join(", ")})`,
    [
      ...records.map((record) => record.car.id),
      ...records.map((record) => record.car.listingNo),
    ],
  );
  const recordById = new Map(records.map((record) => [Number(record.car.id), record]));
  const recordByListingNumber = new Map(records.map((record) => [record.car.listingNo, record]));
  for (const row of existingRows) {
    const id = safeIntegerFromDatabase(row.id, "vehicle_listings.id");
    const listingNumber = String(row.listing_number);
    const expectedById = recordById.get(id);
    const expectedByNumber = recordByListingNumber.get(listingNumber);
    if (!expectedById || !expectedByNumber || expectedById !== expectedByNumber) {
      const error = new Error("예약한 차량 ID 또는 listingNumber가 다른 행에 이미 사용 중입니다.");
      error.code = "IMMUTABLE_LISTING_IDENTITY_CONFLICT";
      throw error;
    }
  }

  const existingIds = new Set(existingRows.map((row) => safeIntegerFromDatabase(row.id, "vehicle_listings.id")));
  const missingRecords = records.filter((record) => !existingIds.has(Number(record.car.id)));
  if (missingRecords.length === 0) return;
  const columns = [
    "id", "listing_number", "model_id", "location_id", "dealer_emp_no", "business_area_id",
    "title", "trim_name", "model_year", "first_registration", "mileage_km", "fuel_type",
    "transmission", "price", "currency", "color", "displacement_cc", "accident_count",
    "owner_change_count", "inspection_status", "status", "description", "created_at", "updated_at",
  ];
  await connection.execute(
    `INSERT INTO vehicle_listings (${columns.join(", ")})
     VALUES ${placeholders(missingRecords.length, columns.length)}`,
    missingRecords.flatMap(vehicleValues),
  );
}

async function insertImmutableChangeEvents(connection, run, records) {
  if (records.length === 0) return;
  const [existingRows] = await connection.query(
    `SELECT event_id, run_id, operation, listing_id, listing_number,
            entity_version, occurred_at, source_checksum
     FROM listing_change_log
     WHERE event_id IN (${records.map(() => "?").join(", ")})`,
    records.map((record) => record.eventId),
  );
  const recordByEventId = new Map(records.map((record) => [record.eventId, record]));
  for (const row of existingRows) {
    const expected = recordByEventId.get(String(row.event_id));
    const matches = expected
      && safeIntegerFromDatabase(row.run_id, "listing_change_log.run_id") === run.id
      && String(row.operation) === "UPSERT"
      && safeIntegerFromDatabase(row.listing_id, "listing_change_log.listing_id") === Number(expected.car.id)
      && String(row.listing_number) === expected.car.listingNo
      && safeIntegerFromDatabase(row.entity_version, "listing_change_log.entity_version") === 1
      && sqlDateTime(row.occurred_at) === sqlDateTime(run.startedAt)
      && String(row.source_checksum) === expected.sourceChecksum;
    if (!matches) {
      const error = new Error("기존 변경 이벤트가 같은 eventId의 불변 payload와 일치하지 않습니다.");
      error.code = "IMMUTABLE_EVENT_CONFLICT";
      throw error;
    }
  }

  const existingEventIds = new Set(existingRows.map((row) => String(row.event_id)));
  const missingRecords = records.filter((record) => !existingEventIds.has(record.eventId));
  if (missingRecords.length === 0) return;
  const columns = [
    "event_id", "run_id", "operation", "listing_id", "listing_number",
    "entity_version", "occurred_at", "payload_json", "source_checksum",
  ];
  const values = missingRecords.flatMap((record) => [
    record.eventId,
    run.id,
    "UPSERT",
    record.car.id,
    record.car.listingNo,
    1,
    sqlDateTime(run.startedAt),
    record.payloadJson,
    record.sourceChecksum,
  ]);
  await connection.execute(
    `INSERT INTO listing_change_log (${columns.join(", ")})
     VALUES ${placeholders(missingRecords.length, columns.length)}`,
    values,
  );
}

async function writeMysqlData(connection, run, runtimeContext, batchSize) {
  await connection.beginTransaction();
  try {
    for (let start = run.sequenceStart; start <= run.sequenceEnd; start += batchSize) {
      const end = Math.min(run.sequenceEnd, start + batchSize - 1);
      const records = [];
      for (let sequence = start; sequence <= end; sequence += 1) {
        records.push(generatedRecord(sequence, run, runtimeContext));
      }
      await insertImmutableVehicleListings(connection, records);
      await insertImmutableChangeEvents(connection, run, records);
    }
    const [rows] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM vehicle_listings WHERE id BETWEEN ? AND ?) AS vehicleCount,
         (SELECT COUNT(*) FROM listing_change_log WHERE run_id = ?) AS eventCount`,
      [run.sequenceStart, run.sequenceEnd, run.id],
    );
    const vehicleCount = safeIntegerFromDatabase(rows[0]?.vehicleCount, "vehicle count");
    const eventCount = safeIntegerFromDatabase(rows[0]?.eventCount, "event count");
    if (vehicleCount !== run.requestedCount || eventCount !== run.requestedCount) {
      throw new Error(
        `MySQL 적재 검증에 실패했습니다. 차량 ${vehicleCount}건, 이벤트 ${eventCount}건을 확인했습니다.`,
      );
    }
    await connection.execute(
      `UPDATE generation_runs
       SET status = 'RUNNING', mysql_count = ?, error_message = NULL, finished_at = NULL
       WHERE id = ?`,
      [run.requestedCount, run.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
  return run.requestedCount;
}

function parseJsonDocument(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MySQL 변경 이벤트의 공개 payload 형식이 올바르지 않습니다.");
  }
  return parsed;
}

function eventDocument(row, payload, run) {
  return {
    seq: safeIntegerFromDatabase(row.seq, "listing_change_log.seq"),
    eventId: String(row.eventId),
    runId: safeIntegerFromDatabase(row.runId, "listing_change_log.run_id"),
    runKey: run.runKey,
    operation: String(row.operation),
    listingId: safeIntegerFromDatabase(row.listingId, "listing_change_log.listing_id"),
    listingNumber: String(row.listingNumber),
    entityVersion: safeIntegerFromDatabase(row.entityVersion, "listing_change_log.entity_version"),
    occurredAt: dateToIso(row.occurredAt),
    payload,
    sourceChecksum: String(row.sourceChecksum),
  };
}

async function ensureMongoIndexes(database) {
  await Promise.all([
    database.collection("vehicle_listings").createIndex({ listingNumber: 1 }, { unique: true, name: "uq_listing_number" }),
    database.collection("listing_change_log").createIndex({ eventId: 1 }, { unique: true, name: "uq_event_id" }),
    database.collection("listing_change_log").createIndex({ seq: 1 }, { unique: true, name: "uq_event_seq" }),
    database.collection("listing_change_log").createIndex(
      { listingNumber: 1, entityVersion: 1 },
      { unique: true, name: "uq_listing_version" },
    ),
    database.collection("generation_runs").createIndex({ runKey: 1 }, { unique: true, name: "uq_run_key" }),
    database.collection("generation_run_events").createIndex({ eventId: 1 }, { unique: true, name: "uq_run_event_id" }),
  ]);
}

async function assertMongoDatasetReady(database, datasetEpoch) {
  const state = await database.collection("dataset_state").findOne(
    { _id: "generator-dataset" },
    { projection: { _id: 0, datasetEpoch: 1, status: 1 } },
  );
  if (state?.status !== "READY" || String(state?.datasetEpoch ?? "") !== String(datasetEpoch)) {
    const error = new Error("MySQL과 MongoDB의 dataset epoch가 일치하지 않거나 MongoDB reset이 완료되지 않았습니다.");
    error.code = "DATASET_EPOCH_MISMATCH";
    throw error;
  }
}

function generationRunEventDocument(row) {
  const eventId = safeIntegerFromDatabase(row.eventId, "generation_run_events.event_id");
  return {
    id: eventId,
    eventId,
    runId: safeIntegerFromDatabase(row.runId, "generation_run_events.run_id"),
    runKey: String(row.runKey),
    status: String(row.status),
    requestedCount: safeIntegerFromDatabase(row.requestedCount, "generation_runs.requested_count"),
    sequenceStart: safeIntegerFromDatabase(row.sequenceStart, "generation_runs.sequence_start"),
    sequenceEnd: safeIntegerFromDatabase(row.sequenceEnd, "generation_runs.sequence_end"),
    mysqlCount: safeIntegerFromDatabase(row.mysqlCount, "generation_run_events.mysql_count"),
    mongoCount: safeIntegerFromDatabase(row.mongoCount, "generation_run_events.mongo_count"),
    errorMessage: row.errorMessage === null ? null : String(row.errorMessage),
    startedAt: dateToIso(row.startedAt),
    finishedAt: row.finishedAt === null ? null : dateToIso(row.finishedAt),
    occurredAt: dateToIso(row.occurredAt),
  };
}

async function mirrorGenerationRunEvents(connection, database, batchSize = 500) {
  const collection = database.collection("generation_run_events");
  const runCollection = database.collection("generation_runs");
  const [mongoEventIds, [sourceEventRows]] = await Promise.all([
    collection.distinct("eventId"),
    connection.query("SELECT event_id AS eventId FROM generation_run_events ORDER BY event_id"),
  ]);
  const mirroredEventIds = new Set(
    mongoEventIds.map((eventId) => safeIntegerFromDatabase(eventId, "MongoDB generation_run_events.eventId")),
  );
  const sourceEventIds = sourceEventRows.map(
    (row) => safeIntegerFromDatabase(row.eventId, "generation_run_events.event_id"),
  );
  const sourceEventIdSet = new Set(sourceEventIds);
  const unexpectedMongoEventId = [...mirroredEventIds].find((eventId) => !sourceEventIdSet.has(eventId));
  if (unexpectedMongoEventId !== undefined) {
    const error = new Error("MongoDB 실행 상태 이벤트에 현재 dataset에 없는 eventId가 있습니다.");
    error.code = "MONGO_RUN_EVENT_DIVERGENCE";
    throw error;
  }
  const firstMissingEventId = sourceEventIds.find((eventId) => !mirroredEventIds.has(eventId));
  let afterEventId = firstMissingEventId === undefined
    ? (sourceEventIds.at(-1) ?? 0)
    : firstMissingEventId - 1;

  while (true) {
    const [rows] = await connection.query(
      `SELECT
         gre.event_id AS eventId,
         gre.run_id AS runId,
         gr.run_key AS runKey,
         gre.status,
         gr.requested_count AS requestedCount,
         gr.sequence_start AS sequenceStart,
         gr.sequence_end AS sequenceEnd,
         gre.mysql_count AS mysqlCount,
         gre.mongo_count AS mongoCount,
         gre.error_message AS errorMessage,
         gr.started_at AS startedAt,
         gre.finished_at AS finishedAt,
         gre.occurred_at AS occurredAt
       FROM generation_run_events gre
       INNER JOIN generation_runs gr ON gr.id = gre.run_id
       WHERE gre.event_id > ?
       ORDER BY gre.event_id
       LIMIT ?`,
      [afterEventId, batchSize],
    );
    if (rows.length === 0) return afterEventId;
    const documents = rows.map(generationRunEventDocument);
    await runCollection.bulkWrite(
      documents.map((document) => ({
        replaceOne: {
          filter: { runKey: document.runKey },
          replacement: {
            id: document.runId,
            runKey: document.runKey,
            status: document.status,
            requestedCount: document.requestedCount,
            sequenceStart: document.sequenceStart,
            sequenceEnd: document.sequenceEnd,
            mysqlCount: document.mysqlCount,
            mongoCount: document.mongoCount,
            errorMessage: document.errorMessage,
            startedAt: document.startedAt,
            finishedAt: document.finishedAt,
            latestEventId: document.eventId,
          },
          upsert: true,
        },
      })),
      // Projection first: eventId becomes the resume checkpoint only after both writes succeed.
      { ordered: true },
    );
    await collection.bulkWrite(
      documents.map((document) => ({
        replaceOne: {
          filter: { eventId: document.eventId },
          replacement: document,
          upsert: true,
        },
      })),
      // Ordered writes keep the maximum mirrored ID a safe resume checkpoint.
      { ordered: true },
    );
    afterEventId = documents.at(-1).eventId;
    if (rows.length < batchSize) return afterEventId;
  }
}

async function readEventRows(connection, run, start, end) {
  const [rows] = await connection.execute(
    `SELECT
       seq,
       event_id AS eventId,
       run_id AS runId,
       operation,
       listing_id AS listingId,
       listing_number AS listingNumber,
       entity_version AS entityVersion,
       occurred_at AS occurredAt,
       payload_json AS payloadJson,
       source_checksum AS sourceChecksum
     FROM listing_change_log
     WHERE run_id = ? AND listing_id BETWEEN ? AND ?
     ORDER BY listing_id`,
    [run.id, start, end],
  );
  const expected = end - start + 1;
  if (rows.length !== expected) {
    throw new Error(`MongoDB 적재에 필요한 MySQL 이벤트가 ${expected}건 중 ${rows.length}건만 조회되었습니다.`);
  }
  return rows;
}

async function writeMongoData(connection, database, run, batchSize, onProgress = () => {}) {
  await ensureMongoIndexes(database);
  const listingCollection = database.collection("vehicle_listings");
  const eventCollection = database.collection("listing_change_log");

  for (let start = run.sequenceStart; start <= run.sequenceEnd; start += batchSize) {
    const end = Math.min(run.sequenceEnd, start + batchSize - 1);
    const rows = await readEventRows(connection, run, start, end);
    const records = rows.map((row) => {
      const payload = parseJsonDocument(row.payloadJson);
      return { payload, event: eventDocument(row, payload, run) };
    });

    const listingWrite = await listingCollection.bulkWrite(
      records.map(({ payload }) => ({
        replaceOne: {
          filter: { listingNumber: payload.listingNumber },
          replacement: payload,
          upsert: true,
        },
      })),
      { ordered: false },
    );
    const eventWrite = await eventCollection.bulkWrite(
      records.map(({ event }) => ({
        replaceOne: {
          filter: { eventId: event.eventId },
          replacement: event,
          upsert: true,
        },
      })),
      { ordered: false },
    );
    if (!listingWrite.isOk() || !eventWrite.isOk()) {
      throw new Error("MongoDB bulkWrite 결과가 성공 상태가 아닙니다.");
    }

    const eventIds = records.map(({ event }) => event.eventId);
    const listingNumbers = records.map(({ payload }) => payload.listingNumber);
    const [storedEvents, storedListingCount] = await Promise.all([
      eventCollection.find(
        { eventId: { $in: eventIds } },
        { projection: { _id: 0, eventId: 1, runKey: 1, sourceChecksum: 1 } },
      ).toArray(),
      listingCollection.countDocuments({ listingNumber: { $in: listingNumbers } }),
    ]);
    const checksumByEventId = new Map(
      storedEvents.map((event) => [String(event.eventId), {
        runKey: String(event.runKey ?? ""),
        sourceChecksum: String(event.sourceChecksum ?? ""),
      }]),
    );
    const mongoEventsMatch = records.every(({ event }) => {
      const stored = checksumByEventId.get(event.eventId);
      return stored?.runKey === run.runKey && stored?.sourceChecksum === event.sourceChecksum;
    });
    if (storedEvents.length !== records.length || storedListingCount !== records.length || !mongoEventsMatch) {
      throw new Error(
        `MongoDB 적재 검증에 실패했습니다. 차량 ${storedListingCount}건, 이벤트 ${storedEvents.length}건을 확인했습니다.`,
      );
    }
    onProgress(end - run.sequenceStart + 1);
  }
  return run.requestedCount;
}

function mongoRunDocument(run, { status, mysqlCount, mongoCount, errorMessage = null, finishedAt = null }) {
  return {
    id: run.id,
    runKey: run.runKey,
    status,
    requestedCount: run.requestedCount,
    sequenceStart: run.sequenceStart,
    sequenceEnd: run.sequenceEnd,
    mysqlCount,
    mongoCount,
    errorMessage,
    startedAt: run.startedAt,
    finishedAt,
  };
}

async function upsertMongoRun(database, document) {
  await database.collection("generation_runs").bulkWrite([
    {
      replaceOne: {
        filter: { runKey: document.runKey },
        replacement: document,
        upsert: true,
      },
    },
  ]);
}

async function updateMysqlFailure(connection, run, { status, mysqlCount, mongoCount, errorMessage }) {
  const finishedAt = new Date().toISOString();
  await connection.beginTransaction();
  try {
    const [result] = await connection.execute(
      `UPDATE generation_runs
       SET status = ?, mysql_count = ?, mongo_count = ?, error_message = ?, finished_at = ?
       WHERE id = ? AND status <> 'SUCCESS'`,
      [status, mysqlCount, mongoCount, errorMessage, sqlDateTime(finishedAt), run.id],
    );
    if (Number(result.affectedRows) === 0) {
      await connection.commit();
      return null;
    }
    const event = await appendGenerationRunEvent(connection, runTransitionSnapshot(run, {
      status,
      mysqlCount,
      mongoCount,
      errorMessage,
      occurredAt: finishedAt,
      finishedAt,
    }));
    await connection.commit();
    return event;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

async function completeMysqlRun(connection, run, { mysqlCount, mongoCount, finishedAt }) {
  await connection.beginTransaction();
  try {
    await connection.execute(
      `UPDATE generation_runs
       SET status = 'SUCCESS', mysql_count = ?, mongo_count = ?, error_message = NULL, finished_at = ?
       WHERE id = ?`,
      [mysqlCount, mongoCount, sqlDateTime(finishedAt), run.id],
    );
    const event = await appendGenerationRunEvent(connection, runTransitionSnapshot(run, {
      status: "SUCCESS",
      mysqlCount,
      mongoCount,
      errorMessage: null,
      occurredAt: finishedAt,
      finishedAt,
    }));
    await connection.commit();
    return event;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

export async function generateDataBatch({
  env = process.env,
  count = DEFAULT_GENERATION_COUNT,
  runKey,
  batchSize,
  mysqlBatchSize = batchSize ?? env.GENERATOR_MYSQL_BATCH_SIZE,
  mongoBatchSize = batchSize ?? env.GENERATOR_MONGO_BATCH_SIZE,
  lockTimeoutSeconds = env.GENERATOR_LOCK_TIMEOUT_SECONDS,
  requireExistingRun = false,
  now = new Date(),
  logger = console,
} = {}) {
  const normalizedCount = requireInteger(count, "count", { maximum: MAX_GENERATION_COUNT });
  const normalizedRunKey = normalizeRunKey(runKey);
  const dealerPublicIdSecret = normalizeDealerPublicIdSecret(env.DEALER_PUBLIC_ID_SECRET);
  const normalizedMysqlBatchSize = integerInRange(mysqlBatchSize, DEFAULT_GENERATION_BATCH_SIZE, { maximum: MAX_BATCH_SIZE });
  const normalizedMongoBatchSize = integerInRange(mongoBatchSize, DEFAULT_GENERATION_BATCH_SIZE, { maximum: MAX_BATCH_SIZE });
  const normalizedLockTimeout = integerInRange(lockTimeoutSeconds, DEFAULT_LOCK_TIMEOUT_SECONDS, {
    minimum: 0,
    maximum: 300,
  });

  const mysqlRuntime = await createMysqlRuntime(env);
  let mongoRuntime = null;
  let lockAcquired = false;
  let run = null;
  let phase = "mysql";
  let mysqlCount = 0;
  let mongoCount = 0;
  let datasetEpoch = null;
  let mongoDatasetReady = false;

  try {
    await acquireGeneratorLock(mysqlRuntime.connection, normalizedLockTimeout);
    lockAcquired = true;
    datasetEpoch = await loadDatasetEpoch(mysqlRuntime.connection);
    run = await prepareRun(mysqlRuntime.connection, {
      runKey: normalizedRunKey,
      count: normalizedCount,
      now,
      requireExistingRun,
    });
    mysqlCount = run.mysqlCount;
    mongoCount = run.mongoCount;
    if (run.skipped) {
      phase = "mongo";
      mongoRuntime = await createMongoRuntime(env);
      await assertMongoDatasetReady(mongoRuntime.database, datasetEpoch);
      mongoDatasetReady = true;
      mongoCount = await writeMongoData(
        mysqlRuntime.connection,
        mongoRuntime.database,
        run,
        normalizedMongoBatchSize,
      );
      const completedRun = mongoRunDocument(run, {
        status: "SUCCESS",
        mysqlCount: run.mysqlCount,
        mongoCount,
        finishedAt: run.finishedAt,
      });
      await upsertMongoRun(mongoRuntime.database, completedRun);
      await mirrorGenerationRunEvents(
        mysqlRuntime.connection,
        mongoRuntime.database,
        normalizedMongoBatchSize,
      );
      return { ...run, mongoCount, skipped: true, reconciled: true };
    }

    const runtimeContext = await loadSeedContext(mysqlRuntime.connection, dealerPublicIdSecret);
    if (runtimeContext.datasetEpoch !== datasetEpoch) {
      throw new Error("generator lock 안에서 dataset epoch가 변경되었습니다.");
    }
    mysqlCount = await writeMysqlData(
      mysqlRuntime.connection,
      run,
      runtimeContext,
      normalizedMysqlBatchSize,
    );

    phase = "mongo";
    mongoRuntime = await createMongoRuntime(env);
    await assertMongoDatasetReady(mongoRuntime.database, datasetEpoch);
    mongoDatasetReady = true;
    mongoCount = await writeMongoData(
      mysqlRuntime.connection,
      mongoRuntime.database,
      run,
      normalizedMongoBatchSize,
      (completedCount) => { mongoCount = completedCount; },
    );

    const finishedAt = new Date().toISOString();
    const completedRun = mongoRunDocument(run, {
      status: "SUCCESS",
      mysqlCount,
      mongoCount,
      finishedAt,
    });
    phase = "finalize";
    await completeMysqlRun(mysqlRuntime.connection, run, { mysqlCount, mongoCount, finishedAt });

    // Vehicle and listing-event mirrors are already durable.  Keep the MySQL
    // status-event ledger authoritative if this metadata mirror is temporarily
    // unavailable; the next successful generator pass resumes by eventId.
    try {
      await upsertMongoRun(mongoRuntime.database, completedRun);
      await mirrorGenerationRunEvents(
        mysqlRuntime.connection,
        mongoRuntime.database,
        normalizedMongoBatchSize,
      );
    } catch (error) {
      logger.warn?.(`MongoDB 실행 상태 이벤트 미러 경고: ${safeErrorMessage(error, env)}`);
    }
    return { ...completedRun, skipped: false };
  } catch (error) {
    const errorMessage = safeErrorMessage(error, env);
    if (run && !run.skipped) {
      const status = phase === "mysql" ? "FAILED" : "PARTIAL_FAILED";
      let failureEvent = null;
      try {
        failureEvent = await updateMysqlFailure(mysqlRuntime.connection, run, {
          status,
          mysqlCount,
          mongoCount,
          errorMessage,
        });
      } catch (ledgerError) {
        logger.error?.(`MySQL 실패 상태 기록 경고: ${safeErrorMessage(ledgerError, env)}`);
      }
      if (failureEvent && mongoRuntime?.database && phase !== "mysql" && mongoDatasetReady) {
        const partialRun = mongoRunDocument(run, {
          status,
          mysqlCount,
          mongoCount,
          errorMessage,
          finishedAt: new Date().toISOString(),
        });
        try {
          await upsertMongoRun(mongoRuntime.database, partialRun);
          await mirrorGenerationRunEvents(
            mysqlRuntime.connection,
            mongoRuntime.database,
            normalizedMongoBatchSize,
          );
        } catch (mirrorError) {
          logger.warn?.(`MongoDB 실패 상태 이벤트 미러 경고: ${safeErrorMessage(mirrorError, env)}`);
        }
      }
    }
    throw error;
  } finally {
    if (mongoRuntime) {
      await mongoRuntime.client.close().catch((error) => {
        logger.warn?.(`MongoDB 연결 종료 경고: ${safeErrorMessage(error, env)}`);
      });
    }
    if (lockAcquired) {
      await releaseGeneratorLock(mysqlRuntime.connection).catch((error) => {
        logger.warn?.(`MySQL 생성 잠금 해제 경고: ${safeErrorMessage(error, env)}`);
      });
    }
    mysqlRuntime.connection.release();
    await mysqlRuntime.pool.end().catch((error) => {
      logger.warn?.(`MySQL 연결 종료 경고: ${safeErrorMessage(error, env)}`);
    });
  }
}

export const generateData = generateDataBatch;
