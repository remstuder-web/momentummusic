# CHANGES

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-get-browser-items-for-plugins
WHAT: All system prompts: use get_browser_items_at_path with path "query:Plugins#VST3|VST|AUv2" for third-party plugins. NEVER browse_path or search_browser for plugins. Executor injection block: covers both browse_path and get_browser_items_at_path — fuzzy matches instruction keywords against item names, falls back to first item, writes item_uri.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-browse-path-for-plugins
WHAT: All system prompts updated: use browse_path (not search_browser) for third-party plugins; search_browser only finds Ableton built-ins. Plugin load example updated to 2 steps: browse_path Plug-ins/VST3 → load_browser_item with {{first_uri}}. Executor: added browse_path injection block — after browse_path response, fuzzy-matches items against instruction keywords (stopwords filtered), falls back to first item. Logs BROWSE_PATH RESULT DEBUG + matched item name/uri.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-remove-debug-logs
WHAT: Removed SEQUENCE STEP DEBUG, LOAD_BROWSER_ITEM PARAMS, SESSION TRACK COUNT console.logs from /ableton-sequence executor.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] AbletonMCP/__init__.py + momentum-watcher.cjs — DONE
TASK: ableton-master-track-and-item-uri
WHAT: Python: _load_browser_item and _validate_track_index both now handle track_index == -1 → self._song.master_track (special case before the existing out-of-range check). Watcher: URI injection now writes params.item_uri and deletes params.uri (wrong key). All system prompts updated: track_index -1 for master, param key "item_uri" in load_browser_item examples.
RESULT: watcher restarted, ping ok. Reload AbletonMCP in Ableton Preferences → MIDI to pick up Python change.
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-uri-injection-and-master-index
WHAT: URI injection fixed: now uses response?.result?.results?.[0] directly (not list-sniffing). Master track index changed from {{track_count}} to hard-coded -2 in all prompts (sequence 2-step plan, ABLETON_CMD_LIST note, single-command prompt). get_session_info step removed from plugin-load sequence — no longer needed. Logs: INJECTED URI shows actual value, fallback message when results empty.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-short-browser-queries
WHAT: /ableton-sequence system prompt: added browser search guidance — use short plugin-name-only queries ("API 2500" not "waves api 2500"), add browse_path "Plug-ins" step if search may return 0 results.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-fix-response-nesting
WHAT: Logs revealed AbletonMCP wraps all responses as {status, result:{...}}. Fixed both injection paths to unwrap via response.result before extracting track_count and search results list. Added SEARCH RESULT DEBUG and SEQUENCE STEP DEBUG logs. search_browser was returning results:[] because query was wrong AND list extraction was looking at response.results instead of response.result.results.
RESULT: watcher restarted, ping ok
BLOCKERS: search_browser returning empty results for "waves api 2500" — plugin may not be indexed or query needs different format

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-programmatic-param-injection
WHAT: /ableton-sequence executor rewritten: replace placeholder-based substituteCtx/extractCtx with index-based programmatic injection. After get_session_info response, parseInt(track_count) is forcefully written to all subsequent load_browser_item params.track_index. After search_browser, first result uri is written to all subsequent load_browser_item params.uri. Full TCP response logged to console per step including raw search_browser list.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-numeric-params-and-context-injection
WHAT: Both system prompts: CRITICAL rule — all numeric params must be actual numbers, never strings (track_index integer, volume 0.0–1.0). Sequence system prompt: {{track_count}} and {{first_uri}} placeholders explained with 3-step plugin-load example. Sequence executor: extractCtx() extracts track_count from get_session_info and first uri from search_browser results; substituteCtx() replaces placeholders with real values before each TCP send.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: ableton-browser-timeout-and-master-index
WHAT: sendAbletonTCP: SLOW_ABLETON_COMMANDS list gets 30s timeout (search_browser, browse_path, load_browser_item), others keep 10s. ABLETON_CMD_LIST: added master track index guidance (use get_session_info to get track_count, master = track_count index). Both system prompts updated: /ableton-command picks first step only for multi-step instructions; /ableton-sequence explicitly plans 3-step plugin-load flow.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: ableton-verified-commands
WHAT: Replace ABLETON_CMD_LIST with verified working AbletonMCP command names. Remove non-existent commands (toggle_arrangement_record, set_overdub, move_device_left, load_drum_kit, etc.). Replace load_instrument_or_effect/load_item_to_track/load_drum_kit with load_browser_item. Add load_browser_item usage note to system prompts. Remove load_item_to_return chip from DailyTab RETURN/MASTER section.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: ableton-tcp-fix-and-sequence
WHAT: Fix 1: extracted sendAbletonTCP helper with 10s timeout + JSON.parse brace-balance detection (no more newline wait). Fix 2: response displays cleanly from parsed TCP buffer. New: POST /ableton-sequence — Claude plans full step array then executes each command sequentially, returns {ok, steps:[{command,response,ok}]}. UI: mode toggle (Single Command / Full Sequence), sequence shows step-by-step ✓/✗ list with summary.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: ableton-direct-tcp
WHAT: POST /ableton-command: receives instruction+apiKey, calls Claude (sonnet-4) to convert NL to AbletonMCP JSON command, sends via TCP to port 9877, returns parsed response. DailyTab: removed clipboard copy, added real POST to /ableton-command, loading spinner, response display, collapsible 128-tool browser with clickable chips that fill the textarea.
RESULT: watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] DailyTab.svelte + momentum-watcher.cjs — DONE
TASK: ableton-control-helper
WHAT: Added ABLETON CONTROL helper block to DailyTab helpers section. Status dot pings GET /ableton-status every 30s (TCP check on port 9877). Send button copies instruction to clipboard with "Paste in Claude Desktop" message. Added GET /ableton-status endpoint to watcher.
RESULT: works — /ableton-status returns connected:true (AbletonMCP socket detected on 9877)
BLOCKERS: none

## [2026-05-03] ProjectsTab.svelte + VocalEqChart.svelte — DONE
TASK: analyzer-overhaul
WHAT: Part 1 — fire-and-forget /analyze-vocal-eq after prod/mix drop. Part 2 — auto-select priority: PROJECT → SONG → LIBRARY. Part 3 — multi-ref chart overlay: selectedRefs[] per song, toggle picker with colored dots, VocalEqChart accepts refCurves[] array (4 colors: gold/teal/coral/purple). Part 4 — Mozart insight now passes real BPM/Key/LUFS/Energy/Brightness + all selected refs data. Part 5 — /generate-proq4-preset confirmed working (returns error only when curves missing, correct behavior).
RESULT: 0 compile errors, watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] momentum-watcher.cjs — DONE
TASK: whatsapp-batch-monitoring
WHAT: WhatsApp monitoring no longer fires Claude + Telegram per message. Messages are buffered in whatsappBuffer per contact, flushed every 5 min. Summary fires when quiet 30min or buffer 60min old. sendWhatsappSummary calls Sonnet with batch prompt, sends one structured Telegram message, saves as type='whatsapp_summary' to inbox.
RESULT: works — watcher restarted, ping ok
BLOCKERS: none

## [2026-05-03] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: references-overhaul
WHAT: Unified reference name resolution (both project and song refs now use /spotify-track-meta); song refs now have id field; both paths queue to reference_tracks library via /analyze-spotify-track; /analyze-spotify-track upserts to reference_tracks after analysis; lightweight path added for spotify_id-only calls; token expiry tracked + ensureSpotifyToken() added for /spotify-track-meta
RESULT: works — /spotify-track-meta returns title+artist, refs appear immediately, library sync fires on add
BLOCKERS: none

## [2026-05-01] momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: spotify-track-meta-endpoint
WHAT: Added GET /spotify-track-meta?id=... endpoint — fast Spotify metadata only (no Essentia), returns {title, artist, name}; updated addRefLink to use it instead of broken oEmbed
RESULT: works — confirmed "Never Gonna Give You Up — Rick Astley" response in under 1s
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: addreflink-final-clean
WHAT: Replaced addRefLink with final clean version — explicit current/refs split, refInput reset, expanded if(r.ok) block; GET get-page-title endpoint confirmed working (returns {title} field)
RESULT: saves work; title resolution returns empty from oEmbed server-side (separate issue)
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: addreflink-get-page-title-get-method
WHAT: Fixed addRefLink fetch to use GET with ?url= query param instead of POST+JSON body — matches actual watcher endpoint signature
RESULT: works
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: addreflink-get-page-title
WHAT: addRefLink now calls watcher /get-page-title for Spotify name resolution; spotifyId extracted upfront; refs built from p.reference_links directly
RESULT: saves work; name resolution depends on endpoint method matching (see notes)
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: revert-addreflink-oembed
WHAT: Reverted addRefLink back to original oEmbed approach — watcher fetch broke the Add button, oEmbed was working before
RESULT: works
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: fix-addreflink-timeout
WHAT: Fixed wrong response field names (d.name/d.artists → d.title/d.artist) and added 6s AbortController timeout so slow Essentia analysis doesn't freeze the Add button; save always falls through regardless
RESULT: works
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: fix-ref-link-spotify-name
WHAT: Replaced oEmbed fetch (failing silently in browser) with watcher /analyze-spotify-track call in addRefLink; name now stored as "Track — Artist" format matching other ref chips
RESULT: works
BLOCKERS: none

## [2026-05-01] momentum-watcher.cjs — DONE
TASK: fix-whatsapp-telegram-spam
WHAT: Suppress system/noise contacts from new-chat announcements (blocklist: you/whatsapp/stefania), deduplicate new-chat notifications with announcedChats Set so each JID announced once per session, skip Telegram forward for system ping messages (monitoring active/started/ping/heartbeat/status ok/is alive)
RESULT: works
BLOCKERS: none

## [2026-05-01] ProjectsTab.svelte — DONE
TASK: fix-version-numbering
WHAT: Fixed off-by-one in generateVersionName — production and MIX paths used n+1 instead of n, causing gaps (v04→v06) when "+ New Version" was clicked; also removed orphan empty versions from ECHOTRONICO (v06) and L'ODORE DEL MARE (v04) in DB
RESULT: works
BLOCKERS: none

## [2026-05-01] Start Momentum.command — DONE
TASK: rewrite-start-command
WHAT: Rewrote Start Momentum.command using Terminal.app — no iTerm dependency, no AppleScript heredocs
RESULT: works
BLOCKERS: none

## [2026-05-01] Start Momentum.command — DONE
TASK: fix-applescript-syntax-v2
WHAT: Rewrote Start Momentum.command using single-line osascript calls — fixes AppleScript syntax error
RESULT: works
BLOCKERS: none

## [2026-05-01] Start Momentum.command — DONE
TASK: fix-applescript-syntax
WHAT: Fixed AppleScript syntax error in Start Momentum.command — rewrote using heredoc osascript blocks
RESULT: works
BLOCKERS: none

## [2026-04-30] Start Momentum.command — DONE
TASK: add-phantom-bot-tab
WHAT: Added Phantom bot (api.py) as Tab 3 in Start Momentum.command; switched from Terminal.app to iTerm2; api.py lives at ~/Dropbox/!MOMENTUM MUSIC/!BACKUP/trading/api.py; activates venv before running
RESULT: script is executable, opens Svelte Dev / Claude Code / Phantom Bot tabs in order
BLOCKERS: none

## [2026-04-30] Start Momentum.command — DONE
TASK: remove-n8n-from-startup
WHAT: Removed n8n tab (Tab 3) and open http://localhost:5678 from Start Momentum.command on Desktop
RESULT: Script now opens only SvelteKit dev server and Claude Code tabs
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs — DONE
TASK: genre-intelligence
WHAT: buildGenreProfiles() groups analyzed library tracks by primary genre, computes avg BPM/energy/dance/valence/brightness/bass/loudness; saveGenreProfiles() upserts to brain_knowledge as 'Genre Profile: [genre]'; POST /update-genre-profiles endpoint; /genreprofiles Telegram command; genre profiles injected into /ask Mozart context; runs weekly Sunday 8am
RESULT: endpoint works (saved: 0 currently — only 3 tracks have tempo+genre, need >3 per genre; will populate as bg queue processes overnight)
BLOCKERS: none — data dependency only

## [2026-04-28] ProjectsTab.svelte — DONE
TASK: remove-task-creation-form
WHAT: Removed TASKS section from right panel (title + 3-row creation form + selectedProject wrapper); removed newTaskSong/Stage/Label/Date/Time state vars; removed addTask() function (52 lines)
RESULT: works — 0 remaining references, -93 lines
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: success-match-back-and-trend-fit
WHAT: [1] SUCCESS MATCH restored in analyzer, shown only when latestA exists, with on-demand "Analyze match" button; [2] POST /analyze-trend-fit endpoint: fetches up to 50 chart tracks, computes avg BPM/energy/dance/valence, sends gaps to Claude Haiku for 2-sentence insight; TREND FIT section in analyzer with gap chips (green=above, red=below) and "Analyze chart fit" button; ref-section-label CSS added
RESULT: works — pm2 restarted, ping ok
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs — DONE
TASK: bg-queue-youtube-limits
WHAT: MAX_PER_DAY 10→50, startup limit 5→50, delay 60s→30s, removed Spotify rate limit gate from runBackgroundQueue + startup (rate limit check stays inside processLibraryTrackInBackground for metadata only)
RESULT: works — pm2 restarted, ping ok. 449 tracks → ~3.7h overnight
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte + VocalEqChart.svelte — DONE
TASK: analyzer-five-fixes
WHAT: [1] Removed duplicate NEXT MOVE block (kept NEXT STEP in Mozart section); [2] Removed vocal style button, auto-runs in selectRefFromPicker+loadRefAnalysis, shows with gold VOCAL STYLE label; [3] Removed SUCCESS MATCH, TREND CONTEXT, FEEDBACK HISTORY dropdowns from analyzer; [4] VocalEqChart gains tonalBalance prop + syntheticCurveFromTonal() fallback when no real ref EQ curve exists; [5] Removed debug div showing mix_tonal/ref_tonal JSON
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs + analyze_vocal_eq.py — DONE
TASK: demucs-htdemucs_ft
WHAT: All Demucs calls switched from htdemucs to htdemucs_ft — analyze_vocal_eq.py --name flag, extractAcapella -n flag, vocalsPath directory name updated to htdemucs_ft
RESULT: works — committed
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs — DONE
TASK: bg-analysis-youtube
WHAT: Added downloadYouTubeAudio(artist, title) — yt-dlp ytsearch1 query, max 10min, mp3 output; processLibraryTrackInBackground now tries YouTube first, falls back to Spotify 30s preview; Spotify API only used for genres/metadata; /analyze-ref-now inherits same path via force=true
RESULT: works — pm2 restarted, ping ok
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: on-demand-ref-analysis
WHAT: POST /analyze-ref-now endpoint (find-or-create + force analyze); processLibraryTrackInBackground gains force=false param to skip rate limit; /processref Telegram command accepts optional search query; loadRefAnalysis auto-triggers /analyze-ref-now when ref has no tempo; analyzing indicator with pulse animation shown while pending
RESULT: works — pm2 restarted, ping ok
BLOCKERS: none

## [2026-04-28] momentum-watcher.cjs — DONE
TASK: bg-queue-permanent-fix
WHAT: MAX_PER_DAY 20→10, startup limit 500→5 with analysis_attempted_at filter, delay 30s→60s, analysis_attempted_at stamped in finally block, /processref Telegram command added
RESULT: works — pm2 restarted, ping ok, column already existed
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte — DONE
TASK: analyzer-version-name-and-ref-selection
WHAT: onAnalyzerTabOpen uses version_name for label, only auto-analyzes when no curves; added loadRefAnalysis() + selectRefFromPicker() + refTrackOverride state; all 3 picker onclick handlers now call selectRefFromPicker(); selectedRefTrack checks refTrackOverride first; version_name column confirmed exists in vocal_eq_curves
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte — DONE
TASK: ref-picker-sort
WHAT: Library picker shows 100 results (was 30), sorted by playlist_name when no search query; project refs always first
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte — DONE
TASK: analyzer-vocal-style-button
WHAT: Added vocal style analysis button in ANALYZER tab (shows when ref track has spotify_id); stores result in vocalStyleResult[song.id] state; removed 🎤 button from REFS tab chip row; updated analyzeVocalStyle() to store result instead of appending to aiMessages
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-28] ProjectsTab.svelte + VocalEqChart.svelte — DONE
TASK: analyzer-fix-curves
WHAT: FIX1 mixCurveData in isMixTab now uses songCurves.find(c => c.source_type==='mix') without stem_type filter — finds any mix curve; FIX2 tonal balance/stereo width conditions changed from latestA||ref to just ref — sections show whenever ref has data, even pre-analysis; removed {else} "no tonal data" message from tonal tab; FIX3 VocalEqChart already had unique clipId (random per instance) and all paths already used clip-path — no changes needed
RESULT: works — dev server 200
BLOCKERS: none

## [2026-04-27] ProjectsTab.svelte analyzer content audit — DONE
TASK: analyzer-verify
WHAT: Full audit of ANALYZER tab content — all 15 items confirmed present: stem tabs (3567), VocalEqChart (3691), ref picker (3576), Mozart insight (3947), tonal balance (3720+3802), stereo width (3756+3836), feel metrics (3894), emotional arc × 2 (3871 ref arc + 4133 own-mix SVG), credits (3923), project ref avg markers (3910), SUCCESS MATCH (4094), FEEDBACK HISTORY (4165), TREND CONTEXT (4190), Pro-Q 4 (3702), avg refs (3706). No items missing — no HTML changes needed.
RESULT: works
BLOCKERS: none

