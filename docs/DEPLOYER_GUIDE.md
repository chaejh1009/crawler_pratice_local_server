# AutoData Lab 배포자 사용설명서

이 문서는 강사 PC 한 대에서 AutoData Lab을 **Node.js 메모리 모드**로 실행하고, 같은 로컬 네트워크에 있는 수강생에게 실습 서버를 제공하는 방법을 설명합니다. 별도 데이터베이스나 컨테이너 환경은 사용하지 않습니다.

배포자가 수강생에게 직접 전달할 것은 서버 주소 하나뿐입니다.

1. 서버 주소: 예) `http://192.168.0.23:4000`
2. 실습 시작 경로: `/cars?page=1&page_size=20`, `/docs#api-explorer`

프로젝트 폴더, `.env`, 딜러 코드 생성용 secret, 원본 CSV는 수강생에게 전달하지 않습니다.

## 1. 운영 형태와 예상 자원

메모리 모드는 강사 PC가 실행 중인 동안 합성 중고차 데이터를 제공합니다. 서버를 다시 시작하면 같은 설정을 바탕으로 데이터가 다시 만들어지며, 수강생이 수집한 결과는 각 수강생의 파일이나 별도 실습 저장소에 보관해야 합니다.

| 항목 | 기준값 |
| --- | ---: |
| 소스와 문서 | 약 0.52 MiB |
| 소스 압축 파일 | 약 0.14 MiB |
| `npm` 의존성 포함 | 약 21 MiB |
| 선택 CSV 4개 | 약 8.36 MiB |
| 모두 포함한 디스크 사용량 | 약 30 MiB |
| 차량 5,000건 실행 시 메모리 | 약 104 MiB |
| 차량 5,000건 전체 JSON 크기 | 약 5.34 MiB |

실제 메모리 사용량은 Node.js 버전과 운영체제에 따라 조금 달라질 수 있습니다. 수강생이 전체 데이터를 한 번에 메모리에 쌓지 않도록 페이지 또는 커서 묶음 단위로 저장하게 하세요.

## 2. 준비 사항

강사 PC에는 다음 항목이 필요합니다.

- Node.js 22.13.0 이상
- Node.js와 함께 설치되는 npm
- 상태 확인에 사용할 웹 브라우저와 `curl`
- 같은 신뢰 가능한 Wi-Fi 또는 유선 LAN에 연결된 강사·수강생 장치
- TCP 4000번 포트의 로컬 네트워크 수신을 허용할 수 있는 방화벽 설정

프로젝트 폴더의 터미널에서 버전을 확인합니다.

```bash
node --version
npm --version
```

Node.js가 `v22.13.0`보다 낮으면 먼저 지원 버전으로 올립니다. 프로젝트에는 잠금 파일이 있으므로 최초 설치에는 다음 명령을 권장합니다.

```bash
npm ci
```

`npm ci`는 인터넷에서 의존성을 내려받습니다. 기관 네트워크의 프록시나 방화벽 때문에 실패하면 네트워크 정책을 확인한 뒤 다시 실행하세요.

## 3. 최초 환경 설정

### 3.1 `.env` 만들기

예제 설정을 복사하고 현재 사용자만 읽고 쓸 수 있게 제한합니다.

```bash
cp .env.example .env
chmod 600 .env
```

Windows에서는 다른 사용자가 읽을 수 없는 강사 전용 폴더에서 PowerShell로 복사합니다.

```powershell
Copy-Item .env.example .env
```

### 3.2 두 종류의 비밀값 이해하기

서버에는 역할이 다른 두 값이 필요합니다.

| 값 | 서버 설정 이름 | 용도 | 수강생 전달 |
| --- | --- | --- | --- |
| 딜러 코드 생성용 secret | `DEALER_PUBLIC_ID_SECRET` | 내부 직원 식별자를 공개 딜러 코드로 가명처리 | 절대 전달하지 않음 |
| 일일 키 생성용 secret | `DAILY_API_KEY_SECRET` | 날짜별 공개 API 키를 결정론적으로 생성 | 절대 전달하지 않음 |
| 오늘의 공개 API 키 | 서버가 자동 생성 | `/api/v1/*` 요청 인증 | `/docs`와 `/api/v1/public-key`에 자동 공개 |

