/**
 * 발표 심사 평가 — 구글 시트 서버 (Google Apps Script)
 *
 * 시트 하나가 행사 하나입니다. [설정]·[평가항목]·[발표자] 탭을 고치면
 * 심사위원 화면과 관리자 화면에 바로 반영됩니다. 자세한 안내: APP_URL + "guide.html"
 *
 * 처음 한 번
 *   1. 구글 시트의 [확장 프로그램 → Apps Script]에 이 파일 내용을 붙여 넣고 저장
 *   2. 시트를 새로고침한 뒤 메뉴 [발표 심사 → 처음 설정] (샘플이 든 탭 3개가 생김)
 *   3. Apps Script의 [배포 → 새 배포 → 웹 앱] (실행: 나, 액세스: 모든 사용자)
 *   4. 배포 후 나오는 웹 앱 주소를 열면 심사위원 링크와 관리자 링크가 나옴
 *
 * 탭 구성
 *   - 설정 / 평가항목 / 발표자 : 주최 측이 고치는 탭
 *   - 응답_{발표유형}           : 심사위원 × 발표자마다 한 줄 (자동 생성, 최신 제출만)
 *   - 제출기록                  : 모든 제출 원본 (자동 생성, 다시 제출해 덮어쓴 내용도 남음)
 *
 * 시트에는 등급(A~E)만 저장합니다. 점수는 관리자 화면이 [평가항목] 탭의 점수표로 그때그때 계산합니다.
 */

/**
 * 권한은 이 코드가 붙어 있는 시트 하나에만 받습니다 (다른 드라이브 파일은 읽지 않음).
 * @OnlyCurrentDoc
 */

// 심사 화면이 올라가 있는 주소 (끝의 / 포함). 심사위원 링크와 관리자 링크를 만들 때 씁니다.
const APP_URL = "https://batlabresearch.github.io/present-eval/";

const TAB = { settings: "설정", criteria: "평가항목", presenters: "발표자", log: "제출기록" };
const RESPONSE_PREFIX = "응답_";
const FIXED_HEADERS = ["제출시각", "심사위원", "부문", "발표자", "발표주제", "평가여부"];
const SKIPPED = "평가 안 함";
const EVALUATED = "평가";
const DEFAULT_GRADES = ["A", "B", "C", "D", "E"];
const MAX_CRITERIA = 10;
const MAX_PRESENTERS = 200;

// [설정] 탭 왼쪽 칸의 이름 → 내부 이름 (왼쪽 칸 글자를 바꾸면 그 줄은 읽지 않습니다)
const SETTING_KEYS = {
  "행사명": "eventTitle",
  "관리자 비밀번호": "password",
  "큰 제목": "display",
  "큰 제목 둘째 줄": "displaySub",
  "기관명": "org",
  "기관 영문명": "orgEn",
  "의견 칸 이름": "commentLabel"
};

/* ── 웹 앱 ───────────────────────────────────────────────────── */

