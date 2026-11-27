<p align="center">
  <img src="build/icon.png" width="112" alt="Cutroom" />
</p>

<h1 align="center">Cutroom</h1>

<p align="center">
  Edit video by talking to the coding agent you already use.<br/>
  Claude Code, Codex or Pi edits the timeline. <a href="https://videodb.io">VideoDB</a> sees, searches and renders the footage.
</p>

<p align="center">
  <a href="https://github.com/omgate234/cutroom/releases/latest"><b>Download for macOS or Windows</b></a>
</p>

---

## What it does

- Drop in footage. Each video is uploaded to VideoDB, transcribed and described shot by shot.
- Ask for an edit: "a 30 second highlight with captions", "remove the ums and silences", "a vertical short from the best moment".
- The agent reads the transcripts, searches the footage, looks at frames, writes `timeline.json` and checks its own cuts. Every save renders a live preview.
- Drag clips, undo any change, or restore any earlier version. Export an MP4 when it looks right.
- The agent can use the rest of VideoDB too: search your whole library, reframe, dub, generate music or voice.

## Install

**macOS**

1. Download the DMG for your Mac from [Releases](https://github.com/omgate234/cutroom/releases/latest) (`arm64` for Apple silicon, `x64` for Intel).
2. Drag Cutroom to Applications.
3. The app is not notarized yet. On first launch macOS will refuse to open it; run this once, then open it normally:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Cutroom.app
   ```

**Windows 10/11**

1. Download `Cutroom-<version>-x64-setup.exe` (or `arm64` for Windows on ARM) from [Releases](https://github.com/omgate234/cutroom/releases/latest).
2. Run it. It installs for your user only, no admin prompt.
3. The installer is not code-signed yet, so SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**.
4. Install [Git for Windows](https://git-scm.com/download/win) if you don't have it: Claude Code needs it, and Cutroom uses it for undo history.

You also need:

- A VideoDB account. Connect through **Sign in with VideoDB** in your browser; Cutroom uses SSO only.
- At least one agent installed and signed in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex) or [Pi](https://github.com/earendil-works/pi) (0.81+).

**Sign into the CLI on the same computer where you run Cutroom.** Being signed into the ChatGPT or Claude web app is not enough.

- **Codex CLI:** open a terminal and run `codex login`.
- **Claude Code CLI:** open a terminal and run `claude auth login`.
- **Pi:** run `pi`, then type `/login`.

Complete the login flow started by the CLI and wait for the terminal to confirm success. Return to Cutroom and click **Re-check** during onboarding or **Retry** in chat if needed. You can close the terminal after login; it does not need to stay open while using Cutroom.

Onboarding checks all of this and can install the [VideoDB skills](https://github.com/video-db/skills) for each agent.

## How it works

Cutroom is an [Agent Client Protocol](https://agentclientprotocol.com) client. It starts your agent through its ACP adapter, runs it inside the project folder, and gives it VideoDB tools over MCP (and as a `vdb` shell command for agents without MCP).

A project is a plain folder, kept in `~/.cutroom/projects/`:

| File | Purpose |
|---|---|
| `project.json` | Name and description: the brief for the edit |
| `timeline.json` | The edit, in VideoDB's timeline format |
| `assets.json` | Imported media and indexing status |
| `media/<id>/` | Transcript, word timings and scene descriptions per video |
| `AGENTS.md`, skills | Instructions the agent reads |

Every agent turn and manual edit is a git commit, so history and undo come for free.

## Develop

```sh
npm install
npm run dev        # run the app
npm run build:mac  # build DMGs into dist/
npm run build:win  # build Windows installers into dist/ (works from macOS too)
```

Electron, React, [shadcn/ui](https://ui.shadcn.com), Tailwind. Main process in `src/main`, the MCP server and CLI in `src/mcp`, shared VideoDB and timeline code in `src/shared`, UI in `src/renderer`.

## License

MIT
