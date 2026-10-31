<script>
  // OVERVIEW — work log + billing per feedback project (Feedback tab and artist page).
  // Stored on feedback_projects: hourly_rate (numeric, default 100) and work_log (jsonb):
  //   rows:        { id, kind: 'row', date, type: 'SESSION'|'DIV', what, time, hours }
//                time = free text ("12-7", never calculated), hours = billed decimal hours
  //   settlements: { id, kind: 'settlement', rate, closed_at }
  // A settlement closes all rows since the previous one; its rate is frozen at closing time so a later
  // rate change does not alter what was already billed. Amount = hours × rate for SESSION, none for DIV.
  import { onMount, onDestroy, tick } from 'svelte'

  let { supabase, project, mode = 'artist' } = $props()

  const isProducer = $derived(mode === 'producer')

  let log     = $state([])
  let rate    = $state(100)
  let loading = $state(true)
  let rootEl  = null

  async function fetchLog() {
    const { data, error } = await supabase.from('feedback_projects')
      .select('work_log, hourly_rate').eq('id', project.id).single()
    if (error) { console.warn('[Overview] load error:', error.message); return null }
    return data
  }
  async function load() {
    const d = await fetchLog()
    if (d) { log = d.work_log || []; rate = Number(d.hourly_rate ?? 100) }
    loading = false
  }

  // Artist sees Remo's changes within a few seconds; paused while editing here
  let pollTimer = null
  function startPolling() {
    pollTimer = setInterval(async () => {
      const a = document.activeElement
      if (a && rootEl?.contains(a) && ['INPUT', 'SELECT'].includes(a.tagName)) return
      const d = await fetchLog()
      if (!d) return
      if (JSON.stringify(d.work_log || []) !== JSON.stringify(log)) log = d.work_log || []
      if (Number(d.hourly_rate) !== rate) rate = Number(d.hourly_rate)
    }, 5000)
  }

  // Read-modify-write on a fresh copy. Chained, so overlapping saves (Tab to the next cell while the
  // previous one is still writing) never overwrite each other.
  let chain = Promise.resolve()
  function mutate(fn) {
    const run = async () => {
      const { data, error } = await supabase.from('feedback_projects').select('work_log').eq('id', project.id).single()
      if (error) { alert('Error: ' + error.message); return }
      const next = data.work_log || []
      fn(next)
      const { error: upErr } = await supabase.from('feedback_projects').update({ work_log: next }).eq('id', project.id)
      if (upErr) { alert('Error: ' + upErr.message); return }
      log = next
    }
    chain = chain.then(run, run)
    return chain
  }

  // ── hours: "4", "4.5", "4,5", "0:30", "0:30:00" → decimal hours ─────────────
  function parseHours(raw) {
    const s = String(raw ?? '').trim().replace(',', '.')
    if (!s) return null
    if (s.includes(':')) {
      const [h, m = '0', sec = '0'] = s.split(':')
      if (![h, m, sec].every(x => /^\d+$/.test(x))) return NaN
      return Math.round((+h + +m / 60 + +sec / 3600) * 10000) / 10000
    }
    return /^\d+(\.\d+)?$/.test(s) ? +s : NaN
  }
  function fmtHours(h) {
    if (h == null || h === '') return ''
    return String(Math.round(h * 100) / 100)
  }
  function fmtMoney(n) {
    if (n == null) return ''
    const r = Math.round(n * 100) / 100
    return Number.isInteger(r) ? r + '.-' : r.toFixed(2)
  }

  // ── blocks: rows between settlements, each with its rate and totals ────────
  const view = $derived.by(() => {
    const out = []
    let block = [], n = 0
    for (const e of log) {
      if (e.kind === 'settlement') {
        const r = Number(e.rate ?? rate)
        for (const it of block) it.amount = it.e.type === 'SESSION' && it.e.hours != null ? it.e.hours * r : null
        out.push(...block)
        n++
        out.push({ e, n, rate: r,
                   amount: block.reduce((s, it) => s + (it.amount || 0), 0),
                   hours: block.reduce((s, it) => s + (it.e.hours || 0), 0) })
        block = []
      } else block.push({ e, amount: null })
    }
    for (const it of block) it.amount = it.e.type === 'SESSION' && it.e.hours != null ? it.e.hours * rate : null
    out.push(...block)
    return {
      items: out,
      open: block,
      openHours: block.reduce((s, it) => s + (it.e.hours || 0), 0),
      openAmount: block.reduce((s, it) => s + (it.amount || 0), 0),
    }
  })

  // ── producer edits ─────────────────────────────────────────────────────────
  async function saveCell(id, field, value) {
    const cur = log.find(e => e.id === id)
    if (!cur || cur[field] === value) return
    await mutate(l => { const e = l.find(e => e.id === id); if (e) e[field] = value })
  }
  async function saveHours(id, input) {
    const h = parseHours(input.value)
    if (Number.isNaN(h)) {
      input.value = fmtHours(log.find(e => e.id === id)?.hours)
      input.classList.add('bad'); setTimeout(() => input.classList.remove('bad'), 1200)
      return
    }
    input.value = fmtHours(h)
    await saveCell(id, 'hours', h)
  }
  async function addRow() {
    const row = { id: 'w' + Date.now() + Math.random().toString(36).slice(2, 6), kind: 'row', date: '', type: 'SESSION', what: '', time: '', hours: null }
    await mutate(l => { if (!l.some(e => e.id === row.id)) l.push(row) })
    await tick()
    rootEl?.querySelector(`[data-id="${row.id}"][data-col="date"]`)?.focus()
  }
  async function deleteEntry(id) {
    await mutate(l => { const i = l.findIndex(e => e.id === id); if (i >= 0) l.splice(i, 1) })
  }
  async function closeSettlement() {
    if (!view.open.length) return
    const sep = { id: 's' + Date.now(), kind: 'settlement', rate, closed_at: new Date().toISOString() }
    await mutate(l => { if (!l.some(e => e.id === sep.id)) l.push(sep) })
  }
  async function saveRate(input) {
    const r = parseFloat(String(input.value).replace(',', '.'))
    if (!(r >= 0)) { input.value = rate; return }
    if (r === rate) return
    const { error } = await supabase.from('feedback_projects').update({ hourly_rate: r }).eq('id', project.id)
    if (error) { alert('Error: ' + error.message); input.value = rate; return }
    rate = r
  }

  // Enter → same column, next row (blur saves the current cell)
  function onEnter(e, id, col) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const rows = view.items.filter(it => it.e.kind !== 'settlement').map(it => it.e.id)
    const nextId = rows[rows.indexOf(id) + 1]
    const next = nextId && rootEl?.querySelector(`[data-id="${nextId}"][data-col="${col}"]`)
    if (next) next.focus(); else e.target.blur()
  }

  onMount(() => { load().then(startPolling) })
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<div class="ov" bind:this={rootEl}>
  {#if loading}
    <p class="empty">Loading…</p>
  {:else}
    <div class="ov-top">
      <span class="rate">
        {#if isProducer}
          <input class="rate-inp" value={rate} onblur={e => saveRate(e.target)}
            onkeydown={e => { if (e.key === 'Enter') e.target.blur() }} />
        {:else}{rate}{/if}.- / Stunde
      </span>
      <span class="open-sum">Offen seit letzter Abrechnung: {fmtHours(view.openHours) || '0'} Std · {fmtMoney(view.openAmount)}</span>
    </div>

    <div class="ov-head {isProducer ? 'prod' : ''}">
      <span>DATUM</span><span>TYP</span><span>WAS</span><span>ZEIT</span><span class="num">STUNDEN</span><span class="num">BETRAG</span>
      {#if isProducer}<span></span>{/if}
    </div>

    {#each view.items as it (it.e.id)}
      {#if it.e.kind === 'settlement'}
        <div class="sep {isProducer ? 'prod' : ''}">
          <span class="sep-label">ABRECHNUNG {it.n}</span>
          <span class="sep-dots"></span>
          <span class="sep-hours">{fmtHours(it.hours)} Std</span>
          <span class="sep-amount">{fmtMoney(it.amount)}</span>
          {#if isProducer}<button class="x" title="Trennlinie entfernen" onclick={() => deleteEntry(it.e.id)}>×</button>{/if}
        </div>
      {:else if isProducer}
        <div class="row prod">
          <input class="cell" data-id={it.e.id} data-col="date" value={it.e.date} placeholder="—"
            onblur={e => saveCell(it.e.id, 'date', e.target.value.trim())} onkeydown={e => onEnter(e, it.e.id, 'date')} />
          <select class="cell" data-id={it.e.id} data-col="type" value={it.e.type}
            onchange={e => saveCell(it.e.id, 'type', e.target.value)} onkeydown={e => onEnter(e, it.e.id, 'type')}>
            <option>SESSION</option><option>DIV</option>
          </select>
          <input class="cell" data-id={it.e.id} data-col="what" value={it.e.what} placeholder="—"
            onblur={e => saveCell(it.e.id, 'what', e.target.value.trim())} onkeydown={e => onEnter(e, it.e.id, 'what')} />
          <input class="cell" data-id={it.e.id} data-col="time" value={it.e.time || ''} placeholder=""
            onblur={e => saveCell(it.e.id, 'time', e.target.value.trim())} onkeydown={e => onEnter(e, it.e.id, 'time')} />
          <input class="cell num" data-id={it.e.id} data-col="hours" value={fmtHours(it.e.hours)} placeholder=""
            onblur={e => saveHours(it.e.id, e.target)} onkeydown={e => onEnter(e, it.e.id, 'hours')} />
          <span class="amount">{fmtMoney(it.amount)}</span>
          <button class="x" title="Zeile löschen" onclick={() => deleteEntry(it.e.id)}>×</button>
        </div>
      {:else}
        <div class="row">
          <span class="ro">{it.e.date}</span>
          <span class="ro type">{it.e.type}</span>
          <span class="ro">{it.e.what}</span>
          <span class="ro time">{it.e.time || ''}</span>
          <span class="ro num">{fmtHours(it.e.hours)}</span>
          <span class="amount">{fmtMoney(it.amount)}</span>
        </div>
      {/if}
    {/each}

    {#if !view.items.length}<p class="empty">Noch keine Einträge.</p>{/if}

    <!-- Running total of everything not yet settled — what the next settlement would bill -->
    <div class="total {isProducer ? 'prod' : ''}">
      <span class="total-label">TOTAL OFFEN</span>
      <span class="num total-hours">{fmtHours(view.openHours) || '0'} Std</span>
      <span class="total-amount">{fmtMoney(view.openAmount)}</span>
      {#if isProducer}<span></span>{/if}
    </div>

    {#if isProducer}
      <div class="ov-actions">
        <button class="btn" onclick={addRow}>+</button>
        <button class="btn" disabled={!view.open.length} onclick={closeSettlement}>+ Abrechnung abschliessen</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .ov { display: flex; flex-direction: column; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 30px 0; margin: 0; }

  .ov-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .rate { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-mid); display: flex; align-items: center; gap: 2px; }
  .rate-inp { width: 52px; text-align: right; background: transparent; border: 1px solid transparent; color: var(--text); font-family: 'Space Mono', monospace; font-size: 12px; padding: 3px 4px; border-radius: 2px; outline: none; }
  .rate-inp:hover, .rate-inp:focus { border-color: var(--border2); background: var(--surface2); }
  .open-sum { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--accent); }

  .ov-head, .row { display: grid; grid-template-columns: 70px 100px minmax(0, 1fr) 80px 80px 90px; gap: 10px; align-items: center; }
  .ov-head.prod, .row.prod { grid-template-columns: 70px 100px minmax(0, 1fr) 80px 80px 90px 18px; }
  .total { display: grid; grid-template-columns: minmax(0, 1fr) 80px 90px; gap: 10px; align-items: center; padding: 10px; border-top: 1px solid var(--border2); border-bottom: 1px solid var(--border2); margin-top: -1px; background: var(--surface); }
  .total.prod { grid-template-columns: minmax(0, 1fr) 80px 90px 18px; }
  .total-label { font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: .08em; color: var(--text-mid); }
  .total-hours { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text); }
  .total-amount { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--accent); text-align: right; }
  .ov-head { padding: 0 10px 8px; border-bottom: 1px solid var(--border); font-family: 'Space Mono', monospace; font-size: 13px; text-transform: uppercase; color: var(--accent-a75); letter-spacing: .06em; }
  .row { padding: 3px 10px; border-bottom: 1px solid var(--border); min-height: 34px; }
  .num { text-align: right; }

  .cell { min-width: 0; background: transparent; border: 1px solid transparent; color: var(--text-mid); font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.5; font-weight: 300; padding: 3px 6px; border-radius: 2px; outline: none; }
  .cell:hover { border-color: var(--border2); }
  .cell:focus { border-color: var(--border2); background: var(--surface2); color: var(--text); }
  .cell::placeholder { color: var(--text-faint); }
  select.cell { font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; }
  select.cell option { background: var(--surface); color: var(--text); }
  :global(.cell.bad) { border-color: #e05a4a !important; }
  .ro { font-size: 14px; line-height: 1.5; color: var(--text-mid); padding: 3px 0; overflow-wrap: anywhere; }
  .ro.type, .ro.time { font-family: 'Space Mono', monospace; font-size: 11px; }
  .amount { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-mid); text-align: right; }
  .x { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 15px; line-height: 1; padding: 0; }
  .x:hover { color: #e05a4a; }

  .sep { display: grid; grid-template-columns: auto minmax(20px, 1fr) auto 90px; gap: 10px; align-items: center; padding: 10px; border-bottom: 1px solid var(--border2); }
  .sep.prod { grid-template-columns: auto minmax(20px, 1fr) auto 90px 18px; }
  .sep-label { font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: .08em; color: var(--accent); }
  .sep-dots { border-bottom: 1px dotted var(--border2); height: 1px; align-self: center; }
  .sep-hours { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); }
  .sep-amount { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--accent); text-align: right; }

  .ov-actions { display: flex; gap: 8px; margin-top: 12px; }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .btn:hover:not(:disabled) { border-color: var(--accent-dim); }
  .btn:disabled { opacity: .4; cursor: default; }

  @media (max-width: 640px) {
    .ov-head, .row { grid-template-columns: 40px 58px minmax(0, 1fr) 40px 38px 56px; gap: 5px; padding-left: 4px; padding-right: 4px; }
    .ov-head.prod, .row.prod { grid-template-columns: 40px 58px minmax(0, 1fr) 40px 38px 56px 14px; }
    .total { grid-template-columns: minmax(0, 1fr) 60px 70px; padding-left: 4px; padding-right: 4px; }
    .total.prod { grid-template-columns: minmax(0, 1fr) 60px 70px 14px; }
    .ov-head { font-size: 10px; }
  }
</style>