// 주소를 브라우저로 열면 심사위원 링크·관리자 링크 안내 페이지, ?action=config 이면 행사 설정(JSON)
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "config") return json_(configResponse_());
  const url = ScriptApp.getService().getUrl();
  rememberWebApp_(url);
  return HtmlService.createHtmlOutput(linksHtml_(url))
    .setTitle("발표 심사 — 링크")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad_request" });
  }
  try {
    if (req.action === "config") return json_(configResponse_());
    if (req.action === "submit") return json_(submit_(req));
    if (req.action === "results") return json_(results_(req));
    return json_({ ok: false, error: "bad_request" });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function configResponse_() {
  const built = loadConfig_(spreadsheet_());
  return built.ok
    ? { ok: true, config: built.config, warnings: built.warnings }
    : { ok: false, error: "config_invalid", messages: built.errors };
}

/* ── 심사위원 제출 ─────────────────────────────────────────────
 * 같은 심사위원·같은 발표유형으로 다시 제출하면 이전 줄을 지우고 새로 기록한다. */
function submit_(req) {
  const ss = spreadsheet_();
  const built = loadConfig_(ss);
  if (!built.ok) return { ok: false, error: "config_invalid", messages: built.errors };
  const type = built.config.types.filter((t) => t.label === req.type)[0];
  if (!type) return { ok: false, error: "unknown_type" };
  if (req.eventId && req.eventId !== built.config.eventId) return { ok: false, error: "event_changed" };

  const grades = built.config.grades;
  const judge = normalize_(req.judge);
  const criteria = Array.isArray(req.criteria) ? req.criteria.slice(0, MAX_CRITERIA).map((c) => text_(c, 100)) : [];
  const rows = Array.isArray(req.rows) ? req.rows.slice(0, MAX_PRESENTERS) : [];
  if (!judge || judge.length > 50 || !criteria.length || !rows.length) {
    return { ok: false, error: "bad_request" };
  }

  const now = new Date();
  const newRows = rows.map((r) => {
    const skipped = !!r.skipped;
    const picked = criteria.map((_, i) => {
      const g = r.grades && String(r.grades[i] || "").trim().toUpperCase();
      return !skipped && grades.indexOf(g) >= 0 ? g : "";
    });
    return [now, judge, text_(r.category, 100), text_(r.presenter, 50), text_(r.topic, 300), skipped ? SKIPPED : EVALUATED]
      .concat(picked, [text_(r.comment, 2000)])
      .map(cell_);
  });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: "busy" };
  try {
    const sheet = getSheet_(ss, responseSheetName_(type.label));
    const headers = FIXED_HEADERS.concat(criteria, ["의견"]);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);

    // 이 심사위원의 이전 제출 줄 삭제 (아래에서부터 지워야 줄 번호가 밀리지 않는다)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const judges = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let i = judges.length - 1; i >= 0; i--) {
        if (normalize_(unescape_(judges[i][0])) === judge) sheet.deleteRow(i + 2);
      }
    }
    const startRow = sheet.getLastRow() + 1;
    // 글자 칸은 '일반 텍스트' 서식으로 — "10/15" 같은 의견이 날짜·숫자로 바뀌지 않게
    sheet.getRange(startRow, 2, newRows.length, headers.length - 1).setNumberFormat("@");
    sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);

    const log = getSheet_(ss, TAB.log);
    if (log.getLastRow() === 0) {
      log.appendRow(["제출시각", "발표유형", "심사위원", "제출내용(JSON)"]);
      log.getRange(1, 1, 1, 4).setFontWeight("bold");
      log.setFrozenRows(1);
    }
    const raw = JSON.stringify({ eventId: built.config.eventId, criteria: criteria, rows: rows });
    log.appendRow([now, cell_(type.label), cell_(judge), cell_(raw.slice(0, 49000))]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, savedAt: now.toISOString() };
}

/* ── 관리자 결과 조회 ─────────────────────────────────────────── */
function results_(req) {
  const ss = spreadsheet_();
  const built = loadConfig_(ss);
  if (!built.password) return { ok: false, error: "password_not_set" };
  if (String(req.password || "") !== built.password) return { ok: false, error: "bad_password" };
  if (!built.ok) return { ok: false, error: "config_invalid", messages: built.errors };

  const data = {};
  built.config.types.forEach((type) => {
    data[type.label] = [];
    const sheet = ss.getSheetByName(responseSheetName_(type.label));
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    const header = values[0].filter((h) => h !== "");
    const criteriaCount = header.length - FIXED_HEADERS.length - 1;
    values.slice(1).forEach((row) => {
      if (!row[1]) return;
      data[type.label].push({
        time: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
        judge: unescape_(row[1]),
        category: unescape_(row[2]),
        presenter: unescape_(row[3]),
        topic: unescape_(row[4]),
        skipped: row[5] === SKIPPED,
        grades: row.slice(6, 6 + criteriaCount).map((g) => String(g)),
        comment: unescape_(row[6 + criteriaCount])
      });
    });
  });
  return { ok: true, data: data, config: built.config, warnings: built.warnings };
}

/* ── 행사 설정 읽기 ─────────────────────────────────────────────
 * [설정]·[평가항목]·[발표자] 탭을 읽어 화면에서 쓰는 설정으로 바꾼다.
 * 잘못 적힌 줄은 빼고 경고로 알려 준다 (행사 중 한 줄 실수로 화면 전체가 멈추지 않게). */
function loadConfig_(ss) {
  return buildConfig_(readTabs_(ss), eventId_(ss));
}

