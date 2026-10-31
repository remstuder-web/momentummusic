<script>
  // Shared view for the FEEDBACK tab (mode 'producer') and the artist page /feedback (mode 'artist').
  // Own tables: feedback_songs (title, deadline_text, position, shared_notes, versions jsonb).
  // versions: [{ id, label, filename, mp3_filename, mp3_url, wav_url, is_current, uploaded_at,
  //              feedback: [{ id, text, author, done, created_at, done_at, done_by }] }]
  // Audio only via Dropbox links — the artist page never talks to the watcher.
  import { onMount, onDestroy } from 'svelte'

  let { supabase, project, mode = 'artist', author = 'Artist' } = $props()

  const isProducer = $derived(mode === 'producer')
  const WATCHER = 'http://localhost:4242'

  let songs      = $state([])
  let loading    = $state(true)
  let expandedId = $state(null)
  let pickedVer  = $state({})   // song.id → version id (default: current version)
  let fbInput    = $state({})
  let rootEl     = null

  // ── data ───────────────────────────────────────────────────────────────────
  async function fetchSongs() {
    const { data, error } = await supabase.from('feedback_songs')
      .select('*').eq('project_id', project.id)
      .order('position').order('created_at')
    if (error) { console.warn('[Feedback] load error:', error.message); return songs }
    return data || []
  }
  async function load() {
    loading = true
    songs = await fetchSongs()
    loading = false
  }

  // 5s poll — picks up what the other side wrote; paused while typing, dragging or uploading
  let pollTimer = null
  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      if (busy || dragSongId) return
      const a = document.activeElement
      if (a && rootEl?.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return
      const fresh = await fetchSongs()
      if (JSON.stringify(fresh) !== JSON.stringify(songs)) songs = fresh
    }, 5000)
  }

  function replaceSong(row) {
    songs = songs.some(s => s.id === row.id) ? songs.map(s => s.id === row.id ? row : s) : [...songs, row]
  }

  // Read-modify-write of versions on a fresh copy, so producer and artist can edit at the same time
  async function mutateVersions(songId, fn) {
    const { data, error } = await supabase.from('feedback_songs').select('versions').eq('id', songId).single()
    if (error) throw new Error(error.message)
    const versions = data.versions || []
    fn(versions)
    const { data: row, error: upErr } = await supabase.from('feedback_songs')
      .update({ versions }).eq('id', songId).select('*').single()
    if (upErr) throw new Error(upErr.message)
    replaceSong(row)
  }

  async function saveField(song, field, value) {
    if ((song[field] || '') === value) return
    const { data: row } = await supabase.from('feedback_songs').update({ [field]: value }).eq('id', song.id).select('*').single()
    if (row) replaceSong(row)
  }

  // ── versions ───────────────────────────────────────────────────────────────
  function currentVersion(song) {
    const vs = song.versions || []
    return vs.find(v => v.is_current) || vs.at(-1) || null
  }
  function shownVersion(song) {
    return (song.versions || []).find(v => v.id === pickedVer[song.id]) || currentVersion(song)
  }
  function sortedFeedback(v) {
    const fb = v?.feedback || []
    return [...fb.filter(f => !f.done), ...fb.filter(f => f.done)]
  }
  function fbCount(song) {
    const fb = currentVersion(song)?.feedback || []
    return { open: fb.filter(f => !f.done).length, total: fb.length }
  }

  // ── feedback ───────────────────────────────────────────────────────────────
  async function addFeedback(song, vId) {
    const text = (fbInput[vId] || '').trim()
    if (!text) return
    fbInput = { ...fbInput, [vId]: '' }
    const item = { id: 'f' + Date.now() + Math.random().toString(36).slice(2, 6), text, author, done: false,
                   created_at: new Date().toISOString(), done_at: null, done_by: null }
    await mutateVersions(song.id, vs => {
      const v = vs.find(v => v.id === vId)
      if (v && !(v.feedback || []).some(f => f.id === item.id)) v.feedback = [...(v.feedback || []), item]
    })
  }
  async function toggleFeedback(song, vId, fId) {
    const done = !shownVersion(song)?.feedback?.find(f => f.id === fId)?.done
    await mutateVersions(song.id, vs => {
      const f = vs.find(v => v.id === vId)?.feedback?.find(f => f.id === fId)
      if (!f) return
      f.done = done
      f.done_at = done ? new Date().toISOString() : null
      f.done_by = done ? author : null
    })
  }

  // Own, open items only — checked-off items stay as the record of what was done
  const canDelete = fb => fb.author === author && !fb.done
  async function deleteFeedback(song, vId, fId) {
    await mutateVersions(song.id, vs => {
      const v = vs.find(v => v.id === vId)
      if (v) v.feedback = (v.feedback || []).filter(f => !(f.id === fId && canDelete(f)))
    })
  }

  // ── producer: songs, uploads, ordering ─────────────────────────────────────
  let busy        = $state(false)
  let progress    = $state({ done: 0, total: 0 })
  let dropRowId   = $state(null)
  let dropArea    = $state(false)
  let newSongOpen = $state(false)
  let newTitle    = $state('')

  async function createSong(title) {
    const position = songs.reduce((m, s) => Math.max(m, s.position ?? 0), -1) + 1
    const { data, error } = await supabase.from('feedback_songs')
      .insert({ project_id: project.id, title, position, versions: [] }).select('*').single()
    if (error) throw new Error(error.message)
    replaceSong(data)
    return data
  }
  async function addSong() {
    const t = newTitle.trim()
    if (!t) return
    try { await createSong(t) } catch (e) { alert('Error: ' + e.message) }
    newTitle = ''; newSongOpen = false
  }

  function titleFromFilename(name) {
    return name.replace(/\.[^.]+$/, '').replace(/[_\s-]+v\d{1,3}$/i, '').replace(/_+/g, ' ').trim() || 'Untitled'
  }
  function fileBase(title) {
    return (title || 'Untitled').replace(/[<>:"/\\|?*]/g, '').trim() || 'Untitled'
  }

  // One file → new version of `song` (V01, V02, …). Old versions and their files stay.
  async function uploadVersion(song, file) {
    const vId = 'v' + Date.now() + Math.random().toString(36).slice(2, 6)
    let label = ''
    await mutateVersions(song.id, vs => {
      if (vs.some(v => v.id === vId)) return
      label = 'V' + String(vs.length + 1).padStart(2, '0')
      for (const v of vs) v.is_current = false
      vs.push({ id: vId, label, filename: null, mp3_filename: null, mp3_url: null, wav_url: null,
                is_current: true, uploaded_at: new Date().toISOString(), feedback: [] })
    })
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'wav'
    const filename = `${fileBase(song.title)}_${label}.${ext}`
    try {
      const r = await fetch(`${WATCHER}/feedback-upload?song_id=${song.id}&version_id=${vId}&folder=${encodeURIComponent(project.folder)}&filename=${encodeURIComponent(filename)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() })
        .then(r => r.json())
      if (!r.ok) throw new Error(r.error || 'upload failed')
    } catch (e) {
      // Roll back the empty version entry, previous version becomes current again
      await mutateVersions(song.id, vs => {
        const i = vs.findIndex(v => v.id === vId)
        if (i < 0) return
        vs.splice(i, 1)
        if (vs.length && !vs.some(v => v.is_current)) vs[vs.length - 1].is_current = true
      })
      throw e
    }
    pickedVer = { ...pickedVer, [song.id]: null }
  }

  // Files on a row → new versions of that song; on the free area → one new song per file
  async function handleFiles(files, song = null) {
    const list = [...files].filter(f => /^audio\//.test(f.type) || /\.(wav|mp3|aiff?|flac|m4a)$/i.test(f.name))
    if (!list.length) return
    busy = true
    progress = { done: 0, total: list.length }
    const errors = []
    for (const file of list) {
      let created = null
      try {
        const target = song || (created = await createSong(titleFromFilename(file.name)))
        await uploadVersion(target, file)
      } catch (e) {
        errors.push(`${file.name}: ${e.message}`)
        if (created) {
          await supabase.from('feedback_songs').delete().eq('id', created.id)
          songs = songs.filter(s => s.id !== created.id)
        }
      }
      progress = { ...progress, done: progress.done + 1 }
    }
    busy = false
    songs = await fetchSongs()
    if (errors.length) alert('Upload-Fehler:\n' + errors.join('\n'))
  }

  // Deletes the DB row only — audio files stay in Dropbox (no silent audio deletion)
  async function deleteSong(song) {
    if (!confirm(`Song „${song.title}" löschen? Die Audiodateien bleiben in Dropbox/!MOMENTUM MUSIC/Feedback/${project.folder}/ liegen und müssen dort von Hand entfernt werden.`)) return
    const { error } = await supabase.from('feedback_songs').delete().eq('id', song.id)
    if (error) { alert('Error: ' + error.message); return }
    songs = songs.filter(s => s.id !== song.id)
    if (expandedId === song.id) expandedId = null
  }

  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files')

  // Drag to sort (rows); file drags are handled separately
  let dragSongId = $state(null)
  async function moveSong(targetId) {
    const from = songs.findIndex(s => s.id === dragSongId)
    const to = songs.findIndex(s => s.id === targetId)
    dragSongId = null
    if (from < 0 || to < 0 || from === to) return
    const next = [...songs]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    songs = next.map((s, i) => ({ ...s, position: i }))
    await Promise.all(songs.map(s => supabase.from('feedback_songs').update({ position: s.position }).eq('id', s.id)))
  }

  // ── player (same mini-player as Demos/Projects) ────────────────────────────
  let currentKey  = $state(null)   // version id
  let isPlaying   = $state(false)
  let currentTime = $state(0)
  let duration    = $state(0)
  let player      = null
  function getPlayer() {
    if (!player) {
      player = new Audio()
      player.addEventListener('timeupdate',     () => { currentTime = player.currentTime })
      player.addEventListener('loadedmetadata', () => { duration = player.duration })
      player.addEventListener('ended',          () => { isPlaying = false; currentKey = null })
      player.addEventListener('play',           () => { isPlaying = true })
      player.addEventListener('pause',          () => { isPlaying = false })
    }
    return player
  }
  function play(key, src) {
    if (!src) return
    const p = getPlayer()
    if (currentKey === key) { p.paused ? p.play().catch(() => {}) : p.pause(); return }
    p.pause(); p.src = src; p.currentTime = 0; currentKey = key; p.load(); p.play().catch(() => {})
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
  {#if isProducer && busy}
    <div class="progress">↑ {progress.done} von {progress.total}</div>
  {/if}

  {#if loading}
    <p class="empty">Loading…</p>
  {:else}
    <div class="tt-head {isProducer ? 'prod' : ''}">
      {#if isProducer}<span></span>{/if}
      <span>SONG</span><span>DEADLINE</span><span>VERSION</span><span>FEEDBACK</span>
    </div>

    <div class="tt-body {dropArea ? 'drag-over' : ''}" role="list"
      ondragover={e => { if (isProducer && hasFiles(e)) { e.preventDefault(); dropArea = true } }}
      ondragleave={e => { if (!e.currentTarget.contains(e.relatedTarget)) dropArea = false }}
      ondrop={e => { if (!isProducer || !hasFiles(e)) return; e.preventDefault(); dropArea = false; handleFiles(e.dataTransfer.files) }}>

      {#each songs as song (song.id)}
        {@const cur = currentVersion(song)}
        {@const cnt = fbCount(song)}
        {@const open = expandedId === song.id}
        <div class="song {open ? 'open' : ''} {dropRowId === song.id ? 'row-drop' : ''} {dragSongId === song.id ? 'dragging' : ''}" role="listitem"
          ondragover={e => {
            if (!isProducer) return
            if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); dropRowId = song.id; dropArea = false }
            else if (dragSongId) { e.preventDefault(); dropRowId = song.id }
          }}
          ondragleave={e => { if (!e.currentTarget.contains(e.relatedTarget) && dropRowId === song.id) dropRowId = null }}
          ondrop={e => {
            if (!isProducer) return
            e.preventDefault(); e.stopPropagation(); dropRowId = null
            if (hasFiles(e)) handleFiles(e.dataTransfer.files, song)
            else if (dragSongId) moveSong(song.id)
          }}>
          <div class="tt-row {isProducer ? 'prod' : ''}" role="button" tabindex="0"
            onclick={() => expandedId = open ? null : song.id}
            onkeydown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) expandedId = open ? null : song.id }}>
            {#if isProducer}
              <span class="handle" draggable="true" title="Ziehen zum Sortieren" role="presentation"
                onclick={e => e.stopPropagation()}
                ondragstart={e => { dragSongId = song.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(song.id)) }}
                ondragend={() => { dragSongId = null; dropRowId = null }}>⋮⋮</span>
            {/if}
            <span class="tt-title"><span class="arr {open ? 'open' : ''}">▶</span>{song.title}</span>
            {#if isProducer}
              <input class="tt-deadline" value={song.deadline_text || ''} placeholder="—"
                onclick={e => e.stopPropagation()}
                onkeydown={e => { if (e.key === 'Enter') e.target.blur() }}
                onblur={e => saveField(song, 'deadline_text', e.target.value.trim())} />
            {:else}
              <span class="tt-deadline ro">{song.deadline_text || '—'}</span>
            {/if}
            <span class="tt-ver">{cur?.label || '—'}</span>
            <span class="tt-fb {cnt.open ? 'has-open' : ''}">{cnt.total ? `${cnt.open} offen / ${cnt.total}` : '—'}</span>
          </div>

          {#if open}
            {@const shown = shownVersion(song)}
            {@const vs = song.versions || []}
            <div class="song-body">
              {#if shown}
                <div class="ver-row">
                  {#if vs.length > 1}
                    <select class="ver-sel" value={shown.id}
                      onchange={e => pickedVer = { ...pickedVer, [song.id]: e.target.value }}>
                      {#each [...vs].reverse() as v}
                        <option value={v.id}>{v.label}{v.id === cur?.id ? ' (aktuell)' : ''} · {fmtDate(v.uploaded_at)}</option>
                      {/each}
                    </select>
                  {:else}
                    <span class="ver-one">{shown.label} · {fmtDate(shown.uploaded_at)}</span>
                  {/if}
                  {#if shown.mp3_url}
                    <div class="mini-player {currentKey === shown.id ? 'active' : ''}">
                      <button onclick={() => play(shown.id, shown.mp3_url)}>
                        {currentKey === shown.id && isPlaying ? '⏸' : '▶'}
                      </button>
                      <span class="time">
                        {currentKey === shown.id ? formatTime(currentTime) + ' / ' + formatTime(duration) : '0:00'}
                      </span>
                      <input type="range" class="seek-bar" min="0"
                        max={currentKey === shown.id ? (duration || 100) : 100}
                        value={currentKey === shown.id ? currentTime : 0}
                        oninput={e => { if (player) player.currentTime = +e.target.value }} />
                    </div>
                  {:else}
                    <span class="audio-unavail">Audio wird vorbereitet…</span>
                  {/if}
                  {#if shown.wav_url}
                    <a class="download-btn" href={shown.wav_url} target="_blank" rel="noopener">↓ WAV</a>
                  {/if}
                </div>
              {/if}

              {#if isProducer}
                <div class="drop-hint">Datei auf die Zeile ziehen → neue Version</div>
              {/if}

              <div class="sec-title">FEEDBACK{shown ? ' — ' + shown.label : ''}</div>
              {#if shown}
                <div class="fb-list">
                  {#each sortedFeedback(shown) as fb (fb.id)}
                    <div class="fb-row {fb.done ? 'done' : ''}">
                      <button class="ckb" onclick={() => toggleFeedback(song, shown.id, fb.id)}>{fb.done ? '✓' : ''}</button>
                      <span class="fb-text">{fb.text}</span>
                      <span class="fb-meta">— {fb.author}{fb.created_at ? ' · ' + fmtDate(fb.created_at) : ''}</span>
                      {#if canDelete(fb)}
                        <button class="fb-del" title="Löschen" onclick={() => deleteFeedback(song, shown.id, fb.id)}>×</button>
                      {/if}
                    </div>
                  {/each}
                  {#if !(shown.feedback || []).length}<p class="empty-sm">Noch kein Feedback.</p>{/if}
                </div>
                <input class="fb-add" placeholder="+ Feedback" bind:value={fbInput[shown.id]}
                  onkeydown={e => { if (e.key === 'Enter') addFeedback(song, shown.id) }} />
              {:else}
                <p class="empty-sm">Noch keine Version.</p>
              {/if}

              <div class="sec-title">NOTIZEN</div>
              <textarea class="notes" rows="4" value={song.shared_notes || ''}
                placeholder="Gemeinsame Notizen…"
                onblur={e => saveField(song, 'shared_notes', e.target.value)}></textarea>
              {#if isProducer}
                <button class="del-song" onclick={() => deleteSong(song)}>Song löschen</button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if isProducer}
        <div class="free-area">
          {#if !songs.length}Audiodateien hierher ziehen → ein neuer Song pro Datei{:else}Dateien hierher ziehen → neue Songs{/if}
        </div>
      {:else if !songs.length}
        <p class="empty">Noch keine Songs.</p>
      {/if}
    </div>

    {#if isProducer}
      <div class="new-song">
        {#if newSongOpen}
          <input class="ns-inp" placeholder="Titel" bind:value={newTitle}
            onkeydown={e => { if (e.key === 'Enter') addSong(); if (e.key === 'Escape') newSongOpen = false }} />
          <button class="btn" onclick={addSong}>Anlegen</button>
          <button class="btn ghost" onclick={() => { newSongOpen = false; newTitle = '' }}>×</button>
        {:else}
          <button class="btn" onclick={() => newSongOpen = true}>+ Neuer Song</button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .fbv { display: flex; flex-direction: column; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 40px 0; margin: 0; }
  .empty-sm { font-size: 14px; line-height: 1.5; color: var(--text-dim); margin: 4px 0; }
  .progress { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--accent); margin-bottom: 10px; }

  .tt-head, .tt-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) 70px 110px; gap: 12px; align-items: center; }
  .tt-head.prod, .tt-row.prod { grid-template-columns: 16px minmax(0, 2fr) minmax(0, 1.4fr) 70px 110px; }
  .tt-head { padding: 0 14px 8px; border-bottom: 1px solid var(--border); font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; }
  .tt-body { border: 1px dashed transparent; border-radius: 3px; }
  .tt-body.drag-over { border-color: var(--accent); }
  .song { border-bottom: 1px solid var(--border); }
  .song.open { background: var(--surface); }
  .song.row-drop { outline: 1px solid var(--accent); outline-offset: -1px; }
  .song.dragging { opacity: .4; }
  .tt-row { padding: 10px 14px; cursor: pointer; }
  .tt-row:hover { background: var(--surface); }
  .handle { color: var(--text-dim); cursor: grab; font-size: 11px; letter-spacing: -2px; user-select: none; }
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
  .ver-row { display: flex; align-items: center; gap: 10px; max-width: 640px; }
  .ver-sel { background: var(--surface2); border: 1px solid var(--border2); color: var(--text-mid); font-family: 'Space Mono', monospace; font-size: 11px; padding: 2px 6px; border-radius: 2px; flex-shrink: 0; }
  .ver-one { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex-shrink: 0; }
  .mini-player { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
  .mini-player button { background: none; border: none; color: var(--text-mid); cursor: pointer; font-size: 14px; height: 24px; padding: 0 3px; flex-shrink: 0; }
  .mini-player.active button { color: var(--text); }
  .mini-player .time { font-size: 10px; font-family: 'Space Mono', monospace; color: var(--text-dim); width: 70px; text-align: right; flex-shrink: 0; }
  .mini-player.active .time { color: var(--text-mid); }
  .seek-bar { flex: 1; min-width: 0; height: 3px; accent-color: var(--text-mid); cursor: pointer; }
  .audio-unavail { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); flex: 1; }
  .download-btn { display: inline-flex; align-items: center; box-sizing: border-box; height: 24px; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; padding: 0 10px; background: transparent; border: 1px solid var(--accent-dim); color: var(--accent); border-radius: 2px; text-decoration: none; flex-shrink: 0; transition: all .15s; }
  .download-btn:hover { border-color: var(--accent); background: var(--accent-a08); color: var(--accent-hot); }
  .drop-hint { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); }

  .sec-title { font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; margin-top: 6px; }
  .fb-list { display: flex; flex-direction: column; }
  .fb-row { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); }
  .fb-row .ckb { align-self: center; }
  .fb-row.done { opacity: .4; }
  .ckb { width: 16px; height: 16px; flex-shrink: 0; background: transparent; border: 1px solid var(--border2); border-radius: 2px; color: var(--sent); font-size: 11px; line-height: 1; cursor: pointer; padding: 0; }
  .fb-text { flex: 1; font-size: 14px; line-height: 1.5; color: var(--text-mid); min-width: 0; }
  .fb-row.done .fb-text { text-decoration: line-through; color: var(--text-dim); }
  .fb-meta { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); white-space: nowrap; }
  .fb-add, .notes, .ns-inp { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.5; font-weight: 300; padding: 7px 10px; border-radius: 3px; outline: none; }
  .fb-add:focus, .notes:focus, .ns-inp:focus { border-color: var(--border2); }
  .notes { resize: vertical; min-height: 80px; }
  .fb-del { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; align-self: center; }
  .fb-del:hover { color: #e05a4a; }
  .del-song { align-self: flex-end; background: none; border: 1px solid transparent; color: var(--text-dim); font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; border-radius: 2px; cursor: pointer; }
  .del-song:hover { color: #e05a4a; border-color: rgba(224,90,74,.4); }
  .fb-add::placeholder, .notes::placeholder, .ns-inp::placeholder, .tt-deadline::placeholder { color: var(--text-faint); }

  .free-area { padding: 22px 14px; text-align: center; font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); }
  .new-song { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
  .ns-inp { width: 260px; max-width: 100%; }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .btn:hover { border-color: var(--accent-dim); }
  .btn.ghost { background: transparent; }

  @media (max-width: 640px) {
    .tt-head, .tt-row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 40px 70px; gap: 8px; }
    .tt-head { font-size: 11px; }
    .song-body { padding-left: 14px; }
    .ver-row { flex-wrap: wrap; }
    .fb-row { flex-wrap: wrap; }
    .fb-meta { width: 100%; padding-left: 26px; }
  }
</style>
