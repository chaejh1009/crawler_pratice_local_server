# AutoData Lab 중고차 API v1

AutoData Lab은 수업용 가상 중고차 매물을 HTML과 JSON으로 제공합니다. JSON API의 기본 주소는 `http://127.0.0.1:4000`이며 모든 정식 API 경로에는 `/api/v1` 접두사가 붙습니다.

API 응답의 기본 `Content-Type`은 `application/json; charset=utf-8`입니다. 매물과 통계 건수는 실행 모드와 시드 데이터 크기에 따라 달라질 수 있습니다.

## 엔드포인트 요약

| 메서드 | 경로 | 용도 | API 키 |
| --- | --- | --- | --- |
| `GET`, `HEAD` | `/api/v1/cars` | 매물 검색·필터·정렬·페이지네이션 | 필요 |
| `GET`, `HEAD` | `/api/v1/cars/cursor` | 대량 수집용 기본키 커서 순회 | 필요 |
| `GET`, `HEAD` | `/api/v1/changes` | 고정 snapshot 증분 변경 로그 | 필요 |
| `GET`, `HEAD` | `/api/v1/generation-runs` | append-only 생성 상태 이벤트 | 필요 |
| `GET`, `HEAD` | `/api/v1/cars/:id` | 매물 한 건 조회 | 필요 |
| `GET`, `HEAD` | `/api/v1/brands` | 제조사와 매물 수 조회 | 필요 |
| `GET`, `HEAD` | `/api/v1/locations` | 지역과 매물 수 조회 | 필요 |
| `GET`, `HEAD` | `/api/v1/business-areas` | CSV 연계 업무영역 조회 | 필요 |
| `GET`, `HEAD` | `/api/v1/stats` | 데이터셋 통계 조회 | 필요 |
| `GET`, `HEAD` | `/healthz` | 서버와 저장소 상태 확인 | 불필요 |
| `OPTIONS` | `/api/v1/*` | CORS 사전 요청 | 불필요 |

`HEAD`는 대응하는 `GET`과 같은 상태 및 헤더를 반환하지만 응답 본문은 보내지 않습니다. 정식 API는 `GET`, `HEAD`, `OPTIONS`만 지원합니다.

HTML 경로인 `/`, `/cars`, `/cars/:id`, `/changes`, `/generation-runs`, `/crawl-policy`, `/docs`, `/learning-guide`와 정적 파일은 API 키 없이 접근할 수 있습니다. 따라서 API 키는 수업에서 정식 JSON API 인증을 연습하기 위한 장치이며, 공개 HTML에 표시되는 데이터 자체를 비밀로 만드는 수단은 아닙니다.

## API 키 인증

`/api/v1` 아래의 `GET`과 `HEAD` 요청은 API 키가 필요합니다. 다음 두 방식 가운데 하나만 사용합니다.

### X-API-Key 헤더

```http
X-API-Key: ucar_v1_<발급된 키>
```

```bash
curl --include \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/cars?page_size=5'
```

### Bearer 헤더

```http
Authorization: Bearer ucar_v1_<발급된 키>
```

```bash
curl --include \
  --header "Authorization: Bearer ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/stats'
```

API 키를 쿼리 문자열에 넣는 방식은 지원하지 않습니다. `X-API-Key`와 `Authorization`을 한 요청에 동시에 보내면 모호한 인증으로 처리되어 `403 Forbidden`을 반환합니다.

키가 유효하면 응답 헤더 `X-API-Key-Prefix`에 원문 키가 아닌 공개 식별 prefix가 포함됩니다.

```http
X-API-Key-Prefix: ucar_v1_0123456789abcdef
```

발급된 원문 키는 발급 명령에서 한 번만 표시됩니다. MySQL에는 원문이 아니라 SHA-256 해시와 공개 prefix만 저장됩니다.

```bash
# 메모리 모드용 키 발급
npm run api-key:create -- --source memory --name "1반 수집 실습"

# MySQL에 해시 형태로 키 발급
npm run api-key:create -- --source mysql --name "1반 수집 실습"

# MySQL 키 폐기: 원문이 아니라 공개 prefix 사용
npm run api-key:revoke -- \
  --source mysql \
  --prefix ucar_v1_0123456789abcdef
```

