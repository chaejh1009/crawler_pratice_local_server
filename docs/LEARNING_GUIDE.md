# AutoData Lab 중고차 수집 학습 가이드

이 문서는 같은 Wi-Fi에서 실행하는 AutoData Lab을 이용해 다음 흐름을 수업하는 가이드입니다.

Encore Chapter 1 Day 21~23에서 외부 live 대신 이 서버의 MySQL·MongoDB 주기 생성 데이터와 변경 로그를 사용할 때는 [Day 21~23 샌드박스 가이드](DAY21_23_SANDBOX.md)를 함께 사용합니다.

1. 서버 렌더링 HTML을 BeautifulSoup으로 수집합니다.
2. API 키를 헤더에 넣고 JSON API를 호출합니다.
3. 기본키 커서와 체크포인트를 이용해 대량 수집을 중단 지점부터 재개합니다.
4. 직원·업무영역 CSV를 MySQL에 정규화하고 제공된 비정규화 결과와 비교합니다.

이 서버의 데이터는 수업용 가상 데이터입니다. 그래도 실제 사이트를 수집할 때는 이용 약관과 `robots.txt`를 확인하고, 요청 간격과 수집 범위를 지켜야 합니다.

## 1. 먼저 알아둘 데이터 경계

HTML과 API가 제공하는 핵심 데이터는 중고차 매물입니다. 차량에는 브랜드, 모델, 트림, 연식, 최초 등록일, 주행거리, 연료, 변속기, 가격, 사고 횟수, 색상, 차량 소재지, 담당 딜러, 담당 업무영역이 연결됩니다.

여기서 `AREA`의 의미를 정확히 구분해야 합니다.

- CSV의 `AREA_ID`, `AREA_NM`은 시·도나 시·군·구가 아닙니다.
- 실제 값은 생산, 데이터, 영업, 물류, 운영센터 같은 업무·조직 영역입니다.
- 차량의 물리적 소재지는 별도 `locations.province`, `locations.city`로 관리합니다.
- 업무영역을 차량 소재지로 변환하거나 지도 데이터처럼 사용하면 안 됩니다.

### 개인정보 공개 원칙

`biz_employee_master.csv`와 `biz_meta_area_join_ready.csv`에는 직원 번호와 이름이 있습니다. 이 값은 MySQL 내부 관계 검증에만 사용합니다.

- 정식 API와 HTML은 원본 직원 이름과 `EMP_NO`를 공개하지 않습니다.
- API의 `dealer.code`, `dealer.displayName`은 공개용 코드와 마스킹된 표시명입니다.
- 부서와 직급은 수업용 관계 문맥으로 제공될 수 있지만, 원본 직원 번호·이름·입사일과 함께 외부로 내보내지 않습니다.
- 원본 CSV, SQL 덤프, 노트북 출력, 화면 캡처를 인터넷에 게시하지 않습니다.

## 2. 수업 환경 준비

교사가 알려 준 서버 주소를 환경 변수로 둡니다. 아래 주소는 각 교실 환경에 맞게 바꿉니다.

```bash
export AUTODATA_BASE_URL='http://192.168.0.23:4000'
```

Python 실습 환경을 준비합니다.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install requests beautifulsoup4
```

서버가 응답하는지 확인합니다. `/healthz`는 API 키 없이 호출할 수 있습니다.

```bash
curl "$AUTODATA_BASE_URL/healthz"
curl "$AUTODATA_BASE_URL/robots.txt"
```

현재 `robots.txt`는 HTML 수집을 허용하고 `/api/`를 일반 웹 크롤러에서 제외하며, 1초의 요청 간격을 안내합니다. API는 웹 크롤러 대신 인증된 API 클라이언트로 호출합니다.

## 3. HTML 수집 실습

`/cars`는 API 키 없이 접근하는 서버 렌더링 HTML입니다. 다음 선택자는 화면 디자인이 바뀌어도 수집 코드가 비교적 안정적으로 동작하도록 마련되어 있습니다.

| 대상 | CSS 선택자 또는 속성 |
| --- | --- |
| 목록 컨테이너 | `[data-car-list]` |
| 차량 카드 | `article.car-card[data-car-id]` |
| 매물 번호 | 카드의 `data-listing-number` |
| 제목 | `[data-field="title"]` |
| 가격 | `data[data-field="price"]`의 `value` |
| 연식 | `[data-field="model-year"]` |
| 주행거리 | `[data-field="mileage"]` |
| 연료 | `[data-field="fuel"]` |
| 소재지 | `[data-field="location"]` |
| 판매 상태 | 카드의 `data-status` |
| 상세 링크 | `[data-field="title"] a[href]` |
| 다음 페이지 | `a[rel="next"]` |

화면에 보이는 가격이나 주행거리에는 쉼표, `원`, `km`가 포함됩니다. 가능한 경우 표시 문자열을 다시 파싱하기보다 `value`나 `data-*`의 원시 값을 사용합니다.

### BeautifulSoup 목록 순회

다음 예제는 최대 3페이지를 수집합니다. 중복 ID를 발견하면 즉시 실패하고 요청 사이에 1초를 기다립니다.

```python
import os
import re
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = os.environ.get("AUTODATA_BASE_URL", "http://127.0.0.1:4000")
session = requests.Session()
session.headers.update({"User-Agent": "AutoData-Classroom/1.0"})


