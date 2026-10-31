<script>
  import { onMount } from 'svelte'
  import { supabase } from './supabase.js'
  import FeedbackView from './FeedbackView.svelte'

  const ARTIST_PAGE = 'https://momentummusic.vercel.app/feedback'

  let projects    = $state([])
  let selectedId  = $state(null)
  let copied      = $state(false)
  let selected    = $derived(projects.find(p => p.id === selectedId) || null)

  async function load() {
    const { data } = await supabase.from('projects').select('id,name,artist,project_meta,status')
      .neq('status', 'archived').order('position')
    projects = data || []
    const last = localStorage.getItem('mm_feedback_project_id')
    selectedId = projects.find(p => String(p.id) === last)?.id ?? projects[0]?.id ?? null
  }

  function selectProject(id) {
    selectedId = projects.find(p => String(p.id) === String(id))?.id ?? null
    localStorage.setItem('mm_feedback_project_id', String(selectedId))
  }

  // Password lives in projects.project_meta.feedback_password
  async function savePassword(p, value) {
    const meta = { ...(p.project_meta || {}), feedback_password: value }
    p.project_meta = meta
    projects = [...projects]
    await supabase.from('projects').update({ project_meta: meta }).eq('id', p.id)
  }
  function generatePassword(p) {
    const base = (p.artist || p.name || 'momentum').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'momentum'
    return base + String(Math.floor(1000 + Math.random() * 9000))
  }

  async function copyArtistLink() {
    const p = selected
    if (!p) return
    let pw = p.project_meta?.feedback_password
    if (!pw) { pw = generatePassword(p); await savePassword(p, pw) }
    await navigator.clipboard.writeText(`${ARTIST_PAGE}?p=${p.id}\nPasswort: ${pw}`).catch(() => {})
    copied = true
    setTimeout(() => copied = false, 2000)
  }

  function sanitizeTitle(title) {
    return (title || '').replace(/[<>:"/\\|?*]/g, '').trim()
  }

  // New version from the FEEDBACK tab — same naming + storage as ProjectsTab.saveSongAudio,
  // marked as sent so it becomes the artist's current version.
  async function dropVersion(song, file) {
    const wd = song.work_data || {}
    const dir = wd.current_stage === 'mixing' ? 'mixing' : 'production'
    const versions = wd.versions || []
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'wav'
    const sameType = versions.filter(v => v.version_type === dir)
    const ver = 'V' + String(sameType.length + 1).padStart(2, '0')
    const artistClean = (selected?.artist || '').toUpperCase().replace(/[<>:"/\\|?*]/g, '').trim()
    const titlePart = sanitizeTitle(song.title || '')
    const filename = dir === 'mixing'
      ? (artistClean ? `${artistClean}_${titlePart}_MIX_${ver}.${ext}` : `${titlePart}_MIX_${ver}.${ext}`)
      : (artistClean ? `${artistClean}_${titlePart}_${ver}.${ext}` : `${titlePart}_${ver}.${ext}`)
    const oldfile = dir === 'mixing' ? (wd.mix_audio || '') : (wd.prod_audio || '')

    const res = await fetch(
      `http://localhost:4242/save-audio?dir=${dir}&filename=${encodeURIComponent(filename)}&oldfile=${encodeURIComponent(oldfile)}&song_id=${encodeURIComponent(song.id)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() }
    ).then(r => r.json())
    if (!res.ok) throw new Error(res.error || 'save-audio failed')

    const { data: row } = await supabase.from('songs').select('work_data,audio_path').eq('id', song.id).single()
    const fresh = { ...(row?.work_data || {}) }
    fresh.versions = fresh.versions || []
    // First production version replaces the demo file, first mix replaces the last production file
    if (dir === 'production' && !sameType.length && row?.audio_path) {
      await fetch(`http://localhost:4242/delete-audio?dir=demo&filename=${encodeURIComponent(row.audio_path)}`, { method: 'POST' }).catch(() => {})
      await supabase.from('songs').update({ audio_path: null }).eq('id', song.id)
    }
    if (dir === 'mixing' && !sameType.length && fresh.prod_audio) {
      await fetch(`http://localhost:4242/delete-audio?dir=production&filename=${encodeURIComponent(fresh.prod_audio)}`, { method: 'POST' }).catch(() => {})
      fresh.prod_audio = ''
    }
    const v = {
      id: 'v' + Date.now(), name: dir === 'mixing' ? 'MIX_' + ver : ver, version_type: dir,
      created_at: new Date().toISOString(), feedback: [], notes: '', audio_path: filename, sent_to_artist: true
    }
    fresh.versions.push(v)
    fresh.active_version_id = v.id
    if (dir === 'mixing') fresh.mix_audio = filename; else fresh.prod_audio = filename
    await supabase.from('songs').update({ work_data: fresh }).eq('id', song.id)

    // mp3 (192k) + Dropbox links — the watcher merges them into the version
    await fetch('http://localhost:4242/version-dropbox-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: song.id, dir, filename, version_id: v.id })
    }).catch(() => {})
  }

  onMount(load)
</script>

<div class="fb-tab">
  <div class="fb-top">
    <select class="proj-sel" value={selectedId} onchange={e => selectProject(e.target.value)}>
      {#each projects as p}
        <option value={p.id}>{p.artist ? p.artist + ' — ' : ''}{p.name}</option>
      {/each}
    </select>
    {#if selected}
      <label class="pw">
        <span>PASSWORT</span>
        <input value={selected.project_meta?.feedback_password || ''} placeholder="wird beim Kopieren erzeugt"
          onblur={e => { const v = e.target.value.trim(); if (v !== (selected.project_meta?.feedback_password || '')) savePassword(selected, v) }} />
      </label>
      <button class="copy-btn" onclick={copyArtistLink}>{copied ? '✓ Kopiert' : 'Artist-Link kopieren'}</button>
    {/if}
  </div>

  {#if selected}
    {#key selected.id}
      <FeedbackView {supabase} project={selected} mode="producer" author="Remo" ondropversion={dropVersion} />
    {/key}
  {:else}
    <p class="empty">Kein Projekt.</p>
  {/if}
</div>

<style>
  .fb-tab { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; display: flex; flex-direction: column; gap: 18px; }
  .fb-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .proj-sel { background: var(--surface); border: 1px solid var(--border2); color: var(--text); font-family: 'Space Mono', monospace; font-size: 13px; padding: 6px 10px; border-radius: 3px; }
  .pw { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .pw span { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); letter-spacing: .08em; }
  .pw input { background: var(--surface2); border: 1px solid var(--border); color: var(--text); font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 8px; border-radius: 3px; outline: none; width: 190px; }
  .pw input:focus { border-color: var(--border2); }
  .copy-btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: var(--surface2); border: 1px solid var(--border2); color: var(--text); border-radius: 3px; cursor: pointer; }
  .copy-btn:hover { border-color: var(--accent-dim); }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: var(--text-dim); text-align: center; padding: 40px 0; }
</style>
