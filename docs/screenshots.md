# Documentation screenshots

The README screenshots show the production UI with fictional, deterministic data. Skill names, descriptions, source groups, version IDs, and paths come from `scripts/screenshot-preview.mjs`. The preview never reads a local Store or forwards requests to the application backend. It supports the Skills list, Bundles list, and the `research` bundle; write requests are rejected.

## Refresh the images

```sh
npm ci
npm run build:ui
node scripts/screenshot-preview.mjs
```

Open `http://127.0.0.1:17529/` in a browser. Use a **1440 × 1000 CSS pixel** viewport, device scale factor **1**, and the light theme. `SCREENSHOT_PORT` can override the preview port.

Capture these pages after their data has loaded:

| Page | Output |
| --- | --- |
| `/` | `docs/images/skill-overview.png` |
| `/bundles/research` | `docs/images/bundle-composition.png` |

Capture the page viewport, excluding browser chrome and any browser-extension overlays. Check that all rows and the footer fit, text is readable, and every visible value matches the fixture data. Do not substitute a screenshot from a personal Store. Stop the preview with Ctrl+C when finished.
