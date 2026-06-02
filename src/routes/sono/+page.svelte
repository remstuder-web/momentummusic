<script>
  import { onMount, onDestroy } from 'svelte'
  import { createClient } from '@supabase/supabase-js'

  const SUPABASE_URL     = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
  const SUPABASE_ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
  const SONO_PASSWORD    = 'sono2026'

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const AUDIO_SERVER = 'http://localhost:4242/audio'

  // ── auth ─────────────────────────────────────────────────────────────────────
  let authed     = $state(false)
  let password   = $state('')
  let authError  = $state('')

  function checkAuth() {
    return typeof localStorage !== 'undefined' && localStorage.getItem('sono_auth') === 'true'
  }
  function login() {
    if (password === SONO_PASSWORD) {
      localStorage.setItem('sono_auth', 'true')
      authed = true; authError = ''; loadSongs()
    } else {
      authError = 'Incorrect password.'
    }
  }

  // ── data ─────────────────────────────────────────────────────────────────────
  let songs   = $state([])
  let loading = $state(false)

  async function loadSongs() {
    loading = true
    const { data } = await supabase.from('songs').select('*').is('project_id', null)
      .order('created_at', { ascending: false })
    songs = (data || [])
      .filter(s => (s.work_data?.at_artist || '').toLowerCase() === 'sono')
      .sort((a, b) => parseInt(b.code) - parseInt(a.code))
    songs.forEach(s => {
      console.log('disco_tags:', s.code, s.work_data?.disco_tags)
      console.log('download url:', s.code, s.work_data?.dropbox_download_url)
    })
    loading = false
    startPolling()
  }

  let pollInterval = null
  function startPolling() {
    if (pollInterval) return
    pollInterval = setInterval(async () => {
      const { data } = await supabase.from('songs').select('*').is('project_id', null)
      if (!data) return
      const fresh = data
        .filter(s => (s.work_data?.at_artist||'').toLowerCase() === 'sono')
        .sort((a, b) => parseInt(b.code) - parseInt(a.code))
      // Detect any change: count, work_data (disco_tags), tags, title
      const current = new Map(songs.map(s => [s.id, s]))
      const hasChange = fresh.length !== songs.length || fresh.some(s => {
        const c = current.get(s.id)
        if (!c) return true
        return JSON.stringify(c.work_data) !== JSON.stringify(s.work_data)
          || JSON.stringify(c.tags) !== JSON.stringify(s.tags)
          || c.title !== s.title || c.tempo !== s.tempo || c.key !== s.key
      })
      if (hasChange) songs = fresh
    }, 5000)
  }

  // ── field saves ──────────────────────────────────────────────────────────────
  async function updateField(song, field, value) {
    song[field] = value
    songs = [...songs]
    await supabase.from('songs').update({ [field]: value }).eq('id', song.id)
  }

  async function updateDemoType(song, type) {
    if (type === (song.work_data?.demo_type || 'SONG')) return
    const work_data = { ...(song.work_data || {}), demo_type: type }
    song.work_data = work_data; songs = [...songs]
    await supabase.from('songs').update({ work_data }).eq('id', song.id)
  }

  let tagInput = $state({})

  async function addTag(song) {
    const val = (tagInput[song.id] || '').trim()
    if (!val) return
    const tags = [...(song.tags || []), val]
    tagInput = { ...tagInput, [song.id]: '' }
    await updateField(song, 'tags', tags)
  }
  async function removeTag(song, tag) {
    await updateField(song, 'tags', (song.tags || []).filter(t => t !== tag))
  }

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

  let discoPickerOpen = $state({}) // `${song.id}_${cat}` → bool

  // ── DISCO tag lists ───────────────────────────────────────────────────────────
  const DISCO_TAGS = {
    tempo:         ['Downtempo','Midtempo','Uptempo','Fast','Slow'],
    mood:          ['Anthemic','Atmospheric','Bright','Building','Catchy','Cinematic','Confident','Cool','Dark','Dramatic','Dreamy','Driving','Emotive','Energetic','Epic','Fun','Gritty','Happy','Hopeful','Intense','Light','Minimal','Moody','Mysterious','Party','Percussive','Playful','Positive','Powerful','Quirky','Reflective','Retro','Rhythmic','Romantic','Sad','Sexy','Swagger','Tension','Upbeat','Uplifting','Warm'],
    genre:         ['Ambient','Blues','Classical','Country','Dance','Electronic','Folk','Funk','Hip hop/rap','Indie','Jazz','Latin','Metal','Pop','Punk','R&B','Reggae','Rock','Singer/songwriter','Soul','Urban','Vintage','World'],
    vocals:        ['Aahs','A cappella','Background vocals','Choir','Clean','Duet','Explicit','Female vocal','Foreign language','French language','German language','Harmonies','Instrumental','Male vocal','Oohs','Spanish language','Whispering','Whistling'],
    lyrical_theme: ['Adventure','Ambition','Betrayal','Celebration','Change','Christmas','Confidence','Conflict','Connection','Death','Desire','Destiny','Discovery','Dream','Empowerment','Energy','Escape','Faith','Family','Fear','Freedom','Friendship','Fun','Gratitude','Happiness','Heartbreak','Home','Hope','Identity','Individuality','Life','Loneliness','Longing','Loss','Love','Money','Nature','New beginning','Nostalgia','Pain','Party','Power','Rebellion','Regret','Relationship','Romance','Strength','Struggle','Success','Survival','Time','Together','Unity'],
    instrument:    ['Acoustic guitar','Bass','Brass','Clarinet','Drums','Electric guitar','Flute','Handclaps','Horns','Keyboard','Orchestral','Organ','Percussion','Piano','Saxophone','Strings','Synth','Trumpet','Ukelele'],
    type:          ['Cover','Demo','Easy-clear','Focus track','Mainstream','One stop','Recognizable','Rerecord','Samples','Score','Sound design','Soundtrack','Sting']
  }
  const DISCO_CATEGORIES = ['tempo','mood','genre','vocals','lyrical_theme','instrument','type']

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
      player.addEventListener('timeupdate',      () => { currentTime = player.currentTime })
      player.addEventListener('loadedmetadata',  () => { duration = player.duration })
      player.addEventListener('ended',           () => { isPlaying = false; currentSongId = null })
      player.addEventListener('play',            () => { isPlaying = true })
      player.addEventListener('pause',           () => { isPlaying = false })
    }
    return player
  }

  function playSong(songId, src) {
    if (!src) return
    const p = getPlayer()
    const id = String(songId)
    if (currentSongId === id) { p.paused ? p.play().catch(() => {}) : p.pause(); return }
    p.pause(); p.src = src; p.currentTime = 0; currentSongId = id; p.load()
    p.play().catch(() => {})
  }

  function audioSrc(song) {
    if (song.work_data?.dropbox_stream_url) return song.work_data.dropbox_stream_url
    if (song.audio_path) return `${AUDIO_SERVER}/${encodeURIComponent(song.audio_path)}`
    return null
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00'
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
  }

  onMount(() => {
    authed = checkAuth()
    if (authed) loadSongs()
    keydownHandler = e => {
      if (e.code !== 'Space' || !hoveredSongId) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      const song = songs.find(s => s.id === hoveredSongId)
      if (song) playSong(song.id, audioSrc(song))
    }
    window.addEventListener('keydown', keydownHandler)
  })
  onDestroy(() => {
    if (keydownHandler) { window.removeEventListener('keydown', keydownHandler); keydownHandler = null }
    if (player) { player.pause(); player.src = ''; player = null }
    if (pollInterval) clearInterval(pollInterval)
  })
