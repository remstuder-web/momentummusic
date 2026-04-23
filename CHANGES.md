# CHANGES

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
