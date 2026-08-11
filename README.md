# AutoData Lab: 중고차 수집 실습 서버

AutoData Lab은 외부 사이트 대신 수집 권한이 명확한 합성 중고차 데이터를 제공하는 교실용 샌드박스입니다.

- 공개 HTML: `/cars`, `/cars/:id` (항상 최신 최대 10,000건), `/faqs` (공식 출처 기반 브랜드 FAQ)
- API 키가 필요한 JSON 데이터: `/api/v1/*` (`/api/v1/public-key`만 공개 예외)
- 크롤링 가능한 증분·적재 로그: `/changes`, `/generation-runs`
- 주기 생성 데이터의 MySQL·MongoDB 멱등 이중 적재

수강생에게 전달할 크롤링 시작 주소는 다음 세 개입니다.

- HTML 게시판(최대 10,000건, 페이지당 20건): `http://<배포자-IP>:4000/cars?page=1&page_size=20`
- 브랜드 FAQ(8개 자동차 회사, 24문항): `http://<배포자-IP>:4000/faqs`
- API 키 입력 크롤러: `http://<배포자-IP>:4000/docs#api-explorer`

HTML 선택자와 페이지네이션, API 키·필터·커서, 고정 high-water mark 증분 수집을 연습한 뒤 직원·업무영역 관계를 분석할 수 있습니다. 차량과 사람 데이터는 모두 교육용이며 실제 차량번호, VIN, 전화번호를 만들지 않습니다. 허용 범위는 `/crawl-policy`에서 확인하며 이 허가는 제3자 사이트에 적용되지 않습니다.

`/cars` 게시판과 그 상세 화면은 인증 없이 수집할 수 있으며, ID가 가장 큰 최신 최대 10,000건을 노출합니다. 새 레코드가 추가되면 즉시 공개 집합에 들어오고 가장 오래된 레코드는 빠집니다. 검색·필터·정렬은 조회 시점의 이 공개 집합 안에서 동작합니다. 전체 차량 projection과 고정 snapshot 커서 수집은 키가 필요한 `/api/v1/cars*`를 사용합니다. 두 저장소에 검증 완료된 이벤트만 수집해야 할 때는 `SUCCESS` run만 공개하는 `/changes` 또는 `/api/v1/changes`를 사용하고, `/api/v1/stats`의 `pendingChangeCount`를 함께 확인하세요.

## 역할별 사용설명서

Docker와 별도 데이터베이스 없이 수업망에서 메모리 모드로 운영할 때는 아래 두 문서를 사용하세요.

- [배포자용 HTML 사용설명서](docs/DEPLOYER_GUIDE.html): 강사 PC 설치, 환경설정, API 키 발급, LAN 공유, 운영·종료
- [사용자용 HTML 사용설명서](docs/USER_GUIDE.html): 서버 접속, 브라우저·curl·Python 실습, 수집 규칙, 오류 해결

Markdown 원문을 수정한 뒤에는 `npm run docs:build`로 두 HTML을 다시 생성할 수 있습니다.
두 HTML 사이의 역할 전환 링크를 사용하려면 파일을 같은 폴더에 유지하세요.

## 먼저 알아둘 데이터 의미

제공된 `AREA`는 주소나 행정구역이 아니라 `생산`, `물류운영`, `IT` 같은 **업무/조직 영역**입니다. 따라서 다음처럼 분리했습니다.

| 데이터 | 서버에서의 역할 |
| --- | --- |
| `biz_employee_master.csv` | 내부 판매 담당자·업무영역 관리자 마스터 |
| `biz_meta_area_50000.csv` | 1,000개 상위 + 49,000개 하위 업무영역 |
| `biz_meta_area_parent_lookup.csv` | 상위 업무영역 snapshot |
| `biz_meta_area_join_ready.csv` | 정규화 조인 결과를 검증하는 비정규화 snapshot |
| `locations` | 차량의 실제 시·도/시군구 소재지(별도 생성) |
| `vehicle_listings` | 담당 직원·업무영역·소재지와 연결되는 중고차 매물 |

실제 네 CSV는 직원 3,000건, 업무영역 50,000건, 상위영역 1,000건, join-ready 50,000건이며 PK·FK와 비정규화 필드 비교가 모두 일치함을 확인했습니다. 비활성 직원 199명이 3,293개 업무영역의 관리자로 남아 있으므로, 차량 생성 시에는 활성 직원이 관리하는 하위영역만 사용합니다.

