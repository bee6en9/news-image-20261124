// The World Daily — 24 November 2026
// One-page newspaper drawn entirely in code (Node 22 stdlib only, no network).
// Text is rendered from a bitmap atlas (font.json) rasterised from Liberation
// Serif / Liberation Sans — real serif headlines, clean sans decks, no pixel font.
// Deterministic: fixed layout, fixed strings, no Date/random anywhere.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
const CREAM = [247, 241, 227];
const PAPER = [252, 248, 238];
const INK = [26, 23, 18];
const RED = [163, 22, 33];
const RED_DK = [122, 14, 24];
const BLUE = [31, 78, 121];
const GOLD = [183, 121, 31];
const GREEN = [46, 125, 79];
const TEAL = [14, 124, 123];
const BROWN = [122, 74, 33];
const GREY = [90, 84, 72];
const LINE = [190, 178, 152];
const OCEAN = [207, 227, 239];
const LAND = [230, 217, 184];

// ---------------------------------------------------------------- pixels
const buf = new Uint8Array(W * H * 3);
function fill(c: number[]) {
  for (let i = 0; i < W * H; i++) { buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2]; }
}
// clip region for scene art: [x0, y0, x1, y1) — full canvas by default.
// drawCard narrows it to the scene frame so art with negative offsets
// (chen tower, quasar beam, dow blocks) cannot bleed onto the card above.
let clipX0 = 0, clipY0 = 0, clipX1 = W, clipY1 = H;
function px(x: number, y: number, c: number[]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  if (x < clipX0 || y < clipY0 || x >= clipX1 || y >= clipY1) return;
  const i = (y * W + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function blend(x: number, y: number, c: number[], a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  if (x < clipX0 || y < clipY0 || x >= clipX1 || y >= clipY1) return;
  if (a > 1) a = 1;
  const i = (y * W + x) * 3;
  buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
}
function rect(x: number, y: number, w: number, h: number, c: number[]) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(xx, yy, c);
}
function hline(x: number, y: number, w: number, c: number[], t = 1) { rect(x, y, w, t, c); }
function vline(x: number, y: number, h: number, c: number[], t = 1) { rect(x, y, t, h, c); }
function circle(cx: number, cy: number, r: number, c: number[]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      if (dx * dx + dy * dy <= r * r) px(x, y, c);
    }
}
function circleOutline(cx: number, cy: number, r: number, c: number[]) {
  for (let a = 0; a < Math.PI * 2; a += 0.02) px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c);
}
function poly(points: number[][], c: number[]) {
  // scanline fill
  let minY = 1e9, maxY = -1e9;
  for (const p of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) px(x, y, c);
  }
}
function tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: number[]) {
  poly([[x1, y1], [x2, y2], [x3, y3]], c);
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: number[]) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx + 0.5) / rx, dy = (y - cy + 0.5) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c);
    }
}

