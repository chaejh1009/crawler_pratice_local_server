# Day 21~23 외부 live 대체 크롤링 샌드박스 가이드

이 문서는 Encore Chapter 1 Day 21~23의 외부 API·HTML live 수집을 **AutoData Lab 로컬 샌드박스**로 대체하는 교사용·학습자용 운영 가이드다. 샌드박스는 합성 중고차 데이터를 HTML과 인증 JSON API로 제공하고, 주기 생성 결과를 MySQL과 MongoDB에 멱등 적재한 뒤 변경 로그와 적재 실행 기록을 다시 수집할 수 있게 한다.

기본 주소는 다음과 같이 표기한다.

```text
http://127.0.0.1:4000
```

같은 Wi-Fi의 교사 PC에서 실행한다면 학습자는 `127.0.0.1` 대신 교사가 안내한 사설 IP와 포트를 사용한다. 이 서버는 교실·로컬 네트워크용이며 인터넷에 직접 공개하지 않는다.

## 1. 기존 교안과의 경계

### 외부 크롤링을 일률적으로 불법이라고 단정하지 않는다

외부 수집은 언제나 불법인 것도 아니고, 공개 페이지라는 이유만으로 언제나 허용되는 것도 아니다. 실제 사이트를 수집하기 전에는 대상별로 다음 항목을 따로 확인해야 한다.

- 이용약관과 API 이용조건
- 저작권·데이터베이스 권리·재배포 조건
- 개인정보 및 민감정보 포함 여부
- 로그인, 인증, 유료 구독, CAPTCHA 같은 접근통제
- `robots.txt`와 사이트가 안내하는 자동 수집 정책
- 요청 빈도·동시성·데이터 양이 서비스에 주는 부하
- API key, cookie, 인증 header와 원문 응답의 보관·제출 범위

`robots.txt` 허용은 중요한 기술적 신호지만 저작권 이용허락이나 계약상 허가 전체를 대신하지 않는다. 반대로 `robots.txt` 한 항목만으로 모든 법적 판단을 단정하지도 않는다. 권한이나 이용 범위가 불명확하면 외부 live 수집을 진행하지 않고 fixture 또는 이 샌드박스를 사용한다.

### Day 21~23의 live 수집은 optional이다

기존 교안의 공통 완료선은 외부 서비스의 현재 상태나 API key 승인 여부와 무관하게 재현돼야 한다. 따라서 다음 세 profile을 구분한다.

| profile | 입력 | 용도 |
| --- | --- | --- |
| `fixture` | 저장된 작은 공식 형태 sample | parser·실패 경로·회귀 테스트 |
| `sandbox` | AutoData Lab의 합성 HTML·JSON | 교실 공통 수집·페이지네이션·증분 처리 |
| `live` | 별도 승인을 받은 실제 외부 source | 모든 정책 검토를 통과한 경우의 선택 활동 |

샌드박스의 수집 허가는 이 AutoData Lab host에만 적용된다. `/crawl-policy`의 허용 문장을 제3자 사이트에 그대로 적용해서는 안 된다.

### source와 학습자 적재 target을 구분한다

AutoData Lab 내부 MySQL·MongoDB는 교사가 운영하는 **source server의 저장소**다. 학습자가 Day 22에 구현하는 MySQL·MongoDB repository는 수집 결과를 저장하는 **학습자 pipeline의 target**이다. 같은 PC를 사용하더라도 database/schema 또는 container를 분리하고, 학습자가 source server 내부 table을 직접 변경하지 않게 한다.

```text
AutoData Lab MySQL·MongoDB
  → HTML 또는 JSON으로 공개
  → 학습자 collector
  → transformer·quality
  → 학습자 MySQL·MongoDB
```

## 2. 공통 준비

### 교사 준비

Day 21의 HTML 구조 확인만 할 때는 memory mode로 시작할 수 있다.

```bash
npm install
npm start
```

Day 23의 실제 MySQL·MongoDB 이중 적재와 생성기 실습까지 진행하려면 두 저장소를 먼저 준비한다.

먼저 `.env.example`을 기준으로 `.env`를 만들고 `DATA_SOURCE=mysql`로 바꾼다. 기본 `DB_*`, `MONGO_URI`, `MONGO_DB_NAME` 값은 `compose.yaml`의 loopback 설정과 일치해야 한다. 실제 CSV를 사용하는 수업은 네 `*_CSV_PATH`도 먼저 확인한다.

