# Momentum Tasks

<!-- CONTINUATION MARKER — 2026-04-17 session 2 -->
<!-- ALL TASKS 0–27 VERIFIED COMPLETE. Next session: add new tasks below or test agent pipeline. -->
<!-- If interrupted mid-task: check CHANGES.md for last PARTIAL/FAILED entry -->

## TASK 0 — URGENT: DailyTab save reliability
File: src/lib/DailyTab.svelte
- Replace save() with async version that sets saveStatus='saving' before upsert, catches error, writes emergency localStorage backup on failure, sets saveStatus='saved'/'error' after
- Add let saveStatus = $state('')
- Change every save() call in the file to await save()
- Add save status indicator in tasks section header: gray "saving…" / green "✓ saved" / red "⚠ save failed — check connection" in Space Mono 11px
- On mount: check localStorage for 'mm_daily_backup_'+todayISO — if it has more tasks than Supabase returned, show yellow restore banner with [Restore] and [Dismiss] buttons
- [Restore] merges backup tasks into state, calls await save(), clears localStorage key
- Ensure every addTask path does state.tasks=[...state.tasks, newTask] then await save() in that order

## TASK 1 — Merge brain into brain_knowledge
File: Supabase SQL + momentum-watcher.js + BrainTab.svelte
- Run SQL: INSERT INTO brain_knowledge SELECT * FROM brain WHERE content NOT IN (SELECT content FROM brain_knowledge); DROP TABLE IF EXISTS brain
- In momentum-watcher.js: replace every Supabase query targeting 'brain' table with 'brain_knowledge'
- In BrainTab.svelte: same audit, replace all 'brain' table refs

## TASK 2 — Essentia only, remove all fallbacks
File: momentum-watcher.js → /analyze-audio endpoint
- Delete keyfinder-cli block entirely
- Delete aubio fallback block entirely
- Essentia edma profile is sole path
- On failure return { bpm: null, key: null, error: 'Essentia failed' }

## TASK 3 — Unify cost tracking to Supabase only
File: momentum-watcher.js + src/routes/+page.svelte
- Confirm POST /track-cost exists and inserts into api_usage
- In +page.svelte: replace window.trackTokens / all localStorage cost writes with fire-and-forget fetch to /track-cost
- Settings panel cost display: remove all localStorage reads, query api_usage only
- Delete window.trackTokens and all localStorage cost keys

## TASK 4 — TASKS.md + CHANGES.md read-back in settings panel
File: momentum-watcher.js + src/routes/+page.svelte
- Confirm GET /get-tasks returns { content: string }
- Add GET /get-changes: reads last 30 lines of CHANGES.md, returns { lines: string[] }
- Settings panel on open: fetch /get-tasks, populate tasks textarea with current content
- Below textarea: read-only <pre> "Recent Changes" from /get-changes — font-size:12px; color:#9e9690; max-height:160px; overflow-y:auto; border-top:1px solid #303030; margin-top:12px

## TASK 5 — Shared brain context in morning runner
File: momentum-watcher.js → /run-morning-agents
- At top of handler: single Supabase query fetching 10 most recent brain_knowledge entries → const sharedBrainContext
- Pass sharedBrainContext as argument into each agent function
- Remove individual brain_knowledge fetches inside each agent

## TASK 6 — Audit taste_profiles
File: momentum-watcher.js + BrainTab.svelte
- If /agent-analyze-taste writes but nothing reads: wire latest taste_profile row into Mozart system prompt
- If nothing uses it at all: remove endpoint, DROP TABLE taste_profiles

## TASK 7 — Brain category: free text with autocomplete
File: BrainTab.svelte
- Any remaining <select> category dropdown → <input list="brain-cats-dl"> + datalist
- Datalist built from loadCategories() result, refreshed after every save
- Remove brainCategories.js if it exists
- Run dedup SQL: DELETE FROM brain_knowledge WHERE id NOT IN (SELECT MIN(id) FROM brain_knowledge GROUP BY content)

## TASK 8 — Spotify track intake: full variables
File: momentum-watcher.js → /analyze-spotify-track
- Add release_date and artist_followers to API call
- Add Essentia energy, danceability, loudness to preview analysis
- Return: { title, artist, album, art_url, popularity, genres, artist_followers, release_date, bpm, key, key_confidence:'low', energy, danceability, loudness }