두 secret은 가능하면 서로 다른 난수로 만드세요. `DAILY_API_KEY_SECRET`이 비어 있으면 서버가 딜러 secret을 별도 HMAC 영역으로 사용하지만, 운영 역할 분리를 위해 별도 값을 권장합니다. 어느 secret이든 바꾸면 공개 식별자 또는 날짜별 키가 달라지므로 운영 중에는 유지합니다.

### 3.3 딜러 코드 생성용 secret 만들기

Node.js만으로 32바이트 난수를 64자리 16진수로 만듭니다. macOS, Linux, Windows PowerShell에서 같은 명령을 사용할 수 있습니다.

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

명령을 두 번 실행해 첫 출력은 `.env`의 `DEALER_PUBLIC_ID_SECRET=`, 두 번째 출력은 `DAILY_API_KEY_SECRET=` 뒤에 붙이는 것을 권장합니다. `DEALER_PUBLIC_ID_SECRET`이 없거나 32자보다 짧으면 서버가 시작을 거부합니다. `DAILY_API_KEY_SECRET`이 비어 있으면 딜러 secret을 대신 사용합니다.

OpenSSL이 설치된 환경에서는 `openssl rand -hex 32`를 사용해도 됩니다. 사람이 만든 문장이나 수업명은 사용하지 않습니다.

### 3.4 공개 일일 API 키 자동화

수강생용 키는 발급 명령이나 `.env`의 `UCAR_API_KEY`가 필요하지 않습니다. 서버가 `DAILY_API_KEY_SECRET`과 한국시간 날짜를 이용해 하루 동안 고정된 키를 만들고 다음 규칙으로 공개합니다.

- 현재 키: `/docs`와 `/api/v1/public-key`에 항상 공개
- 교체: 한국시간 매일 `00:00`
- 다음 날 키: 매일 `23:00`부터 미리 공개
- 사전 공개 키 활성화: 다음 날 `00:00`; 그 전에는 `403`

서버 프로세스가 계속 실행 중이어도 요청 시각을 확인해 자동 교체하므로 cron이나 재시작 작업은 필요하지 않습니다. 다만 운영체제 시간이 틀리면 키 날짜도 틀어지므로 자동 시간 동기화를 켜고 수업 전에 다음 응답의 `server_time`, `current.date`, `expires_at`을 확인합니다.

```bash
curl http://127.0.0.1:4000/api/v1/public-key
```

장기 관리자 키가 별도로 필요한 경우에만 기존 `npm run api-key:create`와 `UCAR_API_KEY(S)`를 선택적으로 사용할 수 있습니다. 일반 수강생 배포에는 사용하지 않습니다.

### 3.5 메모리 모드 설정 확인하기

`.env`에서 최소한 다음 항목을 확인합니다. 아래 값은 예시이며, 이미 만든 두 secret을 실제 값으로 바꾸어야 합니다.

```dotenv
DATA_SOURCE=memory
HOST=0.0.0.0
PORT=4000
MEMORY_CAR_COUNT=5000
AUTO_GENERATE=true
GENERATOR_BATCH_SIZE=28
GENERATOR_INTERVAL_MS=240000

DEALER_PUBLIC_ID_SECRET=위에서_만든_64자리_난수
DAILY_API_KEY_SECRET=별도로_만든_64자리_난수

CSV_REQUIRED=false
EMPLOYEE_CSV_PATH=
AREA_CSV_PATH=
AREA_JOIN_READY_CSV_PATH=
AREA_PARENT_LOOKUP_CSV_PATH=
```

- `DATA_SOURCE=memory`를 명시하여 다른 저장 방식으로 잘못 시작하는 일을 막습니다.
- `HOST=0.0.0.0`은 같은 LAN의 수강생 장치에서 접속할 수 있게 합니다.
- `PORT`를 바꾸면 수강생에게 전달하는 주소의 포트도 함께 바꿉니다.
- `MEMORY_CAR_COUNT=5000`은 기본 수업용 차량 수입니다.
- `AUTO_GENERATE=true`이면 `npm start`가 서버와 주기 생성기를 함께 실행합니다.
- `GENERATOR_BATCH_SIZE=28`, `GENERATOR_INTERVAL_MS=240000`은 4분마다 28건, 하루 약 10,080건을 추가합니다.
- CSV를 사용하지 않으면 예제 파일에 있던 네 CSV 경로를 위처럼 비웁니다. `CSV_REQUIRED=false`도 함께 두면 나중에 DB용 seed 설정과 혼동하지 않습니다.

