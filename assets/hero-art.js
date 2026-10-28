/* 첫 화면·제출 완료 화면의 배경 그래픽: 육각 네트워크, 빛줄기, 구체, 빛줄기가 도착하는 건물 (포스터 톤)
 * [data-hero-art] 요소 안에 SVG를 그린다. 같은 결과가 나오도록 난수는 고정 시드를 쓴다.
 * 빛 펄스가 건물 밑에 도착할 때마다 건물 외곽선·창이 반짝이고 받침 고리가 한 번 퍼진다. */
(() => {
  "use strict";

  const W = 1200;
  const H = 900;
  const BASE = { x: 1140, y: 360 };     // 빛줄기가 모이는 건물 받침의 중심
  const PULSE = 90;                      // 빛 펄스(밝은 선분)의 길이
  const FLASH_GAP_MS = 1100;             // 반짝임 사이 최소 간격

  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  const f = (n) => Math.round(n * 10) / 10;

  // 아래에서 출발해 오른쪽 위 건물 받침으로 휘어 들어가는 빛줄기
  function trails(rand) {
    const out = [];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const sx = -60 + 820 * t + (rand() - 0.5) * 30;
      const sy = H + 30;
      const ex = BASE.x + (t - 0.5) * 70;
      const ey = BASE.y - 2 + (t - 0.5) * 22;
      const c1x = sx + 260 + 120 * t;
      const c1y = 760 - 80 * t - rand() * 40;
      const c2x = ex - 360 + 160 * t;
      const c2y = ey + 150 - 60 * t;
      const d = `M${f(sx)} ${f(sy)} C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(ex)} ${f(ey)}`;
      const width = 0.5 + rand() * 1.4;
      if (i % 6 === 3) {
        // 펄스의 점선 길이·속도는 경로 길이를 잰 뒤 wire()에서 정한다
        out.push(`<path class="trail trail--pulse" d="${d}" stroke-width="1.9" />`);
      } else {
        const kind = i % 3 === 0 ? "flow" : "still";
        out.push(`<path class="trail trail--${kind}" d="${d}" stroke-width="${width.toFixed(2)}" style="animation-delay:${(-rand() * 6).toFixed(2)}s" />`);
      }
    }
    return out.join("");
  }

  // 육각 격자 위에서 몇 개의 육각형·꼭짓점만 밝게 (분자 네트워크 느낌)
  function lattice(rand) {
    const size = 34;                       // 육각형 한 변
    const w = Math.sqrt(3) * size;
    const hex = (cx, cy) => {
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 180 * (60 * k - 30);
        pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
      }
      return pts;
    };
    const cells = [];
    for (let row = -1; row < 9; row++) {
      for (let col = -1; col < 12; col++) {
        const cx = 640 + col * w + (row % 2 ? w / 2 : 0);
        const cy = -20 + row * size * 1.5;
        cells.push({ cx, cy, pts: hex(cx, cy) });
      }
    }
    const faint = cells.map((c) => `<polygon points="${c.pts.map((p) => p.map(f).join(",")).join(" ")}" />`).join("");

    const lit = [];
    const nodes = [];
    const pick = [[2, 3], [3, 3], [3, 4], [2, 5], [5, 7], [6, 7], [1, 8], [4, 9]];
    pick.forEach(([row, col]) => {
      const c = cells[(row + 1) * 13 + (col + 1)];
      if (!c) return;
      lit.push(`<polygon points="${c.pts.map((p) => p.map(f).join(",")).join(" ")}" />`);
      c.pts.forEach((p, k) => {
        if ((k + row) % 2 === 0) nodes.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${(1.6 + rand() * 1.6).toFixed(1)}" />`);
      });
    });
    return { faint, lit: lit.join(""), nodes: nodes.join("") };
  }

  function dust(rand) {
    const out = [];
    for (let i = 0; i < 46; i++) {
      const x = 500 + rand() * 700;
      const y = 40 + rand() * 820;
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${(0.5 + rand() * 1.1).toFixed(1)}" opacity="${(0.25 + rand() * 0.6).toFixed(2)}" />`);
    }
    return out.join("");
  }

  // 포스터의 연구동을 단순한 선으로: 가늘고 높은 15층 타워, 층마다 가로 창 띠, 왼쪽 세로 사인 띠, 낮은 기단
  function building(rand) {
    const S = 0.8;                       // 건물 전체 크기 (가로·세로 같은 비율로 줄임)
    const FLOORS = 15;
    const towerW = 52 * S;
    const towerH = 168 * S;
    const podiumH = 14 * S;
    const podiumTop = BASE.y - podiumH;
    const top = podiumTop - towerH;
    const left = BASE.x - towerW / 2;
    const right = BASE.x + towerW / 2;
    const signW = 10 * S;                // 왼쪽 세로 사인 띠 칸
    const colW = (towerW - signW) / 3;   // 창 3칸
    const cols = [0, 1, 2, 3].map((c) => left + signW + c * colW);
    const rect = (x, y, w, h) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" />`;
    const line = (x1, y1, x2, y2) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" />`;

    const outline = [
      rect(left, top, towerW, towerH),                               // 타워
      rect(left - 3 * S, top - 6 * S, towerW + 6 * S, 6 * S),        // 옥상 띠
      rect(BASE.x - 10 * S, top - 15 * S, 20 * S, 9 * S),            // 옥탑
      rect(BASE.x - 44 * S, podiumTop, 88 * S, podiumH)              // 기단
    ].join("");

    // 15개 층: 경계선 16개 사이에 창 띠 15줄
    const floorTop = top + 8 * S;
    const floorBottom = podiumTop - 2 * S;
    const floorH = (floorBottom - floorTop) / FLOORS;
    const grid = [];
    const wins = [];
    for (let k = 0; k <= FLOORS; k++) grid.push(line(left, floorTop + k * floorH, right, floorTop + k * floorH));
    for (let k = 0; k < FLOORS; k++) {
      for (let c = 0; c < 3; c++) {
        const lit = rand() < 0.2;
        wins.push(`<rect class="ha-win" x="${f(cols[c] + 2 * S)}" y="${f(floorTop + k * floorH + floorH * 0.3)}" width="${f(colW - 4 * S)}" height="${f(floorH * 0.42)}" opacity="${lit ? 0.45 : 0.06}" />`);
      }
    }
    cols.slice(0, 3).forEach((x) => grid.push(line(x, top + 4 * S, x, podiumTop)));

    const signDots = [];
    for (let k = 0; k < 6; k++) signDots.push(`<circle cx="${f(left + 5 * S)}" cy="${f(floorTop + 10 * S + k * 11 * S)}" r="1.1" />`);
    const sign = rect(left + 2 * S, floorTop + 4 * S, 6 * S, floorBottom - floorTop - 30 * S) + signDots.join("");

    return { outline, grid: grid.join(""), wins: wins.join(""), sign };
  }

  function svg() {
    const rand = seeded(20251114);
    const net = lattice(rand);
    const trailMarkup = trails(rand);
    const bldg = building(rand);
    return `
<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="ha-orb" cx="0.72" cy="0.45" r="0.75">
      <stop offset="0" stop-color="#2f7cff" stop-opacity="0.55" />
      <stop offset="0.55" stop-color="#123a8c" stop-opacity="0.35" />
      <stop offset="1" stop-color="#0a1733" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="ha-rim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.45" stop-color="#47d6ff" stop-opacity="0" />
      <stop offset="1" stop-color="#7fe6ff" stop-opacity="0.85" />
    </linearGradient>
    <radialGradient id="ha-light" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#e9fbff" stop-opacity="0.9" />
      <stop offset="0.2" stop-color="#5fdcff" stop-opacity="0.5" />
      <stop offset="1" stop-color="#1e6dff" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="ha-trail" gradientUnits="userSpaceOnUse" x1="0" y1="${H}" x2="${BASE.x}" y2="${BASE.y}">
      <stop offset="0" stop-color="#1e6dff" stop-opacity="0" />
      <stop offset="0.45" stop-color="#2fb8ff" stop-opacity="0.55" />
      <stop offset="1" stop-color="#cdf6ff" stop-opacity="0.95" />
    </linearGradient>
    <radialGradient id="ha-fade" cx="0.8" cy="0.2" r="0.62">
      <stop offset="0" stop-color="#fff" stop-opacity="1" />
      <stop offset="1" stop-color="#fff" stop-opacity="0" />
    </radialGradient>
    <mask id="ha-mask"><rect width="${W}" height="${H}" fill="url(#ha-fade)" /></mask>
    <filter id="ha-blur" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="3.2" /></filter>
  </defs>

  <g class="ha-net" mask="url(#ha-mask)">
    <g class="ha-net__faint">${net.faint}</g>
    <g class="ha-net__lit">${net.lit}</g>
    <g class="ha-net__nodes">${net.nodes}</g>
  </g>

  <g class="ha-orb">
    <circle cx="-150" cy="430" r="400" fill="url(#ha-orb)" />
    <circle cx="-150" cy="430" r="400" fill="none" stroke="url(#ha-rim)" stroke-width="1.6" />
  </g>

  <g class="ha-dust">${dust(rand)}</g>

  <!-- 빛줄기·광원·건물은 한 묶음: 휴대폰에서는 CSS로 이 묶음만 아래로 옮겨 제목 옆에 맞춘다 -->
  <g class="ha-dest">
    <g class="ha-trails" stroke="url(#ha-trail)" fill="none" stroke-linecap="round">${trailMarkup}</g>

    <g class="ha-light">
      <circle cx="${BASE.x}" cy="${BASE.y}" r="125" fill="url(#ha-light)" />
      <ellipse cx="${BASE.x}" cy="${BASE.y}" rx="96" ry="16" fill="none" stroke="#7fe6ff" stroke-opacity="0.6" stroke-width="1.2" />
      <ellipse cx="${BASE.x}" cy="${BASE.y}" rx="150" ry="26" fill="none" stroke="#47a8ff" stroke-opacity="0.25" stroke-width="1" />
    </g>

    <g class="ha-bldg">
      <g class="ha-bldg__glow" filter="url(#ha-blur)">${bldg.outline}</g>
      <g class="ha-bldg__body">${bldg.outline}</g>
      <g class="ha-bldg__grid">${bldg.grid}</g>
      <g class="ha-bldg__sign">${bldg.sign}</g>
      <g class="ha-bldg__wins">${bldg.wins}</g>
    </g>
    <ellipse class="ha-ripple" cx="${BASE.x}" cy="${BASE.y}" rx="70" ry="12" />
  </g>
</svg>`;
  }

  // 펄스가 경로 처음부터 끝까지 정확히 한 번 지나가도록 점선을 맞추고,
  // 한 바퀴가 끝날 때(= 펄스가 건물 밑에 도착할 때) 건물을 반짝이게 한다
  function wire(root, lengths, rand) {
    root.querySelectorAll(".trail--pulse").forEach((p, k) => {
      const len = lengths[k] || 1300;
      p.style.strokeDasharray = `${PULSE} ${len}`;
      p.style.setProperty("--from", String(PULSE));
      p.style.setProperty("--to", String(-len));
      p.style.setProperty("--dur", `${(6.4 + rand() * 2).toFixed(2)}s`);
      p.style.animationDelay = `${(-rand() * 8).toFixed(2)}s`;
    });

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof root.animate !== "function") return;

    const glow = root.querySelector(".ha-bldg__glow");
    const ripple = root.querySelector(".ha-ripple");
    const wins = Array.from(root.querySelectorAll(".ha-win"));
    let last = 0;

    root.addEventListener("animationiteration", (e) => {
      if (!e.target.classList || !e.target.classList.contains("trail--pulse")) return;
      const now = performance.now();
      if (now - last < FLASH_GAP_MS) return;
      last = now;

      glow.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.18 }, { opacity: 0 }], { duration: 950, easing: "ease-out" });
      ripple.animate(
        [{ opacity: 0.85, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.9)" }],
        { duration: 1200, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" }
      );
      for (let n = 0; n < 5; n++) {
        const win = wins[Math.floor(Math.random() * wins.length)];
        win.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: Number(win.getAttribute("opacity")) }],
          { duration: 700 + Math.random() * 500, delay: Math.random() * 180, easing: "ease-in" });
      }
    });
  }

  // 숨겨진 화면의 SVG에 정의된 그라데이션은 다른 SVG에서 참조가 깨지므로, 그림마다 id를 따로 붙인다
  const markup = svg();
  const hosts = Array.from(document.querySelectorAll("[data-hero-art]"));
  hosts.forEach((el, i) => {
    el.innerHTML = markup.replace(/(id="|url\(#)ha-/g, `$1ha${i}-`);
  });

  // 경로 길이는 화면에 보이는 그림에서 한 번만 재서 모든 그림에 같이 쓴다 (모양이 같으므로)
  let lengths = [];
  for (const el of hosts) {
    const paths = Array.from(el.querySelectorAll(".trail--pulse"));
    try {
      lengths = paths.map((p) => Math.ceil(p.getTotalLength()));
    } catch (e) {
      lengths = [];
    }
    if (lengths.length && lengths.every((n) => n > 0)) break;
  }
  const rand = seeded(1114);
  hosts.forEach((el) => {
    const root = el.querySelector("svg");
    if (root) wire(root, lengths, rand);
  });
})();
