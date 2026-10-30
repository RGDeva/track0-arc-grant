import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'mainnet-app'),
  plugins: [react()],
  // Public review build excludes signing code; B2's private build is a separate, unpublished artifact.
  resolve: { alias: { '@': path.resolve(__dirname, 'src'),
    '../src/grant/mainnetSender': path.resolve(__dirname, 'src/grant/mainnetSender.disabled.ts'),
    '../src/grant/useMainnetWalletPort': path.resolve(__dirname, 'src/grant/useMainnetWalletPort.disabled.ts') }, dedupe: ['react', 'react-dom'] },
  build: { outDir: path.resolve(__dirname, 'dist-mainnet-review'), emptyOutDir: true },
})
