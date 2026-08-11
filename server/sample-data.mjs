const DAY_MS = 24 * 60 * 60 * 1000;
const DATASET_ANCHOR = Date.UTC(2026, 5, 1, 12, 0, 0);
const CONTEXT_MARKER = Symbol("used-car-seed-context");

function freezeRecords(records) {
  return Object.freeze(records.map((record) => Object.freeze({ ...record })));
}

export const SAMPLE_MANUFACTURERS = freezeRecords([
  { id: 1, name: "현대", slug: "hyundai", country: "대한민국" },
  { id: 2, name: "기아", slug: "kia", country: "대한민국" },
  { id: 3, name: "제네시스", slug: "genesis", country: "대한민국" },
  { id: 4, name: "쉐보레", slug: "chevrolet", country: "대한민국" },
  { id: 5, name: "르노코리아", slug: "renault-korea", country: "대한민국" },
  { id: 6, name: "KG모빌리티", slug: "kg-mobility", country: "대한민국" },
  { id: 7, name: "BMW", slug: "bmw", country: "독일" },
  { id: 8, name: "메르세데스-벤츠", slug: "mercedes-benz", country: "독일" },
  { id: 9, name: "아우디", slug: "audi", country: "독일" },
  { id: 10, name: "폭스바겐", slug: "volkswagen", country: "독일" },
  { id: 11, name: "토요타", slug: "toyota", country: "일본" },
  { id: 12, name: "렉서스", slug: "lexus", country: "일본" },
]);

