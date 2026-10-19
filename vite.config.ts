import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Serves the user's ROM (any *.gba in the project root) at /rom.gba without
// copying it into the build. The ROM never becomes part of the bundle.
function romServer(): Plugin {
  return {
    name: 'rom-server',
    configureServer(server) {
      server.middlewares.use('/rom.gba', (_req, res) => {
        const root = server.config.root;
        const rom = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'));
        if (!rom) {
          res.statusCode = 404;
          res.end('No .gba file found in project root');
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(path.join(root, rom)).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [romServer()],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  optimizeDeps: { include: ['three'] },
  test: { include: ['tests/*.test.ts'], testTimeout: 60000 },
} as any);
