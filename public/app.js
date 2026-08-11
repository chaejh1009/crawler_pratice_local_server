(() => {
  "use strict";

  document.documentElement.classList.add("js");

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // file:// 또는 브라우저 권한 정책에서 거부되면 아래 fallback을 사용합니다.
      }
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("Copy is not supported");
  }

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;

      const originalLabel = button.textContent;
      try {
        await copyText(target.textContent ?? "");
        button.textContent = "복사됨";
        button.classList.add("is-copied");
      } catch {
        button.textContent = "복사 실패";
      }

      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove("is-copied");
      }, 1600);
    });
  });

  document.querySelectorAll("[data-toggle-secret]").forEach((button) => {
    button.addEventListener("click", () => {
      const inputId = button.getAttribute("aria-controls");
      const input = inputId ? document.getElementById(inputId) : null;
      if (!(input instanceof HTMLInputElement)) return;
      const willShow = input.type === "password";
      input.type = willShow ? "text" : "password";
      button.textContent = willShow ? "숨김" : "표시";
      button.setAttribute("aria-pressed", String(willShow));
      input.focus();
    });
  });

  const explorer = document.querySelector("[data-api-explorer]");
  if (!(explorer instanceof HTMLFormElement)) return;

  const output = document.querySelector("[data-api-output]");
  const status = document.querySelector("[data-api-status]");
  const urlLabel = document.querySelector("[data-api-url]");
  const progress = document.querySelector("[data-api-progress]");
  const submitButtons = [...explorer.querySelectorAll('button[type="submit"]')];
  const stopButton = explorer.querySelector("[data-api-stop]");
  const downloadButton = document.querySelector("[data-api-download]");
  const apiKeyInput = explorer.querySelector("[data-api-key]");
  const maxPagesInput = explorer.querySelector("[data-api-max-pages]");
  const dailyKeyPanel = document.querySelector("[data-daily-key-panel]");
  const loadDailyKeyButton = explorer.querySelector("[data-load-daily-key]");
  let activeRequest;
  let downloadableResult;
  let dailyRefreshTimer;

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value ?? "";
  }

  function scheduleDailyKeyRefresh(schedule) {
    window.clearTimeout(dailyRefreshTimer);
    const serverNow = Date.parse(schedule?.server_time ?? "");
    const referenceNow = Number.isFinite(serverNow) ? serverNow : Date.now();
    const targets = [schedule?.next_key_published_from, schedule?.current?.expires_at]
      .map((value) => Date.parse(value ?? ""))
      .filter((value) => Number.isFinite(value) && value > referenceNow);
    if (targets.length === 0) return;
    const waitMs = Math.min(2_147_000_000, Math.max(1_000, Math.min(...targets) - referenceNow + 1_500));
    dailyRefreshTimer = window.setTimeout(() => refreshDailyKey({ quiet: true }), waitMs);
  }

  async function refreshDailyKey({ quiet = false } = {}) {
    const endpoint = dailyKeyPanel?.getAttribute("data-key-endpoint") || "/api/v1/public-key";
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const schedule = payload?.data;
      const current = schedule?.current;
      if (!current?.api_key) throw new Error("현재 공개 키가 없습니다.");

      if (apiKeyInput instanceof HTMLInputElement) apiKeyInput.value = current.api_key;
      setText("[data-daily-current-key]", current.api_key);
      setText("[data-daily-current-date]", current.date);
      setText("[data-daily-active-from]", current.active_from);
      setText("[data-daily-expires-at]", current.expires_at);

      const nextPanel = document.querySelector("[data-daily-next]");
      if (nextPanel instanceof HTMLElement) {
        nextPanel.hidden = !schedule.next;
        if (schedule.next) {
          setText("[data-daily-next-key]", schedule.next.api_key);
          setText("[data-daily-next-date]", schedule.next.date);
          setText("[data-daily-next-active]", schedule.next.active_from);
        }
      }
      scheduleDailyKeyRefresh(schedule);
      if (!quiet && progress) progress.textContent = `${current.date} 공개 키를 불러왔습니다.`;
      return current.api_key;
    } catch (error) {
      if (!quiet && progress) progress.textContent = `공개 키를 불러오지 못했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
      return null;
    }
  }

  function requestUrl() {
    const url = new URL(explorer.action, window.location.href);
    url.search = "";

    for (const [name, rawValue] of new FormData(explorer).entries()) {
      const value = String(rawValue).trim();
      if (value) url.searchParams.set(name, value);
    }

    return url;
  }

  function syncRequestUrl() {
    const url = requestUrl();
    const relativeUrl = `${url.pathname}${url.search}`;
    if (urlLabel) urlLabel.textContent = relativeUrl;
    if (progress && !activeRequest) {
      const maximum = maxPagesInput instanceof HTMLInputElement ? maxPagesInput.value : "1";
      progress.textContent = `수집 대기 · 최대 ${maximum || "1"}페이지`;
    }
  }

  function setBusy(isBusy) {
    submitButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) button.disabled = isBusy;
    });
    if (stopButton instanceof HTMLButtonElement) stopButton.disabled = !isBusy;
    explorer.toggleAttribute("aria-busy", isBusy);
  }

  function showResult(value) {
    downloadableResult = value;
    if (output) output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (downloadButton instanceof HTMLButtonElement) downloadButton.disabled = typeof value === "string";
  }

  async function fetchPayload(url, apiKey, signal, allowKeyRefresh = true) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      signal,
    });
    if (response.status === 403 && allowKeyRefresh) {
      const refreshedKey = await refreshDailyKey({ quiet: true });
      if (refreshedKey && refreshedKey !== apiKey) {
        return fetchPayload(url, refreshedKey, signal, false);
      }
    }
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = body || "(빈 응답)";
    }
    return { response, payload, apiKey };
  }

  explorer.addEventListener("input", syncRequestUrl);
  explorer.addEventListener("change", syncRequestUrl);

  explorer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const startUrl = requestUrl();
    const crawlMode = event.submitter instanceof HTMLButtonElement && event.submitter.hasAttribute("data-api-crawl");
    syncRequestUrl();

    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;

    if (status) {
      status.textContent = crawlMode ? "크롤링 중" : "요청 중";
      status.classList.remove("is-error");
      status.classList.add("is-loading");
    }
    if (output) output.textContent = "서버 응답을 기다리고 있습니다…";
    downloadableResult = undefined;
    if (downloadButton instanceof HTMLButtonElement) downloadButton.disabled = true;
    setBusy(true);

    try {
      let apiKey = apiKeyInput instanceof HTMLInputElement ? apiKeyInput.value.trim() : "";
      if (!crawlMode) {
        const { response, payload } = await fetchPayload(startUrl, apiKey, request.signal);
        showResult(payload);
        if (status) {
          status.textContent = `${response.status} ${response.ok ? "OK" : "ERROR"}`;
          status.classList.toggle("is-error", !response.ok);
        }
        if (progress) progress.textContent = response.ok ? "현재 페이지 조회 완료" : "요청 오류를 확인하세요.";
        return;
      }

      const maximumPages = maxPagesInput instanceof HTMLInputElement
        ? Math.max(1, Math.min(50, Number(maxPagesInput.value) || 1))
        : 1;
      const collected = [];
      let nextUrl = startUrl;
      let pagesFetched = 0;
      let lastMeta = null;

      while (nextUrl && pagesFetched < maximumPages) {
        const fetched = await fetchPayload(nextUrl, apiKey, request.signal);
        const { response, payload } = fetched;
        apiKey = fetched.apiKey;
        if (!response.ok) {
          showResult(payload);
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        if (!payload || !Array.isArray(payload.data) || !payload.links) {
          throw new Error("API 응답에 data 또는 links가 없습니다.");
        }

        collected.push(...payload.data);
        pagesFetched += 1;
        lastMeta = payload.meta ?? null;
        if (progress) progress.textContent = `${pagesFetched}/${maximumPages}페이지 · ${collected.length}건 수집`;

        const nextPath = payload.links.next;
        nextUrl = nextPath ? new URL(nextPath, window.location.origin) : null;
      }

      const result = {
        data: collected,
        crawl: {
          pages_fetched: pagesFetched,
          items_collected: collected.length,
          stopped_by_page_limit: Boolean(nextUrl),
          next: nextUrl ? `${nextUrl.pathname}${nextUrl.search}` : null,
          last_page_meta: lastMeta,
        },
      };
      showResult(result);
      if (status) status.textContent = `200 OK · ${pagesFetched} PAGE`;
      if (progress) progress.textContent = nextUrl
        ? `최대 페이지에 도달했습니다. ${collected.length}건 수집, 다음 페이지 있음.`
        : `마지막 페이지까지 ${collected.length}건 수집 완료.`;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (status) status.textContent = "중지됨";
        if (progress) progress.textContent = "사용자가 API 크롤링을 중지했습니다.";
        return;
      }
      if (output && downloadableResult === undefined) output.textContent = `요청에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
      if (status) {
        status.textContent = error && typeof error === "object" && "status" in error ? `${error.status} ERROR` : "NETWORK ERROR";
        status.classList.add("is-error");
      }
      if (progress) progress.textContent = "크롤링이 중단되었습니다. 응답과 키를 확인하세요.";
    } finally {
      if (activeRequest === request) {
        activeRequest = undefined;
        setBusy(false);
        if (status) status.classList.remove("is-loading");
      }
    }
  });

  if (stopButton instanceof HTMLButtonElement) {
    stopButton.addEventListener("click", () => activeRequest?.abort());
  }

  if (loadDailyKeyButton instanceof HTMLButtonElement) {
    loadDailyKeyButton.addEventListener("click", () => refreshDailyKey());
  }

  if (downloadButton instanceof HTMLButtonElement) {
    downloadButton.addEventListener("click", () => {
      if (downloadableResult === undefined || typeof downloadableResult === "string") return;
      const blob = new Blob([`${JSON.stringify(downloadableResult, null, 2)}\n`], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `autodata-api-crawl-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(href);
    });
  }

  syncRequestUrl();
  refreshDailyKey({ quiet: true });
})();