// ---------------------------------------------------------------- PNG out
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function writePng(path: string) {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

// ---------------------------------------------------------------- font atlas
const FONT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'font.json'), 'utf8'));
const glyphCache = new Map<string, any>();
function glyph(face: string, ch: string): any {
  const key = face + '|' + ch;
  let g = glyphCache.get(key);
  if (g) return g;
  const f = FONT[face];
  const raw = f.glyphs[ch] ?? f.glyphs['?'];
  const bytes = raw.data ? inflateSync(Buffer.from(raw.data, 'base64')) : new Uint8Array(0);
  g = { w: raw.w, h: raw.h, xoff: raw.xoff, yoff: raw.yoff, adv: raw.adv, px: bytes };
  glyphCache.set(key, g);
  return g;
}
function textW(text: string, face: string, size: number, tracking = 0): number {
  const s = size / FONT[face].size;
  let w = 0;
  for (const ch of text) { w += glyph(face, ch).adv * s + tracking; }
  return w - (text.length ? tracking : 0);
}
function drawGlyph(face: string, ch: string, x: number, baselineY: number, size: number, color: number[]) {
  const g = glyph(face, ch);
  if (!g.w || !g.h) return;
  const s = size / FONT[face].size;
  const asc = FONT[face].ascent;
  const dw = g.w * s, dh = g.h * s;
  // PIL textbbox is measured from the anchor top (ascent line), not the
  // baseline: the glyph bbox top sits at baseline - ascent + yoff.
  const x0 = Math.floor(x + g.xoff * s), y0 = Math.floor(baselineY + (g.yoff - asc) * s);
  const x1 = Math.ceil(x0 + dw), y1 = Math.ceil(y0 + dh);
  for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) {
    for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
      const sx = (xx + 0.5 - x0) / s - 0.5, sy = (yy + 0.5 - y0) / s - 0.5;
      const fx = Math.max(0, Math.min(g.w - 1.001, sx)), fy = Math.max(0, Math.min(g.h - 1.001, sy));
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const ax = fx - ix, ay = fy - iy;
      const at = (pxx: number, pyy: number) => g.px[pyy * g.w + pxx] / 255;
      const v = at(ix, iy) * (1 - ax) * (1 - ay) + at(Math.min(g.w - 1, ix + 1), iy) * ax * (1 - ay)
        + at(ix, Math.min(g.h - 1, iy + 1)) * (1 - ax) * ay + at(Math.min(g.w - 1, ix + 1), Math.min(g.h - 1, iy + 1)) * ax * ay;
      if (v > 0.02) blend(xx, yy, color, v);
    }
  }
}
function drawText(text: string, face: string, size: number, x: number, baselineY: number, color: number[], opts: { align?: string; tracking?: number } = {}) {
  const tr = opts.tracking ?? 0;
  let cx = x;
  const w = textW(text, face, size, tr);
  if (opts.align === 'center') cx = x - w / 2;
  else if (opts.align === 'right') cx = x - w;
  const s = size / FONT[face].size;
  for (const ch of text) {
    drawGlyph(face, ch, cx, baselineY, size, color);
    cx += glyph(face, ch).adv * s + tr;
  }
  return w;
}
function wrap(text: string, face: string, size: number, maxW: number, tracking = 0): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (textW(t, face, size, tracking) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawPara(text: string, face: string, size: number, x: number, yTop: number, maxW: number, color: number[], lh = 1.25, maxLines = 99, tracking = 0): number {
  const lines = wrap(text, face, size, maxW, tracking).slice(0, maxLines);
  const asc = FONT[face].ascent / FONT[face].size * size;
  lines.forEach((ln, i) => drawText(ln, face, size, x, yTop + asc + i * size * lh, color, { tracking }));
  return lines.length;
}

// ---------------------------------------------------------------- scenes
// Flat, specific scene per story — drawn in code, never a single abstract icon.
function clipRect(x: number, y: number, w: number, h: number, fn: () => void) {
  fn();
}
function scene(kind: string, x: number, y: number, w: number, h: number) {
  const sky = (c: number[]) => rect(x, y, w, h, c);
  const R = (rx: number, ry: number, rw: number, rh: number, c: number[]) => rect(x + rx, y + ry, rw, rh, c);
  const E = (cx: number, cy: number, rx: number, ry: number, c: number[]) => ellipse(x + cx, y + cy, rx, ry, c);
  const T = (a: number[], b: number[], c2: number[], c: number[]) =>
    tri(x + a[0], y + a[1], x + b[0], y + b[1], x + c2[0], y + c2[1], c);
  if (kind === 'gaza') {
    sky([216, 199, 168]);
    R(0, h - 26, w, 26, [120, 104, 82]);
    R(8, h - 58, 26, 32, [90, 78, 62]); R(40, h - 48, 20, 22, [104, 90, 70]); R(66, h - 66, 30, 40, [82, 70, 56]);
    R(120, h - 52, 24, 26, [96, 83, 66]); R(150, h - 44, 34, 18, [110, 96, 74]);
    E(w * 0.62, 26, 26, 12, [150, 142, 128]); E(w * 0.68, 18, 20, 10, [168, 160, 146]);
    E(w * 0.62, 40, 14, 22, [120, 114, 104]);
    T([w * 0.58, 46], [w * 0.68, 46], [w * 0.63, 30], [232, 120, 60]);
    R(w * 0.2, h - 14, 60, 4, [60, 52, 40]);
  } else if (kind === 'zaporizhzhia') {
    sky([24, 38, 66]);
    for (let i = 0; i < 14; i++) { const sx = (i * 37) % w, sy = (i * 53) % 26 + 4; circle(x + sx, y + sy, 1, [240, 230, 200]); }
    R(14, h - 62, 60, 62, [52, 58, 78]); R(84, h - 48, 44, 48, [44, 50, 68]); R(136, h - 58, 52, 58, [58, 64, 84]);
    for (let wy = 0; wy < 4; wy++) for (let wx = 0; wx < 4; wx++) R(20 + wx * 13, h - 56 + wy * 13, 7, 8, [232, 196, 90]);
    T([150, h - 58], [188, h - 58], [169, h - 70], [58, 64, 84]);
    E(169, h - 62, 12, 8, [240, 140, 40]); E(169, h - 70, 8, 6, [250, 190, 80]);
    E(158, h - 74, 9, 5, [140, 140, 148]); E(180, h - 72, 8, 4, [130, 130, 138]);
    R(0, h - 8, w, 8, [18, 28, 48]);
  } else if (kind === 'markets') {
    sky([214, 232, 214]);
    R(0, h - 18, w, 18, [46, 90, 60]);
    const pts = [[10, h - 30], [40, h - 44], [70, h - 38], [100, h - 52], [130, h - 46], [160, h - 58], [188, h - 62]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const px2 = ax + (bx - ax) * s / steps, py2 = ay + (by - ay) * s / steps;
        rect(x + px2 - 1.5, y + py2 - 1.5, 3, 3, [20, 110, 60]);
      }
    }
    T([172, h - 70], [196, h - 70], [184, h - 52], [20, 130, 70]);
    R(24, h - 52, 8, 22, [20, 110, 60]); R(52, h - 44, 8, 14, [200, 60, 50]); R(80, h - 54, 8, 24, [20, 110, 60]);
    R(108, h - 60, 8, 30, [20, 110, 60]); R(136, h - 64, 8, 34, [20, 110, 60]);
    E(178, 14, 10, 10, [240, 200, 60]);
  } else if (kind === 'hanoi') {
    sky([238, 214, 178]);
    R(0, h - 20, w, 20, [120, 96, 70]);
    R(20, 18, 120, 10, [163, 22, 33]); R(24, 28, 6, 26, [90, 70, 50]); R(130, 28, 6, 26, [90, 70, 50]);
    R(34, 40, 92, 22, [240, 226, 200]); R(44, 46, 30, 10, [60, 60, 60]); R(86, 46, 30, 10, [60, 60, 60]);
    E(80, 34, 16, 12, [250, 150, 40]); E(80, 26, 10, 9, [255, 200, 80]); E(70, 38, 8, 6, [240, 110, 30]);
    E(96, 20, 14, 7, [140, 138, 132]); E(108, 12, 10, 5, [160, 158, 150]);
    R(150, h - 30, 26, 30, [40, 80, 50]); E(163, h - 34, 10, 10, [40, 80, 50]);
  } else if (kind === 'solomon') {
    sky([168, 214, 232]);
    E(170, 16, 14, 14, [250, 210, 90]);
    R(0, h - 16, w, 16, [40, 110, 160]);
    E(w / 2, h - 8, 70, 14, [34, 120, 70]);
    R(w / 2 - 2, h - 52, 4, 44, [110, 80, 50]);
    E(w / 2 - 16, h - 52, 16, 5, [30, 110, 60]); E(w / 2 + 16, h - 52, 16, 5, [30, 110, 60]);
    E(w / 2, h - 46, 14, 5, [30, 110, 60]);
    R(30, h - 44, 3, 36, [90, 80, 70]); R(33, h - 44, 26, 14, [0, 90, 160]);
    R(150, h - 44, 3, 36, [90, 80, 70]); R(153, h - 44, 26, 14, [200, 40, 40]);
    circle(x + 40, y + h - 37, 3, [255, 255, 255]); circle(x + 160, y + h - 37, 3, [255, 255, 255]);
  } else if (kind === 'nepal') {
    sky([200, 222, 236]);
    T([0, h - 14], [70, h - 14], [35, 10], [120, 130, 150]);
    T([40, h - 14], [130, h - 14], [85, 4], [90, 105, 130]);
    T([95, h - 14], [w, h - 14], [150, 18], [140, 148, 165]);
    T([72, 16], [98, 16], [85, 4], [250, 250, 250]); T([138, 28], [162, 28], [150, 18], [250, 250, 250]);
    R(20, h - 34, 34, 20, [150, 110, 70]); T([16, h - 34], [58, h - 34], [37, h - 46], [120, 84, 50]);
    R(150, h - 30, 30, 16, [150, 110, 70]); T([146, h - 30], [184, h - 30], [165, h - 40], [120, 84, 50]);
    R(96, 8, 3, 22, [163, 22, 33]); R(110, 12, 3, 16, [163, 22, 33]); R(124, 10, 3, 18, [163, 22, 33]);
  } else if (kind === 'dow') {
    sky([24, 44, 84]);
    R(8, h - 52, 26, 52, [200, 210, 225]); R(40, h - 70, 30, 70, [180, 192, 210]); R(76, h - 44, 22, 44, [210, 218, 230]);
    R(104, h - 82, 34, 82, [190, 200, 218]); R(144, h - 58, 26, 58, [200, 210, 225]); R(172, h - 40, 20, 40, [215, 222, 232]);
    for (let wy = 0; wy < 5; wy++) for (let wx = 0; wx < 3; wx++) R(46 + wx * 9, h - 64 + wy * 12, 5, 6, [250, 210, 90]);
    for (let wy = 0; wy < 6; wy++) for (let wx = 0; wx < 3; wx++) R(110 + wx * 10, h - 76 + wy * 12, 5, 6, [250, 210, 90]);
    T([30, 26], [66, 26], [48, 8], [30, 180, 90]);
    R(0, h - 10, w, 10, [16, 32, 62]);
  } else if (kind === 'riyadh') {
    sky([232, 200, 160]);
    R(0, h - 18, w, 18, [110, 90, 70]);
    R(84, h - 52, 26, 52, [70, 78, 92]); R(80, h - 62, 34, 12, [70, 78, 92]);
    R(88, h - 52, 4, 52, [200, 205, 215]); R(96, h - 52, 4, 52, [200, 205, 215]);
    E(97, 8, 11, 7, [240, 130, 40]); E(108, 4, 6, 4, [250, 180, 80]); E(86, 5, 6, 4, [250, 180, 80]);
    R(20, h - 40, 34, 40, [140, 120, 90]); R(140, h - 34, 40, 34, [150, 128, 96]);
    E(178, 12, 9, 9, [250, 210, 90]);
  } else if (kind === 'cartagena') {
    sky([190, 220, 235]);
    R(0, h - 16, w, 16, [100, 96, 88]);
    R(16, 26, 130, 40, [30, 120, 90]); R(16, 26, 130, 12, [220, 40, 40]);
    R(26, 44, 20, 12, [255, 255, 255]); R(56, 44, 20, 12, [255, 255, 255]); R(86, 44, 20, 12, [255, 255, 255]); R(116, 44, 20, 12, [255, 255, 255]);
    R(0, h - 30, w, 6, [250, 210, 40]);
    for (let i = 0; i < 8; i++) R(6 + i * 26, h - 30, 10, 6, [20, 20, 20]);
    R(160, h - 44, 4, 28, [60, 60, 60]); E(162, h - 48, 8, 8, [60, 60, 60]); E(154, h - 48, 8, 4, [60, 60, 60]); E(170, h - 48, 8, 4, [60, 60, 60]);
    E(60, 12, 10, 6, [255, 255, 255]);
  } else if (kind === 'confidence') {
    sky([232, 226, 200]);
    R(20, h - 26, 18, 26, [31, 78, 121]); R(48, h - 34, 18, 34, [31, 78, 121]); R(76, h - 30, 18, 30, [31, 78, 121]); R(104, h - 42, 18, 42, [46, 125, 79]);
    T([104, 2], [140, 2], [122, 16], [46, 125, 79]);
    R(136, h - 44, 30, 28, [163, 22, 33]); R(143, h - 52, 16, 8, [163, 22, 33]);
    E(178, 16, 11, 11, [240, 200, 60]); circle(x + 178, y + 16, 6, [200, 160, 40]);
    R(0, h - 10, w, 10, [120, 100, 70]);
  } else if (kind === 'senegal') {
    sky([20, 90, 50]);
    R(0, h - 34, w, 12, [250, 210, 60]); R(0, h - 22, w, 12, [220, 40, 40]);
    E(96, h - 44, 16, 16, [250, 210, 90]);
    R(88, 18, 16, 14, [240, 190, 60]); R(82, 20, 6, 8, [240, 190, 60]); R(106, 20, 6, 8, [240, 190, 60]);
    R(84, 14, 24, 5, [240, 190, 60]); R(93, 32, 6, 6, [200, 150, 40]); R(88, 38, 16, 4, [200, 150, 40]);
    E(40, 16, 12, 12, [255, 255, 255]); E(150, 12, 9, 9, [255, 255, 255]);
    R(0, h - 10, w, 10, [16, 70, 40]);
  } else if (kind === 'chen') {
    sky([210, 222, 235]);
    R(10, h - 48, 24, 48, [90, 100, 120]); R(40, h - 66, 28, 66, [70, 82, 102]); R(74, h - 40, 20, 40, [100, 112, 130]);
    R(100, 6, 10, 46, [80, 90, 110]); R(98, 2, 14, 5, [80, 90, 110]);
    R(120, h - 54, 26, 54, [90, 100, 120]); R(152, h - 44, 24, 44, [70, 82, 102]);
    circle(x + 158, y + 26, 16, [255, 255, 255]); circleOutline(x + 158, y + 26, 16, [163, 22, 33]);
    R(170, 36, 18, 4, [163, 22, 33]);
    R(0, h - 10, w, 10, [60, 70, 88]);
  } else if (kind === 'quasar') {
    sky([8, 10, 28]);
    for (let i = 0; i < 20; i++) { const sx = (i * 53 + 11) % w, sy = (i * 29 + 7) % h; circle(x + sx, y + sy, i % 5 === 0 ? 2 : 1, [230, 230, 240]); }
    E(w / 2, h / 2 - 4, 10, 10, [255, 240, 180]);
    R(w / 2 - 34, h / 2 - 6, 68, 3, [255, 220, 120]); R(w / 2 - 2, h / 2 - 38, 3, 68, [255, 220, 120]);
    E(w / 2 + 52, h / 2 + 14, 8, 4, [180, 140, 220]); E(w / 2 - 58, h / 2 + 18, 6, 3, [140, 180, 230]);
    R(0, h - 8, w, 8, [16, 18, 44]);
  }
}