const MODEL_DEFINITIONS = Object.freeze([
  ["hyundai", [
    ["아반떼", "avante", "sedan", 25_000_000, ["스마트", "모던", "인스퍼레이션"], ["gasoline", "lpg", "hybrid"]],
    ["쏘나타", "sonata", "sedan", 34_000_000, ["프리미엄", "익스클루시브", "인스퍼레이션"], ["gasoline", "lpg", "hybrid"]],
    ["그랜저", "grandeur", "sedan", 46_000_000, ["프리미엄", "익스클루시브", "캘리그래피"], ["gasoline", "lpg", "hybrid"]],
    ["투싼", "tucson", "suv", 35_000_000, ["모던", "프리미엄", "인스퍼레이션"], ["gasoline", "diesel", "hybrid"]],
    ["싼타페", "santa-fe", "suv", 45_000_000, ["익스클루시브", "프레스티지", "캘리그래피"], ["gasoline", "diesel", "hybrid"]],
    ["팰리세이드", "palisade", "suv", 52_000_000, ["익스클루시브", "프레스티지", "캘리그래피"], ["gasoline", "diesel"]],
    ["캐스퍼", "casper", "compact", 20_000_000, ["스마트", "디 에센셜", "인스퍼레이션"], ["gasoline"]],
    ["아이오닉 5", "ioniq-5", "suv", 59_000_000, ["스탠다드", "롱레인지", "N"], ["electric"]],
  ]],
  ["kia", [
    ["모닝", "morning", "compact", 17_000_000, ["트렌디", "프레스티지", "시그니처"], ["gasoline"]],
    ["레이", "ray", "compact", 19_000_000, ["트렌디", "프레스티지", "시그니처"], ["gasoline", "electric"]],
    ["K3", "k3", "sedan", 24_000_000, ["트렌디", "프레스티지", "시그니처"], ["gasoline"]],
    ["K5", "k5", "sedan", 35_000_000, ["프레스티지", "노블레스", "시그니처"], ["gasoline", "lpg", "hybrid"]],
    ["K8", "k8", "sedan", 47_000_000, ["노블레스", "시그니처", "플래티넘"], ["gasoline", "lpg", "hybrid"]],
    ["스포티지", "sportage", "suv", 36_000_000, ["프레스티지", "노블레스", "시그니처"], ["gasoline", "diesel", "hybrid"]],
    ["쏘렌토", "sorento", "suv", 46_000_000, ["프레스티지", "노블레스", "시그니처"], ["gasoline", "diesel", "hybrid"]],
    ["카니발", "carnival", "minivan", 49_000_000, ["프레스티지", "노블레스", "하이리무진"], ["gasoline", "diesel", "hybrid"]],
    ["EV6", "ev6", "suv", 62_000_000, ["스탠다드", "롱레인지", "GT"], ["electric"]],
  ]],
  ["genesis", [
    ["G70", "g70", "sedan", 53_000_000, ["기본형", "스포츠 패키지", "슈팅 브레이크"], ["gasoline"]],
    ["G80", "g80", "sedan", 72_000_000, ["기본형", "스포츠 패키지", "전동화 모델"], ["gasoline", "electric"]],
    ["G90", "g90", "sedan", 115_000_000, ["기본형", "롱휠베이스", "블랙"], ["gasoline"]],
    ["GV70", "gv70", "suv", 68_000_000, ["기본형", "스포츠 패키지", "전동화 모델"], ["gasoline", "diesel", "electric"]],
    ["GV80", "gv80", "suv", 86_000_000, ["기본형", "쿠페", "블랙"], ["gasoline", "diesel"]],
  ]],
  ["chevrolet", [
    ["스파크", "spark", "compact", 15_000_000, ["LS", "LT", "프리미어"], ["gasoline"]],
    ["말리부", "malibu", "sedan", 32_000_000, ["LS", "LT", "프리미어"], ["gasoline"]],
    ["트레일블레이저", "trailblazer", "suv", 32_000_000, ["LT", "프리미어", "RS"], ["gasoline"]],
    ["트래버스", "traverse", "suv", 60_000_000, ["LT", "레드라인", "하이컨트리"], ["gasoline"]],
  ]],
  ["renault-korea", [
    ["SM6", "sm6", "sedan", 34_000_000, ["필", "RE", "인스파이어"], ["gasoline", "lpg"]],
    ["QM6", "qm6", "suv", 35_000_000, ["LE", "RE", "프리미에르"], ["gasoline", "lpg"]],
    ["XM3", "xm3", "suv", 33_000_000, ["LE", "RE", "인스파이어"], ["gasoline", "hybrid"]],
  ]],
  ["kg-mobility", [
    ["티볼리", "tivoli", "suv", 27_000_000, ["V1", "V3", "V7"], ["gasoline"]],
    ["코란도", "korando", "suv", 32_000_000, ["C3", "C5", "C7"], ["gasoline", "diesel"]],
    ["토레스", "torres", "suv", 39_000_000, ["T5", "T7", "EVX"], ["gasoline", "electric"]],
    ["렉스턴", "rexton", "suv", 52_000_000, ["프리미엄", "노블레스", "더 블랙"], ["diesel"]],
  ]],
  ["bmw", [
    ["3시리즈", "3-series", "sedan", 67_000_000, ["320i", "320d", "M340i"], ["gasoline", "diesel"]],
    ["5시리즈", "5-series", "sedan", 84_000_000, ["520i", "523d", "530e"], ["gasoline", "diesel", "hybrid"]],
    ["X3", "x3", "suv", 83_000_000, ["20i", "20d", "M40i"], ["gasoline", "diesel"]],
    ["X5", "x5", "suv", 125_000_000, ["30d", "40i", "50e"], ["gasoline", "diesel", "hybrid"]],
  ]],
  ["mercedes-benz", [
    ["C-클래스", "c-class", "sedan", 74_000_000, ["C200", "C300", "AMG C43"], ["gasoline"]],
    ["E-클래스", "e-class", "sedan", 91_000_000, ["E200", "E220d", "E350"], ["gasoline", "diesel"]],
    ["GLC", "glc", "suv", 88_000_000, ["GLC 220d", "GLC 300", "AMG GLC 43"], ["gasoline", "diesel"]],
    ["GLE", "gle", "suv", 132_000_000, ["GLE 300d", "GLE 450", "AMG GLE 53"], ["gasoline", "diesel"]],
  ]],
  ["audi", [
    ["A4", "a4", "sedan", 61_000_000, ["40 TFSI", "35 TDI", "프리미엄"], ["gasoline", "diesel"]],
    ["A6", "a6", "sedan", 79_000_000, ["45 TFSI", "40 TDI", "프리미엄"], ["gasoline", "diesel"]],
    ["Q5", "q5", "suv", 83_000_000, ["40 TDI", "45 TFSI", "스포트백"], ["gasoline", "diesel"]],
  ]],
  ["volkswagen", [
    ["골프", "golf", "hatchback", 43_000_000, ["프레스티지", "R-Line", "GTI"], ["gasoline", "diesel"]],
    ["티구안", "tiguan", "suv", 51_000_000, ["프리미엄", "프레스티지", "올스페이스"], ["gasoline", "diesel"]],
  ]],
  ["toyota", [
    ["캠리", "camry", "sedan", 49_000_000, ["XLE", "XSE", "하이브리드"], ["gasoline", "hybrid"]],
    ["RAV4", "rav4", "suv", 57_000_000, ["XLE", "어드벤처", "하이브리드"], ["gasoline", "hybrid"]],
  ]],
  ["lexus", [
    ["ES", "es", "sedan", 71_000_000, ["ES 300h", "럭셔리", "이그제큐티브"], ["hybrid"]],
    ["NX", "nx", "suv", 77_000_000, ["NX 350h", "프리미엄", "F SPORT"], ["hybrid"]],
  ]],
]);

