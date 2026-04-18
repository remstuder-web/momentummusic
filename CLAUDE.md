# Momentum Music Framework — Claude Code Context

## What this project is
A purpose-built music production management tool for a professional music producer.
SvelteKit + Svelte 5 + Supabase web app. Local at localhost:5173. Watcher on port 4242.
Public listen page: momentummusic.vercel.app (deployed via GitHub).
Project root: /Users/remo/momentum

## Spotify API notes (important)
- Client Credentials flow is sufficient — no user login/OAuth required
- Audio Features endpoint (GET /audio-features) deprecated November 2024 — do NOT use
- preview_url is available with free/client-credentials tier (30s preview MP3)
- BPM, key, energy, danceability, loudness are extracted locally via Essentia from preview_url
- New releases: GET /v1/browse/new-releases?limit=10&country=US (works with client credentials)

## Stack
- SvelteKit + Svelte 5 runes ($state, $derived) — NO Svelte 4 syntax
- Supabase (postgres) for all data
- Tailwind installed but NOT used — manual CSS in component <style> blocks
- Node.js watcher: /Users/remo/momentum/momentum-watcher.cjs (port 4242) — always use .cjs, not .js (package.json "type":"module" breaks require in .js)
- npm for package management

## Supabase
URL: https://ukqpnjgvjeduipmdaczn.supabase.co
Anon key: sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS
Tables: projects, songs, share_sessions, inbox_notifications, brain_knowledge, watcher_logs, user_settings

## CSS Standards (ALWAYS match this — never deviate)
```
bg:       #0a0a0a
surface:  #1c1c1c
surface2: #252525
gold:     #c9a84c
text:     #f5f1ea
text-dim: #9e9690
text-mid: #cec9c1
border:   #303030
border2:  #3c3c3c
green:    #4caf82
```
- Body: 15px DM Sans weight 300
- Headers: 17px Space Mono 700 gold
- Section titles: 13px mono uppercase rgba(201,168,76,.75)

## File naming rules (critical — never change these)
- Production audio:    CODE_ARTIST_TITLE_v00.wav (auto-incremented)
- Mix audio:           CODE_ARTIST_TITLE_MIX_v00.wav (auto-incremented)
- Instrumental:        CODE_ARTIST_TITLE_[vXX_BPMbpm from dropped filename].wav
- Stems:               CODE_ARTIST_TITLE_STEMS[_V01_133BPM if version in dropped filename].zip
- All stems V always uppercase

## Tab structure (src/lib/)
- DailyTab.svelte    — tasks, routines, YEAR view, INBOX notifications
- ProjectsTab.svelte — songs per project, production/mixing/stems workflow
- DemoTab.svelte     — demo submissions with listen links
- WorkTab.svelte     — active work session with timer
- FinancesTab.svelte — income tracking
- NotesTab.svelte    — general notes
- ConnectionsTab.svelte — artist/contact database
- ArchiveTab.svelte  — archived projects
- Settings panel     — API key management

## Key Svelte 5 patterns used
```svelte
let items = $state([])
let derived = $derived(items.filter(...))
```
Always use $state and $derived, never writable/readable stores.

## Watcher endpoints (localhost:4242)
- POST /save-audio?dir=production|mixing|demo&filename=...&oldfile=...
- POST /save-instrumental?filename=...&oldfile=...
- POST /save-stems-zip (headers: x-filename, x-oldfile, x-artist, x-song)
- POST /share-link {filePath}
- POST /delete-audio?dir=...&filename=...
- GET  /production/:filename, /mixing/:filename, /instrumentals/:filename
- POST /morning-briefing — daily summary, saves to inbox
- POST /agent-scout — AI artist scouting, saves to inbox
- POST /agent-demo-match — demo→artist matching, saves to inbox
- POST /agent-pulse-check — RSS + Spotify new releases vs brain knowledge
- POST /agent-tiktok-trends — TikTok sound trend analysis (via Claude)
- POST /run-morning-agents — runs scout+demo-match+tiktok-trends+pulse with shared brain context
- POST /analyze-spotify-track — Spotify metadata + Essentia BPM/key/energy/danceability/loudness
- POST /analyze-audio-features — Essentia analysis on local WAV file
- GET  /logs — watcher_logs from Supabase (last 50, newest first)
- GET  /system-status — tasks remaining/done, recent changes, brain stats, api key presence, all endpoints
- GET  /get-changes — last 30 lines of CHANGES.md
- GET  /get-tasks — TASKS.md content
- POST /save-tasks — write TASKS.md
- POST /track-cost — insert row into api_usage
- GET  /get-env-keys — masked + raw API keys from .env
- POST /save-env-key — write/replace key in .env
- POST /speak — OpenAI TTS tts-1 voice:onyx, streams audio/mpeg
- GET  /status — alias for /system-status (session start health check)
- POST /suggest-category — suggest brain_knowledge category for a given entry
- POST /cleanup-brain-dupes — deduplicate brain_knowledge entries