`.env`에는 API key와 HMAC secret이 있으므로 `chmod 600 .env`로 현재 사용자만 읽게 한다. 공개 딜러 코드와 마스킹 이름은 가명처리이며 익명화가 아니므로, CSV 원본은 승인된 합성 또는 내부 실습 자료만 사용하고 학습자 응답·로그·Git에 배포하지 않는다.

딜러 공개 코드는 직원번호를 그대로 변형하지 않고 별도 HMAC secret으로 만든다. 최초 한 번 `openssl rand -hex 32`로 생성한 값을 `.env`의 `DEALER_PUBLIC_ID_SECRET`에 넣고 Git·강의자료·학습자 환경에는 공유하지 않는다. 이 값을 바꾸면 기존 MySQL API와 MongoDB 공개 문서의 딜러 코드가 달라지므로 같은 sandbox 수명 동안 백업·보존한다. 값이 없거나 32자 미만이면 서버와 생성기는 fail-closed로 시작하지 않는다.

```bash
docker compose up -d mysql mongo
npm run db:seed -- --count=100000 --require-csv=true --reset-mongo=true
npm run api-key:create -- --source mysql --name "Encore Day 21-23"
npm start
```

Docker named volume을 이미 사용하던 환경에서는 컨테이너를 다시 시작해도 `/docker-entrypoint-initdb.d`의 변경된 스키마가 재실행되지 않는다. 이번 버전은 MySQL과 MongoDB에 동기화된 `dataset_epoch` 초기화가 필요하므로 기존 volume에 `schema.sql`만 적용해서는 안 된다. HTTP 서버와 생성기를 멈추고 필요한 실습 결과를 백업한 뒤 `db:seed --reset-mongo=true`를 실행한다. 합성 기준 데이터와 생성 run·변경 로그는 다시 만들어지지만 API key는 보존된다.

재시드는 source의 ID·event cursor가 1부터 다시 시작하는 새 데이터셋 수명주기다. crawler는 첫 응답의 `meta.dataset_epoch`를 checkpoint에 저장하고 후속 요청에 다시 보낸다. 재시드 뒤 예전 epoch를 보내면 `409 DATASET_EPOCH_CHANGED`가 반환되므로, 교사는 학습자 target namespace와 cursor checkpoint를 새로 만들도록 공지한다. 운영 중 증분 추가는 재시드 대신 generator로 수행한다.

교사는 발급 명령에서 한 번만 보이는 API key를 별도 안전한 채널로 전달한다. key 원문을 화면 캡처, 실습 보고서, Git, 채팅방 공개 메시지에 남기지 않는다. 학습자는 key를 환경 변수에 넣고 URL query가 아닌 header로 전송한다.

`--reset-mongo=true`는 재시드로 MySQL 변경 cursor가 1부터 다시 시작할 때 기존 MongoDB mirror와 충돌하지 않도록 생성기 전용 네 컬렉션(`vehicle_listings`, `listing_change_log`, `generation_runs`, `generation_run_events`)만 함께 비운다. seed 시작 시 양쪽 `dataset_state`는 `RESETTING`, 모든 적재가 끝난 뒤에만 같은 새 epoch의 `READY`가 된다. 이중 저장소의 안전 기본값이므로 옵션을 생략해도 `SEED_RESET_MONGO=true`가 적용되고, 명시적으로 `false`로 바꾸면 seed가 fail-closed로 거부된다. 재시드가 실패하면 health/API/generator가 닫힌 상태이므로 서버·생성기를 시작하지 말고 seed를 다시 완료한다.

```bash
export AUTODATA_API_KEY='교사가 전달한 값'
export AUTODATA_BASE_URL='http://127.0.0.1:4000'
```

수업 시작 전 다음 주소를 확인한다.

```text
GET /healthz
GET /crawl-policy
GET /robots.txt
GET /cars?page_size=5
```

### 학습자 공통 규칙

- HTML 요청 사이에는 최소 1초를 둔다.
- HTML은 `a[rel="next"]`가 있을 때만 다음 페이지로 이동한다.
- JSON API는 `X-API-Key` 또는 `Authorization: Bearer` 중 하나의 header만 사용한다.
- `429`가 오면 즉시 요청을 멈추고 `Retry-After`, `RateLimit-*` header를 기록한다.
- API key, Authorization header, cookie, DB URI 전체를 log에 남기지 않는다.
- raw에는 source URL, 수집 시각, 응답 checksum, snapshot high-water mark를 함께 남긴다.
- 재실행은 insert-only가 아니라 stable key 기반 upsert로 처리한다.

