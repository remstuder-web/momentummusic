<script>
  import { supabase } from './supabase.js'

  let notes = $state([])
  let loading = $state(true)
  let newTopicName = $state('')
  let syncStatus = $state(null)   // null | 'syncing' | 'done' | 'error'
  let lastSync = $state(null)
  let syncCount = $state(null)

  async function load() {
    const { data } = await supabase.from('notes').select('*').order('position')
    notes = (data || []).map(n => ({ ...n, _exp: false }))
    loading = false
  }

  async function triggerAppleSync() {
    syncStatus = 'syncing'
    try {
      const r = await fetch('http://localhost:4242/apple-notes-sync', { method: 'POST' })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error)
      syncCount = d.synced
      lastSync = d.lastSync ? new Date(d.lastSync) : new Date()
      syncStatus = 'done'
      await load()
      setTimeout(() => { if (syncStatus === 'done') syncStatus = null }, 3000)
    } catch(e) {
      syncStatus = 'error'
      setTimeout(() => { syncStatus = null }, 4000)
    }
  }

  async function fetchLastSyncTime() {
    const r = await fetch('http://localhost:4242/apple-notes').catch(() => null)
    if (!r) return
    const d = await r.json().catch(() => null)
    if (d?.lastSync) lastSync = new Date(d.lastSync)
  }

  async function addTopic() {
    if (!newTopicName.trim()) return
    const { data } = await supabase.from('notes')
      .insert({ name: newTopicName.trim(), text: '', position: notes.length })
      .select().single()
    if (data) notes = [...notes, { ...data, _exp: true }]
    newTopicName = ''
  }

  async function updateText(note, text) {
    note.text = text
    notes = [...notes]
    await supabase.from('notes').update({ text }).eq('id', note.id)
  }

  async function updateName(note, name) {
    note.name = name.trim() || note.name
    notes = [...notes]
    await supabase.from('notes').update({ name: note.name }).eq('id', note.id)
  }

  async function deleteTopic(id) {
    if (!confirm('Delete this topic?')) return
    await supabase.from('notes').delete().eq('id', id)
    notes = notes.filter(n => n.id !== id)
  }

  async function moveNote(note, dir) {
    const idx = notes.findIndex(n => n.id === note.id)
    const ni = idx + dir
    if (ni < 0 || ni >= notes.length) return
    const a = notes[idx], b = notes[ni]
    const pa = a.position ?? idx, pb = b.position ?? ni
    a.position = pb; b.position = pa
    notes = [...notes].sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
    await Promise.all([
      supabase.from('notes').update({ position: pb }).eq('id', a.id),
      supabase.from('notes').update({ position: pa }).eq('id', b.id),
    ])
  }

  function toggle(note) { note._exp = !note._exp; notes = [...notes] }

  function autoResize(node) {
    function resize() { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px' }
    setTimeout(resize, 0)
    node.addEventListener('input', resize)
    return { destroy() { node.removeEventListener('input', resize) } }
  }

  load()
  fetchLastSyncTime()
</script>

<div class="notes-wrap">
  <div class="top-bar">
    <span class="sh">NOTES</span>
    <div class="apple-sync-row">
      {#if lastSync}
        <span class="apple-sync-ts">↻ {lastSync.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      {/if}
      <button class="apple-sync-btn {syncStatus === 'syncing' ? 'syncing' : ''}"
        onclick={triggerAppleSync}
        disabled={syncStatus === 'syncing'}>
        {syncStatus === 'syncing' ? '⏳' : syncStatus === 'done' ? `✓ ${syncCount} synced` : syncStatus === 'error' ? '✗ error' : '🍎 Sync'}
      </button>
    </div>
    <div class="add-row">
      <input class="inp" bind:value={newTopicName} placeholder="New topic..."
        onkeydown={e => e.key === 'Enter' && addTopic()} />
      <button class="btn btn-gold" onclick={addTopic}>+ Topic</button>
    </div>
  </div>

  {#if loading}
    <div class="empty">Loading...</div>
  {:else if !notes.length}
    <div class="empty">No topics yet.</div>
  {:else}
    <div id="topic-list">
      {#each notes as note (note.id)}
        <div class="topic {note._exp ? 'exp' : ''}">
          <div class="topic-head" onclick={() => toggle(note)}>
            <span class="topic-arr">▶</span>
            <span class="topic-name">{note.name}{#if note.source === 'apple_notes'} <span class="apple-badge">🍎</span>{/if}</span>
            <div class="topic-actions" onclick={e => e.stopPropagation()}>
              <button class="act-btn" onclick={() => moveNote(note, -1)}>▲</button>
              <button class="act-btn" onclick={() => moveNote(note, 1)}>▼</button>
              <button class="act-btn del" onclick={() => deleteTopic(note.id)}>✕</button>
            </div>
          </div>
          {#if note._exp}
            <div class="topic-body">
              <textarea class="note-area" value={note.text || ''}
                use:autoResize
                oninput={e => updateText(note, e.target.value)}
                placeholder="Write anything..."></textarea>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .notes-wrap { width: 100%; }
  .top-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .apple-sync-row { display: flex; align-items: center; gap: 6px; }
  .apple-sync-ts { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .apple-sync-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 4px 10px; background: #1c1c1c; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; letter-spacing: .04em; }
  .apple-sync-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .apple-sync-btn.syncing { opacity: .6; cursor: default; }
  .apple-badge { font-size: 12px; opacity: .7; }
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .add-row { display: flex; gap: 8px; margin-left: auto; }
  .inp { background: #1c1c1c; border: 1px solid #252525; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 6px 10px; outline: none; border-radius: 3px; width: 220px; }
  .inp:focus { border-color: rgba(201,168,76,.4); }
  .inp::placeholder { color: #444; }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer; }
  .btn-gold { background: #c9a84c; color: #0a0a0a; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; padding: 32px 0; text-align: center; }

  #topic-list { display: flex; flex-direction: column; gap: 7px; }
  .topic { border: 1px solid #2e2e2e; border-radius: 4px; overflow: hidden; }
  .topic.exp { border-color: rgba(201,168,76,.4); }
  .topic-head { padding: 10px 14px; display: flex; align-items: center; gap: 8px; cursor: pointer; background: #1c1c1c; user-select: none; width: 100%; }
  .topic-head:hover { background: #252525; }
  .topic.exp .topic-head { background: #252525; }
  .topic-arr { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; transition: transform .2s; flex-shrink: 0; }
  .topic.exp .topic-arr { transform: rotate(90deg); }
  .topic-name { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; flex: 1; color: #cec9c1; }
  .topic.exp .topic-name { color: #c9a84c; }
  .topic-actions { display: flex; align-items: center; gap: 3px; opacity: 0; transition: opacity .15s; }
  .topic-head:hover .topic-actions { opacity: 1; }
  .act-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .act-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .act-btn.del:hover { border-color: #e05a4a; color: #e05a4a; }

  .topic-body { padding: 0; border-top: 1px solid #2e2e2e; }
  .note-area { display: block; width: 100%; min-height: 120px; background: #0a0a0a; border: none; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; padding: 14px 18px; outline: none; resize: vertical; border-radius: 0; line-height: 1.8; white-space: pre-wrap; tab-size: 4; }
  .note-area:focus { background: #0d0d0d; }
  .note-area::placeholder { color: #333; }
  .note-rendered { display: block; width: 100%; min-height: 48px; background: #0a0a0a; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; padding: 14px 18px; line-height: 1.8; cursor: text; word-break: break-word; }
  .note-rendered:hover { background: #0d0d0d; }
  .note-rendered.empty { min-height: 48px; }
  .note-placeholder { color: #333; font-style: italic; font-size: 13px; }
  .md-h1 { display: block; font-family: 'Space Mono', monospace; font-size: 15px; font-weight: 700; color: #c9a84c; margin: 4px 0 2px; }
  .md-h2 { display: block; font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: rgba(201,168,76,.8); margin: 4px 0 2px; }
  .md-h3 { display: block; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .06em; margin: 4px 0 2px; }
  .md-li { display: block; padding-left: 8px; color: #cec9c1; }
  .md-code { font-family: 'Space Mono', monospace; font-size: 12px; background: #1c1c1c; padding: 1px 5px; border-radius: 3px; color: #9e9690; }
</style>