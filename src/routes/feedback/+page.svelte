<script>
  import { onMount } from 'svelte'
  import { createClient } from '@supabase/supabase-js'
  import FeedbackView from '$lib/FeedbackView.svelte'
  import WorkOverview from '$lib/WorkOverview.svelte'
  import Timeline from '$lib/Timeline.svelte'
  import Lyrics from '$lib/Lyrics.svelte'

  // Same pattern as /sono: CSR only, Supabase direct, no watcher — audio via Dropbox links
  const SUPABASE_URL      = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
  const SUPABASE_ANON_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
  const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  let projectId = $state(null)
  let project   = $state(null)
  let authed    = $state(false)
  let password  = $state('')
  let authError = $state('')
  let ready     = $state(false)
  let view      = $state('songs')   // 'songs' | 'overview' | 'timeline'

  const storageKey = () => `feedback_auth_${projectId}`

  async function fetchProject() {
    const { data } = await supabase.from('feedback_projects').select('*').eq('id', projectId).maybeSingle()
    return data || null
  }

  async function login() {
    const p = await fetchProject()
    const pw = p?.password
    if (p && pw && password.trim() === pw) {
      localStorage.setItem(storageKey(), pw)
      project = p; authed = true; authError = ''
    } else authError = 'Falsches Passwort.'
  }

  onMount(async () => {
    projectId = new URLSearchParams(window.location.search).get('p')
    if (projectId) {
      const p = await fetchProject()
      const saved = localStorage.getItem(storageKey())
      if (p && saved && saved === p.password) { project = p; authed = true }
    }
    ready = true
  })
</script>

<svelte:head><title>{project ? `${project.artist_name || project.name} — Feedback` : 'Feedback'}</title></svelte:head>

{#if !ready}
  <div></div>
{:else if !projectId}
  <div class="login-wrap"><p class="login-sub">Link unvollständig.</p></div>
{:else if !authed}
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-title">FEEDBACK</div>
      <div class="login-sub">MOMENTUM MUSIC</div>
      <input class="login-inp" type="password" placeholder="Passwort" bind:value={password}
        onkeydown={e => { if (e.key === 'Enter') login() }} />
      {#if authError}<span class="login-err">{authError}</span>{/if}
      <button class="login-btn" onclick={login}>ENTER</button>
    </div>
  </div>
{:else}
  <div class="page">
    <div class="page-header">
      <span class="page-title">{project.artist_name || project.name}</span>
      {#if project.artist_name && project.name}<span class="page-sub">{project.name}</span>{/if}
    </div>
    <div class="view-sw">
      <button class={view === 'songs' ? 'on' : ''} onclick={() => view = 'songs'}>SONGS</button>
      <button class={view === 'overview' ? 'on' : ''} onclick={() => view = 'overview'}>OVERVIEW</button>
      <button class={view === 'timeline' ? 'on' : ''} onclick={() => view = 'timeline'}>TIMELINE</button>
      <button class={view === 'lyrics' ? 'on' : ''} onclick={() => view = 'lyrics'}>LYRICS</button>
    </div>
    {#if view === 'songs'}
      <FeedbackView {supabase} {project} mode="artist" author={project.artist_name || 'Artist'} />
    {:else if view === 'overview'}
      <WorkOverview {supabase} {project} mode="artist" />
    {:else if view === 'timeline'}
      <Timeline {supabase} {project} mode="artist" />
    {:else}
      <Lyrics {supabase} {project} mode="artist" author={project.artist_name || 'Artist'} />
    {/if}
  </div>
{/if}

<style>
  :global(body) { background: var(--bg); color: var(--text); margin: 0; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; }

  .login-wrap  { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 0 16px; }
  .login-box   { display: flex; flex-direction: column; gap: 12px; width: 280px; max-width: 100%; }
  .login-title { font-family: 'Space Mono', monospace; font-size: 24px; font-weight: 500; color: var(--text); letter-spacing: .12em; text-align: center; }
  .login-sub   { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); text-align: center; letter-spacing: .1em; margin-bottom: 4px; }
  .login-inp   { background: var(--surface); border: 1px solid var(--border2); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 15px; padding: 10px 14px; outline: none; border-radius: 3px; }
  .login-inp:focus { border-color: var(--accent-dim); }
  .login-inp::placeholder { color: var(--text-faint); }
  .login-err   { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .login-btn   { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 500; letter-spacing: .1em; padding: 10px; background: var(--surface2); color: var(--text); border: none; border-radius: 3px; cursor: pointer; }
  .login-btn:hover { background: var(--border2); }

  .view-sw { display: flex; gap: 0; margin-bottom: 14px; }
  .view-sw button { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: .08em; padding: 5px 14px; background: transparent; border: 1px solid var(--border2); color: var(--text-dim); cursor: pointer; }
  .view-sw button + button { border-left: none; }
  .view-sw button:first-child { border-radius: 3px 0 0 3px; }
  .view-sw button:last-child { border-radius: 0 3px 3px 0; }
  .view-sw button.on { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-a06); }
  .view-sw button.on + button { border-left: 1px solid var(--accent-dim); }
  .view-sw button:has(+ button.on) { border-right: none; }
  .page        { max-width: 900px; margin: 0 auto; padding: 40px 16px 80px; }
  .page-header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; }
  .page-title  { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 500; color: var(--text); letter-spacing: .12em; text-transform: uppercase; }
  .page-sub    { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); letter-spacing: .08em; text-transform: uppercase; }
</style>
