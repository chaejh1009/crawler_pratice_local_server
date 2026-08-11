(() => {
  "use strict";

  document.documentElement.classList.add("js");

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
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

  const explorer = document.querySelector("[data-api-explorer]");
  if (!(explorer instanceof HTMLFormElement)) return;

  const output = document.querySelector("[data-api-output]");
  const status = document.querySelector("[data-api-status]");
  const urlLabel = document.querySelector("[data-api-url]");
  const openLink = document.querySelector("[data-api-open]");
  const submitButton = explorer.querySelector('button[type="submit"]');
  const apiKeyInput = explorer.querySelector("[data-api-key]");
  let activeRequest;

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
    if (openLink instanceof HTMLAnchorElement) openLink.href = relativeUrl;
  }

  explorer.addEventListener("input", syncRequestUrl);
  explorer.addEventListener("change", syncRequestUrl);

  explorer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = requestUrl();
    syncRequestUrl();

    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;

    if (status) {
      status.textContent = "요청 중";
      status.classList.remove("is-error");
      status.classList.add("is-loading");
    }
    if (output) output.textContent = "서버 응답을 기다리고 있습니다…";
    if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
    explorer.setAttribute("aria-busy", "true");

    try {
      const apiKey = apiKeyInput instanceof HTMLInputElement ? apiKeyInput.value.trim() : "";
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        signal: request.signal,
      });
      const body = await response.text();
      let formattedBody = body;

      try {
        formattedBody = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        // Showing text is useful when a server returns a non-JSON error page.
      }

      if (output) output.textContent = formattedBody || "(빈 응답)";
      if (status) {
        status.textContent = `${response.status} ${response.ok ? "OK" : "ERROR"}`;
        status.classList.toggle("is-error", !response.ok);
        status.classList.remove("is-loading");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (output) output.textContent = `요청에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`;
      if (status) {
        status.textContent = "NETWORK ERROR";
        status.classList.add("is-error");
        status.classList.remove("is-loading");
      }
    } finally {
      if (activeRequest === request) {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
        explorer.removeAttribute("aria-busy");
      }
    }
  });

  syncRequestUrl();
})();
