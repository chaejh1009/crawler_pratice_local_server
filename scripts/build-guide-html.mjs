import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");

const GUIDE_CONFIGS = [
  {
    source: "docs/DEPLOYER_GUIDE.md",
    output: "docs/DEPLOYER_GUIDE.html",
    title: "AutoData Lab 배포자용 사용설명서",
    role: "배포자용",
    eyebrow: "DEPLOYER GUIDE · MEMORY MODE",
    description: "Docker와 별도 데이터베이스 없이 AutoData Lab을 수업망에 배포하는 강사·운영자 안내서",
    heroCopy: "강사 PC 한 대에서 설치하고, 같은 수업망의 사용자에게 주소와 API 키를 전달하는 전체 절차입니다.",
    facts: ["Docker·DB 불필요", "Node.js 22.13+", "로컬 LAN · :4000"],
    otherHref: "USER_GUIDE.html",
    otherLabel: "사용자용 설명서",
    documentClass: "deployer",
  },
  {
    source: "docs/STUDENT_GUIDE.md",
    output: "docs/USER_GUIDE.html",
    title: "AutoData Lab 사용자용 사용설명서",
    role: "사용자용",
    eyebrow: "USER GUIDE · CLASSROOM CLIENT",
    description: "서버 주소와 API 키로 AutoData Lab의 HTML과 JSON API를 수집하는 사용자·수강생 안내서",
    heroCopy: "사용자(수강생)는 서버 주소와 API 키만 받아 브라우저, curl, Python으로 바로 실습합니다.",
    facts: ["서버 설치 불필요", "주소 + API 키", "HTML 간격 · 1초"],
    otherHref: "DEPLOYER_GUIDE.html",
    otherLabel: "배포자용 설명서",
    documentClass: "user",
  },
];

const LANGUAGE_LABELS = Object.freeze({
  bash: "Terminal · bash",
  powershell: "Windows · PowerShell",
  python: "Python",
  dotenv: "환경설정 · .env",
  json: "응답 · JSON",
  text: "안내 예시",
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function rewriteReference(href, label, config) {
  const [path] = href.split("#");
  if (path === "STUDENT_GUIDE.md") {
    return `<a href="USER_GUIDE.html">${label.replace("수강생", "사용자용")}</a>`;
  }
  if (path === "DEPLOYER_GUIDE.md") {
    return `<a href="DEPLOYER_GUIDE.html">${label}</a>`;
  }
  if (path === "API.md") {
    const detail = href.includes("#증분-변경-로그") ? "증분 변경 로그 항목" : "API 전체 계약";
    return `<span class="project-reference">${label}(서버 실행 후 <code>서버 주소/docs</code>의 ${detail})</span>`;
  }
  if (path === "LEARNING_GUIDE.md") {
    const detail = href.includes("#7-csv-") ? "CSV 관계 절" : "전체 실습 예제";
    return `<span class="project-reference">${label}(서버 실행 후 <code>서버 주소/learning-guide</code>의 ${detail})</span>`;
  }
  const safeHref = escapeAttribute(href);
  const external = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : "";
  return `<a href="${safeHref}"${external}>${label}</a>`;
}

function renderInline(value, config) {
  const protectedFragments = [];
  const protect = (html) => {
    const token = `\u0000INLINE${protectedFragments.length}\u0000`;
    protectedFragments.push(html);
    return token;
  };

  let text = String(value ?? "");
  if (config.documentClass === "user") text = text.replaceAll("학생 PC", "수강생 PC");
  text = text.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => (
    protect(rewriteReference(href, escapeHtml(label), config))
  ));
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\u0000INLINE(\d+)\u0000/g, (_, index) => protectedFragments[Number(index)]);
  return text;
}

