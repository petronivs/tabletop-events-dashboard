import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const dark = [24, 61, 53];
const light = [215, 236, 178];
const polygons = [
  [[32, 10], [52, 22], [52, 45], [32, 57], [12, 45], [12, 22]],
  [[32, 15], [47, 24], [32, 33], [17, 24]],
  [[17, 30], [29, 37], [29, 51], [17, 44]],
  [[35, 37], [47, 30], [47, 44], [35, 51]],
];
const inside = (x, y, points) => {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
};
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
};

mkdirSync('public/icons', { recursive: true });
for (const [file, size, maskable] of [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true],
]) {
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = [0, 0, 0];
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const scale = maskable ? .72 : 1;
        const px = (((x + (sx + .5) / 2) / size * 64) - 32) / scale + 32;
        const py = (((y + (sy + .5) / 2) / size * 64) - 32) / scale + 32;
        let color = inside(px, py, polygons[0]) ? dark : light;
        if (polygons.slice(1).some((points) => inside(px, py, points))) color = light;
        if ([[32, 24, 3], [23, 40, 2], [41, 40, 2]].some(([cx, cy, r]) => (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2)) color = dark;
        for (let c = 0; c < 3; c++) rgb[c] += color[c] / 4;
      }
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      rgb.forEach((value, c) => { pixels[offset + c] = Math.round(value); });
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(`public/icons/${file}`, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
