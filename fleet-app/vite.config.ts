import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // La vue 3D (three.js) forme un fichier séparé d'environ 580 ko, chargé seulement sur sa page.
  build: { chunkSizeWarningLimit: 700 },
});
