import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Local release-candidate build only. Real sender is included; source write gates remain disabled. */
export default defineConfig({
  root: path.resolve(__dirname, 'mainnet-app'),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') }, dedupe: ['react', 'react-dom'] },
  build: {
    outDir: path.resolve(__dirname, 'dist-mainnet-release-candidate'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { treeshake: false },
  },
})
