<script>
  let notes = $state([])
  let loading = $state(true)
  let newTopicName = $state('')
  let syncStatus = $state(null)  // null | 'syncing' | 'done' | 'error'
  let lastSync = $state(null)
  let syncCount = $state(null)
  let savingFiles = $state({})   // filename → true while saving

  async function load() {
    loading = true
    try {
      const r = await fetch('http://localhost:4242/notes')
      const d = await r.json()
      notes = (d.notes || []).map(n => ({ ...n, _exp: false, _editing: false }))
      if (d.lastSync) lastSync = new Date(d.lastSync)
    } catch(e) { console.error('notes load error', e) }
    loading = false
  }

  async function addTopic() {
    if (!newTopicName.trim()) return
    const title = newTopicName.trim()
    newTopicName = ''
    const r = await fetch('http://localhost:4242/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: '' })
    })
    const d = await r.json()
    if (d.ok) notes = [{ title, content: '', filename: d.filename, updated: new Date().toISOString(), _exp: true, _editing: false }, ...notes]
  }

  async function saveContent(note, text) {
    note.content = text
    notes = [...notes]
    savingFiles[note.filename] = true
    const r = await fetch('http://localhost:4242/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: note.filename, content: text })
    })
    const d = await r.json()
    if (d.ok) note.filename = d.filename
    delete savingFiles[note.filename]
    savingFiles = { ...savingFiles }
  }

  async function renameNote(note, newTitle) {
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === note.title) { note._editing = false; notes = [...notes]; return }
    const r = await fetch('http://localhost:4242/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: note.filename, title: trimmed, content: note.content })
    })
    const d = await r.json()
    if (d.ok) { note.title = trimmed; note.filename = d.filename }
    note._editing = false
    notes = [...notes]
  }

  async function deleteNote(note) {
    if (!confirm(`Delete "${note.title}"?`)) return
    await fetch('http://localhost:4242/notes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: note.filename })
    })
    notes = notes.filter(n => n.filename !== note.filename)
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

  function toggle(note) { note._exp = !note._exp; notes = [...notes] }

  function autoResize(node) {
    function resize() { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px' }
    setTimeout(resize, 0)
    node.addEventListener('input', resize)
    return { destroy() { node.removeEventListener('input', resize) } }
  }

  function focusInput(node) { setTimeout(() => node.focus(), 0) }

  let saveTimers = {}
  function debounceSave(note, text) {
    clearTimeout(saveTimers[note.filename])
    saveTimers[note.filename] = setTimeout(() => saveContent(note, text), 800)
  }

  load()
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
    <div class="empty">No notes yet.</div>
  {:else}
    <div id="topic-list">
      {#each notes as note (note.filename)}
        <div class="topic {note._exp ? 'exp' : ''}">
          <div class="topic-head" onclick={() => toggle(note)}>
            <span class="topic-arr">▶</span>
            {#if note._editing}
              <input class="topic-name-inp" value={note.title}
                onclick={e => e.stopPropagation()}
                onblur={e => renameNote(note, e.target.value)}
                onkeydown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { note._editing = false; notes = [...notes] } }}
                use:focusInput />
            {:else}
              <span class="topic-name">{note.title}</span>
            {/if}
            <div class="topic-actions" onclick={e => e.stopPropagation()}>
              <button class="act-btn" onclick={() => { note._editing = true; notes = [...notes] }}>✎</button>
              <button class="act-btn del" onclick={() => deleteNote(note)}>✕</button>
            </div>
            {#if savingFiles[note.filename]}
              <span class="saving-dot"></span>
            {/if}
          </div>
          {#if note._exp}
            <div class="topic-body">
              <textarea class="note-area" value={note.content || ''}
                use:autoResize
                oninput={e => debounceSave(note, e.target.value)}
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
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .apple-sync-row { display: flex; align-items: center; gap: 6px; }
  .apple-sync-ts { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .apple-sync-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 4px 10px; background: #1c1c1c; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; letter-spacing: .04em; }
  .apple-sync-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .apple-sync-btn.syncing { opacity: .6; cursor: default; }
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
  .topic-name-inp { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; flex: 1; background: #0a0a0a; border: 1px solid rgba(201,168,76,.4); color: #c9a84c; padding: 2px 6px; outline: none; border-radius: 2px; }
  .topic-actions { display: flex; align-items: center; gap: 3px; opacity: 0; transition: opacity .15s; }
  .topic-head:hover .topic-actions { opacity: 1; }
  .act-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .act-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .act-btn.del:hover { border-color: #e05a4a; color: #e05a4a; }
  .saving-dot { width: 6px; height: 6px; background: rgba(201,168,76,.6); border-radius: 50%; flex-shrink: 0; animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }

  .topic-body { padding: 0; border-top: 1px solid #2e2e2e; }
  .note-area { display: block; width: 100%; min-height: 120px; background: #0a0a0a; border: none; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; padding: 14px 18px; outline: none; resize: vertical; border-radius: 0; line-height: 1.8; white-space: pre-wrap; tab-size: 4; }
  .note-area:focus { background: #0d0d0d; }
  .note-area::placeholder { color: #333; }
</style>