공개 딜러 코드의 HMAC과 이름 마스킹은 **가명처리**이지 익명화가 아닙니다. 원본 CSV와 MySQL 내부 직원 필드는 승인된 합성 데이터 또는 접근 권한이 있는 내부 실습 자료에만 사용하고, 원본을 학생 응답·로그·Git에 배포하지 마세요.

## 요구 환경

- Node.js 22.13 이상
- npm
- 이 문서의 메모리 수업 모드: 별도 데이터베이스·Docker 불필요
- 이중 적재 모드: Docker Desktop 또는 MySQL 8.4·MongoDB 8.0 호환 서버
- Python 실습: Python 3.10 이상

## 바로 실행: 메모리 모드

이 작업 폴더의 로컬 `.env`에는 요청한 네 CSV 경로와 서버 비밀값이 설정되어 있습니다. `.env`는 Git에서 제외됩니다. 수강생용 API 키는 서버가 한국시간 날짜별로 자동 생성해 공개합니다.

```bash
npm install
npm start
```

브라우저에서 `http://127.0.0.1:4000`을 엽니다. 현재 설정은 CSV 53,000개 정규화 레코드를 읽고 결정론적 중고차 5,000건을 메모리에 생성합니다.

새 환경에서는 다음 순서로 준비합니다.

```bash
cp .env.example .env
chmod 600 .env
```

직원번호 후보를 공개 딜러 코드에서 역추측할 수 없도록 별도의 32자 이상 비밀값도 생성해 `.env`에만 보관합니다. 이 값을 바꾸면 동일 담당자의 공개 코드도 달라지므로 운영 중에는 유지하세요.

```bash
openssl rand -hex 32
```

생성한 난수는 `DEALER_PUBLIC_ID_SECRET`과 `DAILY_API_KEY_SECRET`에 각각 서로 다른 값으로 넣는 것을 권장합니다. `DAILY_API_KEY_SECRET`이 비어 있으면 딜러 secret을 별도 HMAC 영역으로 사용합니다. CSV 네 경로는 실제 절대 경로로 바꿉니다.

```dotenv
DATA_SOURCE=memory
MEMORY_CAR_COUNT=5000
DEALER_PUBLIC_ID_SECRET=위에서_생성한_64자리_난수
DAILY_API_KEY_SECRET=별도로_생성한_64자리_난수

EMPLOYEE_CSV_PATH=/data/biz_employee_master.csv
AREA_CSV_PATH=/data/biz_meta_area_50000.csv
AREA_JOIN_READY_CSV_PATH=/data/biz_meta_area_join_ready.csv
AREA_PARENT_LOOKUP_CSV_PATH=/data/biz_meta_area_parent_lookup.csv
```

## 10만 건 이상: MySQL + MongoDB 모드

MySQL과 MongoDB를 시작하고 네 CSV와 중고차 100,000건을 MySQL 기준선에 적재합니다.

```bash
docker compose up -d mysql mongo
npm run db:seed -- --count=100000 --require-csv=true --reset-mongo=true
```

이미 만들어 둔 Docker named volume에는 `/docker-entrypoint-initdb.d`의 변경이 자동 반영되지 않습니다. 이번 버전은 MySQL과 MongoDB에 같은 `dataset_epoch`를 만드는 초기화가 필요하므로 **기존 volume에 `schema.sql`만 적용해서는 안 됩니다.** HTTP 서버와 생성기를 멈추고 필요한 실습 결과를 백업한 뒤 위의 `db:seed --reset-mongo=true`를 실행하세요. seed는 합성 기준 데이터와 생성 run·변경 로그를 다시 만들지만 `api_keys`는 보존합니다.

공개 일일 키는 저장 모드와 관계없이 서버가 자동으로 제공합니다. 이후 `.env`의 `DATA_SOURCE`를 `mysql`로 바꾸고 서버를 실행합니다.

```bash
npm start
```

`db:seed`는 차량, 브랜드, 모델, 소재지, 직원, 업무영역, lookup, join-ready 테이블을 다시 만듭니다. MongoDB mirror가 설정된 환경에서는 새 MySQL 변경 커서와 충돌하지 않도록 `--reset-mongo=true`가 필수이며, 생략해도 안전한 기본값 `SEED_RESET_MONGO=true`가 적용됩니다. seed 동안 MySQL과 MongoDB의 `dataset_state`는 `RESETTING`, 모든 단계가 끝나면 같은 새 `dataset_epoch`의 `READY`가 됩니다. 중간 실패 시 health/API/generator는 fail-closed합니다. MongoDB에서는 `vehicle_listings`, `listing_change_log`, `generation_runs`, `generation_run_events`만 비우며 다른 컬렉션은 건드리지 않습니다. **MySQL의 `api_keys`도 비우지 않아 선택적으로 만든 장기 관리자 키가 유지됩니다.** 재시드 전에는 HTTP 서버와 생성기를 먼저 중지하고, 보존할 학생 수집 결과는 이 데이터베이스가 아닌 별도 스키마나 파일에 두세요.

