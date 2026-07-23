import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    codeSplitting: false,
    lib: {
      entry: 'src/content.tsx',
      name: 'TrenchContentScript',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => `chunks/${chunk.name.replace(/^_+/, 'chunk-')}-[hash].js`,
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
