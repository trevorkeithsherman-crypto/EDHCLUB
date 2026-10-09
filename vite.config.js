import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        table: resolve(__dirname, 'table.html'),
        decks: resolve(__dirname, 'decks.html'),
      },
    },
  },
});
