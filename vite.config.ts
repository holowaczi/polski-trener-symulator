import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// względna ścieżka, żeby build działał też na GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
})
