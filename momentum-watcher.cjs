#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '.env') })

/**
 * Momentum Watcher + Audio Server
 *
 * 1. Watches ~/Downloads for CODE_v00.ext → moves to Dropbox/Demos
 * 2. Watches for __momentum_open__.json → opens file in QuickTime
 * 3. GET  /audio/FILENAME  → streams audio from Dropbox/Demos
 * 4. POST /create-submission → creates Submissions folder, copies files, Dropbox link to clipboard
 * 5. GET  /ping             → health check
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const http = require('http')
const https = require('https')
const { execSync, exec } = require('child_process')
const { Readable } = require('stream')
const chokidar = require('chokidar')
const formidable = require('formidable')

function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'"
}

let Database = null
try { Database = require('better-sqlite3') } catch(e) { console.warn('better-sqlite3 not available:', e.message) }

/*
 * MOMENTUM DATA MAP — where things live
 *
 * songs.reference_links     ← array of {id,title,artist,spotify_id,ref_type}
 * songs.work_data           ← {versions[], notes, release_checklist}
 * songs.work_data.versions  ← [{name, feedback, analysis, created_at}]
 *
 * brain_knowledge           ← all knowledge entries
 *   source_type='text'      ← user typed manually (PROTECTED)
 *   confidence='locked'     ← user locked (PROTECTED)
 *   source_type='mozart'    ← mozart sessions
 *   category='speicherbox'  ← file attachments
 *
 * reference_tracks          ← music references
 *   source='checkout'       ← incoming/scouted
 *   source='agent'          ← promoted to library
 *
 * inbox_notifications       ← daily display only (ephemeral)
 *   type='briefing'         ← one per day, replaced
 *   type='scout'            ← one per day, replaced
 *   type='reference'        ← aktuelle refs, expire 7 days
 *
 * vocal_eq_curves           ← EQ analysis per stem
 *   song_id                 ← mix curves
 *   reference_track_id      ← reference curves
 */

// ── CONFIG ────────────────────────────────────────────────────────────────
// Dropbox OAuth2 — fill in App Key and App Secret from your Dropbox App Console
// https://www.dropbox.com/developers/apps → your app → Settings
const DROPBOX_APP_KEY    = 'd49ij57sk23ukdw'     // e.g. 'abc123xyz'
const DROPBOX_APP_SECRET = 'h36y7hta8ttmr6e'  // e.g. 'def456uvw'

// Spotify — fill in from https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID     = '45bb7c8c0553458ca79e0848ea805559'
const SPOTIFY_CLIENT_SECRET = 'ab5d6290dc404f48b261870262f23a0c'

// Telegram bot
const TELEGRAM_TOKEN    = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_OWNER_ID = 33858745
const TELEGRAM_API      = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN
const sentMessages = [] // { chat_id, message_id, sent_at }

// Gemini API (optional — used for cheap WhatsApp analysis)
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY

// Obsidian vault
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '/Users/remo/ObsidianVault/Momentum'
const NOTES_PATH = path.join(OBSIDIAN_VAULT_PATH, 'Notes')
const NOW_PATH = path.join(OBSIDIAN_VAULT_PATH, 'Notes', 'NOW.md')

// Brain file storage (Dropbox → synced to Obsidian)
const BRAIN_FILES_PATH = process.env.BRAIN_FILES_PATH || '/Users/remo/Dropbox/Brain'
const BRAIN_FOLDERS = [
  'goal', 'mixing_technique', 'production_style', 'creative_process',
  'market_knowledge', 'own_production', 'contact_profile', 'collaboration',
  'observation', 'reference_current', 'business', 'sound_design', 'uncategorized'
]
for (const folder of BRAIN_FOLDERS) {
  fs.mkdirSync(path.join(BRAIN_FILES_PATH, folder), { recursive: true })
}
fs.mkdirSync(path.join(BRAIN_FILES_PATH, 'uploads'), { recursive: true })

let nowExtractTimer = null

const GENRE_LIST = [
  { label: 'ELECTRONIC & DANCE', type: 'main', tag: 'electronic' },
  { label: 'house',              type: 'sub',  tag: 'house' },
  { label: 'afrobeats',          type: 'sub',  tag: 'afrobeats' },
  { label: 'melodic techno',     type: 'sub',  tag: 'melodic-techno' },
  { label: 'POP',                type: 'main', tag: 'pop' },
  { label: 'k-pop',              type: 'sub',  tag: 'k-pop' },
  { label: 'r&b',                type: 'sub',  tag: 'r-n-b' },
  { label: 'hyperpop',           type: 'sub',  tag: 'hyperpop' },
  { label: 'synth-pop',          type: 'sub',  tag: 'synth-pop' },
  { label: 'HIPHOP',             type: 'main', tag: 'hip-hop' },
  { label: 'german hiphop',      type: 'sub',  tag: 'german-hip-hop' },
  { label: 'rap',                type: 'sub',  tag: 'rap' },
  { label: 'trap',               type: 'sub',  tag: 'trap' },
  { label: 'drill',              type: 'sub',  tag: 'drill' },
  { label: 'phonk',              type: 'sub',  tag: 'phonk' },
  { label: 'emo rap',            type: 'sub',  tag: 'emo-rap' },
  { label: 'boom bap',           type: 'sub',  tag: 'boom-bap' },
  { label: 'INDIE / ALT',        type: 'main', tag: 'indie' },
  { label: 'dark pop',           type: 'sub',  tag: 'dark-pop' },
  { label: 'dream pop',          type: 'sub',  tag: 'dream-pop' },
  { label: 'chamber pop',        type: 'sub',  tag: 'chamber-pop' },
  { label: 'LATIN',              type: 'main', tag: 'latin' },
  { label: 'urban latino',       type: 'sub',  tag: 'urbano-latino' },
  { label: 'reggaeton',          type: 'sub',  tag: 'reggaeton' },
  { label: 'dancehall',          type: 'sub',  tag: 'dancehall' },
  { label: 'ROCK',               type: 'main', tag: 'rock' },
  { label: 'SOUL',               type: 'main', tag: 'soul' },
  { label: 'FUNK',               type: 'main', tag: 'funk' },
]
const SPOTIFY_TAGS = GENRE_LIST.filter(g => g.type === 'sub').map(g => g.tag)
const SUB_GENRE_LABELS = GENRE_LIST.filter(g => g.type === 'sub').map(g => g.label).join(', ')

const TOKEN_FILE = path.join(process.env.HOME, '.momentum_dropbox_token.json')

let dropboxTokens = { access_token: '', refresh_token: '', expires_at: 0 }

// Load saved tokens on startup
if (fs.existsSync(TOKEN_FILE)) {
  try { dropboxTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) } catch(e) {}
}

function saveTokens() {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(dropboxTokens), 'utf8')
}

async function getValidAccessToken() {
  // If token is still valid (with 5min buffer), return it
  if (dropboxTokens.access_token && Date.now() < dropboxTokens.expires_at - 300000) {
    return dropboxTokens.access_token
  }
  // Refresh using refresh token
  if (!dropboxTokens.refresh_token) {
    console.log('⚠ No Dropbox refresh token — visit http://localhost:4242/dropbox-auth to authorize')
    return null
  }
  console.log('🔄 Refreshing Dropbox access token...')
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(dropboxTokens.refresh_token)}`
  const creds = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64')
  const data = await fetchJSON('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (data.access_token) {
    dropboxTokens.access_token = data.access_token
    dropboxTokens.expires_at = Date.now() + (data.expires_in || 14400) * 1000
    saveTokens()
    console.log('✓ Dropbox token refreshed')
    return dropboxTokens.access_token
  }
  console.log('✗ Token refresh failed:', JSON.stringify(data))
  return null
}

const WATCH_DIR       = path.join(process.env.HOME, 'Downloads')
const DEMOS_DIR       = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Demos')
const SUBMISSIONS_DIR = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Submissions')
const PRODUCTION_DIR  = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Production')
const INSTRUMENTALS_DIR = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Production', '-Instrumentals')
const MIXING_DIR      = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Mixing')
const RELEASES_DIR    = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Releases')
const STEMS_DIR       = path.join(process.env.HOME, 'Dropbox', '!MOMENTUM MUSIC', 'Stems')
const AUDIO_EXTS      = ['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a', '.ogg', '.opus']
const CODE_PATTERN    = /^\d{8}_v\d{2}\.\w+$/
const OPEN_TRIGGER    = '__momentum_open__.json'
const PORT            = 4242

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',  '.opus': 'audio/ogg',
}

// ── MP3 transcoding via ffmpeg ────────────────────────────────────────────
function transcodeToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -i ${shellEscape(inputPath)} -b:a 320k -y ${shellEscape(outputPath)}`,
      (err) => { if (err) reject(err); else resolve(outputPath) }
    )
  })
}

;[DEMOS_DIR, SUBMISSIONS_DIR, PRODUCTION_DIR, INSTRUMENTALS_DIR, MIXING_DIR, RELEASES_DIR, STEMS_DIR].forEach(d => {
  if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); console.log('Created:', d) }
})

// ── Startup: scan Stems folder for ZIPs older than 24h → auto-delete ──
function cleanupOldStemsZips() {
  try {
    const files = fs.readdirSync(STEMS_DIR)
    const now = Date.now()
    const twentyFourH = 24 * 60 * 60 * 1000
    files.filter(f => f.toLowerCase().endsWith('.zip')).forEach(f => {
      const fp = path.join(STEMS_DIR, f)
      const age = now - fs.statSync(fp).mtimeMs
      if (age > twentyFourH) {
        fs.unlinkSync(fp)
        console.log(`🗑 Auto-deleted stems ZIP (${Math.floor(age/3600000)}h old): ${f}`)
      } else {
        const remaining = Math.ceil((twentyFourH - age) / 3600000)
        console.log(`📦 Stems ZIP active (${remaining}h until auto-delete): ${f}`)
      }
    })
  } catch(e) { console.warn('Stems cleanup error:', e.message) }
}
cleanupOldStemsZips()
// Re-check every hour
setInterval(cleanupOldStemsZips, 60 * 60 * 1000)

// ── Supabase constants (shared by intervals and request handlers) ─────────
const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
const ANON_KEY     = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
const sbHeaders    = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(SUPABASE_URL, ANON_KEY)
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || ANON_KEY)

// ── Weekly: check watched artists for new releases ────────────────────────
setInterval(async () => {
  console.log('🎵 Checking watched artists for new releases...')
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/watched_artists?active=eq.true&select=*`,
      { headers: sbHeaders }
    )
    const artists = await r.json()
    if (!Array.isArray(artists) || !artists.length) return

    let newReleases = []

    for (const artist of artists) {
      const relRes = await spotifyFetch(
        `https://api.spotify.com/v1/artists/${artist.spotify_id}/albums?include_groups=single,album&limit=5`
      )
      const rels = await relRes.json()
      const latest = rels.items?.[0]

      if (latest && latest.id !== artist.last_release_id) {
        newReleases.push({
          artistName:   artist.name,
          releaseTitle: latest.name,
          releaseType:  latest.album_type,
          releaseDate:  latest.release_date,
          spotifyUrl:   latest.external_urls.spotify,
          artistId:     artist.spotify_id,
          releaseId:    latest.id
        })

        // Update last_release_id
        await fetch(
          `${SUPABASE_URL}/rest/v1/watched_artists?spotify_id=eq.${artist.spotify_id}`,
          {
            method: 'PATCH',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              last_release_id: latest.id,
              last_checked: new Date().toISOString().slice(0, 10)
            })
          }
        )
      }
    }

    if (newReleases.length) {
      const message = newReleases.map(r =>
        `${r.artistName} — "${r.releaseTitle}" `
        + `(${r.releaseType}, ${r.releaseDate})\n${r.spotifyUrl}`
      ).join('\n\n')

      await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          type: 'briefing',
          song_title: 'New Releases',
          message: `NEW RELEASES FROM WATCHED ARTISTS\n\n${message}`
            + `\n\nPaste any Spotify URL into the Brain tab to add to brain.`,
          patch_name: `Release check ${new Date().toISOString().slice(0, 10)}`,
          read: false
        })
      })
      console.log(`✓ Found ${newReleases.length} new releases from watched artists`)
    } else {
      console.log('✓ No new releases found')
    }
  } catch(e) {
    console.warn('Release check error:', e.message)
  }
}, 7 * 24 * 60 * 60 * 1000)

// ── Daily: pulse check if anthropicApiKey set in config.json ──────────────
setInterval(() => {
  try {
    const raw = fs.readFileSync('./config.json', 'utf8')
    const config = JSON.parse(raw)
    if (config.anthropicApiKey) {
      console.log('⚡ Running daily pulse check...')
      runPulseCheck(config.anthropicApiKey).catch(e => console.warn('Pulse check error:', e.message))
    }
  } catch(e) { /* config.json missing or invalid — skip silently */ }
}, 24 * 60 * 60 * 1000)

// ── Daily 8am: Obsidian two-way sync ──────────────────────────────────────
function scheduleDaily8amObsidianSync() {
  const now = new Date()
  const next8am = new Date(now)
  next8am.setHours(8, 0, 0, 0)
  if (next8am <= now) next8am.setDate(next8am.getDate() + 1)
  const msUntil = next8am - now
  console.log(`⏰ Obsidian auto-sync scheduled in ${Math.round(msUntil / 60000)}min`)
  setTimeout(async function runSync() {
    console.log('🔄 Daily Obsidian sync running...')
    try {
      await fetch(`http://127.0.0.1:${PORT}/brain-to-obsidian`).catch(() => {})
      await fetch(`http://127.0.0.1:${PORT}/obsidian-sync`, { method: 'POST' }).catch(() => {})
      console.log('✓ Daily Obsidian sync complete')
    } catch(e) { console.warn('Daily Obsidian sync error:', e.message) }
    setTimeout(runSync, 24 * 60 * 60 * 1000)
  }, msUntil)
}
scheduleDaily8amObsidianSync()

// ── Helpers ───────────────────────────────────────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const bodyStr = options.body || ''
    const headers = {
      ...(options.headers || {}),
      'Content-Length': Buffer.byteLength(bodyStr)
    }
    const reqOpts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers
    }
    const req = https.request(reqOpts, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        console.log(`  HTTP ${res.statusCode} — raw: ${data.slice(0, 300)}`)
        try { resolve(JSON.parse(data)) }
        catch(e) { resolve({ _raw: data, _status: res.statusCode }) }
      })
    })
    req.on('error', err => { console.log('  HTTPS error:', err.message); reject(err) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

async function getDropboxShareLink(dbxPath, retries = 8, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const token = await getValidAccessToken()
    if (!token) return null
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    console.log(`  Dropbox API attempt ${attempt}/${retries}...`)
    const createRes = await fetchJSON(
      'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
      { method: 'POST', headers, body: JSON.stringify({ path: dbxPath, settings: { requested_visibility: { '.tag': 'public' } } }) }
    )
    if (createRes.url) return createRes.url
    const errTag = createRes.error?.['.tag'] || createRes.error_summary || ''
    if (errTag.includes('shared_link_already_exists')) {
      const listRes = await fetchJSON('https://api.dropboxapi.com/2/sharing/list_shared_links',
        { method: 'POST', headers, body: JSON.stringify({ path: dbxPath, direct_only: true }) })
      if (listRes.links?.[0]?.url) return listRes.links[0].url
    }
    if (errTag.includes('not_found') || errTag.includes('path')) {
      if (attempt < retries) { console.log(`  Waiting ${delayMs/1000}s...`); await new Promise(r => setTimeout(r, delayMs)); continue }
    }
    console.log('  Dropbox error:', JSON.stringify(createRes)); break
  }
  return null
}

// ── Spotify auth ──────────────────────────────────────────────────────────
function buildBrainContext(knowledge) {
  if (!Array.isArray(knowledge) || !knowledge.length) return ''
  const active = knowledge.filter(k => k.active !== false)
  if (!active.length) return ''
  return `PRODUCER BRAIN — DIALECTICAL CONTEXT:
For each piece of knowledge below, actively consider:
✓ What supports this view in the current situation?
✗ What contradicts or limits this view?
→ What has changed since this was written that might update it?

${active.map(k => `[${k.category}] ${k.title}:\n${k.content}`).join('\n\n')}

When answering: don't just apply this knowledge — interrogate it. Surface what still holds, what is outdated, and what the current data contradicts.
Label your assessments:
[CONFIRMED] = brain knowledge still applies
[TENSION] = evidence both for and against
[OUTDATED] = current situation contradicts this
[NEW] = something the brain doesn't know yet`
}

// ── Agent helpers ─────────────────────────────────────────────────────────────
async function extractInsight(text, apiKey) {
  if (!apiKey || !text) return text.slice(0, 200)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 80,
        messages: [{ role: 'user', content: 'Extract the single most important actionable insight from this report. Max 200 chars. No fluff.\n\n' + text.slice(0, 2000) }]
      })
    })
    const d = await r.json()
    return ((d.content?.[0]?.text || '').trim() || text.slice(0, 200)).slice(0, 200)
  } catch(e) { return text.slice(0, 200) }
}

function todayStartISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

async function deleteInboxToday(songTitle) {
  return fetch(
    `${SUPABASE_URL}/rest/v1/inbox_notifications?type=eq.briefing&song_title=eq.${encodeURIComponent(songTitle)}&created_at=gte.${todayStartISO()}`,
    { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
  ).catch(() => {})
}

// ── Pulse check — compare fresh RSS headlines against brain knowledge ─────────
async function runPulseCheck(apiKey, sharedBrainRows) {
  const sites = [
    { name: 'Music Business Worldwide', url: 'https://www.musicbusinessworldwide.com/feed/' },
    { name: 'Hypebot',                  url: 'https://www.hypebot.com/latest/rss/' }
  ]

  let freshContent = ''
  for (const site of sites) {
    try {
      const r = await fetchJSON(site.url, { method: 'GET' })
      const xml = r._raw || ''
      const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)]
        .slice(1, 6)
        .map(m => m[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim())
      if (titles.length) freshContent += `\n${site.name}:\n${titles.join('\n')}\n`
    } catch(e) { console.warn(`Pulse fetch failed for ${site.name}:`, e.message) }
  }

  // Spotify new releases + featured playlists + Viral 50
  try {
    const [relRes, featRes, viralRes] = await Promise.allSettled([
      spotifyFetch('https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE'),
      spotifyFetch('https://api.spotify.com/v1/browse/featured-playlists?limit=5&country=DE'),
      spotifyFetch('https://api.spotify.com/v1/playlists/4rOoJ6Egrf8K2IrywzwOMk/tracks?limit=20')
    ])

    if (relRes.status === 'fulfilled' && relRes.value.ok) {
      const d = await relRes.value.json()
      const releases = (d.albums?.items || [])
        .map(a => `${a.artists.map(x=>x.name).join(', ')} — ${a.name} (${a.release_date})`)
      if (releases.length) freshContent += `\nSpotify New Releases (DE):\n${releases.join('\n')}\n`
    }
    if (featRes.status === 'fulfilled' && featRes.value.ok) {
      const d = await featRes.value.json()
      const playlists = (d.playlists?.items || []).map(p => p.name)
      if (playlists.length) freshContent += `\nSpotify Editorial Push (DE):\n${playlists.join('\n')}\n`
    }
    if (viralRes.status === 'fulfilled' && viralRes.value.ok) {
      const d = await viralRes.value.json()
      const viral = (d.items || []).slice(0, 10)
        .map(i => `${i.track?.artists?.map(a=>a.name).join(', ')} — ${i.track?.name}`)
        .filter(Boolean)
      if (viral.length) freshContent += `\nViral 50 Proxy:\n${viral.join('\n')}\n`
    }
  } catch(e) { console.warn('Pulse: Spotify data failed:', e.message) }

  freshContent += `\nTikTok Trends: manual check needed — visit TikTok for Today's sounds.\n`

  if (!freshContent.trim()) { console.log('⚡ Pulse: no content fetched, skipping'); return }

  const brainRows = sharedBrainRows || await fetch(
    `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true`
    + `&select=title,content&order=created_at.desc&limit=10`,
    { headers: sbHeaders }
  ).then(r => r.json()).catch(() => [])
  const brainSummary = (Array.isArray(brainRows) ? brainRows : [])
    .map(b => `${b.title}: ${(b.content||'').slice(0, 100)}`)
    .join('\n')

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content:
        `You are a music industry analyst. Compare fresh headlines and new releases against this producer's brain knowledge. Only flag REAL contradictions or important NEW developments. If nothing relevant → respond only: "NO_UPDATES"

FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK]/[CONFIRMED]/[TENSION]/[OUTDATED]/[NEW] for emphasis. Plain text only.
Format your response using this exact structure:
- Use ## for section headers
- One blank line between sections
- Bullet points for lists, max 2 lines per bullet
- Numbers for ranked items
- End with a ## Next Move section: single most important action today
Keep each section tight — no filler sentences.

Sections to include:
## New Releases
## Editorial Push
## Industry News
## Viral Proxy
## Next Move

FRESH DATA:
${freshContent}

PRODUCER BRAIN:
${brainSummary}` }]
    })
  })
  const cd = await claudeRes.json()
  const pulse = cd.content?.[0]?.text || ''

  if (!pulse.includes('NO_UPDATES') && pulse.trim()) {
    const pulseToday = new Date().toISOString().slice(0, 10)
    await deleteInboxToday('Pulse Check')
    await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        type: 'briefing',
        song_title: 'Pulse Check',
        message: pulse,
        patch_name: `Pulse ${pulseToday}`,
        read: false
      })
    })
    setImmediate(async () => {
      try {
        const insight = await extractInsight(pulse, apiKey)
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            category: 'observation',
            title: `Pulse ${pulseToday} — ${insight.slice(0, 60)}`,
            content: insight,
            entry_type_v2: 'observation',
            confidence: 'medium',
            source_type: 'pulse_agent',
            active: true
          })
        })
      } catch(e) { console.warn('pulse brain save error:', e.message) }
    })
    console.log('⚡ Pulse update sent to inbox')
  } else {
    console.log('⚡ Pulse: no updates worth flagging')
  }

  fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      endpoint: '/pulse-check', model: 'haiku',
      input_tokens: cd.usage?.input_tokens || 0,
      output_tokens: cd.usage?.output_tokens || 0,
      cost_usd: ((cd.usage?.input_tokens || 0) * 0.000001) + ((cd.usage?.output_tokens || 0) * 0.000005)
    })
  }).catch(() => {})
}

// ── Agent: Chart Analysis — Spotify year:2026 search + Essentia + brain storage ──
async function runAgentChartAnalysis(apiKey) {
  const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
  const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
  // 1. Fetch current popular tracks (limit capped at 10 with Client Credentials; popularity unavailable in search)
  const searchUrl = 'https://api.spotify.com/v1/search?' +
    new URLSearchParams({ q: 'year:2026 genre:pop', type: 'track', limit: '10' }).toString()
  const searchRes = await spotifyFetch(searchUrl)
  if (!searchRes.ok) {
    const errBody = await searchRes.text()
    throw new Error(`Spotify track search failed: ${searchRes.status} — ${errBody}`)
  }
  const searchData = await searchRes.json()
  const viralTracks = (searchData.tracks?.items || []).filter(Boolean)

  // 2. Filter out tracks already in reference_tracks (by spotify_id or title+artist)
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_tracks?collection_name=eq.daily_chart&select=spotify_id,title,artist`,
    { headers: sbHeaders }
  )
  const existing = existingRes.ok ? await existingRes.json() : []
  const existingIds = new Set((existing || []).map(t => t.spotify_id))
  const existingTitles = new Set((existing || []).map(t => (t.title + '|' + t.artist).toLowerCase()))
  const newTracks = viralTracks.filter(t => {
    if (!t) return false
    if (existingIds.has(t.id)) return false
    const key = (t.name + '|' + t.artists.map(a=>a.name).join(', ')).toLowerCase()
    if (existingTitles.has(key)) return false
    return true
  }).slice(0, 10)

  if (!newTracks.length) {
    console.log('✓ chart-analysis: no new tracks today')
    return { ok: true, tracks: [], assessment: 'No new chart tracks today — all already stored.' }
  }

  // 3. Analyze each new track
  const analyzedTracks = []
  for (const track of newTracks) {
    const trackId = track.id
    const artistId = track.artists?.[0]?.id
    const artistRes = artistId ? await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`) : null
    const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

    let genres = artist.genres || []
    if (!genres.length && artistId) {
      try {
        const relRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}/related-artists`)
        if (relRes.ok) {
          const rel = await relRes.json()
          const gc = {}
          for (const ra of (rel.artists || []).slice(0, 3)) for (const g of (ra.genres || [])) gc[g] = (gc[g] || 0) + 1
          genres = Object.entries(gc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g)
        }
      } catch(e) {}
    }

    let feat = {}
    const tmpAudio = `/tmp/chart_${trackId}_${Date.now()}.mp3`
    try {
      const artistName = (track.artists[0]?.name || '').replace(/"/g, '')
      const trackName = track.name.replace(/"/g, '')
      execSync(`yt-dlp -x --audio-format mp3 --download-sections "*0-30" -o "${tmpAudio}" "ytsearch1:${artistName} ${trackName} official"`, { timeout: 60000 })
      const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
      feat = JSON.parse(esOut)
      console.log(`  ✓ Chart track analyzed: ${track.name} — ${feat.bpm}bpm ${feat.key} ${feat.scale}`)
    } catch(e) {
      console.warn(`  Chart analysis failed for ${track.name}:`, e.message.slice(0, 60))
    } finally {
      try { fs.unlinkSync(tmpAudio) } catch(e) {}
    }

    // Upsert to reference_tracks
    const row = {
      spotify_id: trackId,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album?.name,
      release_date: track.album?.release_date,
      genre_tags: genres,
      tempo: feat.bpm || null,
      key: feat.key || null,
      scale: feat.scale || null,
      key_strength: feat.key_strength || null,
      energy: feat.energy || null,
      danceability: feat.danceability || null,
      valence: feat.valence || null,
      acousticness: feat.acousticness || null,
      brightness: feat.brightness || null,
      bass_energy: feat.bass_energy || null,
      bpm_confidence: feat.bpm_confidence || null,
      loudness: feat.loudness_lufs || null,
      loudness_range: feat.loudness_range || null,
      duration_seconds: feat.duration_seconds || null,
      popularity: track.popularity || null,
      album_art: track.album?.images?.[0]?.url || null,
      collection_name: 'daily_chart',
      source: 'checkout',
      checkout_date: new Date().toISOString(),
      approved: true
    }
    await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row)
    })
    analyzedTracks.push({ title: track.name, artist: track.artists.map(a => a.name).join(', '), ...feat })

    // Also save individual brain_knowledge entry if not already present
    const chartArtist = track.artists.map(a => a.name).join(', ')
    const chartBrainTitle = track.name + ' — ' + chartArtist
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/brain_knowledge?source_url=ilike.*${trackId}*&select=id&limit=1`,
      { headers: sbHeaders }
    )
    const checkRows = checkRes.ok ? await checkRes.json() : []
    if (!checkRows.length) {
      const chartContent = [
        `Artist: ${chartArtist}`,
        feat.bpm ? `BPM: ${feat.bpm} · Key: ${feat.key || '?'}${feat.scale ? ' ' + feat.scale : ''}` : null,
        feat.energy != null ? `Energy: ${Number(feat.energy).toFixed(2)} · Dance: ${Number(feat.danceability ?? 0).toFixed(2)}` : null,
        feat.loudness_lufs != null ? `Loudness: ${feat.loudness_lufs}LUFS` : null,
        `Popularity: ${track.popularity || '?'}/100`,
        genres.length ? `Genres: ${genres.slice(0, 4).join(', ')}` : null,
      ].filter(Boolean).join('\n')
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          category: 'reference_current',
          title: chartBrainTitle,
          content: chartContent,
          entry_type: 'reference_track',
          source_url: `https://open.spotify.com/track/${trackId}`,
          active: true
        })
      })
      setImmediate(() => saveBrainFile({ category: 'reference_current', title: chartBrainTitle, content: chartContent, confidence: 'medium', source_type: 'chart_agent', source_url: `https://open.spotify.com/track/${trackId}` }).catch(() => {}))
    }
  }

  // 4. Get reference benchmark for Claude comparison
  const refsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/reference_tracks?collection_name=neq.my_productions&collection_name=neq.daily_chart&select=tempo,energy,danceability,valence,loudness&limit=10`,
    { headers: sbHeaders }
  )
  const refRows = refsRes.ok ? await refsRes.json() : []
  const refAvg = refRows.length ? {
    bpm: Math.round(refRows.reduce((s, t) => s + (t.tempo || 0), 0) / refRows.length),
    energy: (refRows.reduce((s, t) => s + (t.energy || 0), 0) / refRows.length).toFixed(2),
    danceability: (refRows.reduce((s, t) => s + (t.danceability || 0), 0) / refRows.length).toFixed(2),
    loudness: (refRows.reduce((s, t) => s + (t.loudness || 0), 0) / refRows.length).toFixed(1)
  } : null

  // 5. Claude assessment (Haiku)
  let assessment = ''
  if (apiKey && analyzedTracks.length) {
    const chartSummary = analyzedTracks.map(t =>
      `${t.artist} — ${t.title}: ${t.bpm ? Math.round(t.bpm) + 'bpm' : '?'} ${t.key || ''} ${t.scale || ''} nrg ${t.energy || '?'} dnc ${t.danceability || '?'} ${t.loudness_lufs || '?'}LUFS`
    ).join('\n')
    const refSummary = refAvg
      ? `Remo's references avg: ${refAvg.bpm}bpm · nrg ${refAvg.energy} · dnc ${refAvg.danceability} · ${refAvg.loudness}LUFS`
      : 'No reference data available'
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{ role: 'user', content:
            `These ${analyzedTracks.length} tracks are currently the most viral globally:\n${chartSummary}\n\n${refSummary}\n\nWhat do these viral tracks have in common? What does Remo need to close the gap? Keep response under 150 words. End with one specific action.\nFORMATTING: Never use **bold** or *italic* markdown. Use [GAP]/[OK] for emphasis. Plain text and - bullets only.`
          }]
        })
      })
      const aiData = await aiRes.json()
      assessment = aiData.content?.[0]?.text || ''
      if (aiData.usage) fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
        method: 'POST', headers: { ...sbHeaders },
        body: JSON.stringify({ endpoint: 'agent-chart-analysis', model: 'claude-haiku-4-5-20251001', input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, cost_usd: (aiData.usage.input_tokens * 0.000001) + (aiData.usage.output_tokens * 0.000005) })
      }).catch(() => {})
    } catch(e) { console.warn('Chart analysis Claude call failed:', e.message) }
  }

  // 6. Save key insight from chart assessment to brain_knowledge
  if (assessment) {
    const today = new Date().toISOString().slice(0, 10)
    setImmediate(async () => {
      try {
        const insight = await extractInsight(assessment, apiKey)
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            category: 'market_knowledge',
            title: `Charts ${today} — ${insight.slice(0, 60)}`,
            content: insight,
            entry_type_v2: 'observation',
            confidence: 'medium',
            source_type: 'chart_agent',
            active: true
          })
        })
        saveBrainFile({ category: 'market_knowledge', title: `Charts ${today}`, content: insight, confidence: 'medium', source_type: 'chart_agent' }).catch(() => {})
      } catch(e) { console.warn('chart brain save error:', e.message) }
    })
  }

  // Save to inbox (delete today's first, then insert fresh with structured tracks)
  if (assessment) {
    const today = new Date().toISOString().slice(0, 10)
    const structuredTracks = analyzedTracks.map(t => ({
      title: t.title, artist: t.artist, spotify_id: t.spotify_id,
      spotify_url: t.spotify_id ? `https://open.spotify.com/track/${t.spotify_id}` : null,
      bpm: t.bpm, key: t.key, scale: t.scale, camelot: t.camelot,
      energy: t.energy, source: 'spotify_chart'
    }))
    const tracksJson = structuredTracks.length ? `\n<!--TRACKS:${JSON.stringify(structuredTracks)}-->` : ''
    await deleteInboxToday('Chart Analysis')
    await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
      method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        type: 'briefing', song_code: null, song_title: 'Chart Analysis', artist: null,
        message: assessment + tracksJson, patch_name: `Charts ${today}`, read: false
      })
    })
  }

  console.log(`✓ chart-analysis: ${analyzedTracks.length} tracks stored, assessment saved`)
  return { ok: true, chart_source: 'spotify_top_2026', tracks: analyzedTracks, assessment }
}

// ── Shared brain context fetch ────────────────────────────────────────────
async function fetchSharedBrainContext() {
  return fetch(
    `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true`
    + `&select=category,title,content&order=created_at.desc&limit=10`,
    { headers: sbHeaders }
  ).then(r => r.json()).catch(() => [])
}

// ── Agent: Scout — real market intelligence + AI analysis ─────────────────

const MUSIC_SOURCES = [
  { name: 'A&R Factory',        url: 'https://www.anrfactory.com/feed/',                    type: 'rss' },
  { name: 'Pitchfork Best New', url: 'https://pitchfork.com/reviews/best/tracks/feed/rss',  type: 'rss' },
  { name: 'NME',                url: 'https://www.nme.com/news/music/feed',                 type: 'rss' },
  { name: 'Consequence',        url: 'https://consequence.net/feed/',                       type: 'rss' },
  { name: 'The Guardian Music',  url: 'https://www.theguardian.com/music/rss',               type: 'rss' },
  { name: 'Earmilk',            url: 'https://earmilk.com/feed/',                           type: 'rss' },
  { name: 'Uproxx Music',        url: 'https://uproxx.com/music/feed/',                      type: 'rss' },
  { name: 'Bedroom Producers',  url: 'https://bedroomproducersblog.com/feed/',               type: 'rss' }
]

const GEAR_SOURCES = [
  { name: 'Bedroom Producers Blog', url: 'https://bedroomproducersblog.com/feed/' },
  { name: 'CDM Create Digital Music', url: 'https://cdm.link/feed/' }
]

async function fetchGearNewsItems() {
  const results = await Promise.allSettled(
    GEAR_SOURCES.map(async src => {
      const items = await fetchRssWithBody(src.url, 3)
      return items
        .filter(i => i.title && i.title.length > 10 && i.url && i.url.startsWith('http'))
        .map(i => ({ ...i, source: src.name }))
    })
  )
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  console.log(`  Gear news: ${items.length} items from ${GEAR_SOURCES.length} sources`)
  return items
}

async function fetchMusicPressItems() {
  const results = await Promise.allSettled(
    MUSIC_SOURCES.map(async src => {
      const items = await fetchRssWithBody(src.url, 2)
      return items
        .filter(i => i.title && i.title.length > 15 && i.url && i.url.startsWith('http'))
        .map(i => ({ ...i, source: src.name }))
    })
  )
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}

async function fetchRssTitles(url, count = 5) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentumBot/1.0)' } })
    if (!res.ok) return []
    const text = await res.text()
    // JSON feed (Pitchfork)
    if (url.endsWith('.json') || text.trimStart().startsWith('{')) {
      const data = JSON.parse(text)
      const items = data.items || data.feed?.items || []
      return items.slice(0, count).map(i => i.title || i.headline).filter(Boolean)
    }
    // XML feed — extract <title> tags, skip the first (channel title)
    const matches = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gs)]
    return matches.slice(1, count + 1).map(m => m[1].trim()).filter(Boolean)
  } catch(e) {
    console.warn('RSS fetch failed:', url, e.message)
    return []
  }
}

async function fetchRssWithBody(url, count = 3) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentumBot/1.0)' } })
    if (!res.ok) return []
    const text = await res.text()
    let items = []
    if (url.endsWith('.json') || text.trimStart().startsWith('{')) {
      const data = JSON.parse(text)
      const feedItems = data.items || data.feed?.items || []
      items = feedItems.slice(0, count).map(i => ({
        title: i.title || i.headline || '',
        url: i.url || i.link || '',
        pubDate: i.date_published || i.date_modified || i.pubDate || null
      }))
    } else {
      const titleMatches = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gs)]
      const linkMatches = [...text.matchAll(/<link>([^<]+)<\/link>/gs)]
      const pubDateMatches = [...text.matchAll(/<pubDate>([^<]+)<\/pubDate>/gs)]
      const titles = titleMatches.slice(1).map(m => m[1].trim())
      const links = linkMatches.slice(1).map(m => m[1].trim())
      const pubDates = pubDateMatches.map(m => m[1].trim())
      items = titles.slice(0, count).map((t, i) => ({
        title: t,
        url: links[i] || '',
        pubDate: pubDates[i] || null
      }))
    }
    const withBodies = await Promise.allSettled(items.map(async item => {
      if (!item.url) return item
      try {
        const artRes = await fetch(item.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentumBot/1.0)' },
          signal: AbortSignal.timeout(5000)
        })
        if (!artRes.ok) return item
        const html = await artRes.text()
        const pTags = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)]
        const body = pTags.map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(s => s.length > 30).slice(0, 3).join(' ').slice(0, 400)
        return { ...item, body }
      } catch { return item }
    }))
    return withBodies.map(r => r.status === 'fulfilled' ? r.value : { title: '', url: '' })
  } catch(e) {
    console.warn('RSS+body fetch failed:', url, e.message)
    return []
  }
}

async function fetchKworbTrending() {
  try {
    const res = await fetch('https://kworb.net/youtube/trending.html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MomentumBot/1.0)' }
    })
    if (!res.ok) return []
    const html = await res.text()
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    const items = []
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      const text = cells.map(c => c[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean)
      if (text.length >= 2 && !/^(pos|#|rank)/i.test(text[0])) {
        items.push(text.slice(0, 3).join(' · '))
        if (items.length >= 10) break
      }
    }
    return items
  } catch(e) {
    console.warn('kworb YouTube trending failed:', e.message)
    return []
  }
}

async function fetchKworbSpotify() {
  try {
    const res = await fetch(
      'https://kworb.net/spotify/country/global_daily.html',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return []
    const html = await res.text()
    const results = []
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let match
    while ((match = rowRegex.exec(html)) !== null) {
      const cells = []
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi
      let cell
      while ((cell = cellRegex.exec(match[1])) !== null) {
        cells.push(cell[1].replace(/<[^>]+>/g, '').trim())
      }
      // Columns: [0]=pos [1]=change [2]=artist - title [3]=days [4]=? [5]=(xN) [6]=streams
      if (cells.length < 7) continue
      const pos = parseInt(cells[0])
      if (isNaN(pos)) continue
      const artistTitle = cells[2] || ''
      const dashIdx = artistTitle.indexOf(' - ')
      const artist = dashIdx >= 0 ? artistTitle.slice(0, dashIdx).trim() : artistTitle
      const title = dashIdx >= 0 ? artistTitle.slice(dashIdx + 3).trim() : ''
      results.push({ position: pos, artist, title, streams: cells[6] || '', source: 'kworb_spotify_global' })
    }
    return results.slice(0, 10)
  } catch(e) {
    console.warn('kworb Spotify global failed:', e.message)
    return []
  }
}

async function extractTracksFromText(text, apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: 'Extract all song/track mentions from text. Return a JSON array only, no other text: [{"artist":"","title":""}]. If no tracks found return [].',
        messages: [{ role: 'user', content: text }]
      })
    })
    const d = await res.json()
    const raw = (d.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
    if (!raw || raw === '[]') return []
    // Extract JSON array even if surrounded by extra text
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) { console.warn('extractTracksFromText: no JSON array found in response'); return [] }
    return JSON.parse(match[0])
  } catch(e) {
    console.error('extractTracksFromText error:', e.message)
    return []
  }
}

// ── importSpotifyPlaylist — import all tracks from a playlist URL ─────────
async function importSpotifyPlaylist(playlistUrl, genreTag) {
  const token = spotifyUserToken || await getSpotifyToken()
  console.log('importSpotifyPlaylist: using token type:', spotifyUserToken ? 'USER_OAUTH' : 'CLIENT_CREDS')

  const playlistId = playlistUrl.split('/playlist/')[1]?.split('?')[0]
  if (!playlistId) throw new Error('invalid playlist URL')
  console.log('importSpotifyPlaylist: playlist id:', playlistId)

  // Fetch playlist name first
  const plInfoRes = await fetch(
    'https://api.spotify.com/v1/playlists/' + playlistId,
    { headers: { 'Authorization': 'Bearer ' + token } }
  )
  const plInfoData = await plInfoRes.json()
  const playlistName = plInfoData.name || 'Imported Playlist'

  // Fetch all tracks (paginated) — no fields filter to avoid 403
  let tracks = []
  let url = 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks?limit=50'
  while (url) {
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    console.log('importSpotifyPlaylist: response status:', r.status)
    if (r.status === 403) {
      const body = await r.text()
      console.error('importSpotifyPlaylist: 403 body:', body)
      throw new Error('403 Forbidden: ' + body)
    }
    const d = await r.json()
    console.log('importSpotifyPlaylist: tracks received:', d.items?.length, 'next:', !!d.next)
    tracks.push(...(d.items || []).map(i => i.track).filter(Boolean))
    url = d.next || null
  }

  let saved = 0
  let skipped = 0

  for (const track of tracks) {
    if (!track?.id) continue

    const { data: existing } = await supabase.from('reference_tracks').select('id').eq('spotify_id', track.id).maybeSingle()
    if (existing) { skipped++; continue }

    const artistId = track.artists?.[0]?.id
    let genres = []
    if (artistId) {
      try {
        const ar = await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`)
        const ad = await ar.json()
        genres = ad.genres || []
      } catch(e) {}
      await new Promise(r => setTimeout(r, 200))
    }

    const { error: insErr } = await supabase.from('reference_tracks').insert({
      spotify_id: track.id,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      source: 'agent',
      collection_name: 'playlist_import',
      playlist_name: playlistName,
      genres: genres.length ? genres : (genreTag ? [genreTag] : []),
      genre_tag: genreTag || genres[0] || null,
      popularity: track.popularity || null,
      approved: true
    })
    if (insErr) console.error('playlist import insert error:', track.name, insErr.message)
    else saved++

    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Playlist import: ${playlistName} — saved: ${saved}, skipped: ${skipped}`)
  return { saved, skipped, playlist: playlistName, total: tracks.length }
}

// ── importAllUserPlaylists — import all user playlists via /me/playlists ──
async function importAllUserPlaylists() {
  if (!spotifyUserToken) throw new Error('User OAuth token required — authorize via /spotify-auth')
  const token = spotifyUserToken

  // Fetch all user playlists
  let playlists = []
  let url = 'https://api.spotify.com/v1/me/playlists?limit=50'
  while (url) {
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    if (!r.ok) throw new Error('Failed to fetch user playlists: ' + r.status)
    const d = await r.json()
    playlists.push(...(d.items || []))
    url = d.next || null
  }
  console.log('Found', playlists.length, 'user playlists')

  // Per-session artist genre cache to avoid redundant API calls
  const artistGenreCache = {}

  let totalSaved = 0
  let totalSkipped = 0

  for (const playlist of playlists) {
    // Derive genre tag from playlist name (the user's own label)
    const genreTag = playlist.name.toLowerCase().trim()

    // Use items.href from the playlist object (Spotify returns {href, total} under 'items', not 'tracks')
    // Both /playlists/{id}/items and /playlists/{id}/tracks return 403 — requires Spotify Extended Access
    const tracksHref = playlist.items?.href || playlist.tracks?.href
    if (!tracksHref) { console.warn('Skip playlist (no href):', playlist.name); continue }

    let tracksUrl = tracksHref + (tracksHref.includes('?') ? '&' : '?') + 'limit=50'
    while (tracksUrl) {
      const tr = await fetch(tracksUrl, { headers: { 'Authorization': 'Bearer ' + token } })
      if (!tr.ok) {
        console.log('Skip playlist', playlist.name, 'status:', tr.status)
        break
      }
      const td = await tr.json()
      // /items endpoint uses i.item (not i.track like /tracks endpoint)
      const tracks = (td.items || []).map(i => i.item || i.track).filter(t => t?.id)

      for (const track of tracks) {
        const { data: existing } = await supabase
          .from('reference_tracks').select('id').eq('spotify_id', track.id).maybeSingle()
        if (existing) { totalSkipped++; continue }

        // Artist genres — cached per session
        const artistId = track.artists?.[0]?.id
        let artistGenres = []
        if (artistId) {
          if (artistGenreCache[artistId]) {
            artistGenres = artistGenreCache[artistId]
          } else {
            try {
              const ar = await fetch(
                `https://api.spotify.com/v1/artists/${artistId}`,
                { headers: { 'Authorization': 'Bearer ' + token } }
              )
              if (ar.ok) {
                const ad = await ar.json()
                artistGenres = ad.genres || []
                artistGenreCache[artistId] = artistGenres
              }
            } catch(e) {}
            await new Promise(r => setTimeout(r, 150))
          }
        }

        const { error: insErr } = await supabase.from('reference_tracks').insert({
          spotify_id: track.id,
          title: track.name,
          artist: track.artists?.map(a => a.name).join(', '),
          source: 'agent',
          collection_name: 'playlist_import',
          playlist_name: playlist.name,
          genres: artistGenres.length ? artistGenres : [genreTag],
          genre_tag: genreTag,
          popularity: track.popularity || null,
          approved: true
        })
        if (insErr) console.error('insert error:', track.name, insErr.message)
        else totalSaved++
        await new Promise(r => setTimeout(r, 200))
      }

      tracksUrl = td.next || null
    }

    console.log('✓', playlist.name, '— running total:', totalSaved, 'saved')
    await new Promise(r => setTimeout(r, 500))
  }

  return { saved: totalSaved, skipped: totalSkipped, playlists: playlists.length }
}

async function runAgentScout(apiKey, sharedBrainRows) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  // Fetch all data sources in parallel
  const [connectionsRes, refTracksRes, watchedRes, spToken, pitchfork, factmag, hypebot, kworbYT, kworbSP, pressItems, gearThreads] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/connections?select=name`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?order=tempo.desc&limit=5&select=title,artist,genre_tags,tempo,key`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/watched_artists?active=eq.true&select=*`, { headers: sbHeaders }),
    (spotifyUserToken ? Promise.resolve(spotifyUserToken) : getSpotifyToken().catch(() => null)),
    fetchRssWithBody('https://pitchfork.com/rss/news/feed.json', 3),
    fetchRssWithBody('https://www.factmag.com/feed/', 3),
    fetchRssWithBody('https://www.hypebot.com/feed', 3),
    fetchKworbTrending(),
    fetchKworbSpotify(),
    fetchMusicPressItems(),
    fetchGearNewsItems(),
  ])

  const [connections, refTracks, watchedArtists] = await Promise.all([
    connectionsRes.json(), refTracksRes.json(), watchedRes.json()
  ])

  const crossChartData = await getCrossChartTopics()
  const crossChartBlock = crossChartData.crossChart.length
    ? 'PEAK MOMENTUM (on both TikTok + Spotify):\n' + crossChartData.crossChart.slice(0, 5).map((t, i) => `${i+1}. ${t.artist} — ${t.title}`).join('\n')
    : ''
  const tiktokOnlyBlock = crossChartData.tiktokOnly.length
    ? 'EMERGING (TikTok only — not yet on Spotify chart):\n' + crossChartData.tiktokOnly.slice(0, 5).map((t, i) => `${i+1}. ${t.artist} — ${t.title}`).join('\n')
    : ''

  // Spotify new releases DE
  let newReleasesText = ''
  try {
    const relRes = await spotifyFetch('https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE')
    if (relRes.ok) {
      const relData = await relRes.json()
      const albums = relData.albums?.items || []
      newReleasesText = albums.map(a => `- ${a.artists.map(x=>x.name).join(', ')} — ${a.name} (${a.release_date})`).join('\n')
    }
  } catch(e) { console.warn('Spotify new-releases failed:', e.message) }

  // Watched artists — flag any released in last 7 days
  let watchedNewText = ''
  if (Array.isArray(watchedArtists) && watchedArtists.length) {
    const watchedChecks = await Promise.allSettled(
      watchedArtists.map(async a => {
        const r = await spotifyFetch(`https://api.spotify.com/v1/artists/${a.spotify_id}/albums?include_groups=single,album&limit=1`)
        const d = await r.json()
        const latest = d.items?.[0]
        if (latest && latest.release_date >= sevenDaysAgo) {
          return `- ${a.name}: "${latest.name}" (${latest.release_date}) — NEW THIS WEEK`
        }
        return null
      })
    )
    const newThisWeek = watchedChecks.map(r => r.value).filter(Boolean)
    watchedNewText = newThisWeek.length ? newThisWeek.join('\n') : '- No new releases from watched artists this week'
  }

  // Build RSS headlines block with article snippets
  const formatRss = (items, label) => items
    .filter(i => i.title)
    .map(i => `[${label}] ${i.title}${i.body ? `\n  "${i.body.slice(0, 200)}"` : ''}`)
    .join('\n')
  const rssLines = [
    formatRss(pitchfork, 'Pitchfork'),
    formatRss(factmag, 'FACT'),
    formatRss(hypebot, 'Hypebot'),
  ].filter(Boolean).join('\n') || 'No headlines fetched'

  const kworbYTText = kworbYT.length ? kworbYT.map((l, i) => `${i+1}. ${l}`).join('\n') : 'Unavailable'
  const kworbSPText = kworbSP.length
    ? kworbSP.map(t => `${t.position}. ${t.artist} — ${t.title}`).join('\n')
    : 'Unavailable'

  const knownNames = (Array.isArray(connections) ? connections : []).map(b => b.name).filter(Boolean).join(', ') || 'none'
  const brainContext = buildBrainContext(sharedBrainRows)
  const refTrackText = (Array.isArray(refTracks) ? refTracks : [])
    .map(t => `- ${t.artist} — ${t.title} | ${t.tempo || '?'}bpm ${t.key || ''} | genres: ${(t.genre_tags || []).slice(0,3).join(', ')}`)
    .join('\n')

  // Build music press block grouped by source
  const pressBySource = {}
  for (const item of pressItems) {
    if (!pressBySource[item.source]) pressBySource[item.source] = []
    pressBySource[item.source].push(item)
  }
  const pressBlock = Object.entries(pressBySource)
    .map(([src, items]) => `${src.toUpperCase()}:\n` + items.map(i => `- ${i.title}${i.body ? `: ${i.body.slice(0, 300)}` : ''} (source: ${src})`).join('\n'))
    .join('\n\n') || 'No press fetched'

  const sourcesUsed = ['spotify_new_releases', 'pitchfork', 'factmag', 'hypebot', 'kworb_youtube', 'kworb_spotify', 'watched_artists', 'gear_news', ...MUSIC_SOURCES.map(s => s.name)]

  const gearBlock = gearThreads.length
    ? gearThreads.map((t, i) => `${i+1}. ${t.title}`).join('\n')
    : 'Unavailable'

  const prompt = `Here is this week's REAL music data — do not invent anything outside this data:

NEW RELEASES ON SPOTIFY:
${newReleasesText || 'Unavailable'}

KWORB — YouTube Trending (global):
${kworbYTText}

KWORB — Spotify Global Daily Chart:
${kworbSPText}

INDUSTRY HEADLINES THIS WEEK (with article snippets):
${rssLines}

## MUSIC PRESS (today)
${pressBlock}

WATCHED ARTISTS — NEW RELEASES:
${watchedNewText || 'none this week'}

## TECH — NEW GEAR & PLUGINS (top 5)
${gearBlock}

${crossChartBlock ? crossChartBlock + '\n\n' : ''}${tiktokOnlyBlock ? tiktokOnlyBlock + '\n\n' : ''}${refTrackText ? `REFERENCE TRACKS (Remo's taste):\n${refTrackText}\n` : ''}Already known — skip: ${knownNames}
${brainContext ? `\n[BACKGROUND — read silently, do not reproduce]\n${brainContext}\n[END BACKGROUND]\n` : ''}
Based ONLY on the above real data, write one complete scout report with these sections in this exact order:

## BREAKING ARTISTS
- Name artists actually gaining momentum in new releases or chart data
- Only reference real tracks listed above
- [CROSS-CHART SIGNAL]: Artists in PEAK MOMENTUM section confirmed on both platforms — prioritize these

## TRENDING SOUNDS
- Sonic and production patterns visible across Spotify chart + YouTube trending + new releases
- Note sounds from EMERGING section not yet mainstream
- Link to genres: ${SUB_GENRE_LABELS}

## NEW RELEASES
- Relevant new releases from artists in Remo's network or genre space
- Flag anything from watched artists

## OPPORTUNITIES
- Collaboration or submission windows based on real data vs Remo's sound
- Timing gaps where Remo's style fits current demand

## INDUSTRY / EDITORIAL
- Editorial push or playlist strategy insights from headlines
- Industry news that directly affects production or releases

## TECH & TOOLS
- New gear from BPB/CDM relevant to mixing, recording, plugins, hardware
- Keep to 3-4 bullets — omit section if no gear data

## PRESS
- One-line summaries of each press article at the bottom

If data is insufficient to make a claim, say so explicitly. Never invent follower counts, statistics, or trends not in the data.
FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK] for emphasis. Plain text only.`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
  })
  const claudeData = await claudeRes.json()
  const scoutText = claudeData.content?.[0]?.text || 'No suggestions generated.'

  const model = 'claude-haiku-4-5-20251001'
  const usage = claudeData.usage || {}
  const { error: usageErr } = await supabase.from('api_usage').insert({
    endpoint: '/agent-scout', model,
    input_tokens: usage.input_tokens||0,
    output_tokens: usage.output_tokens||0,
    cost_usd: ((usage.input_tokens||0)*0.000001)+((usage.output_tokens||0)*0.000005)
  })
  if (usageErr) console.error('scout usage insert error:', usageErr.message)

  // Save key insight from scout to brain_knowledge
  setImmediate(async () => {
    try {
      const insight = await extractInsight(scoutText, apiKey)
      const { error: brainErr } = await supabase.from('brain_knowledge').insert({
        category: 'market_knowledge',
        title: `Scout ${today} — ${insight.slice(0, 60)}`,
        content: insight,
        entry_type_v2: 'observation',
        confidence: 'medium',
        source_type: 'scout_agent',
        active: true,
        metadata: { date: today }
      })
      if (brainErr) console.error('scout brain insert error:', brainErr.message)
      await saveBrainFile({ category: 'market_knowledge', title: `Scout ${today}`, content: insight, confidence: 'medium', source_type: 'scout_agent' })
    } catch(e) { console.warn('scout brain save error:', e.message) }
  })

  // Save press articles to inbox as type='press' (top 1 per source, max 5)
  const pressToSave = Object.values(
    pressItems.reduce((acc, item) => {
      if (!acc[item.source]) acc[item.source] = item
      return acc
    }, {})
  ).slice(0, 5)
  for (const item of pressToSave) {
    const { error: pressErr } = await supabase.from('inbox_notifications').insert({
      type: 'press',
      song_code: null,
      song_title: (item.title || '').slice(0, 120),
      artist: null,
      message: (item.body || '').slice(0, 300),
      patch_name: item.source,
      read: false,
      metadata: { url: item.url, source: item.source }
    })
    if (pressErr) console.error('scout press insert error:', pressErr.message)
  }

  // Save Gear news items to brain_knowledge (deduplicated by title)
  if (gearThreads.length) {
    const { data: existingGear, error: gearFetchErr } = await supabase
      .from('brain_knowledge').select('title').eq('source_type', 'gear_news')
    if (gearFetchErr) console.error('scout gear fetch error:', gearFetchErr.message)
    const existingTitles = new Set((existingGear || []).map(r => r.title))
    for (const t of gearThreads) {
      const brainTitle = 'GEAR: ' + t.title
      if (existingTitles.has(brainTitle)) continue
      const { error: gearErr } = await supabase.from('brain_knowledge').insert({
        category: 'sound_design',
        title: brainTitle,
        content: t.title + ' (Gear News (BPB + CDM))',
        entry_type_v2: 'observation',
        source_type: 'gear_news',
        confidence: 'weak',
        active: true
      })
      if (gearErr) console.error('scout gear insert error:', brainTitle, gearErr.message)
    }
  }

  // Save chart positions for trend velocity (BUILD 3) — silent, don't block briefing
  if (Array.isArray(kworbSP) && kworbSP.length) {
    const today = new Date().toISOString().slice(0,10)
    const histRows = kworbSP.slice(0,50).map(t => ({ title: t.title, artist: t.artist, position: t.position, chart_date: today, source: 'kworb' }))
    const { error: histErr } = await supabaseAdmin.from('chart_history').upsert(histRows, { onConflict: 'title,artist,chart_date', ignoreDuplicates: true })
    if (histErr) console.error('chart_history upsert error:', histErr.message)
  }

  // Encode kworb tracks as structured data in inbox message
  const kworbTracks = (Array.isArray(kworbSP) ? kworbSP : []).slice(0, 10).map(t => ({
    title: t.title, artist: t.artist,
    youtube_url: `https://www.youtube.com/results?search_query=${encodeURIComponent((t.artist || '') + ' ' + (t.title || ''))}`,
    spotify_url: `https://open.spotify.com/search/${encodeURIComponent((t.artist || '') + ' ' + (t.title || ''))}`,
    source: 'spotify_global'
  }))
  const kworbYTTracks = (Array.isArray(kworbYT) ? kworbYT : []).slice(0, 5).map(line => {
    const parts = line.split(' · ')
    return { title: parts[1] || line, artist: parts[0] || '', youtube_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(line)}`, source: 'youtube_trending' }
  })
  const allTracks = [...kworbTracks, ...kworbYTTracks].slice(0, 10)
  const tracksJson = allTracks.length ? `\n<!--TRACKS:${JSON.stringify(allTracks)}-->` : ''

  await deleteInboxToday('Artist Scout')
  await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ type: 'scout', song_code: null, song_title: 'Artist Scout', artist: null, message: scoutText + tracksJson, patch_name: `Scout ${today}`, read: false })
  })
  console.log('✓ Agent Scout report saved to inbox + brain_knowledge')

  return { ok: true, suggestions: scoutText, tracks: allTracks }
}

// ── Agent: Demo Match — match demos to artists ────────────────────────────
async function runAgentDemoMatch(apiKey, sharedBrainRows) {
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const [sessionsRes, connectionsRes, refTracksRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/share_sessions?select=song_title,song_code,genre,bpm,key,created_at&type=eq.demo&created_at=gte.${ago30}&order=created_at.desc&limit=50`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/connections?select=name,genre,group_types,notes,status`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?order=energy.desc&limit=5&select=title,artist,genre_tags,tempo,energy,danceability,valence`, { headers: sbHeaders })
  ])
  const [sessions, connections, refTracks] = await Promise.all([sessionsRes.json(), connectionsRes.json(), refTracksRes.json()])

  const demoList = (Array.isArray(sessions) ? sessions : [])
    .map(s => `"${s.song_title || s.song_code || 'Untitled'}" (genre: ${s.genre || '?'}, bpm: ${s.bpm || '?'}, key: ${s.key || '?'})`)

  const artistList = (Array.isArray(connections) ? connections : [])
    .filter(b => b.status !== 'inactive')
    .map(b => `${b.name} (${(b.group_types||[])[0] || 'contact'}, genre: ${b.genre || '?'}${b.notes ? ', notes: ' + b.notes.slice(0, 80) : ''})`)

  if (!demoList.length) return { ok: true, matches: 'No demo sessions found in the last 30 days.' }

  const brainContext = buildBrainContext(sharedBrainRows)
  const refTrackText = (Array.isArray(refTracks) ? refTracks : [])
    .map(t => `- ${t.artist} — ${t.title} | ${Math.round(t.tempo || 0)}bpm | energy ${t.energy?.toFixed(2) || '?'} | genres: ${(t.genre_tags || []).slice(0,3).join(', ')}`)
    .join('\n')

  const context = [
    `DEMOS (last 30 days, ${demoList.length} total):`,
    demoList.slice(0, 20).join('\n'), '',
    `ARTISTS (${artistList.length} active):`,
    artistList.slice(0, 20).join('\n') || 'none',
    brainContext ? `\n[BACKGROUND — read silently, do not reproduce]\n${brainContext}\n[END BACKGROUND]` : '',
    refTrackText ? `\nREFERENCE TRACKS:\n${refTrackText}` : '',
  ].filter(Boolean).join('\n')

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: `You are a demo pitch specialist for a music producer. Match recent demos to artists and generate pitch recommendations.

FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK] for emphasis. Plain text only.
- Use ## for section headers
- One blank line between sections
- Bullet points for lists, max 2 lines per bullet
- Numbers for ranked items
- End with a ## Next Move section: single most important action today
Keep each section tight — no filler sentences.

Sections to include:
## Best Fits
## Reach Out Now
## Skip
## Next Move

Genres: ${SUB_GENRE_LABELS}

${context}` }] })
  })
  const claudeData = await claudeRes.json()
  const matchText = claudeData.content?.[0]?.text || 'No matches generated.'

  const model = 'claude-haiku-4-5-20251001'
  const usage = claudeData.usage || {}
  fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ endpoint: '/agent-demo-match', model, input_tokens: usage.input_tokens||0, output_tokens: usage.output_tokens||0, cost_usd: ((usage.input_tokens||0)*0.000001)+((usage.output_tokens||0)*0.000005) })
  }).catch(() => {})

  await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ type: 'briefing', song_code: null, song_title: 'Demo Match', artist: null, message: matchText, patch_name: `Demo Match ${new Date().toISOString().slice(0,10)}`, read: false })
  })
  console.log('✓ Agent Demo Match saved to inbox')
  return { ok: true, matches: matchText }
}

// ── Agent: TikTok Trends — surface viral sounds aligned to taste profile ──
async function fetchTikTokRealData() {
  try {
    const r = await fetch('https://tikcharts.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'text/html'
      }
    })
    const html = await r.text()

    // Extract __NEXT_DATA__ JSON (Next.js embeds all page data here)
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!match) {
      console.warn('tikcharts: __NEXT_DATA__ not found')
      return []
    }

    const nextData = JSON.parse(match[1])

    // Navigate to chart entries
    const entriesByWeek = nextData?.props?.pageProps?.entriesByWeek
    if (!entriesByWeek) return []

    // Get the latest week (first key)
    const latestWeek = Object.keys(entriesByWeek)[0]
    const entries = entriesByWeek[latestWeek] || []

    console.log('tikcharts: found', entries.length, 'tracks for week', latestWeek)

    // Map to standard format
    return entries.slice(0, 20).map(e => ({
      position: e.rank,
      title: e.title,
      artist: e.artist,
      youtube_id: e.youtube_id,
      tiktok_slug: e.tiktok_slug,
      image_url: e.image_url,
      source: 'tikcharts',
      week: latestWeek
    }))

  } catch(e) {
    console.error('tikcharts error:', e.message)
    return []
  }
}

async function saveToCheckout(track) {
  if (!track.title || !track.artist) return false
  const { data: existing } = await supabase
    .from('reference_tracks')
    .select('id')
    .ilike('title', track.title.trim())
    .ilike('artist', track.artist.trim())
    .maybeSingle()
  if (existing) {
    console.log('skip duplicate:', track.artist, '—', track.title)
    return false
  }
  const row = {
    title: track.title.trim(),
    artist: track.artist.trim(),
    source: 'checkout',
    checkout_date: new Date().toISOString(),
    collection_name: track.collection_name || 'scout',
  }
  if (track.approved != null) row.approved = track.approved
  if (track.spotify_id)        row.spotify_id = track.spotify_id
  if (track.tempo || track.bpm) row.tempo = track.tempo || track.bpm
  if (track.key)               row.key = track.key
  if (track.scale)             row.scale = track.scale
  if (track.camelot)           row.camelot = track.camelot
  if (track.energy != null)    row.energy = track.energy
  if (track.danceability != null) row.danceability = track.danceability
  if (track.loudness != null)  row.loudness = track.loudness
  if (track.valence != null)   row.valence = track.valence
  if (track.brightness != null) row.brightness = track.brightness
  if (track.popularity != null) row.popularity = track.popularity
  if (track.artist_popularity != null) row.artist_popularity = track.artist_popularity
  if (track.artist_followers != null)  row.artist_followers = track.artist_followers
  if (track.preview_url)       row.preview_url = track.preview_url
  if (track.album_art)         row.album_art = track.album_art
  if (track.album)             row.album = track.album
  if (track.release_date)      row.release_date = track.release_date
  if (track.genre_tags)        row.genre_tags = track.genre_tags
  const { error } = await supabase.from('reference_tracks').insert(row)
  if (error) { console.error('saveToCheckout error:', track.title, error.message); return false }
  console.log('✓ checkout:', track.artist, '—', track.title)
  return true
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Background library track processing queue ─────────────────────────────
const ESSENTIA_PY = '/opt/homebrew/bin/python3.11'
const ANALYZE_AUDIO_SCRIPT = path.join(__dirname, 'analyze_audio.py')
const ANALYZE_EQ_SCRIPT = path.join(__dirname, 'analyze_vocal_eq.py')
let processingQueue = []
let isProcessing = false
let spotifyRateLimitUntil = 0

// ── Tier 1: fast analysis — Spotify + Essentia + tonal/stereo + Genius credits ─
async function processLibraryTrackInBackground(refTrack) {
  try {
    if (spotifyRateLimitUntil && Date.now() < spotifyRateLimitUntil) {
      console.log('bg: Spotify rate limited, skipping')
      return
    }

    // Skip if already analysed (tempo is the Tier 1 completion signal)
    if (refTrack.tempo != null) { console.log('bg: skip processed:', refTrack.artist, '—', refTrack.title); return }

    console.log('bg: processing:', refTrack.artist, '—', refTrack.title)

    // Step 1: Spotify — preview URL + genres
    let previewUrl = refTrack.preview_url || null
    if (refTrack.spotify_id) {
      try {
        const sr = await spotifyFetch('https://api.spotify.com/v1/tracks/' + refTrack.spotify_id)
        if (!sr.ok) { console.warn('bg: Spotify track fetch failed:', sr.status, refTrack.title); return }
        const sd = await sr.json()
        if (!previewUrl) {
          previewUrl = sd?.preview_url || null
          if (previewUrl) {
            const { error: pvErr } = await supabase.from('reference_tracks').update({ preview_url: previewUrl }).eq('id', refTrack.id)
            if (pvErr) console.error('bg: preview_url update failed:', refTrack.title, pvErr.message)
          }
        }
        if (!refTrack.genres?.length) {
          const genres = await fetchTrackGenres(refTrack.spotify_id)
          if (genres.length) {
            const { error: gnErr } = await supabase.from('reference_tracks').update({ genres }).eq('id', refTrack.id)
            if (gnErr) console.error('bg: genres update failed:', refTrack.title, gnErr.message)
            else console.log('bg: ✓ genres for:', refTrack.title, genres.slice(0, 3).join(', '))
          }
        }
      } catch(e) { console.warn('bg: spotify fetch failed:', e.message) }
    }
    if (!previewUrl) { console.log('bg: no preview URL for:', refTrack.title); return }

    // Step 2: Download 30s preview
    const tmpFile = '/tmp/ref_bg_' + refTrack.id + '_' + Date.now() + '.mp3'
    const dlRes = await fetch(previewUrl)
    if (!dlRes.ok) throw new Error('preview download failed: ' + dlRes.status)
    fs.writeFileSync(tmpFile, Buffer.from(await dlRes.arrayBuffer()))

    // Step 3: Essentia — BPM, key, energy, tonal balance, stereo width
    try {
      const esOut = execSync(`"${ESSENTIA_PY}" "${ANALYZE_AUDIO_SCRIPT}" ${shellEscape(tmpFile)} 2>/dev/null`, { encoding: 'utf8', timeout: 120000 }).trim()
      const es = JSON.parse(esOut)
      if (es.bpm) {
        const upd = {}
        if (es.bpm)              upd.tempo               = es.bpm
        if (es.key)              upd.key                 = es.key
        if (es.camelot)          upd.camelot             = es.camelot
        if (es.energy != null)   upd.energy              = es.energy
        if (es.danceability != null) upd.danceability    = es.danceability
        if (es.loudness_lufs != null) upd.loudness       = es.loudness_lufs
        if (es.valence != null)  upd.valence             = es.valence
        if (es.brightness != null) upd.brightness        = es.brightness
        if (es.bass_energy != null) upd.bass_energy      = es.bass_energy
        if (es.stereo_width != null) upd.stereo_width    = es.stereo_width
        if (es.tonal_balance)    upd.tonal_balance       = es.tonal_balance
        if (es.stereo_width_per_band) upd.stereo_width_per_band = es.stereo_width_per_band
        if (es.crest_factor_per_band) upd.crest_factor_per_band = es.crest_factor_per_band
        const { error: esErr } = await supabase.from('reference_tracks').update(upd).eq('id', refTrack.id)
        if (esErr) console.error('bg: Essentia update failed:', refTrack.title, esErr.message)
        else console.log('bg: ✓ Tier1 analysis for:', refTrack.title, Math.round(es.bpm) + 'bpm', es.key || '')
      }
    } catch(e) { console.warn('bg: Essentia failed for:', refTrack.title, e.message.slice(0, 60)) }

    // Step 4: Genius credits
    try {
      const credits = await fetchGeniusCredits(refTrack.artist, refTrack.title)
      if (credits && (credits.producers.length || credits.mixers.length || credits.masterers.length)) {
        const { error: crErr } = await supabase.from('reference_tracks').update({ credits }).eq('id', refTrack.id)
        if (crErr) console.error('bg: credits update failed:', refTrack.title, crErr.message)
        else console.log('bg: ✓ Credits for:', refTrack.title, '| prod:', credits.producers.join(', '))
      }
      await new Promise(r => setTimeout(r, 2000))
    } catch(e) { console.warn('bg: credits failed for:', refTrack.title, e.message.slice(0, 60)) }

    try { fs.unlinkSync(tmpFile) } catch(e) {}
  } catch(e) {
    console.error('bg: processLibraryTrack error:', refTrack?.title, e.message)
  }
}

// ── Tier 2: heavy analysis — Demucs stem EQ (on-demand only) ────────────────
async function runStemAnalysis(refTrack) {
  const previewUrl = refTrack.preview_url
  if (!previewUrl) throw new Error('no preview_url for stem analysis')
  const tmpFile = '/tmp/ref_bg_' + refTrack.id + '_' + Date.now() + '.mp3'
  try {
    const dlRes = await fetch(previewUrl)
    if (!dlRes.ok) throw new Error('preview download failed: ' + dlRes.status)
    fs.writeFileSync(tmpFile, Buffer.from(await dlRes.arrayBuffer()))
    const eqOut = execSync(`"${ESSENTIA_PY}" "${ANALYZE_EQ_SCRIPT}" ${shellEscape(tmpFile)} 2>/dev/null`, { encoding: 'utf8', timeout: 300000 }).trim()
    const eqResult = JSON.parse(eqOut)
    if (eqResult.ok && eqResult.stems) {
      for (const [stemName, curve] of Object.entries(eqResult.stems)) {
        const { error: eqInsErr } = await supabase.from('vocal_eq_curves').insert({
          label: (refTrack.artist || '') + ' — ' + (refTrack.title || '') + ' (' + stemName + ')',
          reference_track_id: String(refTrack.id),
          stem_type: stemName,
          source_type: 'reference',
          curve
        })
        if (eqInsErr) console.error('stem EQ insert failed:', stemName, refTrack.title, eqInsErr.message)
      }
      console.log('✓ Stem EQ curves for:', refTrack.title)
    }
    return eqResult
  } finally {
    try { fs.unlinkSync(tmpFile) } catch(e) {}
    exec('rm -rf /tmp/demucs_* /tmp/stem_eq_* 2>/dev/null')
  }
}

async function fetchTrackGenres(spotifyId) {
  try {
    const trackRes = await spotifyFetch('https://api.spotify.com/v1/tracks/' + spotifyId)
    if (!trackRes.ok) return []
    const track = await trackRes.json()
    const artistId = track.artists?.[0]?.id
    if (!artistId) return []
    const artistRes = await spotifyFetch('https://api.spotify.com/v1/artists/' + artistId)
    if (!artistRes.ok) return []
    const artist = await artistRes.json()
    return artist.genres || []
  } catch(e) { return [] }
}

async function runBackgroundQueue() {
  if (Date.now() < spotifyRateLimitUntil) {
    console.log('bg queue paused — rate limited, retrying in 60s')
    setTimeout(runBackgroundQueue, 60000)
    return
  }
  if (isProcessing || processingQueue.length === 0) return
  isProcessing = true
  const track = processingQueue.shift()
  await processLibraryTrackInBackground(track)
  isProcessing = false
  if (processingQueue.length > 0) setTimeout(runBackgroundQueue, 3000)
}

function queueLibraryTrack(track) {
  if (!processingQueue.find(t => t.id === track.id)) {
    processingQueue.push(track)
    runBackgroundQueue()
  }
}

// Startup: Tier 1 queue — all tracks missing tempo (15s delay to let watcher settle)
setTimeout(async () => {
  try {
    const { data: unanalyzed } = await supabase
      .from('reference_tracks')
      .select('*')
      .in('source', ['agent', 'user'])
      .is('tempo', null)
      .not('spotify_id', 'is', null)
      .limit(500)
    if (!unanalyzed?.length) return
    processingQueue.push(...unanalyzed)
    console.log('bg: Tier1 queue ready —', processingQueue.length, 'tracks to process')
    runBackgroundQueue()
  } catch(e) { console.warn('bg: startup queue error:', e.message) }
}, 15000)

// Startup: enrich library tracks missing genres (45s delay, after EQ queue settles)
setTimeout(async () => {
  try {
    const { data: tracks } = await supabase
      .from('reference_tracks')
      .select('id, spotify_id, artist, title, genres')
      .not('spotify_id', 'is', null)
      .in('source', ['user', 'agent', 'mozart', 'promoted'])
      .order('created_at', { ascending: false }).limit(200)
    const missing = (tracks || []).filter(t => !t.genres?.length)
    if (!missing.length) return
    console.log('bg-genres: enriching', missing.length, 'tracks')
    for (const track of missing) {
      const genres = await fetchTrackGenres(track.spotify_id)
      if (genres.length) {
        const { error: bgGnErr } = await supabase.from('reference_tracks').update({ genres }).eq('id', track.id)
        if (bgGnErr) console.error('bg-genres: update failed:', track.title, bgGnErr.message)
      }
      await new Promise(r => setTimeout(r, 3000))
    }
    console.log('bg-genres: done')
  } catch(e) { console.warn('bg-genres startup error:', e.message) }
}, 45000)

// Startup: ensure genres column exists on reference_tracks
setImmediate(async () => {
  try {
    await supabaseAdmin.rpc('run_sql', { query: 'ALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS genres jsonb' })
    console.log('✓ genres column ready')
  } catch(e) { /* column already exists or rpc unavailable — ignore */ }
})

// Startup + every 6h: system health check with Telegram alert on issues
async function runHealthCheck() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`)
    const h = await r.json()
    if (h.issues?.length) {
      const msg = '⚠️ Momentum health issues:\n' + h.issues.map(i => '• ' + i).join('\n')
      sendTelegram(TELEGRAM_OWNER_ID, msg).catch(() => {})
      console.warn('Health check issues:', h.issues)
    } else {
      console.log(`✓ Health check OK — brain:${h.brain_entries} refs:${h.reference_tracks} songs:${h.songs}`)
    }
  } catch(e) { console.warn('Health check error:', e.message) }
}
setTimeout(() => runHealthCheck().then(() => setInterval(runHealthCheck, 6 * 60 * 60 * 1000)), 30000)

// Startup: rebuild brain master on boot
setTimeout(rebuildBrainMaster, 8000)

async function rebuildBrainMaster() {
  try {
    const { data: entries } = await supabase
      .from('brain_knowledge')
      .select('category, title, content, confidence, created_at, priority')
      .or('source_type.eq.text,confidence.eq.locked')
      .eq('active', true)
      .order('category', { ascending: true })
      .order('created_at', { ascending: false })

    if (!entries?.length) return

    const byCategory = {}
    for (const e of entries) {
      const cat = e.category || 'uncategorized'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(e)
    }

    const lines = [
      '# 🧠 BRAIN DUMP MASTER',
      '> Personal knowledge entries — auto-updated, do not edit.',
      '> Last updated: ' + new Date().toLocaleString('de-CH'),
      '',
      '---',
      ''
    ]

    const priorityEntries = entries.filter(e => e.priority || e.confidence === 'locked')
    if (priorityEntries.length) {
      lines.push('## ⚡ LOCKED & HIGH PRIORITY')
      lines.push('')
      for (const e of priorityEntries) {
        lines.push('> **' + e.title + '**')
        if (e.content && e.content.trim() !== e.title.trim()) {
          lines.push('> ' + e.content.replace(/\n/g, ' ').trim())
        }
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    }

    const categoryEmojis = {
      goal: '🎯', mixing_technique: '🎛', production_style: '🎵',
      market_knowledge: '📊', own_production: '🎧', contact_profile: '👤',
      collaboration: '🤝', observation: '👁', creative_process: '💡',
      sound_design: '🔊', business: '💼', power_dynamics_principles: '⚖️',
      release_strategy: '🚀', industry_insight: '🏭', networking: '🌐',
      artist_strategy: '🌟', reference_current: '🎯', question: '❓',
      knowledge_connection: '🔗'
    }

    for (const [cat, catEntries] of Object.entries(byCategory)) {
      const emoji = categoryEmojis[cat] || '📌'
      const catLabel = cat.toUpperCase().replace(/_/g, ' ')
      lines.push('## ' + emoji + ' ' + catLabel + '  (' + catEntries.length + ')')
      lines.push('')
      for (const e of catEntries) {
        const lock = e.confidence === 'locked' ? ' 🔒' : ''
        const prio = e.priority ? ' ⚡' : ''
        const date = new Date(e.created_at).toLocaleDateString('de-CH')
        lines.push('**' + e.title + '**' + lock + prio + '  <small>' + date + '</small>')
        if (e.content && e.content.trim() && e.content.trim() !== e.title.trim()) {
          const c = e.content.replace(/\n+/g, ' ').trim()
          lines.push(c.length > 300 ? c.slice(0, 297) + '...' : c)
        }
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    }

    const masterPath = '/Users/remo/ObsidianVault/Momentum/⚡CORE/BRAIN DUMP MASTER.md'
    const dir = require('path').dirname(masterPath)
    if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true })
    require('fs').writeFileSync(masterPath, lines.join('\n'), 'utf8')
    console.log('✓ Brain dump master rebuilt:', entries.length, 'entries')
  } catch(e) {
    console.warn('rebuildBrainMaster error:', e.message)
  }
}

async function rebuildMusicTips() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { console.warn('rebuildMusicTips: no ANTHROPIC_API_KEY'); return }
  try {
    const [{ data: entries }, { data: tipEntries }] = await Promise.all([
      supabase.from('brain_knowledge')
        .select('title, content, category, confidence, priority, created_at')
        .in('category', ['creative_process', 'mixing_technique', 'production_style', 'sound_design', 'observation', 'question'])
        .eq('active', true)
        .order('created_at', { ascending: false }),
      supabase.from('brain_knowledge')
        .select('title, content, confidence, priority')
        .eq('source_type', 'music_tips')
        .eq('active', true)
    ])

    const allContent = [...(tipEntries || []), ...(entries || [])]
      .map(e => e.title + ': ' + (e.content || '')).join('\n\n')
    if (!allContent.trim()) { console.warn('rebuildMusicTips: no content'); return }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: `You are maintaining a music producer's master knowledge file.
Rules:
- Keep the ORIGINAL structure and format of music tips
- MERGE new insights into existing sections where they fit
- Never duplicate — find the most concise way to express each idea
- Group similar concepts together
- Questions about finishing/genre/emotional response belong together
- Shorter is better — every word must earn its place
- Output clean markdown only, no commentary`,
        messages: [{ role: 'user', content: `Here is all the knowledge to synthesize into one perfect Music Tips file:\n\n${allContent}\n\nCreate the best possible version — complete, concise, perfectly organized.` }]
      })
    })
    const d = await r.json()
    const synthesized = d.content?.[0]?.text || ''
    if (!synthesized) { console.warn('rebuildMusicTips: no AI response', d.error?.message); return }

    const header = [
      '# 🎵 MUSIC TIPS — MASTER',
      '> Living document. Auto-synthesized by Mozart. Do not edit manually.',
      '> Last updated: ' + new Date().toLocaleString('de-CH'),
      '',
      '---',
      ''
    ].join('\n')

    const tipsPath = '/Users/remo/ObsidianVault/Momentum/🎵 MUSIC TIPS MASTER.md'
    try {
      require('fs').writeFileSync(tipsPath, header + synthesized, 'utf8')
      const stat = require('fs').statSync(tipsPath)
      console.log(`✓ Music Tips master rebuilt (${stat.size} bytes)`)
    } catch(writeErr) {
      console.error('rebuildMusicTips write error:', writeErr.message)
      throw writeErr
    }
    setImmediate(() => rebuildFinishingChecklist().catch(e => console.warn('checklist rebuild failed:', e.message)))
    return synthesized
  } catch(e) {
    console.error('rebuildMusicTips error:', e.message)
    throw e
  }
}

async function rebuildFinishingChecklist() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { console.warn('rebuildFinishingChecklist: no ANTHROPIC_API_KEY'); return [] }
  try {
    const tipsPath = '/Users/remo/ObsidianVault/Momentum/🎵 MUSIC TIPS MASTER.md'
    let tipsContent = ''
    try { tipsContent = require('fs').readFileSync(tipsPath, 'utf8') } catch(e) {}

    const { data: questionEntries } = await supabase
      .from('brain_knowledge')
      .select('title, content, category')
      .or([
        'category.eq.question',
        'category.eq.creative_process',
        'category.eq.mixing_technique',
        'category.eq.production_style',
        'priority.eq.true',
        'confidence.eq.locked'
      ].join(','))
      .eq('active', true)
      .limit(50)

    const questionContext = (questionEntries || [])
      .map(e => e.title + ': ' + (e.content || '')).join('\n')

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: `You are building a finishing checklist for a music producer.
Extract and organize the KEY QUESTIONS to ask when finishing a track.
Format as a JSON array. Return ONLY the JSON array, no markdown fences, no explanation:
[
  { "phase": "PRODUCTION", "question": "...", "why": "brief reason" },
  { "phase": "MIXING", "question": "...", "why": "brief reason" },
  { "phase": "MASTERING", "question": "...", "why": "brief reason" },
  { "phase": "RELEASE", "question": "...", "why": "brief reason" }
]
Max 15 questions total. Short, actionable. Return valid JSON only — no text before or after.`,
        messages: [{ role: 'user', content: tipsContent.slice(0, 3000) + '\n\nAdditional entries:\n' + questionContext }]
      })
    })
    const d = await r.json()
    let checklist = []
    const rawText = d.content?.[0]?.text || ''
    if (!rawText) { console.warn('rebuildFinishingChecklist: no AI response', d.error?.message); return [] }
    try {
      const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
      const jsonStr = jsonMatch ? jsonMatch[0] : cleaned
      checklist = JSON.parse(jsonStr)
      if (!Array.isArray(checklist)) checklist = []
    } catch(e) {
      console.warn('rebuildFinishingChecklist: JSON parse failed, raw:', rawText.slice(0, 300))
    }

    if (!checklist.length) { console.warn('rebuildFinishingChecklist: empty result'); return [] }

    // Delete existing checklist entry
    await supabase.from('brain_knowledge')
      .delete()
      .eq('category', 'checklist_70')
      .eq('title', 'Finishing Checklist — Latest')

    // Insert fresh
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'checklist_70',
      title: 'Finishing Checklist — Latest',
      content: JSON.stringify(checklist),
      active: true,
      confidence: 'locked',
      priority: true
    })

    if (error) console.error('checklist save error:', error.message)
    else console.log('✓ checklist saved:', checklist.length, 'questions')
    return checklist
  } catch(e) {
    console.error('rebuildFinishingChecklist error:', e.message)
    return []
  }
}

// Startup: build music tips + finishing checklist (20s delay)
setTimeout(rebuildMusicTips, 20000)

async function getCrossChartTopics() {
  try {
    const [tiktokRes, spotifyRes] = await Promise.all([
      supabaseAdmin.from('reference_tracks').select('title, artist').eq('collection_name', 'tiktok_trending').order('created_at', { ascending: false }).limit(20),
      supabaseAdmin.from('reference_tracks').select('title, artist').eq('collection_name', 'daily_chart').order('created_at', { ascending: false }).limit(20)
    ])
    const tiktok = tiktokRes.data || []
    const spotify = spotifyRes.data || []
    const spotifyTitles = new Set(spotify.map(t => (t.title || '').toLowerCase().trim()))
    const tiktokTitles = new Set(tiktok.map(t => (t.title || '').toLowerCase().trim()))
    const crossChart = tiktok.filter(t => spotifyTitles.has((t.title || '').toLowerCase().trim()))
    const tiktokOnly = tiktok.filter(t => !spotifyTitles.has((t.title || '').toLowerCase().trim()))
    const spotifyOnly = spotify.filter(t => !tiktokTitles.has((t.title || '').toLowerCase().trim()))
    return { crossChart, tiktokOnly, spotifyOnly, tiktok, spotify }
  } catch(e) {
    console.warn('getCrossChartTopics error:', e.message)
    return { crossChart: [], tiktokOnly: [], spotifyOnly: [], tiktok: [], spotify: [] }
  }
}

// ── BUILD 1: Success Pattern ───────────────────────────────────────────────
async function buildSuccessPattern(refsOverride) {
  const refs = refsOverride || (await supabaseAdmin.from('reference_tracks').select('*').in('source', ['user', 'agent']).not('tempo', 'is', null)).data
  if (!refs?.length) return null
  const vals = (field) => refs.map(r => r[field]).filter(v => v != null)
  const avg = (field) => { const v = vals(field); return v.length ? v.reduce((s,x) => s+x, 0) / v.length : null }
  const stddev = (field) => { const v = vals(field); if (!v.length) return null; const m = v.reduce((s,x)=>s+x,0)/v.length; return Math.sqrt(v.reduce((s,x)=>s+Math.pow(x-m,2),0)/v.length) }
  const mode = (field) => { const v = vals(field); const f={}; v.forEach(x=>f[x]=(f[x]||0)+1); return Object.entries(f).sort((a,b)=>b[1]-a[1])[0]?.[0] }
  const tempos = vals('tempo').filter(Boolean)
  const pattern = {
    bpm_avg: avg('tempo'), bpm_std: stddev('tempo'),
    bpm_range: tempos.length ? [Math.min(...tempos), Math.max(...tempos)] : null,
    energy_avg: avg('energy'), energy_std: stddev('energy'),
    danceability_avg: avg('danceability'), valence_avg: avg('valence'),
    loudness_avg: avg('loudness'),
    loudness_range: (() => { const v = vals('loudness').filter(Boolean); return v.length ? [Math.min(...v), Math.max(...v)] : null })(),
    key_mode: mode('key'), scale_mode: mode('scale'), camelot_mode: mode('camelot'),
    brightness_avg: avg('brightness'), bass_energy_avg: avg('bass_energy'),
    warmth_avg: avg('warmth'), harmonic_complexity_avg: avg('harmonic_complexity'), dynamic_complexity_avg: avg('dynamic_complexity'),
    sample_count: refs.length, updated_at: new Date().toISOString()
  }
  const { error: spErr } = await supabaseAdmin.from('user_settings').upsert({ key: 'success_pattern', value: JSON.stringify(pattern) }, { onConflict: 'key' })
  if (spErr) console.error('user_settings upsert failed:', spErr.message)
  return pattern
}

async function compareToSuccessPattern(analysis, pattern) {
  if (!analysis || !pattern) return null
  const score = { total: 0, max: 0, details: [] }
  const check = (label, val, target, tolerance, weight=10) => {
    score.max += weight
    if (val == null || target == null) return
    const diff = Math.abs(val - target)
    const pts = Math.max(0, weight - (diff / tolerance) * weight)
    score.total += pts
    const pct = Math.round(pts / weight * 100)
    score.details.push({ label, value: val, target: Math.round(target*100)/100, match: pct, diff: Math.round(diff*100)/100, ok: pct >= 70 })
  }
  check('BPM', analysis.bpm, pattern.bpm_avg, pattern.bpm_std || 10, 15)
  check('Energy', analysis.energy, pattern.energy_avg, 0.15, 15)
  check('Danceability', analysis.danceability, pattern.danceability_avg, 0.15, 10)
  check('Loudness (LUFS)', analysis.loudness_lufs, pattern.loudness_avg, 2, 15)
  check('Brightness', analysis.brightness, pattern.brightness_avg, 0.15, 10)
  check('Bass Energy', analysis.bass_energy, pattern.bass_energy_avg, 0.15, 10)
  check('Warmth', analysis.warmth, pattern.warmth_avg, 0.15, 8)
  check('Harmonic Complexity', analysis.harmonic_complexity, pattern.harmonic_complexity_avg, 0.2, 8)
  check('Dynamic Complexity', analysis.dynamic_complexity, pattern.dynamic_complexity_avg, 1, 9)
  score.max += 10
  if (analysis.scale === pattern.scale_mode) { score.total += 10; score.details.push({ label: 'Scale', value: analysis.scale, target: pattern.scale_mode, match: 100, ok: true }) }
  else { score.details.push({ label: 'Scale', value: analysis.scale, target: pattern.scale_mode, match: 0, ok: false }) }
  const matchScore = Math.round((score.total / score.max) * 100)
  return { matchScore, details: score.details, gaps: score.details.filter(d=>!d.ok).sort((a,b)=>a.match-b.match), strengths: score.details.filter(d=>d.ok), pattern }
}

// ── BUILD 2: Feedback classification ───────────────────────────────────────
function classifyFeedback(text) {
  const l = text.toLowerCase()
  if (l.includes('energy') && (l.includes('more')||l.includes('higher')||l.includes('lacking'))) return 'energy_low'
  if (l.includes('energy') && (l.includes('less')||l.includes('lower')||l.includes('too much'))) return 'energy_high'
  if (l.includes('bass') && (l.includes('heavy')||l.includes('too much')||l.includes('boom'))) return 'bass_heavy'
  if (l.includes('bass') && (l.includes('more')||l.includes('thin')||l.includes('lacking'))) return 'bass_thin'
  if (l.includes('vocal') && (l.includes('bright')||l.includes('harsh')||l.includes('sharp'))) return 'vocal_bright'
  if (l.includes('vocal') && (l.includes('mud')||l.includes('dark')||l.includes('boomy'))) return 'vocal_muddy'
  if ((l.includes('too quiet')||l.includes('louder')||l.includes('level up'))) return 'too_quiet'
  if ((l.includes('perfect')||l.includes('love it')||l.includes('great')||l.includes('approved')||l.includes('yes'))) return 'approved'
  return 'other'
}

// ── BUILD 5: Emotional arc comparison ──────────────────────────────────────
function compareEmotionalArcs(myArc, refArc) {
  if (!myArc?.length || !refArc?.length) return null
  const segments = Math.min(myArc.length, refArc.length)
  const diffs = []
  for (let i = 0; i < segments; i++) {
    diffs.push({
      segment: i + 1, position_pct: myArc[i].position_pct,
      energy_diff: Math.round((myArc[i].energy - (refArc[i]?.energy||0)) * 100) / 100,
      brightness_diff: Math.round((myArc[i].brightness - (refArc[i]?.brightness||0)) * 100) / 100,
      bass_diff: Math.round((myArc[i].bass - (refArc[i]?.bass||0)) * 100) / 100
    })
  }
  return {
    diffs,
    weakPoints: diffs.filter(d => d.energy_diff < -0.1),
    strongPoints: diffs.filter(d => d.energy_diff > 0.1),
    myContrast: Math.max(...myArc.map(s=>s.energy)) - Math.min(...myArc.map(s=>s.energy)),
    refContrast: Math.max(...refArc.map(s=>s.energy)) - Math.min(...refArc.map(s=>s.energy))
  }
}

// ── BUILD 3: Trend velocity ────────────────────────────────────────────────
async function calculateVelocity() {
  const cutoff = new Date(Date.now() - 14*24*3600000).toISOString().slice(0,10)
  const { data } = await supabaseAdmin.from('chart_history').select('*').gte('chart_date', cutoff).order('chart_date', { ascending: true })
  if (!data?.length) return { rising: [], falling: [], stable: [] }
  const byTrack = {}
  for (const row of data) {
    const key = row.spotify_id || (row.title + row.artist)
    if (!byTrack[key]) byTrack[key] = { title: row.title, artist: row.artist, spotify_id: row.spotify_id, positions: [] }
    byTrack[key].positions.push({ date: row.chart_date, pos: row.position })
  }
  const velocities = Object.values(byTrack).filter(t => t.positions.length >= 2).map(t => {
    const first = t.positions[0].pos, last = t.positions[t.positions.length-1].pos
    const velocity = (first - last) / t.positions.length
    return { ...t, velocity, first_pos: first, last_pos: last, days_tracked: t.positions.length }
  }).sort((a,b) => b.velocity - a.velocity)
  return {
    rising: velocities.filter(t => t.velocity > 10).slice(0,10),
    falling: velocities.filter(t => t.velocity < -10).slice(0,5),
    stable: velocities.filter(t => Math.abs(t.velocity) <= 10).slice(0,5)
  }
}

// ── BUILD 4: Artist collaborators ──────────────────────────────────────────
async function fetchArtistCollaborators(spotifyId) {
  try {
    const r = await spotifyFetch(`https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=US`)
    const d = await r.json()
    const collaborators = new Set()
    for (const track of d.tracks || []) {
      for (const artist of track.artists || []) {
        if (artist.id !== spotifyId) collaborators.add(JSON.stringify({ name: artist.name, id: artist.id }))
      }
    }
    return [...collaborators].map(c => JSON.parse(c))
  } catch(e) { return [] }
}

async function runAgentTikTokTrends(apiKey, sharedBrainRows) {
  console.log('runAgentTikTokTrends: starting')
  const brainContext = buildBrainContext(sharedBrainRows)
  const today = new Date().toISOString().slice(0, 10)
  const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
  const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')

  let tiktokTracks = []   // top 10
  let spotifyTracks = []  // top 5
  let youtubeTracks = []  // top 5
  let analyzedTrends = []

  try {
    // 1. TikTok top 10
    tiktokTracks = (await fetchTikTokRealData()).slice(0, 10)
    console.log(`  TikTok: ${tiktokTracks.length} tracks`)

    // 2. Spotify top 5 from kworb global daily
    const kworbSP = await fetchKworbSpotify()
    spotifyTracks = (Array.isArray(kworbSP) ? kworbSP : []).slice(0, 5).map(t => ({
      title: t.title, artist: t.artist, position: t.position, source: 'spotify_chart'
    }))
    console.log(`  Spotify: ${spotifyTracks.length} tracks`)

    // 3. YouTube top 5 from kworb trending
    const kworbYT = await fetchKworbTrending()
    youtubeTracks = (Array.isArray(kworbYT) ? kworbYT : []).slice(0, 5).map(line => {
      const parts = line.split(' · ')
      return { title: parts[1] || line, artist: parts[0] || '', source: 'youtube_chart' }
    })
    console.log(`  YouTube: ${youtubeTracks.length} tracks`)

    // 4. Save all 20 to checkout with correct collection_name per source
    for (const track of tiktokTracks) {
      if (!track.title || !track.artist) continue
      await saveToCheckout({ title: track.title, artist: track.artist, collection_name: 'tiktok_trending', approved: true })
    }
    for (const track of spotifyTracks) {
      if (!track.title || !track.artist) continue
      await saveToCheckout({ title: track.title, artist: track.artist, collection_name: 'spotify_chart', approved: true })
    }
    for (const track of youtubeTracks) {
      if (!track.title || !track.artist) continue
      await saveToCheckout({ title: track.title, artist: track.artist, collection_name: 'youtube_chart', approved: true })
    }

    // 5. Spotify search + Essentia for TikTok top 5
    if (tiktokTracks.length) {
      for (const trend of tiktokTracks.slice(0, 5)) {
        if (!trend.title) continue
        try {
          const sp = await fetchSpotifyId(trend.title, trend.artist)
          if (!sp) continue
          const spTrack = { id: sp.spotify_id, name: sp.title, preview_url: sp.preview_url, artists: [{ name: sp.artist }] }

          let feat = {}
          const tmpAudio = `/tmp/tiktok_${Date.now()}.mp3`
          if (spTrack.preview_url) {
            try {
              execSync(`curl -s -o "${tmpAudio}" "${spTrack.preview_url}"`, { timeout: 15000 })
              const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
              feat = JSON.parse(esOut)
            } catch(e) { console.warn('  TikTok Essentia skipped:', e.message.slice(0, 60)) }
            finally { try { fs.unlinkSync(tmpAudio) } catch(e) {} }
          }

          const trackData = {
            title: spTrack.name, artist: spTrack.artists.map(a => a.name).join(', '),
            spotify_id: spTrack.id,
            spotify_url: `https://open.spotify.com/track/${spTrack.id}`,
            bpm: feat.bpm || null, key: feat.key || null, scale: feat.scale || null,
            camelot: feat.camelot || null, energy: feat.energy || null,
            source: 'tiktok'
          }
          analyzedTrends.push(trackData)

          saveToCheckout({
            spotify_id: spTrack.id, title: spTrack.name,
            artist: spTrack.artists.map(a => a.name).join(', '),
            collection_name: 'tiktok_trending', approved: true,
            tempo: feat.bpm || null, key: feat.key || null, scale: feat.scale || null,
            energy: feat.energy || null, danceability: feat.danceability || null
          }).catch(() => {})
        } catch(e) { console.warn('  TikTok track failed:', e.message.slice(0, 80)) }
      }
    }
  } catch(e) {
    console.error('TikTok data fetch error:', e.message)
  }

  // Synthesize all sources into ONE weekly brain entry
  const allTracks = [...tiktokTracks, ...spotifyTracks, ...youtubeTracks]
  if (allTracks.length) {
    try {
      const d = new Date()
      const dayOfWeek = d.getDay() || 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - dayOfWeek + 1)
      const weekLabel = monday.toISOString().slice(0, 10)

      const trackList = allTracks.slice(0, 20)
        .map(t => (t.artist ? t.artist + ' — ' : '') + t.title + ` [${t.source}]`)
        .join('\n')

      const synthRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 80,
          messages: [{ role: 'user', content: `You are a music A&R analyst. Analyze these trending tracks across TikTok, Spotify, and YouTube and write ONE concise insight (max 150 chars) about what genres/moods/sounds are dominating this week. Focus on patterns not individual tracks.\n\n${trackList}` }]
        })
      })
      const synthData = await synthRes.json()
      const trendSummary = (synthData.content?.[0]?.text || '').trim().slice(0, 150)
      if (trendSummary) {
        const { error: ttErr } = await supabase.from('brain_knowledge').upsert({
          category: 'market_knowledge',
          title: 'TikTok Trends Week ' + weekLabel,
          content: trendSummary,
          active: true,
          confidence: 'medium',
          source_type: 'tiktok_agent'
        }, { onConflict: 'title' })
        if (ttErr) console.error('tiktok brain upsert failed:', ttErr.message)
        console.log(`  ✓ Weekly trend brain insight saved (week of ${weekLabel})`)
      }
    } catch(e) { console.warn('  TikTok brain synthesis error:', e.message) }
  }

  // Build text sections for Claude prompt
  const tiktokText = tiktokTracks.length
    ? tiktokTracks.map((t, i) => `${i+1}. ${t.artist ? t.artist + ' — ' : ''}${t.title}`).join('\n')
    : 'No TikTok data available'
  const spotifyText = spotifyTracks.length
    ? spotifyTracks.map((t, i) => `${i+1}. ${t.artist} — ${t.title}`).join('\n')
    : 'Unavailable'
  const youtubeText = youtubeTracks.length
    ? youtubeTracks.map((t, i) => `${i+1}. ${t.artist ? t.artist + ' — ' : ''}${t.title}`).join('\n')
    : 'Unavailable'
  const analyzedText = analyzedTrends.length
    ? analyzedTrends.map(t => `- ${t.artist} — ${t.title}${t.bpm ? ': ' + Math.round(t.bpm) + 'bpm ' + (t.key || '') + (t.camelot ? ' (' + t.camelot + ')' : '') : ''}`).join('\n')
    : ''

  const prompt = `You are a music trend analyst. Here is REAL data about trending sounds right now:

📱 TIKTOK TOP 10 (${today}):
${tiktokText}

🎵 SPOTIFY TOP 5:
${spotifyText}

▶ YOUTUBE TOP 5:
${youtubeText}

${analyzedText ? `ANALYZED TRACKS (Essentia signals):\n${analyzedText}\n` : ''}${brainContext ? `[TASTE PROFILE — read silently]\n${brainContext}\n[END PROFILE]\n` : ''}Based on this data, analyze trends for a producer working in: ${SUB_GENRE_LABELS}

FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK] for emphasis. Plain text only.

## Viral Sounds
## Why It's Blowing Up
## Production Angles
## Next Move`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
  })
  const claudeData = await claudeRes.json()
  const trendsText = claudeData.content?.[0]?.text || 'No trends generated.'

  const model = 'claude-haiku-4-5-20251001'
  const usage = claudeData.usage || {}
  fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ endpoint: '/agent-tiktok-trends', model, input_tokens: usage.input_tokens||0, output_tokens: usage.output_tokens||0, cost_usd: ((usage.input_tokens||0)*0.000001)+((usage.output_tokens||0)*0.000005) })
  }).catch(() => {})

  // Inbox: raw track lists + Claude analysis
  const rawListsBlock = [
    `📱 TIKTOK TOP 10\n${tiktokText}`,
    `🎵 SPOTIFY TOP 5\n${spotifyText}`,
    `▶ YOUTUBE TOP 5\n${youtubeText}`
  ].join('\n\n')
  const tracksJson = analyzedTrends.length ? `\n<!--TRACKS:${JSON.stringify(analyzedTrends)}-->` : ''
  const inboxMessage = rawListsBlock + '\n\n---\n\n' + trendsText + tracksJson

  await deleteInboxToday('TikTok Trends')
  await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ type: 'briefing', song_code: null, song_title: 'TikTok Trends', artist: null, message: inboxMessage, patch_name: `Trends ${today}`, read: false })
  })
  setImmediate(async () => {
    try {
      const insight = await extractInsight(trendsText, apiKey)
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          category: 'market_knowledge',
          title: `TikTok ${today} — ${insight.slice(0, 60)}`,
          content: insight,
          entry_type_v2: 'observation',
          confidence: 'medium',
          source_type: 'tiktok_agent',
          active: true
        })
      })
      saveBrainFile({ category: 'market_knowledge', title: `TikTok ${today}`, content: insight, confidence: 'medium', source_type: 'tiktok_agent' }).catch(() => {})
    } catch(e) { console.warn('tiktok brain save error:', e.message) }
  })
  console.log(`✓ Agent TikTok Trends: TikTok(${tiktokTracks.length}) Spotify(${spotifyTracks.length}) YouTube(${youtubeTracks.length}), ${analyzedTrends.length} analyzed`)
  return {
    ok: true,
    tiktok: tiktokTracks,
    spotify: spotifyTracks,
    youtube: youtubeTracks,
    tracks: allTracks,
    trends: trendsText,
    trend_tracks: analyzedTrends,
    source: tiktokTracks.length ? 'real' : 'fallback'
  }
}

console.log('Spotify ID:', SPOTIFY_CLIENT_ID ? 'set' : 'EMPTY')
console.log('Spotify Secret:', SPOTIFY_CLIENT_SECRET ? 'set' : 'EMPTY')

// Spotify user OAuth tokens (set after /spotify-auth flow)
let spotifyUserToken = null
let spotifyUserRefresh = null

const SPOTIFY_TOKEN_FILE = path.join(__dirname, '.spotify-token.json')

function loadSpotifyToken() {
  try {
    if (fs.existsSync(SPOTIFY_TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(SPOTIFY_TOKEN_FILE, 'utf8'))
      if (data.access_token && data.expires_at > Date.now()) {
        spotifyUserToken = data.access_token
        spotifyUserRefresh = data.refresh_token
        console.log('✓ Spotify user token loaded from disk, expires in',
          Math.round((data.expires_at - Date.now()) / 60000), 'min')
      } else if (data.refresh_token) {
        spotifyUserRefresh = data.refresh_token
        refreshSpotifyToken()
      }
    }
  } catch(e) { console.warn('Could not load Spotify token:', e.message) }
}

function saveSpotifyToken(accessToken, refreshToken, expiresIn) {
  try {
    fs.writeFileSync(SPOTIFY_TOKEN_FILE, JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + (expiresIn * 1000) - 60000
    }), 'utf8')
    console.log('✓ Spotify token saved to disk')
  } catch(e) { console.warn('Could not save Spotify token:', e.message) }
}

async function refreshSpotifyToken() {
  if (!spotifyUserRefresh) return
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyUserRefresh
      }).toString()
    })
    const data = await r.json()
    if (data.access_token) {
      spotifyUserToken = data.access_token
      if (data.refresh_token) spotifyUserRefresh = data.refresh_token
      saveSpotifyToken(data.access_token, spotifyUserRefresh, data.expires_in || 3600)
      console.log('✓ Spotify token refreshed')
    } else {
      console.error('✗ Spotify token refresh failed:', JSON.stringify(data))
    }
  } catch(e) { console.warn('Spotify token refresh error:', e.message) }
}

// Spotify rate limit tracking
let spotifyCallCount = 0
let spotifyCallWindowStart = Date.now()
const SPOTIFY_MAX_CALLS_PER_30S = 30

async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Spotify credentials not set — fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in momentum-watcher.js')
  }
  console.log('Getting Spotify token...')
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  })
  console.log('Token response status:', r.status)
  const text = await r.text()
  console.log('Token response:', text.slice(0, 200))
  if (!r.ok) throw new Error(`Spotify token error: ${r.status} ${text}`)
  const d = JSON.parse(text)
  return d.access_token
}

// ── spotifyFetch — rate-limited wrapper for all Spotify API calls ────────────
async function spotifyFetch(url, opts = {}) {
  if (Date.now() < spotifyRateLimitUntil) {
    const waitSec = Math.ceil((spotifyRateLimitUntil - Date.now()) / 1000)
    throw new Error('Spotify rate limited for ' + waitSec + 's')
  }

  // Throttle: reset window every 30s
  const now = Date.now()
  if (now - spotifyCallWindowStart > 30000) {
    spotifyCallCount = 0
    spotifyCallWindowStart = now
  }
  if (spotifyCallCount >= SPOTIFY_MAX_CALLS_PER_30S) {
    await new Promise(r => setTimeout(r, 2000))
  }
  spotifyCallCount++

  const token = spotifyUserToken || await getSpotifyToken()
  const r = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) }
  })

  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('Retry-After') || '60', 10)
    spotifyRateLimitUntil = Date.now() + retryAfter * 1000
    console.warn('⚠ Spotify rate limit hit — blocked for', retryAfter, 's')
    sendTelegram(TELEGRAM_OWNER_ID, '⚠️ Spotify rate limited for ' + Math.ceil(retryAfter / 60) + ' min').catch(() => {})
    throw new Error('Spotify rate limited for ' + retryAfter + 's')
  }

  if (r.status === 403) {
    const body = await r.text()
    throw new Error('Spotify 403 Forbidden: ' + body.slice(0, 200))
  }

  return r
}

// ── Spotify track search by title + artist ───────────────────────────────────
async function fetchSpotifyId(title, artist) {
  if (!title) return null
  try {
    const q = encodeURIComponent((artist ? artist + ' ' : '') + title)
    const r = await spotifyFetch(
      `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`
    )
    if (!r.ok) return null
    const d = await r.json()
    const track = d.tracks?.items?.[0]
    if (!track) return null
    return {
      spotify_id: track.id,
      spotify_url: 'https://open.spotify.com/track/' + track.id,
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      popularity: track.popularity,
      preview_url: track.preview_url || null
    }
  } catch(e) {
    console.warn('[fetchSpotifyId] failed for "' + title + '":', e.message)
    return null
  }
}

// ── Public filename — strips internal code prefix for artist-facing downloads ──
function getPublicFilename(internalFilename, artist, songTitle) {
  if (!internalFilename) return internalFilename
  // Remove leading 8-digit code like "26040604_"
  const withoutCode = internalFilename.replace(/^\d{8}_/, '')
  const artistClean = (artist || '').toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
  if (!artistClean || withoutCode.toUpperCase().includes(artistClean)) {
    return withoutCode
  }
  return artistClean + '_' + withoutCode
}

// ── Error log — writes to Supabase watcher_logs, survives restarts ───────────
function logError(endpoint, message, level = 'error') {
  const row = { endpoint, message: String(message).slice(0, 500), level }
  fetch(`${SUPABASE_URL}/rest/v1/watcher_logs`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(row)
  }).catch(() => {})
  if (level === 'error' && TELEGRAM_TOKEN) {
    sendTelegram(TELEGRAM_OWNER_ID, '⚠️ Watcher error [' + endpoint + ']: ' + String(message).slice(0, 200)).catch(() => {})
  }
  console.error(`[${level}] ${endpoint}: ${message}`)
}

// ── Shared status builder (used by GET /status and GET /system-status alias) ─
async function buildStatusResponse() {
  const tasksPath   = path.join(__dirname, 'TASKS.md')
  const changesPath = path.join(__dirname, 'CHANGES.md')
  const statusPath  = path.join(__dirname, '.claude-status.json')

  const tasksText   = fs.existsSync(tasksPath)   ? fs.readFileSync(tasksPath,   'utf8') : ''
  const changesText = fs.existsSync(changesPath)  ? fs.readFileSync(changesPath, 'utf8') : ''

  const tasks_remaining = (tasksText.match(/- \[ \]/g) || []).length
  const tasks_done      = (tasksText.match(/- \[x\]/gi) || []).length
  const recent_changes  = changesText.split('\n').slice(-15).join('\n')

  let cs = {}
  if (fs.existsSync(statusPath)) {
    try { cs = JSON.parse(fs.readFileSync(statusPath, 'utf8')) } catch(e) {}
  }

  const endpoints_registered = [
    'POST /write-component', 'POST /normalize', 'GET /backup', 'POST /restore',
    'GET /backup-ui', 'GET /dropbox-auth', 'GET /dropbox-callback',
    'POST /rename-audio', 'POST /delete-audio', 'POST /copy-to-demos',
    'POST /share-link', 'POST /delete-submission-folder', 'POST /delete-from-submission',
    'POST /create-release-folder', 'POST /copy-demo-to-production',
    'POST /delete-release-folder', 'POST /copy-to-release',
    'POST /save-audio', 'POST /save-stems-zip', 'GET /test-dropbox',
    'POST /get-share-links', 'POST /morning-briefing', 'POST /agent-scout',
    'POST /agent-demo-match', 'POST /agent-feedback', 'POST /analyze-spotify-track', 'POST /import-spotify-playlist', 'POST /import-all-my-playlists',
    'POST /agent-import-spotify', 'GET /get-page-title', 'POST /create-submission',
    'POST /save-instrumental', 'POST /get-instrumental-link', 'POST /analyze-audio',
    'GET /audio/:filename', 'GET /mixing/:filename', 'GET /production/:filename',
    'GET /instrumentals/:filename', 'GET /stems/:filename',
    'POST /agent-pulse-check', 'POST /agent-chart-analysis', 'POST /run-morning-agents', 'POST /speak',
    'POST /suggest-category', 'GET /daily-snapshot', 'POST /analyze-audio-features', 'POST /analyze-stems', 'POST /extract-acapella', 'POST /analyze-youtube-track',
    'POST /sync-all-refs', 'POST /capture-screen', 'POST /analyze-chat',
    'POST /launch-claude-code', 'POST /launch-claude-overnight',
    'GET /logs', 'GET /get-changes', 'GET /get-tasks', 'POST /track-cost',
    'GET /get-env-keys', 'POST /save-env-key', 'POST /save-tasks',
    'GET /status', 'GET /system-status', 'GET /ping',
    'POST /cleanup-brain-dupes', 'POST /enrich-library-genres', 'POST /rebuild-brain-master',
    'POST /rebuild-music-tips', 'POST /rebuild-finishing-checklist',
    'GET /find-whatsapp-db', 'POST /setup-whatsapp',
    'GET /whatsapp-contacts', 'POST /whatsapp-add-contact'
  ]

  const [catsRes, countRes, logRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?select=category&order=category.asc`, { headers: sbHeaders }).catch(() => null),
    fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?select=id&limit=1`, { headers: { ...sbHeaders, 'Prefer': 'count=exact' } }).catch(() => null),
    fetch(`${SUPABASE_URL}/rest/v1/watcher_logs?select=created_at,endpoint,message,level&order=created_at.desc&limit=1`, { headers: sbHeaders }).catch(() => null)
  ])

  let brain_categories = []
  if (catsRes && catsRes.ok) {
    const rows = await catsRes.json()
    brain_categories = [...new Set((rows || []).map(r => r.category).filter(Boolean))].sort()
  }

  let brain_entry_count = 0
  if (countRes && countRes.ok) {
    const ct = countRes.headers.get('content-range')
    if (ct) brain_entry_count = parseInt(ct.split('/')[1]) || 0
  }

  let last_watcher_error = null
  if (logRes && logRes.ok) {
    const rows = await logRes.json()
    if (rows && rows[0]) {
      const r = rows[0]
      last_watcher_error = `[${r.level}] ${r.endpoint}: ${r.message} (${r.created_at})`
    }
  }

  const api_keys_present = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai:    !!process.env.OPENAI_API_KEY,
    spotify:   !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET)
  }

  return {
    updated:              cs.updated    || null,
    last_task:            cs.last_task  || null,
    working:              cs.working    || [],
    broken:               cs.broken     || [],
    partial:              cs.partial    || [],
    next:                 cs.next       || null,
    notes:                cs.notes      || null,
    tasks_remaining,
    tasks_done,
    recent_changes,
    brain_categories,
    brain_entry_count,
    api_keys_present,
    endpoints_registered,
    last_watcher_error
  }
}

// ── Obsidian sync ─────────────────────────────────────────────────────────

// Files we just patched — debounce so chokidar re-fires don't recurse
const _obsidianSyncDebounce = new Set()

function obsidianKeywords(text) {
  const STOP = new Set(['with','this','that','from','have','been','will','what','when','where','which','your','our','how','not','are','was','were','its','all','but','for','the','and','to','in','of','a','is','it','be','at','on','an','by','as','or','if','do','up','so','no','we','me','my','he','she','they','us','can','has','had','his','her','did','get','got','let','put','run','set','try','use','way','per','now','new','old','two','one','any','may','say','see','give','take','make','come','each','such','both','then','than','very','just','also','well','much','some'])
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))]
}

function findRelatedVaultNotes(ownPath, title, category) {
  const keywords = new Set(obsidianKeywords(title))
  if (!keywords.size) return []
  const SKIP = new Set(['INDEX', 'Hit Benchmark', 'Active Goals', 'My Productions', 'Music Tips', 'Reference Tracks', 'Market Intelligence', 'Contact Directory', 'NOW', 'Networking'])
  const candidates = []

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const fp = path.join(dir, f)
      if (fp === ownPath) continue
      const bt = f.slice(0, -3).replace(/^(\d{4}-\d{2}-\d{2}_)+/, '')
      if (SKIP.has(bt)) continue
      const score = [...keywords].filter(k => bt.toLowerCase().includes(k)).length
      if (score > 0) candidates.push({ filePath: fp, bareTitle: bt, score })
    }
  }

  scanDir(OBSIDIAN_VAULT_PATH)
  const brainDir = path.join(OBSIDIAN_VAULT_PATH, 'Brain')
  if (fs.existsSync(brainDir)) {
    try {
      for (const sub of fs.readdirSync(brainDir)) {
        const subPath = path.join(brainDir, sub)
        if (fs.statSync(subPath).isDirectory()) scanDir(subPath)
      }
    } catch(e) {}
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5)
}

function patchObsidianRelated(filePath, titlesToAdd) {
  if (!titlesToAdd.length || !fs.existsSync(filePath)) return
  let content = fs.readFileSync(filePath, 'utf8')
  const existingLinks = new Set((content.match(/\[\[([^\]]+)\]\]/g) || []).map(l => l.slice(2, -2)))
  const toAdd = titlesToAdd.filter(t => !existingLinks.has(t))
  if (!toAdd.length) return
  const linkStr = toAdd.map(t => `[[${t}]]`).join(', ')
  if (content.includes('\n## Related\n')) {
    content = content.replace('\n## Related\n', `\n## Related\n${linkStr}, `)
  } else {
    content = content.trimEnd() + `\n\n## Related\n${linkStr}`
  }
  _obsidianSyncDebounce.add(filePath)
  setTimeout(() => _obsidianSyncDebounce.delete(filePath), 8000)
  fs.writeFileSync(filePath, content, 'utf8')
}

function patchObsidianSeeAlso(filePath, newTitle) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  if (content.includes(`[[${newTitle}]]`)) return
  _obsidianSyncDebounce.add(filePath)
  setTimeout(() => _obsidianSyncDebounce.delete(filePath), 8000)
  fs.writeFileSync(filePath, content.trimEnd() + `\n\nSee also: [[${newTitle}]]`, 'utf8')
}

async function updateCategoryMOC(category) {
  try {
    const { data: entries } = await supabase
      .from('brain_knowledge')
      .select('title, content, created_at')
      .eq('category', category)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!entries?.length) return

    const mocDir = path.join(OBSIDIAN_VAULT_PATH, 'MOC')
    fs.mkdirSync(mocDir, { recursive: true })
    const safeCat = category.replace(/[\/\\:*?"<>|]/g, '-')
    const mocPath = path.join(mocDir, safeCat + '.md')
    const label = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

    const lines = [
      `# ${label} — Map of Content`,
      `Updated: ${new Date().toLocaleDateString('de-CH')}`,
      '',
      `## Entries (${entries.length})`,
      ...entries.map(e => `- [[${e.title}]] — ${(e.content || '').replace(/\n/g, ' ').slice(0, 80)}`)
    ]

    _obsidianSyncDebounce.add(mocPath)
    setTimeout(() => _obsidianSyncDebounce.delete(mocPath), 8000)
    fs.writeFileSync(mocPath, lines.join('\n'), 'utf8')
  } catch(e) { console.warn('updateCategoryMOC error:', e.message) }
}

function parseObsidianFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m)
  if (!match) return { frontmatter: {}, body: content }
  const fm = {}
  for (const line of match[1].split('\n')) {
    const [k, ...v] = line.split(':')
    if (k && v.length) {
      const val = v.join(':').trim().replace(/^["']|["']$/g, '')
      if (val.startsWith('[')) {
        try { fm[k.trim()] = JSON.parse(val) } catch { fm[k.trim()] = val.replace(/[\[\]]/g, '').split(',').map(s => s.trim()) }
      } else {
        fm[k.trim()] = val
      }
    }
  }
  return { frontmatter: fm, body: match[2].trim() }
}

async function syncObsidianFile(filePath) {
  if (!filePath.endsWith('.md')) return
  // Skip files we just wrote (backlinks/MOC/index) to prevent chokidar loops
  if (_obsidianSyncDebounce.has(filePath)) return
  // Notes/ managed by Apple Notes sync — skip
  if (filePath.startsWith(NOTES_PATH + path.sep) || filePath.startsWith(NOTES_PATH + '/')) return
  // Skip MOC files and INDEX
  const mocDir = path.join(OBSIDIAN_VAULT_PATH, 'MOC')
  if (filePath.startsWith(mocDir + path.sep) || filePath.startsWith(mocDir + '/')) return
  if (path.basename(filePath) === 'INDEX.md') return
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const stat = fs.statSync(filePath)
    const filename = path.basename(filePath, '.md')
    const { frontmatter, body } = parseObsidianFrontmatter(content)
    const tags = frontmatter.tags || frontmatter.tag || []
    const tagArr = Array.isArray(tags) ? tags : [tags]
    const category = frontmatter.category || tagArr[0] || 'knowledge'

    // Extract [[backlinks]] from body
    const backlinkMatches = body.match(/\[\[([^\]]+)\]\]/g) || []
    const relatedNotes = backlinkMatches.map(m => m.slice(2, -2).trim())

    // Strip date prefix from filename to get the clean Supabase title
    const bareFilename = filename.replace(/^(\d{4}-\d{2}-\d{2}_)+/, '')
    const row = {
      category,
      title: bareFilename,
      content: body.replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 500),
      source_type: 'obsidian',
      confidence: frontmatter.confidence || 'medium',
      entry_type_v2: frontmatter.type || 'knowledge',
      active: true,
      ...(relatedNotes.length ? { metadata: { related_notes: relatedNotes } } : {})
    }

    // Upsert by bare title first, then full filename for backward compat
    let existingRows = await fetch(
      `${SUPABASE_URL}/rest/v1/brain_knowledge?title=eq.${encodeURIComponent(bareFilename)}&select=id,created_at`,
      { headers: sbHeaders }
    ).then(r => r.json()).catch(() => [])
    if (!existingRows[0] && bareFilename !== filename) {
      existingRows = await fetch(
        `${SUPABASE_URL}/rest/v1/brain_knowledge?title=eq.${encodeURIComponent(filename)}&select=id,created_at`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => [])
    }

    if (existingRows[0]?.id) {
      const createdAt = new Date(existingRows[0].created_at).getTime()
      const mtime = stat.mtimeMs
      if (mtime > createdAt) {
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?id=eq.${existingRows[0].id}`, {
          method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify(row)
        })
        console.log(`✓ Obsidian sync (updated): ${filename}`)
      }
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify(row)
      })
      console.log(`✓ Obsidian sync (new): ${filename}`)

      // Enrich new entry: backlinks + See also + MOC update
      setImmediate(async () => {
        try {
          const related = findRelatedVaultNotes(filePath, bareFilename, category)
          if (related.length) {
            patchObsidianRelated(filePath, related.map(r => r.bareTitle))
            for (const rel of related) {
              patchObsidianSeeAlso(rel.filePath, bareFilename)
            }
          }
          await updateCategoryMOC(category)
          await updateObsidianIndex()
        } catch(e) { console.warn('Obsidian enrichment error:', e.message) }
      })
    }
  } catch(e) { console.warn('Obsidian sync error:', e.message) }
}

// ── Telegram bot ──────────────────────────────────────────────────────────
const pendingConfirmations = {}
const lastExitAlertSent = {} // coin → ms timestamp (3h cooldown)
let lastSignalResult = null  // cached from last buildCryptoSignal() call

async function sendTelegram(chatId, text) {
  const res = await fetch(TELEGRAM_API + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  })
  try {
    const d = await res.json()
    if (d.ok && d.result?.message_id) {
      sentMessages.push({ chat_id: chatId, message_id: d.result.message_id, sent_at: Date.now() })
      if (sentMessages.length > 500) sentMessages.splice(0, 100)
    }
  } catch(e) {}
}

async function runTelegramCleanup() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const toDelete = sentMessages.filter(m => m.sent_at < cutoff)
  for (const m of toDelete) {
    try { await fetch(TELEGRAM_API + '/deleteMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: m.chat_id, message_id: m.message_id })
    }) } catch(e) {}
  }
  sentMessages.splice(0, sentMessages.length, ...sentMessages.filter(m => m.sent_at >= cutoff))
  if (toDelete.length > 0) console.log('Deleted ' + toDelete.length + ' old bot messages')
  return toDelete.length
}

setInterval(runTelegramCleanup, 60 * 60 * 1000)

// ── WhatsApp / forwarded message analysis helpers ───────────────────────────

async function analyzeWhatsappText(chatText, chatName) {
  const prompt = `Extract all useful information from this WhatsApp chat for a music producer named Remo.

Extract separately:
- Action items (things to do)
- Artist mentions and context
- Feedback received on music
- Decisions made
- Interesting observations
- Questions raised

For each item return:
{"title":"short label max 8 words","content":"verbatim relevant text or summary","category":"one of: collaboration, artist_strategy, mixing_technique, production_style, market_knowledge, industry_insight, networking, question","entry_type":"observation|pattern|rule|reference|question","confidence":"weak|medium|strong","action_item":"one concrete next step if applicable"}

Return ONLY a JSON array. No explanation. No markdown. Start with [.

Chat from ${chatName || 'contact'}:
${chatText.slice(0, 4000)}`

  // Prefer Gemini (cheaper) if key present
  if (GEMINI_API_KEY) {
    try {
      const gr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1500 } })
        }
      )
      const gd = await gr.json()
      const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      const jsonStart = raw.indexOf('[')
      return JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw)
    } catch(e) { console.warn('Gemini analyze failed, falling back to Claude:', e.message) }
  }

  // Fall back to Claude Haiku
  const apiKey = process.env.ANTHROPIC_API_KEY
  const cr = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const cd = await cr.json()
  const raw = cd.content?.[0]?.text || '[]'
  const jsonStart = raw.indexOf('[')
  return JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw)
}

async function saveWhatsappResults(chatId, items, chatName, source) {
  const saved = []
  for (const it of items) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          category: it.category || 'collaboration',
          title: it.title || 'untitled',
          content: it.content || '',
          entry_type_v2: it.entry_type || 'observation',
          confidence: it.confidence || 'medium',
          source_type: source || 'telegram_whatsapp',
          active: true,
          metadata: { action_item: it.action_item || null, chat_name: chatName || null }
        })
      })
      saved.push(it)
    } catch(e) { console.warn('saveWhatsappResults brain error:', e.message) }
  }

  // Save summary to inbox
  const actionItems = items.filter(i => i.action_item).map(i => `• ${i.action_item}`).join('\n')
  const summary = items.slice(0, 5).map(i => `• ${i.title}`).join('\n')
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        type: 'message',
        song_title: `WhatsApp: ${chatName || 'chat'}`,
        message: `Source: ${source || 'forwarded'}\nExtracted ${items.length} items:\n${summary}${actionItems ? '\n\nActions:\n' + actionItems : ''}`,
        patch_name: 'Telegram WhatsApp',
        read: false
      })
    })
  } catch(e) { console.warn('saveWhatsappResults inbox error:', e.message) }

  // Build Telegram reply
  const artistItems = items.filter(i => i.category === 'artist_strategy' || i.category === 'collaboration')
  const firstArtist = artistItems[0]?.title || '—'
  const firstAction = items.find(i => i.action_item)?.action_item || items[0]?.content?.slice(0, 80) || '—'
  const firstNext = items.find(i => i.entry_type === 'question' || i.action_item)?.action_item || '—'

  return (
    `📱 Extracted from WhatsApp:\n` +
    `Artist: ${firstArtist}\n` +
    `Action: ${firstAction}\n` +
    `Next step: ${firstNext}\n` +
    `\n${items.length} items saved to brain + inbox ✓`
  )
}

async function handleOwnerForward(chatId, msg) {
  const chatName = msg.forward_from
    ? (msg.forward_from.first_name || '') + ' ' + (msg.forward_from.last_name || '')
    : (msg.forward_sender_name || 'forwarded')
  const text = msg.text || msg.caption || ''
  if (!text.trim()) {
    await sendTelegram(chatId, '⚠️ Forwarded message has no text to analyze.')
    return
  }
  await sendTelegram(chatId, '⏳ Analyzing forwarded message...')
  try {
    const items = await analyzeWhatsappText(text, chatName.trim())
    if (!items.length) { await sendTelegram(chatId, '🤷 No actionable items found.'); return }
    const reply = await saveWhatsappResults(chatId, items, chatName.trim(), 'telegram_forward')
    await sendTelegram(chatId, reply)
  } catch(e) { await sendTelegram(chatId, '❌ Forward analysis error: ' + e.message) }
}

async function handleOwnerPhoto(chatId, msg) {
  await sendTelegram(chatId, '⏳ Reading photo...')
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    // Get largest photo
    const photos = msg.photo
    const largest = photos[photos.length - 1]
    const fileRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${largest.file_id}`)
    const fileData = await fileRes.json()
    const filePath = fileData.result?.file_path
    if (!filePath) { await sendTelegram(chatId, '❌ Could not get file path from Telegram.'); return }

    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`
    const imgRes = await fetch(fileUrl)
    const imgBuf = await imgRes.arrayBuffer()
    const base64 = Buffer.from(imgBuf).toString('base64')
    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg'

    // Ask Claude to extract text and determine if it's a WhatsApp screenshot
    const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: `This is a screenshot sent by a music producer.
If this is a WhatsApp or messaging app screenshot, extract the full conversation text exactly as written, then reply with:
IS_WHATSAPP: true
CHAT_NAME: [contact name if visible, else "unknown"]
TEXT:
[full conversation text]

If it is not a messaging screenshot, reply with:
IS_WHATSAPP: false
DESCRIPTION: [brief description of what it is]` }
          ]
        }]
      })
    })

    const vd = await visionRes.json()
    const visionText = vd.content?.[0]?.text || ''

    if (visionText.includes('IS_WHATSAPP: true')) {
      const nameMatch = visionText.match(/CHAT_NAME:\s*(.+)/)
      const chatName = nameMatch ? nameMatch[1].trim() : 'screenshot'
      const textStart = visionText.indexOf('TEXT:')
      const extractedText = textStart >= 0 ? visionText.slice(textStart + 5).trim() : visionText

      const items = await analyzeWhatsappText(extractedText, chatName)
      if (!items.length) { await sendTelegram(chatId, '🤷 Photo read but no actionable items found.'); return }
      const reply = await saveWhatsappResults(chatId, items, chatName, 'telegram_photo')
      await sendTelegram(chatId, reply)
    } else {
      const descMatch = visionText.match(/DESCRIPTION:\s*(.+)/)
      const desc = descMatch ? descMatch[1].trim() : visionText.slice(0, 200)
      await sendTelegram(chatId, `📸 Not a WhatsApp screenshot.\nI see: ${desc}\n\nForward a WhatsApp screenshot to extract conversations.`)
    }
  } catch(e) { await sendTelegram(chatId, '❌ Photo error: ' + e.message) }
}

async function handleOwnerCommand(chatId, text) {
  const cmd = text.trim().toLowerCase()
  const apiKey = process.env.ANTHROPIC_API_KEY

  // YES/NO confirmation handling
  if (cmd === 'yes' || cmd === 'ja' || cmd === '/confirm') {
    const pending = pendingConfirmations[chatId]
    if (pending) {
      delete pendingConfirmations[chatId]
      try { await pending.action() } catch(e) { await sendTelegram(chatId, '❌ Error: ' + e.message) }
    } else {
      await sendTelegram(chatId, 'Nothing pending to confirm.')
    }
    return
  }
  if (cmd === 'no' || cmd === 'nein' || cmd === '/cancel') {
    if (pendingConfirmations[chatId]) {
      delete pendingConfirmations[chatId]
      await sendTelegram(chatId, '❌ Cancelled.')
    }
    return
  }

  if (cmd === '/brief' || cmd === '/briefing') {
    await sendTelegram(chatId, '⏳ Generating briefing...')
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/morning-briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const d = await r.json()
      await sendTelegram(chatId, '📋 ' + (d.briefing?.slice(0, 3000) || 'Failed'))
    } catch(e) { await sendTelegram(chatId, '❌ Briefing error: ' + e.message) }
  }
  else if (cmd === '/scout') {
    await sendTelegram(chatId, '⏳ Scouting...')
    try {
      const result = await runAgentScout(apiKey, null)
      await sendTelegram(chatId, '🔍 ' + (result.suggestions?.slice(0, 3000) || 'No suggestions'))
    } catch(e) { await sendTelegram(chatId, '❌ Scout error: ' + e.message) }
  }
  else if (cmd === '/pulse') {
    await sendTelegram(chatId, '⏳ Checking pulse...')
    try {
      await runPulseCheck(apiKey, null)
      await sendTelegram(chatId, '📊 Pulse check complete — check inbox for results.')
    } catch(e) { await sendTelegram(chatId, '❌ Pulse error: ' + e.message) }
  }
  else if (cmd === '/status') {
    try {
      const status = await buildStatusResponse()
      await sendTelegram(chatId,
        '✅ Momentum Status\n' +
        'Brain: ' + status.brain_entry_count + ' entries\n' +
        'Categories: ' + status.brain_categories?.length + '\n' +
        'Anthropic: ' + (status.api_keys_present?.anthropic ? '✅' : '❌') + '\n' +
        'Last error: ' + (status.last_watcher_error || 'none')
      )
    } catch(e) { await sendTelegram(chatId, '❌ Status error: ' + e.message) }
  }
  else if (cmd === '/chart') {
    await sendTelegram(chatId, '⏳ Analyzing charts...')
    try {
      const result = await runAgentChartAnalysis(apiKey)
      const tracks = (result.tracks || []).slice(0, 5)
        .map(t => t.artist + ' — ' + t.title + ' (' + Math.round(t.bpm || 0) + 'bpm ' + (t.camelot || '') + ')')
        .join('\n')
      await sendTelegram(chatId, '🎵 Top tracks:\n' + (tracks || 'No tracks analyzed'))
    } catch(e) { await sendTelegram(chatId, '❌ Chart error: ' + e.message) }
  }
  else if (text.startsWith('/brain ')) {
    const content = text.slice(7).trim()
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          category: 'observation', title: content.slice(0, 60), content,
          entry_type_v2: 'observation', confidence: 'weak', source_type: 'telegram', active: true
        })
      })
      await sendTelegram(chatId, '🧠 Saved to Brain: "' + content.slice(0, 50) + '"')
    } catch(e) { await sendTelegram(chatId, '❌ Brain save error: ' + e.message) }
  }
  else if (text.startsWith('/ask ')) {
    const question = text.slice(5).trim()
    await sendTelegram(chatId, '⏳ Asking Mozart...')
    try {
      const [charts, connRows] = await Promise.allSettled([
        getCrossChartTopics().catch(() => ({ crossChart: [], tiktokOnly: [] })),
        supabase.from('brain_knowledge').select('title, content').eq('category', 'knowledge_connection').eq('active', true).order('created_at', { ascending: false }).limit(5)
      ])
      const ch = charts.status === 'fulfilled' ? charts.value : { crossChart: [], tiktokOnly: [] }
      const mozartChartCtx = [
        ch.crossChart.length ? 'PEAK MOMENTUM (TikTok + Spotify): ' + ch.crossChart.slice(0, 3).map(t => t.artist + ' — ' + t.title).join(', ') : '',
        ch.tiktokOnly.length ? 'EMERGING (TikTok only): ' + ch.tiktokOnly.slice(0, 3).map(t => t.artist + ' — ' + t.title).join(', ') : ''
      ].filter(Boolean).join('\n')
      const connData = connRows.status === 'fulfilled' ? (connRows.value.data || []) : []
      const mozartConnCtx = connData.length
        ? '\n\nKnowledge connections:\n' + connData.map(c => `- ${c.title}: ${(c.content || '').split('\n')[0]}`).join('\n')
        : ''
      const mozartSystem = 'You are Mozart, music production advisor for Remo. Be concise — max 300 words.' +
        (mozartChartCtx ? '\n\nCurrent chart signals:\n' + mozartChartCtx : '') + mozartConnCtx
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 500,
          system: mozartSystem,
          messages: [{ role: 'user', content: question }]
        })
      })
      const d = await r.json()
      await sendTelegram(chatId, '🎹 ' + (d.content?.[0]?.text || 'No response'))
    } catch(e) { await sendTelegram(chatId, '❌ Ask error: ' + e.message) }
  }
  else if (text.startsWith('/obsidian ')) {
    const title = text.slice(10).trim()
    if (!title) { await sendTelegram(chatId, '❌ Usage: /obsidian [note title]'); return }
    try {
      if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) fs.mkdirSync(OBSIDIAN_VAULT_PATH, { recursive: true })
      const filePath = path.join(OBSIDIAN_VAULT_PATH, title + '.md')
      fs.writeFileSync(filePath, `---\ntags: [observation]\ntype: knowledge\nconfidence: medium\n---\n\n`, 'utf8')
      await syncObsidianFile(filePath)
      await sendTelegram(chatId, '📝 Note created in Obsidian: "' + title + '"')
    } catch(e) { await sendTelegram(chatId, '❌ Obsidian error: ' + e.message) }
  }
  else if (text.startsWith('/demo ')) {
    const artist = text.slice(6).trim()
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=title,code,work_data,created_at&title=ilike.*${encodeURIComponent(artist)}*&order=created_at.desc&limit=10`,
        { headers: sbHeaders }
      )
      const songs = await r.json()
      if (!songs.length) { await sendTelegram(chatId, '🔍 No songs found for: ' + artist); return }
      const lines = songs.map(s => {
        const wd = s.work_data || {}
        const stage = wd.current_stage || 'demo'
        const versions = (wd.versions || []).length
        return `${s.code} — ${s.title} | stage: ${stage} | versions: ${versions}`
      }).join('\n')
      await sendTelegram(chatId, '🎵 Demo status for "' + artist + '":\n' + lines)
    } catch(e) { await sendTelegram(chatId, '❌ Demo error: ' + e.message) }
  }
  else if (text.startsWith('/mix ')) {
    const songQuery = text.slice(5).trim()
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=title,code,work_data,audio_analysis&title=ilike.*${encodeURIComponent(songQuery)}*&limit=3`,
        { headers: sbHeaders }
      )
      const songs = await r.json()
      if (!songs.length) { await sendTelegram(chatId, '🔍 No songs found for: ' + songQuery); return }
      const s = songs[0]
      const aa = s.audio_analysis || {}
      const wd = s.work_data || {}
      const gap = []
      if (aa.bpm)       gap.push(`BPM: ${Math.round(aa.bpm)}`)
      if (aa.key)       gap.push(`Key: ${aa.key} ${aa.scale || ''} (${aa.camelot || ''})`)
      if (aa.energy != null)      gap.push(`Energy: ${(aa.energy * 100).toFixed(0)}%`)
      if (aa.loudness_lufs != null) gap.push(`Loudness: ${aa.loudness_lufs.toFixed(1)} LUFS`)
      const stage = wd.current_stage || 'unknown'
      const msg = `🎛 Mix gap — ${s.code} ${s.title}\nStage: ${stage}\n` + (gap.join(' | ') || 'No analysis yet — run /analyze-spotify-track first')
      await sendTelegram(chatId, msg)
    } catch(e) { await sendTelegram(chatId, '❌ Mix error: ' + e.message) }
  }
  else if (text.startsWith('/ref ')) {
    const spotifyUrl = text.slice(5).trim()
    await sendTelegram(chatId, '⏳ Analyzing track...')
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/analyze-spotify-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: spotifyUrl, apiKey })
      })
      const d = await r.json()
      if (!d.ok) { await sendTelegram(chatId, '❌ Analysis failed: ' + (d.error || 'unknown')); return }
      const summary = `🎵 ${d.artist} — ${d.title}\nBPM: ${Math.round(d.bpm || 0)} | Key: ${d.key} ${d.scale || ''} (${d.camelot || ''})\nEnergy: ${((d.energy || 0) * 100).toFixed(0)}% | Dance: ${((d.danceability || 0) * 100).toFixed(0)}%\n\nSave to brain? Reply YES to confirm.`
      pendingConfirmations[chatId] = {
        action: async () => {
          await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              category: 'reference_current', title: d.artist + ' — ' + d.title,
              content: `BPM: ${Math.round(d.bpm || 0)}, Key: ${d.key} ${d.scale||''} (${d.camelot||''}), Energy: ${((d.energy||0)*100).toFixed(0)}%, Dance: ${((d.danceability||0)*100).toFixed(0)}%`,
              source_type: 'telegram', entry_type_v2: 'reference', confidence: 'strong', active: true
            })
          })
          await sendTelegram(chatId, '🧠 Reference saved: ' + d.artist + ' — ' + d.title)
        }
      }
      await sendTelegram(chatId, summary)
    } catch(e) { await sendTelegram(chatId, '❌ Ref error: ' + e.message) }
  }
  else if (text.startsWith('/credits ')) {
    const query = text.slice(9).trim()
    await sendTelegram(chatId, '⏳ Looking up credits for ' + query + '...')
    try {
      const parts = query.split(' - ')
      const [artistQ, titleQ] = parts.length >= 2 ? [parts[0].trim(), parts.slice(1).join(' - ').trim()] : [query, query]
      const credits = await fetchGeniusCredits(artistQ, titleQ)
      if (!credits || (!credits.producers?.length && !credits.writers?.length)) {
        await sendTelegram(chatId, '❌ No credits found for: ' + query + '\nTry: /credits Artist - Title')
        return
      }
      let msg = '🎵 Credits: ' + query
      if (credits.producers?.length) msg += '\n\n🎛 Produced by: ' + credits.producers.join(', ')
      if (credits.mixers?.length) msg += '\n🔊 Mixed by: ' + credits.mixers.join(', ')
      if (credits.masterers?.length) msg += '\n💿 Mastered by: ' + credits.masterers.join(', ')
      if (credits.writers?.length) msg += '\n✍️ Written by: ' + credits.writers.slice(0,4).join(', ')
      await sendTelegram(chatId, msg)
    } catch(e) { await sendTelegram(chatId, '❌ Credits error: ' + e.message) }
  }
  else if (cmd === '/morning') {
    await sendTelegram(chatId, '⏳ Running full morning agents...')
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/run-morning-agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const d = await r.json()
      if (d.scout?.suggestions)
        await sendTelegram(chatId, '🔍 Scout:\n' + d.scout.suggestions.slice(0, 1000))
      if (d.trends?.trends)
        await sendTelegram(chatId, '📱 TikTok:\n' + d.trends.trends.slice(0, 1000))
      if (d.chart?.assessment)
        await sendTelegram(chatId, '🎵 Charts:\n' + d.chart.assessment.slice(0, 1000))
      await sendTelegram(chatId, '✅ Morning agents complete — check inbox for full results.')
    } catch(e) { await sendTelegram(chatId, '❌ Morning run error: ' + e.message) }
  }
  else if (cmd === '/contacts') {
    const list = getWaContacts()
    if (!list.length) {
      await sendTelegram(chatId, '📱 No contacts monitored.\nUse /monitor [name] to add one.')
    } else {
      await sendTelegram(chatId, '📱 Monitored WhatsApp contacts:\n' + list.map(c => '• ' + c).join('\n') + '\n\nUse /monitor [name] to add, /unmonitor [name] to remove.')
    }
  }
  else if (text.startsWith('/monitor ')) {
    const name = text.slice(9).trim()
    if (!name) { await sendTelegram(chatId, '❌ Usage: /monitor [contact name]'); return }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/whatsapp-add-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: name })
      })
      const d = await r.json()
      await sendTelegram(chatId, d.ok
        ? `✅ ${d.message}\nNow monitoring: ${(d.contacts || []).join(', ')}`
        : '❌ ' + (d.error || 'Unknown error'))
    } catch(e) { await sendTelegram(chatId, '❌ Monitor error: ' + e.message) }
  }
  else if (text.startsWith('/unmonitor ')) {
    const name = text.slice(11).trim()
    if (!name) { await sendTelegram(chatId, '❌ Usage: /unmonitor [contact name]'); return }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/whatsapp-add-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: name, remove: true })
      })
      const d = await r.json()
      const remaining = (d.contacts || [])
      await sendTelegram(chatId, d.ok
        ? `✅ ${d.message}\n` + (remaining.length ? 'Still monitoring: ' + remaining.join(', ') : 'No contacts monitored.')
        : '❌ ' + (d.error || 'Unknown error'))
    } catch(e) { await sendTelegram(chatId, '❌ Unmonitor error: ' + e.message) }
  }
  else if (text.startsWith('/whatsapp ')) {
    const chatText = text.slice(10).trim()
    if (!chatText) { await sendTelegram(chatId, '❌ Usage: /whatsapp [paste chat text here]'); return }
    await sendTelegram(chatId, '⏳ Analyzing chat...')
    try {
      const items = await analyzeWhatsappText(chatText, 'pasted')
      if (!items.length) { await sendTelegram(chatId, '🤷 No actionable items found.'); return }
      const reply = await saveWhatsappResults(chatId, items, 'pasted', 'telegram_whatsapp_cmd')
      await sendTelegram(chatId, reply)
    } catch(e) { await sendTelegram(chatId, '❌ WhatsApp analyze error: ' + e.message) }
  }
  else if (cmd === '/crypto') {
    await sendTelegram(chatId, '⏳ Fetching crypto signal...')
    try {
      const crypto = await buildCryptoSignal()
      const d = crypto.btc_derivatives || {}
      let msg = '📊 CRYPTO SIGNAL: ' + crypto.emoji + ' ' + crypto.signal
      msg += '\n\nBTC: €' + Math.round(crypto.btcPrice).toLocaleString() +
        ' (' + (crypto.btcChange24h > 0 ? '+' : '') + crypto.btcChange24h?.toFixed(1) + '% 24h)'
      msg += '\nETH: €' + Math.round(crypto.ethPrice).toLocaleString() +
        ' (' + (crypto.ethChange24h > 0 ? '+' : '') + crypto.ethChange24h?.toFixed(1) + '% 24h)'
      msg += '\nFear & Greed: ' + crypto.fearGreed.value + ' (' + crypto.fearGreed.label + ')'
      if (crypto.funding !== null) msg += '\nFunding: ' + crypto.funding.toFixed(3) + '%'
      msg += '\nBTC Dominance: ' + crypto.dominance + '%'
      msg += '\nAltseason: ' + crypto.altseasonSignal
      // Derivatives block
      if (d.long_pct != null || d.oi_trend || d.taker_buy_ratio != null || d.top_trader_long_pct != null) {
        msg += '\n\n📊 Derivatives:'
        if (d.long_pct != null) msg += '\nLongs: ' + d.long_pct.toFixed(0) + '% ' + (d.long_trend === 'increasing' ? '↑' : '↓')
        if (d.oi_trend) msg += '\nOpen Interest: ' + (d.oi_trend === 'rising' ? '↑ rising' : '↓ falling') + (d.oi_change_pct != null ? ' (' + d.oi_change_pct + '% 6h)' : '')
        if (d.taker_buy_ratio != null) msg += '\nTaker ratio: ' + d.taker_buy_ratio.toFixed(2) + (d.taker_buy_ratio > 1 ? ' (buyers aggressive)' : ' (sellers aggressive)')
        if (d.top_trader_long_pct != null) msg += '\nSmart money: ' + d.top_trader_long_pct.toFixed(0) + '% long'
      }
      if (crypto.trend_4h) msg += '\n4H Trend: ' + (crypto.trend_4h === 'uptrend' ? '↑ uptrend' : '↓ downtrend') + (crypto.ma5_4h ? ' | MA5: €' + crypto.ma5_4h.toLocaleString() : '')
      msg += '\n\n' + crypto.suggestion
      if (crypto.reasons.length) msg += '\n\nReasons:\n' + crypto.reasons.map(r => '· ' + r).join('\n')
      if (crypto.personal_advice) msg += '\n\n' + crypto.personal_advice.trim()
      if (crypto.active_trades?.length) {
        msg += '\n\n🔵 Active Trades:'
        for (const t of crypto.active_trades) {
          msg += '\n' + t.coin + ' entry €' + Math.round(t.entry_price).toLocaleString() +
            ' → ' + (t.pnl_pct > 0 ? '+' : '') + (t.pnl_pct?.toFixed(1) || '?') + '%' +
            ' (€' + Math.round(t.pnl_eur || 0) + ')'
        }
      }
      if (crypto.binanceAction === 'buy') msg += '\n\n→ Open Binance: ' + crypto.binanceDeepLink
      if (crypto.binanceAction === 'sell') {
        try {
          const portRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.crypto_portfolio&select=value`, { headers: sbHeaders })
          const portData = await portRes.json()
          const portfolio = portData[0]?.value ? JSON.parse(portData[0].value) : []
          const btcHoldings = portfolio.filter(p => p.coin === 'BTC')
          const ethHoldings = portfolio.filter(p => p.coin === 'ETH')
          if (btcHoldings.length || ethHoldings.length) {
            msg += '\n\n💰 If you sell now:'
            for (const h of btcHoldings) {
              const cur = h.amount * crypto.btcPrice
              const profit = cur - h.amount * h.entryPrice
              const pct = ((profit / (h.amount * h.entryPrice)) * 100).toFixed(1)
              msg += '\nBTC ' + h.amount + ' → €' + Math.round(cur).toLocaleString() +
                ' (' + (profit > 0 ? '+' : '') + '€' + Math.round(profit) + ' / ' + pct + '%)'
            }
            for (const h of ethHoldings) {
              const cur = h.amount * crypto.ethPrice
              const profit = cur - h.amount * h.entryPrice
              const pct = ((profit / (h.amount * h.entryPrice)) * 100).toFixed(1)
              msg += '\nETH ' + h.amount + ' → €' + Math.round(cur).toLocaleString() +
                ' (' + (profit > 0 ? '+' : '') + '€' + Math.round(profit) + ' / ' + pct + '%)'
            }
            msg += '\n\n/sell to prepare BTC sell · /selleth for ETH'
          }
        } catch(e) { console.warn('Portfolio profit calc error:', e.message) }
      }
      await sendTelegram(chatId, msg)
    } catch(e) { await sendTelegram(chatId, '❌ Crypto signal error: ' + e.message) }
  }
  else if (cmd.startsWith('/buy')) {
    const isEth = cmd.toLowerCase().includes('eth')
    const coin = isEth ? 'ETH' : 'BTC'
    const parts = text.trim().split(/\s+/)
    const amountEur = parseFloat(parts[1]) || 500
    try {
      const btcData = await fetchBTCData()
      const price = coin === 'BTC' ? btcData?.bitcoin?.eur : btcData?.ethereum?.eur
      if (!price) { await sendTelegram(chatId, '❌ Could not fetch ' + coin + ' price'); return }
      const coinAmount = amountEur / price
      const currentSignalStr = lastSignalResult?.signal || 'unknown'
      pendingConfirmations[chatId] = {
        action: async () => {
          await fetch(`${SUPABASE_URL}/rest/v1/crypto_trades`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              coin, amount_coin: coinAmount, amount_eur: amountEur,
              price_eur: Math.round(price), type: 'buy',
              traded_at: new Date().toISOString(),
              source: 'telegram_signal', notes: 'Signal: ' + currentSignalStr
            })
          })
          await fetch(`${SUPABASE_URL}/rest/v1/active_trades?on_conflict=coin`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              coin, entry_price: price, amount: coinAmount, amount_eur: amountEur,
              entry_signal: currentSignalStr, entry_time: new Date().toISOString(), status: 'open'
            })
          })
          await sendTelegram(chatId,
            '✅ Buy logged!\n' +
            coin + ' ' + coinAmount.toFixed(8) + '\n' +
            'Invested: €' + amountEur + ' at €' + Math.round(price).toLocaleString() + '\n' +
            'Signal: ' + currentSignalStr + '\n\n' +
            '→ Binance: https://www.binance.com/en/trade/' + coin + '_EUR'
          )
        }
      }
      await sendTelegram(chatId,
        '⚡ Buy prepared:\n\n' +
        'Buy €' + amountEur + ' of ' + coin + '\n' +
        '≈ ' + coinAmount.toFixed(8) + ' ' + coin + '\n' +
        'Price: €' + Math.round(price).toLocaleString() + '\n' +
        'Signal: ' + currentSignalStr + '\n\n' +
        '→ Open Binance first: https://www.binance.com/en/trade/' + coin + '_EUR\n' +
        'Reply YES to log · NO to cancel'
      )
    } catch(e) { await sendTelegram(chatId, '❌ Buy error: ' + e.message) }
  }
  else if (cmd.match(/^\/(trade|tradeeth|tradedoge|tradexrp|tradefloki)\d+$/i)) {
    const COIN_MAP = { tradefloki: 'FLOKI', tradedoge: 'DOGE', tradexrp: 'XRP', tradeeth: 'ETH', trade: 'BTC' }
    const BINANCE_PAIRS = { BTC: 'BTC_EUR', ETH: 'ETH_EUR', DOGE: 'DOGE_EUR', XRP: 'XRP_EUR', FLOKI: 'FLOKI_USDT' }
    const prefix = Object.keys(COIN_MAP).find(p => cmd.toLowerCase().startsWith('/' + p))
    if (prefix) {
      const coin = COIN_MAP[prefix]
      const amount = parseInt(cmd.slice(prefix.length + 1))
      if (!amount || isNaN(amount)) { await sendTelegram(chatId, '❌ Usage: /trade100 /tradeeth100 /tradedoge100 /tradexrp100 /tradefloki100'); return }
      try {
        const prices = await fetchAllCoinPrices()
        const price = prices[coin]?.price
        if (!price) { await sendTelegram(chatId, '❌ Price unavailable for ' + coin); return }
        const coinAmount = (amount / price).toFixed(coin === 'BTC' ? 8 : 4)
        const pair = BINANCE_PAIRS[coin] || coin + '_EUR'
        const binanceUrl = 'https://www.binance.com/en/trade/' + pair
        pendingConfirmations[chatId] = {
          action: async () => {
            await fetch(`${SUPABASE_URL}/rest/v1/crypto_trades`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                coin, amount_coin: parseFloat(coinAmount), amount_eur: amount,
                price_eur: price < 1 ? price : Math.round(price), type: 'buy',
                traded_at: new Date().toISOString(), source: 'telegram_trade'
              })
            }).catch(() => {})
            await fetch(`${SUPABASE_URL}/rest/v1/active_trades?on_conflict=coin`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                coin, entry_price: price, amount: parseFloat(coinAmount), amount_eur: amount,
                entry_time: new Date().toISOString(), status: 'open'
              })
            }).catch(() => {})
            await sendTelegram(chatId,
              '✅ Buy logged!\n' +
              coinAmount + ' ' + coin + '\n' +
              'Invested: €' + amount + ' at €' + (price < 0.01 ? price.toFixed(6) : price < 1 ? price.toFixed(4) : Math.round(price).toLocaleString()) + '\n\n' +
              '→ Binance: ' + binanceUrl
            )
          }
        }
        await sendTelegram(chatId,
          '⚡ Trade prepared:\n\n' +
          'Buy: ' + coinAmount + ' ' + coin + '\n' +
          'Amount: €' + amount + '\n' +
          'Price: €' + (price < 0.01 ? price.toFixed(6) : price < 1 ? price.toFixed(4) : Math.round(price).toLocaleString()) + '\n\n' +
          '→ Open Binance: ' + binanceUrl + '\n\n' +
          'Reply YES to log · NO to cancel'
        )
      } catch(e) { await sendTelegram(chatId, '❌ Trade error: ' + e.message) }
    }
  }
  else if (cmd.startsWith('/sell')) {
    let coin = 'BTC'
    if (cmd.includes('eth')) coin = 'ETH'
    else if (cmd.includes('doge')) coin = 'DOGE'
    else if (cmd.includes('xrp')) coin = 'XRP'
    else if (cmd.includes('floki')) coin = 'FLOKI'
    const BINANCE_PAIRS = { BTC: 'BTC_EUR', ETH: 'ETH_EUR', DOGE: 'DOGE_EUR', XRP: 'XRP_EUR', FLOKI: 'FLOKI_USDT' }
    try {
      const prices = await fetchAllCoinPrices()
      const price = prices[coin]?.price
      if (!price) { await sendTelegram(chatId, '❌ Price unavailable for ' + coin); return }
      const atRes = await fetch(`${SUPABASE_URL}/rest/v1/active_trades?coin=eq.${coin}&status=eq.open&select=*`, { headers: sbHeaders })
      const atData = await atRes.json()
      const trade = Array.isArray(atData) ? atData[0] : null
      if (!trade) { await sendTelegram(chatId, 'No open ' + coin + ' position found'); return }
      const amount = trade.amount || 0
      const entryPrice = trade.entry_price || price
      const currentValue = amount * price
      const cost = amount * entryPrice
      const profit = currentValue - cost
      const pct = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '0.0'
      const binanceUrl = 'https://www.binance.com/en/trade/' + (BINANCE_PAIRS[coin] || coin + '_EUR')
      const fmtPrice = p => p < 0.01 ? p.toFixed(6) : p < 1 ? p.toFixed(4) : Math.round(p).toLocaleString()
      pendingConfirmations[chatId] = {
        action: async () => {
          await fetch(`${SUPABASE_URL}/rest/v1/crypto_trades`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              coin, amount_coin: amount, amount_eur: Math.round(currentValue),
              price_eur: price < 1 ? price : Math.round(price), type: 'sell',
              traded_at: new Date().toISOString(), source: 'telegram_signal',
              notes: 'Profit: €' + Math.round(profit)
            })
          }).catch(() => {})
          await fetch(`${SUPABASE_URL}/rest/v1/active_trades?coin=eq.${coin}`, {
            method: 'PATCH',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ status: 'closed' })
          }).catch(() => {})
          await sendTelegram(chatId, '✅ Sell logged. ' + coin + ' position closed.\nProfit: ' + (profit > 0 ? '+' : '') + '€' + Math.round(profit))
        }
      }
      await sendTelegram(chatId,
        '⚡ Sell prepared:\n\n' +
        'Sell: ' + amount.toFixed(coin === 'BTC' ? 8 : 4) + ' ' + coin + '\n' +
        'Value now: €' + fmtPrice(currentValue) + '\n' +
        'Entry: €' + fmtPrice(entryPrice) + '\n' +
        'Profit: ' + (profit > 0 ? '+' : '') + '€' + Math.round(profit) + ' (' + pct + '%)\n\n' +
        '→ Open Binance: ' + binanceUrl + '\n\n' +
        'Reply YES to log · NO to cancel'
      )
    } catch(e) { await sendTelegram(chatId, '❌ Sell error: ' + e.message) }
  }
  else if (cmd === '/portfolio') {
    try {
      const [portRes, btcData, binance] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.crypto_portfolio&select=value`, { headers: sbHeaders }),
        fetchBTCData(),
        fetchBinancePortfolio()
      ])
      const portData = await portRes.json()
      const portfolio = portData[0]?.value ? JSON.parse(portData[0].value) : []
      let msg = '📊 Portfolio\n'
      if (portfolio.length) {
        for (const h of portfolio) {
          const price = h.coin === 'BTC' ? btcData?.bitcoin?.eur : btcData?.ethereum?.eur
          if (!price) { msg += '\n' + h.coin + ': ' + h.amount; continue }
          const cur = h.amount * price
          const profit = cur - h.amount * h.entryPrice
          const pct = ((profit / (h.amount * h.entryPrice)) * 100).toFixed(1)
          msg += '\n' + h.coin + ' ' + h.amount + ' @ €' + h.entryPrice.toLocaleString() +
            ' → €' + Math.round(cur).toLocaleString() +
            ' (' + (profit > 0 ? '+' : '') + '€' + Math.round(profit) + ' / ' + pct + '%)'
        }
      } else { msg += 'No holdings tracked.' }
      if (binance?.length) {
        msg += '\n\n🔴 Live Binance:'
        for (const b of binance.filter(b => ['BTC','ETH','EUR','USDT','BNB'].includes(b.coin))) {
          if (b.coin === 'BTC') msg += '\nBTC: ' + b.total.toFixed(6) + ' = €' + Math.round(b.total * btcData.bitcoin.eur).toLocaleString()
          else if (b.coin === 'ETH') msg += '\nETH: ' + b.total.toFixed(4) + ' = €' + Math.round(b.total * btcData.ethereum.eur).toLocaleString()
          else msg += '\n' + b.coin + ': ' + b.total.toFixed(2)
        }
      }
      await sendTelegram(chatId, msg)
    } catch(e) { await sendTelegram(chatId, '❌ Portfolio error: ' + e.message) }
  }
  else if (cmd === '/hold') {
    lastExitAlertSent['BTC'] = Date.now()
    lastExitAlertSent['ETH'] = Date.now()
    await sendTelegram(chatId, '👍 Holding position — exit alerts snoozed for 3 hours')
  }
  else if (cmd === '/enrich') {
    await sendTelegram(chatId, '⏳ Enriching all contacts...')
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/enrich-all-contacts`, { method: 'POST' })
      const d = await r.json()
      const enriched = d.results?.filter(x => x.status === 'enriched') || []
      const tiktokFound = enriched.filter(x => x.found?.includes('tiktok')).length
      const spotifyFound = enriched.filter(x => x.found?.includes('spotify_id')).length
      const igFound = enriched.filter(x => x.found?.includes('instagram')).length
      await sendTelegram(chatId,
        `✓ Enriched ${enriched.length} contacts\n` +
        `Found TikTok: ${tiktokFound}\n` +
        `Found Spotify: ${spotifyFound}\n` +
        `Found Instagram: ${igFound}`
      )
    } catch(e) { await sendTelegram(chatId, '❌ Enrich error: ' + e.message) }
  }
  else if (cmd === '/improve') {
    await sendTelegram(chatId, '⏳ Analyzing system...')
    await weeklySystemReview()
  }
  else if (cmd === '/next') {
    await sendTelegram(chatId, '⏳ Analyzing all coins...')
    try {
      const { data: active } = await supabase
        .from('active_trades').select('coin').eq('status','open').maybeSingle()
      const exclude = active?.coin
      const scores = await recommendNextCoin(exclude)
      const prices = await fetchAllCoinPrices()
      let msg = '🎯 NEXT COIN RANKING\n\n'
      if (exclude) msg += '(Excluding current position: ' + exclude + ')\n\n'
      for (const s of scores) {
        const p = prices[s.coin]
        const fmtP = v => v < 0.01 ? v?.toFixed(6) : v < 1 ? v?.toFixed(4) : v?.toLocaleString()
        msg += s.coin + ' — Score: ' + s.score + '/10\n'
        msg += 'Price: €' + fmtP(p?.price) + '\n'
        msg += '24h: ' + (p?.change24h > 0 ? '+' : '') + p?.change24h?.toFixed(1) + '%\n'
        msg += (s.reasons.slice(0,2).map(r => '· ' + r).join('\n') || '· No signal') + '\n\n'
      }
      msg += 'To buy:\n'
      msg += '/trade100 (BTC) · /tradeeth100 (ETH)\n'
      msg += '/tradedoge100 · /tradexrp100 · /tradefloki100'
      await sendTelegram(chatId, msg)
    } catch(e) { await sendTelegram(chatId, '❌ Next coin error: ' + e.message) }
  }
  else if (cmd === '/tiktok') {
    await sendTelegram(chatId, '⏳ Fetching TikTok top 10...')
    fetch('http://localhost:4242/agent-tiktok-trends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: process.env.ANTHROPIC_API_KEY })
    }).then(r => r.json()).then(() => {
      sendTelegram(chatId, '✓ TikTok trends updated — check Brain CHECKOUT')
    }).catch(e => sendTelegram(chatId, '✗ Error: ' + e.message))
  }
  else if (cmd === '/connect') {
    await sendTelegram(chatId, '⏳ Analyzing brain connections...')
    try {
      await connectBrainEntries()
      await sendTelegram(chatId, '✓ Brain connection analysis complete')
    } catch(e) { await sendTelegram(chatId, '❌ Connect error: ' + e.message) }
  }
  else if (cmd === '/cleanup') {
    const count = await runTelegramCleanup()
    await sendTelegram(chatId, '🗑 Deleted ' + count + ' messages older than 24h')
  }
  else if (cmd === '/help') {
    await sendTelegram(chatId,
      '🎵 Momentum Commands:\n\n' +
      '/brief — Morning briefing\n' +
      '/scout — Scout breaking artists\n' +
      '/pulse — Market pulse check\n' +
      '/chart — Top chart tracks\n' +
      '/status — System status\n' +
      '/brain [text] — Save to Brain\n' +
      '/ask [question] — Ask Mozart\n' +
      '/morning — Full morning agent run\n' +
      '/crypto — Live BTC/ETH signal + Fear & Greed\n' +
      '/next — Best coin to buy next\n' +
      '/buy [€] — Log BTC buy (default €500)\n' +
      '/buyeth [€] — Log ETH buy\n' +
      '/trade100 — Prepare €100 BTC buy\n' +
      '/tradeeth100 — Prepare €100 ETH buy\n' +
      '/tradedoge100 — Prepare €100 DOGE buy\n' +
      '/tradexrp100 — Prepare €100 XRP buy\n' +
      '/tradefloki100 — Prepare €100 FLOKI buy\n' +
      '/sell — Prepare BTC sell (full position)\n' +
      '/selleth — Prepare ETH sell\n' +
      '/selldoge — Prepare DOGE sell\n' +
      '/sellxrp — Prepare XRP sell\n' +
      '/sellfloki — Prepare FLOKI sell\n' +
      '/hold — Snooze exit alerts 3h\n' +
      '/portfolio — Live P&L + Binance balances\n' +
      '/obsidian [title] — Create Obsidian note\n' +
      '/demo [artist] — Check demo status\n' +
      '/mix [song] — Get mix gap analysis\n' +
      '/ref [spotify url] — Analyze reference track\n' +
      '/credits [Artist - Title] — Who produced/mixed/mastered it\n' +
      '/whatsapp [text] — Analyze pasted chat\n' +
      '/contacts — Show monitored WhatsApp contacts\n' +
      '/monitor [name] — Add contact to monitor list\n' +
      '/unmonitor [name] — Remove from monitor list\n' +
      '/enrich — Bulk enrich all contacts\n' +
      '/improve — Weekly system improvement review\n' +
      '/tiktok — Fetch TikTok trending sounds now\n' +
      '/connect — Find connections between brain entries\n' +
      '/cleanup — Delete bot messages older than 24h\n' +
      '📷 Send photo — Extract WhatsApp screenshot\n' +
      '↩️ Forward message — Auto-analyze forwarded chat\n' +
      '/help — This message'
    )
  }
  else {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          category: 'observation', title: text.slice(0, 60), content: text,
          entry_type_v2: 'observation', confidence: 'weak', source_type: 'telegram', active: true
        })
      })
      await sendTelegram(chatId, '🧠 Saved to Brain')
    } catch(e) { await sendTelegram(chatId, '❌ Save error: ' + e.message) }
  }
}

async function handleArtistMessage(chatId, fromId, firstName, text) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        type: 'message',
        song_title: 'Telegram: ' + firstName,
        message: '[from: ' + firstName + ' | telegram_id: ' + fromId + ']\n' + text,
        patch_name: 'Telegram',
        read: false
      })
    })
  } catch(e) { console.warn('Telegram inbox save error:', e.message) }
  await sendTelegram(chatId, '✅ Message received! Remo will get back to you soon.')
  await sendTelegram(TELEGRAM_OWNER_ID, '📩 Message from ' + firstName + ':\n' + text)
}

async function pollTelegram() {
  let offset = 0
  setInterval(async () => {
    try {
      const res = await fetch(TELEGRAM_API + '/getUpdates?offset=' + offset + '&timeout=5')
      const data = await res.json()
      for (const update of (data.result || [])) {
        offset = update.update_id + 1
        const msg = update.message
        if (!msg) continue
        const chatId = msg.chat.id
        const text = msg.text || ''
        const fromId = msg.from.id
        if (fromId === TELEGRAM_OWNER_ID) {
          if (msg.photo) {
            await handleOwnerPhoto(chatId, msg)
          } else if (msg.forward_from || msg.forward_date || msg.forward_sender_name) {
            await handleOwnerForward(chatId, msg)
          } else {
            await handleOwnerCommand(chatId, text)
          }
        } else {
          await handleArtistMessage(chatId, fromId, msg.from.first_name, text)
        }
      }
    } catch(e) { console.error('Telegram poll error:', e.message) }
  }, 3000)
}

let _lastNotifId = 0
let _lastBrainCount = 0

async function pollInboxNotifications() {
  // Seed the baseline on first run — don't flood with existing notifications
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/inbox_notifications?select=id&order=id.desc&limit=1`,
      { headers: sbHeaders }
    )
    const rows = await r.json()
    _lastNotifId = rows?.[0]?.id || 0
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/brain_knowledge?select=id&limit=1`,
      { headers: { ...sbHeaders, 'Prefer': 'count=exact' } }
    )
    _lastBrainCount = parseInt(cr.headers.get('content-range')?.split('/')[1] || '0')
  } catch(e) {}

  setInterval(async () => {
    try {
      // New feedback / download notifications
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/inbox_notifications?id=gt.${_lastNotifId}&type=in.(feedback,download)&select=id,type,song_title,artist,message&order=id.asc`,
        { headers: sbHeaders }
      )
      const rows = await r.json()
      for (const n of (Array.isArray(rows) ? rows : [])) {
        _lastNotifId = Math.max(_lastNotifId, n.id)
        if (n.type === 'feedback') {
          await sendTelegram(TELEGRAM_OWNER_ID,
            '💬 New feedback on <b>' + (n.song_title || 'track') + '</b>\n' + (n.message || '').slice(0, 300)
          ).catch(() => {})
        } else if (n.type === 'download') {
          await sendTelegram(TELEGRAM_OWNER_ID,
            '⬇️ Download: <b>' + (n.song_title || n.artist || 'track') + '</b>'
          ).catch(() => {})
        }
      }

      // Brain milestone check
      const cr = await fetch(
        `${SUPABASE_URL}/rest/v1/brain_knowledge?select=id&limit=1`,
        { headers: { ...sbHeaders, 'Prefer': 'count=exact' } }
      )
      const newCount = parseInt(cr.headers.get('content-range')?.split('/')[1] || '0')
      for (const milestone of [50, 100, 200, 300, 500]) {
        if (_lastBrainCount < milestone && newCount >= milestone) {
          await sendTelegram(TELEGRAM_OWNER_ID, '🧠 Brain milestone: ' + milestone + ' entries!').catch(() => {})
        }
      }
      _lastBrainCount = newCount
    } catch(e) {}
  }, 30000)
}

// ── Export brain_knowledge entries as Obsidian .md files ─────────────────
async function brainToObsidian() {
  if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) fs.mkdirSync(OBSIDIAN_VAULT_PATH, { recursive: true })
  const brainRes = await fetch(
    `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=id,title,category,content,confidence,entry_type_v2,source_type,source_url,created_at,metadata,priority,collection_name_display&order=created_at.desc&limit=500`,
    { headers: sbHeaders }
  )
  const brainRaw = await brainRes.json()
  const safeEntries = Array.isArray(brainRaw) ? brainRaw : []

  const allTitles = safeEntries
    .map(e => (e.title || '').trim())
    .filter(t => t.length > 4)
    .sort((a, b) => b.length - a.length)

  const CATEGORY_LINKS = {
    'goal':              ['[[Active Goals]]', '[[Hit Benchmark]]', '[[Daft Punk Model]]'],
    'mixing_technique':  ['[[Hit Benchmark]]', '[[Reference Tracks]]', '[[Music Tips]]'],
    'reference_current': ['[[Hit Benchmark]]', '[[Mixing Technique]]', '[[Reference Tracks]]'],
    'artist_strategy':   ['[[Release Strategy]]', '[[Social Media]]', '[[Networking]]'],
    'market_knowledge':  ['[[Artist Strategy]]', '[[Hit Benchmark]]', '[[Market Intelligence]]'],
    'own_production':    ['[[Hit Benchmark]]', '[[My Productions]]', '[[Mixing Technique]]'],
    'contact_profile':   ['[[Networking]]', '[[Artist Strategy]]', '[[Contact Directory]]'],
    'production_style':  ['[[Music Tips]]', '[[Mixing Technique]]', '[[Creative Process]]'],
    'creative_process':  ['[[Music Tips]]', '[[Production Style]]', '[[Active Goals]]'],
    'business':          ['[[Active Goals]]', '[[Release Strategy]]'],
    'business_finance':  ['[[Active Goals]]', '[[Business]]'],
    'collaboration':     ['[[Artist Strategy]]', '[[Networking]]', '[[Contact Directory]]'],
    'industry_insight':  ['[[Market Intelligence]]', '[[Artist Strategy]]'],
    'networking':        ['[[Contact Directory]]', '[[Artist Strategy]]'],
    'release_strategy':  ['[[Active Goals]]', '[[Artist Strategy]]'],
    'social_media':      ['[[Artist Strategy]]', '[[Release Strategy]]'],
    'sound_design':      ['[[Music Tips]]', '[[Production Style]]', '[[Mixing Technique]]'],
    'observation':       ['[[NOW]]'],
    'question':          ['[[NOW]]', '[[Active Goals]]']
  }

  const titleKeywords = allTitles.map(t => ({
    full: t,
    key: t.split(/\s+/).slice(0, 3).join(' ')
  })).filter(t => t.key.length > 4)

  function findContentLinks(content, ownTitle) {
    const found = new Set()
    for (const { full, key } of titleKeywords) {
      if (full === ownTitle) continue
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(content)) found.add(`[[${full}]]`)
    }
    return [...found].slice(0, 8)
  }

  let written = 0
  for (const e of safeEntries) {
    const safeName = (e.title || 'untitled').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 100)
    const filePath = path.join(OBSIDIAN_VAULT_PATH, safeName + '.md')
    const createdDate = e.created_at ? new Date(e.created_at).toLocaleDateString() : ''
    const tags = [e.category || 'knowledge', e.entry_type_v2 || 'knowledge']
    if (e.priority) tags.push('priority')
    const fm = [
      '---',
      `category: ${e.category || 'knowledge'}`,
      `confidence: ${e.confidence || 'medium'}`,
      `type: ${e.entry_type_v2 || 'knowledge'}`,
      `source: ${e.source_type || 'manual'}`,
      `created: ${e.created_at || ''}`,
      e.collection_name_display ? `collection: ${e.collection_name_display}` : null,
      `tags: [${tags.join(', ')}]`,
      '---'
    ].filter(l => l !== null).join('\n')
    const catLinks = CATEGORY_LINKS[e.category] || []
    const contentLinks = findContentLinks(e.content || '', e.title || '')
    const allLinks = [...new Set([...catLinks, ...contentLinks])]
    const relatedSection = allLinks.length ? `\n\n## Related\n${allLinks.join(' ')}` : ''
    const footer = [
      '',
      '---',
      e.source_url ? `*Source: ${e.source_url}*` : null,
      createdDate ? `*Added: ${createdDate}*` : null
    ].filter(l => l !== null).join('\n')
    let outPath = filePath
    if (e.collection_name_display) {
      const colDir = path.join(OBSIDIAN_VAULT_PATH, 'Collections', e.collection_name_display.replace(/[\/\\:*?"<>|]/g, '-'))
      if (!fs.existsSync(colDir)) fs.mkdirSync(colDir, { recursive: true })
      outPath = path.join(colDir, safeName + '.md')
    }
    fs.writeFileSync(outPath, `${fm}\n\n# ${e.title || 'Untitled'}\n\n${e.content || ''}${relatedSection}${footer}`, 'utf8')
    written++
  }

  let curatedRefTracks = []
  try {
    const refRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reference_tracks?or=(source.eq.user,promoted.eq.true)&select=title,artist&order=created_at.desc&limit=100`,
      { headers: sbHeaders }
    )
    curatedRefTracks = await refRes.json().catch(() => [])
    if (!Array.isArray(curatedRefTracks)) curatedRefTracks = []
  } catch(e) { console.warn('reference_tracks fetch failed:', e.message) }

  const safeTitle = t => (t || '').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 100)
  const hitBenchmarkRefList = curatedRefTracks.length
    ? curatedRefTracks.map(t => `- [[${safeTitle(t.title)} — ${t.artist || ''}]]`).join('\n')
    : '*(no curated reference tracks yet)*'

  const indexFiles = [
    {
      file: 'Hit Benchmark.md',
      content: [
        '# Hit Benchmark', '',
        'Central reference point for all production decisions.', '',
        '## Reference Tracks', hitBenchmarkRefList, '',
        '## Brain Entries',
        safeEntries.filter(e => e.category?.includes('reference')).map(e => `- [[${safeTitle(e.title)}]]`).join('\n') || '*(none yet)*',
        '', '## Related', '[[My Productions]] [[Mixing Technique]] [[Active Goals]]'
      ].join('\n')
    },
    {
      file: 'My Productions.md',
      content: [
        '# My Productions', '',
        safeEntries.filter(e => e.category === 'own_production').map(e => `- [[${safeTitle(e.title)}]]`).join('\n') || '*(none yet)*',
        '', '## Related', '[[Hit Benchmark]] [[Mixing Technique]] [[Release Strategy]]'
      ].join('\n')
    },
    {
      file: 'Active Goals.md',
      content: [
        '# Active Goals', '',
        safeEntries.filter(e => e.category === 'goal').map(e => `- [[${safeTitle(e.title)}]]`).join('\n') || '*(none yet)*',
        '', '## Related', '[[Hit Benchmark]] [[Artist Strategy]] [[NOW]]'
      ].join('\n')
    },
    {
      file: 'Contact Directory.md',
      content: [
        '# Contact Directory', '',
        safeEntries.filter(e => e.category === 'contact_profile').map(e => `- [[${safeTitle(e.title)}]]`).join('\n') || '*(none yet)*',
        '', '## Related', '[[Artist Strategy]] [[Networking]] [[Collaboration]]'
      ].join('\n')
    },
    {
      file: 'Market Intelligence.md',
      content: [
        '# Market Intelligence', '',
        safeEntries.filter(e => e.category === 'market_knowledge' || e.category === 'industry_insight').slice(0, 10).map(e => `- [[${safeTitle(e.title)}]]`).join('\n') || '*(none yet)*',
        '', '## Related', '[[Artist Strategy]] [[Hit Benchmark]] [[Scout]]'
      ].join('\n')
    },
    {
      file: 'NOW.md',
      content: ['# NOW', '', 'See: [[Notes/NOW]]', '', '## Related', '[[Active Goals]] [[Hit Benchmark]] [[My Productions]]'].join('\n')
    },
    {
      file: 'Daft Punk Model.md',
      content: [
        '# Daft Punk Model', '',
        'Commercial success with artistic integrity.',
        'Mass appeal without compromising vision.',
        'The intersection of hits and respect.',
        '', '## Related', '[[Active Goals]] [[Artist Strategy]] [[Production Style]]'
      ].join('\n')
    }
  ]

  for (const idx of indexFiles) {
    fs.writeFileSync(path.join(OBSIDIAN_VAULT_PATH, idx.file), idx.content, 'utf8')
  }
  pushVaultToGit()
  console.log(`✓ brainToObsidian: ${written} entries, ${indexFiles.length} index notes`)
  return { written, index_notes: indexFiles.length }
}

// ── Generate mixing journey narrative from version feedback history ────────
async function generateVersionNarrative(song, versions) {
  if (!versions?.length) return null
  const mixVersions = versions
    .filter(v => v.version_type === 'mixing')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  if (mixVersions.length < 2) return null

  const history = mixVersions.map(v => {
    const doneFeedback = (v.feedback || []).filter(f => f.done).map(f => f.text)
    const openFeedback = (v.feedback || []).filter(f => !f.done).map(f => f.text)
    return v.name + ': ' +
      (doneFeedback.length ? 'Fixed: ' + doneFeedback.join(', ') : '') +
      (openFeedback.length ? ' Open: ' + openFeedback.join(', ') : '')
  }).join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: 'Summarize a mixing journey in 2-3 sentences. Be specific about what the main issues were and how they were resolved. No bullet points.',
      messages: [{ role: 'user', content: 'Song: ' + (song.title || song.code) + '\nVersions: ' + mixVersions.length + '\nFeedback history:\n' + history + '\n\nWrite a 2-sentence narrative of this mixing journey.' }]
    })
  })
  const d = await res.json()
  return d.content?.[0]?.text || null
}

// ── Crypto signal data fetchers ───────────────────────────────────────────
async function fetchFearGreed() {
  const r = await fetch('https://api.alternative.me/fng/?limit=1')
  const d = await r.json()
  return {
    value: parseInt(d.data[0].value),
    label: d.data[0].value_classification
  }
}

async function fetchBTCData() {
  const r = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?' +
    'ids=bitcoin,ethereum,solana&vs_currencies=eur,usd' +
    '&include_24hr_change=true&include_market_cap=true',
    { headers: { 'Accept': 'application/json' } }
  )
  return await r.json()
}

// ── Coin rotation monitor ──────────────────────────────────────────────────

async function fetchAllCoinPrices() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?' +
      'ids=bitcoin,ethereum,dogecoin,ripple,floki&' +
      'vs_currencies=eur&include_24hr_change=true&' +
      'include_market_cap=true',
      { headers: { 'Accept': 'application/json' } }
    )
    const d = await r.json()
    return {
      BTC: { price: d.bitcoin?.eur, change24h: d.bitcoin?.eur_24h_change, mcap: d.bitcoin?.eur_market_cap },
      ETH: { price: d.ethereum?.eur, change24h: d.ethereum?.eur_24h_change, mcap: d.ethereum?.eur_market_cap },
      DOGE: { price: d.dogecoin?.eur, change24h: d.dogecoin?.eur_24h_change, mcap: d.dogecoin?.eur_market_cap },
      XRP: { price: d.ripple?.eur, change24h: d.ripple?.eur_24h_change, mcap: d.ripple?.eur_market_cap },
      FLOKI: { price: d.floki?.eur, change24h: d.floki?.eur_24h_change, mcap: d.floki?.eur_market_cap }
    }
  } catch(e) {
    console.error('fetchAllCoinPrices error:', e.message)
    return {}
  }
}

async function scoreCoinForEntry(coin, prices) {
  let score = 0
  const reasons = []
  const data = prices[coin]
  if (!data) return { score: 0, reasons: ['No data'] }

  if (data.change24h < -5) { score += 3; reasons.push('Oversold -' + Math.abs(data.change24h).toFixed(1) + '% today') }
  else if (data.change24h < -2) { score += 2; reasons.push('Dipped ' + data.change24h.toFixed(1) + '% today') }
  else if (data.change24h > 5) { score += 1; reasons.push('Momentum +' + data.change24h.toFixed(1) + '%') }

  if (['DOGE','FLOKI','XRP'].includes(coin)) {
    score += 1
    reasons.push('High volatility coin — faster 5% moves')
  }

  if (['BTC','ETH'].includes(coin)) {
    try {
      const symbol = coin + 'USDT'
      const fr = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=' + symbol + '&limit=1')
      const fd = await fr.json()
      const funding = parseFloat(fd[0]?.fundingRate || 0) * 100
      if (funding < -0.03) { score += 2; reasons.push('Negative funding = squeeze potential') }
      else if (funding > 0.05) { score -= 1; reasons.push('High funding = crowded longs') }
    } catch(e) {}
  }

  return { score, reasons, price: data.price, change24h: data.change24h }
}

async function recommendNextCoin(excludeCoin) {
  const prices = await fetchAllCoinPrices()
  const coins = ['BTC','ETH','DOGE','XRP','FLOKI'].filter(c => c !== excludeCoin)
  const scores = await Promise.all(
    coins.map(async coin => ({
      coin,
      ...(await scoreCoinForEntry(coin, prices)),
      price: prices[coin]?.price
    }))
  )
  scores.sort((a,b) => b.score - a.score)
  return scores
}

async function monitorActiveTrades() {
  try {
    const { data: activeTrades } = await supabase
      .from('active_trades')
      .select('*')
      .eq('status', 'open')

    if (!activeTrades?.length) return

    const prices = await fetchAllCoinPrices()

    for (const trade of activeTrades) {
      const currentPrice = prices[trade.coin]?.price
      if (!currentPrice || !trade.entry_price) continue

      const pnlPct = ((currentPrice - trade.entry_price) / trade.entry_price) * 100
      const pnlEur = (currentPrice - trade.entry_price) * (trade.amount || 0)
      const duration = Math.round((Date.now() - new Date(trade.entry_time).getTime()) / 60000)

      await supabase.from('active_trades')
        .update({ current_price: currentPrice, pnl_pct: pnlPct, pnl_eur: pnlEur })
        .eq('id', trade.id)

      if (pnlPct >= 5) {
        const nextCoins = await recommendNextCoin(trade.coin)
        const best = nextCoins[0]
        await sendTelegram(TELEGRAM_OWNER_ID,
          '🟢 TAKE PROFIT — ' + trade.coin + '\n\n' +
          'Entry: €' + (trade.entry_price < 1 ? trade.entry_price.toFixed(6) : Math.round(trade.entry_price).toLocaleString()) + '\n' +
          'Now: €' + (currentPrice < 1 ? currentPrice.toFixed(6) : Math.round(currentPrice).toLocaleString()) + '\n' +
          'Profit: +' + pnlPct.toFixed(2) + '% (+€' + Math.round(pnlEur) + ')\n' +
          'Duration: ' + (duration > 60 ? Math.round(duration/60) + 'h' : duration + 'min') + '\n\n' +
          '💰 SELL NOW → /sell' + trade.coin.toLowerCase() + '\n\n' +
          '🔄 NEXT BEST ENTRY:\n' +
          best.coin + ' (score ' + best.score + '/10)\n' +
          best.reasons.slice(0,2).join('\n') + '\n\n' +
          'Full ranking:\n' +
          nextCoins.map((c,i) => (i+1) + '. ' + c.coin + ' — ' + c.score + '/10').join('\n')
        ).catch(() => {})
      } else if (pnlPct <= -5) {
        await sendTelegram(TELEGRAM_OWNER_ID,
          '🔴 STOP LOSS — ' + trade.coin + '\n\n' +
          'Entry: €' + (trade.entry_price < 1 ? trade.entry_price.toFixed(6) : Math.round(trade.entry_price).toLocaleString()) + '\n' +
          'Now: €' + (currentPrice < 1 ? currentPrice.toFixed(6) : Math.round(currentPrice).toLocaleString()) + '\n' +
          'Loss: ' + pnlPct.toFixed(2) + '% (€' + Math.round(pnlEur) + ')\n' +
          'Duration: ' + (duration > 60 ? Math.round(duration/60) + 'h' : duration + 'min') + '\n\n' +
          '⚠️ EXIT NOW → /sell' + trade.coin.toLowerCase() + '\n\n' +
          'Consider waiting for recovery or cut losses now.'
        ).catch(() => {})
      }
    }
  } catch(e) {
    console.error('monitorActiveTrades error:', e.message)
  }
}
setInterval(monitorActiveTrades, 15 * 60 * 1000)
setImmediate(monitorActiveTrades)

async function fetchBTCDominance() {
  const r = await fetch('https://api.coingecko.com/api/v3/global')
  const d = await r.json()
  return Math.round(d.data.market_cap_percentage.btc * 10) / 10
}

async function fetchFundingRate() {
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1')
    const d = await r.json()
    return parseFloat(d[0]?.fundingRate || 0) * 100
  } catch(e) { return null }
}

function buildReleaseSummary({ title, artist, code, release_date }, work_data) {
  const lines = []
  lines.push('RELEASE SUMMARY')
  lines.push('===============')
  lines.push(`Code:   ${code || '—'}`)
  lines.push(`Title:  ${title || '—'}`)
  lines.push(`Artist: ${artist || '—'}`)
  lines.push(`Date:   ${release_date || '—'}`)
  lines.push('')

  if (work_data) {
    const versions = work_data.versions || []
    const mixVersions = versions.filter(v => v.version_type === 'mixing')
    const prodVersions = versions.filter(v => v.version_type === 'production')
    if (prodVersions.length || mixVersions.length) {
      lines.push('VERSIONS')
      lines.push('--------')
      if (prodVersions.length) lines.push(`Production: ${prodVersions.length} version(s) — latest: ${prodVersions[prodVersions.length - 1]?.name || '—'}`)
      if (mixVersions.length) lines.push(`Mix:        ${mixVersions.length} version(s) — latest: ${mixVersions[mixVersions.length - 1]?.name || '—'}`)
      lines.push('')
    }

    const log = work_data.session_log || []
    if (log.length) {
      const totalSec = log.reduce((s, e) => s + (e.seconds || 0), 0)
      const fmtTime = s => { const m = Math.floor(s / 60); const sec = s % 60; return m + 'm ' + sec + 's' }
      lines.push('WORK LOG')
      lines.push('--------')
      const stageLabels = { production: 'PRODUCTION', mix_prep: 'MIX PREP', mixing: 'MIXING', mastering: 'MASTERING', stems: 'STEMS' }
      for (const e of log) lines.push(`${e.date || ''}  ${stageLabels[e.stage] || e.stage || ''}  ${fmtTime(e.seconds || 0)}`)
      lines.push(`TOTAL: ${fmtTime(totalSec)}`)
      lines.push('')
    }
  }

  lines.push(`Generated: ${new Date().toISOString()}`)
  return lines.join('\n')
}

async function fetchDerivativesData(coin = 'BTC') {
  const symbol = coin + 'USDT'
  const results = {}

  try {
    const fundingRes = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=' + symbol + '&limit=3')
    const fundingData = await fundingRes.json()
    if (Array.isArray(fundingData)) {
      results.funding_current = parseFloat(fundingData[0]?.fundingRate || 0) * 100
      results.funding_prev = parseFloat(fundingData[1]?.fundingRate || 0) * 100
      results.funding_trend = results.funding_current > results.funding_prev ? 'rising' : 'falling'
    }
  } catch(e) {}

  try {
    const lsRes = await fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=' + symbol + '&period=1h&limit=3')
    const lsData = await lsRes.json()
    if (Array.isArray(lsData) && lsData.length) {
      results.long_pct = parseFloat(lsData[0].longAccount) * 100
      results.short_pct = parseFloat(lsData[0].shortAccount) * 100
      results.ls_ratio = parseFloat(lsData[0].longShortRatio)
      if (lsData.length > 1) {
        const prevLong = parseFloat(lsData[1].longAccount) * 100
        results.long_trend = results.long_pct > prevLong ? 'increasing' : 'decreasing'
      }
    }
  } catch(e) {}

  try {
    const oiRes = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=' + symbol)
    const oiData = await oiRes.json()
    results.open_interest = parseFloat(oiData.openInterest || 0)
    const oiHistRes = await fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + symbol + '&period=1h&limit=6')
    const oiHist = await oiHistRes.json()
    if (Array.isArray(oiHist) && oiHist.length > 1) {
      const latest = parseFloat(oiHist[0].sumOpenInterest)
      const prev = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest)
      results.oi_change_pct = ((latest - prev) / prev * 100).toFixed(2)
      results.oi_trend = latest > prev ? 'rising' : 'falling'
    }
  } catch(e) {}

  try {
    const takerRes = await fetch('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=' + symbol + '&period=1h&limit=3')
    const takerData = await takerRes.json()
    if (Array.isArray(takerData) && takerData.length) {
      results.taker_buy_ratio = parseFloat(takerData[0].buySellRatio)
    }
  } catch(e) {}

  try {
    const topRes = await fetch('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=' + symbol + '&period=1h&limit=1')
    const topData = await topRes.json()
    if (Array.isArray(topData) && topData.length) {
      results.top_trader_long_pct = parseFloat(topData[0].longAccount) * 100
    }
  } catch(e) {}

  return results
}

async function fetchExchangeNetflow() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin?' +
      'localization=false&tickers=false&market_data=true' +
      '&community_data=false&developer_data=false'
    )
    const d = await r.json()
    return {
      volume_24h: d.market_data?.total_volume?.eur,
      price_change_7d: d.market_data?.price_change_percentage_7d
    }
  } catch(e) { return null }
}

async function fetchBinancePortfolio() {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) return null
  try {
    const nodeCrypto = require('crypto')
    const timestamp = Date.now()
    const queryString = 'timestamp=' + timestamp
    const signature = nodeCrypto
      .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
      .update(queryString)
      .digest('hex')
    const r = await fetch(
      'https://api.binance.com/api/v3/account?' + queryString + '&signature=' + signature,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY }, signal: AbortSignal.timeout(8000) }
    )
    const d = await r.json()
    if (d.code) { console.warn('Binance API error:', d.msg); return null }
    return (d.balances || [])
      .map(b => ({ coin: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked), total: parseFloat(b.free) + parseFloat(b.locked) }))
      .filter(b => b.total > 0.000001)
  } catch(e) { console.warn('Binance portfolio error:', e.message); return null }
}

async function fetch4HCandles(coin = 'BTC', limit = 10) {
  try {
    const r = await fetch('https://api.binance.com/api/v3/klines?symbol=' + coin + 'EUR&interval=4h&limit=' + limit)
    const data = await r.json()
    if (!Array.isArray(data)) throw new Error('bad response')
    return data.map(c => ({ time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) }))
  } catch(e) {
    try {
      const r = await fetch('https://api.binance.com/api/v3/klines?symbol=' + coin + 'USDT&interval=4h&limit=' + limit)
      const data = await r.json()
      return data.map(c => ({ time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) }))
    } catch(e2) { return [] }
  }
}

let _predictionMarketsCache = null
let _predictionMarketsCacheTime = 0
const PREDICTION_CACHE_MS = 5 * 60 * 1000

async function getPolymarketSignals() {
  if (_predictionMarketsCache && Date.now() - _predictionMarketsCacheTime < PREDICTION_CACHE_MS) {
    return _predictionMarketsCache
  }
  // Try Polymarket CLOB first (may be geo-blocked)
  try {
    const r = await fetch(
      'https://clob.polymarket.com/markets?tag=crypto&limit=20&closed=false',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(3000) }
    )
    if (r.ok) {
      const data = await r.json()
      const markets = (data?.data || data || [])
        .filter(m => {
          const q = (m.question || '').toLowerCase()
          return q.includes('bitcoin') || q.includes('btc') || q.includes('ethereum') ||
                 q.includes('eth') || q.includes('crypto') || q.includes('doge') ||
                 q.includes('xrp') || q.includes('floki')
        })
        .slice(0, 8)
        .map(m => ({
          question: m.question,
          yes_prob: Math.round((m.outcomePrices?.[0] || m.yes_price || 0) * 100),
          volume: m.volume || 0,
          end_date: m.end_date_iso || m.endDate,
          source: 'polymarket'
        }))
        .filter(m => m.volume > 1000)
      if (markets.length) {
        _predictionMarketsCache = markets
        _predictionMarketsCacheTime = Date.now()
        return markets
      }
    }
  } catch(e) { /* geo-blocked or timeout — fall through to Manifold */ }

  // Fallback: Manifold Markets (prediction markets, fully accessible)
  try {
    const queries = ['bitcoin', 'ethereum', 'crypto']
    const seen = new Set()
    const markets = []
    for (const q of queries) {
      const r = await fetch(
        `https://api.manifold.markets/v0/search-markets?term=${q}&limit=10&filter=open`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
      )
      if (!r.ok) continue
      const data = await r.json()
      const items = Array.isArray(data) ? data : (data.markets || [])
      for (const m of items) {
        if (m.outcomeType !== 'BINARY' || !m.probability || seen.has(m.id)) continue
        const question = m.question || ''
        const ql = question.toLowerCase()
        if (!ql.includes('bitcoin') && !ql.includes('btc') && !ql.includes('ethereum') &&
            !ql.includes('eth') && !ql.includes('crypto') && !ql.includes('doge') &&
            !ql.includes('xrp') && !ql.includes('floki')) continue
        seen.add(m.id)
        markets.push({
          question,
          yes_prob: Math.round(m.probability * 100),
          volume: m.volume || 0,
          end_date: m.closeTime ? new Date(m.closeTime).toISOString().slice(0, 10) : null,
          source: 'manifold'
        })
      }
      if (markets.length >= 8) break
    }
    const result = markets.filter(m => m.volume > 50).slice(0, 8)
    _predictionMarketsCache = result
    _predictionMarketsCacheTime = Date.now()
    return result
  } catch(e) {
    console.warn('prediction markets fetch failed:', e.message?.slice(0, 60))
    return _predictionMarketsCache || []
  }
}

const MONITORED_COINS_SET = new Set(['BTC', 'ETH', 'DOGE', 'XRP', 'FLOKI'])

async function getCoinGeckoTrending() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/search/trending',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { trending: [], monitored_trending: [], nfts: [], is_bullish: false }
    const data = await r.json()
    const trending = (data.coins || []).map((c, i) => ({
      rank: i + 1,
      name: c.item?.name,
      symbol: c.item?.symbol?.toUpperCase(),
      market_cap_rank: c.item?.market_cap_rank,
      score: c.item?.score
    }))
    const monitored_trending = trending.filter(t => MONITORED_COINS_SET.has(t.symbol))
    const nfts = (data.nfts || []).slice(0, 3).map(n => ({ name: n.name, symbol: n.symbol }))
    return { trending, monitored_trending, nfts, is_bullish: monitored_trending.length > 0 }
  } catch(e) {
    console.warn('coingecko trending error:', e.message?.slice(0, 60))
    return { trending: [], monitored_trending: [], nfts: [], is_bullish: false }
  }
}

async function getCoinGeckoGlobal() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return {}
    const data = await r.json()
    const d = data.data || {}
    return {
      market_cap_change_24h: d.market_cap_change_percentage_24h_usd,
      btc_dominance: d.market_cap_percentage?.btc,
      eth_dominance: d.market_cap_percentage?.eth,
      total_market_cap: d.total_market_cap?.usd,
      active_coins: d.active_cryptocurrencies
    }
  } catch(e) {
    console.warn('coingecko global error:', e.message?.slice(0, 60))
    return {}
  }
}

async function buildCryptoSignal() {
  const [fearGreed, btcData, dominance, funding, netflow, btcDeriv, ethDeriv, binancePf, candles4h, polymarkets, cgTrending, cgGlobal] =
    await Promise.all([
      fetchFearGreed(),
      fetchBTCData(),
      fetchBTCDominance(),
      fetchFundingRate(),
      fetchExchangeNetflow(),
      fetchDerivativesData('BTC'),
      fetchDerivativesData('ETH'),
      fetchBinancePortfolio(),
      fetch4HCandles('BTC'),
      getPolymarketSignals(),
      getCoinGeckoTrending(),
      getCoinGeckoGlobal()
    ])

  const btcPrice = btcData?.bitcoin?.eur
  const btcChange24h = btcData?.bitcoin?.eur_24h_change
  const ethPrice = btcData?.ethereum?.eur
  const ethChange24h = btcData?.ethereum?.eur_24h_change

  let bullPoints = 0
  let bearPoints = 0
  const reasons = []

  // Fear & Greed
  if (fearGreed.value < 20) { bullPoints += 2; reasons.push('Extreme fear = buying opportunity') }
  else if (fearGreed.value < 35) { bullPoints += 1; reasons.push('Fear present = cautious bullish') }

  if (fearGreed.value > 80) { bearPoints += 2; reasons.push('Extreme greed = take profits') }
  else if (fearGreed.value > 65) { bearPoints += 1; reasons.push('Greed building = caution') }

  // Funding rate
  if (funding !== null) {
    if (funding < -0.05) { bullPoints += 2; reasons.push('Shorts paying = squeeze potential') }
    else if (funding < -0.01) { bullPoints += 1; reasons.push('Slightly negative funding') }

    if (funding > 0.08) { bearPoints += 2; reasons.push('Funding very high = longs overextended') }
    else if (funding > 0.04) { bearPoints += 1; reasons.push('Funding elevated') }
  }

  let altseasonSignal = 'NO'
  if (dominance < 50) altseasonSignal = 'ACTIVE'
  else if (dominance < 54) altseasonSignal = 'STARTING'

  // BTC 24h momentum
  if (btcChange24h > 3) { bullPoints += 1; reasons.push('Strong 24h momentum') }
  if (btcChange24h < -5) { bearPoints += 2; reasons.push('Strong selling pressure') }
  else if (btcChange24h < -3) { bearPoints += 1; reasons.push('Downward momentum') }

  // Long/Short ratio
  if (btcDeriv.long_pct != null) {
    if (btcDeriv.long_pct > 72) {
      bearPoints += 2; reasons.push('72%+ longs = market overextended, crowded trade')
    } else if (btcDeriv.long_pct > 65) {
      bearPoints += 1; reasons.push('Longs elevated at ' + btcDeriv.long_pct.toFixed(0) + '%')
    } else if (btcDeriv.long_pct < 45) {
      bullPoints += 2; reasons.push('Only ' + btcDeriv.long_pct.toFixed(0) + '% longs = potential squeeze up')
    }
  }

  // Open Interest + price direction
  if (btcDeriv.oi_trend) {
    if (btcDeriv.oi_trend === 'rising' && btcChange24h > 0) {
      bullPoints += 1; reasons.push('Rising OI + rising price = strong trend confirmation')
    } else if (btcDeriv.oi_trend === 'rising' && btcChange24h < -2) {
      bullPoints += 1; reasons.push('Rising OI + falling price = shorts building, squeeze potential')
    } else if (btcDeriv.oi_trend === 'falling' && btcChange24h < -3) {
      bullPoints += 1; reasons.push('Falling OI + falling price = capitulation, potential bottom')
    }
  }

  // Taker buy/sell ratio
  if (btcDeriv.taker_buy_ratio != null) {
    if (btcDeriv.taker_buy_ratio > 1.2) {
      bullPoints += 1; reasons.push('Aggressive buyers dominating = bullish flow')
    } else if (btcDeriv.taker_buy_ratio < 0.8) {
      bearPoints += 1; reasons.push('Aggressive sellers dominating = bearish flow')
    }
  }

  // Top trader positions (smart money)
  if (btcDeriv.top_trader_long_pct != null) {
    if (btcDeriv.top_trader_long_pct > 65) {
      bullPoints += 1; reasons.push('Smart money ' + btcDeriv.top_trader_long_pct.toFixed(0) + '% long')
    } else if (btcDeriv.top_trader_long_pct < 45) {
      bearPoints += 1; reasons.push('Smart money only ' + btcDeriv.top_trader_long_pct.toFixed(0) + '% long')
    }
  }

  // 4H candle trend
  let ma5_4h = null, ma10_4h = null, trend_4h = null
  if (candles4h.length >= 5) {
    const closes = candles4h.map(c => c.close)
    ma5_4h = Math.round(closes.slice(-5).reduce((s, v) => s + v, 0) / 5)
    ma10_4h = Math.round(closes.slice(-10).reduce((s, v) => s + v, 0) / Math.min(10, closes.length))
    const currentClose = closes[closes.length - 1]
    trend_4h = currentClose > ma5_4h ? 'uptrend' : 'downtrend'
    if (currentClose > ma5_4h && ma5_4h > ma10_4h) {
      bullPoints += 1; reasons.push('4H trend: price above MAs, uptrend intact')
    } else if (currentClose < ma5_4h && ma5_4h < ma10_4h) {
      bearPoints += 1; reasons.push('4H trend: price below MAs, downtrend')
    }
    const lastCandle = candles4h[candles4h.length - 1]
    const candleBody = Math.abs(lastCandle.close - lastCandle.open)
    const candleRange = lastCandle.high - lastCandle.low
    if (candleRange > 0) {
      const isBullish = lastCandle.close > lastCandle.open
      if (isBullish && candleBody > candleRange * 0.6) {
        bullPoints += 1; reasons.push('Strong bullish 4H candle')
      } else if (!isBullish && candleBody > candleRange * 0.6) {
        bearPoints += 1; reasons.push('Strong bearish 4H candle')
      }
    }
  }

  // Polymarket prediction market scoring
  if (polymarkets?.length) {
    const bullishMarkets = polymarkets.filter(m => m.yes_prob > 65)
    const bearishMarkets = polymarkets.filter(m => m.yes_prob < 35)
    if (bullishMarkets.length >= 2) {
      bullPoints += 1; reasons.push('Polymarket: ' + bullishMarkets.length + ' bullish prediction markets (>' + 65 + '% yes)')
    } else if (bullishMarkets.length === 1) {
      reasons.push('Polymarket: 1 bullish market — ' + Math.round(bullishMarkets[0].yes_prob) + '% yes')
    }
    if (bearishMarkets.length >= 2) {
      bearPoints += 1; reasons.push('Polymarket: ' + bearishMarkets.length + ' bearish prediction markets (<35% yes)')
    }
    // Strong contradiction warning
    const hasBullDerivatives = btcDeriv.long_pct != null && btcDeriv.long_pct < 50
    const hasStrongBearMarkets = bearishMarkets.some(m => m.yes_prob < 25)
    if (hasBullDerivatives && hasStrongBearMarkets)
      reasons.push('⚠️ Conflict: derivatives bullish but Polymarket strongly bearish')
  }

  // CoinGecko crowd sentiment scoring
  if (cgTrending?.monitored_trending?.length) {
    bullPoints += 1
    reasons.push('CoinGecko trending: ' + cgTrending.monitored_trending.map(t => t.symbol).join(', ') + ' in top searches')
  }
  if (cgGlobal?.market_cap_change_24h != null) {
    if (cgGlobal.market_cap_change_24h > 3) { bullPoints += 1; reasons.push('Total market cap +' + cgGlobal.market_cap_change_24h.toFixed(1) + '% 24h = broad rally') }
    else if (cgGlobal.market_cap_change_24h < -3) { bearPoints += 1; reasons.push('Total market cap ' + cgGlobal.market_cap_change_24h.toFixed(1) + '% 24h = broad selloff') }
  }
  if (cgGlobal?.btc_dominance != null) {
    if (cgGlobal.btc_dominance > 58) reasons.push('BTC dom ' + cgGlobal.btc_dominance.toFixed(1) + '% — alts underperforming')
    else if (cgGlobal.btc_dominance < 45) { bullPoints += 1; reasons.push('BTC dom ' + cgGlobal.btc_dominance.toFixed(1) + '% = alt season conditions') }
  }

  let signal, emoji, suggestion, binanceAction

  if (bullPoints >= 4) {
    signal = 'STRONG BUY'; emoji = '🟢🟢'
    suggestion = 'Multiple bullish signals. Strong entry opportunity.'
    binanceAction = 'buy'
  } else if (bullPoints >= 2 && bullPoints > bearPoints) {
    signal = 'BULLISH'; emoji = '🟢'
    suggestion = 'Cautiously bullish. DCA opportunity.'
    binanceAction = 'buy'
  } else if (bearPoints >= 4) {
    signal = 'STRONG SELL'; emoji = '🔴🔴'
    suggestion = 'Multiple warning signs. Consider taking profits.'
    binanceAction = 'sell'
  } else if (bearPoints >= 2 && bearPoints > bullPoints) {
    signal = 'BEARISH'; emoji = '🔴'
    suggestion = 'Caution. Wait for better entry or reduce position.'
    binanceAction = 'sell'
  } else {
    signal = 'NEUTRAL'; emoji = '🟡'
    suggestion = 'No clear setup. Hold current position.'
    binanceAction = null
  }

  // PART 1 — Portfolio: Binance live data first, fallback to user_settings; enrich from crypto_trades
  let portfolio = []
  try {
    if (binancePf?.length) {
      portfolio = binancePf
        .filter(b => ['BTC', 'ETH', 'BNB'].includes(b.coin) && b.total > 0.000001)
        .map(b => ({ coin: b.coin, amount: b.total, entryPrice: null, totalInvested: null }))
    } else {
      const portRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.crypto_portfolio&select=value`, { headers: sbHeaders })
      const portData = await portRes.json()
      const raw = portData[0]?.value ? JSON.parse(portData[0].value) : []
      portfolio = raw.map(p => ({ coin: p.coin, amount: p.amount, entryPrice: p.entryPrice, totalInvested: p.amount * (p.entryPrice || 0) }))
    }
    // Enrich with weighted average entry from buy trades
    const tradesRes = await fetch(`${SUPABASE_URL}/rest/v1/crypto_trades?type=eq.buy&order=traded_at.desc`, { headers: sbHeaders })
    const trades = await tradesRes.json()
    for (const p of portfolio) {
      const coinTrades = (Array.isArray(trades) ? trades : []).filter(t => t.coin === p.coin)
      if (coinTrades.length) {
        const totalCost = coinTrades.reduce((s, t) => s + (t.amount_eur || 0), 0)
        const totalAmt = coinTrades.reduce((s, t) => s + (t.amount_coin || 0), 0)
        if (totalAmt > 0) { p.entryPrice = totalCost / totalAmt; p.totalInvested = totalCost }
      }
    }
  } catch(e) { console.warn('portfolio load error:', e.message) }

  // PART 2 — Active trades: load, compute P&L, send exit alerts (3h cooldown)
  let activeTrades = []
  try {
    const atRes = await fetch(`${SUPABASE_URL}/rest/v1/active_trades?status=eq.open`, { headers: sbHeaders })
    const atData = await atRes.json()
    activeTrades = Array.isArray(atData) ? atData : []
    const ALERT_COOLDOWN_MS = 3 * 60 * 60 * 1000
    const now = Date.now()
    for (const trade of activeTrades) {
      const currentPrice = trade.coin === 'BTC' ? btcPrice : ethPrice
      if (!currentPrice || !trade.entry_price) continue
      const pnlPct = (currentPrice - trade.entry_price) / trade.entry_price * 100
      const pnlEur = (currentPrice - trade.entry_price) * (trade.amount || 0)
      trade.current_price = currentPrice
      trade.pnl_pct = pnlPct
      trade.pnl_eur = pnlEur
      const takeProfit = pnlPct >= 8
      const stopLoss = pnlPct <= -5
      const signalExit = signal === 'STRONG SELL' || signal === 'BEARISH'
      if (takeProfit || stopLoss || signalExit) {
        const lastAlert = lastExitAlertSent[trade.coin] || 0
        if (now - lastAlert > ALERT_COOLDOWN_MS) {
          lastExitAlertSent[trade.coin] = now
          const reason = takeProfit ? 'Take profit target hit (+' + pnlPct.toFixed(1) + '%)' :
                        stopLoss ? 'Stop loss triggered (' + pnlPct.toFixed(1) + '%)' :
                        'Exit signal: ' + signal
          sendTelegram(TELEGRAM_OWNER_ID,
            '🚨 EXIT ALERT: ' + trade.coin + '\n\n' +
            'Entry: €' + Math.round(trade.entry_price).toLocaleString() +
              ' (' + new Date(trade.entry_time).toLocaleDateString() + ')\n' +
            'Now: €' + Math.round(currentPrice).toLocaleString() + '\n' +
            'P&L: ' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(1) + '% ' +
              '(€' + Math.round(pnlEur) + ')\n\n' +
            '⚡ Reason: ' + reason + '\n\n' +
            'Reply /sell' + trade.coin.toLowerCase() + ' to prepare exit\n' +
            'Reply /hold to dismiss this alert'
          ).catch(() => {})
        }
      }
    }
  } catch(e) { console.warn('active_trades error:', e.message) }

  // Personal advice based on enriched portfolio
  let personalAdvice = ''
  try {
    const holdsBTC = portfolio.some(p => p.coin === 'BTC' && p.amount > 0.000001)
    const holdsETH = portfolio.some(p => p.coin === 'ETH' && p.amount > 0.000001)

    if (holdsBTC) {
      const btcH = portfolio.find(p => p.coin === 'BTC')
      if (btcH?.entryPrice) {
        const pnl = ((btcPrice - btcH.entryPrice) / btcH.entryPrice * 100).toFixed(1)
        if (signal === 'STRONG SELL' && parseFloat(pnl) > 10)
          personalAdvice += '⚠️ You hold BTC at avg €' + Math.round(btcH.entryPrice).toLocaleString() + ' (+' + pnl + '%). Signal says SELL — consider taking profits.\n'
        else if (signal === 'STRONG BUY' && btcDeriv.long_pct != null && btcDeriv.long_pct < 50)
          personalAdvice += '✅ You hold BTC. Signal STRONG BUY + low long ratio = good add opportunity.\n'
        else if (signal === 'BEARISH' && parseFloat(pnl) > 20)
          personalAdvice += '💡 You are +' + pnl + '% on BTC. Consider partial profit given bearish signal.\n'
      }
    }

    if (!holdsBTC && (signal === 'STRONG BUY' || signal === 'BULLISH'))
      personalAdvice += '📌 You have no BTC position. Signal is ' + signal + ' — consider starting a position.\n'

    if (holdsETH) {
      const ethH = portfolio.find(p => p.coin === 'ETH')
      if (ethH?.entryPrice) {
        const pnl = ((ethPrice - ethH.entryPrice) / ethH.entryPrice * 100).toFixed(1)
        if ((signal === 'STRONG SELL' || signal === 'BEARISH') && parseFloat(pnl) > 15)
          personalAdvice += '⚠️ ETH at avg €' + Math.round(ethH.entryPrice).toLocaleString() + ' (+' + pnl + '%). Bearish — consider reducing.\n'
      }
    }
  } catch(e) { console.warn('personalAdvice calc error:', e.message) }

  const result = {
    signal, emoji, suggestion, reasons, fearGreed,
    btcPrice, btcChange24h, ethPrice, ethChange24h,
    dominance, funding, netflow, altseasonSignal,
    binanceDeepLink: 'https://www.binance.com/en/trade/BTC_EUR', binanceAction,
    btc_derivatives: btcDeriv,
    eth_derivatives: ethDeriv,
    personal_advice: personalAdvice,
    active_trades: activeTrades,
    ma5_4h, ma10_4h, trend_4h,
    polymarkets: polymarkets || [],
    cg_trending: cgTrending || { trending: [], monitored_trending: [], nfts: [], is_bullish: false },
    cg_global: cgGlobal || {},
    timestamp: new Date().toISOString()
  }
  lastSignalResult = result
  return result
}

// ── Seed production rules into brain_knowledge ────────────────────────────
async function seedProductionRules() {
  const rules = [
    // CORE PHILOSOPHY
    { category: 'goal', title: 'Core philosophy: Daft Punk not Taylor Swift', content: 'Make millions with music that has artistic integrity. Commercial success AND critical respect. Mysterious, forward-thinking. The intersection: sounds like a hit but has something real in it. Every decision measured against this.', confidence: 'locked' },
    { category: 'goal', title: 'Output rule: 2x per week, 30 songs, 3 make it', content: 'Make 2 new songs per week. Listen on 3rd day to decide. Do 30 songs — 3 will make it. Out of 30 tracks, 3 make it (Ian). Volume negates luck. Consistency is the glue.', confidence: 'locked' },
    { category: 'creative_process', title: 'Session start: no referencing first 90 minutes', content: 'No A/B referencing in first 90 minutes. Only 1 reference track. Define the finish line for this song. Write one thing the song still needs. Always check if you can play it loud in front of people.', confidence: 'locked' },
    { category: 'creative_process', title: 'Mindset: flow state and presence', content: 'Be present. Invite magic. Flow state. Move fast — go from A to B — create now to have opinion and perfect later. Follow the feeling, emotions and sound in your head. Imagine end version, hear artist on it, playing the song and where it will play.', confidence: 'strong' },
    { category: 'creative_process', title: 'Song structure: triangle in all dimensions', content: 'Song like a triangle in all dimensions — each chorus bigger. Mono verse, stereo chorus. Change every 4 bars / 8 seconds — transition, surprise, introduce. Never introduce more than one new element at a time. Every part of the song has to be a hook.', confidence: 'locked' },
    { category: 'creative_process', title: 'Macro thinking: Zeitgeist and authenticity', content: "Read the culture. Don't chase trends — chase authenticity. Sound new not good — your lane is never saturated because it's you. Do things that are interesting but also understandable — elegantly simple. Making pop is a push-pull: excite the audience and subvert expectations.", confidence: 'locked' },
    { category: 'creative_process', title: 'Production action: source over tools', content: "Source over tools. Decisions over choice. Feel don't think. Listen don't look. Overproduce first without thinking — then take out what you don't need. Complexity is the enemy of intention. Keep it simple — make tunes playable with one or two fingers. The idea has to fit on a postage stamp.", confidence: 'locked' },
    // MIXING
    { category: 'mixing_technique', title: 'Mix levels: drums and bass targets', content: 'Kick: -6 to -3dB. Snare/clap: -6 to -3dB. Drum loops: -12dB. Perc: -16dB. HH/cymbals: -16 to -12dB. Bass sub: -12 to -10dB. Drums and bass -10 LUFS with music at -8. Minimum 2dB moves, 5dB on aux.', confidence: 'locked' },
    { category: 'mixing_technique', title: 'Mix levels: vocals targets', content: 'Lead vocal hook: -10 to -7dB. Lead vocal verse: -10 to -7dB. BGV: -15dB. FX: -15dB. Reverb send: -27dB. Delay: -24dB. Vocal level: just behind the snare.', confidence: 'locked' },
    { category: 'mixing_technique', title: 'Mix levels: music/synths targets', content: 'Synth melody: -12 to -9dB. Synth lead layer: -15dB. Synth chords/pads: -15dB. Synth rhythmic: -18 to -15dB. Synth surprise: -12dB. All music halfway.', confidence: 'locked' },
    { category: 'mixing_technique', title: 'Mix approach: mono first, top down', content: 'Mix in mono first, 900Hz-3kHz. Mix quiet — vocals slightly too loud, hear kick and snare. Top down mixing — do as little as possible to vox. Mix around vocals. No solo button. Transients. EQ critical at 150-450Hz and 2-5kHz.', confidence: 'locked' },
    { category: 'mixing_technique', title: 'Mix check: 48-hour test and reference', content: "Fix only what survived the 48-hour test. Does it hold up against reference at 70%? Write the ONE thing this song still needs. Does it have a focal point? Can you hear every note and lyric? Finished doesn't mean perfect — emotional not perfect.", confidence: 'locked' },
    { category: 'mixing_technique', title: 'Automation rules', content: '1.5dB on first master insert or volume and width. Check 160-300Hz. USE AUTOMATION — fill gaps, transitions. Automation on master 1.1 after limiter or before. 2 seconds of silence at end.', confidence: 'strong' },
    { category: 'mixing_technique', title: 'Club key centres', content: 'Club key centres: D, E, F#min, G. Priority: melody/lead → kick/snare/HH → bass.', confidence: 'strong' },
    // VOCALS
    { category: 'production_style', title: 'Vocal recording: chain and setup', content: "U47 or C800 into 1073 into CL1B: 4dB constant, spiked 8-10dB, maybe 300Hz cut. 5cm from popshield, 2 handbreiten, angle from above. Check headphone mix for artist. Let them say let's do it again — then chime in. Don't be silent after a take.", confidence: 'locked' },
    { category: 'production_style', title: 'Vocal prep: comp and pitch', content: '3 comps to 1 with autotune. Clean breaths and cuts. Time align. Melodyne: center 90%, drift 70. Mix hook 5-12, verse 15-25, humanize 15-40. Mumble BVs — no esses.', confidence: 'locked' },
    // SONGWRITING
    { category: 'creative_process', title: 'Melody first, lyrics serve melody', content: 'Melody and sound first — then content (Bad Bunny). Make the hook right first. Do gibberish verses. Hook: two-finger piano test, humming test. Write melody first — lyrics serve the melody. Simple lyrics in chorus. Balance between familiarity and something new.', confidence: 'locked' },
    { category: 'creative_process', title: 'Song analysis checklist', content: "Is it great? Don't polish a turd. Is it flowing? Do I stop listening? What is the trademark sound? Is there 1 edgy sound? Is every sound intentional? Song is finished when I can no longer remove anything. What are top 5 things bothering you — fix them.", confidence: 'locked' },
    // BUSINESS
    { category: 'business', title: 'Pricing: production and mixing rates', content: 'Production: 3500 + 800 studio fee + 1% royalty. Production range: 1800-2200. Day 1 mix, day 2 check and send. Always ask for double so you get half.', confidence: 'locked' },
    { category: 'collaboration', title: 'Collab rules: first 5 minutes count', content: "First 5 minutes count — control emotions, copy emotional state. Don't answer quickly. Musikalisch always present but distance on serious issues — don't chase. 1st give them what they want — then do what you think. Artist needs to leave happy. Take the blame for the team.", confidence: 'locked' },
    { category: 'collaboration', title: 'Collab: understanding the artist', content: "Either artist believes too much in themselves or too little — which one is it? What made them famous? What's current? What does artist think their best song has been? Where do they want to go next? Be a fan, have artist's highest goals in mind. Let artist be best version of themselves.", confidence: 'strong' },
    { category: 'production_style', title: 'Session prep: 15 samples rule', content: 'For sessions: 15 samples max. Build vibe for the artist. Come with a few chorus chord changes. Find tempo and key for artist. Demos: just send melodies, don\'t limit what the song can be (Charli XCX rule).', confidence: 'locked' },
    { category: 'production_style', title: 'OTT settings', content: 'OTT: 3-8 = glue sheen. 8-15 = pop sheen thickness. 15-22 = risky. Varispeed: timestretch off, -18% BPM. Synths in 100% reverb and use as texture.', confidence: 'strong' }
  ]

  let seeded = 0, skipped = 0
  for (const rule of rules) {
    const checkR = await fetch(
      `${SUPABASE_URL}/rest/v1/brain_knowledge?title=eq.${encodeURIComponent(rule.title)}&select=id&limit=1`,
      { headers: sbHeaders }
    )
    const existing = await checkR.json()
    if (existing && existing.length > 0) { skipped++; continue }

    await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        category: rule.category,
        title: rule.title,
        content: rule.content,
        confidence: rule.confidence,
        entry_type_v2: 'rule',
        source_type: 'music_tips',
        active: true,
        priority: rule.confidence === 'locked'
      })
    })
    console.log('Seeded:', rule.title)
    seeded++
  }
  console.log(`Production rules seeding complete — seeded: ${seeded}, skipped: ${skipped}`)
  return { seeded, skipped, total: rules.length }
}

// ── Brain file storage (Dropbox + Obsidian) ───────────────────────────────
// Smart folder names (emoji prefix keeps them sorted at top in Obsidian)
const SMART_FOLDERS = {
  CORE:       '⚡ CORE',
  RULES:      '📋 RULES',
  GOALS:      '🎯 GOALS',
  PRODUCTION: '🎵 PRODUCTION',
  KNOWLEDGE:  '🧠 KNOWLEDGE',
  PEOPLE:     '👥 PEOPLE',
  SONGS:      '📦 MY SONGS',
  IDEAS:      '💡 IDEAS',
}

function getSmartFolder(entry) {
  const cat = entry.category || ''
  if (entry.confidence === 'locked' || entry.priority === true) return SMART_FOLDERS.CORE
  if (entry.source_type === 'music_tips' || cat === 'power_dynamics_principles') return SMART_FOLDERS.RULES
  if (cat === 'goal') return SMART_FOLDERS.GOALS
  if (['mixing_technique', 'production_style', 'sound_design'].includes(cat)) return SMART_FOLDERS.PRODUCTION
  if (['market_knowledge', 'industry_insight', 'observation'].includes(cat)) return SMART_FOLDERS.KNOWLEDGE
  if (['contact_profile', 'collaboration', 'networking'].includes(cat)) return SMART_FOLDERS.PEOPLE
  if (['own_production', 'project_references'].includes(cat)) return SMART_FOLDERS.SONGS
  if (['creative_process', 'question'].includes(cat)) return SMART_FOLDERS.IDEAS
  return null
}

async function updateObsidianIndex() {
  try {
    const { data: entries } = await supabase
      .from('brain_knowledge')
      .select('id, title, category, confidence, priority, source_type, content')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(200)
    if (!entries?.length) return

    // Category counts for MOC section
    const catCounts = {}
    for (const e of entries) {
      if (e.category) catCounts[e.category] = (catCounts[e.category] || 0) + 1
    }
    const mocDir = path.join(OBSIDIAN_VAULT_PATH, 'MOC')
    const mocLines = ['## Categories']
    for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
      const safeCat = cat.replace(/[\/\\:*?"<>|]/g, '-')
      const hasMoc = fs.existsSync(path.join(mocDir, safeCat + '.md'))
      mocLines.push(`- ${hasMoc ? `[[MOC/${safeCat}]]` : cat.replace(/_/g, ' ')} (${count})`)
    }

    const sections = {}
    for (const e of entries) {
      const folder = getSmartFolder(e) || '🧠 KNOWLEDGE'
      if (!sections[folder]) sections[folder] = []
      if (sections[folder].length < 10) sections[folder].push(e)
    }

    const lines = [
      '# Momentum Brain Index',
      '',
      `*Auto-generated ${new Date().toLocaleDateString('de-CH')} · ${entries.length} entries*`,
      '',
      ...mocLines,
      ''
    ]
    for (const [folder, items] of Object.entries(sections)) {
      lines.push('## ' + folder)
      for (const e of items) {
        const snip = (e.content || '').slice(0, 60).replace(/\n/g, ' ')
        lines.push('- **' + e.title + '** — ' + snip)
      }
      lines.push('')
    }

    const indexPath = path.join(OBSIDIAN_VAULT_PATH, 'INDEX.md')
    _obsidianSyncDebounce.add(indexPath)
    setTimeout(() => _obsidianSyncDebounce.delete(indexPath), 8000)
    fs.writeFileSync(indexPath, lines.join('\n'), 'utf8')
    console.log('✓ Obsidian INDEX.md updated')
  } catch(e) { console.error('updateObsidianIndex error:', e.message) }
}

function cleanTitle(title) {
  return (title || '').replace(/^(\d{4}-\d{2}-\d{2}_)+/, '').trim()
}

// Find an existing .md file in dir whose bare name (date prefix stripped, lowercased) matches normalizedTitle
function findExistingObsidianFile(dir, normalizedTitle) {
  try {
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    const norm = (s) => s.toLowerCase().replace(/^(\d{4}-\d{2}-\d{2}_)+/, '').replace(/[^a-z0-9]/g, '').slice(0, 40)
    const target = norm(normalizedTitle)
    for (const f of files) {
      if (norm(path.basename(f, '.md')) === target) return path.join(dir, f)
    }
  } catch(e) {}
  return null
}

async function saveBrainFile(entry) {
  try {
    const category = entry.category || 'uncategorized'
    const folderPath = path.join(BRAIN_FILES_PATH, category)
    fs.mkdirSync(folderPath, { recursive: true })

    const safeTitle = cleanTitle(entry.title || 'untitled')
      .replace(/[^a-zA-Z0-9 \-_]/g, '')
      .trim()
      .slice(0, 60)

    const filename = new Date().toISOString().slice(0, 10) + '_' + safeTitle + '.md'
    const filepath = path.join(folderPath, filename)

    const lines = [
      '---',
      'category: ' + category,
      'confidence: ' + (entry.confidence || 'weak'),
      'source: ' + (entry.source_type || 'manual'),
      'created: ' + new Date().toISOString(),
      entry.source_url ? 'url: ' + entry.source_url : null,
      '---',
      '',
      '# ' + cleanTitle(entry.title || 'Untitled'),
      '',
      entry.content || ''
    ].filter(s => s !== null)
    const content = lines.join('\n')

    fs.writeFileSync(filepath, content, 'utf8')

    // Mirror into Obsidian vault under Brain/category/ — reuse existing file if same title
    const obsidianDir = path.join(OBSIDIAN_VAULT_PATH, 'Brain', category)
    fs.mkdirSync(obsidianDir, { recursive: true })
    const existingObsidian = findExistingObsidianFile(obsidianDir, safeTitle)
    const obsidianPath = existingObsidian || path.join(obsidianDir, filename)
    fs.writeFileSync(obsidianPath, content, 'utf8')

    // Copy to smart folder — never overwrite existing files
    const smartFolder = getSmartFolder(entry)
    if (smartFolder) {
      const smartDir = path.join(OBSIDIAN_VAULT_PATH, smartFolder)
      fs.mkdirSync(smartDir, { recursive: true })
      const smartPath = path.join(smartDir, filename)
      if (!fs.existsSync(smartPath)) fs.writeFileSync(smartPath, content, 'utf8')
    }

    return filepath
  } catch(e) {
    console.error('saveBrainFile error:', e.message)
    return null
  }
}

// ── Brain dedup: protect locked+text entries, merge agent content ────────────
async function mergeDupes() {
  const { data: rows, error } = await supabaseAdmin
    .from('brain_knowledge')
    .select('id, category, title, content, source_type, confidence, created_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error('mergeDupes fetch error: ' + error.message)

  const totalCount = (rows || []).length
  const maxDelete = Math.floor(totalCount * 0.2)

  function normalizeTitle(t) {
    return (t || '').replace(/^(\d{4}-\d{2}-\d{2}_)+/, '').toLowerCase().trim().slice(0, 60)
  }

  const isProtected = r => r.confidence === 'locked' || r.source_type === 'text'

  const groups = new Map()
  for (const row of (rows || [])) {
    const key = row.category + '||' + normalizeTitle(row.title)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  // First pass: collect all IDs to delete + merge updates
  const allDeleteIds = []
  const mergeUpdates = [] // [{id, content}]

  for (const [, group] of groups) {
    if (group.length < 2) continue

    const protectedEntries = group.filter(isProtected)
    const agentEntries     = group.filter(r => !isProtected(r))

    if (protectedEntries.length > 0) {
      if (agentEntries.length === 0) continue
      const keepEntry = protectedEntries[0]
      const allContent = [keepEntry, ...agentEntries].map(r => (r.content || '').trim()).filter(Boolean)
      const uniqueSentences = [...new Set(
        allContent.flatMap(c => c.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15))
      )]
      const mergedContent = uniqueSentences.slice(0, 6).join('. ')
      if (mergedContent.length > (keepEntry.content || '').length) mergeUpdates.push({ id: keepEntry.id, content: mergedContent })
      allDeleteIds.push(...agentEntries.map(r => r.id))
    } else {
      const keepEntry     = group[0]
      const deleteEntries = group.slice(1)
      const allContent = group.map(r => (r.content || '').trim()).filter(Boolean)
      const uniqueSentences = [...new Set(
        allContent.flatMap(c => c.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15))
      )]
      const mergedContent = uniqueSentences.slice(0, 6).join('. ')
      if (mergedContent.length > (keepEntry.content || '').length) mergeUpdates.push({ id: keepEntry.id, content: mergedContent })
      allDeleteIds.push(...deleteEntries.map(r => r.id))
    }
  }

  // Safety cap: never delete more than 20% in one run
  let toDelete = allDeleteIds
  if (toDelete.length > maxDelete) {
    console.warn(`mergeDupes safety: would delete ${toDelete.length} of ${totalCount} — capped at ${maxDelete}`)
    toDelete = toDelete.slice(0, maxDelete)
  }

  // Apply merges
  let merged = 0
  for (const { id, content } of mergeUpdates) {
    const { error: mgErr } = await supabaseAdmin.from('brain_knowledge').update({ content }).eq('id', id)
    if (mgErr) console.error('brain dedup merge failed:', id, mgErr.message)
    else merged++
  }

  // Apply deletes in batches
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 50) {
    const { error: dlErr } = await supabaseAdmin.from('brain_knowledge').delete().in('id', toDelete.slice(i, i + 50))
    if (dlErr) console.error('brain dedup delete failed:', dlErr.message)
    else deleted += Math.min(50, toDelete.length - i)
  }

  return { deleted, merged, total: totalCount, capped: allDeleteIds.length > maxDelete }
}

// ── Brain category consolidation ─────────────────────────────────────────
async function consolidateBrainCategories() {
  const deprecated = ['artist_breaking', 'emerging_artists_tracking']
  const target = 'artist_strategy'
  let moved = 0
  for (const oldCat of deprecated) {
    const { data: rows, error } = await supabaseAdmin
      .from('brain_knowledge')
      .select('id')
      .eq('category', oldCat)
    if (error) throw new Error(`consolidate fetch ${oldCat}: ` + error.message)
    if (!rows || !rows.length) continue
    const ids = rows.map(r => r.id)
    for (let i = 0; i < ids.length; i += 50) {
      const { error: upErr } = await supabaseAdmin
        .from('brain_knowledge')
        .update({ category: target })
        .in('id', ids.slice(i, i + 50))
      if (upErr) throw new Error(`consolidate update ${oldCat}: ` + upErr.message)
    }
    moved += ids.length
  }
  return { moved, target }
}

// ── Weekly system improvement review ─────────────────────────────────────
async function weeklySystemReview() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) { console.warn('weeklySystemReview: no ANTHROPIC_API_KEY'); return }

    const [brainRes, songsRes, tradesRes, releasesRes] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=category,confidence,created_at,source_type`, { headers: sbHeaders }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/songs?select=id,work_data,updated_at&limit=20`, { headers: sbHeaders }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/crypto_trades?select=*&order=traded_at.desc&limit=10`, { headers: sbHeaders }).then(r => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/releases?select=id,spotify_streams,updated_at&limit=10`, { headers: sbHeaders }).then(r => r.json())
    ])

    const brainEntries = brainRes.status === 'fulfilled' ? (brainRes.value || []) : []
    const songs = songsRes.status === 'fulfilled' ? (songsRes.value || []) : []
    const recentTrades = tradesRes.status === 'fulfilled' ? (tradesRes.value || []) : []
    const releases = releasesRes.status === 'fulfilled' ? (releasesRes.value || []) : []

    const weakEntries = brainEntries.filter(e => e.confidence === 'weak').length
    const lockedEntries = brainEntries.filter(e => e.confidence === 'locked').length
    const totalEntries = brainEntries.length
    const songsWithAnalysis = songs.filter(s => s.work_data?.versions?.some(v => v.analysis)).length
    const tradesThisWeek = recentTrades.filter(t => Date.now() - new Date(t.traded_at).getTime() < 7 * 24 * 3600000).length

    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800,
        system: `You are the Momentum system advisor for Remo, a music producer.
Every week you review the system and suggest concrete improvements.
Be specific, actionable, and prioritized. Max 5 suggestions.
Focus on what would have the most impact on his music career.
No bold text, no markdown, plain text only.`,
        messages: [{ role: 'user', content: `Weekly system review for Momentum Music Framework.

SYSTEM STATS:
Brain entries: ${totalEntries} total, ${weakEntries} weak, ${lockedEntries} locked
Songs in system: ${songs.length} (${songsWithAnalysis} analyzed, ${songs.length - songsWithAnalysis} missing analysis)
Releases tracked: ${releases.length}
Crypto trades this week: ${tradesThisWeek}

WHAT TO REVIEW:
1. What data is missing that would make Mozart smarter?
2. What workflows could be more automated?
3. What manual steps could be eliminated?
4. What new intelligence sources would help?
5. What in the brain should be promoted from weak to strong?

Give 3-5 specific, prioritized improvement suggestions for this week.
Each suggestion max 2 sentences. Be concrete not general.` }]
      })
    })
    const d = await cr.json()
    const review = d.content?.[0]?.text || ''

    if (TELEGRAM_TOKEN) {
      await sendTelegram(TELEGRAM_OWNER_ID,
        '🔧 Weekly System Improvements\n\n' + review + '\n\n→ Reply with what you want to build'
      )
    }

    const _sysRevEntry = { category: 'observation', title: 'System Review ' + new Date().toLocaleDateString('de-CH'), content: review, confidence: 'weak', source_type: 'system_review' }
    await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ..._sysRevEntry, entry_type_v2: 'observation', active: true })
    }).catch(() => {})
    setImmediate(() => saveBrainFile(_sysRevEntry).catch(() => {}))

    fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        endpoint: 'weekly-system-review', model: 'claude-haiku-4-5-20251001',
        input_tokens: d.usage?.input_tokens || 0, output_tokens: d.usage?.output_tokens || 0,
        cost_usd: ((d.usage?.input_tokens || 0) * 0.0000008) + ((d.usage?.output_tokens || 0) * 0.000001)
      })
    }).catch(() => {})
    console.log('✓ Weekly system review sent')
  } catch(e) { console.warn('weeklySystemReview error:', e.message) }
}

// ── Genius credits scraper ────────────────────────────────────────────────
async function fetchGeniusCredits(artist, title) {
  try {
    const query = encodeURIComponent((artist || '') + ' ' + (title || ''))
    const searchUrl = 'https://genius.com/search?q=' + query
    const r = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Accept': 'text/html' } })
    const html = await r.text()
    const linkMatch = html.match(/href="(https:\/\/genius\.com\/[^"]+lyrics[^"]+)"/)
    if (!linkMatch) return null
    const lyricsUrl = linkMatch[1]
    const lr = await fetch(lyricsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } })
    const lyricsHtml = await lr.text()

    const credits = { producers: [], writers: [], mixers: [], masterers: [], source_url: lyricsUrl }

    // Try Genius Next.js page data
    const jsonMatches = [...lyricsHtml.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)]
    for (const m of jsonMatches) {
      try {
        const data = JSON.parse(m[1])
        const song = data?.props?.pageProps?.song || data?.response?.song
        if (!song) continue
        if (song.producer_artists?.length) credits.producers.push(...song.producer_artists.map(a => a.name))
        if (song.writer_artists?.length) credits.writers.push(...song.writer_artists.map(a => a.name))
        if (song.custom_performances?.length) {
          for (const perf of song.custom_performances) {
            const label = (perf.label || '').toLowerCase()
            const names = (perf.artists || []).map(a => a.name)
            if (label.includes('produc')) credits.producers.push(...names)
            if (label.includes('mix')) credits.mixers.push(...names)
            if (label.includes('master')) credits.masterers.push(...names)
            if (label.includes('writ')) credits.writers.push(...names)
          }
        }
        if (credits.producers.length || credits.mixers.length) break
      } catch(e) {}
    }

    // Fallback: regex
    if (!credits.producers.length) {
      const pm = lyricsHtml.match(/[Pp]roduced by[^<]*<[^>]+>([^<]+)/)
      if (pm) credits.producers.push(pm[1].trim())
    }
    if (!credits.mixers.length) {
      const mm = lyricsHtml.match(/[Mm]ixed by[^<]*<[^>]+>([^<]+)/)
      if (mm) credits.mixers.push(mm[1].trim())
    }
    if (!credits.masterers.length) {
      const mm = lyricsHtml.match(/[Mm]astered by[^<]*<[^>]+>([^<]+)/)
      if (mm) credits.masterers.push(mm[1].trim())
    }

    // Deduplicate
    credits.producers = [...new Set(credits.producers)]
    credits.writers = [...new Set(credits.writers)]
    credits.mixers = [...new Set(credits.mixers)]
    credits.masterers = [...new Set(credits.masterers)]

    return credits
  } catch(e) {
    console.error('genius credits error:', e.message)
    return null
  }
}

// ── Acapella extraction — Demucs vocal separation + librosa onset + ffmpeg trim ──
const ACAPELLA_PYTHON = '/opt/homebrew/bin/python3.11'
const ACAPELLA_ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')

async function extractAcapella(inputPath) {
  const basename = path.basename(inputPath, path.extname(inputPath))
  const tmpDir = `/tmp/acapella_${Date.now()}`
  fs.mkdirSync(tmpDir, { recursive: true })

  // Step 1: Demucs vocal separation
  await new Promise((resolve, reject) => {
    exec(
      `"${ACAPELLA_PYTHON}" -m demucs --two-stems=vocals -o ${shellEscape(tmpDir)} ${shellEscape(inputPath)}`,
      { timeout: 300000 },
      (err) => err ? reject(new Error('Demucs failed: ' + err.message)) : resolve()
    )
  })

  const vocalsPath = path.join(tmpDir, 'htdemucs', basename, 'vocals.wav')
  if (!fs.existsSync(vocalsPath)) throw new Error('Demucs output not found: ' + vocalsPath)

  // Step 2: librosa onset detection via inline Python
  const onsetScript = `
import librosa, numpy as np, json, sys
y, sr = librosa.load(sys.argv[1], sr=None, mono=True)
rms = librosa.feature.rms(y=y)[0]
thresh = rms.max() * 0.05
frames = np.where(rms > thresh)[0]
onset_sec = max(0, librosa.frames_to_time(frames[0], sr=sr) - 0.1) if len(frames) else 0.0
print(json.dumps({'onset': float(onset_sec)}))
`
  const onsetScriptPath = `/tmp/onset_${Date.now()}.py`
  fs.writeFileSync(onsetScriptPath, onsetScript)
  const onsetRaw = execSync(`"${ACAPELLA_PYTHON}" ${shellEscape(onsetScriptPath)} ${shellEscape(vocalsPath)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
  const { onset: onsetTime } = JSON.parse(onsetRaw)
  fs.unlinkSync(onsetScriptPath)

  // Step 3: Essentia BPM + key
  let bpm = 0, keyLabel = 'unknown'
  try {
    const esRaw = execSync(`"${ACAPELLA_PYTHON}" "${ACAPELLA_ANALYZE_SCRIPT}" ${shellEscape(vocalsPath)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
    const esData = JSON.parse(esRaw)
    bpm = Math.round(esData.bpm || 0)
    keyLabel = (esData.key && esData.scale) ? `${esData.key}${esData.scale === 'minor' ? 'm' : ''}` : (esData.key || 'unknown')
  } catch(e) { console.warn('Essentia on vocals failed (non-fatal):', e.message) }

  // Step 4: ffmpeg trim from onset → Desktop
  const safeBpm = bpm || 'unknown'
  const outFilename = `${basename}_acapella_${safeBpm}bpm_${keyLabel}.wav`
  const outputPath = path.join('/Users/remo/Desktop', outFilename)
  await new Promise((resolve, reject) => {
    exec(
      `ffmpeg -y -ss ${onsetTime.toFixed(3)} -i "${vocalsPath}" -c copy "${outputPath}"`,
      { timeout: 60000 },
      (err) => err ? reject(new Error('ffmpeg trim failed: ' + err.message)) : resolve()
    )
  })

  // Cleanup Demucs temp folder
  exec('rm -rf "' + tmpDir + '"')

  return { filename: outFilename, path: outputPath, bpm: safeBpm, key: keyLabel, onset: onsetTime }
}

// ── Vocal EQ — standalone reference analysis function ────────────────────
const VOCAL_EQ_SCRIPT = path.join(__dirname, 'analyze_vocal_eq.py')
const VOCAL_EQ_PYTHON = '/opt/homebrew/bin/python3.11'

async function analyzeVocalEqUrl(url, songId, label) {
  const tmpAudio = `/tmp/vocal_ref_${Date.now()}.mp3`
  let audioReady = false

  if (url.includes('spotify.com/track/')) {
    const trackId = url.split('/track/')[1]?.split('?')[0]?.split('/')[0]
    if (!trackId) return
    try {
      const trackRes = await spotifyFetch(`https://api.spotify.com/v1/tracks/${trackId}`)
      const track = await trackRes.json()
      if (track.preview_url) {
        execSync(`curl -s -o "${tmpAudio}" "${track.preview_url}"`, { timeout: 15000 })
        audioReady = true
        console.log('✓ Spotify preview for vocal EQ ref:', track.name)
      }
      if (!audioReady) {
        const q = ((track.artists?.[0]?.name || '') + ' ' + track.name).replace(/"/g, '')
        execSync(`yt-dlp -x --audio-format mp3 --download-sections "*0-90" -o "${tmpAudio}" "ytsearch1:${q}"`, { timeout: 90000 })
        audioReady = true
        console.log('✓ yt-dlp fallback for vocal EQ ref:', q)
      }
    } catch(e) { throw new Error('Audio download failed: ' + e.message.slice(0, 100)) }
  } else {
    try {
      execSync(`yt-dlp -x --audio-format mp3 --download-sections "*0-90" -o "${tmpAudio}" "${url}"`, { timeout: 90000 })
      audioReady = true
    } catch(e) { throw new Error('yt-dlp failed: ' + e.message.slice(0, 100)) }
  }
  if (!audioReady) throw new Error('Could not download audio for vocal EQ')

  console.log('⏳ Running stem EQ analysis (ref):', label || url)
  const raw = execSync(`"${VOCAL_EQ_PYTHON}" "${VOCAL_EQ_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 400000 }).trim()
  try { fs.unlinkSync(tmpAudio) } catch(e) {}

  const result = JSON.parse(raw)
  if (!result.ok) throw new Error(result.error || 'Script failed')

  const savedRefCurves = []
  for (const [stemName, curve] of Object.entries(result.stems || {})) {
    const { data, error } = await supabaseAdmin
      .from('vocal_eq_curves')
      .insert({
        label: (label || 'Reference') + ' — ' + stemName,
        song_id: songId ? String(songId) : null,
        curve,
        stem_type: stemName,
        source_type: 'reference'
      })
      .select()
    if (error) {
      console.error('✗ vocal_eq_curves ref save error:', error.message, error.code)
    } else {
      console.log('✓ saved ref curve:', stemName, label || url)
      savedRefCurves.push({ stemName, id: data?.[0]?.id })
    }
  }
  const savedId = savedRefCurves[0]?.id || null
  return { id: savedId, stems: result.stems }
}

// ── HTTP server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Oldfile, X-Artist, X-Song, Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // ── POST /write-component — writes a Svelte component to src/lib/ ──────────
  if (req.method === 'POST' && req.url === '/write-component') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { filename, content } = JSON.parse(body)
        if (!filename || !filename.endsWith('.svelte') || filename.includes('..')) throw new Error('Invalid filename')
        const destPath = path.join(process.env.HOME, 'momentum', 'src', 'lib', filename)
        fs.writeFileSync(destPath, content, 'utf8')
        console.log(`✓ Wrote component: ${destPath}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: destPath }))
      } catch(err) {
        logError('write-component', err.message)
        console.error('✗ write-component:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  if (req.method === 'POST' && req.url === '/normalize') {
    const filename = decodeURIComponent(req.headers['x-filename'] || 'audio.wav')
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks)
        const ext = path.extname(filename).toLowerCase()
        const baseName = path.basename(filename, ext)
        const tmpIn = path.join(os.tmpdir(), 'norm_in_' + Date.now() + ext)
        const outName = baseName + '_-14LUFS' + ext
        const outPath = path.join(process.env.HOME, 'Desktop', outName)
        fs.writeFileSync(tmpIn, buf)
        const ffmpegPaths = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
        let ffmpeg = null
        for (const p of ffmpegPaths) {
          try { execSync(`${p} -version`, { stdio: 'ignore' }); ffmpeg = p; break } catch(e) {}
        }
        if (!ffmpeg) throw new Error('ffmpeg not found — install with: brew install ffmpeg')
        // Pass 1: measure integrated LUFS only — no encoding
        const measured = execSync(
          `"${ffmpeg}" -i ${shellEscape(tmpIn)} -af ebur128=framelog=verbose -f null /dev/null 2>&1`,
          { encoding: 'utf8' }
        )
        const lufsMatch = measured.match(/I:\s*(-?\d+\.?\d*)\s*LUFS/)
        if (!lufsMatch) throw new Error('Could not measure LUFS — is the file valid audio?')
        const currentLUFS = parseFloat(lufsMatch[1])
        const gainDb = (-14 - currentLUFS).toFixed(2)
        console.log(`  Measured: ${currentLUFS} LUFS → applying ${gainDb}dB gain`)
        // Pass 2: apply exact gain offset only — no other processing, preserve format
        const encFlags = {
          '.wav':  '-c:a pcm_s24le',
          '.aif':  '-c:a pcm_s24be',
          '.aiff': '-c:a pcm_s24be',
          '.flac': '-c:a flac',
          '.mp3':  '-c:a libmp3lame -q:a 0',
          '.m4a':  '-c:a aac -b:a 320k',
        }[ext] || '-c:a pcm_s24le'
        execSync(`"${ffmpeg}" -i ${shellEscape(tmpIn)} -af "volume=${gainDb}dB" ${encFlags} -y ${shellEscape(outPath)}`, { stdio: 'pipe' })
        fs.unlinkSync(tmpIn)
        console.log(`✓ Normalized → ${outPath}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, outFile: outName, gain: gainDb + 'dB', from: currentLUFS + ' LUFS' }))
      } catch(err) {
        logError('normalize', err.message)
        console.error('✗ normalize error:', err.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  // ── GET /backup — download full Supabase backup as JSON ──────────────
  if (req.url === '/backup') {
    const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
    const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
    const tables = ['songs','projects','patches','patch_songs','connections','daily_state','finances','notes','work_checklist','work_tip_sections','work_tips','work_cards','settings']
    const backup = { _version: 1, _date: new Date().toISOString(), tables: {} }
    try {
      for (const table of tables) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=10000`, {
          headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
        })
        backup.tables[table] = await r.json()
      }
      const json = JSON.stringify(backup, null, 2)
      const filename = `momentum-backup-${new Date().toISOString().slice(0,10)}.json`
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(json)
      })
      res.end(json)
      console.log(`✓ Backup downloaded: ${filename}`)
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /restore — restore from JSON backup ──────────────────────────
  if (req.method === 'POST' && req.url === '/restore') {
    const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
    const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const backup = JSON.parse(body)
        const results = {}
        for (const [table, rows] of Object.entries(backup.tables || {})) {
          if (!Array.isArray(rows) || !rows.length) { results[table] = 'skipped (empty)'; continue }
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
              'apikey': ANON_KEY,
              'Authorization': `Bearer ${ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(rows)
          })
          results[table] = r.ok ? `restored ${rows.length} rows` : `error ${r.status}`
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, results }))
        console.log('✓ Restore complete:', results)
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /backup-ui — backup/restore page ─────────────────────────────
  if (req.url === '/backup-ui') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Momentum Backup</title>
<style>
  body{background:#0a0a0a;color:#f5f1ea;font-family:'Space Mono',monospace;padding:40px;max-width:600px}
  h2{color:#c9a84c;font-size:17px;margin-bottom:24px}
  .btn{display:inline-block;padding:10px 24px;background:#c9a84c;color:#0a0a0a;font-family:'Space Mono',monospace;font-size:13px;font-weight:700;border:none;border-radius:3px;cursor:pointer;text-decoration:none;margin-right:12px}
  .btn-outline{background:transparent;border:1px solid #303030;color:#9e9690}
  .btn-outline:hover{border-color:#c9a84c;color:#c9a84c}
  .section{margin-bottom:32px;padding:20px;background:#1c1c1c;border-radius:4px;border:1px solid #252525}
  .label{font-size:11px;color:#555;margin-bottom:8px;letter-spacing:.1em}
  .status{font-size:12px;color:#4caf82;margin-top:12px;display:none}
  .error{color:#e05a4a}
  input[type=file]{display:none}
</style></head><body>
<h2>MOMENTUM BACKUP</h2>
<div class="section">
  <div class="label">DOWNLOAD BACKUP</div>
  <p style="font-size:13px;color:#9e9690;margin:0 0 12px">Downloads all your data as a JSON file — songs, projects, connections, demos, daily, finances, tips.</p>
  <a class="btn" href="/backup">↓ Download Backup</a>
</div>
<div class="section">
  <div class="label">RESTORE FROM BACKUP</div>
  <p style="font-size:13px;color:#9e9690;margin:0 0 12px">Select a previously downloaded backup file. Existing data will be merged (not deleted).</p>
  <button class="btn btn-outline" onclick="document.getElementById('f').click()">↑ Choose Backup File</button>
  <input type="file" id="f" accept=".json" onchange="restore(this)">
  <div class="status" id="s"></div>
</div>
<script>
async function restore(input) {
  const file = input.files[0]; if (!file) return
  const s = document.getElementById('s')
  s.style.display='block'; s.textContent='Restoring...'
  try {
    const text = await file.text()
    const r = await fetch('/restore', { method:'POST', headers:{'Content-Type':'application/json'}, body: text })
    const data = await r.json()
    if (data.ok) {
      s.textContent = '✓ Restored! ' + Object.entries(data.results).map(([t,v])=>t+': '+v).join(', ')
    } else { s.className='status error'; s.textContent = '✗ Error: ' + data.error }
  } catch(e) { s.className='status error'; s.textContent='✗ '+e.message }
}
</script></body></html>`)
    return
  }

  // ── GET /dropbox-auth — start OAuth2 flow ─────────────────────────────
  if (req.url === '/dropbox-auth') {
    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${DROPBOX_APP_KEY}&response_type=code&token_access_type=offline&redirect_uri=http://localhost:4242/dropbox-callback`
    res.writeHead(302, { Location: authUrl }); res.end(); return
  }

  // ── GET /dropbox-callback — exchange code for refresh token ──────────
  if (req.url.startsWith('/dropbox-callback')) {
    const code = new URL(req.url, 'http://localhost').searchParams.get('code')
    if (!code) { res.writeHead(400); res.end('Missing code'); return }
    try {
      const creds = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64')
      const body = `code=${encodeURIComponent(code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent('http://localhost:4242/dropbox-callback')}`
      const data = await fetchJSON('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (data.refresh_token) {
        dropboxTokens = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in||14400)*1000 }
        saveTokens()
        console.log('✓ Dropbox authorized! Refresh token saved to', TOKEN_FILE)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="background:#0a0a0a;color:#4caf82;font-family:monospace;padding:40px"><h2>✓ Dropbox connected!</h2><p>You can close this tab. Momentum Watcher is now authorized permanently.</p></body></html>')
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="background:#0a0a0a;color:#e05a4a;font-family:monospace;padding:40px"><h2>✗ Error</h2><pre>${JSON.stringify(data,null,2)}</pre></body></html>`)
      }
    } catch(err) { res.writeHead(500); res.end(err.message) }
    return
  }

  // ── POST /rename-audio ────────────────────────────────────────────────
  if (req.method === 'POST' && req.url.startsWith('/rename-audio')) {
    const u = new URL(req.url, 'http://localhost')
    const dir = u.searchParams.get('dir'), oldfile = u.searchParams.get('oldfile'), newfile = u.searchParams.get('newfile')
    const targetDir = dir === 'mixing' ? MIXING_DIR : dir === 'demo' ? DEMOS_DIR : dir === 'instrumental' ? INSTRUMENTALS_DIR : PRODUCTION_DIR
    try {
      const oldPath = path.join(targetDir, oldfile), newPath = path.join(targetDir, newfile)
      if (fs.existsSync(oldPath) && oldfile !== newfile) { fs.renameSync(oldPath, newPath); console.log(`  ✓ Renamed: ${oldfile} → ${newfile}`) }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
    } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    return
  }

  // ── POST /delete-audio ────────────────────────────────────────────────
  if (req.method === 'POST' && req.url.startsWith('/delete-audio')) {
    const u = new URL(req.url, 'http://localhost')
    const dir = u.searchParams.get('dir'), filename = u.searchParams.get('filename')
    const targetDir = dir === 'mixing' ? MIXING_DIR : dir === 'demo' ? DEMOS_DIR : dir === 'instrumental' ? INSTRUMENTALS_DIR : PRODUCTION_DIR
    try {
      const filePath = path.join(targetDir, filename)
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); console.log('  🗑 Deleted:', filename) }
      // Also delete preview MP3 if this is a demo file
      if (dir === 'demo') {
        const previewName = filename.replace(/\.[^.]+$/, '_preview.mp3')
        const previewPath = path.join(targetDir, previewName)
        if (fs.existsSync(previewPath)) { fs.unlinkSync(previewPath); console.log('  🗑 Deleted preview:', previewName) }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
    } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    return
  }

  // ── POST /copy-to-demos ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/copy-to-demos') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { sourceDir, sourceFile, destFile } = JSON.parse(body)
        const srcDir = sourceDir === 'mixing' ? MIXING_DIR : PRODUCTION_DIR
        const srcPath = path.join(srcDir, sourceFile), destPath = path.join(DEMOS_DIR, destFile)
        if (!fs.existsSync(srcPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Source not found: ' + srcPath })); return }
        fs.copyFileSync(srcPath, destPath)
        console.log('  ✓ Copied to Demos:', destFile)
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, destFile }))
      } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/share-link') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { filePath } = JSON.parse(body)
        // filePath is relative to Dropbox root e.g. /!MOMENTUM MUSIC/Production/file.wav
        let shareLink = null
        if (DROPBOX_APP_KEY) shareLink = await getDropboxShareLink(filePath)

        // Transcode WAV → MP3 (320k) alongside the original, non-blocking
        let mp3ShareLink = null
        let mp3Path = null
        const localPath = path.join(process.env.HOME, 'Dropbox', filePath)
        if (localPath.toLowerCase().endsWith('.wav') && fs.existsSync(localPath)) {
          const localMp3 = localPath.replace(/\.wav$/i, '.mp3')
          const dbxMp3   = filePath.replace(/\.wav$/i, '.mp3')
          mp3Path = dbxMp3
          // Fire-and-forget: transcode then get Dropbox link
          transcodeToMp3(localPath, localMp3)
            .then(() => {
              console.log(`✓ Transcoded MP3: ${path.basename(localMp3)}`)
              if (DROPBOX_APP_KEY) {
                return getDropboxShareLink(dbxMp3)
              }
            })
            .catch(e => console.warn('  MP3 transcode failed:', e.message.slice(0, 80)))
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, shareLink, mp3Path, mp3ShareLink }))
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /delete-submission-folder — deletes a submission folder ──────────
  if (req.method === 'POST' && req.url === '/delete-submission-folder') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { patchName } = JSON.parse(body)
        const folderName = patchName.replace(/[<>:"/\\|?*]/g, '_').trim()
        const folderPath = path.join(SUBMISSIONS_DIR, folderName)
        if (fs.existsSync(folderPath)) {
          fs.rmSync(folderPath, { recursive: true, force: true })
          console.log('  🗑 Deleted submission folder:', folderName)
        } else {
          console.log('  ⚠ Folder not found:', folderPath)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
      } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    })
    return
  }

  // ── POST /delete-from-submission — deletes one file from submission folder ──
  if (req.method === 'POST' && req.url === '/delete-from-submission') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { patchName, audioFile, songCode } = JSON.parse(body)
        if (!patchName) { res.writeHead(200); res.end(JSON.stringify({ ok: true })); return }
        const folderName = patchName.replace(/[<>:"/\\|?*]/g, '_').trim()
        const folderPath = path.join(SUBMISSIONS_DIR, folderName)
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath)
          // Match by exact filename, or by song code prefix
          const match = files.find(f =>
            f === audioFile ||
            (audioFile && f.startsWith(audioFile.replace(/\.[^.]+$/, ''))) ||
            (songCode && f.startsWith(songCode))
          )
          if (match) {
            fs.unlinkSync(path.join(folderPath, match))
            console.log('  🗑 Removed from submission:', match)
          } else {
            console.log('  ⚠ File not found in submission:', audioFile, 'in', folderPath)
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
      } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    })
    return
  }

  // ── POST /delete-audio — deletes a file from Production, Mixing, or Demos ──
  if (req.method === 'POST' && req.url.startsWith('/delete-audio')) {
    const u = new URL(req.url, 'http://localhost')
    const dir = u.searchParams.get('dir')
    const filename = u.searchParams.get('filename')
    const targetDir = dir === 'mixing' ? MIXING_DIR : dir === 'demo' ? DEMOS_DIR : PRODUCTION_DIR
    try {
      const filePath = path.join(targetDir, filename)
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); console.log('  🗑 Deleted:', filename) }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }))
    } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    return
  }

  // ── POST /copy-to-demos — copies production/mixing file to Demos as CODE_v00 ──
  if (req.method === 'POST' && req.url === '/copy-to-demos') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { sourceDir, sourceFile, destFile } = JSON.parse(body)
        const srcDir = sourceDir === 'mixing' ? MIXING_DIR : PRODUCTION_DIR
        const srcPath = path.join(srcDir, sourceFile)
        const destPath = path.join(DEMOS_DIR, destFile)
        if (!fs.existsSync(srcPath)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Source not found: ' + srcPath })); return }
        fs.copyFileSync(srcPath, destPath)
        console.log('  ✓ Copied to Demos:', destFile)
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, destFile }))
      } catch(err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })) }
    })
    return
  }

  // ── GET /dropbox-auth — start OAuth flow ──────────────────────────────
  if (req.url === '/dropbox-auth') {
    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${DROPBOX_APP_KEY}&response_type=code&token_access_type=offline&redirect_uri=http://localhost:4242/dropbox-callback`
    res.writeHead(302, { Location: authUrl }); res.end(); return
  }

  // ── GET /dropbox-callback — exchange code for refresh token ───────────
  if (req.url.startsWith('/dropbox-callback')) {
    const code = new URL(req.url, 'http://localhost').searchParams.get('code')
    if (!code) { res.writeHead(400); res.end('Missing code'); return }
    try {
      const creds = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64')
      const body = `code=${encodeURIComponent(code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent('http://localhost:4242/dropbox-callback')}`
      const data = await fetchJSON('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (data.refresh_token) {
        dropboxTokens = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in||14400)*1000 }
        saveTokens()
        console.log('✓ Dropbox authorized! Refresh token saved.')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="background:#0a0a0a;color:#4caf82;font-family:monospace;padding:40px"><h2>✓ Dropbox connected!</h2><p>You can close this tab. Momentum Watcher is now authorized permanently.</p></body></html>')
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="background:#0a0a0a;color:#e05a4a;font-family:monospace;padding:40px"><h2>✗ Error</h2><pre>${JSON.stringify(data,null,2)}</pre></body></html>`)
      }
    } catch(err) { res.writeHead(500); res.end(err.message) }
    return
  }

  // ── POST /open-folder — open path in Finder ──────────────────────────────
  if (req.method === 'POST' && req.url === '/open-folder') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { path: folderPath } = JSON.parse(body)
        if (!folderPath) throw new Error('path required')
        exec(`open "${folderPath}"`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /create-release-entry — folder + SUMMARY.txt + Supabase insert ─
  if (req.method === 'POST' && req.url === '/create-release-entry') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { song_id, title, artist, code, release_date, label, distributor, isrc, upc, notes, work_data } = JSON.parse(body)
        const safeName = s => (s || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim()
        const folderName = [safeName(code), safeName(artist).toUpperCase(), safeName(title).toUpperCase()].filter(Boolean).join('_')
        const folderPath = path.join(RELEASES_DIR, folderName)
        fs.mkdirSync(folderPath, { recursive: true })

        const summary = buildReleaseSummary({ title, artist, code, release_date }, work_data)
        fs.writeFileSync(path.join(folderPath, 'SUMMARY.txt'), summary, 'utf8')
        console.log('✓ Created release entry:', folderPath)

        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/releases`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            song_id: song_id || null,
            song_title: title,
            song_code: code,
            artist: artist || null,
            code: code || null,
            release_date: release_date || null,
            label: label || null,
            distributor: distributor || null,
            isrc: isrc || null,
            upc: upc || null,
            notes: notes || null,
            folder_path: folderPath,
            status: 'released'
          })
        })
        const inserted = await insertRes.json()
        const newId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, folder_path: folderPath, folder_name: folderName, id: newId }))
      } catch(err) {
        console.error('✗ create-release-entry:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /create-release-folder — creates Releases/YEAR/CODE_Artist_Title/ structure ──
  if (req.method === 'POST' && req.url === '/create-release-folder') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { songCode, artistName, songTitle, releaseDate, latestMixFile, latestProdFile, songData } = JSON.parse(body)
        const year = (releaseDate || new Date().toISOString()).slice(0, 4)
        const safeName = (s) => (s||'').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim()
        const folderName = [safeName(songCode), safeName(artistName), safeName(songTitle)].filter(Boolean).join('_')
        const releaseRoot = path.join(RELEASES_DIR, year, folderName)

        // Create subfolders
        const subfolders = ['Admin', 'Master', 'Mix', 'Project', 'Promo']
        for (const sub of subfolders) {
          fs.mkdirSync(path.join(releaseRoot, sub), { recursive: true })
        }
        console.log(`✓ Created release folder: ${releaseRoot}`)

        // Copy latest mix audio → Mix/
        if (latestMixFile && fs.existsSync(path.join(MIXING_DIR, latestMixFile))) {
          fs.copyFileSync(path.join(MIXING_DIR, latestMixFile), path.join(releaseRoot, 'Mix', latestMixFile))
          console.log(`  ✓ Copied mix: ${latestMixFile}`)
        }
        // Copy latest production audio → Project/
        if (latestProdFile && fs.existsSync(path.join(PRODUCTION_DIR, latestProdFile))) {
          fs.copyFileSync(path.join(PRODUCTION_DIR, latestProdFile), path.join(releaseRoot, 'Project', latestProdFile))
          console.log(`  ✓ Copied production: ${latestProdFile}`)
        }

        // Write songinfo.txt → Admin/
        if (songData) {
          const lines = [
            `RELEASE INFO — ${folderName}`,
            `Generated: ${new Date().toISOString()}`,
            '═══════════════════════════════════════',
            `Code:         ${songCode || '—'}`,
            `Title:        ${songTitle || '—'}`,
            `Artist:       ${artistName || '—'}`,
            `Release Date: ${releaseDate || '—'}`,
            '',
          ]
          if (songData.notes) { lines.push('NOTES / BRIEF', songData.notes, '') }
          if (songData.feedback) { lines.push('FEEDBACK', songData.feedback, '') }
          if (songData.session_log?.length) {
            lines.push('SESSION LOG')
            songData.session_log.forEach(e => lines.push(`  ${e.date}  ${e.stage}  ${e.seconds ? Math.round(e.seconds/60)+'min' : ''}`))
            lines.push('')
          }
          if (songData.versions?.length) {
            lines.push('VERSIONS')
            songData.versions.forEach(v => {
              lines.push(`  ${v.name} (${v.version_type})${v.sent_to_artist ? ' — sent to artist' : ''}`)
              if (v.feedback?.length) v.feedback.forEach(f => lines.push(`    ${f.done?'✓':' '} ${f.text}`))
            })
            lines.push('')
          }
          if (songData.reference_links?.length) {
            lines.push('REFERENCES')
            songData.reference_links.forEach(r => lines.push(`  — ${r.name || r.url || r}`))
            lines.push('')
          }
          fs.writeFileSync(path.join(releaseRoot, 'Admin', 'songinfo.txt'), lines.join('\n'), 'utf8')
          console.log(`  ✓ Written songinfo.txt`)
        }

        // Get Dropbox share link for the folder
        const dbxPath = releaseRoot.replace(path.join(process.env.HOME, 'Dropbox'), '').replace(/\\/g, '/')
        let shareLink = null
        try { shareLink = await getDropboxShareLink(dbxPath) } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, folderPath: releaseRoot, folderName, shareLink }))
      } catch(err) {
        logError('create-release-folder', err.message)
        console.error('✗ create-release-folder error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /copy-demo-to-production — copies demo audio → Production as CODE_Title_v00.ext ──
  if (req.method === 'POST' && req.url === '/copy-demo-to-production') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { demoFile, outFile } = JSON.parse(body)
        if (!demoFile) throw new Error('demoFile required')
        const srcPath = path.join(DEMOS_DIR, demoFile)
        if (!fs.existsSync(srcPath)) throw new Error('Demo file not found: ' + demoFile)
        const destPath = path.join(PRODUCTION_DIR, outFile)
        fs.mkdirSync(PRODUCTION_DIR, { recursive: true })
        fs.copyFileSync(srcPath, destPath)
        // Delete source demo file now that production copy exists
        try { fs.unlinkSync(srcPath) } catch(e) { console.warn('Could not delete demo source:', e.message) }
        console.log(`✓ Moved demo → production: ${demoFile} → ${outFile}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, outFile }))
      } catch(err) {
        logError('copy-demo-to-production', err.message)
        console.error('✗ copy-demo-to-production:', err.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  // ── POST /delete-release-folder ──────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/delete-release-folder') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { songCode, artistName, songTitle, releaseDate } = JSON.parse(body)
        const year = (releaseDate || '').slice(0, 4) || new Date().getFullYear().toString()
        const safe = s => (s||'').replace(/[<>:"/\\|?*]/g,'_').replace(/\s+/g,'_').trim()
        const folderName = [safe(songCode), safe(artistName), safe(songTitle)].filter(Boolean).join('_')
        const folderPath = path.join(RELEASES_DIR, year, folderName)
        if (fs.existsSync(folderPath)) {
          fs.rmSync(folderPath, { recursive: true, force: true })
          console.log(`✓ Deleted release folder: ${folderPath}`)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(err) {
        logError('delete-release-folder', err.message)
        console.error('✗ delete-release-folder:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  if (req.method === 'POST' && req.url === '/copy-to-release') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        // data.destPath = relative path within Releases folder e.g. "2026/CODE_Artist_Title/Admin/file.pdf"
        const destFull = path.join(RELEASES_DIR, data.destPath)
        const destDir = path.dirname(destFull)
        fs.mkdirSync(destDir, { recursive: true })
        const buf = Buffer.from(data.content, 'base64')
        fs.writeFileSync(destFull, buf)
        console.log(`  ✓ Copied to release: ${destFull}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }
  // Query: ?dir=production|mixing|demo&filename=...&oldfile=...
  if (req.method === 'POST' && req.url.startsWith('/save-audio')) {
    const u = new URL(req.url, 'http://localhost')
    const dir    = u.searchParams.get('dir')
    const fname  = u.searchParams.get('filename')
    const oldfile = u.searchParams.get('oldfile') || ''
    const songIdParam = u.searchParams.get('song_id') || ''
    const targetDir = dir === 'mixing' ? MIXING_DIR : dir === 'demo' ? DEMOS_DIR : PRODUCTION_DIR
    if (!fname) { res.writeHead(400); res.end('missing filename'); return }

    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        // Delete old file if exists
        if (oldfile && oldfile !== fname) {
          const oldPath = path.join(targetDir, oldfile)
          if (fs.existsSync(oldPath)) { fs.unlinkSync(oldPath); console.log(`  🗑 Deleted: ${oldfile}`) }
        }
        const buf = Buffer.concat(chunks)
        const destPath = path.join(targetDir, fname)
        fs.writeFileSync(destPath, buf)
        console.log(`  ✓ Saved ${dir}: ${fname} (${(buf.length/1024/1024).toFixed(1)}MB)`)

        // Respond immediately — Essentia runs in background
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename: fname, path: destPath }))

        // Background Essentia analysis for WAV files
        if (fname.toLowerCase().endsWith('.wav')) {
          setImmediate(async () => {
            const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
            const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
            try {
              const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(destPath)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
              const feat = JSON.parse(esOut)
              const bpm = feat.bpm ? Math.round(feat.bpm) : null
              const esKey = feat.key && feat.scale ? feat.key + ' ' + feat.scale : null
              const analysis = {
                bpm: feat.bpm, key: feat.key, scale: feat.scale, camelot: feat.camelot || null,
                energy: feat.energy, danceability: feat.danceability, valence: feat.valence,
                loudness_lufs: feat.loudness_lufs, brightness: feat.brightness,
                spectral_centroid: feat.spectral_centroid || null,
                spectral_contrast: feat.spectral_contrast || null,
                bass_energy: feat.bass_energy, duration_seconds: feat.duration_seconds,
                tonal_balance: feat.tonal_balance || null,
                stereo_width: feat.stereo_width ?? null,
                stereo_width_per_band: feat.stereo_width_per_band || null
              }
              console.log(`  ✓ Essentia (bg): ${fname} → ${bpm}bpm ${esKey} (${feat.camelot}) nrg:${feat.energy}`)

              // Find song by song_id param (preferred) or code prefix
              let song = null
              if (songIdParam) {
                const songRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=id,code,work_data&id=eq.${encodeURIComponent(songIdParam)}&limit=1`, { headers: sbHeaders })
                const rows = await songRes.json()
                song = Array.isArray(rows) ? rows[0] : null
              }
              if (!song) {
                const code = fname.split('_')[0]
                if (code) {
                  const songRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=id,code,work_data&code=eq.${encodeURIComponent(code)}&limit=1`, { headers: sbHeaders })
                  const rows = await songRes.json()
                  song = Array.isArray(rows) ? rows[0] : null
                }
              }
              if (song) {
                const wd = song.work_data || {}
                const versions = wd.versions || []
                const vIdx = versions.findIndex(v => v.name === fname || (v.audio_path || '').endsWith(fname))
                if (vIdx >= 0) {
                  versions[vIdx] = { ...versions[vIdx], analysis }
                } else if (versions.length > 0) {
                  versions[versions.length - 1] = { ...versions[versions.length - 1], analysis }
                }
                wd.versions = versions
                await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${song.id}`, {
                  method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ work_data: wd })
                })
                console.log(`  ✓ Essentia (bg): updated work_data for song ${song.code || song.id}`)
              }

              // Save to brain_knowledge as own_production if not yet stored
              if (bpm && esKey) {
                const titleParsed = fname.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
                const today = new Date().toISOString().slice(0, 10)
                const exRes = await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.own_production&title=eq.${encodeURIComponent(titleParsed)}&limit=1`, { headers: sbHeaders })
                const exRows = await exRes.json()
                if (!Array.isArray(exRows) || exRows.length === 0) {
                  await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
                    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                    body: JSON.stringify({
                      category: 'own_production', title: titleParsed,
                      content: `${bpm}bpm · ${esKey} (${feat.camelot || '?'}) · nrg ${feat.energy} · dnc ${feat.danceability} · ${feat.loudness_lufs}LUFS`,
                      entry_type: 'observation', confidence: 'medium', active: true,
                      metadata: { source_type: 'essentia', date: today, file: fname }
                    })
                  })
                  console.log(`  ✓ Essentia (bg): brain entry saved for ${titleParsed}`)
                }
              }
            } catch(e) {
              console.warn(`  Essentia (bg) failed for ${fname}:`, e.message.slice(0, 80))
            }
          })
        }
      } catch(err) {
        logError('save-audio', err.message)
        console.error('✗ save-audio error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /save-stems-zip — saves ZIP to Stems folder, returns Dropbox link ──
  if (req.method === 'POST' && req.url.startsWith('/save-stems-zip')) {
    const filename = decodeURIComponent(req.headers['x-filename'] || 'stems.zip')
    const oldfile  = decodeURIComponent(req.headers['x-oldfile'] || '')
    const artistName = decodeURIComponent(req.headers['x-artist'] || '')
    const songName = decodeURIComponent(req.headers['x-song'] || '')
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks)

        // Delete old file if name changed
        if (oldfile && oldfile !== filename) {
          const oldPath = path.join(STEMS_DIR, oldfile)
          if (fs.existsSync(oldPath)) { fs.unlinkSync(oldPath); console.log(`🗑 Deleted old stems: ${oldfile}`) }
        }

        const destPath = path.join(STEMS_DIR, filename)
        // Also delete same-named file to force Dropbox re-upload
        if (fs.existsSync(destPath)) { fs.unlinkSync(destPath); console.log(`🗑 Removed old stems ZIP for re-upload: ${filename}`) }

        fs.writeFileSync(destPath, buf)
        console.log(`✓ Stems ZIP saved: ${filename} (${(buf.length/1024/1024).toFixed(1)}MB)`)

        // Get Dropbox share link
        let shareLink = null
        try {
          const dbxPath = `/!MOMENTUM MUSIC/Stems/${filename}`
          shareLink = await getDropboxShareLink(dbxPath)
          if (shareLink) console.log(`🔗 Stems link: ${shareLink}`)
        } catch(e) { console.warn('Dropbox link error:', e.message) }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename, shareLink }))
      } catch(err) {
        logError('save-stems-zip', err.message)
        console.error('✗ save-stems-zip:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── GET /test-dropbox — paste in Firefox to see Dropbox API response ────
  if (req.url === '/test-dropbox') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write('Testing Dropbox API...\n\n')
    const testPath = '/!MOMENTUM MUSIC/Submissions'
    try {
      const result = await fetchJSON(
        'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${await getValidAccessToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: testPath })
        }
      )
      res.end('Dropbox response:\n' + JSON.stringify(result, null, 2))
    } catch(e) {
      res.end('Error: ' + e.message)
    }
    return
  }

  // ── POST /get-share-links — get Dropbox share links for demo audio files ─
  if (req.method === 'POST' && req.url === '/get-share-links') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { filenames } = JSON.parse(body)
        const results = []
        for (const filename of (filenames || [])) {
          const dbxPath = `/!MOMENTUM MUSIC/Demos/${filename}`
          try {
            const shareUrl = await getDropboxShareLink(dbxPath)
            results.push({ filename, shareUrl })
            console.log(`🔗 Share link for ${filename}: ${shareUrl ? 'ok' : 'failed'}`)
          } catch(e) {
            results.push({ filename, shareUrl: null, error: e.message })
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, results }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /morning-briefing — generate daily AI summary, push to inbox ──
async function getBrainHealth() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=id,category,title,confidence,created_at,source_type`,
      { headers: sbHeaders }
    )
    const entries = await res.json()
    if (!Array.isArray(entries) || !entries.length) return null

    const categoryCounts = {}
    const weakOld = []
    const recentNew = []
    const thirtyDaysAgo = Date.now() - (30 * 24 * 3600000)
    const threeDaysAgo = Date.now() - (3 * 24 * 3600000)

    for (const e of entries) {
      categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1
      if (e.confidence === 'weak' && new Date(e.created_at).getTime() < thirtyDaysAgo) {
        weakOld.push((e.title || '').slice(0, 40))
      }
      if (new Date(e.created_at).getTime() > threeDaysAgo && e.source_type === 'agent') {
        recentNew.push(e.category)
      }
    }

    const overlaps = []
    const cats = Object.keys(categoryCounts)
    // artist_breaking + emerging_artists_tracking consolidated → artist_strategy

    const lines = []
    lines.push(`Brain: ${entries.length} entries across ${cats.length} categories`)

    if (recentNew.length > 0) {
      const newByCat = {}
      recentNew.forEach(c => newByCat[c] = (newByCat[c] || 0) + 1)
      lines.push(`New last 3 days: ` + Object.entries(newByCat).map(([c,n]) => `${n} ${c}`).join(', '))
    }
    if (weakOld.length > 0)
      lines.push(`${weakOld.length} weak entries >30 days old — consider deleting`)
    if (overlaps.length > 0)
      lines.push('Suggest merging: ' + overlaps.join(', '))

    const missing = []
    if (!cats.includes('goal')) missing.push('goals')
    if (!cats.includes('own_production')) missing.push('own productions')
    if (!cats.includes('mixing_technique')) missing.push('mixing rules')
    if (missing.length)
      lines.push('Missing knowledge: ' + missing.join(', ') + ' — add via Brain dump')

    return lines.join('\n')
  } catch(e) {
    console.warn('getBrainHealth error:', e.message)
    return null
  }
}

  // ── POST /morning-briefing — generate daily AI summary, push to inbox ──
  if (req.method === 'POST' && req.url.startsWith('/morning-briefing')) {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return }

        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbHeaders = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }
        const todayISO = new Date().toISOString().slice(0, 10)
        const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
        const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

        // Fetch data from Supabase in parallel + gear news + cultural timing
        const [gearThreadsBriefing, cultural] = await Promise.all([
          fetchGearNewsItems(),
          fetchCulturalTiming().catch(() => null)
        ])
        const countHeaders = { ...sbHeaders, 'Prefer': 'count=exact' }
        const [songsRes, inboxRes, connectionsRes, brainKnowRes, goalsRes, demoCountRes, projectSongCountRes, activeSongsRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/songs?select=title,code,work_data,project_id&not.project_id=is.null`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications?read=eq.false&order=created_at.desc&limit=20`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/connections?select=name,genre,group_types,last_contact,notes,status`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=category,title,content&order=created_at.desc&limit=10`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&category=eq.goal&select=title,content&order=created_at.desc&limit=10`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/songs?project_id=is.null&select=id`, { headers: countHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/songs?not.project_id=is.null&select=id`, { headers: countHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/songs?select=title,code,status,key,tempo,work_data&status=in.(production,mix_prep,mixing,mastering)&order=updated_at.desc&limit=10`, { headers: sbHeaders })
        ])
        const [songs, inbox, brain, brainKnow, goals] = await Promise.all([songsRes.json(), inboxRes.json(), connectionsRes.json(), brainKnowRes.json(), goalsRes.json()])
        const activeSongs = await activeSongsRes.json().catch(() => [])
        const demoCount = parseInt(demoCountRes.headers.get('content-range')?.split('/')[1] || '0')
        const projectSongCount = parseInt(projectSongCountRes.headers.get('content-range')?.split('/')[1] || '0')
        const activeContext = (Array.isArray(activeSongs) ? activeSongs : [])
          .map(s => (s.title || s.code) + ' (' + (s.status || 'active') + ')')
          .join(', ')

        // Build context summary
        const stageCounts = {}
        const upcomingDeadlines = []
        for (const s of (Array.isArray(songs) ? songs : [])) {
          const wd = s.work_data || {}
          const stage = wd.current_stage || 'demo'
          stageCounts[stage] = (stageCounts[stage] || 0) + 1
          if (wd.deadlines) {
            for (const d of wd.deadlines) {
              if (!d.done && d.date >= todayISO && d.date <= in7days) {
                upcomingDeadlines.push(`${s.title || s.code} — ${d.label} (${d.date})`)
              }
            }
          }
        }

        // Compute done_this_month from stageCounts loop data
        let done_this_month = 0
        for (const s of (Array.isArray(songs) ? songs : [])) {
          const wd = s.work_data || {}
          if (wd.current_stage === 'done' && (wd.completed_at || '').slice(0, 7) === todayISO.slice(0, 7)) done_this_month++
        }

        const overdueArtists = (Array.isArray(brain) ? brain : [])
          .filter(b => b.status !== 'inactive' && (!b.last_contact || b.last_contact < ago30))
          .map(b => `${b.name} (${b.type}, ${b.genre || 'no genre'}, last: ${b.last_contact || 'never'})`)

        const unreadFeedback = (Array.isArray(inbox) ? inbox : [])
          .filter(n => n.type === 'feedback')
          .map(n => `${n.song_title} via ${n.patch_name || 'listen link'}`)

        const brainContext = buildBrainContext(brainKnow)

        const activeGoals = (Array.isArray(goals) ? goals : []).map(g => {
          try { const d = JSON.parse(g.content); return `- ${g.title}: target ${d.target} ${d.unit} by ${d.deadline}` }
          catch { return `- ${g.title}` }
        }).join('\n')

        const NOW_MS = Date.now()
        const H48_MS = 48 * 3600000
        const H24_MS = 24 * 3600000
        const freshGear = gearThreadsBriefing.filter(item => {
          if (!item.pubDate) return true
          const age = NOW_MS - new Date(item.pubDate).getTime()
          return age < H48_MS
        })
        const gearBriefingBlock = freshGear.length
          ? freshGear.map((t, i) => {
              const age = t.pubDate ? NOW_MS - new Date(t.pubDate).getTime() : 0
              const ageLabel = age > H24_MS ? '[OUTDATED] ' : ''
              return `${i+1}. ${ageLabel}${t.title}`
            }).join('\n')
          : ''

        let culturalBlock = ''
        if (cultural) {
          if (cultural.google_trends?.length) {
            culturalBlock += '\nCULTURAL TIMING — Genre trends (Google, last 3 months):\n'
            cultural.google_trends.slice(0, 3).forEach(t => { culturalBlock += `· ${t.term}: ${t.value}/100\n` })
          }
          if (cultural.reddit_sounds?.length) {
            culturalBlock += 'Reddit music discourse:\n'
            cultural.reddit_sounds.slice(0, 3).forEach(p => { culturalBlock += `· [${p.subreddit}] ${p.title.slice(0, 60)}\n` })
          }
          if (cultural.release_timing?.tip) culturalBlock += `Release timing: ${cultural.release_timing.tip}`
        }

        const context = [
          `Today: ${todayISO}`,
          `Songs by stage: ${Object.entries(stageCounts).map(([k,v]) => `${k}(${v})`).join(', ') || 'none'}`,
          `Demos in pipeline: ${demoCount} | Songs in projects: ${projectSongCount} | Finished this month: ${done_this_month}`,
          `Upcoming deadlines (7 days): ${upcomingDeadlines.join('; ') || 'none'}`,
          `Unread feedback: ${unreadFeedback.join('; ') || 'none'}`,
          `Artists to follow up (30+ days no contact): ${overdueArtists.slice(0,5).join('; ') || 'none'}`,
          activeContext ? `\nACTIVE PROJECTS: ${activeContext}` : '',
          activeGoals ? `\nACTIVE GOALS:\n${activeGoals}` : '',
          gearBriefingBlock ? `\nTECH — NEW GEAR & PLUGINS:\n${gearBriefingBlock}` : '',
          culturalBlock ? `\n${culturalBlock}` : '',
          brainContext ? `\n[BACKGROUND — read silently, do not reproduce]\n${brainContext}\n[END BACKGROUND]` : ''
        ].filter(Boolean).join('\n')

        // Call Claude Haiku for briefing
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 500,
            messages: [{ role: 'user', content: `You are a daily assistant for a music producer. Write a focused morning briefing.

FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK]/[CONFIRMED]/[TENSION]/[OUTDATED]/[NEW] for emphasis. Plain text only.
- One blank line between sections
- Bullet points for lists, max 2 lines per bullet
- End with a ## Next Step section: single most important action today
Keep each section tight — no filler sentences.

Focus only on information relevant to these active projects: ${activeContext || 'see pipeline data below'}.
Skip generic industry news unless it directly affects these specific songs or artists.

Sections to include:
## Today's Focus
## Pipeline Status
## Watch Out
## Tech (only if gear news data present — summarize new gear relevant to mixing/recording/plugins/hardware, 3-4 bullets max)
## Next Step

${context}` }]
          })
        })
        const claudeData = await claudeRes.json()
        let briefingText = claudeData.content?.[0]?.text || 'No briefing generated.'

        // Append brain health snapshot
        const brainHealth = await getBrainHealth()
        if (brainHealth) briefingText += '\n\n## Brain Health\n' + brainHealth

        // Track API usage
        {
          const model = 'claude-haiku-4-5-20251001'
          const usage = claudeData.usage || {}
          const inputT = usage.input_tokens || 0
          const outputT = usage.output_tokens || 0
          const costPerMIn = 0.000001, costPerMOut = 0.000005
          const cost = (inputT * costPerMIn) + (outputT * costPerMOut)
          fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ endpoint: '/morning-briefing', model, input_tokens: inputT, output_tokens: outputT, cost_usd: cost })
          }).catch(() => {})
        }

        // Delete any existing Morning Briefing for today, then insert fresh one
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
        await fetch(
          `${SUPABASE_URL}/rest/v1/inbox_notifications?type=eq.briefing&song_title=eq.Morning%20Briefing&created_at=gte.${todayStart.toISOString()}`,
          { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
        ).catch(() => {})
        await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            type: 'briefing',
            song_code: null,
            song_title: 'Morning Briefing',
            artist: null,
            message: briefingText,
            patch_name: `Briefing ${todayISO}`,
            read: false
          })
        })
        setImmediate(async () => {
          try {
            const insight = await extractInsight(briefingText, apiKey)
            await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                category: 'market_knowledge',
                title: `Briefing ${todayISO} — ${insight.slice(0, 60)}`,
                content: insight,
                entry_type_v2: 'observation',
                confidence: 'medium',
                source_type: 'morning_briefing',
                active: true
              })
            })
            saveBrainFile({ category: 'market_knowledge', title: `Briefing ${todayISO}`, content: insight, confidence: 'medium', source_type: 'morning_briefing' }).catch(() => {})
          } catch(e) { console.warn('briefing brain save error:', e.message) }
        })

        if (TELEGRAM_TOKEN) {
          sendTelegram(TELEGRAM_OWNER_ID, '🌅 Morning Briefing\n\n' + briefingText.slice(0, 3000)).catch(() => {})
          // Send crypto signal separately
          try {
            const crypto = await buildCryptoSignal()
            const d = crypto.btc_derivatives || {}
            let cryptoMsg = '📊 CRYPTO SIGNAL: ' + crypto.emoji + ' ' + crypto.signal
            cryptoMsg += '\n\nBTC: €' + Math.round(crypto.btcPrice).toLocaleString() +
              ' (' + (crypto.btcChange24h > 0 ? '+' : '') + crypto.btcChange24h?.toFixed(1) + '% 24h)'
            cryptoMsg += '\nETH: €' + Math.round(crypto.ethPrice).toLocaleString() +
              ' (' + (crypto.ethChange24h > 0 ? '+' : '') + crypto.ethChange24h?.toFixed(1) + '% 24h)'
            cryptoMsg += '\nFear & Greed: ' + crypto.fearGreed.value + ' (' + crypto.fearGreed.label + ')'
            if (crypto.funding !== null) cryptoMsg += '\nFunding: ' + crypto.funding.toFixed(3) + '%'
            cryptoMsg += '\nBTC Dominance: ' + crypto.dominance + '%'
            cryptoMsg += '\nAltseason: ' + crypto.altseasonSignal
            if (d.long_pct != null || d.oi_trend || d.taker_buy_ratio != null || d.top_trader_long_pct != null) {
              cryptoMsg += '\n\n📊 Derivatives:'
              if (d.long_pct != null) cryptoMsg += '\nLongs: ' + d.long_pct.toFixed(0) + '% ' + (d.long_trend === 'increasing' ? '↑' : '↓')
              if (d.oi_trend) cryptoMsg += '\nOI: ' + (d.oi_trend === 'rising' ? '↑' : '↓') + (d.oi_change_pct != null ? ' ' + d.oi_change_pct + '% 6h' : '')
              if (d.taker_buy_ratio != null) cryptoMsg += '\nTaker: ' + d.taker_buy_ratio.toFixed(2) + (d.taker_buy_ratio > 1 ? ' buyers' : ' sellers')
              if (d.top_trader_long_pct != null) cryptoMsg += '\nSmart $: ' + d.top_trader_long_pct.toFixed(0) + '% long'
            }
            cryptoMsg += '\n\n' + crypto.suggestion
            if (crypto.reasons.length) cryptoMsg += '\n\nReasons:\n' + crypto.reasons.map(r => '· ' + r).join('\n')
            if (crypto.personal_advice) cryptoMsg += '\n\n' + crypto.personal_advice.trim()
            if (crypto.binanceAction === 'buy') cryptoMsg += '\n\n→ Open Binance: ' + crypto.binanceDeepLink
            sendTelegram(TELEGRAM_OWNER_ID, cryptoMsg).catch(() => {})
            if (crypto.polymarkets?.length) {
              let polyMsg = '🎯 POLYMARKET\n'
              crypto.polymarkets.slice(0, 4).forEach(m => {
                const bar = m.yes_prob > 65 ? '🟢' : m.yes_prob > 45 ? '🟡' : '🔴'
                polyMsg += bar + ' ' + m.yes_prob + '% — ' + m.question + '\n'
              })
              sendTelegram(TELEGRAM_OWNER_ID, polyMsg).catch(() => {})
            }
            const cgt = crypto.cg_trending
            const cgg = crypto.cg_global
            if (cgt?.trending?.length) {
              let trendMsg = '🔍 CRYPTO TRENDING\n'
              cgt.trending.slice(0, 5).forEach((t, i) => {
                const isM = MONITORED_COINS_SET.has(t.symbol)
                trendMsg += (isM ? '⚡' : (i + 1) + '.') + ' ' + t.symbol + ' — ' + t.name + '\n'
              })
              if (cgg?.btc_dominance != null) {
                trendMsg += 'BTC dom: ' + cgg.btc_dominance.toFixed(1) + '%'
                trendMsg += cgg.btc_dominance > 55 ? ' (alts weak)' : cgg.btc_dominance < 45 ? ' (alt season)' : ' (neutral)'
                trendMsg += '\n'
              }
              if (cgg?.market_cap_change_24h != null)
                trendMsg += 'Market 24h: ' + (cgg.market_cap_change_24h > 0 ? '+' : '') + cgg.market_cap_change_24h.toFixed(2) + '%\n'
              sendTelegram(TELEGRAM_OWNER_ID, trendMsg).catch(() => {})
            }
          } catch(e) { console.warn('crypto signal in briefing failed:', e.message) }
          // Chart Pulse — cross-chart correlation + TikTok top 5 + Spotify top 5
          try {
            const charts = await getCrossChartTopics()
            let chartMsg = '📊 CHART PULSE\n'
            if (charts.crossChart.length) {
              chartMsg += '\nPEAK MOMENTUM (TikTok + Spotify):\n'
              chartMsg += charts.crossChart.slice(0, 5).map((t, i) => (i + 1) + '. ' + t.artist + ' — ' + t.title).join('\n')
            }
            if (charts.tiktokOnly.length) {
              chartMsg += '\n\nEMERGING (TikTok only):\n'
              chartMsg += charts.tiktokOnly.slice(0, 5).map((t, i) => (i + 1) + '. ' + t.artist + ' — ' + t.title).join('\n')
            }
            if (charts.spotify.length) {
              chartMsg += '\n\nSpotify Top 5:\n'
              chartMsg += charts.spotify.slice(0, 5).map((t, i) => (i + 1) + '. ' + t.artist + ' — ' + t.title).join('\n')
            }
            if (charts.tiktok.length || charts.spotify.length) {
              sendTelegram(TELEGRAM_OWNER_ID, chartMsg).catch(() => {})
            }
          } catch(e) { console.warn('chart pulse in briefing failed:', e.message) }
        }
        console.log(`✓ Morning briefing generated for ${todayISO}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, briefing: briefingText }))
      } catch(err) {
        logError('morning-briefing', err.message)
        console.error('✗ Morning briefing error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /agent-scout — AI suggests emerging artists based on taste profile ──
  if (req.method === 'POST' && req.url === '/agent-scout') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return }
        const brainRows = await fetchSharedBrainContext()
        const result = await runAgentScout(apiKey, brainRows)

        // Save all scout tracks to reference_tracks as checkout
        const tracksToSave = [
          ...(result.tracks || []),
          ...(result.tiktok_tracks || []),
          ...(result.spotify_tracks || [])
        ].filter(t => t.title && t.artist)
        const now = new Date().toISOString()
        const dateStr = now.slice(0, 10)
        for (const track of tracksToSave) {
          try {
            await saveToCheckout({
              title: track.title, artist: track.artist,
              collection_name: 'scout_' + dateStr,
              spotify_id: track.spotify_id || null,
              tempo: track.bpm || null, key: track.key || null,
              camelot: track.camelot || null, energy: track.energy || null,
              danceability: track.danceability || null, loudness: track.loudness_lufs || null,
              valence: track.valence || null, brightness: track.brightness || null
            })
          } catch(e) {
            console.error('scout track save error:', e.message)
          }
        }

        // Extract ALL track/song mentions from the generated scout text and save to checkout
        const mentionedTracks = await extractTracksFromText(result.suggestions || '', apiKey)
        console.log('extractTracksFromText returned:', mentionedTracks.length, 'tracks')
        const dateMentioned = new Date().toISOString().slice(0, 10)

        for (const track of mentionedTracks) {
          if (!track.title || !track.artist) continue
          try {
            await saveToCheckout({ title: track.title, artist: track.artist, collection_name: 'scout_' + dateMentioned })
          } catch(e) {
            console.error('✗ EXCEPTION:', e.message)
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
        setImmediate(() => brainToObsidian().catch(() => {}))
      } catch(err) {
        logError('agent-scout', err.message)
        console.error('✗ Agent Scout error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /agent-demo-match — match recent demos to artists, generate pitches ──
  if (req.method === 'POST' && req.url === '/agent-demo-match') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return }
        const brainRows = await fetchSharedBrainContext()
        const result = await runAgentDemoMatch(apiKey, brainRows)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch(err) {
        logError('agent-demo-match', err.message)
        console.error('✗ Agent Demo Match error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /agent-tiktok-trends — TikTok/YouTube trending sounds + Essentia ──
  if (req.method === 'POST' && req.url === '/agent-tiktok-trends') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      console.log('agent-tiktok-trends: starting')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' })); return }
        const brainRows = await fetchSharedBrainContext()
        const result = await runAgentTikTokTrends(apiKey, brainRows)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch(err) {
        logError('agent-tiktok-trends', err.message)
        console.error('✗ agent-tiktok-trends error:', err.message)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, trends: [], summary: 'TikTok data unavailable today — used YouTube proxy', source: 'fallback' }))
      }
    })
    return
  }

  // ── POST /agent-feedback — distil version feedback into a prioritised action list ──
  if (req.method === 'POST' && req.url === '/agent-feedback') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const { songId, apiKey } = body
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing apiKey' })); return }
        if (!songId)  { res.writeHead(400); res.end(JSON.stringify({ error: 'missing songId' })); return }

        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbHeaders = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }

        const songRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=title,code,work_data&id=eq.${encodeURIComponent(songId)}&limit=1`, { headers: sbHeaders })
        const songRows = await songRes.json()
        const song = Array.isArray(songRows) ? songRows[0] : null
        if (!song) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'song not found' }))
          return
        }

        const wd = song.work_data || {}
        const versions = Array.isArray(wd.versions) ? wd.versions : []

        // Build full feedback dump across all versions
        const lines = [
          `SONG: ${song.title || song.code || songId}`,
          `CURRENT STAGE: ${wd.current_stage || 'unknown'}`,
          '',
        ]

        if (wd.notes) {
          lines.push('NOTES:', wd.notes, '')
        }

        for (const v of versions) {
          const fb = Array.isArray(v.feedback) ? v.feedback : []
          if (!fb.length) continue
          lines.push(`VERSION: ${v.name || v.version_type || 'untitled'} (${v.version_type || ''})`)
          for (const f of fb) {
            const status = f.done ? '[done]' : '[open]'
            lines.push(`  ${status} ${f.text || ''}`)
          }
          lines.push('')
        }

        if (lines.length <= 3) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, actions: 'No feedback found for this song.' }))
          return
        }

        const context = lines.join('\n')

        // Call Claude Sonnet
        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', max_tokens: 500,
            messages: [{ role: 'user', content: `Read this version history and feedback. List only what still needs doing, remove duplicates, sort by priority. Max 8 bullet points. FORMATTING: Never use **bold** or *italic* markdown — plain text, - for bullets only.\n\n${context}` }]
          })
        })
        const claudeData = await claudeRes.json()
        const actionsText = claudeData.content?.[0]?.text || 'No actions generated.'

        // Save to inbox_notifications
        await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            type: 'briefing',
            song_code: song.code || null,
            song_title: 'Feedback Sync',
            artist: null,
            message: actionsText,
            patch_name: `${song.title || song.code || songId} — ${new Date().toISOString().slice(0, 10)}`,
            read: false
          })
        })

        console.log(`✓ Agent Feedback Sync saved to inbox (song: ${song.code || songId})`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, actions: actionsText }))
      } catch(err) {
        logError('agent-feedback', err.message)
        console.error('✗ Agent Feedback error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /import-spotify-playlist — import playlist tracks to reference library ──
  if (req.method === 'POST' && req.url === '/import-spotify-playlist') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { playlist_url, genre_tag } = JSON.parse(body)
        if (!playlist_url) { res.writeHead(400); res.end(JSON.stringify({ error: 'playlist_url required' })); return }
        const result = await importSpotifyPlaylist(playlist_url, genre_tag || null)
        res.end(JSON.stringify({ ok: true, ...result }))
      } catch(err) {
        console.error('import-spotify-playlist error:', err.message)
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /import-all-my-playlists — import all user Spotify playlists ────────
  if (req.method === 'POST' && req.url === '/import-all-my-playlists') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    try {
      const result = await importAllUserPlaylists()
      res.end(JSON.stringify({ ok: true, ...result }))
    } catch(err) {
      console.error('import-all-my-playlists error:', err.message)
      res.end(JSON.stringify({ ok: false, error: err.message }))
    }
    return
  }

  // ── POST /analyze-spotify-track — metadata + Essentia BPM/key from preview ──
  if (req.method === 'POST' && req.url === '/analyze-spotify-track') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { url } = JSON.parse(body)
        if (!url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }

        const trackId = url.split('/track/')[1]?.split('?')[0]?.split('/')[0]
        if (!trackId) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid Spotify track URL — expected open.spotify.com/track/...' })); return }
        const trackRes = await spotifyFetch(`https://api.spotify.com/v1/tracks/${trackId}`)
        if (!trackRes.ok) throw new Error(`Spotify track error: ${trackRes.status}`)
        const track = await trackRes.json()

        const artistId = track.artists?.[0]?.id
        const artistRes = artistId
          ? await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`)
          : null
        const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

        let genres = artist.genres || []
        let genres_source = genres.length ? 'artist' : 'none'
        if (!genres.length && artistId) {
          try {
            const relRes = await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}/related-artists`)
            if (relRes.ok) {
              const rel = await relRes.json()
              const genreCounts = {}
              for (const ra of (rel.artists || []).slice(0, 3)) {
                for (const g of (ra.genres || [])) genreCounts[g] = (genreCounts[g] || 0) + 1
              }
              genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g)
              genres_source = genres.length ? 'related' : 'none'
            }
          } catch(e) { console.warn('  Related artists genres failed:', e.message.slice(0, 50)) }
        }

        const art_url = track.album?.images?.[0]?.url
        const preview_url = track.preview_url

        // Full signal set via Essentia on 30s audio
        let bpm = null, key = null, scale = null, key_strength = null
        let energy = null, danceability = null, loudness = null
        let valence = null, acousticness = null, instrumentalness = null, duration_seconds = null
        let preview_source = null
        const tmpAudio = `/tmp/sp_preview_${Date.now()}.mp3`
        let audioReady = false

        if (preview_url) {
          try {
            execSync(`curl -s -o "${tmpAudio}" "${preview_url}"`, { timeout: 15000 })
            audioReady = true
            preview_source = 'spotify'
          } catch(e) {
            console.warn('  Spotify preview download failed:', e.message.slice(0, 50))
          }
        }

        if (!audioReady) {
          const artistName = (track.artists[0]?.name || '').replace(/"/g, '')
          const trackName = track.name.replace(/"/g, '')
          const ytQuery = `${artistName} ${trackName} official`
          try {
            execSync(
              `yt-dlp -x --audio-format mp3 --download-sections "*0-30" -o "${tmpAudio}" "ytsearch1:${ytQuery}"`,
              { timeout: 60000 }
            )
            audioReady = true
            preview_source = 'youtube'
            console.log(`  ✓ YouTube fallback: ${ytQuery}`)
          } catch(e) {
            console.warn('  YouTube fallback failed:', e.message.slice(0, 50))
          }
        }

        let camelot = null
        const esExtended = {}
        if (audioReady) {
          try {
            const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
            const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
            const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
            const feat = JSON.parse(esOut)
            bpm = feat.bpm; key = feat.key; scale = feat.scale; key_strength = feat.key_strength
            energy = feat.energy; danceability = feat.danceability
            loudness = feat.loudness_lufs; valence = feat.valence
            acousticness = feat.acousticness; duration_seconds = feat.duration_seconds
            camelot = feat.camelot || null
            Object.assign(esExtended, {
              spectral_centroid: feat.spectral_centroid ?? null,
              spectral_contrast: feat.spectral_contrast ?? null,
              spectral_flux: feat.spectral_flux ?? null,
              mfcc_mean: feat.mfcc_mean ?? null,
              bpm_confidence: feat.bpm_confidence ?? null,
              brightness: feat.brightness ?? null,
              bass_energy: feat.bass_energy ?? null,
              rms: feat.rms ?? null,
              loudness_lufs: feat.loudness_lufs ?? null,
              // new extended fields
              speechiness: feat.speechiness ?? null,
              instrumentalness: feat.instrumentalness ?? null,
              onset_rate: feat.onset_rate ?? null,
              rhythm_regularity: feat.rhythm_regularity ?? null,
              dynamic_complexity: feat.dynamic_complexity ?? null,
              loudness_range: feat.loudness_range ?? null,
              vocal_pitch_mean: feat.vocal_pitch_mean ?? null,
              vocal_pitch_range: feat.vocal_pitch_range ?? null,
              vocal_root_note: feat.vocal_root_note ?? null,
              vibrato_presence: feat.vibrato_presence ?? null,
              harmonic_complexity: feat.harmonic_complexity ?? null,
              warmth: feat.warmth ?? null,
            })
            console.log(`  ✓ Essentia (${preview_source}): ${bpm}bpm ${key} ${scale} (${camelot}) nrg:${energy} dnc:${danceability} val:${valence} lufs:${loudness}`)
          } catch(e) {
            console.warn('  Essentia analysis failed:', e.message.slice(0, 50))
          }
        }
        try { fs.unlinkSync(tmpAudio) } catch(e) {}

        console.log(`✓ analyze-spotify-track: ${track.name} — ${track.artists[0]?.name} | ${bpm || '?'}bpm ${key || '?'}`)
        setImmediate(() => brainToObsidian().catch(() => {}))
        if (bpm || key) {
          const _trackEntry = { category: 'reference_current', title: `${track.name} — ${track.artists[0]?.name || ''}`, content: [bpm ? `${Math.round(bpm)}bpm` : null, key ? `${key} ${scale || ''}`.trim() : null, energy ? `nrg ${energy}` : null, loudness ? `${loudness}LUFS` : null, genres.length ? `Genres: ${genres.slice(0,3).join(', ')}` : null].filter(Boolean).join(' · '), confidence: 'medium', source_type: 'spotify', source_url: `https://open.spotify.com/track/${trackId}` }
          setImmediate(() => saveBrainFile(_trackEntry).catch(() => {}))
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          spotify_id: trackId,
          title: track.name,
          artist: track.artists.map(a => a.name).join(', '),
          album: track.album?.name,
          release_date: track.album?.release_date,
          art_url,
          popularity: track.popularity,
          artist_popularity: artist.popularity,
          artist_followers: artist.followers?.total,
          genres,
          genres_source,
          bpm,
          key,
          scale,
          key_strength,
          energy,
          danceability,
          valence,
          acousticness,
          instrumentalness,
          loudness,
          duration_seconds,
          preview_url,
          preview_source,
          camelot,
          bpm_confidence: esExtended.bpm_confidence ?? null,
          brightness: esExtended.brightness ?? null,
          bass_energy: esExtended.bass_energy ?? null,
          spectral_centroid: esExtended.spectral_centroid ?? null,
          spectral_contrast: esExtended.spectral_contrast ?? null,
          spectral_flux: esExtended.spectral_flux ?? null,
          mfcc_mean: esExtended.mfcc_mean ?? null,
          rms: esExtended.rms ?? null,
          loudness_lufs: esExtended.loudness_lufs ?? null,
          speechiness: esExtended.speechiness ?? null,
          instrumentalness: esExtended.instrumentalness ?? null,
          onset_rate: esExtended.onset_rate ?? null,
          rhythm_regularity: esExtended.rhythm_regularity ?? null,
          dynamic_complexity: esExtended.dynamic_complexity ?? null,
          loudness_range: esExtended.loudness_range ?? null,
          vocal_pitch_mean: esExtended.vocal_pitch_mean ?? null,
          vocal_pitch_range: esExtended.vocal_pitch_range ?? null,
          vocal_root_note: esExtended.vocal_root_note ?? null,
          vibrato_presence: esExtended.vibrato_presence ?? null,
          harmonic_complexity: esExtended.harmonic_complexity ?? null,
          warmth: esExtended.warmth ?? null,
        }))
      } catch(err) {
        logError('analyze-spotify-track', err.message)
        console.error('✗ analyze-spotify-track:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /analyze-vocal-style — vocal profile from Spotify preview ──────────
  if (req.method === 'POST' && req.url === '/analyze-vocal-style') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { url } = JSON.parse(body)
        if (!url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }

        const trackId = url.split('/track/')[1]?.split('?')[0]?.split('/')[0]
        if (!trackId) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid Spotify URL' })); return }

        const trackRes = await spotifyFetch(`https://api.spotify.com/v1/tracks/${trackId}`)
        if (!trackRes.ok) throw new Error(`Spotify track error: ${trackRes.status}`)
        const track = await trackRes.json()

        const tmpAudio = `/tmp/vocal_${Date.now()}.mp3`
        let audioReady = false

        if (track.preview_url) {
          try {
            execSync(`curl -s -o "${tmpAudio}" "${track.preview_url}"`, { timeout: 15000 })
            audioReady = true
          } catch(e) {}
        }

        if (!audioReady) {
          const ytQuery = `${track.artists[0]?.name || ''} ${track.name} official`
          try {
            execSync(`yt-dlp -x --audio-format mp3 --download-sections "*0-30" -o "${tmpAudio}" "ytsearch1:${ytQuery}"`, { timeout: 60000 })
            audioReady = true
          } catch(e) {}
        }

        if (!audioReady) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Could not download audio' })); return }

        let analysis = {}
        try {
          const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
          const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
          const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 90000 }).trim()
          analysis = JSON.parse(esOut)
        } finally {
          try { fs.unlinkSync(tmpAudio) } catch(e) {}
        }

        const vocalProfile = buildVocalProfile(analysis)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, track: track.name, artist: track.artists[0]?.name, analysis, vocalProfile }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /agent-import-spotify — import playlist or artist into brain + taste profiles ──
  if (req.method === 'POST' && req.url === '/agent-import-spotify') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { url, apiKey, query, song_id, collection, source } = JSON.parse(body)

        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbHeaders = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }

        // ── QUERY MODE (Mozart action: add_reference) ─────────────────
        if (query) {
          const searchRes = await spotifyFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`)
          if (!searchRes.ok) throw new Error(`Spotify search error: ${searchRes.status}`)
          const searchData = await searchRes.json()
          const track = searchData.tracks?.items?.[0]
          if (!track) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'No track found for: ' + query }))
            return
          }

          const artistId = track.artists?.[0]?.id
          const artistRes = artistId ? await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`) : null
          const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

          let bpm = null, key = null, camelot = null
          if (track.preview_url) {
            const tmpAudio = `/tmp/mm_qimport_${Date.now()}.mp3`
            try {
              execSync(`curl -s -o "${tmpAudio}" "${track.preview_url}"`, { timeout: 15000 })
              const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
              const esTmp = require('path').join(require('os').tmpdir(), `mm_qi_${Date.now()}.py`)
              require('fs').writeFileSync(esTmp, [
                'import essentia.standard as es, json, sys',
                `audio = es.MonoLoader(filename=${JSON.stringify(tmpAudio)}, sampleRate=44100)()`,
                'bpm_val, beats, beats_conf, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)',
                'k, scale, strength = es.KeyExtractor(profileType="edma")(audio)',
                'print(json.dumps({"bpm": round(float(bpm_val)), "key": k, "scale": scale}))'
              ].join('\n'))
              const esOut = execSync(`"${ESSENTIA_PYTHON}" ${shellEscape(esTmp)} 2>/dev/null`, { encoding: 'utf8', timeout: 20000 }).trim()
              try { require('fs').unlinkSync(esTmp) } catch(e) {}
              const f = JSON.parse(esOut)
              bpm = f.bpm
              key = f.key + (f.scale === 'minor' ? ' minor' : ' major')
              const CAMELOT = { 'C major':'8B','G major':'9B','D major':'10B','A major':'11B','E major':'12B','B major':'1B','F# major':'2B','Db major':'3B','Ab major':'4B','Eb major':'5B','Bb major':'6B','F major':'7B','A minor':'8A','E minor':'9A','B minor':'10A','F# minor':'11A','C# minor':'12A','G# minor':'1A','Eb minor':'2A','Bb minor':'3A','F minor':'4A','C minor':'5A','G minor':'6A','D minor':'7A' }
              camelot = CAMELOT[key] || null
            } catch(e) { console.warn('  Essentia query-import failed:', e.message.slice(0, 50)) }
            try { require('fs').unlinkSync(tmpAudio) } catch(e) {}
          }

          const spotifyUrl = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`
          const collectionName = collection || 'reference_current'

          await saveToCheckout({
            spotify_id: track.id,
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album?.name,
            release_date: track.album?.release_date,
            genre_tags: artist.genres || [],
            tempo: bpm || null,
            key: key || null,
            camelot: camelot || null,
            popularity: track.popularity,
            preview_url: track.preview_url,
            album_art: track.album?.images?.[0]?.url,
            collection_name: collectionName,
            approved: true
          })

          if (song_id) {
            const { data: songRow } = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${song_id}&select=work_data`, { headers: sbHeaders }).then(r => r.json()).then(d => ({ data: d?.[0] }))
            const wd = songRow?.work_data || {}
            const refLinks = Array.isArray(wd.reference_links) ? wd.reference_links : []
            if (!refLinks.includes(spotifyUrl)) refLinks.push(spotifyUrl)
            await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${song_id}`, {
              method: 'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ work_data: { ...wd, reference_links: refLinks } })
            })
          }

          console.log(`✓ query-import: ${track.name} — ${track.artists[0]?.name} | ${bpm || '?'}bpm ${key || '?'}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, spotify_id: track.id, title: track.name, artist: track.artists.map(a => a.name).join(', '), bpm, key, camelot }))
          return
        }

        if (!url)    { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }
        if (!apiKey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'No API key' })); return }

        // ── SINGLE TRACK ──────────────────────────────────────────────
        if (url.includes('/track/')) {
          const trackId = url.split('/track/')[1]?.split('?')[0]?.split('/')[0]
          const trackRes = await spotifyFetch(`https://api.spotify.com/v1/tracks/${trackId}`)
          if (!trackRes.ok) throw new Error(`Spotify track fetch error: ${trackRes.status}`)
          const track = await trackRes.json()

          const artistId  = track.artists?.[0]?.id
          const artistRes = artistId
            ? await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`)
            : null
          const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

          // BPM + key via Essentia on 30s preview
          let bpm = null, key = null
          if (track.preview_url) {
            const tmpAudio = `/tmp/mm_preview_${Date.now()}.mp3`
            try {
              execSync(`curl -s -o "${tmpAudio}" "${track.preview_url}"`, { timeout: 15000 })
              const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
              const esTmp = path.join(os.tmpdir(), `mm_prev_${Date.now()}.py`)
              fs.writeFileSync(esTmp, [
                'import essentia.standard as es, json, sys',
                `audio = es.MonoLoader(filename=${JSON.stringify(tmpAudio)}, sampleRate=44100)()`,
                'bpm_val, beats, beats_conf, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)',
                'k, scale, strength = es.KeyExtractor(profileType="edma")(audio)',
                'print(json.dumps({"bpm": round(float(bpm_val)), "key": k + (" minor" if scale=="minor" else " major")}))'
              ].join('\n'))
              const esOut = execSync(`"${ESSENTIA_PYTHON}" ${shellEscape(esTmp)} 2>/dev/null`, { encoding: 'utf8', timeout: 20000 }).trim()
              try { fs.unlinkSync(esTmp) } catch(e) {}
              const features = JSON.parse(esOut)
              bpm = features.bpm
              key = features.key
              console.log(`  ✓ Essentia preview: ${bpm}bpm ${key}`)
            } catch(e) {
              console.warn('  Essentia preview failed:', e.message.slice(0, 50))
            }
            try { fs.unlinkSync(tmpAudio) } catch(e) {}
          }

          // Determine category from genre
          const g = (artist.genres||[])[0] || ''
          const category =
            g.includes('house') || g.includes('techno') || g.includes('electronic') ? 'electronic' :
            g.includes('hip') || g.includes('rap') || g.includes('trap') ? 'hiphop' :
            g.includes('r-n-b') || g.includes('soul') ? 'rnb' :
            g.includes('afro') ? 'afrobeats' :
            g.includes('latin') || g.includes('reggaeton') ? 'latin' :
            g.includes('pop') ? 'pop' :
            'music_references'

          const albumArt = track.album?.images?.[0]?.url

          const content = [
            `Artist: ${track.artists.map(a => a.name).join(', ')}`,
            `Album: ${track.album?.name} (${track.album?.release_date?.slice(0,4)})`,
            bpm ? `BPM: ${bpm} · Key: ${key || 'unknown'}` : null,
            `Popularity: ${track.popularity}/100`,
            `Artist followers: ${artist.followers?.total?.toLocaleString()}`,
            `Genres: ${(artist.genres||[]).slice(0,4).join(', ')}`,
          ].filter(Boolean).join('\n')

          // Save to reference_tracks (skip if already exists)
          await saveToCheckout({
            spotify_id: trackId,
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album?.name,
            release_date: track.album?.release_date,
            genre_tags: artist.genres || [],
            tempo: bpm || null,
            key: key || null,
            popularity: track.popularity,
            artist_popularity: artist.popularity,
            artist_followers: artist.followers?.total,
            preview_url: track.preview_url,
            album_art: albumArt,
            approved: true
          })

          // Save to brain_knowledge
          await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              category,
              title: `${track.name} — ${track.artists[0].name}`,
              content,
              entry_type: 'FACT',
              active: true,
              source_url: url
            })
          })

          console.log(`✓ Track saved: ${track.name} — ${bpm || '?'}bpm ${key || '?'}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            type: 'track',
            trackCount: 1,
            artistCount: 1,
            genreCount: (artist.genres||[]).length,
            topGenres: (artist.genres||[]).slice(0, 3),
            avgTempo: bpm,
            trackData: {
              title: track.name,
              artist: track.artists.map(a => a.name).join(', '),
              album: track.album?.name,
              genres: artist.genres || [],
              tempo: bpm,
              key,
              popularity: track.popularity,
              artistFollowers: artist.followers?.total,
              albumArt,
              spotifyId: trackId
            },
            summary: `${track.name} — ${track.artists[0].name} | `
              + (bpm ? `${bpm}bpm · ${key || '?'} · ` : '')
              + `popularity ${track.popularity}/100 · `
              + `${(artist.genres||[]).slice(0, 2).join(', ')}`
          }))
          return
        }

        // ── ARTIST WATCH ──────────────────────────────────────────────
        if (url.includes('/artist/') && body.watch) {
          const artistId = url.split('/artist/')[1]?.split('?')[0]?.split('/')[0]
          const [artistRes, relRes] = await Promise.all([
            spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`),
            spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=single,album&limit=1`)
          ])
          if (!artistRes.ok) throw new Error(`Spotify artist fetch error: ${artistRes.status}`)
          const [artist, releases] = await Promise.all([artistRes.json(), relRes.ok ? relRes.json() : { items: [] }])
          const latestId = releases.items?.[0]?.id || null

          await fetch(`${SUPABASE_URL}/rest/v1/watched_artists`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              spotify_id: artistId,
              name: artist.name,
              genre: (artist.genres||[])[0] || '',
              last_checked: new Date().toISOString().slice(0,10),
              last_release_id: latestId,
              active: true
            })
          })

          console.log(`✓ Now watching artist: ${artist.name}`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            ok: true,
            type: 'watched_artist',
            trackCount: 0, artistCount: 1, genreCount: 0,
            summary: `Now watching ${artist.name} for new releases`
          }))
          return
        }

        // 1. Parse URL
        const isPlaylist = url.includes('/playlist/')
        const isArtist   = url.includes('/artist/')
        if (!isPlaylist && !isArtist) throw new Error('URL must be a Spotify playlist, artist, or track link')
        const id = url.split(isPlaylist ? '/playlist/' : '/artist/')[1]?.split('?')[0]?.split('/')[0]

        // 3/4. Collect track IDs and artist IDs
        const trackItems = []   // { id, name, popularity }
        const artistIdSet = new Set()

        if (isPlaylist) {
          // Paginate up to 500 tracks
          let offset = 0
          while (trackItems.length < 500) {
            const r = await spotifyFetch(
              `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&offset=${offset}`
            )
            if (!r.ok) {
              const errBody = await r.text()
              throw new Error(`Spotify playlist fetch error: ${r.status} — ${errBody}`)
            }
            const d = await r.json()
            const items = (d.items || []).filter(i => i.track?.id)
            for (const item of items) {
              trackItems.push({ id: item.track.id, name: item.track.name, popularity: item.track.popularity || 0 })
              for (const a of (item.track.artists || [])) if (a.id) artistIdSet.add(a.id)
            }
            if (!d.next || items.length < 100) break
            offset += 100
          }
        } else {
          // Artist top tracks + related artists
          const [topR, relR] = await Promise.all([
            spotifyFetch(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=US`),
            spotifyFetch(`https://api.spotify.com/v1/artists/${id}/related-artists`)
          ])
          if (!topR.ok) throw new Error(`Spotify top-tracks error: ${topR.status}`)
          const topD = await topR.json()
          for (const t of (topD.tracks || [])) {
            trackItems.push({ id: t.id, name: t.name, popularity: t.popularity || 0 })
            for (const a of (t.artists || [])) if (a.id) artistIdSet.add(a.id)
          }
          artistIdSet.add(id)
          if (relR.ok) {
            const relD = await relR.json()
            for (const a of (relD.artists || []).slice(0, 20)) artistIdSet.add(a.id)
          }
        }

        if (!trackItems.length) throw new Error('No tracks found')

        // 5. Batch fetch artist details (50 per call)
        const artistIds = [...artistIdSet].slice(0, 150)
        const allArtists = []
        for (let i = 0; i < artistIds.length; i += 50) {
          const batch = artistIds.slice(i, i + 50)
          const r = await spotifyFetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`)
          if (!r.ok) continue
          const d = await r.json()
          for (const a of (d.artists || [])) if (a?.id) allArtists.push(a)
        }

        // 7. Calculate popularity stats
        const popularities = trackItems.map(t => t.popularity).filter(p => p > 0)
        const avgPopularity = popularities.length ? Math.round(popularities.reduce((a, b) => a + b, 0) / popularities.length) : 0
        const minPop = Math.min(...popularities)
        const maxPop = Math.max(...popularities)

        // Top genres by frequency
        const genreFreq = {}
        for (const artist of allArtists) {
          for (const g of (artist.genres || [])) genreFreq[g] = (genreFreq[g] || 0) + 1
        }
        const topGenres = Object.entries(genreFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g)

        // Top artists by followers
        const topArtists = allArtists
          .filter(a => a.followers?.total > 0)
          .sort((a, b) => b.followers.total - a.followers.total)
          .slice(0, 5)
          .map(a => `${a.name} (${(a.followers.total / 1000).toFixed(0)}k followers, popularity ${a.popularity}/100)`)

        // 8. Fetch tiered brain knowledge for taste context
        const brainKnowRes = await fetch(
          `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&category=in.(genre_strategy,production_style)&select=category,title,content&limit=10`,
          { headers: sbHeaders }
        )
        const brainKnow = await brainKnowRes.json()
        // 9. Call Claude to synthesize insights
        const dataBlock = [
          `Track count: ${trackItems.length}`,
          `Artist count: ${allArtists.length}`,
          `Top genres: ${topGenres.join(', ') || 'unknown'}`,
          `Top artists by followers: ${topArtists.join('; ') || 'unknown'}`,
          `Popularity range: ${minPop}-${maxPop}/100 (avg ${avgPopularity}) — Spotify popularity score, not stream count`,
        ].join('\n')

        const brainCtx = buildBrainContext(brainKnow)

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 600,
            messages: [{ role: 'user', content: `Summarize this Spotify data into 2-3 brain knowledge insights for a music producer.

Data:
${dataBlock}
${brainCtx ? `\n${brainCtx}` : ''}

Return ONLY a JSON array, no markdown, no explanation:
[{ "category": "...", "title": "...", "content": "..." }]
Categories: genre_strategy, market_knowledge, production_style, artist_strategy
Note: popularity is a Spotify 0-100 score, not actual stream counts.` }]
          })
        })
        const claudeData = await claudeRes.json()
        const rawText = claudeData.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '[]'

        // 9. Track API usage
        {
          const model = 'claude-haiku-4-5-20251001'
          const usage = claudeData.usage || {}
          const inputT = usage.input_tokens || 0
          const outputT = usage.output_tokens || 0
          const cost = (inputT * 0.000001) + (outputT * 0.000005)
          fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ endpoint: '/agent-import-spotify', model, input_tokens: inputT, output_tokens: outputT, cost_usd: cost })
          }).catch(() => {})
        }

        // Parse and save brain insights
        let extracted = []
        try { extracted = JSON.parse(rawText) } catch(e) {}
        for (const item of extracted) {
          if (!item.category || !item.title || !item.content) continue
          await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ category: item.category, title: item.title, content: item.content, active: true })
          })
        }

        const summary = `Imported ${trackItems.length} tracks from ${allArtists.length} artists. Top genres: ${topGenres.slice(0, 3).join(', ')}. Popularity range ${minPop}–${maxPop}/100 (Spotify score, not stream counts).`

        console.log(`✓ Spotify import: ${trackItems.length} tracks, ${allArtists.length} artists, ${topGenres.length} genres`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          trackCount: trackItems.length,
          artistCount: allArtists.length,
          genreCount: topGenres.length,
          topGenres,
          summary
        }))
      } catch(err) {
        logError('agent-import-spotify', err.message)
        console.error('✗ Agent Import Spotify error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── GET /get-page-title?url=... — fetch page title server-side (no CORS) ──
  if (req.method === 'GET' && req.url.startsWith('/get-page-title')) {
    const urlParam = new URL('http://x' + req.url).searchParams.get('url')
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (!urlParam) { res.writeHead(400); res.end(JSON.stringify({error:'missing url'})); return }
    try {
      let title = ''
      if (urlParam.includes('spotify.com')) {
        const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(urlParam)}`)
        if (r.ok) { const d = await r.json(); title = d.title || '' }
      } else if (urlParam.includes('youtube.com') || urlParam.includes('youtu.be')) {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(urlParam)}&format=json`)
        if (r.ok) { const d = await r.json(); title = (d.title||'') + (d.author_name ? ' — ' + d.author_name : '') }
      } else {
        const r = await fetch(urlParam, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
        if (r.ok) {
          const html = await r.text()
          const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
          if (m) title = m[1].trim()
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ title }))
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ title: '' }))
    }
    return
  }

  // ── POST /create-submission ─────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/create-submission') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { patchName, artist, audioFiles } = JSON.parse(body)
        // Strip only filesystem-illegal chars, preserve spaces within names
        const safe = s => (s||'').replace(/[<>:"/\\|?*]/g,'').trim()
        const folderName = safe(patchName)
        const submissionDir = path.join(SUBMISSIONS_DIR, folderName)

        if (!fs.existsSync(submissionDir)) fs.mkdirSync(submissionDir, { recursive: true })

        const copied = [], missing = []
        ;(audioFiles || []).forEach(filename => {
          const src        = path.join(DEMOS_DIR, filename)
          const publicName = getPublicFilename(filename, artist, null)
          const dest       = path.join(submissionDir, publicName)
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest)
            copied.push(publicName)
            console.log(`  ✓ Copied: ${filename} → ${publicName}`)
          } else {
            missing.push(filename)
            console.log(`  ⚠ Missing: ${filename}`)
          }
        })

        // Get Dropbox share link
        let shareLink = null
        if (DROPBOX_APP_KEY) {
          try {
            // Path relative to Dropbox root, must start with /
            const dbxPath = submissionDir
              .replace(path.join(process.env.HOME, 'Dropbox'), '')
              .replace(/\\/g, '/')
            console.log(`Dropbox path: "${dbxPath}"`)
            shareLink = await getDropboxShareLink(dbxPath)
            if (shareLink) console.log(`🔗 Share link: ${shareLink}`)
            else console.log('⚠ No share link returned')
          } catch(e) {
            console.log('⚠ Dropbox API error:', e.message)
          }
        }

        // Copy to clipboard — "NAME: link" format
        const clipText = shareLink
          ? `${folderName}: ${shareLink}`
          : submissionDir
        execSync(`printf '%s' '${clipText.replace(/'/g, "'\\''")}' | pbcopy`)
        console.log(`📋 Clipboard: ${clipText}`)
        console.log(`✓ Submission "${folderName}": ${copied.length} files copied`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, folderPath: submissionDir, shareLink, folderName, copied, missing }))
      } catch(err) {
        logError('package-submission', err.message)
        console.error('✗ Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /analyze-submission-brief — extract requirements + match ref tracks + demos ──
  if (req.method === 'POST' && req.url === '/analyze-submission-brief') {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      try {
        const { brief, label } = JSON.parse(Buffer.concat(chunks).toString())

        // Step 1: extract requirements via Claude Haiku
        const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 400,
            system: 'Extract music brief requirements. Return JSON only: { genre, subgenre, bpm_min, bpm_max, keys, mood, vocal_style, references, energy_level, keywords }',
            messages: [{ role: 'user', content: brief }]
          })
        })
        const extractData = await extractRes.json()
        let requirements = {}
        try { requirements = JSON.parse(extractData.content?.[0]?.text?.replace(/```json|```/g,'').trim() || '{}') } catch(_) {}

        // Step 2: fetch reference tracks + score against brief
        let refQuery = supabaseAdmin.from('reference_tracks').select('*').in('source', ['user', 'agent'])
        if (requirements.bpm_min) refQuery = refQuery.gte('tempo', requirements.bpm_min - 5)
        if (requirements.bpm_max) refQuery = refQuery.lte('tempo', requirements.bpm_max + 5)
        const { data: allRefs } = await refQuery.limit(100)

        const scoredRefs = (allRefs || []).map(ref => {
          let score = 0
          if (requirements.bpm_min && requirements.bpm_max && ref.tempo) {
            const inRange = ref.tempo >= requirements.bpm_min && ref.tempo <= requirements.bpm_max
            score += inRange ? 30 : Math.max(0, 20 - Math.abs(ref.tempo - ((requirements.bpm_min + requirements.bpm_max) / 2)) * 0.5)
          }
          if (requirements.energy_level === 'high' && ref.energy > 0.7) score += 20
          if (requirements.energy_level === 'low' && ref.energy < 0.4) score += 20
          if (requirements.energy_level === 'medium' && ref.energy > 0.4 && ref.energy < 0.7) score += 20
          if (requirements.keys?.length && ref.key) {
            if (requirements.keys.some(k => ref.key?.toLowerCase().includes(k.toLowerCase()))) score += 15
          }
          return { ...ref, brief_score: score }
        }).sort((a, b) => b.brief_score - a.brief_score).slice(0, 10)

        // Step 3: find matching demos from songs with analysis
        const { data: songs } = await supabaseAdmin.from('songs').select('id, title, code, work_data').not('work_data', 'is', null)
        const matchingDemos = []
        for (const song of (songs || [])) {
          const versions = song.work_data?.versions || []
          const latestAnalysis = versions.filter(v => v.analysis).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
          if (!latestAnalysis?.analysis) continue
          const a = latestAnalysis.analysis
          let score = 0; const reasons = []
          if (requirements.bpm_min && requirements.bpm_max && a.bpm) {
            if (a.bpm >= requirements.bpm_min - 5 && a.bpm <= requirements.bpm_max + 5) { score += 30; reasons.push(Math.round(a.bpm) + 'bpm ✓') }
          }
          if (requirements.energy_level === 'high' && a.energy > 0.7) { score += 25; reasons.push('high energy ✓') }
          if (requirements.energy_level === 'medium' && a.energy > 0.4 && a.energy < 0.75) { score += 25; reasons.push('mid energy ✓') }
          if (requirements.keys?.length && a.key) {
            if (requirements.keys.some(k => a.key?.toLowerCase().includes(k.toLowerCase()))) { score += 20; reasons.push(a.key + ' ✓') }
          }
          if (a.danceability > 0.6 && requirements.energy_level !== 'low') { score += 10; reasons.push('danceable ✓') }
          if (score > 20) matchingDemos.push({ id: song.id, title: song.title || song.code, code: song.code, match_score: Math.min(100, score), reasons, bpm: a.bpm, key: a.key, energy: a.energy })
        }
        matchingDemos.sort((a, b) => b.match_score - a.match_score)

        // Step 4: Mozart takes
        const mozRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 300,
            system: 'You are a music producer A&R advisor. Be specific and brief.',
            messages: [{ role: 'user', content: `Brief: "${brief}"\n\nTop demo matches: ${matchingDemos.slice(0,3).map(d => d.title + ' (' + d.match_score + '%)').join(', ')}\n\nIn 2-3 sentences: which demo should be sent first and why? What should be avoided?` }]
          })
        })
        const mozData = await mozRes.json()
        const analysis = mozData.content?.[0]?.text || ''

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, requirements, reference_tracks: scoredRefs, matching_demos: matchingDemos.slice(0, 8), analysis }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /save-submission-brief — writes brief.txt to submission folder ──
  if (req.method === 'POST' && req.url === '/save-submission-brief') {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (!body.folder || !body.brief) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing folder or brief' })); return }
        const content = [
          'SUBMISSION BRIEF',
          '================',
          new Date().toLocaleDateString('de-CH'),
          '',
          'BRIEF:',
          body.brief,
          '',
          'REQUIREMENTS EXTRACTED:',
          JSON.stringify(body.results?.requirements || {}, null, 2),
          '',
          'MATCHING DEMOS:',
          (body.results?.matching_demos || []).map(d => d.title + ' — ' + d.match_score + '% match').join('\n'),
          '',
          'MOZART ANALYSIS:',
          body.results?.analysis || ''
        ].join('\n')
        fs.writeFileSync(path.join(body.folder, 'brief.txt'), content)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /success-pattern — returns cached pattern, rebuilds if older than 24h ──
  if (req.method === 'GET' && req.url === '/success-pattern') {
    try {
      const { data } = await supabaseAdmin.from('user_settings').select('value, updated_at').eq('key', 'success_pattern').maybeSingle()
      let pattern = data?.value ? JSON.parse(data.value) : null
      if (!pattern || !data.updated_at || (Date.now() - new Date(pattern.updated_at).getTime()) > 24*3600000) {
        pattern = await buildSuccessPattern()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, pattern }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /analyze-success-match — compare song analysis to success pattern ──
  if (req.method === 'POST' && req.url === '/analyze-success-match') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { song_id } = JSON.parse(Buffer.concat(chunks).toString())
        const { data: song } = await supabaseAdmin.from('songs').select('work_data').eq('id', song_id).single()
        const versions = song?.work_data?.versions || []
        const analysis = versions.filter(v => v.analysis).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0]?.analysis
        if (!analysis) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: 'no analysis found' })); return }

        // Build pattern: project refs first, then user refs, then fall back to stored pattern
        const refLinks = song?.work_data?.reference_links || []
        let pattern = null
        if (refLinks.length) {
          const { data: projRefs } = await supabaseAdmin.from('reference_tracks').select('*').in('id', refLinks).limit(10)
          if (projRefs?.length) pattern = await buildSuccessPattern(projRefs)
        }
        if (!pattern) {
          const { data: patternRow } = await supabaseAdmin.from('user_settings').select('value').eq('key', 'success_pattern').maybeSingle()
          pattern = patternRow?.value ? JSON.parse(patternRow.value) : null
        }
        if (!pattern) pattern = await buildSuccessPattern()
        const result = await compareToSuccessPattern(analysis, pattern)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...result }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /log-feedback-pattern — classify + store feedback with analysis ──
  if (req.method === 'POST' && req.url === '/log-feedback-pattern') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { song_id, version_name, feedback_items, analysis } = JSON.parse(Buffer.concat(chunks).toString())
        const rows = (feedback_items || []).map(text => ({
          song_id, version_name,
          feedback_text: text,
          feedback_type: classifyFeedback(text),
          analysis: analysis || {}
        }))
        if (rows.length) {
          const { error: fpErr } = await supabaseAdmin.from('feedback_patterns').insert(rows)
          if (fpErr) console.error('feedback_patterns insert failed:', fpErr.message)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, logged: rows.length }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /feedback-insights — aggregate feedback patterns by type ──
  if (req.method === 'GET' && req.url.startsWith('/feedback-insights')) {
    try {
      const u = new URL(req.url, 'http://localhost')
      const songId = u.searchParams.get('song_id')
      let q = supabaseAdmin.from('feedback_patterns').select('*').order('created_at', { ascending: false }).limit(200)
      if (songId) q = q.eq('song_id', songId)
      const { data } = await q
      if (!data?.length) { res.writeHead(200); res.end(JSON.stringify({ ok: true, insights: {}, history: [] })); return }
      const byType = {}
      for (const row of data) {
        if (!byType[row.feedback_type]) byType[row.feedback_type] = { count: 0, rows: [] }
        byType[row.feedback_type].count++
        byType[row.feedback_type].rows.push(row)
      }
      const insights = {}
      for (const [type, { count, rows }] of Object.entries(byType)) {
        const avg = field => { const v = rows.map(r => r.analysis?.[field]).filter(x => x != null); return v.length ? Math.round((v.reduce((s,x)=>s+x,0)/v.length)*100)/100 : null }
        insights[type] = { count, avg_energy: avg('energy'), avg_bpm: avg('bpm'), avg_loudness: avg('loudness_lufs'), avg_bass: avg('bass_energy') }
      }
      const total = data.length
      const history = Object.entries(byType).map(([type, {count}]) => ({ type, count, pct: Math.round(count/total*100) })).sort((a,b)=>b.count-a.count)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, insights, history, total }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /trend-velocity — chart position velocity over last 14 days ──
  if (req.method === 'GET' && req.url === '/trend-velocity') {
    try {
      const velocity = await calculateVelocity()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...velocity }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /enrich-track-credits — fetch Genius + Spotify collaborators ──
  if (req.method === 'POST' && req.url === '/enrich-track-credits') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { title, artist, spotify_id, reference_track_id } = JSON.parse(Buffer.concat(chunks).toString())
        const [geniusCredits, collaborators] = await Promise.all([
          fetchGeniusCredits(artist, title),
          spotify_id ? fetchArtistCollaborators(spotify_id) : Promise.resolve([])
        ])
        const credits = { ...geniusCredits, collaborators, enriched_at: new Date().toISOString() }
        if (reference_track_id) {
          const { error: rtCrErr } = await supabaseAdmin.from('reference_tracks').update({ credits }).eq('id', reference_track_id)
          if (rtCrErr) console.error('reference_tracks credits update failed:', reference_track_id, rtCrErr.message)
          else console.log('✓ credits saved for track', reference_track_id)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, credits }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /save-instrumental — saves to Production/-Instrumentals/, overwrites old ──
  if (req.method === 'POST' && req.url.startsWith('/save-instrumental')) {
    const u = new URL(req.url, 'http://localhost')
    const fname   = u.searchParams.get('filename')
    const oldfile = u.searchParams.get('oldfile') || ''
    if (!fname) { res.writeHead(400); res.end('missing filename'); return }
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', async () => {
      try {
        // Delete old file if name changed
        if (oldfile && oldfile !== fname) {
          const oldPath = path.join(INSTRUMENTALS_DIR, oldfile)
          if (fs.existsSync(oldPath)) { fs.unlinkSync(oldPath); console.log(`  🗑 Deleted instrumental: ${oldfile}`) }
        }
        const buf = Buffer.concat(chunks)
        const destPath = path.join(INSTRUMENTALS_DIR, fname)
        fs.writeFileSync(destPath, buf)
        console.log(`  ✓ Saved instrumental: ${fname} (${(buf.length/1024/1024).toFixed(1)}MB)`)
        // Get Dropbox share link
        let shareLink = null
        try {
          const dbxPath = `/!MOMENTUM MUSIC/Production/-Instrumentals/${fname}`
          shareLink = await getDropboxShareLink(dbxPath)
        } catch(e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename: fname, shareLink }))
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /get-instrumental-link — get Dropbox link for existing instrumental ──
  if (req.method === 'POST' && req.url === '/get-instrumental-link') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { filename } = JSON.parse(body)
        const dbxPath = `/!MOMENTUM MUSIC/Production/-Instrumentals/${filename}`
        const shareLink = await getDropboxShareLink(dbxPath)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ shareLink }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ shareLink: null }))
      }
    })
    return
  }

  // ── POST /analyze-audio — BPM + Key detection ────────────────────────────
  if (req.method === 'POST' && req.url === '/analyze-audio') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { filename, dir } = JSON.parse(body)
        const dirMap = { demo: DEMOS_DIR, production: PRODUCTION_DIR, mixing: MIXING_DIR, instrumental: INSTRUMENTALS_DIR }
        const srcPath = path.join(dirMap[dir] || DEMOS_DIR, filename)
        if (!fs.existsSync(srcPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return }

        const { execSync } = require('child_process')
        const os = require('os')
        let bpm = null, key = null

        // ── Step 1: try to read embedded metadata (DAWs write BPM/KEY into files) ──
        try {
          const probe = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams ${shellEscape(srcPath)}`, { encoding: 'utf8' })
          const info = JSON.parse(probe)
          const tags = { ...info.format?.tags, ...(info.streams?.[0]?.tags || {}) }
          // case-insensitive tag scan
          const tagMap = {}
          for (const [k, v] of Object.entries(tags)) tagMap[k.toLowerCase()] = v
          if (tagMap.tbpm || tagMap.bpm) bpm = Math.round(parseFloat(tagMap.tbpm || tagMap.bpm))
          if (tagMap.tkey || tagMap.key || tagMap.initialkey) key = (tagMap.tkey || tagMap.key || tagMap.initialkey).trim()
          if (bpm) console.log(`  ℹ Metadata BPM: ${bpm}`)
          if (key) console.log(`  ℹ Metadata Key: ${key}`)
        } catch(e) {}

        // ── Step 2: Full Essentia signal set ──
        const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
        const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
        let esError = null, esFeatures = {}
        try {
          const pyOut = execSync(
            `"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(srcPath)} 2>/dev/null`,
            { encoding: 'utf8', timeout: 60000 }
          ).trim()
          esFeatures = JSON.parse(pyOut)
          if (esFeatures.bpm) {
            let b = esFeatures.bpm
            while (b < 70) b *= 2
            while (b > 160) b /= 2
            bpm = Math.round(b)
          }
          if (esFeatures.key && esFeatures.scale) {
            key = esFeatures.key + (esFeatures.scale === 'minor' ? 'm' : '')
          }
          console.log(`  ✓ Essentia: ${bpm}bpm ${key} nrg:${esFeatures.energy} dnc:${esFeatures.danceability} lufs:${esFeatures.loudness_lufs} (raw ${esFeatures.bpm})`)
        } catch(e) {
          esError = e.message.slice(0, 100)
          console.warn('  ✗ Essentia failed:', esError)
        }

        if (esError && !bpm && !key) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify({ bpm: null, bpmHalf: null, bpmDouble: null, key: null, error: 'Essentia failed' }))
          return
        }

        const bpmHalf = bpm ? Math.round(bpm / 2) : null
        const bpmDouble = bpm ? bpm * 2 : null
        if (bpm) console.log(`  BPM alternatives: ${bpmHalf} / ${bpm} / ${bpmDouble}`)
        console.log(`  ✓ Analysis: ${filename} → ${bpm} BPM, ${key}`)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({
          bpm, bpmHalf, bpmDouble, key,
          scale: esFeatures.scale || null,
          key_strength: esFeatures.key_strength || null,
          camelot: esFeatures.camelot || null,
          energy: esFeatures.energy || null,
          danceability: esFeatures.danceability || null,
          valence: esFeatures.valence || null,
          acousticness: esFeatures.acousticness || null,
          instrumentalness: esFeatures.instrumentalness || null,
          loudness_lufs: esFeatures.loudness_lufs || null,
          loudness: esFeatures.loudness_lufs || null,
          brightness: esFeatures.brightness || null,
          bass_energy: esFeatures.bass_energy || null,
          bpm_confidence: esFeatures.bpm_confidence || null,
          spectral_centroid: esFeatures.spectral_centroid || null,
          spectral_contrast: esFeatures.spectral_contrast || null,
          spectral_flux: esFeatures.spectral_flux || null,
          mfcc_mean: esFeatures.mfcc_mean || null,
          duration_seconds: esFeatures.duration_seconds || null
        }))
      } catch(err) {
        logError('analyze-audio', err.message)
        console.error('✗ analyze-audio:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // ── GET /audio/FILENAME ─────────────────────────────────────────────────
  // unified audio route: /audio/, /production/, /mixing/
  const routePrefixes = { '/audio/': DEMOS_DIR, '/production/': PRODUCTION_DIR, '/mixing/': MIXING_DIR, '/instrumentals/': INSTRUMENTALS_DIR }
  const matchedPrefix = Object.keys(routePrefixes).find(p => req.url.startsWith(p))
  if (matchedPrefix) {
    let filename = decodeURIComponent(req.url.slice(matchedPrefix.length))
    if (filename.includes('..') || filename.includes('/')) { res.writeHead(400); res.end(); return }
    let filepath = path.join(routePrefixes[matchedPrefix], filename)
    // Prefer MP3 over WAV when client accepts audio/mpeg and MP3 exists alongside
    const acceptsMp3 = (req.headers.accept || '').includes('audio/mpeg')
    if (acceptsMp3 && filename.toLowerCase().endsWith('.wav')) {
      const mp3Filename = filename.replace(/\.wav$/i, '.mp3')
      const mp3Filepath = path.join(routePrefixes[matchedPrefix], mp3Filename)
      if (fs.existsSync(mp3Filepath)) { filename = mp3Filename; filepath = mp3Filepath }
    }
    if (!fs.existsSync(filepath)) { res.writeHead(404); res.end('not found'); return }
    const stat  = fs.statSync(filepath)
    const mime  = MIME[path.extname(filename).toLowerCase()] || 'audio/mpeg'
    const total = stat.size
    const range = req.headers.range
    // Strip internal code prefix for download — only for production/mixing, not demos/instrumentals
    const isArtistFile = matchedPrefix === '/production/' || matchedPrefix === '/mixing/'
    const publicName = isArtistFile ? getPublicFilename(filename, null, null) : filename
    const baseHeaders = {
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `inline; filename="${publicName}"`
    }
    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(s, 10)
      const end   = e ? parseInt(e, 10) : total - 1
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
      })
      fs.createReadStream(filepath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...baseHeaders, 'Content-Length': total })
      fs.createReadStream(filepath).pipe(res)
    }
    return
  }

  // ── POST /agent-pulse-check — fetch RSS headlines, compare against brain ──
  if (req.method === 'POST' && req.url === '/agent-pulse-check') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body2 = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body2.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not set' })); return }
        await runPulseCheck(apiKey)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        logError('agent-pulse-check', e.message)
        console.error('agent-pulse-check error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /agent-chart-analysis — Spotify year:2026 search + Essentia + brain storage ──
  if (req.method === 'POST' && req.url === '/agent-chart-analysis') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY || ''
        const result = await runAgentChartAnalysis(apiKey)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch(e) {
        logError('agent-chart-analysis', e.message)
        console.error('✗ agent-chart-analysis:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /run-morning-agents — run all agents with shared brain context ──
  if (req.method === 'POST' && req.url === '/run-morning-agents') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body3 = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const apiKey = body3.apiKey || process.env.ANTHROPIC_API_KEY || ''
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not set' })); return }

        // Fetch brain context once — shared across all agents
        const sharedBrainContext = await fetchSharedBrainContext()
        console.log(`⚡ Morning agents: ${sharedBrainContext.length} brain rows loaded`)

        // Run all agents in parallel with shared context
        const [scoutResult, demoResult, trendsResult, chartResult] = await Promise.allSettled([
          runAgentScout(apiKey, sharedBrainContext),
          runAgentDemoMatch(apiKey, sharedBrainContext),
          runAgentTikTokTrends(apiKey, sharedBrainContext),
          runAgentChartAnalysis(apiKey),
        ])

        // Pulse check runs after (uses RSS, doesn't need brain passed)
        await runPulseCheck(apiKey, sharedBrainContext).catch(e => console.warn('Pulse check error:', e.message))

        const results = {
          ok: true,
          scout:     scoutResult.status === 'fulfilled'  ? scoutResult.value   : { ok: false, error: scoutResult.reason?.message },
          demoMatch: demoResult.status  === 'fulfilled'  ? demoResult.value    : { ok: false, error: demoResult.reason?.message },
          trends:    trendsResult.status === 'fulfilled' ? trendsResult.value  : { ok: false, error: trendsResult.reason?.message },
          chart:     chartResult.status === 'fulfilled'  ? chartResult.value   : { ok: false, error: chartResult.reason?.message },
        }
        console.log('✓ Morning agents complete')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(results))
      } catch(err) {
        logError('run-morning-agents', err.message)
        console.error('✗ Morning agents error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /speak — OpenAI TTS, streams audio/mpeg directly ───────────────
  if (req.method === 'POST' && req.url === '/speak') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing text' })); return }
        const openaiKey = process.env.OPENAI_API_KEY
        if (!openaiKey) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'OPENAI_API_KEY not set in .env' }))
          return
        }
        const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: text.slice(0, 4096) })
        })
        if (!ttsRes.ok) {
          const errText = await ttsRes.text()
          throw new Error(`OpenAI TTS: ${ttsRes.status} ${errText.slice(0, 120)}`)
        }
        // Track cost: $0.015 per 1000 chars — fire-and-forget before streaming
        fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
          method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ endpoint: '/speak', model: 'openai-tts-1', input_tokens: text.length, output_tokens: 0, cost_usd: text.length * 0.000015 })
        }).catch(() => {})
        // Stream directly — no buffering
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
        Readable.fromWeb(ttsRes.body).pipe(res)
      } catch(err) {
        logError('speak', err.message)
        console.error('✗ /speak error:', err.message)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      }
    })
    return
  }

  // ── POST /suggest-category — AI category suggestion for brain dump text ───
  if (req.method === 'POST' && req.url === '/suggest-category') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        console.log('[suggest-category] handler start')
        const { text, existingCategories, apiKey } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!text || !apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing text or apiKey' }))
          return
        }

        // Always fetch distinct active categories fresh from Supabase — never trust stale browser state
        const freshCatsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=category&not.category=is.null`,
          { headers: sbHeaders }
        ).catch(() => null)
        const freshCatsData = freshCatsRes ? await freshCatsRes.json().catch(() => []) : []
        const dbCats = [...new Set(
          (Array.isArray(freshCatsData) ? freshCatsData : []).map(r => r.category).filter(Boolean)
        )]
        const standardCats = [
          'goal', 'mixing_technique', 'production_style', 'market_knowledge', 'own_production',
          'contact_profile', 'collaboration', 'observation', 'creative_process', 'sound_design',
          'business', 'power_dynamics_principles', 'release_strategy', 'industry_insight',
          'networking', 'artist_strategy', 'reference_current', 'question',
          'genre_strategy', 'correction'
        ]
        const cats = [...new Set([...dbCats, ...standardCats])].sort()

        // Build genre fingerprint from library tracks
        let genreFingerprint = ''
        try {
          const libRes = await fetch(
            `${SUPABASE_URL}/rest/v1/reference_tracks?select=genres,genre_tags&not.spotify_id=is.null`,
            { headers: sbHeaders }
          ).catch(() => null)
          const libTracks = libRes ? await libRes.json().catch(() => []) : []
          const genreCounts = {}
          for (const t of (Array.isArray(libTracks) ? libTracks : [])) {
            for (const g of [...(t.genres || []), ...(t.genre_tags || [])]) {
              genreCounts[g] = (genreCounts[g] || 0) + 1
            }
          }
          const topGenres = Object.entries(genreCounts)
            .sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([g, c]) => g + '(' + c + ')')
          if (topGenres.length) genreFingerprint = '\n\nProducer genre fingerprint (from reference library): ' + topGenres.join(', ')
        } catch(e) {}

        let prompt

        if (cats.length < 3) {
          // Early stage — too few categories to match against, just propose a new one
          prompt = `You are organizing a music producer's personal knowledge base.
A new text has been dumped in. The knowledge base is almost empty so do not force-fit it.
Propose a sensible snake_case category name and explain in one sentence what it should collect going forward.

Respond only in JSON:
{
  "action": "new",
  "suggestion": "snake_case_name",
  "reason": "one sentence describing what this category should collect",
  "alternatives": []
}

New text:
${text.slice(0, 1500)}${genreFingerprint}`
        } else {
          // Fetch seed/description row (oldest) + newest real entry per category
          // so Claude sees both the category intent AND real usage
          const catFetches = cats.map(cat => Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.${encodeURIComponent(cat)}&select=title,content&order=created_at.asc&limit=1`, { headers: sbHeaders })
              .then(r => r.json()).catch(() => []),
            fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.${encodeURIComponent(cat)}&select=title,content&order=created_at.desc&limit=1`, { headers: sbHeaders })
              .then(r => r.json()).catch(() => [])
          ]))
          const catResults = await Promise.allSettled(catFetches)

          const contextLines = cats.map((cat, i) => {
            const [oldest, newest] = catResults[i].status === 'fulfilled' ? catResults[i].value : [[], []]
            // Deduplicate: if only one entry exists, oldest === newest
            const rows = []
            if (Array.isArray(oldest) && oldest[0]) rows.push(oldest[0])
            if (Array.isArray(newest) && newest[0] && newest[0].title !== rows[0]?.title) rows.push(newest[0])
            if (!rows.length) return `- ${cat}: (no entries yet)`
            const examples = rows.map(r => `    · ${r.title}: ${(r.content || '').slice(0, 80)}`).join('\n')
            return `- ${cat}:\n${examples}`
          }).join('\n')

          prompt = `You are organizing a music producer's personal knowledge brain.
Your job: decide where new content belongs based on what is ALREADY in each category — not based on category names alone.

Existing categories with real content:
${contextLines}

Rules:
1. Match by content similarity to existing examples, not name
2. Only suggest existing category if content is genuinely similar
3. If nothing fits well, propose a new snake_case category name and ONE sentence describing what it should contain
4. If text covers 2+ clearly separate topics, suggest split
5. Never match on superficial keyword overlap
6. Do not suggest business, or market_knowledge unless the content is specifically about those topics

New text to categorize:
${text.slice(0, 1500)}${genreFingerprint}

Respond ONLY in JSON:
{
  "action": "existing" | "new" | "split",
  "suggestion": "category_name",
  "reason": "one sentence — quote the specific existing entry it matches, or explain why new category is needed",
  "alternatives": [{ "category": "name", "reason": "one sentence" }],
  "splits": [{ "title": "short title", "category": "cat", "content": "verbatim chunk" }]
}`
        }

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }]
          })
        })
        const aiData = await aiRes.json()
        if (aiData.usage) {
          const cost = (aiData.usage.input_tokens * 0.000001) + (aiData.usage.output_tokens * 0.000005)
          fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
            method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ endpoint: '/suggest-category', model: 'claude-haiku-4-5-20251001', input_tokens: aiData.usage.input_tokens, output_tokens: aiData.usage.output_tokens, cost_usd: cost })
          }).catch(() => {})
        }
        if (aiData.error) throw new Error(aiData.error.message)
        const raw = aiData.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '{}'
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        let result
        try {
          result = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: 'new', suggestion: 'knowledge', reason: 'No JSON in response', alternatives: [] }
        } catch(_) {
          result = { action: 'new', suggestion: 'knowledge', reason: 'Parse error', alternatives: [] }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          ...result,
          category: result.suggestion || result.category || '',
          allCategories: cats
        }))
        setImmediate(() => brainToObsidian().catch(() => {}))
      } catch(err) {
        logError('suggest-category', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── GET /daily-snapshot — pipeline counts for goals progress ─────────────
  if (req.method === 'GET' && req.url === '/daily-snapshot') {
    try {
      const thisMonth = new Date().toISOString().slice(0, 7)
      const monthStart = thisMonth + '-01'
      const [songsRes, demosRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/songs?select=work_data&not.project_id=is.null`, { headers: sbHeaders }),
        fetch(`${SUPABASE_URL}/rest/v1/share_sessions?select=created_at&session_type=eq.demo&created_at=gte.${monthStart}`, { headers: sbHeaders })
      ])
      const [songs, demos] = await Promise.all([songsRes.json(), demosRes.json()])
      let in_progress = 0, in_mixing = 0, done_this_month = 0
      for (const s of (Array.isArray(songs) ? songs : [])) {
        const stage = (s.work_data || {}).current_stage || ''
        const completedAt = (s.work_data || {}).completed_at || ''
        if (stage === 'production') in_progress++
        else if (stage === 'mixing') in_mixing++
        else if (stage === 'done' && completedAt.slice(0, 7) === thisMonth) done_this_month++
      }
      const demos_sent_this_month = Array.isArray(demos) ? demos.length : 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, in_progress, in_mixing, done_this_month, demos_sent_this_month }))
    } catch(e) {
      logError('daily-snapshot', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /analyze-youtube-track — yt-dlp download + Essentia (YouTube/TikTok/Instagram) ──
  if (req.method === 'POST' && req.url === '/analyze-youtube-track') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const { url } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }

        const preview_source = /tiktok\.com/.test(url) ? 'tiktok'
          : /instagram\.com/.test(url) ? 'instagram'
          : 'youtube'

        const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
        const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
        const tmpAudio = `/tmp/yt_${Date.now()}.mp3`

        // Get title via yt-dlp --get-title first
        let title = url
        try {
          title = execSync(`yt-dlp --get-title --no-warnings "${url}" 2>/dev/null`, { encoding: 'utf8', timeout: 30000 }).trim()
        } catch(e) {}

        execSync(
          `yt-dlp -x --audio-format mp3 --download-sections "*0-30" -o "${tmpAudio}" "${url}"`,
          { timeout: 90000 }
        )

        const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
        const feat = JSON.parse(esOut)

        try { fs.unlinkSync(tmpAudio) } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          title,
          preview_source,
          bpm:              feat.bpm,
          key:              feat.key,
          scale:            feat.scale,
          key_strength:     feat.key_strength,
          energy:           feat.energy,
          danceability:     feat.danceability,
          valence:          feat.valence,
          loudness_lufs:    feat.loudness_lufs,
          brightness:       feat.brightness,
          bass_energy:      feat.bass_energy,
          acousticness:     feat.acousticness,
          duration_seconds: feat.duration_seconds
        }))
      } catch(e) {
        console.error('analyze-youtube-track:', e.message?.slice(0, 80))
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── vocal EQ helpers ──────────────────────────────────────────────────────
  function getFreqDescription(freq, action) {
    if (freq <= 80)   return action === 'boost' ? 'sub/body' : 'reduce rumble/sub'
    if (freq <= 200)  return action === 'boost' ? 'warmth/fullness' : 'reduce mud/boom'
    if (freq <= 500)  return action === 'boost' ? 'low-mid body' : 'reduce boxiness/mud'
    if (freq <= 1000) return action === 'boost' ? 'presence/nasal' : 'reduce honk'
    if (freq <= 3150) return action === 'boost' ? 'presence/clarity/attack' : 'reduce harshness'
    if (freq <= 8000) return action === 'boost' ? 'definition/detail' : 'reduce sibilance'
    return action === 'boost' ? 'air/brilliance' : 'reduce harshness/hiss'
  }

  function interpretVocalComparison(mixCurve, refCurve) {
    const diffs = {}
    const boostNeeded = []
    const cutNeeded = []
    for (const [freq, refDb] of Object.entries(refCurve)) {
      const mixDb = mixCurve[freq] || 0
      const diff = parseFloat((refDb - mixDb).toFixed(1))
      diffs[freq] = diff
      if (diff > 1.5) boostNeeded.push({ freq: parseFloat(freq), diff })
      if (diff < -1.5) cutNeeded.push({ freq: parseFloat(freq), diff })
    }
    boostNeeded.sort((a, b) => b.diff - a.diff)
    cutNeeded.sort((a, b) => a.diff - b.diff)
    const instructions = []
    for (const b of boostNeeded.slice(0, 5)) {
      const freqLabel = b.freq >= 1000 ? (b.freq/1000).toFixed(1) + 'kHz' : b.freq + 'Hz'
      instructions.push({ action: 'BOOST', freq: b.freq, freqLabel, amount: b.diff.toFixed(1), reason: getFreqDescription(b.freq, 'boost') })
    }
    for (const c of cutNeeded.slice(0, 5)) {
      const freqLabel = c.freq >= 1000 ? (c.freq/1000).toFixed(1) + 'kHz' : c.freq + 'Hz'
      instructions.push({ action: 'CUT', freq: c.freq, freqLabel, amount: Math.abs(c.diff).toFixed(1), reason: getFreqDescription(c.freq, 'cut') })
    }
    const avgDiff = Object.values(diffs).map(d => Math.abs(d)).reduce((s, v) => s + v, 0) / Object.keys(diffs).length
    const matchScore = Math.round(Math.max(0, 100 - avgDiff * 10))
    return { diffs, instructions, matchScore, boostNeeded, cutNeeded }
  }

  // ── POST /analyze-vocal-eq — Demucs 4-stem separation + ISO 30-band EQ ──
  if (req.method === 'POST' && req.url === '/analyze-vocal-eq') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const { type, url, song_id, label } = body

        if (type === 'reference') {
          if (!url) throw new Error('url required for reference type')
          const { id: savedId, stems } = await analyzeVocalEqUrl(url, song_id, label)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, id: savedId, stems, stem_count: Object.keys(stems).length }))

        } else if (type === 'mix') {
          if (!song_id) throw new Error('song_id required for mix type')
          const songRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${song_id}&select=work_data,code`, { headers: sbHeaders })
          const songRows = await songRes.json()
          if (!songRows[0]) throw new Error('Song not found')
          const wd = songRows[0].work_data || {}
          const mixVersions = (wd.versions || [])
            .filter(v => (v.version_type === 'mixing' || v.version_type === 'production') && v.audio_path)
          mixVersions.sort((a, b) => (b.name || '').localeCompare(a.name || ''))
          if (!mixVersions.length) throw new Error('No mixing or production versions with audio found')
          const latestVersion = mixVersions[0]
          const filename = latestVersion.audio_path
          let audioFilePath = null
          const mixPath = path.join(MIXING_DIR, filename)
          const prodPath = path.join(PRODUCTION_DIR, filename)

          if (fs.existsSync(mixPath)) audioFilePath = mixPath
          else if (fs.existsSync(prodPath)) audioFilePath = prodPath

          // Fuzzy fallback: search by song code when exact path not found
          if (!audioFilePath) {
            const code = songRows[0].code || filename.split('_')[0]
            for (const dir of [MIXING_DIR, PRODUCTION_DIR]) {
              try {
                const files = fs.readdirSync(dir)
                const matches = files
                  .filter(f => f.startsWith(code) && (f.endsWith('.wav') || f.endsWith('.mp3')))
                  .sort()
                  .reverse()
                if (matches.length) {
                  audioFilePath = path.join(dir, matches[0])
                  console.log('vocal eq fuzzy match:', matches[0])
                  break
                }
              } catch(e) {}
            }
          }

          if (!audioFilePath) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: 'Audio file not found: ' + filename }))
          }

          console.log('⏳ Running 4-stem EQ analysis on:', audioFilePath)
          const raw = execSync(`"${VOCAL_EQ_PYTHON}" "${VOCAL_EQ_SCRIPT}" ${shellEscape(audioFilePath)} 2>/dev/null`, { encoding: 'utf8', timeout: 400000 }).trim()
          const result = JSON.parse(raw)
          if (!result.ok) throw new Error(result.error || 'Script failed')

          const savedCurves = []
          for (const [stemName, curve] of Object.entries(result.stems || {})) {
            // Remove any prior mix curve for this stem before inserting the fresh one
            const { error: eqDelErr } = await supabaseAdmin.from('vocal_eq_curves').delete()
              .eq('song_id', String(song_id))
              .eq('stem_type', stemName)
              .eq('source_type', 'mix')
            if (eqDelErr) console.error('vocal_eq_curves delete failed:', stemName, eqDelErr.message)
            const { data, error } = await supabaseAdmin
              .from('vocal_eq_curves')
              .insert({
                label: (label || 'My Mix') + ' — ' + stemName,
                song_id: String(song_id),
                version_name: latestVersion?.name || 'latest',
                curve,
                stem_type: stemName,
                source_type: 'mix'
              })
              .select()
            if (error) {
              console.error('✗ vocal_eq_curves save error:', error.message, error.code)
            } else {
              console.log('✓ saved curve:', stemName, 'for song', song_id)
              savedCurves.push({ stemName, id: data?.[0]?.id })
            }
          }

          // Auto-queue song's reference_links that haven't been analyzed yet
          const refLinks = wd.reference_links || []
          for (const ref of refLinks) {
            if (!ref.spotify_id && !ref.url) continue
            const refUrl = ref.url || 'https://open.spotify.com/track/' + ref.spotify_id
            const { data: existRes } = await supabaseAdmin.from('vocal_eq_curves').select('id').eq('source_type', 'reference').eq('label', ref.name || 'Reference').limit(1)
            if (!existRes?.[0]) {
              setImmediate(async () => {
                try {
                  await analyzeVocalEqUrl(refUrl, song_id, ref.name || 'Reference')
                  console.log('✓ Auto-analyzed ref for song', song_id, ':', ref.name || refUrl)
                } catch(e) { console.error('auto-ref vocal eq:', e.message) }
              })
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, stems: result.stems, saved: savedCurves, stem_count: Object.keys(result.stems).length }))
        } else {
          throw new Error('type must be reference or mix')
        }
      } catch(err) {
        console.error('✗ analyze-vocal-eq:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── GET /vocal-eq-curves?song_id=xxx — all curves for a song + global refs ──
  if (req.method === 'GET' && req.url.startsWith('/vocal-eq-curves')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const songId = new URL('http://x' + req.url).searchParams.get('song_id')
      const { data, error } = await supabaseAdmin
        .from('vocal_eq_curves')
        .select('*')
        .eq('song_id', String(songId))
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, curves: data || [] }))
    } catch(err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: err.message }))
    }
    return
  }

  // ── POST /compare-vocal-eq — compute diffs + EQ instructions ─────────────
  if (req.method === 'POST' && req.url === '/compare-vocal-eq') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const { mix_curve, reference_curve } = JSON.parse(Buffer.concat(chunks).toString())
        if (!mix_curve || !reference_curve) throw new Error('mix_curve and reference_curve required')
        const comparison = interpretVocalComparison(mix_curve, reference_curve)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...comparison }))
      } catch(err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: err.message }))
      }
    })
    return
  }

  // ── POST /analyze-stems — Tier 2 on-demand stem EQ via Demucs ───────────────
  if (req.method === 'POST' && req.url === '/analyze-stems') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { reference_track_id } = JSON.parse(body)
        if (!reference_track_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'reference_track_id required' })); return }
        const { data: track, error: fetchErr } = await supabase.from('reference_tracks').select('*').eq('id', reference_track_id).single()
        if (fetchErr || !track) { res.writeHead(404); res.end(JSON.stringify({ error: 'track not found' })); return }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: 'Stem analysis started for: ' + track.title }))
        runStemAnalysis(track).catch(e => console.error('analyze-stems error:', e.message))
      } catch(e) {
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /generate-proq4-preset — generate FabFilter Pro-Q 4 .ffp preset ──────
  if (req.method === 'POST' && req.url === '/generate-proq4-preset') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { song_id, reference_track_id, stem_type } = JSON.parse(body)
        const stemKey = stem_type || 'vocals'

        const { data: mixRow } = await supabaseAdmin.from('vocal_eq_curves')
          .select('curve').eq('song_id', String(song_id)).eq('stem_type', stemKey).eq('source_type', 'mix')
          .order('created_at', { ascending: false }).limit(1).single()

        const { data: refRow } = await supabaseAdmin.from('vocal_eq_curves')
          .select('curve').eq('reference_track_id', String(reference_track_id)).eq('stem_type', stemKey)
          .limit(1).single()

        if (!mixRow?.curve || !refRow?.curve) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Missing curves — analyze stems first (mix: ' + !!mixRow?.curve + ', ref: ' + !!refRow?.curve + ')' }))
          return
        }

        const ISO_FREQS_PQ = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000]

        function toCurveArr(curve) {
          if (!curve) return []
          if (Array.isArray(curve)) return curve.map(v => isFinite(v) ? v : 0)
          const vals = Object.keys(curve).filter(k => !isNaN(k)).sort((a,b)=>Number(a)-Number(b)).map(k=>curve[k])
          return vals.length ? vals.map(v => isFinite(v) ? v : 0) : []
        }
        function normPeak(arr) {
          if (!arr.length) return arr
          const peak = Math.max(...arr.filter(isFinite))
          if (!isFinite(peak) || peak === 0) return arr
          return arr.map(v => v - peak)
        }

        const mixArr = normPeak(toCurveArr(mixRow.curve))
        const refArr = normPeak(toCurveArr(refRow.curve))
        const len = Math.min(mixArr.length, refArr.length, ISO_FREQS_PQ.length)
        const diff = Array.from({ length: len }, (_, i) => refArr[i] - mixArr[i])

        const bands = []
        for (let i = 0; i < diff.length; i++) {
          const gain = diff[i]
          if (Math.abs(gain) < 1.5) continue
          const prev = diff[i-1] || 0, next = diff[i+1] || 0
          if (Math.abs(gain) >= Math.abs(prev) && Math.abs(gain) >= Math.abs(next)) {
            bands.push({ freq: ISO_FREQS_PQ[i], gain: Math.max(-12, Math.min(12, gain)), q: 1.41 })
          }
        }
        bands.sort((a, b) => a.freq - b.freq)
        const activeBands = bands.slice(0, 24)

        const presetName = stemKey + '_match_' + new Date().toISOString().slice(0, 10)
        let xml = '<?xml version="1.0" encoding="utf-8"?>\n<PresetChunkXML>\n  <Preset name="' + presetName + '" plugin="Pro-Q 4">\n    <Parameters>\n'
        activeBands.forEach((band, i) => {
          const n = i + 1
          xml += '      <Band' + n + 'Enabled>1</Band' + n + 'Enabled>\n'
          xml += '      <Band' + n + 'Frequency>' + band.freq.toFixed(2) + '</Band' + n + 'Frequency>\n'
          xml += '      <Band' + n + 'Gain>' + band.gain.toFixed(2) + '</Band' + n + 'Gain>\n'
          xml += '      <Band' + n + 'Q>' + band.q.toFixed(2) + '</Band' + n + 'Q>\n'
          xml += '      <Band' + n + 'Shape>Bell</Band' + n + 'Shape>\n'
        })
        for (let i = activeBands.length + 1; i <= 24; i++) {
          xml += '      <Band' + i + 'Enabled>0</Band' + i + 'Enabled>\n'
        }
        xml += '    </Parameters>\n  </Preset>\n</PresetChunkXML>\n'

        const filename = presetName + '.ffp'
        const outputPath = '/Users/remo/Desktop/' + filename
        fs.writeFileSync(outputPath, xml, 'utf8')
        console.log('✓ Pro-Q 4 preset saved:', outputPath, '(' + activeBands.length + ' bands)')

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename, path: outputPath, bands: activeBands.length }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /average-ref-curves — average EQ curves across multiple reference tracks ──
  if (req.method === 'POST' && req.url === '/average-ref-curves') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { reference_ids, stem_type } = JSON.parse(body)
        if (!reference_ids?.length) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'reference_ids required' })); return }

        const { data: curves } = await supabaseAdmin
          .from('vocal_eq_curves')
          .select('curve, reference_track_id')
          .eq('stem_type', stem_type || 'mix')
          .in('reference_track_id', reference_ids.map(String))

        if (!curves?.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'no curves found for these references' }))
          return
        }

        const arrays = curves.map(c => {
          const arr = c.curve
          if (Array.isArray(arr)) return arr.filter(v => v !== null && isFinite(v))
          if (arr && typeof arr === 'object') {
            const vals = Object.keys(arr).filter(k => !isNaN(k)).sort((a,b)=>Number(a)-Number(b)).map(k=>arr[k])
            return vals.filter(v => v !== null && isFinite(v))
          }
          return []
        }).filter(a => a.length > 0)

        if (!arrays.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'no valid curve data' }))
          return
        }

        const len = Math.max(...arrays.map(a => a.length))
        const averaged = Array.from({ length: len }, (_, i) => {
          const vals = arrays.map(a => a[i]).filter(v => v !== null && isFinite(v))
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
        })

        console.log('✓ avg-ref-curves:', curves.length, 'curves averaged for stem:', stem_type)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, curve: averaged, count: curves.length }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /analyze-audio-features — run Essentia analysis on local audio file ──
  if (req.method === 'POST' && req.url === '/analyze-audio-features') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const dir = body.dir === 'mixing' ? MIXING_DIR
          : body.dir === 'demo' ? DEMOS_DIR : PRODUCTION_DIR
        const filePath = path.join(dir, body.filename)

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'File not found: ' + filePath }))
          return
        }

        // Write Python script to temp file to avoid quoting issues
        const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
        const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
        let features
        const rawResult = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" ${shellEscape(filePath)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 })
        const rawFeat = JSON.parse(rawResult.trim())
        // Normalize for reference_tracks schema
        features = { ...rawFeat, tempo: rawFeat.bpm, key: rawFeat.key + ' ' + rawFeat.scale, loudness: rawFeat.loudness_lufs, duration: rawFeat.duration_seconds }

        // Upsert to reference_tracks
        const spotifyId = 'local_' + body.filename.replace(/[^a-z0-9]/gi, '_')
        await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            spotify_id: spotifyId,
            title: body.filename.replace(/\.(wav|aiff|aif|mp3|flac|m4a)$/i, ''),
            artist: 'REMO (produced)',
            genre_tags: [],
            tempo: features.tempo,
            key: features.key,
            scale: rawFeat.scale,
            camelot: rawFeat.camelot || null,
            key_strength: rawFeat.key_strength,
            energy: rawFeat.energy,
            danceability: rawFeat.danceability,
            valence: rawFeat.valence,
            acousticness: rawFeat.acousticness,
            brightness: rawFeat.brightness,
            bass_energy: rawFeat.bass_energy,
            bpm_confidence: rawFeat.bpm_confidence,
            loudness: rawFeat.loudness_lufs,
            loudness_range: rawFeat.loudness_range,
            duration_seconds: rawFeat.duration_seconds,
            spectral_centroid: rawFeat.spectral_centroid || null,
            spectral_contrast: rawFeat.spectral_contrast || null,
            spectral_flux: rawFeat.spectral_flux || null,
            mfcc_mean: rawFeat.mfcc_mean ? JSON.stringify(rawFeat.mfcc_mean) : null,
            popularity: null,
            collection_name: 'my_productions',
            approved: true
          })
        })

        console.log(`✓ Audio analyzed: ${body.filename} — ${features.tempo}bpm ${features.key} (${rawFeat.camelot||'?'}) nrg:${rawFeat.energy} dnc:${rawFeat.danceability} ${rawFeat.loudness_lufs}LUFS`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, analysis: rawFeat, ...rawFeat, tempo: features.tempo, key: features.key }))
      } catch(e) {
        console.warn('analyze-audio-features error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /extract-acapella — Demucs vocal separation + trim to onset ──
  if (req.method === 'POST' && req.url === '/extract-acapella') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        let inputPath

        if (body.file_path) {
          inputPath = body.file_path
          if (!fs.existsSync(inputPath)) throw new Error('File not found: ' + inputPath)
        } else if (body.file_data) {
          const ext = (body.ext || 'wav').replace(/^\./, '')
          const tmpInput = `/tmp/acapella_in_${Date.now()}.${ext}`
          fs.writeFileSync(tmpInput, Buffer.from(body.file_data, 'base64'))
          inputPath = tmpInput
        } else {
          throw new Error('file_path or file_data required')
        }

        console.log('⏳ Extracting acapella from:', path.basename(inputPath))
        const result = await extractAcapella(inputPath)

        // Clean up base64 temp input — never touch original file_path
        if (body.file_data && fs.existsSync(inputPath)) {
          try { fs.unlinkSync(inputPath) } catch(e) {}
        }

        console.log(`✓ Acapella: ${result.filename} | onset:${result.onset.toFixed(2)}s bpm:${result.bpm} key:${result.key}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...result, saved_to: 'Desktop', original_untouched: true }))
      } catch(e) {
        console.error('extract-acapella error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /sync-all-refs — consolidate all Spotify track refs into reference_tracks ──
  if (req.method === 'POST' && req.url === '/sync-all-refs') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const { apiKey } = JSON.parse(Buffer.concat(chunks).toString())
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing apiKey' })); return }

        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbH = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }

        // 1. Collect track IDs from songs.reference_links
        const songsRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=id,title,code,reference_links`, { headers: sbH })
        const songs = await songsRes.json()
        const trackSources = {} // trackId -> collection_name

        for (const song of (Array.isArray(songs) ? songs : [])) {
          for (const ref of (song.reference_links || [])) {
            const url = typeof ref === 'string' ? ref : (ref.url || '')
            const m = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/)
            if (m) trackSources[m[1]] = (song.code || 'song') + '_refs'
          }
        }

        // 2. Collect track IDs from daily_state.refs
        let dsOffset = 0
        while (true) {
          const dsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/daily_state?select=refs&limit=1000&offset=${dsOffset}`,
            { headers: sbH }
          )
          const dsRows = await dsRes.json()
          if (!Array.isArray(dsRows) || !dsRows.length) break
          for (const row of dsRows) {
            for (const ref of (row.refs || [])) {
              const url = typeof ref === 'string' ? ref : (ref.url || '')
              const m = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/)
              if (m && !trackSources[m[1]]) trackSources[m[1]] = 'daily_references'
            }
          }
          if (dsRows.length < 1000) break
          dsOffset += 1000
        }

        const allIds = Object.keys(trackSources)
        console.log(`  sync-all-refs: found ${allIds.length} unique Spotify track IDs`)
        if (!allIds.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, found: 0, added: 0, skipped: 0 }))
          return
        }

        // 3. Check which IDs already exist
        const existingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/reference_tracks?select=spotify_id&limit=10000`,
          { headers: sbH }
        )
        const existingRows = await existingRes.json()
        const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map(r => r.spotify_id))
        const newIds = allIds.filter(id => !existingIds.has(id))
        console.log(`  sync-all-refs: ${existingIds.size} existing, ${newIds.length} new to fetch`)

        if (!newIds.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, found: allIds.length, added: 0, skipped: allIds.length }))
          return
        }

        // 4. Batch fetch track data + audio features + artists from Spotify
        const KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

        const allTracks = []
        for (let i = 0; i < newIds.length; i += 50) {
          const batch = newIds.slice(i, i + 50)
          const r = await spotifyFetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`)
          if (!r.ok) { console.warn(`  tracks batch error: ${r.status}`); continue }
          const d = await r.json()
          for (const t of (d.tracks || [])) if (t?.id) allTracks.push(t)
        }

        const allFeatures = []
        for (let i = 0; i < newIds.length; i += 50) {
          const batch = newIds.slice(i, i + 50)
          const r = await spotifyFetch(`https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`)
          if (!r.ok) { console.warn(`  features batch error: ${r.status}`); continue }
          const d = await r.json()
          for (const f of (d.audio_features || [])) if (f?.id) allFeatures.push(f)
        }
        const featMap = Object.fromEntries(allFeatures.map(f => [f.id, f]))

        // Fetch unique artists
        const artistIds = [...new Set(allTracks.map(t => t.artists?.[0]?.id).filter(Boolean))]
        const artistMap = {}
        for (let i = 0; i < artistIds.length; i += 50) {
          const batch = artistIds.slice(i, i + 50)
          const r = await spotifyFetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`)
          if (!r.ok) continue
          const d = await r.json()
          for (const a of (d.artists || [])) if (a?.id) artistMap[a.id] = a
        }

        // 5. Upsert to reference_tracks
        let added = 0
        for (const track of allTracks) {
          const feat = featMap[track.id]
          if (!feat) continue
          const artistId = track.artists?.[0]?.id
          const artist = artistId ? (artistMap[artistId] || {}) : {}
          const keyName = feat.key >= 0
            ? KEY_NAMES[feat.key] + (feat.mode === 1 ? ' maj' : ' min')
            : 'unknown'

          const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
            method: 'POST',
            headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              spotify_id: track.id,
              title: track.name,
              artist: track.artists.map(a => a.name).join(', '),
              album: track.album?.name,
              release_date: track.album?.release_date,
              genre_tags: artist.genres || [],
              tempo: feat.tempo ? Math.round(feat.tempo) : null,
              key: keyName,
              energy: feat.energy,
              danceability: feat.danceability,
              valence: feat.valence,
              acousticness: feat.acousticness,
              instrumentalness: feat.instrumentalness,
              loudness: feat.loudness,
              time_signature: feat.time_signature,
              popularity: track.popularity,
              artist_popularity: artist.popularity,
              artist_followers: artist.followers?.total,
              preview_url: track.preview_url,
              album_art: track.album?.images?.[0]?.url,
              collection_name: trackSources[track.id] || null,
              approved: true
            })
          })
          if (upsertRes.ok || upsertRes.status === 201) added++
        }

        console.log(`  sync-all-refs: added ${added} tracks`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, found: allIds.length, added, skipped: allIds.length - newIds.length }))
      } catch(e) {
        logError('sync-all-refs', e.message)
        console.error('sync-all-refs error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /sync-project-refs — analyze project Spotify refs → reference_tracks ─
  if (req.method === 'POST' && req.url === '/sync-project-refs') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const projectsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/projects?select=id,artist,name,project_meta`,
          { headers: sbHeaders }
        )
        const projects = await projectsRes.json().catch(() => [])

        // Collect unique Spotify track IDs from project_meta.reference_links
        const trackSources = {} // trackId -> collectionName
        for (const project of (Array.isArray(projects) ? projects : [])) {
          const refs = project.project_meta?.reference_links || []
          for (const ref of refs) {
            const url = typeof ref === 'string' ? ref : (ref.url || '')
            const m = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/)
            if (m) trackSources[m[1]] = `project_${(project.name || String(project.id)).slice(0, 40)}`
          }
        }

        const allIds = Object.keys(trackSources)
        if (!allIds.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, found: 0, added: 0, skipped: 0 }))
          return
        }

        // Skip IDs already in reference_tracks
        const existingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/reference_tracks?select=spotify_id&limit=10000`,
          { headers: sbHeaders }
        )
        const existingRows = await existingRes.json().catch(() => [])
        const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map(r => r.spotify_id))
        const newIds = allIds.filter(id => !existingIds.has(id))
        console.log(`  sync-project-refs: ${allIds.length} found, ${newIds.length} new to analyze`)

        if (!newIds.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, found: allIds.length, added: 0, skipped: allIds.length }))
          return
        }

        let added = 0
        const errors = []

        for (const trackId of newIds) {
          try {
            const trackRes = await spotifyFetch(`https://api.spotify.com/v1/tracks/${trackId}`)
            if (!trackRes.ok) throw new Error(`Spotify ${trackRes.status}`)
            const track = await trackRes.json()

            const artistId = track.artists?.[0]?.id
            const artistRes = artistId ? await spotifyFetch(`https://api.spotify.com/v1/artists/${artistId}`) : null
            const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

            let bpm = null, keyStr = null, camelot = null
            let energy = null, danceability = null, loudness = null, valence = null, brightness = null

            const tmpAudio = `/tmp/projref_${Date.now()}.mp3`
            let audioReady = false
            if (track.preview_url) {
              try { execSync(`curl -s -o "${tmpAudio}" "${track.preview_url}"`, { timeout: 15000 }); audioReady = true } catch(e) {}
            }
            if (audioReady) {
              try {
                const esOut = execSync(`"/opt/homebrew/bin/python3.11" "${path.join(__dirname, 'analyze_audio.py')}" ${shellEscape(tmpAudio)} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
                const feat = JSON.parse(esOut)
                bpm = feat.bpm; keyStr = feat.key ? `${feat.key} ${feat.scale || ''}`.trim() : null
                camelot = feat.camelot || null; energy = feat.energy; danceability = feat.danceability
                loudness = feat.loudness_lufs; valence = feat.valence; brightness = feat.brightness
              } catch(e) { console.warn('  Essentia failed:', e.message.slice(0, 50)) }
              try { fs.unlinkSync(tmpAudio) } catch(e) {}
            }

            await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                spotify_id: trackId,
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album?.name,
                release_date: track.album?.release_date,
                genre_tags: (artist.genres || []).slice(0, 5),
                collection_name: trackSources[trackId] || 'project_refs',
                source: 'agent',
                approved: true,
                tempo: bpm ? Math.round(bpm) : null,
                key: keyStr,
                camelot,
                energy,
                danceability,
                loudness,
                valence,
                brightness,
                album_art: track.album?.images?.[0]?.url || null,
                popularity: track.popularity
              })
            })
            console.log(`  ✓ sync-project-refs: ${track.name} — ${track.artists[0]?.name}`)
            added++
          } catch(e) {
            console.error('  ✗ sync-project-refs:', trackId, e.message)
            errors.push({ trackId, error: e.message })
          }
        }

        console.log(`  sync-project-refs: added ${added} tracks`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, found: allIds.length, added, skipped: allIds.length - newIds.length, errors }))
      } catch(e) {
        logError('sync-project-refs', e.message)
        console.error('sync-project-refs error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /capture-screen — Mac screencapture → Claude vision → Brain ─────
  if (req.method === 'POST' && req.url.startsWith('/capture-screen')) {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      const tmpPath = `/tmp/mm_screen_${Date.now()}.png`
      try {
        const { region, apiKey, context, category } = JSON.parse(body || '{}')
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing apiKey' })); return }

        if (region) {
          execSync(
            `screencapture -x -R${region.x},${region.y},${region.w},${region.h} "${tmpPath}"`,
            { timeout: 5000 }
          )
        } else {
          execSync(`screencapture -x "${tmpPath}"`, { timeout: 5000 })
        }

        const base64 = fs.readFileSync(tmpPath).toString('base64')
        fs.unlinkSync(tmpPath)

        const prompt = context ? `Analyze this screenshot in the context of: ${context}\n\n` : ''

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 600,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
                { type: 'text', text: prompt + `Analyze this screenshot. Extract concrete, useful observations. Plain text only. No markdown.

If this is a DAW session:
ARRANGEMENT — note structure, sections, track count
MIXING — note fader positions, plugin chains visible
SUGGESTIONS — max 2 specific actionable observations

If this is a chat/message:
FEEDBACK — extract specific requests or feedback points
ACTION ITEMS — what needs a response or action

If this is research/article/other:
KEY FACTS — specific facts, numbers, names
RELEVANCE — why this matters for music production

Format: use ALL CAPS section labels, bullet points with •` }
              ]
            }]
          })
        })

        const cd = await claudeRes.json()
        const analysis = cd.content?.[0]?.text || ''
        const inputT = cd.usage?.input_tokens || 0
        const outputT = cd.usage?.output_tokens || 0

        await fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
          method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            endpoint: '/capture-screen', model: 'claude-sonnet-4-20250514',
            input_tokens: inputT, output_tokens: outputT,
            cost_usd: (inputT * 0.000003) + (outputT * 0.000015)
          })
        })

        // Second pass: mixing suggestions if context suggests DAW/mix session
        let mixing_suggestions = []
        const ctxLower = (context || '').toLowerCase()
        const looksLikeDaw = ctxLower.includes('mix') || ctxLower.includes('daw') || ctxLower.includes('session')
          || /arrangement|track|plugin|fader|channel|compressor|eq/i.test(analysis)
        if (looksLikeDaw && apiKey) {
          try {
            const mixRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001', max_tokens: 300,
                messages: [{ role: 'user', content:
                  `Based on this DAW session analysis:\n${analysis}\n\nGive 3 specific mixing suggestions. Be concrete — mention specific frequencies, levels, or techniques. Return as a JSON array of strings, nothing else. Example: ["Boost 3kHz on vocals by 2dB", "Reduce bass below 60Hz", "Add parallel compression to drums"]\nFORMATTING: Plain text strings only, no bold, no markdown inside strings.`
                }]
              })
            })
            const mixData = await mixRes.json()
            const mixText = mixData.content?.[0]?.text || '[]'
            try {
              mixing_suggestions = JSON.parse(mixText.trim())
              if (!Array.isArray(mixing_suggestions)) mixing_suggestions = []
            } catch(e) {
              // Extract bullet lines as fallback
              mixing_suggestions = mixText.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./))
                .map(l => l.replace(/^[-\d.]\s*/, '').trim()).filter(Boolean).slice(0, 3)
            }
            if (mixData.usage) {
              fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
                method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ endpoint: '/capture-screen-mix', model: 'claude-haiku-4-5-20251001', input_tokens: mixData.usage.input_tokens, output_tokens: mixData.usage.output_tokens, cost_usd: (mixData.usage.input_tokens * 0.000001) + (mixData.usage.output_tokens * 0.000005) })
              }).catch(() => {})
            }
          } catch(e) { console.warn('Mixing suggestions failed:', e.message.slice(0, 60)) }
        }

        const fullContent = mixing_suggestions.length
          ? analysis + '\n\nMIXING NOTES:\n' + mixing_suggestions.map(s => '• ' + s).join('\n')
          : analysis

        let saved_entry_id = null
        if (category && analysis) {
          const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=representation' },
            body: JSON.stringify({
              category,
              title: `Screenshot ${new Date().toLocaleString('de-CH')}`,
              content: fullContent,
              entry_type: 'screenshot',
              active: true
            })
          })
          const inserted = await insertRes.json()
          saved_entry_id = Array.isArray(inserted) ? (inserted[0]?.id || null) : null
        }

        console.log(`✓ capture-screen: ${inputT + outputT} tokens${mixing_suggestions.length ? ' + ' + mixing_suggestions.length + ' mixing suggestions' : ''}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, analysis, mixing_suggestions, saved_entry_id, tokens: inputT + outputT }))
      } catch(e) {
        if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath) } catch(e2) {} }
        logError('capture-screen', e.message)
        console.error('capture-screen error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /analyze-chat — extract multi-entry items from WhatsApp chat ──────
  if (req.method === 'POST' && req.url.startsWith('/analyze-chat')) {
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { chatText, chatName, apiKey, existingCategories = [] } = JSON.parse(body || '{}')
        if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing apiKey' })); return }
        if (!chatText) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing chatText' })); return }

        const catList = existingCategories.length
          ? existingCategories.join(', ')
          : 'collaboration, artist_strategy, mixing_technique, production_style, market_knowledge, industry_insight, question'

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: `Extract all useful information from this WhatsApp chat for a music producer named Remo.

Extract separately:
- Action items (things to do)
- Artist mentions and context
- Feedback received on music
- Decisions made
- Interesting observations
- Questions raised

For each item return:
{
  "title": "short label max 8 words",
  "content": "verbatim relevant text or summary",
  "category": "best fit from [${catList}]",
  "entry_type": "observation|pattern|rule|reference|question",
  "confidence": "weak|medium|strong"
}

Return ONLY a JSON array. No explanation. No markdown. Start with [.

Chat from ${chatName || 'contact'}:
${chatText.slice(0, 4000)}`
            }]
          })
        })

        const cd = await claudeRes.json()
        const raw = cd.content?.[0]?.text || '[]'
        const inputT = cd.usage?.input_tokens || 0
        const outputT = cd.usage?.output_tokens || 0

        fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
          method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            endpoint: '/analyze-chat', model: 'claude-haiku-4-5-20251001',
            input_tokens: inputT, output_tokens: outputT,
            cost_usd: (inputT * 0.000001) + (outputT * 0.000005)
          })
        }).catch(() => {})

        let items = []
        try {
          const jsonStart = raw.indexOf('[')
          items = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw)
        } catch(e) {
          console.warn('analyze-chat: JSON parse failed, wrapping as single item')
          items = [{ title: `WhatsApp: ${chatName || 'chat'}`, content: raw, category: 'collaboration', entry_type: 'observation', confidence: 'medium' }]
        }

        // Normalise to pendingApproval shape expected by BrainTab
        const normalised = items.map(it => ({
          title: it.title || 'untitled',
          content: it.content || '',
          suggestedCategory: it.category || 'collaboration',
          isNewCategory: !existingCategories.includes(it.category || 'collaboration'),
          entry_type: it.entry_type || 'knowledge',
          confidence: it.confidence || 'medium'
        }))

        console.log(`✓ analyze-chat: ${normalised.length} items from ${chatName || 'chat'}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, entries: normalised, items: normalised, count: normalised.length, chatName: chatName || 'chat' }))
        setImmediate(() => brainToObsidian().catch(() => {}))
      } catch(e) {
        logError('analyze-chat', e.message)
        console.error('analyze-chat error:', e.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /launch-claude-code — open Terminal + run claude ────────────────
  if (req.method === 'POST' && req.url === '/launch-claude-code') {
    try {
      execSync(`osascript -e '
        tell application "Terminal"
          activate
          do script "cd /Users/remo/momentum && claude"
        end tell
      '`)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /launch-claude-overnight — autonomous claude with skip-permissions
  if (req.method === 'POST' && req.url === '/launch-claude-overnight') {
    try {
      execSync(`osascript -e '
        tell application "Terminal"
          activate
          do script "cd /Users/remo/momentum && claude --dangerously-skip-permissions \\"Read TASKS.md and work through all Priority tasks. Mark done with ✓. Update CHANGES.md.\\""
        end tell
      '`)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /logs — watcher_logs from Supabase (last 50, newest first) ──────────
  if (req.method === 'GET' && req.url === '/logs') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/watcher_logs?select=created_at,endpoint,message,level&order=created_at.desc&limit=50`, { headers: sbHeaders })
      const rows = await r.json()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: Array.isArray(rows) ? rows : [] }))
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [], fetchError: e.message }))
    }
    return
  }

  // ── GET /get-changes — last 30 lines of CHANGES.md ──────────────────────
  if (req.method === 'GET' && req.url === '/get-changes') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const changesPath = path.join(__dirname, 'CHANGES.md')
    try {
      const text = fs.existsSync(changesPath) ? fs.readFileSync(changesPath, 'utf8') : ''
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 30)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lines }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lines: [], error: e.message }))
    }
    return
  }

  // ── GET /get-tasks — read TASKS.md ───────────────────────────────────────
  if (req.method === 'GET' && req.url === '/get-tasks') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const tasksPath = path.join(__dirname, 'TASKS.md')
    try {
      const content = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : ''
      const stat = fs.existsSync(tasksPath) ? fs.statSync(tasksPath) : null
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ content, lastModified: stat ? stat.mtime.toISOString() : null }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── POST /seed-brain-categories — one-shot category seed ─────────────────
  if (req.method === 'POST' && req.url === '/seed-brain-categories') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const seeds = [
      { category: 'artist_strategy',  title: 'Category: artist strategy',  content: 'Frameworks for how artists build cultural relevance, fan psychology, positioning, rollout tactics' },
      { category: 'mixing_technique', title: 'Category: mixing technique',  content: 'Mixing approaches, compression, EQ, bus processing, reference workflows, loudness targets' },
      { category: 'release_strategy', title: 'Category: release strategy',  content: 'Release planning, timing, DSP strategy, pre-save campaigns, rollout phases' },
      { category: 'sound_design',     title: 'Category: sound design',      content: 'Synthesis, sampling, texture, FX design, sound selection philosophy' },
      { category: 'industry_insight', title: 'Category: industry insight',  content: 'Music industry structure, label deals, sync, publishing, A&R dynamics' },
      { category: 'social_media',     title: 'Category: social media',      content: 'Platform tactics, content strategy, algorithm behaviour, TikTok Instagram YouTube' },
      { category: 'own_production',   title: 'Category: own production',    content: 'Remos own tracks, productions, versions, BPM key status notes' },
      { category: 'networking',       title: 'Category: networking',        content: 'Contacts, relationships, collaboration opportunities, industry connections' },
      { category: 'creative_process', title: 'Category: creative process',  content: 'Songwriting, arrangement, workflow, creative blocks, inspiration sources' },
      { category: 'business_finance', title: 'Category: business finance',  content: 'Revenue, budgets, costs, royalties, financial planning for music' },
    ]
    try {
      let inserted = 0, skipped = 0
      for (const s of seeds) {
        const check = await fetch(
          `${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.${encodeURIComponent(s.category)}&title=eq.${encodeURIComponent(s.title)}&select=id&limit=1`,
          { headers: sbHeaders }
        ).then(r => r.json()).catch(() => [])
        if (Array.isArray(check) && check.length) { skipped++; continue }
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ ...s, entry_type: 'knowledge', active: true })
        })
        inserted++
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, inserted, skipped }))
    } catch(err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: err.message }))
    }
    return
  }

  // ── POST /track-cost — insert row into api_usage ─────────────────────────
  if (req.method === 'POST' && req.url === '/track-cost') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { endpoint, model, input_tokens, output_tokens, cost_usd } = JSON.parse(body)
        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbHeaders = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }
        await fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ endpoint, model, input_tokens: input_tokens || 0, output_tokens: output_tokens || 0, cost_usd: cost_usd || 0 })
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /get-env-keys — return masked API keys from .env ─────────────────
  if (req.method === 'GET' && req.url === '/get-env-keys') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const envPath = path.join(__dirname, '.env')
      const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
      const parse = (key) => {
        const m = envText.match(new RegExp(`^${key}=(.+)$`, 'm'))
        return m ? m[1].trim() : ''
      }
      const mask = (val) => val.length > 4 ? '••••' + val.slice(-4) : (val ? '••••' : '')
      const anthropic = parse('ANTHROPIC_API_KEY')
      const openai = parse('OPENAI_API_KEY')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ANTHROPIC_API_KEY: mask(anthropic),
        OPENAI_API_KEY: mask(openai),
        ANTHROPIC_API_KEY_RAW: anthropic,
        OPENAI_API_KEY_RAW: openai
      }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── POST /save-env-key — write/replace a key in .env ─────────────────────
  if (req.method === 'POST' && req.url === '/save-env-key') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { key, value } = JSON.parse(body || '{}')
        if (!key || !/^[A-Z_]+$/.test(key)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid key name' }))
          return
        }
        const envPath = path.join(__dirname, '.env')
        let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
        const line = `${key}=${value || ''}`
        const regex = new RegExp(`^${key}=.*$`, 'm')
        if (regex.test(envText)) {
          envText = envText.replace(regex, line)
        } else {
          envText = envText.trimEnd() + (envText ? '\n' : '') + line + '\n'
        }
        fs.writeFileSync(envPath, envText, 'utf8')
        // Reload into process.env for immediate effect
        if (value) process.env[key] = value
        else delete process.env[key]
        console.log(`✓ .env updated: ${key}=${value ? '(set)' : '(cleared)'}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /save-tasks — write TASKS.md ────────────────────────────────────
  if (req.method === 'POST' && req.url === '/save-tasks') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body)
        const tasksPath = path.join(__dirname, 'TASKS.md')
        fs.writeFileSync(tasksPath, content || '', 'utf8')
        console.log('save-tasks: TASKS.md written')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /status — merged status + health ─────────────────────────────────
  if (req.method === 'GET' && (req.url === '/status' || req.url === '/system-status')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const data = await buildStatusResponse()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch(e) {
      logError('/status', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── GET /health — comprehensive system health check ──────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const checks = {}
      const issues = []

      // Supabase connectivity
      const { data: sbCheck, error: sbErr } = await supabase.from('brain_knowledge').select('id').limit(1)
      checks.supabase = sbErr ? 'fail' : 'ok'
      if (sbErr) issues.push('supabase: ' + sbErr.message)

      // Brain entries count
      const { count: brainCount } = await supabase.from('brain_knowledge').select('id', { count: 'exact', head: true }).eq('active', true)
      checks.brain_entries = brainCount || 0
      if (brainCount < 10) issues.push('brain_knowledge: only ' + brainCount + ' active entries')

      // Songs count
      const { count: songCount } = await supabase.from('songs').select('id', { count: 'exact', head: true })
      checks.songs = songCount || 0

      // Reference tracks
      const { count: refCount } = await supabase.from('reference_tracks').select('id', { count: 'exact', head: true })
      checks.reference_tracks = refCount || 0

      // Unread inbox notifications
      const { count: inboxCount } = await supabase.from('inbox_notifications').select('id', { count: 'exact', head: true }).eq('read', false)
      checks.unread_inbox = inboxCount || 0

      // Music Tips file
      const tipsPath = '/Users/remo/ObsidianVault/Momentum/🎵 MUSIC TIPS MASTER.md'
      const tipsExists = fs.existsSync(tipsPath)
      checks.music_tips_file = tipsExists ? fs.statSync(tipsPath).size : 0
      if (!tipsExists) issues.push('Music Tips MASTER.md missing — run /rebuild-music-tips')

      // Obsidian vault accessible
      checks.obsidian_vault = fs.existsSync(OBSIDIAN_VAULT_PATH) ? 'ok' : 'missing'
      if (checks.obsidian_vault === 'missing') issues.push('Obsidian vault not found at ' + OBSIDIAN_VAULT_PATH)

      // API keys present
      checks.anthropic_key = !!process.env.ANTHROPIC_API_KEY
      checks.spotify_credentials = !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET)
      if (!checks.anthropic_key) issues.push('ANTHROPIC_API_KEY not set')

      // Background queue size
      checks.bg_queue = processingQueue.length

      const healthy = issues.length === 0
      checks.healthy = healthy
      checks.issues = issues
      checks.checked_at = new Date().toISOString()

      res.writeHead(healthy ? 200 : 207, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(checks))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ healthy: false, error: e.message }))
    }
    return
  }

  // ── GET /find-whatsapp-db ─────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/find-whatsapp-db') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    exec('find /Users/remo/Library -name "*.sqlite" -path "*[Ww]hats*[Aa]pp*" 2>/dev/null', (err, stdout) => {
      const paths = stdout.trim().split('\n').filter(Boolean)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, paths, current: whatsappDbPath }))
    })
    return
  }

  // ── POST /setup-whatsapp ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/setup-whatsapp') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { dbPath } = JSON.parse(body || '{}')
        const targetPath = dbPath || WHATSAPP_DB_PATH

        if (!Database) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: 'better-sqlite3 not installed' })); return }
        if (!fs.existsSync(targetPath)) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'DB not found: ' + targetPath })); return }

        // Test read and return table names
        const db = new Database(targetPath, { readonly: true, fileMustExist: true })
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
        const sampleCount = db.prepare("SELECT COUNT(*) as c FROM ZWAMESSAGE WHERE ZTEXT IS NOT NULL").get()?.c || 0
        db.close()

        whatsappDbPath = targetPath
        lastWhatsAppCheck = Date.now() - 3600000 // Unix ms — 1 hour ago
        console.log('✓ WhatsApp DB set:', whatsappDbPath)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: targetPath, tables, message_count: sampleCount }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /whatsapp-contacts — list contacts from WhatsApp DB ─────────────────
  if (req.method === 'GET' && req.url === '/whatsapp-contacts') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      if (!Database) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: 'better-sqlite3 not available' })); return }
      const dbPath = whatsappDbPath || WHATSAPP_DB_PATH
      if (!fs.existsSync(dbPath)) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'WhatsApp DB not found' })); return }

      const db = new Database(dbPath, { readonly: true, fileMustExist: true })
      // JOIN push names in one query — WhatsApp profile name takes priority over ZPARTNERNAME
      const rows = db.prepare(`
        SELECT DISTINCT
          cs.ZPARTNERNAME AS partner_name,
          cs.ZCONTACTJID  AS jid,
          pp.ZPUSHNAME    AS push_name
        FROM ZWACHATSESSION cs
        LEFT JOIN ZWAPROFILEPUSHNAME pp ON cs.ZCONTACTJID = pp.ZJID
        WHERE cs.ZPARTNERNAME IS NOT NULL AND cs.ZPARTNERNAME != ''
        ORDER BY cs.ZPARTNERNAME
      `).all()
      db.close()

      // Build address book map: last9digits → full name (cached 10 min)
      const abMap = buildAddressBookMap()

      const looksLikePhone = (name) => /^\+?[\d\s\-().]+$/.test(name?.trim())

      // Build contact list: push_name > address book > partner_name
      const contacts = rows.map(r => {
        const isGroup = r.jid?.includes('@g.us') || false
        const phone = r.jid.includes('@s.whatsapp.net') ? r.jid.split('@')[0].replace(/\D/g, '') : null
        const last9 = phone?.slice(-9) || null
        const contacts_name = (last9 && abMap.get(last9)) || null
        const name = isGroup ? (r.partner_name || r.jid) : (r.push_name || contacts_name || r.partner_name)
        return {
          name,
          partner_name: r.partner_name,
          push_name: r.push_name || null,
          contacts_name: contacts_name || null,
          jid: r.jid,
          is_group: isGroup
        }
      })

      // Deduplicate by JID — prefer entry where partner_name is a real name
      const seen = new Map()
      for (const c of contacts) {
        const existing = seen.get(c.jid)
        if (!existing) {
          seen.set(c.jid, c)
        } else {
          const currentIsPhone = /^\+?\d+$/.test(c.partner_name || '')
          const existingIsPhone = /^\+?\d+$/.test(existing.partner_name || '')
          if (existingIsPhone && !currentIsPhone) seen.set(c.jid, c)
        }
      }
      const deduped = Array.from(seen.values())

      const monitored = getWaContacts().map(c => c.toLowerCase())
      for (const c of deduped) {
        c.monitored = monitored.some(mc => c.name.toLowerCase().includes(mc))
      }

      // Sort: named contacts first (not raw phones), then alphabetically
      deduped.sort((a, b) => {
        const aPhone = looksLikePhone(a.name)
        const bPhone = looksLikePhone(b.name)
        if (aPhone !== bPhone) return aPhone ? 1 : -1
        return a.name.localeCompare(b.name)
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, contacts: deduped, monitored_list: getWaContacts().join(',') }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /whatsapp-add-contact ────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/whatsapp-add-contact') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { contact, remove } = JSON.parse(body || '{}')
        if (!contact?.trim()) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing contact' })); return }
        const name = contact.trim()
        const current = getWaContacts()

        let updated
        if (remove) {
          updated = current.filter(c => c.toLowerCase() !== name.toLowerCase())
        } else {
          if (current.some(c => c.toLowerCase() === name.toLowerCase())) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, message: `Already monitoring ${name}`, contacts: current }))
            return
          }
          updated = [...current, name]
        }

        setWaContacts(updated)
        const msg = remove ? `Stopped monitoring ${name}` : `Now monitoring ${name}`
        console.log(`✓ whatsapp-contacts.json updated: ${updated.join(',')}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: msg, contacts: updated }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /whatsapp-remove-contact ────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/whatsapp-remove-contact') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { contact } = JSON.parse(body || '{}')
        if (!contact?.trim()) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing contact' })); return }
        const name = contact.trim()
        const current = getWaContacts()
        const updated = current.filter(c => c.toLowerCase() !== name.toLowerCase())
        setWaContacts(updated)
        console.log(`✓ whatsapp-contacts.json updated: ${updated.join(',')}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, message: `Stopped monitoring ${name}`, contacts: updated }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /whatsapp-backfill ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/whatsapp-backfill')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (!whatsappDbPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'WhatsApp DB not connected. POST /setup-whatsapp first.' }))
      return
    }
    ;(async () => {
      try {
        const params = new URLSearchParams(req.url.split('?')[1] || '')
        const hours = parseInt(params.get('hours') || '24', 10)
        const backfillSince = Date.now() - (hours * 3600000)

        const allMsgs = readWhatsAppMessages(whatsappDbPath, backfillSince)
        if (!allMsgs.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, processed: 0, contacts: [], message: `No messages in last ${hours}h` }))
          return
        }

        // Group by contact JID
        const byContact = {}
        for (const msg of allMsgs) {
          const key = msg.contact || 'unknown'
          const displayName = msg.partner_name || msg.contact?.split('@')[0] || 'unknown'
          if (!byContact[key]) byContact[key] = { contact: displayName, jid: msg.contact, msgs: [] }
          byContact[key].msgs.push(msg)
        }

        // Filter to monitored contacts
        const monitoredContacts = getWaContacts().map(c => c.toLowerCase())
        let entries = Object.values(byContact)
        if (monitoredContacts.length > 0) {
          entries = entries.filter(({ contact }) =>
            monitoredContacts.some(mc => contact.toLowerCase().includes(mc))
          )
        }

        const processed = []
        for (const { contact, jid, msgs } of entries) {
          if (jid.includes('@status')) continue
          const history = msgs.map(m => (m.is_from_me ? 'Remo' : contact) + ': ' + m.text).join('\n')
          const lastMsg = msgs[msgs.length - 1]?.text || ''
          if (history.length <= 20) continue

          // Group chats — save to inbox without AI analysis
          if (jid.includes('@g.us')) {
            await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                type: 'message',
                song_title: `Group: ${contact}`,
                message: lastMsg.slice(0, 500),
                patch_name: 'Backfill',
                read: false,
                metadata: { from: contact, platform: 'whatsapp', is_group: true, urgency: 'low' }
              })
            }).catch(() => {})
            processed.push({ contact, messages: msgs.length, urgency: 'low', boundary: false, is_group: true })
            continue
          }

          try {
            const { analysis, usage } = await analyzeArtistMessage(contact, history, lastMsg)

            // Upsert contact profile
            const existingProfile = await fetch(
              `${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.contact_profile&title=eq.Profile%3A%20${encodeURIComponent(contact)}&limit=1`,
              { headers: sbHeaders }
            ).then(r => r.json()).catch(() => [])
            const profileContent = (analysis.profile_update || '') + '\n\nLast contact: ' + new Date().toLocaleDateString()
            if (existingProfile[0]?.id) {
              await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?id=eq.${existingProfile[0].id}`, {
                method: 'PATCH',
                headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ content: profileContent })
              }).catch(() => {})
            } else {
              await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                  category: 'contact_profile', title: 'Profile: ' + contact,
                  content: profileContent, entry_type_v2: 'knowledge',
                  confidence: 'medium', source_type: 'whatsapp_backfill', active: true
                })
              }).catch(() => {})
            }

            // Save to inbox
            await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                type: 'message',
                song_title: `WhatsApp: ${contact}`,
                message: lastMsg.slice(0, 500),
                patch_name: 'Backfill',
                read: false,
                metadata: {
                  from: contact, platform: 'whatsapp',
                  real_intent: analysis.real_intent,
                  psychological_state: analysis.psychological_state,
                  boundary_alert: analysis.boundary_alert,
                  boundary_type: analysis.boundary_type,
                  best_next_step: analysis.best_next_step,
                  response_suggestion: analysis.response_suggestion,
                  urgency: analysis.urgency,
                  business_assessment: analysis.business_assessment
                }
              })
            }).catch(() => {})

            // Track cost
            await fetch(`http://127.0.0.1:${PORT}/track-cost`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                endpoint: 'whatsapp-backfill',
                model: 'claude-sonnet-4-20250514',
                input_tokens: usage?.input_tokens || 0,
                output_tokens: usage?.output_tokens || 0,
                cost_usd: ((usage?.input_tokens || 0) * 0.000003) + ((usage?.output_tokens || 0) * 0.000015)
              })
            }).catch(() => {})

            processed.push({
              contact, messages: msgs.length,
              urgency: analysis.urgency || 'low',
              boundary: !!analysis.boundary_alert,
              next_step: analysis.best_next_step
            })
          } catch(e) { console.warn(`Backfill error for ${contact}:`, e.message) }
        }

        // Telegram summary
        if (processed.length) {
          const highUrgency = processed.filter(p => p.urgency === 'high')
          const boundaries = processed.filter(p => p.boundary)
          let summary = `📱 WhatsApp backfill (${hours}h) — ${processed.length} contact${processed.length > 1 ? 's' : ''} analyzed\n\n`
          if (boundaries.length) summary += `🚨 Boundary alerts: ${boundaries.map(p => p.contact).join(', ')}\n`
          if (highUrgency.length) summary += `⚡ High urgency: ${highUrgency.map(p => p.contact).join(', ')}\n`
          summary += processed.map(p => `• ${p.contact} (${p.messages} msgs, ${p.urgency})`).join('\n')
          await sendTelegram(TELEGRAM_OWNER_ID, summary).catch(() => {})
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, processed: processed.length, contacts: processed, hours }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })()
    return
  }

  // ── GET /cultural-timing — genre trends + reddit + release timing ────────
  if (req.method === 'GET' && req.url === '/cultural-timing') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const data = await fetchCulturalTiming()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...data }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /spotify-auth — redirect to Spotify OAuth consent page ──────────
  if (req.method === 'GET' && req.url === '/spotify-auth') {
    console.log('DEBUG: spotify-auth hit')
    const scopes = 'playlist-read-private playlist-read-collaborative'
    const authUrl = 'https://accounts.spotify.com/authorize?' +
      'client_id=' + SPOTIFY_CLIENT_ID +
      '&response_type=code' +
      '&redirect_uri=' + encodeURIComponent('http://127.0.0.1:4242/spotify-callback') +
      '&scope=' + encodeURIComponent(scopes)
    res.writeHead(302, { Location: authUrl })
    res.end()
    return
  }

  // ── GET /spotify-callback — exchange code for user token ─────────────────
  if (req.method === 'GET' && req.url.startsWith('/spotify-callback')) {
    try {
      const code = new URL('http://x' + req.url).searchParams.get('code')
      if (!code) { res.writeHead(400); res.end('Missing code'); return }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://127.0.0.1:4242/spotify-callback'
      })

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET
          ).toString('base64')
        },
        body: body.toString()
      })

      const tokenData = await tokenRes.json()
      console.log('OAuth token response:', JSON.stringify(tokenData))

      if (tokenData.access_token) {
        spotifyUserToken = tokenData.access_token
        spotifyUserRefresh = tokenData.refresh_token || null
        saveSpotifyToken(tokenData.access_token, tokenData.refresh_token || null, tokenData.expires_in || 3600)
        console.log('✓ User OAuth token saved, scope:', tokenData.scope)
      } else {
        console.error('✗ OAuth token exchange failed:', tokenData)
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0a0a0a;color:#c9a84c;font-family:monospace;padding:40px">✓ Spotify connected! Scope: ' + (tokenData.scope || 'none') + '<br>Close this tab.</body></html>')
    } catch(e) {
      console.error('spotify-callback error:', e.message)
      res.writeHead(500)
      res.end('Error: ' + e.message)
    }
    return
  }

  // ── GET /spotify-status — rate limit + token health ──────────────────────
  if (req.method === 'GET' && req.url === '/spotify-status') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      rate_limited: Date.now() < spotifyRateLimitUntil,
      rate_limit_until: spotifyRateLimitUntil ? new Date(spotifyRateLimitUntil).toISOString() : null,
      seconds_remaining: Math.max(0, Math.ceil((spotifyRateLimitUntil - Date.now()) / 1000)),
      call_count: spotifyCallCount,
      user_token: !!spotifyUserToken,
      queue_size: processingQueue?.length || 0
    }))
    return
  }

  // ── GET /ping ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/ping') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }))
    return
  }

  // ── GET /chart-health — verify chart data sources have recent entries ──────
  if (req.method === 'GET' && req.url === '/chart-health') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const checks = {}
    try {
      const { data: tiktok } = await supabaseAdmin.from('reference_tracks').select('id').eq('collection_name', 'tiktok_trending').order('created_at', { ascending: false }).limit(1)
      checks.tiktok = tiktok?.length ? 'ok' : 'empty'
    } catch(e) { checks.tiktok = 'error: ' + e.message }
    try {
      const { data: spotify } = await supabaseAdmin.from('reference_tracks').select('id').eq('collection_name', 'daily_chart').order('created_at', { ascending: false }).limit(1)
      checks.spotify_chart = spotify?.length ? 'ok' : 'empty'
    } catch(e) { checks.spotify_chart = 'error: ' + e.message }
    try {
      const { data: history } = await supabaseAdmin.from('chart_history').select('id').order('created_at', { ascending: false }).limit(1)
      checks.chart_history = history?.length ? 'ok' : 'empty'
    } catch(e) { checks.chart_history = 'error: ' + e.message }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, checks }))
    return
  }

  // ── POST /watcher-stop ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/watcher-stop') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, message: 'Watcher stopping...' }))
    require('child_process').exec('pm2 stop momentum-watcher')
    return
  }

  // ── GET /processing-queue — background track processing status ───────────
  if (req.method === 'GET' && req.url === '/processing-queue') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, queued: processingQueue.length, processing: isProcessing, next: processingQueue[0] ? (processingQueue[0].artist + ' — ' + processingQueue[0].title) : null }))
    return
  }

  // ── POST /fetch-credits — fetch Genius credits for a track ────────────────
  if (req.method === 'POST' && req.url === '/fetch-credits') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const { title, artist, reference_track_id } = body
        if (!title || !artist) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'title and artist required' })); return }
        const credits = await fetchGeniusCredits(artist, title)
        if (credits && reference_track_id) {
          const { error: gcErr } = await supabase.from('reference_tracks').update({ credits }).eq('id', reference_track_id)
          if (gcErr) console.error('genius-credits update failed:', reference_track_id, gcErr.message)
          else console.log('✓ genius credits saved for track', reference_track_id)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, credits }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /fix-brain-titles — strip duplicate date prefixes from titles ──────
  if (req.method === 'POST' && req.url === '/fix-brain-titles') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const { data: rows, error: fetchErr } = await supabaseAdmin
        .from('brain_knowledge')
        .select('id, title')
        .like('title', '%-%-%\\_%-%-%\\_%')
      if (fetchErr) throw new Error(fetchErr.message)
      let fixed = 0
      for (const row of rows || []) {
        const cleaned = (row.title || '').replace(/^(\d{4}-\d{2}-\d{2}_)+/, '').trim()
        if (cleaned !== row.title) {
          const { error: ftErr } = await supabaseAdmin.from('brain_knowledge').update({ title: cleaned }).eq('id', row.id)
          if (ftErr) console.error('fix-brain-titles update failed:', row.id, ftErr.message)
          else fixed++
        }
      }
      console.log(`✓ fix-brain-titles: ${fixed} entries fixed`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, fixed, checked: rows?.length || 0 }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /cleanup-brain-dupes — smart dedup: protect locked+text, merge agents ─
  if (req.method === 'POST' && req.url === '/cleanup-brain-dupes') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const result = await mergeDupes()
      console.log(`✓ cleanup-brain-dupes: deleted ${result.deleted}, merged ${result.merged}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...result }))
    } catch(e) {
      console.error('cleanup-brain-dupes error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /consolidate-brain-categories — merge deprecated categories → artist_strategy ─
  if (req.method === 'POST' && req.url === '/consolidate-brain-categories') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const result = await consolidateBrainCategories()
      console.log(`✓ consolidate-brain-categories: moved ${result.moved} entries → ${result.target}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...result }))
    } catch(e) {
      console.error('consolidate-brain-categories error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /fix-inbox-dupes — keep only latest briefing per day ───────────────
  if (req.method === 'POST' && req.url === '/fix-inbox-dupes') {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/inbox_notifications?type=eq.briefing&select=id,created_at&order=created_at.desc`,
        { headers: sbHeaders }
      )
      const briefings = await r.json()
      const seen = new Set()
      const toDelete = []
      for (const b of (Array.isArray(briefings) ? briefings : [])) {
        const day = (b.created_at || '').slice(0, 10)
        if (seen.has(day)) {
          toDelete.push(b.id)
        } else {
          seen.add(day)
        }
      }
      if (toDelete.length) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/inbox_notifications?id=in.(${toDelete.join(',')})`,
          { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
        )
      }
      console.log(`✓ fix-inbox-dupes: deleted ${toDelete.length} duplicate briefing(s)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, deleted: toDelete.length }))
    } catch(e) {
      console.error('fix-inbox-dupes error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /fix-obsidian-dupes — deduplicate .md files by normalized title ────
  if (req.method === 'POST' && req.url === '/fix-obsidian-dupes') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const deleted = []
      const norm = (s) => s.toLowerCase().replace(/^(\d{4}-\d{2}-\d{2}_)+/, '').replace(/[^a-z0-9]/g, '').slice(0, 40)
      // Walk vault recursively, skip MOC/ and Notes/
      const walk = (dir) => {
        let results = []
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch(e) { return results }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (e.name === 'MOC' || e.name === 'Notes' || e.name === '.git') continue
            results = results.concat(walk(full))
          } else if (e.name.endsWith('.md')) {
            results.push(full)
          }
        }
        return results
      }
      const allFiles = walk(OBSIDIAN_VAULT_PATH)
      // Group by dir + normalized basename
      const groups = {}
      for (const f of allFiles) {
        const key = path.dirname(f) + '|' + norm(path.basename(f, '.md'))
        if (!groups[key]) groups[key] = []
        groups[key].push(f)
      }
      for (const [, files] of Object.entries(groups)) {
        if (files.length < 2) continue
        // Prefer file without date prefix; otherwise keep newest by mtime
        files.sort((a, b) => {
          const aHasDate = /^\d{4}-\d{2}-\d{2}_/.test(path.basename(a))
          const bHasDate = /^\d{4}-\d{2}-\d{2}_/.test(path.basename(b))
          if (!aHasDate && bHasDate) return -1
          if (aHasDate && !bHasDate) return 1
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
        })
        const [keep, ...dupes] = files
        for (const dupe of dupes) {
          try { fs.unlinkSync(dupe); deleted.push(dupe) } catch(e) { console.warn('fix-obsidian-dupes unlink error:', e.message) }
        }
        console.log(`✓ kept ${path.basename(keep)}, deleted ${dupes.length} dupe(s)`)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, deleted: deleted.length, files: deleted }))
    } catch(e) {
      console.error('fix-obsidian-dupes error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /rebuild-brain-master — manually rebuild BRAIN DUMP MASTER.md ─────
  if (req.method === 'POST' && req.url === '/rebuild-brain-master') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      await rebuildBrainMaster()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /rebuild-music-tips — synthesize Music Tips master + finishing checklist ─
  if (req.method === 'POST' && req.url === '/rebuild-music-tips') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      await rebuildMusicTips()
      const tipsPath = '/Users/remo/ObsidianVault/Momentum/🎵 MUSIC TIPS MASTER.md'
      const written = require('fs').existsSync(tipsPath)
      const size = written ? require('fs').statSync(tipsPath).size : 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, written, path: tipsPath, size }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /rebuild-finishing-checklist — extract finishing questions from tips ──
  if (req.method === 'POST' && req.url === '/rebuild-finishing-checklist') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const checklist = await rebuildFinishingChecklist()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, count: checklist.length }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /enrich-library-genres — fetch Spotify genres for tracks missing them ──
  if (req.method === 'POST' && req.url === '/enrich-library-genres') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, message: 'Genre enrichment started in background' }))
    setImmediate(async () => {
      try {
        const { data: tracks } = await supabaseAdmin
          .from('reference_tracks')
          .select('id, spotify_id, artist, title, genres')
          .not('spotify_id', 'is', null)
          .in('source', ['user', 'agent', 'mozart', 'promoted'])
          .order('created_at', { ascending: false })
          .limit(200)
        if (!tracks?.length) return
        const missing = tracks.filter(t => !t.genres?.length)
        console.log(`enrich-library-genres: ${missing.length} tracks missing genres`)
        let enriched = 0
        for (const track of missing) {
          const genres = await fetchTrackGenres(track.spotify_id)
          if (genres.length) {
            const { error: elGnErr } = await supabaseAdmin.from('reference_tracks').update({ genres }).eq('id', track.id)
            if (elGnErr) console.error('enrich-library-genres update failed:', track.title, elGnErr.message)
            else { console.log('  ✓', track.artist, '—', track.title, ':', genres.slice(0, 3).join(', ')); enriched++ }
          }
          await new Promise(r => setTimeout(r, 3000))
        }
        console.log(`enrich-library-genres: done — ${enriched}/${missing.length} enriched`)
      } catch(e) { console.error('enrich-library-genres error:', e.message) }
    })
    return
  }

  // ── GET /notes — read all notes from Obsidian/Notes/ ─────────────────────────
  if (req.method === 'GET' && req.url === '/notes') {
    try {
      const nowNote = parseNowNote()
      const regularNotes = readNotesDir()
      const notes = nowNote ? [nowNote, ...regularNotes] : regularNotes
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, notes, lastSync: appleNotesLastSync }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /notes — create note in Obsidian + Apple Notes ──────────────────────
  if (req.method === 'POST' && req.url === '/notes') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.title) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'title required' })); return }
        if (!fs.existsSync(NOTES_PATH)) fs.mkdirSync(NOTES_PATH, { recursive: true })
        const filename = noteToFilename(body.title)
        const existingNotes = readNotesDir()
        const nextPos = existingNotes.length
        writeNoteFile(path.join(NOTES_PATH, filename), { content: body.content || '', position: nextPos })
        createAppleNote(body.title, body.content || '', 'Notes').catch(() => {})
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── PATCH /notes — update note content or rename ──────────────────────────────
  if (req.method === 'PATCH' && req.url === '/notes') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.filename) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'filename required' })); return }
        const oldPath = path.join(NOTES_PATH, body.filename)
        let filename = body.filename
        let title = body.filename.replace(/\.md$/, '')
        // Rename: create new file, delete old
        // Read existing position before any rename/overwrite
        let existingPosition = null
        if (fs.existsSync(oldPath)) {
          const { fm } = parseFrontmatter(fs.readFileSync(oldPath, 'utf8'))
          if (fm.position !== undefined) existingPosition = parseInt(fm.position, 10)
        }
        if (body.title && noteToFilename(body.title) !== body.filename) {
          filename = noteToFilename(body.title)
          title = body.title
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
        }
        writeNoteFile(path.join(NOTES_PATH, filename), { content: body.content ?? '', position: existingPosition })
        updateAppleNote(title, body.content ?? '', 'Notes').catch(() => {})
        // NOW.md: reset 30s extract timer on every save
        if (filename === 'NOW.md') {
          clearTimeout(nowExtractTimer)
          nowExtractTimer = setTimeout(async () => {
            try {
              await extractNowEntries(body.content ?? '')
              console.log('NOW auto-extracted to brain')
            } catch(e) { console.error('NOW extract error:', e.message) }
          }, 30000)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── DELETE /notes — delete note file (Apple Note left intact) ─────────────────
  if (req.method === 'DELETE' && req.url === '/notes') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.filename) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'filename required' })); return }
        const fp = path.join(NOTES_PATH, body.filename)
        if (fs.existsSync(fp)) fs.unlinkSync(fp)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /notes/reorder — swap positions of two adjacent notes ───────────────
  if (req.method === 'POST' && req.url === '/notes/reorder') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.filename || body.direction === undefined) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'filename and direction required' })); return
        }
        const all = readNotesDir()
        const idx = all.findIndex(n => n.filename === body.filename)
        const swapIdx = idx + body.direction
        if (idx < 0 || swapIdx < 0 || swapIdx >= all.length) {
          res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
        }
        // Assign explicit positions to all notes if any are unpositioned
        const needsInit = all.some(n => n.position === null)
        if (needsInit) {
          for (let i = 0; i < all.length; i++) all[i].position = i
        }
        // Swap positions
        const posA = all[idx].position
        const posB = all[swapIdx].position
        all[idx].position = posB
        all[swapIdx].position = posA
        // Write both files preserving content
        for (const n of [all[idx], all[swapIdx]]) {
          const fp = path.join(NOTES_PATH, n.filename)
          if (fs.existsSync(fp)) {
            writeNoteFile(fp, { content: n.content, position: n.position, source: n.source || 'momentum' })
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /apple-notes — return raw Apple Notes list ───────────────────────────
  if (req.method === 'GET' && req.url === '/apple-notes') {
    try {
      const notes = await getAppleNotes('Notes')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, notes, lastSync: appleNotesLastSync, count: notes.length }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /apple-notes-sync — sync Apple Notes → Obsidian/Notes/ ──────────────
  if (req.method === 'POST' && req.url === '/apple-notes-sync') {
    try {
      const result = await syncAppleNotesToObsidian()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...result, lastSync: appleNotesLastSync }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /now — read NOW.md content ───────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/now') {
    try {
      if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) fs.mkdirSync(OBSIDIAN_VAULT_PATH, { recursive: true })
      const content = fs.existsSync(NOW_PATH) ? fs.readFileSync(NOW_PATH, 'utf8') : ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, content }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /now — save NOW.md, schedule extraction ─────────────────────────────
  if (req.method === 'POST' && req.url === '/now') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const content = body.content ?? ''
        if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) fs.mkdirSync(OBSIDIAN_VAULT_PATH, { recursive: true })
        fs.writeFileSync(NOW_PATH, content, 'utf8')
        try { fs.writeFileSync(path.join(BRAIN_FILES_PATH, 'NOW.md'), content, 'utf8') } catch(e) {}
        // Debounced extraction — 30s after last edit
        clearTimeout(nowExtractTimer)
        nowExtractTimer = setTimeout(() => {
          extractNowEntries(content).catch(e => console.error('now extract error:', e.message))
        }, 30000)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /now/extract — manual extract NOW.md → brain_knowledge immediately ──
  if (req.method === 'POST' && req.url === '/now/extract') {
    try {
      const content = fs.existsSync(NOW_PATH) ? fs.readFileSync(NOW_PATH, 'utf8') : ''
      if (!content.trim()) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, count: 0 }))
        return
      }
      clearTimeout(nowExtractTimer) // cancel any pending auto-extract
      const result = await extractNowEntries(content)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, count: result.count }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /obsidian-sync — sync all .md files from Obsidian vault to brain ──
  if (req.method === 'POST' && req.url === '/obsidian-sync') {
    try {
      if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) {
        res.writeHead(200); res.end(JSON.stringify({ ok: true, synced: 0, message: 'Vault not found' })); return
      }
      const files = fs.readdirSync(OBSIDIAN_VAULT_PATH).filter(f => f.endsWith('.md'))
      for (const f of files) await syncObsidianFile(path.join(OBSIDIAN_VAULT_PATH, f))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, synced: files.length }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /brain-to-obsidian — export brain_knowledge entries as .md files ──
  if (req.method === 'GET' && req.url === '/brain-to-obsidian') {
    try {
      const result = await brainToObsidian()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...result }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /enrich-contact — auto-find social profiles by artist name ────────
  if (req.method === 'POST' && req.url === '/enrich-contact') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.name) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'name required' })); return }
        const enriched = await enrichContact(body.name)
        if (!enriched.instagram && enriched.instagram_guess) {
          enriched.instagram = enriched.instagram_guess
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, ...enriched }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /enrich-all-contacts — bulk enrich all connections ─────────────────
  if (req.method === 'POST' && req.url === '/enrich-all-contacts') {
    try {
      const connRes = await fetch(
        `${SUPABASE_URL}/rest/v1/connections?select=id,name,instagram,tiktok,spotify_id&order=id`,
        { headers: sbHeaders }
      )
      const connections = await connRes.json()

      const results = []
      for (const conn of connections || []) {
        if (conn.instagram && conn.tiktok && conn.spotify_id) {
          results.push({ name: conn.name, status: 'already complete' })
          continue
        }
        try {
          const enriched = await enrichContact(conn.name)
          if (!enriched.instagram && enriched.instagram_guess) {
            enriched.instagram = enriched.instagram_guess
          }
          const updates = {}
          if (!conn.instagram && enriched.instagram) updates.instagram = enriched.instagram
          if (!conn.tiktok && enriched.tiktok) updates.tiktok = enriched.tiktok
          if (!conn.spotify_id && enriched.spotify_id) updates.spotify_id = enriched.spotify_id
          if (enriched.ig_followers) updates.ig_followers = enriched.ig_followers
          if (enriched.tiktok_followers) updates.tiktok_followers = enriched.tiktok_followers
          if (enriched.spotify_followers) updates.spotify_followers = enriched.spotify_followers

          if (Object.keys(updates).length > 0) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/connections?id=eq.${conn.id}`,
              { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' }, body: JSON.stringify(updates) }
            )
            results.push({ name: conn.name, status: 'enriched', found: Object.keys(updates).join(', ') })
          } else {
            results.push({ name: conn.name, status: 'nothing found' })
          }
          await new Promise(r => setTimeout(r, 1000))
        } catch(e) {
          results.push({ name: conn.name, status: 'error: ' + e.message })
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, processed: results.length, results }))
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /fetch-instagram — scrape public Instagram profile ────────────────
  if (req.method === 'POST' && req.url === '/fetch-instagram') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!body.handle) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'handle required' })); return }
        const profile = await fetchInstagramProfile(body.handle)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, profile }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /brain-dump — save free text directly to brain_knowledge ──────────
  if (req.method === 'POST' && req.url === '/brain-dump') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const text = body.text || ''
        if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'text required' })); return }
        const entry = {
          category: body.category || 'observation',
          title: text.slice(0, 60),
          content: text,
          entry_type_v2: 'observation',
          confidence: 'weak',
          source_type: body.source || 'external',
          active: true
        }
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(entry)
        })
        setImmediate(() => saveBrainFile(entry).catch(() => {}))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /save-brain-file — thin wrapper: write entry to Dropbox/Brain + Obsidian ──
  if (req.method === 'POST' && req.url === '/save-brain-file') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const entry = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        const filepath = await saveBrainFile(entry)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filepath }))
        setImmediate(() => rebuildBrainMaster().catch(() => {}))
        const MUSIC_TIPS_CATS = new Set(['creative_process', 'mixing_technique', 'production_style', 'sound_design', 'observation', 'question'])
        if (MUSIC_TIPS_CATS.has(entry.category)) {
          setImmediate(() => rebuildMusicTips().catch(() => {}))
        }
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /speicherbox — list stored speicherbox entries ──────────────────
  if (req.method === 'GET' && req.url === '/speicherbox') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const { data } = await supabase
        .from('brain_knowledge')
        .select('*')
        .eq('category', 'speicherbox')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(100)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, items: data || [] }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /save-speicherbox-file — save base64 file to disk + brain ───────
  if (req.method === 'POST' && req.url === '/save-speicherbox-file') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const speicherboxDir = '/Users/remo/Dropbox/!MOMENTUM MUSIC/Brain/speicherbox'
        if (!fs.existsSync(speicherboxDir)) fs.mkdirSync(speicherboxDir, { recursive: true })
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 16)
        const safeOrigName = (data.originalName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
        const filename = timestamp + '_' + safeOrigName
        const filePath = path.join(speicherboxDir, filename)
        const buffer = Buffer.from(data.fileData, 'base64')
        fs.writeFileSync(filePath, buffer)
        const { error: spbErr } = await supabase.from('brain_knowledge').insert({
          category: 'speicherbox',
          title: (data.originalName || 'file') + ' — ' + new Date().toLocaleDateString('de-CH'),
          content: data.extractedText || '',
          active: true,
          metadata: JSON.stringify({
            file_path: filePath,
            file_type: data.fileType || '',
            original_name: data.originalName || '',
            stored_name: filename,
            thumbnail: data.thumbnail || null
          })
        })
        if (spbErr) console.error('speicherbox brain insert failed:', data.originalName, spbErr.message)
        else console.log('✓ speicherbox saved:', filename)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, stored: filename, path: filePath }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /open-file — open a local file with macOS default app ───────────
  if (req.method === 'POST' && req.url === '/open-file') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', () => {
      try {
        const { path: filePath } = JSON.parse(body)
        if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No path' })); return }
        exec('open "' + filePath.replace(/"/g, '\\"') + '"')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /connect-brain-entries — manual trigger for brain connection finder ──
  if (req.method === 'POST' && req.url === '/connect-brain-entries') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    try {
      const result = await connectBrainEntries()
      res.writeHead(result.ok ? 200 : 500)
      res.end(JSON.stringify(result))
    } catch(e) {
      res.writeHead(500)
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /brain-file-upload — multipart upload to Dropbox/Brain/uploads + Obsidian ──
  if (req.method === 'POST' && req.url === '/brain-file-upload') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const form = formidable({ maxFileSize: 50 * 1024 * 1024, keepExtensions: true })
    form.parse(req, async (err, fields, files) => {
      if (err) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: err.message })); return }
      try {
        const fileObj = Array.isArray(files.file) ? files.file[0] : files.file
        if (!fileObj) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No file' })); return }
        const originalName = fileObj.originalFilename || fileObj.newFilename
        const uploadsDir = path.join(BRAIN_FILES_PATH, 'uploads')
        fs.mkdirSync(uploadsDir, { recursive: true })
        const destPath = path.join(uploadsDir, originalName)
        fs.copyFileSync(fileObj.filepath, destPath)
        // Mirror to Obsidian Attachments
        const obsAttachDir = path.join(OBSIDIAN_VAULT_PATH, 'Attachments')
        fs.mkdirSync(obsAttachDir, { recursive: true })
        fs.copyFileSync(fileObj.filepath, path.join(obsAttachDir, originalName))
        fs.unlinkSync(fileObj.filepath)
        // Brain entry
        const note = (Array.isArray(fields.note) ? fields.note[0] : fields.note) || ''
        const title = originalName
        const entry = {
          category: 'observation',
          title,
          content: note || `File upload: ${originalName}`,
          confidence: 'weak',
          source_type: 'file_upload',
          active: true
        }
        await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(entry)
        })
        setImmediate(() => saveBrainFile(entry).catch(() => {}))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, filename: originalName, path: destPath }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /migrate-my-refs-to-library — one-time: source='user' → 'agent' ──
  if (req.method === 'POST' && req.url === '/migrate-my-refs-to-library') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const { data, error } = await supabaseAdmin
        .from('reference_tracks')
        .update({ source: 'agent' })
        .eq('source', 'user')
        .select('id')
      if (error) throw new Error(error.message)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, migrated: data?.length || 0 }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /seed-production-rules ───────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/seed-production-rules') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const result = await seedProductionRules()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...result }))
      setImmediate(() => brainToObsidian().catch(() => {}))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── POST /generate-version-narrative ─────────────────────────────────────
  if (req.method === 'POST' && req.url === '/generate-version-narrative') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { song_id } = JSON.parse(body || '{}')
        if (!song_id) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'song_id required' })); return }
        const songRes = await fetch(
          `${SUPABASE_URL}/rest/v1/songs?id=eq.${song_id}&select=id,title,code,work_data&limit=1`,
          { headers: sbHeaders }
        )
        const songRows = await songRes.json()
        const song = songRows[0]
        if (!song) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'Song not found' })); return }

        const versions = song.work_data?.versions || []
        const narrative = await generateVersionNarrative(song, versions)

        if (narrative) {
          const mixVersions = versions
            .filter(v => v.version_type === 'mixing')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          const lastV = mixVersions[0]
          await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              category: 'own_production',
              title: 'Mixing journey: ' + (song.title || song.code),
              content: narrative +
                '\n\nVersions: ' + mixVersions.length +
                (lastV?.analysis?.loudness_lufs ? '\nFinal LUFS: ' + lastV.analysis.loudness_lufs : ''),
              confidence: 'medium',
              source_type: 'version_history',
              entry_type_v2: 'knowledge',
              active: true
            })
          }).catch(() => {})
          setImmediate(() => brainToObsidian().catch(() => {}))
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, narrative }))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── GET /crypto-signal ────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/crypto-signal') {
    try {
      const [signal, binancePortfolio] = await Promise.all([buildCryptoSignal(), fetchBinancePortfolio()])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...signal, binance_portfolio: binancePortfolio }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /coingecko-trending ───────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/coingecko-trending') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const [trending, global] = await Promise.all([getCoinGeckoTrending(), getCoinGeckoGlobal()])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ...trending, global }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /polymarket-signals ───────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/polymarket-signals') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      const markets = await getPolymarketSignals()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, markets }))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  // ── GET /all-coin-prices ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/all-coin-prices') {
    try {
      const prices = await fetchAllCoinPrices()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(prices))
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // ── POST /save-brain-entry — insert a brain_knowledge row directly ──────────
  if (req.method === 'POST' && req.url === '/save-brain-entry') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')

        // Special case: import a Spotify track to reference_tracks checkout
        if (body.action === 'save_spotify_ref') {
          const { spotify_id, song_id, source } = body
          if (!spotify_id) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing spotify_id' })); return }
          const importRes = await fetch('http://localhost:4242/agent-import-spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'spotify:track:' + spotify_id, collection: 'reference_current', source: source || 'mozart_chat' })
          })
          const imp = await importRes.json()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: imp.ok, id: imp.id, title: imp.title, artist: imp.artist }))
          return
        }

        // Standard brain_knowledge insert
        const entry = {
          category: body.category || 'observation',
          title: (body.title || body.content || '').slice(0, 120),
          content: body.content || body.title || '',
          entry_type_v2: body.entry_type_v2 || 'observation',
          confidence: body.confidence || 'medium',
          source_type: body.source_type || 'text',
          active: body.active !== false,
          metadata: body.metadata || {}
        }
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify(entry)
        })
        const rows = await insertRes.json()
        const id = Array.isArray(rows) && rows[0]?.id

        if (entry.source_type === 'text') setImmediate(() => rebuildBrainMaster())

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, id }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /mozart-action — execute a Mozart tool_use action ──────────────────
  if (req.method === 'POST' && req.url === '/mozart-action') {
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { action, payload } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        let result = ''

        if (action === 'add_project_reference') {
          // Auto-enrich with Spotify if no spotify_id yet
          if (!payload.spotify_id && payload.title) {
            const sp = await fetchSpotifyId(payload.title, payload.artist)
            if (sp) {
              payload.spotify_id = sp.spotify_id
              payload.title      = sp.title
              payload.artist     = sp.artist
              payload.popularity = sp.popularity
              console.log('[mozart] Spotify enriched:', payload.title, payload.spotify_id)
            }
          }

          // Save to reference_tracks checkout
          if (payload.spotify_id) {
            saveToCheckout({
              spotify_id: payload.spotify_id,
              title: payload.title,
              artist: payload.artist,
              collection_name: 'project_reference',
              approved: true,
              popularity: payload.popularity || null
            }).catch(() => {})
          }

          // Resolve project by name, payload.project_id, or most recent
          let proj = null
          if (payload.project_name) {
            const { data: found } = await supabase
              .from('projects')
              .select('id, name, reference_links')
              .ilike('name', '%' + payload.project_name + '%')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            proj = found
          }
          if (!proj && payload.project_id) {
            const { data: byId } = await supabase
              .from('projects')
              .select('id, name, reference_links')
              .eq('id', payload.project_id)
              .maybeSingle()
            proj = byId
          }
          if (!proj) {
            const { data: latest } = await supabase
              .from('projects')
              .select('id, name, reference_links')
              .neq('status', 'archived')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            proj = latest
            if (proj) console.log('[mozart] fallback to latest project:', proj.name)
          }

          if (!proj) {
            console.error('[mozart] add_project_reference: no project found, payload:', JSON.stringify(payload))
            result = '✗ No project found — provide project_id or project_name'
          } else {
            const normTrack = (t, a) =>
              ((a || '') + (t || '')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)

            let refs = Array.isArray(proj.reference_links) ? proj.reference_links : []
            const newKey = normTrack(payload.title, payload.artist)
            const alreadyExists = refs.find(r =>
              (payload.spotify_id && r.spotify_id === payload.spotify_id) ||
              normTrack(r.title, r.artist) === newKey
            )

            if (alreadyExists) {
              console.log('[mozart] duplicate reference skipped:', payload.title)
              result = `✓ "${payload.title} — ${payload.artist}" already in project references`
            } else {
              const refId = (payload.artist + '_' + payload.title).replace(/\s+/g, '_').toLowerCase()
              refs.push({
                id: refId,
                title: payload.title,
                artist: payload.artist,
                spotify_id: payload.spotify_id || null,
                ref_type: payload.ref_type || 'music',
                added_by: 'mozart',
                added_at: new Date().toISOString(),
                url: payload.spotify_id
                  ? 'https://open.spotify.com/track/' + payload.spotify_id
                  : null,
                name: (payload.artist || '') + ' — ' + (payload.title || '')
              })

              const { error: updateErr } = await supabase
                .from('projects')
                .update({ reference_links: refs })
                .eq('id', proj.id)

              if (updateErr) {
                console.error('[mozart] project ref update error:', updateErr.message)
                result = '✗ DB write failed: ' + updateErr.message
              } else {
                console.log('[mozart] ✓ added reference', payload.title, 'to project', proj.name)
                result = `✓ Added "${payload.title} — ${payload.artist}" to project "${proj.name}"`
              }
            }
          }

        } else if (action === 'add_brain_entry') {
          const entry = {
            category: payload.category || 'observation',
            title: (payload.title || payload.content || '').slice(0, 80),
            content: payload.content || payload.title,
            entry_type_v2: 'observation',
            confidence: payload.confidence || 'medium',
            source_type: 'mozart',
            active: true
          }
          await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
            method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(entry)
          })
          result = `✓ Saved to brain (${entry.category}): "${entry.title}"`
          setImmediate(() => rebuildBrainMaster())

        } else if (action === 'add_inbox_task') {
          await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
            method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              type: 'task',
              song_code: payload.song_code || null,
              song_title: payload.song_title || null,
              message: payload.message || payload.title,
              read: false
            })
          })
          result = `✓ Task added to inbox: "${payload.title || payload.message}"`

        } else if (action === 'set_version_feedback') {
          const songRes = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${payload.song_id}&select=work_data`, { headers: sbHeaders })
          const [song] = await songRes.json()
          const wd = song?.work_data || {}
          const versions = Array.isArray(wd.versions) ? wd.versions : []
          const ver = versions.find(v => v.label === payload.version_label || v.version === payload.version_label)
          if (ver) {
            ver.feedback = payload.feedback
            await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${payload.song_id}`, {
              method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ work_data: wd })
            })
            result = `✓ Feedback saved to version "${payload.version_label}"`
          } else {
            result = `✗ Version "${payload.version_label}" not found`
          }

        } else if (action === 'update_now_note') {
          fs.writeFileSync(NOW_PATH, payload.content || '', 'utf8')
          result = '✓ NOW note updated'

        } else if (action === 'add_contact_note') {
          const connRes = await fetch(
            `${SUPABASE_URL}/rest/v1/connections?name=ilike.${encodeURIComponent('%' + payload.name + '%')}&select=id,name,notes&limit=1`,
            { headers: sbHeaders }
          )
          const conns = await connRes.json()
          const conn = Array.isArray(conns) && conns[0]
          if (conn) {
            const existing = conn.notes ? conn.notes + '\n' : ''
            const ts = new Date().toISOString().slice(0, 10)
            const updated = existing + `[${ts}] ${payload.note}`
            await fetch(`${SUPABASE_URL}/rest/v1/connections?id=eq.${conn.id}`, {
              method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ notes: updated })
            })
            result = `✓ Note added to contact "${conn.name}"`
          } else {
            result = `✗ Contact "${payload.name}" not found`
          }

        } else {
          result = `✗ Unknown action: ${action}`
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // ── POST /fix-song-refs — migrate work_data.reference_links → reference_links column ─
  if (req.method === 'POST' && req.url === '/fix-song-refs') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    const chunks = []; req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const { song_id } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        if (!song_id) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing song_id' })); return }

        const { data: song, error: fetchErr } = await supabase
          .from('songs').select('reference_links, work_data').eq('id', song_id).single()
        if (fetchErr) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: fetchErr.message })); return }

        const normTrack = (t, a) =>
          ((a || '') + (t || '')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)

        const colRefs = Array.isArray(song.reference_links) ? song.reference_links : []
        const wdRefs  = Array.isArray(song.work_data?.reference_links) ? song.work_data.reference_links : []

        // Merge: start with column refs, add work_data refs that aren't already present
        const merged = [...colRefs]
        for (const r of wdRefs) {
          const exists = merged.find(x =>
            (r.spotify_id && x.spotify_id === r.spotify_id) ||
            normTrack(x.title, x.artist) === normTrack(r.title, r.artist)
          )
          if (!exists) merged.push(r)
        }

        // Filter test entries + dedup
        const filtered = merged.filter(r =>
          (r.artist || '').toLowerCase() !== 'test artist' &&
          (r.title  || '').toLowerCase() !== 'test track'
        )
        const seen = new Map()
        const cleaned = []
        for (const ref of filtered) {
          const key = normTrack(ref.title, ref.artist)
          if (!seen.has(key)) { seen.set(key, cleaned.length); cleaned.push(ref) }
          else if (ref.spotify_id && !cleaned[seen.get(key)]?.spotify_id) cleaned[seen.get(key)] = ref
        }

        // Write to reference_links column
        const { error: colErr } = await supabase.from('songs')
          .update({ reference_links: cleaned }).eq('id', song_id)
        if (colErr) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: colErr.message })); return }

        // Clear work_data.reference_links
        const wd = song.work_data || {}
        delete wd.reference_links
        const { error: wdErr } = await supabase.from('songs')
          .update({ work_data: wd }).eq('id', song_id)
        if (wdErr) console.warn('[fix-song-refs] work_data clear failed:', wdErr.message)

        console.log(`[fix-song-refs] song ${song_id}: merged ${colRefs.length} col + ${wdRefs.length} wd → ${cleaned.length} refs`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, col_before: colRefs.length, wd_before: wdRefs.length, after: cleaned.length, refs: cleaned }))
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  res.writeHead(404); res.end()
})

// ── Mac AddressBook lookup (cached) ──────────────────────────────────────────
let _abMapCache = null
let _abMapTime  = 0
let _abMapBuilding = false
const AB_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function buildAddressBookMap() {
  if (_abMapCache && (Date.now() - _abMapTime) < AB_CACHE_TTL) return _abMapCache
  if (_abMapBuilding) return _abMapCache || new Map()

  _abMapBuilding = true
  const map = new Map()

  if (Database) {
    // Collect all AddressBook DB paths to try
    const abBase = path.join(os.homedir(), 'Library', 'Application Support', 'AddressBook')
    const candidates = []
    const rootDb = path.join(abBase, 'AddressBook-v22.abcddb')
    if (fs.existsSync(rootDb)) candidates.push(rootDb)
    // Sources — scan if permitted, fall back to env var
    try {
      const sourcesDir = path.join(abBase, 'Sources')
      for (const sub of fs.readdirSync(sourcesDir)) {
        const p = path.join(sourcesDir, sub, 'AddressBook-v22.abcddb')
        try { if (fs.statSync(p).isFile()) candidates.push(p) } catch(e) {}
      }
    } catch(e) {
      for (const p of (process.env.ADDRESSBOOK_SOURCES || '').split(',').filter(Boolean)) {
        try { if (fs.statSync(p.trim()).isFile()) candidates.push(p.trim()) } catch(e2) {}
      }
    }

    for (const dbPath of candidates) {
      try {
        const ab = new Database(dbPath, { readonly: true, fileMustExist: true })
        const rows = ab.prepare(`
          SELECT
            COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '') AS full_name,
            p.ZFULLNUMBER AS phone
          FROM ZABCDRECORD r
          JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
          WHERE p.ZFULLNUMBER IS NOT NULL AND p.ZFULLNUMBER != ''
        `).all()
        ab.close()
        for (const row of rows) {
          const name = row.full_name.trim()
          if (!name) continue
          const digits = row.phone.replace(/\D/g, '')
          if (digits.length < 7) continue
          const key = digits.slice(-9)
          if (!map.has(key)) map.set(key, name)
        }
      } catch(e) { /* db locked or no access — skip */ }
    }
  }

  _abMapCache = map
  _abMapTime  = Date.now()
  _abMapBuilding = false
  return map
}

// ── Apple Notes integration ───────────────────────────────────────────────────
let appleNotesLastSync = null

function parseAppleScriptList(stdout) {
  // JXA returns JSON directly — this is a fallback for raw AppleScript output
  const raw = stdout.trim()
  if (!raw || raw === '{}' || raw === '') return []
  try { return JSON.parse(raw) } catch(e) {}
  // Best-effort: extract name/id pairs from AppleScript record output
  const results = []
  const recordRe = /\{[^{}]*name:"([^"]*)"[^{}]*id:"([^"]*)"/g
  let m
  while ((m = recordRe.exec(raw)) !== null) results.push({ name: m[1], id: m[2], body: '', modificationDate: null })
  return results
}

async function getAppleNotes(folderName = 'Notes') {
  return new Promise((resolve) => {
    const script = `
      var app = Application('Notes');
      var result = [];
      try {
        var folders = app.folders.whose({name: "${folderName}"});
        if (folders.length > 0) {
          var ns = folders[0].notes();
          for (var i = 0; i < ns.length; i++) {
            try {
              result.push({
                name: ns[i].name(),
                body: ns[i].plaintext(),
                id: ns[i].id(),
                modificationDate: ns[i].modificationDate().toISOString()
              });
            } catch(e) {}
          }
        }
      } catch(e) {}
      JSON.stringify(result);
    `
    exec(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`,
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(parseAppleScriptList(stdout || '')); return }
        try { resolve(JSON.parse(stdout.trim())) }
        catch(e) { resolve(parseAppleScriptList(stdout || '')) }
      }
    )
  })
}

async function createAppleNote(title, body, folderName = 'Notes') {
  return new Promise((resolve) => {
    const tmpFile = '/tmp/apple_note_body.txt'
    const htmlBody = textToAppleNotesHtml(body)
    fs.writeFileSync(tmpFile, htmlBody, 'utf8')
    const safeTitle = title.replace(/"/g, '\\"').replace(/'/g, "'\\''")
    const safeFolder = folderName.replace(/"/g, '\\"')
    const script = `
      tell application "Notes"
        tell account "iCloud"
          try
            set targetFolder to folder "${safeFolder}"
          on error
            set targetFolder to make new folder with properties {name:"${safeFolder}"}
          end try
          set noteBody to (read POSIX file "/tmp/apple_note_body.txt" as «class utf8»)
          make new note at targetFolder with properties {name:"${safeTitle}", body:noteBody}
        end tell
      end tell
    `
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, () => resolve(true))
  })
}

async function updateAppleNote(title, body, folderName = 'Notes') {
  return new Promise((resolve) => {
    const tmpFile = '/tmp/apple_note_body.txt'
    const htmlBody = textToAppleNotesHtml(body)
    fs.writeFileSync(tmpFile, htmlBody, 'utf8')
    const safeTitle = title.replace(/"/g, '\\"').replace(/'/g, "'\\''")
    const safeFolder = folderName.replace(/"/g, '\\"')
    const script = `
      tell application "Notes"
        set noteBody to (read POSIX file "/tmp/apple_note_body.txt" as «class utf8»)
        tell account "iCloud"
          try
            set targetFolder to folder "${safeFolder}"
            set matchingNotes to notes of targetFolder whose name is "${safeTitle}"
            if length of matchingNotes > 0 then
              set body of item 1 of matchingNotes to noteBody
            end if
          end try
        end tell
      end tell
    `
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, () => resolve(true))
  })
}

function textToAppleNotesHtml(text) {
  if (!text) return ''
  return text
    .split('\n')
    .map(line => {
      if (line.trim() === '') return '<br>'
      if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        return '<div>' + line.trim().slice(2)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
      }
      return '<div>' + line
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
    })
    .join('')
}

function noteToFilename(title) {
  return title.replace(/[^a-zA-Z0-9 ]/g, '').trim() + '.md'
}

// Extract knowledge entries from NOW.md content → brain_knowledge (source_type: now_note)
// Does NOT modify NOW.md. Checks for duplicate titles before inserting.
async function extractNowEntries(content) {
  if (!content || content.trim().length < 20) return { count: 0 }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { console.warn('extractNowEntries: no ANTHROPIC_API_KEY'); return { count: 0 } }

  const prompt = `You are extracting knowledge entries from a music producer's stream-of-consciousness notes (a "NOW" note — raw thoughts, ideas, observations written freely).

Extract distinct knowledge items worth saving to a brain database. Each item should be self-contained and actionable or insightful on its own.

For each item return JSON:
{"title":"short label max 8 words","content":"verbatim or concise summary","category":"one of: own_production,reference_current,reference_mixing,reference_inspiration,reference_sound,market_knowledge,genre_strategy,artist_strategy,production_style,correction,question,mixing_technique,release_strategy,sound_design,industry_insight,social_media,networking,creative_process,business_finance","entry_type":"observation|pattern|rule|reference|question","confidence":"weak|medium|strong"}

Only extract items with clear informational value. Skip vague fragments, filler text, or incomplete thoughts.
Return ONLY a JSON array. No explanation. No markdown. Start with [.

NOW note content:
${content.slice(0, 5000)}`

  let items = []
  try {
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    })
    const cd = await cr.json()
    const raw = cd.content?.[0]?.text || '[]'
    const jsonStart = raw.indexOf('[')
    items = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw)
  } catch(e) {
    console.error('extractNowEntries: Claude call failed:', e.message)
    return { count: 0 }
  }

  if (!Array.isArray(items) || !items.length) return { count: 0 }

  let saved = 0
  for (const it of items) {
    if (!it.title) continue
    try {
      // Deduplicate by title + source_type
      const existing = await fetch(
        `${SUPABASE_URL}/rest/v1/brain_knowledge?title=eq.${encodeURIComponent(it.title)}&source_type=eq.now_note&select=id&limit=1`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => [])
      if (Array.isArray(existing) && existing.length) continue // already saved

      await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          title: it.title,
          content: it.content || '',
          category: it.category || 'own_production',
          entry_type_v2: it.entry_type || 'observation',
          confidence: it.confidence || 'medium',
          source_type: 'now_note',
          active: true,
          metadata: { extracted_from: 'NOW.md', extracted_at: new Date().toISOString() }
        })
      })
      saved++
    } catch(e) { console.warn('extractNowEntries: insert failed:', e.message) }
  }
  console.log(`✓ NOW extract: ${saved} new entries saved to brain_knowledge`)
  return { count: saved }
}

function pushVaultToGit() {
  exec(
    'cd /Users/remo/ObsidianVault/Momentum && git add -A && git commit -m "brain export" && git push origin main',
    (err, stdout, stderr) => {
      if (err) console.error('vault git push error:', err.message)
      else console.log('✓ vault pushed to GitHub')
    }
  )
}

function ensureNowNote() {
  if (!fs.existsSync(NOTES_PATH)) fs.mkdirSync(NOTES_PATH, { recursive: true })
  if (!fs.existsSync(NOW_PATH)) {
    writeNoteFile(NOW_PATH, { content: "What's on my mind right now\n\n", position: -1, source: 'momentum' })
    console.log('✓ NOW.md created')
  }
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/)
  if (!match) return { fm: {}, body: raw.trim() }
  const fm = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return { fm, body: match[2].trim() }
}

function writeNoteFile(filepath, { content, position, source = 'momentum' }) {
  const posLine = position !== null && position !== undefined ? `position: ${position}\n` : ''
  fs.writeFileSync(filepath, `---\nsource: ${source}\n${posLine}updated: ${new Date().toISOString()}\n---\n\n${content}`, 'utf8')
}

function parseNowNote() {
  if (!fs.existsSync(NOW_PATH)) return null
  const raw = fs.readFileSync(NOW_PATH, 'utf8')
  const stat = fs.statSync(NOW_PATH)
  const { body } = parseFrontmatter(raw)
  return { title: 'NOW', content: body, filename: 'NOW.md', updated: stat.mtime.toISOString(), position: -1, source: 'momentum', isNow: true }
}

function readNotesDir() {
  if (!fs.existsSync(NOTES_PATH)) return []
  const notes = fs.readdirSync(NOTES_PATH)
    .filter(f => f.endsWith('.md') && f !== 'NOW.md')
    .map(f => {
      const fp = path.join(NOTES_PATH, f)
      const raw = fs.readFileSync(fp, 'utf8')
      const stat = fs.statSync(fp)
      const { fm, body } = parseFrontmatter(raw)
      const position = fm.position !== undefined ? parseInt(fm.position, 10) : null
      return {
        title: f.replace(/\.md$/, ''),
        content: body,
        filename: f,
        updated: stat.mtime.toISOString(),
        position,
        source: fm.source || 'momentum'
      }
    })
  const positioned = notes.filter(n => n.position !== null).sort((a, b) => a.position - b.position)
  const unpositioned = notes.filter(n => n.position === null).sort((a, b) => new Date(b.updated) - new Date(a.updated))
  return [...positioned, ...unpositioned]
}

async function syncAppleNotesToObsidian() {
  if (!fs.existsSync(NOTES_PATH)) fs.mkdirSync(NOTES_PATH, { recursive: true })
  const appleNotes = await getAppleNotes('Notes')
  let synced = 0
  for (const note of appleNotes) {
    try {
      const filename = noteToFilename(note.name)
      const filepath = path.join(NOTES_PATH, filename)
      // Preserve existing position if file already exists
      let existingPosition = null
      if (fs.existsSync(filepath)) {
        const { fm } = parseFrontmatter(fs.readFileSync(filepath, 'utf8'))
        if (fm.position !== undefined) existingPosition = parseInt(fm.position, 10)
      }
      writeNoteFile(filepath, { content: note.body, position: existingPosition, source: 'apple_notes' })
      synced++
    } catch(e) { console.error('notes sync error:', note.name, e.message) }
  }
  appleNotesLastSync = new Date().toISOString()
  return { synced, total: appleNotes.length }
}

// ── Apple Notes reconciliation — delete local files for notes removed in Mac ─
async function reconcileNotes() {
  if (!fs.existsSync(NOTES_PATH)) return { deleted: 0 }
  const appleNotes = await getAppleNotes('Notes')
  // Bail if Apple Notes returned nothing — could be an error, don't wipe files
  if (!appleNotes.length) return { deleted: 0 }

  const appleFilenames = new Set(appleNotes.map(n => noteToFilename(n.name)))
  const localFiles = fs.readdirSync(NOTES_PATH).filter(f => f.endsWith('.md') && f !== 'NOW.md')

  let deleted = 0
  for (const filename of localFiles) {
    if (appleFilenames.has(filename)) continue
    const fp = path.join(NOTES_PATH, filename)
    try {
      const { fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'))
      // Only remove files that originated from Apple Notes
      // Leave momentum-created notes intact (they may not have synced to Apple yet)
      if (fm.source === 'apple_notes') {
        fs.unlinkSync(fp)
        console.log('Notes reconcile: removed', filename, '(deleted from Apple Notes)')
        deleted++
      }
    } catch(e) { console.warn('reconcileNotes: error processing', filename, e.message) }
  }
  if (deleted > 0) console.log(`✓ reconcileNotes: removed ${deleted} deleted note(s)`)
  return { deleted }
}

// ── Contact enrichment — auto-find social profiles by artist name ────────────
async function fetchCulturalTiming() {
  const results = { google_trends: [], reddit_sounds: [], release_timing: {} }
  const { execFile } = require('child_process')
  const os = require('os')
  const path_mod = require('path')
  const fs_mod = require('fs')

  // 1. Google Trends via pytrends
  try {
    const terms = ['dark pop', 'afrobeats', 'reggaeton', 'hyperpop', 'phonk', 'melodic techno', 'house music', 'emo rap']
    const trendScript = `
import json, sys
try:
    from pytrends.request import TrendReq
    pt = TrendReq(hl='en-US', tz=360)
    kw = ${JSON.stringify(terms.slice(0, 5))}
    pt.build_payload(kw, timeframe='today 3-m')
    df = pt.interest_over_time()
    last = df.tail(1).to_dict('records')[0] if not df.empty else {}
    clean = {k: int(v) for k, v in last.items() if k != 'isPartial'}
    print(json.dumps(clean))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`
    const tmpScript = path_mod.join(os.tmpdir(), `trends_${Date.now()}.py`)
    fs_mod.writeFileSync(tmpScript, trendScript)
    const trendsData = await new Promise(resolve => {
      execFile('/opt/homebrew/bin/python3.11', [tmpScript], { timeout: 20000 }, (err, stdout) => {
        try { fs_mod.unlinkSync(tmpScript) } catch(e) {}
        try { resolve(JSON.parse(stdout || '{}')) } catch { resolve({}) }
      })
    })
    const sorted = Object.entries(trendsData)
      .filter(([k, v]) => typeof v === 'number')
      .sort(([, a], [, b]) => b - a)
    results.google_trends = sorted.map(([term, value]) => ({ term, value }))
  } catch(e) {
    console.error('trends error:', e.message)
  }

  // 2. Reddit music communities
  try {
    for (const sub of ['WeAreTheMusicMakers', 'hiphopheads']) {
      const r = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=10`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!r.ok) continue
      const d = await r.json()
      const posts = (d.data?.children || []).map(p => ({ title: p.data.title, score: p.data.score, subreddit: sub }))
      results.reddit_sounds.push(...posts)
    }
    results.reddit_sounds.sort((a, b) => b.score - a.score)
    results.reddit_sounds = results.reddit_sounds.slice(0, 10)
  } catch(e) {
    console.error('reddit error:', e.message)
  }

  // 3. Release timing guidance
  const today = new Date()
  const dayName = today.toLocaleDateString('en', { weekday: 'long' })
  results.release_timing = {
    best_day: 'Friday',
    discovery_weekly_refresh: 'Monday',
    release_radar_refresh: 'Friday',
    editorial_pitch_deadline: '7 days before release',
    current_day: dayName,
    tip: today.getDay() === 5
      ? 'Today is Friday — optimal release day'
      : today.getDay() === 1
      ? 'Today is Monday — Discover Weekly just refreshed, good for pitching'
      : 'Next optimal release: this Friday'
  }

  return results
}

function buildVocalProfile(analysis) {
  if (!analysis.vocal_pitch_mean) return null

  const pitch = analysis.vocal_pitch_mean
  const range = analysis.vocal_pitch_range || 0

  let vocalRange
  if (pitch < 165) vocalRange = 'deep bass/baritone'
  else if (pitch < 220) vocalRange = 'baritone/low tenor'
  else if (pitch < 294) vocalRange = 'tenor/low alto'
  else if (pitch < 392) vocalRange = 'alto/mezzo-soprano'
  else if (pitch < 523) vocalRange = 'soprano/high'
  else vocalRange = 'very high soprano'

  const warmth = analysis.warmth ?? 0.5
  const timbre = warmth > 0.6 ? 'warm/dark' : warmth > 0.4 ? 'neutral' : 'bright/thin'
  const expressiveness = range > 200 ? 'highly expressive' : range > 100 ? 'moderately expressive' : 'controlled/monotone'
  const vibratoVal = analysis.vibrato_presence ?? 0
  const vibrato = vibratoVal > 0.6 ? 'strong vibrato' : vibratoVal > 0.3 ? 'subtle vibrato' : 'straight tone'

  return {
    pitch_hz: pitch,
    vocal_range: vocalRange,
    timbre,
    expressiveness,
    vibrato,
    recommendations: [
      pitch < 250
        ? 'Keep 150-400Hz clear — their fundamental sits here'
        : 'Keep 250-600Hz clear — their fundamental sits here',
      warmth > 0.5
        ? 'Avoid overly bright pads — will clash with warm vocal'
        : 'Can use warmer pads — will complement thin vocal',
      range > 150
        ? 'Leave dynamic room — they use full range, don\'t compress too hard'
        : 'Can use denser production — their delivery is controlled',
      vibratoVal > 0.4
        ? 'Avoid slow LFO modulation on synths — will clash with natural vibrato'
        : 'Slow vibrato on synths works well with straight delivery',
      (analysis.energy ?? 0) > 0.7
        ? 'High energy vocal — match with driving rhythm and clear attack'
        : 'Softer delivery — support with space and reverb, not density'
    ]
  }
}

async function enrichContact(name) {
  const results = {
    instagram: null, tiktok: null, spotify_id: null,
    spotify_followers: null, spotify_genres: null,
    ig_followers: null, ig_bio: null,
    tiktok_followers: null, tiktok_likes: null
  }

  // 1. Search Spotify for artist
  try {
    const res = await spotifyFetch(
      'https://api.spotify.com/v1/search?q=' + encodeURIComponent(name) + '&type=artist&limit=1'
    )
    const d = await res.json()
    const artist = d.artists?.items?.[0]
    if (artist && artist.name.toLowerCase() === name.toLowerCase()) {
      results.spotify_id = artist.id
      results.spotify_followers = artist.followers?.total
      results.spotify_genres = artist.genres?.slice(0, 3)
    }
  } catch(e) {}

  // 2. Search Instagram via web
  try {
    const cleanName = name.toLowerCase().replace(/\s+/g, '')
    const variations = [cleanName, cleanName + 'music', cleanName + 'official']
    for (const username of variations) {
      const res = await fetch('https://www.instagram.com/' + username + '/', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (res.ok) {
        const html = await res.text()
        const followers = html.match(/"edge_followed_by":\{"count":(\d+)\}/)
        const bio = html.match(/<meta property="og:description" content="([^"]+)"/)
        if (followers) {
          results.instagram = '@' + username
          results.ig_followers = parseInt(followers[1])
          results.ig_bio = bio?.[1] || null
          break
        }
      }
    }
  } catch(e) {}

  // 3. Search TikTok via web
  try {
    const cleanName = name.toLowerCase().replace(/\s+/g, '')
    const res = await fetch('https://www.tiktok.com/@' + cleanName, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (res.ok) {
      const html = await res.text()
      const followers = html.match(/"followerCount":(\d+)/)
      const likes = html.match(/"heartCount":(\d+)/)
      if (followers) {
        results.tiktok = '@' + cleanName
        results.tiktok_followers = parseInt(followers[1])
        results.tiktok_likes = likes ? parseInt(likes[1]) : null
      }
    }
  } catch(e) {}

  // If TikTok handle found but no Instagram: guess same handle on Instagram
  if (results.tiktok && !results.instagram) {
    results.instagram_guess = results.tiktok
  }

  return results
}

// ── Instagram profile scraper ────────────────────────────────────────────────
async function fetchInstagramProfile(handle) {
  const clean = handle.replace(/^@/, '').replace(/.*instagram\.com\//, '').split('/')[0]
  const url = 'https://www.instagram.com/' + clean + '/?__a=1&__d=dis'

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    const data = await res.json()
    const user = data.graphql?.user || data.data?.user
    if (!user) throw new Error('No user data')

    return {
      username: user.username,
      full_name: user.full_name,
      followers: user.edge_followed_by?.count,
      following: user.edge_follow?.count,
      bio: user.biography,
      posts: user.edge_owner_to_timeline_media?.count,
      verified: user.is_verified,
      profile_pic: user.profile_pic_url_hd
    }
  } catch(e) {
    // Fallback: scrape HTML
    const res2 = await fetch('https://www.instagram.com/' + clean + '/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const html = await res2.text()

    const followers = html.match(/"edge_followed_by":\{"count":(\d+)\}/)
    const bio = html.match(/<meta property="og:description" content="([^"]+)"/)
    const name = html.match(/<meta property="og:title" content="([^"]+)"/)

    return {
      username: clean,
      full_name: name?.[1]?.split('(')?.[0]?.trim() || clean,
      followers: followers ? parseInt(followers[1]) : null,
      bio: bio?.[1] || null,
      posts: null,
      verified: false
    }
  }
}

// ── WhatsApp contacts config (stored in JSON to avoid triggering Vite HMR) ───
const WA_CONTACTS_FILE = path.join(__dirname, 'whatsapp-contacts.json')
function getWaContacts() {
  try {
    if (fs.existsSync(WA_CONTACTS_FILE)) {
      const d = JSON.parse(fs.readFileSync(WA_CONTACTS_FILE, 'utf8'))
      return Array.isArray(d) ? d : []
    }
  } catch(e) {}
  // migrate from .env on first run
  const fromEnv = (process.env.WHATSAPP_CONTACTS || '').split(',').map(c => c.trim()).filter(Boolean)
  if (fromEnv.length) { fs.writeFileSync(WA_CONTACTS_FILE, JSON.stringify(fromEnv), 'utf8') }
  return fromEnv
}
function setWaContacts(list) {
  fs.writeFileSync(WA_CONTACTS_FILE, JSON.stringify(list), 'utf8')
}

// ── WhatsApp Desktop auto-monitor ────────────────────────────────────────────
const WHATSAPP_DB_PATH = '/Users/remo/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite'
// CoreData epoch: WhatsApp ZMESSAGEDATE = Unix seconds - 978307200
const COREDATA_EPOCH_OFFSET = 978307200
let whatsappDbPath = null
let lastWhatsAppCheck = Date.now() - 3600000 // Unix ms — 1 hour ago

function readWhatsAppMessages(dbPath, since) {
  if (!Database) throw new Error('better-sqlite3 not available')
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  // since = Unix ms → convert to CoreData seconds for the WHERE clause
  const waSince = (since / 1000) - COREDATA_EPOCH_OFFSET
  try {
    const msgs = db.prepare(`
      SELECT
        m.ZTEXT        AS text,
        m.ZMESSAGEDATE AS date,
        s.ZCONTACTJID  AS contact,
        m.ZISFROMME    AS is_from_me,
        s.ZPARTNERNAME AS partner_name
      FROM ZWAMESSAGE m
      JOIN ZWACHATSESSION s ON m.ZCHATSESSION = s.Z_PK
      WHERE m.ZMESSAGEDATE > ?
        AND m.ZTEXT IS NOT NULL
        AND m.ZTEXT != ''
      ORDER BY m.ZMESSAGEDATE DESC
      LIMIT 100
    `).all(waSince)
    return msgs
  } finally { db.close() }
}

async function analyzeArtistMessage(contactName, messageHistory, newMessage) {
  // Load existing profile from brain
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/brain_knowledge?select=content&category=eq.contact_profile&title=ilike.*${encodeURIComponent(contactName)}*&limit=1`,
    { headers: sbHeaders }
  ).catch(() => null)
  let existingProfile = 'No previous profile.'
  if (profileRes?.ok) {
    const rows = await profileRes.json().catch(() => [])
    if (rows[0]?.content) existingProfile = rows[0].content
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: `You are a relationship intelligence advisor for Remo, a professional music producer. Remo's main goal: make millions with music that has artistic integrity — the Daft Punk model, not Taylor Swift.

Analyze artist/contact messages with psychological depth. Be direct, practical, protective of Remo's time and energy. Flag boundary violations immediately and clearly.

Format responses as structured JSON only.`,
      messages: [{
        role: 'user',
        content: `Contact: ${contactName}
Existing profile: ${existingProfile}
Recent conversation:
${messageHistory}

New message: "${newMessage}"

Analyze and return JSON:
{
  "surface_message": "what they literally said",
  "real_intent": "what they actually want/need",
  "psychological_state": "their emotional state right now",
  "relationship_dynamic": "how they see this relationship",
  "business_assessment": "value/risk for Remo's goals",
  "boundary_alert": null or "DESCRIBE THE BOUNDARY BEING CROSSED",
  "boundary_type": null or "psychological|business|time|energy",
  "best_next_step": "specific action Remo should take",
  "response_suggestion": "suggested reply in 1-2 sentences",
  "profile_update": "one sentence updating what we know about this person",
  "urgency": "low|medium|high"
}`
      }]
    })
  })

  if (!res.ok) throw new Error(`Claude API ${res.status}`)
  const d = await res.json()
  const raw = (d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
  return { analysis, usage: d.usage }
}

async function pollWhatsApp() {
  if (!whatsappDbPath) return
  try {
    const newMsgs = readWhatsAppMessages(whatsappDbPath, lastWhatsAppCheck)
    if (!newMsgs.length) return

    // Group by contact JID
    const byContact = {}
    for (const msg of newMsgs) {
      const key = msg.contact || 'unknown'
      const displayName = msg.partner_name || msg.contact?.split('@')[0] || 'unknown'
      if (!byContact[key]) byContact[key] = { contact: displayName, jid: msg.contact, msgs: [] }
      byContact[key].msgs.push(msg)
    }

    // Filter to monitored contacts if list is set
    const monitoredContacts = getWaContacts().map(c => c.toLowerCase())

    let entries = Object.values(byContact)
    if (monitoredContacts.length > 0) {
      entries = entries.filter(({ contact }) =>
        monitoredContacts.some(mc => contact.toLowerCase().includes(mc))
      )
    }

    for (const { contact, jid, msgs } of entries) {
      const incomingMsgs = msgs.filter(m => !m.is_from_me)
      if (!incomingMsgs.length) continue
      const conversation = msgs.map(m => (m.is_from_me ? 'Remo' : contact) + ': ' + m.text).join('\n')
      const lastMsg = incomingMsgs[incomingMsgs.length - 1].text

      // Deep psychological + business analysis via Sonnet (personal chats only)
      if (!jid.includes('@g.us') && !jid.includes('@status') && conversation.length > 20) {
        try {
          const { analysis, usage } = await analyzeArtistMessage(contact, conversation, lastMsg)

          // 1. Update contact profile in brain (upsert by title)
          const existingProfile = await fetch(
            `${SUPABASE_URL}/rest/v1/brain_knowledge?category=eq.contact_profile&title=eq.Profile%3A%20${encodeURIComponent(contact)}&limit=1`,
            { headers: sbHeaders }
          ).then(r => r.json()).catch(() => [])

          const profileContent = (analysis.profile_update || '') +
            '\n\nLast contact: ' + new Date().toLocaleDateString()

          if (existingProfile[0]?.id) {
            await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?id=eq.${existingProfile[0].id}`, {
              method: 'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ content: profileContent })
            }).catch(() => {})
          } else {
            await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                category: 'contact_profile',
                title: 'Profile: ' + contact,
                content: profileContent,
                entry_type_v2: 'knowledge',
                confidence: 'medium',
                source_type: 'whatsapp',
                active: true
              })
            }).catch(() => {})
          }

          // 2. Save to inbox with full analysis metadata
          await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              type: 'message',
              song_title: `WhatsApp: ${contact}`,
              message: lastMsg.slice(0, 500),
              patch_name: 'Artist Intel',
              read: false,
              metadata: {
                from: contact,
                platform: 'whatsapp',
                real_intent: analysis.real_intent,
                psychological_state: analysis.psychological_state,
                boundary_alert: analysis.boundary_alert,
                boundary_type: analysis.boundary_type,
                best_next_step: analysis.best_next_step,
                response_suggestion: analysis.response_suggestion,
                urgency: analysis.urgency,
                business_assessment: analysis.business_assessment
              }
            })
          }).catch(() => {})

          // 3. Telegram notification
          let telegramMsg = ''
          if (analysis.boundary_alert) {
            telegramMsg += `⚠️ BOUNDARY ALERT (${analysis.boundary_type || 'unknown'})\n${analysis.boundary_alert}\n\n`
          }
          telegramMsg += `📱 ${contact} (${analysis.urgency || 'medium'} urgency)\n\n`
          telegramMsg += `💬 "${lastMsg.slice(0, 100)}"\n\n`
          if (analysis.real_intent) telegramMsg += `🎯 Real intent: ${analysis.real_intent}\n`
          if (analysis.psychological_state) telegramMsg += `🧠 State: ${analysis.psychological_state}\n`
          if (analysis.business_assessment) telegramMsg += `💼 Business: ${analysis.business_assessment}\n\n`
          if (analysis.best_next_step) telegramMsg += `✅ Next step: ${analysis.best_next_step}\n`
          if (analysis.response_suggestion) telegramMsg += `💡 Suggested reply: ${analysis.response_suggestion}`
          await sendTelegram(TELEGRAM_OWNER_ID, telegramMsg).catch(() => {})

          // 4. Track cost
          await fetch(`http://127.0.0.1:${PORT}/track-cost`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: 'whatsapp-analysis',
              model: 'claude-sonnet-4-20250514',
              input_tokens: usage?.input_tokens || 0,
              output_tokens: usage?.output_tokens || 0,
              cost_usd: ((usage?.input_tokens || 0) * 0.000003) + ((usage?.output_tokens || 0) * 0.000015)
            })
          }).catch(() => {})

        } catch(e) { console.warn('WhatsApp analysis error:', e.message) }
      } else if (jid.includes('@g.us') && !jid.includes('@status') && conversation.length > 0) {
        // Group chat — save to inbox without deep analysis
        await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            type: 'message',
            song_title: `Group: ${contact}`,
            message: lastMsg.slice(0, 500),
            patch_name: 'Group Chat',
            read: false,
            metadata: {
              from: contact,
              platform: 'whatsapp',
              is_group: true,
              urgency: 'low'
            }
          })
        }).catch(() => {})
      }
    }

    // Check for new chat sessions that appeared since last poll
    try {
      if (Database && whatsappDbPath && fs.existsSync(whatsappDbPath)) {
        const db2 = new Database(whatsappDbPath, { readonly: true, fileMustExist: true })
        const newChats = db2.prepare(`
          SELECT ZPARTNERNAME, ZCONTACTJID, ZLASTMESSAGEDATE
          FROM ZWACHATSESSION
          WHERE ZLASTMESSAGEDATE > ?
          AND ZPARTNERNAME IS NOT NULL
          ORDER BY ZLASTMESSAGEDATE DESC
          LIMIT 5
        `).all(lastWhatsAppCheck / 1000 - COREDATA_EPOCH_OFFSET)
        db2.close()

        for (const chat of newChats) {
          const name = chat.ZPARTNERNAME
          const monitored = getWaContacts().some(c => name?.toLowerCase().includes(c.toLowerCase()))
          if (!monitored) {
            await sendTelegram(TELEGRAM_OWNER_ID,
              '📱 New WhatsApp chat: ' + name +
              '\n/monitor ' + name + ' to start monitoring'
            ).catch(() => {})
          }
        }
      }
    } catch(e) { console.warn('pollWhatsApp new-chat detection error:', e.message) }

    // Convert CoreData seconds back to Unix ms for next poll
    lastWhatsAppCheck = (newMsgs[0].date + COREDATA_EPOCH_OFFSET) * 1000
  } catch(e) { console.warn('pollWhatsApp error:', e.message) }
}

// ── Brain connection finder — module scope so endpoint + scheduler can both call it ──
async function connectBrainEntries() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return { ok: false, error: 'No API key' }

    const { data: entries } = await supabase
      .from('brain_knowledge')
      .select('id, title, content, category')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(200)

    if (!entries?.length) return { ok: false, error: 'No entries' }

    // Dedup: skip connections already saved in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentConns } = await supabase
      .from('brain_knowledge')
      .select('metadata')
      .eq('category', 'knowledge_connection')
      .eq('active', true)
      .gte('created_at', sevenDaysAgo)

    const existingCombos = new Set(
      (recentConns || []).map(c => (c.metadata?.entry_ids || []).map(String).sort().join(','))
    )

    // Include recent connection insights as context for Claude
    const { data: mozartConns } = await supabase
      .from('brain_knowledge')
      .select('title, content')
      .eq('category', 'knowledge_connection')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(5)

    const mozartCtx = mozartConns?.length
      ? '\n\nRecent connections already found:\n' + mozartConns.map(c => `- ${c.title}: ${(c.content || '').slice(0, 100)}`).join('\n')
      : ''

    const entrySummary = entries.map(e =>
      `${e.id}|${e.category}|${e.title}: ${(e.content || '').slice(0, 200)}`
    ).join('\n')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: `You are a knowledge synthesis engine for a professional music producer's brain database.
Find meaningful connections between entries: patterns that reinforce each other, contradictions to resolve, complementary insights to merge.
Focus on actionable connections — pairs or groups where seeing them together creates new value.${mozartCtx}
Return ONLY a JSON array. Each element: {"entry_ids":[id1,id2],"connection_type":"reinforces|contradicts|complements|extends","insight":"one sentence why these connect","action":"what to do with this connection"}
Return 5-15 connections. No markdown, no prose.`,
        messages: [{ role: 'user', content: `Find connections in these ${entries.length} brain entries:\n\n${entrySummary}` }]
      })
    })

    const d = await res.json()
    let raw = (d.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
    // Extract array from response even if wrapped in prose
    const arrMatch = raw.match(/\[[\s\S]*\]/)
    if (arrMatch) raw = arrMatch[0]

    let connections = []
    try {
      connections = JSON.parse(raw)
    } catch(e) {
      // Try extracting individual objects if full array parse fails
      const objMatches = [...raw.matchAll(/\{[^{}]*"entry_ids"[^{}]*\}/g)]
      if (objMatches.length) {
        for (const m of objMatches) {
          try { connections.push(JSON.parse(m[0])) } catch(_) {}
        }
      }
      if (!connections.length) {
        console.warn('connectBrainEntries parse error:', e.message)
        return { ok: false, error: 'Parse error: ' + e.message }
      }
    }

    fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        endpoint: 'connect-brain-entries', model: 'claude-haiku-4-5-20251001',
        input_tokens: d.usage?.input_tokens || 0, output_tokens: d.usage?.output_tokens || 0,
        cost_usd: ((d.usage?.input_tokens || 0) * 0.0000008) + ((d.usage?.output_tokens || 0) * 0.000001)
      })
    }).catch(() => {})

    let saved = 0, skipped = 0
    const savedConnections = []

    for (const conn of connections) {
      const ids = (conn.entry_ids || []).map(String).filter(s => s.length > 8).sort()
      if (ids.length < 2) continue
      const comboKey = ids.join(',')
      if (existingCombos.has(comboKey)) { skipped++; continue }

      const includedEntries = entries.filter(e => ids.includes(String(e.id)))
      const entryTitles = includedEntries.map(e => cleanTitle(e.title)).join(' + ')

      const { error } = await supabase.from('brain_knowledge').insert({
        category: 'knowledge_connection',
        title: (conn.connection_type + ': ' + entryTitles).slice(0, 120),
        content: conn.insight + (conn.action ? '\n→ ' + conn.action : ''),
        confidence: 'medium',
        source_type: 'brain_connect',
        active: true,
        metadata: { entry_ids: ids, connection_type: conn.connection_type, action: conn.action }
      })

      if (!error) {
        saved++
        existingCombos.add(comboKey)
        savedConnections.push({ ids, type: conn.connection_type, insight: conn.insight })
      }
    }

    if (TELEGRAM_TOKEN && savedConnections.length) {
      await sendTelegram(TELEGRAM_OWNER_ID,
        `🧠 Brain connections: ${saved} new, ${skipped} already known\n\n` +
        savedConnections.slice(0, 5).map(c => `· [${c.type}] ${c.insight}`).join('\n')
      )
    }

    console.log(`✓ connectBrainEntries: ${saved} saved, ${skipped} skipped`)
    return { ok: true, connections_found: connections.length, connections_saved: saved, skipped_dupes: skipped }
  } catch(e) {
    console.warn('connectBrainEntries error:', e.message)
    return { ok: false, error: e.message }
  }
}

server.listen(PORT, '127.0.0.1', () => {
  server.timeout = 0          // no timeout — needed for large audio file streams
  server.keepAliveTimeout = 0
  exec('rm -rf /tmp/ref_preview_* /tmp/ref_bg_* /tmp/tiktok_* /tmp/sp_preview_* /tmp/vocal_* /tmp/mm_qimport_* /tmp/mm_preview_* /tmp/yt_* /tmp/acapella_* /tmp/demucs_* /tmp/stem_eq_* /tmp/onset_* 2>/dev/null')
  loadSpotifyToken()
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Momentum Watcher + Audio Server')
  console.log('  Watch:       ', WATCH_DIR)
  console.log('  Demos:       ', DEMOS_DIR)
  console.log('  Submissions: ', SUBMISSIONS_DIR)
  console.log('  Audio:        http://localhost:4242/audio/')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (TELEGRAM_TOKEN) {
    pollTelegram()
    pollInboxNotifications()
    console.log('✓ Telegram bot polling started')
    sendTelegram(TELEGRAM_OWNER_ID, '🟢 Momentum watcher started').catch(() => {})
  }
  // Auto-connect WhatsApp DB
  if (Database && fs.existsSync(WHATSAPP_DB_PATH)) {
    whatsappDbPath = WHATSAPP_DB_PATH
    console.log('✓ WhatsApp DB found:', whatsappDbPath)
    setInterval(pollWhatsApp, 120000)
  } else {
    exec(`find /Users/remo/Library -name "ChatStorage.sqlite" -path "*whatsapp*" 2>/dev/null`, (err, stdout) => {
      const p = stdout.trim().split('\n').filter(Boolean)[0]
      if (p) {
        whatsappDbPath = p
        console.log('✓ WhatsApp DB found:', whatsappDbPath)
        setInterval(pollWhatsApp, 120000)
      } else {
        console.log('⚠ WhatsApp DB not found — /setup-whatsapp to configure')
      }
    })
  }
  // Obsidian vault watcher
  if (fs.existsSync(OBSIDIAN_VAULT_PATH)) {
    chokidar.watch(OBSIDIAN_VAULT_PATH, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true })
      .on('add', p => syncObsidianFile(p))
      .on('change', p => syncObsidianFile(p))
    console.log('✓ Obsidian vault watching:', OBSIDIAN_VAULT_PATH)
  } else {
    console.log('⚠ Obsidian vault not found:', OBSIDIAN_VAULT_PATH, '— create vault to enable sync')
  }
  ensureNowNote()
  // Apple Notes auto-sync every 5 minutes
  if (!fs.existsSync(NOTES_PATH)) fs.mkdirSync(NOTES_PATH, { recursive: true })
  setInterval(async () => {
    try { await syncAppleNotesToObsidian() } catch(e) { logError('apple-notes-sync', e.message) }
    try { await reconcileNotes() } catch(e) { logError('notes-reconcile', e.message) }
  }, 5 * 60 * 1000)
  setTimeout(async () => {
    try { await reconcileNotes() } catch(e) { logError('notes-reconcile', e.message) }
  }, 10000)
  console.log('✓ Apple Notes auto-sync + reconcile: every 5 minutes')
  // connectBrainEntries() — defined at module scope above (accessible via endpoint + scheduler)

  // Weekly brain review — Sunday 8am
  async function weeklyBrainReview() {
    try {
      const brainRes = await fetch(
        `${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=id,category,title,content,confidence,created_at,source_type`,
        { headers: sbHeaders }
      )
      const entries = await brainRes.json()
      if (!Array.isArray(entries) || !entries.length) return
      const categoryCounts = {}
      for (const e of entries) categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) { console.warn('weeklyBrainReview: no ANTHROPIC_API_KEY'); return }
      const cr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 600,
          system: 'You are a knowledge curator for a music producer brain. Be direct and specific.',
          messages: [{ role: 'user', content: `Weekly brain review for Remo (music producer).
Categories: ${JSON.stringify(categoryCounts)}
Total entries: ${entries.length}

Analyze and suggest:
1. Category overlaps to merge
2. Knowledge gaps for a music producer
3. Overall brain health score 1-10
4. One priority action to improve the brain this week

Max 150 words. Be specific and actionable.` }]
        })
      })
      const d = await cr.json()
      const review = d.content?.[0]?.text || ''
      if (TELEGRAM_TOKEN) {
        await sendTelegram(TELEGRAM_OWNER_ID, '🧠 Weekly Brain Review\n\n' + review + '\n\n→ Review in Brain tab')
      }
      fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          endpoint: 'weekly-brain-review', model: 'claude-haiku-4-5-20251001',
          input_tokens: d.usage?.input_tokens || 0, output_tokens: d.usage?.output_tokens || 0,
          cost_usd: ((d.usage?.input_tokens || 0) * 0.0000008) + ((d.usage?.output_tokens || 0) * 0.000001)
        })
      }).catch(() => {})
      console.log('✓ Weekly brain review sent')
    } catch(e) { console.warn('weeklyBrainReview error:', e.message) }
  }
  setInterval(() => {
    const now = new Date()
    if (now.getDay() === 0 && now.getHours() === 8 && now.getMinutes() === 0) {
      weeklyBrainReview()
      weeklySystemReview()
      connectBrainEntries()
    }
    // 3am daily — brain dedup
    if (now.getHours() === 3 && now.getMinutes() < 5) {
      mergeDupes().then(r =>
        console.log('Auto brain dedup 3am: deleted', r.deleted, 'merged', r.merged)
      ).catch(e => console.error('Auto brain dedup error:', e.message))
    }
    // 9am daily — TikTok trends
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      fetch('http://localhost:4242/agent-tiktok-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: process.env.ANTHROPIC_API_KEY })
      }).catch(e => console.error('tiktok-trends schedule error:', e.message))
    }
  }, 60000)
  setInterval(() => {
    brainToObsidian().catch(e => console.error('auto obsidian sync error:', e.message))
  }, 3600000)
  // BTC price alert — check hourly, alert on 3%+ move
  setInterval(async () => {
    try {
      const btc = await fetchBTCData()
      const currentPrice = btc?.bitcoin?.eur
      if (!currentPrice) return
      if (!global.lastBTCPrice) { global.lastBTCPrice = currentPrice; return }
      const change = ((currentPrice - global.lastBTCPrice) / global.lastBTCPrice) * 100
      if (Math.abs(change) >= 3) {
        const dir = change > 0 ? '📈 UP' : '📉 DOWN'
        const binanceDeepLink = 'https://www.binance.com/en/trade/BTC_EUR'
        const extra = change < -3 ? '→ Potential buying opportunity\n' + binanceDeepLink :
                      change > 5  ? '→ Taking profits? Check your targets.' : ''
        if (TELEGRAM_TOKEN) {
          await sendTelegram(TELEGRAM_OWNER_ID,
            '⚡ BTC ALERT: ' + dir + ' ' + change.toFixed(1) + '% in last hour\n' +
            'Now: €' + Math.round(currentPrice).toLocaleString() +
            (extra ? '\n' + extra : '')
          ).catch(() => {})
        }
        global.lastBTCPrice = currentPrice
      }
    } catch(e) {}
  }, 3600000)
  exec('/opt/homebrew/bin/python3.11 -c "import essentia"', (err) => {
    if (err) console.warn('⚠ Essentia not available — BPM/key analysis disabled')
    else console.log('✓ Essentia ready')
  })
  // Backfill all active brain entries into smart Obsidian folders
  setTimeout(() => {
    supabase.from('brain_knowledge')
      .select('*').eq('active', true)
      .then(({ data }) => {
        for (const entry of data || []) saveBrainFile(entry).catch(() => {})
        updateObsidianIndex()
        console.log('✓ Obsidian smart folders populated (' + (data?.length || 0) + ' entries)')
      }).catch(e => console.warn('smart folder backfill error:', e.message))
  }, 8000)
  // Check new columns exist — warn with SQL if missing
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=scale,key_strength,valence,acousticness,instrumentalness,duration_seconds,camelot,spectral_centroid,spectral_contrast,spectral_flux,mfcc_mean&limit=1`, { headers: sbHeaders })
    .then(r => {
      if (r.status === 400) console.warn('⚠ reference_tracks missing columns — run SQL in Supabase:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS scale text, ADD COLUMN IF NOT EXISTS key_strength float, ADD COLUMN IF NOT EXISTS valence float, ADD COLUMN IF NOT EXISTS acousticness float, ADD COLUMN IF NOT EXISTS instrumentalness float, ADD COLUMN IF NOT EXISTS duration_seconds float, ADD COLUMN IF NOT EXISTS camelot text, ADD COLUMN IF NOT EXISTS spectral_centroid float, ADD COLUMN IF NOT EXISTS spectral_contrast float, ADD COLUMN IF NOT EXISTS spectral_flux float, ADD COLUMN IF NOT EXISTS mfcc_mean jsonb;')
    })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/songs?select=audio_analysis&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ songs table missing audio_analysis column — run SQL:\nALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_analysis jsonb;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=source,promoted&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ reference_tracks missing source/promoted columns — run SQL in Supabase:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS source text DEFAULT \'agent\', ADD COLUMN IF NOT EXISTS promoted boolean DEFAULT false;\nUPDATE reference_tracks SET source = \'agent\' WHERE collection_name = \'daily_chart\';') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=checkout_date&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ reference_tracks missing checkout_date column — run SQL in Supabase:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS checkout_date timestamptz;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/connections?select=personal&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ connections table missing personal column — run SQL in Supabase:\nALTER TABLE connections ADD COLUMN IF NOT EXISTS personal boolean DEFAULT false;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=warmth,rhythm_regularity,harmonic_complexity&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ reference_tracks missing extended analysis columns — run SQL in Supabase:\nALTER TABLE reference_tracks\n  ADD COLUMN IF NOT EXISTS speechiness float,\n  ADD COLUMN IF NOT EXISTS instrumentalness float,\n  ADD COLUMN IF NOT EXISTS onset_rate float,\n  ADD COLUMN IF NOT EXISTS rhythm_regularity float,\n  ADD COLUMN IF NOT EXISTS dynamic_complexity float,\n  ADD COLUMN IF NOT EXISTS loudness_range float,\n  ADD COLUMN IF NOT EXISTS vocal_pitch_mean float,\n  ADD COLUMN IF NOT EXISTS vocal_pitch_range float,\n  ADD COLUMN IF NOT EXISTS vocal_root_note text,\n  ADD COLUMN IF NOT EXISTS vibrato_presence float,\n  ADD COLUMN IF NOT EXISTS harmonic_complexity float,\n  ADD COLUMN IF NOT EXISTS warmth float;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/notes?select=apple_note_id,source&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ notes table missing Apple Notes columns — run SQL in Supabase:\nALTER TABLE notes ADD COLUMN IF NOT EXISTS apple_note_id text;\nALTER TABLE notes ADD COLUMN IF NOT EXISTS source text DEFAULT \'momentum\';\nALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at timestamptz;\nCREATE UNIQUE INDEX IF NOT EXISTS notes_apple_note_id_idx ON notes(apple_note_id) WHERE apple_note_id IS NOT NULL;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/vocal_eq_curves?select=stem_type,source_type,version_name&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ vocal_eq_curves missing columns — run SQL in Supabase:\nALTER TABLE vocal_eq_curves\n  ADD COLUMN IF NOT EXISTS stem_type text DEFAULT \'vocals\',\n  ADD COLUMN IF NOT EXISTS source_type text DEFAULT \'mix\',\n  ADD COLUMN IF NOT EXISTS version_name text;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/vocal_eq_curves?select=reference_track_id&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ vocal_eq_curves missing reference_track_id — run SQL:\nALTER TABLE vocal_eq_curves ADD COLUMN IF NOT EXISTS reference_track_id text;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=credits&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ reference_tracks missing credits/emotional_arc — run SQL:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS credits jsonb, ADD COLUMN IF NOT EXISTS emotional_arc jsonb;') })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=genre_tag,playlist_name&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ reference_tracks missing genre_tag/playlist_name — run SQL:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS genre_tag text, ADD COLUMN IF NOT EXISTS playlist_name text;') })
    .catch(() => {})
})

// ── File watcher ──────────────────────────────────────────────────────────
const processed = new Set()

fs.watch(WATCH_DIR, (event, filename) => {
  if (!filename) return

  if (filename === OPEN_TRIGGER) {
    const triggerPath = path.join(WATCH_DIR, filename)
    setTimeout(() => {
      try {
        if (!fs.existsSync(triggerPath)) return
        const data = JSON.parse(fs.readFileSync(triggerPath, 'utf8'))
        fs.unlinkSync(triggerPath)
        const audioFile = path.join(DEMOS_DIR, data.file)
        if (!fs.existsSync(audioFile)) { console.log(`⚠  Not found: ${audioFile}`); return }
        execSync(`open -a "QuickTime Player" "${audioFile}"`)
        console.log(`▶  Opened: ${data.file}`)
      } catch(err) { logError('open-audio', err.message); console.error('✗ Open error:', err.message) }
    }, 400)
    return
  }

  if (processed.has(filename)) return
  const ext = path.extname(filename).toLowerCase()
  if (!AUDIO_EXTS.includes(ext)) return
  if (!CODE_PATTERN.test(filename)) return
  const src = path.join(WATCH_DIR, filename)
  setTimeout(() => {
    try {
      if (!fs.existsSync(src)) return
      if (fs.statSync(src).size === 0) return
      fs.renameSync(src, path.join(DEMOS_DIR, filename))
      processed.add(filename)
      console.log(`✓  Moved: ${filename}`)
    } catch(err) { logError('move-file', err.message); console.error(`✗ Move error (${filename}):`, err.message) }
  }, 1500)
})