## TASK 9 — Daily Tab: Check Out section
File: DailyTab.svelte
- Add columns to brain_knowledge if not exist: surfaced_in_daily boolean default false, surfaced_until date, reviewed boolean default false
- On mount: fetch brain_knowledge WHERE surfaced_in_daily=true AND surfaced_until >= today AND reviewed=false
- Render as "🎧 Check Out" checkboxes: track name + Spotify link + category badge
- On tick: PATCH brain_knowledge set reviewed=true, surfaced_in_daily=false
- Hide section when 0 entries

## TASK 10 — Watcher error log in settings panel
File: momentum-watcher.js + src/routes/+page.svelte
- Change in-memory errorLog to write to Supabase watcher_logs table: { id, created_at, endpoint, message, level }
- GET /logs reads from watcher_logs ORDER BY created_at DESC LIMIT 50
- Settings panel: collapsible "Watcher Errors" section, fetches /logs on open
- SQL: CREATE TABLE watcher_logs (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz DEFAULT now(), endpoint text, message text, level text DEFAULT 'error'); ALTER TABLE watcher_logs ENABLE ROW LEVEL SECURITY; CREATE POLICY "anon all" ON watcher_logs FOR ALL TO anon USING (true) WITH CHECK (true);

## TASK 11 — /save-audio suggests Brain after analysis
File: momentum-watcher.js → /save-audio
- After Essentia analysis add suggest_brain:true to response
- Include prefilled: { category:'own_production', title: parsed_from_filename, bpm, key }

## TASK 12 — Mozart system prompt: own productions + references
File: BrainTab.svelte → Mozart call handler
- Before every Mozart call fetch:
    brain_knowledge WHERE category='own_production' LIMIT 5 ORDER BY created_at DESC
    brain_knowledge WHERE category LIKE 'reference_%' LIMIT 5 ORDER BY created_at DESC
    brain_knowledge WHERE category='goal' AND reviewed=false LIMIT 10
- Inject as three labelled blocks: MY PRODUCTIONS · CURRENT REFERENCES · ACTIVE GOALS

## TASK 13 — Pulse Check: real data sources
File: momentum-watcher.js → /agent-pulse-check
- Step 1: fetch Spotify new releases GET https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE using existing getSpotifyToken()
- Step 2: fetch Spotify featured playlists GET https://api.spotify.com/v1/browse/featured-playlists?limit=5&country=DE
- Step 3: fetch MBW RSS https://www.musicbusinessworldwide.com/feed/ — parse last 5 <title> and <description> tags with regex
- Step 4: TikTok — fetch Spotify Viral 50 Global playlist tracks as proxy: GET https://api.spotify.com/v1/playlists/4rOoJ6Egrf8K2IrywzwOMk/tracks?limit=20
- Build Claude prompt with ONLY this real data — no invented trends
- Remove any generic "what's trending" prompt that has no real data input
- Format response with sections: ## New Releases · ## Editorial Push · ## Industry News · ## Viral Proxy · ## Next Move

## TASK 14 — Shared ListenLinkBlock component
File: new src/lib/ListenLinkBlock.svelte + DemoTab.svelte + ProjectsTab.svelte
- Extract shared listen/share UI into ListenLinkBlock.svelte
- Props: { sessionId, sessionType, backgroundStyle, feedbackEnabled, stemsOnly }
- Replace both implementations — no visual changes

## TASK 15 — Update CLAUDE.md Spotify section
File: CLAUDE.md
- Remove any mention of Premium being required
- State: Client Credentials sufficient for all Momentum features
- Audio Features deprecated Nov 2024 — replaced by Essentia local analysis