## Dropbox folder structure
/!MOMENTUM MUSIC/
  Demos/
  Production/
  Production/-Instrumentals/
  Mixing/
  Stems/
  Releases/
  Submissions/

## Listen page sessions (share_sessions table)
Fields: id, songs (jsonb array), patch_name, expires_at, background,
        feedback_enabled, stems_only, session_type, feedback, downloads
session_type: 'demo' | 'production' | 'mixing' | 'instrumental'

## inbox_notifications table
Fields: id, type ('feedback'|'download'|'briefing'), song_code, song_title, artist,
        session_id, patch_name, message, read, created_at

## brain_knowledge table (key categories)
Categories: own_production, reference_current, reference_mixing, reference_inspiration,
            reference_sound, market_knowledge, genre_strategy, artist_breaking,
            production_style, correction, question,
            artist_strategy, mixing_technique, release_strategy,
            sound_design, industry_insight, social_media,
            networking, creative_process, business_finance
Fields include: surfaced_in_daily (bool), surfaced_until (date), metadata (jsonb)
SQL to add missing columns:
  ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS surfaced_in_daily boolean DEFAULT false;
  ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS surfaced_until date;
  ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

## CHANGES.md format (always use exactly this structure)
```
## [DATE] [FILE] — [STATUS: DONE/PARTIAL/FAILED]
TASK: which task number
WHAT: one line what was changed
RESULT: works/broken/untested
BLOCKERS: anything that prevented full implementation
```

## Session handoff (append to CLAUDE.md at end of every session)
```
## HANDOFF — [DATE]
COMPLETED: list task numbers fully done
PARTIAL: list task numbers + what part is missing
FAILED: list task numbers + reason
NEXT: what the next session should tackle first
```

## Status tracking (REQUIRED after every task)
After completing every task, write /Users/remo/momentum/.claude-status.json with:
```json
{
  "updated": "<ISO timestamp>",
  "last_task": "<task id or name>",
  "status": "done | partial | failed",
  "working": ["list of things confirmed working"],
  "broken": ["list of things broken or failing"],
  "partial": ["list of things half-done and what's missing"],
  "next": "what the next session should tackle first",
  "notes": "any important context or blockers"
}
```
This file is how the chat assistant tracks progress across sessions — always keep it current.
Read it via GET http://localhost:4242/status at the start of each session.

## Known issues
- None currently. (Last verified: 2026-04-18)

## System health
Last verified: 2026-04-18
Git: initialized, baseline commit 3545fd6
Tests: 8/8 passing (test-system.cjs)
Brain entries: see Supabase brain_knowledge table for current count

## Session start checklist
At the start of every Claude Code session:
1. Run `node test-system.cjs` and fix any failures before other work
2. Read `.claude-status.json` for last session handoff
3. Update SYSTEM.md after completing tasks
4. Commit to git after every completed task: `git add -A && git commit -m "task: description"`

## Watcher process management (pm2)
The watcher runs as a pm2 daemon — it starts automatically on boot and does NOT need to be launched from a terminal.
After ANY change to momentum-watcher.cjs always run:
  pm2 restart momentum-watcher
Then verify with: curl -s http://localhost:4242/ping
(Expected response: {"ok":true,"time":"..."})

## What NOT to do
- Never use Tailwind utility classes
- Never use Svelte 4 reactive syntax ($: etc)
- Never change the CSS color palette
- Never change file naming rules
- Never break the production send version button
- Never use max-height on drop zones (breaks drag/drop)
- Always test that send version buttons work for both production AND mixing independently
- Never run more than 3 tasks simultaneously
- Run test-system.cjs before and after every session
- Git commit after every completed task
- Update .claude-status.json after every task
- Update SYSTEM.md when features are added or changed

## Morning briefing (watcher endpoint)
Reads Supabase daily: active songs per stage, upcoming deadlines, unread inbox,
brain entries not contacted in 30+ days. Sends to Claude Haiku API.
Inserts result as inbox_notification type='briefing'.

## Claude API calls from app
Model: claude-haiku-4-5-20251001 for briefing/tagging (cheap)
Model: claude-sonnet-4-20250514 for PDF processing, style guides (quality)
API key stored in localStorage key 'mm_api_key'
Always include header: 'anthropic-dangerous-direct-browser-access': 'true'

## HANDOFF — 2026-04-17 (session 2)
COMPLETED: ALL tasks 0–27 verified done or already implemented in prior sessions
FIXED THIS SESSION: 23C (Promise.allSettled + JSON.parse try/catch + console.log), 23D (briefing hardcoded category filter), 13/25 (Viral 50 + featured playlists + country DE), 6 (taste_profiles cleanup), 27 (seed endpoint)
ALSO FIXED (debug pass): BrainTab Spotify intl regex for playlist/album/artist; Discard panel not clearing dumpText; CLAUDE.md watcher command updated to .cjs
FAILED: task 16 code is done; needs OPENAI_API_KEY=sk-... added to .env manually by user
NEXT SESSION SHOULD START WITH: TASKS.md is clear — add new tasks or run /morning-briefing to test agent pipeline
