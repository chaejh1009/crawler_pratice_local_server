import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const CSV_SOURCE_FILES = Object.freeze({
  employees: "biz_employee_master.csv",
  businessAreas: "biz_meta_area_50000.csv",
  joinReady: "biz_meta_area_join_ready.csv",
  parentAreas: "biz_meta_area_parent_lookup.csv",
});

const REQUIRED_HEADERS = Object.freeze({
  employees: Object.freeze([
    "EMP_NO", "EMP_NM", "DEPT_NM", "POSITION_NM", "HIRE_DT", "ACTIVE_YN",
  ]),
  businessAreas: Object.freeze([
    "AREA_ID", "AREA_NM", "PARENT_AREA_ID", "MANAGER_EMP_NO", "REG_DT",
  ]),
  joinReady: Object.freeze([
    "AREA_ID", "AREA_NM", "PARENT_AREA_ID", "PARENT_AREA_NM",
    "MANAGER_EMP_NO", "MANAGER_EMP_NM", "MANAGER_DEPT_NM",
    "MANAGER_POSITION_NM", "REG_DT",
  ]),
  parentAreas: Object.freeze([
    "AREA_ID", "AREA_NM", "AREA_LEVEL", "REG_DT",
  ]),
});

const PATH_ENV_NAMES = Object.freeze({
  employees: Object.freeze([
    "CSV_EMPLOYEE_PATH", "EMPLOYEE_CSV_PATH", "CSV_EMPLOYEE_MASTER_PATH", "BIZ_EMPLOYEE_CSV_PATH",
  ]),
  businessAreas: Object.freeze([
    "CSV_BUSINESS_AREA_PATH", "AREA_CSV_PATH", "CSV_META_AREA_PATH", "BIZ_META_AREA_CSV_PATH",
  ]),
  joinReady: Object.freeze([
    "CSV_JOIN_READY_PATH", "AREA_JOIN_READY_CSV_PATH", "CSV_META_AREA_JOIN_READY_PATH", "BIZ_META_AREA_JOIN_READY_CSV_PATH",
  ]),
  parentAreas: Object.freeze([
    "CSV_PARENT_AREA_PATH", "AREA_PARENT_LOOKUP_CSV_PATH", "CSV_META_AREA_PARENT_LOOKUP_PATH", "BIZ_META_AREA_PARENT_CSV_PATH",
  ]),
});

const EXPLICIT_PATH_ALIASES = Object.freeze({
  employees: Object.freeze(["employees", "employee", "employeeMaster"]),
  businessAreas: Object.freeze(["businessAreas", "businessArea", "areas", "area"]),
  joinReady: Object.freeze(["joinReady", "joinedAreas", "areaJoinReady"]),
  parentAreas: Object.freeze(["parentAreas", "parentArea", "areaParents", "parentLookup"]),
});

function stringValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function nullableString(value) {
  const normalized = stringValue(value);
  return normalized || null;
}

function percent(numerator, denominator) {
  return denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(6));
}

function firstValue(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

function normalizePath(value, baseDirectory = process.cwd()) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const candidate = String(value).trim();
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(baseDirectory, candidate);
}

/**
 * Resolve the four source files from explicit paths first, individual environment
 * variables second, and CSV_DATA_DIR/BIZ_DATA_DIR last.
 */
export function resolveCsvPaths({ env = process.env, paths = {}, dataDir, cwd = process.cwd() } = {}) {
  const configuredDirectory = normalizePath(
    dataDir ?? paths.dataDir ?? env.CSV_DATA_DIR ?? env.BIZ_DATA_DIR,
    cwd,
  );

  return Object.fromEntries(Object.keys(CSV_SOURCE_FILES).map((key) => {
    const explicit = firstValue(paths, EXPLICIT_PATH_ALIASES[key]);
    const fromEnvironment = firstValue(env, PATH_ENV_NAMES[key]);
    const resolved = normalizePath(explicit ?? fromEnvironment, cwd)
      ?? (configuredDirectory ? path.join(configuredDirectory, CSV_SOURCE_FILES[key]) : null);
    return [key, resolved];
  }));
}

