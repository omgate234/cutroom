# First-run review build — 27 November 2026

Historical 0.1.2 first-run check; 0.1.3 supersedes this build (see release manifest).

Evidence: fresh Apple Silicon packaging, app launch inspected through the desktop UI, automated tests, and unauthenticated HTTP endpoint probes.

- Built `dist/Cutroom-0.1.2-arm64.dmg`, installed `/Applications/Cutroom.app`, and verified its ad-hoc signature. Not notarized.
- Confirmed the installed app opens at **Connect VideoDB**, with only browser sign-in after the SSO-only update; API-key entry and validation IPC have been removed.
- Cutroom: 21 tests passed and both TypeScript checks passed. OAuth server: 12 Cutroom-specific tests passed.
- Corrected PKCE to use production DirectorFE at `https://console.videodb.io/oauth/*`, scope `videodb`, and the `access_token` response. The previous MCP-host wiring was incorrect and is superseded.
- Production discovery, registration, consent redirect and invalid-grant handling were checked. Full browser sign-in succeeded in the installed app: browser consent → loopback callback → credential validation → Pick your agent.
- App data, default projects, saved window state and previous installed app moved to a local owner-only backup. Backup parent is owner-only. Codex/Claude CLI logins and external project folders were preserved.
- Legacy manual keys and environment credentials no longer satisfy sign-in; existing users must reconnect through SSO. The exchanged app credential stays in the main process and is not returned to the UI.
- Removed three isolated temporary QA copies and the synthetic media fixture. Other-platform installers in `dist` were not rebuilt.

The corrected app is left at Pick your agent after the successful production SSO test. SSO-only update: API-key entry has been removed. The app now targets the existing DirectorFE production PKCE endpoints. This build is a review candidate, not a launch sign-off.
