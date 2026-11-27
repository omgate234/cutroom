export const AGENTS_MD = `<!-- Managed by Cutroom: rewritten every time the project opens. Put your own notes in NOTES.md. -->
# Video project

This folder is a video edit. You edit the video by editing \`timeline.json\`.
The Cutroom app watches the file, validates it, and re-renders the preview through VideoDB on every save.

Editing is the main job, but you are not limited to it. Use VideoDB for anything the user asks: search across their library, transcripts, summaries, reframing, dubbing, generated music, voice or images, live streams, always with this project's account (below). The global VideoDB skills (\`videodb\`, \`video-search\`, \`video-edit\`, \`video-clips\`, \`video-subtitles\`, \`video-watch\`, \`video-live\`) cover the Python SDK if they are installed. Anything that should end up in this edit comes into the project with \`import_media\` (a VideoDB URL, a public URL or a local path), then goes on the timeline by its media id.

## VideoDB account

Cutroom's API key is the only VideoDB account for this project. \`VIDEO_DB_API_KEY\` and \`VIDEODB_API_KEY\` in your environment are set to it.

- Do VideoDB work through the \`cutroom\` tools, \`./.cutroom/bin/vdb\`, or the VideoDB SDK / \`videodb\` CLI reading that environment key.
- Never use another VideoDB MCP server, connector or plugin, a \`videodb login\` profile, or a key from a \`.env\` file, shell profile or anywhere else. It may be a different account, and its media ids will not render here.
- Media made outside this account comes in with \`import_media\` by public URL or file, never by pasting its id into timeline.json.

## Files

| Path | What it is |
|---|---|
| \`project.json\` | Project name and description: the user's brief for this edit. Read it first. |
| \`timeline.json\` | The edit. Source of truth. You own it. |
| \`assets.json\` | Imported media: VideoDB id, kind, duration (seconds), status. Read-only for you. |
| \`media/<id>/transcript.txt\` | One line per segment: \`[start-end] text\`, seconds in source time. |
| \`media/<id>/words.json\` | Word-level timings \`{text,start,end,speaker}\` for precise cuts. |
| \`media/<id>/scenes.txt\` | Visual description per segment: \`[start-end] description\`. |
| \`renders/frames/\` | Frames you grabbed with \`get_frames\` / \`inspect_cuts\`. |

Media with status \`indexing\` can already be placed on the timeline; transcripts and search arrive when it is \`ready\`.

## timeline.json

\`\`\`json
{
  "background": "#000000",
  "resolution": "1920x1080",
  "tracks": [
    {
      "name": "main",
      "clips": [
        { "id": "c1", "start": 0, "clip": { "duration": 4.2, "asset": { "type": "video", "id": "m-123", "start": 12.5 } } }
      ]
    }
  ]
}
\`\`\`

- \`clips[].start\` = position on the output timeline (seconds). \`clip.asset.start\` = in-point inside the source. \`clip.duration\` = length.
- \`asset.start + duration\` must not exceed the media's duration in assets.json.
- Clips on one track must not overlap. Later tracks draw on top of earlier ones (overlays, titles, captions, music go on their own tracks).
- Every clip needs a unique, stable \`id\`. Edit clips by id; do not rewrite the whole file for a small change.
- The user also edits the timeline by hand in Cutroom (trims, splits, moves, styling). Re-read \`timeline.json\` right before you change it, and keep fields you did not mean to touch.
- To shorten the video, move later clips left so there are no unintended gaps.

Asset types (\`clip.asset\`):
- \`video\`: \`{ "type": "video", "id", "start", "volume" (0-1+), "crop": {top,right,bottom,left} }\`
- \`audio\`: \`{ "type": "audio", "id", "start", "volume" }\`
- \`image\`: \`{ "type": "image", "id" }\`
- \`text\`: \`{ "type": "text", "text", "font": {"family","size","color","opacity","weight" (number, e.g. 700; never "bold")}, "background": {"color","opacity","width","height","text_alignment"}, "alignment": {"horizontal": "left|center|right", "vertical": "top|center|bottom"} }\`
- \`caption\`: \`{ "type": "caption", "src": "auto", "animation": "box_highlight|color_highlight|reveal|karaoke|impact|supersize", "position": {"alignment": "bottom_center", "margin_v": 60}, "font": {"font_name","font_size","bold"}, "primary_color": "&H00FFFFFF" }\`. \`src: "auto"\` captions the speech of the video clips beneath it; give it the duration of the section it covers. Colors are ASS \`&HAABBGGRR\`.

Clip options (\`clip.*\`): \`fit\` (crop|cover|contain), \`position\` (center, top, bottom, left, right, top_left, top_right, bottom_left, bottom_right), \`offset\` {x,y} (-1..1), \`scale\` (0-10), \`opacity\` (0-1), \`filter\` (blur, boost, contrast, darken, greyscale, lighten, muted, negative), \`transition\` {"in": "fade", "out": "fade", "duration": 0.5}.

Vertical video: set \`"resolution": "1080x1920"\` and \`"fit": "crop"\` on video clips.

Motion: video/image/text clips accept motion.enter and motion.exit: {"preset":"slide_up","duration":0.4,"amount":0.08,"easing":"ease_out"}. Presets: fade, slide_up/down/left/right, pop, wipe_left/right. Easing: linear, ease_in, ease_out, ease_in_out, back_out. Remove transition and effect when using motion. motion.keyframes maps offset.x, offset.y, scale, rotation or opacity to ordered {time,value,easing} points in clip-relative seconds. Text rotates around its layer centre. Continuous effect: zoom_in or shake.

Colour: clip.lut or timeline.lut = {"src":"uploaded URL","intensity":0.7}. Use import_lut for local .cube files; do not put local paths in timeline.json. Whole-timeline grading sits beneath captions.

## Cutroom tools (MCP server \`cutroom\`)

- \`list_media\` - media, durations and status.
- \`import_media\` - bring a local file or URL into the project (uploads, transcribes, describes). Returns the media id.
- \`search_footage\` - semantic search over speech and visuals; returns source-time ranges. Prefer this over reading every transcript for long footage.
- \`get_frames\` - look at frames of a source at given times. Use it; you cannot judge a shot you have not seen.
- \`validate_timeline\` - schema + sanity checks against assets.json.
- \`compile_timeline\` - renders timeline.json on VideoDB and returns its HLS stream URL. That stream is the real output: inspect it any way you need (ffmpeg, ffprobe) to check captions, text and framing. The app also compiles on save.
- \`inspect_render\` - inspect actual rendered output frames at output times; requires ffmpeg on PATH.
- \`import_lut\` - validate and upload a local 3D .cube colour grade.
- \`caption_presets\` - tested caption styles with the exact \`caption\` asset JSON.
- \`inspect_cuts\` - frames on both sides of every cut on a track.
- \`export_video\` - an MP4 download link for the current timeline.

### Same tools as a shell command

If the \`cutroom\` MCP tools are not available to you, use the CLI. It reads the project from the folder it lives in (on Windows, \`.cutroom\\bin\\vdb.cmd\` from cmd/PowerShell, or the same \`./.cutroom/bin/vdb\` from Git Bash):

\`\`\`sh
./.cutroom/bin/vdb list
./.cutroom/bin/vdb import ~/Movies/broll.mov       # or a URL
./.cutroom/bin/vdb search "laughing at the whiteboard" --kind visual
./.cutroom/bin/vdb frames m-123 12.5 14 20     # prints JPEG paths; open them to look
./.cutroom/bin/vdb validate
./.cutroom/bin/vdb compile
./.cutroom/bin/vdb cuts --track 0              # prints JPEG paths for each cut
./.cutroom/bin/vdb export
./.cutroom/bin/vdb presets
\`\`\`

## Attachments

When the user attaches files to a message you get their local paths (and images inline). Decide what they are for:
footage or music for the edit -> \`import_media\`; a reference image or screenshot -> look at it; a script or brief -> read it.
Ask only if the purpose is unclear.

## How to work

1. Read assets.json and the transcripts/scenes of the media you need. Use \`search_footage\` for anything not obvious.
2. Infer an editorial direction from the brief, content and destination: pace, typography, caption emphasis, colour and restrained motion. State the direction briefly and execute it; ask only when a consequential choice cannot be inferred. A casual prompt still deserves a finished edit. Respect explicit requests for a minimal change. For subtitles, fetch caption_presets: these are the existing DirectorFE editor styles. Choose a suitable preset from its look and intended use, then adapt font size, contrast, emphasis and safe margins to the actual frame. Keep faces and platform controls clear. Use a coherent style throughout; animation should support the content. A request such as "add subtitles" includes making them readable and well placed without requiring the user to specify typography.
3. Make the edit in timeline.json. Use motion and LUTs only when they improve the content; do not invent a LUT URL.
4. Run \`validate_timeline\`, fix every issue, then \`compile_timeline\`.
5. Run \`inspect_cuts\` and look at the frames. Fix cuts that land mid-word, mid-gesture or on a blink, then compile again.
6. Inspect the actual compiled output at the opening, caption-heavy moments, overlays, transitions and ending. Source frames from inspect_cuts cannot verify captions, LUTs or motion. Use inspect_render with output times, inspect the returned images, correct clipping, contrast, awkward crop and unreadable type, then recompile and inspect affected moments. For subtitles, inspect moments containing speech and confirm words are actually visible, synchronized and readable. An empty subtitle layer is not success: check speech-analysis readiness, correct the cause and render again. If analysis is still pending, report that the edit is unfinished. If rendered inspection is unavailable, say what remains unchecked; never claim visual verification from a successful compile alone.
7. Finish with a short summary: what changed, total duration, and what was verified.

Cut on word boundaries from words.json; leave about 0.1s of air before the first word and after the last one.
`

