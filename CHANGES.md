# CHANGES

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: Hypebot RSS feed URL fix
WHAT: Hypebot moved their RSS from /feed to /latest/rss/ — old URL returned 301 (not followed by fetchJSON) then 404. Fixed URL. Both MBW and Hypebot now return HTTP 200 with real headlines. Pulse check confirmed fetching real data; Claude returning NO_UPDATES is correct behavior (no contradictions vs brain today).
RESULT: works
BLOCKERS: none

## [2026-04-18] test-system.cjs — DONE
TASK: system health test suite
WHAT: Created test-system.cjs with 8 tests: watcher alive, category suggestion, Spotify intl URL, pulse check, briefing no hardcoded filters, notes-to-feedback JSON, no brain dupes, git initialized. Fixed test 4 (pulse check writes to inbox not response body; NO_UPDATES is valid), fixed test 5 (regex was matching prompt strings not DB queries). Final result: 8/8 PASS.
RESULT: works
BLOCKERS: none

## [2026-04-18] repair session audit — DONE
TASK: FIX 1–4 verification + git init
WHAT: Audited all 4 fixes — all already applied from 2026-04-17 session. FIX1 (brainContext simplified, system prompt correct), FIX2 (ghost tasks: removeItem + newInBackup), FIX3 (loadCategories unconditional), FIX4 (API key input intact). No code changes needed. Initialized git repo with baseline commit 3545fd6.
RESULT: works
BLOCKERS: none

## [2026-04-17] ProjectsTab.svelte — DONE
TASK: brainContext simplification in processNotesToFeedback + processPdfToFeedback
WHAT: Replaced dialectical CONFIRMED/TENSION/OUTDATED/NEW system prompt with simple "Return only JSON arrays of strings" + flat bullet list of brain titles/content (80 chars). Dialectical framing caused Claude to return prose.
RESULT: works
BLOCKERS: none

## [2026-04-17] ProjectsTab.svelte — DONE
TASK: processNotesToFeedback hotfix
WHAT: brainContext moved to system prompt (was prepended to user message, causing Claude to respond with analysis prose instead of JSON array); added d.error check before parse; console.log raw response; error message now includes first 200 chars of response for debugging
RESULT: works
BLOCKERS: none

## [2026-04-17] ProjectsTab.svelte — DONE
TASK: processNotesToFeedback + processPdfToFeedback fixes
WHAT: (1) Brain query changed from .in(category,[...]).limit(8) to .order(created_at desc).limit(6) in both functions; (2) notes: brainContext moved before JSON instruction in user message; (3) PDF: brainContext moved to system prompt, removed from user text; (4) both functions now use match(/\[[\s\S]*\]/) robust parse + throw on empty result
RESULT: works
BLOCKERS: none

## [2026-04-17] DailyTab.svelte — DONE
TASK: FIX1
WHAT: Ghost task fix — backup read before state set, removeItem after successful Supabase load and after delTask save; restore banner now checks for IDs missing from Supabase instead of length comparison
RESULT: works
BLOCKERS: none

## [2026-04-17] .env — DONE
TASK: FIX2
WHAT: Fixed broken .env — missing newline between SUPABASE_SECRET_KEY and ANTHROPIC_API_KEY caused key not to parse; settings UI unchanged (mm_api_key localStorage correct)
RESULT: works — user must enter API key via settings panel to populate ANTHROPIC_API_KEY
BLOCKERS: none

