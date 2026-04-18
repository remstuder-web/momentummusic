<script>
  import { supabase } from '$lib/supabase.js'
  import DailyTab from '$lib/DailyTab.svelte'
  import DemoTab from '$lib/DemoTab.svelte'
  import ProjectsTab from '$lib/ProjectsTab.svelte'
  import ConnectionsTab from '$lib/ConnectionsTab.svelte'
  import FinancesTab from '$lib/FinancesTab.svelte'
  import NotesTab from '$lib/NotesTab.svelte'
  import ReleaseTab from '$lib/ReleaseTab.svelte'
  import BrainTab from '$lib/BrainTab.svelte'

  let activeTab = $state('daily')
  let showSettings = $state(false)
  let showCosts = $state(false)
  let watcherStatus = $state(null) // null=checking, true=running, false=stopped
  let apiKeyInput = $state('')
  let apiKeySaved = $state(false)
  let openaiKeyInput = $state('')
  let openaiKeySaved = $state(false)

  // Goals
  let goals = $state([])
  let showGoals = $state(false)
  let newGoalTitle = $state('')
  let newGoalDeadline = $state('')
  let newGoalTarget = $state('')
  let newGoalUnit = $state('songs')

  const tabs = [
    { id: 'daily',       label: 'DAILY' },
    { id: 'demo',        label: 'DEMO' },
    { id: 'submissions', label: 'SUBMISSIONS' },
    { id: 'projects',    label: 'PROJECTS' },
    { id: 'connections', label: 'CONNECTIONS' },
    { id: 'releases',    label: 'RELEASES' },
    { id: 'finances',    label: 'FINANCES' },
    { id: 'notes',       label: 'NOTES' },
    { id: 'brain',       label: 'BRAIN' },
  ]

  async function loadApiKey() {
    try {
      const r = await fetch('http://localhost:4242/get-env-keys')
      if (r.ok) {
        const d = await r.json()
        // Cache raw keys in localStorage so all tabs can read them inline
        if (d.ANTHROPIC_API_KEY_RAW) {
          localStorage.setItem('mm_api_key', d.ANTHROPIC_API_KEY_RAW)
          apiKeyInput = d.ANTHROPIC_API_KEY || '' // show masked in settings
        } else {
          apiKeyInput = localStorage.getItem('mm_api_key') || ''
        }
        if (d.OPENAI_API_KEY_RAW) {
          localStorage.setItem('mm_openai_key', d.OPENAI_API_KEY_RAW)
          openaiKeyInput = d.OPENAI_API_KEY || '' // show masked in settings
        } else {
          openaiKeyInput = localStorage.getItem('mm_openai_key') || ''
        }
        return
      }
    } catch(e) {}
    // Watcher not running — fall back to localStorage cache
    try { apiKeyInput = localStorage.getItem('mm_api_key') || '' } catch(e) {}
    try { openaiKeyInput = localStorage.getItem('mm_openai_key') || '' } catch(e) {}
  }

  async function saveOpenaiKey() {
    if (openaiKeyInput.includes('•')) return // masked display value — not a real key
    try {
      await fetch('http://localhost:4242/save-env-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'OPENAI_API_KEY', value: openaiKeyInput })
      })
      localStorage.setItem('mm_openai_key', openaiKeyInput)
    } catch(e) { localStorage.setItem('mm_openai_key', openaiKeyInput) }
    openaiKeySaved = true
    setTimeout(() => openaiKeySaved = false, 2000)
  }

  async function loadGoals() {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/brain_knowledge?active=eq.true&category=eq.goal&select=id,title,content&order=created_at.desc`, {
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
      })
      goals = r.ok ? (await r.json()) : []
    } catch(e) { goals = [] }
  }

  async function addGoal() {
    if (!newGoalTitle.trim()) return
    const content = JSON.stringify({ target: newGoalTarget, unit: newGoalUnit, deadline: newGoalDeadline })
    try {
      await fetch(`${SB_URL}/rest/v1/brain_knowledge`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ category: 'goal', title: newGoalTitle.trim(), content, active: true })
      })
      newGoalTitle = ''; newGoalDeadline = ''; newGoalTarget = ''; newGoalUnit = 'songs'
      await loadGoals()
    } catch(e) {}
  }

  async function completeGoal(id) {
    try {
      await fetch(`${SB_URL}/rest/v1/brain_knowledge?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ active: false })
      })
      await loadGoals()
    } catch(e) {}
  }

  async function saveApiKey() {
    if (apiKeyInput.includes('•')) return // masked display value — not a real key
    try {
      await fetch('http://localhost:4242/save-env-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ANTHROPIC_API_KEY', value: apiKeyInput })
      })
      localStorage.setItem('mm_api_key', apiKeyInput)
    } catch(e) { localStorage.setItem('mm_api_key', apiKeyInput) }
    apiKeySaved = true
    setTimeout(() => apiKeySaved = false, 2000)
  }

  async function clearApiKey() {
    try {
      await fetch('http://localhost:4242/save-env-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ANTHROPIC_API_KEY', value: '' })
      })
    } catch(e) {}
    localStorage.removeItem('mm_api_key')
    apiKeyInput = ''
  }

  // Tasks — persisted to TASKS.md via watcher
  let tasksContent = $state('')
  let tasksSaved = $state(false)
  let tasksLastSaved = $state('')
  let recentChanges = $state([])
  let errorLog = $state([])
  let showErrorLog = $state(false)

  async function loadTasks() {
    try {
      const r = await fetch('http://localhost:4242/get-tasks')
      if (r.ok) {
        const d = await r.json()
        tasksContent = d.content || ''
        if (d.lastModified) tasksLastSaved = new Date(d.lastModified).toLocaleTimeString()
      }
    } catch(e) {}
  }

  async function saveTasks() {
    try {
      const r = await fetch('http://localhost:4242/save-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tasksContent })
      })
      if (r.ok) {
        tasksSaved = true
        tasksLastSaved = new Date().toLocaleTimeString()
        setTimeout(() => tasksSaved = false, 2000)
      }
    } catch(e) {}
  }

  function clearDoneTasks() {
    tasksContent = tasksContent.split('\n').filter(l => !l.match(/^\s*-\s*\[x\]/i)).join('\n')
    saveTasks()
  }

  async function loadChanges() {
    try {
      const r = await fetch('http://localhost:4242/get-changes')
      if (r.ok) { const d = await r.json(); recentChanges = d.lines || [] }
    } catch(e) {}
  }

  async function loadErrors() {
    try {
      const r = await fetch('http://localhost:4242/logs')
      if (r.ok) { const d = await r.json(); errorLog = d.errors || [] }
    } catch(e) {}
  }

  loadApiKey()
  loadTasks()

  // ── Usage tracking (Supabase only) ───────────────────────────────────────
  const SB_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
  const SB_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'

  let agentUsageRows = $state([])
  let agentUsageLoading = $state(false)
  const todayISO = new Date().toISOString().slice(0, 10)

  async function loadUsageData() {
    agentUsageLoading = true
    try {
      const firstOfMonth = new Date().toISOString().slice(0, 7) + '-01'
      const r = await fetch(
        `${SB_URL}/rest/v1/api_usage?select=created_at,endpoint,cost_usd,input_tokens,output_tokens&created_at=gte.${firstOfMonth}&order=cost_usd.desc`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      )
      agentUsageRows = r.ok ? (await r.json()) : []
    } catch(e) { agentUsageRows = [] }
    agentUsageLoading = false
  }

  let agentUsage = $derived.by(() => {
    const today = agentUsageRows
      .filter(r => (r.created_at || '').slice(0, 10) === todayISO)
      .reduce((s, r) => s + (r.cost_usd || 0), 0)
    const month = agentUsageRows.reduce((s, r) => s + (r.cost_usd || 0), 0)
    const byEndpoint = {}
    for (const r of agentUsageRows) {
      const ep = r.endpoint || 'unknown'
      byEndpoint[ep] = (byEndpoint[ep] || 0) + (r.cost_usd || 0)
    }
    const breakdown = Object.entries(byEndpoint)
      .map(([endpoint, cost]) => ({ endpoint, cost }))
      .sort((a, b) => b.cost - a.cost)
    return { today, month, breakdown }
  })

  $effect(() => {
    if (showCosts) loadUsageData()
  })

  async function checkWatcher() {
    watcherStatus = null
    try {
      const r = await fetch('http://localhost:4242/ping', { signal: AbortSignal.timeout(2000) })
      watcherStatus = r.ok
    } catch { watcherStatus = false }
  }

  async function stopWatcher() {
    try {
      await fetch('http://localhost:4242/watcher-stop', { method: 'POST' })
      watcherStatus = false
    } catch { watcherStatus = false }
  }

  $effect(() => {
    if (showSettings) { loadTasks(); loadChanges(); loadErrors(); loadGoals(); checkWatcher() }
  })
