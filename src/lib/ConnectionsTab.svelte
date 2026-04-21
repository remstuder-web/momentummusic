<script>
  import { supabase } from './supabase.js'
  import { GENRE_LIST } from '$lib/genres.js'

  const GROUPS = ['ARTISTS', 'PRODUCERS', 'MIXERS', 'MUSIC INDUSTRY']

  let connections = $state([])
  let patches = $state([])
  let loading = $state(true)
  let expandedId = $state(null)
  let newName = $state('')
  let newGroup = $state('MUSIC INDUSTRY')
  let showGroupPicker = $state(false)
  let editingNoteId = $state(null)
  let viaPickerOpen = $state({})

  function viaNames(conn) {
    const ids = conn.via_ids || []
    return ids.map(id => connections.find(c => c.id == id)?.name).filter(Boolean)
  }

  let grouped = $derived(
    GROUPS.map(g => ({
      label: g,
      items: connections
        .filter(c => {
          const types = c.group_types?.length ? c.group_types : (c.group_type ? [c.group_type] : ['MUSIC INDUSTRY'])
          return types.includes(g)
        })
        .slice().sort((a,b) => (a.name||'').localeCompare(b.name||''))
    }))
  )

  function markdownToHtml(text) {
    if (!text) return ''
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\\n/g, '\n')
      .replace(/^### (.+)$/gm, '<b style="font-size:12px;color:#c9a84c">$1</b>')
      .replace(/^## (.+)$/gm, '<b style="font-size:13px;color:#c9a84c">$1</b>')
      .replace(/^# (.+)$/gm, '<b style="font-size:14px;color:#c9a84c">$1</b>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\b_(.+?)_\b/g, '<em>$1</em>')
      .replace(/^[-•] (.+)$/gm, '• $1')
      .replace(/\n/g, '<br>')
  }

  function autoResize(node) {
    function resize() { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px' }
    setTimeout(resize, 0)
    node.addEventListener('input', resize)
    return { destroy() { node.removeEventListener('input', resize) } }
  }

  async function load() {
    const [connRes, patchRes] = await Promise.all([
      supabase.from('connections').select('*').order('name'),
      supabase.from('patches')
        .select('id, name, status, sent_at, contact_id, folder_link')
        .in('status', ['sent', 'deleted'])
        .not('contact_id', 'is', null)
        .order('sent_at', { ascending: false })
    ])
    connections = connRes.data || []
    patches = patchRes.data || []
    loading = false
  }

  function activeSubs(connId) {
    return patches.filter(p => String(p.contact_id) === String(connId) && p.status === 'sent')
  }
  function inactiveSubs(connId) {
    return patches.filter(p => String(p.contact_id) === String(connId) && p.status === 'deleted')
  }

  async function addConnection() {
    if (!newName.trim()) return
    const { data } = await supabase.from('connections')
      .insert({ name: newName.trim(), group_types: [newGroup], position: connections.length })
      .select().single()
    connections = [...connections, data]
    newName = ''
    expandedId = data.id
  }

  async function updateField(conn, field, value) {
    conn[field] = value
    connections = [...connections]
    await supabase.from('connections').update({ [field]: value }).eq('id', conn.id)
  }

  async function deleteConnection(id) {
    if (!confirm('Delete this connection?')) return
    await supabase.from('connections').delete().eq('id', id)
    connections = connections.filter(c => c.id !== id)
    if (expandedId === id) expandedId = null
  }

  async function deleteInactiveSub(patchId) {
    await supabase.from('patches').delete().eq('id', patchId)
    patches = patches.filter(p => p.id !== patchId)
  }

  function openLink(url) {
    if (!url) return
    window.open(url.startsWith('http') ? url : 'https://' + url, '_blank')
  }

  function instaUrl(handle) {
    if (!handle) return null
    return `https://instagram.com/${handle.replace(/^@/, '').replace(/.*instagram\.com\//, '')}`
  }

  function tiktokUrl(handle) {
    if (!handle) return null
    return `https://tiktok.com/@${handle.replace(/^@/, '').replace(/.*tiktok\.com\/@?/, '')}`
  }

  load()
</script>

<svelte:window onclick={() => { if (showGroupPicker) showGroupPicker = false; viaPickerOpen = {} }} />

<div class="top-bar">
  <div class="sh">Connections</div>
</div>

<div class="add-row">
  <input class="add-inp" bind:value={newName} placeholder="New contact name..." onkeydown={e => e.key === 'Enter' && addConnection()} />
  <div class="group-pick-wrap" onclick={e => e.stopPropagation()}>
    <button class="group-pick-btn" onclick={() => showGroupPicker = !showGroupPicker}>{newGroup} ▾</button>
    {#if showGroupPicker}
      <div class="group-pick-list">
        {#each GROUPS as g}
          <button class="group-pick-opt {newGroup === g ? 'sel' : ''}" onclick={() => { newGroup = g; showGroupPicker = false }}>{g}</button>
        {/each}
      </div>
    {/if}
  </div>
  <button class="add-btn" onclick={addConnection}>+ ADD</button>
</div>

{#if loading}
  <p class="empty">Loading...</p>
{:else if !connections.length}
  <p class="empty">No connections yet.</p>
{:else}
  {#each grouped as group}
    {#if group.items.length}
      <div class="group-section">
        <div class="group-title">{group.label} <span class="group-count">{group.items.length}</span></div>
        <div class="list">
          {#each group.items as conn (conn.id)}
            {@const activeSs = activeSubs(conn.id)}
            {@const inactiveSs = inactiveSubs(conn.id)}
            {@const connTypes = conn.group_types?.length ? conn.group_types : (conn.group_type ? [conn.group_type] : ['MUSIC INDUSTRY'])}
            <div class="conn-card {expandedId === conn.id ? 'exp' : ''}">

              <!-- Collapsed row -->
              <div class="conn-head" onclick={() => expandedId = expandedId === conn.id ? null : conn.id}>
                <input class="conn-name-input" value={conn.name}
                  onclick={e => e.stopPropagation()}
                  onchange={e => updateField(conn, 'name', e.target.value)}
                  onkeydown={e => e.key === 'Enter' && e.target.blur()} />
                {#each connTypes as t}
                  <span class="type-badge">{t}</span>
                {/each}
                {#if conn.instagram}
                  <button
                    class="social-btn insta head-ig"
                    onclick={e => { e.stopPropagation(); openLink(instaUrl(conn.instagram)) }}
                    title="Open Instagram"
                  >IG</button>
                {/if}
                {#if conn.personal}
                  <span class="personal-dot" title="Personal contact"></span>
                {/if}
                {#if conn.genre}
                  <span class="conn-genre">{conn.genre}</span>
                {/if}
                <span class="conn-spacer"></span>
                {#if conn.last_contact}
                  <span class="conn-last">{conn.last_contact}</span>
                {/if}
                {#if activeSs.length || inactiveSs.length}
                  <span class="sub-count {activeSs.length ? 'active' : 'inactive'}">{activeSs.length + inactiveSs.length}s</span>
                {/if}
                {#if (conn.via_ids||[]).length}
                  <span class="conn-via">VIA {viaNames(conn).join(', ')}</span>
                {/if}
                <span class="arr {expandedId === conn.id ? 'open' : ''}">▶</span>
              </div>

              {#if expandedId === conn.id}
                <div class="conn-body">

                  <label class="personal-check-row">
                    <input type="checkbox"
                      checked={conn.personal || false}
                      onchange={e => updateField(conn, 'personal', e.target.checked)}
                    />
                    <span>Personal contact</span>
                  </label>

                  <div class="field">
                    <div class="field-label">GROUP</div>
                    <div class="inline-group-row">
                      {#each GROUPS as g}
                        {@const isOn = connTypes.includes(g)}
                        <button class="group-tag {isOn ? 'on' : ''}"
                          onclick={() => {
                            const next = isOn
                              ? (connTypes.length > 1 ? connTypes.filter(x => x !== g) : connTypes)
                              : [...connTypes, g]
                            updateField(conn, 'group_types', next)
                            updateField(conn, 'group_type', next[0])
                          }}>{g}</button>
                      {/each}
                    </div>
                  </div>

                  <div class="row2">
                    <div class="field">
                      <div class="field-label">EMAIL</div>
                      <input class="inp-sm" value={conn.email||''} placeholder="email@..." onchange={e => updateField(conn, 'email', e.target.value)} />
                    </div>
                    <div class="field">
                      <div class="field-label">PHONE</div>
                      <input class="inp-sm" value={conn.phone||''} placeholder="+41..." onchange={e => updateField(conn, 'phone', e.target.value)} />
                    </div>
                  </div>

                  <div class="row2">
                    <div class="field">
                      <div class="field-label">INSTAGRAM</div>
                      <div class="inp-with-btn">
                        <input class="inp-sm" value={conn.instagram||''} placeholder="@handle or URL..."
                          onchange={e => {
                            const val = e.target.value
                            updateField(conn, 'instagram', val)
                            if (val && (val.includes('@') || val.includes('instagram'))) {
                              clearTimeout(window._igFetchTimer)
                              window._igFetchTimer = setTimeout(() => {
                                fetch('http://localhost:4242/fetch-instagram', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ handle: val })
                                })
                                .then(r => r.json())
                                .then(d => {
                                  if (d.ok && d.profile) {
                                    if (!conn.name || conn.name === 'New Contact') {
                                      updateField(conn, 'name', d.profile.full_name || d.profile.username)
                                    }
                                    if (d.profile.followers) {
                                      updateField(conn, 'ig_followers', d.profile.followers)
                                    }
                                    if (d.profile.bio) {
                                      updateField(conn, 'ig_bio', d.profile.bio)
                                    }
                                  }
                                })
                                .catch(() => {})
                              }, 500)
                            }
                          }}
                        />
                        {#if conn.instagram}
                          <button class="social-btn insta" onclick={() => openLink(instaUrl(conn.instagram))}>IG</button>
                        {/if}
                      </div>
                      {#if conn.ig_followers}
                        <div class="ig-stats">
                          {conn.ig_followers?.toLocaleString()} followers
                          {#if conn.ig_bio}· {conn.ig_bio.slice(0, 60)}{/if}
                        </div>
                      {/if}
                    </div>
                    <div class="field">
                      <div class="field-label">TIKTOK</div>
                      <div class="inp-with-btn">
                        <input class="inp-sm" value={conn.tiktok||''} placeholder="@handle or URL..." onchange={e => updateField(conn, 'tiktok', e.target.value)} />
                        {#if conn.tiktok}
                          <button class="social-btn tiktok" onclick={() => openLink(tiktokUrl(conn.tiktok))}>TT</button>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <div class="row2">
                    <div class="field">
                      <div class="field-label">GENRE</div>
                      <select class="inp-sm genre-select-conn" value={conn.genre||''} onchange={e => updateField(conn, 'genre', e.target.value)}>
                        <option value="">— genre —</option>
                        {#each GENRE_LIST as g}
                          {#if g.type === 'main'}
                            <option disabled style="font-weight:700;color:#c9a84c">{g.label}</option>
                          {:else}
                            <option value={g.tag}>{g.label}</option>
                          {/if}
                        {/each}
                      </select>
                    </div>
                    <div class="field">
                      <div class="field-label">LAST CONTACT</div>
                      <input class="inp-sm" type="date" value={conn.last_contact||''} onchange={e => updateField(conn, 'last_contact', e.target.value)} />
                    </div>
                  </div>

                  <div class="row2">
                    <div class="field">
                      <div class="field-label">CONTACT PERSON</div>
                      <input class="inp-sm" value={conn.contact_person||''} placeholder="Name..." onchange={e => updateField(conn, 'contact_person', e.target.value)} />
                    </div>
                    <div class="field">
                      <div class="field-label">VIA</div>
                      <div class="via-wrap" onclick={e => e.stopPropagation()}>
                        <div class="via-tags-row">
                          {#each (conn.via_ids||[]) as vid}
                            {#if connections.find(c => c.id == vid)}
                              <span class="via-tag">
                                {connections.find(c => c.id == vid)?.name}
                                <button class="via-tag-del" onclick={() => updateField(conn, 'via_ids', (conn.via_ids||[]).filter(id => id != vid))}>×</button>
                              </span>
                            {/if}
                          {/each}
                          <div class="via-pick-row">
                            <button class="via-add-btn" onclick={() => { viaPickerOpen = {...viaPickerOpen, [conn.id]: !viaPickerOpen[conn.id]} }}>+ Add via</button>
                            {#if viaPickerOpen[conn.id]}
                              <div class="via-pick-list">
                                {#each connections.filter(c => c.id !== conn.id && !(conn.via_ids||[]).includes(c.id)) as c}
                                  <button class="via-pick-opt" onclick={() => {
                                    updateField(conn, 'via_ids', [...(conn.via_ids||[]), c.id])
                                    viaPickerOpen = {...viaPickerOpen, [conn.id]: false}
                                  }}>{c.name}</button>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="field">
                    <div class="field-label">NOTES</div>
                    {#if editingNoteId === conn.id}
                      <textarea class="ta ta-auto" placeholder="Notes about this contact..."
                        value={conn.notes||''} use:autoResize
                        oninput={e => updateField(conn, 'notes', e.target.value)}
                        onblur={() => editingNoteId = null}></textarea>
                    {:else}
                      <div class="notes-rendered {conn.notes ? '' : 'empty'}"
                        onclick={() => editingNoteId = conn.id} title="Click to edit">
                        {#if conn.notes}
                          {@html markdownToHtml(conn.notes)}
                        {:else}
                          <span class="notes-placeholder">Click to add notes...</span>
                        {/if}
                      </div>
                    {/if}
                  </div>

                  <!-- Submissions -->
                  <div class="field">
                    <div class="field-label">SUBMISSIONS</div>
                    <button class="subs-toggle" onclick={() => { conn._subsActiveOpen = !conn._subsActiveOpen; connections = [...connections] }}>
                      <span class="subs-sub-label active-label">ACTIVE {activeSs.length ? '('+activeSs.length+')' : '(0)'}</span>
                      <span class="subs-arr {conn._subsActiveOpen ? 'open' : ''}">▶</span>
                    </button>
                    {#if conn._subsActiveOpen}
                      <div class="subs-list">
                        {#if activeSs.length}
                          {#each activeSs as sub}
                            <div class="sub-row">
                              <span class="sub-name">{sub.name}{(conn.via_ids||[]).length ? ' · VIA '+viaNames(conn).join(', ') : ''}</span>
                              <span class="sub-date">{sub.sent_at ? new Date(sub.sent_at).toLocaleDateString('de-CH') : ''}</span>
                              {#if sub.folder_link}
                                <button class="sub-link-btn" onclick={() => { openLink(sub.folder_link); navigator.clipboard.writeText(sub.folder_link).catch(()=>{}) }}>🔗 Open</button>
                              {:else}
                                <span class="sub-no-link">no link</span>
                              {/if}
                            </div>
                          {/each}
                        {:else}
                          <div class="subs-empty">No active submissions.</div>
                        {/if}
                      </div>
                    {/if}
                    {#if inactiveSs.length}
                      <button class="subs-toggle" style="margin-top:4px" onclick={() => { conn._subsInactiveOpen = !conn._subsInactiveOpen; connections = [...connections] }}>
                        <span class="subs-sub-label inactive-label">INACTIVE ({inactiveSs.length})</span>
                        <span class="subs-arr {conn._subsInactiveOpen ? 'open' : ''}">▶</span>
                      </button>
                      {#if conn._subsInactiveOpen}
                        <div class="subs-list">
                          {#each inactiveSs as sub}
                            <div class="sub-row inactive">
                              <span class="sub-name">{sub.name}</span>
                              <span class="sub-date">{sub.sent_at ? new Date(sub.sent_at).toLocaleDateString('de-CH') : ''}</span>
                              {#if sub.folder_link}
                                <button class="sub-link-btn dim" onclick={() => { openLink(sub.folder_link); navigator.clipboard.writeText(sub.folder_link).catch(()=>{}) }}>🔗 Open</button>
                              {/if}
                              <button class="sub-del-btn" onclick={() => deleteInactiveSub(sub.id)} title="Delete">×</button>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>

                  <div class="conn-footer">
                    <button class="btn-delete" onclick={() => deleteConnection(conn.id)}>Delete</button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/each}
{/if}

<style>
  .top-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); padding-bottom: 6px; border-bottom: 1px solid #303030; }
  .add-row { display: flex; gap: 8px; margin-bottom: 18px; align-items: center; }
  .add-inp { background: #1c1c1c; border: 1px solid #3c3c3c; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 6px 10px; outline: none; border-radius: 3px; flex: 1; transition: border-color .2s; }
  .add-inp:focus { border-color: rgba(201,168,76,.5); }
  .add-inp::placeholder { color: #555; }
  .add-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; padding: 7px 14px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
  .group-pick-wrap { position: relative; flex-shrink: 0; }
  .group-pick-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 6px 10px; background: #1c1c1c; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; white-space: nowrap; letter-spacing: .06em; }
  .group-pick-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .group-pick-list { position: absolute; top: calc(100% + 4px); right: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 99; min-width: 160px; overflow: hidden; }
  .group-pick-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px 12px; background: transparent; border: none; border-bottom: 1px solid #1a1a1a; color: #9e9690; cursor: pointer; text-align: left; }
  .group-pick-opt:last-child { border-bottom: none; }
  .group-pick-opt:hover, .group-pick-opt.sel { background: #252525; color: #c9a84c; }

  .empty { font-family: 'Space Mono', monospace; font-size: 13px; color: #555; padding: 40px 0; text-align: center; }

  .group-section { margin-bottom: 16px; }
  .group-title { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.5); text-transform: uppercase; padding: 0 0 5px; border-bottom: 1px solid #1a1a1a; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
  .group-count { color: #333; font-size: 9px; }

  .list { display: flex; flex-direction: column; }
  .conn-card { border-bottom: 1px solid #1a1a1a; }
  .conn-card.exp { border-bottom-color: rgba(201,168,76,.2); }
  .conn-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; transition: background .15s; overflow: hidden; }
  .conn-head:hover { background: rgba(255,255,255,.02); }
  .conn-card.exp .conn-head { background: rgba(201,168,76,.03); }

  .conn-name-input { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #c9a84c; background: transparent; border: none; outline: none; padding: 0; width: 160px; min-width: 100px; max-width: 200px; cursor: text; letter-spacing: .04em; flex-shrink: 0; }
  .conn-name-input:focus { background: rgba(255,255,255,.03); border-radius: 2px; }

  .type-badge { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: .08em; padding: 2px 5px; background: rgba(255,255,255,.04); border: 1px solid #222; color: #555; border-radius: 2px; white-space: nowrap; flex-shrink: 0; }
  .conn-genre { font-family: 'Space Mono', monospace; font-size: 9px; color: #3a3a3a; flex-shrink: 0; }
  .conn-spacer { flex: 1; }
  .conn-last { font-family: 'Space Mono', monospace; font-size: 9px; color: #3a3a3a; flex-shrink: 0; }
  .conn-via { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; flex-shrink: 0; }
  .sub-count { font-family: 'Space Mono', monospace; font-size: 9px; flex-shrink: 0; }
  .sub-count.active { color: #4a9fd4; }
  .sub-count.inactive { color: #333; }
  .arr { font-size: 9px; color: #444; transition: transform .2s; flex-shrink: 0; }
  .arr.open { transform: rotate(90deg); }

  .conn-body { padding: 10px 10px 12px; border-top: 1px solid #1a1a1a; display: flex; flex-direction: column; gap: 7px; background: #050505; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .field { display: flex; flex-direction: column; gap: 3px; }
  .field-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: rgba(201,168,76,.5); }
  .inp-sm { background: #111; border: 1px solid #1a1a1a; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px; outline: none; border-radius: 3px; width: 100%; }
  .inp-sm:focus { border-color: rgba(201,168,76,.4); }
  .inp-with-btn { display: flex; gap: 4px; }
  .inp-with-btn .inp-sm { flex: 1; }

  .ta { background: #111; border: 1px solid #1a1a1a; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 300; padding: 6px 8px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 52px; line-height: 1.6; }
  .ta:focus { border-color: rgba(201,168,76,.35); }
  .ta-auto { resize: none; overflow: hidden; }
  .notes-rendered { background: #111; border: 1px solid #1a1a1a; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 300; padding: 6px 8px; border-radius: 3px; width: 100%; min-height: 28px; line-height: 1.7; cursor: text; word-break: break-word; }
  .notes-rendered:hover { border-color: rgba(201,168,76,.25); }
  .notes-placeholder { color: #2a2a2a; font-style: italic; font-size: 11px; }

  .inline-group-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .group-tag { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .08em; padding: 3px 8px; background: transparent; border: 1px solid #1a1a1a; color: #3a3a3a; border-radius: 2px; cursor: pointer; }
  .group-tag:hover { border-color: #444; color: #9e9690; }
  .group-tag.on { border-color: rgba(201,168,76,.4); color: #c9a84c; background: rgba(201,168,76,.05); }

  .via-wrap { display: flex; flex-direction: column; gap: 4px; }
  .via-tags-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .via-tag { display: flex; align-items: center; gap: 4px; font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; background: rgba(201,168,76,.06); border: 1px solid rgba(201,168,76,.2); color: #c9a84c; border-radius: 2px; }
  .via-tag-del { background: transparent; border: none; color: #7a6230; cursor: pointer; padding: 0; font-size: 12px; line-height: 1; }
  .via-tag-del:hover { color: #e05a4a; }
  .via-pick-row { position: relative; }
  .via-add-btn { font-family: 'Space Mono', monospace; font-size: 9px; padding: 2px 7px; background: transparent; border: 1px solid #1a1a1a; color: #444; border-radius: 2px; cursor: pointer; }
  .via-add-btn:hover { border-color: #444; color: #9e9690; }
  .via-pick-list { position: absolute; top: calc(100% + 4px); left: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 99; min-width: 180px; max-height: 180px; overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  .via-pick-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 7px 12px; background: transparent; border: none; border-bottom: 1px solid #1a1a1a; color: #9e9690; cursor: pointer; text-align: left; }
  .via-pick-opt:last-child { border-bottom: none; }
  .via-pick-opt:hover { background: #252525; color: #c9a84c; }

  .ig-stats { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #666; margin-top: 3px; font-style: italic; }

  .social-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 3px 7px; border: none; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .social-btn.insta { background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045); color: #fff; }
  .head-ig { font-size: 7px; padding: 1px 5px; flex-shrink: 0; }

  .personal-dot { width: 7px; height: 7px; border-radius: 50%; background: #4caf82; flex-shrink: 0; }
  .personal-check-row { display: flex; align-items: center; gap: 6px; font-family: 'Space Mono', monospace; font-size: 9px; color: #9e9690; cursor: pointer; margin-bottom: 8px; }
  .social-btn.tiktok { background: #111; color: #fff; border: 1px solid #333; }

  .genre-select-conn { color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 12px; cursor: pointer; }
  .genre-select-conn option[disabled] { font-weight: 700; color: rgba(201,168,76,.75); background: #1c1c1c; }
  .genre-select-conn option:not([disabled]) { background: #141414; color: #cec9c1; }

  .subs-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: transparent; border: none; cursor: pointer; padding: 3px 0; }
  .subs-sub-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .1em; }
  .active-label { color: #4a9fd4; }
  .inactive-label { color: #333; }
  .subs-arr { font-size: 9px; color: #444; transition: transform .2s; }
  .subs-arr.open { transform: rotate(90deg); }
  .subs-list { display: flex; flex-direction: column; gap: 3px; margin-top: 3px; }
  .sub-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: #0d0d0d; border: 1px solid #1a1a1a; border-radius: 2px; }
  .sub-row.inactive { opacity: .5; }
  .sub-name { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: #9e9690; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub-date { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; flex-shrink: 0; }
  .sub-link-btn { font-family: 'Space Mono', monospace; font-size: 9px; padding: 2px 7px; background: transparent; border: 1px solid rgba(74,159,212,.3); color: #4a9fd4; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .sub-link-btn:hover { background: rgba(74,159,212,.08); }
  .sub-link-btn.dim { border-color: rgba(74,159,212,.15); color: #444; }
  .sub-no-link { font-family: 'Space Mono', monospace; font-size: 9px; color: #2a2a2a; }
  .subs-empty { font-family: 'Space Mono', monospace; font-size: 10px; color: #2a2a2a; padding: 4px 0; }
  .sub-del-btn { background: transparent; border: none; color: #555; font-size: 13px; cursor: pointer; padding: 0 2px; flex-shrink: 0; line-height: 1; }
  .sub-del-btn:hover { color: #e05a4a; }

  .conn-footer { display: flex; justify-content: flex-end; padding-top: 4px; }
  .btn-delete { font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 10px; background: transparent; border: 1px solid rgba(224,90,74,.25); color: #444; border-radius: 2px; cursor: pointer; }
  .btn-delete:hover { border-color: #e05a4a; color: #e05a4a; }
</style>