def number_from_text(value):
    digits = re.sub(r"[^0-9]", "", value or "")
    return int(digits) if digits else None


url = f"{BASE_URL}/cars"
params = {
    "brand": "hyundai",
    "min_year": 2020,
    "sort": "price_asc",
    "page_size": 24,
}
seen_ids = set()
records = []

for page_number in range(1, 4):
    response = session.get(url, params=params, timeout=10)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    cards = soup.select('[data-car-list] article.car-card[data-car-id]')
    for card in cards:
        car_id = int(card["data-car-id"])
        if car_id in seen_ids:
            raise RuntimeError(f"중복 차량 ID: {car_id}")
        seen_ids.add(car_id)

        title = card.select_one('[data-field="title"]')
        price = card.select_one('data[data-field="price"]')
        model_year = card.select_one('[data-field="model-year"]')
        mileage = card.select_one('[data-field="mileage"]')
        detail_link = card.select_one('[data-field="title"] a[href]')

        records.append({
            "id": car_id,
            "listing_number": card.get("data-listing-number"),
            "title": title.get_text(" ", strip=True),
            "price": int(price["value"]),
            "model_year": number_from_text(model_year.get_text()),
            "mileage_km": number_from_text(mileage.get_text()),
            "fuel": card.select_one('[data-field="fuel"]').get_text(strip=True),
            "location": card.select_one('[data-field="location"]').get_text(" ", strip=True),
            "status": card.get("data-status"),
            "detail_url": urljoin(response.url, detail_link["href"]),
        })

    next_link = soup.select_one('a[rel="next"]')
    if next_link is None:
        break

    url = urljoin(response.url, next_link["href"])
    params = None  # 다음 링크에 현재 필터와 다음 page가 이미 포함되어 있습니다.
    time.sleep(1.0)

