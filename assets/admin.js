/* 관리자 결과 화면: 부문별 순위(심사위원 평균 기준), 심사위원별 점수, 심사의견, 제출 현황 */
(() => {
  "use strict";

  const common = window.EvalCommon;
  const { normalizeName, pointsFor, storage, escapeHtml, formatDateTime, api } = common;

  const PASSWORD_KEY = common.key("admin-password"); // 탭을 닫으면 지워지는 sessionStorage에만 보관
  const TAB_KEY = common.key("admin-tab");
  let config = null;      // 행사 설정: 결과를 불러올 때마다 시트의 최신 설정으로 바꾼다

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const session = {
    get(key) { try { return window.sessionStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window.sessionStorage.setItem(key, value); } catch (e) { /* 사용 불가 */ } },
    remove(key) { try { window.sessionStorage.removeItem(key); } catch (e) { /* 사용 불가 */ } }
  };

  let password = "";
  let report = null;      // 분석 결과 { types: [...] }
  let activeTab = storage.get(TAB_KEY);

  /* ── 계산 ─────────────────────────────────────────────────── */
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const fmt = (n) => (n == null ? "–" : (Math.round(n * 100) / 100).toFixed(2));
  const fmtScore = (n) => String(Math.round(n * 100) / 100); // 94.5처럼 필요한 자리까지만

  function analyzeType(type, ti, rawRows) {
    const t = config.types[type];
    const n = t.criteria.length;
    const rows = rawRows.map((r) => Object.assign({}, r, { judge: normalizeName(r.judge) }));
    const judges = [...new Set(rows.map((r) => r.judge))].sort((a, b) => a.localeCompare(b, "ko"));

    // 발표자는 이름으로 찾되, 같은 이름이 여러 부문에 있으면 부문 이름까지 맞춘다
    const nameCount = {};
    t.categories.forEach((cat) => cat.presenters.forEach((p) => { nameCount[p.name] = (nameCount[p.name] || 0) + 1; }));
    const matched = new Set();
    const invalid = [];

    const categories = t.categories.map((cat, ci) => {
      const items = cat.presenters.map((p) => {
        const evals = [];
        const skippedBy = [];
        const comments = [];
        rows.forEach((r, ri) => {
          if (r.presenter !== p.name || (nameCount[p.name] > 1 && r.category !== cat.label)) return;
          matched.add(ri);
          const comment = String(r.comment || "").trim();
          if (comment) comments.push({ judge: r.judge, text: comment });
          if (r.skipped) { skippedBy.push(r.judge); return; }
          const grades = (r.grades || []).slice(0, n).map((g) => String(g).trim().toUpperCase());
          if (grades.length < n || grades.some((g) => !config.grades.includes(g))) {
            invalid.push(`${r.judge} → ${p.name}`);
            return;
          }
          const points = t.criteria.map((c, i) => pointsFor(grades[i], c));
          evals.push({ judge: r.judge, grades, points, total: points.reduce((a, b) => a + b, 0) });
        });
        const count = evals.length;
        return {
          name: p.name, topic: p.topic || "", count, evals, skippedBy, comments,
          byJudge: Object.fromEntries(evals.map((e) => [e.judge, e])),
          critAvg: t.criteria.map((c, i) => (count ? mean(evals.map((e) => e.points[i])) : null)),
          avg: count ? mean(evals.map((e) => e.total)) : null,
          sum: count ? evals.reduce((a, e) => a + e.total, 0) : null
        };
      });
      rankItems(items);
      // 발표유형 이름은 시트에서 자유롭게 정하므로 화면 id에는 순번을 쓴다
      return { id: `t${ti}-${ci}`, type, typeLabel: t.label, label: cat.label, criteria: t.criteria, commentLabel: t.commentLabel || "의견", judges, items };
    });

    const submissions = judges.map((judge) => {
      const mine = rows.filter((r) => r.judge === judge);
      const times = mine.map((r) => r.time).filter(Boolean).sort();
      return {
        judge, time: times[times.length - 1] || "",
        evaluated: mine.filter((r) => !r.skipped).length,
        skipped: mine.filter((r) => r.skipped).length
      };
    });
    const unmatched = rows.filter((r, ri) => !matched.has(ri)).map((r) => `${r.judge} → ${r.presenter} (${r.category})`);

    return { type, label: t.label, categories, judges, submissions, unmatched, invalid };
  }

  // 평균 총점 내림차순. 동점은 같은 순위(1, 2, 2, 4 …), 평가가 없는 발표자는 순위 없음
  function rankItems(items) {
    const ranked = items.filter((it) => it.avg != null).sort((a, b) => b.avg - a.avg);
    ranked.forEach((it, idx) => {
      const prev = ranked[idx - 1];
      it.rank = prev && Math.abs(prev.avg - it.avg) < 1e-9 ? prev.rank : idx + 1;
    });
    ranked.forEach((it) => { it.tied = ranked.filter((o) => o.rank === it.rank).length > 1; });
    items.forEach((it) => { if (it.avg == null) { it.rank = null; it.tied = false; } });
    items.sort((a, b) => (a.rank == null ? Infinity : a.rank) - (b.rank == null ? Infinity : b.rank));
  }

  /* ── 화면 그리기 ──────────────────────────────────────────── */
  function render() {
    const tabs = [];
    report.types.forEach((tr) => tr.categories.forEach((cat) => tabs.push({ id: cat.id, type: tr.label, name: cat.label })));
    tabs.push({ id: "status", type: "현황", name: "제출 현황" });
    if (!tabs.some((t) => t.id === activeTab)) activeTab = tabs[0].id;

    $("#tabs").innerHTML = tabs.map((t) => `
      <button class="tab" role="tab" type="button" id="tab-${t.id}" data-tab="${t.id}"
        aria-controls="panel-${t.id}" aria-selected="${t.id === activeTab}" tabindex="${t.id === activeTab ? 0 : -1}">
        <span class="tab__type">${escapeHtml(t.type)}</span>
        <span class="tab__name">${escapeHtml(t.name)}</span>
      </button>`).join("");

    const panels = [];
    report.types.forEach((tr) => tr.categories.forEach((cat) => panels.push(categoryPanel(cat))));
    panels.push(statusPanel());
    $("#panels").innerHTML = panels.join("");
    selectTab(activeTab);
  }

  function categoryPanel(cat) {
    const full = cat.criteria.reduce((s, c) => s + c.max, 0);
    const evaluatedJudges = new Set(cat.items.flatMap((it) => it.evals.map((e) => e.judge)));
    const hasData = cat.items.some((it) => it.count > 0);

    const rankRows = cat.items.map((it) => `
      <tr>
        <td class="center">${it.rank == null ? '<span class="dash">–</span>'
          : `<span class="rank${it.rank === 1 ? " rank--1" : ""}">${it.rank}</span>${it.tied ? '<span class="tie">동점</span>' : ""}`}</td>
        <td class="name">${escapeHtml(it.name)}</td>
        <td class="topic">${escapeHtml(it.topic) || '<span class="dash">–</span>'}</td>
        <td class="num total">${fmt(it.avg)}</td>
        <td class="num">${it.sum == null ? "–" : fmtScore(it.sum)}</td>
        <td class="num">${it.count}명${it.skippedBy.length ? `<span class="sub-note">평가 안 함 ${it.skippedBy.length}</span>` : ""}</td>
        ${it.critAvg.map((v) => `<td class="num">${fmt(v)}</td>`).join("")}
      </tr>`).join("");

    const judgeHead = cat.judges.map((j) => `<th class="num">${escapeHtml(j)}</th>`).join("");
    const judgeRows = cat.items.map((it) => `
      <tr>
        <td class="name">${escapeHtml(it.name)}</td>
        ${cat.judges.map((j) => {
          const e = it.byJudge[j];
          if (e) return `<td class="num"><span class="total">${fmtScore(e.total)}</span><span class="grades-text">${e.grades.join(" ")}</span></td>`;
          if (it.skippedBy.includes(j)) return '<td class="num"><span class="dash small">평가 안 함</span></td>';
          return '<td class="num"><span class="dash">–</span></td>';
        }).join("")}
        <td class="num total">${fmt(it.avg)}</td>
      </tr>`).join("");

    const withComments = cat.items.filter((it) => it.comments.length);
    const comments = withComments.length
      ? `<div class="comments">${withComments.map((it) => `
          <div class="comments__item">
            <h3>${escapeHtml(it.name)}</h3>
            <ul class="comments__list">${it.comments.map((c) =>
              `<li><span class="by">${escapeHtml(c.judge)}</span>${escapeHtml(c.text)}</li>`).join("")}</ul>
          </div>`).join("")}</div>`
      : '<p class="empty">작성된 내용이 없습니다.</p>';

    return `
      <section class="panel" role="tabpanel" id="panel-${cat.id}" aria-labelledby="tab-${cat.id}" hidden>
        <h2 class="print-title">${escapeHtml(cat.typeLabel)} · ${escapeHtml(cat.label)}</h2>
        <div class="card panel__section">
          <div class="panel__heading">
            <h2>순위</h2>
            <p>심사위원 평균 총점 기준 · 만점 ${full}점 · 평가한 심사위원 ${evaluatedJudges.size}명</p>
          </div>
          ${hasData ? "" : '<p class="empty">아직 제출된 평가가 없습니다.</p>'}
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th class="center">순위</th><th>발표자</th><th>발표주제</th>
                  <th class="num">평균 총점<span class="max">/ ${full}</span></th>
                  <th class="num">합계<span class="max">참고</span></th>
                  <th class="num">평가 인원</th>
                  ${cat.criteria.map((c) => `<th class="num">${escapeHtml(c.label)}<span class="max">평균 / ${c.max}</span></th>`).join("")}
                </tr>
              </thead>
              <tbody>${rankRows}</tbody>
            </table>
          </div>
        </div>

        ${cat.judges.length ? `
        <div class="card panel__section">
          <div class="panel__heading">
            <h2>심사위원별 점수</h2>
            <p>숫자 아래 작은 글씨는 항목별 등급 (${cat.criteria.map((c) => escapeHtml(c.label)).join(" · ")})</p>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>발표자</th>${judgeHead}<th class="num">평균</th></tr></thead>
              <tbody>${judgeRows}</tbody>
            </table>
          </div>
        </div>` : ""}

        <div class="card panel__section">
          <div class="panel__heading"><h2>${escapeHtml(cat.commentLabel)}</h2></div>
          ${comments}
        </div>
      </section>`;
  }

  function statusPanel() {
    const sections = report.types.map((tr) => {
      const total = tr.categories.reduce((n, c) => n + c.items.length, 0);
      const table = tr.submissions.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>심사위원</th><th>마지막 제출</th><th class="num">평가</th><th class="num">평가 안 함</th></tr></thead>
            <tbody>${tr.submissions.map((s) => `
              <tr>
                <td class="name">${escapeHtml(s.judge)}</td>
                <td>${escapeHtml(formatDateTime(s.time))}</td>
                <td class="num">${s.evaluated} / ${total}</td>
                <td class="num">${s.skipped}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>` : '<p class="empty">아직 제출한 심사위원이 없습니다.</p>';

      const warnings = [];
      if (tr.unmatched.length) {
        warnings.push(`설정 파일 명단에 없는 발표자에 대한 응답 ${tr.unmatched.length}건은 순위 계산에서 빠졌습니다 (이름이 바뀌었는지 확인하세요): ${tr.unmatched.map(escapeHtml).join(", ")}`);
      }
      if (tr.invalid.length) {
        warnings.push(`등급이 비었거나 형식이 맞지 않는 응답 ${tr.invalid.length}건은 계산에서 빠졌습니다: ${tr.invalid.map(escapeHtml).join(", ")}`);
      }

      return `
        <div class="card panel__section">
          <div class="panel__heading">
            <h2>${escapeHtml(tr.label)}</h2>
            <p>제출한 심사위원 ${tr.submissions.length}명 · 발표자 ${total}명</p>
          </div>
          ${warnings.map((w) => `<p class="notice notice--warn" style="margin-bottom:12px">${w}</p>`).join("")}
          ${table}
        </div>`;
    }).join("");

    const judgeLink = common.pageLink("./");
    const notes = common.warnings.length ? `
        <div class="card panel__section">
          <div class="panel__heading"><h2>시트 설정에서 확인할 것</h2><p>잘못 적힌 줄은 빼고 보여 주고 있습니다</p></div>
          <ul class="warn-list">${common.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
        </div>` : "";

    return `
      <section class="panel" role="tabpanel" id="panel-status" aria-labelledby="tab-status" data-print="skip" hidden>
        <div class="card panel__section">
          <div class="panel__heading"><h2>심사위원 링크</h2><p>심사위원에게 이 주소를 보내거나 QR 코드로 만들어 두세요</p></div>
          <div class="copy-row">
            <input class="input" id="judge-link" readonly value="${escapeHtml(judgeLink)}">
            <button class="btn" type="button" id="copy-link-btn">복사</button>
          </div>
        </div>
        ${notes}
        ${sections}
        <p class="muted small no-print">같은 이름으로 다시 제출하면 이전 제출이 최신 내용으로 바뀝니다. 심사위원 이름이 조금이라도 다르게 입력되면(오타 등) 다른 심사위원으로 집계되니 확인하세요.</p>
      </section>`;
  }

  function selectTab(id) {
    activeTab = id;
    storage.set(TAB_KEY, id);
    $$(".tab").forEach((t) => {
      const on = t.dataset.tab === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$(".panel").forEach((p) => { p.hidden = p.id !== `panel-${id}`; });
  }

  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) selectTab(tab.dataset.tab);
  });

  $("#panels").addEventListener("click", (e) => {
    const btn = e.target.closest("#copy-link-btn");
    if (!btn) return;
    const input = $("#judge-link");
    const done = () => {
      btn.textContent = "복사됨";
      setTimeout(() => { btn.textContent = "복사"; }, 1500);
    };
    input.select();
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, () => { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  });

  $("#tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$(".tab");
    const i = tabs.findIndex((t) => t.dataset.tab === activeTab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
  });

  /* ── 불러오기 ─────────────────────────────────────────────── */
  async function load() {
    const btn = $("#refresh-btn");
    btn.disabled = true;
    btn.textContent = "불러오는 중…";
    try {
      const res = await api.fetchResults(password);
      config = common.setConfig(res.config, { warnings: res.warnings || [] });
      bindTitle();
      const data = res.data || {};
      report = { types: config.typeKeys.map((type, ti) => analyzeType(type, ti, data[type] || [])) };
      $("#loaded-at").textContent = `${formatDateTime(new Date())} 기준`;
      $("#login-form").hidden = true;
      $("#results").hidden = false;
      render();
      return true;
    } finally {
      btn.disabled = false;
      btn.textContent = "새로고침";
    }
  }

  async function tryLogin(pw, { silent = false } = {}) {
    password = pw;
    const errorEl = $("#login-error");
    const loginBtn = $("#login-btn");
    errorEl.hidden = true;
    loginBtn.disabled = true;
    try {
      await load();
      if (!api.isDemo) session.set(PASSWORD_KEY, pw);
    } catch (err) {
      session.remove(PASSWORD_KEY);
      $("#results").hidden = true;
      $("#login-form").hidden = false;
      if (!silent) showLoginError(err);
    } finally {
      loginBtn.disabled = false;
    }
  }

  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    tryLogin($("#password").value);
  });

  $("#refresh-btn").addEventListener("click", () => {
    load().catch((err) => alert(`불러오지 못했습니다: ${err.message}`));
  });

  $("#print-btn").addEventListener("click", () => window.print());

  $("#clear-demo-btn").addEventListener("click", () => {
    if (!confirm("이 브라우저에 저장된 테스트 제출 결과를 모두 지울까요?")) return;
    api.clearDemo();
    load();
  });

  /* ── CSV (엑셀에서 바로 열리도록 BOM 포함) ───────────────── */
  function toCsv() {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [];
    report.types.forEach((tr) => tr.categories.forEach((cat) => {
      const full = cat.criteria.reduce((s, c) => s + c.max, 0);
      lines.push([q(`${cat.typeLabel} - ${cat.label}`)].join(","));
      lines.push([
        "순위", "발표자", "발표주제", "평가 인원", "평가 안 함",
        ...cat.criteria.map((c) => `${c.label} 평균(/${c.max})`),
        `평균 총점(/${full})`, "합계",
        ...cat.judges.map((j) => `${j} 총점`),
        ...cat.judges.map((j) => `${j} 등급`)
      ].map(q).join(","));
      cat.items.forEach((it) => {
        lines.push([
          it.rank == null ? "" : `${it.rank}${it.tied ? " (동점)" : ""}`, it.name, it.topic, it.count, it.skippedBy.length,
          ...it.critAvg.map((v) => (v == null ? "" : fmt(v))),
          it.avg == null ? "" : fmt(it.avg), it.sum == null ? "" : fmtScore(it.sum),
          ...cat.judges.map((j) => (it.byJudge[j] ? fmtScore(it.byJudge[j].total) : it.skippedBy.includes(j) ? "평가 안 함" : "")),
          ...cat.judges.map((j) => (it.byJudge[j] ? it.byJudge[j].grades.join("") : ""))
        ].map(q).join(","));
      });
      lines.push("");
    }));
    return "﻿" + lines.join("\r\n");
  }

  $("#csv-btn").addEventListener("click", () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `심사결과_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function showLoginError(err) {
    const details = (err.details || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("");
    const errorEl = $("#login-error");
    errorEl.innerHTML = `${escapeHtml(err.message)}${details ? `<ul>${details}</ul>` : ""}`;
    errorEl.hidden = false;
  }

  function bindTitle() {
    if (!config) return;
    document.title = `심사 결과 · ${config.eventTitle}`;
    $$('[data-bind="event-title"]').forEach((el) => { el.textContent = config.eventTitle; });
  }

  /* ── 시작 ─────────────────────────────────────────────────── */
  $("#demo-banner").hidden = !api.isDemo;
  $("#clear-demo-btn").hidden = !api.isDemo;

  // 행사 이름을 먼저 받아 와서 로그인 화면에 보여 준다. 실패해도 로그인은 할 수 있다
  // (결과를 불러올 때 설정을 다시 받고, 문제가 있으면 그때 자세히 알려 준다).
  common.boot().then((c) => { config = c; bindTitle(); return true; }, (err) => { showLoginError(err); return false; }).then((booted) => {
    const saved = session.get(PASSWORD_KEY);
    if (api.isDemo) tryLogin("");
    else if (booted && saved) tryLogin(saved, { silent: true });
    else $("#login-form").hidden = false;
  });
})();
