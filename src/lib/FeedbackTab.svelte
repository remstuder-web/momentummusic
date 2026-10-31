<script>
  // FEEDBACK tab — standalone, unrelated to Projects: own tables feedback_projects / feedback_songs,
  // files in Dropbox/!MOMENTUM MUSIC/Feedback/<folder>/.
  import { onMount } from 'svelte'
  import { supabase } from './supabase.js'
  import FeedbackView from './FeedbackView.svelte'

  const ARTIST_PAGE = 'https://momentummusic.vercel.app/feedback'

  let projects   = $state([])
  let selectedId = $state(null)
  let copied     = $state(false)
  let newOpen    = $state(false)
  let newName    = $state('')
  let newArtist  = $state('')
  let selected   = $derived(projects.find(p => p.id === selectedId) || null)

  async function load() {
    const { data, error } = await supabase.from('feedback_projects').select('*').order('created_at')
    if (error) console.warn('[FeedbackTab] load error:', error.message)
    projects = data || []
    const last = localStorage.getItem('mm_feedback_project_id')
    selectedId = projects.find(p => p.id === last)?.id ?? projects.at(-1)?.id ?? null
  }

  function selectProject(id) {
    selectedId = id
    localStorage.setItem('mm_feedback_project_id', id)
  }

  function generatePassword(artist, name) {
    const base = (artist || name || 'momentum').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'momentum'
    return base + String(Math.floor(1000 + Math.random() * 9000))
  }
  function folderFor(name) {
    const base = name.replace(/[<>:"/\\|?*]/g, '').replace(/^\.+/, '').trim() || 'Projekt'
    const taken = new Set(projects.map(p => p.folder.toLowerCase()))
    let folder = base, n = 2
    while (taken.has(folder.toLowerCase())) folder = `${base} ${n++}`
    return folder
  }

  async function createProject() {
    const name = newName.trim(), artist_name = newArtist.trim()
    if (!name) return
    const { data, error } = await supabase.from('feedback_projects')
      .insert({ name, artist_name, password: generatePassword(artist_name, name), folder: folderFor(name) })
      .select('*').single()
    if (error) { alert('Error: ' + error.message); return }
    projects = [...projects, data]
    selectProject(data.id)
    newName = ''; newArtist = ''; newOpen = false
  }

  async function saveProjectField(p, field, value) {
    if (!value || value === p[field]) return
    const { data, error } = await supabase.from('feedback_projects').update({ [field]: value }).eq('id', p.id).select('*').single()
    if (error) { alert('Error: ' + error.message); return }
    projects = projects.map(x => x.id === p.id ? data : x)
  }

  async function copyArtistLink() {
    if (!selected) return
    await navigator.clipboard.writeText(`${ARTIST_PAGE}?p=${selected.id}\nPasswort: ${selected.password}`).catch(() => {})
    copied = true
    setTimeout(() => copied = false, 2000)
  }

  onMount(load)
</script>

<div class="fb-tab">
  <div class="fb-top">
    {#if projects.length}
      <select class="proj-sel" value={selectedId} onchange={e => selectProject(e.target.value)}>
        {#each projects as p}
          <option value={p.id}>{p.artist_name ? p.artist_name + ' — ' : ''}{p.name}</option>
        {/each}
      </select>
    {/if}
    {#if newOpen}
      <input class="inp" placeholder="Projektname" bind:value={newName}
        onkeydown={e => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') newOpen = false }} />
      <input class="inp" placeholder="Artist-Name" bind:value={newArtist}
        onkeydown={e => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') newOpen = false }} />
      <button class="btn" onclick={createProject}>Anlegen</button>
      <button class="btn ghost" onclick={() => newOpen = false}>×</button>
    {:else}
      <button class="btn" onclick={() => newOpen = true}>+ Neues Projekt</button>
    {/if}

    {#if selected}
      <label class="pw">
        <span>PASSWORT</span>
        <input value={selected.password} onblur={e => saveProjectField(selected, 'password', e.target.value.trim())} />
      </label>
      <button class="btn" onclick={copyArtistLink}>{copied ? '✓ Kopiert' : 'Artist-Link kopieren'}</button>
    {/if}
  </div>

  {#if selected}
    {#key selected.id}
      <FeedbackView {supabase} project={selected} mode="producer" author="Remo" />
    {/key}
  {:else}
    <p class="empty">Noch kein Projekt — „+ Neues Projekt".</p>
  {/if}
</div>

<style>
  .fb-tab { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; display: flex; flex-direction: column; gap: 18px; }
  .fb-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .proj-sel { background: var(--surface); border: 1px solid var(--border2); color: var(--text); font-family: 'Space Mono', monospace; font-size: 13px; padding: 6px 10px; border-radius: 3px; }
  .inp { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 6px 10px; border-radius: 3px; outline: none; width: 170px; }
  .inp:focus { border-color: var(--border2); }
  .inp::placeholder { color: var(--text-faint); }
  .pw { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .pw span { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); letter-spacing: .08em; }
  .pw input { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 8px; border-radius: 3px; outline: none; width: 150px; }
  .pw input:focus { border-color: var(--border2); }
  .btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .btn:hover { border-color: var(--accent-dim); }
  .btn.ghost { background: transparent; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 40px 0; }
</style>
