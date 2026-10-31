<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext, parseActions, executeAction } from './mozartContext.js'
  import { onMount } from 'svelte'

  const today = new Date().toDateString()
  const todayISO = new Date().toISOString().slice(0,10)

  const STATIC_LINKS = [
    { id: 'static-gs0', label: 'GEARSPACE', url: 'https://www.gearspace.com' },
    { id: 'static-sp1', label: 'SPOTIFY top german', url: 'https://open.spotify.com/playlist/37i9dQZEVXbJiZcmkrIHGU' },
    { id: 'static-gs1', label: 'GEARSPACE SG', url: 'https://gearspace.com/board/high-end/1213742-serban-ghenea-mixes-all-itb-279.html' },
    { id: 'static-gs2', label: 'GEARSPACE SG THEORIES', url: 'https://gearspace.com/board/so-much-gear-so-little-time/1431838-serban-mixbus-theories-10.html?s=ef8b09b7ee8d9ade4fa681322122e82c' }
  ]

  let state = $state({
    date: today, ticks: {}, customs: [], healthChecks: {}, healthTicks: {},
    helpers: [], helperTicks: {},
    checkItems: [], checkTicks: {}
  })

  let projects = $state([])
  let projectSongs = $state({})
  let allSongs_ = $state([])
  let demoSongs_ = $state([])
  let loading = $state(true)

  // Inline preview audio
  let inlineAudio = null
  let inlinePlayingUrl = $state('')
  let activeSection = $state('routine')

  let newCheck = $state('')
  let newCheckUrl = $state('')
  let normDragging = $state(false)
  let normStatus = $state('')   // '' | 'working' | 'ok' | 'err'
  let normMsg = $state('')
  let titleGenInput = $state('')
  let quickGeminiQ = $state('')
  let quickYoutubeQ = $state('')
  let quickSpotifyQ = $state('')
  let youtubeIngestUrls = $state('')
  let youtubeIngestNote = $state('')
  let youtubeIngesting = $state(false)
  let youtubeIngestResults = $state([])
  let youtubeCopyToast = $state('')
  let titleGenLoading = $state(false)
  let titleGenResults = $state([])

  let acapellaFile = $state(null)
  let acapellaLoading = $state(false)
  let acapellaResult = $state(null)
  let acapellaDragging = $state(false)
  let acapellaMode = $state('acapella') // 'acapella' | 'vocal_clean' | 'instrumental'
  let applioLoading = $state(false)

  let midiFile = $state(null)
  let midiLoading = $state(false)
  let midiResult = $state(null)
  let midiDragging = $state(false)
  let midiSteps = $state([])
  let midiIsAudio = $state(false)
  const MIDI_REF_RE = /\.(mid|midi|wav|mp3|aif|aiff|m4a)$/i
  const MIDI_AUDIO_RE = /\.(wav|mp3|aif|aiff|m4a)$/i
  // audio adds stem separation, chord detection and conversion before the shared steps
  let midiTotalSteps = $derived(midiIsAudio ? 6 : 4)

  let lyricsFile = $state(null)
  let lyricsLoading = $state(false)
  let lyricsResult = $state(null)
  let lyricsDragging = $state(false)
  let lyricsCopied = $state(false)
  let lyricsSaved = $state(false)


  let chartStatus = $state(null)   // { running, current, total } | { date, downloaded, already_had, failed, folder, folder_path, per_source, seen } | null  (+ last_successful_date)
  // Days since the last successful chart download, in Zurich dates (same as the watcher)
  let chartDaysBehind = $derived.by(() => {
    const last = chartStatus?.last_successful_date
    if (!last) return 0
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
    return Math.round((Date.parse(today) - Date.parse(last)) / 86400000)
  })

  async function pollChartStatus() {
    try {
      const r = await fetch('http://localhost:4242/chart-download-status', { signal: AbortSignal.timeout(2000) })
      chartStatus = await r.json()
    } catch(_) { /* watcher down — leave last known state */ }
  }
  async function dismissChartBanner() {
    chartStatus = { ...chartStatus, seen: true }
    try { await fetch('http://localhost:4242/chart-download-seen', { method: 'POST' }) } catch(_) {}
  }
  async function openChartFolder() {
    if (!chartStatus?.folder_path) return
    try {
      await fetch('http://localhost:4242/open-folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: chartStatus.folder_path })
      })
    } catch(_) {}
  }

  let refArtist = $state('')
  let refTitle = $state('')
  let refSpotifyUrl = $state('')
  let refAlbumMode = $state(false)
  let refDownloading = $state(false)
  let refFinding = $state(false)
  let refStatus = $state(null)  // { ok, msg }
  let refProgress = $state([])
  let recentRefMoves = $state([])
  let similarResults = $state([])        // [{artist, title, checked, downloading}]
  let similarDownloadingAll = $state(false)

  async function downloadReference() {
    if (!refArtist.trim() && !refTitle.trim() && !refSpotifyUrl.trim()) return
    refDownloading = true
    refStatus = null
    refProgress = []
    try {
      const r = await fetch('http://localhost:4242/download-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: refArtist.trim(), title: refTitle.trim(), spotify_url: refSpotifyUrl.trim(), album_mode: refAlbumMode })
      })
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'progress') {
              refProgress = [...refProgress, ev.msg]
            } else if (ev.type === 'done') {
              refStatus = { ok: true, msg: ev.msg }
              if (ev.files?.length) recentRefMoves = [...ev.files, ...recentRefMoves].slice(0, 5)
            } else if (ev.type === 'error') {
              refStatus = { ok: false, msg: ev.msg }
            }
          } catch(_) {}
        }
      }
    } catch(e) {
      refStatus = { ok: false, msg: e.message }
    }
    refDownloading = false
  }

  async function findSimilar() {
    if (!refArtist.trim() && !refTitle.trim()) return
    refFinding = true
    similarResults = []
    refStatus = null
    try {
      const r = await fetch('http://localhost:4242/find-similar-tracks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: refArtist.trim(), title: refTitle.trim() })
      })
      const d = await r.json()
      if (d.ok && d.results?.length) {
        similarResults = d.results.map(t => ({ ...t, checked: true, downloading: false, done: false }))
      } else {
        refStatus = { ok: false, msg: 'No similar tracks found' }
      }
    } catch(e) {
      refStatus = { ok: false, msg: 'Find failed: ' + e.message }
    }
    refFinding = false
  }

  async function runYoutubeIngest() {
    const urls = youtubeIngestUrls.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    youtubeIngesting = true
    youtubeIngestResults = []
    try {
      const r = await fetch('/api/brain/youtube-ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, personalNote: youtubeIngestNote.trim() })
      })
      const d = await r.json()
      youtubeIngestResults = (d.results || []).map(res => ({ ...res, categoryOverride: '', saving: false }))
    } catch(e) {
      youtubeIngestResults = urls.map(url => ({ url, status: 'error', error: e.message }))
    }
    youtubeIngesting = false
  }

  // Triggered by a direct button click (not after an awaited fetch) so the
  // clipboard permission's "user gesture" is still fresh — copying right
  // after the long yt-dlp/Claude await above gets silently blocked otherwise.
  function copyYoutubeFindings() {
    const drafts = youtubeIngestResults.filter(res => res.status === 'draft' || res.status === 'success')
    if (!drafts.length) return
    const clip = drafts.map(res => `${res.title}\n${res.content}`).join('\n\n---\n\n')
    navigator.clipboard.writeText(clip).then(() => {
      youtubeCopyToast = 'Copied to clipboard'
      setTimeout(() => youtubeCopyToast = '', 2500)
    }).catch(() => {
      youtubeCopyToast = 'Copy failed'
      setTimeout(() => youtubeCopyToast = '', 2500)
    })
  }

  async function saveYoutubeDraft(idx) {
    const draft = youtubeIngestResults[idx]
    if (!draft || draft.saving) return
    const category = (draft.categoryOverride || draft.category || '').trim()
    if (!category) return
    youtubeIngestResults[idx] = { ...draft, saving: true }
    youtubeIngestResults = [...youtubeIngestResults]
    try {
      const r = await fetch('/api/brain/youtube-confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, sourceUrl: draft.sourceUrl, content: draft.content, tags: draft.tags, category })
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error)
      youtubeIngestResults[idx] = { ...draft, status: 'success', category, saving: false }
    } catch(e) {
      youtubeIngestResults[idx] = { ...draft, saving: false, saveError: e.message }
    }
    youtubeIngestResults = [...youtubeIngestResults]
  }

  async function downloadSimilarOne(idx) {
    const t = similarResults[idx]
    if (!t || t.downloading) return
    similarResults[idx] = { ...t, downloading: true }
    similarResults = [...similarResults]
    try {
      const r = await fetch('http://localhost:4242/download-reference', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: t.artist, title: t.title })
      })
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        for (const line of buf.split('\n')) {
          if (line.startsWith('data: ')) {
            try { const ev = JSON.parse(line.slice(6)); if (ev.type === 'done') similarResults[idx] = { ...similarResults[idx], done: true } } catch(_) {}
          }
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1)
      }
    } catch(e) { console.error('downloadSimilarOne error:', e.message) }
    similarResults[idx] = { ...similarResults[idx], downloading: false }
    similarResults = [...similarResults]
  }

  async function downloadAllChecked() {
    similarDownloadingAll = true
    const toDownload = similarResults.map((t, i) => ({ ...t, idx: i })).filter(t => t.checked && !t.done)
    for (const t of toDownload) await downloadSimilarOne(t.idx)
    similarDownloadingAll = false
  }

  async function findOnSpotify() {
    if (!refArtist.trim() && !refTitle.trim() && !refSpotifyUrl.trim()) return
    refFinding = true
    refStatus = null
    try {
      const r = await fetch('http://localhost:4242/find-on-spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: refArtist.trim(), title: refTitle.trim(), spotify_url: refSpotifyUrl.trim() })
      })
      const d = await r.json()
      if (d.ok) {
        refStatus = { ok: true, msg: `✓ Added: ${d.artist} — ${d.title}` }
      } else {
        refStatus = { ok: false, msg: d.error || 'Not found' }
      }
    } catch(e) {
      refStatus = { ok: false, msg: e.message }
    }
    refFinding = false
  }

  async function pollRefMoves() {
    try {
      const r = await fetch('http://localhost:4242/recent-reference-moves')
      const d = await r.json()
      if (Array.isArray(d.files)) recentRefMoves = d.files
    } catch(_) {}
  }

  let newCustom = $state(''), newCustomUrl = $state(''), newHealth = $state('')

  // Mozart
  let aiInput = $state(''), aiMessages = $state([]), aiLoading = $state(false)
  let chatContainer = $state(null)
  $effect(() => {
    if (aiMessages.length && chatContainer) {
      setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight }, 50)
    }
  })
  let correctionInputs = $state({}) // keyed by message index

  let speakingId = $state(null)
  let openArticles = $state({})
  let currentAudio = $state(null)
  let speakToast = $state('')
  let speakToastTimer = null
  let librarySpotifyIds = $state(new Set())

  async function loadLibraryIds() {
    const { data } = await supabase
      .from('reference_tracks')
      .select('spotify_id')
      .in('source', ['agent', 'user', 'mozart', 'promoted', 'chart'])
      .not('spotify_id', 'is', null)
    librarySpotifyIds = new Set((data || []).map(r => r.spotify_id).filter(Boolean))
  }

  function showSpeakToast(msg) {
    speakToast = msg
    if (speakToastTimer) clearTimeout(speakToastTimer)
    speakToastTimer = setTimeout(() => speakToast = '', 3500)
  }

  // Goals
  let activeGoals = $state([])

  async function loadGoals() {
    const { data } = await supabase
      .from('brain_knowledge')
      .select('id,title,content')
      .eq('active', true)
      .eq('category', 'goal')
      .order('created_at', { ascending: false })
    activeGoals = data || []
  }

  async function speakText(id, text) {
    if (speakingId === id) {
      if (currentAudio) { currentAudio.pause(); currentAudio = null }
      speakingId = null
      return
    }
    if (currentAudio) { currentAudio.pause(); currentAudio = null }
    speakingId = id
    try {
      const res = await fetch('http://localhost:4242/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4000) })
      })
      if (!res.ok) {
        try {
          const data = await res.json()
          if (data.error) showSpeakToast('Add OPENAI_API_KEY to .env to enable audio')
        } catch(_) {}
        speakingId = null
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      audio.onended = () => { speakingId = null; currentAudio = null; URL.revokeObjectURL(url) }
      audio.onerror = () => { speakingId = null; currentAudio = null }
      audio.play()
    } catch(e) { speakingId = null }
  }

  // Check Out — brain_knowledge entries surfaced for daily review
  let checkOutItems = $state([])

  async function loadStaticData() {
    const keys = ['customs', 'helpers', 'helper_ticks', 'check_items']
    const { data } = await supabase.from('user_settings').select('key, value').in('key', keys)
    const map = {}
    for (const row of (data || [])) map[row.key] = JSON.parse(row.value)

    if (map.customs) {
      state.customs = map.customs
    } else {
      const { data: fb } = await supabase.from('daily_state')
        .select('customs').not('customs', 'eq', '[]').order('date', { ascending: false }).limit(1).maybeSingle()
      state.customs = fb?.customs || []
      await saveCustoms()
    }

    if (map.helpers) {
      state.helpers = map.helpers
    } else {
      const { data: fb } = await supabase.from('daily_state')
        .select('helpers').not('helpers', 'eq', '[]').order('date', { ascending: false }).limit(1).maybeSingle()
      state.helpers = fb?.helpers || []
      await saveHelpers()
    }

    if (map.helper_ticks) state.helperTicks = map.helper_ticks

    if (map.check_items) {
      state.checkItems = map.check_items
    } else {
      // Migrate from daily_state fallback to user_settings for persistence
      const { data: fb } = await supabase.from('daily_state')
        .select('check_items').not('check_items', 'eq', '[]').order('id', { ascending: false }).limit(1).maybeSingle()
      if (fb?.check_items?.length) {
        state.checkItems = fb.check_items
        await saveCheckItems()
      }
    }
  }

  async function load() {
    try {
      const { data: proj } = await supabase.from('projects').select('id,name,artist,color,deadlines').order('position')
      projects = proj || []
      const { data: allSongs } = await supabase.from('songs').select('id,title,code,project_id,work_data').not('project_id','is',null)
      const { data: demoSongs } = await supabase.from('songs').select('id,title,code').is('project_id',null)
      const songMap = {}
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) { if (!songMap[p.id]) songMap[p.id] = []; songMap[p.id].push(s) }
      })
      // Also key by name for backwards compat
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) { if (!songMap[p.name]) songMap[p.name] = []; songMap[p.name].push(s) }
      })
      allSongs_ = allSongs || []
      demoSongs_ = demoSongs || []
      projectSongs = songMap
      const { data } = await supabase.from('daily_state').select('*').eq('date', today).maybeSingle()

      if (data) {
        state = { ...state,
          ticks: data.ticks||{},
          healthChecks: data.health_checks||[], healthTicks: data.health_ticks||{},
          helperTicks: data.helper_ticks||{},
          checkTicks: data.check_ticks||{}
          // checkItems loaded from user_settings in loadStaticData (persistent)
        }
      }
    } catch(e) { console.error('LOAD ERROR:', e) }
    loading = false
  }

  async function saveCustoms() {
    await supabase.from('user_settings').upsert({ key: 'customs', value: JSON.stringify(state.customs) }, { onConflict: 'key' })
  }
  async function saveHelpers() {
    await supabase.from('user_settings').upsert({ key: 'helpers', value: JSON.stringify(state.helpers) }, { onConflict: 'key' })
  }
  async function saveCheckItems() {
    await supabase.from('user_settings').upsert({ key: 'check_items', value: JSON.stringify(state.checkItems) }, { onConflict: 'key' })
  }
  async function saveHelperTicks() {
    await supabase.from('user_settings').upsert({ key: 'helper_ticks', value: JSON.stringify(state.helperTicks) }, { onConflict: 'key' })
  }

  async function save() {
    await supabase.from('daily_state').upsert({
      date: today,
      ticks: state.ticks,
      health_ticks: state.healthTicks
    }, { onConflict: 'date' })
  }

  async function tick(id) { state.ticks = {...state.ticks, [id]: !state.ticks[id]}; await save() }

  async function tickHealth(id) { state.healthTicks = {...state.healthTicks, [id]: !state.healthTicks[id]}; await save() }
  async function addCustom() {
    if (!newCustom.trim()) return
    state.customs = [...state.customs, { id: 'c'+Date.now(), label: newCustom.trim(), url: newCustomUrl.trim() }]
    newCustom = ''; newCustomUrl = ''; await saveCustoms()
  }
  async function delCustom(id) { state.customs = state.customs.filter(c => c.id !== id); await saveCustoms() }
  async function addHealth() {
    if (!newHealth.trim()) return
    state.healthChecks = [...(state.healthChecks||[]), { id: 'h'+Date.now(), label: newHealth.trim() }]
    newHealth = ''; await save()
  }
  async function delHealth(id) {
    state.healthChecks = (state.healthChecks||[]).filter(h => h.id !== id)
    const ht = {...state.healthTicks}; delete ht[id]; state.healthTicks = ht; await save()
  }

  let newHelper = $state(''), newHelperUrl = $state('')
  let helperSearchInputs = $state({})

  function getHelperSearchConfig(url) {
    if (!url) return null
    if (url.includes('youtube.com') || url.includes('youtu.be'))
      return { placeholder: 'Search YouTube...', buildUrl: q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) }
    if (url.includes('open.spotify.com') || url.includes('spotify.com'))
      return { placeholder: 'Search Spotify...', buildUrl: q => 'https://open.spotify.com/search/' + encodeURIComponent(q) }
    if (url.includes('gemini.google.com'))
      return { placeholder: 'Ask Gemini...', buildUrl: q => 'https://gemini.google.com/app?q=' + encodeURIComponent(q) }
    if (url.includes('deepseek.com'))
      return { placeholder: 'Ask DeepSeek...', buildUrl: q => 'https://chat.deepseek.com/?q=' + encodeURIComponent(q) }
    return null
  }

  async function tickHelper(id) { state.helperTicks = {...state.helperTicks, [id]: !state.helperTicks[id]}; await saveHelperTicks() }
  async function addHelper() {
    if (!newHelper.trim()) return
    state.helpers = [...(state.helpers||[]), { id: 'h'+Date.now(), label: newHelper.trim(), url: newHelperUrl.trim() }]
    newHelper = ''; newHelperUrl = ''; await saveHelpers()
  }
  async function delHelper(id) { state.helpers = (state.helpers||[]).filter(h => h.id !== id); await saveHelpers() }
  async function moveHelper(id, dir) {
    const arr = [...(state.helpers||[])]
    const idx = arr.findIndex(h => h.id === id), ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp; state.helpers = arr; await saveHelpers()
  }

  async function generateTitles() {
    if (!titleGenInput.trim() || titleGenLoading) return
    titleGenLoading = true
    titleGenResults = []
    try {
      const r = await fetch('http://localhost:4242/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: titleGenInput.trim() })
      })
      const d = await r.json()
      titleGenResults = d.titles || []
    } catch(e) { alert('Title generator error: ' + e.message) }
    titleGenLoading = false
  }

  async function moveCustom(id, dir) {
    const arr = [...(state.customs||[])]
    const idx = arr.findIndex(c => c.id === id)
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    state.customs = arr; await saveCustoms()
  }
  async function moveHealth(id, dir) {
    const arr = [...(state.healthChecks||[])]
    const idx = arr.findIndex(h => h.id === id)
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    state.healthChecks = arr; await save()
  }

  async function addCheck() {
    if (!newCheck.trim()) return
    const item = { id: 'ck'+Date.now(), label: newCheck.trim(), url: newCheckUrl.trim() }
    state.checkItems = [...(state.checkItems||[]), item]
    newCheck = ''; newCheckUrl = ''
    await saveCheckItems()
  }
  async function delCheck(id) {
    state.checkItems = (state.checkItems||[]).filter(i => i.id !== id)
    await saveCheckItems()
  }
  async function moveCheck(id, dir) {
    const arr = [...(state.checkItems||[])]
    const i = arr.findIndex(x => x.id === id)
    if (i + dir < 0 || i + dir >= arr.length) return
    ;[arr[i], arr[i+dir]] = [arr[i+dir], arr[i]]
    state.checkItems = arr; await saveCheckItems()
  }

  let inboxItems = $state([])
  let inboxUnread = $state(0)
  let generatingBriefing = $state(false)
  let autoBriefingLoading = $state(false)
  let agentLastRun = $state({})
  let todayBriefing = $derived(inboxItems.find(n => n.type === 'briefing' && n.created_at?.slice(0,10) === todayISO))
  let pressItems = $derived(inboxItems.filter(n => n.type === 'press' && n.created_at?.slice(0,10) === todayISO).slice(0, 3))
  let scoutingArtists = $state(false)

  // WhatsApp on-demand analysis
  let waContacts = $state([])
  let waSelectedContact = $state('')
  let waAnalyzing = $state(false)
  let waResult = $state(null)
  let waError = $state('')

  async function loadWaContacts() {
    try {
      const r = await fetch('http://localhost:4242/whatsapp-contacts')
      const d = await r.json()
      if (d.ok) waContacts = (d.contacts || []).filter(c => c.monitored && !c.is_group)
    } catch(e) {}
  }

  async function analyzeWaContact() {
    if (!waSelectedContact || waAnalyzing) return
    waAnalyzing = true
    waResult = null
    waError = ''
    try {
      const r = await fetch('http://localhost:4242/analyze-whatsapp-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactName: waSelectedContact })
      })
      const d = await r.json()
      if (d.ok) waResult = d
      else waError = d.error || 'Analysis failed'
    } catch(e) { waError = e.message }
    waAnalyzing = false
  }

  function timeAgo(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000)
    if (mins < 60) return mins + 'm ago'
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return hrs + 'h ago'
    return Math.round(hrs / 24) + 'd ago'
  }

  async function generateBriefing() {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (apiKey) localStorage.setItem('mm_api_key', apiKey)
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    generatingBriefing = true
    try {
      const res = await fetch('http://localhost:4242/morning-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      agentLastRun = { ...agentLastRun, briefing: new Date().toISOString() }
      await loadInbox()
    } catch(e) {
      alert('Briefing error: ' + e.message + '\nMake sure watcher is running.')
    }
    generatingBriefing = false
  }

  async function scoutArtists() {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    scoutingArtists = true
    try {
      const res = await fetch('http://localhost:4242/agent-scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      agentLastRun = { ...agentLastRun, scout: new Date().toISOString() }
      await loadInbox()
    } catch(e) {
      alert('Scout error: ' + e.message + '\nMake sure watcher is running.')
    }
    scoutingArtists = false
  }



  async function loadInbox() {
    // Delete old notifications first: feedback after 1 day, downloads after 7 days
    const oneDayAgo  = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'feedback').lt('created_at', oneDayAgo)
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'download').lt('created_at', sevenDaysAgo)
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'reference').lt('metadata->>expires', new Date().toISOString())

    const { data } = await supabase.from('inbox_notifications')
      .select('*').order('created_at', { ascending: false }).limit(50)
    inboxItems = data || []
    inboxUnread = inboxItems.filter(n => !n.read).length

    // Seed last-run timestamps from most recent notification per agent
    const titleToKey = { 'Morning Briefing': 'briefing', 'Artist Scout': 'scout', 'Demo Match': 'match', 'Pulse Check': 'pulse' }
    const seeded = {}
    for (const n of inboxItems) {
      const key = titleToKey[n.song_title]
      if (key && !seeded[key]) seeded[key] = n.created_at
    }
    agentLastRun = { ...agentLastRun, ...seeded }
  }

  // Check share_sessions for new downloads and create inbox notifications
  async function syncDownloadNotifications() {
    try {
      const { data: sessions } = await supabase
        .from('share_sessions')
        .select('id, patch_name, songs, downloads, feedback_enabled, created_at')
        .neq('downloads', '{}')
        .not('downloads', 'is', null)
      if (!sessions?.length) return

      // Use Supabase as source of truth — not localStorage — so deleting a notification is permanent
      const { data: existing } = await supabase
        .from('inbox_notifications')
        .select('session_id, song_code')
        .eq('type', 'download')
      const alreadyNotified = new Set((existing || []).map(r => `${r.session_id}::${r.song_code}`))

      const toInsert = []
      for (const session of sessions) {
        const dlCodes = Object.keys(session.downloads || {})
        for (const code of dlCodes) {
          if (alreadyNotified.has(`${session.id}::${code}`)) continue
          const songEntry = (session.songs || []).find(s => s.code === code)
          toInsert.push({
            type: 'download',
            song_code: code,
            song_title: songEntry?.title || code,
            artist: '',
            session_id: session.id,
            patch_name: session.patch_name || '',
            message: `Downloaded from listen link`,
            read: false
          })
        }
      }

      if (toInsert.length) {
        await supabase.from('inbox_notifications').insert(toInsert)
        await loadInbox()
      }
    } catch(e) { console.warn('syncDownloadNotifications error:', e.message) }
  }

  async function markInboxRead() {
    const unreadIds = inboxItems.filter(n => !n.read).map(n => n.id)
    if (!unreadIds.length) return
    await supabase.from('inbox_notifications').update({ read: true }).in('id', unreadIds)
    inboxItems = inboxItems.map(n => ({ ...n, read: true }))
    inboxUnread = 0
  }

  async function addChartTrackToBrain(track) {
    const entry = `${track.artist} — ${track.title}${track.spotify_id ? ' (spotify:' + track.spotify_id + ')' : ''}`
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'reference_current', entry, source: 'chart', notes: track.source || ''
    })
    if (!error) alert(`Added to brain: ${track.artist} — ${track.title}`)
    else alert('Error: ' + error.message)
  }

  async function addChartTrackToLibrary(track) {
    const res = await fetch('http://localhost:4242/save-to-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: track.title, artist: track.artist, spotify_id: track.spotify_id || null,
        source: 'chart', collection_name: 'chart_pick'
      })
    })
    const j = await res.json().catch(() => ({}))
    if (j.ok) {
      if (track.spotify_id) librarySpotifyIds = new Set([...librarySpotifyIds, track.spotify_id])
      alert(`Saved to library: ${track.artist} — ${track.title}`)
    } else alert('Error: ' + (j.error || 'unknown'))
  }

  function playSpotifyTrack(spotifyId) {
    window.open(`https://open.spotify.com/track/${spotifyId}`, '_blank')
  }

  async function deleteInboxItem(id) {
    // For download notifications: also remove from share_sessions.downloads so sync won't re-create it
    const notif = inboxItems.find(n => n.id === id)
    if (notif?.type === 'download' && notif.session_id && notif.song_code) {
      const { data: sess } = await supabase.from('share_sessions').select('downloads').eq('id', notif.session_id).maybeSingle()
      if (sess?.downloads) {
        const updated = { ...sess.downloads }
        delete updated[notif.song_code]
        await supabase.from('share_sessions').update({ downloads: updated }).eq('id', notif.session_id)
      }
    }
    await supabase.from('inbox_notifications').delete().eq('id', id)
    inboxItems = [...inboxItems.filter(n => n.id !== id)]
    inboxUnread = inboxItems.filter(n => !n.read).length
  }

  // Mozart
  async function sendAI(rawMsg) {
    const msg = (typeof rawMsg === 'string' && rawMsg.trim()) ? rawMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''

    const mozartContext = await buildMozartContext(supabase, {})

    const system = `You are this producer's co-intelligence.
A sharp, direct thinking partner for music production decisions.
Today: ${todayISO}.

CHARACTER:
- Challenge assumptions before confirming them
- Offer the angle the producer hasn't considered
- Be specific — no generic music industry advice
- For recommendations note: ✓ [why this works] / ✗ [what speaks against it]
- When corrected, acknowledge it and update your reasoning

${mozartContext}`
    const payload = { system, messages: aiMessages.slice(-10).map(m => ({ role: m.role, content: m.content })), apiKey }
    try {
      console.log('Mozart request:', JSON.stringify(payload))
      const res = await fetch('http://localhost:4242/mozart-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      console.log('Mozart response:', JSON.stringify(data))
      if (data.error) throw new Error(data.error)
      let reply = data.content?.find(b => b.type === 'text')?.text || 'No response.'
      if (reply.length > 300 && /research|found|analysis|suggests|shows|according|trend|data|insight|indicates/i.test(reply)) {
        reply += '\n\n---\n💡 Worth saving to Brain? Paste the key insight in Brain dump.'
      }
      const actions = parseActions(reply)
      const cleanReply = reply.replace(/\[ACTION:[^\]]+\]/g, '').trim()
      aiMessages = [...aiMessages, { role: 'assistant', content: cleanReply }]
      for (const action of actions) {
        const result = await executeAction(action, supabase, null)
        if (result) aiMessages = [...aiMessages, { role: 'assistant', content: result, _system: true }]
      }
    } catch(e) {
      console.log('Mozart error:', e)
      aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: '+e.message }]
    }
    aiLoading = false
  }


  function getTracksFromMessage(msg) {
    if (!msg) return []
    const m = msg.match(/<!--TRACKS:([\s\S]*?)-->/)
    if (!m) return []
    try { return JSON.parse(m[1]) } catch { return [] }
  }

  function stripTracksFromMessage(msg) {
    return (msg || '').replace(/\n*<!--TRACKS:[\s\S]*?-->/g, '')
  }

  async function addTrackToBrain(track) {
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'reference_current',
      title: `${track.artist} — ${track.title}`,
      content: [
        track.bpm ? `${Math.round(track.bpm)}bpm` : null,
        track.key ? `${track.key}${track.scale ? ' ' + track.scale : ''}${track.camelot ? ' (' + track.camelot + ')' : ''}` : null,
        track.energy != null ? `nrg ${Number(track.energy).toFixed(2)}` : null,
        track.source ? `source: ${track.source}` : null,
      ].filter(Boolean).join(' · '),
      entry_type: 'reference_track',
      confidence: 'medium',
      active: true,
      metadata: { source_type: track.source, spotify_id: track.spotify_id }
    })
    await supabase.from('reference_tracks').insert({
      title: track.title,
      artist: track.artist,
      spotify_id: track.spotify_id || null,
      preview_url: track.spotify_url || null,
      source: 'checkout',
      checkout_date: new Date().toISOString(),
      collection_name: 'reference_current',
      approved: true
    })
    if (!error) alert(`Saved to Brain: ${track.artist} — ${track.title}`)
    else alert('Error saving: ' + error.message)
  }

  function addTrackButtons(html, tracks) {
    // Detect "Artist — Title" or "Artist - Title" (spaces required around plain hyphen)
    return html.replace(
      /([A-Z][^—<\n]{1,35})\s*(?:—| - )\s*([^<\n,;(—]{2,50})/g,
      (match, artist, title) => {
        const a = artist.trim()
        const t = title.trim()
        if (a.length < 2 || t.length < 2) return match
        const track = tracks?.find(tr =>
          tr.title?.toLowerCase().includes(t.toLowerCase()) ||
          tr.artist?.toLowerCase().includes(a.toLowerCase())
        )
        const url = (track?.spotify_url ||
          'https://open.spotify.com/search/' + encodeURIComponent(a + ' ' + t))
          .replace(/"/g, '&quot;')
        const previewUrl = (track?.preview_url || '').replace(/"/g, '&quot;')
        return match +
          ` <button class="inline-play-btn" data-url="${url}" data-preview="${previewUrl}">▶</button>` +
          ` <button class="inline-brain-btn" data-artist="${a.replace(/"/g,'&quot;')}" data-title="${t.replace(/"/g,'&quot;')}" data-url="${url}">+</button>`
      }
    )
  }

  function parseAgentOutput(text) {
    if (!text) return ''
    const tracks = getTracksFromMessage(text)
    text = stripTracksFromMessage(text)
    // Strip "▶ YOUTUBE TOP N\n<anything>" blocks (YouTube data unavailable)
    text = text.replace(/▶\s*YOUTUBE TOP \d+[^\n]*\n[^\n]*/gi, '')
    // Strip standalone --- / -- separators
    text = text.replace(/^-{2,}\s*$/gm, '')
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const lines = text.split('\n')
    let html = ''
    let inNextMove = false

    function closeNextMove() {
      if (inNextMove) { html += '</div>'; inNextMove = false }
    }

    function colorTagLine(s) {
      return s
        .replace(/\[GAP\]/g,       '<span class="ao-tag-gap">[GAP]</span>')
        .replace(/\[OK\]/g,        '<span class="ao-tag-ok">[OK]</span>')
        .replace(/\[CONFIRMED\]/g, '<span class="agent-label-confirmed">[CONFIRMED]</span>')
        .replace(/\[TENSION\]/g,   '<span class="agent-label-tension">[TENSION]</span>')
        .replace(/\[OUTDATED\]/g,  '<span class="agent-label-outdated">[OUTDATED]</span>')
        .replace(/\[NEW\]/g,       '<span class="agent-label-new">[NEW]</span>')
    }

    for (const rawLine of lines) {
      const t = rawLine.trim()
      if (!t) continue
      if (/^[-—]{1,3}$/.test(t) || t.toLowerCase() === 'unavailable' || t.toLowerCase() === 'n/a') continue

      if (t.startsWith('## ')) {
        closeNextMove()
        const title = esc(t.slice(3).trim())
        const isNextMoveOrStep = /^NEXT (MOVE|STEP)$/i.test(title)
        html += `<div class="agent-header">${title}</div>`
        if (isNextMoveOrStep) { html += '<div class="agent-next-move">'; inNextMove = true }
      } else if (t.startsWith('- ') || t.startsWith('• ')) {
        const parts = t.replace(/^[-•]\s+/, '').split(/\s+[-•]\s+/)
        for (const part of parts) {
          if (part.trim()) {
            const content = addTrackButtons(colorTagLine(esc(part.trim())), tracks)
            html += `<div class="agent-bullet">${content}</div>`
          }
        }
      } else if (/^\d+\.\s/.test(t)) {
        const content = addTrackButtons(colorTagLine(esc(t.replace(/^\d+\.\s+/, ''))), tracks)
        html += `<div class="agent-bullet">${content}</div>`
      } else if (t.startsWith('[GAP]')) {
        html += `<div class="agent-gap">${colorTagLine(esc(t))}</div>`
      } else if (t.startsWith('[OK]')) {
        html += `<div class="agent-ok">${colorTagLine(esc(t))}</div>`
      } else if (t.length > 100) {
        const sentences = t.split(/(?<=\. )/)
        for (const s of sentences) {
          if (s.trim()) {
            const content = addTrackButtons(colorTagLine(esc(s.trim())), tracks)
            html += `<div class="agent-p">${content}</div>`
          }
        }
      } else {
        const content = addTrackButtons(colorTagLine(esc(t)), tracks)
        html += `<div class="agent-p">${content}</div>`
      }
    }
    closeNextMove()
    return html
  }

  function formatMozartOutput(text) {
    if (!text) return ''
    return text
      .replace(/^## (.+)$/gm, '<div class="moz-header">$1</div>')
      .replace(/\[GAP\]/g, '<span class="moz-gap">[GAP]</span>')
      .replace(/\[OK\]/g, '<span class="moz-ok">[OK]</span>')
      .replace(/\[CONFIRMED\]/g, '<span class="moz-confirmed">[CONFIRMED]</span>')
      .replace(/\[TENSION\]/g, '<span class="moz-tension">[TENSION]</span>')
      .replace(/\[OUTDATED\]/g, '<span class="moz-outdated">[OUTDATED]</span>')
      .replace(/\[NEW\]/g, '<span class="moz-new">[NEW]</span>')
      .replace(/^[-•] (.+)$/gm, '<div class="moz-bullet">$1</div>')
      .replace(/^\d+\. (.+)$/gm, '<div class="moz-bullet">$1</div>')
      .replace(/<div class="moz-header">(Next Step|Next Move)<\/div>\n?/g, '<div class="moz-next-label">NEXT STEP</div>')
      .replace(/\n\n/g, '<div class="moz-spacer"></div>')
      .replace(/\n/g, '<br>')
  }

  async function reloadProjectData() {
    try {
      const { data: proj } = await supabase.from('projects').select('id,name,artist,color,deadlines').order('position')
      projects = proj || []
      const { data: allSongs } = await supabase.from('songs').select('id,title,code,project_id,work_data').not('project_id','is',null)
      const { data: demoSongs } = await supabase.from('songs').select('id,title,code').is('project_id',null)
      allSongs_ = allSongs || []
      demoSongs_ = demoSongs || []
      const songMap = {}
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) {
          if (!songMap[p.id]) songMap[p.id] = []
          songMap[p.id].push(s)
          if (!songMap[p.name]) songMap[p.name] = []
          songMap[p.name].push(s)
        }
      })
      projectSongs = songMap
      // Also reload today's tasks in case Projects tab added some
      const { data: ds } = await supabase.from('daily_state').select('tasks').eq('date', today).maybeSingle()
      if (ds?.tasks) state = { ...state, tasks: ds.tasks }
    } catch(e) {}
  }

  async function loadCheckOut() {
    const { data } = await supabase
      .from('brain_knowledge')
      .select('id, title, category, source_url, metadata')
      .eq('surfaced_in_daily', true)
      .gte('surfaced_until', todayISO)
      .or('reviewed.is.null,reviewed.eq.false')
      .order('created_at', { ascending: false })
    checkOutItems = data || []
  }

  async function dismissCheckOut(id) {
    await supabase.from('brain_knowledge').update({ surfaced_in_daily: false, reviewed: true }).eq('id', id)
    checkOutItems = checkOutItems.filter(i => i.id !== id)
  }

  function handleAcapellaDrop(e) {
    e.preventDefault()
    acapellaDragging = false
    const file = e.dataTransfer.files[0]
    if (file) { acapellaFile = file; acapellaResult = null }
  }

  async function runAcapellaExtract() {
    if (!acapellaFile) return
    acapellaLoading = true
    acapellaResult = null
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.readAsDataURL(acapellaFile)
    })
    const ext = acapellaFile.name.split('.').pop()
    const endpoint = acapellaMode === 'vocal_clean' ? '/extract-vocal-clean'
                   : acapellaMode === 'instrumental' ? '/extract-instrumental'
                   : '/extract-acapella'
    try {
      const r = await fetch('http://localhost:4242' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: base64, ext })
      })
      acapellaResult = await r.json()
    } catch(e) {
      acapellaResult = { ok: false, error: e.message }
    }
    acapellaLoading = false
    acapellaFile = null
  }

  async function openApplio() {
    applioLoading = true
    try {
      await fetch('http://localhost:4242/start-applio', { method: 'POST' })
    } catch(e) {}
    window.open('http://localhost:6969', '_blank', 'width=1400,height=900,left=100,top=50')
    applioLoading = false
  }

  function handleMidiDrop(e) {
    e.preventDefault()
    midiDragging = false
    const file = e.dataTransfer.files[0]
    if (file && MIDI_REF_RE.test(file.name)) { midiFile = file; midiIsAudio = MIDI_AUDIO_RE.test(file.name); midiResult = null; midiSteps = [] }
  }

  async function runMidiGenerate() {
    if (!midiFile || midiLoading) return
    midiLoading = true
    midiResult = null
    midiSteps = []
    const apiKey = localStorage.getItem('mm_api_key') || ''
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.readAsDataURL(midiFile)
    })
    const ext = midiFile.name.split('.').pop().toLowerCase()
    const filename = midiFile.name.replace(/\.[^.]+$/, '')
    try {
      const response = await fetch('http://localhost:4242/generate-midi-from-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: base64, ext, filename, apiKey })
      })
      const reader2 = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader2.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.step) midiSteps = [...midiSteps, event.step]
            if (event.done) { midiResult = event; midiLoading = false }
            if (event.error) { midiResult = { ok: false, error: event.error }; midiLoading = false }
          } catch {}
        }
      }
    } catch(e) {
      midiResult = { ok: false, error: e.message }
      midiLoading = false
    }
    midiFile = null
  }

  function handleLyricsDrop(e) {
    e.preventDefault()
    lyricsDragging = false
    const file = e.dataTransfer.files[0]
    if (file && /\.(wav|mp3|m4a)$/i.test(file.name)) { lyricsFile = file; lyricsResult = null; lyricsCopied = false; lyricsSaved = false }
  }

  async function runLyricsExtract() {
    if (!lyricsFile || lyricsLoading) return
    lyricsLoading = true
    lyricsResult = null
    lyricsCopied = false
    lyricsSaved = false
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.readAsDataURL(lyricsFile)
    })
    const ext = lyricsFile.name.split('.').pop().toLowerCase()
    const filename = lyricsFile.name
    try {
      const r = await fetch('http://localhost:4242/extract-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: base64, ext, filename })
      })
      lyricsResult = await r.json()
    } catch(e) {
      lyricsResult = { ok: false, error: e.message }
    }
    lyricsLoading = false
    lyricsFile = null
  }

  function copyLyrics() {
    if (!lyricsResult?.lyrics) return
    navigator.clipboard.writeText(lyricsResult.lyrics).then(() => {
      lyricsCopied = true
      setTimeout(() => lyricsCopied = false, 2000)
    })
  }

  async function saveLyricsToBrain() {
    if (!lyricsResult?.lyrics || lyricsSaved) return
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'own_production',
      title: `Lyrics — ${lyricsResult.filename || 'extracted'}`,
      content: lyricsResult.lyrics,
      active: true
    })
    if (!error) lyricsSaved = true
    else alert('Error: ' + error.message)
  }

  // loadStaticData MUST complete before load() so customs/helpers aren't lost to the state spread
  ;(async () => { await loadStaticData(); load() })()
  ;(async () => { await loadInbox() })()
  loadCheckOut()
  loadGoals()
  loadWaContacts()

  onMount(() => {
    syncDownloadNotifications()
    loadLibraryIds()
    const onFocus = () => reloadProjectData()
    const onVisible = () => { if (document.visibilityState === 'visible') reloadProjectData() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    const onInlineClick = (e) => {
      const playBtn = e.target.closest('.inline-play-btn')
      if (playBtn) {
        const previewUrl = playBtn.dataset.preview
        const spotifyUrl = playBtn.dataset.url
        if (previewUrl) {
          if (inlinePlayingUrl === previewUrl) {
            inlineAudio?.pause()
            inlinePlayingUrl = ''
            playBtn.textContent = '▶'
            return
          }
          inlineAudio?.pause()
          document.querySelectorAll('.inline-play-btn').forEach(b => { b.textContent = '▶' })
          inlineAudio = new Audio(previewUrl)
          inlineAudio.volume = 0.8
          inlineAudio.play()
          inlinePlayingUrl = previewUrl
          playBtn.textContent = '■'
          inlineAudio.onended = () => { inlinePlayingUrl = ''; playBtn.textContent = '▶' }
        } else if (spotifyUrl) {
          window.open(spotifyUrl, 'momentum_popup', 'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes')
        }
        return
      }
      const brainBtn = e.target.closest('.inline-brain-btn')
      if (brainBtn) addTrackToBrain({ artist: brainBtn.dataset.artist, title: brainBtn.dataset.title, spotify_url: brainBtn.dataset.url })
    }
    document.addEventListener('click', onInlineClick)

    pollChartStatus()
    const chartPoll = setInterval(pollChartStatus, 30000)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('click', onInlineClick)
      clearInterval(chartPoll)
    }
  })
