import {defineConfig} from 'vite';
export default defineConfig({build:{target:'es2022',emptyOutDir:false,copyPublicDir:false,rollupOptions:{input:'src/background.ts',output:{entryFileNames:'background.js',format:'es',inlineDynamicImports:true}}}});