API는 `/robots.txt`에서 `Disallow: /api/`로 표시된다. 이는 익명 HTML crawler가 API 경로를 무단 순회하지 않게 하는 경계다. 교사가 발급한 key와 `/crawl-policy`의 명시적 계약에 따라 수행하는 JSON API 실습은 별도의 인증된 사용 경로다.

## 3. Day 21 — 허용 범위와 HTML 계약 확정

Day 21의 목표는 많은 데이터를 받는 것이 아니라, 수집 전에 source·정책·selector·중단 조건을 고정하고 작은 HTML 경로를 한 번 연결하는 것이다.

### 3.1 `/crawl-policy`를 먼저 읽는다

브라우저 또는 `requests`로 다음 페이지를 확인한다.

```text
GET /crawl-policy
```

source registry에는 최소한 다음 내용을 기록한다.

```yaml
sources:
  autodata_sandbox:
    mode: html-and-json
    owner: classroom-instructor
    base_url: http://127.0.0.1:4000
    crawl_policy_url: http://127.0.0.1:4000/crawl-policy
    robots_url: http://127.0.0.1:4000/robots.txt
    data_classification: synthetic
    allowed_html_paths:
      - /cars
      - /changes
      - /generation-runs
    request_interval_seconds: 1
    api_credential_env: AUTODATA_API_KEY
    external_live_required: false
```

실제 수업망 주소를 사용했다면 제출본에는 필요한 범위의 사설 주소만 남기고 credential을 포함하지 않는다. source registry의 허용 범위는 `/crawl-policy`와 모순되면 안 된다.

### 3.2 `/cars` HTML을 수집한다

```text
GET /cars?page=1&page_size=20
```

이 게시판과 연결된 상세 화면은 토큰 없이 조회할 수 있지만, ID 순으로 고정한 최초 최대 10,000건만 HTML에 공개한다. 검색·필터·정렬은 이 공개 집합 안에서만 동작한다. 전체 데이터는 현재 일일 키를 헤더에 넣은 `/api/v1/cars` 또는 `/api/v1/cars/cursor`로 수집한다.

안정 selector 계약은 다음과 같다.

| 의미 | selector 또는 attribute |
| --- | --- |
| 목록 container | `[data-car-list]` |
| 게시판 행 | `article.car-card[data-car-id]` |
| 제목 | `[data-field="title"]` |
| 가격 | `[data-field="price"]`의 `value` |
| 주행거리 | `[data-field="mileage"]` |
| 다음 페이지 | `a[rel="next"]` |

학습자는 첫 페이지에서 card 수, 필수 selector 누락 수, 첫·마지막 `data-car-id`를 기록한다. 다음 링크를 직접 문자열로 추측하지 말고 현재 문서의 `href`를 기준 URL과 결합한다. `rel=next`가 없으면 정상 종료한다.

### 3.3 `/changes` HTML을 유한하게 수집한다

```text
GET /changes?after_seq=0&limit=24
```

`/changes`는 계속 추가될 수 있는 변경 이벤트를 보여 주지만, 첫 응답에서 high-water mark를 고정하므로 한 번의 순회는 유한하게 끝난다.

| 의미 | selector 또는 attribute |
| --- | --- |
| 목록과 snapshot 상한 | `[data-change-list][data-snapshot-until]` |
| 변경 event | `article[data-change-event]` |
| cursor | `[data-seq]` |
| event identity | `[data-event-id]` |
| operation | `[data-operation]` 또는 `[data-field="operation"]` |
| 차량 식별자 | `[data-field="listing-number"]` |
| entity version | `[data-field="entity-version"]` |
| 발생 시각 | `[data-field="occurred-at"] time[datetime]` |
| 생성 실행 | `[data-field="run-key"]` |
| 다음 page | `a[rel="next"]` |

첫 응답의 `data-snapshot-until`을 `H`라고 하면 이번 수집은 `seq <= H`까지만 처리한다. 다음 링크에는 같은 `until_seq=H`가 들어 있어야 한다. 수집 도중 생성기가 새 event를 추가하더라도 `H`보다 큰 값은 다음 실행으로 넘긴다.

### 3.4 Day 21 종료 증거