## TASK 16 — TTS audio playback
File: momentum-watcher.js + DailyTab.svelte
- Add POST /speak: check OPENAI_API_KEY, call OpenAI TTS tts-1 voice:onyx, pipe stream back as audio/mpeg, track cost
- DailyTab: ▶ button on each agent block (28px circle, #1c1c1c, border #303030, color #c9a84c)
- On click: fetch /speak → blob → Audio(URL.createObjectURL(blob)) → play()
- Button shows ■ while playing, ▶ on end
- On error: toast "Add OPENAI_API_KEY to .env to enable audio"
- Add OPENAI_API_KEY=your_key_here to .env.example

## TASK 17 — Goals section in settings panel
File: src/routes/+page.svelte + BrainTab.svelte
- Goals stored as brain_knowledge rows with category:'goal', content as JSON {name,type,target,current,deadline,done}
- Settings panel goals section: list goals, progress bars (gold #c9a84c, capped 100%), type badges (release/demo/finance/other)
- Add/mark-done/delete via Supabase INSERT/UPDATE
- Types: release → tag-release (gold), demo → tag-demo (green), finance → tag-finance (blue), other → tag-other (gray)
- Mozart fetches goal rows and injects as ACTIVE GOALS block in system prompt

## TASK 18 — Structured agent output formatting
File: momentum-watcher.js + DailyTab.svelte
- All agent prompts: add formatting instruction — use ## for sections, bullets for lists, max 2 lines per bullet, end with ## Next Move
- Agent schemas: Briefing: Today's Focus/Pipeline Status/Watch Out/Next Move · Scout: Breaking Artists/Trending Sounds/Opportunities/Next Move · Pulse: Chart Moves/Genre Shifts/Relevant Tracks/Next Move · Demo Match: Best Fits/Reach Out Now/Skip/Next Move
- DailyTab: parseAgentOutput() function — split on ## headers, render headers in Space Mono 11px gold uppercase, lists as <ul>/<ol>, paragraphs as <p>
- ## Next Move section: background:#141414, border-left:2px solid #c9a84c, padding:10px 14px
- Remove all raw <pre>/innerHTML dumps

## TASK 19 — Smart category suggestion for Brain dumps
File: momentum-watcher.js + BrainTab.svelte
Already partially implemented — see Task 23 for the fix

## TASK 20 — Fix category suggestion quality
File: momentum-watcher.js → /suggest-category
Already covered in Task 23

## TASK 21 — Fix category list source in BrainTab
File: BrainTab.svelte
- loadCategories() fetches DISTINCT category FROM brain_knowledge — confirmed implemented
- Call loadCategories() after every successful save — confirm this is in saveApproved(), saveSplitsDirect(), saveSpotifyPreview()
- /suggest-category call must pass freshly loaded existingCategories — not stale state

## TASK 22 — Nothing stored only in localStorage
File: +page.svelte + BrainTab.svelte + DailyTab.svelte + momentum-watcher.js
- Audit all localStorage.setItem calls
- Cost/token data → replace with POST /track-cost
- API keys → store in .env only, read via GET /get-env-keys returning masked values
- UI state (open/closed panels) → fine to keep in localStorage
- Create user_settings table: CREATE TABLE user_settings (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, key text UNIQUE NOT NULL, value text, updated_at timestamptz DEFAULT now()); ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY; CREATE POLICY "anon all" ON user_settings FOR ALL TO anon USING (true) WITH CHECK (true);
- watcher errorLog → write to watcher_logs Supabase table (see Task 10)

## TASK 23 — Fix brain dump category suggestion flow
File: src/lib/BrainTab.svelte + momentum-watcher.js

Part A — Single-pass flow after category chosen:
- When prefilledCategory is set AND text < 300 words AND not isArticle:
  skip Claude entirely, save directly to brain_knowledge with prefilledCategory
- When prefilledCategory is set AND text is long/article:
  run Claude but remove category suggestion from prompt, replace with "Category already chosen: [prefilledCategory]. Only extract and structure content."
- Remove category input field from approval panel entirely — category decided at suggestion step
- Approval panel shows only: entry_type badge · title · content

Part B — Always refresh categories before suggestion:
- In fetchCatSuggestion(): always call await loadCategories() unconditionally at start
- Pass freshly loaded existingCategories to /suggest-category

Part C — Fix watcher suggest-category prompt:
- Watcher fetches DISTINCT categories fresh from brain_knowledge at start of every call (don't trust browser list)
- Fetch asc LIMIT 1 (seed/description row) + desc LIMIT 1 (newest real entry) per category
- System prompt: match by content similarity not name, quote specific matching entry in reason, never match on keyword overlap alone, do not suggest artist_breaking/business/market_knowledge unless content specifically matches those topics
- Wrap entire handler in try/catch, every error path returns JSON
- Use Promise.allSettled for per-category fetches
- If existingCategories empty: skip fetch, ask Claude to propose new category
- Add console.log at top of handler for debugging
- If JSON.parse fails: return { ok:true, action:'new', suggestion:'knowledge', reason:'Parse error', alternatives:[] }

Part D — Remove hardcoded categories from morning briefing:
- Line ~1400: change category=in.(market_knowledge,business,artist_breaking) to order=created_at.desc&limit=10

Part E — Fix captureCategory default:
- Change let captureCategory = $state('production_style') to $state('')
- Set to existingCategories[0] || '' after loadCategories() completes

## TASK 24 — Fix Spotify URL detection
File: src/lib/BrainTab.svelte → processDump()
- Replace Spotify track regex with: /spotify\.com\/(?:intl-\w+\/)?track\/([a-zA-Z0-9]+)/
  Catches: open.spotify.com/track/X, open.spotify.com/intl-de/track/X, open.spotify.com/intl-ch/track/X
- Same fix for the hint detection in template
- Move dumpText='' to BEFORE the fetch call in Spotify handler (clears immediately on detect)
- In fetchCatSuggestion: add early return if /spotify\.com/.test(dumpText)
- In saveApproved: guard against Spotify content reaching approval panel
- Confirm dumpText='' in every successful save path: saveApproved, saveSplitsDirect, saveSpotifyPreview, proceedAfterSuggestion

## TASK 25 — Pulse Check real data
File: momentum-watcher.js → /agent-pulse-check
- Fetch Spotify new releases: GET https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE
- Fetch featured playlists: GET https://api.spotify.com/v1/browse/featured-playlists?limit=5&country=DE
- Fetch MBW RSS: GET https://www.musicbusinessworldwide.com/feed/ — parse last 5 titles+descriptions with regex on <title> and <description> tags
- Fetch Viral 50 proxy: GET https://api.spotify.com/v1/playlists/4rOoJ6Egrf8K2IrywzwOMk/tracks?limit=20
- Build Claude prompt with ONLY this real fetched data
- TikTok: include note "TikTok trends: manual check needed" — never invent data
- Response sections: ## New Releases · ## Editorial Push · ## Industry News · ## Viral Proxy · ## Next Move

## TASK 26 — Fix /suggest-category silent failure
File: momentum-watcher.js → /suggest-category (~line 2500)
- Covered in Task 23 Part C above

## TASK 27 — Seed brain categories + use content as descriptions
File: Supabase SQL + momentum-watcher.js
- Run this SQL first:
  INSERT INTO brain_knowledge (category, title, content, entry_type, active) VALUES
  ('artist_strategy','Category: artist strategy','Frameworks for how artists build cultural relevance, fan psychology, positioning, rollout tactics','knowledge',true),
  ('mixing_technique','Category: mixing technique','Mixing approaches, compression, EQ, bus processing, reference workflows, loudness targets','knowledge',true),
  ('release_strategy','Category: release strategy','Release planning, timing, DSP strategy, pre-save campaigns, rollout phases','knowledge',true),
  ('sound_design','Category: sound design','Synthesis, sampling, texture, FX design, sound selection philosophy','knowledge',true),
  ('industry_insight','Category: industry insight','Music industry structure, label deals, sync, publishing, A&R dynamics','knowledge',true),
  ('social_media','Category: social media','Platform tactics, content strategy, algorithm behaviour, TikTok Instagram YouTube','knowledge',true),
  ('own_production','Category: own production','Remos own tracks, productions, versions, BPM key status notes','knowledge',true),
  ('networking','Category: networking','Contacts, relationships, collaboration opportunities, industry connections','knowledge',true),
  ('creative_process','Category: creative process','Songwriting, arrangement, workflow, creative blocks, inspiration sources','knowledge',true),
  ('business_finance','Category: business finance','Revenue, budgets, costs, royalties, financial planning for music','knowledge',true);
- In /suggest-category: fetch asc LIMIT 1 + desc LIMIT 1 per category so seeded description row is always included as the category intent signal
- Watcher fetches distinct categories fresh from DB at start of every suggest-category call

## FUTURE BUILD — Library Intelligence (stem analysis expansion)
Status: QUEUED — do not implement until explicitly requested
Added: 2026-04-25

After Demucs separation (in processLibraryTrackInBackground or extractAcapella),
run additional per-stem analysis and save results to reference_tracks as jsonb columns.

### 1. Chord progression
- Stems: other + vocals (ignore drums)
- Method: librosa.effects.harmonic() + chroma features
- Output: ['Cm', 'Fm', 'Bb', 'Eb'] per 4-bar section
- DB column: chord_progression jsonb

### 2. Drum pattern grid
- Stem: drums
- 16-step grid showing kick/snare/hihat hits
- Detect: straight vs swing, complexity score
- DB column: drum_pattern jsonb

### 3. Bass movement
- Stem: bass
- Root note per bar
- Detect: static vs moving bass line
- DB column: bass_movement jsonb

### 4. Vocal melody contour
- Stem: vocals
- Pitch over time: rising/falling/static phrases
- Detect: hooks vs verses by melodic range
- DB column: vocal_contour jsonb

### 5. Structure detection (full mix)
- Intro/verse/chorus/bridge timestamps
- Method: librosa.segment + self-similarity matrix
- DB column: song_structure jsonb

### UI
- Show all above as additional panels in ANALYZER tab

### Tooling to monitor monthly
- AudioSep (text-based separation)
- Moises.ai API availability
- Demucs v5 updates
- Telegram command: /check-audio-tools → check for updates on above tools
