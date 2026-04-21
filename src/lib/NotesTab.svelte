<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext } from './mozartContext.js'

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
      const r = await fetch('/watcher/notes')
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
    const r = await fetch('/watcher/notes', {
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
    const r = await fetch('/watcher/notes', {
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
    const r = await fetch('/watcher/notes', {
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
    await fetch('/watcher/notes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: note.filename })
    })
    notes = notes.filter(n => n.filename !== note.filename)
  }

  async function triggerAppleSync() {
    syncStatus = 'syncing'
    try {
      const r = await fetch('/watcher/apple-notes-sync', { method: 'POST' })
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

  async function moveNote(note, dir) {
    await fetch('/watcher/notes/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: note.filename, direction: dir })
    })
    await load()
  }

  let saveTimers = {}
  function debounceSave(note, text) {
    clearTimeout(saveTimers[note.filename])
    saveTimers[note.filename] = setTimeout(() => saveContent(note, text), 800)
  }

  // NOW note state
  let nowContent = $state('')
  let nowSaveTimer = null
  let nowExtractStatus = $state(null) // null | 'extracting' | { count: number }

  async function loadNow() {
    try {
      const r = await fetch('/watcher/now')
      const d = await r.json()
      nowContent = d.content || ''
    } catch(e) { console.error('now load error', e) }
  }

  function saveNow(text) {
    nowContent = text
    clearTimeout(nowSaveTimer)
    nowSaveTimer = setTimeout(async () => {
      try {
        await fetch('/watcher/now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text })
        })
      } catch(e) { console.error('now save error', e) }
    }, 600)
  }

  async function extractNow() {
    nowExtractStatus = 'extracting'
    try {
      const r = await fetch('/watcher/now/extract', { method: 'POST' })
      const d = await r.json()
      nowExtractStatus = { count: d.count ?? 0 }
      setTimeout(() => { nowExtractStatus = null }, 4000)
    } catch(e) {
      nowExtractStatus = null
    }
  }

  load()
  loadNow()

  let aiMessages = $state([])
  let aiInput = $state('')
  let aiLoading = $state(false)

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return
    const msg = aiInput.trim(); aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set — add it in Settings ⚙.' }]; aiLoading = false; return }
    const mozartContext = await buildMozartContext(supabase, {})
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: mozartContext, messages: aiMessages.slice(-10) })
      })
      const data = await res.json()
      if (data.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/mozart', model: 'claude-sonnet-4-20250514', input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, cost_usd: (data.usage.input_tokens * 0.000003) + (data.usage.output_tokens * 0.000015) }) }).catch(() => {})
      aiMessages = [...aiMessages, { role: 'assistant', content: data.content?.[0]?.text || 'No response.' }]
    } catch(e) { aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: '+e.message }] }
    aiLoading = false
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
  }
</script>

<div class="tab-layout">
<div class="tab-main">
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

  <div class="now-block">
    <div class="now-header">
      <span class="now-label">NOW</span>
      <button class="extract-btn"
        onclick={extractNow}
        disabled={nowExtractStatus === 'extracting'}>
        {#if nowExtractStatus === 'extracting'}
          Extracting...
        {:else if nowExtractStatus !== null}
          ✓ {nowExtractStatus.count} saved
        {:else}
          → Extract to Brain
        {/if}
      </button>
    </div>
    <textarea class="now-area"
      value={nowContent}
      oninput={e => saveNow(e.target.value)}
      use:autoResize
      placeholder="Write anything — thoughts, ideas, observations. Saved automatically. Extracts to brain 30s after you stop typing."></textarea>
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
              <button class="act-btn" onclick={() => moveNote(note, -1)}>▲</button>
              <button class="act-btn" onclick={() => moveNote(note, 1)}>▼</button>
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
<div class="tab-sidebar">
  <div class="mozart-block">
    <div class="mozart-title-row">
      <div class="mozart-title">ASK MOZART</div>
      {#if aiMessages.length}
        <button class="clear-chat" onclick={() => aiMessages = []}>Clear</button>
      {/if}
    </div>
    <div class="chat-input-row">
      <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..." onkeydown={e=>e.key==='Enter'&&sendAI()} />
      <button class="btn-gold-sm" onclick={sendAI}>Ask</button>
    </div>
    <div class="chat-out">
      {#each aiMessages as msg}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
          <div class="chat-text">{@html msg.role === 'assistant' ? formatMozartOutput(msg.content) : msg.content}</div>
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
      {/if}
    </div>
  </div>
</div>
</div>

<style>
  .tab-layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; min-height: calc(100vh - 100px); align-items: start; }
  .tab-main { display: flex; flex-direction: column; min-width: 0; }
  .tab-sidebar { border-left: 1px solid #1c1c1c; padding-left: 24px; display: flex; flex-direction: column; }
  .now-block { margin-bottom: 28px; }
  .now-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .now-label { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .now-area { width: 100%; min-height: 120px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; line-height: 1.6; padding: 12px; resize: none; outline: none; box-sizing: border-box; transition: border-color .2s; }
  .now-area:focus { border-color: rgba(201,168,76,.4); }
  .now-area::placeholder { color: #555; }
  .extract-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 5px 10px; background: transparent; border: 1px solid #3c3c3c; color: #9e9690; border-radius: 3px; cursor: pointer; transition: all .2s; white-space: nowrap; }
  .extract-btn:hover:not(:disabled) { border-color: #c9a84c; color: #c9a84c; }
  .extract-btn:disabled { opacity: 0.6; cursor: default; }
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
  .mozart-block { margin-top: 16px; border-top: 1px solid #1c1c1c; padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .mozart-title-row { display: flex; align-items: center; justify-content: space-between; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); margin-bottom: 2px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: #555; color: #9e9690; }
  .chat-out { overflow-y: auto; max-height: 70vh; min-height: 200px; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; scroll-behavior: smooth; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; line-height: 1.5; }
  .chat-text.dim { color: #444; }
  .chat-input-row { display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 7px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
</style>