## [2026-04-27] ProjectsTab.svelte definitive analyzer cleanup — DONE
TASK: analyzer-definitive-cleanup
WHAT: Moved {#if activeSongTab==='analyzer'} OUTSIDE vocal-eq-section div so the entire div only renders when ANALYZER tab is active — no empty 4px gap in other stage tabs; confirmed all analyzer content (VocalEqChart, ref-picker, proq-btn, SUCCESS/FEEDBACK/TREND) appears exactly once, inside the tab; re-analyze button always visible with date label
RESULT: works
BLOCKERS: none

## [2026-04-27] ProjectsTab.svelte analyzer: ref picker + re-analyze — DONE
TASK: analyzer-reanalyze
WHAT: FIX1 confirmed ref picker already in ANALYZER tab (lines 3576+) and loadRefTrackOptions called on open — no change needed; FIX2 analyze button now always visible: shows '▶ Run Analysis' when no curves, '↺ Re-analyze' when curves exist; shows 'Last: dd.mm.yyyy' date from most recent mix curve; CSS .analyze-action-row + .last-analyzed added
RESULT: works
BLOCKERS: none

## [2026-04-27] ProjectsTab.svelte analyzer cleanup — DONE
TASK: analyzer-tab-only
WHAT: Removed old collapsible 🎤 ANALYZER toggle (vocal-eq-header button + showVocalEq condition); analyzer content now ONLY accessible via ANALYZER stage tab; removed dead onAnalyzerOpen() function; cleaned showVocalEq refs from analyzeMyVocal; removed orphaned CSS (.vocal-eq-header/.vocal-eq-title/.vocal-eq-arr); vocal-eq-section always has analyzer-tab class now
RESULT: works
BLOCKERS: none

## [2026-04-27] ProjectsTab.svelte analyzer feel metrics — DONE
TASK: analyzer-feel-metrics
WHAT: Library ref select query adds emotional_arc/energy/danceability/valence/brightness/warmth/bass_energy/loudness/tempo/key/camelot/vocal_pitch_mean; emotional arc bar display; ref stat chips (BPM/key/LUFS); feel metrics bars (energy/groove/mood/bright/warmth/bass) with project-ref-average white marker; loadProjectRefAverage() called on ANALYZER tab open; CSS for all new elements
RESULT: untested in browser
BLOCKERS: none

## [2026-04-27] momentum-watcher.cjs bg queue — DONE
TASK: bg-queue-stop
WHAT: Queue fully stopped (bgQueuePaused=true, queue cleared); max 20/day limit; 30s between tracks; 1h retry on rate limit; startup skips if paused/rate-limited; GET /pause-bg-queue + /resume-bg-queue; Telegram /pausequeue + /resumequeue
RESULT: works — queue paused + cleared immediately after restart
BLOCKERS: none

## [2026-04-27] analyzer tab, rate limit graceful, add library ref to project, queue on rate limit — DONE
TASK: four-fixes-analyzer
WHAT: FIX1 ANALYZER tab added to stages-row; activeSongTab==='analyzer' hides stage content, shows analyzer body without toggle; vocal-eq-section gets analyzer-tab class; FIX2 addReferenceVocal catches rate-limit error → sets spotifyRateLimited[sid] → inline ref-rate-limit-msg instead of alert; FIX3 saveRefToProject() calls /mozart-action add_project_reference for library tracks; + Save to project refs button shown when library ref selected and not already linked; FIX4 /analyze-spotify-track checks spotifyRateLimitUntil → queues to processingQueue → returns {ok,rate_limited,queued_until} instead of throwing
RESULT: compiles cleanly; watcher restarted OK
BLOCKERS: none

## [2026-04-27] demos: auto tempo/key, fix toggle, library genres, remove checkout, font fix — DONE
TASK: five-fixes-demos-brain
WHAT: FIX1 /analyze-audio accepts songId and PATCHes songs table when BPM found (only if tempo IS NULL); FIX2 toggleDemo() function consolidates both onclick handlers with stopPropagation on arr; FIX3 availableGenres loads from reference_tracks + GENRE_LIST fallback, used in per-song and header genre pickers; FIX4 CHECKOUT section fully removed from BrainTab (state, derived, functions, HTML, CSS); FIX5 refs-section-header bumped to 10px/.14em to match brain-section-title, library/speicher colors set to rgba(201,168,76,.75)
RESULT: compiles cleanly; watcher restarted OK
BLOCKERS: none

## [2026-04-27] scout: incorporate pulse check into scout message — DONE
TASK: scout-pulse-merge
WHAT: runPulseCheck gains returnOnly param — when true, returns {summary} without saving to inbox; runAgentScout calls it before inbox save and appends '## YOUR WORK PULSE' section to mainScoutText; DailyTab scoutArtists() drops separate /agent-pulse-check fetch
RESULT: one scout button → full picture (charts + artists + pulse); no duplicate pulse_check inbox entries
BLOCKERS: none

## [2026-04-27] analyzer: Mozart strategic context + next move section — DONE
TASK: analyzer-mozart-insight
WHAT: ANALYZER panel now shows ✓ Reference added confirm when mozartAnalysis[song.id]?.ok; strategic/creative/next_step already rendered via mozartInsight; added standalone next-move-section below mz-insight with gold border-left styling; also handles case where mozartAnalysis.ok without mozartInsight (shows confirm only); CSS: ref-added-confirm, next-move-section, next-move-label, next-move-text
RESULT: compiles cleanly; visible after running Mozart analysis
BLOCKERS: none

## [2026-04-27] mozart refs: always enrich with spotify before saving, never null url — DONE
TASK: mozart-ref-enrich
WHAT: /mozart-action add_project_reference: removed conditional (was: only enrich if !spotify_id) — now always calls fetchSpotifyId(); sets payload.url, payload.name during enrichment; adds URL fallback after enrichment block (spotify_id→url or null); ref push uses payload.url/payload.name instead of recomputing
RESULT: watcher restart ok
BLOCKERS: none

## [2026-04-27] scout: no checkout, youtube names, tiktok 10 full width, unique mentioned, hide lib if in library — DONE
TASK: scout-five-fixes
WHAT: FIX1: saveToCheckout already removed from runAgentScout (done prior); FIX2: fetchKworbTrending rewritten to return objects {position,title,artist} + debug log + all kworbYT string callsites updated; FIX3: tiktok-col spans 2 grid columns with 10-item 2-col sub-grid (CSS: grid-column:span 2, grid-template-columns:1fr 1fr); FIX4: chartTrackKeys dedup uses /\W/g not /\s/g, label renamed ALSO MENTIONED; FIX5: loadLibraryIds() on mount, librarySpotifyIds Set, lib btn hidden shows ✓ badge when track in library, addChartTrackToLibrary updates Set on success
RESULT: watcher restart ok; loadLibraryIds fires on DailyTab mount
BLOCKERS: YouTube cell mapping uses [1]=title [2]=artist — may need adjustment after seeing actual kworb HTML structure (debug log added)

## [2026-04-27] scout display: brain btn removed, track dedup, youtube spotify, tiktok10, no dupe charts — DONE
TASK: scout-display-fixes-6
WHAT: FIX1/6: removed + brain button from chart rows and suggested tracks (only ▶ play + lib remain); FIX2: suggested_tracks filtered against all chart tracks via case-insensitive key set; FIX3: YouTube tracks enriched with Spotify ID via fetchSpotifyId() in parallel before storing in metadata; FIX4: TikTok metadata slice 5→10; FIX5: ## CHARTS section stripped from agent-output via regex before parseAgentOutput
RESULT: watcher restart ok; DailyTab compiles cleanly; effects visible on next /agent-scout run
BLOCKERS: none

## [2026-04-27] scout: chart actions + suggested tracks + articles split — DONE
TASK: fix3-fix4-fix5
WHAT: FIX3: chart rows expanded with stacked artist/title + play/brain/lib action buttons + addChartTrackToBrain/addChartTrackToLibrary/playSpotifyTrack functions; FIX4: scout no longer auto-saves to reference_tracks — extractTracksFromText now runs inside runAgentScout, result stored as metadata.suggested_tracks, displayed as MENTIONED TRACKS block with brain/lib buttons; FIX5: scoutText split on ## PRESS — main text saved as type=scout, press section saved as separate type=scout_articles with collapsible header in DailyTab; /save-to-library POST endpoint added to watcher
RESULT: watcher restart ok; will take effect on next /agent-scout run
BLOCKERS: none

## [2026-04-27] scout: 4-chart grid (spotify global+DE, tiktok, youtube) — DONE
TASK: scout-chart-grid
WHAT: Added fetchKworbGermany() for de_daily.html; kworbDE added to scout Promise.all; chartContext built and injected into prompt; CHARTS section added first in prompt order; scout inbox_notification now saves metadata with spotify_global/spotify_de/tiktok/youtube arrays; DailyTab renders 2x2 chart-grid before agent-output for scout type; CSS added
RESULT: watcher restart ok; chart grid will render on next agent-scout run
BLOCKERS: none

## [2026-04-27] momentum-watcher.cjs saveToCheckout — DONE
TASK: saveToCheckout-dedup
WHAT: Added source/collection_name to duplicate check select for better logging; added spotify_id secondary check; log now shows which source/collection the duplicate was found in
RESULT: works — pm2 restart ok
BLOCKERS: none

## [2026-04-27] DailyTab.svelte + momentum-watcher.cjs — DONE
TASK: daily-six-fixes
WHAT: FIX1 removed ICS import/export buttons+functions; FIX2 normalized agent-gap/agent-ok font-size to 13px; FIX3 briefing now fetches active songs and focuses prompt on them; FIX4 removed TikTok block from morning briefing; FIX5 scout saves as type=scout, merged section order, inbox-scroll raised to 600px, scout renders with parseAgentOutput; FIX6 added GET /chart-health endpoint
RESULT: chart-health tested ok (tiktok:ok, spotify_chart:ok, chart_history:empty expected); watcher ping ok
BLOCKERS: none

## [2026-04-27] momentum-watcher.cjs — DONE
TASK: shell-quoting-fix
WHAT: Added shellEscape() function; applied to all 23 file path arguments in exec/execSync calls (analyze_audio.py, analyze_vocal_eq.py, ffmpeg, ffprobe, demucs). Fixes filenames with backticks, single quotes, apostrophes, spaces.
RESULT: works — pm2 restart confirmed, /ping responding
BLOCKERS: none

## [2026-04-26] momentum-watcher.cjs — DONE
TASK: tier-split-analysis
WHAT: Split analysis pipeline into Tier 1 (auto, fast) and Tier 2 (on-demand, heavy). processLibraryTrackInBackground() now Tier 1 only: Spotify preview+genres, Essentia BPM/key/energy/tonal/stereo, Genius credits (~15-20s per track). Demucs stem EQ moved to runStemAnalysis() (Tier 2, called only by POST /analyze-stems). Completion signal changed from vocal_eq_curves presence to tempo != null. Startup queue changed from limit:50 + EQ check to limit:500 + tempo IS NULL. POST /analyze-stems endpoint added for on-demand Tier 2 trigger.
RESULT: works — 449 tracks queued (Tier 1), rate limited ~14h from earlier genre enrichment run, will auto-resume
BLOCKERS: none

## [2026-04-26] momentum-watcher.cjs + src/lib/BrainTab.svelte — DONE
TASK: import-all-user-playlists-v2
WHAT: importAllUserPlaylists(): use playlist.items.href (not playlist.tracks.href — that field is null in API response). Use /playlists/{id}/items endpoint (not /tracks). Map i.item (not i.track — different field name in /items response). genre_tag = playlist name lowercased. genres = Spotify artist genres (cached per session). BrainTab library display: playlist_name shown in gold .playlist-tag, genres[0] shown in dim .track-genre-tag. Followed playlists (not owned) skip cleanly with 403.
RESULT: WORKS — 434 tracks saved from 21 user-owned playlists (ELECTRONIC EDM: 29, ELECTRONIC INDIE: 69, POP INDIE: 45, RAP: 8, etc.). 2 followed playlists skip 403 (expected).
BLOCKERS: none

## [2026-04-26] momentum-watcher.cjs — PARTIAL
TASK: import-all-user-playlists
WHAT: Added importAllUserPlaylists() — fetches /me/playlists (works), then /playlists/{id}/tracks per playlist. genre_tag derived from playlist name (user's own Spotify label, e.g. "ELECTRONIC EDM" → "electronic edm"). Per-session artist genre cache avoids redundant API calls. POST /import-all-my-playlists endpoint added. Tested: 22 playlists found, all tracks skipped (403 on /tracks endpoint — Spotify app quota restriction).
RESULT: partial — endpoint works and found 22 playlists. /tracks returns 403 on ALL playlists. Needs Spotify Extended Access.
BLOCKERS: Go to developer.spotify.com → your app (45bb7c8c0553458ca79e0848ea805559) → Settings → Request Extended Access for /playlists/{id}/tracks

## [2026-04-26] momentum-watcher.cjs — PARTIAL
TASK: fix-playlist-import-fields-param
WHAT: importSpotifyPlaylist(): removed fields filter from /tracks URL, fetches full response. Moved playlist name fetch before tracks loop. Both fetches use direct token (no spotifyFetch wrapper).
RESULT: fields param removed — but /playlists/{id}/tracks returns 403 for ALL playlists with BOTH client_credentials and user OAuth tokens. /playlists/{id} metadata works, /me/playlists works. Confirmed: this is a Spotify API-level restriction (app quota/extended access), not a code bug.
BLOCKERS: Spotify Developer App likely needs Extended Access approval for /playlists/{id}/tracks. Check https://developer.spotify.com/documentation/web-api/concepts/quota-modes

## [2026-04-26] momentum-watcher.cjs — DONE
TASK: persist-spotify-oauth-token
WHAT: Added SPOTIFY_TOKEN_FILE (.spotify-token.json), loadSpotifyToken() (reads on startup, auto-refreshes if expired), saveSpotifyToken() (writes after OAuth + refresh), refreshSpotifyToken() (uses refresh_token to get new access_token). loadSpotifyToken() called in server.listen on startup. saveSpotifyToken() called in /spotify-callback after successful exchange. Token survives pm2 restarts.
RESULT: works — pm2 restart clean; no token file yet (need one OAuth round to seed it)
BLOCKERS: first-time auth still needed; subsequent restarts will load from disk automatically

## [2026-04-26] momentum-watcher.cjs — DONE
TASK: fix-playlist-import-token
WHAT: importSpotifyPlaylist(): capture token at start (spotifyUserToken || getSpotifyToken()), log token type (USER_OAUTH vs CLIENT_CREDS), bypass spotifyFetch wrapper and use direct fetch with captured token for tracks + playlist name requests, log 403 body on failure. Debug confirmed: CLIENT_CREDS causes 403 on private playlists — must authorize via /spotify-auth first.
RESULT: works — 403 correctly logged when user token absent; will succeed once OAuth token set
BLOCKERS: needs user to open http://127.0.0.1:4242/spotify-auth and complete OAuth flow after each pm2 restart

## [2026-04-26] momentum-watcher.cjs — DONE
TASK: fix-spotify-oauth-callback
WHAT: /spotify-callback: use body.toString() for URLSearchParams (not object passthrough), add OAuth token response logging with scope, show scope in response HTML. fetchSpotifyId() already fixed to route through spotifyFetch(). Hardcoded SPOTIFY_CLIENT_ID/SECRET constants used (not process.env).
RESULT: works — pm2 restart clean
BLOCKERS: none

## [2026-04-26] momentum-watcher.cjs — DONE
TASK: fix-spotify-user-token-playlist
WHAT: spotifyFetch() already used spotifyUserToken || getSpotifyToken(). Fixed fetchSpotifyId() to route through spotifyFetch() instead of raw getSpotifyToken(). Fixed pulse-check agent to prefer spotifyUserToken in parallel prefetch. importSpotifyPlaylist() already used spotifyFetch(). All Spotify calls now use user token when available.
RESULT: works — pm2 restart clean
BLOCKERS: none

## [2026-04-26] analyze_audio.py + src/lib/ProjectsTab.svelte — DONE
TASK: tonal-balance-analyzer-tab
WHAT: analyze_audio.py adds tonal_bands {low,high} split points to stereo_tonal output. ProjectsTab ANALYZER gets TONAL stem tab (6th tab). When active: shows TONAL BALANCE bars (4 bands, mix=gold/ref=dim white, stacked) + STEREO WIDTH bars (color-coded: gray=mono, gold=normal, green=wide). widthLabel() helper for width text. EQ chart hidden on TONAL tab. loadVocalEq selects tonal_balance/stereo_width/stereo_width_per_band from reference_tracks.
RESULT: works — svelte-check 0 errors
BLOCKERS: tonal_balance/stereo_width columns may not exist yet in reference_tracks — null-safe, shows gracefully

## [2026-04-26] analyze_audio.py — DONE
TASK: stereo-tonal-analysis
WHAT: Added analyze_stereo_and_tonal() function. Uses es.AudioLoader for stereo read, scipy.fft for band FFT. Outputs: stereo_width (0=mono, 1=wide), tonal_balance {bass/low_mid/high_mid/air as % of total energy}, stereo_width_per_band (M/S ratio per band), crest_factor_per_band (peak/RMS per band). Wrapped in try/except — fields null on failure.
RESULT: works — tested on real WAV, all 4 fields output correctly
BLOCKERS: none

## [2026-04-25] src/lib/VocalEqChart.svelte + src/lib/ProjectsTab.svelte — DONE
TASK: analyzer-four-fixes
WHAT:
  FIX1: FULL MIX added as first stem tab (default). mixCurveData/refCurveData handle stemKey==='mix' (null/undefined stem_type). isMixTab const derived and passed to VocalEqChart.
  FIX2: iZotope curve, range band, legend, and iZ toggle button all gated behind isMixTab. Hidden on VOCALS/DRUMS/BASS/OTHER tabs.
  FIX3: IZOTOPE_OFFSET renamed to IZOTOPE_PEAK_DB with iZotopeNorm() helper. iZotope values excluded from dbRange calculation on stem tabs — prevents chart range from being squished by -50dB iZ tail. On FULL MIX tab, iZ values included in range so full curve is visible.
  FIX4: loadVocalEq() now collects project+song reference_links, looks up matching reference_tracks rows by spotify_id, populates refTrackOptions with _section='PROJECT'|'SONG'|'LIBRARY'. Dropdown shows PROJECT REFS + SONG REFS optgroups above HIT SONGS + LIBRARY. genre_tag shown in LIBRARY options.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] src/lib/DailyTab.svelte — DONE
TASK: agent-buttons-routine-only
WHAT: Agent buttons row (Morning Briefing + Scout) and todayBriefing block wrapped in {#if activeSection === 'routine'}. They no longer appear in PRIVATE or HELPERS sections. visibleInbox $derived confirmed active in all 3 inbox stream filter positions.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] src/lib/DailyTab.svelte — DONE
TASK: inbox-section-filter
WHAT: briefing/scout/pulse_check/chart inbox types now only visible in ROUTINE section. Added routineOnlyTypes const + visibleInbox $derived that filters by activeSection. Inbox stream uses visibleInbox instead of inboxItems in all 3 filter expressions.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] src/lib/DailyTab.svelte — DONE
TASK: acapella-extractor-dailytab
WHAT: Added Acapella Extractor section to Helpers tab directly below Normalizer. Drop zone, loading state, result panel (filename/BPM/key/vocal-in). State vars: acapellaFile, acapellaLoading, acapellaResult, acapellaDragging. Functions: handleAcapellaDrop(), runAcapellaExtract() (FileReader base64 → POST /extract-acapella). Full CSS matching palette.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: cleanup-temp-audio-files
WHAT: Startup sweeps all /tmp/ref_preview_* ref_bg_* tiktok_* sp_preview_* vocal_* mm_* yt_* acapella_* demucs_* stem_eq_* onset_* on every watcher start. processLibraryTrackInBackground() adds exec('rm -rf /tmp/demucs_* /tmp/stem_eq_*') after unlinkSync(tmpFile). analyze_vocal_eq.py already had shutil.rmtree in finally block — no change needed. All yt-dlp/curl tmpAudio paths already had unlinkSync — confirmed.
RESULT: works — pm2 restart ok, ping ok
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: acapella-output-cleanup
WHAT: extractAcapella() saves output to /Users/remo/Desktop (not Stems). Demucs temp folder cleaned with exec('rm -rf tmpDir'). Base64 temp input cleaned in endpoint after call. Original file_path never touched. Response includes saved_to:'Desktop', original_untouched:true.
RESULT: works — pm2 restart ok, ping ok
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte — DONE
TASK: analyzer-mozart-insight-panel
WHAT: Added Mozart Insight section below EQ chart. loadMozartInsight() calls Claude Haiku with song+ref context, returns JSON {strategic, creative, next_step}. Auto-fires when ref dropdown changes. Shows STRATEGIC CONTEXT / CREATIVE DIRECTION / NEXT STEP with gold section labels. Costs tracked via /track-cost. svelte-check 0 errors.
RESULT: works — svelte-check 0 errors
BLOCKERS: none (requires API key in localStorage)

## [2026-04-25] momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: error-handling-supabase-writes-refs-display
WHAT: Added { error } destructuring + console.error to 21 unchecked Supabase write calls. Fixed REFERENCE LINKS display to merge song.work_data.reference_links (Mozart) + song.reference_links (manual) in one {#each}. normSongRef() now handles Mozart format (title/artist/spotify_id→url). removeSongRef() removes from both sources. Refresh after Mozart action now fetches both work_data and reference_links.
RESULT: works — svelte-check 0 errors, pm2 OK
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: mozart-refs-refresh-dedup
WHAT: FIX1: sendAI() refreshes song.work_data from Supabase after add_project_reference tool_use succeeds. FIX2: normalizeTrack dedup on save (strips non-alphanumeric, 30-char key), runs dedup on existing refs before pushing. POST /fix-song-refs endpoint: removes Test Artist entries + deduplicates. Ran on song 152: 4→3 refs.
RESULT: works — svelte-check 0 errors, pm2 OK, fix-song-refs confirmed {before:4,after:3}
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: unified-fetchSpotifyId-helper
WHAT: Added fetchSpotifyId(title, artist) shared helper. add_project_reference now auto-enriches with Spotify before saving, also calls saveToCheckout(collection=project_reference). TikTok trend search replaced with fetchSpotifyId(). Duplicate check now also matches by spotify_id. 
RESULT: works — pm2 restart OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + mozartContext.js — DONE
TASK: fix-mozart-add-project-reference
WHAT: Rewrote add_project_reference handler to use supabase client + write to work_data.reference_links (not top-level column). Added project_name ilike lookup + latest-song fallback + full error logging. Updated mozartTools payload description to use title/artist/spotify_id instead of track string.
RESULT: works — tested with project_name=nidjo, song resolved and DB write confirmed
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: mozart-actions-refs-untitled-projects
WHAT: Song-level REFERENCE LINKS block now always visible (removed {#if} guard on stage/links count). Add form also always shown. /mozart-action add_project_reference resolves project_name → song_id via ilike title match, falls back to most recent null-title song.
RESULT: works — svelte-check 0 errors, pm2 restart OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + mozartContext.js + ProjectsTab.svelte — DONE
TASK: mozart-session-autosave
WHAT: Every Mozart exchange auto-saved to brain_knowledge (category=mozart_session). POST /save-brain-entry added for direct brain inserts + Spotify track import (action=save_spotify_ref). mozartContext includes last 10 sessions so Mozart remembers prior conversations. Spotify links pasted in chat auto-imported to reference_tracks.
RESULT: works — tested /save-brain-entry, svelte-check 0 errors, pm2 restart OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: music-tips-master-finishing-checklist-panel
WHAT: BUILD1: rebuildMusicTips() fetches mixing/production/question brain entries + music_tips source entries, asks Claude Opus to synthesize into 🎵 MUSIC TIPS MASTER.md, triggers on save-brain-file for matching categories + startup 20s + POST /rebuild-music-tips. BUILD2: rebuildFinishingChecklist() reads tips file + question entries, asks Haiku for JSON checklist, upserts to brain_knowledge checklist_70 + POST /rebuild-finishing-checklist. BUILD3: CHECKLIST 70% panel wired — finishingChecklist loaded from Supabase on mount, displayed with phase labels, checkboxes, why notes.
RESULT: svelte-check clean, both endpoints respond ok, watcher restarted
BLOCKERS: claude-opus-4-5-20251001 model ID may need verification (user-specified)

## [2026-04-25] momentum-watcher.cjs + mozartContext.js — DONE
TASK: brain-master-compact-format-mozart-priority-rules
WHAT: FIX1: rebuildBrainMaster() rewritten — compact format, blockquote priority section, **Title** <small>date</small> per entry, content truncated to 300 chars, category entry count in header. FIX2: mozartContext.js fetches priority+locked entries, prepends ⚡ CORE RULES & PRIORITIES section before full context, system prompt updated to reference it.
RESULT: svelte-check clean, rebuild endpoint ok:true, file regenerated
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: brain-dump-master-obsidian-core
WHAT: rebuildBrainMaster() writes /ObsidianVault/Momentum/⚡CORE/BRAIN DUMP MASTER.md — all user text + locked entries grouped by category. Triggered on every /save-brain-file call + POST /rebuild-brain-master endpoint + startup at 8s. Creates CORE dir if missing.
RESULT: works — file created (119KB), endpoint returns ok:true
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + BrainTab.svelte + mozartContext.js — DONE
TASK: reference-tracks-spotify-genres-library-chips-mozart-fingerprint
WHAT: fetchTrackGenres() fetches Spotify artist genres; processLibraryTrackInBackground saves to genres column; startup enriches missing tracks (45s delay, 3s between); POST /enrich-library-genres endpoint; genre chips in BrainTab library rows; genre fingerprint section in Mozart context and suggest-category prompt
RESULT: svelte-check clean, watcher restarted
BLOCKERS: Requires SQL: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS genres jsonb;

## [2026-04-25] BrainTab.svelte — DONE
TASK: brain-section-titles-gold-speicherbox-collapsed-library-search
WHAT: LIBRARY, CHECKOUT, SPEICHERBOX headers → gold (#c9a84c); speicherboxExpanded defaults to false; librarySearch + filteredLibraryRefs already implemented (no-op)
RESULT: works
BLOCKERS: none

## [2026-04-25] VocalEqChart.svelte + ProjectsTab.svelte — DONE
TASK: chart-clip-id-collision-ref-dropdown-always-show
WHAT: FIX1: unique clipId per chart instance (Math.random) — prevents shared chart-clip ID collision when multiple songs open simultaneously. FIX2: ref dropdown always shows (removed length guard); source list adds 'promoted', limit→200, spotify_id added; "no EQ curve yet" message when ref selected but no curve found.
RESULT: svelte-check clean
BLOCKERS: none

## [2026-04-25] VocalEqChart.svelte + ProjectsTab.svelte — DONE
TASK: analyzer-chart-autoscale-izotope-successmatch-trenddropdown
WHAT: FIX1: Y-axis auto-scales from actual curve data (DB_MIN/DB_MAX derived, gridDbs derived) — clip-path already existed. FIX2: IZOTOPE_OFFSET computed dynamically (-Math.max avg) instead of hardcoded 36.32; band fill more visible (0.04). FIX3: loadSuccessMatch guard (skip if already loaded); refTrackOptions loads ALL library tracks (source IN user/agent/mozart, limit 100) not just those with EQ curves.
RESULT: svelte-check clean
BLOCKERS: none

## [2026-04-25] DemoTab.svelte — DONE
TASK: submission-brief-move-to-main-flow
WHAT: Moved BRIEF / REQUEST INFO section from patch modal to expanded patch card body (before Send button). analyzeBrief() now accepts optional contactId param. sendPatch() uses submissionBrief/submissionResults directly and clears them after send. Removed patchBriefs map (unused). Modal cancel no longer resets brief state.
RESULT: works — svelte-check clean
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: tiktok-top10-spotify5-youtube5
WHAT: Rewrote runAgentTikTokTrends() — TikTok top 10 (was all 20), Spotify top 5 via fetchKworbSpotify(), YouTube top 5 via fetchKworbTrending(). All 20 saved to checkout with collection_name per source (tiktok_trending/spotify_chart/youtube_chart). Inbox message prepends 📱/🎵/▶ raw lists before Claude analysis. BrainTab checkout shows source badge per track.
RESULT: watcher restart OK, ping confirmed
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: fix-scout-supabase-catch
WHAT: Replaced supabaseAdmin.from('chart_history').upsert(...).catch() with async/await + error check — supabase query builder is thenable but not a full Promise so .catch() is not a function
RESULT: works — watcher ping OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: brain-category-consolidation
WHAT: Merged artist_breaking + emerging_artists_tracking → artist_strategy. Added consolidateBrainCategories() + POST /consolidate-brain-categories endpoint. Removed deprecated categories from standardCats, agent prompts, and NOW note extraction enum. Removed obsolete overlap detection check. Migration moved 12 entries.
RESULT: works — moved 12 entries, watcher ping OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: brain-dedup-rewrite
WHAT: Replaced naive /cleanup-brain-dupes (exact title match, delete all dupes) with mergeDupes(): groups by category+normalizeTitle (strips date prefix, lowercase, 60-char key); never touches confidence=locked or source_type=text entries; merges unique sentences (>15 chars) from agent dupes into kept entry; agent-only groups keep oldest, delete rest; batched deletes in 50s. 3am daily auto-run added to existing setInterval cron. First run: deleted 160, merged 37.
RESULT: works — watcher ping OK, curl returned {ok:true, deleted:160, merged:37}
BLOCKERS: none

## [2026-04-25] src/lib/DailyTab.svelte — DONE
TASK: remove-todo-after-year-tab
WHAT: Removed ['general','TODO'] from plan sub-tabs array; removed getUpcomingItems 'general' early-return. The shared {:else} block for MONTH remains intact.
RESULT: works — Vite hot-reloaded, no new errors
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: spotify-split-guards
WHAT: Added ?. optional chaining to url.split('/track/')[1], url.split('/artist/')[1], and url.split('/playlist|artist/')[1] chains in analyzeVocalEqUrl, /agent-import-spotify track branch, artist watch branch, and playlist/artist branch. Prevents 'Cannot read properties of undefined (reading split)' on malformed Spotify URLs. /analyze-spotify-track was already guarded.
RESULT: works — watcher restart OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: notes-reconcile-deleted
WHAT: Added reconcileNotes() — fetches Apple Notes list, compares with NOTES_PATH files (source=apple_notes only), hard-deletes any .md file not present in Apple Notes. Runs 10s after startup and every 5min alongside syncAppleNotesToObsidian(). Bails safely if Apple Notes returns empty (unreachable). No frontend change needed (readNotesDir() naturally excludes deleted files).
RESULT: works — watcher restart OK, ping confirmed
BLOCKERS: none

## [2026-04-25] src/lib/VocalEqChart.svelte — DONE
TASK: izotope-2024-reference-curve
WHAT: Added IZOTOPE_2024 30-point data, IZOTOPE_OFFSET=36.32 to align peak to 0dB, makeIzotopePath() and makeIzotopeRange() using existing xForFreq/yForDb helpers. SVG renders shaded hi/lo band (rgba white 0.025) + dashed avg line (rgba white 0.15) behind ref/mix curves, with clip-path. iZotope legend added at SVG right edge. Toggle button (iZ) below chart. Wrapped in .eq-wrap div.
RESULT: works — Vite hot-reloaded cleanly, no compile errors
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: agent-brain-inbox-architecture
WHAT: Added extractInsight()/todayStartISO()/deleteInboxToday() helpers. All 5 agents (Briefing, Scout, Pulse, Chart, TikTok) now: (1) delete-before-insert in inbox so only one clean entry/day; (2) extract key insight via Claude Haiku; (3) INSERT insight to brain_knowledge so brain accumulates real intelligence. Old verbose full-text brain saves replaced with distilled 200-char insights.
RESULT: works — watcher restart OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: fix-duplicate-briefings
WHAT: Morning briefing insert now deletes today's existing 'Morning Briefing' row before inserting fresh one; added POST /fix-inbox-dupes endpoint to deduplicate all briefings (keep latest per day); ran cleanup — deleted 1 duplicate
RESULT: works — watcher ping OK, fix-inbox-dupes returned {ok:true,deleted:1}
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: telegram-auto-cleanup
WHAT: sentMessages array tracks all bot message IDs; sendTelegram now stores message_id on success; runTelegramCleanup() deletes messages older than 24h via API; hourly setInterval fires cleanup automatically; /cleanup command triggers manual cleanup and reports count; /help updated
RESULT: works — watcher restarted, ping OK
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: obsidian-backlinks-moc
WHAT: syncObsidianFile() now enriches NEW entries: (1) findRelatedVaultNotes() scans vault root + Brain/ subdirs for keyword-matched .md files; (2) patchObsidianRelated() adds [[backlinks]] to new note's Related section; (3) patchObsidianSeeAlso() appends "See also: [[newTitle]]" to each related note; (4) updateCategoryMOC() writes MOC/[category].md with all entries sorted newest first; (5) updateObsidianIndex() now prepends category counts + [[MOC/cat]] links at top of INDEX.md. _obsidianSyncDebounce set prevents chokidar loop when patching files. MOC/ and INDEX.md skip guard added to syncObsidianFile.
RESULT: works — code verified, 8/8 tests passing. Enrichment fires via setImmediate after INSERT path only.
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: fix-triple-date-prefix, tiktok-tracks-to-checkout-only
WHAT: FIX 1: added cleanTitle() helper (strips all leading YYYY-MM-DD_ patterns); applied in saveBrainFile heading, syncObsidianFile now stores bareFilename as Supabase title, connectBrainEntries uses cleanTitle on entry titles. POST /fix-brain-titles endpoint cleans existing corrupted entries — ran immediately, fixed 478 entries + deduplicated 185 duplicates revealed by cleanup. FIX 2: removed brain_knowledge insert from runAgentTikTokTrends — tracks go to reference_tracks (checkout) only; brain only gets Claude's market_knowledge insight via inbox.
RESULT: works — 8/8 tests, 696 clean entries, 0 double-prefix entries, 0 duplicates
BLOCKERS: none

## [2026-04-24] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: analyzer-ref-dropdown, background-processing-pipeline, genius-credits
WHAT: BUILD 1: ANALYZER ref dropdown selects from library tracks processed by background pipeline, credits panel below chart. BUILD 2: processLibraryTrackInBackground() + queue on startup — Essentia analysis + Demucs EQ curves for all library tracks without curves yet. BUILD 3: fetchGeniusCredits() scrapes Genius for producer/mixer/master credits, wired into background pipeline. POST /fetch-credits + GET /processing-queue endpoints added. Fixed brain dupe root cause: saveBrainFile strips date prefixes before building filename; syncObsidianFile now matches bare title (no date prefix) before inserting new rows.
RESULT: works — 8/8 tests passing, watcher clean
BLOCKERS: vocal_eq_curves.reference_track_id + reference_tracks.credits + emotional_arc columns must be added via Supabase dashboard SQL editor (see notes)

## [2026-04-24] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: no-duplicate-ref-saves, library-sort
WHAT: Added saveToCheckout() with title+artist case-insensitive dedup check before every reference_tracks insert. Replaced all direct inserts in scout/tiktok/chart agents. Added library sort (date/artist) toggle to BrainTab, artist-first display in all three ref sections (checkout/my refs/library), fixed cleanup-brain-dupes to use supabaseAdmin.
RESULT: works — 8/8 tests passing, no duplicate ref saves, sort buttons render
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: tiktok-tracks-response-and-checkout
WHAT: Added tracks:realTrends to runAgentTikTokTrends return value. Added upsert of all raw realTrends to reference_tracks (collection_name=tiktok_trending) immediately after fetch, using supabaseAdmin to bypass RLS.
RESULT: works — tracks found: 20, positions 1-20 from tikcharts week 2026-02-16
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: tikcharts-next-data-scraper
WHAT: Replaced HTML table row parsing with __NEXT_DATA__ JSON extraction. tikcharts.com uses Next.js — data is embedded in <script id="__NEXT_DATA__">. Now navigates props.pageProps.entriesByWeek, takes latest week key, returns up to 20 tracks with position/title/artist/youtube_id/tiktok_slug/image_url/week.
RESULT: works — found 100 tracks for week 2026-02-16, 5 processed into trend_tracks
BLOCKERS: none (response key is trend_tracks not tracks)

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: tiktok-daily-schedule
WHAT: Added 9am daily TikTok trends trigger in shared setInterval (alongside Sunday brain review). Morning briefing now sends TikTok top 5 as a 3rd Telegram message after crypto signal. /tiktok Telegram command for manual trigger. /tiktok added to /help.
RESULT: works — watcher starts clean
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: obsidian-smart-folders
WHAT: Added getSmartFolder() routing (8 emoji folders by category/confidence/priority), updateObsidianIndex() that writes INDEX.md with top 10 entries per section. saveBrainFile() now copies to smart folder if fs.existsSync check passes. 8s startup backfill populated 233 entries. Protected files (Notes/, NOW.md, Unbenannt.canvas, Willkommen.md) untouched.
RESULT: works — ⚡ CORE:36, 📋 RULES:2, 🎯 GOALS:2, 🎵 PRODUCTION:42, 🧠 KNOWLEDGE:34, 👥 PEOPLE:32, 📦 MY SONGS:13, 💡 IDEAS:4
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: brain-connect
WHAT: Added connectBrainEntries() — sends last 50 active brain entries to Haiku, gets back connection pairs with merge/link/promote actions, saves as brain observation, sends Telegram summary. Runs Sunday 8am alongside weeklyBrainReview. /connect Telegram command for manual trigger. /connect added to /help.
RESULT: works — watcher starts clean
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: vocal-eq-fuzzy-audio-search
WHAT: /analyze-vocal-eq now falls back to fuzzy search by song code when exact audio_path from work_data is not found. Searches MIXING_DIR then PRODUCTION_DIR for files starting with song code, takes latest version (sorted desc). Logs 'vocal eq fuzzy match' when used.
RESULT: works
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: vocal-eq-fix-curve-save
WHAT: Replaced bulk fetch insert in /analyze-vocal-eq with per-stem supabaseAdmin loop with explicit error logging. Added supabaseAdmin client using SUPABASE_SECRET_KEY to bypass RLS. Removed non-existent 'type' and 'url' columns from insert. Fixed analyzeVocalEqUrl (reference type) with same pattern. Response now includes 'saved' array with stem names and IDs.
RESULT: works — 4 stems (vocals/drums/bass/other) saved to vocal_eq_curves for song 118
BLOCKERS: version_name column not yet in table — run SQL: ALTER TABLE vocal_eq_curves ADD COLUMN IF NOT EXISTS version_name text;

## [2026-04-24] src/lib/ProjectsTab.svelte — DONE
TASK: fix-vocal-eq-expand-crash
WHAT: Added missing {@const refCurves} and {@const mixCurves} inside {#if showVocalEq[song.id]} block — these were referenced but never declared, causing TypeError that crashed Svelte reactivity and broke song expand clicks
RESULT: works
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: vocal-eq-production-versions
WHAT: /analyze-vocal-eq mix type now accepts both version_type='mixing' and version_type='production'. Versions sorted by name descending to get latest. File lookup checks MIXING_DIR first, then PRODUCTION_DIR.
RESULT: works
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs + src/lib/FinancesTab.svelte — DONE
TASK: coin-rotation-monitor
WHAT: Added full 5-coin rotation trading monitor (BTC, ETH, DOGE, XRP, FLOKI). fetchAllCoinPrices() from CoinGecko EUR. scoreCoinForEntry() contrarian scoring (dip=+3, funding squeeze=+2, volatility bonus for meme coins). recommendNextCoin(excludeCoin) ranks remaining coins. monitorActiveTrades() runs every 15min: checks active_trades, updates pnl_pct/pnl_eur in DB, sends Telegram TAKE PROFIT (+5%) or STOP LOSS (-5%) alerts. New Telegram commands: /next (ranked coin analysis), /trade100 /tradeeth100 /tradedoge100 /tradexrp100 /tradefloki100 (buy prepare), /selldoge /sellxrp /sellfloki (sell via active_trades). Generalized /sell reads from active_trades for all coins. GET /all-coin-prices endpoint. FinancesTab: MONITORED COINS section with live prices + ACTIVE indicator, active trade rows with colored left border by P&L tier.
RESULT: works — /all-coin-prices returns live data, 8/8 tests passing
BLOCKERS: Run SQL: ALTER TABLE active_trades ADD COLUMN IF NOT EXISTS current_price float, ADD COLUMN IF NOT EXISTS pnl_pct float, ADD COLUMN IF NOT EXISTS pnl_eur float;

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: fix-scout-save-final
WHAT: Three fixes: (1) supabase client initialized (createClient) and used for all reference_tracks inserts instead of raw fetch. (2) kworb loop uses supabase client, only sets spotify_id if non-null. (3) extractTracksFromText regex extracts JSON array even if surrounded by extra text, logs raw response for debug, returns 26 tracks per run. Verified: ✓ INSERTED logs + skip (exists) working correctly.
RESULT: works — 26 tracks extracted and inserted per scout run
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: scout-checkout-null-spotify-id
WHAT: Removed placeholder txt_* spotify_id now that SQL migration dropped NOT NULL constraint. Text-extracted tracks insert cleanly with spotify_id: null.
RESULT: works
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: fix-scout-checkout-not-null
WHAT: Root cause: spotify_id NOT NULL constraint blocks text-extracted track inserts. Fix: generate placeholder spotify_id ('txt_' + timestamp36 + random6) so insert succeeds. Removed all diagnostic code. Proper fix is SQL: ALTER TABLE reference_tracks ALTER COLUMN spotify_id DROP NOT NULL; — run when convenient, then remove placeholder logic.
RESULT: works — tracks now insert
BLOCKERS: SQL migration pending to properly allow null spotify_id

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: fix-scout-checkout-exist-check
WHAT: existCheck now uses title+artist ilike (both fields) instead of title alone. Prefer changed to return=representation so saveData contains full response. Error log shows status + full JSON body.
RESULT: works — verified via pm2 logs, no FAILED lines, track saved OK
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: fix-scout-checkout-save
WHAT: Removed 'approved: true' from scout mention insert (column doesn't exist). Added proper saveRes error logging — logs status + response body on failure, success message on 201.
RESULT: works
BLOCKERS: none

## [2026-04-24] BrainTab.svelte — DONE
TASK: brain-refs-auto-refresh
WHAT: Added refsInterval in onMount — polls reference_tracks every 2 min (created_at DESC) and updates referenceTrackEntries. Both intervals cleaned up on destroy.
RESULT: works
BLOCKERS: none

## [2026-04-23] BrainTab + DailyTab + ProjectsTab — DONE
TASK: ref-track-preview-audio
WHAT: ▶ buttons play 30s preview_url audio in-app instead of opening Spotify popup. BrainTab: playPreview() toggles Audio object, falls back to momentum_popup if no preview_url. DailyTab: inline-play-btn embeds data-preview, onInlineClick plays audio + toggles ■/▶, falls back to momentum_popup. ProjectsTab: playRefUrl() fetches preview_url from reference_tracks by spotify_id, plays audio or falls back to popup. ■/▶ toggle on all buttons.
RESULT: works
BLOCKERS: none

## [2026-04-23] +page.svelte — DONE
TASK: popup-window-dimensions
WHAT: Both window.open override and linkHandler now use originalOpen with name 'momentum_popup' + fixed 900x700 dimensions. Same named window is reused for every link so only one popup window stays open. POPUP_FEATURES constant defined once in onMount.
RESULT: works
BLOCKERS: none

## [2026-04-23] +page.svelte — DONE
TASK: popup-window-open-override
WHAT: Override window.open so JS-triggered popups also use iframe popup. Switched link interceptor from mousedown capture to click capture (true). ↗ and fallback link temporarily restore originalOpen so real new-tab still works. iframeBlocked state replaces popupBlocked.
RESULT: works
BLOCKERS: none

## [2026-04-23] +page.svelte — DONE
TASK: floating-link-popup
WHAT: Global click interceptor on all a[target="_blank"] links opens 85vw/85vh iframe popup instead of new tab. Header shows hostname + ↗ new-tab button + × close. onload detects cross-origin block and shows fallback message. ESC/overlay click closes. CSS matches dark palette.
RESULT: works — sites blocking iframes (Spotify, Instagram) show fallback message with ↗ button
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: scout-extract-mentions
WHAT: Added extractTracksFromText() helper (calls Haiku to parse track mentions as JSON array). /agent-scout endpoint now calls it after kworb tracks loop, saves all text-mentioned tracks to reference_tracks as source:'checkout' with ilike dedup.
RESULT: works
BLOCKERS: none

## [2026-04-23] BrainTab.svelte — DONE
TASK: brain-loadentries-onmount
WHAT: onMount made async + await loadEntries(); removed debug console.log lines. loadEntries already moved to onMount in prior commit. checkout_date column needs SQL migration in Supabase (timestamptz).
RESULT: works
BLOCKERS: Run SQL: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS checkout_date timestamptz;
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: scout-tracks-checkout
WHAT: runAgentScout now auto-saves all kworb tracks (allTracks = kworbSP + kworbYT, up to 15) to reference_tracks as source:'checkout' via setImmediate fire-and-forget. Deduplicates by title+artist before inserting. Maps source:'youtube_trending' → collection_name:'tiktok_trending', all others → 'daily_chart'. DailyTab inline + button confirmed already uses source:'checkout'. Watcher restarted OK.
RESULT: works
BLOCKERS: none

## [2026-04-23] ProjectsTab.svelte — DONE
TASK: fix-vocal-eq-header-click
WHAT: Vocal EQ section CSS fix. vocal-eq-section: added position:relative; z-index:1; margin-top:16px; padding-top:10px. vocal-eq-header: added position:relative; z-index:2; pointer-events:all; text-align:left; padding changed from 9px 14px to 6px 0. Structural position confirmed correct — vocal-eq-section is already outside versions-block, a direct flex child of song-body.
RESULT: z-index fix lifts header button above stacking contexts created by overflow:hidden on versions-block sibling
BLOCKERS: none

## [2026-04-23] DailyTab.svelte + +page.svelte — DONE
TASK: remove-checkout-banner
WHAT: Removed CHECK OUT TODAY banner from top of DailyTab (the {#if checkOutItems.length||pressItems.length} block). Removed $effect that dispatched mm-checkout-count event. Removed all 8 banner-only CSS classes (checkout-section, -header, -row, -cb, -art, -title-txt, -artist-btn, -spotify-btn, -cat-badge). In +page.svelte: removed checkoutCount state, mm-checkout-count event listener, checkout-alert-dot span in tab nav, and pulse-dot CSS + keyframes.
RESULT: works
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: agent-tracks-checkout
WHAT: Verified all agent reference_tracks inserts (agent-chart-analysis/daily_chart, agent-tiktok-trends/tiktok_trending, agent-scout/analyze-spotify-track) already use source:'checkout' + checkout_date. No code changes needed. DB: PATCH confirmed 0 rows with source='agent' in daily_chart or tiktok_trending — already clean. 3 rows in reference_current still have source='agent' (out of scope per task SQL).
RESULT: works — code was already correct from prior session
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + ProjectsTab.svelte + VocalEqChart.svelte — PARTIAL
TASK: vocal-eq-stems
WHAT: Save each stem (vocals/drums/bass/other) as a separate vocal_eq_curves row with stem_type + source_type columns. Both analyzeVocalEqUrl (reference) and /analyze-vocal-eq mix branch now insert 4 rows per analysis. GET /vocal-eq-curves limits raised to 20+40. ProjectsTab: added activeStem state, stem selector tabs UI, loadVocalEq filters by source_type+stem_type, analyzeMyVocal sets showVocalEq[sid]=true after load. VocalEqChart simplified to single refCurve prop + refLabel, stem selector removed (now in ProjectsTab).
RESULT: watcher restarted OK — code ready but blocked on SQL migration
BLOCKERS: vocal_eq_curves table missing stem_type and source_type columns — run SQL in Supabase dashboard: ALTER TABLE vocal_eq_curves ADD COLUMN IF NOT EXISTS stem_type text DEFAULT 'vocals', ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'mix';

## [2026-04-23] mozartContext.js + ProjectsTab.svelte — DONE
TASK: mozart-ref-context
WHAT: Mozart add_reference now routes to correct level. song_id param → songs.reference_links column. project_id param (or no song expanded) → project_meta.reference_links. System prompt tells Mozart which context is active and which ACTION format to use (project_id= vs song_id=).
RESULT: works, svelte-check 0 errors
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: housekeeping
WHAT: Removed 3 debug console.log lines from readWhatsAppMessages() (waSince, Invictus CoreData ts, Will catch flag). Ran /cleanup-brain-dupes (deleted 65 duplicates, 173 remaining). 8/8 tests passing.
RESULT: works
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: brain-file-storage
WHAT: saveBrainFile() hooked into agent-chart-analysis (both reference track + assessment inserts), morning-briefing (inbox insert), analyze-spotify-track (track data). Added POST /save-brain-file thin wrapper endpoint. Added POST /brain-file-upload (formidable, 50MB, saves to Dropbox/Brain/uploads + Obsidian Attachments). POST /now now copies to BRAIN_FILES_PATH/NOW.md. BrainTab: fileDragging/uploadedFile/fileUploading state, handleFileDrop(), ondrop routes non-text/non-image files to /brain-file-upload, status UI. saveApproved() calls /save-brain-file after each insert.
RESULT: watcher restarted OK, svelte-check 0 errors
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: weekly-system-review
WHAT: weeklySystemReview() added as module-level function (so /improve Telegram command can call it). Pulls brain stats (total/weak/locked), song analysis coverage, releases count, crypto trades this week via Promise.allSettled. Sends to Haiku for 3-5 concrete improvement suggestions. Saves result to brain_knowledge (category=observation, source_type=system_review). Tracks cost. Fires Sunday 8am alongside weeklyBrainReview() via setInterval. /improve Telegram command triggers on demand. Added to /help list.
RESULT: watcher restarted OK, no errors
BLOCKERS: none

## [2026-04-23] analyze_vocal_eq.py + momentum-watcher.cjs + ProjectsTab.svelte + VocalEqChart.svelte — DONE
TASK: vocal-eq-four-fixes
WHAT: FIX 1 — analyze_vocal_eq.py: Demucs now uses --name htdemucs (4 stems: vocals/drums/bass/other); returns { ok, stems: { vocals:{...}, drums:{...}, ... }, stem_count }. FIX 2 — watcher: analyzeVocalEqUrl() extracted as module-level standalone function; /analyze-vocal-eq saves stems dict; type=mix auto-queues song's reference_links via setImmediate for background analysis. FIX 3 — ProjectsTab: vocalEqCache Map for persistence across expand/collapse; loadVocalEq correctly reads d.curves (was d.mix_curves/d.ref_curves — bug); vocalEqStatus state ('idle'|'separating'|'done'|'error') with pulsing status line; auto-compare extracts vocals stem for comparison. FIX 4 — VocalEqChart: stem tabs (VOCALS/DRUMS/BASS/OTHER); getStemCurve() handles both new {vocals:{}} and old flat format; multiple ref curves (gold/green/blue); mix curve is light/white; legend uses REF 1/2/3 + MY MIX labels.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: vocal_eq_curves table must have curve column as jsonb (stores stem dict directly)

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: whatsapp-group-fix
WHAT: Three fixes: (1) readWhatsAppMessages() — confirmed COREDATA_EPOCH_OFFSET=978307200 correct; added debug logging (waSince, Invictus CoreData ts 798648620, Will catch bool). (2) /whatsapp-backfill — removed hard `@g.us` skip at line 6905; group chats now processed without AI analysis (inbox save + push to processed with is_group=true). (3) pollWhatsApp() — fixed ReferenceError: `history` was undefined, renamed to `conversation` to match the variable defined in that scope.
RESULT: Backfill confirmed — Invictus Records (25 msgs, is_group: true) appears in processed list alongside personal contacts. Debug log: waSince < 798648620 = true.
BLOCKERS: none

## [2026-04-23] analyze_vocal_eq.py + momentum-watcher.cjs + ProjectsTab.svelte + VocalEqChart.svelte — DONE
TASK: vocal-eq-analysis
WHAT: PART A — analyze_vocal_eq.py: Demucs vocal separation + 30-band ISO third-octave spectrum (8192 FFT, Hann, mean-normalized). PART B — watcher: getFreqDescription(), interpretVocalComparison(), POST /analyze-vocal-eq (type=reference via yt-dlp/Spotify preview, type=mix via latest MIXING_DIR file), GET /vocal-eq-curves?song_id=, POST /compare-vocal-eq; saves curves to vocal_eq_curves table. PART C — VocalEqChart.svelte: SVG 580×200 chart, log-frequency x-axis, ±20dB y-axis, gold reference line + blue mix line with fill areas, grid lines, legend, frequency labels. ProjectsTab: VOCAL EQ collapsible section per song with chart, Analyze My Vocal button, + Add Reference URL input, comparison match score + BOOST/CUT instructions grid, curve history list.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: Run CREATE TABLE vocal_eq_curves in Supabase (id uuid pk default, song_id text, curve_type text, source_url text, label text, curve jsonb, created_at timestamptz default now())

## [2026-04-23] momentum-watcher.cjs + FinancesTab.svelte — DONE
TASK: buy-sell-cycle-4h-binance-portfolio
WHAT: PART 1 — Portfolio uses Binance live balances as source of truth (fallback: user_settings); enriched with weighted average entry price from crypto_trades buy history. PART 2 — active_trades table loaded in buildCryptoSignal(); P&L computed per trade; EXIT ALERT sent via Telegram (3h cooldown) for take-profit ≥8%, stop-loss ≤-5%, or bearish signal. /buy [€] command logs buy to crypto_trades + upserts active_trades. /sell confirm closes active_trade. /hold snoozes exit alerts 3h. PART 3 — fetch4HCandles() fetches BTCEUR (fallback BTCUSDT) 4H candles; MA5/MA10 scoring (+/-1pt); strong candle body scoring (+/-1pt); trend_4h, ma5_4h, ma10_4h in signal response. PART 4 — FinancesTab: 5 distinct signal colors (strong-buy green #00c853, bullish green, neutral orange, bearish orange-red, strong-sell red); active trades block in UI with P&L per row, colored border by profit/loss.
RESULT: 0 svelte errors; watcher restarted OK; crypto-signal returns trend_4h=uptrend, MA5=€66692, active_trades=[]
BLOCKERS: Run CREATE TABLE active_trades SQL in Supabase (schema in task spec)

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: crypto-derivatives-signal
WHAT: fetchDerivativesData(coin) fetches long/short ratio, open interest + hist trend, taker buy/sell ratio, top trader positions, funding trend (3 periods). buildCryptoSignal() calls BTC+ETH derivatives in parallel; scores L/S ratio (±1-2pts), OI+price combo (±1pt), taker ratio (±1pt), smart money (±1pt). Portfolio-aware personalAdvice fetches holdings from Supabase and generates context-specific text. /crypto and morning briefing both show Derivatives block + personal advice. btc_derivatives, eth_derivatives, personal_advice in signal response.
RESULT: watcher restarted OK; /crypto-signal live — longs 40%, OI rising 2.1% 6h, taker 0.78 (sellers), smart money 45% long; signal BULLISH
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + ReleaseTab.svelte + ProjectsTab.svelte + mozartContext.js — DONE
TASK: releases-tab-full-rebuild
WHAT: buildReleaseSummary() added to watcher (CRITICAL fix — was called but undefined). ReleaseTab rebuilt with label/distributor/ISRC/UPC, publishing PRO, spotify_streams, playlist placements (name/followers/date/notes grid), split sheet (name/role/pct per row), revenue_eur, open folder button, regenerate SUMMARY.txt button, + Add from scratch form. RELEASE button in ProjectsTab updated to call POST /create-release-entry (creates folder + SUMMARY.txt + Supabase insert). mozartContext.js adds releases query with stream/revenue/invoice status per release.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: Run ALTER TABLE releases ADD COLUMN IF NOT EXISTS for new fields (label, distributor, isrc, upc, spotify_streams, peak_position, peak_date, playlist_placements, revenue_eur, split_sheet, publishing_pro, publishing_registered, folder_path, song_id, status)

## [2026-04-23] momentum-watcher.cjs + FinancesTab.svelte — DONE
TASK: crypto-strong-sell-binance-portfolio
WHAT: PART 1 — STRONG SELL signal (bearPoints >= 4); scoring split so bull/sell conditions independent; BEARISH binanceAction='sell'. PART 2 — /crypto shows P&L profit on sell signal; /sell and /selleth commands with pendingConfirmations; /portfolio command shows holdings + live Binance. PART 3 — fetchBinancePortfolio() using HMAC SHA256; /crypto-signal endpoint includes binance_portfolio. PART 4 — FinancesTab LIVE BINANCE section with total; onMount auto-refresh 5 min; red sell button on bearish signal.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: Add BINANCE_API_KEY + BINANCE_SECRET_KEY to .env for live balances. crypto_trades table must exist in Supabase.

## [2026-04-23] src/lib/DailyTab.svelte — DONE
TASK: delete-btn-hover-only
WHAT: .inbox-item .del-btn, .whatsapp-item .del-btn, .dl-notif .del-btn all start at opacity:0 and fade in (transition .15s) on parent row hover. Size from previous fix retained.
RESULT: 0 svelte errors
BLOCKERS: None

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: whatsapp-full-conversation-context
WHAT: readWhatsAppMessages() removes ZISFROMME=0 filter — all messages fetched. pollWhatsApp() loop builds full conversation (Remo + contact) for analysis but guards on incomingMsgs — skips if no incoming messages, passes last incoming as newMessage. analyzeArtistMessage() now receives full back-and-forth context.
RESULT: watcher restarted OK
BLOCKERS: None

## [2026-04-23] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: whatsapp-filter-own-messages-delete-btn
WHAT: FIX 1 — readWhatsAppMessages() SQL adds ZISFROMME=0 so own replies excluded at DB level. pollWhatsApp() per-contact loop also filters incomingMsgs and skips if empty; history built from incoming only. FIX 2 — .inbox-item .del-btn and .whatsapp-item .del-btn get 28×28px min-size with flex centering.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: None

## [2026-04-23] src/routes/+page.svelte — DONE
TASK: whatsapp-contacts-ux
WHAT: FIX 1 — contact search input filters by partner_name/name (case-insensitive). FIX 2 — sortedContacts $derived sorts monitored first, then alphabetical. FIX 3 — PERSONAL and GROUPS sections rendered separately with section labels.
RESULT: 0 svelte errors
BLOCKERS: None

## [2026-04-23] +page.svelte + momentum-watcher.cjs — DONE
TASK: whatsapp-group-chats-and-new-chat-detection
WHAT: FIX 1 — /whatsapp-contacts already returns groups; removed @g.us filter from Settings UI so groups appear with GROUP badge (blue). FIX 2 — pollWhatsApp() now checks for new ZWACHATSESSION entries since last poll and sends Telegram notification for unmonitored chats. /monitor and /unmonitor already call setWaContacts() via /whatsapp-add-contact — confirmed correct.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: None

## [2026-04-23] momentum-watcher.cjs + BrainTab.svelte + DailyTab.svelte — DONE
TASK: checkout-source-fixes
WHAT: FIX 1 — /agent-import-spotify query mode and single-track mode now save source='checkout' + checkout_date. FIX 2 — BrainTab ★ button shows "★ Mine" with gold CSS (font-weight 700, bg tint, border). FIX 3 — addTrackToBrain() in DailyTab also inserts to reference_tracks with source='checkout' + checkout_date alongside existing brain_knowledge save.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: Run SQL to fix existing Romantic Homicide track — see notes

## [2026-04-23] momentum-watcher.cjs + ProjectsTab.svelte + mozartContext.js — DONE
TASK: analyze-audio-part2-part3
WHAT: PART 2 — tikcharts.com added as primary TikTok chart source in fetchTikTokRealData() (tokboard demoted to fallback, kworb keeps as gap-fill). PART 3 — third analysis line in ProjectsTab version-analysis-row showing LRA/dyn/warm/groove/harm/vocal; formatVersion() in mozartContext.js updated with same 6 new fields.
RESULT: 0 svelte errors; watcher restarted OK
BLOCKERS: tikcharts.com structure may change — scraping extracts table cells

## [2026-04-23] analyze_audio.py + mozartContext.js + momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: expanded-essentia-vocal-cultural
WHAT: BUILD 1 — 12 new Essentia signals (onset_rate, rhythm_regularity, dynamic_complexity, loudness_range, speechiness, instrumentalness, vocal_pitch_mean, vocal_root_note, vibrato_presence, harmonic_complexity, warmth) + mozartContext formatTrack updated. BUILD 2 — /analyze-vocal-style endpoint + buildVocalProfile() + 🎤 button in ProjectsTab ref chips. BUILD 3 — fetchCulturalTiming() + GET /cultural-timing + morning briefing cultural block + mozartContext CULTURAL MOMENTUM section. pytrends installed.
RESULT: new fields confirmed in analyze_audio.py output; /cultural-timing endpoint responds; 0 svelte errors
BLOCKERS: Run SQL for new DB columns (watcher logs them on startup). vocal_pitch_mean/vibrato null on short previews (PredominantPitchMelodia needs higher confidence). Google Trends degrades gracefully when Google blocks scraping.

## [2026-04-23] src/lib/mozartContext.js — DONE
TASK: mozart-target-contacts
WHAT: buildMozartContext() fetches connections with personal=false and no via_ids, appends as TARGET CONTACTS section so Mozart flags networking opportunities
RESULT: works, 0 svelte errors; query has try/catch so it degrades gracefully if personal column missing
BLOCKERS: Needs personal column in DB first: ALTER TABLE connections ADD COLUMN IF NOT EXISTS personal boolean DEFAULT false;

## [2026-04-23] ConnectionsTab.svelte + momentum-watcher.cjs — DONE
TASK: personal-checkbox-persist
WHAT: Confirmed personal checkbox already calls updateField → Supabase. Added watcher startup warning for missing personal column. Column must be added manually in Supabase.
RESULT: code correct; watcher logs SQL to run; column not yet in DB
BLOCKERS: Run in Supabase SQL editor: ALTER TABLE connections ADD COLUMN IF NOT EXISTS personal boolean DEFAULT false;

## [2026-04-23] ConnectionsTab.svelte — DONE
TASK: target-contact-color
WHAT: Contacts with no via tags and personal=false shown in red with tooltip "Target — not yet connected"
RESULT: works, 0 svelte errors
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: reference-tracks-checkout
WHAT: Add checkout source to reference_tracks; chart/tiktok agents now save source='checkout' + checkout_date; BrainTab restructured into three always-visible sections: CHECKOUT / MY REFERENCES / LIBRARY with promote/delete actions
RESULT: 0 svelte errors, watcher healthy
BLOCKERS: Run SQL manually: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS checkout_date timestamptz;

## [2026-04-23] momentum-watcher.cjs + ConnectionsTab.svelte — DONE
TASK: enrich-contacts-fixes
WHAT: Auto-promote instagram_guess to instagram in /enrich-contact; add /enrich-all-contacts bulk endpoint; Telegram /enrich command; "Enrich All" button in ConnectionsTab
RESULT: works — tested 24 contacts, multiple enriched with TikTok/Spotify/Instagram
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + ProjectsTab.svelte + ListenPage.svelte — DONE
TASK: public-download-filenames
WHAT: Strip internal 8-digit code prefix from artist-facing downloads. Content-Disposition on /production/ and /mixing/ routes. Submission folder copies use public name. Share sessions store public_filename. Listen page shows public name and passes it to download attribute.
RESULT: works — svelte-check 0 errors, watcher restarted
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs + FinancesTab.svelte — DONE
TASK: crypto-signal-dashboard
WHAT: Crypto signal (Fear&Greed, funding, dominance, BTC/ETH prices) in Finances tab + Telegram /crypto command + morning briefing crypto block + hourly price alert
RESULT: works — live test: NEUTRAL 🟡, BTC €66,299, Fear 46, Dominance 58.1%
BLOCKERS: none

## [2026-04-22] mozartContext.js + ProjectsTab.svelte — DONE
TASK: four-improvements
WHAT: Version narrative, release checklist, brain milestone logging, Mozart sort fix
RESULT: works — svelte-check 0 errors, committed baed880
BLOCKERS: none

## [2026-04-23] DailyTab.svelte — DONE
TASK: show-whatsapp-messages-in-daily
WHAT: Replaced derived-state MESSAGES section with direct inline filter {#each inboxItems.filter(n => n.type === 'message' && n.metadata?.platform === 'whatsapp')}. Added inbox-item + whatsapp-item dual class. Updated CSS with DM Sans font-family on message fields. whatsappItems derived also updated with type guard.
RESULT: works — 0 svelte-check errors
BLOCKERS: none

## [2026-04-23] DailyTab.svelte + momentum-watcher.cjs — DONE
TASK: whatsapp-daily-messages
WHAT: Added dedicated MESSAGES section in Daily inbox for WhatsApp notifications. WhatsApp items filtered out of general inbox stream. Added group chat support in pollWhatsApp (saves to inbox without deep analysis). /whatsapp-contacts now returns is_group flag and includes 57 group chats. Added RAPHAEL MARTIN, NidjoMusic, Pilar Vega to WHATSAPP_CONTACTS. Fixed olderInbox to show WhatsApp badge.
RESULT: works — 57 groups detected, 39 monitored contacts, watcher online
BLOCKERS: none

## [2026-04-23] momentum-watcher.cjs — DONE
TASK: auto-obsidian-sync
WHAT: Extracted brainToObsidian() as standalone async function. GET /brain-to-obsidian now delegates to it. Added setImmediate(() => brainToObsidian()) trigger after /agent-scout, /analyze-spotify-track, /suggest-category, /analyze-chat, /seed-production-rules. Added hourly setInterval for automatic background sync.
RESULT: works — 235 entries + 7 index notes confirmed via curl
BLOCKERS: none

## [2026-04-21] BrainTab.svelte + momentum-watcher.cjs — DONE
TASK: refs-sort-mozart
WHAT: curatedRefs now includes source='mozart' tracks alongside source='user'. Both curatedRefs and libraryRefs sorted A-Z by artist. libraryRefs filter updated to also exclude mozart source. Watcher query-import saves source='user' so Mozart-added tracks land in My References panel immediately.
RESULT: works — svelte-check 0 errors, watcher restarted OK
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: gear-news-tech-section
WHAT: Added GEAR_SOURCES (BPB + CDM RSS) and fetchGearNewsItems(). TECH section injected into /agent-scout and /morning-briefing prompts. Gear items saved to brain_knowledge category=sound_design source_type=gear_news (deduped). Gearspace web scraper dropped (403 blocked) — replaced with reliable RSS feeds. Test confirmed ## Tech section appears in briefing output with free plugin summaries.
RESULT: works — TECH section confirmed in morning briefing
BLOCKERS: none

## [2026-04-21] mozartContext.js + ProjectsTab.svelte — DONE
TASK: mozart-refs-to-project
WHAT: executeAction add_reference now saves to projects.project_meta.reference_links (deduped by name) instead of songs.work_data. executeAction signature gains currentProject param. ProjectsTab passes selectedProject to executeAction and injects project_id into system prompt. ACTION COMMANDS updated to use project_id.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-21] mozartContext.js + ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: mozart-action-link-refs
WHAT: executeAction add_reference now links saved reference_track into song work_data.reference_links (deduped by spotify_id). ProjectsTab injects current song id into system prompt so Mozart uses correct song_id in ACTION commands. Watcher query-import response now includes spotify_id field.
RESULT: works — svelte-check 0 errors, watcher restarted OK
BLOCKERS: none

## [2026-04-21] mozartContext.js + ProjectsTab/DailyTab/BrainTab + momentum-watcher.cjs — DONE
TASK: mozart-actions
WHAT: Mozart can now signal actions via [ACTION: type | param=value] blocks. parseActions()/executeAction() exported from mozartContext.js. Actions: add_reference (Spotify search→save), save_to_brain, analyze_track, set_stage. /agent-import-spotify query mode added to watcher for text-based track search + Essentia analysis + reference_tracks save + song reference_links update.
RESULT: works — svelte-check 0 errors, watcher restarted OK
BLOCKERS: none

## [2026-04-21] src/lib/ProjectsTab.svelte — DONE
TASK: work-log-tracking
WHAT: Auto-log work sessions when songs are expanded/collapsed; display WORK LOG section per song with stage/duration/date. Timer starts on expand, stops+logs on collapse, tab hide, or component destroy. Min 5 min to log. Also inserts brain_knowledge entry per session.
RESULT: works — svelte-check 0 errors, work_logs table confirmed in Supabase
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + NotesTab.svelte — DONE
TASK: fix-now-duplicate-extract-btn
WHAT: (1) readNotesDir() skips NOW.md; parseNowNote() reads it separately; GET /notes prepends it → no more duplicate. (2) PATCH /notes resets 30s extract timer when filename===NOW.md. (3) Removed dedicated NOW block + all NOW-specific state/functions from NotesTab. NOW.md now renders via standard note loop: always expanded (_exp=true), toggle() no-ops for it, no delete/rename/reorder buttons, now-title gold style. (4) Removed extract button.
RESULT: /notes returns 8 notes, NOW.md first, no duplicate — confirmed
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: now-note-pinned-top
WHAT: ensureNowNote() creates Notes/NOW.md on startup if missing (position -1). readNotesDir() forces NOW.md to position -1 so it's always first. NOW_PATH updated to NOTES_PATH/NOW.md.
RESULT: /notes returns 8 notes with NOW.md first — confirmed
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: brain-health-briefing + curated-vs-library-refs
WHAT: (1) getBrainHealth() appended to morning briefing — entry count, new last 3 days, weak old entries, category overlaps, missing knowledge gaps. (2) weeklyBrainReview() Sunday 8am Haiku analysis → Telegram. (3) BrainTab REFERENCE TRACKS split into MY REFERENCES (user+promoted) and LIBRARY (collapsed, searchable) with promote + delete buttons.
RESULT: watcher restarted OK, svelte-check clean
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + NotesTab.svelte — DONE
TASK: now-brain-extract
WHAT: NOW.md note — GET/POST/POST /now/extract endpoints; extractNowEntries() via Claude Haiku; 30s debounced auto-extract after save; dedup by title+source_type; NOW.md preserved intact. NotesTab: NOW textarea at top with "→ Extract to Brain" button, nowContent/saveNow/extractNow state.
RESULT: works — /now GET + POST tested OK, watcher ping OK
BLOCKERS: none

## [2026-04-21] ConnectionsTab + FinancesTab + NotesTab + BrainTab — DONE
TASK: mozart-all-tabs
WHAT: Added Mozart chat panel to 4 tabs (ReleasesTab doesn't exist). Each gets: buildMozartContext import, aiMessages/aiInput/aiLoading state, sendAI(), formatMozartOutput(), Mozart block HTML at bottom, full CSS. NotesTab also got supabase import.
RESULT: works — HMR reloaded all 4 cleanly, no compile errors
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: apple-note-html-body
WHAT: Added textToAppleNotesHtml() — converts plain text to Apple Notes HTML before writing to temp file; lines→<div>, blank lines→<br>, bullet prefixes stripped. Applied to both createAppleNote and updateAppleNote.
RESULT: works — temp file confirmed correct HTML output
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: apple-note-formatting
WHAT: createAppleNote + updateAppleNote now write body to /tmp/apple_note_body.txt and read it via AppleScript heredoc — avoids \n→literal escaping that broke line breaks in Apple Notes
RESULT: works — watcher restarted cleanly
BLOCKERS: none

## [2026-04-21] vite.config.js + NotesTab.svelte — DONE
TASK: vite-proxy-notes
WHAT: Added /watcher proxy in vite.config.js pointing to localhost:4242; changed all 7 fetch calls in NotesTab from http://localhost:4242/ to /watcher/ so requests route through Vite dev server (fixes Firefox CORS)
RESULT: works — proxy routes through Vite, no cross-origin request from browser
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: notes-cors-verify
WHAT: Verified CORS already has GET in Access-Control-Allow-Methods; GET /notes already exists and returns valid JSON with position+content
RESULT: no changes needed — both already correct
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + NotesTab.svelte — DONE
TASK: notes-manual-ordering
WHAT: Added position field to note frontmatter; readNotesDir sorts by position asc then updated desc; POST /notes/reorder swaps adjacent notes and lazily assigns positions to all on first use; NotesTab has ▲▼ buttons per row
RESULT: works — reorder tested, frontmatter written correctly
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + NotesTab.svelte — DONE
TASK: apple-notes-obsidian-sync
WHAT: Switched Apple Notes sync target from Supabase to Obsidian/Notes/ folder. Added GET/POST/PATCH/DELETE /notes endpoints (file-based). NotesTab fully rewritten to use watcher as source of truth — no Supabase. Edits debounce-save to .md + push back to Apple Notes via JXA. 5-min auto-sync Apple → Obsidian.
RESULT: works — 7/7 Apple Notes synced to Obsidian/Notes/, GET /notes returns all with content
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + NotesTab.svelte — DONE
TASK: apple-notes-integration
WHAT: Added Apple Notes integration — GET/POST /apple-notes + POST /apple-notes-sync endpoints; getAppleNotes() via JXA + createAppleNote() via AppleScript; 5-min auto-sync to Supabase notes table; NotesTab shows sync button, last-sync time, 🍎 badge on Apple-sourced notes
RESULT: works — /apple-notes returns {ok:true,notes:[],count:0} (empty until Momentum folder created in Apple Notes); SQL migration needed for apple_note_id/source columns
BLOCKERS: Run SQL in Supabase dashboard (logged in startup warning)

## [2026-04-21] BrainTab.svelte — DONE
TASK: remove-capture-category-input
WHAT: Removed manual category input from screen capture section; category now auto-suggested via /suggest-category after capture and applied via Supabase update
RESULT: works
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + ConnectionsTab.svelte — DONE
TASK: ig-guess-from-tiktok
WHAT: enrichContact() now sets instagram_guess = tiktok handle when TikTok found but no IG scraped. ConnectionsTab uses instagram_guess to auto-fill IG field, sets _ig_guessed flag. Shows "auto-guessed from TikTok — verify manually" note in 9px italic below field.
RESULT: works
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + ConnectionsTab.svelte — DONE
TASK: contact-enrichment
WHAT: enrichContact() searches Spotify exact-match + IG username variations + TikTok handle. POST /enrich-contact endpoint. addConnection() triggers enrichment after save. Name input onblur triggers enrichment if no instagram/tiktok yet. "✓ Profiles auto-filled" indicator. TikTok + Spotify stats displayed below respective fields.
RESULT: works (endpoint live). Columns tiktok/spotify_id/tiktok_followers/spotify_followers/spotify_genres need SQL migration.
BLOCKERS: Run in Supabase SQL editor: ALTER TABLE connections ADD COLUMN IF NOT EXISTS tiktok text; ALTER TABLE connections ADD COLUMN IF NOT EXISTS spotify_id text; ALTER TABLE connections ADD COLUMN IF NOT EXISTS tiktok_followers integer; ALTER TABLE connections ADD COLUMN IF NOT EXISTS spotify_followers integer; ALTER TABLE connections ADD COLUMN IF NOT EXISTS spotify_genres text[];

## [2026-04-21] momentum-watcher.cjs + ConnectionsTab.svelte — DONE
TASK: ig-auto-fetch
WHAT: Added fetchInstagramProfile() helper + POST /fetch-instagram endpoint. ConnectionsTab instagram onchange triggers 500ms debounce fetch — auto-fills name if empty, saves ig_followers + ig_bio fields. ig-stats display below instagram input.
RESULT: works (endpoint live). ig_followers/ig_bio display pending SQL migration.
BLOCKERS: Run in Supabase SQL editor: ALTER TABLE connections ADD COLUMN IF NOT EXISTS ig_followers integer; ALTER TABLE connections ADD COLUMN IF NOT EXISTS ig_bio text;

## [2026-04-21] ConnectionsTab.svelte — DONE
TASK: connections-header-reorder
WHAT: Moved IG button and personal dot to after category badges (order: name → badges → IG → green dot). Widened name input from 120px to 160px with min 100px / max 200px.
RESULT: works
BLOCKERS: none

## [2026-04-21] ConnectionsTab.svelte — DONE
TASK: connections-mixers-personal-ig
WHAT: Added MIXERS to GROUPS array. Personal contact checkbox in expanded body (saves to conn.personal). Green dot in header when personal=true. IG button in header (stopPropagation, opens Instagram link).
RESULT: works
BLOCKERS: none

## [2026-04-21] DailyTab.svelte + ProjectsTab.svelte — DONE
TASK: mozart-window-larger
WHAT: .chat-out max-height 70vh (was 300px), min-height 300px. .mozart-block min-height 500px both files. ProjectsTab .right-col fixed height removed (was calc(100vh-60px)), sticky/overflow removed so Mozart expands naturally.
RESULT: works
BLOCKERS: none

## [2026-04-20] momentum-watcher.cjs → /brain-to-obsidian — DONE
TASK: obsidian-graph-backlinks
WHAT: Added CATEGORY_LINKS map (13 categories → related [[notes]]). Each exported .md gets ## Related section with category links + content-scanned links to other entry titles (longest-first matching, max 8). Created 5 index notes: Hit Benchmark.md, My Productions.md, Active Goals.md, Contact Directory.md, Market Intelligence.md. Export returns {written, index_notes}. Tested: 134 entries + 5 index notes written successfully.
RESULT: works
BLOCKERS: none

## [2026-04-20] momentum-watcher.cjs + BrainTab.svelte + mozartContext.js — DONE
TASK: obsidian-two-way-sync
WHAT: A) brain-to-obsidian writes richer .md with full frontmatter (category/confidence/type/source/created/tags), # title header, footer with source_url + added date, [[backlinks]] for reference tracks. B) syncObsidianFile parses category from frontmatter, extracts [[backlinks]] into metadata.related_notes, only updates brain if file mtime > created_at (manual edit detection). C) Daily 8am auto-sync via scheduleDaily8amObsidianSync() — fires brain-to-obsidian then obsidian-sync. D) BrainTab reference tracks get notes textarea (onblur save), mozartContext formatTrack includes notes field. SQL needed: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS notes text;
RESULT: works
BLOCKERS: Run SQL migration in Supabase: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS notes text;

## [2026-04-20] DailyTab.svelte + ProjectsTab.svelte — DONE
TASK: mozart-chat-autoscroll
WHAT: Added chatContainer ref + $effect auto-scroll (50ms timeout) to both DailyTab and ProjectsTab Mozart chat. Added scroll-behavior:smooth to .chat-out CSS in both files.
RESULT: works
BLOCKERS: none

## [2026-04-20] DailyTab.svelte + ProjectsTab.svelte — DONE
TASK: mozart-output-formatting
WHAT: Added formatMozartOutput() to DailyTab and ProjectsTab — regex-based renderer for ## headers, [GAP]/[OK]/tag spans, bullet/numbered items, Next Step label, spacers. Replaced parseMozartOutput() in ProjectsTab. Applied {@html formatMozartOutput()} for all assistant messages. Added :global(.moz-*) CSS classes in both files.
RESULT: works
BLOCKERS: none

## [2026-04-20] mozartContext.js + DailyTab.svelte + ProjectsTab.svelte — DONE
TASK: mozart-output-line-breaks
WHAT: Added 7 new formatting rules to Mozart system prompt (every topic on new line, no inline lists, blank line between ideas). parseAgentOutput() in DailyTab now splits plain paragraphs >100 chars into individual sentence divs. ProjectsTab added parseMozartOutput() with full header/bullet/sentence rendering + {#if assistant} block uses {@html}.
RESULT: works
BLOCKERS: none

## [2026-04-20] src/lib/mozartContext.js — DONE
TASK: mozart-full-system-context
WHAT: Added 6 new parallel queries to buildMozartContext(): project songs by stage, demos in market, unread non-whatsapp inbox, market_knowledge brain entries, watched_artists, active projects. Added 7 new context sections after ACTIVE GOALS: ACTIVE PROJECTS, SONGS IN PIPELINE, DEMOS IN MARKET, TODAY'S TASKS, PENDING INBOX, MARKET INTELLIGENCE, WATCHED ARTISTS.
RESULT: works
BLOCKERS: none

## [2026-04-20] src/lib/mozartContext.js — DONE
TASK: mozart-whatsapp-context
WHAT: Added contact_profile + whatsapp inbox queries to buildMozartContext(). Mozart now sees ARTIST/CONTACT PROFILES (last 10) and RECENT WHATSAPP ACTIVITY (last 5, showing real_intent + [HIGH URGENCY] flag).
RESULT: works
BLOCKERS: none

## [2026-04-20] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: whatsapp-psychological-analysis
WHAT: analyzeArtistMessage() upgraded — added urgency field, fixed JSON parsing, returns {analysis, usage}. pollWhatsApp analysis block replaced: upserts contact_profile in brain, saves inbox notification with full metadata (real_intent, psychological_state, boundary_alert, boundary_type, best_next_step, response_suggestion, urgency, business_assessment), sends structured Telegram with boundary alert first, tracks API cost. DailyTab inbox shows expanded WhatsApp view: urgency badge, boundary alert (red border), real_intent/state/business fields, next step in gold, reply suggestion with Copy button.
RESULT: works
BLOCKERS: none

## [2026-04-20] DailyTab.svelte + +page.svelte + momentum-watcher.cjs — DONE
TASK: cleanup-fixes-1-5
WHAT: FIX1 removed add-check-item boxes; FIX2 removed WhatsApp button from agent row; FIX3 removed "How am I doing" button; FIX4 merged pulse check into scoutArtists(); FIX5 added WhatsApp Monitor section in Settings panel with contact toggles (○/●); added /whatsapp-add-contact + /whatsapp-remove-contact watcher endpoints
RESULT: works
BLOCKERS: none

## [2026-04-20] DailyTab.svelte — DONE
TASK: agent-output-font-match
WHAT: Agent output CSS matched to Mozart chat style — all font-size 14px→13px; agent-next-move color #9e9690→#cec9c1; agent-header 11px→10px, letter-spacing .08→.1em, margin/padding tightened, border #252525→#1c1c1c, added font-weight:700; added font-family DM Sans to .chat-text
RESULT: works
BLOCKERS: none

## [2026-04-20] momentum-watcher.cjs — DONE
TASK: whatsapp-epoch-fix
WHAT: readWhatsAppMessages now stores lastWhatsAppCheck as Unix ms (standard JS), converts to CoreData seconds at query time via (since/1000) - 978307200; SQL uses partner_name + is_from_me aliases; pollWhatsApp display uses partner_name || jid.split('@')[0]; /whatsapp-contacts returns 254 contacts alphabetically; lastWhatsAppCheck update converts CoreData secs back to Unix ms correctly
RESULT: works — 254 contacts, monitored names (Raphael/Luca/Stefania/Ciro) matched correctly including groups
BLOCKERS: none

## [2026-04-20] momentum-watcher.cjs — DONE
TASK: telegram-whatsapp-analysis, whatsapp-desktop-monitor
WHAT: Telegram bot handles forwarded messages (auto-extract + save), photos (Claude vision OCR), /whatsapp command; WhatsApp Desktop auto-monitor reads ChatStorage.sqlite every 2min via better-sqlite3, AI analysis + brain/inbox save + Telegram push; GET /find-whatsapp-db + POST /setup-whatsapp endpoints; Gemini API support for cheaper analysis
RESULT: works — /setup-whatsapp returns 18 tables + 45059 messages
BLOCKERS: GEMINI_API_KEY empty in .env (fallback to Claude works fine)

## [2026-04-20] momentum-watcher.cjs + Start Momentum.command — DONE
TASK: obsidian-sync, n8n-setup, telegram-expanded
WHAT: Obsidian↔brain bi-directional sync (chokidar), /obsidian-sync + /brain-to-obsidian + /brain-dump endpoints; extended Telegram commands (/obsidian /demo /mix /ref /morning + YES/NO confirmation + feedback/download/milestone/error notifications); Start Momentum.command updated with n8n tab; CLAUDE.md updated
RESULT: works — pm2 restarted, Telegram polling confirmed, Obsidian vault warning shown (vault not yet created)
BLOCKERS: Obsidian vault must be created at /Users/remo/ObsidianVault/Momentum; n8n must be installed (npm install -g n8n)

## [2026-04-19] DailyTab.svelte — DONE
TASK: next step no background, download delete permanent, text dimmer
WHAT: agent-next-move padding 6px 12px, margin-top 8px, color #9e9690 (was #cec9c1/10px/14px); confirmed deleteInboxItem already does Supabase delete for all types; confirmed body text already #9e9690
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: agent output less bright, download notifs permanent delete, tag colors
WHAT: (1) agent-output/bullet/p #9e9690, next-move #cec9c1 no bg; (2) removed mm_sub_dismiss localStorage set/get; (3) [GAP]=#e05a4a [OK]=#4caf82 [CONFIRMED]=#c9a84c [TENSION]=#e8a838 [OUTDATED]=#9e9690 [NEW]=#4a9fd4, all font-weight:500
RESULT: works
BLOCKERS: none

## [2026-04-19] +page.svelte — DONE
TASK: persistent cost indicator in nav bar
WHAT: todayCost fetched on mount + every 5min from api_usage; cost-indicator div in nav shows $X.XX, amber >$0.50, red >$2.00, clicks open settings
RESULT: works
BLOCKERS: none

## [2026-04-19] ProjectsTab.svelte — DONE
TASK: projects: readable analysis stats, auto Mozart on song open
WHAT: (1) analysis row 11px/#9e9690, two lines: BPM·Key·LUFS / nrg·dnc·val; (2) expandSong() triggers auto Mozart message with song stats on open if analysis exists; (3) sendAI now uses buildMozartContext (HIT BENCHMARK + brain) combined with buildProjectContext
RESULT: works
BLOCKERS: none

## [2026-04-19] BrainTab.svelte — DONE
TASK: brain: rotating placeholder, confidence pills, hover preview
WHAT: (1) DUMP_HINTS array rotates every 4s via onMount setInterval; (2) confidence dots replaced with single pill cycling weak→medium→strong→locked, tooltip only for locked; (3) title attr on entry title span for native hover preview (120 chars)
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte + mozartContext.js — DONE
TASK: today focus — pin one task highlighted gold
WHAT: pinnedTask $derived; togglePin() clears all then toggles one; ◎/◉ pin button per task row; focus-block shown above task list when pinned; mozartContext receives tasks option and prepends TODAY'S FOCUS TASK to context
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: delete agent outputs + permanent download notification dismiss
WHAT: FIX1 — × delete button (position:absolute top-right) added to today-briefing-block; FIX2 — deleteInboxItem now clears song_code from share_sessions.downloads when deleting a download notification, preventing syncDownloadNotifications from re-creating it
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte + +page.svelte — DONE
TASK: check out section prominent at top of daily
WHAT: Check Out already at top — gold border/bg styling, bigger rows (36px/36x36art/13px/bigger spotify btn), hidden when 0 items; pulsing gold dot in DAILY tab via mm-checkout-count custom event; $effect broadcasts count whenever checkOutItems changes
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: agent buttons distinct colors + last run timestamp
WHAT: Brief/Scout/Match/Pulse get distinct left border colors; agentLastRun seeded from inbox_notifications on load and updated after each agent runs; timeAgo() helper displays "Xm/h/d ago" under each button
RESULT: works
BLOCKERS: none

## [2026-04-19] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: morning briefing auto-shows on daily load
WHAT: watcher already saves briefing to inbox_notifications (confirmed, no change needed); DailyTab: on load checks for today's briefing in inbox, auto-triggers generateBriefing() if none exists and hour >= 8, shows briefing expanded at top of agents section with speak button; filters briefing from inbox stream to avoid duplication
RESULT: works
BLOCKERS: none

## [2026-04-19] BrainTab.svelte — DONE
TASK: goal/rule text auto-routes to goal category with locked confidence
WHAT: fetchCatSuggestion() skips API if text matches goal/rule keywords and sets catSuggestion directly; saveApproved() auto-sets confidence='locked' when category is 'goal'
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte, ProjectsTab.svelte — DONE
TASK: Mozart suggests saving research to brain
WHAT: After every Mozart response >300 chars containing research keywords, appends "💡 Worth saving to Brain?" prompt
RESULT: works
BLOCKERS: BrainTab has no Mozart chat (only dump processing) — not applicable there

## [2026-04-19] DailyTab.svelte — DONE
TASK: fix: customs/helpers never loaded from daily_state
WHAT: audited all state.customs= and state.helpers= lines; confirmed no customs/helpers in load() daily_state or fallback blocks; removed leftover console.log debug lines from loadStaticData()
RESULT: customs/helpers exclusively from user_settings via loadStaticData(); load order guaranteed by async IIFE
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: fix load order: customs from user_settings only
WHAT: wrapped loadStaticData()+load() in async IIFE so loadStaticData is awaited before load() fires — race condition was causing state spread in load() to capture customs:[] before user_settings resolved, then seedFixed() running with empty customs
RESULT: customs/helpers now guaranteed to be set before daily_state spread overwrites state
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: customs/helpers fully static via loadStaticData() + dedicated save functions
WHAT: added loadStaticData() called before load() on mount; saveCustoms()/saveHelpers()/saveHelperTicks() are the only write paths; save() upsert no longer includes customs/helpers/helper_ticks; handlers call dedicated functions only
RESULT: works — customs/helpers load exclusively from user_settings, never from old daily_state rows
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: customs/helpers permanent in user_settings
WHAT: load() reads customs/helpers exclusively from user_settings (migrates from daily_state on first run); addCustom/delCustom/moveCustom/addHelper/delHelper/moveHelper each upsert to user_settings after save(); daily_state upsert no longer includes customs or helpers; fallback query simplified to private_items/check_items only
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: customs/helpers stored in user_settings not daily rows
WHAT: load() fetches customs/helpers from user_settings first; save() upserts to user_settings in parallel with daily_state; daily_state fallback only used for one-time migration; fixed optional chaining in else branch
RESULT: works — on first load, migrates existing customs/helpers to user_settings automatically
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: search inputs in routine items too
WHAT: added YouTube/Spotify/Gemini/DeepSeek search input+button to customs and checkItems sections, reusing helper-search-inp/go CSS and helperSearchInputs state
RESULT: works
BLOCKERS: none

## [2026-04-19] BrainTab.svelte — DONE
TASK: spotify link opens + copies simultaneously
WHAT: track-dl-btn now opens Spotify in new tab AND copies URL; label changed ↓→▶; title updated
RESULT: works
BLOCKERS: none

## [2026-04-19] DailyTab.svelte — DONE
TASK: fix helper search CSS, fix helper order persistence
WHAT: placeholder color corrected to #3a3a3a; fallback save condition now always fires when a previous row was loaded (fallback || ...) to prevent stale helpers reappearing
RESULT: works
BLOCKERS: none

## [2026-04-19] BrainTab.svelte + mozartContext.js + momentum-watcher.cjs — PARTIAL
TASK: reference track source weighting: user vs agent
WHAT: added source/promoted fields to reference_tracks rows; saveSpotifyPreview sets source='user'; chart analysis sets source='agent'; brain entries show ●/◑/○ indicators + [+] promote button; mozartContext splits into MY REFERENCE TRACKS (personal) vs MARKET CONTEXT (charts)
RESULT: code done, watcher restarted; SQL migration pending (columns not yet in DB)
BLOCKERS: need to run SQL in Supabase dashboard — ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS source text DEFAULT 'agent', ADD COLUMN IF NOT EXISTS promoted boolean DEFAULT false; UPDATE reference_tracks SET source='agent' WHERE collection_name='daily_chart';

## [2026-04-19] BrainTab.svelte — DONE
TASK: remove sync all refs button
WHAT: removed brain-sync-btn button, syncAllRefs() function, and brain-sync-btn CSS class
RESULT: works
BLOCKERS: none

## [2026-04-19] BrainTab.svelte + momentum-watcher.cjs — DONE
TASK: reference tracks visible in brain entries
WHAT: (1) Reference tracks now show in BRAIN ENTRIES section grouped by collection_name with dividers; (2) saveSpotifyPreview + saveTrackImport now dedup-check before brain_knowledge insert; (3) agent-chart-analysis saves individual brain_knowledge entry per track
RESULT: works — watcher restarted OK
BLOCKERS: none

## [2026-04-19] analyze_audio.py + momentum-watcher.cjs — DONE
TASK: fix loudness_lufs and rms returning null
WHAT: consolidated RMS into single shared call for loudness_lufs/rms/energy; watcher now extracts rms+loudness_lufs from Essentia output and includes both in /analyze-spotify-track response
RESULT: works — LUFS: -13.5 RMS: 0.1503
BLOCKERS: none

## [2026-04-18] ProjectsTab + BrainTab + DailyTab — DONE
TASK: sendToArtist fix + full undo system across all tabs
WHAT: sendToArtist: correct isLatest/nextExists logic — only auto-creates next version when latest has no next; if sending old version switches active to latest. pushUndo refactored to 4-arg signature. undoFlash added. pushUndo before addFeedback/toggleFeedback/deleteFeedback/sendToArtist. BrainTab: undoStack + pushBrainUndo/undoBrain; deleteEntry saves snapshot; saveApproved saves inserted id for undo. DailyTab: undoStack + pushDailyUndo/undoDaily; delTask and addTask push before mutating. undo-tab-btn in all three tab headers.
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-18] src/lib/DailyTab.svelte — DONE
TASK: agent output font + helper search new tab
WHAT: FIX 1 — rewrote parseAgentOutput to use agent-* CSS classes (agent-header, agent-bullet, agent-gap, agent-ok, agent-next-move, agent-p); updated .agent-output to DM Sans 14px 300 weight; added agent-label-confirmed/tension/outdated/new inline tag spans; replaced ao-* classes with agent-* throughout. FIX 2 — helper search already using window.open(_blank), confirmed correct
RESULT: works — 0 svelte errors
BLOCKERS: none

## [2026-04-18] src/lib/ListenPage.svelte + src/routes/+page.svelte — DONE
TASK: listen page with pitch shift controls
WHAT: Created ListenPage.svelte — public listen page served at momentummusic.vercel.app?s=XXXX. Loads share_sessions from Supabase, shows patch_name, audio player with <source> preferring MP3 then WAV, pitch shift [−][0][+] buttons (range −3 to +3 semitones) using Web Audio playbackRate, double-click center to reset, stars/void background, feedback textarea+submit, download links. +page.svelte: detects ?s= param on mount and renders ListenPage instead of admin app.
RESULT: works — 0 svelte errors
BLOCKERS: SQL needed: ALTER TABLE share_sessions ADD COLUMN IF NOT EXISTS mp3_path text

## [2026-04-18] momentum-watcher.cjs + ProjectsTab.svelte — DONE
TASK: MP3 transcoding for share links
WHAT: Added transcodeToMp3() (ffmpeg 320k); /share-link now fire-and-forgets WAV→MP3 transcode after Dropbox link generation, returns mp3Path+mp3ShareLink; audio serving route prefers .mp3 over .wav when Accept: audio/mpeg header present; ProjectsTab sendToArtist and production listen link now store mp3ShareUrl in songs[] and mp3_path in share_sessions; listen page (separate repo) still needs <source> update
RESULT: works — watcher online, 0 svelte errors
BLOCKERS: SQL needed: ALTER TABLE share_sessions ADD COLUMN IF NOT EXISTS mp3_path text; listen page (momentummusic.vercel.app) is separate repo — audio element <source> update needed there

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: chart-analysis search fix
WHAT: /agent-chart-analysis: fixed Spotify search — limit capped at 10 for Client Credentials (limit=20 returns 400); market=DE also invalid; popularity undefined in search results so sort removed; working query is 'year:2026 genre:pop' limit=10; tested ok:true with 3 analyzed tracks + Claude assessment
RESULT: works — endpoint returns ok:true, 3 tracks with full Essentia analysis
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: chart-analysis cleanup
WHAT: /agent-chart-analysis: removed all editorial playlist attempts (Viral 50, Today's Top Hits, Global Top 50 all 403 without Extended Quota); year:2026 Spotify search is now sole method with market=DE param; chart_source updated to 'spotify_top_2026'; comments cleaned up
RESULT: works — watcher restarted ok
BLOCKERS: none

## [2026-04-18] BrainTab.svelte + momentum-watcher.cjs — DONE
TASK: screenshot-delete + spectral-fields-passthrough
WHAT: (1) /capture-screen now uses Prefer:return=representation, returns saved_entry_id; BrainTab stores captureEntryId, shows "Saved to Brain · category · delete" note below result; delete link calls deleteEntry() and clears result panel; (2) /analyze-spotify-track: all new Essentia fields (spectral_centroid/contrast/flux, mfcc_mean, bpm_confidence, brightness, bass_energy) collected into esExtended{} and included in response; (3) /analyze-audio: same fields added to response (camelot, loudness_lufs, brightness, bass_energy, bpm_confidence, spectral_centroid/contrast/flux, mfcc_mean)
RESULT: works — watcher restarted ok
BLOCKERS: none

## [2026-04-18] DailyTab.svelte + BrainTab.svelte + momentum-watcher.cjs + analyze_audio.py — DONE
TASK: helper-search + full-essentia + capture-mixing + camelot-everywhere
WHAT: (1) Helper search: replaced function-based approach with inline {@const isYoutube/isSpotify/isGemini/isDeepseek} — now works for any URL containing those domains; (2) analyze_audio.py: full rewrite with frame-based spectral features (centroid, flux, rolloff, contrast), MFCCs (13 coefficients), all wrapped in try/except so any failure returns null; (3) /capture-screen: detects DAW context from keywords (mix/daw/session) + analysis text, fires second Haiku call for 3 mixing suggestions, returns mixing_suggestions array; (4) BrainTab: MIXING NOTES section shown below capture result; (5) reference_tracks upsert now includes spectral_centroid, spectral_contrast, spectral_flux, mfcc_mean; (6) startup warns if new columns missing
RESULT: works — watcher restarted ok
BLOCKERS: SQL needed in Supabase (see .claude-status.json next field)

## [2026-04-18] momentum-watcher.cjs + analyze_audio.py + mozartContext.js + BrainTab.svelte — DONE
TASK: market-intelligence + camelot + scout-real-data + chart-3-tracks + no-bold
WHAT: (1) runAgentScout: fetches Pitchfork/FACT/Hypebot RSS, Spotify new-releases DE, watched artists new releases this week — injects all as real data, prompt says "do not invent anything outside this data"; (2) Scout saves findings to brain_knowledge category:market_knowledge; (3) Spotify search limit 20, filter by title+artist, take top 3 for chart analysis; (4) camelot notation added to analyze_audio.py (CAMELOT dict key+scale → Camelot code); (5) camelot passed through analyze-spotify-track, analyze-audio-features responses and reference_tracks upsert; (6) formatTrack/formatVersion in mozartContext.js show key (camelot) inline; (7) BrainTab spotifyPreview shows camelot after key; (8) FORMATTING: no-bold rule added to all 6 agent prompts
RESULT: works — watcher restarted successfully
BLOCKERS: SQL needed: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS camelot text;

## [2026-04-18] BrainTab.svelte — DONE
TASK: fix-6 — Check Out album art metadata
WHAT: saveSpotifyPreview() now includes art_url, artist, spotify_id in metadata field when inserting to brain_knowledge; DailyTab Check Out rows can now display album art and artist link
RESULT: works
BLOCKERS: none

## [2026-04-18] BrainTab.svelte + DailyTab.svelte + momentum-watcher.cjs — DONE
TASK: 32 — WhatsApp bulk import + entry connections
WHAT: (1) /analyze-chat replaced: multi-entry extraction via Claude Haiku, returns JSON array [{title, content, suggestedCategory, entry_type, confidence}], cost tracked, no auto-save; (2) BrainTab processDump(): WhatsApp export detection (\d/\d/\d pattern + >5 lines), calls /analyze-chat with existingCategories, shows pendingApproval panel; (3) approval panel enhanced: editable category input per item, confidence badge, remove single item button; (4) saveApproved: now persists confidence field; (5) DailyTab extractWhatsapp: stores items to localStorage + dispatches mm-switch-tab → BrainTab picks up on load; (6) Entry connections: "Related:" chips in expanded view — JS-only matching on same category + title word overlap (>4 chars), max 3, click to expand that entry
RESULT: compiled clean, watcher ping ok
BLOCKERS: none

## [2026-04-18] BrainTab.svelte + DailyTab.svelte + momentum-watcher.cjs + page.svelte — DONE
TASK: 30 + 31 — Brain confidence/review/search + TikTok/Instagram/YouTube analysis
WHAT:
  TASK 30A: confidence indicator on each brain entry (4 dots: low/medium/strong/locked). Promotions to strong/locked show confirmation tooltip. Demotions instant. Saves to confidence column.
  TASK 30B: review_date date picker in expanded entry view. Saves inline. DailyTab shows "N brain entries ready for review" banner that dispatches mm-switch-tab event → page.svelte switches to brain tab.
  TASK 30C: search input at top of brain entries panel — real-time JS filter on title+content. Clear button when text present.
  TASK 31: /analyze-youtube-track endpoint — yt-dlp + Essentia, detects platform from URL (tiktok/instagram/youtube). BrainTab processDump() detects TikTok/Instagram/YouTube URLs first, calls /analyze-youtube-track, shows analysis card.
RESULT: all compiled cleanly, watcher ping ok
BLOCKERS: brain_knowledge table needs confidence (text) and review_date (date) columns — run SQL: ALTER TABLE brain_knowledge ADD COLUMN IF NOT EXISTS confidence text; ADD COLUMN IF NOT EXISTS review_date date;

## [2026-04-18] src/lib/mozartContext.js — DONE
TASK: Mozart formatting rules + full signal set in all context blocks
WHAT: (1) System prompt replaced with explicit FORMATTING RULES: ## headers, bullet points, [GAP]/[OK] prefixes, no bold, ## Next Step ending, max 3-5 bullets per section; (2) formatTrack now emits all 9 signals: bpm, key/scale, nrg, dnc, val, LUFS, brt, bas, aco, duration, genres; (3) HIT BENCHMARK includes brt/bas/aco averages; (4) CURRENT SONG versions use same full-signal formatVersion function; (5) avg() helper skips null values
RESULT: all context blocks now carry full signal data for gap analysis
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs + analyze_audio.py — DONE
TASK: three quick fixes — tasks checkbox counting, LUFS calibration, chart search primary
WHAT: (1) buildStatusResponse: reverted to pure - [ ] / - [x] checkbox counting (no header fallback); (2) analyze_audio.py: LUFS offset -23→-6, clamped max(-20, min(-4, val)); (3) chart analysis: search is now primary method (no Viral 50 attempt), added market=DE + popularity sort + chart_source:'spotify_search' in response
RESULT: ok=true, chart_source=spotify_search, loudness_lufs -18 to -20 (hitting floor clamp)
BLOCKERS: none — Viral 50 requires Extended Quota Mode in Spotify developer dashboard

## [2026-04-18] momentum-watcher.cjs + analyze_audio.py — DONE
TASK: chart-analysis fixes — loudness + tasks count + Spotify fallback
WHAT: (1) analyze_audio.py: replaced LoudnessEBUR128 (returns -70 on 30s clips) with ReplayGain - 23.0 → realistic LUFS values (-35 to -38); (2) buildStatusResponse: tasks_remaining now counts ## TASK headers when no checkboxes found (was always 0); (3) chart analysis: documented that 37i9dQZE playlists need Extended Quota Mode, kept search fallback which works
RESULT: loudness_lufs now -35 to -38, tasks_remaining=28, pipeline ok=true
BLOCKERS: Spotify editorial playlists (37i9dQZEVXb*) require Extended Quota Mode — enable in developer.spotify.com dashboard to use Viral 50 directly

## [2026-04-18] momentum-watcher.cjs + analyze_audio.py + mozartContext.js + CLAUDE.md — DONE
TASK: agent-chart-analysis endpoint + Spotify search fix
WHAT: (1) Created /agent-chart-analysis — searches Spotify year:YYYY, downloads 30s clips via yt-dlp, runs Essentia via analyze_audio.py, upserts to reference_tracks collection_name=daily_chart, generates Claude Haiku gap assessment; (2) Fixed Spotify 403 — browse/playlist endpoints need extended quota; search works without market param; (3) Updated CLAUDE.md with endpoint docs and Spotify browse limitation; (4) analyze_audio.py standalone script handles all 14 signals
RESULT: works — 3 tracks analyzed+stored, Claude assessment generated with gap flags
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs + BrainTab.svelte + DailyTab.svelte + ProjectsTab.svelte + mozartContext.js — DONE
TASK: full Essentia signal set + Mozart context upgrade
WHAT: (1) All 3 Essentia endpoints now extract: bpm, key, scale, key_strength, energy, danceability, valence, acousticness, instrumentalness, loudness, duration_seconds; (2) Created src/lib/mozartContext.js — shared buildMozartContext(supabase) used by all 3 tabs; (3) BrainTab/DailyTab/ProjectsTab Claude calls now get reference_tracks with full signal set; (4) BrainTab track rows show key+scale+valence; (5) Startup warning logs SQL needed for missing columns
RESULT: works — /analyze-spotify-track returns all 11 signals; loudness null on 30s clips (expected); column SQL shown in next step
BLOCKERS: ALTER TABLE reference_tracks needs to be run manually in Supabase (SQL shown in watcher startup log)

## [2026-04-18] momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: danceability normalization, genres fallback, reference track display
WHAT: (1) danceability normalized to 0-1 (÷3); (2) genres fallback via related-artists when empty, adds genres_source field; (3) reference track rows show nrg/dnc/LUFS + genre pills; (4) brain_knowledge reference entries show structured Artist·BPM·Key·Genres with Spotify link; (5) saveSpotifyPreview saves energy/danceability/loudness to reference_tracks
RESULT: works — watcher online, /ping ok
BLOCKERS: reference_tracks table needs danceability+loudness columns for new fields to persist

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: fix Python path for Essentia
WHAT: replaced all 5 ESSENTIA_PYTHON pyenv paths with /opt/homebrew/bin/python3.11; added exec import; added startup check that logs '✓ Essentia ready' or warns if missing
RESULT: works — startup log shows '✓ Essentia ready'
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: youtube fallback for analyze-spotify-track
WHAT: when preview_url is null, use yt-dlp to grab first 30s from YouTube ("artist title official") for Essentia analysis; response includes preview_source: 'spotify'|'youtube'
RESULT: works — watcher online, /ping ok
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: dotenv loading
WHAT: added require('dotenv').config() at top of watcher; installed dotenv package
RESULT: works — /status now shows anthropic: true
BLOCKERS: none

## [2026-04-18] +page.svelte + momentum-watcher.cjs — DONE
TASK: watcher control section in settings panel
WHAT: added WATCHER section to settings panel — green/red dot + status + Stop button; added POST /watcher-stop endpoint to watcher (runs pm2 stop); stopped state shows terminal hint instead of Start button
RESULT: works — watcher restarts and /ping confirmed live
BLOCKERS: none

## [2026-04-18] pm2 setup + Start Momentum.command + watcher /ping — DONE
TASK: pm2 watcher daemon setup
WHAT: installed pm2 globally, started momentum-watcher as pm2 daemon, updated Start Momentum.command (removed watcher tab, now 2 tabs: dev + claude), updated /ping to include time field, added pm2 restart rule to CLAUDE.md
RESULT: works — pm2 running, /ping returns {ok:true,time:...}, desktop script updated
BLOCKERS: pm2 startup launchd command requires manual sudo (run in terminal to enable reboot persistence)

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: agent endpoints fall back to process.env.ANTHROPIC_API_KEY
WHAT: /morning-briefing, /agent-scout, /agent-demo-match, /agent-pulse-check, /run-morning-agents now use `body.apiKey || process.env.ANTHROPIC_API_KEY || ''`; error message changed to 'ANTHROPIC_API_KEY not set'
RESULT: works — browser calls still use body.apiKey; terminal/cron calls with no body use .env key
BLOCKERS: none

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: Merge /status and /system-status into single GET /status endpoint
WHAT: Extracted buildStatusResponse() helper; merged both handlers into one (req.url === '/status' || '/system-status'); returns all .claude-status.json fields + tasks/changes/brain/api_keys/endpoints/last_watcher_error; removed ~80 lines of duplicated logic
RESULT: works — /status and /system-status both return full merged payload
BLOCKERS: none

## [2026-04-18] CLAUDE.md — DONE
TASK: CLAUDE.md housekeeping — reflect current system state
WHAT: Updated tables list (removed brain/taste_profiles, added watcher_logs/user_settings); added 3 missing watcher endpoints; expanded brain_knowledge categories; removed stale brain table section; added Known Issues, System Health, Session Start Checklist sections; added permanent rules to What NOT to do
RESULT: CLAUDE.md now matches actual system state
BLOCKERS: none

## [2026-04-18] ProjectsTab.svelte — DONE
TASK: sendToArtist auto-next-version + V01 numbering
WHAT: (1) generateVersionName now starts at V01 not V00 for production/vocal_rec/fallback types; (2) sendToArtist auto-creates next version + sets it active after send completes
RESULT: works — first version is now v01, sending auto-advances to next empty version
BLOCKERS: none

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

## [2026-04-18] momentum-watcher.cjs — DONE
TASK: /status live data fix
WHAT: Restarted watcher so buildStatusResponse() loads (was running stale process from before code landed); all live fields now present
RESULT: works — brain_categories, brain_entry_count, tasks_remaining, recent_changes, api_keys_present, endpoints_registered all populated
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: brain-to-obsidian backlinks + index notes
WHAT: Expanded CATEGORY_LINKS (19 categories), 3-word content scanning, 7 index notes (Hit Benchmark with ref tracks, My Productions, Active Goals, Contact Directory, Market Intelligence, NOW, Daft Punk Model)
RESULT: works — 171 entries written, 7 index notes, all with Related sections
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs + DailyTab.svelte — DONE
TASK: scout music press sources + Check Out PRESS subsection
WHAT: Added MUSIC_SOURCES (5 feeds: Pitchfork Best New, FADER, Stereogum, Lyrical Lemonade, A&R Factory). fetchMusicPressItems() fetches 2 articles per source with 300-char body. Press block added to Claude prompt. Top 1 per source saved to inbox as type='press'. DailyTab Check Out shows PRESS subsection with top 3 today's articles as clickable links.
RESULT: works — Stereogum, FADER, A&R Factory confirmed parsing; Pitchfork Best New URL adjusted (may still 404 silently); items filtered by url+title length
BLOCKERS: none

## [2026-04-21] momentum-watcher.cjs — DONE
TASK: brain-to-obsidian auto git push
WHAT: pushVaultToGit() fires after /brain-to-obsidian completes — git add -A, commit "brain export", push origin main. Fire-and-forget (no await).
RESULT: works — "✓ vault pushed to GitHub" confirmed in pm2 logs
BLOCKERS: none

## [2026-04-21] src/lib/DailyTab.svelte — DONE
TASK: inline ▶ + buttons after song mentions in agent output
WHAT: addTrackButtons() scans bullet/paragraph lines for "Artist — Title" and "Artist - Title" patterns after HTML-escaping. Appends inline ▶ (green) and + (gold) buttons using data attributes. Delegated click handler in onMount opens Spotify or calls addTrackToBrain(). Tracks extracted from <!--TRACKS:--> comment inside parseAgentOutput(). CSS uses :global() for {@html} context. Headers and [GAP]/[OK] lines excluded from scanning.
RESULT: works — 0 svelte-check errors
BLOCKERS: none

## [2026-04-21] src/lib/DailyTab.svelte — DONE
TASK: bigger inline buttons, remove duplicate tracks list
WHAT: inline-play-btn/inline-brain-btn: font-size 8→9px, padding 0/4→2/6px, margin 4/2→5/3px, line-height 1.4→1.6. Removed agent-tracks div from todayBriefing block and inbox briefing items (both occurrences). Inline buttons in text are now the only track interaction.
RESULT: works — 0 svelte-check errors
BLOCKERS: none

## [2026-04-24] momentum-watcher.cjs — DONE
TASK: vocal-eq-fix-rls-reads
WHAT: RLS was blocking anon reads of vocal_eq_curves. Switched /vocal-eq-curves GET endpoint to supabaseAdmin for reads. Fixed GET filter from 'type' (non-existent column) to 'source_type'. Fixed ref deduplication check same way. Added version_name to mix insert (column confirmed to exist).
RESULT: works — 4 stems save and are readable via /vocal-eq-curves
BLOCKERS: none

## [2026-04-24] ProjectsTab.svelte + momentum-watcher.cjs — DONE
TASK: vocal-eq-chart-display-fix
WHAT: loadVocalEq: removed silent catch, added console.log, cleaned up source_type/stem_type matching. Watcher GET: simplified to single supabaseAdmin query by song_id. Template: added explicit mixCurve/refCurve consts with typeof guard, cleaned all filters to use source_type directly.
RESULT: works — GET returns 12 curves with 30 freq keys each, chart receives plain objects
BLOCKERS: none

## [2026-04-24] [ProjectsTab.svelte, VocalEqChart.svelte, BrainTab.svelte, momentum-watcher.cjs] — DONE
TASK: THREE FIXES (mozart no analysis, EQ chart, category chips)
WHAT: Mozart suppresses raw numbers; EQ chart persists on collapse, ref=gold, mix=bright white; category chips in approval panel
RESULT: works — 8/8 tests passing, 8 brain dupes cleaned
BLOCKERS: none

## [2026-04-24] [momentum-watcher.cjs] — DONE
TASK: replace blocked press feeds + fix obsidian dupe storm
WHAT: Replaced FADER/Stereogum/Lyrical Lemonade/HotNewHipHop/OnestoWatch/PigeonsPlanes with NME, Consequence, The Guardian, Earmilk, Uproxx; chokidar ignoreInitial:true stops 'add' flood on restart
RESULT: works — 8/8 tests, 6/8 feeds confirmed live, no dupe storm on restart
BLOCKERS: none

## [2026-04-24] [DailyTab.svelte, DemoTab.svelte, momentum-watcher.cjs] — DONE
TASK: submission brief intelligence + remove Match Demos from Daily
WHAT: New Submission modal has brief textarea + Find Matches button; /analyze-submission-brief extracts requirements, scores ref tracks + demos by BPM/energy/key, Mozart gives 2-3 sentence take; brief.txt saved to Dropbox folder on send; Match Demos button removed from DailyTab
RESULT: works — 8/8 tests passing
BLOCKERS: none

## [2026-04-24] [BrainTab.svelte, DailyTab.svelte] — DONE
TASK: FIX 1 — Spotify ref types wired correctly
WHAT: reference_tracks now saves collection_name per type; aktuelle refs create inbox_notifications with 7-day expiry; DailyTab shows AKTUELLE REFS section with gold border and days-remaining; expired refs auto-cleaned on loadInbox; FIX 2/3/4 confirmed already in place
RESULT: works — 8/8 tests passing
BLOCKERS: none

## [2026-04-25] [momentum-watcher.cjs, ProjectsTab.svelte, analyze_audio.py] — DONE
TASK: FIVE MAJOR BUILDS — success pattern, feedback loops, trend velocity, emotional arc, credits
WHAT: 6 builds implemented — see commit a47560d for full details
RESULT: works — 8/8 tests, /success-pattern and /trend-velocity endpoints verified
BLOCKERS: 2 SQL tables need creating in Supabase dashboard before feedback/chart endpoints activate

## [2026-04-25] momentum-watcher.cjs + ProjectsTab.svelte + BrainTab.svelte — STATUS: DONE
TASK: fix split undefined + svelte const placement errors
WHAT: null-guarded url.split('/track/') chain in /analyze-spotify-track with optional chaining + early 400 return; moved {#const ao}/{#const latestA} out of <div> into {#if showVocalEq} block; moved {#const arc}/{#const maxE} before <div class="az-body">; moved {#const chipPool} before <div class="brain-approval-item">
RESULT: works — clean vite build, 8/8 tests passing
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + FinancesTab.svelte — STATUS: DONE
TASK: polymarket prediction signals in crypto assessment
WHAT: getPolymarketSignals() — tries Polymarket CLOB (3s timeout), falls back to Manifold Markets; adds bull/bear scoring (+1 if 2+ markets >65%, +1 bear if 2+ <35%); polymarkets array returned from buildCryptoSignal; GET /polymarket-signals endpoint; Telegram morning briefing sends 🎯 POLYMARKET block; FinancesTab collapsible POLYMARKET section with green/yellow/red per market
RESULT: works — Manifold returning 8 live crypto markets (Polymarket geo-blocked from CH)
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + FinancesTab.svelte — STATUS: DONE
TASK: coingecko trending as crowd sentiment signal
WHAT: getCoinGeckoTrending() fetches top 7 trending coins, flags monitored ones (BTC/ETH/DOGE/XRP/FLOKI); getCoinGeckoGlobal() fetches BTC dominance + market cap 24h change; both added to buildCryptoSignal() Promise.all; scoring: +1 bull if monitored coin trending, +1 bull if market +3%, +1 bear if market -3%, dominance note; result includes cg_trending/cg_global; GET /coingecko-trending endpoint; morning briefing sends 🔍 CRYPTO TRENDING Telegram block; FinancesTab collapsible TRENDING NOW section with global stats row + ranked list (⚡ for monitored coins)
RESULT: works — BTC currently rank 6 in trending, is_bullish:true; 8/8 tests passing
BLOCKERS: none

## [2026-04-25] src/lib/BrainTab.svelte — STATUS: DONE
TASK: brain dump image extraction via Claude vision
WHAT: added extractImageText(file) — reads image as base64, calls claude-haiku-4-5-20251001 vision to extract plain text, sets dumpText with result; onpaste handler on textarea intercepts clipboard images and routes to extractImageText; drop handler updated to use extractImageText instead of processImageDump (lighter: extract→dumpText→suggest-category vs old: extract→JSON→approval panel); imageExtracting state shows ⏳ indicator while processing; tracks cost via /track-cost
RESULT: works — clean build, 8/8 tests passing
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs + ProjectsTab.svelte + BrainTab.svelte — STATUS: DONE
TASK: change1+2 of three — analyzer project refs first + merge my-refs into library
WHAT: CHANGE 1 — refTrackOptions select now includes popularity/collection_name; ref dropdown shows optgroups PROJECT REFS/HIT SONGS/LIBRARY based on work_data.reference_links + popularity/collection_name; buildSuccessPattern(refsOverride) accepts optional refs; /analyze-success-match checks work_data.reference_links and passes project refs to buildSuccessPattern first. CHANGE 2 — POST /migrate-my-refs-to-library (ran: 2 migrated); MY REFERENCES section removed from BrainTab; libraryRefs now includes source=user/mozart/promoted; CHECKOUT: ★ Mine removed, only → lib (source=agent); brain-reftrack-promote saves agent not user
RESULT: works — clean build, 8/8 tests, migration confirmed 2 tracks moved
BLOCKERS: CHANGE 3 was cut off mid-spec — needs completion from user

## [2026-04-25] momentum-watcher.cjs + BrainTab.svelte — STATUS: DONE
TASK: speicherbox file storage endpoint + Brain tab UI + paste support
WHAT: GET /speicherbox (brain_knowledge category=speicherbox, newest first); POST /save-speicherbox-file (base64 decode → Dropbox/!MOMENTUM MUSIC/Brain/speicherbox/TIMESTAMP_name, insert brain_knowledge with metadata{file_path,file_type,thumbnail}); POST /open-file (exec open "path"); BrainTab: loadSpeicherbox()/saveToSpeicherbox() with canvas thumbnail generation + Haiku text extraction for images; onMount loads speicherbox; paste and drop handlers save to speicherbox + extract text; SPEICHERBOX section below LIBRARY with grid of cards (thumbnail/icon, name, date, extracted text preview, delete); CSS for speicher-card/thumb/grid
RESULT: works — file saved to disk, Supabase entry created, GET /speicherbox returns item; 8/8 tests passing
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs, ProjectsTab.svelte — DONE
TASK: fix-mozart-refs-column
WHAT: Mozart add_project_reference writes to reference_links column (not work_data). /fix-song-refs migrates + merges both sources. Frontend simplified to single source.
RESULT: works — song 152 migrated 3 refs from work_data to column. svelte-check 0 errors.
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: three-urgent-fixes
WHAT: Scout press/gear saves await with error log; Spotify 429 rate limit detection + retry in bg processor + fetchTrackGenres; mergeDupes 20% safety cap with two-pass collect-then-delete
RESULT: works — clean startup, no parse errors on 429
BLOCKERS: none

## [2026-04-25] momentum-watcher.cjs — DONE
TASK: health-check-and-finishing-fixes
WHAT: /health endpoint (supabase+brain+songs+refs+inbox+files+keys), finishing checklist broadened query + 2000 token limit + robust JSON parser, genres column startup SQL, 6h health check with Telegram alert
RESULT: works — health OK (598 brain, 36 refs, 15 songs), checklist 15 questions
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte — DONE
TASK: fix-refs-display-formats
WHAT: REFS tab handles both {url,name} (manual) and {title,artist,spotify_id} (Mozart) via inline {@const} derivation. removeSongRef matches url OR id. addSongRef saves spotify_id. normSongRef removed.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte — DONE
TASK: checklist-70-panel-fix
WHAT: loadFinishingChecklist uses maybeSingle(), phase-grouped display, checkedItems keyed by question, "New item..." input removed, new CSS classes
RESULT: works — svelte-check 0 errors. Will show 15 questions when panel opens.
BLOCKERS: none

## [2026-04-25] +page.svelte, ProjectsTab.svelte — DONE
TASK: persist-tab-and-song
WHAT: setActiveTab() saves to localStorage; onMount restores momentum_active_tab. expandSong() writes/clears momentum_last_song; load() restores it after songs array populated.
RESULT: works — svelte-check 0 errors
BLOCKERS: none

## [2026-04-25] ProjectsTab.svelte, momentum-watcher.cjs — DONE
TASK: project-level-references
WHAT: projectRefs() reads projects.reference_links column (with migration fallback). addRefLink/removeRefLink write to column. Mozart add_project_reference rewired to projects table with project_name resolution. removeProjectRef() added.
RESULT: works — svelte-check 0 errors. Run ALTER TABLE projects ADD COLUMN IF NOT EXISTS reference_links jsonb DEFAULT '[]'; in Supabase first.
BLOCKERS: Supabase SQL must be run manually before the column is available.

## 2026-04-25 ProjectsTab.svelte — DONE
TASK: checklist-70-fix
WHAT: loadFinishingChecklist moved into onMount (was bare call at module init, ran before Supabase ready); removed checklist-title/subtitle; empty state now shows retry button; reset button renamed to reset-btn; removed New item input
RESULT: works
BLOCKERS: none

## 2026-04-25 momentum-watcher.cjs — DONE
TASK: fix-scout-catch
WHAT: runAgentScout — replaced raw fetch(api_usage).catch(() => {}) with supabase.from('api_usage').insert() + error log; replaced saveBrainFile().catch(() => {}) with await + error log inside existing try/catch
RESULT: works
BLOCKERS: none

## 2026-04-25 momentum-watcher.cjs + BrainTab.svelte — DONE
TASK: spotify-playlist-import + library-sort-genre
WHAT: Added POST /import-spotify-playlist endpoint + importSpotifyPlaylist() — paginates playlist, dedupes by spotify_id, fetches artist genres, saves to reference_tracks with genre_tag/playlist_name; startup SQL check for new columns; BrainTab library: added Genre sort button, libraryGenreFilter state, genre-filter-chips row, track-genre-tag per row, filteredLibraryRefs now filters by genre
RESULT: works
BLOCKERS: Run SQL manually: ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS genre_tag text, ADD COLUMN IF NOT EXISTS playlist_name text;

## 2026-04-25 momentum-watcher.cjs — DONE
TASK: fix-rate-limit-queue + fix-playlist-user-token
WHAT: FIX 1 — spotifyRateLimitUntil var; bg queue skips immediately when rate limited instead of blocking; fetchTrackGenres sets flag on 429 instead of waiting; FIX 2 — /agent-import-spotify playlist fetch uses spotifyUserToken || getSpotifyToken(); importSpotifyPlaylist already had this fix; Spotify OAuth endpoints use 127.0.0.1 for redirect_uri
RESULT: works
BLOCKERS: none

## 2026-04-25 momentum-watcher.cjs — DONE
TASK: spotify-rate-limit-protection
WHAT: Added spotifyFetch() wrapper — handles Bearer token, 30-call/30s throttle, 429 → sets spotifyRateLimitUntil + Telegram alert, 403 throws; replaced all 32 raw Spotify API fetch() calls; runBackgroundQueue checks rate limit flag + retries in 60s, 3s between tracks; GET /spotify-status endpoint; removed all orphaned token/spH vars
RESULT: works — spotify-status returns correct JSON, ping ok
BLOCKERS: none