메모리 모드의 `datasetEpoch`는 `memory-v1`으로 고정됩니다. 수업 도중 차량 수, CSV, `DEALER_PUBLIC_ID_SECRET`을 바꾸면 수강생의 기존 체크포인트가 변경 사실을 자동으로 구분하지 못할 수 있습니다. 설정을 바꾸어야 한다면 모든 수강생에게 기존 수집 결과와 체크포인트를 새 namespace로 분리하고 처음부터 다시 수집하도록 공지하세요.

## 4. 선택 사항: CSV 4개 연결하기

CSV 없이도 내장된 합성 직원·업무영역 데이터로 서버를 실행할 수 있습니다. 수업용 CSV 4개를 연결하면 해당 관계 데이터를 읽어 차량과 연결합니다.

```dotenv
EMPLOYEE_CSV_PATH=/absolute/path/to/biz_employee_master.csv
AREA_CSV_PATH=/absolute/path/to/biz_meta_area_50000.csv
AREA_JOIN_READY_CSV_PATH=/absolute/path/to/biz_meta_area_join_ready.csv
AREA_PARENT_LOOKUP_CSV_PATH=/absolute/path/to/biz_meta_area_parent_lookup.csv
```

경로는 모두 실제 **절대 경로**로 지정합니다. 네 파일 가운데 일부만 연결하거나 경로가 잘못되어도 메모리 서버는 내장 합성 데이터로 시작할 수 있습니다. 이를 CSV 연동 성공으로 오인하지 않도록 수업 전에 다음 엄격 검사를 실행합니다.

`.env.example`의 `CSV_REQUIRED` 값만으로는 메모리 모드의 CSV 누락을 시작 오류로 바꿀 수 없습니다. 아래 검사 결과를 CSV 연결 여부의 기준으로 사용하세요.

```bash
node --input-type=module -e '
import { loadEnvFile } from "node:process";
import { loadCsvSources } from "./server/csv-data.mjs";
loadEnvFile(".env");
const data = await loadCsvSources({ env: process.env, strict: true });
console.log({
  valid: data.validation.valid,
  employees: data.employees.length,
  businessAreas: data.businessAreas.length,
  parentAreas: data.parentAreas.length,
  joinReady: data.joinReady.length,
});
'
```

정상 수업용 CSV라면 `valid: true`와 아래 기대 건수가 출력됩니다. 파일 누락, 헤더 오류, 관계 불일치가 있으면 명령이 실패하므로 경로나 원본을 수정한 뒤 다시 검사하세요.

정상 수업용 CSV의 기대 건수는 다음과 같습니다.

- 직원 3,000건
- 업무영역 50,000건
- 상위 업무영역 1,000건
- join-ready 50,000건

`AREA`는 주소나 행정구역이 아니라 생산, 물류운영, IT 같은 **업무·조직 영역**입니다. 차량의 실제 소재지는 별도의 `location` 필드입니다.

CSV에는 내부 직원명과 직원번호 같은 필드가 포함될 수 있습니다. 승인된 합성 데이터 또는 접근 권한이 있는 수업 자료만 사용하고, CSV 원본을 수강생 제출물·로그·Git·공개 파일 서버에 올리지 마세요.

## 5. 서버 실행

프로젝트 폴더에서 다음 명령을 실행합니다.

```bash
npm start
```

정상적으로 시작되면 터미널에 다음 정보가 표시됩니다.

- 강사 PC 주소: `http://localhost:4000`
- 같은 Wi-Fi에서 사용할 수 있는 주소 후보
- 데이터 소스: `memory`

서버를 실행한 터미널은 수업이 끝날 때까지 닫지 않습니다. 노트북이 절전 모드에 들어가거나 Wi-Fi가 바뀌면 수강생 연결이 끊길 수 있으므로 전원과 네트워크를 유지하세요.

운영체제가 첫 실행 때 Node.js의 네트워크 수신 허용 여부를 물으면 현재의 신뢰 가능한 수업 LAN에 대해서만 허용합니다.

## 6. 수업 전 검증

### 6.1 코드 자동 검사

