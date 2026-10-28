import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Private, non-deployable artifact for human inspection of the real sender wiring.
 * The source release gate remains hard-disabled. No production deployment uses this config.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'mainnet-app'),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') }, dedupe: ['react', 'react-dom'] },
  build: {
    outDir: path.resolve(__dirname, 'dist-mainnet-activation-review'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: { treeshake: false },
  },
})
