import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname, 'mainnet-app'),
  plugins: [react()],
  // A separate, independently reviewed release change must remove this alias and activate the source gate.
  resolve: { alias: { '@': path.resolve(__dirname, 'src'),
    '../src/grant/mainnetSender': path.resolve(__dirname, 'src/grant/mainnetSender.disabled.ts'),
    '../src/grant/useMainnetWalletPort': path.resolve(__dirname, 'src/grant/useMainnetWalletPort.disabled.ts') }, dedupe: ['react', 'react-dom'] },
  build: { outDir: path.resolve(__dirname, 'dist-mainnet-review'), emptyOutDir: true },
})
