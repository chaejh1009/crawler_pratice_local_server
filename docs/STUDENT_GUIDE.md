# AutoData Lab 수강생 사용설명서

이 문서는 배포자가 실행해 둔 AutoData Lab에 접속해 중고차 HTML과 JSON API를 수집하는 수강생용 안내서입니다. 수강생에게 필요한 것은 다음 두 가지입니다.

- 배포자가 알려 준 서버 주소(예: `http://192.168.0.23:4000`)
- 배포자가 안전한 방법으로 전달한 API 키(형식: `ucar_v1_...`)

수강생은 Docker, MySQL, MongoDB, Node.js 서버를 설치하거나 실행하지 않습니다. 이 문서의 `127.0.0.1`은 서버와 실습 코드가 같은 컴퓨터에서 실행될 때만 유효합니다. 교실 서버에 접속할 때는 반드시 배포자가 알려 준 주소를 사용하세요.

## 1. 준비물과 환경 변수

필수 준비물은 웹 브라우저와 `curl`입니다. Python 수집 실습까지 진행한다면 Python 3.10 이상을 준비합니다.

서버 주소 끝에는 `/`를 붙이지 않는 것을 권장합니다.

### macOS 또는 Linux

```bash
export AUTODATA_BASE_URL='http://192.168.0.23:4000'
printf 'API 키: '
read -r -s AUTODATA_API_KEY
printf '\n'
export AUTODATA_API_KEY
```

`API 키:`가 표시되면 배포자가 전달한 원문 키를 붙여 넣고 Enter를 누릅니다. 입력한 문자는 화면과 셸 명령 기록에 표시되지 않습니다.

### Windows PowerShell

```powershell
$env:AUTODATA_BASE_URL = 'http://192.168.0.23:4000'
$secureKey = Read-Host 'API 키' -AsSecureString
$env:AUTODATA_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
Remove-Variable secureKey
```

PowerShell에서도 프롬프트가 나타난 뒤 원문 키를 입력합니다. 키 원문을 `$env:AUTODATA_API_KEY = '...'` 형태로 직접 명령 기록에 남기지 마세요.

환경 변수는 현재 터미널 창에서만 사용합니다. 공용 컴퓨터에서는 실습이 끝난 뒤 키를 제거하세요.

macOS 또는 Linux:

```bash
unset AUTODATA_API_KEY
```

Windows PowerShell:

```powershell
Remove-Item Env:AUTODATA_API_KEY
```

## 2. 접속과 수집 정책 확인

먼저 API 키가 필요 없는 상태 확인 경로를 호출합니다.

macOS 또는 Linux:

```bash
curl --include "$AUTODATA_BASE_URL/healthz"
curl "$AUTODATA_BASE_URL/robots.txt"
```

Windows PowerShell에서는 `curl`이 다른 명령의 별칭일 수 있으므로 이 문서에서는 `curl.exe`를 사용합니다.

```powershell
curl.exe --include "${env:AUTODATA_BASE_URL}/healthz"
curl.exe "${env:AUTODATA_BASE_URL}/robots.txt"
```

정상 상태라면 `/healthz`가 `200 OK`와 함께 `"ok": true`를 반환합니다. `503`이거나 연결되지 않으면 반복 요청하지 말고 배포자에게 알리세요.

브라우저에서도 다음 주소를 차례로 엽니다.

1. `<서버 주소>/crawl-policy`
2. `<서버 주소>/robots.txt`
3. `<서버 주소>/cars?page_size=5`

`robots.txt`는 공개 HTML 경로를 안내하고 일반 웹 크롤러가 `/api/`를 순회하지 않도록 제한합니다. 수업용 JSON API는 배포자가 발급한 키를 헤더에 넣어 사용하는 별도 경로입니다. HTML 수집 요청 사이에는 최소 1초를 기다리세요. 이 서버의 수집 허가는 다른 웹사이트에 적용되지 않습니다.

## 3. 브라우저 화면 사용법

| 경로 | 인증 | 용도 |
| --- | --- | --- |
| `/` | 공개 | 데이터셋 현황과 실습 메뉴 |
| `/cars` | 공개 | 차량 검색·필터·정렬·페이지 이동 |
| `/cars/:id` | 공개 | 차량 한 건의 상세 정보 |
| `/changes` | 공개 | 고정된 상한까지 변경 이벤트 순회 |
| `/generation-runs` | 공개 | 데이터 생성 상태 이벤트 순회 |
| `/docs` | 공개 | API 요약과 브라우저 API 탐색기 |
| `/learning-guide` | 공개 | HTML·API·CSV 관계 학습 순서 |
| `/crawl-policy` | 공개 | 이 서버에서 허용한 수집 범위 |

