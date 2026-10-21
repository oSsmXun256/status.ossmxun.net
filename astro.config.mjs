import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://status.ossmxun.net',
  output: 'static',
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
});
