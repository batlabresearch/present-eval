/* 심사위원 화면과 관리자 화면이 함께 쓰는 기능: 시트 연결, 행사 설정 불러오기, 점수 환산, 저장소, 서버 통신 */
(() => {
  "use strict";

  const site = window.EVAL_SITE || {};
  const REQUEST_TIMEOUT_MS = 30000;
  const ID_RE = /^[A-Za-z0-9_-]{20,200}$/;

  /* ── 어느 시트와 연결할지 ─────────────────────────────────────
   * 링크의 ?s= 에 Apps Script 배포 ID가 있으면 그 시트의 행사, 없으면 샘플 행사(테스트 모드).
   * 저장소 이름에 배포 ID를 넣어서, 한 기기로 여러 행사를 심사해도 서로 섞이지 않게 한다. */
  const linkId = (new URLSearchParams(window.location.search).get("s") || "").trim();
  const fallbackId = String(site.defaultScriptId || "").trim();
  const scriptId = ID_RE.test(linkId) ? linkId : (!linkId && ID_RE.test(fallbackId) ? fallbackId : "");
  const badLink = !!linkId && !scriptId;
  const isDemo = !scriptId && !badLink;
  const serverUrl = scriptId ? `https://script.google.com/macros/s/${scriptId}/exec` : "";
  const NS = `peval:v1:${scriptId || "demo"}`;

  const normalizeName = (name) => String(name || "").replace(/\s+/g, " ").trim();

  // 등급 → 점수: 평가항목마다 시트 [평가항목] 탭의 점수표를 따른다
  function pointsFor(grade, criterion) {
    const value = criterion.points && criterion.points[grade];
    return typeof value === "number" ? value : 0;
  }

  const presenterCount = (type) =>
    common.config.types[type].categories.reduce((n, cat) => n + cat.presenters.length, 0);

  // localStorage는 사생활 보호 모드 등에서 막힐 수 있으므로 항상 감싸서 쓴다
  const storage = {
    get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) {
      try { window.localStorage.removeItem(key); } catch (e) { /* 저장소 사용 불가 */ }
    }
  };

  // 저장소 이름: key는 시트마다, eventKey는 행사마다 (시트에서 [새 행사 시작]을 하면 바뀜)
  const key = (name) => `${NS}:${name}`;
  const eventKey = (name) => `${NS}:${(common.config && common.config.eventId) || "-"}:${name}`;
  const DEMO_KEY = key("demo-store");
  const CONFIG_CACHE_KEY = key("config");

  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function formatDateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value || "");
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 같은 시트에 연결된 다른 화면 주소 (예: 관리자 화면에서 심사위원 링크 만들기)
  function pageLink(path) {
    const url = new URL(path, window.location.href);
    url.search = scriptId ? `?s=${scriptId}` : "";
    url.hash = "";
    return url.href;
  }

  /* ── 행사 설정 ───────────────────────────────────────────────
   * 시트가 준 설정을 화면에서 쓰는 모양으로 바꾼다. 발표유형은 이름으로 찾고, 순서는 typeKeys를 따른다. */
  function setConfig(raw, { warnings = [], fromCache = false } = {}) {
    const types = {};
    const typeKeys = [];
    (raw.types || []).forEach((t) => {
      types[t.label] = Object.assign({ commentLabel: raw.commentLabel || "의견" }, t);
      typeKeys.push(t.label);
    });
    common.config = Object.assign({}, raw, { types, typeKeys });
    common.warnings = warnings;
    common.fromCache = fromCache;
    return common.config;
  }

  // 시작할 때 한 번: 시트에서 행사 설정을 받아 온다. 연결이 안 되면 이 기기에 마지막으로 받은 설정을 쓴다.
  async function boot() {
    if (badLink) throw new Error("링크 주소가 올바르지 않습니다. 주최 측이 보낸 링크를 그대로 열어 주세요.");
    if (isDemo) return setConfig(window.EVAL_SAMPLE);
    try {
      const res = await postToServer({ action: "config" });
      storage.set(CONFIG_CACHE_KEY, res.config);
      return setConfig(res.config, { warnings: res.warnings || [] });
    } catch (err) {
      const cached = storage.get(CONFIG_CACHE_KEY);
      if (!cached || err.code) throw err;   // 서버가 답한 오류(설정 오류 등)는 그대로 보여 준다
      return setConfig(cached, { fromCache: true });
    }
  }

  /* ── 서버 통신 ───────────────────────────────────────────────
   * 시트와 연결되어 있으면 구글 Apps Script로, 아니면(샘플 행사) 이 브라우저의
   * localStorage에 서버와 같은 형식으로 저장하는 테스트 모드로 동작한다. */
  const SERVER_ERRORS = {
    bad_password: "관리자 비밀번호가 틀렸습니다.",
    password_not_set: "시트의 [설정] 탭에 관리자 비밀번호를 먼저 적어 주세요.",
    bad_request: "요청 형식이 올바르지 않습니다.",
    busy: "다른 제출을 처리 중입니다. 잠시 후 다시 시도해 주세요.",
    config_invalid: "시트의 행사 설정에 문제가 있어서 열 수 없습니다. 주최 측에 알려 주세요.",
    unknown_type: "이 발표유형이 시트에서 바뀌었거나 지워졌습니다. 페이지를 새로고침해 주세요.",
    event_changed: "주최 측이 새 행사를 시작해서 이 화면으로는 제출할 수 없습니다. 페이지를 새로고침해 주세요."
  };

  async function postToServer(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // text/plain으로 보내야 브라우저가 사전 요청(CORS preflight)을 하지 않는다
      const res = await fetch(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (res.status === 404) throw new Error("연결된 시트를 찾지 못했습니다. 링크가 맞는지 주최 측에 확인해 주세요.");
      if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
      const data = await res.json();
      if (!data || data.ok !== true) {
        const code = (data && data.error) || "unknown";
        const err = new Error(SERVER_ERRORS[code] || `서버 오류: ${code}`);
        err.code = code;
        err.details = (data && data.messages) || [];
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("서버 응답이 너무 늦습니다. 네트워크를 확인해 주세요.");
      if (err instanceof TypeError) throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
      if (err instanceof SyntaxError) throw new Error("서버 응답을 읽지 못했습니다. 시트의 웹 앱 배포를 확인해 주세요.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // 테스트 모드: 서버와 같은 규칙(같은 심사위원의 이전 제출은 덮어쓰기)으로 브라우저에 저장
  function demoSubmit(payload) {
    const store = storage.get(DEMO_KEY) || {};
    const judge = normalizeName(payload.judge);
    const now = new Date().toISOString();
    const kept = (store[payload.type] || []).filter((r) => normalizeName(r.judge) !== judge);
    payload.rows.forEach((r) => {
      kept.push({
        time: now, judge, category: r.category, presenter: r.presenter, topic: r.topic,
        skipped: !!r.skipped, grades: r.grades.slice(), comment: r.comment || ""
      });
    });
    store[payload.type] = kept;
    if (!storage.set(DEMO_KEY, store)) return Promise.reject(new Error("이 브라우저에 저장할 수 없습니다."));
    return Promise.resolve({ ok: true, savedAt: now });
  }

  const api = {
    isDemo,
    submit(payload) {
      const body = Object.assign({ action: "submit", eventId: common.config.eventId }, payload);
      return isDemo ? demoSubmit(body) : postToServer(body);
    },
    // 결과와 함께 최신 행사 설정도 받는다 (점수표를 고치면 바로 다시 계산되도록)
    fetchResults(password) {
      if (isDemo) {
        return Promise.resolve({ ok: true, data: storage.get(DEMO_KEY) || {}, config: window.EVAL_SAMPLE, warnings: [] });
      }
      return postToServer({ action: "results", password });
    },
    clearDemo() { storage.remove(DEMO_KEY); }
  };

  const common = {
    config: null, warnings: [], fromCache: false,
    scriptId, isDemo, boot, setConfig, pageLink, key, eventKey,
    normalizeName, pointsFor, presenterCount, storage, escapeHtml, formatDateTime, api
  };
  window.EvalCommon = common;
})();
