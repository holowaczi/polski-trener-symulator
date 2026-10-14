import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// względna ścieżka, żeby build działał też na GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
  // numer wersji ma jedno źródło: package.json
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