### 차량 목록과 상세

`/cars`에서는 검색어, 브랜드, 연료, 판매 상태, 차량 소재지, 최소 연식, 최대 주행거리, 최소·최대 가격, 정렬 방식, 표시 개수를 선택한 뒤 **조건 적용**을 누릅니다. 표시 개수는 12, 24, 48, 100개 중에서 고를 수 있고, HTML 목록의 기본값은 24개입니다.

차량 제목을 누르면 `/cars/:id` 상세 화면으로 이동합니다. 목록 아래의 **이전**, **다음** 링크를 사용하고, 마지막 페이지에서 **다음**이 비활성화되면 정상 종료입니다. 조건에 맞는 차량이 없을 때 0건이 표시되는 것도 정상 결과입니다.

### API 문서와 탐색기

`/docs`에는 현재 서버 주소, 엔드포인트, 필터 표, API 탐색기가 있습니다. 탐색기에서 API 키와 조건을 입력하고 **GET 요청 보내기**를 누르면 상태 코드와 JSON 응답을 확인할 수 있습니다. 탐색기는 키를 브라우저 저장소에 저장하지 않지만, 공용 화면에 키가 보이거나 캡처되지 않도록 주의하고 사용 후 페이지를 닫으세요.

## 4. HTML 수집 실습

### 안정적인 선택자

화면에 보이는 가격과 주행거리에는 쉼표, `원`, `km`가 포함됩니다. 가능하면 화면 문자열을 다시 계산하지 말고 `value`와 `data-*` 원시 값을 사용하세요.

| 대상 | CSS 선택자 또는 속성 |
| --- | --- |
| 목록 컨테이너 | `[data-car-list]` |
| 차량 카드 | `article.car-card[data-car-id]` |
| 차량 ID | 카드의 `data-car-id` |
| 매물 번호 | 카드의 `data-listing-number` |
| 판매 상태 | 카드의 `data-status` |
| 제목 | `[data-field="title"]` |
| 상세 링크 | `[data-field="title"] a[href]` |
| 가격 원시 값 | `data[data-field="price"]`의 `value` |
| 연식 | `[data-field="model-year"]` |
| 주행거리 | `[data-field="mileage"]` |
| 연료 | `[data-field="fuel"]` |
| 소재지 | `[data-field="location"]` |
| 다음 페이지 | `a[rel="next"]` |

### Python 환경 준비

macOS 또는 Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install requests beautifulsoup4
```

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install requests beautifulsoup4
```

### 최대 3페이지 수집 예제

다음 코드는 현재 문서의 `a[rel="next"]`를 따라가며 요청 사이에 1초를 기다립니다. 다음 URL을 페이지 번호로 직접 추측하지 않습니다.

```python
import os
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = os.environ["AUTODATA_BASE_URL"].rstrip("/")
session = requests.Session()
session.headers.update({"User-Agent": "AutoData-Classroom/1.0"})

url = f"{BASE_URL}/cars?page_size=24"
seen_ids = set()
records = []

for _ in range(3):
    response = session.get(url, timeout=10)
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
        detail = card.select_one('[data-field="title"] a[href]')
        if title is None or price is None or detail is None:
            raise RuntimeError(f"필수 선택자 누락: {car_id}")

        records.append({
            "id": car_id,
            "listing_number": card.get("data-listing-number"),
            "title": title.get_text(" ", strip=True),
            "price": int(price["value"]),
            "status": card.get("data-status"),
            "detail_url": urljoin(response.url, detail["href"]),
        })

    next_link = soup.select_one('a[rel="next"]')
    if next_link is None:
        break

    url = urljoin(response.url, next_link["href"])
    time.sleep(1.0)

print("수집 건수:", len(records))
print("고유 ID 수:", len(seen_ids))
print(records[:2])
```

응답 상태를 확인한 뒤 파싱하고, 카드가 0개라고 즉시 프로그램 오류로 판단하지 마세요. 필터 결과가 없거나 마지막 범위를 지난 경우일 수 있습니다.

## 5. API 키와 JSON API