function syntaxError(message, line, column) {
  const error = new SyntaxError(`${message} (line ${line}, column ${column})`);
  error.code = "CSV_SYNTAX_ERROR";
  error.line = line;
  error.column = column;
  return error;
}

/**
 * Parse RFC 4180-style CSV, including UTF-8 BOM, escaped double quotes and
 * embedded CR/LF inside quoted fields. Returns headers, object rows and warnings.
 */
export function parseCsv(text, { strict = true } = {}) {
  if (typeof text !== "string") throw new TypeError("CSV input must be a string.");
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const matrix = [];
  const warnings = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let line = 1;
  let column = 1;

  const pushRow = () => {
    row.push(field);
    matrix.push(row);
    row = [];
    field = "";
    afterClosingQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
          column += 2;
          continue;
        }
        inQuotes = false;
        afterClosingQuote = true;
        column += 1;
        continue;
      }
      field += character;
      if (character === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      continue;
    }

    if (afterClosingQuote && ![",", "\r", "\n"].includes(character)) {
      const error = syntaxError("Unexpected character after a closing quote", line, column);
      if (strict) throw error;
      warnings.push(error.message);
      afterClosingQuote = false;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      afterClosingQuote = false;
      column += 1;
    } else if (character === ",") {
      row.push(field);
      field = "";
      afterClosingQuote = false;
      column += 1;
    } else if (character === "\r" || character === "\n") {
      pushRow();
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      line += 1;
      column = 1;
    } else {
      field += character;
      column += 1;
    }
  }

  if (inQuotes) throw syntaxError("Unclosed quoted field", line, column);
  if (field.length > 0 || row.length > 0 || (input.length > 0 && !/[\r\n]$/.test(input))) {
    pushRow();
  }

  while (matrix.length > 0 && matrix.at(-1).every((value) => value === "")) matrix.pop();
  if (matrix.length === 0) return { headers: [], rows: [], warnings };

  const headers = matrix.shift().map((header, index) => {
    const normalized = stringValue(header);
    if (!normalized) {
      const message = `CSV header at column ${index + 1} is empty.`;
      if (strict) throw syntaxError(message, 1, index + 1);
      warnings.push(message);
      return `__EMPTY_${index + 1}`;
    }
    return normalized;
  });
  const duplicateHeaders = [...new Set(headers.filter((header, index) => headers.indexOf(header) !== index))];
  if (duplicateHeaders.length > 0) {
    const message = `CSV contains duplicate headers: ${duplicateHeaders.join(", ")}`;
    if (strict) throw syntaxError(message, 1, 1);
    warnings.push(message);
  }

  const rows = [];
  for (let index = 0; index < matrix.length; index += 1) {
    const values = matrix[index];
    if (values.length !== headers.length) {
      const message = `CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`;
      if (strict) throw syntaxError(message, index + 2, 1);
      warnings.push(message);
    }
    const record = {};
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      record[headers[headerIndex]] = values[headerIndex] ?? "";
    }
    rows.push(record);
  }
  return { headers, rows, warnings };
}

export async function readCsvFile(filePath, options = {}) {
  const resolvedPath = normalizePath(filePath, options.cwd ?? process.cwd());
  if (!resolvedPath) throw new TypeError("CSV file path is required.");
  const contents = await readFile(resolvedPath, "utf8");
  return { path: resolvedPath, ...parseCsv(contents, options) };
}

function normalizeEmployee(row) {
  const employeeNo = stringValue(row.EMP_NO);
  if (!employeeNo) return null;
  const activeValue = stringValue(row.ACTIVE_YN).toUpperCase();
  return {
    employeeNo,
    name: stringValue(row.EMP_NM),
    departmentName: stringValue(row.DEPT_NM),
    positionName: stringValue(row.POSITION_NM),
    hiredAt: stringValue(row.HIRE_DT),
    active: activeValue === "Y",
  };
}

function normalizeParentArea(row) {
  const id = stringValue(row.AREA_ID);
  if (!id) return null;
  return {
    id,
    name: stringValue(row.AREA_NM),
    level: stringValue(row.AREA_LEVEL),
    registeredAt: stringValue(row.REG_DT),
  };
}