</script>

{#if loading}
  <p class="empty">Loading...</p>
{:else}

<!-- ASK MOZART — full-width, first thing on the page -->
<div class="mozart-top">
  <div class="mozart-title-row">
    <div class="mozart-title">ASK MOZART</div>
    {#if aiMessages.length}
      <button class="clear-chat" onclick={() => aiMessages = []}>Clear</button>
    {/if}
  </div>
  <div class="chat-input-row">
    <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..." onkeydown={e=>e.key==='Enter'&&sendAI()} />
    <button class="btn-gold-sm" onclick={() => sendAI()}>Ask</button>
  </div>
  {#if aiMessages.length || aiLoading}
    <div class="chat-out" bind:this={chatContainer}>
      {#each aiMessages as msg, i}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
          <div class="chat-text">{@html msg.role === 'assistant' ? formatMozartOutput(msg.content) : msg.content}</div>
          {#if msg.role === 'assistant'}
            <div class="chat-correction-row">
              <button class="btn-wrong" onclick={() => correctionInputs = {...correctionInputs, [i]: correctionInputs[i] !== undefined ? undefined : ''}}>✗ Wrong</button>
            </div>
            {#if correctionInputs[i] !== undefined}
              <input
                class="correction-inp"
                placeholder="What was wrong about this?"
                value={correctionInputs[i]}
                oninput={e => correctionInputs = {...correctionInputs, [i]: e.target.value}}
                onkeydown={async e => {
                  if (e.key !== 'Enter') return
                  const val = correctionInputs[i]?.trim()
                  if (!val) return
                  await supabase.from('brain_knowledge').insert({
                    category: 'correction',
                    title: msg.content.slice(0, 60),
                    content: val,
                    active: true
                  })
                  correctionInputs = {...correctionInputs, [i]: undefined}
                }}
              />
            {/if}
          {/if}
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
      {/if}
    </div>
  {/if}
</div>

{#if chartDaysBehind > 1}
  <div class="chart-dl-miss">⚠ Last chart download: {chartStatus.last_successful_date} ({chartDaysBehind} days ago)</div>
{/if}
{#if chartStatus?.running}
  <div class="chart-dl-line">⬇ Downloading charts… {chartStatus.current} / {chartStatus.total}</div>
{:else if chartStatus && chartStatus.finished_at && !chartStatus.seen}
  <div class="chart-dl-banner">
    <div class="chart-dl-main">
      <span>📊 Chart download complete — {chartStatus.downloaded} new, {chartStatus.already_had ?? chartStatus.linked ?? 0} already had, {chartStatus.failed} failed</span>
      <div class="chart-dl-actions">
        <button class="chart-dl-btn" onclick={openChartFolder}>Open folder</button>
        <button class="chart-dl-x" onclick={dismissChartBanner} title="Dismiss">✕</button>
      </div>
    </div>
    <div class="chart-dl-folder">→ {chartStatus.folder}</div>
  </div>
{/if}

<div class="layout">

  <!-- LEFT COLUMN -->
  <div class="main">


    <!-- SECTION 1: TRENDS & NEWS -->
    <div class="section-block">
      <div class="sh">TRENDS & NEWS</div>

      <div class="agent-row">
        <div class="agent-btn-wrap">
          <button class="briefing-btn agent-brief {generatingBriefing?'loading':''}" onclick={() => generateBriefing()}>
            {generatingBriefing ? '✦ Generating...' : '✦ Morning Briefing'}
          </button>
          {#if agentLastRun.briefing}<div class="agent-last-run">{timeAgo(agentLastRun.briefing)}</div>{/if}
        </div>
        <div class="agent-btn-wrap">
          <button class="briefing-btn agent-scout {scoutingArtists?'loading':''}" onclick={() => scoutArtists()}>
            {scoutingArtists ? '✦ Scouting...' : '✦ Scout'}
          </button>
          {#if agentLastRun.scout}<div class="agent-last-run">{timeAgo(agentLastRun.scout)}</div>{/if}
        </div>
      </div>

      {#if todayBriefing}
        <div class="today-briefing-block">
          <div class="today-briefing-header">
            <button class="inbox-del-btn" onclick={() => deleteInboxItem(todayBriefing.id)}>×</button>
            <span class="inbox-type-badge br">✦ AI</span>
            <span class="today-briefing-label">TODAY'S BRIEFING</span>
            {#if todayBriefing.message}
              <button class="inbox-speak-btn {speakingId === todayBriefing.id ? 'playing' : ''}" onclick={() => speakText(todayBriefing.id, todayBriefing.message)} title={speakingId === todayBriefing.id ? 'Stop' : 'Read aloud'}>
                {speakingId === todayBriefing.id ? '■' : '▶'}
              </button>
            {/if}
          </div>
          <div class="agent-output">{@html parseAgentOutput(todayBriefing.message)}</div>
        </div>
      {/if}

      <!-- Aktuelle Refs -->
      {#if inboxItems.some(n => n.type === 'reference')}
        <div class="year-today-sep" style="margin-bottom:6px">AKTUELLE REFS</div>
        {#each inboxItems.filter(n => n.type === 'reference') as item (item.id)}
          <div class="inbox-item ref-item">
            <div class="ref-item-header">
              <span class="ref-badge">REF</span>
              <span class="ref-name">{item.message}</span>
              {#if item.metadata?.bpm}
                <span class="ref-meta">{Math.round(item.metadata.bpm)}bpm{item.metadata.camelot ? ' · ' + item.metadata.camelot : ''}</span>
              {/if}
              <button class="del-btn" onclick={() => deleteInboxItem(item.id)}>×</button>
            </div>
            <div class="ref-expires">surfaces for {Math.max(0, Math.round((new Date(item.metadata?.expires) - Date.now()) / 86400000))} more days</div>
          </div>
        {/each}
      {/if}

      <!-- Inbox stream (no WhatsApp auto-poll messages) -->
      {#each [inboxItems.filter(n => n.type !== 'message' && n.type !== 'reference')] as inboxStream}
      {#if !inboxStream.length}
        <p class="empty-sm" style="padding: 10px 0;color: var(--text-dim)">No notifications yet. Run an agent or send a listen link.</p>
      {:else}
        {@const todayInbox = inboxStream.filter(n => n.created_at?.slice(0,10) === todayISO && !(n.type === 'briefing' && n.id === todayBriefing?.id))}
        <div class="inbox-scroll">
          {#if todayInbox.length}
            {#each todayInbox as n (n.id)}
              <div class="inbox-item {n.read ? 'read' : 'unread'}">
                <div class="inbox-item-header">
                  {#if n.type === 'download'}<span class="inbox-type-badge dl">↓ DL</span>{:else if n.type === 'briefing' || n.type === 'scout'}<span class="inbox-type-badge br">✦ AI</span>{:else}<span class="inbox-type-badge fb">✎ FB</span>{/if}
                  <span class="inbox-code">{n.song_code}</span>
                  {#if n.artist}<span class="inbox-artist">{n.artist.toUpperCase()}</span>{/if}
                  <span class="inbox-title">{n.song_title}</span>
                  <span class="inbox-date">{new Date(n.created_at).toLocaleDateString('de-CH')}</span>
                  {#if !n.read}<span class="inbox-new-dot"></span>{/if}
                  {#if (n.type === 'briefing' || n.type === 'scout') && n.message}
                    <button class="inbox-speak-btn {speakingId === n.id ? 'playing' : ''}" onclick={() => speakText(n.id, n.message)} title={speakingId === n.id ? 'Stop' : 'Read aloud'}>
                      {speakingId === n.id ? '■' : '▶'}
                    </button>
                  {/if}
                  <button class="inbox-del-btn" onclick={() => deleteInboxItem(n.id)}>×</button>
                </div>
                {#if n.type === 'briefing' || n.type === 'scout'}
                  {@const scoutMsg = n.type === 'scout' ? n.message.replace(/^## CHARTS[\s\S]*/m, '').trim() : n.message}
                  {#if n.type === 'scout' && (n.metadata?.spotify_global?.length || n.metadata?.billboard?.length || n.metadata?.uk_charts?.length)}
                    <div class="chart-grid">
                      {#each [
                        {key:'spotify_global', label:'🌍 SPOTIFY GLOBAL'},
                        {key:'spotify_de',     label:'🇩🇪 SPOTIFY DE'},
                        {key:'billboard',      label:'🇺🇸 BILLBOARD'},
                        {key:'tiktok',         label:'📱 TIKTOK'},
                        {key:'youtube',        label:'▶ YOUTUBE'},
                        {key:'uk_charts',      label:'🇬🇧 UK CHARTS'}
                      ] as chart}
                        {#if (n.metadata[chart.key]||[]).length > 0}
                          <div class="chart-col">
                            <div class="chart-title">{chart.label}</div>
                            {#each (n.metadata[chart.key] || []).slice(0, 8) as t, i}
                              <div class="chart-track-row">
                                <span class="chart-pos">{t.position || (i+1)}</span>
                                <div class="chart-track-info">
                                  {#if typeof t === 'string'}
                                    <span class="chart-track-artist">{t}</span>
                                  {:else}
                                    <span class="chart-track-artist">{t.artist || ''}</span>
                                    <span class="chart-track-title-text">{t.title || ''}</span>
                                  {/if}
                                </div>
                                <div class="chart-track-actions">
                                  {#if typeof t !== 'string' && t.spotify_id}
                                    <button class="chart-play-btn" onclick={() => playSpotifyTrack(t.spotify_id)} title="Open in Spotify">▶</button>
                                  {:else if typeof t !== 'string' && (t.title || t.artist)}
                                    <a class="chart-play-btn" href="https://open.spotify.com/search/{encodeURIComponent((t.artist||'')+' '+(t.title||''))}" target="_blank" title="Search on Spotify">▶</a>
                                  {/if}
                                  {#if typeof t !== 'string'}
                                    {#if !librarySpotifyIds.has(t.spotify_id)}
                                      <button class="chart-lib-btn" onclick={() => addChartTrackToLibrary(t)}>→lib</button>
                                    {:else}
                                      <span class="in-library-badge">✓</span>
                                    {/if}
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                  {#if n.type === 'scout' && n.metadata?.one_to_watch?.length}
                    <div class="one-to-watch-block">
                      <div class="chart-title" style="margin-bottom:6px">👀 ONE TO WATCH</div>
                      {#each n.metadata.one_to_watch.slice(0, 5) as item}
                        <a class="otw-item" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                      {/each}
                    </div>
                  {/if}
                  {#if n.type === 'scout' && n.metadata?.suggested_tracks?.length}
                    {@const chartTrackKeys = new Set([...(n.metadata.spotify_global||[]),...(n.metadata.spotify_de||[]),...(n.metadata.billboard||[]),...(n.metadata.uk_charts||[]),...(n.metadata.tiktok||[]),...(n.metadata.youtube||[])].map(t => typeof t === 'string' ? t.toLowerCase().replace(/\W/g,'') : ((t.artist||'')+(t.title||'')).toLowerCase().replace(/\W/g,'')))}
                    {@const uniqueScoutTracks = (n.metadata.suggested_tracks||[]).filter(t => !chartTrackKeys.has(((t.artist||'')+(t.title||'')).toLowerCase().replace(/\W/g,'')))}
                    {#if uniqueScoutTracks.length}
                      <div class="suggested-tracks">
                        <div class="chart-title" style="margin-bottom:6px">ALSO MENTIONED</div>
                        {#each uniqueScoutTracks as t}
                          <div class="chart-track-row">
                            <div class="chart-track-info">
                              <span class="chart-track-artist">{t.artist || ''}</span>
                              <span class="chart-track-title-text">{t.title || ''}</span>
                            </div>
                            <div class="chart-track-actions">
                              {#if !librarySpotifyIds.has(t.spotify_id)}
                                <button class="chart-lib-btn" onclick={() => addChartTrackToLibrary(t)}>lib</button>
                              {:else}
                                <span class="in-library-badge">✓</span>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                  <div class="agent-output">{@html parseAgentOutput(scoutMsg)}</div>
                {:else if n.type === 'scout_articles'}
                  <div class="articles-block">
                    <div class="articles-header" onclick={() => openArticles[n.id] = !openArticles[n.id]}>
                      <span class="articles-count">{n.metadata?.article_count || '?'} sources</span>
                      <span class="articles-toggle">{openArticles[n.id] ? '▲' : '▼'}</span>
                    </div>
                    {#if openArticles[n.id]}
                      <div class="agent-output">{@html parseAgentOutput(n.message)}</div>
                    {/if}
                  </div>
                {:else}
                  <div class="inbox-msg">{n.message}</div>
                {/if}
                {#if n.patch_name}<div class="inbox-patch">via {n.patch_name}</div>{/if}
              </div>
            {/each}
          {:else}
            <p class="empty-sm" style="padding: 8px 0;color: var(--text-dim)">Nothing today.</p>
          {/if}
        </div>
      {/if}
      {/each}
    </div>

    <!-- SECTION 2: ROUTINE / HELPERS -->
    <div class="section-block" style="border-top:none;padding-top:0;gap:0">

      <div class="sections">
        <button class="sec-tab {activeSection==='routine'?'on':''}" onclick={() => activeSection='routine'}>ROUTINE</button>
      </div>

      {#if activeSection === 'routine'}
      <div class="quick-search-bar">
        <div class="qs-cell">
          <input class="helper-search-inp qs-inp" placeholder="Search YouTube..." bind:value={quickYoutubeQ}
            onkeydown={e => e.key==='Enter' && quickYoutubeQ.trim() && window.open('https://youtube.com/results?search_query='+encodeURIComponent(quickYoutubeQ.trim()),'_blank')} />
          <button class="helper-search-go" onclick={() => quickYoutubeQ.trim() && window.open('https://youtube.com/results?search_query='+encodeURIComponent(quickYoutubeQ.trim()),'_blank')}>→</button>
        </div>
        <div class="qs-cell">
          <input class="helper-search-inp qs-inp" placeholder="Search Spotify..." bind:value={quickSpotifyQ}
            onkeydown={e => e.key==='Enter' && quickSpotifyQ.trim() && window.open('https://open.spotify.com/search/'+encodeURIComponent(quickSpotifyQ.trim()),'_blank')} />
          <button class="helper-search-go" onclick={() => quickSpotifyQ.trim() && window.open('https://open.spotify.com/search/'+encodeURIComponent(quickSpotifyQ.trim()),'_blank')}>→</button>
        </div>
      </div>

      <div class="helpers-built-in">

        <!-- YOUTUBE → BRAIN -->
        <div class="helper-block">
          <div class="normalizer-title">YOUTUBE → BRAIN</div>
          <textarea
            class="helper-textarea"
            rows="3"
            placeholder="Paste YouTube URLs, one per line..."
            bind:value={youtubeIngestUrls}
          ></textarea>
          <input
            class="add-inp"
            placeholder="Add your personal note (optional)... e.g. 'pay attention to his reverb technique'"
            bind:value={youtubeIngestNote}
          />
          <div style="display:flex; align-items:center; gap:8px">
            <button class="btn-ref-sm {youtubeIngesting ? 'dim' : ''}" onclick={runYoutubeIngest} disabled={youtubeIngesting} style="align-self:flex-start">
              {youtubeIngesting ? 'INGESTING...' : 'INGEST'}
            </button>
            {#if youtubeIngestResults.some(r => r.status === 'draft' || r.status === 'success')}
              <button class="btn-ref-sm" onclick={copyYoutubeFindings}>📋 COPY FINDINGS</button>
            {/if}
            {#if youtubeCopyToast}
              <span class="yt-copy-toast">{youtubeCopyToast}</span>
            {/if}
          </div>
          {#if youtubeIngestResults.length}
            <div class="acapella-result">
              {#each youtubeIngestResults as r, i}
                {#if r.status === 'draft'}
                  <div class="yt-draft">
                    <div class="result-row">
                      <span class="result-val" style="color: var(--text-mid)">◔ {r.title}</span>
                    </div>
                    <div class="yt-draft-cat-row">
                      <span class="yt-draft-cat-label">{r.categoryAction === 'new' ? 'NEW' : 'TOPIC'}</span>
                      <input
                        class="add-inp"
                        list="yt-cats-dl-{i}"
                        placeholder="category…"
                        value={r.categoryOverride || r.category}
                        oninput={e => { youtubeIngestResults[i] = { ...r, categoryOverride: e.target.value }; youtubeIngestResults = [...youtubeIngestResults] }}
                      />
                      <datalist id="yt-cats-dl-{i}">
                        {#each r.allCategories || [] as c}<option value={c}></option>{/each}
                      </datalist>
                      <button class="btn-ref-sm {r.saving ? 'dim' : ''}" disabled={r.saving} onclick={() => saveYoutubeDraft(i)}>
                        {r.saving ? 'SAVING...' : '✓ SAVE'}
                      </button>
                    </div>
                    {#if r.categoryReason}
                      <div class="yt-draft-reason">{r.categoryReason}</div>
                    {/if}
                    {#if r.alternatives?.length}
                      <div class="yt-draft-alts">
                        {#each r.alternatives as alt}
                          {@const altCat = typeof alt === 'string' ? alt : alt.category}
                          {@const altReason = typeof alt === 'string' ? '' : alt.reason}
                          <button class="yt-alt-chip" title={altReason}
                            onclick={() => { youtubeIngestResults[i] = { ...r, categoryOverride: altCat }; youtubeIngestResults = [...youtubeIngestResults] }}>
                            {altCat}
                          </button>
                        {/each}
                      </div>
                    {/if}
                    {#if r.saveError}
                      <div class="yt-draft-reason" style="color: #e57373">{r.saveError}</div>
                    {/if}
                  </div>
                {:else}
                  <div class="result-row">
                    <span class="result-val" style="color:{r.status === 'success' ? '#4caf82' : '#e57373'}">
                      {r.status === 'success' ? '✓ Saved to ' + r.category + ' — ' + r.title : '✗ ' + r.error}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>

        <!-- REFERENCES -->
        <div class="helper-block">
          <div class="normalizer-title">REFERENCES</div>
          <div class="ref-row1">
            <input class="add-inp ref-field" bind:value={refArtist} placeholder="Artist"
              oninput={() => { similarResults = [] }} />
            <input class="add-inp ref-field" bind:value={refTitle} placeholder="Song / Album title"
              oninput={() => { similarResults = [] }} />
            <button class="btn-ref-find {refFinding ? 'dim' : ''}" onclick={findSimilar} disabled={refFinding} title="Find similar tracks">
              {refFinding ? '...' : 'FIND'}
            </button>
            <button class="btn-ref-sm {refDownloading ? 'dim' : ''}" onclick={downloadReference} disabled={refDownloading}>
              {refDownloading ? '...' : '↓ DOWNLOAD'}
            </button>
            <label class="ref-album-check">
              <input type="checkbox" bind:checked={refAlbumMode} />
              Album
            </label>
          </div>
          {#if similarResults.length}
            <div class="similar-results">
              {#each similarResults as t, i}
                <div class="similar-row">
                  <label class="similar-check">
                    <input type="checkbox" bind:checked={similarResults[i].checked} />
                  </label>
                  <span class="similar-name">{t.artist} — {t.title}</span>
                  <button class="btn-ref-sm similar-dl-btn {t.downloading ? 'dim' : ''} {t.done ? 'done' : ''}"
                    onclick={() => downloadSimilarOne(i)} disabled={t.downloading || t.done}>
                    {t.done ? '✓' : t.downloading ? '...' : '↓ DL'}
                  </button>
                </div>
              {/each}
              <button class="btn-ref-sm similar-dl-all {similarDownloadingAll ? 'dim' : ''}"
                onclick={downloadAllChecked} disabled={similarDownloadingAll}>
                {similarDownloadingAll ? '⟳ Downloading...' : '↓ Download All Checked'}
              </button>
            </div>
          {/if}
          {#if refProgress.length}
            <div class="ref-progress">
              {#each refProgress as p}
                <div class="ref-progress-line">{p}</div>
              {/each}
            </div>
          {/if}
          {#if refStatus}
            <div class="ref-status {refStatus.ok ? 'ok' : 'err'}">{refStatus.msg}</div>
          {/if}
          {#if recentRefMoves.length}
            <div class="ref-moves">
              {#each recentRefMoves as f}
                <div class="ref-move-item">✓ {f}</div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- TITLE GENERATOR -->
        <div class="helper-block">
          <div class="normalizer-title">TITLE GENERATOR</div>
          <div class="title-gen-row">
            <input class="add-inp title-gen-inp" bind:value={titleGenInput}
              placeholder="Describe the vibe, genre, mood, artist style..."
              onkeydown={e => e.key === 'Enter' && generateTitles()} />
            <button class="btn-ref-sm {titleGenLoading ? 'dim' : ''}" onclick={generateTitles} disabled={titleGenLoading}>
              {titleGenLoading ? '...' : 'GENERATE TITLES'}
            </button>
          </div>
          {#if titleGenResults.length}
            <div class="title-gen-results">
              {#each titleGenResults as t}
                <div class="title-gen-item">
                  <span class="title-gen-text">{t}</span>
                  <button class="title-copy-btn" onclick={() => navigator.clipboard.writeText(t)}>Copy</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- NORMALIZER -->
        <div class="helper-block">
          <div class="normalizer-title">NORMALIZER</div>
          <div class="normalizer-drop
            {normDragging ? 'dragging' : ''}
            {normStatus === 'ok' ? 'ok' : ''}
            {normStatus === 'err' ? 'err' : ''}"
            ondragover={e => { e.preventDefault(); normDragging = true }}
            ondragleave={() => normDragging = false}
            ondrop={async e => {
              e.preventDefault()
              normDragging = false
              normStatus = 'working'
              normMsg = ''
              const file = e.dataTransfer.files[0]
              if (!file) return
              const exts = ['.mp3','.wav','.aiff','.aif','.flac','.m4a']
              const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
              if (!exts.includes(ext)) { normStatus = 'err'; normMsg = 'Unsupported format'; return }
              try {
                const buf = await file.arrayBuffer()
                const res = await fetch('http://localhost:4242/normalize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
                  body: buf
                })
                const data = await res.json()
                if (data.ok) { normStatus = 'ok'; normMsg = data.outFile }
                else { normStatus = 'err'; normMsg = data.error || 'Error' }
              } catch(err) { normStatus = 'err'; normMsg = err.message }
            }}>
            {#if normStatus === 'working'}
              <span class="norm-hint">Normalizing...</span>
            {:else if normStatus === 'ok'}
              <span class="norm-ok">✓ {normMsg}</span>
            {:else if normStatus === 'err'}
              <span class="norm-err">✗ {normMsg}</span>
            {:else}
              <span class="norm-hint">Drop audio here → –14 LUFS → Desktop</span>
            {/if}
          </div>
        </div>

        <!-- ACAPELLA EXTRACTOR -->
        <div class="helper-block">
          <div class="acapella-header-row">
            <div class="normalizer-title">ACAPELLA EXTRACTOR</div>
            <div style="display:flex;gap:5px;margin-left:auto;align-items:center">
              <button class="acapella-mode-btn {acapellaMode==='acapella'?'on':''}" onclick={() => acapellaMode='acapella'}>ACAPELLA</button>
              <button class="acapella-mode-btn {acapellaMode==='vocal_clean'?'on':''}" onclick={() => acapellaMode='vocal_clean'}>VOCAL CLEAN</button>
              <button class="acapella-mode-btn {acapellaMode==='instrumental'?'on':''}" onclick={() => acapellaMode='instrumental'}>INSTRUMENTAL</button>
              <button class="acapella-applio-btn" onclick={openApplio} disabled={applioLoading}>APPLIO</button>
              <button class="acapella-applio-btn" onclick={() => window.open('https://app.kits.ai/', '_blank', 'width=1400,height=900,left=100,top=50')}>KITS</button>
            </div>
          </div>
          <div class="acapella-drop {acapellaDragging ? 'dragging' : ''}"
            ondragover={e => { e.preventDefault(); acapellaDragging = true }}
            ondragleave={() => acapellaDragging = false}
            ondrop={handleAcapellaDrop}>
            {#if acapellaLoading}
              <div class="acapella-loading">● {acapellaMode === 'vocal_clean' ? 'Cleaning vocals' : acapellaMode === 'instrumental' ? 'Extracting instrumental' : 'Extracting acapella'}... 2-5 min</div>
            {:else if acapellaFile}
              <div class="acapella-ready">
                📁 {acapellaFile.name}
                <button class="extract-btn" onclick={runAcapellaExtract}>
                  {acapellaMode === 'vocal_clean' ? 'Clean Vocals' : acapellaMode === 'instrumental' ? 'Extract Instrumental' : 'Extract Acapella'}
                </button>
              </div>
            {:else}
              <div class="acapella-placeholder">
                🎤 Drop audio file here
                <span style="font-size: 9px;color: #252525">mp3 · wav · aif · m4a</span>
              </div>
            {/if}
          </div>
          {#if acapellaResult}
            <div class="acapella-result">
              {#if acapellaResult.ok}
                <div class="result-row">
                  <span class="result-label">FILE</span>
                  <span class="result-val">{acapellaResult.filename}</span>
                </div>
                {#if acapellaResult.bpm}
                  <div class="result-row">
                    <span class="result-label">BPM</span>
                    <span class="result-val">{acapellaResult.bpm}</span>
                  </div>
                {/if}
                {#if acapellaResult.key}
                  <div class="result-row">
                    <span class="result-label">KEY</span>
                    <span class="result-val">{acapellaResult.key}{acapellaResult.camelot ? ' · ' + acapellaResult.camelot : ''}</span>
                  </div>
                {/if}
                {#if acapellaResult.onset !== undefined}
                  <div class="result-row">
                    <span class="result-label">VOCAL IN</span>
                    <span class="result-val">{typeof acapellaResult.onset === 'number' ? acapellaResult.onset.toFixed(2) : acapellaResult.onset}s</span>
                  </div>
                {/if}
                <div style="font-family: 'Space Mono',monospace;font-size: 9px;color: #4caf82;margin-top: 6px">✓ Saved to Desktop</div>
              {:else}
                <div style="color: #e57373;font-size: 11px">{acapellaResult.error}</div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- MIDI FROM REFERENCE -->
        <div class="helper-block">
          <div class="normalizer-title">REFERENCE → MIDI IDEEN</div>
          <div class="helper-sub">Drop a MIDI or audio file to generate 5 new ideas in the same style</div>
          <div class="acapella-drop {midiDragging ? 'dragging' : ''}"
            ondragover={e => { e.preventDefault(); midiDragging = true }}
            ondragleave={() => midiDragging = false}
            ondrop={handleMidiDrop}>
            {#if midiLoading}
              <div class="acapella-loading">● Generating{midiSteps.length ? ` · step ${midiSteps.length}/${midiTotalSteps}` : '...'}</div>
            {:else if midiFile}
              <div class="acapella-ready">
                📁 {midiFile.name}
                <button class="extract-btn" onclick={runMidiGenerate}>Analyze &amp; Generate MIDIs</button>
              </div>
            {:else}
              <div class="acapella-placeholder">
                🎹 MIDI oder Audio — bei Audio dauert die Analyse 5-10 Min
                <span style="font-size: 9px;color: var(--text-dim)">.mid · wav · mp3 · aiff · m4a — analyzed temporarily · never saved</span>
              </div>
            {/if}
          </div>
          {#if midiSteps.length > 0 || midiResult}
            <div class="midi-progress">
              {#each midiSteps as step}
                <div class="midi-step">✓ {step}</div>
              {/each}
              {#if midiLoading && midiSteps.length < midiTotalSteps}
                <div class="midi-step pending">◌ Processing...</div>
              {/if}
            </div>
          {/if}
          {#if midiResult}
            <div class="acapella-result">
              {#if midiResult.ok}
                {#if midiResult.analysis?.keyShort}
                  {@const a = midiResult.analysis}
                  <div class="midi-detected">
                    Erkannt: {a.keyShort} — {(a.progression || []).slice(0, 8).join(' ')}{a.confidence ? ` (Konfidenz: ${a.confidence.level})` : ''}
                  </div>
                  {#if a.confidence?.level === 'niedrig'}
                    <div class="midi-detected-warn">Akkorderkennung unsicher — Tonart und Akkorde können falsch sein</div>
                  {/if}
                {/if}
                {#if midiResult.ideas?.length}
                  {#each midiResult.ideas as idea}
                    <div class="result-row midi-idea-row">
                      <span class="result-label">{String(idea.n).padStart(2,'0')}</span>
                      <span class="result-val midi-idea-name" title={idea.name}>{idea.name}</span>
                      <span class="midi-variant" title={idea.tracks}>2 Spuren</span>
                      {#if idea.clip}<span class="midi-variant" title={idea.clip}>1 Clip</span>{/if}
                    </div>
                  {/each}
                {:else}
                  {#each (midiResult.files || []) as fname, i}
                    <div class="result-row">
                      <span class="result-label">{String(i+1).padStart(2,'0')}</span>
                      <span class="result-val">{fname}</span>
                    </div>
                  {/each}
                {/if}
                <div style="font-family: 'Space Mono',monospace;font-size: 9px;color: #4caf82;margin-top: 6px">✓ Saved to Desktop</div>
              {:else}
                <div style="color: #e57373;font-size: 11px">{midiResult.error}</div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- LYRICS EXTRACTOR -->
        <div class="helper-block">
          <div class="normalizer-title">LYRICS EXTRACTOR</div>
          <div class="helper-sub">Drop audio to transcribe lyrics via Whisper</div>
          <div class="acapella-drop {lyricsDragging ? 'dragging' : ''}"
            ondragover={e => { e.preventDefault(); lyricsDragging = true }}
            ondragleave={() => lyricsDragging = false}
            ondrop={handleLyricsDrop}>
            {#if lyricsLoading}
              <div class="acapella-loading">● Transcribing... 1-3 min</div>
            {:else if lyricsFile}
              <div class="acapella-ready">
                📁 {lyricsFile.name}
                <button class="extract-btn" onclick={runLyricsExtract}>Extract Lyrics</button>
              </div>
            {:else}
              <div class="acapella-placeholder">
                📝 Drop audio file (WAV, MP3, M4A)
                <span style="font-size: 9px;color: var(--text-dim)">transcribed via Whisper</span>
              </div>
            {/if}
          </div>
          {#if lyricsResult}
            <div class="acapella-result">
              {#if lyricsResult.ok}
                <textarea class="lyrics-textarea" readonly rows="8">{lyricsResult.lyrics}</textarea>
                <div class="lyrics-btn-row">
                  <button class="extract-btn" onclick={copyLyrics}>{lyricsCopied ? '✓ Copied' : 'Copy to Clipboard'}</button>
                  <button class="acapella-applio-btn" onclick={saveLyricsToBrain} disabled={lyricsSaved}>{lyricsSaved ? '✓ Saved' : 'Save to Brain'}</button>
                </div>
              {:else}
                <div style="color: #e57373;font-size: 11px">{lyricsResult.error}</div>
              {/if}
            </div>
          {/if}
        </div>

      </div><!-- /helpers-built-in routine -->
      {/if}

    </div>

  </div>
</div>
{/if}

<style>
  .layout { display: flex; flex-direction: column; min-height: calc(100vh - 100px); gap: 32px; }
  .main { display: flex; flex-direction: column; gap: 24px; }
  .empty { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--text-dim); padding: 32px 0; text-align: center; }
  .empty-sm { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); }

  .reminders { display: flex; flex-direction: column; gap: 6px; }
  .reminder-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--chip-bg); border: 1px solid transparent; border-radius: 4px; }
  .brain-review-nudge {
    display: block; width: 100%; text-align: left;
    background: rgba(76,175,130,.07); border: 1px solid rgba(76,175,130,.25);
    border-radius: 4px; color: #4caf82;
    font-family: 'Space Mono', monospace; font-size: 11px;
    padding: 6px 10px; cursor: pointer; margin-bottom: 6px;
    transition: background .15s;
  }
  .brain-review-nudge:hover { background: rgba(76,175,130,.13); }

  .sub-reminders { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
  .sub-reminder-row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; background: rgba(224,90,74,.08); border: 1px solid rgba(224,90,74,.4); border-radius: 3px; cursor: pointer; width: 100%; text-align: left; transition: background .15s; }
  .sub-reminder-row:hover { background: rgba(224,90,74,.14); }
  .sub-remind-icon { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; color: #e05a4a; flex-shrink: 0; }
  .sub-remind-text { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; flex: 1; letter-spacing: .02em; }
  .sub-remind-close { font-size: 14px; color: rgba(224,90,74,.5); flex-shrink: 0; }
  .reminder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .reminder-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .reminder-label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; color: var(--text-mid); letter-spacing: .06em; }
  .reminder-sub { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); }
  .reminder-dismiss { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; background: transparent; border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .reminder-dismiss:hover { border-color: var(--border2); color: var(--text); }

  .day-header { margin-bottom: 4px; }
  .day-title { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--text-dim); letter-spacing: .06em; }

  .section-block { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid transparent; padding-top: 16px; }
  .press-divider { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .12em; color: var(--text-dim); text-transform: uppercase; margin: 8px 0 4px; border-top: 1px solid transparent; padding-top: 6px; }
  .press-item { display: flex; align-items: baseline; gap: 7px; background: none; border: none; cursor: pointer; padding: 3px 0; text-align: left; width: 100%; }
  .press-item:hover .press-title { color: var(--text); }
  .press-source { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); flex-shrink: 0; text-transform: uppercase; letter-spacing: .06em; min-width: 110px; }
  .press-title { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .15s; }
  .sh { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); padding-bottom: 6px; border-bottom: 1px solid transparent; margin-bottom: 4px; }

  /* Upcoming */
  .upcoming-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-bottom: 1px solid transparent; }
  .upcoming-row.task-row { background: var(--bg); border-radius: 2px; margin-bottom: 2px; border: 1px solid transparent; }
  .upcoming-label { flex: 1; font-size: 14px; color: var(--text-mid); }
  .upcoming-proj { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; }
  .upcoming-date { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  .ckb-sm { width: 15px; height: 15px; border: 1px solid var(--border2); border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }

  /* Tasks */
  .tasks-header { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .undo-tab-btn { font-family: 'Space Mono', monospace; font-size: 9px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); padding: 3px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap; transition: all .15s; flex-shrink: 0; }
  .undo-tab-btn:not(:disabled):hover { border-color: var(--border2); color: var(--text); }
  .undo-tab-btn:disabled { opacity: .3; cursor: default; }
  .cal-btns { display: flex; gap: 4px; }
  .cal-action-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .06em; padding: 3px 8px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; }
  .cal-action-btn:hover { border-color: var(--border2); color: var(--text); }
  .add-task-form { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .date-inp { width: 130px; flex-shrink: 0; }
  .time-inp { width: 90px; flex-shrink: 0; }
  .time-sep { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex-shrink: 0; }

  .task-dropdown { border: 1px solid var(--border); border-radius: 3px; overflow: hidden; margin-top: 4px; }
  .task-dropdown-toggle { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface); border: none; cursor: pointer; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: .1em; color: var(--text-dim); }
  .task-dropdown-toggle:hover { background: var(--surface); color: var(--text-mid); }
  .td-arr { font-size: 9px; transition: transform .2s; }
  .td-arr.open { transform: rotate(90deg); }
  .task-list { display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--bg); }
  .task-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid transparent; border-radius: 3px; background: var(--surface); position: relative; overflow: hidden; }
  .task-item.done { opacity: .38; }
  .task-color-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
  .task-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .task-top-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .task-proj-bold { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: .04em; }
  .task-type-badge { font-family: 'Space Mono', monospace; font-size: 9px; opacity: .7; letter-spacing: .06em; }
  .task-label { font-size: 14px; color: var(--text-mid); }
  .task-item.done .task-label { text-decoration: line-through; color: var(--text-dim); }
  .task-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .task-date { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); }
  .task-dismissed { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); }
  .ckb { width: 15px; height: 15px; border: 1px solid var(--border2); border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }
  .task-item.done .ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .del-btn { background: transparent; border: none; color: var(--text-dim); font-size: 16px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .inbox-item .del-btn, .whatsapp-item .del-btn { font-size: 16px; padding: 2px 8px; min-width: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-dim); background: transparent; border: none; cursor: pointer; opacity: 0; transition: opacity .15s; }
  .inbox-item:hover .del-btn, .whatsapp-item:hover .del-btn { opacity: 1; color: #e05a4a; }
  .dl-notif .del-btn { opacity: 0; transition: opacity .15s; }
  .dl-notif:hover .del-btn { opacity: 1; }

  /* Upcoming panel */
  .upcoming-panel { border: 1px solid transparent; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
  .up-tabs { display: flex; border-bottom: 1px solid transparent; background: var(--surface); }
  .up-tab { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: .08em; padding: 7px 12px; background: var(--chip-bg); border: none; border-bottom: 2px solid transparent; color: var(--text-dim); cursor: pointer; transition: all .15s; margin-bottom: -1px; }
  .up-tab:hover { color: var(--text-mid); }
  .up-tab.on { color: var(--accent); border-bottom-color: var(--accent-dim); }
  .up-tab.has-badge { color: #e05a4a; }
  .inbox-item { padding: 9px 0 9px 10px; border-bottom: 1px solid transparent; }
  .inbox-item.unread { border-left: 2px solid transparent; }
  .inbox-item.read { opacity: .5; border-left: 2px solid transparent; }
  .inbox-item-header { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; flex-wrap: nowrap; }
  .inbox-type-badge { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 500; padding: 1px 5px; border-radius: 2px; letter-spacing: .06em; flex-shrink: 0; }
  .inbox-type-badge.dl { background: rgba(76,175,130,.12); color: #4caf82; border: 1px solid rgba(76,175,130,.25); }
  .inbox-type-badge.fb { background: var(--chip-bg); color: var(--text-mid); border: 1px solid transparent; }
  .inbox-type-badge.br { background: rgba(120,80,200,.12); color: rgba(180,140,255,.8); border: 1px solid rgba(140,100,220,.25); }
  .agent-btn-wrap { display: flex; flex-direction: column; align-items: center; }
  .agent-last-run { font-family: 'Space Mono', monospace; font-size: 8px; color: var(--text-dim); text-align: center; margin-top: 2px; }
  .agent-brief { border-left: 3px solid var(--text-dim) !important; }
  .agent-scout { border-left: 3px solid #4caf82 !important; }
  .agent-pulse { border-left: 3px solid var(--accent-dim) !important; }
  .agent-match { border-left: 3px solid #9b59b6 !important; }
  .auto-briefing-loading { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); padding: 6px 0 2px; letter-spacing: .06em; }
  .today-briefing-block { background: transparent; border: 1px solid transparent; border-radius: 3px; padding: 10px 12px; margin: 8px 0; }
  .today-briefing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .today-briefing-label { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); letter-spacing: .1em; flex: 1; }
  .agent-output-del { position: absolute; top: 6px; right: 6px; background: transparent; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; line-height: 1; padding: 2px 4px; }
  .agent-output-del:hover { color: #e05a4a; }
  .briefing-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .08em; padding: 4px 10px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); border-radius: 2px; cursor: pointer; transition: all .15s; }
  .briefing-btn:hover { border-color: var(--border2); color: var(--text); }
  .briefing-btn.loading { opacity: .5; cursor: default; }
  .inbox-code { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); }
  .inbox-artist { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text); }
  .inbox-title { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inbox-date { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); }
  .inbox-new-dot { width: 5px; height: 5px; border-radius: 50%; background: #e05a4a; flex-shrink: 0; }
  .inbox-msg { font-size: 11px; color: var(--text-mid); white-space: pre-wrap; line-height: 1.7; }
  .inbox-patch { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); margin-top: 2px; }
  .inbox-type-badge.wa { background: rgba(76,175,130,.15); color: #4caf82; }

  /* WhatsApp analysis */
  .wa-urgency-badge { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .05em; padding: 1px 5px; border-radius: 2px; text-transform: uppercase; }
  .wa-urgency-badge.high { background: rgba(224,90,74,.15); color: #e05a4a; }
  .wa-urgency-badge.medium { background: var(--chip-bg); color: var(--text-mid); }
  .wa-urgency-badge.low { background: rgba(158,150,144,.15); color: var(--text-mid); }
  .wa-analysis { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 6px 8px; border-radius: 3px; background: var(--surface); }
  .wa-analysis.has-boundary { border-left: 2px solid #e05a4a; background: rgba(224,90,74,.05); }
  .wa-boundary { font-size: 10px; color: #e05a4a; font-weight: 500; margin-bottom: 2px; }
  .wa-field { font-size: 10px; line-height: 1.5; }
  .wa-field.intent { color: var(--text-mid); font-style: italic; }
  .wa-field.state { font-size: 9px; color: var(--text-dim); }
  .wa-field.biz { font-size: 9px; color: var(--text-dim); }
  .wa-field.next { color: var(--text-mid); }
  .wa-reply-wrap { display: flex; align-items: flex-start; gap: 8px; margin-top: 4px; background: var(--surface); padding: 6px 8px; border-radius: 3px; }
  .wa-reply-text { font-size: 11px; color: var(--text-mid); flex: 1; line-height: 1.5; }
  .wa-copy-btn { font-family: 'Space Mono', monospace; font-size: 9px; padding: 2px 7px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .wa-copy-btn:hover { color: var(--text); border-color: var(--border2); }
  .wa-analyze-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wa-contact-sel { background: var(--surface); border: 1px solid transparent; color: var(--text-mid); font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 9px; outline: none; border-radius: 3px; flex: 1; min-width: 140px; color-scheme: dark; }
  .wa-contact-sel option { background: var(--surface); color: var(--text-mid); }
  .wa-contact-sel:focus { border-color: var(--accent-dim); }
  .wa-result { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 12px; background: var(--surface); border-radius: 4px; border: 1px solid transparent; }
  .wa-result-row { display: flex; align-items: center; gap: 8px; }
  .wa-result-section { display: flex; flex-direction: column; gap: 3px; }
  .wa-result-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 400; letter-spacing: .08em; color: var(--text-dim); text-transform: uppercase; }
  .wa-result-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-mid); line-height: 1.6; }
  .wa-urgency-val { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 2px; }
  .wa-urgency-val.urgency-high { background: rgba(224,90,74,.15); color: #e05a4a; }
  .wa-urgency-val.urgency-medium { background: var(--chip-bg); color: var(--text); }
  .wa-urgency-val.urgency-low { background: rgba(76,175,130,.1); color: #4caf82; }

  /* WhatsApp MESSAGES section */
  .ref-item { border-left: 2px solid transparent; background: var(--chip-bg); padding: 6px 10px; margin-bottom: 5px; border-radius: 0 3px 3px 0; }
  .ref-item-header { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
  .ref-badge { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 500; color: var(--text-mid); border: 1px solid transparent; padding: 1px 5px; border-radius: 2px; flex-shrink: 0; background: var(--chip-bg)}
  .ref-name { font-family: 'DM Sans', sans-serif; font-size: 12px; color: var(--text-mid); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-meta { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); flex-shrink: 0; }
  .ref-expires { font-family: 'DM Sans', sans-serif; font-size: 10px; color: var(--text-dim); font-style: italic; margin-top: 2px; }
  .del-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: var(--text-mid); }
  .whatsapp-item { border-left: 2px solid #25d366; background: rgba(37,211,102,.03); padding: 8px 10px; margin-bottom: 6px; border-radius: 0 3px 3px 0; }
  .whatsapp-item.boundary { border-left-color: #e05a4a; background: rgba(224,90,74,.05); }
  .whatsapp-item.urgent { border-left-color: #e8a838; }
  .notif-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .notif-from { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 500; color: var(--text-mid); }
  .notif-urgency.high { color: #e05a4a; font-size: 9px; font-family: 'Space Mono', monospace; }
  .notif-urgency.medium { color: #e8a838; font-size: 9px; font-family: 'Space Mono', monospace; }
  .notif-message { font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--text-mid); font-style: italic; margin: 4px 0; }
  .notif-real-intent { font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--text-mid); margin: 2px 0; }
  .notif-next-step { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #4caf82; margin: 2px 0; }
  .notif-suggestion { font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--text-mid); background: var(--surface); padding: 4px 8px; border-radius: 3px; margin-top: 4px; display: flex; align-items: center; gap: 8px; }
  .boundary-alert { font-family: 'Space Mono', monospace; font-size: 9px; color: #e05a4a; background: rgba(224,90,74,.1); padding: 3px 8px; border-radius: 2px; margin-bottom: 4px; }
  .del-btn { font-size: 12px; background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .copy-btn { font-family: 'Space Mono', monospace; font-size: 8px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); padding: 1px 5px; border-radius: 2px; cursor: pointer; margin-left: auto; flex-shrink: 0; }
  .copy-btn:hover { color: var(--text); border-color: var(--border2); }

  :global(.inline-play-btn) {
    display: inline; font-size: 9px; font-family: 'Space Mono', monospace;
    background: var(--chip-bg); border: 1px solid transparent; color: #4caf82;
    padding: 2px 6px; border-radius: 2px; cursor: pointer;
    margin-left: 5px; vertical-align: middle; line-height: 1.6;
  }
  :global(.inline-brain-btn) {
    display: inline; font-size: 9px; font-family: 'Space Mono', monospace;
    background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid);
    padding: 2px 6px; border-radius: 2px; cursor: pointer;
    margin-left: 3px; vertical-align: middle; line-height: 1.6;
  }
  :global(.inline-play-btn:hover)  { border-color: #4caf82; }
  :global(.inline-brain-btn:hover) { border-color: var(--border2); }

  /* Structured agent output renderer */
  .agent-output {
    padding: 2px 0 4px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: var(--text-mid);
    line-height: 1.65;
  }
  .agent-output * {
    font-family: 'DM Sans', sans-serif;
    font-weight: 300;
  }
  :global(.agent-header) {
    font-family: 'Space Mono', monospace !important;
    font-size: 10px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--text-dim);
    margin: 12px 0 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid transparent;
  }
  :global(.agent-header:first-child) { margin-top: 6px; }
  :global(.agent-bullet) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: var(--text-mid);
    line-height: 1.65;
    padding: 2px 0 2px 12px;
    margin: 0;
  }
  :global(.agent-gap) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #e05a4a;
    padding: 2px 0 2px 12px;
    line-height: 1.65;
  }
  :global(.agent-ok) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #4caf82;
    padding: 2px 0 2px 12px;
    line-height: 1.65;
  }
  :global(.agent-next-move) {
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    padding: 6px 12px;
    margin-top: 8px;
    color: var(--text-mid);
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    line-height: 1.65;
  }
  :global(.agent-p) { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; color: var(--text-mid); line-height: 1.65; margin: 3px 0; }
  .agent-tracks { margin-top: 8px; border-top: 1px solid transparent; padding-top: 6px; }
  .agent-track-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid transparent; }
  .agent-track-row:last-child { border-bottom: none; }
  .agent-track-name { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent-track-btns { display: flex; gap: 4px; flex-shrink: 0; }
  .track-play-btn { background: transparent; border: 1px solid #4caf82; color: #4caf82; font-size: 9px; padding: 2px 6px; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .track-play-btn:hover { background: rgba(76,175,130,.12); }
  .track-brain-btn { background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); font-size: 9px; padding: 2px 6px; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .track-brain-btn:hover { background: rgba(255,255,255,.06); }
  :global(.ao-tag-gap) { color: #e05a4a; font-weight: 500; margin-right: 4px; }
  :global(.ao-tag-ok)  { color: #4caf82; font-weight: 500; margin-right: 4px; }
  :global(.agent-label-confirmed) { color: var(--text-mid); font-weight: 500; }
  :global(.agent-label-tension)   { color: #e8a838; font-weight: 500; }
  :global(.agent-label-outdated)  { color: var(--text-mid); font-weight: 500; }
  :global(.agent-label-new)       { color: var(--accent); font-weight: 500; }
  .task-scroll { }
  .task-scroll.scrollable { max-height: calc(7 * 50px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .year-scroll { max-height: calc(10 * 32px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .inbox-scroll { max-height: 600px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid transparent; }
  .chart-col { display: flex; flex-direction: column; gap: 3px; }
  .chart-title { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; color: var(--text); letter-spacing: .08em; margin-bottom: 4px; }
  .chart-track-row { display: flex; align-items: center; gap: 5px; padding: 3px 0; border-bottom: 1px solid transparent; }
  .chart-track-row:last-child { border-bottom: none; }
  .chart-pos { font-family: 'Space Mono', monospace; font-size: 9px; color: #3c3c3c; min-width: 13px; text-align: right; flex-shrink: 0; }
  .chart-track-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .chart-track-artist { font-size: 11px; color: var(--text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .chart-track-title-text { font-size: 10px; color: var(--text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .chart-track-actions { display: flex; gap: 2px; flex-shrink: 0; }
  .chart-play-btn, .chart-lib-btn { background: var(--surface); border: 1px solid transparent; border-radius: 3px; cursor: pointer; font-size: 9px; padding: 2px 4px; line-height: 1; }
  .chart-play-btn { color: #4caf82; }
  .chart-lib-btn { color: var(--text-mid); }
  .chart-play-btn:hover, .chart-lib-btn:hover { background: var(--surface2); }
  .in-library-badge { font-family: 'Space Mono', monospace; font-size: 7px; color: #2a4a2a; padding: 2px 5px; }
  .suggested-tracks { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .one-to-watch-block { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid transparent; }
  .otw-item { font-family: 'DM Sans', sans-serif; font-size: 12px; color: var(--text-mid); text-decoration: none; line-height: 1.4; }
  .otw-item:hover { color: var(--text); text-decoration: underline; }
  .articles-block { padding: 4px 0; }
  .articles-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 6px 0; border-top: 1px solid transparent; }
  .articles-count { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text); letter-spacing: .05em; }
  .articles-toggle { font-size: 9px; color: #3c3c3c; }
  .inbox-row { display: flex; align-items: flex-start; gap: 0; }
  .inbox-del-btn { flex-shrink: 0; order: -1; background: transparent; border: none; color: var(--text-dim); font-size: 13px; cursor: pointer; padding: 10px 6px 10px 2px; align-self: flex-start; }
  .inbox-del-btn:hover { color: #e05a4a; }
  .inbox-speak-btn { width: 28px; height: 28px; border-radius: 50%; background: var(--surface); border: 1px solid transparent; color: var(--text-mid); font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; transition: all .15s; }
  .inbox-speak-btn:hover { border-color: var(--border2); }
  .inbox-speak-btn.playing { background: rgba(122,166,194,.1); border-color: var(--accent-dim); }
  .speak-toast { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text); background: var(--surface2); border: 1px solid var(--border2); border-radius: 3px; padding: 7px 12px; margin-bottom: 6px; }
  .goal-check-btn { border-color: rgba(76,175,130,.25); color: rgba(76,175,130,.5); }
  .goal-check-btn:hover { border-color: rgba(76,175,130,.5); color: rgba(76,175,130,.8); }
  .year-done-row { opacity: .35; }
  .year-past-row { opacity: .5; }
  .year-today-sep { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; color: var(--text-mid); letter-spacing: .1em; padding: 6px 0 3px; border-top: 1px solid transparent; margin-top: 4px; }
  .task-flat-row.deadline-row { background: #0d0d0a; }
  .week-view { display: flex; flex-direction: column; }
  .week-day-block { border-bottom: 1px solid transparent; }
  .week-day-block.is-today { background: var(--chip-bg); border-left: 2px solid transparent; }
  .week-day-header { display: flex; align-items: baseline; gap: 10px; padding: 8px 10px 4px; }
  .week-day-name { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; letter-spacing: .1em; color: var(--text-mid); }
  .week-day-name.today-name { color: var(--text); }
  .week-day-date { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); }
  .week-empty-day { padding: 4px 10px 8px; font-family: 'Space Mono', monospace; font-size: 10px; color: #222; }
  .task-flat-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #0f0f0f; }
  .tfl-date { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; color: var(--text-mid); flex-shrink: 0; min-width: 38px; }
  .tfl-time { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-mid); flex-shrink: 0; min-width: 38px; }
  .tfl-prefix { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 500; letter-spacing: .04em; white-space: nowrap; flex-shrink: 0; }
  .tfl-edit { flex: 1; background: transparent; border: none; color: var(--text-mid); font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; min-width: 0; padding: 0; }
  .tfl-edit:focus { background: rgba(255,255,255,.03); border-radius: 2px; }
  .tfl-label { flex: 1; color: var(--text-mid); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tfl-done { background: transparent; border: 1px solid transparent; border-radius: 2px; color: var(--text-dim); font-size: 10px; cursor: pointer; padding: 1px 5px; flex-shrink: 0; }
  .tfl-done:hover { border-color: #4caf82; color: #4caf82; }
  .del-flat { background: transparent; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-flat:hover { color: #e05a4a; }
  .pin-btn { background: transparent; border: none; color: var(--text-dim); font-size: 13px; cursor: pointer; padding: 0 3px; flex-shrink: 0; line-height: 1; }
  .pin-btn.pinned { color: var(--text-mid); }
  .pin-btn:hover { color: var(--text); }
  .focus-block { background: var(--chip-bg); border: 1px solid transparent; border-left: 3px solid transparent; border-radius: 4px; padding: 10px 14px; margin-bottom: 12px; }
  .focus-label { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); letter-spacing: .1em; margin-bottom: 4px; }
  .focus-task { font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 400; color: var(--text); }
  .edit-time-btn { background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; padding: 0 3px; flex-shrink: 0; }
  .edit-time-btn:hover, .edit-time-btn.on { color: var(--accent); }
  .task-edit-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px 6px; background: var(--surface); border-bottom: 1px solid #0f0f0f; }
  .cal-actions-row { display: flex; gap: 8px; padding: 8px 0 0; }
  .clickable-row { cursor: pointer; transition: background .1s; }
  .clickable-row:hover { background: rgba(76,175,130,.06); border-radius: 3px; }
  .type-sel { flex-shrink: 0; width: 90px; }
  .proj-sel { flex-shrink: 0; width: 110px; }
  .up-row { display: flex; align-items: center; gap: 9px; padding: 7px 12px; border-bottom: 1px solid #0d0d0d; background: var(--bg); }
  .up-row:last-child { border-bottom: none; }
  .up-row.today { background: var(--chip-bg); border-left: 3px solid transparent; }
  .up-row.tomorrow { background: rgba(122,166,194,.03); border-left: 3px solid var(--accent-a30); }
  .up-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .up-label { font-size: 14px; color: var(--text-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .up-proj { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 500; }
  .up-date { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  .up-row.today .up-date { color: var(--text-mid); font-weight: 500; }
  .up-row.tomorrow .up-date { color: var(--accent); }

  /* Routine / Health */
  .sections { display: flex; margin-bottom: 0; }
  .sec-tab { font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: .14em; padding: 0; background: transparent; border: none; color: var(--text-dim); cursor: pointer; transition: all .15s; }
  .sec-tab:hover { color: var(--text-mid); }
  .sec-tab.on { color: var(--accent); }
  .quick-search-bar { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 8px; }
  .qs-cell { display: flex; gap: 4px; }
  .qs-cell .helper-search-inp { flex: 1; width: auto; }
  .check-list { display: flex; flex-direction: column; gap: 2px; }
  .routine-divider { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 500; letter-spacing: .1em; color: var(--text-mid); padding: 10px 0 4px; border-top: 1px solid transparent; margin-top: 16px; }
  .check-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: transparent; min-height: 0; }
  .check-item.done { opacity: .38; }
  .routine-btns-wrap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 6px; }
  .routine-box { display: flex; align-items: center; padding: 3px 6px 3px 8px; background: var(--surface); border: 1px solid transparent; border-radius: 3px; gap: 4px; overflow: hidden; cursor: pointer; }
  .routine-box:hover { border-color: var(--border2); }
  .routine-box-label { flex: 1; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 300; color: var(--text-mid); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .routine-box-arr { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); flex-shrink: 0; }
  .routine-box:hover .routine-box-arr { color: var(--text); }
  .helper-search-inp { background: var(--surface); border: 1px solid var(--border2); color: var(--text-mid); font-size: 12px; font-family: 'DM Sans', sans-serif; padding: 3px 8px; border-radius: 3px; width: 150px; flex-shrink: 0; outline: none; }
  .helper-search-inp::placeholder { color: var(--text-faint); }
  .helper-search-inp:focus { border-color: var(--accent-dim); }
  .helper-search-go { font-family: 'Space Mono', monospace; font-size: 12px; padding: 3px 8px; background: transparent; border: 1px solid var(--border2); color: var(--text-mid); border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .helper-search-go:hover { color: var(--text); border-color: var(--border2); }
  .routine-box .helper-search-go { border: none; padding: 0 4px; line-height: 1; }
  .reorder-col { display: flex; flex-direction: row; gap: 2px; flex-shrink: 0; }
  .reorder-micro { font-size: 9px; padding: 2px 4px; background: transparent; border: none; color: var(--border2); cursor: pointer; line-height: 1; }
  .reorder-micro:hover { color: var(--text); }
  .ckb.blue { color: #4a90e2; }
  .check-item.done .ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .check-item.done .ckb.blue { background: rgba(74,144,226,.12); border-color: #4a90e2; }
  .item-label { flex: 1; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; color: var(--text-mid); text-decoration: none; }
  .check-item.done .item-label { color: var(--text-dim); text-decoration: line-through; }
  .add-row { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
  .add-inp { background: var(--surface); border: 1px solid var(--border); color: var(--text); font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 9px; outline: none; border-radius: 3px; }
  .add-inp:focus { border-color: var(--accent-dim); }
  .helpers-built-in { display: flex; flex-direction: column; margin-top: 24px; }
  .ref-row1 { display: flex; gap: 5px; align-items: center; margin-bottom: 5px; }
  .ref-row2 { display: flex; gap: 5px; align-items: center; }
  .ref-field { flex: 1; min-width: 0; }
  .ref-url-inp { flex: 1; min-width: 0; }
  .ref-album-check { display: flex; align-items: center; gap: 3px; font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); cursor: pointer; white-space: nowrap; flex-shrink: 0; }
  .ref-album-check input[type="checkbox"] { accent-color: var(--text-mid); width: 11px; height: 11px; }
  .btn-ref-sm { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; padding: 3px 10px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); border-radius: 2px; cursor: pointer; white-space: nowrap; flex-shrink: 0; letter-spacing: .06em; }
  .btn-ref-sm:hover { background: rgba(255,255,255,.06); }
  .btn-ref-sm.dim { opacity: .5; cursor: not-allowed; }
  .btn-ref-spotify-sm { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; padding: 4px 10px; background: rgba(30,215,96,.08); border: 1px solid rgba(30,215,96,.3); color: #1ed760; border-radius: 2px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
  .btn-ref-spotify-sm:hover { background: rgba(30,215,96,.14); }
  .btn-ref-spotify-sm.dim { opacity: .5; cursor: not-allowed; }
  .btn-ref-find { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; padding: 3px 10px; background: rgba(76,175,130,.08); border: 1px solid rgba(76,175,130,.35); color: #4caf82; border-radius: 2px; cursor: pointer; white-space: nowrap; flex-shrink: 0; letter-spacing: .06em; }
  .btn-ref-find:hover { background: rgba(76,175,130,.14); }
  .btn-ref-find.dim { opacity: .5; cursor: not-allowed; }
  .similar-results { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 6px 8px; background: var(--bg); border: 1px solid transparent; border-radius: 3px; }
  .similar-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .similar-check { display: flex; align-items: center; flex-shrink: 0; }
  .similar-name { font-family: 'DM Sans', sans-serif; font-size: 12px; color: var(--text-mid); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .similar-dl-btn { font-size: 10px !important; padding: 2px 8px !important; }
  .similar-dl-btn.done { background: rgba(76,175,130,.08) !important; border-color: rgba(76,175,130,.3) !important; color: #4caf82 !important; }
  .similar-dl-all { margin-top: 4px; width: 100%; justify-content: center; }
  .ref-progress { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; padding: 6px 8px; background: var(--surface); border-radius: 3px; max-height: 140px; overflow-y: auto; }
  .ref-progress-line { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); }
  .ref-status { font-family: 'Space Mono', monospace; font-size: 10px; margin-top: 5px; }
  .ref-status.ok { color: #4caf82; }
  .ref-status.err { color: #e05a4a; }
  .ref-moves { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .ref-move-item { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; }
  .helper-block { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
  .helper-block:first-child { margin-top: 0; }
  .yt-copy-toast { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; }
  .yt-draft { display: flex; flex-direction: column; gap: 5px; padding: 8px 0; border-bottom: 1px solid transparent; }
  .yt-draft:last-child { border-bottom: none; }
  .yt-draft-cat-row { display: flex; gap: 6px; align-items: center; }
  .yt-draft-cat-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .08em; color: var(--text-mid); flex-shrink: 0; }
  .yt-draft-cat-row .add-inp { flex: 1; }
  .yt-draft-reason { font-family: 'DM Sans', sans-serif; font-size: 11px; color: var(--text-mid); }
  .yt-draft-alts { display: flex; gap: 5px; flex-wrap: wrap; }
  .yt-alt-chip { font-family: 'Space Mono', monospace; font-size: 9px; padding: 2px 8px; background: var(--surface); border: 1px solid transparent; color: var(--text-mid); border-radius: 10px; cursor: pointer; }
  .yt-alt-chip:hover { border-color: var(--border2); color: var(--text); }
  .normalizer-title { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); }
  .title-gen-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  .title-gen-inp { flex: 1; }
  .title-gen-results { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .title-gen-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--surface); border: 1px solid transparent; border-radius: 3px; }
  .title-gen-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-mid); flex: 1; }
  .title-copy-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .title-copy-btn:hover { border-color: var(--border2); color: var(--text); }
  .btn-gold-sm.dim { opacity: .5; cursor: not-allowed; }
  .normalizer-drop { background: var(--surface); border: 1px solid transparent; border-radius: 3px; padding: 10px 14px; cursor: copy; transition: all .15s; }
  .normalizer-drop.dragging { border-color: var(--accent-dim); background: var(--accent-a04); }
  .normalizer-drop.ok { border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.04); }
  .normalizer-drop.err { border-color: rgba(224,90,74,.4); background: rgba(224,90,74,.04); }
  .norm-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); }
  .norm-ok { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; }
  .norm-err { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .helper-sub { font-family: 'DM Sans', sans-serif; font-size: 10px; color: var(--text-dim); }
  .acapella-mode-row { display: flex; gap: 5px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
  .acapella-mode-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; padding: 3px 10px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; letter-spacing: .06em; transition: all .12s; }
  .acapella-mode-btn:hover { border-color: var(--border2); color: var(--text-mid); }
  .acapella-mode-btn.on { border-color: var(--accent-dim); color: var(--accent); background: rgba(122,166,194,.07); }
  .acapella-header-row { display: flex; align-items: center; gap: 6px; }
  .acapella-launch-group { margin-left: auto; display: flex; gap: 5px; }
  .acapella-applio-btn { font-family: 'Space Mono', monospace; font-size: 9px; padding: 3px 10px; background: rgba(76,175,130,.08); border: 1px solid rgba(76,175,130,.35); color: #4caf82; border-radius: 2px; cursor: pointer; transition: all .12s; }
  .acapella-applio-btn:hover { background: rgba(76,175,130,.14); }
  .acapella-drop { background: var(--surface); border: 1px solid transparent; border-radius: 3px; padding: 10px 14px; cursor: pointer; transition: border-color .15s; }
  .acapella-drop.dragging { border-color: var(--accent-dim); background: var(--accent-a04); }
  .acapella-placeholder { font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-dim); display: flex; flex-direction: column; gap: 4px; align-items: center; }
  .acapella-loading { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); }
  .acapella-ready { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .extract-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); padding: 5px 14px; border-radius: 2px; cursor: pointer; }
  .extract-btn:hover { background: rgba(255,255,255,.06); }
  .acapella-result { background: var(--surface); border-radius: 3px; padding: 8px 10px; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
  .result-row { display: flex; gap: 8px; align-items: baseline; }
  .result-label { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); letter-spacing: .08em; width: 56px; flex-shrink: 0; }
  .result-val { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); }
  .midi-idea-row { align-items: center; }
  .midi-detected { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-mid); margin-bottom: 4px; }
  .midi-detected-warn { font-family: 'Space Mono', monospace; font-size: 9px; color: #e8a838; margin-bottom: 4px; }
  .midi-idea-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .midi-variant { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .06em; padding: 2px 7px; background: var(--chip-bg); color: var(--text-dim); border-radius: 2px; white-space: nowrap; flex-shrink: 0; cursor: default; }
  .midi-progress { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .midi-step { font-family: 'Space Mono', monospace; font-size: 9px; color: #4caf82; }
  .midi-step.pending { color: var(--text-dim); }
  .lyrics-textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 8px 10px; resize: vertical; outline: none; box-sizing: border-box; }
  .lyrics-btn-row { display: flex; gap: 8px; margin-top: 6px; }
  .helper-textarea { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 3px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 8px 10px; resize: vertical; outline: none; box-sizing: border-box; }
  .helper-textarea:focus { border-color: var(--accent-dim); }
  .helper-textarea::placeholder { color: var(--text-faint); }
  .add-inp::placeholder { color: var(--text-faint); }
  .add-inp.url { flex: 2; min-width: 120px; }
  .add-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; padding: 5px 12px; background: var(--chip-bg); color: var(--text-mid); border: 1px solid transparent; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .add-btn:hover { background: rgba(255,255,255,.06); }
  .daily-toggle { font-size: 14px; padding: 3px 7px; background: var(--chip-bg); border: 1px solid transparent; border-radius: 3px; cursor: pointer; color: var(--text-dim); flex-shrink: 0; }
  .daily-toggle.on { border-color: var(--accent-dim); color: var(--accent); background: var(--accent-a08); }
  .recurring-row { background: transparent; }
  .tfl-daily { font-size: 13px; color: var(--text-mid); width: 40px; flex-shrink: 0; }

  /* Calendar */
  .cal-wrap { background: var(--surface); border-radius: 4px; padding: 14px; border: 1px solid transparent; }
  .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .cal-month { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; color: var(--text-mid); }
  .cal-nav { background: transparent; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 0 6px; }
  .cal-nav:hover { color: var(--text); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cal-day-lbl { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-dim); text-align: center; padding: 3px 0; }
  .cal-cell { position: relative; font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-mid); text-align: center; padding: 5px 2px; border-radius: 3px; cursor: pointer; background: transparent; border: none; transition: all .15s; width: 100%; }
  .cal-cell:hover { background: var(--surface2); color: var(--text); }
  .cal-cell.today { color: var(--text); font-weight: 500; }
  .cal-cell.sel { background: rgba(122,166,194,.15); color: var(--accent); }
  .cal-dot { position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; display: block; }
  .gold-dot { background: var(--surface2); }
  .blue-dot { background: var(--accent); left: 55%; }

  /* Day detail */
  .day-detail { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .detail-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid transparent; }
  .dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .detail-label { flex: 1; font-size: 13px; color: var(--text-mid); }
  .done-txt { text-decoration: line-through; color: var(--text-dim); }
  .detail-proj { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); }

  /* Upcoming week */
  .week-block { margin-top: 16px; border-top: 1px solid transparent; padding-top: 12px; }
  .week-today-badge { font-family: 'Space Mono', monospace; font-size: 9px; padding: 1px 5px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); border-radius: 2px; }
  .week-task-row { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 2px; background: var(--surface); margin-bottom: 2px; }
  .week-task-row.dim { opacity: .35; }
  .week-task-label { flex: 1; font-size: 12px; color: var(--text-mid); }
  .week-task-proj { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 500; flex-shrink: 0; }
  .week-task-time { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); flex-shrink: 0; }

  /* TODAY section */
  .today-section { border: 1px solid transparent; border-radius: 4px; overflow: hidden; margin-bottom: 8px; display: flex; flex-direction: column; gap: 0; }
  .agent-row { display: flex; gap: 6px; justify-content: flex-start; padding: 8px 10px; border-bottom: 1px solid #141414; background: var(--bg); }
  .today-tasks-list { border-bottom: 1px solid #141414; }

  /* PLAN section */
  .plan-section { border: 1px solid transparent; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }

  /* Chart download status / banner */
  .chart-dl-line {
    font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: .06em;
    color: var(--text-mid); padding: 6px 12px; margin-bottom: 8px;
    background: var(--surface); border: 1px solid transparent; border-radius: 4px;
  }
  .chart-dl-banner {
    background: var(--surface); border: 1px solid transparent; border-radius: 4px;
    padding: 10px 14px; margin-bottom: 10px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .chart-dl-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .chart-dl-main > span { font-size: 13px; color: var(--text); }
  .chart-dl-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .chart-dl-btn {
    font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .08em;
    padding: 3px 10px; background: var(--chip-bg); border: 1px solid transparent;
    color: var(--text-mid); border-radius: 2px; cursor: pointer;
  }
  .chart-dl-btn:hover { background: rgba(255,255,255,.06); }
  .chart-dl-x {
    font-size: 12px; line-height: 1; padding: 3px 6px; background: transparent;
    border: 1px solid transparent; color: var(--text-mid); border-radius: 2px; cursor: pointer;
  }
  .chart-dl-x:hover { border-color: var(--border2); color: var(--text); }
  .chart-dl-miss { font-size: 12px; color: var(--text-mid); margin-bottom: 6px; }
  .chart-dl-folder { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-mid); }

  /* Mozart */
  .mozart-top { border: 1px solid transparent; border-radius: 4px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .mozart-title-row { display: flex; align-items: center; justify-content: space-between; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 400; letter-spacing: .08em; color: var(--text-dim); margin-bottom: 2px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: var(--text-dim); color: var(--text-mid); }
  .chat-out { overflow-y: auto; max-height: 40vh; min-height: 120px; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; scroll-behavior: smooth; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); }
  .chat-msg.assistant .chat-who { color: var(--text-dim); }
  .chat-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text-mid); line-height: 1.5; }
  .chat-text.dim { color: var(--text-dim); }
  :global(.moz-header) { font-family: 'Space Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); margin: 12px 0 4px; padding-bottom: 4px; border-bottom: 1px solid transparent; display: block; }
  :global(.moz-bullet) { padding: 2px 0 2px 12px; line-height: 1.6; color: var(--text-mid); display: block; }
  :global(.moz-spacer) { height: 8px; display: block; }
  :global(.moz-gap) { color: #e05a4a; font-weight: 500; }
  :global(.moz-ok) { color: #4caf82; font-weight: 500; }
  :global(.moz-confirmed) { color: var(--text-mid); font-weight: 500; }
  :global(.moz-tension) { color: #e8a838; font-weight: 500; }
  :global(.moz-outdated) { color: var(--text-mid); font-weight: 500; }
  :global(.moz-new) { color: var(--accent); font-weight: 500; }
  :global(.moz-next-label) { font-family: 'Space Mono', monospace; font-size: 9px; color: var(--text-mid); letter-spacing: .1em; margin-top: 10px; margin-bottom: 4px; display: block; }
  .chat-input-row { display: flex; gap: 6px; }
  .chat-correction-row { display: flex; gap: 6px; margin-top: 4px; }
  .btn-wrong { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 7px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; }
  .btn-wrong:hover { border-color: #c0392b; color: #c0392b; }
  .correction-inp { margin-top: 4px; width: 100%; background: var(--surface); border: 1px solid var(--border2); border-radius: 3px; padding: 5px 8px; font-size: 12px; color: var(--text-mid); font-family: 'DM Sans', sans-serif; outline: none; }
  .correction-inp:focus { border-color: #c0392b; }
  .chat-inp { flex: 1; background: var(--surface); border: 1px solid var(--border2); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: var(--accent-dim); }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; padding: 7px 12px; background: var(--surface2); color: var(--text); border: none; border-radius: 3px; cursor: pointer; }
  /* References tab */

</style>