## [2026-04-17] BrainTab.svelte — DONE
TASK: FIX3
WHAT: processDump() guard against double-fire; duplicate check (category+title) before every insert in saveApproved() and saveSplitsDirect()
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: FIX4
WHAT: Added POST /cleanup-brain-dupes endpoint — fetches all brain_knowledge, finds duplicate category+title pairs, deletes all but the earliest id in batches of 50
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: 23C
WHAT: Promise.all→allSettled for per-category fetches; JSON.parse try/catch with fallback; console.log at handler start
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: 23D
WHAT: Removed hardcoded category=in.(market_knowledge,artist_breaking,genre_strategy) filter in runPulseCheck; replaced with order=created_at.desc&limit=10
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: 13/25
WHAT: Added Spotify featured playlists (DE) + Viral 50 proxy; country US→DE; TikTok manual note; Claude prompt sections updated to New Releases/Editorial Push/Industry News/Viral Proxy/Next Move
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: 6
WHAT: Removed taste_profiles from system-status table list; no endpoint existed
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.cjs — DONE
TASK: 27
WHAT: Added POST /seed-brain-categories — idempotent upsert of 10 category seed rows; ran successfully (all 10 already present)
RESULT: works
BLOCKERS: none

## [2026-04-17] BrainTab.svelte — DONE
TASK: debug pass
WHAT: Fixed Spotify intl regex for playlist/album/artist; fixed Discard button not clearing dumpText
RESULT: works
BLOCKERS: none

## [2026-04-17] CLAUDE.md — DONE
TASK: debug pass
WHAT: Updated watcher reference to momentum-watcher.cjs; .js crashes under package.json type:module
RESULT: works
BLOCKERS: none

## [2026-04-17] momentum-watcher.js — DONE
TASK: debug pass
WHAT: .js crashes on startup (require not defined in ESM scope); .cjs is the working copy — always use node momentum-watcher.cjs
RESULT: broken (.js) / works (.cjs)
BLOCKERS: package.json type:module — will never be fixed without converting all requires to imports

## momentum-watcher.js + .cjs + BrainTab.svelte — 2026-04-17
- Added: POST /analyze-spotify-track — fetch track + artist from Spotify API, download preview_url, run Essentia RhythmExtractor2013 + KeyExtractor(edma), return { title, artist, album, art_url, popularity, genres, bpm, key, preview_url }
- Changed: BrainTab processDump — Spotify track URLs now call /analyze-spotify-track first (preview card flow), playlist/artist URLs still go to /agent-import-spotify
- Added: BrainTab spotifyPreview state + saveSpotifyPreview() — saves to reference_tracks + brain_knowledge with auto-derived category from genre
- Added: BrainTab preview card for spotifyPreview — album art, artist—title, BPM·key, genre pills, popularity, Add to Brain / Discard buttons
- Changed: /analyze-audio Step 2 BPM — replaced median interval with trimmed-mean (drop top/bottom 10%) to reduce quantization error
- Changed: /analyze-audio Step 2b — Essentia now outputs both BPM (RhythmExtractor2013 multifeature) and key in one Python call; BPM from Essentia fills Step 2 gap before aubiotrack fallback is used
- Removed: /agent-import-spotify track handler — removed all /v1/audio-features calls (deprecated for new apps since Nov 2024, 403 errors)
- Changed: /agent-import-spotify track handler — BPM + key now from Essentia RhythmExtractor2013 on 30s preview_url download; tmpfile approach for safe path quoting
- Changed: /agent-import-spotify track handler — auto-derives category from first artist genre; saves to both reference_tracks and brain_knowledge
- Changed: /agent-import-spotify playlist/artist handler — removed Step 5 audio-features batch fetch and all avg.tempo/energy references; dataBlock now uses genres + popularity only; removed taste_profiles upsert (no audio features data)

## momentum-watcher.js + .cjs — 2026-04-16
- Added: POST /capture-screen — Mac screencapture -x → base64 → Claude Sonnet vision → analysis text; optional save to brain_knowledge with entry_type='screenshot'; tracks tokens to api_usage
- Added: POST /analyze-chat — receives WhatsApp/chat text + chatName → Claude Haiku extracts FEEDBACK POINTS / ACTION ITEMS / SENTIMENT → saves to brain_knowledge (category='collaboration', entry_type='chat') + inbox_notifications

