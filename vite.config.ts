import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
    build: {
        target: 'es2018',
        sourcemap: true,
        emptyOutDir: true,
        outDir: 'lib',
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'asyncGenetic',
            formats: ['es', 'cjs', 'umd'],
            fileName: (format) => {
                if (format === 'es') return 'index.esm.js';
                if (format === 'cjs') return 'index.cjs.js';
                return 'index.umd.js';
            },
        },
    },
    plugins: [
        dts({
            include: ['src/**/*.ts'],
            rollupTypes: true,
            tsconfigPath: resolve(__dirname, 'tsconfig.json'),
        }),
    ],
    test: {
        include: ['test/unit/**/*.test.ts'],
        environment: 'node',
        globals: false,
    },
});
