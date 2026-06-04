<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext } from './mozartContext.js'
  import { onMount } from 'svelte'

  // ── Phantom status (from Supabase) ────────────────────────────────────────
  let phantomStatus = $state(null)
  let phantomBrief  = $state(null)

  async function loadPhantomBrief() {
    const { data } = await supabase
      .from('phantom_brief')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    phantomBrief = data || null
  }

  async function dismissBrief() {
    await supabase.from('phantom_brief').update({ dismissed: true }).eq('id', 1)
    if (phantomBrief) phantomBrief = { ...phantomBrief, dismissed: true }
  }

  async function loadPhantomStatus() {
    const { data } = await supabase
      .from('phantom_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    phantomStatus = data || null
  }

  // ── Supabase trades + signals ──────────────────────────────────────────────
  let recentTrades  = $state([])
  let recentSignals = $state([])
  let tradesLoading = $state(false)

  let closedTrades = $derived(recentTrades.filter(t => t.result !== 'OPEN'))
  let openTrades   = $derived(recentTrades.filter(t => t.result === 'OPEN'))
  let totalPnl     = $derived(closedTrades.reduce((s,t) => s + (t.pnl_usd||0), 0))
  let winRate = $derived(closedTrades.length
    ? Math.round(closedTrades.filter(t => t.result==='WIN').length / closedTrades.length * 100)
    : 0)

  // Bot is running if a trade opened recently OR phantom_status was ticked within last 5 min
  let botRunning = $derived(
    recentTrades.some(t => (Date.now() - new Date(t.opened_at).getTime()) < 10 * 60 * 1000) ||
    (!!phantomStatus?.updated_at && (Date.now() - new Date(phantomStatus.updated_at).getTime()) < 5 * 60 * 1000)
  )
  // Supabase writes failing — bot is deployed but status row is absent
  let botSyncing = $derived(!phantomStatus && !botRunning)

  // ── Live feed ──────────────────────────────────────────────────────────────
  let liveFeed = $derived(() => {
    const events = []
    for (const t of recentTrades.slice(0, 20)) {
      events.push({
        type:     t.result === 'OPEN' ? 'open' : 'close',
        time:     t.result === 'OPEN' ? t.opened_at : t.closed_at,
        strategy: t.strategy,
        side:     t.side,
        pnl:      t.pnl_usd,
        result:   t.result,
        entry:    t.entry_price,
        size:     t.size_usd,
      })
    }
    for (const s of recentSignals.slice(0, 10)) {
      events.push({
        type:     'signal',
        time:     s.fired_at,
        strategy: s.strategy,
        side:     s.direction,
        acted:    s.acted_on,
        score:    s.score,
      })
    }
    return events.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15)
  })

  function feedTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diff = Math.floor((now - d) / 1000)
    if (diff < 60)    return diff + 's ago'
    if (diff < 3600)  return Math.floor(diff/60) + 'm ago'
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago'
    return d.toLocaleDateString()
  }

  async function loadTrades() {
    tradesLoading = true
    try {
      const [{data: openData}, {data: closedData}, {data: signals}] = await Promise.all([
        supabase.from('phantom_trades').select('*').eq('result', 'OPEN'),
        supabase.from('phantom_trades').select('*').neq('result', 'OPEN')
          .order('opened_at', {ascending: false}).limit(50),
        supabase.from('phantom_signals').select('*')
          .order('fired_at', {ascending: false}).limit(20),
      ])
      // Open trades first so openTrades derived is always accurate for equity calc
      recentTrades = [...(openData || []), ...(closedData || [])]
      recentSignals = signals || []
    } catch(e) { console.error(e) }
    tradesLoading = false
  }

  function formatTime(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleTimeString('de-CH', {hour:'2-digit', minute:'2-digit'})
  }
  function formatDate(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const today = new Date()
    return d.toDateString()===today.toDateString()
      ? `Today ${formatTime(ts)}`
      : d.toLocaleDateString('de-CH', {day:'2-digit', month:'2-digit'}) + ' ' + formatTime(ts)
  }

  // ── Inbox fallback for live feed when trades table is empty ───────────────
  let inboxFallback = $state([])

  async function loadInboxFallback() {
    try {
      const { data } = await supabase
        .from('inbox_notifications')
        .select('id, type, message, song_title, artist, created_at')
        .in('type', ['trade', 'open', 'close', 'signal'])
        .order('created_at', { ascending: false })
        .limit(5)
      inboxFallback = (data || []).filter(n => ['trade','open','close','signal'].includes(n.type))
    } catch(e) { /* silent — this is best-effort */ }
  }

  // ── Cron jobs ──────────────────────────────────────────────────────────────
  const cronJobs = [
    { name: 'PHANTOM Health Monitor', schedule: 'Every 30 min' },
    { name: 'PHANTOM Monday Brief',   schedule: 'Mon 08:00'    },
    { name: 'Auto Validator',         schedule: 'Mon 08:00'    },
    { name: 'Market Audit',           schedule: 'Daily 07:45 UTC' },
    { name: 'Daily Health',           schedule: 'Daily 07:50 UTC' },
    { name: 'Param Optimizer',        schedule: 'Daily 07:55 UTC' },
    { name: 'Weekly Carry Scan',      schedule: 'Sun 22:00 UTC',  source: 'Claude Code' },
  ]

  let cronLogs = $state({})

  async function loadCronLogs() {
    try {
      const names = cronJobs.map(c => c.name)
      const { data } = await supabase
        .from('cron_log')
        .select('cron_name, run_at, status, message')
        .in('cron_name', names)
        .order('run_at', { ascending: false })
        .limit(names.length * 5)
      if (!data) return
      const map = {}
      for (const row of data) {
        if (!map[row.cron_name]) map[row.cron_name] = row
      }
      cronLogs = map
    } catch(e) { /* silent — cron_log may not exist yet */ }
  }

  // ── Trading Dashboard ──────────────────────────────────────────────────────
  let withdrawalGoal     = $state(1000)  // target monthly withdrawal ($) — loaded from Supabase
  const FALLBACK_RATE    = 0.175         // 17.5%/month estimate when no live data

  let allMonthTrades   = $state([])
  let totalCarryIncome = $state(0)
  let carryDaysActive  = $state(1)
  let dashLoading      = $state(false)

  function getMonthStart() {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d.toISOString()
  }

  function buildProjection(equity, rate, goal) {
    if (equity <= 0 || rate <= 0) return []
    const rows = []
    let e = equity
    for (let m = 1; m <= 24; m++) {
      e = e * (1 + rate)
      rows.push({ month: m, equity: e, income: e * rate, reached: e >= goal })
      if (e >= goal) break
    }
    return rows
  }

  async function loadWithdrawalGoal() {
    try {
      const { data } = await supabase
        .from('phantom_settings')
        .select('value')
        .eq('key', 'withdrawal_goal')
        .single()
      if (data?.value) withdrawalGoal = parseFloat(data.value) || 1000
    } catch(e) { /* table may not exist — use default */ }
  }

  async function saveWithdrawalGoal() {
    const val = withdrawalGoal || 1000
    withdrawalGoal = val
    try {
      await supabase
        .from('phantom_settings')
        .upsert({ key: 'withdrawal_goal', value: String(val) }, { onConflict: 'key' })
    } catch(e) { /* silent */ }
  }

  let monthWins    = $derived(allMonthTrades.filter(t => t.result === 'WIN').length)
  let monthLosses  = $derived(allMonthTrades.filter(t => t.result === 'LOSS' || t.result === 'STOPPED').length)
  let monthPnl     = $derived(allMonthTrades.reduce((s,t) => s + (t.pnl_usd||0), 0))
  let monthWinRate = $derived(
    (monthWins + monthLosses) > 0
      ? Math.round(monthWins / (monthWins + monthLosses) * 100)
      : 0
  )
  let monthBestTrade = $derived(
    allMonthTrades.length
      ? allMonthTrades.reduce((b,t) => (t.pnl_usd||0) > (b.pnl_usd||0) ? t : b)
      : null
  )
  let monthWorstTrade = $derived(
    allMonthTrades.length
      ? allMonthTrades.reduce((b,t) => (t.pnl_usd||0) < (b.pnl_usd||0) ? t : b)
      : null
  )
  let freeBalance      = $derived(phantomStatus?.balance ?? 0)
  let inPositions      = $derived(
    phantomStatus?.total_equity != null && phantomStatus?.balance != null
      ? phantomStatus.total_equity - phantomStatus.balance
      : openTrades.reduce((s,t) => s + (t.size_usd||0), 0)
  )
  let currentEquity    = $derived(phantomStatus?.total_equity != null ? phantomStatus.total_equity : freeBalance + inPositions)
  let equitySyncing    = $derived(!phantomStatus || freeBalance === 0)
  let monthCarryIncome = $derived(
    allMonthTrades.filter(t => t.risk_label === 'CARRY').reduce((s,t) => s + (t.pnl_usd||0), 0)
  )
  let monthTotalIncome    = $derived(monthPnl)
  let safeWithdrawal      = $derived(monthTotalIncome > 0 ? monthTotalIncome * 0.5 : 0)
  let withdrawMonthlyRate = $derived(monthPnl > 0 && currentEquity > 0 ? monthPnl / currentEquity : FALLBACK_RATE)
  let usingFallbackRate   = $derived(!(monthPnl > 0 && currentEquity > 0))
  // Capital needed so that income at current rate = withdrawalGoal
  let capitalNeeded       = $derived(
    monthPnl > 0 && currentEquity > 0
      ? (withdrawalGoal / monthPnl) * currentEquity
      : withdrawalGoal / FALLBACK_RATE
  )
  let capitalGap          = $derived(capitalNeeded - currentEquity)
  let withdrawalReached   = $derived(capitalGap <= 0)
  let goalProgressPct     = $derived(capitalNeeded > 0 ? Math.min(100, Math.round(currentEquity / capitalNeeded * 100)) : 0)
  let compoundProjection  = $derived(
    withdrawalReached ? [] : buildProjection(currentEquity, withdrawMonthlyRate, capitalNeeded)
  )
  let dailyAvgCarry       = $derived(carryDaysActive > 0 ? totalCarryIncome / carryDaysActive : 0)

  async function loadDashboard() {
    dashLoading = true
    try {
      const { data: monthTrades } = await supabase
        .from('phantom_trades')
        .select('*')
        .neq('result', 'OPEN')
        .gte('closed_at', getMonthStart())
        .order('closed_at', { ascending: false })
      allMonthTrades = monthTrades || []

      const { data: allCarry } = await supabase
        .from('phantom_trades')
        .select('pnl_usd, closed_at')
        .eq('risk_label', 'CARRY')
        .neq('result', 'OPEN')
        .order('closed_at', { ascending: true })
      if (allCarry && allCarry.length > 0) {
        totalCarryIncome = allCarry.reduce((s,t) => s + (t.pnl_usd||0), 0)
        const firstDate = new Date(allCarry[0].closed_at)
        carryDaysActive = Math.max(1, Math.ceil((Date.now() - firstDate.getTime()) / 86400000))
      } else {
        totalCarryIncome = 0
        carryDaysActive  = 1
      }
    } catch(e) { console.error(e) }
    dashLoading = false
  }

  // ── Deposits ──────────────────────────────────────────────────────────────
  let deposits        = $state([])
  let etDepositOpen   = $state(false)
  let newDepositAmt   = $state('')
  let newDepositNotes = $state('')
  let depositSaving   = $state(false)

  let totalDeposited    = $derived(deposits.reduce((s,d) => s + (parseFloat(d.amount)||0), 0))
  let netPnlVsDeposited = $derived(
    totalDeposited > 0 && phantomStatus?.total_equity != null
      ? phantomStatus.total_equity - totalDeposited
      : null
  )

  async function loadDeposits() {
    const { data } = await supabase
      .from('phantom_deposits')
      .select('*')
      .order('deposited_at', { ascending: false })
    deposits = data || []
  }

  async function addDeposit() {
    const amt = parseFloat(newDepositAmt)
    if (!amt || amt <= 0) return
    depositSaving = true
    const { data, error } = await supabase
      .from('phantom_deposits')
      .insert({ amount: amt, notes: newDepositNotes.trim() || null, deposited_at: new Date().toISOString() })
      .select().single()
    if (!error && data) {
      deposits = [data, ...deposits]
      newDepositAmt = ''; newDepositNotes = ''
    }
    depositSaving = false
  }

  async function deleteDeposit(id) {
    if (!confirm('Remove this deposit entry?')) return
    await supabase.from('phantom_deposits').delete().eq('id', id)
    deposits = deposits.filter(d => d.id !== id)
  }

  // ── Strategy Decisions ────────────────────────────────────────────────────
  let { pendingStrategyCount = $bindable(0) } = $props()

  let strategyDecisions = $state([])
  let strategyLoading   = $state(false)
  let strategyToast     = $state('')

  let pendingDecisions = $derived(strategyDecisions.filter(d => d.status === 'pending'))

  $effect(() => { pendingStrategyCount = pendingDecisions.length })

  async function loadStrategyDecisions() {
    strategyLoading = true
    try {
      const { data } = await supabase
        .from('strategy_decisions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      strategyDecisions = data || []
    } catch(e) { console.error(e) }
    strategyLoading = false
  }

  async function approveDecision(id) {
    await supabase.from('strategy_decisions').update({ status: 'approved' }).eq('id', id)
    strategyDecisions = strategyDecisions.filter(d => d.id !== id)
  }

  async function rejectDecision(id) {
    await supabase.from('strategy_decisions').update({ status: 'rejected' }).eq('id', id)
    strategyDecisions = strategyDecisions.filter(d => d.id !== id)
  }

  function discussDecision(decision) {
    const text = `STRATEGY DECISION: ${decision.title}\n\nSUMMARY: ${decision.summary}\n\nRECOMMENDATION: ${decision.recommendation}`
    navigator.clipboard.writeText(text).then(() => {
      strategyToast = 'Copied to clipboard'
      setTimeout(() => strategyToast = '', 2000)
    })
  }

  // ── Mozart ─────────────────────────────────────────────────────────────────
  let aiMessages = $state([])
  let aiInput    = $state('')
  let aiLoading  = $state(false)
  let sideCollapsed = $state(true)
  let liveFeedOpen   = $state(false)
  let perfTradesOpen = $state(false)
  let perfSignalsOpen = $state(false)

  async function sendAI(rawMsg) {
    const msg = (typeof rawMsg==='string' && rawMsg.trim()) ? rawMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    aiInput = ''; aiMessages = [...aiMessages, {role:'user', content:msg}]; aiLoading = true
    const apiKey = (typeof window !== 'undefined' ? localStorage.getItem('mm_api_key') : null) || ''
    if (!apiKey) {
      aiMessages = [...aiMessages, {role:'assistant', content:'No API key — add in Settings.'}]
      aiLoading = false; return
    }
    const ctx = await buildMozartContext(supabase, {})
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':apiKey,
                  'anthropic-version':'2023-06-01',
                  'anthropic-dangerous-direct-browser-access':'true'},
        body: JSON.stringify({model:'claude-sonnet-4-20250514', max_tokens:400,
                              system:ctx, messages:aiMessages.slice(-10)})
      })
      const data = await res.json()
      aiMessages = [...aiMessages, {role:'assistant', content:data.content?.[0]?.text||'No response.'}]
    } catch(e) { aiMessages = [...aiMessages, {role:'assistant', content:'Error: '+e.message}] }
    aiLoading = false
  }

  onMount(() => {
    loadPhantomStatus()
    loadPhantomBrief()
    loadTrades()
    loadInboxFallback()
    loadCronLogs()
    loadDashboard()
    loadDeposits()
    loadStrategyDecisions()
    loadWithdrawalGoal()

    const pi = setInterval(loadPhantomStatus, 60000)
    const ti = setInterval(loadTrades, 15000)
    const ci = setInterval(loadCronLogs, 5 * 60 * 1000)
    const di  = setInterval(loadDashboard, 2 * 60 * 1000)

    const ps = supabase.channel('phantom_status')
      .on('postgres_changes', {event:'*', schema:'public', table:'phantom_status'}, () => loadPhantomStatus())
      .subscribe()
    const ts = supabase.channel('phantom_trades')
      .on('postgres_changes', {event:'*', schema:'public', table:'phantom_trades'}, () => { loadTrades(); loadDashboard() })
      .subscribe()
    const ss = supabase.channel('phantom_signals')
      .on('postgres_changes', {event:'*', schema:'public', table:'phantom_signals'}, () => loadTrades())
      .subscribe()
    const ds = supabase.channel('phantom_deposits')
      .on('postgres_changes', {event:'*', schema:'public', table:'phantom_deposits'}, () => loadDeposits())
      .subscribe()
    const strat = supabase.channel('strategy_decisions')
      .on('postgres_changes', {event:'*', schema:'public', table:'strategy_decisions'}, () => loadStrategyDecisions())
      .subscribe()

    return () => {
      clearInterval(pi); clearInterval(ti); clearInterval(ci); clearInterval(di)
      supabase.removeChannel(ps); supabase.removeChannel(ts); supabase.removeChannel(ss)
      supabase.removeChannel(ds); supabase.removeChannel(strat)
    }
  })
