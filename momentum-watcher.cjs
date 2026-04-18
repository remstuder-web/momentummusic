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

// ── CONFIG ────────────────────────────────────────────────────────────────
// Dropbox OAuth2 — fill in App Key and App Secret from your Dropbox App Console
// https://www.dropbox.com/developers/apps → your app → Settings
const DROPBOX_APP_KEY    = 'd49ij57sk23ukdw'     // e.g. 'abc123xyz'
const DROPBOX_APP_SECRET = 'h36y7hta8ttmr6e'  // e.g. 'def456uvw'

// Spotify — fill in from https://developer.spotify.com/dashboard
const SPOTIFY_CLIENT_ID     = '45bb7c8c0553458ca79e0848ea805559'
const SPOTIFY_CLIENT_SECRET = 'ab5d6290dc404f48b261870262f23a0c'

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

// ── Weekly: check watched artists for new releases ────────────────────────
setInterval(async () => {
  console.log('🎵 Checking watched artists for new releases...')
  try {
    const token = await getSpotifyToken()

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/watched_artists?active=eq.true&select=*`,
      { headers: sbHeaders }
    )
    const artists = await r.json()
    if (!Array.isArray(artists) || !artists.length) return

    let newReleases = []

    for (const artist of artists) {
      const relRes = await fetch(
        `https://api.spotify.com/v1/artists/${artist.spotify_id}/albums`
        + `?include_groups=single,album&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
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
    const spToken = await getSpotifyToken()
    const spH = { 'Authorization': `Bearer ${spToken}` }

    const [relRes, featRes, viralRes] = await Promise.allSettled([
      fetch('https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE', { headers: spH }),
      fetch('https://api.spotify.com/v1/browse/featured-playlists?limit=5&country=DE', { headers: spH }),
      fetch('https://api.spotify.com/v1/playlists/4rOoJ6Egrf8K2IrywzwOMk/tracks?limit=20', { headers: spH })
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
    await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        type: 'briefing',
        song_title: 'Pulse Check',
        message: pulse,
        patch_name: `Pulse ${new Date().toISOString().slice(0, 10)}`,
        read: false
      })
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

// ── Agent: Chart Analysis — Viral 50 + Essentia + brain storage ──────────
async function runAgentChartAnalysis(apiKey) {
  const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
  const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
  const spToken = await getSpotifyToken()
  const spH = { 'Authorization': `Bearer ${spToken}` }

  // 1. Fetch current popular tracks via search (Viral 50 requires Extended Quota Mode)
  const year = new Date().getFullYear()
  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=year:${year}&type=track&limit=20`,
    { headers: spH }
  )
  if (!searchRes.ok) throw new Error('Spotify track search failed: ' + searchRes.status)
  const searchData = await searchRes.json()
  const viralTracks = (searchData.tracks?.items || [])
    .filter(Boolean)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))

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
  }).slice(0, 3)

  if (!newTracks.length) {
    console.log('✓ chart-analysis: no new tracks today')
    return { ok: true, tracks: [], assessment: 'No new chart tracks today — all already stored.' }
  }

  // 3. Analyze each new track
  const analyzedTracks = []
  for (const track of newTracks) {
    const trackId = track.id
    const artistId = track.artists?.[0]?.id
    const artistRes = artistId ? await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: spH }) : null
    const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

    let genres = artist.genres || []
    if (!genres.length && artistId) {
      try {
        const relRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}/related-artists`, { headers: spH })
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
      const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${tmpAudio}" 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
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
      approved: true
    }
    await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row)
    })
    analyzedTracks.push({ title: track.name, artist: track.artists.map(a => a.name).join(', '), ...feat })
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

  // 6. Save assessment to brain_knowledge
  if (assessment) {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        category: 'market_knowledge',
        title: `Chart Analysis ${today}`,
        content: assessment,
        entry_type: 'FACT',
        active: true
      })
    })
  }

  console.log(`✓ chart-analysis: ${analyzedTracks.length} tracks stored, assessment saved`)
  return { ok: true, chart_source: 'spotify_search', tracks: analyzedTracks, assessment }
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

async function runAgentScout(apiKey, sharedBrainRows) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  // Fetch all data sources in parallel
  const [connectionsRes, refTracksRes, watchedRes, spToken, pitchfork, factmag, hypebot] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/connections?select=name`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?order=tempo.desc&limit=5&select=title,artist,genre_tags,tempo,key`, { headers: sbHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/watched_artists?active=eq.true&select=*`, { headers: sbHeaders }),
    getSpotifyToken().catch(() => null),
    fetchRssTitles('https://pitchfork.com/rss/news/feed.json', 5),
    fetchRssTitles('https://www.factmag.com/feed/', 5),
    fetchRssTitles('https://www.hypebot.com/feed', 5),
  ])

  const [connections, refTracks, watchedArtists] = await Promise.all([
    connectionsRes.json(), refTracksRes.json(), watchedRes.json()
  ])

  // Spotify new releases DE
  let newReleasesText = ''
  if (spToken) {
    try {
      const spH = { 'Authorization': `Bearer ${spToken}` }
      const relRes = await fetch('https://api.spotify.com/v1/browse/new-releases?limit=10&country=DE', { headers: spH })
      if (relRes.ok) {
        const relData = await relRes.json()
        const albums = relData.albums?.items || []
        newReleasesText = albums.map(a => `- ${a.artists.map(x=>x.name).join(', ')} — ${a.name} (${a.release_date})`).join('\n')
      }
    } catch(e) { console.warn('Spotify new-releases failed:', e.message) }
  }

  // Watched artists — flag any released in last 7 days
  let watchedNewText = ''
  if (spToken && Array.isArray(watchedArtists) && watchedArtists.length) {
    const spH = { 'Authorization': `Bearer ${spToken}` }
    const watchedChecks = await Promise.allSettled(
      watchedArtists.map(async a => {
        const r = await fetch(`https://api.spotify.com/v1/artists/${a.spotify_id}/albums?include_groups=single,album&limit=1`, { headers: spH })
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

  // Build RSS headlines block
  const rssLines = [
    ...pitchfork.map(t => `[Pitchfork] ${t}`),
    ...factmag.map(t => `[FACT] ${t}`),
    ...hypebot.map(t => `[Hypebot] ${t}`),
  ].join('\n') || 'No headlines fetched'

  const knownNames = (Array.isArray(connections) ? connections : []).map(b => b.name).filter(Boolean).join(', ') || 'none'
  const brainContext = buildBrainContext(sharedBrainRows)
  const refTrackText = (Array.isArray(refTracks) ? refTracks : [])
    .map(t => `- ${t.artist} — ${t.title} | ${t.tempo || '?'}bpm ${t.key || ''} | genres: ${(t.genre_tags || []).slice(0,3).join(', ')}`)
    .join('\n')

  const prompt = `Here is this week's REAL music data — do not invent anything outside this data:

NEW RELEASES ON SPOTIFY:
${newReleasesText || 'Unavailable'}

INDUSTRY HEADLINES THIS WEEK:
${rssLines}

WATCHED ARTISTS — NEW RELEASES:
${watchedNewText || 'none this week'}

${refTrackText ? `REFERENCE TRACKS (Remo's taste):\n${refTrackText}\n` : ''}Already known — skip: ${knownNames}
${brainContext ? `\n[BACKGROUND — read silently, do not reproduce]\n${brainContext}\n[END BACKGROUND]\n` : ''}
Based ONLY on the above real data:

## Breaking Artists
- Name artists actually in the new releases data
- Only reference real tracks listed above

## Trending Sounds
- Patterns visible in the real data only

## Opportunities
- Based on gaps in the real data vs Remo's sound (genres: ${SUB_GENRE_LABELS})

## Next Step
- Single most important action today

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
  fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ endpoint: '/agent-scout', model, input_tokens: usage.input_tokens||0, output_tokens: usage.output_tokens||0, cost_usd: ((usage.input_tokens||0)*0.000001)+((usage.output_tokens||0)*0.000005) })
  }).catch(() => {})

  // Save scout report to brain_knowledge
  fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ category: 'market_knowledge', title: `Scout Report ${today}`, content: scoutText, entry_type: 'observation', confidence: 'weak', active: true })
  }).catch(() => {})

  await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ type: 'briefing', song_code: null, song_title: 'Artist Scout', artist: null, message: scoutText, patch_name: `Scout ${new Date().toISOString().slice(0,10)}`, read: false })
  })
  console.log('✓ Agent Scout report saved to inbox + brain_knowledge')
  return { ok: true, suggestions: scoutText }
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
async function runAgentTikTokTrends(apiKey, sharedBrainRows) {
  const brainContext = buildBrainContext(sharedBrainRows)

  const prompt = `You are a music trend analyst focused on TikTok virality. Identify 5 current TikTok sound trends most relevant to this producer's taste profile.

FORMATTING: Never use **bold** or *italic* markdown. Use ## for headers, - for bullets, [GAP]/[OK] for emphasis. Plain text only.
Format your response using this exact structure:
- Use ## for section headers
- One blank line between sections
- Bullet points for lists, max 2 lines per bullet
- Numbers for ranked items
- End with a ## Next Move section: single most important action today
Keep each section tight — no filler sentences.

Sections to include:
## Viral Sounds
## Why It's Blowing Up
## Production Angles
## Next Move

${brainContext ? `[TASTE PROFILE — read silently]\n${brainContext}\n[END PROFILE]\n` : ''}Genres to focus on: ${SUB_GENRE_LABELS}`

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

  await fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications`, {
    method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ type: 'briefing', song_code: null, song_title: 'TikTok Trends', artist: null, message: trendsText, patch_name: `Trends ${new Date().toISOString().slice(0,10)}`, read: false })
  })
  console.log('✓ Agent TikTok Trends saved to inbox')
  return { ok: true, trends: trendsText }
}

console.log('Spotify ID:', SPOTIFY_CLIENT_ID ? 'set' : 'EMPTY')
console.log('Spotify Secret:', SPOTIFY_CLIENT_SECRET ? 'set' : 'EMPTY')

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

// ── Error log — writes to Supabase watcher_logs, survives restarts ───────────
function logError(endpoint, message, level = 'error') {
  const row = { endpoint, message: String(message).slice(0, 500), level }
  fetch(`${SUPABASE_URL}/rest/v1/watcher_logs`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(row)
  }).catch(() => {}) // fire-and-forget — never throw
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
    'POST /agent-demo-match', 'POST /agent-feedback', 'POST /analyze-spotify-track',
    'POST /agent-import-spotify', 'GET /get-page-title', 'POST /create-submission',
    'POST /save-instrumental', 'POST /get-instrumental-link', 'POST /analyze-audio',
    'GET /audio/:filename', 'GET /mixing/:filename', 'GET /production/:filename',
    'GET /instrumentals/:filename', 'GET /stems/:filename',
    'POST /agent-pulse-check', 'POST /agent-chart-analysis', 'POST /run-morning-agents', 'POST /speak',
    'POST /suggest-category', 'GET /daily-snapshot', 'POST /analyze-audio-features', 'POST /analyze-youtube-track',
    'POST /sync-all-refs', 'POST /capture-screen', 'POST /analyze-chat',
    'POST /launch-claude-code', 'POST /launch-claude-overnight',
    'GET /logs', 'GET /get-changes', 'GET /get-tasks', 'POST /track-cost',
    'GET /get-env-keys', 'POST /save-env-key', 'POST /save-tasks',
    'GET /status', 'GET /system-status', 'GET /ping',
    'POST /cleanup-brain-dupes'
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
          `"${ffmpeg}" -i "${tmpIn}" -af ebur128=framelog=verbose -f null /dev/null 2>&1`,
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
        execSync(`"${ffmpeg}" -i "${tmpIn}" -af "volume=${gainDb}dB" ${encFlags} -y "${outPath}"`, { stdio: 'pipe' })
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
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, shareLink }))
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

        // Full Essentia analysis for WAV files
        let analysis = null
        let bpm = null, esKey = null
        if (fname.toLowerCase().endsWith('.wav')) {
          const ESSENTIA_PYTHON = '/opt/homebrew/bin/python3.11'
          const ANALYZE_SCRIPT = path.join(__dirname, 'analyze_audio.py')
          try {
            const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${destPath}" 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
            const feat = JSON.parse(esOut)
            bpm = feat.bpm ? Math.round(feat.bpm) : null
            esKey = feat.key && feat.scale ? feat.key + ' ' + feat.scale : null
            analysis = {
              bpm: feat.bpm, key: feat.key, scale: feat.scale, camelot: feat.camelot || null,
              energy: feat.energy, danceability: feat.danceability, valence: feat.valence,
              loudness_lufs: feat.loudness_lufs, brightness: feat.brightness,
              spectral_centroid: feat.spectral_centroid || null,
              spectral_contrast: feat.spectral_contrast || null,
              bass_energy: feat.bass_energy, duration_seconds: feat.duration_seconds
            }
            console.log(`  ✓ Essentia: ${fname} → ${bpm}bpm ${esKey} (${feat.camelot}) nrg:${feat.energy}`)
          } catch(e) {
            console.warn(`  Essentia skipped for ${fname}:`, e.message.slice(0, 60))
          }
        }

        // Parse human title from filename: CODE_ARTIST_TITLE_v00.wav → ARTIST TITLE
        const titleParsed = fname.replace(/\.[^.]+$/, '').replace(/_/g, ' ')

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true, filename: fname, path: destPath,
          ...(analysis ? { analysis } : {}),
          ...(bpm ? { suggest_brain: true, brain_prefill: { category: 'own_production', title: titleParsed, bpm, key: esKey } } : {})
        }))
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

        // Fetch data from Supabase in parallel
        const [songsRes, inboxRes, connectionsRes, brainKnowRes, goalsRes, demosRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/songs?select=title,code,work_data,project_id&not.project_id=is.null`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/inbox_notifications?read=eq.false&order=created_at.desc&limit=20`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/connections?select=name,genre,group_types,last_contact,notes,status`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&select=category,title,content&order=created_at.desc&limit=10`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?active=eq.true&category=eq.goal&select=title,content&order=created_at.desc&limit=10`, { headers: sbHeaders }),
          fetch(`${SUPABASE_URL}/rest/v1/share_sessions?select=created_at&session_type=eq.demo&created_at=gte.${todayISO.slice(0,7)+'-01'}`, { headers: sbHeaders })
        ])
        const [songs, inbox, brain, brainKnow, goals, demos] = await Promise.all([songsRes.json(), inboxRes.json(), connectionsRes.json(), brainKnowRes.json(), goalsRes.json(), demosRes.json()])

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
        const demos_sent_this_month = Array.isArray(demos) ? demos.length : 0

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

        const context = [
          `Today: ${todayISO}`,
          `Songs by stage: ${Object.entries(stageCounts).map(([k,v]) => `${k}(${v})`).join(', ') || 'none'}`,
          `Finished this month: ${done_this_month} | Demos sent this month: ${demos_sent_this_month}`,
          `Upcoming deadlines (7 days): ${upcomingDeadlines.join('; ') || 'none'}`,
          `Unread feedback: ${unreadFeedback.join('; ') || 'none'}`,
          `Artists to follow up (30+ days no contact): ${overdueArtists.slice(0,5).join('; ') || 'none'}`,
          activeGoals ? `\nACTIVE GOALS:\n${activeGoals}` : '',
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

Sections to include:
## Today's Focus
## Pipeline Status
## Watch Out
## Next Step

${context}` }]
          })
        })
        const claudeData = await claudeRes.json()
        const briefingText = claudeData.content?.[0]?.text || 'No briefing generated.'

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

        // Insert into inbox_notifications
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
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
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

  // ── POST /analyze-spotify-track — metadata + Essentia BPM/key from preview ──
  if (req.method === 'POST' && req.url === '/analyze-spotify-track') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { url } = JSON.parse(body)
        if (!url) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }

        const trackId = url.split('/track/')[1].split('?')[0].split('/')[0]
        const token = await getSpotifyToken()
        const spH = { 'Authorization': `Bearer ${token}` }

        const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, { headers: spH })
        if (!trackRes.ok) throw new Error(`Spotify track error: ${trackRes.status}`)
        const track = await trackRes.json()

        const artistId = track.artists?.[0]?.id
        const artistRes = artistId
          ? await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: spH })
          : null
        const artist = artistRes?.ok ? await artistRes.json() : { genres: [] }

        let genres = artist.genres || []
        let genres_source = genres.length ? 'artist' : 'none'
        if (!genres.length && artistId) {
          try {
            const relRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}/related-artists`, { headers: spH })
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
            const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${tmpAudio}" 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
            const feat = JSON.parse(esOut)
            bpm = feat.bpm; key = feat.key; scale = feat.scale; key_strength = feat.key_strength
            energy = feat.energy; danceability = feat.danceability
            loudness = feat.loudness_lufs; valence = feat.valence
            acousticness = feat.acousticness; duration_seconds = feat.duration_seconds
            camelot = feat.camelot || null
            Object.assign(esExtended, {
              spectral_centroid: feat.spectral_centroid || null,
              spectral_contrast: feat.spectral_contrast || null,
              spectral_flux: feat.spectral_flux || null,
              mfcc_mean: feat.mfcc_mean || null,
              bpm_confidence: feat.bpm_confidence || null,
              brightness: feat.brightness || null,
              bass_energy: feat.bass_energy || null,
            })
            console.log(`  ✓ Essentia (${preview_source}): ${bpm}bpm ${key} ${scale} (${camelot}) nrg:${energy} dnc:${danceability} val:${valence} lufs:${loudness}`)
          } catch(e) {
            console.warn('  Essentia analysis failed:', e.message.slice(0, 50))
          }
        }
        try { fs.unlinkSync(tmpAudio) } catch(e) {}

        console.log(`✓ analyze-spotify-track: ${track.name} — ${track.artists[0]?.name} | ${bpm || '?'}bpm ${key || '?'}`)
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
          bpm_confidence: esExtended.bpm_confidence || null,
          brightness: esExtended.brightness || null,
          bass_energy: esExtended.bass_energy || null,
          spectral_centroid: esExtended.spectral_centroid || null,
          spectral_contrast: esExtended.spectral_contrast || null,
          spectral_flux: esExtended.spectral_flux || null,
          mfcc_mean: esExtended.mfcc_mean || null,
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

  // ── POST /agent-import-spotify — import playlist or artist into brain + taste profiles ──
  if (req.method === 'POST' && req.url === '/agent-import-spotify') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    let body = ''
    req.on('data', d => body += d)
    req.on('end', async () => {
      try {
        const { url, apiKey } = JSON.parse(body)
        if (!url)    { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'No URL' })); return }
        if (!apiKey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'No API key' })); return }

        const SUPABASE_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
        const ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
        const sbHeaders = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }

        // ── SINGLE TRACK ──────────────────────────────────────────────
        if (url.includes('/track/')) {
          const trackId = url.split('/track/')[1].split('?')[0].split('/')[0]
          const token = await getSpotifyToken()
          const spH = { 'Authorization': `Bearer ${token}` }

          const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, { headers: spH })
          if (!trackRes.ok) throw new Error(`Spotify track fetch error: ${trackRes.status}`)
          const track = await trackRes.json()

          const artistId  = track.artists?.[0]?.id
          const artistRes = artistId
            ? await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: spH })
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
              const esOut = execSync(`"${ESSENTIA_PYTHON}" "${esTmp}" 2>/dev/null`, { encoding: 'utf8', timeout: 20000 }).trim()
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

          // Save to reference_tracks
          await fetch(`${SUPABASE_URL}/rest/v1/reference_tracks`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
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
          const artistId = url.split('/artist/')[1].split('?')[0].split('/')[0]
          const token = await getSpotifyToken()
          const spH = { 'Authorization': `Bearer ${token}` }

          const [artistRes, relRes] = await Promise.all([
            fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: spH }),
            fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=single,album&limit=1`, { headers: spH })
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
        const id = url.split(isPlaylist ? '/playlist/' : '/artist/')[1].split('?')[0].split('/')[0]

        // 2. Spotify token
        const spotifyToken = await getSpotifyToken()
        const spHeaders = { 'Authorization': `Bearer ${spotifyToken}` }

        // 3/4. Collect track IDs and artist IDs
        const trackItems = []   // { id, name, popularity }
        const artistIdSet = new Set()

        if (isPlaylist) {
          // Paginate up to 500 tracks
          let offset = 0
          while (trackItems.length < 500) {
            const r = await fetch(
              `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&offset=${offset}`,
              { headers: spHeaders }
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
            fetch(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=US`, { headers: spHeaders }),
            fetch(`https://api.spotify.com/v1/artists/${id}/related-artists`, { headers: spHeaders })
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
          const r = await fetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, { headers: spHeaders })
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
Categories: genre_strategy, market_knowledge, production_style, artist_breaking
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
          const src  = path.join(DEMOS_DIR, filename)
          const dest = path.join(submissionDir, filename)
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest)
            copied.push(filename)
            console.log(`  ✓ Copied: ${filename}`)
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
          const probe = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${srcPath}"`, { encoding: 'utf8' })
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
            `"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${srcPath}" 2>/dev/null`,
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
    const filename = decodeURIComponent(req.url.slice(matchedPrefix.length))
    if (filename.includes('..') || filename.includes('/')) { res.writeHead(400); res.end(); return }
    const filepath = path.join(routePrefixes[matchedPrefix], filename)
    if (!fs.existsSync(filepath)) { res.writeHead(404); res.end('not found'); return }
    const stat  = fs.statSync(filepath)
    const mime  = MIME[path.extname(filename).toLowerCase()] || 'audio/mpeg'
    const total = stat.size
    const range = req.headers.range
    const baseHeaders = {
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
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

  // ── POST /agent-chart-analysis — Viral 50 analysis + Essentia + brain storage ──
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
        const cats = [...new Set(
          (Array.isArray(freshCatsData) ? freshCatsData : []).map(r => r.category).filter(Boolean)
        )].sort()

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
${text.slice(0, 1500)}`
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
6. Do not suggest artist_breaking, business, or market_knowledge unless the content is specifically about those topics

New text to categorize:
${text.slice(0, 1500)}

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
        res.end(JSON.stringify({ ok: true, ...result }))
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

        const esOut = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${tmpAudio}" 2>/dev/null`, { encoding: 'utf8', timeout: 60000 }).trim()
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
        const rawResult = execSync(`"${ESSENTIA_PYTHON}" "${ANALYZE_SCRIPT}" "${filePath}" 2>/dev/null`, { encoding: 'utf8', timeout: 60000 })
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
        const token = await getSpotifyToken()
        const spH = { 'Authorization': `Bearer ${token}` }
        const KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

        const allTracks = []
        for (let i = 0; i < newIds.length; i += 50) {
          const batch = newIds.slice(i, i + 50)
          const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, { headers: spH })
          if (!r.ok) { console.warn(`  tracks batch error: ${r.status}`); continue }
          const d = await r.json()
          for (const t of (d.tracks || [])) if (t?.id) allTracks.push(t)
        }

        const allFeatures = []
        for (let i = 0; i < newIds.length; i += 50) {
          const batch = newIds.slice(i, i + 50)
          const r = await fetch(`https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`, { headers: spH })
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
          const r = await fetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, { headers: spH })
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

  // ── GET /ping ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/ping') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }))
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

  // ── POST /cleanup-brain-dupes — delete duplicate brain_knowledge rows ─────
  if (req.method === 'POST' && req.url === '/cleanup-brain-dupes') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    try {
      // Fetch all brain_knowledge rows ordered by id so we keep the earliest (MIN id) per category+title
      const r = await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?select=id,category,title&order=id.asc`, {
        headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
      })
      if (!r.ok) throw new Error('Failed to fetch brain_knowledge: ' + r.status)
      const rows = await r.json()
      const seen = new Map()
      const toDelete = []
      for (const row of rows) {
        const key = `${row.category}||${row.title}`
        if (seen.has(key)) {
          toDelete.push(row.id)
        } else {
          seen.set(key, row.id)
        }
      }
      if (toDelete.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, deleted: 0 }))
        return
      }
      // Delete in batches of 50 using in filter
      let deleted = 0
      for (let i = 0; i < toDelete.length; i += 50) {
        const batch = toDelete.slice(i, i + 50)
        const del = await fetch(`${SUPABASE_URL}/rest/v1/brain_knowledge?id=in.(${batch.join(',')})`, {
          method: 'DELETE',
          headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Prefer': 'return=minimal' }
        })
        if (del.ok) deleted += batch.length
      }
      console.log(`✓ cleanup-brain-dupes: deleted ${deleted} duplicate(s)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, deleted }))
    } catch(e) {
      console.error('cleanup-brain-dupes error:', e.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  server.timeout = 0          // no timeout — needed for large audio file streams
  server.keepAliveTimeout = 0
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Momentum Watcher + Audio Server')
  console.log('  Watch:       ', WATCH_DIR)
  console.log('  Demos:       ', DEMOS_DIR)
  console.log('  Submissions: ', SUBMISSIONS_DIR)
  console.log('  Audio:        http://localhost:4242/audio/')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  exec('/opt/homebrew/bin/python3.11 -c "import essentia"', (err) => {
    if (err) console.warn('⚠ Essentia not available — BPM/key analysis disabled')
    else console.log('✓ Essentia ready')
  })
  // Check new columns exist — warn with SQL if missing
  fetch(`${SUPABASE_URL}/rest/v1/reference_tracks?select=scale,key_strength,valence,acousticness,instrumentalness,duration_seconds,camelot,spectral_centroid,spectral_contrast,spectral_flux,mfcc_mean&limit=1`, { headers: sbHeaders })
    .then(r => {
      if (r.status === 400) console.warn('⚠ reference_tracks missing columns — run SQL in Supabase:\nALTER TABLE reference_tracks ADD COLUMN IF NOT EXISTS scale text, ADD COLUMN IF NOT EXISTS key_strength float, ADD COLUMN IF NOT EXISTS valence float, ADD COLUMN IF NOT EXISTS acousticness float, ADD COLUMN IF NOT EXISTS instrumentalness float, ADD COLUMN IF NOT EXISTS duration_seconds float, ADD COLUMN IF NOT EXISTS camelot text, ADD COLUMN IF NOT EXISTS spectral_centroid float, ADD COLUMN IF NOT EXISTS spectral_contrast float, ADD COLUMN IF NOT EXISTS spectral_flux float, ADD COLUMN IF NOT EXISTS mfcc_mean jsonb;')
    })
    .catch(() => {})
  fetch(`${SUPABASE_URL}/rest/v1/songs?select=audio_analysis&limit=1`, { headers: sbHeaders })
    .then(r => { if (r.status === 400) console.warn('⚠ songs table missing audio_analysis column — run SQL:\nALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_analysis jsonb;') })
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