더 큰 데이터셋 예시:

```bash
npm run db:seed -- --count=250000 --batch-size=1000 --require-csv=true --reset-mongo=true
```

초기 seed는 기준 테이블을 다시 만들기 때문에 `listing_change_log`, `generation_run_events`, `generation_runs`도 비웁니다. 운영 중 추가 적재에는 seed를 다시 실행하지 말고 아래 생성기를 사용하세요.

재시드는 source cursor가 1부터 다시 시작하는 **새 데이터셋 수명주기**입니다. 커서 응답의 `meta.dataset_epoch`를 체크포인트와 함께 저장하고 모든 후속 요청에 `dataset_epoch`로 재전송하세요. 재시드 뒤 예전 값을 보내면 서버가 `409 DATASET_EPOCH_CHANGED`를 반환하므로, 그때 새 target namespace와 체크포인트로 처음부터 수집합니다. 수업 중 증분 갱신에는 재시드가 아니라 생성기를 사용하세요.

## 하루 약 10,000건 자동 주기 생성

한 번만 1,000건을 생성해 MySQL의 `vehicle_listings`·`listing_change_log`와 MongoDB의 같은 이름 컬렉션에 멱등 upsert합니다. `generation_runs`는 실행의 최신 상태 projection이고, append-only `generation_run_events`는 `RUNNING → SUCCESS/PARTIAL_FAILED/FAILED` 및 재시도 전이를 크롤링 가능하게 보존합니다.

```bash
npm run generate:once -- --count=1000 --run-key=manual-20260810-01
```

같은 `run-key`와 같은 `count`로 다시 실행하면 건수가 늘지 않고 MongoDB core/status mirror의 누락을 다시 검증·복구합니다. MySQL 성공 뒤 MongoDB가 실패하면 `PARTIAL_FAILED`가 남고, 같은 명령을 재실행하면 빠진 MongoDB 적재를 복구합니다.

MySQL 모드 스케줄러는 `FAILED`·`PARTIAL_FAILED`·중단된 `RUNNING`을 자동 복구합니다. 이미 `SUCCESS`인 과거 run의 MongoDB mirror가 운영자 삭제 등으로 나중에 유실된 경우에는 해당 `run-key`와 `count`를 수동으로 다시 실행해 재검증합니다.

미완료 run이 있으면 생성기는 그 run을 먼저 복구하며 새 sequence 범위 생성을 중단합니다. 생성기 밖에서 같은 테이블에 쓰는 프로그램도 반드시 `autodata-generator-v1` named lock을 획득하고 차량 ID·listing number 및 append-only event 불변식을 지켜야 합니다. 그렇지 않으면 커서가 이미 지난 낮은 ID를 나중에 넣거나 기존 이벤트를 바꿀 수 있습니다.

`npm start`는 서버와 주기 생성기를 함께 시작합니다. 기본 설정은 4분마다 28건으로, 24시간 연속 운영 시 약 10,080건을 추가합니다. 메모리 모드에서는 프로세스 메모리에 적재되어 API·변경 로그에 즉시 보이지만 재시작하면 초기 데이터로 돌아갑니다. MySQL 모드에서는 기존 멱등 생성기가 MySQL·MongoDB에 적재합니다. 장애 시간의 슬롯을 무제한 소급 생성하는 SLA는 아닙니다.

```dotenv
AUTO_GENERATE=true
GENERATOR_BATCH_SIZE=28
GENERATOR_INTERVAL_MS=240000
```

자동 생성을 잠시 끄려면 `AUTO_GENERATE=false`로 서버를 재시작합니다. 기본 자동 생성이 켜진 상태에서는 별도의 `generate:watch`를 중복 실행하지 않습니다.

독립 생성기 프로세스가 꼭 필요한 운영에서만 서버의 `AUTO_GENERATE=false`를 설정한 뒤 `npm run generate:watch`를 사용합니다.

수업에서 빠르게 관찰하려면 테스트 서버의 환경 변수로 간격과 묶음 크기를 줄입니다.

```bash
GENERATOR_BATCH_SIZE=25 GENERATOR_INTERVAL_MS=10000 npm run generate:watch
```