function readTabs_(ss) {
  const read = (name, display) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() === 0) return [];
    const range = sheet.getDataRange();
    return display ? range.getDisplayValues() : range.getValues();
  };
  // 설정·발표자는 보이는 글자 그대로 (13:00 같은 시각이 날짜 값으로 바뀌지 않게), 평가항목은 숫자 값으로
  return { settings: read(TAB.settings, true), criteria: read(TAB.criteria, false), presenters: read(TAB.presenters, true) };
}

function buildConfig_(tabs, eventId) {
  const errors = [];
  const warnings = [];

  const settings = {};
  (tabs.settings || []).forEach((r) => {
    const key = SETTING_KEYS[cellText_(r[0])];
    if (key) settings[key] = cellText_(r[1]);
  });

  const crit = tabs.criteria || [];
  const pres = tabs.presenters || [];
  if (!crit.length || !pres.length) {
    errors.push("[평가항목]·[발표자] 탭이 없거나 비어 있습니다. 시트 메뉴 [발표 심사 → 처음 설정]을 실행해 주세요.");
    return { ok: false, errors: errors, warnings: warnings, password: settings.password || "", config: null };
  }

  // 등급: [평가항목] 머리줄의 배점 오른쪽 칸들 (A, B, C, D, E …)
  const header = (crit[0] || []).map(cellText_);
  let grades = [];
  for (let i = 3; i < header.length && header[i]; i++) grades.push(header[i].toUpperCase());
  if (grades.length < 2 || new Set(grades).size !== grades.length) {
    if (grades.length) warnings.push("[평가항목] 머리줄의 등급 이름이 2개 미만이거나 겹쳐서 A~E를 씁니다.");
    grades = DEFAULT_GRADES.slice();
  }

  const types = [];
  const byLabel = {};
  crit.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const typeLabel = cellText_(r[0]).slice(0, 50);
    const label = cellText_(r[1]).slice(0, 100);
    if (!typeLabel && !label && cellText_(r[2]) === "") return;
    if (!typeLabel || !label) {
      warnings.push(`[평가항목] ${rowNo}행: 발표유형과 평가항목 이름을 모두 적어야 합니다. 이 줄은 뺐습니다.`);
      return;
    }
    const max = number_(r[2]);
    if (!(max > 0)) {
      warnings.push(`[평가항목] ${rowNo}행 '${label}': 배점이 0보다 큰 숫자가 아닙니다. 이 줄은 뺐습니다.`);
      return;
    }
    const points = {};
    grades.forEach((g, k) => {
      const raw = r[3 + k];
      const blank = raw === "" || raw == null;
      let value = blank ? null : number_(raw);
      if (!blank && value == null) warnings.push(`[평가항목] ${rowNo}행 '${label}': ${g} 점수가 숫자가 아니어서 자동 계산값을 씁니다.`);
      // 비워 두면 배점의 100·90·80·70·60 % …
      if (value == null) value = max * Math.max(0, 1 - 0.1 * k);
      points[g] = round4_(value);
    });

    let type = byLabel[typeLabel];
    if (!type) {
      type = byLabel[typeLabel] = { label: typeLabel, criteria: [], categories: [] };
      types.push(type);
    }
    if (type.criteria.some((c) => c.label === label)) {
      warnings.push(`[평가항목] ${rowNo}행: '${typeLabel}'에 '${label}' 항목이 이미 있습니다. 이 줄은 뺐습니다.`);
      return;
    }
    if (type.criteria.length >= MAX_CRITERIA) {
      warnings.push(`[평가항목] ${rowNo}행: 한 발표유형의 평가항목은 ${MAX_CRITERIA}개까지입니다. 이 줄은 뺐습니다.`);
      return;
    }
    type.criteria.push({ label: label, max: round4_(max), points: points });
  });

  // 발표자: 지도교수 칸의 머리글(예: 지도교수, 소속)이 화면에 그대로 나온다
  const pHeader = (pres[0] || []).map(cellText_);
  const advisorLabel = pHeader[4] || "";
  const counts = {};
  pres.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const cells = [0, 1, 2, 3, 4, 5].map((k) => cellText_(r[k]));
    if (cells.every((c) => !c)) return;
    let typeLabel = cells[0].slice(0, 50);
    const name = cells[2];
    if (!typeLabel && types.length === 1) typeLabel = types[0].label;
    const type = byLabel[typeLabel];
    if (!type) {
      warnings.push(`[발표자] ${rowNo}행 '${name || "이름 없음"}': 발표유형 '${typeLabel}'이(가) [평가항목] 탭에 없습니다. 이 줄은 뺐습니다.`);
      return;
    }
    if (!name) {
      warnings.push(`[발표자] ${rowNo}행: 이름이 비어 있습니다. 이 줄은 뺐습니다.`);
      return;
    }
    if (name.length > 50) {
      warnings.push(`[발표자] ${rowNo}행: 이름은 50자까지입니다. 이 줄은 뺐습니다.`);
      return;
    }
    const catLabel = (cells[1] || type.label).slice(0, 100);
    let cat = type.categories.filter((c) => c.label === catLabel)[0];
    if (!cat) {
      cat = { label: catLabel, presenters: [] };
      type.categories.push(cat);
    }
    if (cat.presenters.some((p) => p.name === name)) {
      warnings.push(`[발표자] ${rowNo}행: '${typeLabel} / ${catLabel}'에 '${name}'이(가) 이미 있습니다. 이 줄은 뺐습니다.`);
      return;
    }
    counts[typeLabel] = (counts[typeLabel] || 0) + 1;
    if (counts[typeLabel] > MAX_PRESENTERS) {
      warnings.push(`[발표자] ${rowNo}행: 한 발표유형의 발표자는 ${MAX_PRESENTERS}명까지입니다. 이 줄은 뺐습니다.`);
      return;
    }
    cat.presenters.push({ name: name, topic: cells[3].slice(0, 300), advisor: cells[4], time: cells[5] });
  });

  // 한 부문의 발표자가 모두 같은 시간이면 부문 시간으로 올린다 (포스터처럼 한 시간대에 다 같이 하는 경우)
  types.forEach((type) => type.categories.forEach((cat) => {
    const first = cat.presenters[0] && cat.presenters[0].time;
    if (cat.presenters.length > 1 && first && cat.presenters.every((p) => p.time === first)) {
      cat.time = first;
      cat.presenters.forEach((p) => { p.time = ""; });
    }
  }));

  types.forEach((type) => {
    if (!type.criteria.length) warnings.push(`'${type.label}': 평가항목이 없어서 심사위원 화면에 나오지 않습니다.`);
    else if (!type.categories.length) warnings.push(`'${type.label}': 발표자가 없어서 심사위원 화면에 나오지 않습니다.`);
  });
  const usable = types.filter((t) => t.criteria.length && t.categories.length);
  if (!usable.length) errors.push("평가항목과 발표자가 모두 있는 발표유형이 없습니다. [평가항목]과 [발표자] 탭의 발표유형 이름이 같은지 확인해 주세요.");
  if (!settings.eventTitle) warnings.push("[설정] 행사명이 비어 있습니다.");

  return {
    ok: !errors.length,
    errors: errors,
    warnings: warnings,
    password: settings.password || "",
    config: {
      eventId: eventId,
      eventTitle: settings.eventTitle || "발표 심사",
      hero: {
        org: settings.org || "",
        orgEn: settings.orgEn || "",
        display: settings.display || "",
        displaySub: settings.displaySub || ""
      },
      grades: grades,
      commentLabel: settings.commentLabel || "의견",
      advisorLabel: advisorLabel,
      types: usable
    }
  };
}