const ROUGH_CUT = `---
name: rough-cut
description: Turn raw talking-head, interview or podcast footage into a tight cut - removes silences, false starts, filler words and retakes. Use when asked to tighten, clean up, rough cut or remove filler/ums/pauses.
---

# Rough cut

1. For each source, read \`media/<id>/words.json\`.
2. Build keep-ranges of speech. Drop: gaps over 0.6s, filler words (um, uh, like, you know, so - only when used as filler), repeated phrases and false starts (keep the last, complete take).
3. Merge keep-ranges that are less than 0.25s apart. Pad each range 0.08s before and 0.12s after, clamped to the source.
4. Write each range as a video clip on track "main", back to back with no gaps. Ids: \`rc-001\`, \`rc-002\`, ...
5. Writing a script (node or python) that reads words.json and writes timeline.json is the right move for long footage.
6. Validate, compile, \`inspect_cuts\` on a sample of cuts, and report the old vs new duration.
`

const SHORTS = `---
name: shorts
description: Find the best moments in long footage and cut vertical 9:16 shorts (Reels, TikTok, YouTube Shorts) with captions. Use when asked for shorts, clips, reels, highlights or social cuts.
---

# Shorts

1. Read the transcripts. Pick moments of 20-60s that stand alone: a clear hook in the first 3 seconds, one idea, a clean ending. Use \`search_footage\` to find moments matching what the user asked for.
2. Tell the user the candidates (start-end, hook line, why) before cutting if they asked for options; otherwise pick the best one.
3. Timeline: \`"resolution": "1080x1920"\`, video clips with \`"fit": "crop"\`. Use \`get_frames\` to check the subject stays in frame; if not, adjust \`offset.x\`.
4. Fetch \`caption_presets\`, choose a style for this content, and adapt font size, emphasis and safe margins to the vertical frame. Add a caption clip covering the short with \`src: "auto"\`. Avoid covering faces; visually inspect the compiled captions.
5. Tighten inside the moment with the rough-cut rules (silences, filler).
6. One short per project timeline; if the user wants several, make the first, show it, then ask before replacing it.
`

const TITLES = `---
name: titles-and-overlays
description: Add titles, lower thirds, logos, music and b-roll overlays to an edit. Use when asked for titles, text, lower thirds, intro, outro, music, logo or b-roll.
---

# Titles and overlays

- Each overlay kind gets its own track above "main": "broll", "titles", "captions", "music".
- Title card: a \`text\` clip, \`font.size\` 72-96, 2-3s, \`transition\` fade in/out 0.4s.
- Lower third: \`text\` clip, \`alignment\` {horizontal: left, vertical: bottom}, \`font.size\` 40, background with opacity 0.6, 4s.
- Logo: \`image\` clip, \`scale\` 0.15-0.25, \`position\` top_right, \`opacity\` 0.9, spanning the whole edit.
- Music: \`audio\` clip on "music", \`volume\` 0.12-0.2 under speech, fade transitions.
- B-roll: \`video\` clip on "broll" with \`volume\` 0, placed over the line it illustrates. Find it with \`search_footage\`.
- Run \`inspect_render\` at output times after adding overlays to check legibility; source frames do not include overlays.
`

export const SKILLS: Record<string, string> = {
  'rough-cut': ROUGH_CUT,
  shorts: SHORTS,
  'titles-and-overlays': TITLES
}
