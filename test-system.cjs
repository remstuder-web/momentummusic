#!/usr/bin/env node
// test-system.js — Momentum system health tests
// Usage: node test-system.js

const fs = require('fs')
const path = require('path')

// ── Load .env ─────────────────────────────────────────────────────────────────
const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const env = {}
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || ''
const SB_URL        = env.PUBLIC_SUPABASE_URL || 'https://ukqpnjgvjeduipmdaczn.supabase.co'
const SB_KEY        = env.PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
const SB_HEADERS    = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

// ── Helpers ───────────────────────────────────────────────────────────────────
const results = []

function pass(n, label, detail = '') {
  const msg = `TEST ${n} — ${label}: PASS${detail ? ' (' + detail + ')' : ''}`
  console.log('\x1b[32m' + msg + '\x1b[0m')
  results.push({ n, label, ok: true, detail })
}

function fail(n, label, detail = '') {
  const msg = `TEST ${n} — ${label}: FAIL${detail ? ' (' + detail + ')' : ''}`
  console.log('\x1b[31m' + msg + '\x1b[0m')
  results.push({ n, label, ok: false, detail })
}

async function get(url) {
  const r = await fetch(url)
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function post(url, body, headers = { 'Content-Type': 'application/json' }) {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}

// ── TEST 1 — Watcher alive ────────────────────────────────────────────────────
async function test1() {
  try {
    const { body } = await get('http://localhost:4242/status')
    if (body && body.updated) {
      pass(1, 'Watcher alive', `last_task: ${body.last_task || '?'}`)
    } else if (body && body.error === 'no status yet') {
      pass(1, 'Watcher alive', 'status file not yet written')
    } else {
      fail(1, 'Watcher alive', `unexpected response: ${JSON.stringify(body).slice(0, 80)}`)
    }
  } catch (e) {
    fail(1, 'Watcher alive', `connection refused: ${e.message}`)
  }
}

// ── TEST 2 — Category suggestion ──────────────────────────────────────────────
async function test2() {
  try {
    const { body } = await post('http://localhost:4242/suggest-category', {
      text: 'I need to work on my kick drum compression and parallel processing technique',
      existingCategories: [],
      apiKey: ANTHROPIC_KEY
    })
    if (!body || !body.ok) {
      fail(2, 'Category suggestion', `error: ${body?.error || 'no response'}`)
      return
    }
    const suggestion = body.suggestion || ''
    const wrongCats = ['artist_breaking', 'business']
    if (!body.action || !suggestion) {
      fail(2, 'Category suggestion', `missing action/suggestion fields: ${JSON.stringify(body).slice(0, 120)}`)
    } else if (wrongCats.includes(suggestion)) {
      fail(2, 'Category suggestion', `wrong category "${suggestion}" for mixing/production content`)
    } else {
      pass(2, 'Category suggestion', `action=${body.action} suggestion="${suggestion}"`)
    }
  } catch (e) {
    fail(2, 'Category suggestion', e.message)
  }
}

// ── TEST 3 — Spotify intl URL detection ───────────────────────────────────────
async function test3() {
  try {
    const { body } = await post('http://localhost:4242/analyze-spotify-track', {
      url: 'https://open.spotify.com/intl-de/track/55ZZAOtvWkHrEFX10Zg0lP'
    })
    if (body && body.title && body.artist) {
      pass(3, 'Spotify intl URL', `${body.artist} — ${body.title}`)
    } else if (body?.error) {
      fail(3, 'Spotify intl URL', `API error: ${body.error}`)
    } else {
      fail(3, 'Spotify intl URL', `missing title/artist: ${JSON.stringify(body).slice(0, 120)}`)
    }
  } catch (e) {
    fail(3, 'Spotify intl URL', e.message)
  }
}

// ── TEST 4 — Pulse check endpoint runs without error ─────────────────────────
// Pulse check saves to inbox only when Claude finds something new.
// NO_UPDATES is valid — means no noteworthy developments today.
// We verify: (a) endpoint runs without error, (b) any past briefing has real content.
async function test4() {
  try {
    // Step 1: endpoint must return {ok:true}
    const { body } = await post('http://localhost:4242/agent-pulse-check', { apiKey: ANTHROPIC_KEY })
    if (!body?.ok) {
      fail(4, 'Pulse check real data', `endpoint error: ${JSON.stringify(body).slice(0, 120)}`)
      return
    }
    // Step 2: check any existing briefing in inbox for quality (not required to be from this run)
    const r = await fetch(
      `${SB_URL}/rest/v1/inbox_notifications?type=eq.briefing&patch_name=like.Pulse*&order=created_at.desc&limit=1`,
      { headers: SB_HEADERS }
    )
    const rows = await r.json()
    if (!Array.isArray(rows) || !rows.length) {
      // No past pulse briefings — endpoint ran fine, first time
      pass(4, 'Pulse check real data', 'endpoint ok — no past pulse briefings (first run, or today returned NO_UPDATES)')
      return
    }
    const msg = rows[0].message || ''
    const vaguePatterns = ['various artists', 'sources suggest', 'unnamed sources']
    const vague = vaguePatterns.find(p => msg.toLowerCase().includes(p))
    if (vague) {
      fail(4, 'Pulse check real data', `past briefing contains vague phrase: "${vague}"`)
    } else {
      pass(4, 'Pulse check real data', `endpoint ok + past briefing has real content (${msg.length} chars)`)
    }
  } catch (e) {
    fail(4, 'Pulse check real data', e.message)
  }
}

// ── TEST 5 — Morning briefing no hardcoded category DB filter ────────────────
async function test5() {
  try {
    const watcherText = fs.readFileSync(path.join(__dirname, 'momentum-watcher.cjs'), 'utf8')
    // Extract only the morning-briefing handler block (~3000 chars around the handler)
    const handlerStart = watcherText.indexOf("'/morning-briefing'")
    if (handlerStart === -1) { fail(5, 'Briefing no hardcoded categories', 'could not find /morning-briefing handler'); return }
    const handlerBlock = watcherText.slice(handlerStart, handlerStart + 3000)
    // Check for REST API category filter like category=in.(market_knowledge,...)
    const hasCategoryFilter = /category=in\.\([^)]*market_knowledge|category=in\.\([^)]*artist_breaking/.test(handlerBlock)
    const hasCreatedAtDesc = /created_at\.desc/.test(handlerBlock) || /created_at.*desc/.test(handlerBlock)
    if (hasCategoryFilter) {
      fail(5, 'Briefing no hardcoded categories', 'morning-briefing Supabase query still filters by hardcoded categories')
    } else if (!hasCreatedAtDesc) {
      fail(5, 'Briefing no hardcoded categories', 'morning-briefing does not fetch brain by created_at desc')
    } else {
      pass(5, 'Briefing no hardcoded categories', 'no hardcoded category filter, uses created_at desc')
    }
  } catch (e) {
    fail(5, 'Briefing no hardcoded categories', e.message)
  }
}

// ── TEST 6 — Notes-to-feedback returns JSON array ─────────────────────────────
async function test6() {
  if (!ANTHROPIC_KEY) { fail(6, 'Notes-to-feedback JSON', 'no ANTHROPIC_API_KEY in .env'); return }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'You are a music production assistant. Return only JSON arrays.',
        messages: [{
          role: 'user',
          content: 'Convert these notes to feedback: "kick needs more punch, vocals too loud, reverb on snare is too long". Return ONLY a JSON array of strings.'
        }]
      })
    })
    const d = await r.json()
    if (d.error) { fail(6, 'Notes-to-feedback JSON', `API error: ${d.error.message}`); return }
    const raw = d.content?.[0]?.text || ''
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) { fail(6, 'Notes-to-feedback JSON', `no JSON array in response: ${raw.slice(0, 120)}`); return }
    const arr = JSON.parse(match[0])
    if (!Array.isArray(arr) || arr.length < 2) {
      fail(6, 'Notes-to-feedback JSON', `parsed but got ${arr.length} items: ${JSON.stringify(arr)}`)
    } else {
      pass(6, 'Notes-to-feedback JSON', `${arr.length} items: ${JSON.stringify(arr[0])}`)
    }
  } catch (e) {
    fail(6, 'Notes-to-feedback JSON', e.message)
  }
}

