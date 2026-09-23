import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        environmentMatchGlobs: [
            ['src/core/PluginLoader.test.ts', 'jsdom'],
        ],
    },
});