- `/crawl-policy` 확인 시각과 policy 핵심 요약
- `/robots.txt`의 HTML 허용 경로와 1초 간격
- `/cars` 첫 page의 selector 검증 결과
- `/changes`의 첫 high-water mark와 마지막 수집 `seq`
- 개인정보·실차량번호·API key가 sample과 log에 없다는 확인
- `fixture`, `sandbox`, optional `live`의 역할 구분
- 한 명령 또는 한 script로 작은 HTML smoke run을 재현한 결과

## 4. Day 22 — 인증 API와 high-water mark 증분 수집

Day 22에서는 현재 상태 조회와 변경 이력 조회를 분리한다.

```text
/api/v1/cars     = 현재 보이는 차량 상태를 검색·필터·페이지 조회
/api/v1/changes  = append-only sequence로 변경을 증분 조회
```

### 4.1 API 인증과 오류 경계

```bash
curl "$AUTODATA_BASE_URL/api/v1/cars?page=1&page_size=5" \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

API key가 없으면 `401`, 유효하지 않거나 폐기된 key이면 `403`이다. 원문 key는 응답에 포함되지 않으며 공개 prefix만 응답 header에 나타날 수 있다. `401`, `403`, query 형식 오류는 같은 요청을 빠르게 반복해 해결하지 않는다.

### 4.2 `/api/v1/cars` 현재 상태 수집

```text
GET /api/v1/cars?page=1&page_size=100
```

응답 envelope은 `data`, `meta`, `links`로 나뉜다.

- `data`: 차량 document 배열
- `meta.page`, `meta.page_size`, `meta.total`, `meta.returned`: page 건수
- `links.next`: 다음 page 또는 `null`
- `links.previous`: 이전 page 또는 `null`

검색·필터·정렬 실습에는 `/api/v1/cars`를 사용한다. 생성기가 동시에 쓰는 동안 전체 baseline을 수집할 때는 page 번호만 무작정 증가시키지 말고, 교사가 생성기를 잠시 멈춘 정적 구간을 사용하거나 `/api/v1/cars/cursor`와 `/api/v1/changes`를 조합한다. 현재 상태 page는 변경 event snapshot을 대신하지 않는다.

### 4.3 `/api/v1/changes` high-water mark 알고리즘

첫 요청에서는 `until_seq`를 보내지 않는다.

```bash
curl "$AUTODATA_BASE_URL/api/v1/changes?after_seq=0&limit=500" \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

첫 응답 예시는 다음 계약을 따른다.

```json
{
  "data": [
    { "seq": 1, "eventId": "64자리 sha256", "operation": "UPSERT" },
    { "seq": 2, "eventId": "64자리 sha256", "operation": "UPSERT" }
  ],
  "meta": {
    "dataset_epoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "after_seq": 0,
    "until_seq": 3,
    "limit": 2,
    "returned": 2,
    "has_more": true
  },
  "links": {
    "self": "/api/v1/changes?after_seq=0&limit=2",
    "next": "/api/v1/changes?after_seq=2&until_seq=3&limit=2&dataset_epoch=f46a26d1-9772-4873-974f-d796fdcb5b8f"
  }
}
```

위 숫자는 구조 설명용이며 실제 값은 실행 시점에 달라진다. 안전한 수집 순서는 다음과 같다.

1. 저장된 checkpoint `after_seq`와 `dataset_epoch`를 읽는다. 처음이면 각각 `0`, 없음이다.
2. `until_seq` 없이 첫 요청을 보낸다.
3. 첫 응답의 `meta.until_seq`와 `meta.dataset_epoch`를 이번 run의 high-water mark `H` 및 dataset namespace로 저장한다.
4. 각 `data` batch를 `eventId` 또는 `seq` unique key로 upsert한다.
5. DB commit이 성공한 뒤에만 마지막 처리 `seq`를 임시 checkpoint로 갱신한다.
6. `links.next`를 그대로 따라가며 모든 요청에서 같은 `until_seq=H`와 `dataset_epoch`인지 확인한다.
7. `links.next == null`이고 마지막 `seq == H`이면 run을 성공으로 닫는다.
8. 다음 scheduled run은 `after_seq=H`에서 시작하고 새 high-water mark를 받는다.

재시드 뒤 과거 epoch를 보낸 요청은 `409 DATASET_EPOCH_CHANGED`를 받는다. 이 경우 기존 target에 새 데이터셋을 섞지 말고, 응답의 `details.current`를 새 namespace로 사용해 cursor 0부터 별도 적재한다.