`/api/v1/*`의 `GET`과 `HEAD` 요청에는 API 키가 필요합니다. 다음 두 인증 방식 가운데 하나만 사용합니다.

macOS 또는 Linux:

```bash
curl --include "$AUTODATA_BASE_URL/api/v1/cars?page_size=5" \
  -H "X-API-Key: $AUTODATA_API_KEY"

curl "$AUTODATA_BASE_URL/api/v1/stats" \
  -H "Authorization: Bearer $AUTODATA_API_KEY"
```

Windows PowerShell:

```powershell
curl.exe --include "${env:AUTODATA_BASE_URL}/api/v1/cars?page_size=5" `
  -H "X-API-Key: $env:AUTODATA_API_KEY"

curl.exe "${env:AUTODATA_BASE_URL}/api/v1/stats" `
  -H "Authorization: Bearer $env:AUTODATA_API_KEY"
```

API 키를 URL의 쿼리 문자열에 넣지 마세요. `X-API-Key`와 `Authorization`을 한 요청에 동시에 보내면 `403`입니다. 정상 응답에 보이는 `X-API-Key-Prefix`는 원문 키가 아니라 공개 식별용 prefix입니다.

### 엔드포인트

| 경로 | 용도 |
| --- | --- |
| `/api/v1/cars` | 검색·필터·정렬·페이지 조회 |
| `/api/v1/cars/cursor` | 전체 차량을 ID 커서로 순회 |
| `/api/v1/changes` | 성공이 검증된 변경 이벤트 증분 수집 |
| `/api/v1/generation-runs` | append-only 생성 상태 이벤트 수집 |
| `/api/v1/cars/:id` | 차량 한 건 조회 |
| `/api/v1/brands` | 브랜드와 차량 수 |
| `/api/v1/locations` | 실제 차량 소재지와 차량 수 |
| `/api/v1/business-areas` | 업무영역과 공개용 관리자 정보 |
| `/api/v1/stats` | 데이터셋 통계와 현재 epoch |

## 6. 필터와 페이지네이션

### 차량 필터 계약

`/api/v1/cars`의 JSON 속성은 `camelCase`, 쿼리와 페이지 메타데이터는 `snake_case`입니다.

| 매개변수 | 허용값과 의미 |
| --- | --- |
| `page` | 1~100,000 정수, 기본값 1 |
| `page_size` | 1~100 정수, 기본값 20 |
| `q` | 최대 100자, 제목·설명 검색 |
| `brand` | 브랜드 양의 숫자 ID 또는 slug |
| `location` | 소재지 양의 숫자 ID 또는 slug |
| `fuel` | `가솔린`, `디젤`, `하이브리드`, `전기`, `LPG` |
| `status` | `AVAILABLE`, `RESERVED`, `SOLD` |
| `min_price`, `max_price` | 0~1,000,000,000, 경계 포함 |
| `min_year`, `max_year` | 1990~2030, 경계 포함 |
| `max_mileage` | 0~1,000,000km, 경계 포함 |
| `accident_free` | `true`/`false` 또는 `1`/`0` |
| `sort` | `newest`, `price_asc`, `price_desc`, `mileage_asc`, `year_desc` |

`min_price`는 `max_price`보다 클 수 없고 `min_year`는 `max_year`보다 클 수 없습니다. 브랜드와 소재지의 실제 slug는 `/api/v1/brands`, `/api/v1/locations`에서 먼저 확인하세요. 알 수 없는 쿼리 이름은 무시되므로 오탈자가 있어도 오류가 나지 않을 수 있습니다.

macOS 또는 Linux 필터 예제:

```bash
curl --get "$AUTODATA_BASE_URL/api/v1/cars" \
  -H "X-API-Key: $AUTODATA_API_KEY" \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=50' \
  --data-urlencode 'brand=hyundai' \
  --data-urlencode 'fuel=하이브리드' \
  --data-urlencode 'status=AVAILABLE' \
  --data-urlencode 'min_year=2020' \
  --data-urlencode 'max_mileage=80000' \
  --data-urlencode 'accident_free=true' \
  --data-urlencode 'sort=price_asc'
```

Windows PowerShell 필터 예제:

```powershell
curl.exe --get "${env:AUTODATA_BASE_URL}/api/v1/cars" `
  -H "X-API-Key: $env:AUTODATA_API_KEY" `
  --data-urlencode "page=1" `
  --data-urlencode "page_size=50" `
  --data-urlencode "brand=hyundai" `
  --data-urlencode "fuel=하이브리드" `
  --data-urlencode "status=AVAILABLE" `
  --data-urlencode "min_year=2020" `
  --data-urlencode "max_mileage=80000" `
  --data-urlencode "accident_free=true" `
  --data-urlencode "sort=price_asc"
```