// ── TEST 7 — No brain duplicates ──────────────────────────────────────────────
async function test7() {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/brain_knowledge?select=category,title&order=category.asc`,
      { headers: SB_HEADERS }
    )
    const rows = await r.json()
    if (!Array.isArray(rows)) { fail(7, 'No brain duplicates', `unexpected response: ${JSON.stringify(rows).slice(0, 80)}`); return }
    const seen = {}
    const dupes = []
    for (const row of rows) {
      const key = `${row.category}||${row.title}`
      if (seen[key]) dupes.push(`"${row.title}" in [${row.category}]`)
      seen[key] = true
    }
    if (dupes.length > 0) {
      fail(7, 'No brain duplicates', `${dupes.length} duplicate(s): ${dupes.slice(0, 3).join(', ')}`)
    } else {
      pass(7, 'No brain duplicates', `${rows.length} entries, 0 duplicates`)
    }
  } catch (e) {
    fail(7, 'No brain duplicates', e.message)
  }
}

// ── TEST 8 — Git initialized ──────────────────────────────────────────────────
async function test8() {
  const { execSync } = require('child_process')
  try {
    const log = execSync('git log --oneline | head -3', { cwd: __dirname, encoding: 'utf8' })
    const lines = log.trim().split('\n').filter(Boolean)
    if (lines.length > 0) {
      pass(8, 'Git initialized', lines[0])
    } else {
      fail(8, 'Git initialized', 'git log returned no commits')
    }
  } catch (e) {
    fail(8, 'Git initialized', `not a git repo or no commits: ${e.message.slice(0, 80)}`)
  }
}

// ── Run all tests ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n━━━ Momentum System Tests ━━━\n')
  await test1()
  await test2()
  await test3()
  await test4()
  await test5()
  await test6()
  await test7()
  await test8()

  const passed = results.filter(r => r.ok).length
  const total  = results.length
  console.log(`\n━━━ SUMMARY: ${passed}/${total} passed ━━━\n`)

  const failedTests = results.filter(r => !r.ok)
  if (failedTests.length) {
    console.log('FAILED:')
    for (const t of failedTests) console.log(`  TEST ${t.n} — ${t.label}: ${t.detail}`)
    console.log('')
  }

  // Write summary to file for CHANGES.md use
  fs.writeFileSync(
    path.join(__dirname, '.test-results.json'),
    JSON.stringify({ run: new Date().toISOString(), passed, total, results }, null, 2)
  )
  process.exit(failedTests.length > 0 ? 1 : 0)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