서버를 열기 전이나 별도 터미널에서 다음 검사를 실행합니다.

```bash
npm run check
npm test
```

자동 테스트는 데이터베이스 없이 메모리 저장소와 임시 로컬 HTTP 서버를 사용합니다. 보안 정책상 로컬 포트 바인딩을 막는 제한 환경에서는 `listen EPERM`으로 HTTP 테스트가 실패할 수 있습니다. 일반 터미널에서 다시 실행하거나 기관 보안 정책을 확인하세요.

CSV를 연결한 환경에서는 전체 관계 검사도 테스트에 포함됩니다. CSV가 설정되지 않았거나 읽을 수 없으면 해당 관계 검사는 건너뛸 수 있으므로 테스트 요약의 `skipped` 수도 확인합니다.

### 6.2 강사 PC에서 HTTP 확인

서버를 실행한 상태에서 새 터미널을 열고 주소를 설정합니다.

```bash
export AUTODATA_BASE_URL='http://127.0.0.1:4000'
```

공개 경로를 확인합니다.

```bash
curl --include "$AUTODATA_BASE_URL/healthz"
curl --include "$AUTODATA_BASE_URL/crawl-policy"
curl --include "$AUTODATA_BASE_URL/robots.txt"
curl --include "$AUTODATA_BASE_URL/cars?page_size=5"
```

`/healthz`는 `200 OK`와 함께 다음 핵심 값을 반환해야 합니다.

```json
{
  "ok": true,
  "source": "memory",
  "datasetEpoch": "memory-v1"
}
```

공개 경로에서 오늘의 키를 자동으로 읽어 인증 경로도 확인합니다.

```bash
export AUTODATA_API_KEY="$(curl -fsS "$AUTODATA_BASE_URL/api/v1/public-key" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["current"]["api_key"])')"
curl --include "$AUTODATA_BASE_URL/api/v1/stats" \
  -H "X-API-Key: $AUTODATA_API_KEY"
```

Windows PowerShell에서는 다음처럼 확인합니다.

```powershell
$env:AUTODATA_BASE_URL = 'http://127.0.0.1:4000'
$env:AUTODATA_API_KEY = (curl.exe -fsS "${env:AUTODATA_BASE_URL}/api/v1/public-key" | ConvertFrom-Json).data.current.api_key
curl.exe --include "${env:AUTODATA_BASE_URL}/api/v1/stats" `
  -H "X-API-Key: $env:AUTODATA_API_KEY"
```

여기서 변수 이름을 구분하세요.

- 서버 `.env`: `DAILY_API_KEY_SECRET`(공개 키의 원문이 아님)
- 강사와 수강생의 요청 예제: `AUTODATA_API_KEY`
- 강사와 수강생의 서버 주소: `AUTODATA_BASE_URL`

`AUTODATA_*` 변수는 예제 클라이언트가 사용하는 이름이며 서버 설정 항목이 아닙니다.

### 6.3 LAN 주소 확인

서버 시작 로그의 같은 Wi-Fi 주소 후보를 우선 사용합니다. 운영체제에서 직접 확인하려면 다음 예를 참고합니다.

macOS:

```bash
ipconfig getifaddr en0
```

Linux:

```bash
hostname -I
```

Windows:

```powershell
ipconfig
```

예를 들어 강사 PC의 주소가 `192.168.0.23`이면 수강생 주소는 `http://192.168.0.23:4000`입니다. VPN이나 가상 네트워크 주소가 아니라 수강생과 같은 LAN에 연결된 인터페이스의 사설 IPv4 주소를 선택합니다.

수강생 장치 한 대에서 다음 두 주소를 직접 열어 최종 확인합니다.

```text
http://192.168.0.23:4000/healthz
http://192.168.0.23:4000/cars?page=1&page_size=20
```

## 7. 수강생에게 전달할 내용

수업 시작 전에 다음 내용을 안전한 수업 채널로 전달합니다.

```text
AutoData Lab 서버 주소: http://192.168.0.23:4000
HTML 시작: http://192.168.0.23:4000/cars?page=1&page_size=20
API 키·크롤러: http://192.168.0.23:4000/docs#api-explorer
자동화 키 조회: http://192.168.0.23:4000/api/v1/public-key
HTML 요청 간격: 최소 1초
API 키 사용 위치: X-API-Key 요청 헤더
```