/* ── 시트 메뉴 ───────────────────────────────────────────────── */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("발표 심사")
    .addItem("처음 설정 (샘플 탭 만들기)", "setup")
    .addItem("설정 점검", "checkConfig")
    .addItem("심사 링크 보기", "showLinks")
    .addSeparator()
    .addItem("결과 보관하고 새 행사 시작", "archiveResults")
    .addToUi();
}

// [설정]·[평가항목]·[발표자] 탭을 샘플 내용으로 만든다. 이미 있는 탭은 건드리지 않는다.
function setup() {
  const ss = spreadsheet_();
  const sample = sampleTabs_();
  const made = [];
  [
    [TAB.settings, sample.settings, formatSettings_],
    [TAB.criteria, sample.criteria, formatCriteria_],
    [TAB.presenters, sample.presenters, formatPresenters_]
  ].forEach(([name, rows, format], i) => {
    if (ss.getSheetByName(name)) return;
    const sheet = ss.insertSheet(name, i);
    const width = Math.max.apply(null, rows.map((r) => r.length));
    const padded = rows.map((r) => r.concat(new Array(width - r.length).fill("")));
    if (name === TAB.presenters) sheet.getRange(1, 1, Math.max(padded.length, 300), width).setNumberFormat("@");
    sheet.getRange(1, 1, padded.length, width).setValues(padded);
    format(sheet, ss);
    made.push(name);
  });

  // 새 시트에 처음부터 있던 빈 탭(시트1)은 지운다
  ss.getSheets().forEach((sheet) => {
    if (/^(시트|Sheet)\d+$/.test(sheet.getName()) && sheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("EVENT_ID")) props.setProperty("EVENT_ID", newEventId_());
  const first = ss.getSheetByName(TAB.settings);
  if (first) ss.setActiveSheet(first);

  alert_(made.length
    ? `탭을 만들었습니다: ${made.join(", ")}\n\n샘플 내용을 우리 행사에 맞게 고치고, [설정] 탭에 관리자 비밀번호를 적어 주세요.\n그다음 Apps Script에서 [배포 → 새 배포 → 웹 앱]으로 배포하면 됩니다.`
    : "[설정]·[평가항목]·[발표자] 탭이 이미 있어서 바꾼 것이 없습니다.");
}

function checkConfig() {
  const built = loadConfig_(spreadsheet_());
  const lines = [];
  if (built.config) {
    lines.push(`행사명: ${built.config.eventTitle}`);
    lines.push(`등급: ${built.config.grades.join(" ")}`);
    built.config.types.forEach((t) => {
      const full = round4_(t.criteria.reduce((s, c) => s + c.max, 0));
      const people = t.categories.reduce((n, c) => n + c.presenters.length, 0);
      lines.push(`· ${t.label}: 평가항목 ${t.criteria.length}개(만점 ${full}점), 부문 ${t.categories.length}개, 발표자 ${people}명`);
    });
  }
  if (!built.password) built.warnings.unshift("[설정] 관리자 비밀번호가 비어 있어서 결과를 볼 수 없습니다.");
  if (built.errors.length) lines.push("", "오류 (심사위원 화면이 열리지 않습니다)", ...built.errors.map((m) => `- ${m}`));
  if (built.warnings.length) lines.push("", "확인할 것", ...built.warnings.map((m) => `- ${m}`));
  if (!built.errors.length && !built.warnings.length) lines.push("", "문제가 없습니다.");
  alert_(lines.join("\n"));
}

function showLinks() {
  const html = HtmlService.createHtmlOutput(linksHtml_(webAppUrl_())).setWidth(600).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, "심사 링크");
}

// 응답 탭과 제출기록 탭의 이름을 '보관…'으로 바꿔 두고 새 행사를 시작한다
function archiveResults() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    "결과 보관하고 새 행사 시작",
    "응답 탭과 제출기록 탭의 이름을 '보관 날짜 …'로 바꿔 보관하고, 새 행사를 시작합니다.\n" +
    "설정·평가항목·발표자 탭은 그대로 남으니 다음 행사에 맞게 고치면 됩니다. 심사위원 링크도 그대로 씁니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert("다른 제출을 처리 중입니다. 잠시 후 다시 해 주세요."); return; }
  try {
    const ss = spreadsheet_();
    const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyMMdd-HHmm");
    let count = 0;
    ss.getSheets().forEach((sheet) => {
      const name = sheet.getName();
      if (name.indexOf(RESPONSE_PREFIX) === 0 || name === TAB.log) {
        sheet.setName(`보관${stamp} ${name}`.slice(0, 100));
        count++;
      }
    });
    // 행사 번호를 바꾸면 심사위원 기기에 남은 이전 행사의 작성 내용이 새 행사와 섞이지 않는다
    PropertiesService.getScriptProperties().setProperty("EVENT_ID", newEventId_());
    ui.alert(count ? `탭 ${count}개를 보관했습니다. 새 행사를 시작할 수 있습니다.` : "보관할 응답이 없어서 행사 번호만 새로 정했습니다.");
  } finally {
    lock.releaseLock();
  }
}

