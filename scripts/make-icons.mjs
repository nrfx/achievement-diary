// Перегенерация PNG-иконок из web/public/icons/icon.svg: `node scripts/make-icons.mjs`
// Нужен Playwright с Chromium (в зависимости проекта не входит — иконки уже лежат в репозитории).
import fs from 'node:fs';
import { chromium } from 'playwright';

const dir = new URL('../web/public/icons/', import.meta.url).pathname;
const svg = fs.readFileSync(dir + 'icon.svg', 'utf8');
// Для maskable и apple-touch — без скруглений и с полями: ОС обрежет сама.
const full = svg.replace('rx="112"', 'rx="0"');
const targets = [
  ['icon-192.png', 192, svg, 1],
  ['icon-512.png', 512, svg, 1],
  ['apple-touch-icon.png', 180, full, 1],
  ['icon-maskable-512.png', 512, full, 0.8],
];
const browser = await chromium.launch();
for (const [name, size, source, scale] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<body style="margin:0;background:${scale === 1 && source === svg ? 'transparent' : '#3f6b57'};display:grid;place-items:center;height:100vh">
       <div style="width:${inner}px;height:${inner}px">${source}</div></body>`,
  );
  await page.screenshot({ path: dir + name, omitBackground: scale === 1 && source === svg });
  await page.close();
}
await browser.close();