event에는 `seq`, `eventId`, `runId`, `runKey`, `operation`, `listingId`, `listingNumber`, `entityVersion`, `occurredAt`, `sourceChecksum`, `payload`가 들어간다. `seq`는 순회 cursor이고 `eventId`는 멱등 적재 identity다. 둘을 같은 의미로 취급하지 않는다.

### 4.4 실패 후 재실행

예를 들어 `seq=1,500`까지 target DB commit이 끝난 뒤 network가 끊겼다면 다음 실행은 완료된 checkpoint에서 다시 시작한다.

```text
after_seq=1500
until_seq=처음 고정한 H
```

마지막 batch의 commit 여부가 불명확하면 해당 batch를 다시 읽어 `eventId` upsert와 checksum 비교로 판정한다. 중복을 피하려고 무조건 다음 cursor로 건너뛰거나, count를 맞추기 위해 target row를 수동 삭제하지 않는다.

### 4.5 Day 22 종료 증거

- API key 원문이 없는 요청·응답 log
- `/api/v1/cars` page envelope과 대표 filter 결과
- `/api/v1/changes` 첫 `until_seq`, 마지막 `seq`, page 수
- 모든 다음 링크에서 high-water mark가 같다는 검증
- `candidate = invalid + duplicate + valid_unique` 건수식
- source `eventId` 집합과 target key 집합의 missing·extra 비교
- 같은 input 재실행 뒤 business row 수 불변
- `401`, `403`, `429`, invalid query의 중단·재시도 판정표

## 5. Day 23 — MySQL·MongoDB 생성기, 스케줄, 실행 로그

Day 23은 source server 자체가 새 합성 데이터를 계속 생성하고 두 저장소에 같은 logical batch를 적재하는 과정을 관찰한다. 이 가이드에서 생성기 CLI는 다음 표준 인터페이스를 가정한다.

```bash
npm run generate:once -- --count=1000
npm run generate:watch
```

`generate:once`는 한 batch를 만들고 종료한다. `generate:watch`는 설정된 간격마다 같은 동작을 반복하며, 종료할 때는 해당 terminal에서 `Ctrl+C`를 눌러 정상 중지한다.

### 5.1 기본 생성량

저장소가 정상이고 미완료 run이 없는 steady state 목표는 다음과 같다. 장애 시간의 모든 slot을 무제한 소급 생성하는 SLA는 아니다.

```text
1회 생성량: 28건
실행 간격: 4분
하루 실행 수: 360회
하루 생성량: 28 × 360 = 10,080건
```

기본 간격은 `.env`의 다음 값으로 표현한다.

```dotenv
AUTO_GENERATE=true
GENERATOR_BATCH_SIZE=28
GENERATOR_INTERVAL_MS=240000
```

`npm start`가 생성기를 함께 시작하므로 기본 운영에서는 `generate:watch`를 별도로 실행하지 않는다. 수업 시간에 4분을 기다리지 않으려면 교사는 작은 count와 짧은 interval을 별도 test profile에서 사용할 수 있다. 검증이 끝나면 기본값으로 되돌리고, 짧은 interval로 여러 generator를 동시에 실행하지 않는다.

```bash
npm run generate:once -- --count=20
```

### 5.2 두 저장소의 역할

생성기 한 run은 다음을 수행한다.

1. MySQL advisory lock으로 같은 generator의 겹친 실행을 막는다.
2. `generation_runs.run_key`를 unique identity로 실행 범위를 예약한다.
3. MySQL `vehicle_listings`와 `listing_change_log`는 누락 row만 insert하고, 기존 identity는 payload·checksum이 같은지 검증한다.
4. MySQL count를 다시 읽어 요청 수와 일치하는지 확인한다.
5. MongoDB `vehicle_listings`, `listing_change_log`, `generation_runs`, `generation_run_events`를 unique key로 미러링한다.
6. 두 저장소 count가 일치하면 run을 `SUCCESS`로 닫는다.

MySQL `generation_runs`는 최신 상태 projection이다. 별도 `generation_run_events`는 RUNNING, terminal status, 재시도 RUNNING을 append-only로 기록하므로 cursor를 이미 넘긴 학생도 후속 전이를 놓치지 않는다. MongoDB의 동명 collection은 이 상태 event를 미러링한다.

미완료 run이 하나라도 있으면 새 run의 ID 범위를 예약하지 않고 해당 run을 먼저 복구한다. 이 backpressure 때문에 낮은 차량 ID나 낮은 change `seq`가 나중에 성공 feed에 뒤늦게 끼어드는 일을 막는다. `/changes`는 `SUCCESS` run의 이벤트만 공개하며 명시한 미래 `until_seq`는 현재 성공 watermark로 clamp한다.

