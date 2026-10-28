/* 심사위원 평가 화면 */
(() => {
  "use strict";

  const common = window.EvalCommon;
  const { normalizeName, storage, escapeHtml, formatDateTime, api, presenterCount } = common;

  const LAST_JUDGE_KEY = "peval:v1:last-judge";   // 이름은 행사가 달라도 미리 채워 준다
  const STATUS_LABEL = { done: "완료", partial: "작성 중", skipped: "평가 안 함", empty: "미평가" };
  let config = null;     // 시트에서 받아 온 행사 설정 (init에서 채움)
  let typeKeys = [];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const screens = { start: $("#screen-start"), eval: $("#screen-eval"), done: $("#screen-done") };

  let state = null;      // 현재 심사위원·발표유형의 입력 내용 (이 기기에 자동 저장)
  let presenters = [];   // 현재 발표유형의 발표자 목록 (부문 순서대로 펼친 것)
  let commentTimer = null;

  const draftKey = (type, judge) => common.eventKey(`draft:${type}:${normalizeName(judge)}`);
  const pad2 = (n) => String(n).padStart(2, "0");

  function flattenPresenters(type) {
    const list = [];
    config.types[type].categories.forEach((cat, ci) => {
      cat.presenters.forEach((p) => {
        list.push({
          key: `${cat.label}|${p.name}`, index: list.length, categoryIndex: ci,
          category: cat.label, name: p.name, topic: p.topic || ""
        });
      });
    });
    return list;
  }

  function loadState(type, judge) {
    const saved = storage.get(draftKey(type, judge));
    const criteriaCount = config.types[type].criteria.length;
    const entries = {};
    flattenPresenters(type).forEach((p) => {
      const prev = saved && saved.entries && saved.entries[p.key];
      const entry = { grades: new Array(criteriaCount).fill(null), skipped: false, comment: "" };
      if (prev) {
        entry.skipped = !!prev.skipped;
        entry.comment = typeof prev.comment === "string" ? prev.comment : "";
        // 평가항목 개수가 바뀐 경우 예전 등급은 버린다
        if (Array.isArray(prev.grades) && prev.grades.length === criteriaCount) {
          entry.grades = prev.grades.map((g) => (config.grades.includes(g) ? g : null));
        }
      }
      entries[p.key] = entry;
    });
    return {
      type, judge: normalizeName(judge), entries,
      submittedAt: (saved && saved.submittedAt) || null,
      updatedAt: (saved && saved.updatedAt) || null
    };
  }

  function entryStatus(entry) {
    if (entry.skipped) return "skipped";
    const filled = entry.grades.filter(Boolean).length;
    if (filled === entry.grades.length) return "done";
    if (filled > 0 || entry.comment.trim()) return "partial";
    return "empty";
  }

  const hasAnyInput = (s) => Object.values(s.entries).some((e) => entryStatus(e) !== "empty");

  function persist(touch = true) {
    if (touch) state.updatedAt = new Date().toISOString();
    const ok = storage.set(draftKey(state.type, state.judge), state);
    const status = $("#save-status");
    status.classList.toggle("is-error", !ok);
    status.textContent = ok
      ? (state.updatedAt ? `자동 저장 ${formatDateTime(state.updatedAt).split(" ")[1]}` : "")
      : "이 브라우저에서는 자동 저장이 되지 않습니다";
    updateResubmitNotice();
  }

  function updateResubmitNotice() {
    $("#resubmit-notice").hidden = !(state.submittedAt && state.updatedAt && state.updatedAt > state.submittedAt);
  }

  /* ── 화면 전환 ─────────────────────────────────────────────── */
  function showScreen(name, { push = false } = {}) {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    document.body.classList.toggle("is-stage", name !== "eval");
    if (push) history.pushState({ screen: name }, "");
    window.scrollTo(0, 0);
  }

  // 휴대폰 뒤로가기를 누르면 사이트를 벗어나지 않고 첫 화면으로 돌아간다
  // (발표 순서 목록이 열려 있으면 목록만 닫는다)
  window.addEventListener("popstate", () => {
    if (!scheduleEl.hidden) { hideSchedule(); return; }
    if (!screens.start.hidden) return;
    renderStart();
    showScreen("start");
  });

  /* ── 1. 첫 화면 ───────────────────────────────────────────── */
  function renderTypeChoices() {
    $("#type-choices").innerHTML = typeKeys.map((type, i) => {
      const t = config.types[type];
      const cats = t.categories.length;
      const meta = cats > 1 ? `${cats}개 부문 · ${presenterCount(type)}명` : `${presenterCount(type)}명`;
      return `
        <label class="type-row">
          <input type="radio" name="eval-type" value="${escapeHtml(type)}">
          <span class="type-row__no">${pad2(i + 1)}</span>
          <span>
            <span class="type-row__name">${escapeHtml(t.label)}</span>
            <span class="type-row__meta">${meta}</span>
          </span>
          <span class="type-row__mark" aria-hidden="true"></span>
        </label>`;
    }).join("");
  }

  const selectedType = () => {
    const checked = $('input[name="eval-type"]:checked');
    return checked ? checked.value : null;
  };

  function renderStart(prefill = {}) {
    document.title = `심사 평가 · ${config.eventTitle}`;
    const nameInput = $("#judge-name");
    if (prefill.judge != null) nameInput.value = prefill.judge;
    if (prefill.type) {
      // 발표유형 이름은 시트에서 자유롭게 정하므로 선택자 대신 값으로 찾는다
      const radio = $$('input[name="eval-type"]').find((r) => r.value === prefill.type);
      if (radio) radio.checked = true;
    }
    updateStartForm();
  }

  function updateStartForm() {
    const judge = normalizeName($("#judge-name").value);
    const type = selectedType();
    $("#start-btn").disabled = !(judge && type);

    const notice = $("#start-notice");
    notice.hidden = true;
    if (!judge || !type) return;
    const saved = storage.get(draftKey(type, judge));
    if (saved && saved.submittedAt) {
      notice.textContent = `${formatDateTime(saved.submittedAt)}에 제출한 ${config.types[type].label} 평가가 있습니다. 불러와서 수정하고 다시 제출할 수 있습니다.`;
      notice.hidden = false;
    } else if (saved && saved.entries && hasAnyInput(loadState(type, judge))) {
      notice.textContent = "작성하던 평가가 이 기기에 저장되어 있습니다. 이어서 진행합니다.";
      notice.hidden = false;
    }
  }

  $("#judge-name").addEventListener("input", updateStartForm);
  $("#type-choices").addEventListener("change", updateStartForm);
  $("#start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const judge = normalizeName($("#judge-name").value);
    const type = selectedType();
    if (!judge || !type) return;
    storage.set(LAST_JUDGE_KEY, judge);
    startEvaluation(type, judge);
  });

  /* ── 2. 평가 화면 ─────────────────────────────────────────── */
  function startEvaluation(type, judge) {
    presenters = flattenPresenters(type);
    state = loadState(type, judge);
    renderEval();
    showScreen("eval", { push: true });
  }

  function renderEval() {
    const t = config.types[state.type];
    document.title = `${t.label} 평가 · ${config.eventTitle}`;
    $("#eval-title").textContent = `${t.label} 심사표`;
    $("#eval-judge").textContent = `${state.judge} 심사위원`;

    const nav = $("#cat-nav");
    nav.hidden = t.categories.length < 2;
    nav.innerHTML = t.categories.map((cat, ci) =>
      `<a href="#cat-${ci}" data-cat="${ci}"><span class="no">${pad2(ci + 1)}</span>${escapeHtml(cat.label)}<span class="n"></span></a>`).join("");

    // 발표자 한 명당 한 칸짜리 진행 눈금 (누르면 그 발표자로 이동)
    $("#ticks").innerHTML = presenters.map((p) =>
      `<button type="button" class="tick" data-index="${p.index}" tabindex="-1" title="${escapeHtml(p.name)}"></button>`).join("");

    $("#eval-list").innerHTML = t.categories.map((cat, ci) => `
      <section class="cat-section" id="cat-${ci}">
        <h2 class="cat-title">
          <span class="cat-title__no">${pad2(ci + 1)}</span>
          <span class="cat-title__name">${escapeHtml(cat.label)}</span>
          <span class="cat-title__count">${cat.presenters.length}명</span>
        </h2>
        ${presenters.filter((p) => p.categoryIndex === ci).map((p) => presenterCard(p, t)).join("")}
      </section>`).join("");

    presenters.forEach(updateCard);
    updateProgress();
    persist(false);
  }

  function presenterCard(p, t) {
    const entry = state.entries[p.key];
    const criteria = t.criteria.map((c, ci) => {
      const labelId = `p${p.index}-c${ci}-label`;
      const options = config.grades.map((g) => `
        <label class="grade">
          <input type="radio" name="p${p.index}-c${ci}" value="${escapeHtml(g)}" data-ci="${ci}"${entry.grades[ci] === g ? " checked" : ""}>
          <span>${escapeHtml(g)}</span>
        </label>`).join("");
      return `
        <div class="crit" role="radiogroup" aria-labelledby="${labelId}">
          <div class="crit__label" id="${labelId}"><span>${escapeHtml(c.label)}</span><span class="crit__max">${c.max}점</span></div>
          <div class="grades">${options}</div>
        </div>`;
    }).join("");

    return `
      <article class="pcard" id="p-${p.index}" data-index="${p.index}">
        <header class="pcard__head">
          <span class="pcard__no">${pad2(p.index + 1)}</span>
          <div>
            <h3 class="pcard__name">${escapeHtml(p.name)}</h3>
            ${p.topic ? `<p class="pcard__topic">${escapeHtml(p.topic)}</p>` : ""}
          </div>
          <span class="state" data-role="status"></span>
        </header>
        <div class="pcard__body">
          ${criteria}
          <p class="skip-note">평가하지 않는 발표자입니다. 이 심사위원의 점수는 평균 계산에서 빠집니다.</p>
          <label class="comment">
            <span class="comment__label">${escapeHtml(t.commentLabel || "의견")} (선택)</span>
            <textarea data-role="comment" rows="2" maxlength="1000">${escapeHtml(entry.comment)}</textarea>
          </label>
        </div>
        <footer class="pcard__foot">
          <button type="button" class="link-btn" data-action="clear">선택 초기화</button>
          <button type="button" class="check-btn" data-action="skip" aria-pressed="false"><span class="check-btn__box" aria-hidden="true"></span>평가 안 함</button>
        </footer>
      </article>`;
  }

  function updateCard(p) {
    const card = $(`#p-${p.index}`);
    const entry = state.entries[p.key];
    const status = entryStatus(entry);
    const label = $('[data-role="status"]', card);
    label.textContent = STATUS_LABEL[status];
    label.className = `state state--${status}`;
    card.classList.toggle("is-done", status === "done");
    card.classList.toggle("is-skipped", status === "skipped");
    if (status === "done" || status === "skipped") card.classList.remove("is-attention");
    $('[data-action="skip"]', card).setAttribute("aria-pressed", String(entry.skipped));
    $$('input[type="radio"]', card).forEach((input) => { input.disabled = entry.skipped; });
  }

  function updateProgress() {
    const finished = presenters.filter((p) => ["done", "skipped"].includes(entryStatus(state.entries[p.key]))).length;
    $("#progress-text").innerHTML = `<b>${finished}</b>/${presenters.length}`;
    $("#progress-text").setAttribute("aria-label", `${presenters.length}명 중 ${finished}명 완료`);
    $$("#ticks .tick").forEach((tick) => {
      tick.className = `tick tick--${entryStatus(state.entries[presenters[Number(tick.dataset.index)].key])}`;
    });

    $$("#cat-nav a").forEach((a) => {
      const ci = Number(a.dataset.cat);
      const inCat = presenters.filter((p) => p.categoryIndex === ci);
      const doneInCat = inCat.filter((p) => ["done", "skipped"].includes(entryStatus(state.entries[p.key]))).length;
      a.querySelector(".n").textContent = `${doneInCat}/${inCat.length}`;
      a.classList.toggle("is-complete", doneInCat === inCat.length);
    });
  }

  const presenterOf = (el) => {
    const card = el.closest(".pcard");
    return card ? presenters[Number(card.dataset.index)] : null;
  };

  const evalList = $("#eval-list");

  evalList.addEventListener("change", (e) => {
    const input = e.target;
    if (input.type !== "radio") return;
    const p = presenterOf(input);
    state.entries[p.key].grades[Number(input.dataset.ci)] = input.value;
    updateCard(p);
    updateProgress();
    persist();
  });

  evalList.addEventListener("input", (e) => {
    if (e.target.dataset.role !== "comment") return;
    const p = presenterOf(e.target);
    state.entries[p.key].comment = e.target.value;
    updateCard(p);
    updateProgress();
    clearTimeout(commentTimer);
    commentTimer = setTimeout(() => persist(), 400);
  });

  evalList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const p = presenterOf(btn);
    const entry = state.entries[p.key];
    if (btn.dataset.action === "skip") {
      entry.skipped = !entry.skipped;
    } else if (btn.dataset.action === "clear") {
      entry.grades = entry.grades.map(() => null);
      entry.skipped = false;
      $$('input[type="radio"]', $(`#p-${p.index}`)).forEach((input) => { input.checked = false; });
    }
    updateCard(p);
    updateProgress();
    persist();
  });

  // 부문 바로가기: 주소창에 #을 남기지 않고 부드럽게 이동
  $("#cat-nav").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    $(`#cat-${a.dataset.cat}`).scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#ticks").addEventListener("click", (e) => {
    const tick = e.target.closest(".tick");
    if (tick) $(`#p-${tick.dataset.index}`).scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function focusCard(p) {
    const card = $(`#p-${p.index}`);
    card.classList.add("is-attention");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── 제출 ─────────────────────────────────────────────────── */
  const nameList = (items) => `<ul>${items.map(({ p }) =>
    `<li><b>${escapeHtml(p.name)}</b> <span class="muted small">${escapeHtml(p.category)}</span></li>`).join("")}</ul>`;

  async function onSubmit() {
    clearTimeout(commentTimer);
    const t = config.types[state.type];
    const rows = presenters.map((p) => ({ p, status: entryStatus(state.entries[p.key]) }));
    const partial = rows.filter((r) => r.status === "partial");
    const done = rows.filter((r) => r.status === "done");
    const empty = rows.filter((r) => r.status === "empty");
    const skippedCount = rows.length - done.length;

    if (partial.length) {
      await showDialog({
        title: "평가가 끝나지 않은 발표자가 있습니다",
        body: `<p>아래 발표자의 모든 항목을 선택하거나, 평가하지 않을 경우 <b>평가 안 함</b>을 눌러 주세요.</p>${nameList(partial)}`,
        actions: [{ label: "확인", value: true, primary: true }]
      });
      partial.forEach((r) => $(`#p-${r.p.index}`).classList.add("is-attention"));
      focusCard(partial[0].p);
      return;
    }
    if (!done.length) {
      await showDialog({
        title: "평가한 발표자가 없습니다",
        body: "<p>한 명 이상 평가한 뒤 제출해 주세요.</p>",
        actions: [{ label: "확인", value: true, primary: true }]
      });
      return;
    }

    let body = `<p>평가 <b>${done.length}명</b>${skippedCount ? ` · 평가 안 함 <b>${skippedCount}명</b>` : ""}</p>`;
    if (empty.length) {
      body += `<div class="notice notice--warn">아직 평가하지 않은 발표자가 있습니다. <b>평가 안 함</b>으로 처리하고 제출합니다.${nameList(empty)}</div>`;
    }
    body += `<p class="muted small">제출한 뒤에도 같은 이름으로 다시 제출하면 최신 내용으로 바뀝니다.</p>`;

    const confirmed = await showDialog({
      title: `${t.label} 평가를 제출할까요?`,
      body,
      actions: [
        { label: "취소", value: false },
        { label: empty.length ? "평가 안 함으로 처리하고 제출" : "제출", value: true, primary: true }
      ]
    });
    if (!confirmed) return;

    empty.forEach(({ p }) => { state.entries[p.key].skipped = true; updateCard(p); });
    updateProgress();
    persist();

    const btn = $("#submit-btn");
    const btnLabel = btn.querySelector("span");
    btn.disabled = true;
    btnLabel.textContent = "제출 중…";
    try {
      const res = await api.submit(buildPayload());
      state.submittedAt = res.savedAt || new Date().toISOString();
      state.updatedAt = state.submittedAt;
      persist(false);
      showDone(done.length, skippedCount);
    } catch (err) {
      await showDialog({
        title: "제출하지 못했습니다",
        body: `<p>${escapeHtml(err.message)}</p><p class="muted small">입력한 내용은 이 기기에 저장되어 있으니, 잠시 후 다시 제출해 주세요.</p>`,
        actions: [{ label: "확인", value: true, primary: true }]
      });
    } finally {
      btn.disabled = false;
      btnLabel.textContent = "제출하기";
    }
  }

  function buildPayload() {
    const t = config.types[state.type];
    return {
      type: state.type,
      judge: state.judge,
      criteria: t.criteria.map((c) => c.label),
      rows: presenters.map((p) => {
        const entry = state.entries[p.key];
        const skipped = entryStatus(entry) !== "done";
        return {
          category: p.category, presenter: p.name, topic: p.topic, skipped,
          grades: skipped ? [] : entry.grades.slice(), comment: entry.comment.trim()
        };
      })
    };
  }

  $("#submit-btn").addEventListener("click", onSubmit);

  /* ── 3. 제출 완료 ─────────────────────────────────────────── */
  // 다음에 평가할 유형: 아직 제출하지 않은 유형을 먼저, 모두 제출했으면 바로 다음 유형
  function otherType() {
    const others = typeKeys.filter((k) => k !== state.type);
    const notYet = others.find((k) => {
      const saved = storage.get(draftKey(k, state.judge));
      return !(saved && saved.submittedAt);
    });
    return notYet || others[0];
  }

  function showDone(doneCount, skippedCount) {
    const t = config.types[state.type];
    const rows = [
      ["심사위원", state.judge],
      ["발표 유형", t.label],
      ["평가", `${doneCount}명`],
      ["평가 안 함", `${skippedCount}명`],
      ["제출 시각", formatDateTime(state.submittedAt)]
    ];
    $("#done-stub").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("");
    const other = otherType();
    const otherBtn = $("#done-other");
    otherBtn.hidden = !other;
    if (other) {
      otherBtn.innerHTML = `<span>${escapeHtml(config.types[other].label)} 평가하기</span><span class="go__arrow" aria-hidden="true">→</span>`;
    }
    showScreen("done");
  }

  $("#done-other").addEventListener("click", () => {
    const other = otherType();
    if (other) startEvaluation(other, state.judge);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="home"], [data-action="edit"]');
    if (!btn) return;
    if (btn.dataset.action === "edit") {
      renderEval();
      showScreen("eval");
      return;
    }
    renderStart({ judge: state ? state.judge : undefined, type: state ? state.type : undefined });
    showScreen("start");
  });

  /* ── 발표 순서 · 시간 ─────────────────────────────────────── */
  const scheduleEl = $("#schedule");
  let scheduleReturnFocus = null;

  const splitRange = (range) => String(range || "").split(/\s*[-–~]\s*/).filter(Boolean);
  const toMinutes = (hhmm) => {
    const m = /(\d{1,2}):(\d{2})/.exec(hhmm || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
  };

  // 부문마다 하나의 세션으로 묶고 시작 시각 순서로 정렬 (포스터 11:00 → 신입 13:00 → …)
  function sessions() {
    const list = [];
    typeKeys.forEach((type) => {
      const t = config.types[type];
      t.categories.forEach((cat) => {
        const own = cat.presenters.map((p) => splitRange(p.time)).filter((r) => r.length);
        const span = cat.time ? splitRange(cat.time)
          : own.length ? [own[0][0], own[own.length - 1][1] || own[own.length - 1][0]] : [];
        list.push({ typeLabel: t.label, label: cat.label, start: span[0] || "", end: span[1] || "", shared: !own.length, presenters: cat.presenters });
      });
    });
    return list.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }

  function renderSchedule() {
    $("#schedule-body").innerHTML = sessions().map((s) => `
      <section class="sess${s.shared ? " sess--shared" : ""}">
        <header class="sess__head">
          ${s.start ? `<p class="sess__time">${escapeHtml(s.start)}${s.end ? `–${escapeHtml(s.end)}` : ""}</p>` : ""}
          <div class="sess__title">
            <h3 class="sess__name">${escapeHtml(s.label)}</h3>
            <span class="sess__meta">${escapeHtml(s.typeLabel)} · ${s.presenters.length}명</span>
          </div>
        </header>
        <ol class="sess__list">
          ${s.presenters.map((p, i) => `
            <li class="slot">
              <span class="slot__no">${pad2(i + 1)}</span>
              <span class="slot__time">${escapeHtml(splitRange(p.time)[0] || "")}</span>
              <div>
                <p class="slot__who"><b>${escapeHtml(p.name)}</b>${p.advisor ? `<span>${escapeHtml([config.advisorLabel, p.advisor].filter(Boolean).join(" "))}</span>` : ""}</p>
                ${p.topic ? `<p class="slot__topic">${escapeHtml(p.topic)}</p>` : ""}
              </div>
            </li>`).join("")}
        </ol>
      </section>`).join("");
  }

  function openSchedule() {
    renderSchedule();
    scheduleReturnFocus = document.activeElement;
    scheduleEl.hidden = false;
    document.body.classList.add("is-locked");
    $("#schedule-body").scrollTop = 0;
    history.pushState({ screen: "schedule" }, "");   // 휴대폰 뒤로가기로도 닫히게
    $("#schedule-close").focus();
  }

  function hideSchedule() {
    scheduleEl.hidden = true;
    document.body.classList.remove("is-locked");
    if (scheduleReturnFocus && scheduleReturnFocus.focus) scheduleReturnFocus.focus();
  }

  function closeSchedule() {
    if (history.state && history.state.screen === "schedule") history.back();   // popstate에서 닫힘
    else hideSchedule();
  }

  $("#schedule-open").addEventListener("click", openSchedule);
  $("#schedule-close").addEventListener("click", closeSchedule);
  scheduleEl.addEventListener("click", (e) => { if (e.target === scheduleEl) closeSchedule(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !scheduleEl.hidden && !document.querySelector(".modal-backdrop")) closeSchedule();
  });

  /* ── 대화상자 ─────────────────────────────────────────────── */
  function showDialog({ title, body, actions }) {
    return new Promise((resolve) => {
      const lastFocus = document.activeElement;
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 class="modal__title" id="modal-title">${escapeHtml(title)}</h2>
          <div class="modal__body">${body}</div>
          <div class="modal__actions">
            ${actions.map((a, i) => `<button type="button" class="btn${a.primary ? " btn-primary" : ""}" data-i="${i}">${escapeHtml(a.label)}</button>`).join("")}
          </div>
        </div>`;
      const close = (value) => {
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        resolve(value);
      };
      const cancelValue = actions[0].value; // Esc·바깥 클릭 = 첫 번째(취소/확인) 버튼
      const onKey = (e) => { if (e.key === "Escape") close(cancelValue); };
      backdrop.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-i]");
        if (b) close(actions[Number(b.dataset.i)].value);
        else if (e.target === backdrop) close(cancelValue);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(backdrop);
      const primary = backdrop.querySelector(".btn-primary") || backdrop.querySelector("button");
      primary.focus();
    });
  }

  /* ── 시작 ─────────────────────────────────────────────────── */
  function bindHero() {
    const hero = config.hero || {};
    const bind = (key, value) => $$(`[data-bind="${key}"]`).forEach((el) => {
      el.textContent = value || "";
      el.hidden = !value;
    });
    bind("event-title", config.eventTitle);
    bind("hero-tagline", hero.tagline);
    bind("hero-org", hero.org);
    bind("hero-display", hero.display);
    bind("hero-display-sub", hero.displaySub);
    // 영문 학과명: "Department of / Transdisciplinary / Medicine"처럼 나누고 첫 글자 강조
    const lines = [];
    String(hero.orgEn || "").split(/\s+/).filter(Boolean).forEach((w) => {
      if (/^[a-z]{1,3}$/.test(w) && lines.length) lines[lines.length - 1] += ` ${w}`;
      else lines.push(w);
    });
    $$('[data-bind="hero-org-en"]').forEach((el) => {
      el.innerHTML = lines.map((l) => `<span><b>${escapeHtml(l[0])}</b>${escapeHtml(l.slice(1))}</span>`).join("");
      el.hidden = !lines.length;
    });
  }

  // 큰 제목은 DTM처럼 짧은 글자에 맞춘 크기라서, 길면 한 줄에 들어가도록 글자를 줄인다
  function fitDisplay() {
    $$(".title-block__main, .title-block__sub").forEach((el) => {
      el.style.fontSize = "";
      if (el.hidden || !el.textContent) return;
      const base = parseFloat(getComputedStyle(el).fontSize);
      el.style.whiteSpace = "nowrap";
      el.style.display = "inline-block";
      const natural = el.getBoundingClientRect().width;
      el.style.whiteSpace = "";
      el.style.display = "";
      const room = el.parentElement.clientWidth;
      if (natural > room) el.style.fontSize = `${Math.max(base * 0.3, Math.floor(base * room / natural))}px`;
    });
  }

  function renderLegend() {
    const g = config.grades;
    $("#legend-text").innerHTML = `항목마다 <b>${escapeHtml(g[0])}</b>(가장 우수)부터 <b>${escapeHtml(g[g.length - 1])}</b>까지 하나를 고르세요. ` +
      "불참·이해관계 등으로 평가하지 않을 발표자는 <b>평가 안 함</b>에 표시합니다.";
  }

  /* ── 시작 ─────────────────────────────────────────────────── */
  function init() {
    config = common.config;
    typeKeys = config.typeKeys;
    bindHero();
    renderLegend();
    renderTypeChoices();
    renderStart({ judge: storage.get(LAST_JUDGE_KEY) || "" });
    $("#boot-notice").hidden = !common.fromCache;
    $("#start-form").dataset.state = "ready";

    fitDisplay();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitDisplay);
    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitDisplay);
    });
  }

  function showBootError(err) {
    const details = (err.details || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("");
    $("#boot-status").innerHTML = `
      <b>행사 정보를 불러오지 못했습니다</b>
      <span>${escapeHtml(err.message)}</span>
      ${details ? `<ul>${details}</ul>` : ""}
      <button class="ghost-btn" type="button" id="boot-retry">다시 시도</button>`;
    $("#boot-retry").addEventListener("click", () => window.location.reload());
    $("#start-form").dataset.state = "error";
  }

  $("#demo-banner").hidden = !api.isDemo;
  history.replaceState({ screen: "start" }, "");
  common.boot().then(init, showBootError);
})();
