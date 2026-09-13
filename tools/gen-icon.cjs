// 生成 build/icon.png / build/icon.ico / build/tray.png，纯 Node 手搓 PNG/ICO，运行：node tools/gen-icon.cjs
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

let SIZE = 256;
let px = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a) {
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// 圆角深色底，四角透明
function drawBackground() {
  const radius = 56;
  const bg = [0x0b, 0x0d, 0x11];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = Math.min(Math.max(x, radius), SIZE - 1 - radius);
      const cy = Math.min(Math.max(y, radius), SIZE - 1 - radius);
      const inCorner = (x < radius || x >= SIZE - radius) && (y < radius || y >= SIZE - radius);
      const dx = x - cx, dy = y - cy;
      const d = inCorner ? Math.sqrt(dx * dx + dy * dy) : 0;
      if (!inCorner || d <= radius) setPixel(x, y, bg[0], bg[1], bg[2], 255);
    }
  }
}

function inPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 等距立方体，翡翠绿三个明度面
function drawCube() {
  const cx = SIZE / 2, cy = SIZE / 2 - 4, r = 74;
  const w = r * 0.866;
  const top = [cx, cy - r], tr = [cx + w, cy - r / 2], br = [cx + w, cy + r / 2];
  const bottom = [cx, cy + r], bl = [cx - w, cy + r / 2], tl = [cx - w, cy - r / 2];
  const center = [cx, cy];
  const faces = [
    { poly: [top, tr, center, tl], c: [0x4c, 0xe0, 0xa7] },
    { poly: [tr, br, bottom, center], c: [0x10, 0xb9, 0x81] },
    { poly: [tl, center, bottom, bl], c: [0x0a, 0x8f, 0x66] },
  ];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      for (const f of faces) {
        if (inPolygon({ x: x + 0.5, y: y + 0.5 }, f.poly)) setPixel(x, y, f.c[0], f.c[1], f.c[2], 255);
      }
    }
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 每行行首一个 filter 字节，全用 0（None）
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 4)] = 0;
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (1 + SIZE * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO 里直接塞一条 256 的 PNG（Vista 之后都认）
function wrapICO(png) {
  const out = Buffer.alloc(22 + png.length);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(1, 4);
  out[6] = 0; // 256 写 0
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out.writeUInt16LE(1, 10);
  out.writeUInt16LE(32, 12);
  out.writeUInt32LE(png.length, 14);
  out.writeUInt32LE(22, 18);
  png.copy(out, 22);
  return out;
}

function render(size) {
  SIZE = size;
  px = new Uint8Array(SIZE * SIZE * 4);
  drawBackground();
  drawCube();
  return encodePNG();
}

const iconPng = render(256);
// 托盘小图标单独出 32px（Windows 托盘直接缩 256px 会糊）
const trayPng = render(32);
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), iconPng);
fs.writeFileSync(path.join(buildDir, "icon.ico"), wrapICO(iconPng));
fs.writeFileSync(path.join(buildDir, "tray.png"), trayPng);
console.log(`图标已生成：build/icon.png（${iconPng.length} 字节）+ build/icon.ico + build/tray.png（${trayPng.length} 字节）`);