`/cars` 계열은 MySQL current projection이므로 초기 seed와 MongoDB 복구 전 차량도 포함할 수 있다. 두 저장소의 검증 완료분만 학습자 target에 반영하는 증분 pipeline은 `/changes`를 기준으로 삼고 `pendingChangeCount`와 `/generation-runs` 상태 event를 함께 관찰한다.

생성기 외부 writer도 같은 `autodata-generator-v1` MySQL named lock을 획득하고 차량 `(id, listing_number)` identity 및 change event 불변성을 지켜야 한다. 이 규칙을 따르지 않는 직접 INSERT/UPDATE는 cursor 안전성을 보장하지 않는다.

주요 identity는 다음과 같다.

| 대상 | 멱등 key |
| --- | --- |
| generation run | `run_key` |
| run 상태 event 순서 | `generation_run_events.event_id` |
| 현재 차량 document | `listingNumber` |
| 변경 event | `eventId` |
| event 순서 | `seq` |

MySQL의 `listing_change_log`와 MongoDB의 동명 collection은 공개 가능한 합성 event만 담는다. HTTP access log와 분리돼 있으므로 `/changes` 또는 `/generation-runs`를 읽는 행위가 새 source event를 다시 만드는 재귀 loop로 이어지지 않는다.

### 5.3 `run_key` 멱등성

자동 schedule은 시간 slot마다 재현 가능한 `run_key`를 사용한다. 권장 형식은 다음과 같다.

```text
hourly-20260810T09
hourly-20260810T10
```

CLI가 `--run-key`를 받는 환경에서는 교사가 명시적으로 고정할 수 있다.

```bash
npm run generate:once -- --count=1000 --run-key=hourly-20260810T09
```

같은 `run_key`의 규칙은 다음과 같다.

- 기존 status가 `SUCCESS`이면 business data를 늘리지 않고 MongoDB core/status mirror를 다시 읽어 누락을 복구한다.
- 기존 status가 `FAILED` 또는 `PARTIAL_FAILED`이면 같은 sequence 범위를 재사용한다.
- 같은 `run_key`에 다른 `count`를 넣으면 실행하지 않는다.
- retry를 위해 새 `run_key`를 만들지 않는다. 새 key는 새 logical batch를 뜻한다.

따라서 안전성 관찰식은 다음과 같다.

```text
같은 run_key 재실행 후 MySQL business count = 이전 count
같은 run_key 재실행 후 MongoDB document count = 이전 count
SUCCESS generation run identity = 동일한 run_key 한 건
```

### 5.4 `PARTIAL_FAILED`와 부분 재시도

MySQL commit 뒤 MongoDB 적재가 실패하면 run은 `PARTIAL_FAILED`가 될 수 있다. 이 상태는 두 저장소가 영구적으로 불일치한다는 뜻이 아니라, 같은 logical run의 후속 안전 재시도가 필요하다는 뜻이다.

복구 순서는 다음과 같다.

1. `/generation-runs`에서 `run_key`, requested count, MySQL count, MongoDB count를 확인한다.
2. MongoDB 연결·인증·용량·index 원인을 고친다.
3. 원본과 같은 `run_key`, 같은 `count`로 다시 실행한다.
4. MySQL은 기존 immutable row의 identity·checksum을 검증하고, MongoDB는 누락 document를 upsert한다.
5. 두 count와 checksum을 다시 읽는다.
6. 일치할 때만 `SUCCESS`를 확인한다.

교사가 격리된 로컬 환경에서 failure drill을 진행한다면 MongoDB를 잠시 중지해 partial 상태를 만든 뒤 같은 key로 복구할 수 있다.

```bash
docker compose stop mongo
npm run generate:once -- --count=20 --run-key=partial-demo-001
docker compose start mongo
npm run generate:once -- --count=20 --run-key=partial-demo-001
```

이 실습은 교사 소유의 로컬 container에서만 수행한다. 외부 서비스에 고의 장애 요청을 보내거나 production credential을 사용하지 않는다. MongoDB가 healthy가 된 것을 확인한 뒤 재실행하고, count를 맞추기 위해 MySQL row를 수동 삭제하지 않는다.

### 5.5 `/generation-runs` 상태 이벤트 수집

HTML 실행 로그:

```text
GET /generation-runs?after_id=0&limit=24
```

안정 selector는 다음과 같다.

