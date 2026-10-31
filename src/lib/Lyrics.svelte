<script>
  // LYRICS — shared lyrics per feedback project (Feedback tab and artist page). Both sides write.
  // Stored on feedback_projects.lyrics (jsonb): [{ id, title, text, updated_by, updated_at }].
  // Own list, not linked to SONGS or TIMELINE. Plain text, line breaks kept.
  // Text saves ~1.5 s after the last keystroke and on blur. If the other side changed the same text
  // since this page last saw it, nothing is overwritten: this version is appended below a marker.
  import { onMount, onDestroy, tick } from 'svelte'

  let { supabase, project, mode = 'artist', author = 'Artist' } = $props()

  const isProducer = $derived(mode === 'producer')

  let songs    = $state([])
  let loading  = $state(true)
  let notice   = $state({})   // song id → message after a merge
  let saving   = $state({})   // song id → true while a save is pending
  let rootEl   = null
  const base   = {}           // song id → text as last seen in the DB (conflict detection)
  const timers = {}

  function remember(list) { for (const s of list) base[s.id] = s.text || '' }

  async function fetchSongs() {
    const { data, error } = await supabase.from('feedback_projects').select('lyrics').eq('id', project.id).single()
    if (error) { console.warn('[Lyrics] load error:', error.message); return null }
    return data.lyrics || []
  }
  async function load() {
    const l = await fetchSongs()
    if (l) { songs = l; remember(l) }
    loading = false
  }

  // Poll for the other side's changes; a song whose fields are focused keeps what is being typed
  let pollTimer = null
  function startPolling() {
    pollTimer = setInterval(async () => {
      const fresh = await fetchSongs()
      if (!fresh || JSON.stringify(fresh) === JSON.stringify(songs)) return
      const editing = document.activeElement?.closest?.('[data-song]')?.dataset.song
      songs = fresh.map(s => {
        if (s.id !== editing) { base[s.id] = s.text || ''; return s }
        const local = songs.find(x => x.id === s.id)
        return local ? { ...s, title: local.title, text: local.text } : s
      })
    }, 5000)
  }

  // Read-modify-write on a fresh copy, chained so overlapping saves never overwrite each other
  let chain = Promise.resolve()
  function mutate(fn) {
    const run = async () => {
      const { data, error } = await supabase.from('feedback_projects').select('lyrics').eq('id', project.id).single()
      if (error) { alert('Error: ' + error.message); return null }
      const next = data.lyrics || []
      const result = fn(next)
      const { error: upErr } = await supabase.from('feedback_projects').update({ lyrics: next }).eq('id', project.id)
      if (upErr) { alert('Error: ' + upErr.message); return null }
      return { next, result }
    }
    const p = chain.then(run, run)
    chain = p.catch(() => {})
    return p
  }

  function stamp(s) { s.updated_by = author; s.updated_at = new Date().toISOString() }

  async function saveText(id) {
    clearTimeout(timers[id])
    const local = songs.find(s => s.id === id)
    if (!local) return
    const mine = local.text || ''
    if (mine === base[id]) return
    saving = { ...saving, [id]: true }
    const r = await mutate(l => {
      const s = l.find(s => s.id === id)
      if (!s) return { gone: true }
      const theirs = s.text || ''
      if (theirs === mine) return { text: theirs }
      if (theirs !== base[id]) {
        // The other side changed it meanwhile → keep both
        s.text = `${theirs}\n\n— gleichzeitig geschrieben von ${author} —\n${mine}`
        stamp(s)
        return { text: s.text, merged: s.updated_by }
      }
      s.text = mine
      stamp(s)
      return { text: mine }
    })
    saving = { ...saving, [id]: false }
    if (!r || r.result.gone) return
    base[id] = r.result.text
    const editingThis = document.activeElement?.closest?.('[data-song]')?.dataset.song === id
    const typedSince = (songs.find(s => s.id === id)?.text || '') !== mine
    songs = r.next.map(s => {
      if (s.id !== id) return songs.find(x => x.id === s.id && document.activeElement?.closest?.('[data-song]')?.dataset.song === x.id) || s
      // Keep keystrokes typed while this save was running; they go out with the next save
      return editingThis && typedSince && !r.result.merged ? { ...s, text: songs.find(x => x.id === id).text } : s
    })
    if (r.result.merged) {
      notice = { ...notice, [id]: 'Gleichzeitig bearbeitet — beide Fassungen sind im Text, bitte zusammenführen.' }
      setTimeout(() => { notice = { ...notice, [id]: null } }, 12000)
    }
  }
  function onType(id, value) {
    songs = songs.map(s => s.id === id ? { ...s, text: value } : s)
    clearTimeout(timers[id])
    timers[id] = setTimeout(() => saveText(id), 1500)
  }

  async function saveTitle(id, value) {
    const cur = songs.find(s => s.id === id)
    if (!cur) return
    await mutate(l => { const s = l.find(s => s.id === id); if (s && s.title !== value) { s.title = value; stamp(s) } })
    songs = songs.map(s => s.id === id ? { ...s, title: value } : s)
  }

  async function addSong() {
    const song = { id: 'l' + Date.now() + Math.random().toString(36).slice(2, 6), title: '', text: '', updated_by: author, updated_at: new Date().toISOString() }
    const r = await mutate(l => { if (!l.some(s => s.id === song.id)) l.push(song) })
    if (!r) return
    base[song.id] = ''
    songs = [...songs.filter(s => s.id !== song.id), song]
    await tick()
    rootEl?.querySelector(`[data-song="${song.id}"] .title-inp`)?.focus()
  }
  async function deleteSong(s) {
    if (!confirm(`Lyrics „${s.title || 'Ohne Titel'}" löschen?`)) return
    const r = await mutate(l => { const i = l.findIndex(x => x.id === s.id); if (i >= 0) l.splice(i, 1) })
    if (r) songs = songs.filter(x => x.id !== s.id)
  }

  // Textarea grows with its content
  function grow(node) {
    const fit = () => { node.style.height = 'auto'; node.style.height = node.scrollHeight + 2 + 'px' }
    fit()
    node.addEventListener('input', fit)
    return { update: fit, destroy: () => node.removeEventListener('input', fit) }
  }

  function fmtStamp(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  // Unsaved text when leaving the page
  function flushAll() { for (const s of songs) if ((s.text || '') !== base[s.id]) saveText(s.id) }

  onMount(() => {
    load().then(startPolling)
    window.addEventListener('beforeunload', flushAll)
  })
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    window.removeEventListener('beforeunload', flushAll)
    flushAll()
  })
