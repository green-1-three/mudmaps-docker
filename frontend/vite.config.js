export default {
    build: {
        sourcemap: true,
        minify: 'esbuild',
        target: 'es2015'
    },
    esbuild: {
        keepNames: true  // Prevents mangling of class names like Map
    }
};