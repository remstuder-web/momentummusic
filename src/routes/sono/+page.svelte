<script>
  import { onMount } from 'svelte'
  import { createClient } from '@supabase/supabase-js'
  import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SONO_PASSWORD } from '$env/static/public'

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

  const AUDIO_SERVER = 'http://localhost:4242/audio'

  let authed = $state(false)
  let password = $state('')
  let authError = $state('')
  let songs = $state([])
  let loading = $state(false)
  let expandedId = $state(null)
  let currentSongId = $state(null)
  let isPlaying = $state(false)
  let currentTime = $state(0)
  let duration = $state(0)
  let player = null

  const DISCO_CATEGORIES = ['tempo','mood','genre','vocals','lyrical_theme','instrument','type']
  const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B','Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m','Am','A#m','Bm']

  function checkAuth() {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem('sono_auth') === 'true'
  }

  function login() {
    if (password === PUBLIC_SONO_PASSWORD) {
      localStorage.setItem('sono_auth', 'true')
      authed = true
      authError = ''
      loadSongs()
    } else {
      authError = 'Incorrect password.'
    }
  }

  async function loadSongs() {
    loading = true
    const { data } = await supabase
      .from('songs')
      .select('*')
      .is('project_id', null)
      .order('created_at', { ascending: false })
    songs = (data || [])
      .filter(s => (s.work_data?.at_artist || '').toLowerCase() === 'sono')
      .sort((a, b) => parseInt(b.code) - parseInt(a.code))
    loading = false
  }

  function getPlayer() {
    if (!player) {
      player = new Audio()
      player.addEventListener('timeupdate', () => { currentTime = player.currentTime })
      player.addEventListener('loadedmetadata', () => { duration = player.duration })
      player.addEventListener('ended', () => { isPlaying = false; currentSongId = null })
      player.addEventListener('play', () => { isPlaying = true })
      player.addEventListener('pause', () => { isPlaying = false })
    }
    return player
  }

  function playSong(songId, src) {
    if (!src) return
    const p = getPlayer()
    const id = String(songId)
    if (currentSongId === id) {
      if (p.paused) p.play().catch(() => {})
      else p.pause()
      return
    }
    p.pause()
    p.src = src
    p.currentTime = 0
    currentSongId = id
    p.load()
    p.play().catch(() => {})
  }

  function audioSrc(song) {
    if (song.audio_path) return `${AUDIO_SERVER}/${encodeURIComponent(song.audio_path)}`
    return null
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00'
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
  }

  onMount(() => {
    authed = checkAuth()
    if (authed) loadSongs()
  })
</script>

<svelte:head>
  <title>SONO</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400&display=swap" rel="stylesheet">
</svelte:head>