function isTableSeparator(line) {
  if (!/^\s*\|/.test(line)) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line) {
  return String(line).trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return /^```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
    || (/^\s*\|/.test(line) && isTableSeparator(next));
}

function parseMarkdown(markdown, config) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  let h2Index = 0;
  let h3Index = 0;
  const usedIds = new Set(["top", "main-content"]);

  const uniqueId = (candidate) => {
    let id = candidate;
    let suffix = 2;
    while (usedIds.has(id)) id = `${candidate}-${suffix++}`;
    usedIds.add(id);
    return id;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const language = fence[1] || "text";
      const body = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index >= lines.length) throw new Error(`${config.source}: 닫히지 않은 code fence`);
      index += 1;
      blocks.push({ type: "code", language, value: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const rawText = heading[2].trim();
      let id = "top";
      if (level === 2) {
        h2Index += 1;
        h3Index = 0;
        id = uniqueId(`section-${h2Index}`);
      } else if (level === 3) {
        h3Index += 1;
        id = uniqueId(`section-${h2Index}-${h3Index}`);
      } else if (level > 3) {
        id = uniqueId(`heading-${blocks.length + 1}`);
      }
      blocks.push({ type: "heading", level, id, rawText });
      index += 1;
      continue;
    }

    if (/^\s*\|/.test(line) && isTableSeparator(lines[index + 1] ?? "")) {
      const headers = splitTableRow(line);
      const alignments = splitTableRow(lines[index + 1]).map((cell) => (
        cell.endsWith(":") && !cell.startsWith(":") ? "right"
          : cell.startsWith(":") && cell.endsWith(":") ? "center"
            : "left"
      ));
      index += 2;
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(splitTableRow(lines[index++]));
      blocks.push({ type: "table", headers, alignments, rows });
      continue;
    }

    const listMatch = line.match(/^\s*(?:(\d+)\.|([-+*]))\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)\.|([-+*]))\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        const task = !ordered ? item[3].match(/^\[([ xX])\]\s+(.+)$/) : null;
        items.push({
          value: task ? task[2] : item[3],
          task: Boolean(task),
          checked: task ? task[1].toLowerCase() === "x" : false,
        });
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", value: paragraph.join(" ") });
  }

  return blocks;
}

function renderTable(block, context, config, tableIndex) {
  const label = `${context || "설명서"} 표 ${tableIndex}`;
  const columnCount = block.headers.length;
  const head = block.headers.map((cell, index) => (
    `<th scope="col" class="align-${block.alignments[index] || "left"}">${renderInline(cell, config)}</th>`
  )).join("");
  const body = block.rows.map((row) => `<tr>${Array.from({ length: columnCount }, (_, index) => {
    const tag = index === 0 ? "th" : "td";
    const scope = index === 0 ? ' scope="row"' : "";
    return `<${tag}${scope} class="align-${block.alignments[index] || "left"}">${renderInline(row[index] ?? "", config)}</${tag}>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-scroll" role="region" tabindex="0" aria-label="${escapeAttribute(label)}"><table><caption class="sr-only">${escapeHtml(label)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderCode(block, codeIndex) {
  const label = LANGUAGE_LABELS[block.language] || block.language;
  const longClass = block.value.split("\n").length > 55 ? " code-block--long" : "";
  return `<figure class="code-block${longClass}" data-code-block>
    <figcaption><span>${escapeHtml(label)}</span><span class="code-actions"><button type="button" data-wrap-code aria-pressed="false">줄바꿈</button><button type="button" data-copy-code aria-label="코드 예제 ${codeIndex} 복사">복사</button></span></figcaption>
    <pre tabindex="0"><code class="language-${escapeAttribute(block.language)}">${escapeHtml(block.value)}</code></pre>
  </figure>`;
}

function renderContent(blocks, config) {
  let html = '<section class="intro-card" aria-label="문서 소개">';
  let sectionOpen = false;
  let introOpen = true;
  let currentHeading = "문서 소개";
  let tableIndex = 0;
  let codeIndex = 0;

  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1) continue;
    if (block.type === "heading" && block.level === 2) {
      if (introOpen) {
        html += "</section>";
        introOpen = false;
      }
      if (sectionOpen) html += "</section>";
      currentHeading = block.rawText;
      html += `<section class="guide-section" aria-labelledby="${block.id}"><h2 id="${block.id}">${renderInline(block.rawText, config)}<a class="heading-anchor" href="#${block.id}" aria-label="${escapeAttribute(block.rawText)} 바로가기">#</a></h2>`;
      sectionOpen = true;
      continue;
    }
    if (block.type === "heading") {
      currentHeading = block.rawText;
      html += `<h${block.level} id="${block.id}">${renderInline(block.rawText, config)}<a class="heading-anchor" href="#${block.id}" aria-label="${escapeAttribute(block.rawText)} 바로가기">#</a></h${block.level}>`;
      continue;
    }
    if (block.type === "paragraph") {
      let value = block.value;
      if (config.documentClass === "user") {
        value = value
          .replace("수강생용 안내서", "사용자(수강생)용 안내서")
          .replaceAll("학생 PC", "수강생 PC");
      }
      html += `<p>${renderInline(value, config)}</p>`;
      continue;
    }
    if (block.type === "list") {
      const allTasks = block.items.every((item) => item.task);
      const tag = block.ordered ? "ol" : "ul";
      const className = allTasks ? ' class="checklist"' : "";
      html += `<${tag}${className}>${block.items.map((item) => {
        if (!item.task) return `<li>${renderInline(item.value, config)}</li>`;
        return `<li class="check-item"><span class="check-box${item.checked ? " is-checked" : ""}" aria-hidden="true"></span><span>${renderInline(item.value, config)}</span></li>`;
      }).join("")}</${tag}>`;
      continue;
    }
    if (block.type === "table") {
      tableIndex += 1;
      html += renderTable(block, currentHeading, config, tableIndex);
      continue;
    }
    if (block.type === "code") {
      codeIndex += 1;
      html += renderCode(block, codeIndex);
    }
  }

  if (introOpen || sectionOpen) html += "</section>";
  return { html, tableCount: tableIndex, codeCount: codeIndex };
}

function renderToc(blocks) {
  return blocks.filter((block) => block.type === "heading" && [2, 3].includes(block.level)).map((block) => (
    `<li class="toc-level-${block.level}"><a href="#${block.id}">${escapeHtml(block.rawText)}</a></li>`
  )).join("");
}

const STYLES = String.raw`
:root {
  --canvas: #f4f3ec; --surface: #fff; --surface-soft: #ebece4; --ink: #14221e;
  --ink-soft: #53615c; --line: #d9ddd4; --forest: #0e654b; --forest-dark: #0b392e;
  --forest-deep: #071f1a; --lime: #d8ee74; --coral: #ff765e; --gold: #e8a62a;
  --danger: #9d332f; --shadow: 0 1px 2px rgb(16 37 31 / .08), 0 12px 30px rgb(16 37 31 / .07);
  --radius-sm: 10px; --radius-md: 18px; --radius-lg: 28px; --shell: 1180px;
  --sans: Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; color: var(--ink); background: var(--canvas); font-family: var(--sans); font-size: 16px; line-height: 1.75; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
a { color: var(--forest); text-decoration-thickness: 1.5px; text-underline-offset: .2em; }
a:hover { color: var(--forest-dark); }
button, input { font: inherit; }
code, pre { font-family: var(--mono); }
code { padding: .13em .34em; color: #084d3a; border-radius: 5px; background: #e7efe8; font-size: .88em; overflow-wrap: anywhere; }
strong { font-weight: 850; }
:focus-visible { outline: 3px solid var(--forest-deep); outline-offset: 3px; box-shadow: 0 0 0 6px var(--coral); }
::selection { color: var(--forest-deep); background: var(--lime); }
.shell { width: min(calc(100% - 40px), var(--shell)); margin-inline: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; z-index: 1000; top: 12px; left: 12px; padding: 10px 16px; color: #fff; background: var(--forest-deep); border-radius: 8px; font-weight: 800; transform: translateY(-160%); transition: transform 160ms ease; }
.skip-link:focus { transform: translateY(0); }
.topbar { position: sticky; z-index: 30; top: 0; border-bottom: 1px solid rgb(20 34 30 / .11); background: rgb(244 243 236 / .94); backdrop-filter: blur(16px); }
.topbar__inner { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
.brand__mark { width: 38px; height: 38px; display: grid; place-items: center; color: var(--forest-deep); background: var(--lime); border: 1px solid rgb(7 31 26 / .18); border-radius: 12px 4px 12px 12px; box-shadow: 3px 3px 0 var(--forest-deep); font-weight: 950; }
.brand__text { display: flex; flex-direction: column; line-height: 1.15; }
.brand__text small { margin-top: 4px; color: var(--ink-soft); font-size: 10px; font-weight: 750; letter-spacing: .08em; }
.role-nav { display: flex; align-items: center; gap: 8px; }
.role-pill, .role-link { min-height: 42px; display: inline-flex; align-items: center; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 800; }
.role-pill { color: #fff; background: var(--forest); }
.role-link { color: var(--ink); border: 1px solid var(--line); background: var(--surface); text-decoration: none; }
.hero { position: relative; overflow: hidden; padding: 68px 0 72px; color: #fff; background: radial-gradient(circle at 85% 0, rgb(216 238 116 / .2), transparent 28%), radial-gradient(circle at 4% 100%, rgb(255 118 94 / .12), transparent 31%), var(--forest-deep); }
.hero::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .16; background-image: linear-gradient(rgb(255 255 255 / .12) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .12) 1px, transparent 1px); background-size: 46px 46px; mask-image: linear-gradient(to right, transparent 12%, #000 90%); }
.hero__inner { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, .55fr); gap: clamp(34px, 8vw, 96px); align-items: end; }
.eyebrow { margin: 0 0 12px; color: var(--lime); font-size: 11px; font-weight: 900; letter-spacing: .14em; }
.hero h1 { max-width: 760px; margin: 0; font-size: clamp(40px, 5.8vw, 68px); font-weight: 950; letter-spacing: -.055em; line-height: 1.08; word-break: keep-all; }
.hero__copy { max-width: 720px; margin: 20px 0 0; color: rgb(255 255 255 / .72); font-size: 18px; word-break: keep-all; }
.fact-list { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.fact-list li { min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 10px 14px; color: #fff; border: 1px solid rgb(255 255 255 / .16); border-radius: 13px; background: rgb(255 255 255 / .07); font-weight: 780; }
.fact-list li::before { content: ""; width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 4px rgb(216 238 116 / .12); }
.page { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 42px; align-items: start; padding: 44px 0 80px; }
.toc { position: sticky; top: 96px; max-height: calc(100vh - 120px); overflow: auto; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius-md); background: rgb(255 255 255 / .78); box-shadow: var(--shadow); }
.toc summary { cursor: pointer; color: var(--forest); font-weight: 900; }
.toc ol { margin: 14px 0 0; padding: 0; list-style: none; }
.toc li + li { margin-top: 2px; }
.toc a { display: block; padding: 6px 8px; color: var(--ink-soft); border-radius: 7px; font-size: 13px; font-weight: 700; line-height: 1.4; text-decoration: none; }
.toc a:hover, .toc a[aria-current="location"] { color: var(--forest-dark); background: #e5eee2; font-weight: 850; }
.toc a[aria-current="location"] { box-shadow: inset 3px 0 0 var(--forest); }
.toc .toc-level-3 a { padding-left: 22px; font-size: 12px; font-weight: 600; }
.manual { min-width: 0; max-width: 820px; }
.intro-card, .guide-section { padding: clamp(24px, 4vw, 42px); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow); }
.guide-section { margin-top: 20px; }
.intro-card { border-top: 5px solid var(--lime); }
.intro-card > :first-child, .guide-section > :first-child { margin-top: 0; }
.intro-card > :last-child, .guide-section > :last-child { margin-bottom: 0; }
.manual h2, .manual h3 { position: relative; scroll-margin-top: 98px; word-break: keep-all; }
.manual h2 { margin: 0 0 22px; padding-bottom: 14px; border-bottom: 1px solid var(--line); font-size: clamp(27px, 3.3vw, 38px); font-weight: 920; letter-spacing: -.045em; line-height: 1.25; }
.manual h3 { margin: 36px 0 14px; color: var(--forest-dark); font-size: clamp(20px, 2.4vw, 26px); font-weight: 880; letter-spacing: -.025em; line-height: 1.35; }
.heading-anchor { margin-left: 8px; color: var(--forest); font-size: .65em; font-weight: 800; text-decoration: none; }
.manual h2:hover .heading-anchor, .manual h3:hover .heading-anchor, .heading-anchor:focus { color: var(--danger); }
.manual p { margin: 14px 0; color: var(--ink-soft); word-break: keep-all; overflow-wrap: anywhere; }
.manual ul, .manual ol { margin: 16px 0; padding-left: 1.45em; }
.manual li { margin: 7px 0; padding-left: .18em; overflow-wrap: anywhere; }
.manual li::marker { color: var(--forest); font-weight: 850; }
.manual strong { color: var(--ink); }
.project-reference { color: var(--ink-soft); }
.table-scroll { max-width: 100%; margin: 22px 0; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
table { width: 100%; min-width: 590px; border-collapse: collapse; font-size: 14px; line-height: 1.55; }
th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
thead th { color: #fff; background: var(--forest); font-size: 12px; letter-spacing: .02em; }
tbody th { color: var(--ink); background: #f3f6ef; font-weight: 780; }
tbody tr:last-child > * { border-bottom: 0; }
tbody tr:nth-child(even) td { background: #fafaf7; }
.align-right { text-align: right; }
.align-center { text-align: center; }
.code-block { margin: 22px 0; overflow: hidden; border: 1px solid #263b35; border-radius: var(--radius-md); background: #0c1714; box-shadow: 0 12px 28px rgb(7 31 26 / .12); }
.code-block figcaption { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 10px 7px 16px; color: rgb(255 255 255 / .68); border-bottom: 1px solid rgb(255 255 255 / .1); font-family: var(--mono); font-size: 11px; font-weight: 700; }
.code-actions { display: flex; gap: 6px; }
.code-actions button { min-height: 44px; padding: 7px 12px; color: #fff; border: 1px solid rgb(255 255 255 / .2); border-radius: 8px; background: rgb(255 255 255 / .07); cursor: pointer; font-size: 11px; font-weight: 800; }
.code-actions button:hover { color: var(--forest-deep); background: var(--lime); }
.code-actions button:focus-visible { outline: 3px solid var(--lime); outline-offset: -4px; box-shadow: none; }
.code-block pre { margin: 0; padding: 20px; overflow: auto; color: #dcece5; background: transparent; font-size: 13px; line-height: 1.65; tab-size: 4; }
.code-block pre code { display: block; min-width: max-content; padding: 0; color: inherit; background: transparent; border-radius: 0; font-size: inherit; overflow-wrap: normal; }
.code-block.is-wrapped pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.code-block.is-wrapped pre code { min-width: 0; }
.checklist { padding: 0 !important; list-style: none; }
.check-item { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 12px !important; border: 1px solid var(--line); border-radius: 10px; background: #fafaf7; }
.check-box { width: 18px; height: 18px; margin-top: 5px; border: 2px solid var(--forest); border-radius: 4px; background: #fff; }
.check-box.is-checked { background: var(--forest); box-shadow: inset 0 0 0 3px #fff; }
.security-note { margin: 0; padding: 12px 0; color: var(--forest-deep); background: var(--lime); text-align: center; font-size: 13px; font-weight: 850; }
.toast { position: fixed; z-index: 80; right: 20px; bottom: 20px; padding: 11px 16px; color: #fff; border-radius: 10px; background: var(--forest-deep); box-shadow: var(--shadow); font-weight: 800; transform: translateY(130%); transition: transform 160ms ease; }
.toast.is-visible { transform: translateY(0); }
.footer { padding: 34px 0; color: rgb(255 255 255 / .68); background: var(--forest-deep); }
.footer__inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.footer strong { color: #fff; }
.footer p { margin: 4px 0 0; font-size: 12px; }
.footer a { color: var(--lime); }
@media (max-width: 880px) {
  .page { grid-template-columns: 1fr; gap: 20px; padding-top: 24px; }
  .toc { position: static; max-height: none; }
  .toc ol { columns: 2; column-gap: 20px; }
  .toc li { break-inside: avoid; }
  .manual { max-width: none; }
  .hero__inner { grid-template-columns: 1fr; }
  .fact-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .shell { width: min(calc(100% - 28px), var(--shell)); }
  .topbar__inner { min-height: 66px; }
  .brand__text small, .role-pill { display: none; }
  .role-link { min-height: 44px; padding-inline: 12px; }
  .hero { padding: 50px 0 54px; }
  .hero h1 { font-size: clamp(34px, 10vw, 48px); }
  .hero__copy { font-size: 16px; }
  .fact-list { grid-template-columns: 1fr; }
  .page { padding-bottom: 48px; }
  .toc ol { columns: 1; }
  .intro-card, .guide-section { padding: 22px 18px; border-radius: 20px; }
  .manual h2 { font-size: 28px; }
  .code-block { margin-inline: -4px; }
  .code-block pre { padding: 16px; font-size: 12px; }
  .footer__inner { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 400px) {
  .topbar__inner { gap: 10px; }
  .brand__mark { width: 35px; height: 35px; }
  .brand__text { display: none; }
  .role-link { padding-inline: 10px; font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
}
@media (prefers-contrast: more) {
  :root { --ink-soft: #34413d; --line: #9ba69f; }
}
@page { size: A4; margin: 14mm 13mm 16mm; }
@media print {
  :root { --ink: #000; --ink-soft: #222; --line: #aaa; }
  body { color: #000; background: #fff; font-size: 10pt; line-height: 1.5; }
  .topbar, .toc, .skip-link, .code-actions, .toast, .footer { display: none !important; }
  .shell { width: 100%; }
  .hero { padding: 0 0 8mm; color: #000; border-top: 4mm solid var(--forest); background: #fff; }
  .hero::after { display: none; }
  .hero__inner { display: block; }
  .eyebrow { margin-top: 5mm; color: var(--forest); }
  .hero h1 { max-width: none; color: #000; font-size: 27pt; }
  .hero__copy { max-width: none; margin-top: 3mm; color: #222; font-size: 11pt; }
  .fact-list { display: flex; flex-wrap: wrap; gap: 3mm; margin-top: 5mm; }
  .fact-list li { min-height: auto; padding: 1.5mm 3mm; color: #000; border: 1px solid #777; background: #fff; }
  .fact-list li::before { box-shadow: none; background: var(--forest); }
  .security-note { display: block; margin: 0 0 5mm; padding: 3mm; color: #000; border: 2px solid #333; background: #fff; text-align: left; }
  .security-note > span { display: none; }
  .page { display: block; padding: 0; }
  .manual { max-width: none; }
  .intro-card, .guide-section { margin: 0; padding: 6mm 0; border: 0; border-top: 1px solid #bbb; border-radius: 0; background: #fff; box-shadow: none; }
  .intro-card { border-top: 2px solid var(--forest); }
  .manual h2 { margin-bottom: 4mm; padding-bottom: 2mm; font-size: 18pt; break-after: avoid; }
  .manual h3 { margin-top: 6mm; font-size: 13pt; break-after: avoid; }
  .heading-anchor { display: none; }
  p, li { orphans: 3; widows: 3; }
  a { color: #000; text-decoration: underline; }
  code { color: #000; border: 1px solid #ccc; background: #f5f5f5; }
  .table-scroll { overflow: visible; border-color: #777; break-inside: auto; }
  table { min-width: 0; font-size: 8.2pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { padding: 2mm; border-color: #aaa; }
  thead th { color: #000; border-bottom: 2px solid #333; background: #e9e9e9; }
  tbody th, tbody tr:nth-child(even) td { background: #f7f7f7; }
  .code-block { margin: 4mm 0; border-color: #999; border-radius: 0; background: #fff; box-shadow: none; break-inside: avoid; }
  .code-block--long { break-inside: auto; }
  .code-block figcaption { min-height: auto; padding: 2mm 3mm; color: #000; border-color: #aaa; background: #eee; }
  .code-block pre { padding: 3mm; overflow: visible; color: #000; font-size: 7.8pt; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .code-block pre code { min-width: 0; color: #000; border: 0; background: transparent; }
  .check-item { break-inside: avoid; border-color: #aaa; background: #fff; }
  .check-box { border-color: #000; }
}
`;

const CLIENT_SCRIPT = String.raw`
(() => {
  "use strict";
  const toast = document.querySelector("[data-toast]");
  let toastTimer;
  function announce(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1600);
  }
  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // file:// 또는 권한 제한 환경에서는 아래 선택 기반 복사를 시도합니다.
      }
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy failed");
  }
  document.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest("[data-code-block]")?.querySelector("code");
      if (!code) return;
      try {
        await copyText(code.textContent || "");
        announce("코드를 복사했습니다.");
      } catch {
        announce("복사할 수 없습니다. 코드를 직접 선택해 주세요.");
      }
    });
  });
  document.querySelectorAll("[data-wrap-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const figure = button.closest("[data-code-block]");
      if (!figure) return;
      const wrapped = figure.classList.toggle("is-wrapped");
      button.setAttribute("aria-pressed", String(wrapped));
    });
  });
  const tocLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  const headingById = new Map(tocLinks.map((link) => [link.hash.slice(1), link]));
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      tocLinks.forEach((link) => link.removeAttribute("aria-current"));
      headingById.get(visible.target.id)?.setAttribute("aria-current", "location");
    }, { rootMargin: "-15% 0px -75% 0px" });
    document.querySelectorAll(".manual h2[id], .manual h3[id]").forEach((heading) => observer.observe(heading));
  }
})();
`;

function buildDocument(markdown, config) {
  const blocks = parseMarkdown(markdown, config);
  const content = renderContent(blocks, config);
  const toc = renderToc(blocks);
  const factItems = config.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("");
  const securityMessage = config.documentClass === "deployer"
    ? ".env · 딜러 secret · 원본 CSV는 사용자에게 전달하지 않습니다."
    : "API 키는 URL·소스 코드·Git·노트북 출력에 남기지 않습니다.";

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeAttribute(config.description)}">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(config.title)}</title>
  <style>${STYLES}</style>
</head>
<body class="guide guide--${config.documentClass}">
  <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
  <header class="topbar">
    <div class="shell topbar__inner">
      <a class="brand" href="#top" aria-label="AutoData Lab 설명서 맨 위로">
        <span class="brand__mark" aria-hidden="true">A</span>
        <span class="brand__text"><strong>AutoData Lab</strong><small>USED CAR COLLECTION CLASSROOM</small></span>
      </a>
      <nav class="role-nav" aria-label="역할별 설명서">
        <span class="role-pill" aria-current="page">${escapeHtml(config.role)}</span>
        <a class="role-link" href="${escapeAttribute(config.otherHref)}">${escapeHtml(config.otherLabel)}</a>
      </nav>
    </div>
  </header>
  <section class="hero" id="top">
    <div class="shell hero__inner">
      <div><p class="eyebrow">${escapeHtml(config.eyebrow)}</p><h1>${escapeHtml(config.title)}</h1><p class="hero__copy">${escapeHtml(config.heroCopy)}</p></div>
      <ul class="fact-list" aria-label="핵심 안내">${factItems}</ul>
    </div>
  </section>
  <p class="security-note"><span aria-hidden="true">●</span> ${escapeHtml(securityMessage)}</p>
  <div class="shell page">
    <aside class="toc"><details open><summary>문서 목차</summary><ol>${toc}</ol></details></aside>
    <main class="manual" id="main-content">${content.html}</main>
  </div>
  <footer class="footer"><div class="shell footer__inner"><div><strong>AutoData Lab</strong><p>로컬 수업망에서 사용하는 합성 중고차 수집 실습 서버</p></div><a href="${escapeAttribute(config.otherHref)}">${escapeHtml(config.otherLabel)} 보기 →</a></div></footer>
  <div class="toast" role="status" aria-live="polite" data-toast></div>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;

  return {
    html,
    blocks,
    tableCount: content.tableCount,
    codeCount: content.codeCount,
  };
}