## BrainTab.svelte — 2026-04-16
- Added: SCREEN CAPTURE section above dump textarea — 3s countdown, context input, category select, calls /capture-screen, shows result inline
- Added: captureScreen(), capturing/captureResult/captureContext/captureCategory state
- Added: .brain-screen-section, .brain-screen-controls, .brain-capture-result CSS

## DailyTab.svelte — 2026-04-16
- Added: 💬 WhatsApp button in agent-row — prompts for chat paste + contact name, POSTs to /analyze-chat, reloads inbox on success
- Added: extractWhatsapp(), whatsappName/readingWhatsapp state

## ProjectsTab.svelte — 2026-04-16
- Added: 📸 daw-capture-btn on each song row — 4s countdown then calls /capture-screen with DAW context, shows analysis in alert, appends to active version notes
- Added: captureDawSession(song) function
- Added: .daw-capture-btn CSS (opacity .25, full on hover)

## momentum-watcher.js + .cjs — 2026-04-16
- Changed: /analyze-audio Step 2 — aubiotrack beat timestamps → median interval BPM (falls back to aubiotempo if missing)
- Added: Step 2b keyfinder-cli key (silent fail if not installed)
- Added: Step 2c Essentia Python key with edma profile (silent fail if not installed)
- Changed: DSP fallback BPM fold range extended from 80-150 to 70-160
- Changed: response now includes bpmHalf and bpmDouble alongside bpm
- Installed: aubiotrack via brew install aubio

## DemoTab.svelte — 2026-04-16
- Added: updateTempo() — updates song.tempo and recomputes _bpmHalf/_bpmDouble
- Changed: both analyze-audio call sites destructure bpmHalf/bpmDouble, store on song._bpmHalf/_bpmDouble
- Changed: TEMPO field shows ½ and 2× clickable alternatives next to input
- Added: .bpm-alt CSS

## BrainTab.svelte — 2026-04-16
- Changed: tracksByGenre derived — excludes my_productions tracks from genre grouping
- Added: MY PRODUCTIONS sub-section at top of REFERENCE TRACKS — shows tempo/key/loudness/energy, play opens localhost:4242/production/filename.wav
- Changed: external refs section unchanged, grouped by genre as before

## package.json — 2026-04-16
- Added: setup-essentia script — pip3 install essentia-tensorflow with fallback to essentia

## momentum-watcher.js + .cjs — 2026-04-16
- Added: POST /analyze-audio-features — writes Python/Essentia script to tmp file, runs via execSync, upserts result to reference_tracks as local_ entry with collection_name='my_productions'
- Note: LoudnessEBUR128 needs stereo — script passes mono loader twice as workaround

## ProjectsTab.svelte — 2026-04-16
- Added: fire-and-forget POST /analyze-audio-features after successful saveSongAudio — non-blocking, silent failure

## momentum-watcher.js + .cjs — 2026-04-16
- Added: POST /sync-all-refs — scans songs.reference_links + daily_state.refs for Spotify track URLs, batch-fetches tracks/features/artists, upserts to reference_tracks with collection_name
- Returns: { ok, found, added, skipped }

## BrainTab.svelte — 2026-04-16
- Added: syncAllRefs() function — POSTs to /sync-all-refs, shows result alert, reloads entries
- Added: ↺ Sync All System Refs button in brain-actions row

## momentum-watcher.js + .cjs — 2026-04-16
- Changed: /agent-import-spotify track handler — stores ALL fields to reference_tracks (album, release_date, loudness, time_signature, artist_popularity, artist_followers, preview_url, album_art, approved)
- Changed: track response — adds topGenres, avgTempo, avgEnergy, full trackData object, rich summary string
- Removed: brain_knowledge insert from track handler (category choice now deferred to UI)
- Added: debug logging for Spotify credentials + getSpotifyToken response

## BrainTab.svelte — 2026-04-16
- Added: importCategory, newCategoryForImport state
- Added: saveTrackImport() — updates reference_tracks collection_name + inserts brain_knowledge entry
- Changed: importResult display — track imports show album art, stats, genre pills, category selector, Save/Discard buttons
- Changed: non-track imports (playlist/artist) still show old summary-only panel