메모리 모드는 발급된 키를 `UCAR_API_KEY` 또는 쉼표로 구분한 `UCAR_API_KEYS` 환경 변수에 설정한 뒤 서버를 시작합니다. 환경 변수에서 키를 제거하거나 바꾼 경우 서버를 다시 시작해야 합니다.

### 401과 403의 차이

인증 헤더를 보내지 않으면 `401 Unauthorized`입니다.

```json
{
  "error": {
    "code": "API_KEY_REQUIRED",
    "message": "X-API-Key 또는 Bearer API 키가 필요합니다."
  }
}
```

`401` 응답에는 다음 헤더가 함께 제공됩니다.

```http
WWW-Authenticate: Bearer realm="AutoData Lab API"
```

키 형식이 잘못되었거나, 존재하지 않거나, 폐기되었거나, 두 인증 헤더를 동시에 보내면 `403 Forbidden`입니다.

```json
{
  "error": {
    "code": "API_KEY_INVALID",
    "message": "API 키가 올바르지 않거나 폐기되었습니다."
  }
}
```

보안을 위해 존재하지 않는 키와 폐기된 키를 서로 다른 오류로 구분하지 않습니다.

### 요청 제한

인증된 API는 기본적으로 키별 분당 60회이며 `API_RATE_LIMIT_PER_MINUTE`로 수업 환경에 맞게 조정할 수 있습니다. DB 인증 전에 클라이언트 주소별 분당 120회의 `API_PREAUTH_RATE_LIMIT_PER_MINUTE`도 적용하므로 잘못된 키 반복과 이미 한도를 넘긴 키가 인증 저장소를 무제한 조회하지 못합니다. 정상 응답에는 `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`이 포함되고, 한도를 넘으면 `429 RATE_LIMITED`와 `Retry-After`를 반환합니다. 유효 키의 `last_used_at` 쓰기는 프로세스 안에서 최대 분당 한 번으로 샘플링합니다. HTML 데이터 경로는 기본 분당 120회이지만, 크롤러는 `/robots.txt`와 `/crawl-policy`에 따라 요청 사이에 최소 1초를 기다립니다.

## 공통 데이터 규칙

- JSON 속성은 `camelCase`, 쿼리 매개변수와 페이지 메타데이터는 `snake_case`를 사용합니다.
- 가격은 `currency`에 표시된 통화의 정수 금액입니다. 기본 통화는 `KRW`입니다.
- 거리와 배기량 단위는 각각 km와 cc입니다.
- 날짜는 `YYYY-MM-DD`, 일시는 ISO 8601 UTC 문자열입니다.
- `AVAILABLE`, `RESERVED`, `SOLD`는 각각 판매 중, 예약 중, 판매 완료 상태입니다.
- 목록 결과가 없어도 정상 조회이므로 `200 OK`와 빈 `data` 배열을 반환합니다.
- 알 수 없는 쿼리 매개변수는 무시합니다. 알려진 매개변수의 형식이나 범위가 잘못되면 `400 Bad Request`입니다.

## 중고차 매물 객체

목록, 커서, 상세 조회의 매물은 다음 구조를 공유합니다.

```json
{
  "id": 1,
  "listingNumber": "UC-00000001",
  "title": "2013 메르세데스-벤츠 GLE GLE 450",
  "description": "2013 메르세데스-벤츠 GLE GLE 450, 주행거리 148,985km의 수업용 가상 중고차 매물입니다.",
  "brand": {
    "id": 8,
    "name": "메르세데스-벤츠",
    "slug": "mercedes-benz",
    "country": "독일"
  },
  "model": {
    "id": 41,
    "name": "GLE",
    "slug": "gle",
    "bodyType": "suv"
  },
  "trim": "GLE 450",
  "modelYear": 2013,
  "firstRegistration": "2013-08-01",
  "mileageKm": 148985,
  "fuelType": "디젤",
  "transmission": "자동",
  "price": 18000000,
  "currency": "KRW",
  "color": "빨간색",
  "displacementCc": 2151,
  "accidentCount": 0,
  "ownerChangeCount": 3,
  "inspectionStatus": "점검완료",
  "status": "AVAILABLE",
  "location": {
    "id": 34,
    "province": "충청남도",
    "city": "아산시",
    "slug": "chungnam-2"
  },
  "dealer": {
    "code": "DLR-a16e35c90b",
    "displayName": "인증딜러 2373",
    "department": "데이터팀",
    "position": "과장"
  },
  "businessArea": {
    "id": "BIZ_00211",
    "name": "수도권영업팀 211",
    "parent": {
      "id": "BIZ_00013",
      "name": "수도권영업 13"
    }
  },
  "createdAt": "2024-08-17T13:27:56.000Z",
  "updatedAt": "2024-09-08T13:27:56.000Z"
}
```

