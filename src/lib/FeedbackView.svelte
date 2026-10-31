<script>
  // Shared view for the FEEDBACK tab (mode 'producer') and the artist page /feedback (mode 'artist').
  // Data lives in songs.work_data: versions[].feedback (per version), deadline_text, shared_notes.
  // Audio only via Dropbox links (versions[].dropbox_mp3_url / dropbox_wav_url) — no watcher needed.
  import { onMount, onDestroy } from 'svelte'

  let { supabase, project, mode = 'artist', author = 'Artist', ondropversion = null } = $props()

  const isProducer = $derived(mode === 'producer')

  let songs      = $state([])
  let loading    = $state(true)
  let expandedId = $state(null)
  let pickedVer  = $state({})   // song.id → version id (default: current version)
  let fbInput    = $state({})
  let dragOverId = $state(null)
  let uploading  = $state({})
  let rootEl     = null

  // ── data ───────────────────────────────────────────────────────────────────
  async function fetchSongs() {
    const { data } = await supabase.from('songs')
      .select('id,title,code,position,work_data,project_id')
      .eq('project_id', project.id).order('position')
    return (data || []).filter(s => !s.work_data?.archived)
  }

  async function load() {
    loading = true
    songs = await fetchSongs()
    loading = false
  }

  // 5s poll — picks up what the other side wrote; skipped while typing here
  let pollTimer = null
  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      const a = document.activeElement
      if (a && rootEl?.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return
      const fresh = await fetchSongs()
      if (JSON.stringify(fresh) !== JSON.stringify(songs)) songs = fresh
    }, 5000)
  }

  // Read-modify-write on a fresh copy so both sides can edit at the same time
  async function mutate(song, fn) {
    const { data } = await supabase.from('songs').select('work_data').eq('id', song.id).single()
    const wd = { ...(data?.work_data || song.work_data || {}) }
    wd.versions = wd.versions || []
    fn(wd)
    await supabase.from('songs').update({ work_data: wd }).eq('id', song.id)
    songs = songs.map(s => s.id === song.id ? { ...s, work_data: wd } : s)
  }

  // ── versions ───────────────────────────────────────────────────────────────
  function versionsOf(song) {
    return (song.work_data?.versions || []).filter(v => v.version_type === 'production' || v.version_type === 'mixing')
  }
  // "Current" = last version marked as sent, otherwise the last dropped one
  function currentVersion(song) {
    const vs = versionsOf(song)
    const withAudio = vs.filter(v => v.audio_path)
    return withAudio.filter(v => v.sent_to_artist).at(-1) || withAudio.at(-1) || vs.at(-1) || null
  }
  function shownVersion(song) {
    const vs = versionsOf(song)
    return vs.find(v => v.id === pickedVer[song.id]) || currentVersion(song)
  }
  function verLabel(v) { return v ? v.name.replace(/^MIX_/, 'MIX ') : '—' }

  function sortedFeedback(v) {
    const fb = v?.feedback || []
    return [...fb.filter(f => !f.done), ...fb.filter(f => f.done)]
  }
  function fbCount(song) {
    const fb = currentVersion(song)?.feedback || []
    return { open: fb.filter(f => !f.done).length, total: fb.length }
  }

  // ── edits ──────────────────────────────────────────────────────────────────
  async function addFeedback(song, vId) {
    const text = (fbInput[vId] || '').trim()
    if (!text) return
    fbInput = { ...fbInput, [vId]: '' }
    await mutate(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (!v) return
      v.feedback = [...(v.feedback || []), { id: 'f' + Date.now(), text, done: false, author, created_at: new Date().toISOString() }]
    })
  }
  async function toggleFeedback(song, vId, fId) {
    await mutate(song, wd => {
      const f = wd.versions.find(v => v.id === vId)?.feedback?.find(f => f.id === fId)
      if (f) { f.done = !f.done; f.done_by = f.done ? author : null }
    })
  }
  async function saveField(song, field, value) {
    if ((song.work_data?.[field] || '') === value) return
    await mutate(song, wd => { wd[field] = value })
  }

  async function onDrop(e, song) {
    e.preventDefault(); dragOverId = null
    const file = e.dataTransfer.files[0]
    if (!file || !ondropversion) return
    uploading = { ...uploading, [song.id]: true }
    try {
      await ondropversion(song, file)
      songs = await fetchSongs()
      pickedVer = { ...pickedVer, [song.id]: null }
    } catch (err) { alert('Error: ' + err.message) }
    uploading = { ...uploading, [song.id]: false }
  }

  // ── player (same mini-player as Demos/Projects) ────────────────────────────
  let currentSongId = $state(null)
  let isPlaying     = $state(false)
  let currentTime   = $state(0)
  let duration      = $state(0)
  let player        = null
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
  function playSong(id, src) {
    if (!src) return
    const p = getPlayer()
    if (currentSongId === id) { p.paused ? p.play().catch(() => {}) : p.pause(); return }
    p.pause(); p.src = src; p.currentTime = 0; currentSongId = id; p.load(); p.play().catch(() => {})
  }
  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00'
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
  }
  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''
  }

  onMount(() => { load().then(startPolling) })
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    if (player) { player.pause(); player.src = '' }
  })
