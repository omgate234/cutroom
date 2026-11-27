# Cutroom launch readiness

Evidence: the local `videodb-python` editor contract, Cutroom and DirectorFE source, OAuth-server source, automated tests, and a live synthetic VideoDB render. No private footage was used in the live smoke test. Version 0.1.3 installers and the website are published; full cross-platform release validation remains incomplete.

## Capability findings

| Capability | Python SDK | Cutroom now |
|---|---|---|
| Motion presets | Eight: fade, four slides, pop, two wipes | Entrance/exit, duration and easing in the clip inspector |
| Transform keyframes | Offset X/Y, scale, rotation, opacity; five easing curves | Preserved, validated and documented for agents; no graphical keyframe editor |
| Continuous effects | Zoom in and shake | Inspector selection; mutually exclusive with motion |
| Colour grading | 3D `.cube`, size 2–65, default 0–1 domain; clip/global intensity | Local file import, validation, upload, clip/global scope, intensity and removal |
| Captions | Styled captions and animation | Existing caption presets and inspector retained; agents instructed to adapt them to content |
| Stock graphics/LUT library | Rendering primitives, not a licensed asset catalog | Bring your own LUTs; no bundled commercial LUT or motion-template pack |
| Output verification | Streams/downloads | New `inspect_render` MCP tool and `vdb inspect`; actual composited frames, requires ffmpeg |

Sources: [Python editor](../../videodb-python/videodb/editor.py), [shared effect contract](../src/shared/effects.ts), [inspector controls](../src/renderer/src/components/effects-panel.tsx), [render/upload tools](../src/shared/vdb.ts).

## Implemented refinements

- Agents must understand the brief/content, choose an editorial direction, inspect the final render, and fix visual defects before claiming verification. Corrected vertical framing from stretching (`cover`) to cropping (`crop`). [Agent guidance](../src/shared/scaffold.ts)
- Cutroom's selected VideoDB connection takes precedence over other VideoDB skills/profiles. Existing environment overrides and Claude connector blocking are reinforced on every prompt. Unrelated tools remain available. This is not a security sandbox for arbitrary agent shell code. [Agent sessions](../src/main/agent.ts)
- Changing accounts stops idle agent sessions, rejects changes during active edits, invalidates compile state and recompiles. The player now clears the previous account’s stream when the connection resets. Compile caches are separated by credential. [Main process](../src/main/index.ts), [project lifecycle](../src/main/project.ts)
- Agent sign-in recovery already existed in the working tree. Added explicit guidance that users can close the terminal once login succeeds. [Sign-in card](../src/renderer/src/components/sign-in-card.tsx)
- Browser VideoDB sign-in is the only supported connection method; legacy manually configured keys require sign-in again. Settings writes use owner-only permissions on POSIX; credentials remain in a local settings file, not an OS keychain. [Login](../src/main/videodb-login.ts), [settings](../src/main/settings.ts)

## Login integration

Cutroom uses the existing production DirectorFE OAuth 2.1 service at `https://console.videodb.io`: `/oauth/register`, `/oauth/authorize`, and `/oauth/token`, scope `videodb`. The exchange returns `access_token`, which remains in the main process. S256, callback state and issuer checks are enforced. No API-key UI or fallback is available.

The earlier MCP bridge design was based on a stale local DirectorFE branch. It is superseded for Cutroom: the extra `/oauth/cutroom/*` routes and Redis configuration are **not required** for this integration. Do not deploy the earlier server patches for this desktop login.

Production discovery, registration (201), consent redirect (`/connect/app`) and rejected invalid grants (400 JSON) have been verified. A complete production browser login succeeded on 27 November: the callback displayed Connected, the SDK validated the returned credential, and the installed app advanced to Pick your agent. The consent page still labels the dynamically registered app Unverified.

## Verification

- Current PR verification: all 21 Cutroom tests passed; node and renderer typechecks and production build passed.
- Live VideoDB: uploaded a valid synthetic identity LUT; compiled a three-second title with slide entrance/fade exit and timeline LUT; extracted and visually inspected output at 0.2, 1.5 and 2.8 seconds. Text was legible, within frame, and changed position/opacity during motion. An additional inverted LUT visibly changed both background and title, confirming the renderer applies the grade rather than merely accepting its JSON: [identity](launch-smoke/identity-lut.jpg), [inverted](launch-smoke/inverted-lut.jpg). This is a narrow contract smoke test, not full editorial QA.
- Desktop UI: verified production browser SSO in the installed Apple Silicon app; API-key fallback was subsequently removed. Full motion/LUT interaction, undo/redo and fresh-install onboarding still need an end-to-end pass.
- Repository-wide lint remains failing: 176 errors and 227 warnings, including existing generated UI return-type rules, dynamic `any` types and React effect-state rules. New standalone effect/login components and editor tests pass targeted lint.

## Before Monday

1. Production SSO login is verified. Refine the dynamically registered app’s Unverified consent label; no new MCP deployment is needed.
2. Exercise three real edits with both Claude Code and Codex: a vertical talking-head reel, an interview rough cut, and a title/LUT treatment. Verify readability, speech boundaries, audio, first/last frames, export and account consistency with a conflicting global VideoDB skill installed.
3. Test a fresh install with no agent installed, an installed-but-signed-out agent, and expired agent credentials. Pi remains an additional unverified path.
4. Runtime-test the published Intel macOS and Windows installers. Current macOS packaging is ad-hoc signed and explicitly not notarized; Windows is unsigned. Signing/notarization credentials and Windows testing were not supplied or completed.
5. Decide the repository lint baseline and fix the CI failures before enforcing a clean release gate. Do not represent the current lint run as passing.

## Positioning and demo

**Cutroom is a visual editing workspace for the coding agent you already use.** Its value is a shared, inspectable timeline, preview, direct controls, project history and output verification. A plugin provides capabilities; Cutroom makes the edit visible and adjustable. Extra integrations remain usable, while VideoDB work stays tied to the app's selected account.

Demo: import footage → ask for one coherent vertical reel → show the agent choosing captions and checking rendered frames → adjust motion and LUT intensity directly → undo a change → export. Show actual output quality and reduced editing effort; do not claim autonomous quality from instructions alone.

Review bundle: `dist/mac-arm64/Cutroom.app` (ad-hoc signed, not notarized).

Published artifacts: version 0.1.3 for macOS arm64/x64 and Windows x64 (see release-0.1.3-manifest.json). Website: https://cutroom-pied-seven.vercel.app. The source is being submitted as a release PR; the superseded DirectorFE/MCP bridge is excluded.
