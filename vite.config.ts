import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { name: string };
const PUZZLE_KEY = pkg.name;
const PUZZLES_FILE = resolve(process.cwd(), 'src/data/puzzles.json');

/**
 * Exposes src/data/puzzles.json as `virtual:puzzles`, XOR-obfuscated + base64.
 * Not security: it only prevents reading tomorrow's answer in plain text in the bundle.
 */
function puzzlesPlugin(): Plugin {
  const VIRTUAL_ID = 'virtual:puzzles';
  const RESOLVED_ID = '\0' + VIRTUAL_ID;
  return {
    name: 'daily-puzzles',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(PUZZLES_FILE);
      const json = JSON.stringify(JSON.parse(readFileSync(PUZZLES_FILE, 'utf8')));
      const key = Buffer.from(PUZZLE_KEY, 'utf8');
      const bytes = Buffer.from(json, 'utf8');
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length];
      return `export default ${JSON.stringify(bytes.toString('base64'))};`;
    },
    handleHotUpdate({ file, server }) {
      if (file === PUZZLES_FILE) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({
  plugins: [puzzlesPlugin()],
  define: { __PUZZLE_KEY__: JSON.stringify(PUZZLE_KEY) },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