function normalizeBusinessArea(row, parentNameById) {
  const id = stringValue(row.AREA_ID);
  if (!id) return null;
  const parentAreaId = nullableString(row.PARENT_AREA_ID);
  return {
    id,
    name: stringValue(row.AREA_NM),
    parentAreaId,
    parentAreaName: parentAreaId ? (parentNameById.get(parentAreaId) ?? null) : null,
    managerEmployeeNo: nullableString(row.MANAGER_EMP_NO),
    registeredAt: stringValue(row.REG_DT),
  };
}

function normalizeJoinReady(row) {
  const id = stringValue(row.AREA_ID);
  if (!id) return null;
  return {
    id,
    name: stringValue(row.AREA_NM),
    parentAreaId: nullableString(row.PARENT_AREA_ID),
    parentAreaName: nullableString(row.PARENT_AREA_NM),
    managerEmployeeNo: nullableString(row.MANAGER_EMP_NO),
    managerName: stringValue(row.MANAGER_EMP_NM),
    managerDepartmentName: stringValue(row.MANAGER_DEPT_NM),
    managerPositionName: stringValue(row.MANAGER_POSITION_NM),
    registeredAt: stringValue(row.REG_DT),
  };
}

function duplicateCount(values) {
  const seen = new Set();
  let duplicates = 0;
  for (const value of values) {
    const normalized = stringValue(value);
    if (!normalized) continue;
    if (seen.has(normalized)) duplicates += 1;
    else seen.add(normalized);
  }
  return duplicates;
}

function relationSummary(sourceValues, targetValues, { ignoreBlank = false } = {}) {
  const targets = new Set(targetValues.map(stringValue).filter(Boolean));
  const source = sourceValues.map(stringValue);
  const considered = ignoreBlank ? source.filter(Boolean) : source;
  const matched = considered.filter((value) => value && targets.has(value));
  const orphans = considered.filter((value) => !value || !targets.has(value));
  const sourceDistinct = new Set(considered.filter(Boolean));
  const matchedDistinct = new Set(matched);
  return {
    sourceRows: source.length,
    consideredRows: considered.length,
    blankRows: source.filter((value) => !value).length,
    matchedRows: matched.length,
    orphanRows: orphans.length,
    matchPercent: percent(matched.length, considered.length),
    sourceDistinct: sourceDistinct.size,
    matchedDistinct: matchedDistinct.size,
    orphanDistinct: new Set(orphans.filter(Boolean)).size,
    distinctMatchPercent: percent(matchedDistinct.size, sourceDistinct.size),
  };
}

function equalitySummary(rows, leftField, rightLookup, rightField) {
  let comparableRows = 0;
  let equalRows = 0;
  for (const row of rows) {
    const key = stringValue(row.AREA_ID);
    const other = rightLookup.get(key);
    if (!other) continue;
    comparableRows += 1;
    if (stringValue(row[leftField]) === stringValue(other[rightField])) equalRows += 1;
  }
  return {
    comparableRows,
    equalRows,
    differentRows: comparableRows - equalRows,
    agreementPercent: percent(equalRows, comparableRows),
  };
}

function lookupBy(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const key = stringValue(row[field]);
    if (key && !result.has(key)) result.set(key, row);
  }
  return result;
}

function pushIssue(issues, code, count, message) {
  if (count > 0) issues.push({ code, count, message });
}

/**
 * Validate PK/FK relationships and compare the denormalized join-ready file
 * against the three normalized sources. Summaries contain counts only; no
 * employee identifiers or names are exposed.
 */