수강생은 서버 주소만 환경 변수에 두고 오늘의 키는 실행 직전에 공개 경로에서 읽습니다.

```bash
export AUTODATA_BASE_URL='http://192.168.0.23:4000'
curl "$AUTODATA_BASE_URL/api/v1/public-key"
```

수강생에게 다음 규칙도 함께 안내합니다.

- 공개 일일 키를 URL 쿼리나 소스 코드에 고정하지 않고 `/api/v1/public-key`에서 갱신합니다.
- `X-API-Key` 또는 `Authorization: Bearer` 중 한 헤더만 사용합니다.
- HTML 요청 사이에는 최소 1초를 기다립니다.
- HTML은 `a[rel="next"]`, JSON API는 응답의 `links.next`를 따라갑니다.
- 기본 API 제한은 키 prefix와 클라이언트 주소 조합별 분당 60회입니다. `429`가 오면 요청을 멈추고 `Retry-After`만큼 기다립니다.
- 한꺼번에 과도하게 병렬 요청하지 않고 페이지 또는 커서 묶음별로 저장합니다.
- 이 서버의 수집 허가는 이 수업용 호스트에만 적용되며 제3자 사이트에는 적용되지 않습니다.

수강생용 자세한 절차는 [수강생 사용설명서](STUDENT_GUIDE.md), API 계약은 [API 문서](API.md), 전체 실습 예제는 [학습 가이드](LEARNING_GUIDE.md)를 참고하게 하세요.

## 8. 수업 중 운영

### 8.1 상태 관찰

다음 경로는 API 키 없이 확인할 수 있습니다.

| 경로 | 확인 내용 |
| --- | --- |
| `/healthz` | 서버와 메모리 저장소 상태 |
| `/cars?page=1&page_size=20` | 최초 최대 10,000건 중 페이지당 20건의 공개 HTML 게시판과 다음·이전 링크 |
| `/changes` | 고정 snapshot 변경 로그 |
| `/generation-runs` | 메모리 데이터 생성 상태 이벤트 |
| `/crawl-policy` | 이 서버에만 적용되는 수집 허용 범위 |
| `/docs#api-explorer` | API 키 입력·다중 페이지 크롤러 |
| `/learning-guide` | 브라우저용 학습 가이드 |

메모리 모드는 서버 시작 시 초기 합성 데이터를 만든 뒤, 기본적으로 4분마다 28건을 추가하여 24시간에 약 10,080건을 적재합니다. `/api/v1/stats`의 `carCount`, `/changes`, `/generation-runs`에서 증가를 확인할 수 있습니다. 별도의 `npm run generate:watch`를 함께 실행하지 마세요. 잠시 멈추려면 `.env`의 `AUTO_GENERATE=false`로 바꾸고 서버를 재시작합니다.

메모리 적재는 디스크에 영속화되지 않습니다. 서버를 재시작하면 `MEMORY_CAR_COUNT`의 초기 상태로 돌아가고 주기 생성도 새로 시작하므로, 장기 보존이 필요한 결과는 수강생 수집 DB 또는 네이티브 데이터베이스 모드에 저장해야 합니다.

공개 `/cars`와 `/cars/:id`는 ID 순으로 고정한 최초 최대 10,000건만 노출합니다. 필터·정렬로 이 범위를 우회할 수 없습니다. 전체 차량 JSON은 `/api/v1/public-key`에서 받은 현재 키가 있어야 `/api/v1/cars*`로 조회할 수 있다는 점을 수강생에게 함께 고지하세요.

### 8.2 요청 제한 조정

기본값은 인증 API의 `키 prefix + 클라이언트 주소` 조합별 분당 60회, 인증 전 요청은 클라이언트별 분당 120회, HTML은 클라이언트별 분당 120회입니다. 따라서 같은 일일 공개 키를 쓰는 서로 다른 수강생 장치는 각자 한도를 가집니다.

```dotenv
API_RATE_LIMIT_PER_MINUTE=60
API_PREAUTH_RATE_LIMIT_PER_MINUTE=120
HTML_RATE_LIMIT_PER_MINUTE=120
```

