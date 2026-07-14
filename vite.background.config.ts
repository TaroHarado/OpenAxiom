import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    codeSplitting: false,
    lib: {
      entry: 'src/background.ts',
      formats: ['es'],
      fileName: () => 'background.js'
    },
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => `chunks/${chunk.name.replace(/^_+/, 'chunk-')}-[hash].js`,
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
