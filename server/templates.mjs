const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

export function escapeHtml(value) {
  return String(value ?? "").replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character]);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
}

function formatPrice(value) {
  return `${formatNumber(value)}원`;
}

function formatDate(value) {
  if (!value) return "정보 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(date);
}

function excerpt(value, maximum = 115) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum).trimEnd()}…` : text;
}

function normaliseBaseUrl(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function navLink(href, label, key, activePage) {
  return `<a class="site-nav__link${activePage === key ? " is-current" : ""}" href="${href}"${activePage === key ? ' aria-current="page"' : ""}>${label}</a>`;
}

function layout({ title, description, activePage, content }) {
  const fullTitle = `${title} · AutoData Lab`;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(fullTitle)}</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
  <header class="site-header">
    <div class="shell site-header__inner">
      <a class="brand" href="/" aria-label="AutoData Lab 홈">
        <span class="brand__mark" aria-hidden="true">A</span>
        <span><strong class="brand__name">AutoData Lab</strong><small class="brand__tagline">USED CAR COLLECTION CLASSROOM</small></span>
      </a>
      <nav class="site-nav" aria-label="주요 메뉴">
        ${navLink("/cars", "중고차 목록", "cars", activePage)}
        ${navLink("/changes", "변경 로그", "changes", activePage)}
        ${navLink("/generation-runs", "적재 실행", "runs", activePage)}
        ${navLink("/docs", "API 문서", "docs", activePage)}
        ${navLink("/learning-guide", "학습 가이드", "guide", activePage)}
      </nav>
    </div>
  </header>
  <main id="main-content">${content}</main>
  <footer class="site-footer">
    <div class="shell site-footer__inner">
      <div><strong>AutoData Lab</strong><p>같은 Wi-Fi 안에서 허가된 HTML·API·증분 로그 수집을 연습하는 합성 데이터 서버입니다. <a href="/crawl-policy">수집 이용정책</a></p></div>
      <p class="site-footer__note"><span class="status-dot" aria-hidden="true"></span>수업용 합성 데이터</p>
    </div>
  </footer>
</body>
</html>`;
}

function selected(actual, expected) {
  return String(actual ?? "") === String(expected) ? " selected" : "";
}