</script>

<div class="app">
  <nav>
    {#each tabs as tab}
      <button
        class="tab {activeTab === tab.id ? 'active' : ''}"
        onclick={() => activeTab = tab.id}
      >
        {tab.label}
      </button>
    {/each}
    <a class="pizza-btn" href="https://www.just-eat.ch/speisekarte/central-pizza-kebap#pre-order" target="_blank" title="Central Pizza Kebap">🍕</a>
    <button class="cost-btn" onclick={() => showCosts = !showCosts} title="API costs">$</button>
    <button class="settings-btn" onclick={() => showSettings = !showSettings}>⚙</button>
  </nav>

  {#if showCosts}
    <div class="settings-overlay" onclick={() => showCosts = false}>
      <div class="cost-panel" onclick={e => e.stopPropagation()}>
        <div class="settings-title">API COSTS — {new Date().toISOString().slice(0,7)}</div>

        <div class="usage-section-label">TODAY</div>
        <div class="usage-row total">
          <span class="usage-label">TOTAL TODAY</span>
          <span class="usage-cost">${agentUsage.today.toFixed(4)}</span>
        </div>

        <div class="usage-section-label" style="margin-top:14px">THIS MONTH</div>
        <div class="usage-row total">
          <span class="usage-label">TOTAL MONTH</span>
          <span class="usage-cost">${agentUsage.month.toFixed(4)}</span>
        </div>

        {#if agentUsage.breakdown.length}
          <div class="usage-section-label" style="margin-top:14px">BY ENDPOINT (THIS MONTH)</div>
          {#each agentUsage.breakdown.slice(0,10) as item}
            <div class="usage-row">
              <span class="usage-label" style="font-size:8px;color:#555">{item.endpoint.replace('/','').replace(/-/g,' ')}</span>
              <span class="usage-cost" style="font-size:9px;color:#666">${item.cost.toFixed(4)}</span>
            </div>
          {/each}
        {/if}

        <div class="cost-footer">
          <span class="settings-hint">Haiku $1/$5 · Sonnet $3/$15 per MTok</span>
          {#if agentUsageLoading}
            <span class="settings-hint">loading…</span>
          {:else}
            <button class="settings-clear" onclick={loadUsageData}>↻</button>
          {/if}
        </div>
        <button class="settings-close" style="margin-top:4px" onclick={() => showCosts = false}>Close</button>
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div class="settings-overlay" onclick={() => showSettings = false}>
      <div class="settings-panel" onclick={e => e.stopPropagation()}>
        <div class="settings-title">SETTINGS</div>
        <div class="settings-field">
          <label>ANTHROPIC API KEY</label>
          <div class="settings-row">
            <input
              class="settings-inp"
              type="password"
              bind:value={apiKeyInput}
              placeholder={apiKeyInput ? 'key set — type to replace' : 'sk-ant-api03-...'}
              onkeydown={e => e.key === 'Enter' && saveApiKey()}
              onfocus={() => { if (apiKeyInput.includes('•')) apiKeyInput = '' }}
            />
            <button class="settings-save" onclick={saveApiKey}>
              {apiKeySaved ? 'Saved ✓' : 'Save'}
            </button>
            <button class="settings-clear" onclick={clearApiKey}>Clear</button>
          </div>
          <p class="settings-hint">Used for Mozart AI and Claude tag generation across all tabs. Saved to .env.</p>
        </div>
        <div class="settings-field">
          <label>OPENAI API KEY</label>
          <div class="settings-row">
            <input
              class="settings-inp"
              type="password"
              bind:value={openaiKeyInput}
              placeholder={openaiKeyInput ? 'key set — type to replace' : 'sk-...'}
              onkeydown={e => e.key === 'Enter' && saveOpenaiKey()}
              onfocus={() => { if (openaiKeyInput.includes('•')) openaiKeyInput = '' }}
            />
            <button class="settings-save" onclick={saveOpenaiKey}>
              {openaiKeySaved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <p class="settings-hint">Used for TTS voice playback (▶ on inbox items). Saved to .env.</p>
        </div>
        <div class="settings-field">
          <button class="error-log-toggle" onclick={() => showGoals = !showGoals}>
            ACTIVE GOALS ({goals.length}) {showGoals ? '▲' : '▼'}
          </button>
          {#if showGoals}
            {#each goals as g (g.id)}
              <div class="goal-row">
                <span class="goal-title">{g.title}</span>
                {#if g.content}
                  {@const parsed = (() => { try { return JSON.parse(g.content) } catch { return null } })()}
                  {#if parsed?.target}
                    <span class="goal-meta">{parsed.target} {parsed.unit}{parsed.deadline ? ' · ' + parsed.deadline : ''}</span>
                  {/if}
                {/if}
                <button class="goal-done-btn" onclick={() => completeGoal(g.id)}>✓</button>
              </div>
            {/each}
            <div class="goal-add-row">
              <input class="goal-inp" bind:value={newGoalTitle} placeholder="Goal title..." />
              <input class="goal-inp goal-inp-sm" bind:value={newGoalTarget} placeholder="Target" type="number" />
              <select class="goal-unit-sel" bind:value={newGoalUnit}>
                <option>songs</option><option>demos</option><option>euros</option><option>releases</option>
              </select>
              <input class="goal-inp goal-inp-sm" bind:value={newGoalDeadline} type="date" />
              <button class="settings-save" onclick={addGoal}>Add</button>
            </div>
          {/if}
        </div>
        <div class="settings-field">
          <div class="usage-header-row">
            <label>CLAUDE CODE TASKS</label>
            {#if tasksLastSaved}
              <span class="tasks-saved-time">{tasksLastSaved}</span>
            {/if}
          </div>
          <textarea
            class="tasks-inp"
            bind:value={tasksContent}
            placeholder="- [ ] Task to do&#10;- [x] Done task"
            rows="8"
          ></textarea>
          <div class="tasks-actions">
            <button class="settings-save" onclick={saveTasks}>
              {tasksSaved ? 'Saved ✓' : 'Save to TASKS.md'}
            </button>
            <button class="settings-save" style="background:rgba(201,168,76,.15);color:#c9a84c;" onclick={async () => {
              await saveTasks()
              try { await fetch('http://localhost:4242/launch-claude-code', { method: 'POST' }) }
              catch(e) { alert('Watcher not running') }
            }}>▶ Save & Launch</button>
            <button class="settings-clear" onclick={clearDoneTasks}>Clear done</button>
            <button class="settings-clear" onclick={async () => {
              if (!confirm('Run Claude Code overnight autonomously?')) return
              await saveTasks()
              fetch('http://localhost:4242/launch-claude-overnight', { method: 'POST' })
            }}>⚡ Overnight</button>
          </div>
        </div>
        {#if recentChanges.length}
          <div class="settings-field">
            <label>RECENT CHANGES</label>
            <pre class="changes-log">{recentChanges.join('\n')}</pre>
          </div>
        {/if}
        <div class="settings-field">
          <button class="error-log-toggle" onclick={() => showErrorLog = !showErrorLog}>
            WATCHER ERRORS {errorLog.length ? `(${errorLog.length})` : '(0)'} {showErrorLog ? '▲' : '▼'}
          </button>
          {#if showErrorLog}
            {#if errorLog.length}
              <pre class="changes-log">{errorLog.map(e => `${e.time} · ${e.endpoint} · ${e.message}`).join('\n')}</pre>
            {:else}
              <pre class="changes-log" style="color:#444">no errors</pre>
            {/if}
          {/if}
        </div>
        <div class="settings-field">
          <label>WATCHER</label>
          <div class="watcher-status-row">
            {#if watcherStatus === null}
              <span class="watcher-dot" style="background:#555"></span>
              <span class="watcher-label">Checking…</span>
            {:else if watcherStatus}
              <span class="watcher-dot" style="background:#4caf82"></span>
              <span class="watcher-label">Watcher running</span>
              <button class="settings-clear" onclick={stopWatcher}>Stop</button>
            {:else}
              <span class="watcher-dot" style="background:#e74c3c"></span>
              <span class="watcher-label">Watcher stopped</span>
            {/if}
          </div>
          {#if watcherStatus === false}
            <p class="settings-hint" style="color:#e74c3c">Run <code>pm2 start momentum-watcher</code> in terminal to restart</p>
          {/if}
        </div>
        <button class="settings-close" onclick={() => showSettings = false}>Close</button>
      </div>
    </div>
  {/if}

  <main>
    {#if activeTab === 'daily'}
      <DailyTab />
    {:else if activeTab === 'demo'}
      <DemoTab initialView="demos" />
    {:else if activeTab === 'submissions'}
      <DemoTab initialView="patches" />
    {:else if activeTab === 'projects'}
      <ProjectsTab />
    {:else if activeTab === 'connections'}
      <ConnectionsTab />
    {:else if activeTab === 'releases'}
      <ReleaseTab />
    {:else if activeTab === 'finances'}
      <FinancesTab />
    {:else if activeTab === 'notes'}
      <NotesTab />
    {:else if activeTab === 'brain'}
      <BrainTab />
    {/if}
  </main>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: #0a0a0a; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-weight: 300; min-height: 100vh; }

  .app { display: flex; flex-direction: column; min-height: 100vh; }

  nav {
    display: flex;
    background: #0a0a0a;
    border-bottom: 1px solid #222;
    position: sticky;
    top: 0;
    z-index: 99;
    overflow-x: auto;
    align-items: center;
  }

  .tab {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
    padding: 15px 22px;
    cursor: pointer;
    color: #a09a94;
    border: none;
    border-bottom: 3px solid transparent;
    background: transparent;
    white-space: nowrap;
    transition: all .2s;
  }

  .tab:hover { color: #c9a84c; }
  .tab.active { color: #c9a84c; border-bottom-color: #c9a84c; }

  main { flex: 1; padding: 24px 32px; }

  .settings-btn { font-family: 'Space Mono', monospace; font-size: 16px; padding: 10px 14px; background: transparent; border: none; color: #555; cursor: pointer; flex-shrink: 0; }
  .settings-btn:hover { color: #c9a84c; }
  .pizza-btn { font-size: 18px; padding: 6px 10px; text-decoration: none; flex-shrink: 0; cursor: pointer; opacity: .7; transition: opacity .2s; }
  .pizza-btn:hover { opacity: 1; }
  .cost-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 4px 8px; background: transparent; border: 1px solid #252525; color: #444; cursor: pointer; border-radius: 2px; transition: all .15s; flex-shrink: 0; margin-left: auto; }
  .cost-btn:hover { color: #4caf82; border-color: #4caf82; }

  .settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 9999; display: flex; align-items: center; justify-content: center; }
  .settings-panel { background: #1c1c1c; border: 1px solid #303030; border-radius: 6px; padding: 28px; width: 460px; display: flex; flex-direction: column; gap: 20px; }
  .cost-panel { background: #1c1c1c; border: 1px solid #303030; border-radius: 6px; padding: 24px; width: 320px; display: flex; flex-direction: column; gap: 6px; }
  .settings-title { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; letter-spacing: .14em; color: #c9a84c; }
  .settings-field { display: flex; flex-direction: column; gap: 8px; }
  .settings-field label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; color: #9e9690; }
  .watcher-status-row { display: flex; align-items: center; gap: 8px; }
  .watcher-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .watcher-label { font-family: 'Space Mono', monospace; font-size: 11px; color: #cec9c1; }
  .settings-row { display: flex; gap: 6px; }
  .settings-inp { flex: 1; background: #0a0a0a; border: 1px solid #303030; color: #f5f1ea; font-family: 'Space Mono', monospace; font-size: 13px; padding: 8px 12px; outline: none; border-radius: 3px; }
  .settings-inp:focus { border-color: rgba(201,168,76,.5); }
  .settings-save { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 8px 14px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  .settings-clear { font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px 12px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 3px; cursor: pointer; }
  .settings-clear:hover { border-color: #e05a4a; color: #e05a4a; }
  .settings-hint { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; line-height: 1.6; }
  .settings-close { font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px 14px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 3px; cursor: pointer; align-self: flex-end; }
  .settings-close:hover { color: #9e9690; }

  .usage-header-row { display: flex; align-items: center; justify-content: space-between; }
  .usage-header-row label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; color: #9e9690; }
  .tasks-inp { width: 100%; background: #0a0a0a; border: 1px solid #303030; color: #f5f1ea; font-family: 'Space Mono', monospace; font-size: 11px; line-height: 1.7; padding: 10px 12px; outline: none; border-radius: 3px; resize: vertical; }
  .tasks-inp:focus { border-color: rgba(201,168,76,.5); }
  .tasks-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .tasks-saved-time { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; }
  .changes-log { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; background: #0a0a0a; border: 1px solid #1c1c1c; border-radius: 3px; padding: 10px 12px; max-height: 160px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; line-height: 1.6; margin: 0; }
  .error-log-toggle { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.6); background: transparent; border: none; padding: 0; cursor: pointer; text-transform: uppercase; }
  .goal-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #1c1c1c; }
  .goal-title { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; flex: 1; }
  .goal-meta { font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.5); white-space: nowrap; }
  .goal-done-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 7px; background: transparent; border: 1px solid #303030; color: #4caf82; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .goal-done-btn:hover { background: rgba(76,175,130,.08); }
  .goal-add-row { display: flex; gap: 5px; margin-top: 8px; flex-wrap: wrap; }
  .goal-inp { background: #0a0a0a; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 6px 8px; outline: none; border-radius: 3px; flex: 1; min-width: 0; }
  .goal-inp:focus { border-color: rgba(201,168,76,.4); }
  .goal-inp-sm { flex: 0 0 90px; }
  .goal-unit-sel { background: #0a0a0a; border: 1px solid #303030; color: #9e9690; font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 4px; outline: none; border-radius: 3px; flex: 0 0 80px; }

  /* Cost panel */
  .usage-section-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.5); text-transform: uppercase; margin-top: 8px; }
  .usage-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
  .usage-row.total { border-top: 1px solid #252525; margin-top: 4px; padding-top: 6px; }
  .usage-row.total .usage-label { color: #c9a84c; font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; }
  .usage-row.total .usage-cost { color: #c9a84c; font-weight: 700; font-size: 13px; }
  .usage-label { font-family: 'Space Mono', monospace; font-size: 10px; color: #666; }
  .usage-cost { font-family: 'Space Mono', monospace; font-size: 11px; color: #cec9c1; }
  .cost-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .cost-footer .settings-hint { flex: 1; }
</style>