// ---------------------------------------------------------------- flags
function flag(x: number, y: number, stripes: number[][]) {
  const h = 9, w = 15, sh = h / stripes.length;
  stripes.forEach((c, i) => rect(x, y + i * sh, w, sh + 0.5, c));
  rect(x, y, w, h, [0, 0, 0]); // placeholder replaced below
  stripes.forEach((c, i) => rect(x + 0.5, y + 0.5 + i * sh, w - 1, sh - 0.5, c));
}
const FLAG_GAZA = [[0, 120, 60], [255, 255, 255], [0, 0, 0]];
const FLAG_UA = [[31, 78, 180], [250, 210, 60]];
const FLAG_KR = [[255, 255, 255], [200, 40, 40]];
const FLAG_VN = [[220, 40, 40], [250, 210, 60]];
const FLAG_SB = [[0, 90, 160], [250, 210, 60]];
const FLAG_NP = [[220, 40, 60], [31, 78, 180]];
const FLAG_US = [[180, 30, 40], [255, 255, 255]];
const FLAG_SA = [[0, 110, 60], [255, 255, 255]];
const FLAG_CO = [[250, 210, 60], [31, 78, 180]];
const FLAG_SN = [[0, 130, 60], [250, 210, 60]];
const FLAG_CN = [[220, 40, 40], [250, 210, 60]];
const FLAG_W = [[31, 78, 121], [255, 255, 255]];