function buildQueryUrl(path, query = {}, overrides = {}) {
  const params = new URLSearchParams();
  const values = {
    q: query.q,
    brand: query.brand,
    fuel: query.fuel,
    status: query.status,
    location: query.location,
    min_price: query.minPrice,
    max_price: query.maxPrice,
    min_year: query.minYear,
    max_year: query.maxYear,
    max_mileage: query.maxMileage,
    accident_free: query.accidentFree,
    sort: query.sort,
    page: query.page,
    page_size: query.pageSize,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function statusLabel(status) {
  return {
    AVAILABLE: "판매중",
    RESERVED: "예약중",
    SOLD: "판매완료",
  }[status] ?? String(status ?? "상태 미상");
}

function carTitle(car) {
  return car.title || [car.brand?.name, car.model?.name, car.trim].filter(Boolean).join(" ");
}

function renderCarCard(car) {
  const title = carTitle(car);
  const href = `/cars/${encodeURIComponent(String(car.id))}`;
  const brandSlug = car.brand?.slug ?? "unknown";
  const firstLetter = String(car.brand?.name ?? "A").charAt(0);
  return `<article class="product-card car-card" data-car-id="${escapeHtml(car.id)}" data-listing-number="${escapeHtml(car.listingNumber)}" data-brand="${escapeHtml(brandSlug)}" data-model-year="${escapeHtml(car.modelYear)}" data-status="${escapeHtml(car.status)}">
    <a class="product-card__visual car-card__visual" href="${href}" tabindex="-1" aria-hidden="true"><span>${escapeHtml(firstLetter)}</span><small>${escapeHtml(car.model?.bodyType ?? "USED CAR")}</small></a>
    <div class="product-card__body">
      <div class="product-card__meta"><a class="product-category" href="/cars?brand=${encodeURIComponent(brandSlug)}">${escapeHtml(car.brand?.name)}</a><span class="product-stock ${car.status === "AVAILABLE" ? "is-available" : "is-sold-out"}" data-field="status">${escapeHtml(statusLabel(car.status))}</span></div>
      <h2 class="product-name car-title" data-field="title"><a href="${href}">${escapeHtml(title)}</a></h2>
      <p class="car-card__specs"><span data-field="model-year">${escapeHtml(car.modelYear)}년식</span><span data-field="mileage">${formatNumber(car.mileageKm)}km</span><span data-field="fuel">${escapeHtml(car.fuelType)}</span></p>
      <p class="product-card__description">${escapeHtml(excerpt(car.description))}</p>
      <div class="product-card__footer"><data class="product-price" data-field="price" value="${escapeHtml(car.price)}">${escapeHtml(formatPrice(car.price))}</data><span class="product-rating" data-field="location">${escapeHtml(car.location?.province)} ${escapeHtml(car.location?.city)}</span></div>
    </div>
  </article>`;
}

export function renderHomePage({ stats = {}, brands = [], baseUrl = "" } = {}) {
  const displayBase = normaliseBaseUrl(baseUrl) || "http://서버-IP:4000";
  const brandChips = brands.slice(0, 8).map((brand) => `<a href="/cars?brand=${encodeURIComponent(brand.slug)}">${escapeHtml(brand.name)} <span>${formatNumber(brand.carCount)}</span></a>`).join("");
  return layout({
    title: "중고차 수집 실습 홈",
    description: "중고차 HTML 크롤링과 API·CSV 수집을 연습하는 로컬 서버",
    activePage: "home",
    content: `
      <section class="hero">
        <div class="shell hero__grid">
          <div class="hero__content">
            <p class="eyebrow">USED CAR DATA · HTML + JSON + MYSQL + MONGODB</p>
            <h1>차량을 긁고,<br><em>관계를 수집하세요.</em></h1>
            <p class="hero__lede">외부 사이트 대신 수집 권한이 명확한 합성 중고차 데이터를 HTML과 API로 제공합니다. 직원·업무영역 CSV 관계를 유지한 주기 데이터는 MySQL·MongoDB에 멱등 적재되고 고정 snapshot 변경 로그로 다시 수집할 수 있습니다.</p>
            <div class="hero__actions"><a class="button button--primary" href="/cars">HTML 목록 크롤링</a><a class="button button--secondary" href="/changes">증분 로그 크롤링</a></div>
            <p class="hero__network"><span class="status-dot" aria-hidden="true"></span><strong>${escapeHtml(displayBase)}</strong> · 같은 Wi-Fi에서 접속</p>
          </div>
          <aside class="hero__panel" aria-label="데이터셋 현황">
            <p class="eyebrow">LIVE DATASET</p>
            <dl class="stat-grid">
              <div><dt>차량 매물</dt><dd>${formatNumber(stats.carCount)}</dd></div>
              <div><dt>판매중</dt><dd>${formatNumber(stats.availableCount)}</dd></div>
              <div><dt>직원</dt><dd>${formatNumber(stats.employeeCount)}</dd></div>
              <div><dt>변경 로그</dt><dd>${formatNumber(stats.changeCount)}</dd></div>
            </dl>
            <p class="dataset-source">현재 저장소: <strong>${escapeHtml(stats.source ?? "memory")}</strong></p>
          </aside>
        </div>
      </section>
      <section class="category-strip"><div class="shell"><p class="eyebrow">POPULAR BRANDS</p><div class="category-chips">${brandChips}</div></div></section>
      <section class="lesson-section"><div class="shell">
        <div class="section-heading"><div><p class="eyebrow">FOUR COLLECTION TRACKS</p><h2>한 서버에서 네 가지 수집 흐름</h2></div></div>
        <div class="lesson-grid">
          <article class="lesson-card"><span>01</span><h3>HTML 크롤링</h3><p><code>.car-card</code>와 <code>data-field</code>를 이용해 목록, 상세, 다음 페이지를 파싱합니다.</p><a href="/cars">목록 열기 →</a></article>
          <article class="lesson-card"><span>02</span><h3>인증 API 수집</h3><p><code>X-API-Key</code> 헤더와 페이지·커서 방식으로 JSON을 안전하게 순회합니다.</p><a href="/docs">API 문서 →</a></article>
          <article class="lesson-card"><span>03</span><h3>CSV 관계 적재</h3><p>직원 3천 건, 업무영역 5만 건과 매물을 MySQL에서 조인하며 정규화·비정규화를 비교합니다.</p><a href="/learning-guide#csv-join">관계 설계 보기 →</a></article>
          <article class="lesson-card"><span>04</span><h3>증분 로그 수집</h3><p><code>until_seq</code> high-water mark를 고정하고 계속 늘어나는 변경 이벤트를 유한하게 수집합니다.</p><a href="/changes">변경 로그 →</a></article>
        </div>
      </div></section>`,
  });
}

export function renderCarListPage({ items = [], total = 0, query = {}, brands = [], locations = [] } = {}) {
  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || 24;
  const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
  const firstResult = items.length ? (page - 1) * pageSize + 1 : 0;
  const lastResult = items.length ? firstResult + items.length - 1 : 0;
  const cards = items.length ? items.map(renderCarCard).join("") : '<div class="empty-state"><strong>조건에 맞는 차량이 없습니다.</strong><p>검색어나 필터를 바꾸어 다시 시도해 보세요.</p></div>';
  const brandOptions = brands.map((brand) => `<option value="${escapeHtml(brand.slug)}"${selected(query.brand, brand.slug)}>${escapeHtml(brand.name)} (${formatNumber(brand.carCount)})</option>`).join("");
  const locationOptions = locations.map((location) => `<option value="${escapeHtml(location.slug)}"${selected(query.location, location.slug)}>${escapeHtml(location.province)} ${escapeHtml(location.city)}</option>`).join("");
  const sizeOptions = [12, 24, 48, 100].map((size) => `<option value="${size}"${selected(pageSize, size)}>${size}개</option>`).join("");
  const previous = page > 1 ? `<a class="pagination__link" rel="prev" href="${escapeHtml(buildQueryUrl("/cars", query, { page: page - 1 }))}">← 이전</a>` : '<span class="pagination__link is-disabled" aria-disabled="true">← 이전</span>';
  const next = page < totalPages ? `<a class="pagination__link" rel="next" href="${escapeHtml(buildQueryUrl("/cars", query, { page: page + 1 }))}">다음 →</a>` : '<span class="pagination__link is-disabled" aria-disabled="true">다음 →</span>';
  return layout({
    title: query.q ? `“${query.q}” 중고차 검색` : "중고차 HTML 목록",
    description: "중고차 검색·필터·정렬·페이지네이션 HTML 데이터",
    activePage: "cars",
    content: `
      <section class="page-hero page-hero--compact"><div class="shell"><p class="eyebrow">CRAWLABLE HTML DATASET</p><div class="page-hero__row"><div><h1>중고차 매물 탐색</h1><p>페이지 소스와 개발자 도구에서 카드의 안정적인 수집 표식을 확인하세요.</p></div><a class="button button--dark" href="/docs#api-explorer">같은 데이터의 JSON API ↗</a></div></div></section>
      <section class="catalog-section"><div class="shell">
        <form class="filter-panel car-filter-panel" action="/cars" method="get" role="search">
          <div class="field field--search"><label for="car-q">차량 검색</label><div class="search-input"><span aria-hidden="true">⌕</span><input id="car-q" name="q" type="search" value="${escapeHtml(query.q)}" placeholder="브랜드, 모델, 트림" maxlength="100"></div></div>
          <div class="field"><label for="car-brand">브랜드</label><select id="car-brand" name="brand"><option value="">전체 브랜드</option>${brandOptions}</select></div>
          <div class="field"><label for="car-fuel">연료</label><select id="car-fuel" name="fuel"><option value="">전체 연료</option>${["가솔린", "디젤", "하이브리드", "전기", "LPG"].map((v) => `<option value="${v}"${selected(query.fuel, v)}>${v}</option>`).join("")}</select></div>
          <div class="field"><label for="car-status">판매 상태</label><select id="car-status" name="status"><option value="">전체 상태</option><option value="AVAILABLE"${selected(query.status, "AVAILABLE")}>판매중</option><option value="RESERVED"${selected(query.status, "RESERVED")}>예약중</option><option value="SOLD"${selected(query.status, "SOLD")}>판매완료</option></select></div>
          <div class="field"><label for="car-location">차량 소재지</label><select id="car-location" name="location"><option value="">전체 지역</option>${locationOptions}</select></div>
          <div class="field"><label for="car-min-year">최소 연식</label><input id="car-min-year" name="min_year" type="number" value="${escapeHtml(query.minYear)}" min="1990" max="2030" placeholder="2018"></div>
          <div class="field"><label for="car-max-mileage">최대 주행거리</label><input id="car-max-mileage" name="max_mileage" type="number" value="${escapeHtml(query.maxMileage)}" min="0" max="1000000" step="1000" placeholder="100000"></div>
          <div class="field field--price"><label for="car-min-price">최소 가격</label><input id="car-min-price" name="min_price" type="number" value="${escapeHtml(query.minPrice)}" min="0" max="1000000000" step="100000" placeholder="0"></div>
          <div class="field field--price"><label for="car-max-price">최대 가격</label><input id="car-max-price" name="max_price" type="number" value="${escapeHtml(query.maxPrice)}" min="0" max="1000000000" step="100000" placeholder="제한 없음"></div>
          <div class="field"><label for="car-sort">정렬</label><select id="car-sort" name="sort"><option value="newest"${selected(query.sort, "newest")}>최신 등록순</option><option value="price_asc"${selected(query.sort, "price_asc")}>낮은 가격순</option><option value="price_desc"${selected(query.sort, "price_desc")}>높은 가격순</option><option value="mileage_asc"${selected(query.sort, "mileage_asc")}>짧은 주행거리순</option><option value="year_desc"${selected(query.sort, "year_desc")}>최신 연식순</option></select></div>
          <div class="field field--size"><label for="car-page-size">표시 개수</label><select id="car-page-size" name="page_size">${sizeOptions}</select></div>
          <button class="button button--primary filter-panel__submit" type="submit">조건 적용</button>
        </form>
        <div class="catalog-toolbar"><div><p class="eyebrow">SEARCH RESULT</p><h2>총 <strong>${formatNumber(total)}</strong>대</h2></div><p><strong>${formatNumber(firstResult)}–${formatNumber(lastResult)}</strong>번째 결과</p></div>
        <div class="product-grid car-grid" data-car-list>${cards}</div>
        <nav class="pagination" aria-label="중고차 목록 페이지">${previous}<span class="pagination__current"><strong>${page}</strong> / ${totalPages} 페이지</span>${next}</nav>
      </div></section>`,
  });
}

export function renderCarDetailPage({ car } = {}) {
  if (!car) return renderErrorPage({ status: 404, message: "요청한 중고차 매물을 찾을 수 없습니다." });
  const title = carTitle(car);
  const apiPath = `/api/v1/cars/${encodeURIComponent(String(car.id))}`;
  return layout({
    title,
    description: excerpt(car.description, 150),
    activePage: "cars",
    content: `<div class="shell detail-shell">
      <nav class="breadcrumbs" aria-label="현재 위치"><ol><li><a href="/">홈</a></li><li><a href="/cars">중고차</a></li><li aria-current="page">${escapeHtml(title)}</li></ol></nav>
      <article class="product-detail car-detail" data-car-id="${escapeHtml(car.id)}" data-listing-number="${escapeHtml(car.listingNumber)}">
        <div class="product-detail__visual car-detail__visual" aria-hidden="true"><span>${escapeHtml(car.brand?.name?.charAt(0) ?? "A")}</span><small>${escapeHtml(car.model?.bodyType)}</small></div>
        <div class="product-detail__content"><div class="product-detail__topline"><span><a class="product-category" href="/cars?brand=${encodeURIComponent(car.brand?.slug ?? "")}">${escapeHtml(car.brand?.name)}</a></span><span class="product-stock ${car.status === "AVAILABLE" ? "is-available" : "is-sold-out"}" data-field="status">${escapeHtml(statusLabel(car.status))}</span></div>
          <h1 class="product-name car-title" data-field="title">${escapeHtml(title)}</h1><p class="product-detail__brand">매물번호 ${escapeHtml(car.listingNumber)} · 차량 ID ${escapeHtml(car.id)}</p>
          <div class="product-detail__summary"><data class="product-price" data-field="price" value="${escapeHtml(car.price)}">${escapeHtml(formatPrice(car.price))}</data><span class="product-rating">${escapeHtml(car.modelYear)}년식 · ${formatNumber(car.mileageKm)}km</span></div>
          <p class="product-detail__description">${escapeHtml(car.description)}</p><div class="detail-actions"><a class="button button--primary" href="/docs#api-explorer">API 키로 JSON 조회</a><a class="button button--secondary" href="/cars">목록으로 돌아가기</a></div>
        </div>
      </article>
      <div class="detail-columns"><section class="detail-section"><h2>차량 제원</h2><dl class="detail-list">
        <div><dt>브랜드 / 모델</dt><dd>${escapeHtml(car.brand?.name)} ${escapeHtml(car.model?.name)}</dd></div><div><dt>트림</dt><dd>${escapeHtml(car.trim)}</dd></div><div><dt>연식</dt><dd data-field="model-year">${escapeHtml(car.modelYear)}년</dd></div><div><dt>최초 등록</dt><dd>${escapeHtml(formatDate(car.firstRegistration))}</dd></div><div><dt>주행거리</dt><dd data-field="mileage">${formatNumber(car.mileageKm)}km</dd></div><div><dt>연료 / 변속기</dt><dd>${escapeHtml(car.fuelType)} / ${escapeHtml(car.transmission)}</dd></div><div><dt>색상</dt><dd>${escapeHtml(car.color)}</dd></div><div><dt>배기량</dt><dd>${formatNumber(car.displacementCc)}cc</dd></div>
      </dl></section><section class="detail-section"><h2>이력과 담당 관계</h2><dl class="detail-list">
        <div><dt>사고 이력</dt><dd>${formatNumber(car.accidentCount)}건</dd></div><div><dt>소유자 변경</dt><dd>${formatNumber(car.ownerChangeCount)}회</dd></div><div><dt>성능점검</dt><dd>${escapeHtml(car.inspectionStatus)}</dd></div><div><dt>차량 소재지</dt><dd>${escapeHtml(car.location?.province)} ${escapeHtml(car.location?.city)}</dd></div><div><dt>판매 담당자</dt><dd>${escapeHtml(car.dealer?.displayName)} (${escapeHtml(car.dealer?.position)})</dd></div><div><dt>담당 업무영역</dt><dd>${escapeHtml(car.businessArea?.name)} · ${escapeHtml(car.businessArea?.id)}</dd></div><div><dt>등록일</dt><dd>${escapeHtml(formatDate(car.createdAt))}</dd></div><div><dt>API 경로</dt><dd><code>${escapeHtml(apiPath)}</code></dd></div>
      </dl></section></div>
    </div>`,
  });
}

function endpointCard(path, description, isPublic = false) {
  return `<article class="endpoint-card"><div class="endpoint-card__request"><span class="method-badge">GET</span><code>${escapeHtml(path)}</code></div><p>${escapeHtml(description)}</p><span class="api-access-badge">${isPublic ? "공개" : "API 키 필요"}</span></article>`;
}

export function renderDocsPage({ baseUrl = "" } = {}) {
  const displayBase = normaliseBaseUrl(baseUrl) || "http://서버-IP:4000";
  return layout({
    title: "API 문서",
    description: "AutoData Lab 중고차 JSON API와 API 키 사용법",
    activePage: "docs",
    content: `<section class="docs-hero"><div class="shell docs-hero__grid"><div><p class="eyebrow">API REFERENCE · X-API-KEY</p><h1>키를 넣고<br>차량을 수집하세요.</h1><p>HTML 페이지는 공개지만 <code>/api/v1/*</code> 정식 API는 발급된 키가 있어야 합니다. 키는 URL이 아니라 요청 헤더에 넣습니다.</p></div><div class="base-url-card"><span>BASE URL</span><code id="base-url-value">${escapeHtml(displayBase)}</code><button class="copy-button" type="button" data-copy-target="base-url-value">복사</button></div></div></section>
      <div class="shell docs-layout"><aside class="docs-nav"><strong>문서 목차</strong><a href="#authentication">인증</a><a href="#endpoints">엔드포인트</a><a href="#parameters">필터</a><a href="#api-explorer">API 탐색기</a></aside><div class="docs-content">
        <section class="docs-section" id="authentication"><p class="eyebrow">AUTHENTICATION</p><h2>API 키 헤더</h2><p>교사가 발급한 키를 <code>X-API-Key</code> 또는 <code>Authorization: Bearer</code> 헤더로 전달합니다. 저장소에는 원문 대신 SHA-256 해시만 남습니다.</p><div class="code-block code-block--command"><div><span>curl</span></div><pre><code>curl '${escapeHtml(displayBase)}/api/v1/cars?page_size=5' \\
  -H 'X-API-Key: YOUR_API_KEY'</code></pre></div><p><code>401</code>은 키 누락, <code>403</code>은 잘못되거나 폐기된 키를 뜻합니다. 키를 쿼리 문자열에 넣으면 로그와 방문 기록에 남으므로 사용하지 마세요.</p></section>
        <section class="docs-section" id="endpoints"><p class="eyebrow">ENDPOINTS</p><h2>사용 가능한 경로</h2><div class="endpoint-list">${endpointCard("/healthz", "서버와 저장소 상태를 확인합니다.", true)}${endpointCard("/api/v1/cars", "필터·정렬·페이지 기반 차량 목록")}${endpointCard("/api/v1/cars/cursor?after_id=0&limit=100", "대량 적재용 ID 커서 목록")}${endpointCard("/api/v1/changes?after_seq=0&limit=100", "고정 high-water mark 증분 변경 로그")}${endpointCard("/api/v1/generation-runs?after_id=0", "append-only 적재 상태 이벤트")}${endpointCard("/api/v1/cars/:id", "차량 한 건과 담당 관계")}${endpointCard("/api/v1/brands", "브랜드별 차량 수")}${endpointCard("/api/v1/locations", "실제 차량 소재지 목록")}${endpointCard("/api/v1/business-areas", "CSV 업무영역과 마스킹된 관리자")}${endpointCard("/api/v1/stats", "데이터셋 통계")}</div></section>
        <section class="docs-section" id="parameters"><p class="eyebrow">QUERY PARAMETERS</p><h2>차량 목록 필터</h2><div class="table-scroll" tabindex="0"><table><thead><tr><th>이름</th><th>예시</th><th>설명</th></tr></thead><tbody><tr><th><code>q</code></th><td>그랜저</td><td>브랜드·모델·트림 검색</td></tr><tr><th><code>brand</code></th><td>hyundai</td><td>브랜드 slug</td></tr><tr><th><code>fuel</code></th><td>하이브리드</td><td>연료 유형</td></tr><tr><th><code>status</code></th><td>AVAILABLE</td><td>판매 상태</td></tr><tr><th><code>location</code></th><td>seoul</td><td>실제 소재지 slug</td></tr><tr><th><code>min_price</code> / <code>max_price</code></th><td>10000000</td><td>가격 범위</td></tr><tr><th><code>min_year</code> / <code>max_year</code></th><td>2020</td><td>연식 범위</td></tr><tr><th><code>max_mileage</code></th><td>80000</td><td>최대 주행거리 km</td></tr><tr><th><code>accident_free</code></th><td>true</td><td>사고 0건만 조회</td></tr><tr><th><code>sort</code></th><td>price_asc</td><td>newest, price_asc, price_desc, mileage_asc, year_desc</td></tr><tr><th><code>page</code> / <code>page_size</code></th><td>1 / 20</td><td>페이지와 1~100 크기</td></tr></tbody></table></div></section>
        <section class="docs-section explorer-section" id="api-explorer"><p class="eyebrow">TRY IT</p><h2>키를 넣어 실제 호출</h2><p>키는 이 페이지의 메모리에만 머물며 저장하지 않습니다.</p><form class="api-explorer car-api-explorer" action="/api/v1/cars" method="get" data-api-explorer><div class="field api-key-field"><label for="explorer-key">API 키</label><input id="explorer-key" type="password" autocomplete="off" placeholder="ucar_v1_..." data-api-key required></div><div class="field"><label for="explorer-q">검색어</label><input id="explorer-q" name="q" type="search" placeholder="예: 쏘나타"></div><div class="field"><label for="explorer-sort">정렬</label><select id="explorer-sort" name="sort"><option value="newest">최신 등록순</option><option value="price_asc">낮은 가격순</option><option value="price_desc">높은 가격순</option><option value="mileage_asc">짧은 주행거리순</option><option value="year_desc">최신 연식순</option></select></div><div class="field"><label for="explorer-size">표시 개수</label><input id="explorer-size" name="page_size" type="number" value="5" min="1" max="100"></div><button class="button button--primary" type="submit">GET 요청 보내기</button></form><div class="explorer-result"><div><span class="response-status" data-api-status aria-live="polite">요청 전</span><code data-api-url>/api/v1/cars?page_size=5</code></div><pre tabindex="0"><code data-api-output>API 키와 조건을 입력한 뒤 요청을 보내세요.</code></pre></div></section>
      </div></div>`,
  });
}

export function renderLearningGuidePage({ baseUrl = "", stats = {} } = {}) {
  const displayBase = normaliseBaseUrl(baseUrl) || "http://서버-IP:4000";
  return layout({
    title: "수집 학습 가이드",
    description: "중고차 HTML, API, CSV 관계 수집 수업 가이드",
    activePage: "guide",
    content: `<section class="docs-hero"><div class="shell docs-hero__grid"><div><p class="eyebrow">CLASSROOM GUIDE</p><h1>관찰부터 적재까지<br>한 단계씩.</h1><p>HTML 선택자, 인증 헤더, 페이지 종료 조건, CSV 정규화와 MySQL 조인을 한 데이터셋으로 이어갑니다.</p></div><div class="base-url-card"><span>현재 데이터</span><code>${formatNumber(stats.carCount)} cars · ${formatNumber(stats.businessAreaCount)} areas</code><span>${escapeHtml(displayBase)}</span></div></div></section>
      <div class="shell docs-layout"><aside class="docs-nav"><strong>실습 순서</strong><a href="#html-crawl">1. HTML</a><a href="#api-collect">2. API</a><a href="#csv-join">3. CSV 관계</a><a href="#assignments">4. 과제</a></aside><div class="docs-content">
        <section class="docs-section" id="html-crawl"><p class="eyebrow">STEP 1</p><h2>HTML 목록 수집</h2><p><code>/cars</code>의 각 매물은 <code>article.car-card[data-car-id]</code>입니다. 제목·가격·주행거리에는 각각 <code>data-field</code>가 있고, 다음 페이지 링크는 <code>a[rel=next]</code>로 찾을 수 있습니다.</p><div class="code-block"><div><span>Python + BeautifulSoup</span></div><pre><code>import requests
from bs4 import BeautifulSoup

url = "${escapeHtml(displayBase)}/cars?page_size=24"
while url:
    soup = BeautifulSoup(requests.get(url, timeout=10).text, "html.parser")
    for card in soup.select("article.car-card[data-car-id]"):
        print(card["data-car-id"], card.select_one('[data-field="price"]').get("value"))
    next_link = soup.select_one("a[rel=next]")
    url = requests.compat.urljoin(url, next_link["href"]) if next_link else None</code></pre></div></section>
        <section class="docs-section" id="api-collect"><p class="eyebrow">STEP 2</p><h2>인증 API와 커서 수집</h2><p>교사가 발급한 키를 환경 변수에 두고 헤더로 전달합니다. 전체 적재는 큰 OFFSET 대신 <code>after_id</code> 커서를 사용합니다.</p><div class="code-block"><div><span>Python requests</span></div><pre><code>import os, requests

base = "${escapeHtml(displayBase)}"
headers = {"X-API-Key": os.environ["AUTODATA_API_KEY"]}
path = "/api/v1/cars/cursor?after_id=0&amp;limit=500"
while path:
    payload = requests.get(base + path, headers=headers, timeout=10).json()
    # payload["data"]를 파일 또는 DB에 즉시 저장
    path = payload["links"]["next"]</code></pre></div></section>
        <section class="docs-section" id="csv-join"><p class="eyebrow">STEP 3</p><h2>CSV 네 개의 실제 의미</h2><p><code>AREA</code>는 시·도가 아니라 업무/조직 영역입니다. 따라서 차량 소재지는 <code>locations</code>, 담당 조직은 <code>business_areas</code>로 분리합니다. 공개 응답의 직원 이름은 마스킹합니다.</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>원본</th><th>역할</th><th>관계</th></tr></thead><tbody><tr><th>biz_employee_master</th><td>직원 마스터 3,000건</td><td><code>EMP_NO</code> PK</td></tr><tr><th>biz_meta_area_50000</th><td>업무영역 50,000건</td><td><code>MANAGER_EMP_NO → employees</code></td></tr><tr><th>biz_meta_area_parent_lookup</th><td>상위영역 1,000건</td><td><code>PARENT_AREA_ID</code> 참조</td></tr><tr><th>biz_meta_area_join_ready</th><td>수업용 비정규화 결과</td><td>정규화 조인 결과 검증</td></tr><tr><th>vehicle_listings</th><td>중고차 매물</td><td>담당 직원·업무영역·소재지 참조</td></tr></tbody></table></div><p>정규화 테이블을 조인한 결과와 <code>join_ready</code>의 이름·부서·직급이 같은지 비교하면 데이터 품질 검증 실습이 됩니다.</p></section>
        <section class="docs-section" id="assignments"><p class="eyebrow">STEP 4</p><h2>권장 과제</h2><ol class="guide-assignments"><li>HTML 3페이지를 수집해 중복 ID와 누락 필드를 검사합니다.</li><li>같은 필터를 API로 호출하고 HTML 결과와 가격·ID를 대조합니다.</li><li>커서 API 전체 수집을 재시작 가능하도록 체크포인트 파일을 만듭니다.</li><li>직원–업무영역–차량을 조인하되 직원 이름은 결과에서 마스킹합니다.</li><li>OFFSET과 커서 수집 시간을 측정하고 실행 계획을 비교합니다.</li></ol><p>상세 SQL과 실행 명령은 저장소의 <code>docs/LEARNING_GUIDE.md</code>에 있습니다.</p></section>
      </div></div>`,
  });
}

function cursorUrl(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

function formatDateTime(value) {
  if (!value) return "진행 중";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Seoul",
    }).format(date);
}

export function renderChangeLogPage({ items = [], afterSeq = 0, untilSeq = 0, datasetEpoch = "", limit = 24, hasMore = false } = {}) {
  const cards = items.length ? items.map((event) => `<article class="lesson-card change-card" data-change-event data-seq="${escapeHtml(event.seq)}" data-event-id="${escapeHtml(event.eventId)}" data-operation="${escapeHtml(event.operation)}">
    <span data-field="seq">#${formatNumber(event.seq)}</span>
    <h2 data-field="listing-number">${escapeHtml(event.listingNumber)}</h2>
    <p><strong data-field="operation">${escapeHtml(event.operation)}</strong> · entity version <data data-field="entity-version" value="${escapeHtml(event.entityVersion)}">${formatNumber(event.entityVersion)}</data></p>
    <p data-field="occurred-at"><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatDateTime(event.occurredAt))}</time></p>
    <p>run <code data-field="run-key">${escapeHtml(event.runKey ?? event.runId)}</code></p>
    <a href="/cars/${encodeURIComponent(String(event.listingId))}">현재 차량 보기 →</a>
  </article>`).join("") : '<div class="empty-state"><strong>이 snapshot에 변경 이벤트가 없습니다.</strong><p>생성기를 한 번 실행한 뒤 다시 확인하세요.</p></div>';
  const lastSeq = items.at(-1)?.seq ?? Number(afterSeq);
  const next = hasMore
    ? `<a class="pagination__link" rel="next" href="${escapeHtml(cursorUrl("/changes", { after_seq: lastSeq, until_seq: untilSeq, limit, dataset_epoch: datasetEpoch }))}">다음 로그 →</a>`
    : '<span class="pagination__link is-disabled" aria-disabled="true">마지막 로그</span>';
  return layout({
    title: "크롤링 가능한 변경 로그",
    description: "MySQL과 MongoDB에 멱등 적재된 합성 차량 변경 이벤트의 고정 snapshot",
    activePage: "changes",
    content: `<section class="page-hero page-hero--compact"><div class="shell"><p class="eyebrow">BOUNDED CHANGE FEED</p><div class="page-hero__row"><div><h1>차량 변경 로그</h1><p>첫 요청의 <code>until_seq=${escapeHtml(untilSeq)}</code>를 다음 링크에도 유지하므로, 새 이벤트가 계속 생겨도 이번 순회는 끝납니다.</p></div><a class="button button--dark" href="/crawl-policy">수집 이용정책</a></div></div></section>
      <section class="lesson-section"><div class="shell" data-change-list data-snapshot-until="${escapeHtml(untilSeq)}" data-dataset-epoch="${escapeHtml(datasetEpoch)}">
        <div class="catalog-toolbar"><div><p class="eyebrow">SNAPSHOT RANGE</p><h2><code>${escapeHtml(afterSeq)}</code> 다음부터</h2></div><p>high-water mark <strong>${formatNumber(untilSeq)}</strong></p></div>
        <div class="lesson-grid">${cards}</div>
        <nav class="pagination" aria-label="변경 로그 커서">${next}</nav>
      </div></section>`,
  });
}

export function renderGenerationRunsPage({ items = [], afterId = 0, untilId = 0, datasetEpoch = "", limit = 24, hasMore = false } = {}) {
  const cards = items.length ? items.map((event) => `<article class="lesson-card generation-run-card" data-generation-run data-generation-run-event data-event-id="${escapeHtml(event.eventId ?? event.id)}" data-run-id="${escapeHtml(event.runId)}" data-status="${escapeHtml(event.status)}">
    <span data-field="event-id">EVENT #${formatNumber(event.eventId ?? event.id)}</span>
    <h2 data-field="run-key">${escapeHtml(event.runKey)}</h2>
    <p>RUN <data data-field="run-id" value="${escapeHtml(event.runId)}">#${formatNumber(event.runId)}</data> · <strong data-field="status">${escapeHtml(event.status)}</strong></p>
    <p>요청 <data data-field="requested-count" value="${escapeHtml(event.requestedCount)}">${formatNumber(event.requestedCount)}</data>건 · MySQL <data data-field="mysql-count" value="${escapeHtml(event.mysqlCount)}">${formatNumber(event.mysqlCount)}</data> · MongoDB <data data-field="mongo-count" value="${escapeHtml(event.mongoCount)}">${formatNumber(event.mongoCount)}</data></p>
    <p>ID <data data-field="sequence-start" value="${escapeHtml(event.sequenceStart)}">${formatNumber(event.sequenceStart)}</data>–<data data-field="sequence-end" value="${escapeHtml(event.sequenceEnd)}">${formatNumber(event.sequenceEnd)}</data></p>
    <p data-field="occurred-at"><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatDateTime(event.occurredAt))}</time></p>
    <p data-field="started-at">실행 시작 <time datetime="${escapeHtml(event.startedAt)}">${escapeHtml(formatDateTime(event.startedAt))}</time></p>
    ${event.errorMessage ? `<p data-field="error-message">${escapeHtml(event.errorMessage)}</p>` : ""}
  </article>`).join("") : '<div class="empty-state"><strong>생성 실행 기록이 없습니다.</strong><p>MySQL·MongoDB를 시작하고 생성기를 실행하세요.</p></div>';
  const lastId = items.at(-1)?.id ?? Number(afterId);
  const next = hasMore
    ? `<a class="pagination__link" rel="next" href="${escapeHtml(cursorUrl("/generation-runs", { after_id: lastId, until_id: untilId, limit, dataset_epoch: datasetEpoch }))}">다음 실행 →</a>`
    : '<span class="pagination__link is-disabled" aria-disabled="true">마지막 실행</span>';
  return layout({
    title: "데이터 생성 상태 이벤트",
    description: "MySQL과 MongoDB 이중 적재의 모든 상태 전이를 수집하는 append-only snapshot",
    activePage: "runs",
    content: `<section class="page-hero page-hero--compact"><div class="shell"><p class="eyebrow">APPEND-ONLY RUN EVENTS</p><div class="page-hero__row"><div><h1>적재 상태 이벤트</h1><p>RUNNING부터 SUCCESS·PARTIAL_FAILED·FAILED와 재시도까지 append-only로 남습니다. 이 페이지를 읽어도 source event가 재귀적으로 늘어나지 않습니다.</p></div><a class="button button--dark" href="/changes">변경 로그 보기</a></div></div></section>
      <section class="lesson-section"><div class="shell" data-generation-run-list data-snapshot-until="${escapeHtml(untilId)}" data-dataset-epoch="${escapeHtml(datasetEpoch)}">
        <div class="catalog-toolbar"><div><p class="eyebrow">EVENT SNAPSHOT</p><h2>event <code>${escapeHtml(afterId)}</code> 다음부터</h2></div><p>event high-water mark <strong>${formatNumber(untilId)}</strong></p></div>
        <div class="lesson-grid">${cards}</div>
        <nav class="pagination" aria-label="생성 상태 이벤트 커서">${next}</nav>
      </div></section>`,
  });
}

export function renderCrawlPolicyPage({ baseUrl = "" } = {}) {
  const displayBase = normaliseBaseUrl(baseUrl) || "이 AutoData Lab 호스트";
  return layout({
    title: "수집 이용정책",
    description: "AutoData Lab 교육용 HTML·API 크롤링 허용 범위와 요청 제한",
    activePage: "policy",
    content: `<section class="docs-hero"><div class="shell docs-hero__grid"><div><p class="eyebrow">CRAWL POLICY · EDUCATIONAL SANDBOX</p><h1>허용 범위를<br>먼저 확인하세요.</h1><p><strong>${escapeHtml(displayBase)}</strong>의 합성 데이터는 아래 조건에서 교육용 수집을 허용합니다. 이 허가는 어떤 제3자 사이트에도 적용되지 않습니다.</p></div><div class="base-url-card"><span>권장 HTML 간격</span><code>요청 사이 최소 1초</code><span>API는 발급 키와 응답의 제한 헤더 준수</span></div></div></section>
      <div class="shell docs-layout"><aside class="docs-nav"><strong>정책 목차</strong><a href="#allowed">허용</a><a href="#prohibited">금지</a><a href="#limits">요청 제한</a><a href="#legal">외부 사이트</a></aside><div class="docs-content">
        <section class="docs-section" id="allowed"><p class="eyebrow">ALLOWED</p><h2>이 샌드박스에서 허용하는 수집</h2><ul><li><code>/cars</code>, <code>/changes</code>, <code>/generation-runs</code>의 순차 HTML 수집</li><li>발급된 키를 헤더로 사용하는 <code>/api/v1/*</code> JSON 수집</li><li>과제 제출을 위한 합성 데이터의 저장·변환·통계</li></ul><p>차량, 담당자 표시명, 실행 기록은 모두 교육용 합성 값이며 실제 차량번호·연락처·API key를 포함하지 않습니다.</p></section>
        <section class="docs-section" id="prohibited"><p class="eyebrow">NOT ALLOWED</p><h2>우회와 과도한 요청 금지</h2><ul><li>인증 우회, 키 공유·노출, 제한 회피, 의도적인 서비스 방해</li><li>과도한 병렬 요청, <code>429</code> 또는 <code>Retry-After</code> 무시</li><li>개인정보나 실재 차량 정보를 이 서버에 입력하거나 공개</li></ul></section>
        <section class="docs-section" id="limits"><p class="eyebrow">RATE &amp; SNAPSHOT</p><h2>유한하게 끝나는 수집</h2><p>HTML은 요청 사이 최소 1초를 두고 <code>a[rel=next]</code>를 따릅니다. 변경·상태 이벤트는 첫 응답에서 받은 <code>until_seq</code> 또는 <code>until_id</code>를 끝까지 유지합니다. 실행 feed의 ID는 run ID가 아니라 event cursor입니다. API 제한을 넘으면 <code>429</code>, <code>Retry-After</code>, <code>RateLimit-*</code> 헤더를 반환합니다.</p></section>
        <section class="docs-section" id="legal"><p class="eyebrow">THIRD-PARTY SITES</p><h2>robots 허용만으로 충분하지 않습니다</h2><p>외부 수집이 언제나 불법인 것도, 공개 페이지라 언제나 허용되는 것도 아닙니다. 실제 사이트에서는 이용약관, 저작권·데이터베이스 권리, 개인정보, 로그인·접근통제, 요청 부하, API 라이선스를 각각 확인하고 권한이 불명확하면 수집하지 않습니다.</p></section>
      </div></div>`,
  });
}

export function renderErrorPage({ status = 500, message = "요청을 처리하지 못했습니다." } = {}) {
  return layout({
    title: `${status} 오류`,
    description: message,
    activePage: "error",
    content: `<section class="error-page"><div class="shell error-page__inner"><p class="error-page__code" aria-hidden="true">${escapeHtml(status)}</p><p class="eyebrow">REQUEST ERROR</p><h1>${escapeHtml(message)}</h1><p>주소, 필터, API 키를 확인한 뒤 다시 시도해 주세요.</p><div class="hero__actions"><a class="button button--primary" href="/">홈으로 이동</a><a class="button button--secondary" href="/docs">API 문서 확인</a></div></div></section>`,
  });
}
