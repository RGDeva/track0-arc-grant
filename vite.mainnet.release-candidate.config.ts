import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Local B2 activation build only. Real sender is included; never deploy without Decision C. */
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