// ---------------------------------------------------------------- map
const MAP = { x: 8, y: 688, w: 1008, h: 100 };
function mapXY(lon: number, lat: number): [number, number] {
  return [MAP.x + (lon + 180) / 360 * MAP.w, MAP.y + (90 - lat) / 180 * MAP.h];
}
const CONTINENTS: number[][][] = [
  [[-168, 66], [-140, 70], [-125, 72], [-110, 73], [-95, 80], [-85, 80], [-75, 72], [-65, 60], [-55, 52], [-60, 45], [-70, 42], [-75, 35], [-80, 32], [-81, 26], [-90, 21], [-97, 16], [-105, 20], [-115, 30], [-125, 40], [-125, 49], [-140, 60], [-155, 58], [-165, 60]],
  [[-80, 10], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18], [-70, -23], [-70, -30], [-72, -37], [-73, -44], [-70, -52], [-65, -55], [-68, -50], [-62, -41], [-58, -34], [-52, -32], [-48, -28], [-40, -20], [-35, -9], [-40, -3], [-50, 0], [-53, 4], [-60, 8], [-68, 11], [-75, 11]],
  [[-10, 36], [-9, 43], [-2, 48], [0, 50], [3, 53], [8, 57], [10, 59], [5, 60], [5, 62], [12, 65], [18, 69], [25, 71], [30, 70], [40, 68], [45, 66], [40, 60], [35, 55], [30, 50], [28, 45], [23, 40], [19, 42], [12, 44], [8, 44], [3, 43], [-2, 37], [-6, 36]],
  [[-6, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [34, 28], [36, 22], [38, 18], [40, 15], [43, 12], [48, 11], [51, 12], [46, 5], [42, 0], [40, -5], [40, -10], [36, -18], [33, -26], [28, -33], [20, -35], [16, -29], [12, -18], [13, -10], [9, -1], [9, 4], [0, 6], [-8, 5], [-13, 8], [-17, 15], [-17, 21], [-15, 27], [-10, 31]],
  [[30, 70], [40, 68], [50, 69], [60, 70], [70, 72], [80, 73], [90, 75], [100, 77], [110, 76], [120, 73], [130, 72], [140, 72], [150, 70], [160, 69], [170, 67], [178, 65], [170, 60], [162, 56], [158, 52], [150, 59], [142, 55], [140, 50], [135, 43], [130, 38], [127, 35], [122, 32], [120, 28], [115, 23], [110, 20], [108, 12], [105, 9], [100, 8], [98, 12], [95, 16], [92, 21], [88, 22], [85, 19], [80, 15], [77, 8], [75, 10], [72, 20], [68, 23], [65, 25], [60, 25], [57, 27], [54, 27], [52, 29], [50, 30], [48, 30], [44, 29], [42, 32], [40, 36], [36, 36], [33, 40], [30, 45], [28, 45], [30, 50], [35, 55], [40, 60]],
  [[113, -22], [114, -30], [115, -34], [118, -35], [124, -33], [130, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
  [[-45, 60], [-40, 65], [-32, 68], [-25, 70], [-20, 74], [-25, 78], [-35, 80], [-50, 78], [-58, 74], [-55, 70], [-52, 64], [-48, 60]],
];
function drawMap(pins: { n: number; lon: number; lat: number; dx: number; dy: number; label?: string; lx?: number; ly?: number }[]) {
  rect(MAP.x, MAP.y, MAP.w, MAP.h, OCEAN);
  for (const cont of CONTINENTS) poly(cont.map(([lo, la]) => mapXY(lo, la)), LAND);
  // graticule
  for (let lo = -150; lo <= 150; lo += 30) { const [x1] = mapXY(lo, 85); vline(x1, MAP.y, MAP.h, [255, 255, 255], 1); }
  // deep-space star for pin 13, top-left sky patch
  rect(MAP.x + 4, MAP.y + 4, 96, 22, [10, 14, 34]);
  circle(MAP.x + 16, MAP.y + 15, 4, [255, 240, 180]);
  drawText('13 · DEEP SPACE', 'sansBold', 8, MAP.x + 26, MAP.y + 18, [255, 255, 255]);
  for (const p of pins) {
    const [px2, py2] = mapXY(p.lon, p.lat);
    const cx = px2 + p.dx, cy = py2 + p.dy;
    circle(cx, cy, 8, RED);
    circleOutline(cx, cy, 8, [255, 255, 255]);
    drawText(String(p.n), 'sansBold', 9, cx, cy + 3.2, [255, 255, 255], { align: 'center' });
    if (p.label) drawText(p.label, 'sansBold', 8.5, cx + (p.lx ?? 10), cy + (p.ly ?? 3), INK);
  }
}
function numBadge(x: number, y: number, n: number, r = 9) {
  circle(x, y, r, RED);
  circleOutline(x, y, r, [255, 255, 255]);
  drawText(String(n), 'sansBold', 10, x, y + 3.5, [255, 255, 255], { align: 'center' });
}
function metaLine(x: number, y: number, n: number, loc: string, region: string, status: string, source: string, fl: number[][], maxW: number) {
  numBadge(x + 9, y + 2, n, 8);
  flag(x + 22, y - 3, fl);
  const t = loc + ' · ' + region + ' — ' + status + ' · ' + source;
  drawText(t, 'sansBold', 8.5, x + 42, y + 5, GREY);
}

// ---------------------------------------------------------------- stories
// All 36 dated Tuesday 24 November 2026 (RESEARCH.md). RAGU items excluded.
type Story = {
  n: number; kind: string; headline: string; deck: string; loc: string; region: string;
  status: string; source: string; flag: number[][]; lon: number; lat: number;
  dx: number; dy: number; label?: string; lx?: number; ly?: number;
};
const HEROES: Story[] = [
  { n: 1, kind: 'gaza', headline: 'Israeli strikes kill at least six in Gaza', deck: 'Strikes hit Khan Younis, including a police post, as the toll rose from three to six. Reuters says the figure may still change.', loc: 'GAZA', region: 'MIDDLE EAST', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_GAZA, lon: 34.5, lat: 31.5, dx: 0, dy: 0, label: 'Gaza', lx: -46 },
  { n: 2, kind: 'zaporizhzhia', headline: 'Russian strike on Zaporizhzhia kills two, wounds 22', deck: 'Two children are among the wounded in the attack on the southern Ukrainian city, officials say.', loc: 'ZAPORIZHZHIA', region: 'EUROPE', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_UA, lon: 35.2, lat: 47.8, dx: 0, dy: 0, label: 'Zaporizhzhia', ly: -14 },
  { n: 3, kind: 'markets', headline: 'Asian stocks surge as Huang returns to lead Nvidia', deck: 'KOSPI jumps 7.5%, Nikkei 4.5% and Taiwan 9.1% in a broad rally across the region\u2019s markets.', loc: 'TOKYO', region: 'ASIA-PACIFIC', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_KR, lon: 139, lat: 35.5, dx: 0, dy: 0, label: 'Tokyo' },
];
const CARDS: Story[] = [
  { n: 4, kind: 'hanoi', headline: 'Gas blast at Hanoi food shop kills six', deck: 'Six people are killed and ten hurt in an explosion at a food shop in the Vietnamese capital.', loc: 'HANOI', region: 'ASIA-PACIFIC', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_VN, lon: 105.8, lat: 21, dx: 0, dy: 0, label: 'Hanoi' },
  { n: 5, kind: 'solomon', headline: 'Solomon Islands ends China security pact', deck: 'Honiara scraps its security deal with Beijing and signs a new agreement with Australia instead.', loc: 'HONIARA', region: 'OCEANIA', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_SB, lon: 160, lat: -9, dx: 0, dy: 0, label: 'Solomon Is.', lx: -80 },
  { n: 6, kind: 'nepal', headline: 'Magnitude 5.6 quake shakes eastern Nepal', deck: 'The tremor is felt in Kathmandu and Bhutan; USGS puts it at 5.3, Nepal\u2019s centre at 5.6.', loc: 'EASTERN NEPAL', region: 'ASIA-PACIFIC', status: 'CONFIRMED', source: 'Xinhua', flag: FLAG_NP, lon: 85, lat: 28, dx: 0, dy: 0, label: 'Nepal' },
  { n: 7, kind: 'dow', headline: 'Dow closes above 50,000 for the first time', deck: 'The Dow gains 0.85% to 50,018.70 while the S&P 500 and Nasdaq fall on the day.', loc: 'NEW YORK', region: 'AMERICAS', status: 'CONFIRMED', source: 'Investopedia', flag: FLAG_US, lon: -74, lat: 40.7, dx: 0, dy: 0, label: 'New York' },
  { n: 8, kind: 'riyadh', headline: 'Houthi strike wounds 11 at Riyadh tower', deck: 'A second strike in a week hits the PIF Tower; the wounded include Saudis, Indians, Nepalis and Egyptians.', loc: 'RIYADH', region: 'MIDDLE EAST', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_SA, lon: 46.7, lat: 24.6, dx: 0, dy: 0, label: 'Riyadh', ly: 15 },
  { n: 9, kind: 'cartagena', headline: 'Hostage standoff halts flights at Cartagena airport', deck: 'Dozens are held at an \u00c9xito supermarket; landings at Rafael N\u00fa\u00f1ez airport are suspended for about 45 minutes.', loc: 'CARTAGENA', region: 'AMERICAS', status: 'REPORTED', source: 'Reuters', flag: FLAG_CO, lon: -75.5, lat: 10.4, dx: 0, dy: 0, label: 'Cartagena' },
  { n: 10, kind: 'confidence', headline: 'US consumer confidence roars back to 103.3', deck: 'Confidence jumps 11.4 points from October\u2019s 91.9, its highest since January 2025, the Conference Board says.', loc: 'WASHINGTON', region: 'AMERICAS', status: 'CONFIRMED', source: 'Morningstar', flag: FLAG_US, lon: -77, lat: 38.9, dx: -34, dy: 26 },
  { n: 11, kind: 'senegal', headline: 'Senegal reinstated as Africa Cup champions', deck: 'CAS upholds Senegal\u2019s appeal: the 2025 title returns after the final against Morocco.', loc: 'DAKAR', region: 'AFRICA', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_SN, lon: -17.4, lat: 14.7, dx: 0, dy: 0, label: 'Dakar' },
  { n: 12, kind: 'chen', headline: 'China investigates Politburo member Chen Jining', deck: 'The Shanghai party chief is probed for corruption \u2014 the fourth Politburo member investigated since 2025.', loc: 'SHANGHAI', region: 'ASIA-PACIFIC', status: 'CONFIRMED', source: 'Reuters', flag: FLAG_CN, lon: 121.5, lat: 31.2, dx: 0, dy: -14 },
  { n: 13, kind: 'quasar', headline: 'Oldest quasar ever found, 630m years after Big Bang', deck: 'Astronomers spot a record-setting quasar powered by a black hole 360 million times the Sun\u2019s mass.', loc: 'DEEP SPACE', region: 'WORLD', status: 'CONFIRMED', source: 'AP', flag: FLAG_W, lon: 0, lat: 0, dx: 0, dy: 0 },
];
const ALSO: string[] = [
  '14  BYD in talks to buy Ineos car plant in Hambach, France (Reuters)',
  '15  Germany\u2019s military satellite network may cost \u20ac15bn (Reuters)',
  '16  Norway\u2013Ukraine expand DESNA anti-drone cooperation (Reuters)',
  '17  ECB may raise rates in December, Dutch chief says (Reuters)',
  '18  German business sentiment (Ifo) rises to 90.6 in Nov. (Reuters)',
  '19  Houthis within 60 km of Aden; army: city will not fall (Reuters)',
  '20  UK sanctions Houthis and four senior officials (Reported)',
  '21  Libya\u2019s Haftar visits T\u00fcrkiye for first time, meets Erdogan (Reported)',
  '22  DR Congo orders foreign miners to open local units (OkayAfrica)',
  '23  Nigeria police confirm 6 killed in Delta campaign attack (Reported)',
  '24  Amnesty: Ethiopia Alamata strikes must be probed as war crimes (Amnesty)',
  '25  Trump awards Medal of Freedom to Rudy Giuliani (Reuters)',
  '26  Trump pardons Thanksgiving turkeys \u201cFreedom\u201d and \u201cFeathers\u201d (Reuters)',
  '27  Refugees sue to block Trump administration Medicaid cuts (Reuters)',
  '28  WHO chief urges US to lift Cuba fuel blockade; $2m vaccines (Reuters/WHO)',
  '29  China names Shenzhou-24 crew, first Pakistani to Tiangong (Xinhua)',
  '30  Trump set to unveil new tariffs after Section 301 probe (Reuters)',
  '31  North Korea threatens to shut Swiss office in Pyongyang (Reported)',
  '32  Australia threatens Big Tech fines up to 5% of revenue (Reuters)',
  '33  PNG parliament starts Bougainville independence vote (Bus. Melanesia)',
  '34  Sanofi buys Insmed for $41bn, its biggest deal in 20+ years (Sanofi)',
  '35  Champions League: Real Madrid 5\u20131 PSV; Man City 2\u20132 Napoli (UEFA)',
  '36  DeepMind launches \u201cHumanity\u2019s First Exam\u201d of LLMs (Unite.ai)',
];

// ---------------------------------------------------------------- draw
function drawHero(s: Story, x: number, y: number, w: number, h: number) {
  rect(x, y, w, h, PAPER);
  rect(x, y, w, 1, INK); rect(x, y + h - 1, w, 1, INK); rect(x, y, 1, h, INK); rect(x + w - 1, y, 1, h, INK);
  scene(s.kind, x + 1, y + 1, w - 2, 76);
  numBadge(x + 16, y + 16, s.n, 10);
  const hy = y + 80;
  drawPara(s.headline, 'serifBold', 15, x + 10, hy, w - 20, INK, 1.15, 2);
  drawPara(s.deck, 'sans', 10, x + 10, y + 120, w - 20, [58, 52, 44], 1.25, 2);
  metaLine(x + 2, y + h - 10, s.n, s.loc, s.region, s.status, s.source, s.flag, w);
}
function drawCard(s: Story, x: number, y: number, w: number, h: number) {
  rect(x, y, w, h, PAPER);
  rect(x, y, w, 1, INK); rect(x, y + h - 1, w, 1, INK); rect(x, y, 1, h, INK); rect(x + w - 1, y, 1, h, INK);
  // Scene art is clipped to its own frame: several scenes draw shapes with
  // negative offsets (chen tower, quasar beam, dow blocks) that used to bleed
  // over the card above and paint across that card's meta line. Clipping
  // keeps every in-frame pixel identical and removes only the bleed.
  clipX0 = x + 1; clipY0 = y + 1; clipX1 = x + w - 1; clipY1 = y + 53;
  scene(s.kind, x + 1, y + 1, w - 2, 52);
  clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H;
  numBadge(x + 14, y + 14, s.n, 9);
  // Text block re-spaced so no two ink rows ever share a pixel (measured
  // from the font metrics: sans/serif asc 58/64, desc 14/64; the all-caps
  // meta lines have no descenders). Headline (13 pt, lh 1.12) ends ~y+86,
  // deck (9 pt, lh 1.12) ends ~y+107, loc caps y+110..y+116, status caps
  // y+121..y+127, bottom border y+131. Previously the deck ran at lh 1.25
  // and the two 8 pt meta lines sat only 7 px apart (baselines y+121/y+128),
  // so the red status line printed over the grey loc line and over the
  // badge, and the status sat on the bottom border.
  drawPara(s.headline, 'serifBold', 13, x + 8, y + 57, w - 16, INK, 1.12, 2);
  drawPara(s.deck, 'sans', 9, x + 8, y + 87, w - 16, [58, 52, 44], 1.12, 2);
  // Both meta lines start at x+41, clear of badge/flag: loc on the
  // badge/flag row (baseline y+116), status below it (baseline y+127),
  // 11 px apart for an 8 pt face.
  numBadge(x + 10, y + 115, s.n, 7);
  flag(x + 22, y + 109, s.flag);
  drawText(s.loc + ' · ' + s.region, 'sansBold', 8, x + 41, y + 116, GREY);
  drawText(s.status + ' · ' + s.source, 'sansBold', 8, x + 41, y + 127, RED);
}

function main() {
  fill(CREAM);
  // top bar
  rect(0, 0, W, 26, INK);
  drawText('THE WORLD IN ONE DAY', 'sansBold', 11.5, 10, 18, [250, 244, 230], { tracking: 1 });
  drawText('36 STORIES · 7 REGIONS · ALL DATED TUESDAY 24 NOVEMBER 2026', 'sansBold', 10.5, W - 10, 18, [250, 244, 230], { align: 'right', tracking: 0.5 });
  // masthead
  drawText('THE WORLD DAILY', 'serifBold', 58, W / 2, 78, INK, { align: 'center', tracking: 1 });
  hline(8, 88, W - 16, INK, 2); hline(8, 92, W - 16, INK, 1);
  drawText('Tuesday 24 November 2026', 'serifBold', 30, W / 2, 124, RED_DK, { align: 'center' });
  drawText('ONE DAY · EVERY STORY DATED · WIRES READ TO 00:30 UTC, 25 NOVEMBER 2026', 'sans', 10, W / 2, 142, GREY, { align: 'center', tracking: 0.5 });
  // KPI strip — six hard numbers from the day's news
  const kpis: [string, string][] = [
    ['6', 'KILLED IN GAZA\nAT LEAST · REUTERS'],
    ['2 · 22', 'KILLED · WOUNDED\nZAPORIZHZHIA'],
    ['6', 'KILLED IN HANOI\nGAS BLAST · 10 HURT'],
    ['50,018', 'DOW ABOVE 50,000\nFIRST TIME EVER'],
    ['103.3', 'US CONSUMER\nCONFIDENCE · NOV.'],
    ['97.7%', 'BOUGAINVILLE YES\n2019 REFERENDUM'],
  ];
  const kw = 166, kgap = 4;
  kpis.forEach(([num, lab], i) => {
    const x = 8 + i * (kw + kgap), y = 150;
    rect(x, y, kw, 36, PAPER);
    rect(x, y, kw, 1, INK); rect(x, y + 35, kw, 1, INK); rect(x, y, 1, 36, INK); rect(x + kw - 1, y, 1, 36, INK);
    drawText(num, 'serifBold', 23, x + 8, y + 25, RED);
    const lw = textW(num, 'serifBold', 23) + 14;
    const lines = lab.split('\n');
    drawText(lines[0], 'sansBold', 8.5, x + lw, y + 15, INK);
    drawText(lines[1], 'sansBold', 8.5, x + lw, y + 27, GREY);
  });
  // region bar — counts sum to 36
  const regions: [string, number, number[]][] = [
    ['EUROPE', 6, BLUE], ['MIDDLE EAST', 5, RED], ['AMERICAS', 7, GREEN],
    ['ASIA-PACIFIC', 7, GOLD], ['AFRICA', 4, BROWN], ['OCEANIA', 3, TEAL], ['WORLD', 4, [68, 64, 58]],
  ];
  let rx = 8;
  for (const [name, count, col] of regions) {
    const w = Math.round(count / 36 * 1008);
    rect(rx, 190, w - 2, 20, col);
    drawText(name + ' · ' + count, 'sansBold', 10, rx + (w - 2) / 2, 204, [255, 255, 255], { align: 'center' });
    rx += w;
  }
  // heroes
  HEROES.forEach((s, i) => drawHero(s, 8 + i * 340, 214, 328, 158));
  // grid header
  drawText('THE DAY IN BRIEF — 10 MORE STORIES', 'sansBold', 12, 8, 388, INK, { tracking: 0.5 });
  hline(8, 394, W - 16, INK, 1);
  // grid 5 x 2
  CARDS.forEach((s, i) => {
    const col = i % 5, row = Math.floor(i / 5);
    drawCard(s, 8 + col * 204, 400 + row * 138, 198, 132);
  });
  // map header + map
  drawText('WHERE IT HAPPENED — 13 STORIES PINNED', 'sansBold', 12, 8, 678, INK, { tracking: 0.5 });
  hline(8, 684, W - 16, INK, 1);
  drawMap([...HEROES, ...CARDS].filter(s => s.n !== 13).map(s => ({ n: s.n, lon: s.lon, lat: s.lat, dx: s.dx, dy: s.dy, label: s.label, lx: s.lx, ly: (s as any).ly })));
  // ALSO list
  drawText('ALSO ON TUESDAY — 23 MORE STORIES, EVERY ONE DATED 24 NOVEMBER 2026', 'sansBold', 12, 8, 800, INK, { tracking: 0.5 });
  hline(8, 806, W - 16, INK, 1);
  ALSO.forEach((item, i) => {
    const col = i < 12 ? 0 : 1, row = i < 12 ? i : i - 12;
    drawText(item, 'sans', 9.5, 10 + col * 508, 819 + row * 11, INK);
  });
  // DATE CHECK
  const dy = 944;
  rect(8, dy, W - 16, 62, [255, 240, 238]);
  rect(8, dy, W - 16, 2, RED); rect(8, dy + 60, W - 16, 2, RED); rect(8, dy, 2, 62, RED); rect(W - 10, dy, 2, 62, RED);
  drawText('DATE CHECK — WHAT WE LEFT OUT: NOT 24 NOVEMBER', 'sansBold', 11, 16, dy + 14, RED_DK);
  drawText('Abu Dhabi talks did NOT happen on 24 Nov \u2014 last round was 10\u201311 Nov; Kremlin on 24 Nov: no date set for the next round.', 'sans', 10, 16, dy + 28, INK);
  drawText('US states\u2019 lawsuit against SpaceX over Grok was filed on Monday 23 Nov, not Tuesday 24 Nov. COP31 ended Sunday 22 Nov; Norway\u2019s court ruling was 13 Nov.', 'sans', 10, 16, dy + 40, INK);
  drawText('Treason charges against Listyo Sigit were announced on the night of 23 Nov. Cutoff: wires read to 00:30 UTC, 25 Nov 2026.', 'sans', 10, 16, dy + 52, INK);
  // footer
  drawText('Sources: Reuters · AP · Xinhua · UEFA · Sanofi · WHO · Conference Board · Amnesty International · OkayAfrica · Business Melanesia — The World Daily', 'sans', 9, W / 2, 1017, GREY, { align: 'center' });

  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(out, { recursive: true });
  writePng(join(out, 'entry.png'));
}
main();
