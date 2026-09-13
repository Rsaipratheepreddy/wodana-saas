# Web foundations

The web application uses CSS custom properties from `tokens.css`. Product components should use
semantic tokens such as `--wd-color-text`, `--wd-color-surface` and
`--wd-color-action-primary`; raw palette steps are reserved for theme definitions.

Fonts are loaded once by `app/fonts.ts` through `next/font`. Inter covers Latin UI and Noto Sans
Arabic covers Arabic UI. No runtime request to Google Fonts is made by the browser.

Set `data-theme="light|dark|high-contrast"`, `data-density="comfortable|compact"`, `lang`, and
`dir` on the nearest application root. Logical CSS properties (`inline`, `block`, `start`, `end`)
are required so the same components work in LTR and RTL layouts.

Global CSS contains only reset, accessibility and internationalization behavior. Route and module
layout belongs in CSS modules so one screen cannot change another screen's typography or geometry.