</script>

<div class="ly" bind:this={rootEl}>
  {#if loading}
    <p class="empty">Loading…</p>
  {:else}
    {#each songs as s (s.id)}
      <div class="song" data-song={s.id}>
        <div class="song-head">
          <input class="title-inp" value={s.title} placeholder="Titel"
            onkeydown={e => { if (e.key === 'Enter') e.target.blur() }}
            onblur={e => { const t = e.target.value.trim(); if (t !== s.title) saveTitle(s.id, t) }} />
          <span class="meta">
            {#if saving[s.id]}speichert…{:else if s.updated_by}{s.updated_by} · {fmtStamp(s.updated_at)}{/if}
          </span>
          {#if isProducer}<button class="x" title="Löschen" onclick={() => deleteSong(s)}>×</button>{/if}
        </div>
        {#if notice[s.id]}<div class="notice">{notice[s.id]}</div>{/if}
        <textarea class="text" use:grow={s.text} value={s.text || ''} placeholder="Lyrics…" spellcheck="false"
          oninput={e => onType(s.id, e.target.value)}
          onblur={() => saveText(s.id)}></textarea>
      </div>
    {/each}

    {#if !songs.length}<p class="empty">Noch keine Lyrics.</p>{/if}

    <div class="ly-actions"><button class="btn" onclick={addSong}>+ Song</button></div>
  {/if}
</div>

<style>
  .ly { display: flex; flex-direction: column; gap: 22px; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 30px 0; margin: 0; }

  .song { display: flex; flex-direction: column; gap: 6px; }
  .song-head { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .title-inp { flex: 1; min-width: 0; background: transparent; border: 1px solid transparent; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 400; padding: 3px 6px; margin-left: -6px; border-radius: 2px; outline: none; }
  .title-inp:hover { border-color: var(--border2); }
  .title-inp:focus { border-color: var(--border2); background: var(--surface2); }
  .title-inp::placeholder, .text::placeholder { color: var(--text-faint); }
  .meta { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); white-space: nowrap; }
  .x { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; }
  .x:hover { color: #e05a4a; }
  .notice { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--sent); }

  .text { width: 100%; box-sizing: border-box; min-height: 120px; resize: none; overflow: hidden; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.6; font-weight: 300; padding: 12px 14px; border-radius: 3px; outline: none; white-space: pre-wrap; }
  .text:focus { border-color: var(--border2); }

  .ly-actions { display: flex; gap: 8px; }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .btn:hover { border-color: var(--accent-dim); }
</style>