const manufacturerBySlug = new Map(SAMPLE_MANUFACTURERS.map((item) => [item.slug, item]));

export const SAMPLE_CAR_MODELS = Object.freeze(
  MODEL_DEFINITIONS.flatMap(([manufacturerSlug, definitions]) => {
    const manufacturer = manufacturerBySlug.get(manufacturerSlug);
    return definitions.map(([name, slug, bodyType, newPriceKrw, grades, fuelTypes]) => ({
      id: 0,
      manufacturerId: manufacturer.id,
      manufacturerSlug,
      name,
      slug,
      bodyType,
      newPriceKrw,
      grades: Object.freeze([...grades]),
      fuelTypes: Object.freeze([...fuelTypes]),
    }));
  }).map((model, index) => Object.freeze({ ...model, id: index + 1 })),
);

const LOCATION_GROUPS = Object.freeze([
  ["서울특별시", "seoul", ["강남구", "송파구", "마포구"]],
  ["부산광역시", "busan", ["해운대구", "부산진구", "사하구"]],
  ["대구광역시", "daegu", ["수성구", "달서구", "북구"]],
  ["인천광역시", "incheon", ["남동구", "서구", "연수구"]],
  ["광주광역시", "gwangju", ["광산구", "북구", "서구"]],
  ["대전광역시", "daejeon", ["유성구", "서구", "중구"]],
  ["울산광역시", "ulsan", ["남구", "북구", "울주군"]],
  ["세종특별자치시", "sejong", ["세종시"]],
  ["경기도", "gyeonggi", ["수원시", "성남시", "고양시", "용인시"]],
  ["강원특별자치도", "gangwon", ["춘천시", "원주시", "강릉시"]],
  ["충청북도", "chungbuk", ["청주시", "충주시", "제천시"]],
  ["충청남도", "chungnam", ["천안시", "아산시", "서산시"]],
  ["전북특별자치도", "jeonbuk", ["전주시", "익산시", "군산시"]],
  ["전라남도", "jeonnam", ["목포시", "여수시", "순천시"]],
  ["경상북도", "gyeongbuk", ["포항시", "구미시", "경산시"]],
  ["경상남도", "gyeongnam", ["창원시", "김해시", "진주시"]],
  ["제주특별자치도", "jeju", ["제주시", "서귀포시"]],
]);

export const SAMPLE_LOCATIONS = Object.freeze(
  LOCATION_GROUPS.flatMap(([sido, sidoSlug, sigunguList]) => sigunguList.map((sigungu, index) => ({
    id: 0,
    sido,
    sigungu,
    province: sido,
    city: sigungu,
    name: `${sido} ${sigungu}`,
    slug: `${sidoSlug}-${index + 1}`,
  }))).map((location, index) => Object.freeze({ ...location, id: index + 1 })),
);

