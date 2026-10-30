// 첫 화면을 PC·태블릿·휴대폰 크기로 캡처한다 (설치된 Chrome을 창 없이 실행).
// 실행: node tools/capture-screens.js "<심사위원 링크>"
// 결과: 화면캡처/화면_PC.png, 화면_태블릿.png, 화면_휴대폰.png
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const OUT = path.join(__dirname, "../화면캡처");
const SHOTS = [
  { file: "화면_PC.png", width: 1440, height: 900, scale: 2, mobile: false },
  { file: "화면_태블릿.png", width: 820, height: 1180, scale: 2, mobile: true },
  // 휴대폰은 화면보다 내용이 길어서 맨 아래(로고)까지 이어서 찍는다
  { file: "화면_휴대폰.png", width: 390, height: 844, scale: 3, mobile: true, fullPage: true }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch (e) { /* 아직 안 뜸 */ }
    await sleep(200);
  }
  throw new Error("Chrome이 시작되지 않았습니다");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (!waiting.has(msg.id)) return;
      const { ok, fail } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
    };
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((ok, fail) => {
        const n = ++id;
        waiting.set(n, { ok, fail });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      close: () => ws.close()
    });
    ws.onerror = () => reject(new Error("Chrome에 연결하지 못했습니다"));
  });
}

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error("심사위원 링크를 넣어 주세요");
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "peval-capture-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars"], { stdio: "ignore" });
  try {
    await waitForChrome();
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");

    for (const shot of SHOTS) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: shot.mobile });
      await page.send("Page.navigate", { url });
      let ready = false;
      for (let i = 0; i < 120 && !ready; i++) {
        await sleep(500);
        const r = await page.send("Runtime.evaluate", { expression: `(document.querySelector("#start-form") || {dataset:{}}).dataset.state === "ready"`, returnByValue: true });
        ready = r.result.value === true;
      }
      if (!ready) throw new Error(`${shot.file}: 화면이 준비되지 않았습니다`);
      await page.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
      await sleep(1500);   // 배경 그래픽이 자리 잡을 시간

      const params = { format: "png" };
      if (shot.fullPage) {
        const m = await page.send("Page.getLayoutMetrics");
        params.captureBeyondViewport = true;
        params.clip = { x: 0, y: 0, width: shot.width, height: Math.ceil(m.cssContentSize.height), scale: 1 };
      }
      const { data } = await page.send("Page.captureScreenshot", params);
      fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(data, "base64"));
      console.log(shot.file, `${shot.width}px 너비`, params.clip ? `(세로 ${params.clip.height}px 전체)` : `× ${shot.height}px`);
    }
    page.close();
  } finally {
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