`run-key`는 UTC 시간 슬롯으로 결정되므로 같은 슬롯에서 프로세스를 다시 시작해도 중복 생성하지 않습니다. 두 프로세스가 겹치면 MySQL named lock으로 하나만 실행합니다. 기본값과 MongoDB 연결은 `.env.example`을 참고하세요.

`SIGINT`/`SIGTERM`을 받으면 진행 중인 batch의 안전한 종료를 최대 `GENERATOR_SHUTDOWN_TIMEOUT_MS`(기본 60초)까지 기다립니다. 같은 신호를 한 번 더 보내거나 상한을 넘기면 프로세스를 종료하고, 다음 시작에서 남은 `RUNNING`/`FAILED`/`PARTIAL_FAILED` run을 sequence 순서로 재조정합니다.

## API 키 관리

수강생용 공개 키는 별도 발급 명령 없이 `/api/v1/public-key`와 `/docs`에 표시됩니다. 한국시간 매일 자정에 바뀌고, 23:00부터 다음 날 키가 함께 표시됩니다. 다음 날 키는 자정 전에는 인증되지 않습니다.

자동화 프로그램은 실행 직전에 다음 공개 경로에서 `data.current.api_key`를 읽어야 합니다. 자정을 지나 `403`이 발생하면 현재 페이지 체크포인트를 유지한 채 키를 다시 읽고 해당 요청을 한 번만 재시도합니다.

```bash
curl 'http://127.0.0.1:4000/api/v1/public-key'
```

아래 발급·폐기 명령은 별도의 고정 관리자 키가 필요한 경우에만 선택적으로 사용합니다.

메모리 키 발급:

```bash
npm run api-key:create -- --source memory --name "오전반"
```

MySQL 키 발급·폐기:

```bash
npm run api-key:create -- --source mysql --name "오전반"
npm run api-key:revoke -- --source mysql --prefix ucar_v1_0123456789abcdef
```

메모리 키를 폐기할 때는 `.env`의 `UCAR_API_KEY(S)`에서 해당 값을 제거하고 서버를 재시작합니다. API 키는 URL 쿼리나 소스 코드에 넣지 말고 환경 변수와 요청 헤더를 사용합니다.

```bash
curl 'http://127.0.0.1:4000/api/v1/cars?page_size=5' \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

Bearer도 지원합니다.

```bash
curl 'http://127.0.0.1:4000/api/v1/stats' \
  -H "Authorization: Bearer $AUTODATA_API_KEY"
```

## 같은 Wi-Fi에서 접속

서버는 기본적으로 `0.0.0.0`에 바인딩됩니다. macOS에서 Wi-Fi IP를 확인합니다.

```bash
ipconfig getifaddr en0
```

IP가 `192.168.0.23`이면 학생은 `http://192.168.0.23:4000`으로 접속합니다. 교사와 학생이 같은 Wi-Fi에 있어야 하며, 공유기의 AP/클라이언트 격리가 켜져 있으면 서로 접근할 수 없습니다. 이 프로젝트는 로컬 수업망용이므로 인터넷에 직접 공개하지 마세요.

## 주요 경로

| 메서드 | 경로 | 인증 | 용도 |
| --- | --- | --- | --- |
| `GET` | `/` | 공개 | 데이터셋 홈 |
| `GET` | `/cars` | 공개 | 실시간 최신 최대 10,000건 중 페이지당 기본 20건의 게시판형 차량 목록 |
| `GET` | `/cars/:id` | 공개 | 현재 최신 10,000건 공개 집합의 차량 상세 HTML |
| `GET` | `/faqs` | 공개 | 공식 홈페이지 출처·확인일이 포함된 8개 브랜드 FAQ HTML |
| `GET` | `/changes` | 공개 | 고정 snapshot 변경 로그 HTML |
| `GET` | `/generation-runs` | 공개 | append-only 적재 상태 이벤트 HTML |
| `GET` | `/crawl-policy` | 공개 | 이 샌드박스의 수집 허용 범위 |
| `GET` | `/docs` | 공개 | API 문서와 키 입력·다중 페이지 크롤러 |
| `GET` | `/learning-guide` | 공개 | 수업 진행 가이드 |
| `GET` | `/healthz` | 공개 | 서버·저장소 상태 |
| `GET` | `/api/v1/cars` | 키 | 차량 필터·정렬·페이지 목록 |
| `GET` | `/api/v1/cars/cursor` | 키 | 대량 적재용 ID 커서 |
| `GET` | `/api/v1/cars/:id` | 키 | 차량 상세 JSON |
| `GET` | `/api/v1/changes` | 키 | `after_seq`·`until_seq` 증분 로그 |
| `GET` | `/api/v1/generation-runs` | 키 | `after_id`·`until_id` 상태 이벤트 feed |
| `GET` | `/api/v1/brands` | 키 | 브랜드별 차량 수 |
| `GET` | `/api/v1/locations` | 키 | 실제 차량 소재지 |
| `GET` | `/api/v1/business-areas` | 키 | 업무영역과 가명 관리자 |
| `GET` | `/api/v1/stats` | 키 | 전체 통계 |