// Short aliases make the catalog convenient to import from seed and repository code.
export const SAMPLE_BRANDS = SAMPLE_MANUFACTURERS;
export const SAMPLE_MODELS = SAMPLE_CAR_MODELS;
export const KOREAN_LOCATIONS = SAMPLE_LOCATIONS;

export const DEFAULT_MEMORY_CAR_COUNT = 2_400;
export const DEFAULT_FALLBACK_EMPLOYEE_COUNT = 3_000;
export const DEFAULT_FALLBACK_BUSINESS_AREA_COUNT = 3_000;

const DEPARTMENTS = Object.freeze([
  "영업팀", "차량매입팀", "상품화팀", "고객서비스팀", "데이터팀", "품질관리팀",
]);
const POSITIONS = Object.freeze(["사원", "대리", "과장", "차장", "부장", "팀장"]);
const BUSINESS_AREA_NAMES = Object.freeze([
  "수도권영업", "중부영업", "영남영업", "호남영업", "제주영업", "온라인영업",
]);
const BUSINESS_AREA_SUFFIXES = Object.freeze(["팀", "센터", "지점", "운영", "플랫폼"]);
const COLORS = Object.freeze([
  "흰색", "검정색", "은색", "회색", "청색", "빨간색", "갈색", "녹색", "진주색",
]);
const FUEL_NAMES = Object.freeze({
  gasoline: "가솔린",
  diesel: "디젤",
  hybrid: "하이브리드",
  electric: "전기",
  lpg: "LPG",
});
const DISPLACEMENTS_BY_FUEL = Object.freeze({
  gasoline: Object.freeze([999, 1_598, 1_998, 2_497, 2_998, 3_470]),
  diesel: Object.freeze([1_598, 1_998, 2_151, 2_993]),
  hybrid: Object.freeze([1_580, 1_999, 2_487, 3_456]),
  lpg: Object.freeze([1_999, 2_359, 3_470]),
  electric: Object.freeze([0]),
});
const INSPECTION_STATUSES = Object.freeze([
  "점검완료", "점검완료", "점검완료", "점검완료", "점검완료",
  "점검완료", "점검완료", "점검완료", "점검예정", "재점검필요",
]);
const AUTOMATIC = Object.freeze({ code: "automatic", name: "자동" });
const TRANSMISSIONS = Object.freeze([
  AUTOMATIC,
  AUTOMATIC,
  AUTOMATIC,
  AUTOMATIC,
  AUTOMATIC,
  AUTOMATIC,
  AUTOMATIC,
  Object.freeze({ code: "dct", name: "DCT" }),
  Object.freeze({ code: "cvt", name: "CVT" }),
  Object.freeze({ code: "manual", name: "수동" }),
]);
const STATUSES = Object.freeze([
  "AVAILABLE", "AVAILABLE", "AVAILABLE", "AVAILABLE", "AVAILABLE",
  "AVAILABLE", "AVAILABLE", "AVAILABLE", "RESERVED", "SOLD",
]);

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function textValue(record, ...keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function mixedNumber(index, salt) {
  let value = ((index + 1) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function choice(items, index, salt) {
  return items[mixedNumber(index, salt) % items.length];
}

function publicDealerCode(index) {
  return `DLR-${String(index + 1).padStart(5, "0")}`;
}

export function normalizeEmployeeRecord(record, index = 0) {
  const employeeNo = textValue(record, "employeeNo", "EMP_NO");
  if (!employeeNo) return null;
  const activeValue = textValue(record, "active", "activeYn", "ACTIVE_YN").toUpperCase();
  return {
    employeeNo,
    name: textValue(record, "name", "employeeName", "EMP_NM") || `교육용 직원 ${index + 1}`,
    departmentName: textValue(record, "departmentName", "DEPT_NM") || "영업팀",
    positionName: textValue(record, "positionName", "POSITION_NM") || "사원",
    hiredAt: textValue(record, "hiredAt", "HIRE_DT") || "2020-01-01 00:00:00",
    active: !["N", "FALSE", "0"].includes(activeValue),
  };
}

export function normalizeBusinessAreaRecord(record) {
  const id = textValue(record, "id", "areaId", "AREA_ID");
  if (!id) return null;
  return {
    id,
    name: textValue(record, "name", "areaName", "AREA_NM") || id,
    parentAreaId: textValue(record, "parentAreaId", "PARENT_AREA_ID") || null,
    parentAreaName: textValue(record, "parentAreaName", "PARENT_AREA_NM") || null,
    managerEmployeeNo: textValue(record, "managerEmployeeNo", "MANAGER_EMP_NO") || null,
    registeredAt: textValue(record, "registeredAt", "REG_DT") || "2020-01-01 00:00:00",
  };
}

export function createFallbackEmployees(count = DEFAULT_FALLBACK_EMPLOYEE_COUNT) {
  const employeeCount = positiveInteger(count, DEFAULT_FALLBACK_EMPLOYEE_COUNT);
  return Array.from({ length: employeeCount }, (_, index) => {
    const id = index + 1;
    const hiredAt = new Date(Date.UTC(2010 + (index % 15), (index * 7) % 12, (index % 27) + 1));
    return {
      employeeNo: `EMP${String(id).padStart(6, "0")}`,
      name: `교육용 직원 ${String(id).padStart(4, "0")}`,
      departmentName: DEPARTMENTS[(index * 5) % DEPARTMENTS.length],
      positionName: POSITIONS[(index * 7) % POSITIONS.length],
      hiredAt: hiredAt.toISOString(),
      active: id % 17 !== 0,
    };
  });
}

export function createFallbackBusinessAreas(
  count = DEFAULT_FALLBACK_BUSINESS_AREA_COUNT,
  employees = createFallbackEmployees(),
) {
  const areaCount = positiveInteger(count, DEFAULT_FALLBACK_BUSINESS_AREA_COUNT);
  const normalizedEmployees = employees
    .map(normalizeEmployeeRecord)
    .filter(Boolean);
  if (normalizedEmployees.length === 0) {
    throw new TypeError("At least one employee is required to create business areas.");
  }

  const rootCount = Math.min(100, Math.max(1, Math.floor(areaCount / 20)));
  const roots = Array.from({ length: rootCount }, (_, index) => ({
    id: `BIZ_${String(index + 1).padStart(5, "0")}`,
    name: `${BUSINESS_AREA_NAMES[index % BUSINESS_AREA_NAMES.length]} ${index + 1}`,
    parentAreaId: null,
    parentAreaName: null,
    managerEmployeeNo: normalizedEmployees[(index * 17) % normalizedEmployees.length].employeeNo,
    registeredAt: new Date(Date.UTC(2018, index % 12, (index % 27) + 1)).toISOString(),
  }));

  return Array.from({ length: areaCount }, (_, index) => {
    if (index < roots.length) return roots[index];
    const root = roots[mixedNumber(index, 0x12ab) % roots.length];
    return {
      id: `BIZ_${String(index + 1).padStart(5, "0")}`,
      name: `${BUSINESS_AREA_NAMES[index % BUSINESS_AREA_NAMES.length]}${BUSINESS_AREA_SUFFIXES[(index * 3) % BUSINESS_AREA_SUFFIXES.length]} ${index + 1}`,
      parentAreaId: root.id,
      parentAreaName: root.name,
      managerEmployeeNo: normalizedEmployees[mixedNumber(index, 0x34cd) % normalizedEmployees.length].employeeNo,
      registeredAt: new Date(Date.UTC(2018 + (index % 8), (index * 7) % 12, (index % 27) + 1)).toISOString(),
    };
  });
}

export function createCarSeedContext({
  manufacturers = SAMPLE_MANUFACTURERS,
  models = SAMPLE_CAR_MODELS,
  locations = SAMPLE_LOCATIONS,
  employees,
  businessAreas,
} = {}) {
  const normalizedEmployees = (employees ?? createFallbackEmployees())
    .map(normalizeEmployeeRecord)
    .filter(Boolean)
    .sort((left, right) => left.employeeNo.localeCompare(right.employeeNo));
  if (normalizedEmployees.length === 0) {
    throw new TypeError("At least one employee is required to create cars.");
  }

  const employeeByNo = new Map(normalizedEmployees.map((employee, index) => [
    employee.employeeNo,
    { ...employee, publicCode: publicDealerCode(index), publicName: `인증딜러 ${String(index + 1).padStart(4, "0")}` },
  ]));
  const suppliedAreas = businessAreas
    ?? createFallbackBusinessAreas(DEFAULT_FALLBACK_BUSINESS_AREA_COUNT, normalizedEmployees);
  const normalizedAreas = suppliedAreas.map(normalizeBusinessAreaRecord).filter(Boolean);
  let eligibleAreas = normalizedAreas.filter((area) => {
    const manager = employeeByNo.get(area.managerEmployeeNo);
    return manager?.active && area.parentAreaId;
  });
  if (eligibleAreas.length === 0) {
    eligibleAreas = normalizedAreas.filter((area) => employeeByNo.has(area.managerEmployeeNo));
  }
  if (eligibleAreas.length === 0) {
    throw new TypeError("Business areas must reference at least one supplied employee.");
  }
  if (!manufacturers.length || !models.length || !locations.length) {
    throw new TypeError("At least one manufacturer, model, and location are required.");
  }

  return Object.freeze({
    [CONTEXT_MARKER]: true,
    manufacturers,
    manufacturerById: new Map(manufacturers.map((item) => [Number(item.id), item])),
    models,
    locations,
    employeeByNo,
    businessAreas: eligibleAreas,
  });
}

/**
 * Build one reproducible used-car listing. CSV rows using uppercase source
 * columns can be passed directly through createCarSeedContext/createSampleCars.
 */
export function createSampleCar(index, options = {}) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError("Car index must be a non-negative safe integer.");
  }
  const context = options?.[CONTEXT_MARKER] ? options : createCarSeedContext(options);
  const id = index + 1;
  const model = choice(context.models, index, 0x51f2);
  const manufacturer = context.manufacturerById.get(Number(model.manufacturerId));
  if (!manufacturer) {
    throw new TypeError(`Model ${model.id} references an unknown manufacturer.`);
  }
  const businessArea = choice(context.businessAreas, index, 0x92ad);
  const employee = context.employeeByNo.get(businessArea.managerEmployeeNo);
  const location = choice(context.locations, index, 0xc311);
  const grade = choice(model.grades, index, 0x71e5);
  const fuelType = choice(model.fuelTypes, index, 0x41bd);
  const transmission = fuelType === "electric"
    ? { code: "automatic", name: "자동" }
    : choice(TRANSMISSIONS, index, 0x1337);
  const modelYear = 2008 + (mixedNumber(index, 0x2255) % 19);
  const vehicleAge = 2026 - modelYear;
  const mileageKm = Math.min(
    330_000,
    Math.max(300, vehicleAge * 11_500 + (mixedNumber(index, 0x33aa) % 24_000) - 6_000),
  );
  const accidentRoll = mixedNumber(index, 0x4c7d) % 100;
  const accidentCount = accidentRoll < 70 ? 0 : accidentRoll < 90 ? 1 : accidentRoll < 98 ? 2 : 3;
  const ownerChangeRoll = mixedNumber(index, 0x5d8f) % 100;
  const ownerChangeCount = ownerChangeRoll < 25
    ? 0
    : ownerChangeRoll < 55
      ? 1
      : ownerChangeRoll < 75
        ? 2
        : ownerChangeRoll < 88
          ? 3
          : ownerChangeRoll < 96
            ? 4
            : 5;
  const displacementOptions = model.bodyType === "compact" && fuelType === "gasoline"
    ? [999, 1_197, 1_598]
    : DISPLACEMENTS_BY_FUEL[fuelType] ?? [1_998];
  const displacementCc = choice(displacementOptions, index, 0x6ea1);
  const inspectionStatus = choice(INSPECTION_STATUSES, index, 0x7fb3);
  const depreciation = Math.pow(0.87, vehicleAge);
  const mileageAdjustment = Math.max(0.58, 1 - mileageKm / 900_000);
  const accidentAdjustment = 1 - accidentCount * 0.055;
  const price = Math.max(
    1_500_000,
    Math.round((model.newPriceKrw * depreciation * mileageAdjustment * accidentAdjustment) / 100_000) * 100_000,
  );
  const registrationMonthCount = modelYear === 2026 ? 5 : 12;
  const firstRegistration = new Date(Date.UTC(
    modelYear,
    mixedNumber(index, 0x67ef) % registrationMonthCount,
    (index % 27) + 1,
  ));
  const registeredAtTime = DATASET_ANCHOR
    - (mixedNumber(index, 0x78f1) % 730) * DAY_MS
    - (mixedNumber(index, 0x8e21) % 86_400) * 1_000;
  const updatedAtTime = Math.min(
    DATASET_ANCHOR,
    registeredAtTime + (mixedNumber(index, 0x99b3) % 31) * DAY_MS,
  );
  const paddedId = String(id).padStart(8, "0");
  const title = `${modelYear} ${manufacturer.name} ${model.name} ${grade}`;

  return {
    id,
    listingNo: `UC-${paddedId}`,
    slug: `used-car-${paddedId}`,
    title,
    description: `${title}, 주행거리 ${mileageKm.toLocaleString("ko-KR")}km의 수업용 가상 중고차 매물입니다. 실제 차량번호나 연락처를 포함하지 않습니다.`,
    manufacturer: {
      id: Number(manufacturer.id),
      name: manufacturer.name,
      slug: manufacturer.slug,
      country: manufacturer.country,
    },
    model: {
      id: Number(model.id),
      name: model.name,
      slug: model.slug,
      bodyType: model.bodyType,
    },
    grade,
    modelYear,
    firstRegistrationDate: firstRegistration.toISOString().slice(0, 10),
    mileageKm,
    fuelType,
    fuelName: FUEL_NAMES[fuelType] ?? fuelType,
    transmission: transmission.code,
    transmissionName: transmission.name,
    price,
    currency: "KRW",
    accidentCount,
    isAccidentFree: accidentCount === 0,
    ownerChangeCount,
    displacementCc,
    inspectionStatus,
    color: choice(COLORS, index, 0xa4d7),
    status: choice(STATUSES, index, 0xb5e9),
    viewCount: mixedNumber(index, 0xc6fb) % 50_001,
    location: {
      id: Number(location.id),
      sido: location.sido ?? location.province,
      sigungu: location.sigungu ?? location.city,
      province: location.province ?? location.sido,
      city: location.city ?? location.sigungu,
      name: location.name ?? `${location.province ?? location.sido} ${location.city ?? location.sigungu}`,
      slug: location.slug,
    },
    dealer: {
      // employeeNo is an internal FK for seeding; API mappers must omit it.
      employeeNo: employee.employeeNo,
      publicCode: employee.publicCode,
      displayName: employee.publicName,
      departmentName: employee.departmentName,
      positionName: employee.positionName,
    },
    businessArea: {
      id: businessArea.id,
      name: businessArea.name,
      parentAreaId: businessArea.parentAreaId,
      parentAreaName: businessArea.parentAreaName,
    },
    registeredAt: new Date(registeredAtTime).toISOString(),
    updatedAt: new Date(updatedAtTime).toISOString(),
  };
}

export function createSampleCars(count = DEFAULT_MEMORY_CAR_COUNT, options = {}) {
  const carCount = positiveInteger(count, DEFAULT_MEMORY_CAR_COUNT);
  const context = options?.[CONTEXT_MARKER] ? options : createCarSeedContext(options);
  return Array.from({ length: carCount }, (_, index) => createSampleCar(index, context));
}