export function validateCsvRelations({ employees = [], businessAreas = [], joinReady = [], parentAreas = [] } = {}) {
  const issues = [];
  const employeeByNo = lookupBy(employees, "EMP_NO");
  const areaById = lookupBy(businessAreas, "AREA_ID");
  const parentById = lookupBy(parentAreas, "AREA_ID");
  const joinById = lookupBy(joinReady, "AREA_ID");

  const primaryKeys = {
    employees: {
      rows: employees.length,
      blank: employees.filter((row) => !stringValue(row.EMP_NO)).length,
      duplicates: duplicateCount(employees.map((row) => row.EMP_NO)),
    },
    businessAreas: {
      rows: businessAreas.length,
      blank: businessAreas.filter((row) => !stringValue(row.AREA_ID)).length,
      duplicates: duplicateCount(businessAreas.map((row) => row.AREA_ID)),
    },
    joinReady: {
      rows: joinReady.length,
      blank: joinReady.filter((row) => !stringValue(row.AREA_ID)).length,
      duplicates: duplicateCount(joinReady.map((row) => row.AREA_ID)),
    },
    parentAreas: {
      rows: parentAreas.length,
      blank: parentAreas.filter((row) => !stringValue(row.AREA_ID)).length,
      duplicates: duplicateCount(parentAreas.map((row) => row.AREA_ID)),
    },
  };

  for (const [source, summary] of Object.entries(primaryKeys)) {
    pushIssue(issues, `${source}.blank_primary_key`, summary.blank, `${source} contains blank primary keys.`);
    pushIssue(issues, `${source}.duplicate_primary_key`, summary.duplicates, `${source} contains duplicate primary keys.`);
  }

  const relationships = {
    areaManagerToEmployee: relationSummary(
      businessAreas.map((row) => row.MANAGER_EMP_NO),
      employees.map((row) => row.EMP_NO),
    ),
    areaParentToLookup: relationSummary(
      businessAreas.map((row) => row.PARENT_AREA_ID),
      parentAreas.map((row) => row.AREA_ID),
      { ignoreBlank: true },
    ),
    areaParentToArea: relationSummary(
      businessAreas.map((row) => row.PARENT_AREA_ID),
      businessAreas.map((row) => row.AREA_ID),
      { ignoreBlank: true },
    ),
    joinReadyToArea: relationSummary(
      joinReady.map((row) => row.AREA_ID),
      businessAreas.map((row) => row.AREA_ID),
    ),
    areaToJoinReady: relationSummary(
      businessAreas.map((row) => row.AREA_ID),
      joinReady.map((row) => row.AREA_ID),
    ),
  };

  pushIssue(issues, "businessAreas.manager_orphan", relationships.areaManagerToEmployee.orphanRows, "Business areas reference unknown employees.");
  pushIssue(issues, "businessAreas.parent_orphan", relationships.areaParentToLookup.orphanRows, "Business areas reference unknown parent lookup rows.");
  pushIssue(issues, "businessAreas.parent_not_in_area", relationships.areaParentToArea.orphanRows, "Business-area parents are missing from the area master.");
  pushIssue(issues, "joinReady.area_orphan", relationships.joinReadyToArea.orphanRows, "Join-ready rows reference unknown business areas.");
  pushIssue(issues, "joinReady.area_missing", relationships.areaToJoinReady.orphanRows, "Business areas are missing from the join-ready file.");

  const sharedAreaFields = Object.fromEntries([
    "AREA_NM", "PARENT_AREA_ID", "MANAGER_EMP_NO", "REG_DT",
  ].map((field) => [field, equalitySummary(joinReady, field, areaById, field)]));

  const denormalizedParent = { comparableRows: 0, equalRows: 0, differentRows: 0, agreementPercent: null };
  const denormalizedEmployees = Object.fromEntries([
    ["MANAGER_EMP_NM", "EMP_NM"],
    ["MANAGER_DEPT_NM", "DEPT_NM"],
    ["MANAGER_POSITION_NM", "POSITION_NM"],
  ].map(([field]) => [field, { comparableRows: 0, equalRows: 0, differentRows: 0, agreementPercent: null }]));

  for (const row of joinReady) {
    const parentId = stringValue(row.PARENT_AREA_ID);
    const parent = parentById.get(parentId);
    if (parent) {
      denormalizedParent.comparableRows += 1;
      if (stringValue(row.PARENT_AREA_NM) === stringValue(parent.AREA_NM)) denormalizedParent.equalRows += 1;
    }

    const employee = employeeByNo.get(stringValue(row.MANAGER_EMP_NO));
    if (employee) {
      for (const [field, employeeField] of [
        ["MANAGER_EMP_NM", "EMP_NM"],
        ["MANAGER_DEPT_NM", "DEPT_NM"],
        ["MANAGER_POSITION_NM", "POSITION_NM"],
      ]) {
        const summary = denormalizedEmployees[field];
        summary.comparableRows += 1;
        if (stringValue(row[field]) === stringValue(employee[employeeField])) summary.equalRows += 1;
      }
    }
  }

  for (const summary of [denormalizedParent, ...Object.values(denormalizedEmployees)]) {
    summary.differentRows = summary.comparableRows - summary.equalRows;
    summary.agreementPercent = percent(summary.equalRows, summary.comparableRows);
  }

  for (const [field, summary] of Object.entries(sharedAreaFields)) {
    pushIssue(issues, `joinReady.${field}.mismatch`, summary.differentRows, `Join-ready ${field} differs from the area master.`);
  }
  pushIssue(issues, "joinReady.PARENT_AREA_NM.mismatch", denormalizedParent.differentRows, "Join-ready parent names differ from the parent lookup.");
  for (const [field, summary] of Object.entries(denormalizedEmployees)) {
    pushIssue(issues, `joinReady.${field}.mismatch`, summary.differentRows, `Join-ready ${field} differs from the employee master.`);
  }

  const rootIds = new Set(businessAreas
    .filter((row) => !stringValue(row.PARENT_AREA_ID))
    .map((row) => stringValue(row.AREA_ID))
    .filter(Boolean));
  const parentIds = new Set(parentAreas.map((row) => stringValue(row.AREA_ID)).filter(Boolean));
  const rootsMissingFromLookup = [...rootIds].filter((id) => !parentIds.has(id)).length;
  const lookupRowsNotRoots = [...parentIds].filter((id) => !rootIds.has(id)).length;
  pushIssue(issues, "hierarchy.root_missing_lookup", rootsMissingFromLookup, "Root business areas are missing from the parent lookup.");
  pushIssue(issues, "hierarchy.lookup_not_root", lookupRowsNotRoots, "Parent lookup rows are not root business areas.");

  const inactiveEmployees = new Set(employees
    .filter((row) => stringValue(row.ACTIVE_YN).toUpperCase() === "N")
    .map((row) => stringValue(row.EMP_NO)));
  const managedByInactiveRows = businessAreas
    .filter((row) => inactiveEmployees.has(stringValue(row.MANAGER_EMP_NO))).length;

  return {
    valid: issues.length === 0,
    primaryKeys,
    relationships,
    consistency: { sharedAreaFields, denormalizedParent, denormalizedEmployees },
    hierarchy: {
      rootRows: rootIds.size,
      parentLookupRows: parentIds.size,
      rootsMissingFromLookup,
      lookupRowsNotRoots,
    },
    managerActivity: {
      inactiveEmployeeCount: inactiveEmployees.size,
      areaRowsManagedByInactiveEmployees: managedByInactiveRows,
      areaRowsManagedByInactivePercent: percent(managedByInactiveRows, businessAreas.length),
    },
    issues,
  };
}

