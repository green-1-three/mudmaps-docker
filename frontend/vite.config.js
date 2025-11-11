import { resolve } from 'path'
import { defineConfig } from 'vite'
import { createHtmlPlugin } from 'vite-plugin-html'

export default defineConfig(({ mode, command }) => {
    // Check if running locally (dev server OR NODE_ENV !== production)
    const isLocal = command === 'serve' || process.env.NODE_ENV !== 'production'

    return {
        plugins: [
            createHtmlPlugin({
                minify: false,
                pages: [
                    {
                        entry: 'main.js',
                        filename: 'index.html',
                        template: 'index.html',
                        injectOptions: {
                            data: {
                                title: isLocal ? 'LOCAL - MAIN' : 'MuckMaps'
                            }
                        }
                    },
                    {
                        entry: 'admin.js',
                        filename: 'admin.html',
                        template: 'admin.html',
                        injectOptions: {
                            data: {
                                title: isLocal ? 'LOCAL - Admin' : 'MuckMaps - Admin'
                            }
                        }
                    }
                ]
            })
        ],
        build: {
            sourcemap: true,
            minify: false,  // Disable minification - it breaks Map cache
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    admin: resolve(__dirname, 'admin.html')
                }
            }
        }
    }
});