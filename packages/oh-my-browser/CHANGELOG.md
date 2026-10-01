# Changelog

## [Unreleased]

### Added

- Added `@oh-my-pi/oh-my-browser`, an Electron + Bun desktop browser where `createAgentSession` from `@oh-my-pi/pi-coding-agent` drives tabs, local files/shell, and the primary UI.
- Added Aside-like chrome: left rail (bookmarks, human tabs, agent tabs), NTP “Ask AI a task” composer, page-attached side panel, and omnibox.
- Added CDP `connected` host path so Eval `browser.*` (goto/observe/click) targets in-app WebContents tabs.
- Added Guard / Read / Full permission modes (mapped to omp `tools.approvalMode`) with `hasUI` approvals in the side panel.
- Added static browser/desktop prompt templates (`.md` + Handlebars) and `bun run start` / `bun run smoke` scripts.