</script>

<div class="fbv" bind:this={rootEl}>
  {#if loading}
    <p class="empty">Loading…</p>
  {:else if !songs.length}
    <p class="empty">No songs in this project.</p>
  {:else}
    <div class="tt-head">
      <span>SONG</span><span>DEADLINE</span><span>VERSION</span><span>FEEDBACK</span>
    </div>
    {#each songs as song (song.id)}
      {@const cur = currentVersion(song)}
      {@const cnt = fbCount(song)}
      {@const open = expandedId === song.id}
      <div class="song {open ? 'open' : ''}">
        <div class="tt-row" role="button" tabindex="0" onclick={() => expandedId = open ? null : song.id}
          onkeydown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) expandedId = open ? null : song.id }}>
          <span class="tt-title"><span class="arr {open ? 'open' : ''}">▶</span>{song.title || song.code}</span>
          {#if isProducer}
            <input class="tt-deadline" value={song.work_data?.deadline_text || ''} placeholder="—"
              onclick={e => e.stopPropagation()}
              onkeydown={e => { if (e.key === 'Enter') e.target.blur() }}
              onblur={e => saveField(song, 'deadline_text', e.target.value.trim())} />
          {:else}
            <span class="tt-deadline ro">{song.work_data?.deadline_text || '—'}</span>
          {/if}
          <span class="tt-ver">{verLabel(cur)}</span>
          <span class="tt-fb {cnt.open ? 'has-open' : ''}">{cnt.total ? `${cnt.open} offen / ${cnt.total}` : '—'}</span>
        </div>

        {#if open}
          {@const shown = shownVersion(song)}
          {@const vs = versionsOf(song)}
          <div class="song-body">
            {#if cur}
              <div class="player-row">
                {#if cur.dropbox_mp3_url}
                  <div class="mini-player {currentSongId === song.id ? 'active' : ''}">
                    <button onclick={() => playSong(song.id, cur.dropbox_mp3_url)}>
                      {currentSongId === song.id && isPlaying ? '⏸' : '▶'}
                    </button>
                    <span class="time">
                      {currentSongId === song.id ? formatTime(currentTime) + ' / ' + formatTime(duration) : '0:00'}
                    </span>
                    <input type="range" class="seek-bar" min="0"
                      max={currentSongId === song.id ? (duration || 100) : 100}
                      value={currentSongId === song.id ? currentTime : 0}
                      oninput={e => { if (player) player.currentTime = +e.target.value }} />
                  </div>
                {:else}
                  <span class="audio-unavail">{cur.audio_path ? 'Audio wird vorbereitet…' : 'Noch kein Audio'}</span>
                {/if}
                {#if cur.dropbox_wav_url}
                  <a class="download-btn" href={cur.dropbox_wav_url} target="_blank" rel="noopener">↓ WAV</a>
                {/if}
              </div>
            {/if}

            {#if isProducer}
              <div class="drop {dragOverId === song.id ? 'drag-over' : ''}" role="region" aria-label="Neue Version"
                ondragover={e => { e.preventDefault(); dragOverId = song.id }}
                ondragleave={() => dragOverId = null}
                ondrop={e => onDrop(e, song)}>
                {uploading[song.id] ? '↑ uploading…' : '↓ Drop neue Version'}
              </div>
            {/if}

            <div class="sec-head">
              <span class="sec-title">FEEDBACK</span>
              {#if vs.length > 1}
                <select class="ver-sel" value={shown?.id}
                  onchange={e => pickedVer = { ...pickedVer, [song.id]: e.target.value }}>
                  {#each vs as v}
                    <option value={v.id}>{verLabel(v)}{v.id === cur?.id ? ' (aktuell)' : ''}</option>
                  {/each}
                </select>
              {:else if shown}
                <span class="ver-one">{verLabel(shown)}</span>
              {/if}
            </div>
            {#if shown}
              <div class="fb-list">
                {#each sortedFeedback(shown) as fb (fb.id)}
                  <div class="fb-row {fb.done ? 'done' : ''}">
                    <button class="ckb" onclick={() => toggleFeedback(song, shown.id, fb.id)}>{fb.done ? '✓' : ''}</button>
                    <span class="fb-text">{fb.text}</span>
                    <span class="fb-meta">— {fb.author || 'Remo'}{fb.created_at ? ' · ' + fmtDate(fb.created_at) : ''}</span>
                  </div>
                {/each}
                {#if !(shown.feedback || []).length}<p class="empty-sm">Noch kein Feedback.</p>{/if}
              </div>
              <input class="fb-add" placeholder="+ Feedback" bind:value={fbInput[shown.id]}
                onkeydown={e => { if (e.key === 'Enter') addFeedback(song, shown.id) }} />
            {:else}
              <p class="empty-sm">Noch keine Version.</p>
            {/if}

            <div class="sec-head"><span class="sec-title">NOTIZEN</span></div>
            <textarea class="notes" rows="4" value={song.work_data?.shared_notes || ''}
              placeholder="Gemeinsame Notizen…"
              onblur={e => saveField(song, 'shared_notes', e.target.value)}></textarea>
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .fbv { display: flex; flex-direction: column; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 40px 0; margin: 0; }
  .empty-sm { font-size: 13px; color: var(--text-dim); margin: 4px 0; }

  .tt-head, .tt-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) 90px 110px; gap: 12px; align-items: center; }
  .tt-head { padding: 0 14px 8px; border-bottom: 1px solid var(--border); font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; }
  .song { border-bottom: 1px solid var(--border); }
  .song.open { background: var(--surface); }
  .tt-row { padding: 10px 14px; cursor: pointer; }
  .tt-row:hover { background: var(--surface); }
  .tt-title { color: var(--text); font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
  .arr { font-size: 9px; color: var(--text-dim); transition: transform .15s; display: inline-block; }
  .arr.open { transform: rotate(90deg); }
  .tt-deadline { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-mid); text-transform: uppercase; background: transparent; border: 1px solid transparent; padding: 3px 6px; border-radius: 2px; outline: none; min-width: 0; }
  input.tt-deadline:hover { border-color: var(--border2); }
  input.tt-deadline:focus { border-color: var(--border2); background: var(--surface2); color: var(--text); }
  .tt-deadline.ro { padding-left: 0; }
  .tt-ver { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-mid); }
  .tt-fb { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); }
  .tt-fb.has-open { color: var(--accent); }

  .song-body { padding: 4px 14px 18px 32px; display: flex; flex-direction: column; gap: 10px; }
  .player-row { display: flex; align-items: center; gap: 10px; max-width: 520px; }
  .mini-player { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
  .mini-player button { background: none; border: none; color: var(--text-mid); cursor: pointer; font-size: 14px; padding: 2px 3px; flex-shrink: 0; }
  .mini-player.active button { color: var(--text); }
  .mini-player .time { font-size: 10px; font-family: 'Space Mono', monospace; color: var(--text-dim); width: 70px; text-align: right; flex-shrink: 0; }
  .mini-player.active .time { color: var(--text-mid); }
  .seek-bar { flex: 1; min-width: 0; height: 3px; accent-color: var(--text-mid); cursor: pointer; }
  .audio-unavail { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex: 1; }
  .download-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 10px; background: var(--surface2); border: 1px solid transparent; color: var(--text-mid); border-radius: 2px; text-decoration: none; flex-shrink: 0; }
  .download-btn:hover { border-color: var(--border2); color: var(--text); }

  .drop { border: 1px dashed var(--border2); border-radius: 3px; padding: 12px; text-align: center; font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); max-width: 520px; }
  .drop.drag-over { border-color: var(--accent); color: var(--text); }

  .sec-head { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .sec-title { font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; }
  .ver-sel { background: var(--surface2); border: 1px solid var(--border2); color: var(--text-mid); font-family: 'Space Mono', monospace; font-size: 11px; padding: 2px 6px; border-radius: 2px; }
  .ver-one { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); }

  .fb-list { display: flex; flex-direction: column; }
  .fb-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  .fb-row.done { opacity: .4; }
  .ckb { width: 16px; height: 16px; flex-shrink: 0; background: transparent; border: 1px solid var(--border2); border-radius: 2px; color: var(--sent); font-size: 11px; line-height: 1; cursor: pointer; padding: 0; }
  .fb-text { flex: 1; font-size: 14px; color: var(--text-mid); min-width: 0; }
  .fb-row.done .fb-text { text-decoration: line-through; color: var(--text-dim); }
  .fb-meta { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); white-space: nowrap; }
  .fb-add, .notes { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 7px 10px; border-radius: 3px; outline: none; }
  .fb-add:focus, .notes:focus { border-color: var(--border2); }
  .notes { resize: vertical; min-height: 80px; }

  @media (max-width: 640px) {
    .tt-head, .tt-row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 54px 70px; gap: 8px; }
    .tt-head { font-size: 11px; }
    .song-body { padding-left: 14px; }
    .fb-row { flex-wrap: wrap; }
    .fb-meta { width: 100%; padding-left: 26px; }
  }
</style>