/* ── 링크 안내 페이지 ────────────────────────────────────────── */
function linksHtml_(url) {
  const m = /\/s\/([A-Za-z0-9_-]+)\/(exec|dev)\b/.exec(url || "");
  let built = null;
  try { built = loadConfig_(spreadsheet_()); } catch (e) { /* 아래에서 안내 */ }

  const parts = [];
  if (built && built.config) parts.push(`<p class="event">${esc_(built.config.eventTitle)}</p>`);
  parts.push("<h1>심사 링크</h1>");
  if (!m) {
    parts.push('<p class="warn">웹 앱 주소를 찾지 못했습니다. Apps Script에서 [배포 → 새 배포 → 웹 앱]으로 배포한 뒤, 배포가 끝나면 나오는 웹 앱 주소를 한 번 열어 주세요.</p>');
  } else {
    if (m[2] === "dev") parts.push('<p class="warn">지금 주소는 테스트용(/dev)입니다. 심사위원은 열 수 없습니다. [배포 → 새 배포]로 만든 /exec 주소를 열어 주세요.</p>');
    const judge = `${APP_URL}?s=${m[1]}`;
    const admin = `${APP_URL}admin.html?s=${m[1]}`;
    parts.push(linkBox_("심사위원 링크", "심사위원에게 보내거나 QR 코드로 만들어 붙여 두세요.", judge));
    parts.push(linkBox_("관리자 링크", "결과를 보는 화면입니다. [설정] 탭의 관리자 비밀번호로 들어갑니다. 공유하지 마세요.", admin));
  }

  const notes = [];
  if (built) {
    if (!built.password) notes.push("[설정] 관리자 비밀번호가 비어 있어서 결과를 볼 수 없습니다.");
    notes.push(...built.errors, ...built.warnings);
  } else {
    notes.push("시트를 읽지 못했습니다. [발표 심사 → 처음 설정]을 실행했는지 확인해 주세요.");
  }
  if (notes.length) parts.push(`<h2>시트 설정에서 확인할 것</h2><ul>${notes.map((n) => `<li>${esc_(n)}</li>`).join("")}</ul>`);

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;padding:24px 20px 32px;background:#f3f1ea;color:#0c1a36;font:15px/1.55 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;word-break:keep-all}
    .event{margin:0;font-size:13px;font-weight:600;color:#0a78a8}
    h1{margin:2px 0 18px;font-size:24px;padding-bottom:8px;border-bottom:3px solid #0c1a36}
    h2{margin:24px 0 8px;font-size:16px}
    .box{margin:0 0 14px;padding:14px;background:#fbfaf6;border:1px solid #d9d5ca;border-top:2px solid #0c1a36}
    .box b{display:block;font-size:15px}.box p{margin:2px 0 10px;font-size:13px;color:#4b5363}
    .row{display:flex;flex-wrap:wrap;gap:6px}
    input{flex:1 1 240px;min-width:0;height:40px;padding:0 10px;border:1px solid #b9b4a8;border-radius:0;background:#fff;font:13px Consolas,monospace;color:#0c1a36}
    button,a.btn{display:inline-flex;align-items:center;height:40px;padding:0 14px;border:1px solid #0c1a36;border-radius:0;background:#0c1a36;color:#fbfaf6;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
    a.btn{background:transparent;color:#0c1a36}
    .warn{padding:10px 12px;border-left:3px solid #cf4a0f;background:rgba(207,74,15,.09)}
    ul{margin:0;padding-left:18px;font-size:14px}
  </style></head><body>${parts.join("")}<script>
    document.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-copy]"); if (!b) return;
      var input = b.parentNode.querySelector("input"); input.select();
      var done = function () { b.textContent = "복사됨"; setTimeout(function () { b.textContent = "복사"; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { document.execCommand("copy"); done(); });
      else { document.execCommand("copy"); done(); }
    });
  </script></body></html>`;
}

function linkBox_(title, desc, url) {
  return `<div class="box"><b>${esc_(title)}</b><p>${esc_(desc)}</p><div class="row">` +
    `<input readonly value="${esc_(url)}" onfocus="this.select()"><button type="button" data-copy>복사</button>` +
    `<a class="btn" href="${esc_(url)}">열기</a></div></div>`;
}

// 웹 앱 주소: 웹 앱 안에서는 그 주소, 시트 메뉴에서는 마지막으로 연 웹 앱 주소 (이 스크립트 것일 때만)
function webAppUrl_() {
  let url = "";
  try { url = ScriptApp.getService().getUrl() || ""; } catch (e) { /* 배포 전 */ }
  if (/\/exec$/.test(url)) return url;
  try {
    const saved = JSON.parse(PropertiesService.getScriptProperties().getProperty("WEB_APP") || "null");
    if (saved && saved.scriptId === ScriptApp.getScriptId()) return saved.url;
  } catch (e) { /* 저장된 주소 없음 */ }
  return url;
}

function rememberWebApp_(url) {
  if (!/\/exec$/.test(url || "")) return;
  PropertiesService.getScriptProperties().setProperty("WEB_APP", JSON.stringify({ scriptId: ScriptApp.getScriptId(), url: url }));
}

/* ── 샘플 탭 ─────────────────────────────────────────────────── */
function sampleTabs_() {
  return {
    settings: [
      ["항목", "값", "설명"],
      ["행사명", "2026 OO 학술대회", "화면 곳곳과 결과표 제목에 나옵니다"],
      ["관리자 비밀번호", "", "결과(관리자 화면)를 볼 때 쓰는 비밀번호. 꼭 정해 주세요"],
      ["큰 제목", "2026", "첫 화면의 큰 글씨. 짧을수록 크게 보입니다 (예: DTM)"],
      ["큰 제목 둘째 줄", "ACADEMIC FESTIVAL", "큰 글씨 아래 줄. 비우면 나오지 않습니다"],
      ["기관명", "OO대학교 OO학과", "첫 화면 오른쪽 위. 비우면 나오지 않습니다"],
      ["기관 영문명", "Department of Sample Studies", "단어마다 줄을 바꾸고 첫 글자를 강조합니다. 비우면 나오지 않습니다"],
      ["의견 칸 이름", "심사의견", "발표자마다 자유롭게 쓰는 칸의 이름"]
    ],
    criteria: [
      ["발표유형", "평가항목", "배점", "A", "B", "C", "D", "E"],
      ["구두발표", "연구내용의 창의성 및 우수성", 30],
      ["구두발표", "구연능력", 30],
      ["구두발표", "주제 선정의 명확성", 20],
      ["구두발표", "발표자료", 10],
      ["구두발표", "질의 응답", 10],
      ["포스터발표", "구성", 20],
      ["포스터발표", "내용", 45],
      ["포스터발표", "포스터 완성도", 20],
      ["포스터발표", "질의응답", 15]
    ],
    presenters: [
      ["발표유형", "부문", "이름", "발표주제", "지도교수", "발표시간"],
      ["구두발표", "신진연구자 부문", "김하늘", "딥러닝을 이용한 흉부 X선 영상의 이상 소견 검출", "박지훈", "13:00 - 13:15"],
      ["구두발표", "신진연구자 부문", "이도윤", "웨어러블 센서 기반 보행 패턴 분석\nGait Pattern Analysis Using Wearable Sensors", "최서연", "13:15 - 13:30"],
      ["구두발표", "신진연구자 부문", "박서준", "전자의무기록을 이용한 입원 기간 예측 모델", "정우성", "13:30 - 13:45"],
      ["구두발표", "우수연구 부문", "최지우", "하이드로겔 마이크로니들을 이용한 국소 약물 전달", "한예슬", "14:00 - 14:20"],
      ["구두발표", "우수연구 부문", "정민서", "대규모 언어모델을 활용한 임상 기록 요약", "박지훈", "14:20 - 14:40"],
      ["포스터발표", "포스터 세션", "한예린", "심전도 신호의 자기지도 사전학습", "정우성", "11:00 - 12:00"],
      ["포스터발표", "포스터 세션", "오승현", "공간 단백체 분석으로 본 신장 손상 모델", "한예슬", "11:00 - 12:00"],
      ["포스터발표", "포스터 세션", "강다은", "증강현실 기반 수술 내비게이션의 정확도 평가", "최서연", "11:00 - 12:00"],
      ["포스터발표", "포스터 세션", "윤시우", "안저 영상을 이용한 당뇨병 발생 예측", "박지훈", "11:00 - 12:00"],
      ["포스터발표", "포스터 세션", "장하린", "피부 부착형 바이오센서의 장기 안정성", "정우성", "11:00 - 12:00"],
      ["포스터발표", "포스터 세션", "임준호", "자연어 질의를 SQL로 바꾸는 임상 데이터 검색 도구", "한예슬", "11:00 - 12:00"]
    ]
  };
}

function formatSettings_(sheet) {
  sheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#e9e6dc");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 460);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setFontWeight("bold");
  sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).setFontColor("#80868f");
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat("@");
  sheet.getRange("A:A").protect().setWarningOnly(true).setDescription("왼쪽 칸 이름을 바꾸면 그 설정을 읽지 못합니다");
}

function formatCriteria_(sheet) {
  const last = sheet.getLastRow();
  // A~E 칸: 배점에 비율을 곱하는 수식. 직접 숫자를 적어도 되고, 비워 두면 같은 비율로 자동 계산
  const formulas = [];
  for (let r = 2; r <= last; r++) formulas.push([`=$C${r}`, `=$C${r}*0.9`, `=$C${r}*0.8`, `=$C${r}*0.7`, `=$C${r}*0.6`]);
  if (formulas.length) sheet.getRange(2, 4, formulas.length, 5).setFormulas(formulas);
  sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#e9e6dc");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 260);
  [3, 4, 5, 6, 7, 8].forEach((c) => sheet.setColumnWidth(c, 64));
  sheet.getRange("A1").setNote("같은 발표유형 이름끼리 묶입니다. [발표자] 탭의 발표유형과 글자가 같아야 합니다.");
  sheet.getRange("B1").setNote("심사위원 화면에 위에서부터 이 순서로 나옵니다. 심사가 시작된 뒤에는 순서와 개수를 바꾸지 마세요.");
  sheet.getRange("D1").setNote("등급별 점수. 비워 두면 배점의 100·90·80·70·60%로 계산합니다.\n등급 이름을 바꾸려면 이 줄의 머리글(A, B, C, D, E)을 고치세요.");
}

function formatPresenters_(sheet, ss) {
  sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e9e6dc");
  sheet.setFrozenRows(1);
  [110, 160, 90, 420, 100, 120].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.getRange(2, 4, Math.max(sheet.getMaxRows() - 1, 1), 1).setWrap(true);
  sheet.getRange("B1").setNote("순위는 부문마다 따로 매깁니다. 비워 두면 발표유형 이름을 부문으로 씁니다.");
  sheet.getRange("C1").setNote("심사가 시작된 뒤에는 이름을 바꾸지 마세요. 제출된 결과를 이름으로 맞춥니다.");
  sheet.getRange("D1").setNote("Alt+Enter로 줄을 바꾸면 화면에서도 줄이 바뀝니다 (국문·영문 제목을 두 줄로).");
  sheet.getRange("E1").setNote("주최 측 참고용 칸입니다. 심사 화면에는 나오지 않습니다. 비워 두어도 됩니다.");
  sheet.getRange("F1").setNote("주최 측 참고용 칸입니다 (예: 13:00 - 13:20). 심사 화면에는 나오지 않습니다.");
  const criteria = ss.getSheetByName(TAB.criteria);
  if (criteria) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInRange(criteria.getRange("A2:A"), true).setAllowInvalid(true).build();
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }
}

/* ── 도우미 ──────────────────────────────────────────────────── */
// 이 코드가 붙어 있는 시트 (웹 앱으로 불려도 같은 시트)
function spreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function responseSheetName_(typeLabel) {
  return RESPONSE_PREFIX + String(typeLabel).replace(/[\[\]*?\/\\:]/g, " ").slice(0, 90);
}

function eventId_(ss) {
  return PropertiesService.getScriptProperties().getProperty("EVENT_ID") || ss.getId().slice(-10);
}

function newEventId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 10);
}

function alert_(message) {
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { Logger.log(message); }   // 편집기에서 실행하면 로그로
}

function cellText_(value) {
  return String(value == null ? "" : value).trim();
}

// "30", 30, "30점" → 30. 숫자가 없으면 null
function number_(value) {
  if (typeof value === "number") return isFinite(value) ? value : null;
  const m = /-?\d+(?:\.\d+)?/.exec(String(value == null ? "" : value).replace(/,/g, ""));
  return m ? Number(m[0]) : null;
}

function round4_(n) {
  return Math.round(n * 10000) / 10000;
}

function normalize_(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function text_(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

// =, +, -, @ 로 시작하는 글이 수식으로 실행되지 않도록 앞에 ' 를 붙인다
function cell_(value) {
  return typeof value === "string" && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function unescape_(value) {
  const s = String(value == null ? "" : value);
  return s.charAt(0) === "'" && /^[=+\-@]/.test(s.slice(1)) ? s.slice(1) : s;
}

function esc_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