{#if !authed}
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-title">SONO</div>
      <div class="login-sub">Private demo access</div>
      <input
        class="login-inp"
        type="password"
        placeholder="Password"
        bind:value={password}
        onkeydown={e => e.key === 'Enter' && login()} />
      {#if authError}
        <span class="login-err">{authError}</span>
      {/if}
      <button class="login-btn" onclick={login}>Enter</button>
    </div>
  </div>

{:else}
  <div class="page">
    <div class="page-header">
      <span class="page-title">SONO</span>
      <span class="page-sub">{songs.length} demo{songs.length === 1 ? '' : 's'}</span>
    </div>

    {#if loading}
      <p class="empty">Loading...</p>
    {:else if !songs.length}
      <p class="empty">No SONO demos yet.</p>
    {:else}
      <div class="list">
        {#each songs as song (song.id)}
          {@const expanded = expandedId === song.id}
          {@const src = audioSrc(song)}
          <div class="card {expanded ? 'exp' : ''}">

            <div class="card-head" onclick={() => expandedId = expanded ? null : song.id}>
              <div class="head-left">
                <span class="code">{song.code}</span>
                {#if song.title}<span class="song-title">{song.title}</span>{/if}
              </div>
              <div class="head-meta">
                {#if song.tempo}<span class="pill">{song.tempo} BPM</span>{/if}
                {#if song.key}<span class="pill">{song.key}</span>{/if}
              </div>
              <div class="player-slot" onclick={e => e.stopPropagation()}>
                {#if src}
                  <div class="mini-player {currentSongId === String(song.id) ? 'active' : ''}">
                    <button onclick={() => playSong(song.id, src)}>
                      {currentSongId === String(song.id) && isPlaying ? '⏸' : '▶'}
                    </button>
                    <span class="time">
                      {currentSongId === String(song.id) ? formatTime(currentTime) + ' / ' + formatTime(duration) : '0:00'}
                    </span>
                    <input type="range" class="seek-bar"
                      min="0"
                      max={currentSongId === String(song.id) ? (duration || 100) : 100}
                      value={currentSongId === String(song.id) ? currentTime : 0}
                      oninput={e => { if (player) player.currentTime = +e.target.value }} />
                  </div>
                {/if}
              </div>
              <span class="arr">{expanded ? '▾' : '▸'}</span>
            </div>

            {#if expanded}
              <div class="card-body">
                {#if song.notes}
                  <div class="field">
                    <span class="field-label">NOTES</span>
                    <p class="field-text">{song.notes}</p>
                  </div>
                {/if}

                {#if song.work_data?.disco_tags && DISCO_CATEGORIES.some(c => (song.work_data.disco_tags[c]||[]).length)}
                  <div class="field">
                    <span class="field-label">DISCO TAGS</span>
                    <div class="disco-wrap">
                      {#each DISCO_CATEGORIES as cat}
                        {#if (song.work_data.disco_tags[cat]||[]).length}
                          <div class="disco-row">
                            <span class="disco-cat">{cat.replace('_',' ').toUpperCase()}</span>
                            {#each song.work_data.disco_tags[cat] as tag}
                              <span class="disco-chip">{tag}</span>
                            {/each}
                          </div>
                        {/if}
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}

          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(body) { background: #0a0a0a; color: #f5f1ea; margin: 0; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 300; }

  /* login */
  .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { display: flex; flex-direction: column; gap: 12px; width: 280px; }
  .login-title { font-family: 'Space Mono', monospace; font-size: 24px; font-weight: 700; color: #c9a84c; letter-spacing: .12em; text-align: center; }
  .login-sub { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; text-align: center; letter-spacing: .1em; margin-bottom: 4px; }
  .login-inp { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 15px; padding: 10px 14px; outline: none; border-radius: 3px; }
  .login-inp:focus { border-color: rgba(201,168,76,.5); }
  .login-err { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .login-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; padding: 10px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
  .login-btn:hover { background: #d4b660; }

  /* page */
  .page { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
  .page-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 28px; }
  .page-title { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; color: #c9a84c; letter-spacing: .12em; }
  .page-sub { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; text-align: center; padding: 40px 0; }

  /* cards */
  .list { display: flex; flex-direction: column; gap: 6px; }
  .card { border: 1px solid #252525; border-radius: 4px; overflow: hidden; }
  .card.exp { border-color: rgba(201,168,76,.4); }
  .card-head { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 52px; background: #1c1c1c; cursor: pointer; user-select: none; transition: background .15s; }
  .card-head:hover { background: #222; }
  .card.exp .card-head { background: #252525; }
  .head-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .code { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #c9a84c; flex-shrink: 0; }
  .song-title { font-size: 13px; color: #cec9c1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head-meta { display: flex; gap: 4px; flex-shrink: 0; }
  .pill { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 2px; background: #1a1a1a; border: 1px solid #2a2a2a; color: #9e9690; }
  .player-slot { flex-shrink: 0; }
  .mini-player { display: flex; align-items: center; gap: 6px; width: 210px; }
  .mini-player button { background: none; border: none; color: #9e9690; cursor: pointer; font-size: 14px; padding: 2px 4px; }
  .mini-player.active button { color: #f5f1ea; }
  .mini-player .time { font-size: 10px; font-family: 'Space Mono', monospace; color: #555; width: 80px; text-align: right; flex-shrink: 0; }
  .mini-player.active .time { color: #9e9690; }
  .seek-bar { flex: 1; height: 3px; accent-color: #c9a84c; cursor: pointer; }
  .arr { font-size: 12px; color: #555; flex-shrink: 0; }

  /* card body */
  .card-body { padding: 14px 16px; border-top: 1px solid #252525; background: #0f0f0f; display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.6); text-transform: uppercase; }
  .field-text { font-size: 13px; color: #9e9690; line-height: 1.6; margin: 0; }
  .disco-wrap { display: flex; flex-direction: column; gap: 4px; }
  .disco-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .disco-cat { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: rgba(201,168,76,.5); width: 90px; flex-shrink: 0; }
  .disco-chip { display: inline-flex; align-items: center; padding: 2px 8px; background: rgba(201,168,76,.05); border: 1px solid rgba(201,168,76,.2); border-radius: 2px; font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; }
</style>