### `data`, `meta`, `links`

목록 응답은 다음 세 부분으로 나뉩니다.

- `data`: 현재 페이지의 차량 배열
- `meta`: `page`, `page_size`, `total`, `total_pages`, `returned`, 적용된 필터와 정렬
- `links`: `self`, `previous`, `next`

첫 페이지의 `previous`와 마지막 페이지의 `next`는 `null`입니다. 범위를 벗어난 페이지와 검색 결과 0건은 오류가 아니라 `200 OK`와 빈 `data` 배열을 반환합니다. 다음 URL을 직접 조립하지 말고 서버가 반환한 `links.next`를 사용하세요. `links.next`에는 API 키가 없으므로 매 요청에 인증 헤더를 다시 보냅니다.

다음 Python 예제는 필터를 적용한 모든 페이지를 순회합니다.

```python
import os
import time
from urllib.parse import urljoin

import requests

BASE_URL = os.environ["AUTODATA_BASE_URL"].rstrip("/")
API_KEY = os.environ["AUTODATA_API_KEY"]

session = requests.Session()
session.headers.update({
    "X-API-Key": API_KEY,
    "User-Agent": "AutoData-Classroom/1.0",
})

path = "/api/v1/cars?brand=hyundai&status=AVAILABLE&page_size=100&sort=price_asc"
seen_ids = set()

while path:
    response = session.get(urljoin(BASE_URL + "/", path), timeout=10)
    response.raise_for_status()
    payload = response.json()

    for car in payload["data"]:
        if car["id"] in seen_ids:
            raise RuntimeError(f"중복 차량 ID: {car['id']}")
        seen_ids.add(car["id"])

    print("page:", payload["meta"]["page"], "returned:", payload["meta"]["returned"])
    path = payload["links"]["next"]
    if path:
        time.sleep(1.0)

print("고유 차량 수:", len(seen_ids))
```

페이지 번호 방식은 조건 검색과 화면 탐색에 적합합니다. 전체 데이터 적재에는 큰 `OFFSET` 대신 다음 절의 커서를 사용하세요.

## 7. 커서, epoch, UPSERT로 전체 수집

첫 요청은 다음과 같습니다.

macOS 또는 Linux:

```bash
curl --get "$AUTODATA_BASE_URL/api/v1/cars/cursor" \
  -H "X-API-Key: $AUTODATA_API_KEY" \
  --data-urlencode 'after_id=0' \
  --data-urlencode 'limit=500'
```

Windows PowerShell:

```powershell
curl.exe --get "${env:AUTODATA_BASE_URL}/api/v1/cars/cursor" `
  -H "X-API-Key: $env:AUTODATA_API_KEY" `
  --data-urlencode "after_id=0" `
  --data-urlencode "limit=500"
```

커서의 핵심 값은 다음과 같습니다.

- `after_id`: 마지막으로 저장을 완료한 차량 ID
- `until_id`: 첫 응답이 고정한 이번 전체 수집의 상한
- `dataset_epoch`: 재시드 여부를 판별하는 데이터셋 식별자
- `limit`: 1~500

첫 응답의 `meta.until_id`와 `meta.dataset_epoch`는 이번 순회가 끝날 때까지 바꾸지 않습니다. 서버가 반환한 `links.next`에는 이 값이 포함됩니다. `links.next == null` 또는 `meta.has_more == false`이면 완료입니다. 이 API는 필터와 임의 정렬을 지원하지 않고 ID 오름차순으로만 반환합니다.

수집 결과에는 `id` 또는 `listingNumber` UNIQUE 제약을 두고 UPSERT합니다. 한 묶음의 차량 저장과 체크포인트 갱신은 같은 트랜잭션에서 커밋해야 합니다. 그래야 중간에 프로그램이 종료되어도 마지막으로 완전히 저장한 위치부터 안전하게 다시 시작할 수 있습니다.

### SQLite 체크포인트 예제

다음 예제는 Python 표준 라이브러리 SQLite에 차량 JSON과 체크포인트를 저장합니다. 같은 묶음을 다시 받아도 차량 수가 증가하지 않습니다.

```python
import json
import os
import sqlite3
import time
from urllib.parse import urlencode, urljoin