function assertRequiredHeaders(sourceName, parsed) {
  const available = new Set(parsed.headers);
  const missing = REQUIRED_HEADERS[sourceName].filter((header) => !available.has(header));
  if (missing.length > 0) {
    const error = new Error(`${CSV_SOURCE_FILES[sourceName]} is missing required headers: ${missing.join(", ")}`);
    error.code = "CSV_HEADERS_MISSING";
    error.source = sourceName;
    error.missingHeaders = missing;
    throw error;
  }
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unavailableResult(resolvedPaths, missingFiles, errors = []) {
  return {
    source: "none",
    available: false,
    fallbackUsed: false,
    paths: resolvedPaths,
    missingFiles,
    employees: [],
    businessAreas: [],
    parentAreas: [],
    joinReady: [],
    sourceRows: {
      employees: [], businessAreas: [], joinReady: [], parentAreas: [],
    },
    validation: {
      valid: false,
      complete: false,
      issues: errors.map((error) => ({
        code: error.code ?? "CSV_LOAD_ERROR",
        count: 1,
        message: error.message,
      })),
    },
    files: {},
  };
}

async function resolveFallback(fallback, context) {
  if (fallback === undefined || fallback === null) return null;
  const value = typeof fallback === "function" ? await fallback(context) : fallback;
  if (value === undefined || value === null) return null;
  return {
    ...value,
    source: "fallback",
    available: Boolean(value.available ?? (value.employees?.length && value.businessAreas?.length)),
    fallbackUsed: true,
    paths: context.paths,
    missingFiles: context.missingFiles,
    employees: value.employees ?? [],
    businessAreas: value.businessAreas ?? [],
    parentAreas: value.parentAreas ?? [],
    joinReady: value.joinReady ?? [],
    sourceRows: value.sourceRows ?? {
      employees: [], businessAreas: [], joinReady: [], parentAreas: [],
    },
  };
}

/**
 * Load and normalize the four business CSV files.
 *
 * strict=true rejects missing files, malformed headers and relationship or
 * join-ready mismatches. In tolerant mode missing files return an empty result,
 * or `fallback(context)` when supplied.
 */
export async function loadCsvSources({
  env = process.env,
  paths,
  dataDir,
  cwd = process.cwd(),
  strict = false,
  fallback,
} = {}) {
  const resolvedPaths = resolveCsvPaths({ env, paths, dataDir, cwd });
  const missingFiles = [];
  for (const [source, filePath] of Object.entries(resolvedPaths)) {
    if (!await fileExists(filePath)) missingFiles.push({ source, path: filePath });
  }

  if (missingFiles.length > 0) {
    const description = missingFiles.map(({ source, path: filePath }) => `${source}: ${filePath ?? "not configured"}`).join("; ");
    const error = new Error(`Required CSV files are unavailable (${description}).`);
    error.code = "CSV_FILES_MISSING";
    error.missingFiles = missingFiles;
    if (strict) throw error;
    const context = { error, paths: resolvedPaths, missingFiles };
    return await resolveFallback(fallback, context)
      ?? unavailableResult(resolvedPaths, missingFiles, [error]);
  }

  let parsed;
  try {
    parsed = Object.fromEntries(await Promise.all(Object.entries(resolvedPaths).map(async ([source, filePath]) => {
      const file = await readCsvFile(filePath, { strict });
      assertRequiredHeaders(source, file);
      return [source, file];
    })));
  } catch (error) {
    if (strict) throw error;
    const context = { error, paths: resolvedPaths, missingFiles: [] };
    return await resolveFallback(fallback, context)
      ?? unavailableResult(resolvedPaths, [], [error]);
  }

  const raw = Object.fromEntries(Object.entries(parsed).map(([source, file]) => [source, file.rows]));
  const parentAreas = raw.parentAreas.map(normalizeParentArea).filter(Boolean);
  const parentNameById = new Map(parentAreas.map((area) => [area.id, area.name]));
  const employees = raw.employees.map(normalizeEmployee).filter(Boolean);
  const businessAreas = raw.businessAreas
    .map((row) => normalizeBusinessArea(row, parentNameById))
    .filter(Boolean);
  const joinReady = raw.joinReady.map(normalizeJoinReady).filter(Boolean);
  const validation = validateCsvRelations(raw);
  validation.complete = true;

  if (strict && !validation.valid) {
    const error = new Error(`CSV relationship validation failed with ${validation.issues.length} issue type(s).`);
    error.code = "CSV_RELATION_VALIDATION_FAILED";
    error.validation = validation;
    throw error;
  }

  return {
    source: "csv",
    available: true,
    fallbackUsed: false,
    paths: resolvedPaths,
    missingFiles: [],
    employees,
    businessAreas,
    parentAreas,
    joinReady,
    sourceRows: raw,
    validation,
    files: Object.fromEntries(Object.entries(parsed).map(([source, file]) => [source, {
      path: file.path,
      rowCount: file.rows.length,
      headers: file.headers,
      warnings: file.warnings,
    }])),
  };
}
