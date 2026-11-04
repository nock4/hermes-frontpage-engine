import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { excludeReviewAssets } from './scripts/lib/exclude-review-assets.mjs';
import { effectsReviewPlugin } from './scripts/lib/effects-review-plugin.mjs';
export default defineConfig({
    plugins: [react(), excludeReviewAssets, effectsReviewPlugin],
    server: {
        allowedHosts: true,
    },
    preview: {
        allowedHosts: true,
    },
    test: {
        exclude: ['tests/ux/**', 'node_modules/**', 'dist/**'],
    },
});