import requests

BASE_URL = os.environ["AUTODATA_BASE_URL"].rstrip("/")
API_KEY = os.environ["AUTODATA_API_KEY"]
STREAM = "cars-id-v1"
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
    (STREAM,),
).fetchone()
after_id, until_id, dataset_epoch = row if row else (0, None, None)

params = {"after_id": after_id, "limit": LIMIT}
if until_id is not None:
    params["until_id"] = until_id
if dataset_epoch is not None:
    params["dataset_epoch"] = dataset_epoch
path = "/api/v1/cars/cursor?" + urlencode(params)

session = requests.Session()
session.headers.update({
    "X-API-Key": API_KEY,
    "User-Agent": "AutoData-Classroom/1.0",
})

while path:
    response = session.get(urljoin(BASE_URL + "/", path), timeout=20)
    if response.status_code == 409:
        current = response.json().get("error", {}).get("details", {}).get("current")
        raise RuntimeError(
            f"데이터셋이 바뀌었습니다(current={current}). "
            "기존 DB에 이어 쓰지 말고 새 파일 또는 namespace로 0부터 수집하세요."
        )
    response.raise_for_status()
    payload = response.json()
    cars = payload["data"]
    meta = payload["meta"]

    if until_id is None:
        until_id = meta["until_id"]
    elif until_id != meta["until_id"]:
        raise RuntimeError("순회 중 until_id가 바뀌었습니다.")

    if dataset_epoch is None:
        dataset_epoch = meta["dataset_epoch"]
    elif dataset_epoch != meta["dataset_epoch"]:
        raise RuntimeError("순회 중 dataset_epoch가 바뀌었습니다.")

    if not cars and meta["has_more"]:
        raise RuntimeError("빈 응답인데 has_more=true입니다.")

    next_after_id = cars[-1]["id"] if cars else after_id
    completed = not meta["has_more"]

    # 차량 UPSERT와 체크포인트를 한 트랜잭션으로 커밋합니다.
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
                (car["id"], car["listingNumber"], json.dumps(car, ensure_ascii=False))
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
            (STREAM, next_after_id, None if completed else until_id, dataset_epoch),
        )

    after_id = next_after_id
    print("checkpoint:", after_id, "batch:", len(cars), "epoch:", dataset_epoch)
    path = payload["links"]["next"]
    if path:
        time.sleep(1.0)

total = db.execute("SELECT COUNT(*) FROM collected_cars").fetchone()[0]
print("고유 차량 수:", total)
db.close()
```

`409 DATASET_EPOCH_CHANGED`는 배포자가 데이터를 재시드해 ID 수명주기가 바뀌었다는 뜻입니다. 기존 수집 DB에 새 데이터를 섞거나 체크포인트만 0으로 덮어쓰지 마세요. 기존 결과를 보존한 뒤 새 DB 파일 또는 별도 namespace를 만들고 새 epoch에서 다시 시작합니다.

## 8. 변경 로그 증분 수집

전체 현재 상태는 `/api/v1/cars/cursor`, 이후 성공이 검증된 변경 이벤트는 `/api/v1/changes`로 수집합니다.

```bash
curl --get "$AUTODATA_BASE_URL/api/v1/changes" \
  -H "X-API-Key: $AUTODATA_API_KEY" \
  --data-urlencode 'after_seq=0' \
  --data-urlencode 'limit=500'
```

첫 요청에서는 `until_seq`를 생략합니다. 서버가 현재 마지막 이벤트를 이번 실행의 high-water mark로 고정합니다. 이후에는 같은 `until_seq`와 `dataset_epoch`가 든 `links.next`를 그대로 따라갑니다. `eventId` 또는 `(listingNumber, entityVersion)`을 멱등 키로 사용하고, 이벤트 저장과 `after_seq` 체크포인트 갱신을 같은 트랜잭션으로 처리하세요.

수집 중 새 이벤트가 생겨도 고정된 `until_seq`보다 큰 이벤트는 다음 실행에서 처리합니다. 따라서 한 번의 순회는 유한하게 끝납니다. 자세한 응답 필드와 재시작 알고리즘은 [API 상세 문서](API.md#증분-변경-로그)를 참고하세요.

## 9. CSV와 업무영역 데이터

이 서버에는 CSV 다운로드 기능이 없습니다. `/api/v1/business-areas`는 서버가 보유한 직원·업무영역 관계에서 공개 가능한 필드만 JSON으로 제공하는 API입니다.

```bash
curl --get "$AUTODATA_BASE_URL/api/v1/business-areas" \
  -H "X-API-Key: $AUTODATA_API_KEY" \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=50' \
  --data-urlencode 'q=수도권'
