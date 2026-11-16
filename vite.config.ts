import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import preact from '@preact/preset-vite';
import { type Plugin, defineConfig } from 'vite';

/**
 * Собирает service worker: подставляет в web/sw.js список файлов оболочки
 * приложения и версию кэша (хеш от содержимого сборки).
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'diary-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) walk(full);
          else if (item.name !== 'sw.js') files.push('/' + path.relative(outDir, full).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      files.sort();
      const hash = crypto.createHash('sha256');
      for (const f of files) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
      const precache = files.map((f) => (f === '/index.html' ? '/' : f));
      const source = fs
        .readFileSync(path.resolve(import.meta.dirname, 'web/sw.js'), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace("'__PRECACHE__'", JSON.stringify(precache));
      fs.writeFileSync(path.join(outDir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [preact(), serviceWorker()],
  build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