`dealer.code`는 직원번호를 직접 포함하지 않고 비공개 환경 secret을 사용하는 도메인 분리 HMAC-SHA-256 기반 `DLR-<10 hex>` 공개용 가명 코드입니다. 내부 직원번호, HMAC secret, 원본 직원명은 매물 API에 포함되지 않습니다. `businessArea.parent`는 최상위 업무영역인 경우 `null`입니다.

## 매물 목록

```http
GET /api/v1/cars
```

### 쿼리 매개변수

| 이름 | 형식 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `page` | 1~100,000 정수 | `1` | 조회할 페이지 |
| `page_size` | 1~100 정수 | `20` | 페이지당 매물 수 |
| `q` | 최대 100자 문자열 | - | 매물 제목과 설명 검색 |
| `brand` | 제조사 숫자 ID 또는 slug | - | 예: `1`, `hyundai`, `mercedes-benz` |
| `location` | 지역 숫자 ID 또는 slug | - | 예: `34`, `chungnam-2` |
| `fuel` | `가솔린`, `디젤`, `하이브리드`, `전기`, `LPG` | - | 연료 종류 |
| `status` | `AVAILABLE`, `RESERVED`, `SOLD` | - | 매물 상태. 대소문자 구분 없이 입력 가능 |
| `min_price` | 0~1,000,000,000 정수 | - | 최소 가격, 경계값 포함 |
| `max_price` | 0~1,000,000,000 정수 | - | 최대 가격, 경계값 포함 |
| `min_year` | 1990~2030 정수 | - | 최소 연식, 경계값 포함 |
| `max_year` | 1990~2030 정수 | - | 최대 연식, 경계값 포함 |
| `max_mileage` | 0~1,000,000 정수 | - | 최대 주행거리 km, 경계값 포함 |
| `accident_free` | `true`/`false` 또는 `1`/`0` | - | `true`는 무사고, `false`는 사고 이력이 있는 매물 |
| `sort` | 아래 정렬값 | `newest` | 정렬 방식 |

`min_price`는 `max_price`보다 클 수 없고 `min_year`는 `max_year`보다 클 수 없습니다. `brand`와 `location`의 slug는 영문 소문자, 숫자, 하이픈 형식입니다.

### 정렬값

| 값 | 의미 |
| --- | --- |
| `newest` | 최신 등록순 |
| `price_asc` | 낮은 가격순 |
| `price_desc` | 높은 가격순 |
| `mileage_asc` | 짧은 주행거리순 |
| `year_desc` | 최신 연식순. 같은 연식은 짧은 주행거리 우선 |

### 응답

```json
{
  "data": [
    {
      "id": 1,
      "listingNumber": "UC-00000001",
      "title": "2013 메르세데스-벤츠 GLE GLE 450",
      "modelYear": 2013,
      "mileageKm": 148985,
      "fuelType": "디젤",
      "price": 18000000,
      "currency": "KRW",
      "status": "AVAILABLE"
    }
  ],
  "meta": {
    "page": 2,
    "page_size": 20,
    "total": 100000,
    "total_pages": 5000,
    "returned": 20,
    "sort": "price_asc",
    "filters": {
      "q": "쏘나타",
      "brand": "hyundai",
      "fuel": "가솔린",
      "status": "AVAILABLE",
      "location": "seoul-1",
      "min_price": 10000000,
      "max_price": 40000000,
      "min_year": 2020,
      "max_year": 2026,
      "max_mileage": 100000,
      "accident_free": true
    }
  },
  "links": {
    "self": "/api/v1/cars?page=2&page_size=20",
    "next": "/api/v1/cars?page=3&page_size=20",
    "previous": "/api/v1/cars?page=1&page_size=20"
  }
}
```

