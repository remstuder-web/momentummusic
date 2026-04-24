<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext } from './mozartContext.js'
  import { onMount } from 'svelte'

  let items = $state([])
  let loading = $state(true)
  let newName = $state('')

  const RENEWALS = ['monthly','yearly','quarterly','one-time']

  let total = $derived(items.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0))

  async function load() {
    const { data } = await supabase.from('finances').select('*').order('position')
    items = data || []
    loading = false
  }

  async function save(item) {
    await supabase.from('finances').update({
      name: item.name, amount: item.amount, renewal: item.renewal, notes: item.notes, billing_day: item.billing_day
    }).eq('id', item.id)
  }

  async function add() {
    if (!newName.trim()) return
    const { data } = await supabase.from('finances')
      .insert({ name: newName.trim(), amount: 0, renewal: 'monthly', notes: '', position: items.length })
      .select().single()
    if (data) items = [...items, { ...data, _exp: true }]
    newName = ''
  }

  async function del(id) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('finances').delete().eq('id', id)
    items = items.filter(f => f.id !== id)
  }

  async function move(item, dir) {
    const idx = items.findIndex(f => f.id === item.id)
    const ni = idx + dir
    if (ni < 0 || ni >= items.length) return
    const a = items[idx], b = items[ni]
    const pa = a.position ?? idx, pb = b.position ?? ni
    a.position = pb; b.position = pa
    items = [...items].sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
    await Promise.all([
      supabase.from('finances').update({ position: pb }).eq('id', a.id),
      supabase.from('finances').update({ position: pa }).eq('id', b.id),
    ])
  }

  function toggle(item) { item._exp = !item._exp; items = [...items] }

  function amtStr(f) {
    return f.amount ? 'CHF ' + parseFloat(f.amount).toFixed(2) + ' / ' + (f.renewal || 'monthly') : ''
  }

  // ── Crypto signal ──────────────────────────────────────────────────────────
  const MONITORED_COINS = ['BTC','ETH','DOGE','XRP','FLOKI']
  let cryptoSignal = $state(null)
  let cryptoLoading = $state(false)
  let showPolymarket = $state(false)
  let showTrending = $state(false)
  const MONITORED_SYMS = new Set(['BTC','ETH','DOGE','XRP','FLOKI'])
  let allCoinPrices = $state({})
  let portfolio = $state([])
  let newCoin = $state('BTC')
  let newAmount = $state('')
  let newEntryPrice = $state('')

  async function loadCryptoSignal() {
    cryptoLoading = true
    try {
      const [sigRes, pricesRes] = await Promise.all([
        fetch('http://localhost:4242/crypto-signal'),
        fetch('http://localhost:4242/all-coin-prices')
      ])
      cryptoSignal = await sigRes.json()
      allCoinPrices = await pricesRes.json()
    } catch(e) {}
    cryptoLoading = false
  }

  async function loadPortfolio() {
    const { data } = await supabase.from('user_settings').select('value').eq('key', 'crypto_portfolio').single()
    if (data?.value) portfolio = JSON.parse(data.value)
  }

  async function savePortfolio() {
    await supabase.from('user_settings').upsert({ key: 'crypto_portfolio', value: JSON.stringify(portfolio) }, { onConflict: 'key' })
  }

  async function addPortfolioEntry() {
    if (!newAmount || !newEntryPrice) return
    portfolio = [...portfolio, {
      id: Date.now().toString(),
      coin: newCoin,
      amount: parseFloat(newAmount),
      entryPrice: parseFloat(newEntryPrice)
    }]
    newAmount = ''; newEntryPrice = ''
    await savePortfolio()
  }

  async function removePortfolioEntry(id) {
    portfolio = portfolio.filter(e => e.id !== id)
    await savePortfolio()
  }

  function currentPrice(coin) {
    if (!cryptoSignal) return 0
    if (coin === 'BTC') return cryptoSignal.btcPrice || 0
    if (coin === 'ETH') return cryptoSignal.ethPrice || 0
    return 0
  }

  onMount(() => {
    loadCryptoSignal()
    loadPortfolio()
    const interval = setInterval(loadCryptoSignal, 5 * 60 * 1000)
    return () => clearInterval(interval)
  })

  load()

  let aiMessages = $state([])
  let aiInput = $state('')
  let aiLoading = $state(false)

  async function sendAI(rawMsg) {
    const msg = (typeof rawMsg === 'string' && rawMsg.trim()) ? rawMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    aiInput = ''
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
  <div class="sh">Subscriptions &amp; Services</div>

  <div class="add-row">
    <input class="inp" bind:value={newName} placeholder="Service name..." onkeydown={e => e.key === 'Enter' && add()} />
    <button class="btn btn-gold" onclick={add}>+ Add</button>
  </div>

  {#if loading}
    <div class="empty">Loading...</div>
  {:else if !items.length}
    <div class="empty">No entries yet.</div>
  {:else}
    {#each items as f (f.id)}
      <div class="sub-card {f._exp ? 'exp' : ''}">
        <div class="sub-head" onclick={() => toggle(f)}>
          <div class="reorder-col" onclick={e => e.stopPropagation()}>
            <button class="reorder-micro" onclick={() => move(f, -1)}>▲</button>
            <button class="reorder-micro" onclick={() => move(f, 1)}>▼</button>
          </div>
          <span class="sub-name">{f.name}</span>
          {#if f.billing_day}
            <span class="billing-day">day {f.billing_day}</span>
          {/if}
          {#if f.amount}
            <span class="sub-amt">CHF {parseFloat(f.amount).toFixed(2)}</span>
            <span class="sub-renewal">{f.renewal || 'monthly'}</span>
          {/if}
          <button class="del-btn" onclick={e => { e.stopPropagation(); del(f.id) }}>×</button>
          <span class="sub-arr">▶</span>
        </div>
        {#if f._exp}
          <div class="sub-body">
            <div class="field-row">
              <div class="field-lbl">AMOUNT (CHF)</div>
              <input class="inp" type="number" step="0.01" placeholder="0.00"
                value={f.amount || ''}
                oninput={e => { f.amount = e.target.value; items = [...items]; save(f) }} />
            </div>
            <div class="field-row">
              <div class="field-lbl">RENEWAL</div>
              <select class="inp" value={f.renewal || 'monthly'} onchange={e => { f.renewal = e.target.value; items = [...items]; save(f) }}>
                {#each RENEWALS as r}<option value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>{/each}
              </select>
            </div>
            <div class="field-row">
              <div class="field-lbl">BILLING DAY <span style="font-size:10px;color:#555;font-family:'DM Sans',sans-serif;font-weight:300;text-transform:none;letter-spacing:0">— day of month (1–31)</span></div>
              <input class="inp" type="number" min="1" max="31" placeholder="e.g. 15"
                value={f.billing_day || ''}
                oninput={e => { f.billing_day = e.target.value ? parseInt(e.target.value) : null; items = [...items]; save(f) }} />
            </div>
            <div class="field-row">
              <div class="field-lbl">NOTES</div>
              <input class="inp" placeholder="Notes..." value={f.notes || ''}
                onchange={e => { f.notes = e.target.value; items = [...items]; save(f) }} />
            </div>
          </div>
        {/if}
      </div>
    {/each}

    <div class="total-bar">
      <span class="total-lbl">Total / month</span>
      <span class="total-amt">CHF {total.toFixed(2)}</span>
    </div>
  {/if}

  <!-- CRYPTO SIGNAL -->
  <div class="crypto-section">
    <div class="sh" style="margin-top:24px">CRYPTO SIGNAL</div>

    {#if cryptoLoading}
      <div class="empty" style="padding:16px 0">Loading signals...</div>
    {:else if cryptoSignal?.ok}

      <div class="signal-block signal-{cryptoSignal.signal.toLowerCase().replace(/ /g,'-')}">
        <div class="signal-label">{cryptoSignal.emoji} {cryptoSignal.signal}</div>
        <div class="signal-suggestion">{cryptoSignal.suggestion}</div>
      </div>

      <div class="price-row">
        <span class="coin-label">BTC</span>
        <span class="coin-price">€{Math.round(cryptoSignal.btcPrice).toLocaleString()}</span>
        <span class="coin-change {cryptoSignal.btcChange24h > 0 ? 'up' : 'down'}">
          {cryptoSignal.btcChange24h > 0 ? '+' : ''}{cryptoSignal.btcChange24h?.toFixed(1)}%
        </span>
      </div>
      <div class="price-row">
        <span class="coin-label">ETH</span>
        <span class="coin-price">€{Math.round(cryptoSignal.ethPrice).toLocaleString()}</span>
        <span class="coin-change {cryptoSignal.ethChange24h > 0 ? 'up' : 'down'}">
          {cryptoSignal.ethChange24h > 0 ? '+' : ''}{cryptoSignal.ethChange24h?.toFixed(1)}%
        </span>
      </div>

      <div class="indicators">
        <div class="ind-row">
          <span class="ind-label">Fear &amp; Greed</span>
          <span class="ind-val">{cryptoSignal.fearGreed.value} · {cryptoSignal.fearGreed.label}</span>
        </div>
        {#if cryptoSignal.funding !== null}
          <div class="ind-row">
            <span class="ind-label">Funding Rate</span>
            <span class="ind-val">{cryptoSignal.funding?.toFixed(3)}%</span>
          </div>
        {/if}
        <div class="ind-row">
          <span class="ind-label">BTC Dominance</span>
          <span class="ind-val">{cryptoSignal.dominance}%</span>
        </div>
        <div class="ind-row">
          <span class="ind-label">Altseason</span>
          <span class="ind-val {cryptoSignal.altseasonSignal === 'ACTIVE' ? 'active' : ''}">{cryptoSignal.altseasonSignal}</span>
        </div>
      </div>

      {#if cryptoSignal.reasons?.length}
        <div class="signal-reasons">
          {#each cryptoSignal.reasons as reason}
            <div class="reason-item">· {reason}</div>
          {/each}
        </div>
      {/if}

      {#if cryptoSignal.polymarkets?.length}
        <button class="poly-toggle" onclick={() => showPolymarket = !showPolymarket}>
          🎯 POLYMARKET <span class="poly-arr {showPolymarket ? 'open' : ''}">▶</span>
        </button>
        {#if showPolymarket}
          <div class="poly-body">
            {#each cryptoSignal.polymarkets as m}
              {@const icon = m.yes_prob > 65 ? '🟢' : m.yes_prob > 45 ? '🟡' : '🔴'}
              <div class="poly-row">
                <span class="poly-prob" style="color:{m.yes_prob > 65 ? '#4caf82' : m.yes_prob > 45 ? '#e8a838' : '#e05a4a'}">{m.yes_prob}%</span>
                <span class="poly-icon">{icon}</span>
                <span class="poly-q">{m.question}</span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      {#if cryptoSignal.cg_trending?.trending?.length}
        {@const cgt = cryptoSignal.cg_trending}
        {@const cgg = cryptoSignal.cg_global || {}}
        <button class="poly-toggle" onclick={() => showTrending = !showTrending}>
          🔍 TRENDING NOW <span class="poly-arr {showTrending ? 'open' : ''}">▶</span>
          {#if cgt.monitored_trending?.length}
            <span class="trend-alert">⚡ {cgt.monitored_trending.map(t => t.symbol).join(' ')}</span>
          {/if}
        </button>
        {#if showTrending}
          <div class="poly-body">
            {#if cgg.btc_dominance != null}
              <div class="trend-global">
                <span class="trend-dom">BTC dom: <b style="color:{cgg.btc_dominance > 55 ? '#e8a838' : cgg.btc_dominance < 45 ? '#4caf82' : '#cec9c1'}">{cgg.btc_dominance.toFixed(1)}%</b></span>
                {#if cgg.market_cap_change_24h != null}
                  <span class="trend-mktcap" style="color:{cgg.market_cap_change_24h > 0 ? '#4caf82' : '#e05a4a'}">
                    Market {cgg.market_cap_change_24h > 0 ? '+' : ''}{cgg.market_cap_change_24h.toFixed(2)}%
                  </span>
                {/if}
              </div>
            {/if}
            {#each cgt.trending as t}
              {@const isMonitored = MONITORED_SYMS.has(t.symbol)}
              <div class="trend-row {isMonitored ? 'monitored' : ''}">
                <span class="trend-rank">{isMonitored ? '⚡' : t.rank + '.'}</span>
                <span class="trend-sym" style="color:{isMonitored ? '#c9a84c' : '#cec9c1'}">{t.symbol}</span>
                <span class="trend-name">{t.name}</span>
                {#if t.market_cap_rank}<span class="trend-mcr">#{t.market_cap_rank}</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <!-- Monitored coins live prices -->
      {#if Object.keys(allCoinPrices).length}
        <div class="section-title" style="margin-top:12px;margin-bottom:4px">MONITORED COINS</div>
        {#each MONITORED_COINS as coin}
          {@const data = allCoinPrices[coin]}
          {@const activeTrade = cryptoSignal?.active_trades?.find(t => t.coin === coin)}
          {#if data}
            <div class="price-row">
              <span class="coin-label">{coin}</span>
              <span class="coin-price">
                {data.price < 0.01 ? '€' + data.price?.toFixed(6) : '€' + Math.round(data.price).toLocaleString()}
              </span>
              <span class="coin-change {data.change24h > 0 ? 'up' : 'down'}">
                {data.change24h > 0 ? '+' : ''}{data.change24h?.toFixed(1)}%
              </span>
              {#if activeTrade}
                <span style="font-size:9px;color:#c9a84c;font-family:'Space Mono',monospace;margin-left:6px">ACTIVE</span>
              {/if}
            </div>
          {/if}
        {/each}
      {/if}

      {#if cryptoSignal.active_trades?.length}
        <div class="section-title" style="margin-top:12px;margin-bottom:4px">ACTIVE TRADES</div>
        {#each cryptoSignal.active_trades as trade}
          {@const fmtEntry = trade.entry_price < 1 ? trade.entry_price?.toFixed(4) : Math.round(trade.entry_price).toLocaleString()}
          <div class="active-trade-row {(trade.pnl_pct || 0) >= 0 ? 'profit' : 'loss'}"
            style="border-left: 3px solid {(trade.pnl_pct || 0) >= 5 ? '#00c853' : (trade.pnl_pct || 0) <= -5 ? '#e05a4a' : (trade.pnl_pct || 0) > 0 ? '#4caf82' : '#ff6b35'};padding-left:8px">
            <span class="coin-label">{trade.coin}</span>
            <span class="coin-price" style="font-size:11px">entry €{fmtEntry}</span>
            <span class="coin-change {(trade.pnl_pct || 0) >= 0 ? 'up' : 'down'}" style="margin-left:auto">
              {(trade.pnl_pct || 0) >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(2)}%
              (€{Math.round(trade.pnl_eur || 0)})
            </span>
          </div>
        {/each}
      {/if}

      {#if cryptoSignal.binanceAction === 'buy'}
        <a href={cryptoSignal.binanceDeepLink} target="_blank" class="binance-btn">Open Binance →</a>
      {:else if cryptoSignal.binanceAction === 'sell'}
        <a href={cryptoSignal.binanceDeepLink} target="_blank" class="binance-btn sell">Sell on Binance →</a>
      {/if}

      <button class="refresh-btn" onclick={loadCryptoSignal}>↻ Refresh</button>
    {:else if cryptoSignal}
      <div class="empty" style="padding:10px 0;font-size:11px;color:#444">Signal unavailable — check watcher</div>
      <button class="refresh-btn" onclick={loadCryptoSignal}>↻ Retry</button>
    {/if}

    <!-- Live Binance -->
    {#if cryptoSignal?.binance_portfolio?.length}
      <div class="sh" style="margin-top:20px">LIVE BINANCE</div>
      {#each cryptoSignal.binance_portfolio.filter(b => ['BTC','ETH','BNB','EUR','USDT','USDC'].includes(b.coin)) as balance}
        <div class="price-row">
          <span class="coin-label">{balance.coin}</span>
          <span class="coin-price">{balance.total.toFixed(6)}</span>
          {#if balance.coin === 'BTC' && cryptoSignal.btcPrice}
            <span class="coin-change up">€{Math.round(balance.total * cryptoSignal.btcPrice).toLocaleString()}</span>
          {:else if balance.coin === 'ETH' && cryptoSignal.ethPrice}
            <span class="coin-change up">€{Math.round(balance.total * cryptoSignal.ethPrice).toLocaleString()}</span>
          {/if}
          {#if balance.locked > 0}
            <span style="font-size:9px;color:#444">({balance.locked.toFixed(6)} locked)</span>
          {/if}
        </div>
      {/each}
      {@const totalEur =
        (cryptoSignal.binance_portfolio.find(b => b.coin === 'BTC')?.total || 0) * (cryptoSignal.btcPrice || 0) +
        (cryptoSignal.binance_portfolio.find(b => b.coin === 'ETH')?.total || 0) * (cryptoSignal.ethPrice || 0) +
        (cryptoSignal.binance_portfolio.find(b => b.coin === 'EUR')?.total || 0) +
        (cryptoSignal.binance_portfolio.find(b => b.coin === 'USDT')?.total || 0)}
      <div class="price-row" style="border-top:1px solid #1c1c1c;margin-top:6px;padding-top:6px">
        <span class="coin-label" style="color:#c9a84c">TOTAL</span>
        <span class="coin-price" style="color:#c9a84c">€{Math.round(totalEur).toLocaleString()}</span>
      </div>
    {:else if cryptoSignal && cryptoSignal.binance_portfolio === null}
      <div class="sh" style="margin-top:20px">LIVE BINANCE</div>
      <div class="empty" style="font-size:11px;color:#333;padding:8px 0">Add BINANCE_API_KEY + BINANCE_SECRET_KEY to .env for live balance tracking</div>
    {/if}

    <!-- Portfolio tracker -->
    <div class="sh" style="margin-top:20px">MY PORTFOLIO</div>

    {#each portfolio as entry}
      {@const cur = currentPrice(entry.coin)}
      {@const curVal = Math.round(entry.amount * cur)}
      {@const pnlPct = cur > 0 ? ((cur - entry.entryPrice) / entry.entryPrice * 100).toFixed(1) : null}
      <div class="portfolio-row">
        <span class="p-coin">{entry.coin}</span>
        <span class="p-amount">{entry.amount}</span>
        <span class="p-entry">@ €{entry.entryPrice.toLocaleString()}</span>
        <span class="p-value">€{cur > 0 ? curVal.toLocaleString() : '—'}</span>
        {#if pnlPct !== null}
          <span class="p-pnl {parseFloat(pnlPct) >= 0 ? 'up' : 'down'}">{parseFloat(pnlPct) >= 0 ? '+' : ''}{pnlPct}%</span>
        {/if}
        <button class="del-btn" onclick={() => removePortfolioEntry(entry.id)}>×</button>
      </div>
    {/each}

    <div class="add-row" style="margin-top:8px">
      <select bind:value={newCoin} class="inp" style="width:auto;flex-shrink:0">
        <option>BTC</option>
        <option>ETH</option>
        <option>SOL</option>
      </select>
      <input class="inp" bind:value={newAmount} placeholder="Amount" type="number" step="any" />
      <input class="inp" bind:value={newEntryPrice} placeholder="Entry €" type="number" step="any" />
      <button class="btn btn-gold" onclick={addPortfolioEntry}>+</button>
    </div>
  </div>

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
      <button class="btn-gold-sm" onclick={() => sendAI()}>Ask</button>
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
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); padding-bottom: 6px; border-bottom: 1px solid #303030; margin-bottom: 14px; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: #9e9690; padding: 32px 0; text-align: center; }

  .add-row { display: flex; gap: 8px; margin-bottom: 14px; }
  .inp { background: #1c1c1c; border: 1px solid #3c3c3c; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 4px 8px; outline: none; border-radius: 3px; transition: border-color .2s; width: 100%; }
  .inp:focus { border-color: rgba(201,168,76,.5); }
  .inp::placeholder { color: #9e9690; }
  .btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 7px 14px; border: none; cursor: pointer; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
  .btn-gold { background: #c9a84c; color: #0a0a0a; }
  .btn-gold:hover { background: #d4b060; }

  .sub-card { border-bottom: 1px solid #1a1a1a; background: transparent; }
  .sub-card.exp { border-bottom-color: rgba(201,168,76,.2); }
  .sub-head { padding: 6px 10px; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; transition: background .15s; }
  .sub-head:hover { background: rgba(255,255,255,.015); }
  .sub-card.exp .sub-head { background: rgba(201,168,76,.03); }
  .sub-name { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; flex: 1; color: #cec9c1; }
  .sub-card.exp .sub-name { color: #c9a84c; }
  .billing-day { font-family: 'Space Mono', monospace; font-size: 9px; color: #3a3a3a; flex-shrink: 0; }
  .sub-amt { font-family: 'Space Mono', monospace; font-size: 11px; color: #cec9c1; flex-shrink: 0; text-align: right; }
  .sub-card.exp .sub-amt { color: #c9a84c; }
  .sub-renewal { font-family: 'Space Mono', monospace; font-size: 7px; color: #444; flex-shrink: 0; text-transform: uppercase; letter-spacing: .06em; }
  .sub-arr { font-size: 9px; color: #444; transition: transform .2s; font-family: 'Space Mono', monospace; flex-shrink: 0; }
  .sub-card.exp .sub-arr { transform: rotate(90deg); }

  .reorder-col { display: flex; flex-direction: column; gap: 0; flex-shrink: 0; }
  .reorder-micro { font-size: 9px; padding: 1px 2px; background: transparent; border: none; color: #252525; cursor: pointer; line-height: 1; }
  .reorder-micro:hover { color: #555; }
  .del-btn { background: transparent; border: none; color: #1c1c1c; font-size: 15px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }

  .sub-body { padding: 8px 10px; border-top: 1px solid #1a1a1a; display: flex; flex-direction: column; gap: 6px; background: #050505; }
  .field-row { display: flex; flex-direction: column; gap: 4px; }
  .field-lbl { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: rgba(201,168,76,.5); }

  .total-bar { border: 1px solid rgba(201,168,76,.2); border-radius: 3px; padding: 8px 12px; background: rgba(201,168,76,.04); display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
  .total-lbl { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #555; }
  .total-amt { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; color: #c9a84c; }
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

  /* Crypto */
  .crypto-section { margin-top: 4px; }
  .signal-block { padding: 10px 12px; border-radius: 3px; margin-bottom: 10px; border-left: 3px solid #444; }
  .signal-block.signal-strong-buy { border-left-color: #00c853; background: rgba(0,200,83,.08); }
  .signal-block.signal-strong-buy .signal-label { color: #00c853; }
  .signal-block.signal-bullish { border-left-color: #4caf82; background: rgba(76,175,130,.05); }
  .signal-block.signal-bullish .signal-label { color: #4caf82; }
  .signal-block.signal-neutral { border-left-color: #f5a623; background: rgba(245,166,35,.05); }
  .signal-block.signal-neutral .signal-label { color: #f5a623; }
  .signal-block.signal-bearish { border-left-color: #ff6b35; background: rgba(255,107,53,.05); }
  .signal-block.signal-bearish .signal-label { color: #ff6b35; }
  .signal-block.signal-strong-sell { border-left-color: #e05a4a; background: rgba(224,90,74,.08); }
  .signal-block.signal-strong-sell .signal-label { color: #e05a4a; }
  .signal-label { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #cec9c1; margin-bottom: 4px; }
  .signal-suggestion { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #9e9690; }
  .active-trade-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-left: 2px solid #333; margin-bottom: 2px; }
  .active-trade-row.profit { border-left-color: #4caf82; }
  .active-trade-row.loss { border-left-color: #e05a4a; }
  .price-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid #111; }
  .coin-label { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; width: 30px; }
  .coin-price { font-family: 'Space Mono', monospace; font-size: 13px; color: #cec9c1; flex: 1; }
  .coin-change { font-family: 'Space Mono', monospace; font-size: 11px; }
  .coin-change.up { color: #4caf82; }
  .coin-change.down { color: #e05a4a; }
  .indicators { margin: 10px 0; }
  .ind-row { display: flex; justify-content: space-between; padding: 3px 0; font-family: 'DM Sans', sans-serif; font-size: 11px; }
  .ind-label { color: #555; }
  .ind-val { color: #9e9690; }
  .ind-val.active { color: #c9a84c; }
  .signal-reasons { margin: 8px 0; }
  .reason-item { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #666; padding: 1px 0; }
  .binance-btn { display: inline-block; margin-top: 10px; font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; background: #c9a84c; color: #0a0a0a; padding: 6px 14px; border-radius: 3px; text-decoration: none; letter-spacing: .06em; }
  .binance-btn:hover { background: #d4b862; }
  .binance-btn.sell { background: #e05a4a; }
  .binance-btn.sell:hover { background: #e86f60; }
  .refresh-btn { display: block; margin-top: 8px; font-family: 'Space Mono', monospace; font-size: 9px; background: transparent; border: 1px solid #252525; color: #444; padding: 3px 8px; border-radius: 2px; cursor: pointer; }
  .refresh-btn:hover { color: #9e9690; }
  .poly-toggle { display: flex; align-items: center; gap: 6px; width: 100%; background: transparent; border: none; border-top: 1px solid #252525; color: rgba(201,168,76,.65); font-family: 'Space Mono', monospace; font-size: 10px; padding: 7px 0 4px; cursor: pointer; margin-top: 8px; }
  .poly-toggle:hover { color: #c9a84c; }
  .poly-arr { font-size: 8px; transition: transform .2s; }
  .poly-arr.open { transform: rotate(90deg); }
  .poly-body { margin: 4px 0 6px; display: flex; flex-direction: column; gap: 4px; }
  .poly-row { display: flex; align-items: flex-start; gap: 6px; }
  .poly-prob { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; min-width: 32px; }
  .poly-icon { font-size: 10px; }
  .poly-q { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #9e9690; line-height: 1.3; }
  .trend-alert { font-size: 9px; color: #c9a84c; margin-left: auto; }
  .trend-global { display: flex; gap: 12px; padding: 4px 0 6px; border-bottom: 1px solid #252525; margin-bottom: 4px; }
  .trend-dom, .trend-mktcap { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #666; }
  .trend-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .trend-row.monitored { background: rgba(201,168,76,.04); border-radius: 2px; padding: 2px 4px; }
  .trend-rank { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; min-width: 16px; }
  .trend-sym { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; min-width: 44px; }
  .trend-name { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #666; flex: 1; }
  .trend-mcr { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; }
  .portfolio-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #111; font-family: 'Space Mono', monospace; font-size: 10px; flex-wrap: wrap; }
  .p-coin { color: #c9a84c; width: 30px; }
  .p-amount { color: #cec9c1; }
  .p-entry { color: #555; }
  .p-value { color: #cec9c1; margin-left: auto; }
  .p-pnl { font-size: 10px; }
  .p-pnl.up { color: #4caf82; }
  .p-pnl.down { color: #e05a4a; }
</style>