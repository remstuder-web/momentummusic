<script>
  import { supabase } from './supabase.js'
  import { onMount } from 'svelte'

  let releases = $state([])
  let loading = $state(true)
  let expandedId = $state(null)
  let streamInputs = $state({})
  let workLogs = $state({})      // rel.id → {open, entries, loading}
  let logOpen = $state({})       // rel.id → bool

  function formatMinSec(sec) {
    const m = Math.floor(sec / 60), s = sec % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  async function load() {
    loading = true
    const { data } = await supabase.from('releases').select('*').order('release_date', { ascending: false })
    releases = data || []
    loading = false
    await checkOverdueInvoices(releases)
  }

  async function update(rel, field, value) {
    rel[field] = value
    releases = [...releases]
    await supabase.from('releases').update({ [field]: value }).eq('id', rel.id)
  }

  // All tasks go into TODAY's row. task.date controls when they appear in Daily tabs/calendar.
  const todayKey = () => new Date().toDateString()

  async function getTodayRow() {
    const { data } = await supabase.from('daily_state').select('id,tasks').eq('date', todayKey()).maybeSingle()
    return data
  }

  async function upsertTodayTasks(newTasks) {
    // newTasks: array of task objects to upsert (by id) into today's row
    const ds = await getTodayRow()
    let tasks = ds?.tasks || []
    for (const t of newTasks) {
      const idx = tasks.findIndex(x => x.id === t.id)
      if (idx >= 0) tasks[idx] = t; else tasks.push(t)
    }
    if (ds?.id) await supabase.from('daily_state').update({ tasks }).eq('id', ds.id)
    else await supabase.from('daily_state').insert({ date: todayKey(), tasks })
  }

  async function removeTodayTasks(ids) {
    const ds = await getTodayRow()
    if (!ds?.id) return
    const tasks = (ds.tasks||[]).filter(t => !ids.includes(t.id))
    await supabase.from('daily_state').update({ tasks }).eq('id', ds.id)
  }

  async function updateReleaseDate(rel, value) {
    const oldDate = rel.release_date
    await update(rel, 'release_date', value)

    const taskId = 'release_' + rel.id
    if (!value) {
      await removeTodayTasks([taskId])
      return
    }

    // Upsert into today's row with the target date — DailyTab uses task.date for calendar dots
    const label = 'RELEASE: ' + [rel.artist, rel.song_title].filter(Boolean).join('_')
    await upsertTodayTasks([{
      id: taskId, label, date: value, time: '', type: 'project',
      project: rel.project_name||'', done: false, recurring: false
    }])
  }

  async function toggleInvoiceSent(rel) {
    const newVal = !rel.invoice_sent
    await update(rel, 'invoice_sent', newVal)
    if (!newVal) return

    // Create ONE invoice check task 2 weeks from now
    await scheduleNextInvoiceCheck(rel)
  }

  async function scheduleNextInvoiceCheck(rel) {
    const songLabel = [rel.artist, rel.song_title].filter(Boolean).join('_')
    const checkDate = new Date(); checkDate.setDate(checkDate.getDate() + 14)
    const checkISO = checkDate.toISOString().slice(0,10)
    const taskId = `inv_check_${rel.id}`   // single fixed ID — always overwritten

    // Store the date for cleanup
    await supabase.from('releases').update({ invoice_check_dates: [checkISO] }).eq('id', rel.id)
    rel.invoice_check_dates = [checkISO]

    await upsertTodayTasks([{
      id: taskId, label: `INVOICE CHECK: ${songLabel}`,
      date: checkISO, time: '', type: 'project',
      project: rel.project_name||'', done: false, recurring: false
    }])
  }

  async function togglePaymentReceived(rel) {
    const newVal = !rel.payment_received
    await update(rel, 'payment_received', newVal)
    if (!newVal) return

    // Delete the current invoice check task
    await removeTodayTasks([`inv_check_${rel.id}`])
    await supabase.from('releases').update({ invoice_check_dates: [] }).eq('id', rel.id)
    rel.invoice_check_dates = []
  }

  // Called on load — checks if any invoice check task is past due without payment
  async function checkOverdueInvoices(releases) {
    const todayISO = new Date().toISOString().slice(0,10)
    for (const rel of releases) {
      if (!rel.invoice_sent || rel.payment_received) continue
      const dates = rel.invoice_check_dates || []
      // If the scheduled date has passed and payment still not received → reschedule
      if (dates.length > 0 && dates[0] <= todayISO) {
        await scheduleNextInvoiceCheck(rel)
      }
    }
  }

  async function loadWorkLog(rel) {
    if (workLogs[rel.id]?.entries) { logOpen = {...logOpen, [rel.id]: !logOpen[rel.id]}; return }
    workLogs = {...workLogs, [rel.id]: { loading: true, entries: null }}
    const { data } = await supabase.from('songs').select('work_data').eq('code', rel.song_code).maybeSingle()
    const log = data?.work_data?.session_log || []
    workLogs = {...workLogs, [rel.id]: { loading: false, entries: log }}
    logOpen = {...logOpen, [rel.id]: true}
  }

  function copyWorkLog(rel) {
    const entries = workLogs[rel.id]?.entries || []
    if (!entries.length) return
    const stageLabels = { production:'PRODUCTION', mix_prep:'MIX PREP', mixing:'MIXING', mastering:'MASTERING', stems:'STEMS' }
    const lines = entries.map(e => `${e.date || ''}  ${stageLabels[e.stage]||e.stage||''}  ${formatMinSec(e.seconds||0)}`).join('\n')
    const total = entries.reduce((s,e) => s+( e.seconds||0), 0)
    navigator.clipboard.writeText(lines + '\n\nTOTAL: ' + formatMinSec(total)).catch(()=>{})
  }

  async function addStreamEntry(rel) {
    const inp = streamInputs[rel.id] || {}
    if (!inp.count) return
    const entry = { date: inp.date || new Date().toISOString().slice(0,10), count: inp.count, notes: inp.notes || '' }
    const log = [...(rel.stream_log||[]), entry]
    await update(rel, 'stream_log', log)
    streamInputs = { ...streamInputs, [rel.id]: {} }
  }

  async function deleteStreamEntry(rel, idx) {
    const log = (rel.stream_log||[]).filter((_,i) => i !== idx)
    await update(rel, 'stream_log', log)
  }

  async function deleteRelease(rel) {
    if (!confirm(`Delete release "${rel.song_title||rel.song_code}"?`)) return
    fetch('http://localhost:4242/delete-release-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songCode: rel.song_code, artistName: rel.artist, songTitle: rel.song_title, releaseDate: rel.release_date })
    }).catch(() => {})
    await supabase.from('releases').delete().eq('id', rel.id)
    releases = releases.filter(r => r.id !== rel.id)
    if (expandedId === rel.id) expandedId = null
  }

  async function scheduleQuarterlyChecks(rel) {
    if (!rel.release_date) return
    const base = new Date(rel.release_date)
    const dates = []
    for (let q = 1; q <= 8; q++) {
      const d = new Date(base); d.setMonth(d.getMonth() + q * 3)
      dates.push(d.toISOString().slice(0,10))
    }
    await update(rel, 'quarterly_check_dates', dates)
    const newTasks = dates.map((date, i) => ({
      id: 't_qc_' + rel.id + '_' + i,
      label: 'Q-CHECK — ' + (rel.song_title || rel.song_code) + (rel.artist ? ' (' + rel.artist + ')' : ''),
      date, time: '09:00', type: 'project', project: rel.project_name || '', done: false, recurring: false
    }))
    await upsertTodayTasks(newTasks)
    alert(`✓ Created ${dates.length} quarterly check reminders in Daily`)
  }

  function latestStreams(rel) {
    return [...(rel.stream_log||[])].sort((a,b) => b.date.localeCompare(a.date)).slice(0,5)
  }

  onMount(load)
