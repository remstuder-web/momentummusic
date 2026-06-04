<script>
  import { supabase } from './supabase.js'

  let projects = $state([])
  let songs = $state([])
  let tipSections = $state([])
  let cards = $state([])
  let loading = $state(true)
  let expandedSongId = $state(null)
  let collapsedProjects = $state({})
  let openTipSectionId = $state(null)
  let cardIdx = $state(0)
  let audioBlobUrls = $state({})
  let fbInput = $state({})

  let timerSec = $state(3600)
  let timerRunning = $state(false)
  let timerInterval = null
  let timerAlarmed = $state(false)

  let aiInput = $state('')
  let aiMessages = $state([])
  let aiLoading = $state(false)
  let sideCollapsed = $state(true)

  let acapellaFile = $state(null)
  let acapellaLoading = $state(false)
  let acapellaResult = $state(null)
  let acapellaDragging = $state(false)
  let acapellaError = $state('')

  const STAGES = [
    { id: 'demo',       label: 'DEMO' },
    { id: 'production', label: 'PRODUCTION', hasSent: true },
    { id: 'lyrics',     label: 'LYRICS',     hasLyrics: true },
    { id: 'vocal_rec',  label: 'VOCAL REC' },
    { id: 'vocal_prep', label: 'VOCAL PREP' },
    { id: 'mix_prep',   label: 'MIX PREP' },
    { id: 'mixing',     label: 'MIXING',     hasSent: true },
    { id: 'mastering',  label: 'MASTERING' },
  ]

  const STAGE_TIP_MAP = {
    demo: 1, production: 2, lyrics: 3, vocal_rec: 3,
    vocal_prep: 5, mix_prep: 5, mixing: 5, mastering: 5
  }

  let grouped = $derived(groupByProject())
  let timerDisplay = $derived(formatTime(timerSec))
  let currentCard = $derived(cards[cardIdx % (cards.length || 1)] || null)
  let expandedSong = $derived(songs.find(s => s.id === expandedSongId) || null)
  let rightTips = $derived(getRightTips())

  function groupByProject() {
    const map = {}
    projects.forEach(p => { map[p.id] = { ...p, songs: [] } })
    songs.forEach(s => { if (s.project_id && map[s.project_id]) map[s.project_id].songs.push(s) })
    return Object.values(map).filter(p => p.songs.length)
  }

  function getRightTips() {
    if (!expandedSong) return []
    const wd = workData(expandedSong)
    const stageNum = STAGE_TIP_MAP[wd.current_stage] || 2
    return tipSections.filter(s => s.stage_num === stageNum)
  }

  async function load() {
    try {
      const [projRes, songsRes, tipsRes, cardsRes] = await Promise.all([
        supabase.from('projects').select('id, name, artist, color').order('position'),
        supabase.from('songs').select('id, title, code, project_id, work_data, position').not('project_id', 'is', null).order('position'),
        supabase.from('work_tip_sections').select('*, work_tips(*)').order('stage_num').order('position'),
        supabase.from('work_cards').select('*').order('position'),
      ])
      projects = projRes.data || []
      songs = songsRes.data || []
      tipSections = tipsRes.data || []
      cards = cardsRes.data || []
    } catch(e) { console.error('WorkTab load error:', e) }
    loading = false
  }

  function workData(song) {
    const wd = song.work_data || {}
    return {
      project_info:    wd.project_info    || '',
      current_stage:   wd.current_stage   || 'demo',
      stages: {
        demo:       { done: false, ...(wd.stages?.demo       || {}) },
        production: { done: false, sent: false, ...(wd.stages?.production || {}) },
        lyrics:     { done: false, text: '',   ...(wd.stages?.lyrics     || {}) },
        vocal_rec:  { done: false, ...(wd.stages?.vocal_rec  || {}) },
        vocal_prep: { done: false, ...(wd.stages?.vocal_prep || {}) },
        mix_prep:   { done: false, ...(wd.stages?.mix_prep   || {}) },
        mixing:     { done: false, sent: false, ...(wd.stages?.mixing    || {}) },
        mastering:  { done: false, ...(wd.stages?.mastering  || {}) },
      },
      versions:          wd.versions          || [],
      active_version_id: wd.active_version_id || null,
    }
  }

  async function saveWorkData(song, updater) {
    const wd = workData(song)
    updater(wd)
    song.work_data = wd
    songs = [...songs]
    await supabase.from('songs').update({ work_data: wd }).eq('id', song.id)
  }

  function setStage(song, stageId) {
    saveWorkData(song, wd => { wd.current_stage = stageId })
    openTipSectionId = null
  }

  function toggleStageDone(song, stageId) {
    saveWorkData(song, wd => { wd.stages[stageId].done = !wd.stages[stageId].done })
  }

  function toggleSent(song, stageId) {
    saveWorkData(song, wd => { wd.stages[stageId].sent = !wd.stages[stageId].sent })
  }

  function saveLyrics(song, text) {
    saveWorkData(song, wd => { wd.stages.lyrics.text = text })
  }

  function saveProjectInfo(song, text) {
    saveWorkData(song, wd => { wd.project_info = text })
  }

  function addVersion(song) {
    saveWorkData(song, wd => {
      const num = wd.versions.length + 1
      const v = { id: 'v'+Date.now(), name: 'v'+num, created_at: new Date().toISOString(), feedback: [], audio_path: '' }
      wd.versions.push(v)
      wd.active_version_id = v.id
    })
  }

  function setActiveVersion(song, vId) {
    saveWorkData(song, wd => { wd.active_version_id = vId })
  }

  function addFeedback(song, vId, text) {
    if (!text.trim()) return
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.feedback.push({ id: 'f'+Date.now(), text: text.trim(), done: false })
    })
  }

  function toggleFeedback(song, vId, fId) {
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (!v) return
      const f = v.feedback.find(f => f.id === fId)
      if (f) f.done = !f.done
      if (v.feedback.length && v.feedback.every(f => f.done)) {
        const text = v.name + ' Changes:\n' + v.feedback.map(f => '✓ ' + f.text).join('\n')
        navigator.clipboard.writeText(text).catch(() => {})
        song._copied = v.id
        songs = [...songs]
        setTimeout(() => { song._copied = null; songs = [...songs] }, 2500)
      }
    })
  }

  function deleteFeedback(song, vId, fId) {
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.feedback = v.feedback.filter(f => f.id !== fId)
    })
  }

  function handleVersionAudioDrop(e, song, vId) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (audioBlobUrls[vId]) URL.revokeObjectURL(audioBlobUrls[vId])
    audioBlobUrls = { ...audioBlobUrls, [vId]: URL.createObjectURL(file) }
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.audio_path = file.name
    })
  }

  function clearVersionAudio(song, vId) {
    if (audioBlobUrls[vId]) URL.revokeObjectURL(audioBlobUrls[vId])
    audioBlobUrls = { ...audioBlobUrls, [vId]: null }
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.audio_path = ''
    })
  }

  function activeVersionBlobUrl(song) {
    const wd = workData(song)
    return wd.active_version_id ? (audioBlobUrls[wd.active_version_id] || null) : null
  }

  function activeVersionAudioPath(song) {
    const wd = workData(song)
    if (!wd.active_version_id) return ''
    const v = wd.versions.find(v => v.id === wd.active_version_id)
    return v ? (v.audio_path || '') : ''
  }

  async function moveSong(song, dir) {
    const proj = grouped.find(p => p.id === song.project_id)
    if (!proj) return
    const list = proj.songs
    const idx = list.findIndex(s => s.id === song.id)
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= list.length) return
    const a = list[idx]
    const b = list[newIdx]
    const posA = a.position ?? idx
    const posB = b.position ?? newIdx
    a.position = posB
    b.position = posA
    songs = songs.slice().sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
    await Promise.all([
      supabase.from('songs').update({ position: posB }).eq('id', a.id),
      supabase.from('songs').update({ position: posA }).eq('id', b.id),
    ])
  }

  function playAlarm() {
    try {
      const ctx = new AudioContext()
      [0, 0.25, 0.5].forEach(offset => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = offset === 0.25 ? 660 : 880
        gain.gain.setValueAtTime(0.35, ctx.currentTime + offset)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2)
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + 0.22)
      })
    } catch(e) {}
  }

  function toggleTimer() {
    if (timerRunning) {
      clearInterval(timerInterval)
      timerRunning = false
    } else {
      timerAlarmed = false
      timerRunning = true
      timerInterval = setInterval(() => {
        if (timerSec <= 0) {
          clearInterval(timerInterval)
          timerRunning = false
          if (!timerAlarmed) { playAlarm(); timerAlarmed = true }
          return
        }
        timerSec--
      }, 1000)
    }
  }

  function resetTimer() {
    clearInterval(timerInterval)
    timerRunning = false
    timerSec = 3600
    timerAlarmed = false
  }

  function formatTime(sec) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0')
  }

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return
    const msg = aiInput.trim()
    aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) {
      aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set. Add it in Settings.' }]
      aiLoading = false
      return
    }
    const songCtx = expandedSong ? ('Song: ' + (expandedSong.title || expandedSong.code) + '. Stage: ' + workData(expandedSong).current_stage + '.') : ''
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 400,
          system: 'You are Mozart, a music production AI. ' + songCtx + ' Be concise and inspiring.',
          messages: aiMessages.slice(-10)
        })
      })
      const data = await res.json()
      aiMessages = [...aiMessages, { role: 'assistant', content: data.content?.[0]?.text || 'No response.' }]
    } catch(e) {
      aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: ' + e.message }]
    }
    aiLoading = false
  }

  function handleAcapellaDrop(e) {
    e.preventDefault()
    acapellaDragging = false
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0]
    if (!file) return
    acapellaFile = file
    acapellaResult = null
    acapellaError = ''
  }

  async function runAcapellaExtract() {
    if (!acapellaFile || acapellaLoading) return
    acapellaLoading = true
    acapellaResult = null
    acapellaError = ''
    try {
      const buf = await acapellaFile.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const ext = acapellaFile.name.split('.').pop()
      const res = await fetch('http://localhost:4242/extract-acapella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: b64, ext })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Extraction failed')
      acapellaResult = data
    } catch(e) {
      acapellaError = e.message
    }
    acapellaLoading = false
  }

  load()
