import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { createManifest, workerSource } from './config';

export function observatoryPwa(): Plugin {
  let config: ResolvedConfig;
  let manifestVersion = '';
  return {
    name: 'life-observatory-pwa',
    configResolved(value) { config = value; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== server.config.base + 'manifest.webmanifest') return next();
        response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        response.end(JSON.stringify(createManifest(server.config.base)));
      });
    },
    generateBundle(_, bundle) {
      if (config.build.ssr) return;
      const manifest = JSON.stringify(createManifest(config.base), null, 2);
      const hash = createHash('sha256').update('life-pwa-v1').update(manifest).update(readFileSync(join(config.root, 'index.html')));
      const assets: string[] = [];
      for (const [name, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name.endsWith('.map')) continue;
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source);
        if (name.startsWith('assets/') && /\.(js|css)$/.test(name)) assets.push(name);
      }
      const shell = [...assets, 'icons/orbit-192.png', 'icons/orbit-512.png', 'icons/apple-touch-icon.png', 'favicon.svg', 'manifest.webmanifest'];
      for (const file of shell.filter(file => !file.startsWith('assets/') && file !== 'manifest.webmanifest')) hash.update(readFileSync(join(config.publicDir, file)));
      hash.update(workerSource(config.base, 'build-version', shell));
      const version = hash.digest('hex').slice(0, 20);
      manifestVersion = version;
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest + '\n' });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(config.base, version, shell) });
    },
    writeBundle(output) {
      if (config.build.ssr || !manifestVersion) return;
      // Vite emits HTML after user generateBundle hooks, so version its link here.
      const path = resolve(config.root, output.dir ?? config.build.outDir, 'index.html');
      const html = readFileSync(path, 'utf8');
      writeFileSync(path, html.replace(/manifest\.webmanifest(?:\?v=[a-f0-9]+)?"/, `manifest.webmanifest?v=${manifestVersion}"`));
    },
  };
}
