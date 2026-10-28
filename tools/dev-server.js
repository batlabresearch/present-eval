// 개발용 미리보기 서버: 사이트 파일 + 가짜 Apps Script(Code.gs를 가짜 시트로 실행)
// 실행: node tools/dev-server.js [포트]
//   http://localhost:8790/                     샘플 행사 (테스트 모드)
//   http://localhost:8790/?s=MOCKDEPLOYMENT…   가짜 시트에 연결 (script.google.com 요청을 이 서버로 돌림)
//   관리자 비밀번호: test
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadGas } = require("./gas-mock.js");

const PORT = Number(process.argv[2]) || 8790;
const ROOT = path.join(__dirname, "..");
const MOCK_ID = "MOCKDEPLOYMENTID0000000000000000";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".gs": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".png": "image/png" };

const gas = loadGas({ scriptId: MOCK_ID });
gas.setup();
gas.ss.getSheetByName("설정").set(3, 2, "test");

// 페이지가 script.google.com으로 보내는 요청을 이 서버의 가짜 웹 앱으로 돌린다
const STUB = `<script>(() => { const f = window.fetch.bind(window); window.fetch = (u, o) =>
  String(u).startsWith("https://script.google.com/macros/s/") ? f("/__exec", o) : f(u, o); })();</script>`;

const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => resolve(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/__exec") {
    await new Promise((r) => setTimeout(r, 350));   // Apps Script 응답 지연 흉내
    const out = req.method === "POST"
      ? gas.doPost({ postData: { contents: await readBody(req) } })
      : gas.doGet({ parameter: Object.fromEntries(url.searchParams) });
    const content = out.getContent();
    res.writeHead(200, { "Content-Type": content.startsWith("<!doctype") ? "text/html; charset=utf-8" : "application/json; charset=utf-8" });
    return res.end(content);
  }
  // 시험용: 가짜 시트의 칸 바꾸기 {tab, row, col, value} / 내용 보기
  if (url.pathname === "/__sheet") {
    if (req.method === "POST") {
      const { tab, row, col, value } = JSON.parse(await readBody(req));
      gas.ss.getSheetByName(tab).set(row, col, value);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(gas.ss.getSheets().map((s) => ({ name: s.getName(), rows: s.cells }))));
  }

  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  const ext = path.extname(file);
  let body = fs.readFileSync(file);
  if (ext === ".html") body = body.toString("utf8").replace("<head>", `<head>${STUB}`);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(body);
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/  ·  연결 모드: http://localhost:${PORT}/?s=${MOCK_ID}`));