수강 인원에 맞춰 값을 바꿀 수 있지만, 너무 높이면 강사 PC와 네트워크에 순간 부하가 몰릴 수 있습니다. 변경 후에는 서버를 정상 종료하고 다시 시작해야 적용됩니다. HTML의 최소 1초 요청 간격 안내는 제한값을 높이더라도 유지합니다.

### 8.3 일일 키 교체 관찰

일일 키는 서버 재시작 없이 한국시간 자정에 자동 교체됩니다. 23:00 이후 `/docs`와 `/api/v1/public-key`에 다음 날 키가 보이는지, 자정 뒤 `current`가 그 키로 바뀌는지 확인합니다. 자정에 진행 중인 수집기는 `403`에서 현재 키를 다시 읽고 실패한 요청을 한 번만 재시도해야 합니다.

`DAILY_API_KEY_SECRET`을 수동 변경하면 그날의 현재 키까지 즉시 달라집니다. 긴급 교체가 아니라면 수업 중 변경하지 마세요. 변경해야 한다면 서버를 재시작하고 수강생에게 공개 키 재조회를 공지합니다.

## 9. 정상 종료와 재시작

수업 종료 순서는 다음과 같습니다.

1. 수강생에게 크롤러와 API 클라이언트를 중지하게 합니다.
2. 강사 PC의 서버 터미널에서 `Ctrl+C`를 한 번 누릅니다.
3. 종료 메시지가 표시되고 터미널 프롬프트가 돌아올 때까지 기다립니다.
4. 선택적 장기 키를 만들었다면 더 이상 쓸 키를 `.env`에서 제거합니다.
5. `.env`, secret, CSV 원본의 보관 또는 폐기 정책을 확인합니다.

강제 종료나 노트북 전원 차단보다 `Ctrl+C` 정상 종료를 사용하세요. 다시 시작할 때는 같은 프로젝트 폴더에서 `npm start`를 실행합니다. 같은 `DEALER_PUBLIC_ID_SECRET`을 유지하면 공개 딜러 코드도 안정적으로 유지됩니다.

정상 종료는 진행 중인 생성 묶음이 끝나기를 기다린 뒤 저장소를 닫습니다. 메모리 모드에서 생성된 추가 데이터는 재시작 후 복원되지 않는다는 점을 수강생에게 미리 알리세요.

## 10. 보안 원칙

- 이 서버는 신뢰 가능한 로컬 수업망용입니다. 인터넷에 직접 공개하지 않습니다.
- 강사와 수강생이 사용하는 HTTP 연결은 암호화되지 않으므로 공용 Wi-Fi에서 운영하지 않습니다.
- `.env` 전체, `DEALER_PUBLIC_ID_SECRET`, CSV 원본을 수강생이나 공개 저장소에 공유하지 않습니다.
- 일일 API 키 자체는 의도적으로 공개하지만, 이를 만드는 `DAILY_API_KEY_SECRET`은 `.env`, 화면 캡처, 녹화, 로그에 절대 노출하지 않습니다.
- 공개 딜러 코드와 마스킹 이름은 가명처리이며 익명화가 아닙니다.
- 직원 원본 이름, 직원번호, 입사일을 HTML/API 응답이나 제출물에 추가하지 않습니다.
- 방화벽은 가능하면 현재 수업 LAN에서 들어오는 TCP 4000번 연결만 허용합니다.
- 수업 종료 후 계속 제공할 이유가 없으면 서버를 종료합니다.

## 11. 문제 해결

