import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        sourcemap: true,
        minify: false,  // Disable minification - it breaks Map cache
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                dev: resolve(__dirname, 'dev.html')
            }
        }
    }
});