자세한 계약은 [API 문서](docs/API.md), 기존 실습 코드는 [학습 가이드](docs/LEARNING_GUIDE.md), Encore 21~23일차 운영은 [샌드박스 가이드](docs/DAY21_23_SANDBOX.md)를 참고하세요.

## HTML 수집 예제

```bash
python -m pip install requests beautifulsoup4
```

```python
import requests
from bs4 import BeautifulSoup

url = "http://127.0.0.1:4000/cars?page=1&page_size=20"

while url:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    for card in soup.select("article.car-card[data-car-id]"):
        print(
            card["data-car-id"],
            card.select_one('[data-field="title"]').get_text(strip=True),
            card.select_one('[data-field="price"]')["value"],
        )

    next_link = soup.select_one("a[rel=next]")
    url = requests.compat.urljoin(url, next_link["href"]) if next_link else None
```

## API 커서 수집 예제

```python
import os
import requests

base_url = "http://127.0.0.1:4000"
headers = {"X-API-Key": os.environ["AUTODATA_API_KEY"]}
path = "/api/v1/cars/cursor?after_id=0&limit=500"

while path:
    response = requests.get(base_url + path, headers=headers, timeout=10)
    response.raise_for_status()
    payload = response.json()
    for car in payload["data"]:
        print(car["id"], car["listingNumber"], car["price"])
    path = payload["links"]["next"]
```

실제 적재에서는 각 batch를 저장한 뒤 마지막 ID를 체크포인트로 남기고, `listingNumber`를 유일키로 upsert하세요.

## 계속 늘어나는 변경 로그를 유한하게 수집

첫 요청에서는 `until_seq`를 생략합니다. 서버가 현재 마지막 이벤트를 snapshot 상한으로 고정하고 다음 링크에 포함합니다.

```python
import os
import requests

base_url = "http://127.0.0.1:4000"
headers = {"X-API-Key": os.environ["AUTODATA_API_KEY"]}
path = "/api/v1/changes?after_seq=0&limit=500"

while path:
    payload = requests.get(base_url + path, headers=headers, timeout=10).json()
    for event in payload["data"]:
        print(event["seq"], event["operation"], event["listingNumber"])
    path = payload["links"]["next"]
```

수집 중 새 이벤트가 추가되어도 `until_seq`보다 큰 값은 다음 실행으로 넘기므로 무한 순회하지 않습니다. HTML `/changes`도 같은 원칙으로 `a[rel=next]`를 제공합니다.

## 개인정보와 공개 응답

원본 직원명과 `EMP_NO`, 입사일은 HTML·API에 내보내지 않습니다. API의 딜러와 업무영역 관리자는 비공개 환경 secret을 사용하는 도메인 분리 HMAC-SHA-256 기반 `DLR-<10 hex>` 공개 코드와 가명/마스킹 이름만 사용합니다. `DEALER_PUBLIC_ID_SECRET`이 없거나 32자 미만이면 서버와 생성기는 안전하게 시작을 거부합니다. 원본 값은 MySQL 내부 관계 검증과 수업용 SQL에서만 다룹니다.

## 검사

```bash
npm run check
npm test
```

테스트는 메모리 저장소와 임시 로컬 HTTP 서버를 사용하므로 MySQL이 필요하지 않습니다. CSV 전체 관계만 별도로 확인하려면 다음을 실행할 수 있습니다.

```bash
node --input-type=module -e '
import { loadEnvFile } from "node:process";
import { loadCsvSources } from "./server/csv-data.mjs";
loadEnvFile(".env");
const data = await loadCsvSources({ env: process.env, strict: true });
console.log(data.files, data.validation.valid);
'
```

## 안전하게 종료

1. 학생 크롤러를 먼저 중지합니다.
2. 서버 터미널에서 `Ctrl+C`를 눌러 HTTP 서버와 연결 풀이 닫힐 때까지 기다립니다.
3. DB 컨테이너를 멈출 때는 `docker compose stop mysql mongo`를 사용합니다.

`docker compose down -v`는 MySQL·MongoDB 볼륨을 모두 지우므로 데이터를 폐기하려는 경우에만 사용하세요.
