/* 개발용: 구글 시트·Apps Script 서비스를 흉내 내서 Code.gs를 Node에서 돌린다.
 * 시험(tools/test-server.js)과 로컬 미리보기 서버(tools/dev-server.js)가 함께 쓴다. 실제 사이트에는 쓰이지 않는다. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const colIndex = (letters) => letters.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((line) => line.map((v) => (v instanceof Object && typeof v.toISOString === "function" ? v.toISOString() : String(v))));
  }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  // 샘플 점수표 수식(=$C2*0.9)만 계산한다
  setFormulas(formulas) {
    formulas.forEach((line, r) => line.forEach((f, c) => {
      const m = /^=\$C(\d+)(?:\*([\d.]+))?$/.exec(f);
      const value = m ? Number(this.sheet.get(Number(m[1]), 3)) * (m[2] ? Number(m[2]) : 1) : f;
      this.sheet.set(this.row + r, this.col + c, value);
    }));
    return this;
  }
  protect() { const p = { setWarningOnly: () => p, setDescription: () => p }; return p; }
}
["setNumberFormat", "setFontWeight", "setBackground", "setFontColor", "setNote", "setWrap", "setDataValidation"].forEach((name) => {
  Range.prototype[name] = function () { return this; };
});

class Sheet {
  constructor(name) { this.name = name; this.cells = []; }
  getName() { return this.name; }
  setName(name) { this.name = name; return this; }
  get(r, c) { return (this.cells[r - 1] && this.cells[r - 1][c - 1] !== undefined) ? this.cells[r - 1][c - 1] : ""; }
  set(r, c, v) {
    while (this.cells.length < r) this.cells.push([]);
    this.cells[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let r = this.cells.length; r > 0; r--) if ((this.cells[r - 1] || []).some((v) => v !== "" && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() { return this.cells.reduce((n, line) => Math.max(n, line.length), 0); }
  getMaxRows() { return 1000; }
  getRange(a, b, c, d) {
    if (typeof a === "string") {
      const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a);
      return new Range(this, Number(m[2] || 1), colIndex(m[1]), 1, 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  deleteRow(r) { this.cells.splice(r - 1, 1); }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, c) => this.set(r, c + 1, v)); }
  setFrozenRows() {}
  setColumnWidth() {}
}

class Spreadsheet {
  constructor() { this.sheets = [new Sheet("시트1")]; }
  getId() { return "mock-spreadsheet-0001"; }
  getUrl() { return "https://docs.google.com/spreadsheets/d/mock-spreadsheet-0001/edit"; }
  getSpreadsheetTimeZone() { return "Asia/Seoul"; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name, index) {
    const sheet = new Sheet(name);
    this.sheets.splice(index == null ? this.sheets.length : index, 0, sheet);
    return sheet;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
  setActiveSheet() {}
}

// Code.gs를 새 가짜 시트와 함께 불러온다. ctx.ss로 시트에 직접 접근할 수 있다.
function loadGas({ scriptId = "MOCKDEPLOYMENTID0000000000000000", alerts = [] } = {}) {
  const ss = new Spreadsheet();
  const props = {};
  const builder = () => { const b = { requireValueInRange: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; };
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      newDataValidation: builder,
      getUi: () => ({
        alert: (...args) => { alerts.push(args.length > 1 ? args[1] : args[0]); return "YES"; },
        showModalDialog: () => {},
        createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; },
        ButtonSet: { YES_NO: "YES_NO" },
        Button: { YES: "YES" }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s })
    },
    HtmlService: {
      createHtmlOutput: (h) => ({ setTitle() { return this; }, addMetaTag() { return this; }, setWidth() { return this; }, setHeight() { return this; }, getContent: () => h })
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => `https://script.google.com/macros/s/${scriptId}/exec` }),
      getScriptId: () => "mock-script"
    },
    Utilities: {
      getUuid: () => require("crypto").randomUUID(),
      formatDate: (d) => d.toISOString().slice(2, 16).replace(/[-T:]/g, "")
    },
    Logger: { log: (m) => alerts.push(m) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx, { filename: "Code.gs" });
  ctx.ss = ss;
  ctx.props = props;
  ctx.alerts = alerts;
  // 웹 앱에 POST 한 것처럼 부르고 JSON 응답을 돌려준다
  ctx.post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return ctx;
}

module.exports = { loadGas };
