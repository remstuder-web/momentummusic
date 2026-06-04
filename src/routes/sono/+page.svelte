<script>
  import { onMount, onDestroy } from 'svelte'
  import { createClient } from '@supabase/supabase-js'

  const SUPABASE_URL      = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
  const SUPABASE_ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
  const SONO_PASSWORD     = 'sono2026'
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const AUDIO_SERVER      = 'http://localhost:4242/audio'

  // ── auth ─────────────────────────────────────────────────────────────────────
  let authed    = $state(false)
  let password  = $state('')
  let authError = $state('')

  function checkAuth() { return typeof localStorage !== 'undefined' && localStorage.getItem('sono_auth') === 'true' }
  function login() {
    if (password === SONO_PASSWORD) { localStorage.setItem('sono_auth','true'); authed=true; authError=''; loadAll() }
    else authError = 'Incorrect password.'
  }

  // ── songs ────────────────────────────────────────────────────────────────────
  let songs   = $state([])
  let loading = $state(false)

  async function loadAll() {
    loading = true
    const [songsRes, packsRes] = await Promise.all([
      supabase.from('songs').select('*').is('project_id', null).order('created_at', { ascending: false }),
      supabase.from('patches').select('*, patch_songs(song_id)').eq('artist','SONO').order('created_at', { ascending: false })
    ])
    songs = (songsRes.data || [])
      .filter(s => (s.work_data?.at_artist || '').toLowerCase() === 'sono')
      .sort((a, b) => parseInt(b.code) - parseInt(a.code))
    packs = buildPacks(packsRes.data || [])
    loading = false
    startPolling()
    startRealtimePacks()
  }

  // Songs: 5s poll (work_data changes need full row refresh)
  let pollInterval = null
  function startPolling() {
    if (pollInterval) return
    pollInterval = setInterval(async () => {
      const { data } = await supabase.from('songs').select('*').is('project_id', null)
      if (!data) return
      const fresh = data.filter(s => (s.work_data?.at_artist||'').toLowerCase() === 'sono')
        .sort((a, b) => parseInt(b.code) - parseInt(a.code))
      const cur = new Map(songs.map(s => [s.id, s]))
      const hasChange = fresh.length !== songs.length || fresh.some(s => {
        const c = cur.get(s.id); if (!c) return true
        return JSON.stringify(c.work_data) !== JSON.stringify(s.work_data)
          || JSON.stringify(c.tags) !== JSON.stringify(s.tags)
          || c.title !== s.title || c.tempo !== s.tempo || c.key !== s.key
      })
      if (hasChange) songs = fresh
    }, 5000)
  }

  // Packs: Supabase Realtime for instant cross-device sync
  let realtimeChannel = null
  function startRealtimePacks() {
    if (realtimeChannel) return
    realtimeChannel = supabase.channel('sono-packs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patches' }, async () => {
        // Re-fetch full packs with patch_songs join on any change
        const { data } = await supabase.from('patches').select('*, patch_songs(song_id)')
          .eq('artist', 'SONO').order('created_at', { ascending: false })
        if (data) packs = buildPacks(data)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patch_songs' }, async () => {
        const { data } = await supabase.from('patches').select('*, patch_songs(song_id)')
          .eq('artist', 'SONO').order('created_at', { ascending: false })
        if (data) packs = buildPacks(data)
      })
      .subscribe()
  }

  // ── packs (SONO patches) ──────────────────────────────────────────────────────
  let packs        = $state([])
  let showNewPack  = $state(false)
  let newPackName  = $state('')
  let packPickerOpen = $state({}) // song.id → bool

  function buildPacks(data) {
    return data.map(p => ({ ...p, song_ids: (p.patch_songs || []).map(ps => ps.song_id) }))
  }

  let songPackMap = $derived((() => {
    const m = {}
    for (const p of packs) {
      if (p.status === 'deleted') continue
      for (const id of (p.song_ids || [])) {
        if (!m[id]) m[id] = []
        if (!m[id].includes(p.name)) m[id].push(p.name)
      }
    }
    return m
  })())

  async function createPack() {
    const name = newPackName.trim()
    if (!name) return
    const { data } = await supabase.from('patches')
      .insert({ name, status: 'open', artist: 'SONO', dropped_files: [] })
      .select('*, patch_songs(song_id)').single()
    if (data) packs = [buildPacks([data])[0], ...packs]
    newPackName = ''; showNewPack = false
  }

  async function addSongToPack(song, pack) {
    const already = (pack.song_ids || []).includes(song.id)
    if (already) { packPickerOpen = { ...packPickerOpen, [song.id]: false }; return }
    await supabase.from('patch_songs').insert({ patch_id: pack.id, song_id: song.id })
    pack.song_ids = [...(pack.song_ids || []), song.id]
    packs = [...packs]
    packPickerOpen = { ...packPickerOpen, [song.id]: false }
  }

  async function removeSongFromPack(packId, songId) {
    await supabase.from('patch_songs').delete().eq('patch_id', packId).eq('song_id', songId)
    const p = packs.find(p => p.id === packId)
    if (p) p.song_ids = (p.song_ids || []).filter(id => id !== songId)
    packs = [...packs]
  }

  async function deletePack(pack) {
    if (!confirm(`Delete pack "${pack.name}"?`)) return
    await supabase.from('patches').delete().eq('id', pack.id)
    packs = packs.filter(p => p.id !== pack.id)
  }

  async function updatePackFeedback(pack, value) {
    if (value === (pack.feedback || '')) return
    pack.feedback = value; packs = [...packs]
    await supabase.from('patches').update({ feedback: value }).eq('id', pack.id)
  }

  // ── field saves ──────────────────────────────────────────────────────────────
  async function updateField(song, field, value) {
    song[field] = value; songs = [...songs]
    await supabase.from('songs').update({ [field]: value }).eq('id', song.id)
  }

  let tagInput = $state({})
  async function addTag(song) {
    const val = (tagInput[song.id] || '').trim(); if (!val) return
    tagInput = { ...tagInput, [song.id]: '' }
    await updateField(song, 'tags', [...(song.tags || []), val])
  }
  async function removeTag(song, tag) { await updateField(song, 'tags', (song.tags || []).filter(t => t !== tag)) }

  async function addDiscoTag(song, cat, tag) {
    const disco_tags = { ...(song.work_data?.disco_tags || {}) }
    disco_tags[cat] = [...new Set([...(disco_tags[cat] || []), tag])]
    const work_data = { ...(song.work_data || {}), disco_tags }
    song.work_data = work_data; songs = [...songs]
    discoPickerOpen = { ...discoPickerOpen, [`${song.id}_${cat}`]: false }
    await supabase.from('songs').update({ work_data }).eq('id', song.id)
  }
  async function removeDiscoTag(song, cat, tag) {
    const disco_tags = { ...(song.work_data?.disco_tags || {}) }
    disco_tags[cat] = (disco_tags[cat] || []).filter(t => t !== tag)
    const work_data = { ...(song.work_data || {}), disco_tags }
    song.work_data = work_data; songs = [...songs]
    await supabase.from('songs').update({ work_data }).eq('id', song.id)
  }

  let discoPickerOpen = $state({})

  // ── DISCO tag lists + categories ─────────────────────────────────────────────
  // DISCO_TAGS fetched from watcher on load (shared source of truth with DemoTab)
  let DISCO_TAGS = $state({
    tempo:         ['Downtempo','Midtempo','Uptempo','Fast','Slow'],
    mood:          ['Anthemic','Atmospheric','Bright','Building','Catchy','Cinematic','Confident','Cool','Dark','Dramatic','Dreamy','Driving','Emotive','Energetic','Epic','Fun','Gritty','Happy','Hopeful','Intense','Light','Minimal','Moody','Mysterious','Party','Percussive','Playful','Positive','Powerful','Quirky','Reflective','Retro','Rhythmic','Romantic','Sad','Sexy','Swagger','Tension','Upbeat','Uplifting','Warm'],
    genre:         ['Ambient','Blues','Classical','Country','Dance','Electronic','Folk','Funk','Hip hop/rap','Indie','Jazz','Latin','Metal','Pop','Punk','R&B','Reggae','Rock','Singer/songwriter','Soul','Urban','Vintage','World'],
    vocals:        ['Aahs','A cappella','Background vocals','Choir','Clean','Duet','Explicit','Female vocal','Foreign language','French language','German language','Harmonies','Instrumental','Male vocal','Oohs','Spanish language','Whispering','Whistling'],
    lyrical_theme: ['Adventure','Ambition','Betrayal','Celebration','Change','Christmas','Confidence','Conflict','Connection','Death','Desire','Destiny','Discovery','Dream','Empowerment','Energy','Escape','Faith','Family','Fear','Freedom','Friendship','Fun','Gratitude','Happiness','Heartbreak','Home','Hope','Identity','Individuality','Life','Loneliness','Longing','Loss','Love','Money','Nature','New beginning','Nostalgia','Pain','Party','Power','Rebellion','Regret','Relationship','Romance','Strength','Struggle','Success','Survival','Time','Together','Unity'],
    instrument:    ['Acoustic guitar','Bass','Brass','Clarinet','Drums','Electric guitar','Flute','Handclaps','Horns','Keyboard','Orchestral','Organ','Percussion','Piano','Saxophone','Strings','Synth','Trumpet','Ukelele'],
    type:          ['Cover','Demo','Easy-clear','Focus track','Mainstream','One stop','Recognizable','Rerecord','Samples','Score','Sound design','Soundtrack','Sting']
  })
  const DISCO_CATEGORIES = ['tempo','mood','genre','vocals','lyrical_theme','instrument','type']

  // ── filter state ─────────────────────────────────────────────────────────────
  let showFilterPanel = $state(false)
  let fTempo      = $state(new Set())
  let fMood       = $state(new Set())
  let fGenre      = $state(new Set())
  let fVocals     = $state(new Set())
  let fLyrical    = $state(new Set())
  let fInstrument = $state(new Set())
  let fType       = $state(new Set())
  let fBpmMin     = $state(60)
  let fBpmMax     = $state(200)
  let fCustomTag  = $state(new Set())
  let allCustomTags = $derived([...new Set(songs.flatMap(s => s.tags || []))].sort())

  function toggleFTempo(tag) { const n = new Set(fTempo); n.has(tag) ? n.delete(tag) : (n.clear(), n.add(tag)); fTempo = n }
  function toggleF(st, tag)  { const n = new Set(st); n.has(tag) ? n.delete(tag) : n.add(tag); return n }
  function clearAllFilters()  { fTempo=new Set(); fMood=new Set(); fGenre=new Set(); fVocals=new Set(); fLyrical=new Set(); fInstrument=new Set(); fType=new Set(); fBpmMin=60; fBpmMax=200; fCustomTag=new Set() }

  let hasActiveFilter = $derived(
    fTempo.size||fMood.size||fGenre.size||fVocals.size||fLyrical.size||fInstrument.size||fType.size||fBpmMin>60||fBpmMax<200||fCustomTag.size>0
  )

  let filteredSongs = $derived((() => songs.filter(s => {
    const dt = s.work_data?.disco_tags || {}
    if (fTempo.size      && !(dt.tempo         ||[]).some(t => fTempo.has(t)))      return false
    if (fMood.size       && !(dt.mood          ||[]).some(t => fMood.has(t)))       return false
    if (fGenre.size      && !(dt.genre         ||[]).some(t => fGenre.has(t)))      return false
    if (fVocals.size     && !(dt.vocals        ||[]).some(t => fVocals.has(t)))     return false
    if (fLyrical.size    && !(dt.lyrical_theme ||[]).some(t => fLyrical.has(t)))   return false
    if (fInstrument.size && !(dt.instrument    ||[]).some(t => fInstrument.has(t))) return false
    if (fType.size       && !(dt.type          ||[]).some(t => fType.has(t)))       return false
    if (fBpmMin>60||fBpmMax<200) { if (!s.tempo||s.tempo<fBpmMin||s.tempo>fBpmMax) return false }
    if (fCustomTag.size && ![...fCustomTag].every(t => (s.tags||[]).includes(t))) return false
    return true
  }))())

  // ── player ───────────────────────────────────────────────────────────────────
  let expandedId    = $state(null)
  let currentSongId = $state(null)
  let isPlaying     = $state(false)
  let currentTime   = $state(0)
  let duration      = $state(0)
  let hoveredSongId = $state(null)
  let player        = null
  let keydownHandler = null

  function getPlayer() {
    if (!player) {
      player = new Audio()
      player.addEventListener('timeupdate',     () => { currentTime = player.currentTime })
      player.addEventListener('loadedmetadata', () => { duration = player.duration })
      player.addEventListener('ended',          () => { isPlaying = false; currentSongId = null })
      player.addEventListener('play',           () => { isPlaying = true })
      player.addEventListener('pause',          () => { isPlaying = false })
    }
    return player
  }

  function playSong(songId, src) {
    if (!src) return
    const p = getPlayer(), id = String(songId)
    if (currentSongId === id) { p.paused ? p.play().catch(()=>{}) : p.pause(); return }
    p.pause(); p.src = src; p.currentTime = 0; currentSongId = id; p.load(); p.play().catch(()=>{})
  }

  function audioSrc(song) {
    if (song.work_data?.dropbox_stream_url) return song.work_data.dropbox_stream_url
    if (song.audio_path) return `${AUDIO_SERVER}/${encodeURIComponent(song.audio_path)}`
    return null
  }

  function getDownloadUrl(song) {
    // Prefer stored download URL; derive from stream URL if missing or malformed
    const dl = song.work_data?.dropbox_download_url
    if (dl && !dl.includes('&dl=0&dl=1')) return dl
    const stream = song.work_data?.dropbox_stream_url
    if (!stream) return null
    return stream
      .replace('dl.dropboxusercontent.com', 'www.dropbox.com')
      .replace(/([?&])dl=\d/, '$1dl=1')
      + (stream.includes('?') ? '&dl=1' : '?dl=1')
  }

  async function handleTitleChange(song, newTitle) {
    const trimmed = newTitle.trim().toUpperCase()
    if (!trimmed || trimmed === (song.title || '').trim().toUpperCase()) return
    song.title = trimmed; songs = [...songs]
    await supabase.from('songs').update({ title: trimmed }).eq('id', song.id)
    if (song.audio_path) {
      fetch('http://localhost:4242/rename-demo-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id, old_filename: song.audio_path, new_title: trimmed })
      }).then(async r => {
        const result = await r.json().catch(() => ({}))
        if (result.ok && result.new_filename && result.new_filename !== song.audio_path) {
          song.audio_path = result.new_filename; songs = [...songs]
        }
      }).catch(() => {}) // fire-and-forget — watcher may be offline
    }
  }

  function formatTime(s) {
    if (!s||isNaN(s)) return '0:00'
    return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')
  }

  onMount(() => {
    authed = checkAuth(); if (authed) loadAll()
    fetch('http://localhost:4242/disco-tags')
      .then(r => r.json())
      .then(d => { if (d && typeof d === 'object') DISCO_TAGS = d })
      .catch(() => {})
    keydownHandler = e => {
      if (e.code !== 'Space' || !hoveredSongId) return
      const tag = document.activeElement?.tagName
      if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return
      e.preventDefault()
      const song = songs.find(s => s.id === hoveredSongId)
      if (song) playSong(song.id, audioSrc(song))
    }
    window.addEventListener('keydown', keydownHandler)
  })
  onDestroy(() => {
    if (keydownHandler) { window.removeEventListener('keydown', keydownHandler); keydownHandler = null }
    if (player) { player.pause(); player.src=''; player=null }
    if (pollInterval) clearInterval(pollInterval)
    if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  })