</script>

<div class="tab-layout {sideCollapsed ? 'side-collapsed' : ''}">
<div class="tab-main">

  <!-- ══ PHANTOM (TOP) ══════════════════════════════════════════════════════ -->
  <div class="sh" style="display:flex;align-items:center;justify-content:space-between">
    <span>🖤 PHANTOM</span>
    <span class="bot-badge {botRunning ? 'running' : botSyncing ? 'syncing' : 'scanning'}">
      {botRunning ? 'RUNNING' : botSyncing ? 'SYNCING' : 'SCANNING'}
    </span>
  </div>

  {#if phantomStatus}
    <div class="bot-meta">
      <div>
        <div class="bal-label">{phantomStatus.total_equity != null ? 'EQUITY' : 'BALANCE'}</div>
        <div class="bal-val">${(phantomStatus.total_equity ?? phantomStatus.balance ?? 0).toFixed(2)} <span class="bal-unit">USDC</span></div>
      </div>
      <div>
        <div class="bal-label">RISK POOL</div>
        <div class="bal-val" style="font-size:14px;color:#7a6230">${(phantomStatus.pool_balance??0).toFixed(2)}</div>
      </div>
      {#if phantomStatus.regime}
        <div>
          <div class="bal-label">REGIME</div>
          <div class="regime-val">{phantomStatus.regime}</div>
        </div>
      {/if}
      {#if phantomStatus.open_positions != null}
        <div>
          <div class="bal-label">OPEN POS</div>
          <div class="bal-val" style="font-size:16px;color:{phantomStatus.open_positions>0?'#c9a84c':'#555'}">{phantomStatus.open_positions}</div>
        </div>
      {/if}
      {#if phantomStatus.last_tick || phantomStatus.updated_at}
        <div class="bot-lasttick">Last tick<br>{new Date(phantomStatus.last_tick ?? phantomStatus.updated_at).toLocaleTimeString()}</div>
      {/if}
    </div>
    {#if freeBalance > 0}
      <div class="equity-row">
        <span class="equity-item">Free: <strong>${freeBalance.toFixed(2)}</strong></span>
        <span class="equity-sep">·</span>
        <span class="equity-item">In positions: <strong>${inPositions.toFixed(2)}</strong></span>
        <span class="equity-sep">·</span>
        <span class="equity-item total">Total: <strong>${currentEquity.toFixed(2)}</strong></span>
      </div>
    {/if}
  {:else}
    <div class="bot-syncing">
      <span class="sync-dot"></span>
      <div>
        <div class="sync-label">Bot running on Railway</div>
        <div class="sync-sub">Data syncing — Supabase writes pending</div>
      </div>
    </div>
  {/if}


  <!-- ══ LIVE FEED ════════════════════════════════════════════════════════════ -->
  <button class="sh collapse-sh" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;text-align:left" onclick={() => liveFeedOpen = !liveFeedOpen}>
    <span>LIVE FEED</span>
    <span style="display:flex;align-items:center;gap:8px"><span class="feed-pulse"></span><span class="collapse-arrow">{liveFeedOpen ? '▲' : '▼'}</span></span>
  </button>
  {#if liveFeedOpen}
  <div class="live-feed">
    {#if liveFeed().length === 0}
      {#if inboxFallback.length > 0}
        {#each inboxFallback as n}
          <div class="feed-row signal">
            <span class="feed-icon">📥</span>
            <span class="feed-body">
              <span class="feed-strat" style="opacity:0.6">{n.type?.toUpperCase()}</span>
              <span class="feed-detail">{n.message ? (n.message.length > 64 ? n.message.slice(0,64) + '…' : n.message) : (n.song_title || '—')}</span>
            </span>
            <span class="feed-time">{feedTime(n.created_at)}</span>
          </div>
        {/each}
        <div class="feed-fallback-note">Recent notifications — trade data syncing from Railway</div>
      {:else}
        <div class="feed-waiting">
          <span class="wait-dot"></span>
          Waiting for first trade...
        </div>
      {/if}
    {/if}
    {#each liveFeed() as ev}
      <div class="feed-row {ev.type}">
        {#if ev.type === 'open'}
          <span class="feed-icon">🟢</span>
          <span class="feed-body">
            <span class="feed-strat">{ev.strategy}</span>
            <span class="feed-tag {ev.side}">{ev.side?.toUpperCase()}</span>
            <span class="feed-detail">@ ${ev.entry < 1 ? ev.entry?.toFixed(4) : ev.entry?.toFixed(2)} · ${ev.size?.toFixed(0)}</span>
          </span>
          <span class="feed-time">{feedTime(ev.time)}</span>
        {:else if ev.type === 'close'}
          <span class="feed-icon">{ev.result === 'WIN' ? '✅' : ev.result === 'STOPPED' ? '🛑' : '❌'}</span>
          <span class="feed-body">
            <span class="feed-strat">{ev.strategy}</span>
            <span class="feed-pnl" style="color:{(ev.pnl??0)>=0?'#4caf82':'#e05a4a'}">{(ev.pnl??0)>=0?'+':''}{(ev.pnl??0).toFixed(2)}</span>
            <span class="feed-result-tag {ev.result?.toLowerCase()}">{ev.result}</span>
          </span>
          <span class="feed-time">{feedTime(ev.time)}</span>
        {:else if ev.type === 'signal'}
          <span class="feed-icon">{ev.acted ? '⚡' : '·'}</span>
          <span class="feed-body">
            <span class="feed-strat" style="opacity:0.6">{ev.strategy}</span>
            <span class="feed-tag {ev.side}" style="opacity:0.7">{ev.side?.toUpperCase()}</span>
            <span class="feed-detail" style="opacity:0.5">{ev.score}/11 · {ev.acted ? 'TRADED' : 'SKIPPED'}</span>
          </span>
          <span class="feed-time">{feedTime(ev.time)}</span>
        {/if}
      </div>
    {/each}
  </div>
  {/if}

<!-- ══ PERFORMANCE ════════════════════════════════════════════════════════ -->
  <div class="sh" style="margin-top:20px;display:flex;align-items:center;justify-content:space-between">
    <span>PERFORMANCE</span>
    <button class="refresh-btn" onclick={loadTrades}>{tradesLoading ? '...' : '↻'}</button>
  </div>

  {#if closedTrades.length > 0}
    <div class="stats-bar">
      <div class="stat-box">
        <div class="stat-label">TOTAL P&L</div>
        <div class="stat-val" style="color:{totalPnl>=0?'#4caf82':'#e05a4a'}">${totalPnl>=0?'+':''}{totalPnl.toFixed(2)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">WIN RATE</div>
        <div class="stat-val" style="color:{winRate>=50?'#4caf82':'#c9a84c'}">{winRate}%</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">CLOSED</div>
        <div class="stat-val">{closedTrades.length}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">OPEN</div>
        <div class="stat-val" style="color:#c9a84c">{openTrades.length}</div>
      </div>
    </div>
  {:else}
    <div class="empty-sm">No trades yet — bot is scanning for signals</div>
  {/if}

  {#if openTrades.length > 0}
    <div class="section-title" style="margin-top:12px">OPEN POSITIONS</div>
    {#each openTrades as t}
      <div class="trade-row open">
        <span class="trade-strategy">{t.strategy}</span>
        <span class="trade-side {t.side}">{t.side?.toUpperCase()}</span>
        <span class="trade-entry">@ ${t.entry_price < 1 ? t.entry_price?.toFixed(4) : t.entry_price?.toFixed(2)}</span>
        <span class="trade-size">${t.size_usd?.toFixed(0)}</span>
        <span class="trade-time">{formatTime(t.opened_at)}</span>
        <span class="trade-result open-badge">OPEN</span>
      </div>
    {/each}
  {/if}

  {#if closedTrades.length > 0}
    <button class="section-title collapse-sh" style="margin-top:12px" onclick={() => perfTradesOpen = !perfTradesOpen}>RECENT TRADES {perfTradesOpen ? '▲' : '▼'}</button>
    {#if perfTradesOpen}
    {#each closedTrades.slice(0,15) as t}
      <div class="trade-row">
        <span class="trade-strategy">{t.strategy}</span>
        <span class="trade-side {t.side}">{t.side?.toUpperCase()}</span>
        <span class="trade-entry">@ ${t.entry_price < 1 ? t.entry_price?.toFixed(4) : t.entry_price?.toFixed(2)}</span>
        <span class="trade-size">${t.size_usd?.toFixed(0)}</span>
        <span class="trade-pnl" style="color:{(t.pnl_usd??0)>=0?'#4caf82':'#e05a4a'}">{(t.pnl_usd??0)>=0?'+':''}{(t.pnl_usd??0).toFixed(2)}</span>
        <span class="trade-result {t.result?.toLowerCase()}">{t.result}</span>
      </div>
    {/each}
    {/if}
  {/if}

  {#if recentSignals.length > 0}
    <button class="section-title collapse-sh" style="margin-top:16px" onclick={() => perfSignalsOpen = !perfSignalsOpen}>RECENT SIGNALS {perfSignalsOpen ? '▲' : '▼'}</button>
    {#if perfSignalsOpen}
    {#each recentSignals.slice(0,10) as s}
      <div class="signal-row">
        <span class="signal-dot {s.direction}"></span>
        <span class="signal-strategy">{s.strategy}</span>
        <span class="signal-dir {s.direction}">{s.direction?.toUpperCase()}</span>
        <span class="signal-label">{s.risk_label}</span>
        <span class="signal-score">{s.score}/11</span>
        <span class="signal-time">{formatDate(s.fired_at)}</span>
        <span class="signal-acted {s.acted_on?'yes':'no'}">{s.acted_on ? 'TRADED' : 'SKIPPED'}</span>
      </div>
    {/each}
    {/if}
  {/if}

  <!-- ══ MONDAY BRIEF ═══════════════════════════════════════════════════════ -->
  {#if phantomBrief && !phantomBrief.dismissed && phantomBrief.stats_text}
    <div class="brief-card">
      <div class="brief-header">
        <span class="brief-title">MONDAY BRIEF</span>
        <span class="brief-date">{new Date(phantomBrief.created_at).toLocaleDateString('de-CH', {day:'2-digit',month:'2-digit',year:'numeric'})}</span>
        <button class="brief-dismiss" onclick={dismissBrief}>×</button>
      </div>
      <div class="brief-stats">{phantomBrief.stats_text}</div>
      {#if phantomBrief.suggestions_text}
        <div class="brief-suggestions">{phantomBrief.suggestions_text}</div>
      {/if}
    </div>
  {/if}

  <!-- ══ TRADING DASHBOARD ════════════════════════════════════════════════ -->
  <div class="sh" style="margin-top:28px;display:flex;align-items:center;justify-content:space-between">
    <span>TRADING DASHBOARD</span>
    <button class="refresh-btn" onclick={loadDashboard}>{dashLoading ? '...' : '↻'}</button>
  </div>

  <!-- Monthly Summary -->
  <div class="section-title" style="margin-bottom:8px">MONTHLY SUMMARY</div>
  <div class="dash-grid">
    <div class="dash-cell">
      <div class="dash-lbl">WINS</div>
      <div class="dash-val" style="color:#4caf82">{monthWins}</div>
    </div>
    <div class="dash-cell">
      <div class="dash-lbl">LOSSES</div>
      <div class="dash-val" style="color:#e05a4a">{monthLosses}</div>
    </div>
    <div class="dash-cell">
      <div class="dash-lbl">WIN RATE</div>
      <div class="dash-val" style="color:{monthWinRate>=50?'#4caf82':'#c9a84c'}">{monthWinRate}%</div>
    </div>
    <div class="dash-cell">
      <div class="dash-lbl">REALIZED P&L</div>
      <div class="dash-val" style="color:{monthPnl>=0?'#4caf82':'#e05a4a'}">{monthPnl>=0?'+':''}{monthPnl.toFixed(2)}</div>
    </div>
  </div>
  {#if monthBestTrade || monthWorstTrade}
    <div class="dash-extremes">
      {#if monthBestTrade}
        <div class="extreme-row">
          <span class="extreme-lbl">BEST</span>
          <span class="extreme-strategy">{monthBestTrade.strategy}</span>
          <span class="extreme-val" style="color:#4caf82">+{(monthBestTrade.pnl_usd||0).toFixed(2)}</span>
        </div>
      {/if}
      {#if monthWorstTrade}
        <div class="extreme-row">
          <span class="extreme-lbl">WORST</span>
          <span class="extreme-strategy">{monthWorstTrade.strategy}</span>
          <span class="extreme-val" style="color:#e05a4a">{(monthWorstTrade.pnl_usd||0).toFixed(2)}</span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty-sm" style="padding:8px 0">No closed trades this month yet</div>
  {/if}

  <!-- Equity Tracker -->
  <div class="section-title" style="margin-top:16px;margin-bottom:8px">EQUITY TRACKER</div>
  <div class="et-block">
    <div class="et-row">
      <span class="et-lbl">Free balance <span style="font-family:'DM Sans',sans-serif;font-size:9px;color:#555;text-transform:none;letter-spacing:0">phantom_status.balance</span></span>
      <span class="et-val">{equitySyncing ? '—' : '$' + (phantomStatus?.balance ?? 0).toFixed(2)}</span>
    </div>
    <div class="et-row">
      <span class="et-lbl">In positions <span style="font-family:'DM Sans',sans-serif;font-size:9px;color:#555;text-transform:none;letter-spacing:0">total_equity − balance</span></span>
      <span class="et-val" style="color:{inPositions>0?'#c9a84c':'#555'}">{inPositions>0 ? '$'+inPositions.toFixed(2) : '—'}</span>
    </div>
    <div class="et-row et-highlight">
      <span class="et-lbl">Total equity <span style="font-family:'DM Sans',sans-serif;font-size:9px;color:#555;text-transform:none;letter-spacing:0">phantom_status.total_equity</span></span>
      <span class="et-val">{equitySyncing ? '—' : '$' + (phantomStatus?.total_equity ?? currentEquity).toFixed(2)}</span>
    </div>
    <div class="et-row">
      <span class="et-lbl">Total deposited</span>
      <span class="et-val" style="display:flex;align-items:center;gap:6px">
        <span style="color:#9e9690">{totalDeposited > 0 ? '$' + totalDeposited.toFixed(2) : '—'}</span>
        <button class="et-dep-add" onclick={() => { etDepositOpen = !etDepositOpen; newDepositAmt = '' }}>+</button>
      </span>
    </div>
    {#if etDepositOpen}
      <div class="et-dep-form">
        <input class="inp et-dep-inp" type="number" min="0" step="0.01" placeholder="Amount (USD)"
          bind:value={newDepositAmt}
          onkeydown={async e => { if (e.key === 'Enter') { await addDeposit(); etDepositOpen = false } }} />
        <button class="btn btn-gold et-dep-confirm" onclick={async () => { await addDeposit(); etDepositOpen = false }}
          disabled={depositSaving}>{depositSaving ? '...' : 'Log'}</button>
        <button class="et-dep-cancel" onclick={() => etDepositOpen = false}>×</button>
      </div>
    {/if}
    {#if netPnlVsDeposited !== null}
      {@const pos = netPnlVsDeposited >= 0}
      <div class="et-row et-highlight" style="border-color:{pos?'rgba(76,175,130,.2)':'rgba(224,90,74,.2)'};background:{pos?'rgba(76,175,130,.03)':'rgba(224,90,74,.03)'}">
        <span class="et-lbl">Net P&amp;L on capital</span>
        <span class="et-val" style="color:{pos?'#4caf82':'#e05a4a'}">{pos?'+':''}{netPnlVsDeposited.toFixed(2)}</span>
      </div>
    {/if}
    {#if equitySyncing}
      <div style="font-family:'DM Sans',sans-serif;font-size:10px;color:#7a6230;padding-top:2px">Equity data syncing — deposit to Lighter to activate</div>
    {/if}
  </div>

  <!-- Withdrawal Planner -->
  <div class="section-title" style="margin-top:16px;margin-bottom:8px">WITHDRAWAL PLANNER <span class="wp-goal-tag">GOAL $500/mo</span></div>

  {#if equitySyncing}
    <div class="wp-sync-note">Equity data syncing — deposit to Lighter to activate</div>
  {/if}

  <div class="wp-block">
    <!-- Row 1: Monthly income -->
    <div class="wp-row">
      <span class="wp-lbl">Monthly income so far <span class="wp-sublbl">P&L + carry</span></span>
      <span class="wp-val" style="color:{monthTotalIncome>0?'#4caf82':monthTotalIncome<0?'#e05a4a':'#555'}">{monthTotalIncome>0?'+':''}{monthTotalIncome.toFixed(2)}</span>
    </div>
    <!-- Row 2: Safe withdrawal -->
    <div class="wp-row wp-row-accent">
      <span class="wp-lbl">Safe withdrawal <span class="wp-sublbl">50% stays in system</span></span>
      <span class="wp-val" style="color:{safeWithdrawal>0?'#c9a84c':'#555'}">{safeWithdrawal>0?'$'+safeWithdrawal.toFixed(2):'—'}</span>
    </div>

    <div class="wp-divider"></div>

    <!-- Row 3: Capital needed -->
    <div class="wp-row">
      <span class="wp-lbl">Capital needed for $<input
          class="goal-input"
          type="number"
          bind:value={withdrawalGoal}
          onblur={saveWithdrawalGoal}
          onkeydown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          min="1"
          step="100"
        />/mo
        {#if usingFallbackRate}<span class="wp-sublbl">est. at 17.5%/mo</span>{/if}
      </span>
      <span class="wp-val" style="color:#9e9690">${capitalNeeded.toFixed(0)}</span>
    </div>
    <!-- Row 4: Current equity -->
    <div class="wp-row">
      <span class="wp-lbl">Current equity</span>
      <span class="wp-val">{equitySyncing ? '—' : '$'+currentEquity.toFixed(2)}</span>
    </div>
    <!-- Row 5: Capital gap -->
    <div class="wp-row">
      <span class="wp-lbl">Capital gap</span>
      {#if withdrawalReached}
        <span class="wp-ready-badge">✓ WITHDRAWAL READY</span>
      {:else if equitySyncing}
        <span class="wp-val" style="color:#555">—</span>
      {:else}
        <span class="wp-val" style="color:#e05a4a">−${capitalGap.toFixed(0)}</span>
      {/if}
    </div>

    <!-- Progress bar -->
    <div class="prog-wrap">
      <div class="prog-track">
        <div class="prog-fill" style="width:{goalProgressPct}%;background:{withdrawalReached?'#4caf82':'#c9a84c'}"></div>
      </div>
      <span class="prog-pct" style="color:{withdrawalReached?'#4caf82':'#555'}">{goalProgressPct}%</span>
    </div>
  </div>

  <!-- Compound Projector -->
  {#if compoundProjection.length > 0 && !equitySyncing}
    <div class="section-title" style="margin-top:14px;margin-bottom:6px">COMPOUND PROJECTOR <span class="wp-sublbl" style="letter-spacing:0;text-transform:none">reinvest all income until goal</span></div>
    <div class="ct-table">
      <div class="ct-header">
        <span>MONTH</span>
        <span>EQUITY</span>
        <span>MONTHLY INCOME</span>
        <span>SAFE WITHDRAWAL</span>
      </div>
      {#each compoundProjection as row}
        <div class="ct-row {row.reached ? 'ct-goal' : ''}">
          <span class="ct-month">+{row.month}mo</span>
          <span class="ct-equity">${Math.round(row.equity).toLocaleString()}</span>
          <span class="ct-income" style="color:{row.income >= withdrawalGoal ? '#4caf82' : '#9e9690'}">${Math.round(row.income).toLocaleString()}</span>
          <span class="ct-safe" style="color:{row.income * 0.5 >= withdrawalGoal ? '#4caf82' : '#555'}">${Math.round(row.income * 0.5).toLocaleString()}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Carry Income Tracker -->
  <div class="section-title" style="margin-top:16px;margin-bottom:8px">CARRY INCOME</div>
  <div class="dash-grid">
    <div class="dash-cell">
      <div class="dash-lbl">ALL-TIME</div>
      <div class="dash-val" style="color:{totalCarryIncome>=0?'#c9a84c':'#e05a4a'}">{totalCarryIncome>=0?'+':''}{totalCarryIncome.toFixed(2)}</div>
    </div>
    <div class="dash-cell">
      <div class="dash-lbl">THIS MONTH</div>
      <div class="dash-val" style="color:{monthCarryIncome>=0?'#c9a84c':'#e05a4a'}">{monthCarryIncome>=0?'+':''}{monthCarryIncome.toFixed(2)}</div>
    </div>
    <div class="dash-cell dash-cell-wide">
      <div class="dash-lbl">DAILY AVG</div>
      <div class="dash-val" style="color:#9e9690">{dailyAvgCarry>=0?'+':''}{dailyAvgCarry.toFixed(3)}</div>
    </div>
  </div>

  <!-- ══ CRON JOBS ═══════════════════════════════════════════════════════════ -->
  <div class="sh" style="margin-top:28px">CRON JOBS</div>
  <div class="cron-list">
    {#each cronJobs as cron}
      {@const log = cronLogs[cron.name]}
      {@const dotClass = log ? (log.status === 'ok' ? 'ok' : 'error') : 'inactive'}
      <div class="cron-row" title={log?.message || ''}>
        <span class="cron-dot {dotClass}"></span>
        <span class="cron-name-col">
          <span class="cron-name">{cron.name}</span>
          {#if log?.message}
            <span class="cron-msg">{log.message.length > 72 ? log.message.slice(0, 72) + '…' : log.message}</span>
          {/if}
        </span>
        <span class="cron-meta">
          <span class="cron-schedule">{cron.schedule}</span>
          {#if cron.source}<span class="cron-source">{cron.source}</span>{/if}
          <span class="cron-last" style={log?.run_at ? '' : 'color:#555'}>{log?.run_at ? feedTime(log.run_at) : '—'}</span>
        </span>
      </div>
    {/each}
  </div>

  <!-- ══ STRATEGY REVIEW ═══════════════════════════════════════════════════ -->
  <div class="sh" style="margin-top:32px;display:flex;align-items:center;justify-content:space-between">
    <span>STRATEGY REVIEW</span>
    {#if pendingDecisions.length > 0}
      <span class="strat-badge">{pendingDecisions.length} pending</span>
    {:else}
      <span class="strat-clear">all clear</span>
    {/if}
  </div>

  {#if strategyToast}
    <div class="strat-toast">{strategyToast}</div>
  {/if}

  {#if strategyLoading}
    <div class="empty-sm">Loading...</div>
  {:else if pendingDecisions.length === 0}
    <div class="strat-empty">No pending strategy decisions.</div>
  {:else}
    <div class="strat-list">
      {#each pendingDecisions as d (d.id)}
        <div class="strat-card">
          <div class="strat-meta">
            <span class="strat-source">{d.source?.replace(/_/g,' ').toUpperCase()}</span>
            <span class="strat-date">{new Date(d.created_at).toLocaleDateString('de-CH',{day:'2-digit',month:'2-digit'})}</span>
          </div>
          <div class="strat-title">{d.title}</div>
          {#if d.summary}
            <div class="strat-summary">{d.summary}</div>
          {/if}
          {#if d.recommendation}
            <div class="strat-rec">
              <span class="strat-rec-label">RECOMMENDATION</span>
              <span class="strat-rec-text">{d.recommendation}</span>
            </div>
          {/if}
          <div class="strat-actions">
            <button class="strat-btn approve" onclick={() => approveDecision(d.id)}>Approve</button>
            <button class="strat-btn reject"  onclick={() => rejectDecision(d.id)}>Reject</button>
            <button class="strat-btn discuss" onclick={() => discussDecision(d)}>Discuss</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

</div>

<!-- ══ Sidebar ════════════════════════════════════════════════════════════════ -->
<div class="tab-sidebar">
  <button class="side-toggle {sideCollapsed ? '' : 'expanded'}" onclick={() => sideCollapsed = !sideCollapsed}>{sideCollapsed ? '›' : '‹'}</button>
  {#if !sideCollapsed}
  <div class="mozart-block">
    <div class="mozart-title-row">
      <div class="mozart-title">ASK MOZART</div>
      {#if aiMessages.length}
        <button class="clear-chat" onclick={() => aiMessages=[]}>Clear</button>
      {/if}
    </div>
    <div class="chat-input-row">
      <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..."
        onkeydown={e => e.key==='Enter' && sendAI()} />
      <button class="btn-gold-sm" onclick={() => sendAI()}>Ask</button>
    </div>
    <div class="chat-out">
      {#each aiMessages as msg}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role==='user' ? 'You' : 'Mozart'}</div>
          <div class="chat-text">{msg.content}</div>
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant">
          <div class="chat-who">Mozart</div>
          <div class="chat-text dim">...</div>
        </div>
      {/if}
    </div>
  </div>
  {/if}
</div>
</div>

<style>
  .tab-layout{display:grid;grid-template-columns:1fr 320px;gap:32px;min-height:calc(100vh - 100px);align-items:start;transition:grid-template-columns .2s}
  .tab-layout.side-collapsed{grid-template-columns:1fr 20px}
  .tab-main{display:flex;flex-direction:column;min-width:0}
  .tab-sidebar{border-left:1px solid #1c1c1c;padding-left:12px;display:flex;flex-direction:column;overflow:hidden}
  .side-toggle { background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; color: #9e9690; font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; padding: 20px 10px; align-self: flex-start; line-height: 1; margin-bottom: 6px; }
  .side-toggle.expanded { padding: 10px 10px; }
  .side-toggle:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }

  .sh{font-family:'Space Mono',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;padding-bottom:6px;border-bottom:1px solid #303030;margin-bottom:14px}
  .empty{font-family:'Space Mono',monospace;font-size:12px;color:#9e9690;padding:32px 0;text-align:center}
  .empty-sm{font-family:'DM Sans',sans-serif;font-size:11px;color:#9e9690;padding:4px 0 8px}
  .section-title{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:rgba(201,168,76,.85);margin:0 0 4px}
  .collapse-sh{background:none;border:none;padding:0;cursor:pointer;text-align:left;width:100%}
  .collapse-sh:hover{opacity:.75}
  .collapse-arrow{font-size:9px;color:#555;margin-left:4px}

  /* Bot */
  .bot-badge{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;padding:2px 7px;border-radius:2px;letter-spacing:.08em}
  .bot-badge.running{background:rgba(76,175,130,.12);color:#4caf82;border:1px solid rgba(76,175,130,.25)}
  .bot-badge.scanning{background:rgba(201,168,76,.08);color:#7a6230;border:1px solid rgba(201,168,76,.15)}
  .bot-badge.syncing{background:rgba(100,140,200,.08);color:#5a7ab0;border:1px solid rgba(100,140,200,.2)}
  .bot-syncing{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#161616;border:1px solid #2a2a2a;border-radius:4px;margin-bottom:14px}
  .sync-dot{width:8px;height:8px;border-radius:50%;background:#5a7ab0;flex-shrink:0;animation:sync-pulse 2s ease-in-out infinite}
  @keyframes sync-pulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
  .sync-label{font-family:'Space Mono',monospace;font-size:11px;font-weight:700;color:#cec9c1;letter-spacing:.06em}
  .sync-sub{font-family:'DM Sans',sans-serif;font-size:11px;color:#9e9690;margin-top:2px}
  .live-feed{display:flex;flex-direction:column;gap:2px;margin-top:6px}
  .feed-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:#1c1c1c;border:0.5px solid #303030;font-size:12px}
  .feed-row.open{border-color:rgba(76,175,130,0.3)}
  .feed-row.close{border-color:rgba(201,168,76,0.2)}
  .feed-row.signal{background:transparent;border-color:#1a1a1a}
  .feed-icon{font-size:13px;flex-shrink:0}
  .feed-body{flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .feed-strat{color:#cec9c1;font-family:'Space Mono',monospace;font-size:11px}
  .feed-detail{color:#9e9690;font-size:11px}
  .feed-time{color:#6b6762;font-size:10px;flex-shrink:0}
  .feed-pnl{font-family:'Space Mono',monospace;font-size:12px;font-weight:700}
  .feed-tag{font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700}
  .feed-tag.long{background:rgba(76,175,130,0.15);color:#4caf82}
  .feed-tag.short{background:rgba(224,90,74,0.15);color:#e05a4a}
  .feed-result-tag{font-size:10px;padding:1px 5px;border-radius:3px}
  .feed-result-tag.win{background:rgba(76,175,130,0.15);color:#4caf82}
  .feed-result-tag.stopped,.feed-result-tag.loss{background:rgba(224,90,74,0.15);color:#e05a4a}
  .feed-fallback-note{font-family:'DM Sans',sans-serif;font-size:10px;color:#6b6762;padding:6px 10px;text-align:center;letter-spacing:.02em}
  .feed-waiting{display:flex;align-items:center;gap:8px;color:#6b6762;font-size:12px;padding:12px 10px;font-family:'Space Mono',monospace;letter-spacing:.04em}
  .wait-dot{width:7px;height:7px;border-radius:50%;background:#3a3a3a;flex-shrink:0;animation:wait-pulse 2.5s ease-in-out infinite}
  @keyframes wait-pulse{0%,100%{background:#3a3a3a;box-shadow:none}50%{background:#c9a84c;box-shadow:0 0 6px rgba(201,168,76,.4)}}
  .feed-pulse{width:7px;height:7px;border-radius:50%;background:#4caf82;animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  .bot-meta{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;gap:20px;flex-wrap:wrap}
  .bal-label{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#cec9c1;margin-bottom:3px}
  .bal-val{font-family:'Space Mono',monospace;font-size:20px;font-weight:700;color:#c9a84c}
  .bal-unit{font-size:11px;color:#7a6230}
  .bot-lasttick{font-family:'Space Mono',monospace;font-size:9px;color:#6b6762;text-align:right;line-height:1.5}
  .regime-val{font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:#cec9c1;text-transform:uppercase;letter-spacing:.06em}

  /* Stats */
  .stats-bar{display:flex;gap:12px;margin-bottom:12px;padding:10px 14px;background:rgba(201,168,76,.04);border:1px solid rgba(201,168,76,.12);border-radius:3px}
  .stat-box{display:flex;flex-direction:column;gap:3px;flex:1}
  .stat-label{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#cec9c1}
  .stat-val{font-family:'Space Mono',monospace;font-size:16px;font-weight:700;color:#f5f1ea}

  /* Trades */
  .trade-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #111;font-family:'Space Mono',monospace}
  .trade-row.open{background:rgba(201,168,76,.03)}
  .trade-strategy{font-size:9px;color:#9e9690;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .trade-side{font-size:10px;font-weight:700;width:38px;flex-shrink:0}
  .trade-side.long{color:#4caf82}
  .trade-side.short{color:#e05a4a}
  .trade-entry{font-size:9px;color:#cec9c1;flex-shrink:0}
  .trade-size{font-size:9px;color:#9e9690;width:32px;text-align:right;flex-shrink:0}
  .trade-pnl{font-size:10px;font-weight:700;width:44px;text-align:right;flex-shrink:0}
  .trade-time{font-size:9px;color:#6b6762;flex-shrink:0}
  .trade-result{font-size:8px;font-weight:700;padding:1px 5px;border-radius:2px;flex-shrink:0;letter-spacing:.04em}
  .trade-result.win{background:rgba(76,175,130,.15);color:#4caf82}
  .trade-result.loss,.trade-result.stopped{background:rgba(224,90,74,.12);color:#e05a4a}
  .trade-result.open-badge{background:rgba(201,168,76,.1);color:#c9a84c}

  /* Signals */
  .signal-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #0d0d0d;font-family:'Space Mono',monospace}
  .signal-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .signal-dot.long{background:#4caf82}
  .signal-dot.short{background:#e05a4a}
  .signal-strategy{font-size:9px;color:#9e9690;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .signal-dir{font-size:9px;font-weight:700;width:36px;flex-shrink:0}
  .signal-dir.long{color:#4caf82}
  .signal-dir.short{color:#e05a4a}
  .signal-label{font-size:8px;color:#7a6230;width:70px;flex-shrink:0;overflow:hidden}
  .signal-score{font-size:9px;color:#9e9690;width:24px;flex-shrink:0}
  .signal-time{font-size:8px;color:#6b6762;flex-shrink:0}
  .signal-acted{font-size:8px;padding:1px 4px;border-radius:2px;flex-shrink:0}
  .signal-acted.yes{background:rgba(76,175,130,.1);color:#4caf82}
  .signal-acted.no{background:rgba(80,80,80,.12);color:#6b6762}

  /* Cron jobs */
  .cron-list{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}
  .cron-row{display:flex;align-items:flex-start;gap:10px;padding:6px 10px;border-radius:3px;background:#1c1c1c;border:0.5px solid #303030}
  .cron-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:3px}
  .cron-dot.active,.cron-dot.ok{background:#4caf82;box-shadow:0 0 4px rgba(76,175,130,.4)}
  .cron-dot.inactive{background:#444}
  .cron-dot.error,.cron-dot.alert{background:#e05a4a;box-shadow:0 0 4px rgba(224,90,74,.4)}
  .cron-name-col{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
  .cron-name{font-family:'Space Mono',monospace;font-size:10px;color:#cec9c1}
  .cron-msg{font-family:'DM Sans',sans-serif;font-size:10px;color:#9e9690;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cron-meta{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
  .cron-schedule{font-family:'Space Mono',monospace;font-size:9px;color:#9e9690}
  .cron-source{font-family:'Space Mono',monospace;font-size:8px;color:#7a6230;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.12);padding:1px 5px;border-radius:2px}
  .cron-last{font-family:'Space Mono',monospace;font-size:9px;color:#4caf82}

  /* System costs */
  /* Mozart */
  .mozart-block{margin-top:16px;border-top:1px solid #1c1c1c;padding-top:12px;display:flex;flex-direction:column;gap:8px}
  .mozart-title-row{display:flex;align-items:center;justify-content:space-between}
  .mozart-title{font-family:'Space Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.14em;color:#c9a84c}
  .clear-chat{font-family:'Space Mono',monospace;font-size:10px;padding:2px 8px;background:transparent;border:1px solid #252525;color:#444;border-radius:2px;cursor:pointer}
  .chat-out{overflow-y:auto;max-height:70vh;min-height:200px;display:flex;flex-direction:column;gap:8px;padding:4px 0}
  .chat-msg{display:flex;flex-direction:column;gap:2px}
  .chat-who{font-family:'Space Mono',monospace;font-size:10px;color:#9e9690}
  .chat-msg.assistant .chat-who{color:#7a6230}
  .chat-text{font-family:'DM Sans',sans-serif;font-size:13px;color:#cec9c1;line-height:1.5}
  .chat-text.dim{color:#444}
  .chat-input-row{display:flex;gap:6px}
  .chat-inp{flex:1;background:#1c1c1c;border:1px solid #303030;color:#f5f1ea;font-family:'DM Sans',sans-serif;font-size:13px;padding:7px 10px;outline:none;border-radius:3px}
  .chat-inp:focus{border-color:rgba(201,168,76,.4)}
  .btn-gold-sm{font-family:'Space Mono',monospace;font-size:11px;font-weight:700;padding:7px 12px;background:#c9a84c;color:#0a0a0a;border:none;border-radius:3px;cursor:pointer}
  .refresh-btn{font-family:'Space Mono',monospace;font-size:9px;background:transparent;border:1px solid #252525;color:#444;padding:3px 8px;border-radius:2px;cursor:pointer}
  .refresh-btn:hover{color:#9e9690;border-color:#444}

  /* Equity row */
  .equity-row{display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(201,168,76,.03);border:1px solid rgba(201,168,76,.1);border-radius:3px;margin-bottom:10px;flex-wrap:wrap}
  .equity-item{font-family:'Space Mono',monospace;font-size:10px;color:#7a6230}
  .equity-item strong{color:#cec9c1;font-weight:700}
  .equity-item.total strong{color:#c9a84c}
  .equity-sep{color:#555;font-size:10px}

  /* Dim credits badge */

  /* Trading Dashboard */
  .dash-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:6px}
  .dash-cell{background:#1c1c1c;border:0.5px solid #303030;border-radius:3px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
  .dash-cell-wide{grid-column:span 2}
  .dash-lbl{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#cec9c1}
  .dash-val{font-family:'Space Mono',monospace;font-size:15px;font-weight:700;color:#f5f1ea}
  .dash-extremes{display:flex;flex-direction:column;gap:2px;margin-bottom:4px}
  .extreme-row{display:flex;align-items:center;gap:8px;padding:5px 10px;background:#161616;border:0.5px solid #252525;border-radius:3px}
  .extreme-lbl{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#cec9c1;width:32px;flex-shrink:0}
  .extreme-strategy{font-family:'Space Mono',monospace;font-size:9px;color:#9e9690;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .extreme-val{font-family:'Space Mono',monospace;font-size:11px;font-weight:700;flex-shrink:0}
  /* Equity Tracker */
  .et-block{display:flex;flex-direction:column;gap:2px;margin-bottom:4px}
  .et-row{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#1c1c1c;border:0.5px solid #303030;border-radius:3px}
  .et-row.et-highlight{background:rgba(201,168,76,.05);border-color:rgba(201,168,76,.2)}
  .et-lbl{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#cec9c1}
  .et-val{font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:#f5f1ea}
  .et-dep-add{background:none;border:1px solid #303030;color:#9e9690;font-size:11px;line-height:1;padding:1px 5px;border-radius:2px;cursor:pointer;font-family:'Space Mono',monospace}
  .et-dep-add:hover{border-color:#c9a84c;color:#c9a84c}
  .et-dep-form{display:flex;align-items:center;gap:6px;padding:5px 10px;background:#0d0d0d;border:0.5px solid #252525;border-radius:3px;margin-top:2px}
  .et-dep-inp{flex:1;background:#111;border:1px solid #303030;color:#f5f1ea;font-family:'DM Sans',sans-serif;font-size:12px;padding:4px 7px;border-radius:2px}
  .et-dep-inp:focus{outline:none;border-color:#c9a84c}
  .et-dep-confirm{padding:3px 10px;font-size:11px}
  .et-dep-cancel{background:none;border:none;color:#555;font-size:14px;cursor:pointer;padding:0 2px;line-height:1}
  .et-dep-cancel:hover{color:#f5f1ea}
  /* Withdrawal Planner */
  .wp-goal-tag{font-family:'DM Sans',sans-serif;font-size:9px;font-weight:400;letter-spacing:.02em;text-transform:none;color:#7a6230;margin-left:6px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.15);padding:1px 6px;border-radius:2px}
  .wp-sync-note{font-family:'DM Sans',sans-serif;font-size:11px;color:#7a6230;background:rgba(201,168,76,.05);border:1px solid rgba(201,168,76,.12);border-radius:3px;padding:7px 10px;margin-bottom:8px;letter-spacing:.01em}
  .wp-block{background:#1c1c1c;border:0.5px solid #303030;border-radius:3px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;margin-bottom:4px}
  .wp-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .wp-row-accent{background:rgba(201,168,76,.03);margin:0 -12px;padding:5px 12px;border-top:0.5px solid rgba(201,168,76,.1);border-bottom:0.5px solid rgba(201,168,76,.1)}
  .wp-lbl{font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#cec9c1;display:flex;align-items:center;gap:6px;flex:1}
  .goal-input{width:52px;background:transparent;border:none;border-bottom:1px solid #303030;color:#cec9c1;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.05em;padding:0 2px;text-align:center;-moz-appearance:textfield}
  .goal-input:focus{outline:none;border-bottom-color:#c9a84c}
  .goal-input::-webkit-outer-spin-button,.goal-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
  .wp-sublbl{font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:.01em;text-transform:none;color:#9e9690;font-weight:400}
  .wp-val{font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:#f5f1ea;flex-shrink:0}
  .wp-divider{border:none;border-top:1px solid #1c1c1c;margin:2px 0}
  .wp-ready-badge{font-family:'Space Mono',monospace;font-size:10px;font-weight:700;color:#4caf82;background:rgba(76,175,130,.1);border:1px solid rgba(76,175,130,.25);padding:2px 8px;border-radius:2px;letter-spacing:.06em;flex-shrink:0}
  .prog-wrap{display:flex;align-items:center;gap:8px;margin-top:2px}
  .prog-track{flex:1;height:5px;background:#1c1c1c;border-radius:3px;overflow:hidden}
  .prog-fill{height:100%;border-radius:3px;transition:width .5s ease}
  .prog-pct{font-family:'Space Mono',monospace;font-size:10px;width:30px;text-align:right;flex-shrink:0}
  /* Compound Projector table */
  .ct-table{display:flex;flex-direction:column;gap:1px;margin-bottom:6px}
  .ct-header{display:grid;grid-template-columns:48px 1fr 1fr 1fr;gap:6px;padding:4px 10px;font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:#6b6762}
  .ct-row{display:grid;grid-template-columns:48px 1fr 1fr 1fr;gap:6px;padding:5px 10px;background:#161616;border:0.5px solid #252525;border-radius:2px;font-family:'Space Mono',monospace;font-size:10px;align-items:center}
  .ct-row.ct-goal{background:rgba(76,175,130,.04);border-color:rgba(76,175,130,.2)}
  .ct-month{color:#9e9690;font-size:9px}
  .ct-equity{color:#f5f1ea;font-weight:700}
  .ct-income{font-weight:700}
  .ct-safe{}

  /* Monday Brief */
  .brief-card{background:#1c1c1c;border:1px solid rgba(201,168,76,.25);border-radius:4px;padding:14px 16px;margin:20px 0 28px}
  .brief-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .brief-title{font-family:'Space Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.14em;color:#c9a84c}
  .brief-date{font-family:'Space Mono',monospace;font-size:9px;color:#7a6230;flex:1}
  .brief-dismiss{background:transparent;border:none;color:#444;font-size:17px;cursor:pointer;padding:0 2px;line-height:1;margin-left:auto}
  .brief-dismiss:hover{color:#e05a4a}
  .brief-stats{font-family:'DM Sans',sans-serif;font-size:13px;color:#cec9c1;line-height:1.6;white-space:pre-wrap}
  .brief-suggestions{font-family:'DM Sans',sans-serif;font-size:12px;color:#9e9690;line-height:1.6;white-space:pre-wrap;margin-top:10px;padding-top:10px;border-top:1px solid #252525}

  /* Strategy Review */
  .strat-badge{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;padding:2px 8px;border-radius:2px;background:rgba(201,168,76,.12);color:#c9a84c;border:1px solid rgba(201,168,76,.25);letter-spacing:.06em}
  .strat-clear{font-family:'Space Mono',monospace;font-size:9px;color:#6b6762;letter-spacing:.06em}
  .strat-empty{font-family:'DM Sans',sans-serif;font-size:12px;color:#9e9690;padding:8px 0 16px}
  .strat-toast{font-family:'DM Sans',sans-serif;font-size:11px;color:#4caf82;background:rgba(76,175,130,.08);border:1px solid rgba(76,175,130,.2);border-radius:3px;padding:5px 12px;margin-bottom:10px}
  .strat-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
  .strat-card{background:#1c1c1c;border:1px solid #303030;border-radius:4px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
  .strat-meta{display:flex;align-items:center;justify-content:space-between}
  .strat-source{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.1em;color:#7a6230;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.12);padding:1px 6px;border-radius:2px}
  .strat-date{font-family:'Space Mono',monospace;font-size:9px;color:#6b6762}
  .strat-title{font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:#f5f1ea;letter-spacing:.04em;line-height:1.4}
  .strat-summary{font-family:'DM Sans',sans-serif;font-size:12px;color:#cec9c1;line-height:1.6}
  .strat-rec{display:flex;flex-direction:column;gap:3px;padding:8px 10px;background:rgba(201,168,76,.04);border-left:2px solid rgba(201,168,76,.3);border-radius:0 3px 3px 0}
  .strat-rec-label{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:rgba(201,168,76,.85)}
  .strat-rec-text{font-family:'DM Sans',sans-serif;font-size:12px;color:#cec9c1;line-height:1.5}
  .strat-actions{display:flex;gap:6px;margin-top:2px}
  .strat-btn{font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.06em;padding:5px 12px;border:none;border-radius:3px;cursor:pointer;transition:opacity .15s}
  .strat-btn:hover{opacity:.8}
  .strat-btn.approve{background:rgba(76,175,130,.15);color:#4caf82;border:1px solid rgba(76,175,130,.3)}
  .strat-btn.reject{background:rgba(224,90,74,.1);color:#e05a4a;border:1px solid rgba(224,90,74,.25)}
  .strat-btn.discuss{background:rgba(100,140,200,.08);color:#7a9fd0;border:1px solid rgba(100,140,200,.2)}
</style>
