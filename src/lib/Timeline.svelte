<script>
  // TIMELINE — free-text song schedule per feedback project (Feedback tab and artist page).
  // Stored on feedback_projects.timeline (jsonb): [{ id, song, finished, feedback }].
  // Deliberately not linked to the song list — all three columns are plain text.
  import { onMount, onDestroy, tick } from 'svelte'

  let { supabase, project, mode = 'artist' } = $props()

  const isProducer = $derived(mode === 'producer')
  const COLS = ['song', 'finished', 'feedback']

  let rows    = $state([])
  let loading = $state(true)
  let rootEl  = null

  async function fetchRows() {
    const { data, error } = await supabase.from('feedback_projects').select('timeline').eq('id', project.id).single()
    if (error) { console.warn('[Timeline] load error:', error.message); return null }
    return data.timeline || []
  }
  async function load() {
    const r = await fetchRows()
    if (r) rows = r
    loading = false
  }

  // Artist sees Remo's changes within a few seconds; paused while editing here
  let pollTimer = null
  function startPolling() {
    pollTimer = setInterval(async () => {
      const a = document.activeElement
      if (a && rootEl?.contains(a) && a.tagName === 'INPUT') return
      const r = await fetchRows()
      if (r && JSON.stringify(r) !== JSON.stringify(rows)) rows = r
    }, 5000)
  }

  // Read-modify-write on a fresh copy, chained so overlapping saves never overwrite each other
  let chain = Promise.resolve()
  function mutate(fn) {
    const run = async () => {
      const { data, error } = await supabase.from('feedback_projects').select('timeline').eq('id', project.id).single()
      if (error) { alert('Error: ' + error.message); return }
      const next = data.timeline || []
      fn(next)
      const { error: upErr } = await supabase.from('feedback_projects').update({ timeline: next }).eq('id', project.id)
      if (upErr) { alert('Error: ' + upErr.message); return }
      rows = next
    }
    chain = chain.then(run, run)
    return chain
  }

  async function saveCell(id, field, value) {
    const cur = rows.find(r => r.id === id)
    if (!cur || (cur[field] || '') === value) return
    await mutate(l => { const r = l.find(r => r.id === id); if (r) r[field] = value })
  }
  async function addRow() {
    const row = { id: 't' + Date.now() + Math.random().toString(36).slice(2, 6), song: '', finished: '', feedback: '' }
    await mutate(l => { if (!l.some(r => r.id === row.id)) l.push(row) })
    await tick()
    rootEl?.querySelector(`[data-id="${row.id}"][data-col="song"]`)?.focus()
  }
  async function deleteRow(id) {
    await mutate(l => { const i = l.findIndex(r => r.id === id); if (i >= 0) l.splice(i, 1) })
  }

  // Enter → same column, next row (blur saves the current cell)
  function onEnter(e, id, col) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const nextId = rows[rows.findIndex(r => r.id === id) + 1]?.id
    const next = nextId && rootEl?.querySelector(`[data-id="${nextId}"][data-col="${col}"]`)
    if (next) next.focus(); else e.target.blur()
  }

  onMount(() => { load().then(startPolling) })
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<div class="tl" bind:this={rootEl}>
  {#if loading}
    <p class="empty">Loading…</p>
  {:else}
    <div class="tl-head {isProducer ? 'prod' : ''}">
      <span>SONG</span><span>FINISHED</span><span>AKTUELLE VERSION FEEDBACKS</span>
      {#if isProducer}<span></span>{/if}
    </div>

    {#each rows as r (r.id)}
      {#if isProducer}
        <div class="row prod">
          {#each COLS as col}
            <input class="cell {col}" data-id={r.id} data-col={col} value={r[col] || ''} placeholder="—"
              onblur={e => saveCell(r.id, col, e.target.value.trim())} onkeydown={e => onEnter(e, r.id, col)} />
          {/each}
          <button class="x" title="Zeile löschen" onclick={() => deleteRow(r.id)}>×</button>
        </div>
      {:else}
        <div class="row">
          <span class="ro song">{r.song}</span>
          <span class="ro finished">{r.finished}</span>
          <span class="ro">{r.feedback}</span>
        </div>
      {/if}
    {/each}

    {#if !rows.length}<p class="empty">Noch keine Einträge.</p>{/if}

    {#if isProducer}
      <div class="tl-actions"><button class="btn" onclick={addRow}>+</button></div>
    {/if}
  {/if}
</div>

<style>
  .tl { display: flex; flex-direction: column; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 30px 0; margin: 0; }

  .tl-head, .row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 2fr); gap: 10px; align-items: center; }
  .tl-head.prod, .row.prod { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 2fr) 18px; }
  .tl-head { padding: 0 10px 8px; border-bottom: 1px solid var(--border); font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; }
  .row { padding: 3px 10px; border-bottom: 1px solid var(--border); min-height: 34px; }

  .cell { min-width: 0; background: transparent; border: 1px solid transparent; color: var(--text-mid); font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.5; font-weight: 300; padding: 3px 6px; border-radius: 2px; outline: none; }
  .cell.song { color: var(--text); font-size: 15px; }
  .cell.finished { font-family: 'Space Mono', monospace; font-size: 12px; text-transform: uppercase; }
  .cell:hover { border-color: var(--border2); }
  .cell:focus { border-color: var(--border2); background: var(--surface2); color: var(--text); }
  .cell::placeholder { color: var(--text-faint); }
  .ro { font-size: 14px; line-height: 1.5; color: var(--text-mid); padding: 3px 0; overflow-wrap: anywhere; }
  .ro.song { color: var(--text); font-size: 15px; }
  .ro.finished { font-family: 'Space Mono', monospace; font-size: 12px; text-transform: uppercase; }
  .x { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 15px; line-height: 1; padding: 0; }
  .x:hover { color: #e05a4a; }

  .tl-actions { display: flex; gap: 8px; margin-top: 12px; }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .btn:hover { border-color: var(--accent-dim); }

  @media (max-width: 640px) {
    .tl-head, .row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr); gap: 6px; padding-left: 4px; padding-right: 4px; }
    .tl-head.prod, .row.prod { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) 14px; }
    .tl-head { font-size: 10px; }
  }
</style>