</script>

<svelte:head>
  <title>SONO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400&display=swap" rel="stylesheet">
</svelte:head>

<svelte:window onclick={() => {
  if (Object.values(discoPickerOpen).some(Boolean)) discoPickerOpen = {}
  if (Object.values(packPickerOpen).some(Boolean)) packPickerOpen = {}
}} />

{#if !authed}
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-title">SONO</div>
      <div class="login-sub">Private demo access</div>
      <input class="login-inp" type="password" placeholder="Password"
        bind:value={password} onkeydown={e => e.key==='Enter' && login()} />
      {#if authError}<span class="login-err">{authError}</span>{/if}
      <button class="login-btn" onclick={login}>Enter</button>
    </div>
  </div>

{:else}
  <div class="outer">

    <!-- ── MAIN COLUMN ── -->
    <div class="main-col">
      <div class="page-header">
        <div class="header-left">
          <span class="page-title">SONO</span>
          <span class="page-sub">Track Library</span>
        </div>
        <div class="header-right">
          <button class="filter-toggle {hasActiveFilter ? 'active' : ''} {showFilterPanel ? 'open' : ''}"
            onclick={() => showFilterPanel = !showFilterPanel}>
            ⊞ Filter{hasActiveFilter ? ' ●' : ''}
          </button>
          <span class="page-count">{filteredSongs.length} / {songs.length} track{songs.length===1?'':'s'}</span>
        </div>
      </div>

      <!-- FILTER PANEL -->
      {#if showFilterPanel}
        <div class="filter-panel">
          <div class="fp-section">
            <span class="fp-label">TEMPO</span>
            <div class="fp-pills">
              {#each DISCO_TAGS.tempo as tag}
                <button class="fp-pill {fTempo.has(tag)?'sel':''}" onclick={() => toggleFTempo(tag)}>{tag}</button>
              {/each}
            </div>
          </div>
          <div class="fp-section">
            <span class="fp-label">MOOD</span>
            <div class="fp-pills">{#each DISCO_TAGS.mood as tag}<button class="fp-pill {fMood.has(tag)?'sel':''}" onclick={() => fMood=toggleF(fMood,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">GENRE</span>
            <div class="fp-pills">{#each DISCO_TAGS.genre as tag}<button class="fp-pill {fGenre.has(tag)?'sel':''}" onclick={() => fGenre=toggleF(fGenre,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">VOCALS</span>
            <div class="fp-pills">{#each DISCO_TAGS.vocals as tag}<button class="fp-pill {fVocals.has(tag)?'sel':''}" onclick={() => fVocals=toggleF(fVocals,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">LYRICAL THEME</span>
            <div class="fp-pills">{#each DISCO_TAGS.lyrical_theme as tag}<button class="fp-pill {fLyrical.has(tag)?'sel':''}" onclick={() => fLyrical=toggleF(fLyrical,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">INSTRUMENT</span>
            <div class="fp-pills">{#each DISCO_TAGS.instrument as tag}<button class="fp-pill {fInstrument.has(tag)?'sel':''}" onclick={() => fInstrument=toggleF(fInstrument,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">TYPE</span>
            <div class="fp-pills">{#each DISCO_TAGS.type as tag}<button class="fp-pill {fType.has(tag)?'sel':''}" onclick={() => fType=toggleF(fType,tag)}>{tag}</button>{/each}</div>
          </div>
          <div class="fp-section">
            <span class="fp-label">BPM RANGE</span>
            <div class="fp-bpm-wrap">
              <span class="fp-bpm-val">{fBpmMin}</span>
              <div class="fp-dual-range">
                <input type="range" min="60" max="200" step="1" value={fBpmMin} oninput={e => fBpmMin=Math.min(+e.target.value,fBpmMax-5)} />
                <input type="range" min="60" max="200" step="1" value={fBpmMax} oninput={e => fBpmMax=Math.max(+e.target.value,fBpmMin+5)} />
                <div class="fp-range-track"><div class="fp-range-fill" style="left:{(fBpmMin-60)/140*100}%;right:{(200-fBpmMax)/140*100}%"></div></div>
              </div>
              <span class="fp-bpm-val">{fBpmMax} BPM</span>
            </div>
          </div>
          {#if allCustomTags.length}
          <div class="fp-section">
            <span class="fp-label">CUSTOM TAGS</span>
            <div class="fp-pills">
              {#each allCustomTags as tag}
                <button class="fp-pill {fCustomTag.has(tag) ? 'sel' : ''}" onclick={() => fCustomTag = toggleF(fCustomTag, tag)}>{tag}</button>
              {/each}
            </div>
          </div>
          {/if}
          <div class="fp-footer">
            <span class="fp-count">{filteredSongs.length} result{filteredSongs.length===1?'':'s'}</span>
            {#if hasActiveFilter}
              <button class="fp-clear-btn" onclick={clearAllFilters}>✕ Clear All</button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- SONG LIST -->
      {#if loading}
        <p class="empty">Loading...</p>
      {:else if !songs.length}
        <p class="empty">No SONO demos yet.</p>
      {:else if !filteredSongs.length}
        <p class="empty">No results — <button class="link-btn" onclick={clearAllFilters}>clear filters</button></p>
      {:else}
        <div class="list">
          {#each filteredSongs as song (song.id)}
            {@const expanded = expandedId === song.id}
            {@const src = audioSrc(song)}
            {@const songPacks = songPackMap[song.id] || []}

            <div class="card {expanded?'exp':''}"
              onmouseenter={() => hoveredSongId = song.id}
              onmouseleave={() => hoveredSongId = null}>

              <div class="card-head" onclick={() => expandedId = expanded ? null : song.id}>
                <div class="head-left">
                  <span class="code">{song.code}</span>
                  {#if song.title}<span class="song-title">{song.title}</span>{/if}
                  {#each songPacks as pname}
                    <span class="pack-chip">→ {pname}</span>
                  {/each}
                </div>
                <div class="head-meta">
                  {#if song.tempo || song.key}
                    <span class="pill">{[song.tempo ? song.tempo+' BPM' : '', song.key||''].filter(Boolean).join(' · ')}</span>
                  {/if}
                </div>
                <div class="player-slot" onclick={e => e.stopPropagation()}>
                  {#if src}
                    <div class="mini-player {currentSongId===String(song.id)?'active':''}">
                      <button onclick={() => playSong(song.id, src)}>
                        {currentSongId===String(song.id) && isPlaying ? '⏸' : '▶'}
                      </button>
                      <span class="time">
                        {currentSongId===String(song.id) ? formatTime(currentTime)+' / '+formatTime(duration) : '0:00'}
                      </span>
                      <input type="range" class="seek-bar" min="0"
                        max={currentSongId===String(song.id) ? (duration||100) : 100}
                        value={currentSongId===String(song.id) ? currentTime : 0}
                        oninput={e => { if (player) player.currentTime = +e.target.value }} />
                    </div>
                  {:else if song.audio_path}
                    <span class="audio-unavail">not linked</span>
                  {/if}
                </div>
                {#if getDownloadUrl(song)}
                  <a href={getDownloadUrl(song)} target="_blank" rel="noopener" class="download-btn" onclick={e => e.stopPropagation()}>↓ DL</a>
                {/if}
                <!-- Add to pack button -->
                {#if packs.filter(p => p.status==='open').length}
                  <div class="pack-add-wrap" onclick={e => e.stopPropagation()}>
                    <button class="pack-add-btn {songPacks.length?'in-pack':''}"
                      onclick={() => packPickerOpen = {...packPickerOpen, [song.id]: !packPickerOpen[song.id]}}
                      title="Add to submission pack">+</button>
                    {#if packPickerOpen[song.id]}
                      <div class="pack-picker">
                        {#each packs.filter(p => p.status==='open') as pack}
                          <button class="pack-pick-opt {(pack.song_ids||[]).includes(song.id)?'active':''}"
                            onclick={() => addSongToPack(song, pack)}>
                            {pack.name}
                            {#if (pack.song_ids||[]).includes(song.id)}<span class="pick-check">✓</span>{/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
                <span class="arr">{expanded?'▾':'▸'}</span>
              </div>

              {#if expanded}
                <div class="card-body">
                  <div class="row1">
                    <div class="field" style="flex:1;min-width:0">
                      <label>TITLE</label>
                      <input class="inp-sm" placeholder="Title..." value={song.title||''}
                        onblur={e => handleTitleChange(song, e.target.value)}
                        onkeydown={e => e.key==='Enter' && e.target.blur()} />
                    </div>
                    <div class="field" style="flex:0 0 90px">
                      <label>CODE</label>
                      <input class="inp-sm mono" value={song.code} readonly />
                    </div>
                  </div>

                  {#if song.tempo || song.key}
                    <div class="row-meta">
                      {#if song.tempo}<span class="meta-item"><span class="meta-l">BPM</span><span class="meta-v">{song.tempo}</span></span>{/if}
                      {#if song.key}<span class="meta-item"><span class="meta-l">KEY</span><span class="meta-v">{song.key}</span></span>{/if}
                    </div>
                  {/if}

                  <div class="field">
                    <label>TAGS</label>
                    <div class="tags-row">
                      <input class="tag-inp-compact" placeholder="+ tag..."
                        value={tagInput[song.id]||''}
                        oninput={e => tagInput={...tagInput,[song.id]:e.target.value}}
                        onkeydown={e => e.key==='Enter' && addTag(song)} />
                      <div class="tags-inline">
                        {#each (song.tags||[]) as tag}
                          <span class="chip"><span class="chip-text">{tag}</span><button class="chip-del" onclick={() => removeTag(song,tag)}>×</button></span>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <div class="field">
                    <label>TAGS DISCO</label>
                    <div class="disco-wrap">
                      {#each DISCO_CATEGORIES as cat}
                        {@const assigned = (song.work_data?.disco_tags?.[cat]||[])}
                        {@const available = DISCO_TAGS[cat].filter(t => !assigned.includes(t))}
                        {@const pk = `${song.id}_${cat}`}
                        <div class="disco-cat-row">
                          <span class="disco-cat-lbl">{cat.replace('_',' ').toUpperCase()}</span>
                          <div class="disco-chips">
                            {#each assigned as tag}
                              <span class="chip"><span class="chip-text">{tag}</span><button class="chip-del" onclick={() => removeDiscoTag(song,cat,tag)}>×</button></span>
                            {/each}
                            {#if available.length}
                              <div class="disco-add-wrap" onclick={e => e.stopPropagation()}>
                                <button class="disco-add-btn" onclick={() => discoPickerOpen={...discoPickerOpen,[pk]:!discoPickerOpen[pk]}}>+</button>
                                {#if discoPickerOpen[pk]}
                                  <div class="disco-picker">
                                    {#each available as t}<button class="disco-pick-opt" onclick={() => addDiscoTag(song,cat,t)}>{t}</button>{/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>

                  <div class="field">
                    <label>NOTES</label>
                    <textarea class="ta" placeholder="Production notes..." value={song.notes||''} oninput={e => updateField(song,'notes',e.target.value)}></textarea>
                  </div>
                  <div class="field">
                    <label>FEEDBACK</label>
                    <textarea class="ta" placeholder="Feedback..." value={song.feedback||''} oninput={e => updateField(song,'feedback',e.target.value)}></textarea>
                  </div>

                  {#if packs.some(p => (p.song_ids||[]).includes(song.id) && p.status !== 'deleted')}
                    <div class="field">
                      <label>SUBMISSIONS</label>
                      <div class="song-subs">
                        {#each packs.filter(p => (p.song_ids||[]).includes(song.id) && p.status !== 'deleted') as pack}
                          <div class="song-sub-row">
                            <span class="song-sub-arrow">→</span>
                            <span class="song-sub-name">{pack.name}</span>
                            <span class="song-sub-status {pack.status}">{pack.status.toUpperCase()}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}

            </div>
          {/each}
        </div>
      {/if}
    </div><!-- end main-col -->

    <!-- ── SIDEBAR ── -->
    <div class="sidebar">
      <div class="sb-header">
        <span class="sb-title">SUBMISSIONS</span>
        <button class="sb-new-btn" onclick={() => showNewPack = !showNewPack}>+ New Pack</button>
      </div>


      {#if showNewPack}
        <div class="sb-new-form">
          <input class="inp-sm" placeholder="Pack name (e.g. SONY March 2026)"
            bind:value={newPackName}
            onkeydown={e => e.key==='Enter' && createPack()} />
          <div class="sb-new-actions">
            <button class="sb-create-btn" onclick={createPack}>Create</button>
            <button class="sb-cancel-btn" onclick={() => { showNewPack=false; newPackName='' }}>Cancel</button>
          </div>
        </div>
      {/if}

      {#if !packs.length}
        <p class="sb-empty">No packs yet.</p>
      {:else}
        <div class="sb-packs">
          {#each packs.filter(p => p.status !== 'deleted') as pack}
            <div class="sb-pack {pack.status}">
              <div class="sb-pack-head">
                <span class="sb-pack-name">{pack.name}</span>
                <span class="sb-pack-status {pack.status}">{pack.status.toUpperCase()}</span>
                <button class="sb-del-btn" onclick={() => deletePack(pack)} title="Delete pack">×</button>
              </div>
              {#if songs.filter(s => (pack.song_ids||[]).includes(s.id)).length}
                <div class="sb-pack-songs">
                  {#each songs.filter(s => (pack.song_ids||[]).includes(s.id)) as s}
                    <div class="sb-song-row">
                      <span class="sb-song-code">{s.code}</span>
                      <span class="sb-song-title">{s.title || s.code}</span>
                      {#if pack.status === 'open'}
                        <button class="sb-song-del" onclick={() => removeSongFromPack(pack.id, s.id)}>×</button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="sb-pack-empty">No songs yet — click + on a track.</p>
              {/if}
              <textarea class="sb-pack-notes" placeholder="Pack notes..."
                value={pack.feedback || ''}
                oninput={e => { pack.feedback = e.target.value; packs = [...packs] }}
                onblur={e => updatePackFeedback(pack, e.target.value)}></textarea>
            </div>
          {/each}
        </div>
      {/if}
    </div><!-- end sidebar -->

  </div><!-- end outer -->
{/if}

<style>
  :global(body) { background: #0a0a0a; color: #f5f1ea; margin: 0; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; }

  /* ── login ── */
  .login-wrap  { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box   { display: flex; flex-direction: column; gap: 12px; width: 280px; }
  .login-title { font-family: 'Space Mono', monospace; font-size: 24px; font-weight: 700; color: #c9a84c; letter-spacing: .12em; text-align: center; }
  .login-sub   { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; text-align: center; letter-spacing: .1em; margin-bottom: 4px; }
  .login-inp   { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 15px; padding: 10px 14px; outline: none; border-radius: 3px; }
  .login-inp:focus { border-color: rgba(201,168,76,.5); }
  .login-err   { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .login-btn   { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; padding: 10px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
  .login-btn:hover { background: #d4b660; }

  /* ── outer layout ── */
  .outer       { display: grid; grid-template-columns: 1fr 640px; gap: 24px; max-width: 1400px; margin: 0 auto; padding: 40px 16px 80px; min-height: 100vh; }
  .main-col    { min-width: 0; display: flex; flex-direction: column; }

  /* ── page header ── */
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .header-left { display: flex; align-items: baseline; gap: 14px; }
  .header-right { display: flex; align-items: center; gap: 10px; }
  .page-title  { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; color: #c9a84c; letter-spacing: .12em; }
  .page-sub    { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; letter-spacing: .08em; }
  .page-count  { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; }
  .empty       { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; text-align: center; padding: 40px 0; margin: 0; }
  .link-btn    { background: none; border: none; color: rgba(201,168,76,.7); font-family: 'Space Mono', monospace; font-size: 12px; cursor: pointer; padding: 0; text-decoration: underline; }

  /* ── filter toggle ── */
  .filter-toggle { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 5px 12px; background: #1c1c1c; border: 1px solid #252525; color: #9e9690; border-radius: 3px; cursor: pointer; transition: all .15s; letter-spacing: .06em; }
  .filter-toggle:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .filter-toggle.active { border-color: rgba(201,168,76,.5); color: #c9a84c; background: rgba(201,168,76,.06); }
  .filter-toggle.open   { border-color: rgba(201,168,76,.6); color: #c9a84c; background: rgba(201,168,76,.08); }

  /* ── filter panel ── */
  .filter-panel { background: #141414; border: 1px solid #252525; border-radius: 4px; padding: 14px 16px 10px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px; }
  .fp-section   { display: flex; flex-direction: column; gap: 5px; }
  .fp-label     { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.6); text-transform: uppercase; }
  .fp-pills     { display: flex; flex-wrap: wrap; gap: 4px; }
  .fp-pill      { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; border-radius: 2px; background: transparent; border: 1px solid #2a2a2a; color: #6a6560; cursor: pointer; transition: all .1s; white-space: nowrap; line-height: 1.6; }
  .fp-pill:hover { border-color: rgba(201,168,76,.35); color: #cec9c1; }
  .fp-pill.sel  { background: #c9a84c; border-color: #c9a84c; color: #0a0a0a; font-weight: 700; }
  .fp-bpm-wrap  { display: flex; align-items: center; gap: 10px; }
  .fp-bpm-val   { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; flex-shrink: 0; min-width: 44px; }
  .fp-dual-range { position: relative; flex: 1; height: 20px; }
  .fp-dual-range input[type=range] { position: absolute; width: 100%; top: 3px; height: 14px; background: transparent; -webkit-appearance: none; appearance: none; pointer-events: none; }
  .fp-dual-range input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; background: #c9a84c; border-radius: 50%; cursor: pointer; pointer-events: all; }
  .fp-dual-range input[type=range]::-moz-range-thumb { width: 13px; height: 13px; background: #c9a84c; border-radius: 50%; cursor: pointer; pointer-events: all; border: none; }
  .fp-range-track { position: absolute; top: 8px; left: 0; right: 0; height: 3px; background: #2a2a2a; border-radius: 2px; pointer-events: none; }
  .fp-range-fill  { position: absolute; top: 0; height: 100%; background: #c9a84c; border-radius: 2px; }
  .fp-tag-search { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 5px 10px; outline: none; border-radius: 3px; width: 200px; }
  .fp-tag-search:focus { border-color: rgba(201,168,76,.4); }
  .fp-tag-search::placeholder { color: #333; }
  .fp-footer    { display: flex; align-items: center; gap: 12px; padding-top: 6px; border-top: 1px solid #1c1c1c; }
  .fp-count     { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .fp-clear-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 4px 12px; background: transparent; border: 1px solid rgba(201,168,76,.35); color: rgba(201,168,76,.8); border-radius: 2px; cursor: pointer; }
  .fp-clear-btn:hover { background: rgba(201,168,76,.08); color: #c9a84c; }

  /* ── card list ── */
  .list { display: flex; flex-direction: column; gap: 6px; }
  .card { border: 1px solid #252525; border-radius: 4px; overflow: visible; }
  .card.exp { border-color: rgba(201,168,76,.45); }
  .card-head  { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 52px; background: #1c1c1c; cursor: pointer; user-select: none; transition: background .15s; }
  .card-head:hover { background: #222; }
  .card.exp .card-head { background: #252525; }
  .head-left  { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; overflow: hidden; }
  .code       { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #c9a84c; flex-shrink: 0; }
  .song-title { font-size: 13px; color: #cec9c1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pack-chip  { font-family: 'Space Mono', monospace; font-size: 9px; padding: 1px 6px; background: rgba(201,168,76,.08); border: 1px solid rgba(201,168,76,.3); border-radius: 2px; color: #c9a84c; white-space: nowrap; flex-shrink: 0; }
  .head-meta  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .pill       { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 2px; background: #1a1a1a; border: 1px solid #2a2a2a; color: #9e9690; }
  .player-slot { flex-shrink: 0; width: 180px; overflow: hidden; }
  .mini-player { display: flex; align-items: center; gap: 5px; width: 100%; }
  .mini-player button { background: none; border: none; color: #9e9690; cursor: pointer; font-size: 14px; padding: 2px 3px; flex-shrink: 0; }
  .mini-player.active button { color: #f5f1ea; }
  .mini-player .time { font-size: 10px; font-family: 'Space Mono', monospace; color: #555; width: 70px; text-align: right; flex-shrink: 0; }
  .mini-player.active .time { color: #9e9690; }
  .seek-bar     { flex: 1; min-width: 0; height: 3px; accent-color: #c9a84c; cursor: pointer; }
  .audio-unavail { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; flex-shrink: 0; }
  .download-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 10px; min-width: 36px; background: transparent; border: 1px solid rgba(201,168,76,.45); color: #c9a84c; border-radius: 2px; cursor: pointer; text-decoration: none; flex-shrink: 0; transition: all .15s; text-align: center; }
  .download-btn:hover { background: rgba(201,168,76,.12); border-color: #c9a84c; }
  .arr          { font-size: 12px; color: #555; flex-shrink: 0; }

  /* pack add button */
  .pack-add-wrap { position: relative; flex-shrink: 0; }
  .pack-add-btn  { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; width: 22px; height: 22px; background: transparent; border: 1px solid #2a2a2a; color: #444; border-radius: 2px; cursor: pointer; padding: 0; line-height: 1; }
  .pack-add-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .pack-add-btn.in-pack { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .pack-picker   { position: absolute; top: calc(100% + 4px); right: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 99; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,.6); overflow: hidden; }
  .pack-pick-opt { display: flex; align-items: center; justify-content: space-between; width: 100%; font-family: 'Space Mono', monospace; font-size: 10px; padding: 7px 10px; background: transparent; border: none; border-bottom: 1px solid #1a1a1a; color: #9e9690; cursor: pointer; text-align: left; }
  .pack-pick-opt:last-child { border-bottom: none; }
  .pack-pick-opt:hover { background: #252525; color: #c9a84c; }
  .pack-pick-opt.active { color: #c9a84c; }
  .pick-check    { color: #4caf82; font-size: 11px; }

  /* card body */
  .card-body { padding: 16px; border-top: 1px solid #252525; background: #0a0a0a; display: flex; flex-direction: column; gap: 14px; }
  .row1      { display: flex; gap: 8px; align-items: flex-end; }
  .row-meta  { display: flex; gap: 16px; }
  .meta-item { display: flex; align-items: center; gap: 6px; }
  .meta-l    { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .1em; color: rgba(201,168,76,.5); }
  .meta-v    { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #9e9690; }
  .field     { display: flex; flex-direction: column; gap: 5px; }
  label      { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: rgba(201,168,76,.65); }
  .inp-sm    { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 6px 10px; outline: none; border-radius: 3px; width: 100%; box-sizing: border-box; }
  .inp-sm:focus { border-color: rgba(201,168,76,.5); }
  .inp-sm.mono  { font-family: 'Space Mono', monospace; font-size: 12px; color: #c9a84c; }
  .inp-sm[readonly] { background: #111; color: #555; cursor: default; border-color: #1c1c1c; }
  .ta        { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 8px 10px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 72px; line-height: 1.6; box-sizing: border-box; }
  .ta:focus  { border-color: rgba(201,168,76,.5); }
  .tags-row  { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tags-inline { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag-inp-compact { background: #1c1c1c; border: 1px solid #252525; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 2px 8px; outline: none; border-radius: 2px; width: 110px; flex-shrink: 0; }
  .tag-inp-compact:focus { border-color: rgba(201,168,76,.4); }
  .tag-inp-compact::placeholder { color: #333; }
  .chip      { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 8px; background: rgba(201,168,76,.05); border: 1px solid rgba(201,168,76,.2); border-radius: 2px; }
  .chip-text { font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; }
  .chip-del  { background: none; border: none; color: #9e9690; cursor: pointer; padding: 0; font-size: 13px; opacity: .6; line-height: 1; }
  .chip-del:hover { opacity: 1; }
  .disco-wrap    { display: flex; flex-direction: column; gap: 5px; }
  .disco-cat-row { display: flex; align-items: flex-start; gap: 6px; }
  .disco-cat-lbl { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .1em; color: rgba(201,168,76,.5); flex-shrink: 0; width: 90px; padding-top: 4px; }
  .disco-chips   { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .disco-add-wrap { position: relative; }
  .disco-add-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; width: 20px; height: 20px; background: transparent; border: 1px solid #2a2a2a; color: #444; border-radius: 2px; cursor: pointer; padding: 0; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .disco-add-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .disco-picker  { position: absolute; top: calc(100% + 4px); left: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 99; max-height: 160px; overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,.6); min-width: 140px; }
  .disco-pick-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 10px; padding: 5px 10px; background: transparent; border: none; border-bottom: 1px solid #1a1a1a; color: #9e9690; cursor: pointer; text-align: left; }
  .disco-pick-opt:last-child { border-bottom: none; }
  .disco-pick-opt:hover { background: #252525; color: #c9a84c; }

  /* ── sidebar ── */
  .sidebar      { border-left: 1px solid #303030; padding: 0 0 0 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .sb-header    { display: flex; flex-direction: column; gap: 8px; }
  .sb-title     { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); }
  .sb-new-btn   { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 6px; width: 100%; background: transparent; border: 1px solid rgba(201,168,76,.4); color: #c9a84c; border-radius: 2px; cursor: pointer; text-align: center; letter-spacing: .06em; }
  .sb-new-btn:hover { background: rgba(201,168,76,.08); border-color: #c9a84c; }
  .sb-new-form  { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #141414; border: 1px solid #252525; border-radius: 3px; }
  .sb-new-actions { display: flex; gap: 6px; }
  .sb-create-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 4px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 2px; cursor: pointer; }
  .sb-cancel-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 10px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; }
  .sb-empty     { font-family: 'Space Mono', monospace; font-size: 10px; color: #333; margin: 0; }
  .sb-packs     { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .sb-pack      { border: 1px solid #252525; border-radius: 3px; overflow: hidden; width: 100%; box-sizing: border-box; }
  .sb-pack.open { border-color: rgba(201,168,76,.25); }
  .sb-pack-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 7px 8px; background: #1c1c1c; width: 100%; box-sizing: border-box; }
  .sb-pack-name { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: #cec9c1; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-pack-status { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 2px; flex-shrink: 0; }
  .sb-pack-status.open     { color: #c9a84c; border: 1px solid rgba(201,168,76,.3); background: rgba(201,168,76,.06); }
  .sb-pack-status.archived { color: #444;    border: 1px solid #252525; }
  .sb-pack-status.sent     { color: #4a9fd4; border: 1px solid rgba(74,159,212,.3); background: rgba(74,159,212,.06); }
  .sb-del-btn { background: transparent; border: none; color: #333; font-size: 16px; cursor: pointer; padding: 0 2px; flex-shrink: 0; line-height: 1; }
  .sb-del-btn:hover { color: #e05a4a; }
  .sb-pack-songs { display: flex; flex-direction: column; gap: 1px; padding: 4px 0; }
  .sb-song-row  { display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
  .sb-song-code { font-family: 'Space Mono', monospace; font-size: 9px; color: #c9a84c; flex-shrink: 0; }
  .sb-song-title { font-size: 11px; color: #9e9690; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-song-del  { background: transparent; border: none; color: #333; font-size: 14px; cursor: pointer; padding: 0; flex-shrink: 0; }
  .sb-song-del:hover { color: #e05a4a; }
  .sb-pack-empty { font-family: 'Space Mono', monospace; font-size: 9px; color: #2a2a2a; padding: 6px 10px; margin: 0; }
  .sb-pack-notes { background: #111; border: none; border-top: 1px solid #1a1a1a; color: #6a6560; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 300; padding: 6px 10px; resize: none; width: 100%; min-height: 44px; outline: none; line-height: 1.5; box-sizing: border-box; }
  .sb-pack-notes:focus { color: #9e9690; background: #141414; }
  .sb-pack-notes::placeholder { color: #2a2a2a; }

  /* submissions list in card body */
  .song-subs      { display: flex; flex-direction: column; gap: 4px; }
  .song-sub-row   { display: flex; align-items: center; gap: 8px; }
  .song-sub-arrow { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; flex-shrink: 0; }
  .song-sub-name  { font-family: 'Space Mono', monospace; font-size: 11px; color: #9e9690; flex: 1; }
  .song-sub-status { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 2px; flex-shrink: 0; }
  .song-sub-status.open     { color: #c9a84c; border: 1px solid rgba(201,168,76,.3); background: rgba(201,168,76,.06); }
  .song-sub-status.sent     { color: #4a9fd4; border: 1px solid rgba(74,159,212,.3); background: rgba(74,159,212,.06); }
  .song-sub-status.archived { color: #444;    border: 1px solid #252525; }
</style>