위 `data` 항목은 설명을 위해 일부 속성만 표시했습니다. 실제 항목은 [중고차 매물 객체](#중고차-매물-객체)의 전체 구조를 사용합니다.

첫 페이지의 `links.previous`와 마지막 페이지의 `links.next`는 `null`입니다. 필터와 정렬 쿼리는 페이지 링크에도 유지됩니다. 범위를 벗어난 페이지는 오류가 아니라 빈 배열을 반환하며, `total_pages`는 결과가 0건이어도 최소 `1`입니다.

### curl 예제

```bash
curl --get 'http://127.0.0.1:4000/api/v1/cars' \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=50' \
  --data-urlencode 'q=쏘나타' \
  --data-urlencode 'brand=hyundai' \
  --data-urlencode 'location=seoul-1' \
  --data-urlencode 'fuel=가솔린' \
  --data-urlencode 'status=AVAILABLE' \
  --data-urlencode 'min_price=10000000' \
  --data-urlencode 'max_price=40000000' \
  --data-urlencode 'min_year=2020' \
  --data-urlencode 'max_mileage=100000' \
  --data-urlencode 'accident_free=true' \
  --data-urlencode 'sort=price_asc'
```

## 대량 수집용 커서

차량 목록과 커서는 MySQL의 현재 projection을 제공합니다. 초기 seed 차량은 MongoDB 생성 mirror 대상이 아니며, `PARTIAL_FAILED` run의 현재 차량도 복구 전에 보일 수 있습니다. MySQL·MongoDB 양쪽 검증이 끝난 증분만 필요하면 `SUCCESS` run만 게시하는 [변경 로그](#증분-변경-로그)를 사용합니다.

```http
GET /api/v1/cars/cursor?after_id=0&limit=100
```

기본키 `id`를 기준으로 전체 매물을 순회합니다. 큰 `OFFSET`을 건너뛰거나 매 요청마다 전체 건수를 계산하지 않으므로 대량 적재 실습에 적합합니다.

| 이름 | 형식 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `after_id` | 0 이상의 안전한 정수 | `0` | 직전 응답에서 마지막으로 받은 매물 ID |
| `until_id` | 0 이상의 안전한 정수 | 첫 요청 시 현재 최대 ID | 이번 순회에서 넘지 않을 고정 snapshot 상한 |
| `dataset_epoch` | 서버가 반환한 문자열 | 생략 | 재시드 감지용 데이터셋 식별자. 첫 응답 뒤에는 반드시 그대로 재전송 |
| `limit` | 1~500 정수 | `100` | 한 번에 받을 최대 매물 수 |

커서 API는 검색, 필터, 임의 정렬을 지원하지 않으며 항상 `id` 오름차순으로 반환합니다.

```json
{
  "data": [
    {
      "id": 1,
      "listingNumber": "UC-00000001",
      "title": "2013 메르세데스-벤츠 GLE GLE 450"
    },
    {
      "id": 2,
      "listingNumber": "UC-00000002",
      "title": "2022 현대 아반떼 모던"
    }
  ],
  "meta": {
    "dataset_epoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "after_id": 0,
    "until_id": 100000,
    "limit": 100,
    "returned": 100,
    "has_more": true
  },
  "links": {
    "self": "/api/v1/cars/cursor?after_id=0&limit=100",
    "next": "/api/v1/cars/cursor?after_id=100&until_id=100000&limit=100&dataset_epoch=f46a26d1-9772-4873-974f-d796fdcb5b8f"
  }
}
```

위 `data` 항목은 일부 속성만 표시했습니다. 실제 매물은 전체 매물 객체입니다. 첫 응답이 고정한 `meta.until_id`와 `meta.dataset_epoch`는 모든 `links.next`에 유지되므로 생성기가 새 매물을 추가해도 이번 순회는 유한하고 재시드를 감지할 수 있습니다. `links.next`가 `null`이면 수집이 끝난 것입니다. 다음 링크를 호출할 때도 API 키 헤더를 다시 보내야 하며, 링크 자체에는 키가 포함되지 않습니다.

```bash
curl --get 'http://127.0.0.1:4000/api/v1/cars/cursor' \
  --header "Authorization: Bearer ${UCAR_API_KEY}" \
  --data-urlencode 'after_id=0' \
  --data-urlencode 'limit=500'
```

## 증분 변경 로그

```http
GET /api/v1/changes?after_seq=0&limit=100
```

MySQL과 MongoDB에 함께 적재를 마쳐 `generation_runs.status='SUCCESS'`가 된 합성 차량 이벤트만 `seq` 오름차순으로 반환합니다. 실패·부분 실패 run의 payload는 terminal 성공 전까지 공개 feed에 나타나지 않습니다. 첫 요청에서 `until_seq`를 생략하면 서버가 성공 run 가운데 현재 마지막 `seq`를 high-water mark로 고정합니다. 미래 `until_seq`를 명시하면 현재 watermark로 낮춥니다. 이후에는 `links.next`를 그대로 따라가야 합니다. 수집 중 새 이벤트가 생겨도 고정된 `until_seq`보다 큰 이벤트는 다음 실행으로 넘기므로 이번 순회는 반드시 끝납니다.

| 이름 | 형식 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `after_seq` | 0 이상의 정수 | `0` | 직전 응답의 마지막 `seq` |
| `until_seq` | 0 이상의 정수 | 첫 요청 시 현재 최대값 | 이번 snapshot의 닫힌 상한 |
| `dataset_epoch` | 서버가 반환한 문자열 | 생략 | 재시드 감지용 데이터셋 식별자. 첫 응답 뒤에는 반드시 그대로 재전송 |
| `limit` | 1~500 정수 | `100` | 한 응답의 최대 이벤트 수 |

```json
{
  "data": [{
    "seq": 1,
    "eventId": "64자리 sha256",
    "runId": 1,
    "runKey": "slot-20260810T03",
    "operation": "UPSERT",
    "listingId": 100001,
    "listingNumber": "UC-00100001",
    "entityVersion": 1,
    "occurredAt": "2026-08-10T03:00:00.000Z",
    "sourceChecksum": "64자리 sha256",
    "payload": { "id": 100001, "listingNumber": "UC-00100001" }
  }],
  "meta": {
    "dataset_epoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "after_seq": 0,
    "until_seq": 24000,
    "limit": 100,
    "returned": 100,
    "has_more": true
  },
  "links": {
    "next": "/api/v1/changes?after_seq=100&until_seq=24000&limit=100&dataset_epoch=f46a26d1-9772-4873-974f-d796fdcb5b8f"
  }
}
```

`eventId`와 `(listingNumber, entityVersion)`은 한 `dataset_epoch` 안의 멱등 키입니다. 같은 `runKey`를 재실행해도 이벤트 수가 늘지 않습니다. 첫 응답의 epoch를 target checkpoint와 함께 저장하고 후속 요청에 다시 보냅니다. 공개 payload에는 내부 직원번호와 원문 API 키가 포함되지 않습니다.

## 데이터 생성 상태 이벤트

```http
GET /api/v1/generation-runs?after_id=0&limit=50
```

`generation_runs`의 변경 가능한 최신 행을 직접 페이지네이션하지 않고, `generation_run_events`의 append-only 상태 전이를 조회합니다. 기존 URL 호환을 위해 `after_id`, `until_id` 이름을 유지하지만 여기서 ID는 **run ID가 아니라 상태 event ID**입니다. 응답 항목의 `id`와 `eventId`가 cursor이고 `runId`가 실제 실행 ID입니다.

첫 요청은 현재 최대 event ID를 `meta.until_id`로 고정하고 현재 `dataset_epoch`도 반환합니다. 명시한 `until_id`가 현재 watermark보다 미래이면 서버가 현재 값으로 낮춰 응답하므로 meta와 실제 조회 범위가 일치합니다. 후속 `links.next`는 두 값을 모두 유지합니다. `status`는 `RUNNING`, `SUCCESS`, `PARTIAL_FAILED`, `FAILED` 중 하나이며 같은 `runId`가 재시도되면 `PARTIAL_FAILED → RUNNING → SUCCESS`처럼 여러 항목으로 나타납니다. `mysqlCount`와 `mongoCount`는 해당 전이 시점의 snapshot이고 오류 문구는 자격증명과 연결 문자열을 제거한 최대 500자 요약입니다.

```json
{
  "data": [
    {
      "id": 42,
      "eventId": 42,
      "runId": 17,
      "runKey": "hourly-20260810T09",
      "status": "PARTIAL_FAILED",
      "requestedCount": 1000,
      "mysqlCount": 1000,
      "mongoCount": 500,
      "occurredAt": "2026-08-10T09:00:12.000Z"
    }
  ],
  "meta": {
    "dataset_epoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "after_id": 41,
    "until_id": 42,
    "has_more": false
  },
  "links": { "next": null }
}
```

## 매물 한 건

```http
GET /api/v1/cars/:id
```

`id`는 양의 정수입니다. 성공하면 전체 매물 객체를 `data`에 담습니다.

```json
{
  "data": {
    "id": 1,
    "listingNumber": "UC-00000001",
    "title": "2013 메르세데스-벤츠 GLE GLE 450",
    "modelYear": 2013,
    "mileageKm": 148985,
    "price": 18000000,
    "currency": "KRW",
    "status": "AVAILABLE"
  }
}
```

위 예시는 일부 속성만 표시했습니다. 존재하지 않는 숫자 ID는 `404 Not Found`와 `CAR_NOT_FOUND`를 반환합니다. 숫자가 아닌 경로는 매물 ID 경로로 인식되지 않아 `ENDPOINT_NOT_FOUND`가 됩니다.

```bash
curl \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/cars/1'
```

## 제조사

```http
GET /api/v1/brands
```

제조사별 전체 매물 수를 반환합니다. 페이지네이션은 없습니다.

```json
{
  "data": [
    {
      "id": 1,
      "name": "현대",
      "slug": "hyundai",
      "country": "대한민국",
      "carCount": 8334
    }
  ]
}
```

```bash
curl \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/brands'
```

## 지역

```http
GET /api/v1/locations
```

시·도와 시·군·구 조합별 매물 수를 반환합니다. `slug`는 매물 목록의 `location` 필터에 사용할 수 있습니다. 페이지네이션은 없습니다.

```json
{
  "data": [
    {
      "id": 1,
      "province": "서울특별시",
      "city": "강남구",
      "slug": "seoul-1",
      "carCount": 2041
    }
  ]
}
```

```bash
curl \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/locations'
```

## 업무영역

```http
GET /api/v1/business-areas
```

직원 마스터 및 업무영역 CSV와 연결되는 업무영역 데이터를 조회합니다.

| 이름 | 형식 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `page` | 1~100,000 정수 | `1` | 조회할 페이지 |
| `page_size` | 1~100 정수 | `20` | 페이지당 업무영역 수 |
| `q` | 최대 100자 문자열 | - | 업무영역 ID와 이름 검색 |
| `parent_id` | 최대 32자의 영문·숫자·`_`·`-` | - | 부모 업무영역 ID가 정확히 일치하는 하위 영역만 조회 |

```json
{
  "data": [
    {
      "id": "BIZ_00211",
      "name": "수도권영업팀 211",
      "parent": {
        "id": "BIZ_00013",
        "name": "수도권영업 13"
      },
      "manager": {
        "code": "DLR-a16e35c90b",
        "displayName": "김○○"
      },
      "carCount": 42,
      "registeredAt": "2024-03-12"
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 20,
    "total": 50000,
    "total_pages": 2500,
    "returned": 20
  },
  "links": {
    "self": "/api/v1/business-areas?page=1&page_size=20",
    "next": "/api/v1/business-areas?page=2&page_size=20",
    "previous": null
  }
}
```

`parent`는 최상위 업무영역이면 `null`입니다. `manager`에는 공개용 `code`와 마스킹된 `displayName`만 포함됩니다. 원본 직원번호, 원본 이름 및 그 밖의 직원 마스터 속성은 이 엔드포인트로 공개하지 않습니다.

```bash
curl --get 'http://127.0.0.1:4000/api/v1/business-areas' \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=50' \
  --data-urlencode 'q=수도권' \
  --data-urlencode 'parent_id=BIZ_00013'
```

## 통계

```http
GET /api/v1/stats
```

```json
{
  "data": {
    "datasetEpoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "carCount": 100000,
    "availableCount": 80000,
    "brandCount": 12,
    "locationCount": 49,
    "employeeCount": 3000,
    "businessAreaCount": 50000,
    "changeCount": 24000,
    "pendingChangeCount": 0,
    "generationRunCount": 24,
    "incompleteGenerationRunCount": 0,
    "generationRunEventCount": 48,
    "latestGenerationRunEventId": 48,
    "latestChangeSeq": 24000,
    "source": "mysql"
  }
}
```

| 필드 | 의미 |
| --- | --- |
| `datasetEpoch` | 현재 데이터셋 수명주기 식별자. cursor checkpoint의 namespace로 사용 |
| `carCount` | 전체 중고차 매물 수 |
| `availableCount` | `AVAILABLE` 매물 수 |
| `brandCount` | 제조사 수 |
| `locationCount` | 지역 수 |
| `employeeCount` | 연계된 직원 마스터 레코드 수 |
| `businessAreaCount` | 연계된 업무영역 수 |
| `changeCount` | 수집 가능한 변경 이벤트 수 |
| `pendingChangeCount` | 아직 MongoDB 검증·SUCCESS 공개 전인 변경 이벤트 수 |
| `generationRunCount` | 합성 데이터 생성 실행 수 |
| `incompleteGenerationRunCount` | 복구가 끝나기 전이라 신규 run에 backpressure를 거는 실행 수 |
| `generationRunEventCount` | append-only 실행 상태 전이 수 |
| `latestGenerationRunEventId` | 실행 상태 feed의 현재 high-water mark |
| `latestChangeSeq` | 현재 변경 로그 high-water mark |
| `source` | 현재 저장소인 `memory` 또는 `mysql` |

```bash
curl \
  --header "Authorization: Bearer ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/stats'
```

## 상태 확인

```http
GET /healthz
```

`/healthz`는 API 키가 필요하지 않습니다. HTTP 조회의 기준 저장소인 MySQL(또는 memory)과 MySQL `dataset_state`가 정상이면 `200 OK`입니다. MongoDB 연결과 양쪽 document parity까지 검사하는 endpoint는 아니므로, MongoDB 복구 상태는 `/generation-runs`, `pendingChangeCount`, 생성기 검증 log로 함께 확인합니다.

```json
{
  "ok": true,
  "source": "memory",
  "datasetEpoch": "memory-v1"
}
```

MySQL 모드의 정상 응답에는 `latencyMs`도 포함됩니다.

```json
{
  "ok": true,
  "source": "mysql",
  "latencyMs": 3,
  "datasetEpoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
  "incompleteGenerationRunCount": 0
}
```

저장소 점검에 실패하거나 MySQL의 `dataset_state`가 없거나 `READY`가 아니면 `503 Service Unavailable`과 `ok: false`, 공개용 `DATASTORE_UNAVAILABLE`만 반환합니다. 내부 DB 오류 상세는 서버 log에만 남습니다. `incompleteGenerationRunCount`가 0보다 크면 생성기는 해당 run을 먼저 복구하며 신규 생성을 보류합니다.

```bash
curl --include 'http://127.0.0.1:4000/healthz'
```

## 오류 형식

`/api/v1/*` 오류는 같은 envelope를 사용합니다.

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "page 값은 1 이상 100000 이하여야 합니다.",
    "details": {
      "field": "page",
      "min": 1,
      "max": 100000
    }
  }
}
```

`details`는 추가 정보가 있을 때만 포함됩니다.

| HTTP 상태 | 코드 | 의미 |
| --- | --- | --- |
| `400` | `INVALID_QUERY` | 알려진 쿼리 매개변수의 형식, 범위 또는 조합이 잘못됨 |
| `400` | `INVALID_REQUEST_URL` | 요청 URL 형식이 잘못됨 |
| `401` | `API_KEY_REQUIRED` | 인증 헤더가 없음 |
| `403` | `API_KEY_INVALID` | 키가 잘못되었거나 폐기됨, 또는 인증 헤더가 모호함 |
| `409` | `DATASET_EPOCH_CHANGED` | 재시드로 데이터셋이 바뀜. 응답 `details.current` 기준으로 새 target namespace와 checkpoint 필요 |
| `404` | `CAR_NOT_FOUND` | 요청한 숫자 ID의 매물이 없음 |
| `404` | `ENDPOINT_NOT_FOUND` | API 경로가 존재하지 않음 |
| `405` | `METHOD_NOT_ALLOWED` | 지원하지 않는 HTTP 메서드. `Allow: GET, HEAD, OPTIONS` 포함 |
| `429` | `RATE_LIMITED` | 키 또는 HTML 클라이언트의 요청 한도 초과. `Retry-After` 준수 |
| `500` | `INTERNAL_ERROR` | 서버가 요청을 처리하지 못함 |
| `503` | `DATASET_NOT_READY` | seed/reset이 완료되지 않아 데이터 경로를 fail-closed로 차단함 |
| `503` | `SERVICE_UNAVAILABLE` | 데이터 저장소 연결 또는 대기열이 일시적으로 포화됨 |
| `503` | `API_AUTH_UNAVAILABLE` | API 키 인증 저장소가 준비되지 않음 |

인증은 API 라우팅보다 먼저 수행됩니다. 따라서 존재하지 않는 `/api/v1/*` 경로도 키가 없으면 먼저 `401`, 잘못된 키면 먼저 `403`을 반환할 수 있습니다.

```bash
# 인증 헤더가 없으므로 401
curl --include 'http://127.0.0.1:4000/api/v1/cars'

# 유효한 키를 넣었지만 page가 범위를 벗어나므로 400
curl --include \
  --header "X-API-Key: ${UCAR_API_KEY}" \
  'http://127.0.0.1:4000/api/v1/cars?page=0'
```

## CORS

수업 중 다른 포트에서 실행한 노트북이나 웹 페이지에서도 API를 호출할 수 있도록 다음 정책을 사용합니다.

- `Access-Control-Allow-Origin: *`
- 허용 메서드: `GET`, `HEAD`, `OPTIONS`
- 허용 요청 헤더: `Content-Type`, `Accept`, `X-API-Key`, `Authorization`
- 브라우저 JavaScript에 노출하는 응답 헤더: `X-API-Key-Prefix`, `RateLimit-*`, `Retry-After`

`OPTIONS` 사전 요청에는 API 키가 필요하지 않습니다.

```bash
curl --include --request OPTIONS \
  'http://127.0.0.1:4000/api/v1/cars' \
  --header 'Origin: http://127.0.0.1:8888' \
  --header 'Access-Control-Request-Method: GET' \
  --header 'Access-Control-Request-Headers: X-API-Key'
```

## 수집 시 유의사항

- 검색·필터·정렬 학습에는 `/api/v1/cars`, 전체 snapshot에는 `/api/v1/cars/cursor`, 증분 적재에는 `/api/v1/changes`를 사용합니다.
- `links.next`에는 인증 정보가 없으므로 모든 후속 요청에 API 키 헤더를 다시 전달합니다.
- 커서 응답의 `meta.dataset_epoch`를 checkpoint와 함께 저장하고 `links.next`를 따릅니다. 직접 URL을 만들 때는 같은 `dataset_epoch`를 넣으며, `409 DATASET_EPOCH_CHANGED`가 오면 이전 cursor를 이어 쓰지 않습니다.
- 한 번에 모든 데이터를 메모리에 쌓기보다 페이지 또는 커서 묶음 단위로 파일이나 데이터베이스에 저장합니다.
- 로그, 노트북 출력, URL, 공유 문서에 원문 API 키를 남기지 않습니다.
- 이 서버의 데이터는 수업용 합성 데이터이며 수집 허용 범위는 `/crawl-policy`에만 적용됩니다. 실제 사이트 수집에서는 이용약관, 저작권·데이터베이스 권리, 개인정보, 접근통제, API 라이선스와 요청 부하를 각각 확인해야 합니다.