## momentum-watcher.js + .cjs — 2026-04-16
- Added: async function runPulseCheck(apiKey) — fetches MBW + Hypebot RSS, compares headlines to brain, posts to inbox if real updates found
- Added: POST /agent-pulse-check — manual trigger endpoint
- Added: daily setInterval — reads config.json for anthropicApiKey, auto-runs runPulseCheck every 24h
- Fixed: RSS parsing uses _raw fallback from fetchJSON (not JSON.parse), strips CDATA wrappers

## BrainTab.svelte — 2026-04-16
- Changed: approval panel — replaced brain-preview with brain-approval-panel spec
- Added: entry_type emoji badges (CHUNK/FACT/THOUGHT/QUESTION/KNOWLEDGE)
- Added: NEW CATEGORY badge when isNewCategory
- Changed: category rename input uses brain-cat-rename-inp styling (gold tint)
- Changed: title/content shown as display divs (not editable inputs)

## BrainTab.svelte — 2026-04-16
- Rewritten: processDump — Spotify (hard return), question (approval UI, no Claude), long/article/short routing to 3 different Claude prompts
- Changed: question detection — endsWith('?') or leading question word regex (was includes('?'))
- Added: approval UI replaces old lastExtracted preview — shows entry_type, editable category/title/content per item
- Added: pendingApproval, pendingOriginalText, showApproval, newCategoryInput state
- Added: saveApproved() — saves with entry_type, source_url, verbatim_full fields
- Changed: approval panel category field is editable input (supports isNewCategory rename)

## DailyTab.svelte — 2026-04-16
- Removed: CHECK tab from section tab bar
- Changed: tab bar is now ROUTINE · HELPERS · MIX REFS · PRIVATE
- Changed: CHECK items merged into ROUTINE section below a routine-divider
- Changed: addCheck/delCheck/moveCheck extracted as named functions
- Changed: REFERENCES tab label → MIX REFS; section header REFERENCES → MIX REFERENCES
- Changed: addRef — Spotify track URLs use oEmbed for auto-title; non-Spotify still uses fetchRefTitle
- Changed: ref-row display — label shown first (prominent), URL dimmed below

## BrainTab.svelte — 2026-04-16
- Added: duplicateWarnings state — computed after loadEntries via first-15-char title match per category
- Added: warning banner at top of BRAIN ENTRIES when duplicates detected

## DailyTab.svelte — 2026-04-16
- Changed: sendAI() — replaced single brainData fetch with 3 parallel fetches (corrections, knowledge, questions)
- Changed: system prompt — replaced Mozart persona with co-intelligence spec (CHARACTER block + ✓/✗ framing)
- Added: correctionInputs state — tracks open correction fields per message index
- Added: ✗ Wrong button on each assistant message — toggles inline correction input
- Added: correction input saves to brain_knowledge category='correction' on Enter, then hides

## momentum-watcher.js + BrainTab.svelte + DailyTab.svelte + ProjectsTab.svelte — 2026-04-16
- Changed: agent-import-spotify playlist handler — replaced old brainKnowText framing with buildBrainContext(brainKnow)
- Changed: BrainTab processDump Claude prompt — added COUNTER: instruction after each extracted insight
- Changed: DailyTab Mozart system prompt — replaced flat brain context with dialectical framing + FOR:/AGAINST: instruction
- Changed: ProjectsTab processNotesToFeedback + processPdfToFeedback — replaced flat brain context with dialectical framing

## BrainTab.svelte — 2026-04-16
- Changed: button label — dynamic per Spotify URL type (track/playlist/artist)
- Changed: processDump — Spotify URL detection runs first, never falls through
- Changed: entries section — replaced per-category groups with one unified dropdown
- Changed: entries rendering — all entries deleteable, click title to expand content
- Changed: reference_tracks — compact single-line rows sorted by genre then tempo
- Added: watched_artists sub-section with unwatch (set active=false) button
- Added: loadEntries fetches watched_artists table alongside brain_knowledge

