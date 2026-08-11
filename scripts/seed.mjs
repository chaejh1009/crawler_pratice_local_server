import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { loadCsvSources } from "../server/csv-data.mjs";
import {
  SAMPLE_CAR_MODELS,
  SAMPLE_LOCATIONS,
  SAMPLE_MANUFACTURERS,
  createCarSeedContext,
  createFallbackBusinessAreas,
  createFallbackEmployees,
  createSampleCar,
} from "../server/sample-data.mjs";
import {
  GENERATOR_LOCK_NAME,
  resetGeneratedMongoData,
  safeErrorMessage,
} from "../server/data-generator.mjs";

const DEFAULT_SEED_COUNT = 100_000;
const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 2_000;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function sqlDateTime(value) {
  return String(value ?? "").trim().replace("T", " ").replace(/Z$/, "").slice(0, 23);
}

function readArgument(name) {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readBooleanArgument(name) {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : "true";
}

function connectionOptions(env) {
  const common = { timezone: "Z", multipleStatements: true, dateStrings: true };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql://.");
    return {
      ...common,
      host: url.hostname,
      port: positiveInteger(Number(url.port), 3306, 65_535),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
  }
  return {
    ...common,
    host: env.DB_HOST || "127.0.0.1",
    port: positiveInteger(Number(env.DB_PORT), 3306, 65_535),
    user: env.DB_USER || "crawler",
    password: env.DB_PASSWORD ?? "crawler",
    database: env.DB_NAME || "crawl_lab",
  };
}

async function insertRows(connection, table, columns, rows) {
  if (rows.length === 0) return;
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;
  const placeholders = rows.map(() => rowPlaceholder).join(", ");
  await connection.execute(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
    rows.flat(),
  );
}

async function insertInBatches(connection, table, columns, rows, batchSize, onProgress, stage) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    await connection.beginTransaction();
    try {
      await insertRows(connection, table, columns, batch);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    onProgress({ stage, inserted: start + batch.length, total: rows.length });
  }
}

function fallbackCsvData() {
  const employees = createFallbackEmployees();
  const businessAreas = createFallbackBusinessAreas(3_000, employees);
  const employeeByNo = new Map(employees.map((employee) => [employee.employeeNo, employee]));
  const areaById = new Map(businessAreas.map((area) => [area.id, area]));
  const parentAreas = businessAreas.filter((area) => !area.parentAreaId).map((area) => ({
    id: area.id,
    name: area.name,
    level: "TOP_LEVEL",
    registeredAt: area.registeredAt,
  }));
  const joinReady = businessAreas.map((area) => {
    const manager = employeeByNo.get(area.managerEmployeeNo);
    const parent = area.parentAreaId ? areaById.get(area.parentAreaId) : null;
    return {
      id: area.id,
      name: area.name,
      parentAreaId: area.parentAreaId,
      parentAreaName: parent?.name ?? null,
      managerEmployeeNo: area.managerEmployeeNo,
      managerName: manager?.name ?? "교육용 직원",
      managerDepartmentName: manager?.departmentName ?? "영업팀",
      managerPositionName: manager?.positionName ?? "담당자",
      registeredAt: area.registeredAt,
    };
  });
  return { available: true, employees, businessAreas, parentAreas, joinReady, validation: { valid: true, issues: [] } };
}

async function loadBusinessData(env, { requireCsv }) {
  return loadCsvSources({
    env,
    strict: requireCsv,
    fallback: () => fallbackCsvData(),
  });
}

