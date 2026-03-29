// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://devarkadiA.github.io',
  base: '/distributed-consensus-learning',
  vite: {
    plugins: [tailwindcss()],
  },
});