```

`page`, `page_size`, `q`, `parent_id`를 사용할 수 있습니다. 응답의 관리자는 공개 코드와 마스킹된 표시명만 포함합니다.

원본 CSV 실습은 배포자가 승인된 파일을 별도 실습 자료로 제공했을 때만 진행합니다.

| 파일 | 검증된 행 수 | 의미 |
| --- | ---: | --- |
| `biz_employee_master.csv` | 3,000 | 직원 마스터, `EMP_NO`가 PK |
| `biz_meta_area_50000.csv` | 50,000 | 업무영역, `AREA_ID`가 PK |
| `biz_meta_area_parent_lookup.csv` | 1,000 | 상위 업무영역 snapshot |
| `biz_meta_area_join_ready.csv` | 50,000 | 정규화 조인 결과 검증용 snapshot |

CSV의 `AREA`는 주소나 행정구역이 아니라 생산, 영업, 물류, IT 같은 업무·조직 영역입니다. 차량의 실제 소재지는 API의 `location.province`, `location.city`입니다. 두 차원을 섞어 지도나 지역 통계를 만들지 마세요.

원본 CSV의 직원 번호와 이름은 관계 검증용 내부 필드입니다. 원본 행, 직원 이름·번호·입사일, SQL 덤프, 원문이 보이는 화면 캡처를 Git, 채팅방, 공개 저장소 또는 제출물에 포함하지 마세요. CSV의 상세 관계 검증 실습은 [학습 가이드의 CSV 절](LEARNING_GUIDE.md#7-csv-네-개의-의미와-검증-사실)을 참고하세요.

## 10. 보안과 수집 예절

- API 키는 요청 헤더로만 전달하고 URL, 소스 코드, Git, 노트북 출력, 로그에 남기지 않습니다.
- `links.next`를 공유하거나 기록할 수는 있지만, 헤더 전체나 API 키 원문은 기록하지 않습니다.
- HTML 요청 사이에는 최소 1초를 기다립니다.
- API 응답의 `RateLimit-Remaining`, `RateLimit-Reset`을 확인하고 `429`에서는 `Retry-After`가 지난 뒤 재개합니다.
- 한 번에 모든 응답을 메모리에 모으지 말고 페이지 또는 묶음 단위로 즉시 저장합니다.
- 중복 요청에 대비해 안정적인 ID와 UPSERT를 사용합니다.
- 공개 딜러 코드와 마스킹 이름은 가명처리된 값이지 완전한 익명정보가 아닙니다.
- 이 서버의 합성 데이터 수집 허가를 다른 웹사이트의 허가로 해석하지 않습니다.

## 11. 오류와 문제 해결

| 증상 또는 상태 | 의미와 조치 |
| --- | --- |
| 연결 거부·시간 초과 | 서버 주소와 포트, 같은 Wi-Fi, 배포자 서버 상태를 확인합니다. 학생 PC에서 교실 서버를 `127.0.0.1`로 호출하지 마세요. 방화벽 또는 AP/클라이언트 격리는 배포자에게 확인합니다. |
| 브라우저 탐색기의 `NETWORK ERROR` | 서버 주소와 네트워크를 확인하고 `/healthz`를 먼저 호출합니다. |
| `400 INVALID_QUERY` | 숫자 범위, 연료·상태·정렬값, 최소값과 최대값 순서를 고칩니다. 같은 요청을 그대로 반복하지 않습니다. |
| `401 API_KEY_REQUIRED` | `X-API-Key` 또는 Bearer 헤더가 빠졌습니다. |
| `403 API_KEY_INVALID` | 키 오타·폐기 여부와 두 인증 헤더를 동시에 보냈는지 확인합니다. |
| `404 CAR_NOT_FOUND` | 해당 숫자 차량 ID가 없습니다. |
| `404 ENDPOINT_NOT_FOUND` | API 경로와 `/api/v1` 접두사를 확인합니다. |
| `405 METHOD_NOT_ALLOWED` | API는 `GET`, `HEAD`, `OPTIONS`만 지원합니다. |
| `409 DATASET_EPOCH_CHANGED` | 기존 적재를 멈추고 새 target과 체크포인트로 0부터 수집합니다. |
| `429 RATE_LIMITED` | 즉시 요청을 멈추고 `Retry-After` 이후 재개합니다. |
| `503 DATASET_NOT_READY` | 재시드가 끝나지 않았습니다. 배포자에게 알리고 기다립니다. |
| `503 SERVICE_UNAVAILABLE` | 저장소가 일시적으로 혼잡하거나 연결되지 않았습니다. 무한 재시도하지 않습니다. |
| HTML 또는 API 결과 0건 | 필터 조합과 현재 페이지를 확인합니다. 빈 결과는 정상일 수 있습니다. |
| HTML에서 필드 누락 | 응답 상태, 선택자 오타, 상세와 목록 선택자를 혼동했는지 확인합니다. |
| 커서 수집 중 중복 | 데이터 저장과 체크포인트 갱신이 같은 트랜잭션인지, UPSERT 키가 `id` 또는 `listingNumber`인지 확인합니다. |
| 커서 수집이 끝나지 않음 | 요청의 이전 `after_id`가 아니라 마지막으로 저장한 차량 ID를 체크포인트에 기록했는지 확인합니다. |
| PowerShell에서 `curl` 옵션 오류 | `curl` 대신 Windows 실행 파일인 `curl.exe`를 사용합니다. |

기본 인증 API 제한은 키별 분당 60회이며 수업 환경에서 달라질 수 있습니다. `/healthz`는 HTTP 기준 저장소 상태를 보여 주지만 모든 저장소의 문서 일치까지 보장하지는 않습니다. 필요하면 `/generation-runs`와 `/api/v1/stats`의 `pendingChangeCount`를 함께 확인합니다.

## 12. 권장 학습 순서

1. `/crawl-policy`, `/robots.txt`, `/healthz`로 수집 범위와 서버 상태를 확인합니다.
2. `/cars`에서 필터, 상세, 이전·다음 페이지를 직접 사용합니다.
3. BeautifulSoup으로 HTML 최대 3페이지를 수집하고 중복 ID와 필수 선택자를 검사합니다.
4. `/docs` 탐색기와 `curl`로 API 인증, `401`, `403`의 차이를 확인합니다.
5. `/api/v1/cars`에서 필터를 적용하고 `links.next`로 순회합니다.
6. `/api/v1/cars/cursor`를 SQLite에 UPSERT하고 중단 후 체크포인트에서 재개합니다.
7. `/api/v1/changes`의 `until_seq`와 `dataset_epoch`를 고정해 증분 수집합니다.
8. 원본 CSV를 별도로 받은 경우에만 직원–업무영역 관계를 검증합니다.
9. 같은 필터의 HTML과 API 결과에서 차량 ID와 가격을 대조합니다.

## 13. 제출 전 체크리스트

- [ ] 제출물에 API 키 원문, `Authorization` 헤더, 쿠키, DB 연결 문자열이 없습니다.
- [ ] 코드가 서버 주소와 API 키를 환경 변수에서 읽습니다.
- [ ] 실제 사용한 경로, 필터, 수집 시각, HTTP 상태를 기록했습니다.
- [ ] HTML 수집기가 `a[rel="next"]`로 종료하고 요청 사이에 1초를 기다립니다.
- [ ] JSON 목록 수집기가 `links.next`로 종료하며 각 요청에 인증 헤더를 보냅니다.
- [ ] 전체 수집 결과에 `until_id`, `dataset_epoch`, 마지막 `after_id` 체크포인트가 있습니다.
- [ ] 차량 저장과 체크포인트 갱신이 같은 트랜잭션이며 재실행 후 고유 차량 수가 불필요하게 증가하지 않습니다.
- [ ] 증분 수집 결과에 첫 `until_seq`, 마지막 `seq`, `dataset_epoch`가 있습니다.
- [ ] 빈 결과와 오류를 구분하고 `429`의 `Retry-After`를 준수합니다.
- [ ] 원본 CSV를 사용했다면 직원 번호·원본 이름·입사일과 원본 행을 제출물에서 제거했습니다.
- [ ] `AREA`를 실제 차량 소재지로 해석하지 않았습니다.

더 상세한 필드·응답·오류 계약은 [API 문서](API.md), 전체 실습 코드와 관계 검증은 [학습 가이드](LEARNING_GUIDE.md)를 참고하세요.