| 의미 | selector 또는 attribute |
| --- | --- |
| 목록, snapshot 상한, epoch | `[data-generation-run-list][data-snapshot-until][data-dataset-epoch]` |
| 상태 event card | `article[data-generation-run-event]` |
| event cursor | `[data-event-id]` 또는 `[data-field="event-id"]` |
| 실제 run ID | `[data-run-id]` 또는 `[data-field="run-id"]` |
| status | `[data-status]` 또는 `[data-field="status"]` |
| run key | `[data-field="run-key"]` |
| 요청·DB count | `[data-field="requested-count"]`, `[data-field="mysql-count"]`, `[data-field="mongo-count"]` |
| sequence 범위 | `[data-field="sequence-start"]`, `[data-field="sequence-end"]` |
| 시작 시각 | `[data-field="started-at"] time[datetime]` |
| 상태 전이 시각 | `[data-field="occurred-at"] time[datetime]` |
| 다음 page | `a[rel="next"]` |

인증 JSON 실행 로그:

```bash
curl "$AUTODATA_BASE_URL/api/v1/generation-runs?after_id=0&limit=50" \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

JSON API는 첫 응답의 `meta.until_id`와 `meta.dataset_epoch`를 checkpoint에 고정하고 `links.next`를 따른다. 이름은 호환을 위해 `after_id`/`until_id`지만 값은 run ID가 아니라 단조 증가하는 event ID다. 각 항목의 `runId`로 같은 실행의 `RUNNING → PARTIAL_FAILED → RUNNING → SUCCESS`를 묶는다. 미래 `until_id`는 현재 watermark로 clamp된다. 과거 epoch는 `409 DATASET_EPOCH_CHANGED`로 중단된다. `errorMessage`는 진단용 sanitized 요약이며 credential이나 전체 DB URI가 들어가서는 안 된다.

### 5.6 Day 23 종료 증거

- `generate:once` 한 번의 `run_key`, requested/MySQL/Mongo count
- 정상 steady state 기준 28건/4분과 약 10,080건/일 계산
- `generate:watch`의 next run과 정상 중지 기록
- 같은 `run_key` 재실행 뒤 count 불변
- controlled `PARTIAL_FAILED → SUCCESS` 또는 그에 준하는 fixture 증거
- `/changes` event 수와 성공 run의 requested count 대조
- `/generation-runs` HTML·JSON high-water mark 수집 결과
- API key·DB URI·개인정보 의심 0건인 sanitized log

## 6. 교사용 테스트 체크리스트

### 수업 전

- [ ] Node.js, npm, Docker와 MySQL·MongoDB health check가 정상이다.
- [ ] `/healthz`가 현재 storage mode를 설명한다.
- [ ] `/crawl-policy`가 이 host에 한정된 교육용 허용 범위를 표시한다.
- [ ] `/robots.txt`가 `/cars`, `/changes`, `/generation-runs`, `/crawl-policy`를 허용하고 `/api/`를 익명 crawler에 허용하지 않는다.
- [ ] HTML 제한과 API 제한 값이 학습자 수에 맞는다.
- [ ] API key 원문이 DB, Git, 화면 자료에 저장되지 않았다.
- [ ] source server DB와 학습자 target DB가 분리돼 있다.

### Day 21

- [ ] `/cars?page_size=5`에 게시판 행 5개와 stable selector가 있다.
- [ ] `/cars`의 다음 링크가 `rel="next"`를 가진다.
- [ ] `/changes?after_seq=0&limit=5`가 `data-snapshot-until`을 표시한다.
- [ ] `/changes` 다음 링크가 첫 `until_seq`를 유지한다.
- [ ] HTML 요청 간격 최소 1초를 실습 안내에 포함했다.

### Day 22

- [ ] API key 누락은 401, 잘못된 key는 403이다.
- [ ] `/api/v1/cars`가 `data/meta/links` envelope을 반환한다.
- [ ] `/api/v1/changes` 첫 응답에 `meta.until_seq`가 있다.
- [ ] `links.next`가 같은 `until_seq`와 증가한 `after_seq`를 가진다.
- [ ] 마지막 page에서 `has_more=false`, `links.next=null`이다.
- [ ] 제한 초과 시 429와 `Retry-After`가 반환된다.

### Day 23

- [ ] `generate:once -- --count=20`이 MySQL·MongoDB에 각각 20건을 반영한다.
- [ ] 같은 `run_key`와 count를 다시 실행해 business count가 늘지 않는다.
- [ ] 같은 `run_key`와 다른 count는 거부된다.
- [ ] `generation_runs`, `generation_run_events`, `listing_change_log`의 key·cursor index가 존재한다.
- [ ] `/generation-runs`에서 같은 run의 RUNNING과 terminal 상태 event를 모두 읽을 수 있다.
- [ ] `generate:watch`가 한 process만 실행되고 중지 후 process가 남지 않는다.
- [ ] partial retry 후 동일 sequence 범위로 두 저장소 count가 일치한다.
- [ ] access log와 crawlable source log가 분리돼 있다.

### 자동 검사

```bash
npm run check
npm test
```

자동 테스트가 통과해도 실제 MySQL·MongoDB 생성기와 장시간 scheduler 동작까지 증명되는 것은 아니다. 저장소 통합, 재실행, partial retry, process 종료는 위 수동 체크리스트로 별도 확인한다.

## 7. 학습자 제출 체크리스트

- [ ] source registry에 `/crawl-policy`, `/robots.txt`, allowed path, 요청 간격을 기록했다.
- [ ] 외부 live를 수행하지 않았으면 `profile=sandbox`와 선택 이유를 적었다.
- [ ] 외부 수집을 항상 불법 또는 항상 허용이라고 단정하지 않고 검토 항목을 설명했다.
- [ ] HTML selector와 API schema를 config 또는 contract로 분리했다.
- [ ] 첫 high-water mark를 run context에 고정했다.
- [ ] 다음 링크를 추측하지 않고 응답의 `links.next` 또는 `a[rel=next]`를 따랐다.
- [ ] batch commit 뒤에만 checkpoint를 전진시켰다.
- [ ] `eventId` 또는 합의된 business key로 upsert했다.
- [ ] 같은 input 재실행 뒤 business count가 증가하지 않았다.
- [ ] 401·403·429·schema 오류를 무한 재시도하지 않았다.
- [ ] run·stage·count unit·duration·sanitized error를 기록했다.
- [ ] key·cookie·DB URI·실제 개인정보가 raw, log, screenshot, Git에 없다.
- [ ] scheduler와 DB connection을 정상 종료했다.

## 8. 기존 Day 21~23 산출물에 반영할 위치

| 기존 산출물 | sandbox에서 추가할 내용 |
| --- | --- |
| `docs/brd.md` | 외부 source 불확실성을 줄이는 교육용 sandbox 사용 목적 |
| `docs/prd.md` | HTML/API 수집, high-water mark, 멱등 재실행, 실행 로그 AC |
| `config/source-registry.yml` | base URL, policy·robots URL, allowed path, API key 환경 변수 |
| `docs/data-contract.md` | car document, change event, generation run, cursor·high-water mark |
| `docs/architecture.md` | source server DB와 학습자 target DB의 분리 |
| `src/collectors/` | `/cars`, `/changes`, `/api/v1/cars`, `/api/v1/changes` adapter |
| `src/repositories/` | stable key upsert와 checkpoint transaction 경계 |
| `output/<run_id>/quality-report.json` | candidate·invalid·duplicate·valid, missing·extra, high-water mark |
| `evidence/scheduler-run.md` | 28건/4분 설정, 하루 약 10,080건 계산, scheduled run ID, 중지 증거 |
| `evidence/retry-idempotency.md` | 같은 key 재실행과 partial retry의 before/after count |

샌드박스는 외부 live 성공 증거 또는 AWS topology 증거를 대신하지 않는다. 대신 Day 21~23의 공통 학습 목표인 source 계약, HTML/API collector, 예외 처리, MySQL·MongoDB 적재, 멱등성, 구조화 로그, 스케줄 실행을 외부 사이트 상태와 분리해 반복 가능하게 만든다.

## 9. 종료

수업 종료 순서는 다음과 같다.

1. 학습자 crawler와 `generate:watch`를 먼저 중지한다.
2. HTTP server를 `Ctrl+C`로 정상 종료한다.
3. MySQL·MongoDB connection이 닫혔는지 확인한다.
4. 보존할 run ID, high-water mark, quality report checksum을 기록한다.
5. container를 유지할 필요가 없으면 `docker compose stop mysql mongo`로 중지한다.

volume 삭제가 필요한 경우에는 보존할 evidence와 복구 필요를 먼저 판단한다. `docker compose down -v`는 저장 데이터를 제거하므로 일반적인 수업 종료 명령으로 사용하지 않는다.