</script>

<svelte:head>
  <title>SONO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400&display=swap" rel="stylesheet">
</svelte:head>

<svelte:window onclick={() => { if (Object.values(discoPickerOpen).some(Boolean)) discoPickerOpen = {} }} />

{#if !authed}
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-title">SONO</div>
      <div class="login-sub">Private demo access</div>
      <input class="login-inp" type="password" placeholder="Password"
        bind:value={password} onkeydown={e => e.key === 'Enter' && login()} />
      {#if authError}<span class="login-err">{authError}</span>{/if}
      <button class="login-btn" onclick={login}>Enter</button>
    </div>
  </div>

{:else}
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <span class="page-title">SONO</span>
        <span class="page-sub">Track Library</span>
      </div>
      <span class="page-count">{songs.length} track{songs.length === 1 ? '' : 's'}</span>
    </div>

    {#if loading}
      <p class="empty">Loading...</p>
    {:else if !songs.length}
      <p class="empty">No SONO demos yet.</p>
    {:else}
      <div class="list">
        {#each songs as song (song.id)}
          {@const expanded = expandedId === song.id}
          {@const src = audioSrc(song)}

          <div class="card {expanded ? 'exp' : ''}"
            onmouseenter={() => hoveredSongId = song.id}
            onmouseleave={() => hoveredSongId = null}>

            <!-- CARD HEAD -->
            <div class="card-head" onclick={() => expandedId = expanded ? null : song.id}>
              <div class="head-left">
                <span class="code">{song.code}</span>
                {#if song.title}<span class="song-title">{song.title}</span>{/if}
              </div>
              <div class="head-meta">
                {#if song.tempo || song.key}
                  <span class="pill">{[song.tempo ? song.tempo + ' BPM' : '', song.key || ''].filter(Boolean).join(' · ')}</span>
                {/if}
              </div>
              <div class="player-slot" onclick={e => e.stopPropagation()}>
                {#if src}
                  <div class="mini-player {currentSongId === String(song.id) ? 'active' : ''}">
                    <button onclick={() => playSong(song.id, src)}>
                      {currentSongId === String(song.id) && isPlaying ? '⏸' : '▶'}
                    </button>
                    <span class="time">
                      {currentSongId === String(song.id) ? formatTime(currentTime) + ' / ' + formatTime(duration) : '0:00'}
                    </span>
                    <input type="range" class="seek-bar" min="0"
                      max={currentSongId === String(song.id) ? (duration || 100) : 100}
                      value={currentSongId === String(song.id) ? currentTime : 0}
                      oninput={e => { if (player) player.currentTime = +e.target.value }} />
                  </div>
                {:else if song.audio_path}
                  <span class="audio-unavail">audio not yet linked</span>
                {/if}
              </div>
              {#if song.work_data?.dropbox_download_url}
                <a href={song.work_data.dropbox_download_url} target="_blank" rel="noopener" class="download-btn" onclick={e => e.stopPropagation()}>↓</a>
              {/if}
              <span class="arr">{expanded ? '▾' : '▸'}</span>
            </div>

            <!-- CARD BODY -->
            {#if expanded}
              <div class="card-body">

                <!-- Row 1: title + code -->
                <div class="row1">
                  <div class="field" style="flex:1;min-width:0">
                    <label>TITLE</label>
                    <input class="inp-sm" placeholder="Title..." value={song.title || ''}
                      onblur={e => { const v = e.target.value.trim(); if (v !== (song.title||'').trim()) updateField(song,'title',v) }}
                      onkeydown={e => e.key === 'Enter' && e.target.blur()} />
                  </div>
                  <div class="field" style="flex:0 0 90px">
                    <label>CODE</label>
                    <input class="inp-sm mono" value={song.code} readonly />
                  </div>
                </div>

                <!-- Row 2: BPM + KEY (read-only) -->
                {#if song.tempo || song.key}
                  <div class="row-meta">
                    {#if song.tempo}<span class="meta-item"><span class="meta-l">BPM</span><span class="meta-v">{song.tempo}</span></span>{/if}
                    {#if song.key}<span class="meta-item"><span class="meta-l">KEY</span><span class="meta-v">{song.key}</span></span>{/if}
                  </div>
                {/if}

                <!-- TAGS -->
                <div class="field">
                  <label>TAGS</label>
                  <div class="tags-row">
                    <input class="tag-inp-compact" placeholder="+ tag..."
                      value={tagInput[song.id]||''}
                      oninput={e => tagInput = {...tagInput, [song.id]: e.target.value}}
                      onkeydown={e => e.key === 'Enter' && addTag(song)} />
                    <div class="tags-inline">
                      {#each (song.tags || []) as tag}
                        <span class="chip"><span class="chip-text">{tag}</span><button class="chip-del" onclick={() => removeTag(song, tag)}>×</button></span>
                      {/each}
                    </div>
                  </div>
                </div>

                <!-- TAGS DISCO -->
                <div class="field">
                  <label>TAGS DISCO</label>
                  <div class="disco-wrap">
                    {#each DISCO_CATEGORIES as cat}
                      {@const assigned = (song.work_data?.disco_tags?.[cat] || [])}
                      {@const available = DISCO_TAGS[cat].filter(t => !assigned.includes(t))}
                      {@const pickerKey = `${song.id}_${cat}`}
                      <div class="disco-cat-row">
                        <span class="disco-cat-lbl">{cat.replace('_',' ').toUpperCase()}</span>
                        <div class="disco-chips">
                          {#each assigned as tag}
                            <span class="chip"><span class="chip-text">{tag}</span><button class="chip-del" onclick={() => removeDiscoTag(song, cat, tag)}>×</button></span>
                          {/each}
                          {#if available.length}
                            <div class="disco-add-wrap" onclick={e => e.stopPropagation()}>
                              <button class="disco-add-btn" onclick={() => discoPickerOpen = {...discoPickerOpen, [pickerKey]: !discoPickerOpen[pickerKey]}}>+</button>
                              {#if discoPickerOpen[pickerKey]}
                                <div class="disco-picker">
                                  {#each available as t}
                                    <button class="disco-pick-opt" onclick={() => addDiscoTag(song, cat, t)}>{t}</button>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>

                <!-- NOTES -->
                <div class="field">
                  <label>NOTES</label>
                  <textarea class="ta" placeholder="Production notes..."
                    value={song.notes || ''}
                    oninput={e => updateField(song, 'notes', e.target.value)}></textarea>
                </div>

                <!-- FEEDBACK -->
                <div class="field">
                  <label>FEEDBACK</label>
                  <textarea class="ta" placeholder="Feedback..."
                    value={song.feedback || ''}
                    oninput={e => updateField(song, 'feedback', e.target.value)}></textarea>
                </div>

              </div>
            {/if}

          </div>
        {/each}
      </div>
    {/if}
  </div>
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

  /* ── page layout ── */
  .page        { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .header-left { display: flex; align-items: baseline; gap: 14px; }
  .page-title  { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; color: #c9a84c; letter-spacing: .12em; }
  .page-sub    { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; letter-spacing: .08em; }
  .page-count  { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; }
  .empty       { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; text-align: center; padding: 40px 0; }

  /* ── card list ── */
  .list { display: flex; flex-direction: column; gap: 6px; }
  .card { border: 1px solid #252525; border-radius: 4px; overflow: visible; }
  .card.exp { border-color: rgba(201,168,76,.45); }

  /* head */
  .card-head  { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 52px; background: #1c1c1c; cursor: pointer; user-select: none; transition: background .15s; position: relative; }
  .card-head:hover { background: #222; }
  .card.exp .card-head { background: #252525; }
  .head-left  { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; overflow: hidden; }
  .code       { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #c9a84c; flex-shrink: 0; }
  .song-title { font-size: 13px; color: #cec9c1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head-meta  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .type-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 2px; color: #c9a84c; border: 1px solid rgba(201,168,76,.35); background: rgba(201,168,76,.06); }
  .pill       { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 2px; background: #1a1a1a; border: 1px solid #2a2a2a; color: #9e9690; }
  .player-slot { flex-shrink: 0; }
  .mini-player { display: flex; align-items: center; gap: 6px; width: 230px; }
  .mini-player button { background: none; border: none; color: #9e9690; cursor: pointer; font-size: 14px; padding: 2px 4px; flex-shrink: 0; }
  .mini-player.active button { color: #f5f1ea; }
  .mini-player .time { font-size: 10px; font-family: 'Space Mono', monospace; color: #555; width: 80px; text-align: right; flex-shrink: 0; }
  .mini-player.active .time { color: #9e9690; }
  .seek-bar   { flex: 1; height: 3px; accent-color: #c9a84c; cursor: pointer; }
  .arr          { font-size: 12px; color: #555; flex-shrink: 0; }
  .audio-unavail { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; flex-shrink: 0; }
  .download-btn  { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 8px; background: transparent; border: 1px solid rgba(201,168,76,.35); color: rgba(201,168,76,.8); border-radius: 2px; cursor: pointer; text-decoration: none; flex-shrink: 0; transition: all .15s; }
  .download-btn:hover { background: rgba(201,168,76,.08); border-color: rgba(201,168,76,.6); color: #c9a84c; }

  /* body */
  .card-body { padding: 16px; border-top: 1px solid #252525; background: #0a0a0a; display: flex; flex-direction: column; gap: 14px; }

  /* row 1 */
  .row1 { display: flex; gap: 8px; align-items: flex-end; }

  /* row meta */
  .row-meta  { display: flex; gap: 16px; }
  .meta-item { display: flex; align-items: center; gap: 6px; }
  .meta-l    { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .1em; color: rgba(201,168,76,.5); }
  .meta-v    { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #9e9690; }

  /* fields */
  .field { display: flex; flex-direction: column; gap: 5px; }
  label  { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: rgba(201,168,76,.65); }
  .inp-sm { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 6px 10px; outline: none; border-radius: 3px; width: 100%; box-sizing: border-box; }
  .inp-sm:focus { border-color: rgba(201,168,76,.5); }
  .inp-sm.mono  { font-family: 'Space Mono', monospace; font-size: 12px; color: #c9a84c; }
  .inp-sm[readonly] { background: #111; color: #555; cursor: default; border-color: #1c1c1c; }
  .ta { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 8px 10px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 72px; line-height: 1.6; box-sizing: border-box; }
  .ta:focus { border-color: rgba(201,168,76,.5); }

  /* tags */
  .tags-row   { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tags-inline { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag-inp-compact { background: #1c1c1c; border: 1px solid #252525; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 2px 8px; outline: none; border-radius: 2px; width: 110px; flex-shrink: 0; }
  .tag-inp-compact:focus { border-color: rgba(201,168,76,.4); }
  .tag-inp-compact::placeholder { color: #333; }

  /* chips (shared by custom tags + DISCO) */
  .chip      { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px 2px 8px; background: rgba(201,168,76,.05); border: 1px solid rgba(201,168,76,.2); border-radius: 2px; }
  .chip-text { font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; }
  .chip-del  { background: none; border: none; color: #9e9690; cursor: pointer; padding: 0; font-size: 13px; opacity: .6; line-height: 1; }
  .chip-del:hover { opacity: 1; }

  /* DISCO section */
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
</style>