| 증상 | 확인 및 조치 |
| --- | --- |
| `node` 또는 `npm` 명령을 찾을 수 없음 | Node.js 22.13.0 이상 설치 여부와 터미널 재시작 확인 |
| `npm ci` 실패 | 인터넷 연결, 기관 프록시, npm registry 접근 정책 확인 |
| `DEALER_PUBLIC_ID_SECRET` 오류로 시작 실패 | `.env`에 32자 이상의 예측 불가능한 값을 넣었는지 확인 |
| 공개 키 경로가 `503` | `DAILY_API_KEY_SECRET` 또는 fallback인 `DEALER_PUBLIC_ID_SECRET`이 32자 이상인지 확인 |
| API가 `403 API_KEY_INVALID` | `/api/v1/public-key`를 다시 읽고 `current.api_key`인지 확인. 23시에 보이는 `next`는 자정 전 사용할 수 없음 |
| 수강생만 연결할 수 없음 | `HOST=0.0.0.0`, 같은 LAN, 정확한 사설 IP·포트, 강사 PC 방화벽 확인 |
| 같은 Wi-Fi인데 연결할 수 없음 | 공유기의 AP isolation 또는 client isolation, 게스트 Wi-Fi 사용 여부 확인 |
| `EADDRINUSE`로 시작 실패 | 4000번 포트를 쓰는 기존 서버를 정상 종료하거나 `.env`의 `PORT`를 변경 |
| `/healthz`의 `source`가 `memory`가 아님 | `.env`의 `DATA_SOURCE=memory` 확인 후 재시작 |
| 4분이 지나도 데이터가 늘지 않음 | `AUTO_GENERATE=true`, `GENERATOR_BATCH_SIZE=28`, `GENERATOR_INTERVAL_MS=240000`과 서버의 `주기 데이터 생성` 로그 확인 |
| CSV를 연결했지만 내장 데이터로 시작 | 네 CSV의 절대 경로, 파일 권한, 시작 로그, `npm test`의 CSV 검사 결과 확인 |
| 응답이 `429 RATE_LIMITED` | 병렬 요청을 줄이고 `Retry-After`만큼 기다린 뒤 재개 |
| 수집 중 중복 발생 | `id` 또는 `listingNumber`를 안정 키로 사용하여 upsert하고 저장 성공 후 체크포인트 전진 |
| 재시작 뒤 체크포인트가 맞지 않음 | 메모리 데이터셋의 `datasetEpoch`를 체크포인트와 함께 기록했는지 확인 |
| 테스트가 `listen EPERM`으로 실패 | 로컬 포트 바인딩을 허용하는 일반 터미널에서 재실행하고 기관 보안 정책 확인 |

문제가 계속되면 서버 터미널의 오류 메시지에서 secret이나 API 키를 가린 뒤 관리자에게 전달하세요. `.env` 원문이나 전체 환경 변수 출력은 공유하지 않습니다.

## 12. 최종 체크리스트

### 최초 설치

- [ ] Node.js 22.13.0 이상과 npm을 확인했습니다.
- [ ] 프로젝트 폴더에서 `npm ci`를 완료했습니다.
- [ ] `.env.example`을 `.env`로 복사하고 접근 권한을 제한했습니다.
- [ ] `DEALER_PUBLIC_ID_SECRET`과 `DAILY_API_KEY_SECRET`을 서로 다른 난수로 설정했습니다.
- [ ] `DATA_SOURCE=memory`, `HOST=0.0.0.0`, `PORT`, `MEMORY_CAR_COUNT`를 확인했습니다.
- [ ] `AUTO_GENERATE=true`, 28건/240000ms와 하루 약 10,080건 계산을 확인했습니다.
- [ ] 선택 CSV를 사용할 경우 네 절대 경로와 파일 권한을 확인했습니다.

### 수업 직전

- [ ] `npm run check`와 `npm test` 결과를 확인했습니다.
- [ ] `npm start` 후 `/healthz`가 `ok: true`, `source: memory`를 반환합니다.
- [ ] 공개 HTML과 인증 API를 강사 PC에서 확인했습니다.
- [ ] 수강생 장치에서 LAN 주소의 `/healthz`와 `/cars`를 확인했습니다.
- [ ] 서버 주소와 HTML·API 크롤링 시작 경로를 수강생에게 전달했습니다.
- [ ] 자정 교체·23시 사전 공개·403 갱신, 요청 간격, 429 처리, 허용 범위를 안내했습니다.

### 수업 중과 종료

- [ ] 서버 터미널, 강사 PC 전원, LAN 연결을 유지하고 있습니다.
- [ ] 4분 뒤 `/api/v1/stats`와 `/generation-runs`에서 28건 추가를 확인했습니다.
- [ ] 과도한 병렬 요청과 반복되는 401·403·429를 관찰합니다.
- [ ] 수강생 크롤러를 먼저 중지한 뒤 서버를 `Ctrl+C`로 종료합니다.
- [ ] 선택적 장기 키를 만들었다면 사용이 끝난 키를 `.env`에서 제거했습니다.
- [ ] `.env`, secret, CSV 원본이 제출물·로그·공개 저장소에 없는지 확인했습니다.
