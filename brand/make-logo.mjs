// Draws Hearth's 8-bit logo on a 32x32 grid and writes brand/logo.svg (crisp pixels at any size).
// The hearth sits in the middle; devices around it link to it with dotted lines: everything connects to the hearth.
//   node brand/make-logo.mjs
import { writeFileSync } from 'node:fs';

const N = 32;
const C = {
  bg: '#211812', stone: '#EADBC8', stoneShade: '#C9B49C',
  Y: '#FFD166', L: '#FFF3C4', O: '#F78C2F', R: '#E4501E', B: '#6B3F26',
  node: '#EADBC8', nodeLit: '#F78C2F', dot: '#C27A45', glow: '#3A2618',
};
const px = new Map();
const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px.set(`${x},${y}`, c); };
// Everything but the tile is drawn 2 pixels lower, so the picture sits in the middle.
const DY = 2;
const set = (x, y, c) => put(x, y + DY, c);

// Tile with stepped (pixel) rounded corners.
const cut = [3, 1, 1]; // pixels removed from each side, rows 0..3 from the edge
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const ry = Math.min(y, N - 1 - y), rx = Math.min(x, N - 1 - x);
  if (ry < cut.length && rx < cut[ry]) continue;
  put(x, y, C.bg);
}

// Warm glow inside the hearth (filled, not dithered).
for (let y = 9; y <= 23; y++) for (let x = 12; x <= 19; x++) {
  if (y > 14 || Math.hypot(x - 15.5, y - 14.5) < 4.7) set(x, y, C.glow);
}

// Connections: dotted lines from each device to the hearth.
const dots = [
  [15, 5], [16, 5], [15, 7], [16, 7],                   // top
  [7, 7], [9, 9],                                        // top left
  [24, 7], [22, 9],                                      // top right
  [5, 16], [7, 16], [5, 17], [7, 17],                    // left
  [26, 16], [24, 16], [26, 17], [24, 17],                // right
];
for (const [x, y] of dots) set(x, y, C.dot);

// Devices: little 4x3 screens (top), 3x3 boxes (sides), lit centre.
const device = (x0, y0, w, h) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, C.node);
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) set(x, y, C.nodeLit);
};
device(14, 1, 4, 3);   // top: a screen
device(4, 4, 3, 3);    // top left
device(25, 4, 3, 3);   // top right
device(1, 15, 3, 4);   // left: a phone
device(28, 15, 3, 4);  // right: a phone

// The hearth: a two-pixel arch on legs.
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const d = Math.hypot(x - 15.5, y - 14.5);
  if (y <= 14 && x >= 10 && x <= 21 && d >= 4.7 && d <= 6.75) set(x, y, C.stone);
}
for (let y = 14; y <= 23; y++) { set(10, y, C.stone); set(11, y, C.stoneShade); set(20, y, C.stoneShade); set(21, y, C.stone); }
// Hearthstone.
for (let x = 8; x <= 23; x++) { set(x, 24, C.stone); set(x, 25, C.stoneShade); }

// The fire.
const fire = {
  12: { 16: 'Y' },
  13: { 15: 'Y', 16: 'O' },
  14: { 15: 'O', 16: 'O', 18: 'Y' },
  15: { 14: 'O', 15: 'O', 16: 'Y', 17: 'O', 18: 'O' },
  16: { 14: 'O', 15: 'Y', 16: 'Y', 17: 'O', 18: 'O' },
  17: { 13: 'R', 14: 'O', 15: 'Y', 16: 'L', 17: 'Y', 18: 'O' },
  18: { 13: 'R', 14: 'O', 15: 'Y', 16: 'L', 17: 'Y', 18: 'O' },
  19: { 13: 'R', 14: 'O', 15: 'L', 16: 'L', 17: 'Y', 18: 'R' },
  20: { 13: 'R', 14: 'O', 15: 'Y', 16: 'L', 17: 'O', 18: 'R' },
  21: { 13: 'R', 14: 'R', 15: 'O', 16: 'O', 17: 'R', 18: 'R' },
  22: { 14: 'R', 15: 'R', 16: 'R', 17: 'R' },
  23: { 13: 'B', 14: 'B', 15: 'B', 16: 'B', 17: 'B', 18: 'B' },
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
