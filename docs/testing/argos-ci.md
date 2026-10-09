# Runtime QA and native visual baselines

GitHub Actions (`.github/workflows/ux-visual-regression.yml`) runs `npm run qa:publish`: dependency audits for all and production packages, codebase audit, edition validation, unit tests, build, and the explicitly listed Playwright smoke/media/mobile regressions. HTML reports and test-result/trace artifacts still upload.

The optional Argos upload integration was removed because its dependency chain included `braces <=3.0.3`, affected by GHSA-vfj7-8cjw-p6xm, with no patched release available. The required publish QA lane did not depend on hosted Argos uploads.

The broader `npm run test:ux` suite retains visual assertions using Playwright's native `toHaveScreenshot`, both locally and in CI. Masks, animation disabling, CSS scale, and the 1% pixel-difference threshold remain configured. Missing or changed baselines fail rather than silently becoming upload-only captures. Baselines are platform-specific; review and provision Linux baselines before adding the broader visual suite to Linux CI. Do not auto-accept baseline updates in CI.

Commands:
- `npm run qa:publish` — required publish gate.
- `npm run test:ux` — broader visual/interaction suite.
- `npm run test:ux:update` — intentional, manually reviewed baseline refresh.
- `npm run test:ux:a11y` — accessibility suite.

Argos tokens and hosted snapshot uploads are no longer used. Screenshots, traces, mobile audits, and independent visual review remain required as applicable. The existing UX `bypassCSP` setting is unchanged by this dependency repair.
