import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  server: {
    host: true,
    port: 5173
  },
  envDir: '../',
  define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
});
