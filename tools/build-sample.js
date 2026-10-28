// 테스트 모드의 샘플 행사(assets/sample-config.js)를 Code.gs의 샘플 탭에서 만든다.
// Code.gs의 sampleTabs_()를 고친 뒤 실행:  node tools/build-sample.js
const fs = require("fs");
const path = require("path");
const gas = require("./gas.js")();

const built = gas.buildConfig_(gas.sampleTabs_(), "sample");
if (!built.ok || built.warnings.length) {
  console.error("샘플 탭에 문제가 있습니다:", built.errors, built.warnings);
  process.exit(1);
}
const out = `/* 샘플 행사 설정: 링크에 시트 연결(?s=)이 없을 때 보여 주는 테스트 화면용.
 * apps-script/Code.gs의 sampleTabs_()를 같은 규칙(buildConfig_)으로 바꾼 결과입니다. 직접 고치지 말고
 * sampleTabs_()를 고친 뒤 node tools/build-sample.js를 실행하세요. */
window.EVAL_SAMPLE = ${JSON.stringify(built.config, null, 2)};
`;
fs.writeFileSync(path.join(__dirname, "../assets/sample-config.js"), out);
console.log("assets/sample-config.js:", built.config.types.map((t) => `${t.label} ${t.categories.reduce((n, c) => n + c.presenters.length, 0)}명`).join(", "));