</script>

{#if loading}
  <p class="empty">Loading releases...</p>
{:else}
<div class="release-layout">

  <div class="release-header">
    <span class="release-title">RELEASES</span>
    <span class="release-count">{releases.length} songs</span>
  </div>

  {#if !releases.length}
    <div class="empty-state">
      <p>No releases yet. When you mark a release in Projects, it appears here.</p>
    </div>
  {:else}
    <div class="release-list">
      {#each releases as rel (rel.id)}
        <div class="rel-card {expandedId===rel.id?'open':''}">

          <!-- Card header -->
          <div class="rel-head" onclick={() => expandedId = expandedId===rel.id ? null : rel.id}>
            <div class="rel-head-left">
              <span class="rel-code">{rel.song_code||'—'}</span>
              <div class="rel-titles">
                <span class="rel-title-song">{rel.song_title||'Untitled'}</span>
                {#if rel.artist}<span class="rel-artist">{rel.artist}</span>{/if}
              </div>
            </div>
            <div class="rel-head-right">
              {#if rel.release_date}<span class="rel-date">{rel.release_date}</span>{/if}
              <span class="rel-badge {rel.agreement_signed?'gold':'red'}">AGMT</span>
              <span class="rel-badge {rel.suisa_registered?'gold':'red'}">SUISA</span>
              <span class="rel-badge {rel.invoice_sent?'gold':'red'}">INV</span>
              <span class="rel-badge {rel.payment_received?'gold':'dim'}">PAID</span>
              <span class="rel-arr {expandedId===rel.id?'open':''}">▶</span>
            </div>
          </div>

          {#if expandedId === rel.id}
          <div class="rel-body">

            <!-- TOP ROW: Song info + Agreements -->
            <div class="rel-section-row">
              <div class="rel-col">
                <div class="rel-sec-title">SONG INFO</div>
                <div class="rel-field-row">
                  <label>CODE</label>
                  <input class="r-inp" value={rel.song_code||''} onchange={e=>update(rel,'song_code',e.target.value)} />
                </div>
                <div class="rel-field-row">
                  <label>TITLE</label>
                  <input class="r-inp" value={rel.song_title||''} onchange={e=>update(rel,'song_title',e.target.value)} />
                </div>
                <div class="rel-field-row">
                  <label>ARTIST</label>
                  <input class="r-inp" value={rel.artist||''} onchange={e=>update(rel,'artist',e.target.value)} />
                </div>
                <div class="rel-field-row">
                  <label>PROJECT</label>
                  <input class="r-inp" value={rel.project_name||''} onchange={e=>update(rel,'project_name',e.target.value)} />
                </div>
                {#if rel.spotify_url}
                  <div class="rel-field-row">
                    <label>SPOTIFY</label>
                    <div class="r-spotify-row">
                      <button class="r-spotidown" onclick={() => { navigator.clipboard.writeText(rel.spotify_url); window.open('https://spotidown.app/de4','_blank') }}>↓</button>
                      <button class="r-play" onclick={() => window.open(rel.spotify_url,'_blank')}>▶</button>
                      <span class="r-spotify-link">{rel.spotify_url.slice(0,36)}...</span>
                    </div>
                  </div>
                {/if}
                <div class="rel-field-row">
                  <label>SPOTIFY URL</label>
                  <input class="r-inp" value={rel.spotify_url||''} placeholder="https://open.spotify.com/track/..." onchange={e=>update(rel,'spotify_url',e.target.value)} />
                </div>
              </div>

              <div class="rel-col">
                <div class="rel-sec-title">AGREEMENTS</div>
                <div class="rel-check-row">
                  <button class="r-ckb {rel.agreement_signed?'on':''}" onclick={() => update(rel,'agreement_signed',!rel.agreement_signed)}>{rel.agreement_signed?'✓':''}</button>
                  <span class="r-ck-label {rel.agreement_signed?'done':''}" >Agreement signed</span>
                </div>
                <div class="rel-check-row">
                  <button class="r-ckb {rel.suisa_registered?'on':''}" onclick={() => update(rel,'suisa_registered',!rel.suisa_registered)}>{rel.suisa_registered?'✓':''}</button>
                  <span class="r-ck-label {rel.suisa_registered?'done':''}">SUISA registered</span>
                </div>
                <textarea class="r-ta" placeholder="Agreement notes, deal details..."
                  value={rel.agreement_notes||''}
                  oninput={e=>update(rel,'agreement_notes',e.target.value)}></textarea>
              </div>
            </div>

            <!-- RELEASE DATE -->
            <div class="rel-section">
              <div class="rel-sec-title">RELEASE DATE</div>
              <div class="rel-field-row">
                <label>DATE</label>
                <input class="r-inp" type="date" value={rel.release_date||''}
                  onchange={e => updateReleaseDate(rel, e.target.value)} />
                {#if rel.release_date}
                  <button class="r-sync-btn" onclick={() => updateReleaseDate(rel, rel.release_date)} title="Re-sync to calendar">↻</button>
                  <span class="r-date-hint">RELEASE: {[rel.artist, rel.song_title].filter(Boolean).join('_')}</span>
                {/if}
              </div>
            </div>

            <!-- CONTACT & MONEY -->
            <div class="rel-section">
              <div class="rel-sec-title">CONTACT & MONEY</div>
              <div class="rel-section-row" style="gap:16px">
                <div class="rel-col">
                  <div class="rel-field-row">
                    <label>CONTACT</label>
                    <input class="r-inp" value={rel.contact_name||''} placeholder="Name..." onchange={e=>update(rel,'contact_name',e.target.value)} />
                  </div>
                  <div class="rel-field-row">
                    <label>EMAIL</label>
                    <input class="r-inp" value={rel.contact_email||''} placeholder="email@..." onchange={e=>update(rel,'contact_email',e.target.value)} />
                  </div>
                  <div class="rel-field-row">
                    <label>SPLIT</label>
                    <input class="r-inp" value={rel.split_pct||''} placeholder="e.g. 30% / CHF 500" onchange={e=>update(rel,'split_pct',e.target.value)} />
                  </div>
                </div>
                <div class="rel-col" style="gap:6px">
                  <!-- Work log dropdown -->
                  <button class="work-log-toggle" onclick={() => loadWorkLog(rel)}>
                    <span>WORK LOG {rel.song_code||''}</span>
                    <span class="work-log-hint">⌘C to copy</span>
                    <span class="work-log-arr {logOpen[rel.id]?'open':''}">▶</span>
                  </button>
                  {#if logOpen[rel.id]}
                    {#if workLogs[rel.id]?.loading}
                      <div class="work-log-loading">Loading...</div>
                    {:else}
                      {@const entries = workLogs[rel.id]?.entries || []}
                      {@const stageLabels = { production:'PROD', mix_prep:'MIX PREP', mixing:'MIX', mastering:'MASTER', stems:'STEMS' }}
                      {@const totalSec = entries.reduce((s,e) => s+(e.seconds||0), 0)}
                      <div class="work-log-panel" onkeydown={e => { if ((e.metaKey||e.ctrlKey) && e.key==='c') copyWorkLog(rel) }} tabindex="0">
                        {#if entries.length}
                          {#each entries as e}
                            <div class="work-log-row">
                              <span class="wl-date">{e.date||''}</span>
                              <span class="wl-stage">{stageLabels[e.stage]||e.stage||''}</span>
                              <span class="wl-time">{formatMinSec(e.seconds||0)}</span>
                            </div>
                          {/each}
                          <div class="work-log-total">TOTAL: {formatMinSec(totalSec)}</div>
                          <button class="work-log-copy-btn" onclick={() => copyWorkLog(rel)}>⌘C Copy</button>
                        {:else}
                          <div class="work-log-empty">No work sessions logged yet.</div>
                        {/if}
                      </div>
                    {/if}
                  {/if}

                  <!-- Invoice + Payment -->
                  <div class="rel-check-row" style="margin-top:8px">
                    <button class="r-ckb {rel.invoice_sent?'on':''}" onclick={() => toggleInvoiceSent(rel)}>{rel.invoice_sent?'✓':''}</button>
                    <span class="r-ck-label {rel.invoice_sent?'done':''}">Invoice sent</span>
                  </div>
                  <div class="rel-check-row">
                    <button class="r-ckb {rel.payment_received?'on':''}" onclick={() => togglePaymentReceived(rel)}>{rel.payment_received?'✓':''}</button>
                    <span class="r-ck-label {rel.payment_received?'done':''}">Payment received</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- STREAMS -->
            <div class="rel-section">
              <div class="rel-sec-title">STREAM LOG</div>
              <div class="stream-entries">
                {#each latestStreams(rel) as entry}
                  <div class="stream-row">
                    <span class="s-date">{entry.date}</span>
                    <span class="s-count">{parseInt(entry.count).toLocaleString()}</span>
                    {#if entry.notes}<span class="s-notes">{entry.notes}</span>{/if}
                    <button class="r-del" onclick={() => deleteStreamEntry(rel, (rel.stream_log||[]).indexOf(entry))}>×</button>
                  </div>
                {/each}
              </div>
              <div class="r-add-row">
                <input class="r-inp r-inp-sm" type="date"
                  value={streamInputs[rel.id]?.date||''}
                  onchange={e => { if (!streamInputs[rel.id]) streamInputs[rel.id]={};streamInputs[rel.id].date=e.target.value;streamInputs={...streamInputs} }} />
                <input class="r-inp" placeholder="Stream count..." style="width:130px"
                  value={streamInputs[rel.id]?.count||''}
                  oninput={e => { if (!streamInputs[rel.id]) streamInputs[rel.id]={};streamInputs[rel.id].count=e.target.value;streamInputs={...streamInputs} }} />
                <input class="r-inp" placeholder="Notes (optional)..." style="flex:1"
                  value={streamInputs[rel.id]?.notes||''}
                  oninput={e => { if (!streamInputs[rel.id]) streamInputs[rel.id]={};streamInputs[rel.id].notes=e.target.value;streamInputs={...streamInputs} }} />
                <button class="r-add-btn" onclick={() => addStreamEntry(rel)}>+ Add</button>
              </div>
            </div>

            <!-- NOTES -->
            <div class="rel-section">
              <div class="rel-sec-title">NOTES</div>
              <textarea class="r-ta r-ta-lg" placeholder="General release notes, links, ISRC, distributor info..."
                value={rel.notes||''}
                oninput={e => update(rel,'notes',e.target.value)}></textarea>
            </div>

            <!-- FOOTER -->
            <div class="rel-footer">
              <button class="r-btn-ghost" onclick={() => scheduleQuarterlyChecks(rel)}>⏱ Schedule quarterly checks (8×)</button>
              {#if rel.quarterly_check_dates?.length}
                <span class="r-qc-info">{rel.quarterly_check_dates.length} checks scheduled</span>
              {/if}
              <div class="r-footer-right">
                <button class="r-btn-danger" onclick={() => deleteRelease(rel)}>Delete</button>
              </div>
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
  .release-layout { max-width: 1100px; padding: 24px 32px; }
  .release-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; }
  .release-title { font-family: 'Space Mono', monospace; font-size: 17px; font-weight: 700; color: #c9a84c; }
  .release-count { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; }
  .empty-state { padding: 40px 0; color: #444; font-size: 14px; font-family: 'DM Sans', sans-serif; }
  .empty { color: #444; padding: 40px 32px; font-size: 14px; }
  .release-list { display: flex; flex-direction: column; gap: 2px; }

  .rel-card { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .rel-card.open { border-color: #2a2a2a; }
  .rel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #111; cursor: pointer; gap: 12px; }
  .rel-head:hover { background: #161616; }
  .rel-head-left { display: flex; align-items: center; gap: 12px; }
  .rel-head-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .rel-code { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex-shrink: 0; }
  .rel-titles { display: flex; flex-direction: column; gap: 1px; }
  .rel-title-song { font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 400; color: #f5f1ea; }
  .rel-artist { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; }
  .rel-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; margin-right: 4px; }

  .rel-badge { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 2px; }
  .rel-badge.gold { background: rgba(201,168,76,.1); border: 1px solid rgba(201,168,76,.4); color: #c9a84c; }
  .rel-badge.red { background: rgba(224,90,74,.08); border: 1px solid rgba(224,90,74,.35); color: #e05a4a; }
  .rel-badge.dim { background: transparent; border: 1px solid #252525; color: #333; }

  .rel-arr { font-size: 9px; color: #333; transition: transform .15s; margin-left: 4px; }
  .rel-arr.open { transform: rotate(90deg); }

  .rel-body { background: #0d0d0d; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
  .rel-section-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .rel-col { display: flex; flex-direction: column; gap: 6px; }
  .rel-section { display: flex; flex-direction: column; gap: 8px; }
  .rel-sec-title { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-bottom: 2px; padding-bottom: 4px; border-bottom: 1px solid #1a1a1a; }
  .rel-field-row { display: flex; align-items: center; gap: 8px; }
  .rel-field-row label { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; width: 80px; flex-shrink: 0; }
  .r-date-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.5); white-space: nowrap; }
  .r-sync-btn { font-family: 'Space Mono', monospace; font-size: 13px; padding: 1px 6px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .r-sync-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }

  .r-inp { background: #0a0a0a; border: 1px solid #1c1c1c; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 3px 7px; outline: none; border-radius: 2px; width: 100%; flex: 1; }
  .r-inp:focus { border-color: rgba(201,168,76,.4); }
  .r-inp-sm { width: 130px !important; flex: none !important; flex-shrink: 0; }
  .r-spotify-row { display: flex; align-items: center; gap: 6px; flex: 1; }
  .r-spotidown { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .r-spotidown:hover { border-color: #c9a84c; color: #c9a84c; }
  .r-play { font-size: 10px; padding: 2px 8px; background: rgba(30,215,96,.08); border: 1px solid rgba(30,215,96,.4); color: #1ed760; border-radius: 2px; cursor: pointer; font-family: 'Space Mono', monospace; font-weight: 700; }
  .r-spotify-link { font-size: 11px; color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .rel-check-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .r-ckb { width: 15px; height: 15px; border: 1px solid #303030; border-radius: 2px; background: transparent; cursor: pointer; font-size: 10px; color: #4caf82; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; }
  .r-ckb.on { background: rgba(76,175,130,.12); border-color: #4caf82; }
  .r-ck-label { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex: 1; }
  .r-ck-label.done { color: #9e9690; }

  .work-log-toggle { display: flex; align-items: center; gap: 8px; width: 100%; background: #111; border: 1px solid #1c1c1c; border-radius: 3px; padding: 6px 10px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.6); font-weight: 700; letter-spacing: .08em; }
  .work-log-toggle:hover { border-color: rgba(201,168,76,.3); }
  .work-log-hint { font-size: 9px; color: #333; font-weight: 300; margin-left: 4px; }
  .work-log-arr { font-size: 9px; color: #444; transition: transform .15s; margin-left: auto; }
  .work-log-arr.open { transform: rotate(90deg); }
  .work-log-panel { background: #0a0a0a; border: 1px solid #1c1c1c; border-radius: 3px; overflow: hidden; outline: none; }
  .work-log-loading { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 8px 10px; }
  .work-log-empty { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; padding: 8px 10px; }
  .work-log-row { display: flex; gap: 12px; padding: 4px 10px; border-bottom: 1px solid #111; }
  .wl-date { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; width: 80px; flex-shrink: 0; }
  .wl-stage { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; width: 70px; flex-shrink: 0; }
  .wl-time { font-family: 'Space Mono', monospace; font-size: 10px; color: #c9a84c; }
  .work-log-total { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; padding: 4px 10px; border-top: 1px solid #1c1c1c; }
  .work-log-copy-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 10px; background: transparent; border: none; border-top: 1px solid #111; color: #444; cursor: pointer; width: 100%; text-align: left; }
  .work-log-copy-btn:hover { color: #c9a84c; }

  .r-ta { background: #0a0a0a; border: 1px solid #1c1c1c; color: #9e9690; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; line-height: 1.7; padding: 8px 10px; outline: none; border-radius: 3px; width: 100%; resize: vertical; min-height: 60px; margin-top: 4px; box-sizing: border-box; }
  .r-ta:focus { border-color: #252525; }
  .r-ta-lg { min-height: 100px; }

  .stream-entries { display: flex; flex-direction: column; gap: 2px; }
  .stream-row { display: flex; align-items: center; gap: 10px; padding: 4px 8px; background: #111; border-radius: 2px; }
  .s-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; width: 90px; flex-shrink: 0; }
  .s-count { font-family: 'Space Mono', monospace; font-size: 12px; color: #cec9c1; width: 100px; flex-shrink: 0; }
  .s-notes { font-size: 12px; color: #555; flex: 1; }
  .r-del { background: transparent; border: none; color: #333; cursor: pointer; font-size: 13px; padding: 0 4px; }
  .r-del:hover { color: #e05a4a; }

  .r-add-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  .r-add-btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 4px 10px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .r-add-btn:hover { border-color: #c9a84c; color: #c9a84c; }

  .rel-footer { display: flex; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid #1a1a1a; }
  .r-btn-ghost { font-family: 'Space Mono', monospace; font-size: 11px; padding: 5px 12px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; }
  .r-btn-ghost:hover { border-color: #c9a84c; color: #c9a84c; }
  .r-qc-info { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; }
  .r-footer-right { margin-left: auto; }
  .r-btn-danger { font-family: 'Space Mono', monospace; font-size: 11px; padding: 4px 10px; background: transparent; border: 1px solid rgba(224,90,74,.3); color: rgba(224,90,74,.6); border-radius: 2px; cursor: pointer; }
  .r-btn-danger:hover { border-color: #e05a4a; color: #e05a4a; }
</style>