## BrainTab.svelte — 2026-04-16
- Changed: processDump — clean Spotify block with single try/catch, explicit return
- Fixed: removed nested double-try; processing=false before return, not in finally

## BrainTab.svelte — 2026-04-16
- Added: referenceTrackEntries state — fetches from reference_tracks table
- Added: loadEntries fetches reference_tracks, sorted by genre_tag then tempo
- Added: deleteRefTrack, playTrack, copyTrackLink functions
- Added: TRACKS sub-section grouped by genre with play/copy/delete per row
- Changed: toggle count includes referenceTrackEntries.length
- Removed: old refEntries derived from brain_knowledge for display

## momentum-watcher.js + .cjs — 2026-04-16
- Changed: morning-briefing — added tiered brain_knowledge fetch (market_knowledge,business,artist_breaking)
- Changed: agent-scout — added brain_knowledge + top-5 reference_tracks fetches; both added to Claude prompt
- Changed: agent-demo-match — added brain_knowledge + top-5 reference_tracks; added to context block
- Changed: agent-import-spotify playlist handler — added brain_knowledge fetch (genre_strategy,production_style) for Claude prompt context

## BrainTab.svelte — 2026-04-16
- Removed: copiedTrackId state, deleteRefTrack/playTrack/copyTrackLink helpers (all inlined in template)
- Added: tracksOpen state; tracksByGenre $derived.by grouping tracks by first genre_tag
- Changed: loadEntries reference_tracks fetch — order by tempo, no JS sort
- Changed: REFERENCE TRACKS moved out of brain entries dropdown into its own separate toggle section
- Changed: brain entries toggle count no longer includes referenceTrackEntries.length
- Fixed: processDump simplified — removed data.summary construction; return labeled STOP

## BrainTab.svelte — 2026-04-16
- Changed: processDump — full replacement with canonical version
- Fixed: Spotify regex no longer requires https:// prefix (catches all paste formats)
- Fixed: Claude text path now saves directly to brain_knowledge and calls loadEntries (no saveExtracted step)

## BrainTab.svelte — 2026-04-16
- Added: question detection in processDump — saves verbatim, skips Claude
- Added: 'question' to CATEGORIES array
- Added: question entries render italic, no toggle, full content shown inline
- Fixed: question check runs after Spotify, before Claude (correct order confirmed)

## DailyTab.svelte — 2026-04-16
- Changed: sendAI (Mozart) — fetches top 8 brain_knowledge entries before Claude call
- Added: brainContext injected into Mozart system prompt

## ProjectsTab.svelte — 2026-04-16
- Changed: processNotesToFeedback — fetches brain_knowledge, prepends as context to Claude prompt
- Changed: processPdfToFeedback — same brain fetch, appended to PDF extraction instruction

## BrainTab.svelte — 2026-04-16
- Changed: question entries render as brain-question-row with icon, italic text, date, delete
- Removed: old brain-entry-question/question-title styles, replaced with new spec

## BrainTab.svelte — 2026-04-16
- Fixed: apiKey check moved to just before Claude call — questions/Spotify no longer blocked by missing key

## BrainTab.svelte — 2026-04-16
- Fixed: entriesOpen = true after saving a question so it's immediately visible
- Fixed: added error handling to question insert (shows alert on failure)

## BrainTab.svelte — 2026-04-16
- Fixed: question detection now triggers if text contains ANY '?' — context before the question no longer breaks it

## [2026-04-17] momentum-watcher.js — DONE
TASK: #28
WHAT: Added GET /system-status endpoint returning tasks stats, brain stats, api key presence, all endpoints, last watcher error
RESULT: works
BLOCKERS: none

## [2026-04-17] CLAUDE.md — DONE
TASK: #28
WHAT: Added CHANGES.md format rule and session handoff rule; updated watcher endpoints list
RESULT: works
BLOCKERS: none
