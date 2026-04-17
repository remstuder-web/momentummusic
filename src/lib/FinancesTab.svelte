<script>
  import { supabase } from './supabase.js'

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

  load()
</script>

<div class="finances-wrap">
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
</div>

<style>
  .finances-wrap { width: 100%; }
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
</style>