function countMarkdown(markdown) {
  return {
    h1: (markdown.match(/^#\s+/gm) || []).length,
    h2: (markdown.match(/^##\s+/gm) || []).length,
    h3: (markdown.match(/^###\s+/gm) || []).length,
    code: (markdown.match(/^```[\w-]*\s*$/gm) || []).length / 2,
    tables: (markdown.match(/^\|\s*:?-{3,}/gm) || []).length,
    tasks: (markdown.match(/^\s*-\s+\[[ xX]\]\s+/gm) || []).length,
  };
}

function validateDocument(markdown, result, config) {
  const expected = countMarkdown(markdown);
  const actual = {
    h1: result.html.split("<h1>").length - 1,
    h2: result.html.split("<h2 ").length - 1,
    h3: result.html.split("<h3 ").length - 1,
    code: (result.html.match(/<figure class="code-block/g) || []).length,
    tables: (result.html.match(/<table>/g) || []).length,
    tasks: (result.html.match(/class="check-item"/g) || []).length,
  };
  for (const key of Object.keys(expected)) {
    if (expected[key] !== actual[key]) {
      throw new Error(`${config.output}: ${key} 개수 불일치 expected=${expected[key]}, actual=${actual[key]}`);
    }
  }
  for (const block of result.blocks.filter((item) => item.type === "code")) {
    const exactCode = `<code class="language-${escapeAttribute(block.language)}">${escapeHtml(block.value)}</code>`;
    if (!result.html.includes(exactCode)) {
      throw new Error(`${config.output}: ${block.language} 코드 원문이 보존되지 않음`);
    }
  }
  if (!result.html.includes('<html lang="ko">')) throw new Error(`${config.output}: lang 누락`);
  if (/<(?:link|img|iframe)\b|<script\s+src=/i.test(result.html)) throw new Error(`${config.output}: 외부 자산 참조 발견`);
  if (/href="[^"]+\.md(?:#|\")/i.test(result.html)) throw new Error(`${config.output}: Markdown 링크가 남아 있음`);
  const ids = [...result.html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error(`${config.output}: 중복 id 발견`);
  for (const match of result.html.matchAll(/class="toc-level-[23]"[^>]*><a href="#([^"]+)"/g)) {
    if (!ids.includes(match[1])) throw new Error(`${config.output}: 목차 대상 누락 ${match[1]}`);
  }
  if (config.documentClass === "user") {
    if (!result.html.includes("&lt;서버 주소&gt;/crawl-policy")) {
      throw new Error(`${config.output}: <서버 주소> 예시 이스케이프 누락`);
    }
    if (!result.html.includes("hyundai&amp;status=AVAILABLE&amp;page_size=100&amp;sort=price_asc")) {
      throw new Error(`${config.output}: 페이지네이션 URL의 & 이스케이프 누락`);
    }
  }
  return { expected, actual };
}

async function main() {
  // Generated pages execute this inline, so parse it during every build.
  new Function(CLIENT_SCRIPT);
  for (const config of GUIDE_CONFIGS) {
    const sourcePath = resolve(PROJECT_ROOT, config.source);
    const outputPath = resolve(PROJECT_ROOT, config.output);
    const markdown = await readFile(sourcePath, "utf8");
    const result = buildDocument(markdown, config);
    const validation = validateDocument(markdown, result, config);
    await writeFile(outputPath, result.html, "utf8");
    const bytes = Buffer.byteLength(result.html);
    console.log(`${config.output}: ${(bytes / 1024).toFixed(1)} KiB`, validation.actual);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
