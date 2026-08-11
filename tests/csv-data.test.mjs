import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { test } from "node:test";

import { loadCsvSources, parseCsv, resolveCsvPaths } from "../server/csv-data.mjs";
import { createSampleCars } from "../server/sample-data.mjs";

test("CSV parser handles BOM, commas, quotes and embedded newlines", () => {
  const parsed = parseCsv('\ufeffID,NOTE\r\n1,"comma, value"\r\n2,"line 1\nline 2"\r\n3,"say ""hi"""\r\n');
  assert.deepEqual(parsed.headers, ["ID", "NOTE"]);
  assert.deepEqual(parsed.rows, [
    { ID: "1", NOTE: "comma, value" },
    { ID: "2", NOTE: "line 1\nline 2" },
    { ID: "3", NOTE: 'say "hi"' },
  ]);
});

test("configured classroom CSVs pass full relationship validation", async (context) => {
  try { loadEnvFile(".env"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const paths = resolveCsvPaths({ env: process.env });
  try {
    await Promise.all(Object.values(paths).map((filePath) => access(filePath)));
  } catch {
    context.skip("The external classroom CSV files are not configured in this environment.");
    return;
  }

  const csv = await loadCsvSources({ env: process.env, strict: true });
  assert.equal(csv.validation.valid, true);
  assert.equal(csv.employees.length, 3_000);
  assert.equal(csv.businessAreas.length, 50_000);
  assert.equal(csv.parentAreas.length, 1_000);
  assert.equal(csv.joinReady.length, 50_000);
  assert.equal(csv.validation.relationships.areaManagerToEmployee.matchPercent, 100);
  assert.equal(csv.validation.relationships.areaParentToArea.matchPercent, 100);
  assert.equal(csv.validation.issues.length, 0);
});

test("used-car generation is deterministic and keeps private employee numbers internal", () => {
  const first = createSampleCars(20);
  const second = createSampleCars(20);
  assert.deepEqual(first, second);
  assert.ok(first.every((car) => /^UC-\d{8}$/.test(car.listingNo)));
  assert.ok(first.every((car) => ["AVAILABLE", "RESERVED", "SOLD"].includes(car.status)));
  assert.ok(first.every((car) => car.dealer.employeeNo && car.dealer.displayName.startsWith("인증딜러")));
  assert.ok(first.every((car) => car.location.province && car.businessArea.id));
});
