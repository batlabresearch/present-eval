// Code.gs의 순수 함수(buildConfig_, sampleTabs_ 등)만 쓸 때: 구글 서비스 없이 불러온다
const fs = require("fs");
const path = require("path");
const vm = require("vm");

module.exports = function load(file = path.join(__dirname, "../apps-script/Code.gs")) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: "Code.gs" });
  return ctx;
};
