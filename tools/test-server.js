// Code.gs 시험: 시트 읽기 규칙, 제출·재제출·결과 조회, 수식 방지, 행사 보관
// 실행: node tools/test-server.js
const assert = require("assert/strict");
const { loadGas } = require("./gas-mock.js");
const gas = require("./gas.js")();

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n${e.stack}`); process.exitCode = 1; }
};
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm 안의 객체를 비교하기 좋게

console.log("buildConfig_");
const base = () => plain(gas.sampleTabs_());

test("샘플 탭 → 경고 없이 2개 유형, 점수 자동 계산", () => {
  const b = plain(gas.buildConfig_(base(), "e1"));
  assert.equal(b.ok, true);
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.config.types.map((t) => t.label), ["구두발표", "포스터발표"]);
  assert.deepEqual(b.config.types[1].criteria[1].points, { A: 45, B: 40.5, C: 36, D: 31.5, E: 27 });
  assert.equal(b.config.advisorLabel, "지도교수");
  assert.equal(b.config.eventId, "e1");
});

test("한 부문이 모두 같은 시간이면 부문 시간으로 올림", () => {
  const b = plain(gas.buildConfig_(base(), "e"));
  const poster = b.config.types[1].categories[0];
  assert.equal(poster.time, "11:00 - 12:00");
  assert.ok(poster.presenters.every((p) => p.time === ""));
  assert.equal(b.config.types[0].categories[0].presenters[0].time, "13:00 - 13:15");
});

test("등급 머리글을 바꾸면 그 등급을 씀 (소문자는 대문자로)", () => {
  const tabs = base();
  tabs.criteria = [["발표유형", "평가항목", "배점", "s", "a", "b"], ["구두", "내용", 50, 50, "", "30점"], ["구두", "발표", 50]];
  tabs.presenters = [["유형", "부문", "이름"], ["", "", "홍길동"]];
  const b = plain(gas.buildConfig_(tabs, "e"));
  assert.deepEqual(b.config.grades, ["S", "A", "B"]);
  assert.deepEqual(b.config.types[0].criteria[0].points, { S: 50, A: 45, B: 30 });
  assert.equal(b.config.types[0].categories[0].label, "구두", "부문을 비우면 유형 이름");
  assert.equal(b.config.advisorLabel, "");
});

test("잘못 적힌 줄은 빼고 경고", () => {
  const tabs = base();
  tabs.criteria.push(["구두발표", "새 항목", "많이"]);           // 배점이 숫자가 아님
  tabs.criteria.push(["구두발표", "구연능력", 10]);              // 항목 중복
  tabs.presenters.push(["구두발포", "신진연구자 부문", "오타유형"]); // 없는 유형
  tabs.presenters.push(["구두발표", "신진연구자 부문", "김하늘"]);  // 같은 부문 같은 이름
  tabs.presenters.push(["구두발표", "다른 부문", "김하늘"]);       // 다른 부문의 같은 이름은 허용
  tabs.presenters.push(["구두발표", "", ""]);                     // 이름 없음
  const b = plain(gas.buildConfig_(tabs, "e"));
  assert.equal(b.ok, true);
  assert.equal(b.warnings.length, 5, b.warnings.join("\n"));
  assert.equal(b.config.types[0].criteria.length, 5);
  assert.deepEqual(b.config.types[0].categories.map((c) => c.label), ["신진연구자 부문", "우수연구 부문", "다른 부문"]);
});

test("쓸 수 있는 유형이 없으면 오류, 비밀번호는 따로", () => {
  const tabs = base();
  tabs.presenters = tabs.presenters.map((r, i) => (i ? ["없는유형"].concat(r.slice(1)) : r));
  tabs.settings[2][1] = "pw1234";
  const b = plain(gas.buildConfig_(tabs, "e"));
  assert.equal(b.ok, false);
  assert.equal(b.errors.length, 1);
  assert.equal(b.password, "pw1234");
  assert.ok(!JSON.stringify(b.config).includes("pw1234"), "공개 설정에 비밀번호가 들어가면 안 됨");
});

test("탭이 비어 있으면 처음 설정 안내", () => {
  const b = plain(gas.buildConfig_({ settings: [], criteria: [], presenters: [] }, "e"));
  assert.equal(b.ok, false);
  assert.match(b.errors[0], /처음 설정/);
});

console.log("웹 앱 흐름");
const g = loadGas();
g.setup();
const settings = g.ss.getSheetByName("설정");

test("처음 설정: 탭 3개 생성, 빈 시트1 삭제, 행사 번호", () => {
  assert.deepEqual(g.ss.getSheets().map((s) => s.getName()), ["설정", "평가항목", "발표자"]);
  assert.ok(g.props.EVENT_ID);
  assert.equal(g.ss.getSheetByName("평가항목").get(8, 5), 40.5, "수식으로 B 점수");
  g.setup();
  assert.match(g.alerts[g.alerts.length - 1], /이미 있어서/);
});

const cfg = g.post({ action: "config" });
const oral = cfg.config.types[0];
const rowsFor = (gradesFor) => oral.categories.flatMap((c) => c.presenters.map((p) => {
  const grades = gradesFor(p.name);
  return { category: c.label, presenter: p.name, topic: p.topic, skipped: !grades, grades: grades || [], comment: "" };
}));
const submit = (judge, gradesFor, extra = {}) => g.post(Object.assign({
  action: "submit", eventId: cfg.config.eventId, type: "구두발표", judge,
  criteria: oral.criteria.map((c) => c.label), rows: rowsFor(gradesFor)
}, extra));

test("설정 요청: 공개 설정만, 비밀번호 없음", () => {
  assert.equal(cfg.ok, true);
  assert.equal(cfg.config.eventId, g.props.EVENT_ID);
  assert.ok(!("password" in cfg.config));
});

test("비밀번호가 비어 있으면 결과 조회 불가", () => {
  assert.equal(g.post({ action: "results", password: "" }).error, "password_not_set");
});

settings.set(3, 2, "secret");

test("제출 → 응답 탭 생성, 재제출은 덮어쓰기", () => {
  assert.equal(submit(" 홍  길동 ", (n) => (n === "김하늘" ? ["A", "A", "A", "A", "A"] : null)).ok, true);
  assert.equal(submit("이심사", (n) => (n === "김하늘" ? ["a", "B", "A", "C", "B"] : null)).ok, true);
  assert.equal(submit("홍 길동", (n) => (n === "김하늘" ? ["B", "B", "B", "B", "B"] : null)).ok, true);
  const sheet = g.ss.getSheetByName("응답_구두발표");
  assert.ok(sheet);
  assert.equal(sheet.getLastRow(), 1 + 5 * 2, "심사위원 2명 × 발표자 5명");
  assert.equal(g.ss.getSheetByName("제출기록").getLastRow(), 1 + 3);
});

test("결과 조회: 비밀번호 확인, 등급·평가 안 함, 최신 설정 동봉", () => {
  assert.equal(g.post({ action: "results", password: "wrong" }).error, "bad_password");
  const res = g.post({ action: "results", password: "secret" });
  assert.equal(res.ok, true);
  const rows = res.data["구두발표"];
  const hong = rows.filter((r) => r.judge === "홍 길동");
  assert.equal(hong.length, 5);
  assert.deepEqual(hong.find((r) => r.presenter === "김하늘").grades, ["B", "B", "B", "B", "B"]);
  assert.equal(hong.filter((r) => r.skipped).length, 4);
  assert.deepEqual(rows.find((r) => r.judge === "이심사" && r.presenter === "김하늘").grades, ["A", "B", "A", "C", "B"]);
  assert.deepEqual(res.data["포스터발표"], []);
  assert.equal(res.config.types.length, 2);
});

test("수식 방지: 시트에는 ', 결과에는 원래 글", () => {
  const rows = rowsFor((n) => (n === "김하늘" ? ["A", "A", "A", "A", "A"] : null));
  rows[0].comment = "=1+1";
  g.post({ action: "submit", eventId: cfg.config.eventId, type: "구두발표", judge: "수식", criteria: oral.criteria.map((c) => c.label), rows });
  const sheet = g.ss.getSheetByName("응답_구두발표");
  const stored = sheet.getRange(1, 1, sheet.getLastRow(), 12).getValues().find((r) => r[1] === "수식" && r[3] === "김하늘");
  assert.equal(stored[11], "'=1+1");
  const res = g.post({ action: "results", password: "secret" });
  assert.equal(res.data["구두발표"].find((r) => r.judge === "수식" && r.presenter === "김하늘").comment, "=1+1");
});

test("없는 유형·행사 번호 불일치·잘못된 요청", () => {
  assert.equal(submit("a", () => null, { type: "없는유형" }).error, "unknown_type");
  assert.equal(submit("a", () => null, { eventId: "old" }).error, "event_changed");
  assert.equal(submit("", () => null).error, "bad_request");
  assert.equal(JSON.parse(g.doPost({ postData: { contents: "{" } }).getContent()).error, "bad_request");
});

test("링크 안내 페이지: 심사위원·관리자 링크", () => {
  const html = g.doGet({ parameter: {} }).getContent();
  assert.match(html, /\?s=MOCKDEPLOYMENTID0000000000000000/);
  assert.match(html, /admin\.html\?s=MOCKDEPLOYMENTID/);
  assert.equal(JSON.parse(g.doGet({ parameter: { action: "config" } }).getContent()).ok, true);
});

test("결과 보관: 응답·기록 탭 이름 변경, 새 행사 번호, 이전 화면 제출 거부", () => {
  const before = g.props.EVENT_ID;
  g.archiveResults();
  const names = g.ss.getSheets().map((s) => s.getName());
  assert.ok(!names.includes("응답_구두발표") && !names.includes("제출기록"));
  assert.equal(names.filter((n) => n.startsWith("보관")).length, 2);
  assert.notEqual(g.props.EVENT_ID, before);
  assert.equal(submit("홍 길동", () => null).error, "event_changed");
  const res = g.post({ action: "results", password: "secret" });
  assert.deepEqual(res.data["구두발표"], []);
});

console.log(`\n${passed}개 통과${process.exitCode ? ", 실패 있음" : ""}`);