</script>

{#if loading}
  <p class="empty">Loading...</p>
{:else}
<div class="layout {sideCollapsed ? 'side-collapsed' : ''}">

  <div class="songs-col">
    {#if !grouped.length}
      <p class="empty">No project songs yet. Add songs to a project first.</p>
    {:else}
      {#each grouped as project}
        <div class="project-group">
          <button class="project-label" style="border-left:3px solid {project.color}"
            onclick={() => collapsedProjects[project.id] = !collapsedProjects[project.id]}>
            <span class="proj-name">{project.name}</span>
            {#if project.artist}<span class="proj-artist">{project.artist}</span>{/if}
            <span class="proj-arr {collapsedProjects[project.id] ? '' : 'open'}">▶</span>
          </button>

          {#if !collapsedProjects[project.id]}
            {#each project.songs as song, idx (song.id)}
              {@const wd = workData(song)}
              {@const doneCount = STAGES.filter(s => wd.stages[s.id]?.done).length}
              {@const activeV = wd.versions.find(v => v.id === wd.active_version_id)}
              {@const expanded = expandedSongId === song.id}
              {@const blobUrl = activeVersionBlobUrl(song)}
              {@const audioPath = activeVersionAudioPath(song)}

              <div class="song-card {expanded ? 'exp' : ''}">
                <div class="song-head">
                  <div class="reorder-btns">
                    <button class="reorder-btn" onclick={() => moveSong(song, -1)}>▲</button>
                    <button class="reorder-btn" onclick={() => moveSong(song, 1)}>▼</button>
                  </div>
                  <div class="song-info" onclick={() => expandedSongId = expanded ? null : song.id}>
                    <span class="song-code">{song.code}</span>
                    {#if song.title}<span class="song-title-txt">{song.title}</span>{/if}
                  </div>
                  <div class="stage-pills" onclick={() => expandedSongId = expanded ? null : song.id}>
                    {#each STAGES as stage}
                      <div class="stage-pill {wd.stages[stage.id]?.done ? 'done' : ''} {wd.current_stage === stage.id ? 'active' : ''}" title={stage.label}></div>
                    {/each}
                  </div>
                  {#if blobUrl}
                    <audio class="mini-player" controls src={blobUrl} onclick={e => e.stopPropagation()}></audio>
                  {:else if audioPath}
                    <span class="audio-ref" title="Drop in version to play">🎵 {audioPath}</span>
                  {/if}
                  <div class="song-meta" onclick={() => expandedSongId = expanded ? null : song.id}>
                    <span class="stage-current">{STAGES.find(s => s.id === wd.current_stage)?.label || ''}</span>
                    <span class="song-progress">{doneCount}/{STAGES.length}</span>
                  </div>
                  <span class="arr {expanded ? 'open' : ''}" onclick={() => expandedSongId = expanded ? null : song.id}>▶</span>
                </div>

                {#if expanded}
                  <div class="song-body">
                    <div class="stages-row">
                      {#each STAGES as stage}
                        {@const sd = wd.stages[stage.id]}
                        <div class="stage-box {wd.current_stage === stage.id ? 'active' : ''} {sd.done ? 'done' : ''}">
                          <button class="stage-ckb" onclick={() => toggleStageDone(song, stage.id)}>{sd.done ? '✓' : ''}</button>
                          <button class="stage-lbl" onclick={() => setStage(song, stage.id)}>{stage.label}</button>
                          {#if stage.hasSent}
                            <button class="sent-ckb {sd.sent ? 'sent' : ''}" onclick={() => toggleSent(song, stage.id)} title="Sent to artist">{sd.sent ? '✉✓' : '✉'}</button>
                          {/if}
                        </div>
                      {/each}
                    </div>

                    <div class="field">
                      <label>PROJECT INFO / BRIEF</label>
                      <textarea class="ta" placeholder="Artist vision, references, goals..." value={wd.project_info} oninput={e => saveProjectInfo(song, e.target.value)}></textarea>
                    </div>

                    {#if wd.current_stage === 'lyrics'}
                      <div class="field">
                        <label>LYRICS</label>
                        <textarea class="ta lyrics-ta" placeholder="Paste or write lyrics here..." value={wd.stages.lyrics.text} oninput={e => saveLyrics(song, e.target.value)}></textarea>
                      </div>
                    {/if}

                    <div class="versions-block">
                      <div class="versions-header">
                        <label>VERSIONS</label>
                        <button class="btn-ghost-sm" onclick={() => addVersion(song)}>+ New Version</button>
                      </div>

                      {#if wd.versions.length}
                        <div class="version-tabs">
                          {#each wd.versions as v}
                            <button class="vtab {wd.active_version_id === v.id ? 'on' : ''}" onclick={() => setActiveVersion(song, v.id)}>
                              {v.name}{audioBlobUrls[v.id] ? ' ♪' : ''}
                            </button>
                          {/each}
                        </div>

                        {#if activeV}
                          <div class="version-audio"
                            ondragover={e => e.preventDefault()}
                            ondrop={e => handleVersionAudioDrop(e, song, activeV.id)}>
                            {#if audioBlobUrls[activeV.id]}
                              <audio class="version-player" controls src={audioBlobUrls[activeV.id]}></audio>
                              <span class="version-audio-name">🎵 {activeV.audio_path}</span>
                              <button class="drop-clear" onclick={() => clearVersionAudio(song, activeV.id)}>×</button>
                            {:else if activeV.audio_path}
                              <span class="version-audio-name dim">🎵 {activeV.audio_path}</span>
                              <span class="drop-rehint">Drop again to play</span>
                            {:else}
                              <span class="drop-hint">↓ Drop audio for {activeV.name}</span>
                            {/if}
                          </div>

                          {#if song._copied === activeV.id}
                            <div class="copied-banner">✓ Changelog copied to clipboard!</div>
                          {/if}

                          <div class="feedback-list">
                            {#each activeV.feedback as fb (fb.id)}
                              <div class="fb-row {fb.done ? 'fb-done' : ''}">
                                <button class="ckb-sm" onclick={() => toggleFeedback(song, activeV.id, fb.id)}>{fb.done ? '✓' : ''}</button>
                                <span class="fb-text">{fb.text}</span>
                                <button class="del-btn" onclick={() => deleteFeedback(song, activeV.id, fb.id)}>×</button>
                              </div>
                            {/each}
                            {#if !activeV.feedback.length}<p class="empty-sm">No feedback yet.</p>{/if}
                          </div>

                          <div class="fb-add-row">
                            <input class="add-inp" bind:value={fbInput[activeV.id]}
                              placeholder="Add feedback item..."
                              onkeydown={e => { if (e.key === 'Enter') { addFeedback(song, activeV.id, fbInput[activeV.id] || ''); fbInput[activeV.id] = '' } }} />
                            <button class="add-btn" onclick={() => { addFeedback(song, activeV.id, fbInput[activeV.id] || ''); fbInput[activeV.id] = '' }}>+</button>
                          </div>

                          {#if activeV.feedback.length && activeV.feedback.every(f => f.done)}
                            <div class="all-done-hint">All done — changelog auto-copied ✓</div>
                          {/if}
                        {/if}
                      {:else}
                        <p class="empty-sm" style="padding:12px">No versions yet.</p>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="right-col">
    <div class="timer-block {timerAlarmed ? 'alarmed' : ''}">
      <span class="timer-disp">{timerDisplay}</span>
      <div class="timer-btns">
        <button class="btn-ghost-sm" onclick={toggleTimer}>{timerRunning ? 'Pause' : timerSec === 3600 ? 'Start' : 'Resume'}</button>
        <button class="btn-ghost-sm" onclick={resetTimer}>Reset</button>
      </div>
      {#if timerAlarmed}<div class="alarm-msg">⏰ Time's up!</div>{/if}
    </div>

    {#if rightTips.length}
      <div class="tips-block">
        <div class="tips-title">TIPS{expandedSong ? ' — ' + (STAGES.find(s => s.id === workData(expandedSong).current_stage)?.label || '') : ''}</div>
        {#each rightTips as sec}
          <div class="tip-sec">
            <button class="tip-toggle" onclick={() => openTipSectionId = openTipSectionId === sec.id ? null : sec.id}>
              <span class="tip-toggle-lbl">{sec.label}</span>
              {#if sec.tier}<span class="tip-tier">{sec.tier}</span>{/if}
              <span class="tip-arr {openTipSectionId === sec.id ? 'open' : ''}">▶</span>
            </button>
            {#if openTipSectionId === sec.id}
              <div class="tips-body">
                {#each (sec.work_tips || []) as tip}
                  <div class="tip-row">— {tip.tip}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="tips-block">
        <div class="tips-title">TIPS{expandedSong ? ' — ' + (STAGES.find(s => s.id === workData(expandedSong).current_stage)?.label || '') : ''}</div>
        <p class="empty-sm">{expandedSong ? 'No tips for this stage.' : 'Open a song to see tips.'}</p>
      </div>
    {/if}

    {#if currentCard}
      <div class="card-block">
        <div class="card-label">// oblique strategy</div>
        <div class="card-text">"{currentCard.text}"</div>
        <button class="btn-ghost-sm" onclick={() => cardIdx++}>Next →</button>
      </div>
    {/if}

    <div class="acapella-block">
      <div class="acapella-title">ACAPELLA EXTRACTOR</div>
      <div class="acapella-zone {acapellaDragging ? 'drag-over' : ''} {acapellaFile ? 'has-file' : ''}"
        ondragover={e => { e.preventDefault(); acapellaDragging = true }}
        ondragleave={() => acapellaDragging = false}
        ondrop={handleAcapellaDrop}>
        {#if acapellaFile}
          <span class="acapella-fname">{acapellaFile.name}</span>
          <button class="acapella-clear" onclick={() => { acapellaFile = null; acapellaResult = null; acapellaError = '' }}>×</button>
        {:else}
          <span class="acapella-hint">↓ Drop WAV / MP3</span>
        {/if}
      </div>
      {#if acapellaFile && !acapellaLoading && !acapellaResult}
        <button class="acapella-run-btn" onclick={runAcapellaExtract}>Extract Vocals</button>
      {/if}
      {#if acapellaLoading}
        <div class="acapella-status loading">⏳ Extracting vocals... 2–5 min</div>
      {/if}
      {#if acapellaError}
        <div class="acapella-status error">{acapellaError}</div>
      {/if}
      {#if acapellaResult}
        <div class="acapella-result">
          <div class="acapella-result-name">✓ {acapellaResult.filename}</div>
          <div class="acapella-result-meta">{acapellaResult.bpm}bpm · {acapellaResult.key} · onset {acapellaResult.onset?.toFixed?.(2)}s</div>
          <div class="acapella-result-loc">Saved to Stems folder</div>
        </div>
      {/if}
    </div>

  </div>

<div class="work-side">
  <button class="side-toggle {sideCollapsed ? '' : 'expanded'}" onclick={() => sideCollapsed = !sideCollapsed}>{sideCollapsed ? '›' : '‹'}</button>
  {#if !sideCollapsed}
  <div class="mozart-block">
    <div class="mozart-title">ASK MOZART</div>
    <div class="chat-out">
      {#each aiMessages as msg}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role === 'user' ? 'You' : 'Mozart'}</div>
          <div class="chat-text">{msg.content}</div>
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
      {/if}
    </div>
    <div class="chat-input-row">
      <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..." onkeydown={e => e.key === 'Enter' && sendAI()} />
      <button class="btn-gold-sm" onclick={sendAI}>Ask</button>
    </div>
  </div>
  {/if}
</div>
</div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 1fr 300px; gap: 32px; min-height: calc(100vh - 100px); transition: grid-template-columns .2s; }
  .layout.side-collapsed { grid-template-columns: 1fr 20px; }
  .work-side { display: flex; flex-direction: column; border-left: 1px solid #1c1c1c; padding-left: 12px; overflow: hidden; }
  .side-toggle { background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; color: #9e9690; font-family: 'Space Mono', monospace; font-size: 11px; cursor: pointer; padding: 4px 10px; align-self: flex-start; line-height: 1; margin-bottom: 6px; }
  .side-toggle.expanded { padding: 10px 10px; }
  .side-toggle:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .songs-col { display: flex; flex-direction: column; gap: 10px; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; padding: 32px 0; text-align: center; }
  .empty-sm { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 4px 0; }
  .project-group { display: flex; flex-direction: column; gap: 4px; }
  .project-label { display: flex; align-items: center; gap: 10px; padding: 7px 12px; background: #111; border-radius: 3px; border: none; cursor: pointer; width: 100%; text-align: left; }
  .project-label:hover { background: #1c1c1c; }
  .proj-name { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; color: #cec9c1; flex: 1; }
  .proj-artist { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .proj-arr { font-size: 10px; color: #555; transition: transform .2s; }
  .proj-arr.open { transform: rotate(90deg); }
  .song-card { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; margin-left: 8px; }
  .song-card.exp { border-color: rgba(201,168,76,.4); }
  .song-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #1c1c1c; flex-wrap: wrap; }
  .song-card.exp .song-head { background: #252525; }
  .reorder-btns { display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; }
  .reorder-btn { font-size: 8px; padding: 1px 3px; background: transparent; border: none; color: #444; cursor: pointer; }
  .reorder-btn:hover { color: #c9a84c; }
  .song-info { display: flex; flex-direction: column; gap: 1px; min-width: 75px; cursor: pointer; }
  .song-code { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #c9a84c; }
  .song-title-txt { font-size: 11px; color: #9e9690; }
  .stage-pills { display: flex; gap: 3px; flex: 1; cursor: pointer; align-items: center; }
  .stage-pill { width: 16px; height: 5px; border-radius: 2px; background: #252525; border: 1px solid #303030; flex-shrink: 0; transition: all .2s; }
  .stage-pill.done { background: #4caf82; border-color: #4caf82; }
  .stage-pill.active { background: rgba(201,168,76,.5); border-color: #c9a84c; }
  .mini-player { height: 26px; flex-shrink: 0; max-width: 170px; accent-color: #c9a84c; }
  .audio-ref { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .song-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex-shrink: 0; cursor: pointer; }
  .stage-current { font-family: 'Space Mono', monospace; font-size: 9px; color: #c9a84c; letter-spacing: .08em; }
  .song-progress { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; }
  .arr { font-size: 10px; color: #555; transition: transform .2s; flex-shrink: 0; cursor: pointer; font-family: 'Space Mono', monospace; }
  .arr.open { transform: rotate(90deg); }
  .song-body { padding: 14px; border-top: 1px solid #1c1c1c; display: flex; flex-direction: column; gap: 14px; background: #0a0a0a; }
  .stages-row { display: flex; gap: 4px; flex-wrap: wrap; }
  .stage-box { display: flex; align-items: center; gap: 3px; padding: 4px 7px; border: 1px solid #252525; border-radius: 3px; background: #111; }
  .stage-box.active { border-color: rgba(201,168,76,.5); background: rgba(201,168,76,.06); }
  .stage-box.done { opacity: .5; }
  .stage-ckb { width: 13px; height: 13px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #4caf82; cursor: pointer; background: transparent; padding: 0; flex-shrink: 0; }
  .stage-box.done .stage-ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .stage-lbl { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .06em; color: #9e9690; cursor: pointer; background: transparent; border: none; padding: 0; }
  .stage-box.active .stage-lbl { color: #c9a84c; }
  .sent-ckb { font-family: 'Space Mono', monospace; font-size: 8px; padding: 1px 4px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .sent-ckb.sent { color: #4caf82; border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.08); }
  .field { display: flex; flex-direction: column; gap: 5px; }
  label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #9e9690; }
  .ta { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; padding: 8px 10px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 55px; line-height: 1.6; }
  .ta:focus { border-color: rgba(201,168,76,.4); }
  .lyrics-ta { min-height: 130px; font-size: 14px; }
  .versions-block { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .versions-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; background: #111; border-bottom: 1px solid #1c1c1c; }
  .version-tabs { display: flex; border-bottom: 1px solid #1c1c1c; }
  .vtab { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 5px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #555; cursor: pointer; margin-bottom: -1px; }
  .vtab:hover { color: #9e9690; }
  .vtab.on { color: #c9a84c; border-bottom-color: #c9a84c; }
  .version-audio { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #080808; border-bottom: 1px solid #1c1c1c; min-height: 44px; }
  .version-player { height: 26px; flex: 1; accent-color: #c9a84c; }
  .version-audio-name { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .version-audio-name.dim { color: #555; }
  .drop-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; flex: 1; text-align: center; }
  .drop-rehint { font-family: 'Space Mono', monospace; font-size: 10px; color: #333; }
  .drop-clear { background: transparent; border: none; color: #555; font-size: 16px; cursor: pointer; flex-shrink: 0; padding: 0; }
  .drop-clear:hover { color: #e05a4a; }
  .copied-banner { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; padding: 6px 12px; background: rgba(76,175,130,.08); border-bottom: 1px solid rgba(76,175,130,.2); }
  .feedback-list { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; }
  .fb-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #0f0f0f; }
  .fb-row.fb-done { opacity: .38; }
  .ckb-sm { width: 13px; height: 13px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }
  .fb-done .ckb-sm { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .fb-text { flex: 1; font-size: 12px; color: #cec9c1; }
  .fb-done .fb-text { text-decoration: line-through; color: #555; }
  .del-btn { background: transparent; border: none; color: #333; font-size: 14px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .fb-add-row { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #1c1c1c; }
  .add-inp { background: #111; border: 1px solid #252525; color: #f5f1ea; font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 9px; outline: none; border-radius: 3px; flex: 1; }
  .add-inp:focus { border-color: rgba(201,168,76,.4); }
  .add-inp::placeholder { color: #444; }
  .add-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; padding: 5px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .all-done-hint { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; padding: 6px 12px; text-align: center; opacity: .7; border-top: 1px solid #1c1c1c; }
  .right-col { display: flex; flex-direction: column; gap: 16px; border-left: 1px solid #1c1c1c; padding-left: 24px; position: sticky; top: 80px; height: calc(100vh - 100px); overflow-y: auto; }
  .timer-block { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #1c1c1c; border: 1px solid #252525; border-radius: 4px; flex-wrap: wrap; }
  .timer-block.alarmed { border-color: #e05a4a; background: rgba(224,90,74,.06); animation: pulse 1s ease-in-out 3; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .6 } }
  .timer-disp { font-family: 'Space Mono', monospace; font-size: 18px; font-weight: 700; color: #c9a84c; min-width: 75px; }
  .timer-block.alarmed .timer-disp { color: #e05a4a; }
  .timer-btns { display: flex; gap: 5px; margin-left: auto; }
  .alarm-msg { font-family: 'Space Mono', monospace; font-size: 10px; color: #e05a4a; width: 100%; letter-spacing: .1em; }
  .tips-block { display: flex; flex-direction: column; gap: 4px; }
  .tips-title { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); padding-bottom: 5px; border-bottom: 1px solid #303030; margin-bottom: 2px; }
  .tip-sec { border: 1px solid #1c1c1c; border-radius: 3px; overflow: hidden; }
  .tip-toggle { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; background: #111; border: none; width: 100%; text-align: left; }
  .tip-toggle:hover { background: #1c1c1c; }
  .tip-toggle-lbl { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .06em; color: rgba(201,168,76,.8); flex: 1; }
  .tip-tier { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; }
  .tip-arr { font-size: 9px; color: #555; transition: transform .2s; flex-shrink: 0; font-family: 'Space Mono', monospace; }
  .tip-arr.open { transform: rotate(90deg); }
  .tips-body { padding: 8px 12px; border-top: 1px solid #1c1c1c; display: flex; flex-direction: column; gap: 4px; background: #080808; max-height: 250px; overflow-y: auto; }
  .tip-row { font-size: 11px; color: #9e9690; line-height: 1.6; padding: 2px 0; border-bottom: 1px solid #0f0f0f; }
  .tip-row:last-child { border-bottom: none; }
  .card-block { padding: 12px; background: #1c1c1c; border-radius: 4px; border: 1px solid #252525; display: flex; flex-direction: column; gap: 8px; }
  .card-label { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; letter-spacing: .1em; }
  .card-text { font-family: 'Space Mono', monospace; font-size: 11px; color: #9e9690; line-height: 1.6; font-style: italic; }
  .mozart-block { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 150px; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); }
  .chat-out { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-size: 12px; color: #cec9c1; line-height: 1.5; }
  .chat-text.dim { color: #444; }
  .chat-input-row { display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 6px 9px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }
  .btn-ghost-sm { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 4px 9px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .btn-ghost-sm:hover { border-color: #c9a84c; color: #c9a84c; }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 6px 11px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
  .acapella-block { display: flex; flex-direction: column; gap: 7px; }
  .acapella-title { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .acapella-zone { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px dashed #303030; border-radius: 3px; background: #111; min-height: 42px; cursor: default; transition: border-color .15s; }
  .acapella-zone.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.05); }
  .acapella-zone.has-file { border-style: solid; border-color: #3c3c3c; }
  .acapella-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; flex: 1; text-align: center; }
  .acapella-fname { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acapella-clear { background: transparent; border: none; color: #555; font-size: 16px; cursor: pointer; padding: 0; flex-shrink: 0; }
  .acapella-clear:hover { color: #e05a4a; }
  .acapella-run-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 6px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; width: 100%; }
  .acapella-run-btn:hover { background: #d4b456; }
  .acapella-status { font-family: 'Space Mono', monospace; font-size: 11px; padding: 7px 10px; border-radius: 3px; }
  .acapella-status.loading { color: #9e9690; background: #1c1c1c; border: 1px solid #252525; }
  .acapella-status.error { color: #e05a4a; background: rgba(224,90,74,.07); border: 1px solid rgba(224,90,74,.2); }
  .acapella-result { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; background: rgba(76,175,130,.07); border: 1px solid rgba(76,175,130,.2); border-radius: 3px; }
  .acapella-result-name { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; font-weight: 700; }
  .acapella-result-meta { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; }
  .acapella-result-loc { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; }
</style>