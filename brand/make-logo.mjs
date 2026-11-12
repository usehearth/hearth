// Draws Hearth's 8-bit logo on a 32x32 grid and writes brand/logo.svg (crisp pixels at any size).
// The hearth sits in the middle; around it are devices (a monitor, two laptops, two phones), each joined to the
// hearth by a warm line, with screens lit by its fire: every device is a window onto the one hearth.
//   node brand/make-logo.mjs && bash brand/render.sh
import { writeFileSync } from 'node:fs';

const N = 32;
const C = {
  bg: '#141A2B',
  stone: '#EADBC8', stoneShade: '#BFAE98',
  Y: '#FFD166', L: '#FFF3C4', O: '#F78C2F', R: '#E4501E', B: '#7A4A2C', inside: '#2A2030',
  frame: '#D8E0EC', frameShade: '#A9B6C9', screen: '#F2A04A', screenHi: '#FFD49A',
  line: '#E08A35', spark: '#FFD166',
};
const px = new Map();
const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px.set(`${x},${y}`, c); };
const DY = 4; // the picture sits in the middle of the tile
const set = (x, y, c) => put(x, y + DY, c);

// Tile with stepped (pixel) rounded corners.
const cut = [3, 1, 1];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const ry = Math.min(y, N - 1 - y), rx = Math.min(x, N - 1 - x);
  if (ry < cut.length && rx < cut[ry]) continue;
  put(x, y, C.bg);
}

// ---- connections: solid warm lines, one bright spark on each ----
const line = (pts, spark) => { pts.forEach(([x, y], i) => set(x, y, i === spark ? C.spark : C.line)); };
line([[15, 5], [15, 6], [15, 7], [15, 8], [15, 9]], 2);              // monitor (top)
line([[16, 5], [16, 6], [16, 7], [16, 8], [16, 9]], 2);
line([[8, 7], [9, 8], [10, 9], [11, 10]], 1);                         // laptop (top left)
line([[23, 7], [22, 8], [21, 9], [20, 10]], 1);                       // laptop (top right)
line([[5, 17], [6, 17], [7, 17], [8, 17], [9, 17], [10, 17]], 3);     // phone (left)
line([[26, 17], [25, 17], [24, 17], [23, 17], [22, 17], [21, 17]], 3); // phone (right)

// ---- devices ----
const box = (x0, y0, w, h, edge = C.frame) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    set(x, y, border ? edge : (y === y0 + 1 && x === x0 + 1 ? C.screenHi : C.screen));
  }
};
// monitor: screen + stand
box(12, 0, 8, 4); set(15, 4, C.frameShade); set(16, 4, C.frameShade);
// laptops: screen + keyboard base
box(3, 3, 5, 4); for (let x = 2; x <= 8; x++) set(x, 7, x === 8 ? C.frame : C.frameShade);
box(24, 3, 5, 4); for (let x = 23; x <= 29; x++) set(x, 7, x === 23 ? C.frame : C.frameShade);
// phones
box(2, 14, 3, 6); box(27, 14, 3, 6);

// ---- the hearth: a smaller arch on legs, a hearthstone, the fire ----
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const d = Math.hypot(x - 15.5, y - 15);
  if (y <= 15 && x >= 11 && x <= 20 && d < 3.2 && y >= 12) set(x, y, C.inside);
  if (y <= 15 && x >= 11 && x <= 20 && d >= 3.2 && d <= 5.2) set(x, y, C.stone);
}
for (let y = 16; y <= 20; y++) {
  set(11, y, C.stone); set(12, y, C.stoneShade); set(19, y, C.stoneShade); set(20, y, C.stone);
  for (let x = 13; x <= 18; x++) set(x, y, C.inside);
}
for (let x = 9; x <= 22; x++) { set(x, 21, C.stone); set(x, 22, C.stoneShade); }

const fire = {
  13: { 16: 'Y' },
  14: { 15: 'Y', 16: 'O' },
  15: { 14: 'O', 15: 'Y', 16: 'L', 17: 'Y' },
  16: { 14: 'R', 15: 'Y', 16: 'L', 17: 'O' },
  17: { 13: 'R', 14: 'O', 15: 'L', 16: 'L', 17: 'Y', 18: 'O' },
  18: { 13: 'R', 14: 'R', 15: 'O', 16: 'Y', 17: 'O', 18: 'R' },
  19: { 14: 'R', 15: 'R', 16: 'R', 17: 'R' },
  20: { 13: 'B', 14: 'B', 15: 'B', 16: 'B', 17: 'B', 18: 'B' },
};
for (const [y, row] of Object.entries(fire)) for (const [x, k] of Object.entries(row)) set(+x, +y, C[k]);

// One rect per run of same-coloured pixels in a row.
const rects = [];
for (let y = 0; y < N; y++) {
  let x = 0;
  while (x < N) {
    const c = px.get(`${x},${y}`);
    if (!c) { x++; continue; }
    let w = 1;
    while (px.get(`${x + w},${y}`) === c) w++;
    rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`);
    x += w;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="512" height="512" shape-rendering="crispEdges">\n<title>Hearth</title>\n${rects.join('\n')}\n</svg>\n`;
writeFileSync(new URL('./logo.svg', import.meta.url), svg);
console.log(`logo.svg: ${rects.length} rects`);