export async function seedDatabase({
  env = process.env,
  count = DEFAULT_SEED_COUNT,
  batchSize = DEFAULT_BATCH_SIZE,
  requireCsv = booleanValue(env.CSV_REQUIRED, false),
  resetMongo = booleanValue(env.SEED_RESET_MONGO, true),
  onProgress = () => {},
} = {}) {
  if (!resetMongo) {
    throw new Error(
      "이중 저장소 seed는 MySQL cursor와 MongoDB mirror를 함께 초기화해야 합니다. --reset-mongo=true를 사용하세요.",
    );
  }
  const carCount = positiveInteger(count, DEFAULT_SEED_COUNT);
  const normalizedBatchSize = positiveInteger(batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const csv = await loadBusinessData(env, { requireCsv });
  if (!csv.available || !csv.validation?.valid) {
    throw new Error("직원·업무영역 CSV 관계 검증을 통과하지 못했습니다.");
  }

  const mysql = await import("mysql2/promise");
  const createConnection = mysql.createConnection ?? mysql.default?.createConnection;
  const connection = await createConnection(connectionOptions(env));
  const schemaSql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  const datasetEpoch = randomUUID();
  let generatorLockAcquired = false;

  try {
    const lockTimeoutSeconds = positiveInteger(env.SEED_LOCK_TIMEOUT_SECONDS, 5, 300);
    const [lockRows] = await connection.execute("SELECT GET_LOCK(?, ?) AS acquired", [
      GENERATOR_LOCK_NAME,
      lockTimeoutSeconds,
    ]);
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error("데이터 생성기가 실행 중이어서 seed를 시작할 수 없습니다. 생성기를 중지한 뒤 다시 시도하세요.");
    }
    generatorLockAcquired = true;
    await connection.query(schemaSql);
    const [datasetStatusColumns] = await connection.query(
      "SHOW COLUMNS FROM dataset_state LIKE 'status'",
    );
    if (datasetStatusColumns.length === 0) {
      await connection.query(
        "ALTER TABLE dataset_state ADD COLUMN status ENUM('RESETTING', 'READY') NOT NULL DEFAULT 'RESETTING' AFTER dataset_epoch",
      );
    }
    await connection.execute(
      `INSERT INTO dataset_state (id, dataset_epoch, status, seeded_at)
       VALUES (1, ?, 'RESETTING', UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         dataset_epoch = VALUES(dataset_epoch),
         status = 'RESETTING',
         seeded_at = VALUES(seeded_at)`,
      [datasetEpoch],
    );
    // api_keys is intentionally excluded so classroom credentials survive a reseed.
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      // Remove tables from the former generic-product classroom domain.
      for (const legacyTable of ["products", "sellers", "categories"]) {
        await connection.query(`DROP TABLE IF EXISTS ${legacyTable}`);
      }
      for (const table of [
        "listing_change_log",
        "generation_run_events",
        "generation_runs",
        "vehicle_listings",
        "vehicle_models",
        "vehicle_brands",
        "locations",
        "business_area_join_ready",
        "business_area_parent_lookup",
        "business_areas",
        "employees",
      ]) {
        await connection.query(`TRUNCATE TABLE ${table}`);
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    await insertInBatches(
      connection,
      "employees",
      ["emp_no", "emp_name", "dept_name", "position_name", "hire_date", "is_active"],
      csv.employees.map((employee) => [
        employee.employeeNo,
        employee.name,
        employee.departmentName,
        employee.positionName,
        String(employee.hiredAt).slice(0, 10),
        employee.active ? 1 : 0,
      ]),
      normalizedBatchSize,
      onProgress,
      "employees",
    );

    const sortedAreas = [...csv.businessAreas].sort((left, right) => (
      Number(Boolean(left.parentAreaId)) - Number(Boolean(right.parentAreaId))
      || left.id.localeCompare(right.id)
    ));
    await insertInBatches(
      connection,
      "business_areas",
      ["area_id", "area_name", "parent_area_id", "manager_emp_no", "registered_at"],
      sortedAreas.map((area) => [area.id, area.name, area.parentAreaId, area.managerEmployeeNo, sqlDateTime(area.registeredAt)]),
      normalizedBatchSize,
      onProgress,
      "business_areas",
    );
    await insertInBatches(
      connection,
      "business_area_parent_lookup",
      ["area_id", "area_name", "area_level", "registered_at"],
      csv.parentAreas.map((area) => [area.id, area.name, area.level, sqlDateTime(area.registeredAt)]),
      normalizedBatchSize,
      onProgress,
      "parent_lookup",
    );
    await insertInBatches(
      connection,
      "business_area_join_ready",
      ["area_id", "area_name", "parent_area_id", "parent_area_name", "manager_emp_no", "manager_emp_name", "manager_dept_name", "manager_position_name", "registered_at"],
      csv.joinReady.map((area) => [
        area.id,
        area.name,
        area.parentAreaId,
        area.parentAreaName,
        area.managerEmployeeNo,
        area.managerName,
        area.managerDepartmentName,
        area.managerPositionName,
        sqlDateTime(area.registeredAt),
      ]),
      normalizedBatchSize,
      onProgress,
      "join_ready",
    );

    await connection.beginTransaction();
    try {
      await insertRows(connection, "vehicle_brands", ["id", "name", "slug", "country"], SAMPLE_MANUFACTURERS.map((brand) => [brand.id, brand.name, brand.slug, brand.country]));
      await insertRows(connection, "vehicle_models", ["id", "brand_id", "name", "slug", "body_type"], SAMPLE_CAR_MODELS.map((model) => [model.id, model.manufacturerId, model.name, model.slug, model.bodyType]));
      await insertRows(connection, "locations", ["id", "province", "city", "slug"], SAMPLE_LOCATIONS.map((location) => [location.id, location.province, location.city, location.slug]));
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const seedContext = createCarSeedContext({ employees: csv.employees, businessAreas: csv.businessAreas });
    for (let start = 0; start < carCount; start += normalizedBatchSize) {
      const end = Math.min(start + normalizedBatchSize, carCount);
      const rows = [];
      for (let index = start; index < end; index += 1) {
        const car = createSampleCar(index, seedContext);
        rows.push([
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
          new Date(car.registeredAt),
          new Date(car.updatedAt),
        ]);
      }
      await connection.beginTransaction();
      try {
        await insertRows(connection, "vehicle_listings", [
          "id", "listing_number", "model_id", "location_id", "dealer_emp_no", "business_area_id",
          "title", "trim_name", "model_year", "first_registration", "mileage_km", "fuel_type",
          "transmission", "price", "currency", "color", "displacement_cc", "accident_count",
          "owner_change_count", "inspection_status", "status", "description", "created_at", "updated_at",
        ], rows);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
      onProgress({ stage: "vehicle_listings", inserted: end, total: carCount });
    }

    const mongoReset = resetMongo
      ? await resetGeneratedMongoData({ env, datasetEpoch })
      : null;
    if (mongoReset) onProgress({ stage: "mongo_generated_collections", inserted: 4, total: 4 });
    const [readyResult] = await connection.execute(
      `UPDATE dataset_state
       SET status = 'READY', seeded_at = UTC_TIMESTAMP(3)
       WHERE id = 1 AND dataset_epoch = ? AND status = 'RESETTING'`,
      [datasetEpoch],
    );
    if (Number(readyResult.affectedRows) !== 1) {
      throw new Error("seed 완료 상태를 현재 dataset epoch에 기록하지 못했습니다.");
    }

    return {
      csvSource: csv.source,
      validation: csv.validation,
      employees: csv.employees.length,
      businessAreas: csv.businessAreas.length,
      parentAreas: csv.parentAreas.length,
      joinReady: csv.joinReady.length,
      brands: SAMPLE_MANUFACTURERS.length,
      models: SAMPLE_CAR_MODELS.length,
      locations: SAMPLE_LOCATIONS.length,
      cars: carCount,
      datasetEpoch,
      mongoReset,
    };
  } finally {
    if (generatorLockAcquired) {
      await connection.execute("SELECT RELEASE_LOCK(?) AS released", [GENERATOR_LOCK_NAME]).catch(() => {});
    }
    await connection.end();
  }
}

async function main() {
  try { loadEnvFile(".env"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const count = positiveInteger(readArgument("count") ?? process.env.SEED_COUNT, DEFAULT_SEED_COUNT);
  const batchSize = positiveInteger(readArgument("batch-size") ?? process.env.SEED_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const requireCsv = booleanValue(readArgument("require-csv") ?? process.env.CSV_REQUIRED, false);
  const resetMongo = booleanValue(
    readBooleanArgument("reset-mongo") ?? process.env.SEED_RESET_MONGO,
    true,
  );
  const lastReported = new Map();
  console.log(
    `중고차 ${count.toLocaleString("ko-KR")}건과 CSV 관계 데이터를 MySQL에 적재합니다${resetMongo ? ", 생성기용 MongoDB 컬렉션도 초기화합니다" : ""}.`,
  );
  const result = await seedDatabase({
    count,
    batchSize,
    requireCsv,
    resetMongo,
    onProgress({ stage, inserted, total }) {
      const previous = lastReported.get(stage) ?? 0;
      if (inserted === total || inserted - previous >= 10_000) {
        lastReported.set(stage, inserted);
        console.log(`  ${stage}: ${inserted.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")}`);
      }
    },
  });
  console.log(`적재 완료: 직원 ${result.employees.toLocaleString("ko-KR")}, 업무영역 ${result.businessAreas.toLocaleString("ko-KR")}, 차량 ${result.cars.toLocaleString("ko-KR")}건 (${result.csvSource}).`);
  console.log(`데이터셋 epoch: ${result.datasetEpoch}`);
  if (result.mongoReset) {
    const deleted = Object.values(result.mongoReset.deletedCounts).reduce((sum, countValue) => sum + countValue, 0);
    console.log(`MongoDB 생성 데이터 초기화 완료: ${deleted.toLocaleString("ko-KR")}건 삭제.`);
  }
  if (!resetMongo) {
    console.warn("주의: MongoDB 생성 컬렉션은 유지했습니다. 기존 mirror가 있다면 다음에는 --reset-mongo=true를 사용하세요.");
  }
  console.log("api_keys 테이블은 보존되었습니다.");
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`시드 실패: ${safeErrorMessage(error, process.env)}`);
    process.exitCode = 1;
  });
}