print("수집 건수:", len(records))
print("고유 ID 수:", len(seen_ids))
print(records[:2])
```

### HTML 수집 검증 포인트

- HTTP 상태를 확인한 뒤 파싱합니다.
- 카드 수가 0이라고 무조건 오류로 처리하지 않습니다. 마지막 페이지 또는 필터 결과 0건일 수 있습니다.
- 다음 페이지의 존재 여부는 페이지 번호 추측보다 `a[rel="next"]`로 판단합니다.
- 제목과 가격 같은 화면 문구를 데이터베이스 키로 사용하지 않습니다. `data-car-id` 또는 `data-listing-number`를 사용합니다.
- 목록 수집과 상세 수집을 한꺼번에 병렬 실행하지 않습니다. 목록을 먼저 저장한 뒤 필요한 상세 페이지만 제한적으로 조회합니다.

## 4. API 키 발급과 사용

`/api/v1/*`의 정식 API는 모두 API 키가 필요합니다. `/healthz`, HTML 화면, 정적 파일은 공개입니다.

### 메모리 모드 키

교사가 키를 한 번 발급합니다.

```bash
node scripts/create-api-key.mjs --source memory --name "1반 실습"
```

명령이 출력한 원문 키는 한 번만 표시됩니다. 서버를 시작할 때 그 값을 `UCAR_API_KEY`로 전달합니다.

```bash
export AUTODATA_API_KEY='발급된_ucar_v1_키'
UCAR_API_KEY="$AUTODATA_API_KEY" DATA_SOURCE=memory npm start
```

### MySQL 모드 키

스키마와 데이터 적재를 마친 뒤 키를 발급하는 편이 안전합니다.

```bash
node scripts/create-api-key.mjs create --source mysql --name "1반 실습"
```

MySQL에는 원문이 아니라 키 prefix와 SHA-256 해시만 저장됩니다. 원문 키는 학생에게 별도의 안전한 채널로 전달합니다.

### 요청 헤더

권장 방식은 `X-API-Key`입니다.

```bash
curl "$AUTODATA_BASE_URL/api/v1/cars?page_size=5" \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

Bearer 인증도 지원합니다.

```bash
curl "$AUTODATA_BASE_URL/api/v1/stats" \
  -H "Authorization: Bearer $AUTODATA_API_KEY"
```

두 인증 헤더를 동시에 보내지 않습니다. 키가 없으면 `401 API_KEY_REQUIRED`, 형식이 잘못되었거나 폐기된 키이면 `403 API_KEY_INVALID`가 반환됩니다.

API 키를 URL의 쿼리 문자열에 넣으면 서버 로그, 브라우저 방문 기록, 노트북 출력에 남을 수 있습니다. 항상 헤더로 보내고 코드에는 직접 적지 말고 환경 변수에서 읽습니다.

## 5. 필터형 JSON API 수집

차량 목록 API는 검색·필터·정렬 수업에 사용합니다.

```python
import os
import requests

BASE_URL = os.environ.get("AUTODATA_BASE_URL", "http://127.0.0.1:4000")
API_KEY = os.environ["AUTODATA_API_KEY"]

response = requests.get(
    f"{BASE_URL}/api/v1/cars",
    headers={"X-API-Key": API_KEY},
    params={
        "brand": "hyundai",
        "fuel": "하이브리드",
        "status": "AVAILABLE",
        "min_year": 2020,
        "max_mileage": 80000,
        "accident_free": "true",
        "sort": "price_asc",
        "page": 1,
        "page_size": 100,
    },
    timeout=10,
)
response.raise_for_status()
payload = response.json()

for car in payload["data"]:
    print(
        car["id"],
        car["listingNumber"],
        car["brand"]["name"],
        car["model"]["name"],
        car["price"],
    )

print(payload["meta"])
print("다음 페이지:", payload["links"]["next"])
```

주요 필터와 정렬값은 다음과 같습니다.

| 매개변수 | 예 | 의미 |
| --- | --- | --- |
| `q` | `그랜저` | 제목·설명·브랜드·모델·트림 검색 |
| `brand` | `hyundai` 또는 `1` | 브랜드 slug 또는 ID |
| `location` | `seoul-1` 또는 `1` | 실제 차량 소재지 slug 또는 ID |
| `fuel` | `하이브리드` | 가솔린, 디젤, 하이브리드, 전기, LPG |
| `status` | `AVAILABLE` | AVAILABLE, RESERVED, SOLD |
| `min_price`, `max_price` | `10000000` | 가격 범위, 경계 포함 |
| `min_year`, `max_year` | `2020` | 연식 범위, 경계 포함 |
| `max_mileage` | `80000` | 최대 주행거리 km |
| `accident_free` | `true` | `true`는 사고 0건, `false`는 사고 1건 이상 |
| `sort` | `price_asc` | newest, price_asc, price_desc, mileage_asc, year_desc |

페이지 기반 목록은 결과 탐색과 임의 정렬에 편리하지만, 큰 `OFFSET`을 반복하는 전체 적재에는 적합하지 않습니다. 전체 적재에는 다음 커서 API를 사용합니다.

## 6. 커서와 체크포인트로 대량 수집

첫 요청은 다음과 같습니다.

```http
GET /api/v1/cars/cursor?after_id=0&limit=500
X-API-Key: ...
```

서버는 `id > after_id` 조건으로 기본키 순서의 차량을 최대 500건 반환합니다. 첫 응답의 `meta.until_id`와 `meta.dataset_epoch`가 모든 `links.next`에 유지되므로, 수집 중 새 매물이 생겨도 이번 순회는 유한하고 재시드도 감지할 수 있습니다. 응답의 `links.next`가 `null`이면 끝입니다.

커서 API는 전체 적재 전용이므로 검색 필터와 임의 정렬을 받지 않습니다. 조건별 탐색은 `/api/v1/cars`, 전체 원본 순회는 `/api/v1/cars/cursor`로 역할을 나눕니다.

```json
{
  "data": [{ "id": 1 }, { "id": 2 }],
  "meta": {
    "dataset_epoch": "f46a26d1-9772-4873-974f-d796fdcb5b8f",
    "after_id": 0,
    "until_id": 100000,
    "limit": 500,
    "returned": 500,
    "has_more": true
  },
  "links": {
    "self": "/api/v1/cars/cursor?after_id=0&limit=500",
    "next": "/api/v1/cars/cursor?after_id=500&until_id=100000&limit=500&dataset_epoch=f46a26d1-9772-4873-974f-d796fdcb5b8f"
  }
}
```

### 트랜잭션 체크포인트 예제

다음 코드는 Python 표준 라이브러리 SQLite를 로컬 수집 저장소로 사용합니다. 한 트랜잭션 안에서 차량 UPSERT와 마지막 ID 저장을 함께 처리하므로 실행을 강제로 중단해도 이미 커밋한 다음 ID부터 재개합니다.

```python
import json
import os
import sqlite3
import time

import requests

BASE_URL = os.environ.get("AUTODATA_BASE_URL", "http://127.0.0.1:4000")
API_KEY = os.environ["AUTODATA_API_KEY"]
STREAM_NAME = "cars-id-v1"
LIMIT = 500

db = sqlite3.connect("collected-cars.sqlite3")
db.execute("""
CREATE TABLE IF NOT EXISTS collected_cars (
    id INTEGER PRIMARY KEY,
    listing_number TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL
)
""")
db.execute("""
CREATE TABLE IF NOT EXISTS collection_checkpoint (
    stream_name TEXT PRIMARY KEY,
    after_id INTEGER NOT NULL,
    until_id INTEGER,
    dataset_epoch TEXT
)
""")
db.commit()

row = db.execute(
    "SELECT after_id, until_id, dataset_epoch FROM collection_checkpoint WHERE stream_name = ?",
    (STREAM_NAME,),
).fetchone()
after_id = row[0] if row else 0
until_id = row[1] if row else None
dataset_epoch = row[2] if row else None

session = requests.Session()
session.headers.update({
    "X-API-Key": API_KEY,
    "User-Agent": "AutoData-Classroom/1.0",
})

while True:
    params = {"after_id": after_id, "limit": LIMIT}
    if until_id is not None:
        params["until_id"] = until_id
    if dataset_epoch is not None:
        params["dataset_epoch"] = dataset_epoch
    response = session.get(
        f"{BASE_URL}/api/v1/cars/cursor",
        params=params,
        timeout=20,
    )
    if response.status_code == 409:
        current = response.json().get("error", {}).get("details", {}).get("current")
        raise RuntimeError(
            f"데이터셋이 재시드되었습니다(current={current}). "
            "새 target namespace와 checkpoint로 0부터 다시 수집하세요."
        )
    response.raise_for_status()
    payload = response.json()
    cars = payload["data"]
    response_until_id = payload["meta"]["until_id"]
    response_dataset_epoch = payload["meta"]["dataset_epoch"]
    if until_id is None:
        until_id = response_until_id
    elif response_until_id != until_id:
        raise RuntimeError("순회 중 until_id가 바뀌었습니다.")
    if dataset_epoch is None:
        dataset_epoch = response_dataset_epoch
    elif response_dataset_epoch != dataset_epoch:
        raise RuntimeError("순회 중 dataset_epoch가 바뀌었습니다.")

    if not cars:
        if payload["meta"]["has_more"]:
            raise RuntimeError("빈 페이지인데 has_more=true입니다.")
        with db:
            db.execute(
                """
                INSERT INTO collection_checkpoint (stream_name, after_id, until_id, dataset_epoch)
                VALUES (?, ?, NULL, ?)
                ON CONFLICT(stream_name) DO UPDATE SET
                    after_id = excluded.after_id,
                    until_id = NULL,
                    dataset_epoch = excluded.dataset_epoch
                """,
                (STREAM_NAME, after_id, dataset_epoch),
            )
        break

    next_after_id = cars[-1]["id"]
    with db:
        db.executemany(
            """
            INSERT INTO collected_cars (id, listing_number, payload_json)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                listing_number = excluded.listing_number,
                payload_json = excluded.payload_json
            """,
            [
                (
                    car["id"],
                    car["listingNumber"],
                    json.dumps(car, ensure_ascii=False),
                )
                for car in cars
            ],
        )
        db.execute(
            """
            INSERT INTO collection_checkpoint (stream_name, after_id, until_id, dataset_epoch)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(stream_name) DO UPDATE SET
                after_id = excluded.after_id,
                until_id = excluded.until_id,
                dataset_epoch = excluded.dataset_epoch
            """,
            (STREAM_NAME, next_after_id, until_id, dataset_epoch),
        )

    after_id = next_after_id
    print("checkpoint:", after_id, "batch:", len(cars))

    if not payload["meta"]["has_more"]:
        with db:
            db.execute(
                """
                UPDATE collection_checkpoint
                   SET until_id = NULL, dataset_epoch = ?
                 WHERE stream_name = ?
                """,
                (dataset_epoch, STREAM_NAME),
            )
        break
    time.sleep(0.1)

total = db.execute("SELECT COUNT(*) FROM collected_cars").fetchone()[0]
print("고유 차량 수:", total)
db.close()
```

MySQL에 직접 적재할 때도 원칙은 같습니다.

- `id` 또는 `listing_number`에 UNIQUE 제약을 둡니다.
- `INSERT ... ON DUPLICATE KEY UPDATE`로 같은 묶음을 다시 받아도 결과가 변하지 않게 합니다.
- 차량 묶음 저장과 `after_id`·`until_id`·`dataset_epoch` 체크포인트 갱신을 같은 트랜잭션에서 커밋합니다. 한 snapshot이 끝난 뒤에는 `until_id`만 비우고 epoch는 유지합니다.
- 연결 오류와 `5xx`는 제한 횟수로 재시도하고, `400`, `401`, `403`은 요청이나 키를 고친 뒤 다시 실행합니다.
- `409 DATASET_EPOCH_CHANGED`는 재시드 신호입니다. 기존 target에 이어 쓰지 말고 새 namespace를 준비한 뒤 cursor 0부터 시작합니다.
- `links.next`가 `null`이거나 `has_more=false`일 때만 완료로 기록합니다.

## 7. CSV 네 개의 의미와 검증 사실

CSV 디렉터리는 다음 환경 변수 하나로 지정할 수 있습니다.

```bash
export CSV_DATA_DIR='/absolute/path/to/dataset'
```

필요하면 파일별 경로를 각각 지정할 수도 있습니다.

| 파일 | 경로 환경 변수 | 호환 alias |
| --- | --- | --- |
| 직원 | `CSV_EMPLOYEE_PATH` | `EMPLOYEE_CSV_PATH` |
| 업무영역 | `CSV_BUSINESS_AREA_PATH` | `AREA_CSV_PATH` |
| join-ready | `CSV_JOIN_READY_PATH` | `AREA_JOIN_READY_CSV_PATH` |
| 상위영역 lookup | `CSV_PARENT_AREA_PATH` | `AREA_PARENT_LOOKUP_CSV_PATH` |

경로에 공백이나 한글이 있으면 반드시 따옴표로 감쌉니다.

### 실제 파일 구조

| 파일 | 행 수(헤더 제외) | 키와 의미 |
| --- | ---: | --- |
| `biz_employee_master.csv` | 3,000 | `EMP_NO`가 직원 PK |
| `biz_meta_area_50000.csv` | 50,000 | `AREA_ID`가 업무영역 PK, `PARENT_AREA_ID`는 자기참조, `MANAGER_EMP_NO`는 직원 FK |
| `biz_meta_area_parent_lookup.csv` | 1,000 | 상위 업무영역 lookup snapshot |
| `biz_meta_area_join_ready.csv` | 50,000 | 업무영역에 상위영역명과 관리자 정보를 미리 붙인 비정규화 snapshot |

검토된 원본의 품질 사실은 다음과 같습니다.

- 직원 3,000건의 `EMP_NO`는 모두 고유하고 필수 필드가 비어 있지 않습니다.
- 활성 직원은 2,801명, 비활성 직원은 199명입니다.
- 업무영역 50,000건의 `AREA_ID`는 모두 고유합니다.
- 상위 업무영역 1,000건은 `PARENT_AREA_ID`가 비어 있고, 하위 업무영역은 49,000건입니다.
- 업무영역의 `MANAGER_EMP_NO`는 직원 마스터와 모두 연결됩니다.
- 비활성 직원 199명 중 일부가 업무영역 관리자이며, 비활성 직원이 관리하는 업무영역은 3,293건입니다. FK 오류는 아니지만 별도의 업무 품질 규칙을 논의할 수 있는 사례입니다.
- parent lookup의 1,000개 ID·이름은 상위 업무영역과 모두 일치합니다.
- 다만 parent lookup의 `REG_DT`와 기본 업무영역 파일의 상위 1,000건 `REG_DT`는 1,000건 모두 다릅니다. 두 파일이 서로 다른 snapshot이라는 비교 포인트이며 한쪽 날짜로 덮어쓰지 않습니다.
- join-ready 50,000건은 기본 업무영역, 상위영역 이름, 직원 이름·부서·직급과 비교했을 때 불일치가 없습니다.

### Python으로 원본 검증

다음 스크립트는 직원 이름을 출력하지 않고 건수와 관계만 검증합니다.

```python
import csv
import os
from pathlib import Path

data_dir = Path(os.environ["CSV_DATA_DIR"])


def read_csv(name):
    with (data_dir / name).open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


employees = read_csv("biz_employee_master.csv")
areas = read_csv("biz_meta_area_50000.csv")
parents = read_csv("biz_meta_area_parent_lookup.csv")
join_ready = read_csv("biz_meta_area_join_ready.csv")

employee_by_no = {row["EMP_NO"]: row for row in employees}
area_by_id = {row["AREA_ID"]: row for row in areas}
parent_by_id = {row["AREA_ID"]: row for row in parents}
joined_by_id = {row["AREA_ID"]: row for row in join_ready}
roots = {row["AREA_ID"]: row for row in areas if not row["PARENT_AREA_ID"]}

assert len(employees) == len(employee_by_no) == 3_000
assert len(areas) == len(area_by_id) == 50_000
assert len(parents) == len(parent_by_id) == 1_000
assert len(join_ready) == len(joined_by_id) == 50_000
assert len(roots) == 1_000
assert sum(bool(row["PARENT_AREA_ID"]) for row in areas) == 49_000
assert all(row["MANAGER_EMP_NO"] in employee_by_no for row in areas)
assert all(
    not row["PARENT_AREA_ID"] or row["PARENT_AREA_ID"] in roots
    for row in areas
)
assert set(roots) == set(parent_by_id)
assert all(roots[key]["AREA_NM"] == parent_by_id[key]["AREA_NM"] for key in roots)

for area_id, source in area_by_id.items():
    ready = joined_by_id[area_id]
    for column in ("AREA_ID", "AREA_NM", "PARENT_AREA_ID", "MANAGER_EMP_NO", "REG_DT"):
        assert source[column] == ready[column]

    manager = employee_by_no[source["MANAGER_EMP_NO"]]
    assert ready["MANAGER_EMP_NM"] == manager["EMP_NM"]
    assert ready["MANAGER_DEPT_NM"] == manager["DEPT_NM"]
    assert ready["MANAGER_POSITION_NM"] == manager["POSITION_NM"]

    if source["PARENT_AREA_ID"]:
        assert ready["PARENT_AREA_NM"] == roots[source["PARENT_AREA_ID"]]["AREA_NM"]
    else:
        assert ready["PARENT_AREA_NM"] == ""

different_parent_dates = sum(
    roots[area_id]["REG_DT"] != parent_by_id[area_id]["REG_DT"]
    for area_id in roots
)

print({
    "employees": len(employees),
    "areas": len(areas),
    "root_areas": len(roots),
    "join_ready": len(join_ready),
    "different_parent_dates": different_parent_dates,
})
```

정상 원본의 원시 timestamp를 비교하면 `different_parent_dates`는 `1000`입니다. 이것을 오류로 고쳐 쓰는 대신 source별 날짜를 각각 보존합니다.

## 8. MySQL 관계 모델

핵심 관계는 다음과 같습니다.

```text
vehicle_brands ──< vehicle_models ──< vehicle_listings >── locations
                                           │
                                           ├── dealer_emp_no ──> employees
                                           │                       ▲
                                           └── business_area_id    │ manager_emp_no
                                                      │            │
                                                      └──> business_areas
                                                             │
                                                             └── parent_area_id ──┐
                                                                                  └─ self FK

business_area_parent_lookup       원본 lookup snapshot
business_area_join_ready          원본 비정규화 snapshot
v_business_area_normalized_join   정규화 테이블을 매번 조인한 결과
```

적재 순서는 FK 관계를 따릅니다.

1. `employees`
2. 상위 `business_areas`
3. 하위 `business_areas`
4. `business_area_parent_lookup`, `business_area_join_ready`
5. `locations`, `vehicle_brands`, `vehicle_models`
6. `vehicle_listings`
7. API 키 발급

CSV 디렉터리와 10만 건을 지정하는 기본 실행 형태는 다음과 같습니다.

```bash
CSV_DATA_DIR="$CSV_DATA_DIR" npm run db:seed -- --count=100000 --reset-mongo=true
```

데이터 재생성은 기존 실습 데이터를 비울 수 있으므로 수집기와 서버를 멈추고 필요한 DB를 백업한 뒤 실행합니다.

### FK 고아 레코드 검사

```sql
SELECT
  SUM(e.emp_no IS NULL) AS manager_orphans,
  SUM(a.parent_area_id IS NOT NULL AND p.area_id IS NULL) AS parent_orphans
FROM business_areas AS a
LEFT JOIN employees AS e
  ON e.emp_no = a.manager_emp_no
LEFT JOIN business_areas AS p
  ON p.area_id = a.parent_area_id;

SELECT
  SUM(m.id IS NULL) AS model_orphans,
  SUM(loc.id IS NULL) AS location_orphans,
  SUM(e.emp_no IS NULL) AS dealer_orphans,
  SUM(a.area_id IS NULL) AS area_orphans
FROM vehicle_listings AS l
LEFT JOIN vehicle_models AS m ON m.id = l.model_id
LEFT JOIN locations AS loc ON loc.id = l.location_id
LEFT JOIN employees AS e ON e.emp_no = l.dealer_emp_no
LEFT JOIN business_areas AS a ON a.area_id = l.business_area_id;
```

정상 적재라면 모든 값이 `0`입니다.

### 정규화 조인과 join-ready 비교

먼저 양쪽 행 수와 누락 ID를 검사합니다.

```sql
SELECT 'normalized_view' AS source_name, COUNT(*) AS row_count
FROM v_business_area_normalized_join
UNION ALL
SELECT 'join_ready', COUNT(*)
FROM business_area_join_ready;

SELECT COUNT(*) AS only_in_join_ready
FROM business_area_join_ready AS j
LEFT JOIN v_business_area_normalized_join AS v
  ON v.area_id = j.area_id
WHERE v.area_id IS NULL;

SELECT COUNT(*) AS only_in_normalized_view
FROM v_business_area_normalized_join AS v
LEFT JOIN business_area_join_ready AS j
  ON j.area_id = v.area_id
WHERE j.area_id IS NULL;
```

MySQL의 null-safe equality 연산자 `<=>`를 이용해 필드 불일치 행을 셉니다. 이 쿼리는 이름 자체를 결과에 출력하지 않습니다.

```sql
SELECT COUNT(*) AS mismatch_rows
FROM business_area_join_ready AS j
INNER JOIN v_business_area_normalized_join AS v
  ON v.area_id = j.area_id
WHERE NOT (j.area_name <=> v.area_name)
   OR NOT (j.parent_area_id <=> v.parent_area_id)
   OR NOT (j.parent_area_name <=> v.parent_area_name)
   OR NOT (j.manager_emp_no <=> v.manager_emp_no)
   OR NOT (j.manager_emp_name <=> v.manager_emp_name)
   OR NOT (j.manager_dept_name <=> v.manager_dept_name)
   OR NOT (j.manager_position_name <=> v.manager_position_name)
   OR NOT (j.registered_at <=> v.registered_at);
```

정상 원본이면 행 수는 각각 50,000이고 누락과 불일치는 모두 `0`입니다.

### Parent lookup snapshot 비교

```sql
SELECT
  COUNT(*) AS matched_ids,
  SUM(p.area_name <=> a.area_name) AS matched_names,
  SUM(NOT (p.registered_at <=> a.registered_at)) AS different_dates
FROM business_area_parent_lookup AS p
INNER JOIN business_areas AS a
  ON a.area_id = p.area_id
WHERE a.parent_area_id IS NULL;
```

현재 스키마는 `registered_at`을 `DATE`로 저장합니다. 원시 timestamp 1,000건은 모두 다르지만 날짜만 남기면 우연히 같은 날짜가 1건 있으므로, 제공된 원본의 MySQL 기대값은 `matched_ids=1000`, `matched_names=1000`, `different_dates=999`입니다. 컬럼을 `DATETIME`으로 보존하는 변형 실습에서는 `different_dates=1000`이 됩니다.

비활성 관리자는 FK 고아 레코드와 다른 품질 문제입니다. 다음 쿼리의 제공 원본 기대값은 3,293건입니다.

```sql
SELECT COUNT(*) AS areas_managed_by_inactive_employees
FROM business_areas AS a
INNER JOIN employees AS e
  ON e.emp_no = a.manager_emp_no
WHERE e.is_active = 0;
```

### 개인정보를 제외한 차량–조직 조인

아래 예제는 내부 FK로 조인하지만 직원 번호를 선택하지 않고 이름도 마스킹합니다.

```sql
SELECT
  l.listing_number,
  b.name AS brand_name,
  m.name AS model_name,
  l.model_year,
  l.price,
  loc.province,
  loc.city,
  a.area_name AS business_area_name,
  CONCAT(
    LEFT(e.emp_name, 1),
    REPEAT('○', LEAST(2, GREATEST(1, CHAR_LENGTH(e.emp_name) - 1)))
  ) AS dealer_display_name,
  e.dept_name AS dealer_department,
  e.position_name AS dealer_position
FROM vehicle_listings AS l
INNER JOIN vehicle_models AS m ON m.id = l.model_id
INNER JOIN vehicle_brands AS b ON b.id = m.brand_id
INNER JOIN locations AS loc ON loc.id = l.location_id
INNER JOIN business_areas AS a ON a.area_id = l.business_area_id
INNER JOIN employees AS e ON e.emp_no = l.dealer_emp_no
ORDER BY l.id
LIMIT 20;
```

## 9. API 개인정보 회귀 검사

API 응답에 내부 직원 식별자가 실수로 추가되지 않았는지 자동으로 확인할 수 있습니다.

```python
import os
import requests

base_url = os.environ.get("AUTODATA_BASE_URL", "http://127.0.0.1:4000")
key = os.environ["AUTODATA_API_KEY"]
response = requests.get(
    f"{base_url}/api/v1/cars?page_size=100",
    headers={"X-API-Key": key},
    timeout=10,
)
response.raise_for_status()
payload = response.json()

forbidden = {
    "EMP_NO", "EMP_NM", "empNo", "empName",
    "employeeNo", "employeeName", "dealerEmpNo", "hiredAt",
}


def all_keys(value):
    if isinstance(value, dict):
        for key_name, child in value.items():
            yield key_name
            yield from all_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from all_keys(child)


leaked = forbidden.intersection(all_keys(payload))
assert not leaked, f"비공개 직원 필드가 API에 포함됨: {sorted(leaked)}"
assert all("code" in car["dealer"] for car in payload["data"])
assert all("displayName" in car["dealer"] for car in payload["data"])
print("직원 원본 식별자 비공개 검사 통과")
```

## 10. 권장 과제

### 기본

1. `/cars` 3페이지를 수집하고 `data-car-id` 중복, 필수 필드 누락, 다음 링크 종료 조건을 검사합니다.
2. 브랜드와 연식 조건을 HTML과 API에 똑같이 적용한 뒤 차량 ID와 가격이 일치하는지 비교합니다.
3. API 키 없이 호출했을 때와 잘못된 키로 호출했을 때의 상태 코드와 오류 envelope를 기록합니다.

### 중급

1. 커서 수집을 5회 반복한 뒤 프로세스를 강제 종료하고, 재실행 시 체크포인트부터 이어지는지 확인합니다.
2. 같은 커서 묶음을 두 번 적재해도 고유 차량 수가 늘지 않도록 UPSERT를 구현합니다.
3. OFFSET 페이지와 ID 커서로 각각 10만 건을 순회하고 처리 시간과 SQL 실행 계획을 비교합니다.
4. 사고가 없는 차량의 브랜드별 평균 가격과 평균 주행거리를 계산합니다.

### 관계형 데이터

1. Python 검증 코드와 MySQL 검증 SQL을 각각 실행해 같은 관계 품질 결과가 나오는지 비교합니다.
2. `v_business_area_normalized_join`과 `business_area_join_ready`의 불일치가 0건인지 검증합니다.
3. parent lookup의 이름은 일치하지만 날짜가 다른 이유를 source snapshot 관점에서 설명합니다.
4. 차량 소재지와 업무영역을 한 차트에 섞지 않고 별도 차원으로 집계합니다.
5. 직원 원본 이름과 번호를 제외한 제출용 결과 테이블 또는 뷰를 만듭니다.

## 11. 운영 체크리스트

### 수업 전

- [ ] 서버와 학생 장치가 같은 신뢰 가능한 Wi-Fi에 연결되어 있습니다.
- [ ] `HOST=0.0.0.0`으로 실행하고 교실 IP와 포트를 확인했습니다.
- [ ] `/healthz`, `/cars`, `/robots.txt`를 교사 장치와 학생 장치에서 각각 확인했습니다.
- [ ] MySQL 실습 전 기존 데이터를 백업하고 CSV 네 파일의 경로와 읽기 권한을 확인했습니다.
- [ ] CSV 원시 timestamp 차이 1,000건과 MySQL `DATE` 비교 차이 999건을 각각 확인했습니다.
- [ ] 반 또는 조별 API 키를 발급하고 원문 키를 안전한 채널로 한 번만 전달했습니다.
- [ ] API 키를 노트북, Git, 채팅 로그, URL 쿼리에 기록하지 않도록 안내했습니다.
- [ ] 요청 간격, 동시 실행 인원, 최대 수집 범위를 학생에게 공지했습니다.

### 수업 중

- [ ] 학생은 응답 상태를 확인한 뒤 HTML 또는 JSON을 파싱합니다.
- [ ] HTML 수집기는 `rel=next`, API 수집기는 `links.next`와 `has_more`로 종료합니다.
- [ ] 전체 수집은 커서와 체크포인트를 사용하고, 페이지마다 즉시 저장합니다.
- [ ] 중복 수집에 대비해 `id` 또는 `listingNumber`로 UPSERT합니다.
- [ ] 서버 로그에 API 원문 키나 직원 원본 필드를 출력하지 않습니다.
- [ ] 다수의 `401`, `403`, `5xx`, 연결 풀 포화가 발생하면 무조건 재시도하지 말고 원인을 먼저 확인합니다.
- [ ] `AREA`를 실제 주소로 해석한 결과가 없는지 중간 산출물을 확인합니다.

### 수업 후

- [ ] 학생 수집기를 먼저 중지하고 서버를 정상 종료합니다.
- [ ] 더 이상 사용할 필요가 없는 MySQL API 키는 prefix로 폐기합니다.
- [ ] 메모리 키는 `UCAR_API_KEY` 또는 `UCAR_API_KEYS`에서 제거한 뒤 서버를 재시작합니다.
- [ ] 노트북 출력과 제출 파일에서 직원 번호·원본 이름·입사일을 제거합니다.
- [ ] 체크포인트와 수집 DB를 보존할지 삭제할지 수업 정책에 따라 결정합니다.
- [ ] MySQL 컨테이너만 멈출 때는 `docker compose stop mysql`을 사용합니다.
- [ ] `docker compose down -v`는 볼륨 삭제 의도가 분명할 때만 사용합니다.

MySQL 키는 다음처럼 공개 prefix로 폐기할 수 있습니다.

```bash
node scripts/create-api-key.mjs revoke \
  --source mysql \
  --prefix ucar_v1_0123456789abcdef
```

## 12. 자주 만나는 문제

| 증상 | 확인할 것 |
| --- | --- |
| 학생 장치에서 연결 거부 | 같은 Wi-Fi, 서버의 `HOST=0.0.0.0`, 방화벽, AP/클라이언트 격리 |
| `401 API_KEY_REQUIRED` | `X-API-Key` 또는 Bearer 헤더 누락 |
| `403 API_KEY_INVALID` | 키 오타, 폐기된 키, 두 인증 헤더 동시 사용 |
| `400 INVALID_QUERY` | 허용된 fuel/status/sort 값, 숫자 범위, 최소·최대값 순서 |
| HTML 결과 0건 | 필터 조합, 마지막 페이지, 선택자 오타 |
| 커서 수집 중 중복 | 체크포인트와 데이터 저장을 다른 트랜잭션에서 처리했는지 확인 |
| 커서 수집이 끝나지 않음 | 마지막 ID 대신 요청의 `after_id`를 다시 저장하지 않았는지 확인 |
| CSV FK 오류 | 직원 → 상위 업무영역 → 하위 업무영역 순서와 빈 parent의 `NULL` 변환 |
| 지역 집계가 이상함 | `business_areas`를 지리로 사용하지 않았는지 확인 |
| join-ready 날짜 비교 혼란 | base area와 parent lookup은 서로 다른 snapshot 날짜를 보존함 |
