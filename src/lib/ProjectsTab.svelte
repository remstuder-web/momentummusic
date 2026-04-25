<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext, parseActions, executeAction, mozartTools } from './mozartContext.js'
  import { GENRE_LIST } from '$lib/genres.js'
  import ListenLinkBlock from './ListenLinkBlock.svelte'
  import VocalEqChart from './VocalEqChart.svelte'
  import { onDestroy } from 'svelte'

  let projects = $state([])
  let songs = $state([])
  let sanityItems = $state([])
  let sanityChecks = $state({})
  let sanityText = $state("")
  let tipSections = $state([])
  let tipsText = $state("")
  let cards = $state([])
  let releasedSongIds = $state([])
  let loading = $state(true)
  let hitBenchmark = $state(null) // avg of reference tracks for comparison

  let selectedProjectId = $state(null)
  let expandedSongId = $state(null)
  let workTimerStart = $state(null)
  let workTimerSong = $state(null)
  let workTimerStage = $state(null)
  let songWorkLogs = $state([])
  const MIN_LOG_MINUTES = 5

  let selectedListenBg = $state('stars')  // 'stars' or 'void'
  let openTipSectionId = $state(null)
  let activeTipSectionId = $state(null)
  let activeTipText = $state("")
  let cardIdx = $state(0)
  let audioBlobUrls = $state({})
  let prodBlobUrls = {}  // song.id -> blob URL for production audio (module-level, survives tab switch)
  let mixBlobUrls  = {}  // song.id -> blob URL for mixing audio
  let instrBlobUrls = {} // song.id -> blob URL for instrumental audio
  let instrPendingName = {} // song.id -> filename being saved (shows immediately)
  let audioTick = $state(0) // increment to force header player re-render
  let activeSongTab = $state({})
  let lyricsOpen = $state({})
  let undoStack = $state([])
  let undoFlash = $state(false)
  const MAX_UNDO = 10

  // Vocal EQ
  let vocalEqCurves = $state({}) // song.id -> curves[] (flat array from API)
  const vocalEqCache = new Map() // persistent cache across expand/collapse
  let vocalEqStatus = $state({}) // song.id -> 'separating' | 'done' | 'error'
  let vocalEqLoading = $state({}) // song.id -> 'ref' | null
  let vocalRefUrl = $state({}) // song.id -> url input string
  let showVocalEq = $state({}) // song.id -> bool
  let vocalComparison = $state({}) // song.id -> comparison result
  let activeStem = $state({}) // song.id -> 'vocals' | 'drums' | 'bass' | 'other'
  let selectedRefId = $state({}) // song.id -> reference_track_id (string)
  let refTrackOptions = $state([]) // ref tracks that have EQ curves available
  let analyzerOpen = $state({}) // song.id -> { track, match, arc, feedback, trend }
  let successMatch = $state({}) // song.id -> result from /analyze-success-match
  let successMatchLoading = $state({}) // song.id -> bool
  let feedbackInsights = $state({}) // song.id -> result from /feedback-insights
  let feedbackLoading = $state({}) // song.id -> bool
  let trendVelocity = $state(null)
  let trendLoading = $state(false)
  let finishingChecklist = $state([])
  let checkedItems = $state({})
  let mozartAnalyzeOpen = $state({}) // song.id -> bool
  let mozartTrackQuery = $state({}) // song.id -> string
  let mozartAnalysis = $state({}) // song.id -> { loading, ok, error }
  let mozartInsight = $state({}) // song.id -> { strategic, creative, next_step }
  let mozartInsightLoading = $state({}) // song.id -> bool

  function formatMinSec(sec) {
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60)
    if (h > 0) return h + 'h ' + m + 'm'
    return m + 'm'
  } // song.id -> bool

  // Auto-resize textarea: starts at 1 line, grows with content
  function autoResize(node) {
    function resize() {
      node.style.height = 'auto'
      node.style.height = node.scrollHeight + 'px'
    }
    // Initial resize after a tick so value is set
    setTimeout(resize, 0)
    node.addEventListener('input', resize)
    return { destroy() { node.removeEventListener('input', resize) } }
  }

  // Plain DOM action — sets textarea value on mount/section-change, zero Svelte binding
  function setVal(node, val) {
    node.value = val ?? ''
    return {
      update(v) {
        // Only update if not currently focused (user typing)
        if (document.activeElement !== node) node.value = v ?? ''
      }
    }
  }

  function extractVersion(filename) {
    // Extract version string from filename: beat_v02.mp3 → v02, song_03.wav → 03
    const stem = filename.replace(/\.[^.]+$/, '')
    const m = stem.match(/[_\-\s](v?\d+)$/i)
    return m ? m[1] : stem.split(/[_\-\s]/).pop() || 'v01'
  }

  function sanitizeTitle(title) {
    return (title || '').replace(/[<>:"/\\|?*]/g, '').trim()
  }

  function buildAudioFilename(song, dir, versionNum) {
    const ext_map = { production: 'wav', mixing: 'wav' }
    const code = song.code || ''
    const title = song.title ? '_' + sanitizeTitle(song.title) : ''
    const ver = 'v' + String(versionNum).padStart(2, '0')
    // Can't know extension until file dropped — handled in saveSongAudio
    return dir === 'mixing'
      ? `${code}${title}_MIX_${ver}`
      : `${code}${title}_${ver}`
  }

  async function deleteAudioFile(dir, filename) {
    if (!filename) return
    try {
      await fetch(`http://localhost:4242/delete-audio?dir=${dir}&filename=${encodeURIComponent(filename)}`, { method: 'POST' })
      console.log('Deleted:', dir, filename)
    } catch(e) {}
  }

  function pushUndo(description, songId, workDataSnapshot, audioFileToDelete = null) {
    undoStack = [{ description, songId, workDataSnapshot, audioFileToDelete, timestamp: Date.now() }, ...undoStack].slice(0, MAX_UNDO)
  }

  async function undo() {
    if (!undoStack.length) return
    const action = undoStack[0]
    undoStack = undoStack.slice(1)
    const song = songs.find(s => s.id === action.songId)
    if (!song) return
    await supabase.from('songs').update({ work_data: action.workDataSnapshot }).eq('id', action.songId)
    song.work_data = action.workDataSnapshot
    songs = [...songs]
    audioTick++
    if (action.audioFileToDelete) {
      const dir = action.audioFileToDelete.includes('_MIX_') ? 'mixing' : 'production'
      fetch(
        `http://localhost:4242/delete-audio?dir=${dir}&filename=${encodeURIComponent(action.audioFileToDelete)}`,
        { method: 'POST' }
      ).catch(() => {})
    }
    undoFlash = true
    setTimeout(() => undoFlash = false, 1500)
  }

  async function saveSongAudio(file, song, dir, overwrite = false) {
    const wd = workData(song)
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'wav'

    // Overwrite mode: just swap the audio file on the active version, no new version
    if (overwrite) {
      const activeId = wd.active_version_id
      const activeV = wd.versions.find(v => v.id === activeId && v.version_type === dir)
      if (activeV) {
        const oldFilename = activeV.audio_path || ''
        const code = song.code || ''
        const artist = selectedProject?.artist ? '_' + sanitizeTitle(selectedProject.artist) : ''
        const title = song.title ? '_' + sanitizeTitle(song.title) : ''
        const verPart = dir === 'mixing' ? `MIX_${activeV.name.replace('MIX_', '')}` : activeV.name
        const filename = `${code}${artist}${title}_${verPart}.${ext}`
        pushUndo('Overwrote ' + filename + ' on ' + (song.title || song.code), song.id, JSON.parse(JSON.stringify(wd)), filename)
        const buf = await file.arrayBuffer()
        const res = await fetch(
          `http://localhost:4242/save-audio?dir=${dir}&filename=${encodeURIComponent(filename)}&oldfile=${encodeURIComponent(oldFilename)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }
        )
        const result = await res.json()
        if (!result.ok) throw new Error(result.error)
        if (dir === 'production') {
          if (prodBlobUrls[song.id]) URL.revokeObjectURL(prodBlobUrls[song.id])
          prodBlobUrls[song.id] = URL.createObjectURL(file)
        } else {
          if (mixBlobUrls[song.id]) URL.revokeObjectURL(mixBlobUrls[song.id])
          mixBlobUrls[song.id] = URL.createObjectURL(file)
        }
        await saveWorkData(song, wd2 => {
          const v = wd2.versions.find(v => v.id === activeId)
          if (v) { v.audio_path = filename; v.sent_to_artist = false }
          if (dir === 'production') wd2.prod_audio = filename
          else wd2.mix_audio = filename
        })
        audioTick++
        if (result.analysis) {
          await saveWorkData(song, wd2 => {
            const v = wd2.versions.find(v => v.id === activeId)
            if (v) v.analysis = result.analysis
          })
        }
        return filename
      }
    }

    const existingVersions = wd.versions.filter(v => v.version_type === dir)
    const nextVerNum = existingVersions.length
    const ver = 'v' + String(nextVerNum).padStart(2, '0')

    const code = song.code || ''
    const artist = selectedProject?.artist ? '_' + sanitizeTitle(selectedProject.artist) : ''
    const title = song.title ? '_' + sanitizeTitle(song.title) : ''
    const filename = dir === 'mixing'
      ? `${code}${artist}${title}_MIX_${ver}.${ext}`
      : `${code}${artist}${title}_${ver}.${ext}`

    const oldfile = dir === 'mixing' ? (wd.mix_audio || '') : (wd.prod_audio || '')

    pushUndo('Dropped ' + filename + ' on ' + (song.title || song.code), song.id, JSON.parse(JSON.stringify(wd)), filename)

    const buf = await file.arrayBuffer()
    const res = await fetch(
      `http://localhost:4242/save-audio?dir=${dir}&filename=${encodeURIComponent(filename)}&oldfile=${encodeURIComponent(oldfile)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }
    )
    const result = await res.json()
    if (!result.ok) throw new Error(result.error)

    // If this is the FIRST production version, delete the original demo file
    if (dir === 'production' && existingVersions.length === 0 && song.audio_path) {
      await deleteAudioFile('demo', song.audio_path)
      await supabase.from('songs').update({ audio_path: null }).eq('id', song.id)
      song.audio_path = null; songs = [...songs]
    }

    // If this is the FIRST mix version being dropped, delete the last production file
    if (dir === 'mixing' && existingVersions.length === 0 && wd.prod_audio) {
      await deleteAudioFile('production', wd.prod_audio)
      await saveWorkData(song, wd2 => { wd2.prod_audio = '' })
    }

    if (dir === 'production') {
      if (prodBlobUrls[song.id]) URL.revokeObjectURL(prodBlobUrls[song.id])
      prodBlobUrls[song.id] = URL.createObjectURL(file)
      await saveWorkData(song, wd => {
        wd.prod_audio = filename
        const vName = ver
        const existing = wd.versions.find(v => v.version_type === 'production' && v.name === vName)
        if (existing) {
          existing.audio_path = filename; existing.sent_to_artist = false
          wd.active_version_id = existing.id
          const existingIndex = wd.versions.indexOf(existing)
          const toDelete = wd.versions.filter((v, i) => i > existingIndex && v.version_type === 'production')
          for (const v of toDelete) {
            if (v.audio_path) fetch(`http://localhost:4242/delete-audio?dir=production&filename=${encodeURIComponent(v.audio_path)}`, { method: 'POST' })
          }
          wd.versions = wd.versions.filter((v, i) => !(i > existingIndex && v.version_type === 'production'))
        } else {
          const v = { id: 'v'+Date.now(), name: vName, version_type: 'production', created_at: new Date().toISOString(), feedback: [], notes: '', audio_path: filename, sent_to_artist: false }
          wd.versions.push(v); wd.active_version_id = v.id
        }
      })
    } else {
      if (mixBlobUrls[song.id]) URL.revokeObjectURL(mixBlobUrls[song.id])
      mixBlobUrls[song.id] = URL.createObjectURL(file)
      await saveWorkData(song, wd => {
        wd.mix_audio = filename
        const vName = 'MIX_' + ver
        const existing = wd.versions.find(v => v.version_type === 'mixing' && v.name === vName)
        if (existing) {
          existing.audio_path = filename; existing.sent_to_artist = false
          wd.active_version_id = existing.id
          const existingIndex = wd.versions.indexOf(existing)
          const toDelete = wd.versions.filter((v, i) => i > existingIndex && v.version_type === 'mixing')
          for (const v of toDelete) {
            if (v.audio_path) fetch(`http://localhost:4242/delete-audio?dir=mixing&filename=${encodeURIComponent(v.audio_path)}`, { method: 'POST' })
          }
          wd.versions = wd.versions.filter((v, i) => !(i > existingIndex && v.version_type === 'mixing'))
        } else {
          const v = { id: 'v'+Date.now(), name: vName, version_type: 'mixing', created_at: new Date().toISOString(), feedback: [], notes: '', audio_path: filename, sent_to_artist: false }
          wd.versions.push(v); wd.active_version_id = v.id
        }
      })
    }
    audioTick++

    // Use analysis already returned by save-audio (full Essentia via analyze_audio.py)
    if (result.analysis) {
      const activeId = workData(song).active_version_id
      await saveWorkData(song, wd => {
        const v = wd.versions.find(v => v.id === activeId)
        if (v) v.analysis = result.analysis
      })
    }

    return filename
  }

  // When song title changes, rename the audio files in Dropbox
  async function renameSongAudioFiles(song, newTitle) {
    const wd = workData(song)
    const code = song.code || ''
    const artist = selectedProject?.artist ? '_' + sanitizeTitle(selectedProject.artist) : ''
    const sanitized = newTitle ? '_' + sanitizeTitle(newTitle) : ''

    for (const dir of ['production', 'mixing']) {
      const oldFile = dir === 'mixing' ? wd.mix_audio : wd.prod_audio
      if (!oldFile) continue
      const match = oldFile.match(/_((?:MIX_)?v\d{2})\.(\w+)$/)
      if (!match) continue
      const verPart = match[1], ext = match[2]
      const newFile = `${code}${artist}${sanitized}_${verPart}.${ext}`
      if (newFile === oldFile) continue
      try {
        await fetch(`http://localhost:4242/rename-audio?dir=${dir}&oldfile=${encodeURIComponent(oldFile)}&newfile=${encodeURIComponent(newFile)}`, { method: 'POST' })
        await saveWorkData(song, wd2 => {
          if (dir === 'mixing') wd2.mix_audio = newFile
          else wd2.prod_audio = newFile
        })
      } catch(e) { console.error('rename failed', e) }
    }

    // Also rename instrumental file if present
    if (wd.instr_audio) {
      const match = wd.instr_audio.match(/_(v\d{2,3})_(\d+bpm)\.(\w+)$/i) || wd.instr_audio.match(/_(v\d{2,3})\.(\w+)$/)
      if (match) {
        const verTempoBpm = match[2] && match[2].includes('bpm') ? `_${match[1]}_${match[2]}` : `_${match[1]}`
        const ext = match[3] || match[2]
        const newInstrFile = `${code}${artist}${sanitized}${verTempoBpm}.${ext}`
        if (newInstrFile !== wd.instr_audio) {
          try {
            await fetch(`http://localhost:4242/rename-audio?dir=instrumental&oldfile=${encodeURIComponent(wd.instr_audio)}&newfile=${encodeURIComponent(newInstrFile)}`, { method: 'POST' })
            await saveWorkData(song, wd2 => { wd2.instr_audio = newInstrFile })
          } catch(e) { console.error('instrumental rename failed', e) }
        }
      }
    }
  }

  async function handleProdDrop(e, song) {
    e.preventDefault(); song._prodDrag = false; songs = [...songs]
    const file = e.dataTransfer.files[0]; if (!file) return
    try { await saveSongAudio(file, song, 'production', e.altKey) } catch(err) { alert('Error: ' + err.message) }
  }

  async function handleMixDrop(e, song) {
    e.preventDefault(); song._mixDrag = false; songs = [...songs]
    const file = e.dataTransfer.files[0]; if (!file) return
    try { await saveSongAudio(file, song, 'mixing', e.altKey) } catch(err) { alert('Error: ' + err.message) }
  }

  async function handleInstrumentalDrop(e, song) {
    e.preventDefault(); song._instrDrag = false; songs = [...songs]
    const file = e.dataTransfer.files[0]; if (!file) return

    const wd = workData(song)
    const artist = selectedProject?.artist || ''
    const safe = s => (s||'').replace(/[<>:"/\\|?*]/g,'').trim()

    // Extract version+bpm suffix from dropped filename
    // e.g. "beat_v02_94bpm.wav" → suffix "_v02_94bpm"
    // e.g. "prod_v003.wav"      → suffix "_v003"
    // e.g. "song.wav"           → suffix "_v01" (default)
    const base = file.name.replace(/\.[^.]+$/, '')
    const ext  = file.name.slice(file.name.lastIndexOf('.'))
    const vIdx = base.search(/[_\s\-]?v\d{1,3}/i)
    let suffix = '_v01'
    if (vIdx !== -1) {
      const raw = base.slice(vIdx).replace(/^[_\s\-]+/, '')
      suffix = '_' + raw.replace(/\s+/g, '_').replace(/^v(\d)(?=[_\s]|$)/i, (_, n) => 'v0' + n)
    } else if (song.tempo) {
      suffix = '_v01_' + song.tempo + 'bpm'
    }

    const parts = [safe(song.code), safe(artist), safe(song.title||'')].filter(Boolean)
    const filename = parts.join('_') + suffix + ext
    const vLabel = suffix.replace(/^_/, '').split('_')[0]
    const oldfile = wd.instr_audio || ''

    // Show filename immediately before async work
    instrPendingName = { ...instrPendingName, [song.id]: filename }
    songs = [...songs]

    try {
      const buf = await file.arrayBuffer()
      const res = await fetch(`http://localhost:4242/save-instrumental?filename=${encodeURIComponent(filename)}&oldfile=${encodeURIComponent(oldfile)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error)

      await saveWorkData(song, wd2 => {
        wd2.instr_audio = filename
        wd2.instr_version = vLabel
        wd2.instr_sent = false
      })
      if (instrBlobUrls[song.id]) URL.revokeObjectURL(instrBlobUrls[song.id])
      instrBlobUrls = { ...instrBlobUrls, [song.id]: URL.createObjectURL(file) }
      audioTick++
      console.log(`✓ Instrumental saved: ${filename}`)
    } catch(err) {
      alert('Error saving instrumental: ' + err.message + '\nMake sure the watcher is running.')
    }
  }

  async function sendInstrumentalToArtist(song) {
    const wd = workData(song)
    if (!wd.instr_audio) return

    // Generate listen link immediately — copy to clipboard while user gesture is fresh
    const LISTEN_URL = 'https://momentummusic.vercel.app'
    const listenId = Math.random().toString(36).slice(2, 10).toUpperCase()
    const listenUrl = `${LISTEN_URL}?s=${listenId}`

    const versionLabel = wd.instr_version ? ` — ${wd.instr_version.toUpperCase()}` : ''
    const lines = [
      `${song.title || song.code}${versionLabel} (Instrumental)`,
      '',
      `Listen / Download: ${listenUrl}`
    ]
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch(e) {
      const ta = document.createElement('textarea')
      ta.value = lines.join('\n'); document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }

    await saveWorkData(song, wd2 => { wd2.instr_sent = true })
    song._instr_flash = true; songs = [...songs]
    setTimeout(() => { song._instr_flash = false; songs = [...songs] }, 2500)

    // Insert listen session in background
    ;(async () => {
      try {
        const dbxPath = `/!MOMENTUM MUSIC/Production/-Instrumentals/${wd.instr_audio}`
        const linkRes = await fetch('http://localhost:4242/share-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: dbxPath })
        })
        const { shareLink } = await linkRes.json()
        const songEntry = {
          code: song.code,
          title: wd.instr_audio,
          filename: wd.instr_audio,
          shareUrl: shareLink || null,
          previewUrl: null
        }
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        const instrPayload = {
          id: listenId,
          songs: [songEntry],
          patch_name: `${selectedProject?.artist || ''} — ${song.title || song.code} (Instrumental)`.trim(),
          expires_at: expiresAt,
          background: selectedListenBg,
          feedback_enabled: false,
          session_type: 'instrumental'
        }
        const { error: instrErr } = await supabase.from('share_sessions').insert(instrPayload)
        if (instrErr) {
          const { session_type, ...payloadNoType } = instrPayload
          await supabase.from('share_sessions').insert(payloadNoType)
        }
        console.log('✓ Instrumental listen session ready:', listenUrl)
      } catch(e) { console.warn('Instrumental listen session error:', e.message) }
    })()
  }

  async function copyInstrumentalLink(song) {
    const wd = workData(song)
    if (!wd.instr_audio) return
    try {
      const res = await fetch('http://localhost:4242/get-instrumental-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: wd.instr_audio })
      })
      const data = await res.json()
      if (data.shareLink) {
        navigator.clipboard.writeText(data.shareLink)
        song._instr_copied = true; songs = [...songs]
        setTimeout(() => { song._instr_copied = false; songs = [...songs] }, 2500)
      } else alert('No Dropbox link yet — make sure Dropbox is connected.')
    } catch(e) { alert('Watcher not running.') }
  }

  async function handleStemsZipDrop(e, song) {
    e.preventDefault(); song._stemsDrag = false; songs = [...songs]
    const file = e.dataTransfer.files[0]; if (!file) return
    if (!file.name.toLowerCase().endsWith('.zip')) { alert('Please drop a ZIP file.'); return }

    const wd = workData(song)
    const artist = selectedProject?.artist || ''
    const safe = s => (s||'').replace(/[<>:"/\\|?*]/g,'').trim()

    // Parse version suffix from dropped filename — find _V01_133bpm etc, uppercase it
    const baseName = file.name.replace(/\.zip$/i, '')
    const vMatch = baseName.match(/(_?[Vv]\d+.*)$/)
    const versionSuffix = vMatch ? '_' + vMatch[1].replace(/^_+/, '').toUpperCase() : ''
    // e.g. "mysong_V01_133bpm" → "_V01_133BPM", "stems_v02" → "_V02"

    // Extract version label for display (e.g. "_V01_133BPM" → "V01")
    const stemsVersionLabel = vMatch ? vMatch[1].replace(/^_+/, '').toUpperCase().split('_')[0] : ''

    const parts = [safe(song.code), safe(artist), safe(song.title||''), 'STEMS'].filter(Boolean)
    const filename = parts.join('_') + versionSuffix + '.zip'
    const oldfile = wd.stems_zip || ''

    try {
      const buf = await file.arrayBuffer()
      const res = await fetch('http://localhost:4242/save-stems-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-filename': encodeURIComponent(filename),
          'x-oldfile': encodeURIComponent(oldfile),
          'x-artist': encodeURIComponent(artist),
          'x-song': encodeURIComponent(song.title || song.code || '')
        },
        body: buf
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error)

      await saveWorkData(song, wd2 => {
        wd2.stems_received = true
        wd2.stems_zip = filename
        wd2.stems_version = stemsVersionLabel
        wd2.stems_sharelink = result.shareLink || null
      })
    } catch(err) {
      alert('Error uploading stems: ' + err.message + '\nMake sure the watcher is running.')
    }
  }

  async function copyDropboxStemsLink(song) {
    const wd = workData(song)
    if (!wd.stems_zip) return
    try {
      const res = await fetch('http://localhost:4242/share-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: `/!MOMENTUM MUSIC/Stems/${wd.stems_zip}` })
      })
      const { shareLink } = await res.json()
      if (!shareLink) { alert('No Dropbox link yet.'); return }
      try { await navigator.clipboard.writeText(shareLink) } catch(e) {
        const ta = document.createElement('textarea')
        ta.value = shareLink; document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
      }
      song._stemsCopied = true; songs = [...songs]
      setTimeout(() => { song._stemsCopied = false; songs = [...songs] }, 2000)
    } catch(e) { alert('Watcher not running.') }
  }

  async function sendStems(song) {
    const wd = workData(song)
    if (!wd.stems_zip) return

    // Read stems_version directly from work_data to get freshest value
    const rawWd = song.work_data || {}
    const stemsVersion = rawWd.stems_version || wd.stems_version || ''
    const stemsLabel = stemsVersion ? `STEMS ${stemsVersion}` : 'STEMS'

    const LISTEN_URL = 'https://momentummusic.vercel.app'
    const listenId = Math.random().toString(36).slice(2, 10).toUpperCase()
    const listenUrl = `${LISTEN_URL}?s=${listenId}`

    const lines = [
      `${song.title || song.code} — ${stemsLabel}`,
      '',
      `Download: ${listenUrl}`
    ]
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch(e) {
      const ta = document.createElement('textarea')
      ta.value = lines.join('\n'); document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }

    song._stemsSent = true; songs = [...songs]
    setTimeout(() => { song._stemsSent = false; songs = [...songs] }, 2500)
    await saveWorkData(song, wd2 => { wd2.stems_sent = true })

    ;(async () => {
      try {
        const res = await fetch('http://localhost:4242/share-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: `/!MOMENTUM MUSIC/Stems/${wd.stems_zip}` })
        })
        const { shareLink } = await res.json()
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        await supabase.from('share_sessions').insert({
          id: listenId,
          songs: [{
            code: song.code,
            title: song.title || song.code,
            filename: wd.stems_zip,
            stems_version: stemsVersion,
            shareUrl: shareLink || null,
            previewUrl: null
          }],
          patch_name: `${selectedProject?.artist || ''} — ${song.title || song.code} (Stems)`.trim(),
          expires_at: expiresAt,
          background: 'void',
          feedback_enabled: false,
          stems_only: true
        })
        console.log('✓ Stems session ready:', listenUrl)
      } catch(e) { console.warn('Stems session error:', e.message) }
    })()
  }

  // Best available audio src for header player — mixing > production only
  function bestAudioSrc(song) {
    const wd = workData(song)
    if (mixBlobUrls[song.id]) return { src: mixBlobUrls[song.id], label: 'MIX' }
    if (wd.mix_audio) return { src: `http://localhost:4242/mixing/${encodeURIComponent(wd.mix_audio)}`, label: 'MIX' }
    if (prodBlobUrls[song.id]) return { src: prodBlobUrls[song.id], label: 'PROD' }
    if (wd.prod_audio) return { src: `http://localhost:4242/production/${encodeURIComponent(wd.prod_audio)}`, label: 'PROD' }
    if (song.audio_path && !wd.prod_audio && !wd.mix_audio) {
      return { src: `http://localhost:4242/production/${encodeURIComponent(song.audio_path)}`, label: 'PROD' }
    }
    return null
  }
  let fbInput = $state({})
  let deadlinesOpen = $state(false)
  let sanityOpen = $state(false)
  let tipsOpen = $state(false)

  // ── Timer ─────────────────────────────────────────────────────────
  let timerSec     = $state(0)
  let timerTarget  = $state(0)
  let timerRunning = $state(false)
  let timerInterval = null
  let timerPreset  = $state(0)
  let timerDoneMsg = $state('')
  // sessionLog: [{stage, seconds}] — accumulated across countdowns until Reset
  let sessionLog   = $state([])
  let noLog        = $state(false)  // when true, timer runs without logging
  // captured at Start so Reset always has the right song/stage even if user clicks elsewhere
  let timerSong    = null
  let timerStage   = ''

  function showTimerDone(msg) {
    timerDoneMsg = msg
    setTimeout(() => timerDoneMsg = '', 4000)
  }

  const TIMER_PRESETS = [
    { label: '1m',  sec: 60 },
    { label: '15m', sec: 900 },
    { label: '30m', sec: 1800 },
    { label: '1h',  sec: 3600 },
    { label: '2h',  sec: 7200 },
  ]

  // Mozart
  let aiInput = $state('')
  let aiMessages = $state([])
  let aiLoading = $state(false)
  let chatContainer = $state(null)
  $effect(() => {
    if (aiMessages.length && chatContainer) {
      setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight }, 50)
    }
  })

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
      .replace(/\n/g, '<br>')
  }

  // Deadlines & Tasks
  let newDeadlineLabel = $state('')
  let newDeadlineDate = $state('')
  let newTaskLabel = $state('')
  let newTaskDate  = $state('')
  let newTaskTime  = $state('')
  let newTaskSong  = $state('')
  let newTaskStage = $state('')

  const PROJ_SONG_STAGES = [
    { id: 'production',   label: 'PRODUCTION',   prefix: 'PR' },
    { id: 'mix_prep',     label: 'MIX PREP',      prefix: 'MP' },
    { id: 'mixing',       label: 'MIXING',        prefix: 'MR' },
    { id: 'mastering',    label: 'MASTERING',     prefix: 'MA' },
    { id: 'stems',        label: 'STEMS',         prefix: 'ST' },
  ]

  function getProjActiveVersion(song, stage) {
    const wd = song?.work_data || {}
    const versions = (wd.versions || []).filter(v => v.version_type === stage)
    const active = versions.find(v => v.id === wd.active_version_id)
    return active || versions[versions.length - 1] || null
  }

  // Create project modal
  let showCreateProject = $state(false)
  let newProjName = $state('')
  let newProjArtist = $state('')
  let newProjColor = $state('#9b6fd4')

  function getPublicFilename(internalFilename, artist) {
    if (!internalFilename) return internalFilename
    const withoutCode = internalFilename.replace(/^\d{8}_/, '')
    const artistClean = (artist || '').toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '').trim().replace(/\s+/g, '_')
    if (!artistClean || withoutCode.toUpperCase().includes(artistClean)) return withoutCode
    return artistClean + '_' + withoutCode
  }

  const STAGES = [
    { id: 'demo',         label: 'DEMO' },
    { id: 'production',   label: 'PRODUCTION', hasSent: true, hasVersions: true, versionType: 'production' },
    { id: 'mix_prep',     label: 'MIX PREP' },
    { id: 'mixing',       label: 'MIXING', hasSent: true, hasVersions: true, versionType: 'mixing' },
    { id: 'mastering',    label: 'MASTERING' },
  ]

  const RELEASE_CHECKLIST = [
    { id: 'stems',        label: 'Stems delivered' },
    { id: 'master',       label: 'Master approved' },
    { id: 'metadata',     label: 'Metadata complete' },
    { id: 'distribution', label: 'Submitted to distribution' },
    { id: 'playlist',     label: 'Playlist pitching done' },
    { id: 'press',        label: 'Press/EPK sent' },
    { id: 'social',       label: 'Social content scheduled' },
    { id: 'date',         label: 'Release date confirmed' },
  ]

  const STAGE_TIP_MAP = {
    demo: 1, production: 2, instrumental: 2, mix_prep: 5, mixing: 5, mastering: 5
  }

  const COLORS = ['#c9a84c','#9b6fd4','#4a9fd4','#4caf82','#e05a4a','#e07a4a','#4ac9c9','#c94a9f','#888']

  let selectedProject = $derived(projects.find(p => p.id === selectedProjectId) || null)
  let sortedProjects = $derived(projects.slice().sort((a,b) => (a.artist||'').localeCompare(b.artist||'') || (a.name||'').localeCompare(b.name||'')))
  let projectSongs = $derived(songs.filter(s => s.project_id === selectedProjectId && !getArchived(s)).sort((a,b) => (a.title||a.code||'').localeCompare(b.title||b.code||'')))
  let expandedSong = $derived(songs.find(s => s.id === expandedSongId) || null)
  let rightTips = $derived(getRightTips())
  let timerDisplay = $derived(timerTarget > 0
    ? formatTime(Math.max(0, timerTarget - timerSec))
    : formatTime(timerSec)
  )
  let currentCard = $derived(cards[cardIdx % (cards.length || 1)] || null)
  let projectDeadlines = $derived(getProjectDeadlines())
  let projectTasks = $derived(getProjectTasks())

  function getArchived(song) { return !!(song.work_data?.archived) }

  function getRightTips() {
    if (!expandedSong) return []
    const wd = workData(expandedSong)
    const stageNum = STAGE_TIP_MAP[wd.current_stage] || 2
    return tipSections.filter(s => s.stage_num === stageNum)
  }
  function getProjectDeadlines() {
    if (!selectedProject) return []
    return (selectedProject.deadlines||[]).filter(d=>!d.done).sort((a,b)=>(a.date||'').localeCompare(b.date||''))
  }
  function getProjectTasks() {
    if (!selectedProject) return []
    return (selectedProject.tasks||[]).filter(t=>!t.done).sort((a,b)=>(a.date||'').localeCompare(b.date||''))
  }

  async function load() {
    try {
      const [projRes, songsRes, sanityRes, tipsRes, cardsRes, releasesRes, refRes] = await Promise.all([
        supabase.from('projects').select('*').neq('status','archived').order('position'),
        supabase.from('songs').select('id,title,code,project_id,work_data,position,key,tempo,tags,reference_links,audio_path,notes,feedback,status,release_date,spotify_url').not('project_id','is',null).order('position'),
        supabase.from('work_checklist').select('*').eq('stage_num',6).order('position'),
        supabase.from('work_tip_sections').select('*, work_tips(*)').order('stage_num').order('position'),
        supabase.from('work_cards').select('*').order('position'),
        supabase.from('releases').select('song_id,song_code'),
        supabase.from('reference_tracks').select('tempo,energy,danceability,loudness,brightness,valence').neq('collection_name','my_productions'),
      ])
      projects = projRes.data || []
      songs = songsRes.data || []
      audioTick++
      sanityItems = sanityRes.data || []
      sanityText = sanityItems.map(i => i.item).join('\n')
      tipSections = tipsRes.data || []
      tipsText = tipSections.map(s =>
        '## ' + s.label + '\n' + (s.work_tips||[]).map(t => t.tip).join('\n')
      ).join('\n\n')
      cards = cardsRes.data || []
      const refs = refRes.data || []
      if (refs.length) {
        const avg = (arr, key) => { const vals = arr.map(r => r[key]).filter(v => v != null); return vals.length ? vals.reduce((s,v) => s+v, 0)/vals.length : null }
        hitBenchmark = {
          bpm: avg(refs, 'tempo') ? Math.round(avg(refs, 'tempo')) : null,
          loudness_lufs: avg(refs, 'loudness') ? Math.round(avg(refs, 'loudness') * 10) / 10 : null,
          energy: avg(refs, 'energy') ? Math.round(avg(refs, 'energy') * 100) / 100 : null,
          danceability: avg(refs, 'danceability') ? Math.round(avg(refs, 'danceability') * 100) / 100 : null,
          brightness: avg(refs, 'brightness') ? Math.round(avg(refs, 'brightness') * 1000) / 1000 : null,
          count: refs.length
        }
      }
      const rels = releasesRes.data || []
      releasedSongIds = [
        ...rels.filter(r => r.song_id).map(r => r.song_id),
        ...rels.filter(r => r.song_code).map(r => r.song_code)
      ]
    if (projects.length) {
      const last = localStorage.getItem('mm_last_project_id')
      selectedProjectId = (last && projects.find(p => p.id === Number(last) || p.id === last))
        ? (projects.find(p => p.id === Number(last) || p.id === last)?.id)
        : projects[0].id
    }
    } catch(e) { console.error('ProjectsTab load error:', e) }
    loading = false
    // Sync feedback from listen links in background
    syncFeedbackFromListenLinks()
  }

  function fmtSec(s) { const t=Math.max(0,Math.floor(s||0)); return Math.floor(t/60)+':'+(t%60+'').padStart(2,'0') }

  async function syncFeedbackFromListenLinks() {
    try {
      const { data: sessions } = await supabase
        .from('share_sessions')
        .select('id, songs, feedback, patch_name, created_at')
        .eq('feedback_enabled', true)
      if (!sessions?.length) return

      for (const session of sessions) {
        const fbData = session.feedback || {}
        for (const sessionSong of (session.songs || [])) {
          const code = sessionSong.code
          const fbItems = fbData[code] || []
          if (!fbItems.length) continue

          const song = songs.find(s => s.code === code)
          if (!song) continue

          const wd = song.work_data || {}
          const versions = wd.versions || []
          if (!versions.length) continue
          const latestV = versions[versions.length - 1]

          // Track how many we've already imported per session
          const importKey = session.id
          const alreadyImported = (song.work_data?.feedback_sync || {})[importKey] || 0
          const newItems = fbItems.slice(alreadyImported)
          if (!newItems.length) continue

          const isFirst = alreadyImported === 0

          await saveWorkData(song, wd2 => {
            const v = wd2.versions?.[wd2.versions.length - 1]
            if (!v) return
            if (!v.feedback) v.feedback = []
            newItems.forEach(fb => {
              v.feedback.push({
                id: 'lnk_' + session.id + '_' + Date.now() + Math.random().toString(36).slice(2),
                text: `[${fmtSec(fb.ts)}] ${fb.text}`,
                done: false,
                from_listen: true
              })
            })
            if (!wd2.feedback_sync) wd2.feedback_sync = {}
            wd2.feedback_sync[importKey] = fbItems.length
          })

          // First feedback ever → create inbox notification
          if (isFirst) {
            const artist = projects.find(p => p.id === song.project_id)?.artist || ''
            await supabase.from('inbox_notifications').insert({
              type: 'feedback',
              song_code: code,
              song_title: sessionSong.title || code,
              artist,
              session_id: session.id,
              patch_name: session.patch_name || '',
              message: `${newItems.length} feedback item${newItems.length > 1 ? 's' : ''} received`,
              read: false
            }).then(({ error }) => { if (error) console.warn('inbox insert error:', error.message) })
          }
        }
      }
    } catch(e) { console.warn('syncFeedbackFromListenLinks error:', e.message) }
  }

  function workData(song) {
    const wd = song.work_data || {}
    return {
      project_info:    wd.project_info    || '',
      current_stage:   wd.current_stage   || 'production',
      archived:        wd.archived        || false,
      sent_to_mastering: wd.sent_to_mastering || false,
      stems_received:  wd.stems_received  || false,
      stems_zip:       wd.stems_zip       || '',
      stems_sent:      wd.stems_sent      || false,
      stems_version:   wd.stems_version   || '',
      stems_sharelink: wd.stems_sharelink || null,
      prod_sharelink:  wd.prod_sharelink  || '',
      mix_sharelink:   wd.mix_sharelink   || '',
      prod_audio:      wd.prod_audio      || '',
      mix_audio:       wd.mix_audio       || '',
      instr_audio:     wd.instr_audio     || '',
      instr_version:   wd.instr_version   || '',
      instr_sent:      wd.instr_sent      || false,
      // Production sub-steps
      prod_lyrics:     wd.prod_lyrics     || false,
      prod_vocal_rec:  wd.prod_vocal_rec  || false,
      prod_vocal_prep: wd.prod_vocal_prep || false,
      lyrics_text:     wd.lyrics_text     || wd.stages?.lyrics?.text || '',
      stages: {
        demo:         { done: false, ...(wd.stages?.demo         || {}) },
        production:   { done: false, sent: false, ...(wd.stages?.production   || {}) },
        instrumental: { done: false, ...(wd.stages?.instrumental || {}) },
        mix_prep:     { done: false, ...(wd.stages?.mix_prep     || {}) },
        mixing:       { done: false, sent: false, ...(wd.stages?.mixing       || {}) },
        mastering:    { done: false, ...(wd.stages?.mastering    || {}) },
      },
      versions:          wd.versions          || [],
      active_version_id: wd.active_version_id || null,
      session_log:       wd.session_log        || [],
      released:          wd.released           || false,
      feedback_sync:     wd.feedback_sync      || {},  // tracks imported listen-link feedback counts
    }
  }

  async function saveWorkData(song, updater) {
    const wd = workData(song)
    updater(wd)
    song.work_data = { ...wd }  // new reference forces Svelte reactivity
    songs = [...songs]
    await supabase.from('songs').update({ work_data: song.work_data }).eq('id', song.id)
  }

  // Save currently active tip section before switching away
  async function saveActiveTips() {
    if (!activeTipSectionId) return
    // Read directly from DOM textarea to get latest unsaved content
    const ta = document.querySelector('.tips-active-ta')
    const text = ta ? ta.value : activeTipText
    if (!text && !activeTipText) return
    const sec = tipSections.find(s => s.id === activeTipSectionId)
    if (!sec) return
    const lines = text.split('\n').map(l => l.trimEnd())
    while (lines.length && lines[lines.length-1] === '') lines.pop()
    const tips = (sec.work_tips||[]).sort((a,b)=>a.position-b.position)
    for (let i = 0; i < lines.length; i++) {
      if (tips[i]) {
        if (tips[i].tip !== lines[i] || tips[i].position !== i)
          await supabase.from('work_tips').update({ tip: lines[i], position: i }).eq('id', tips[i].id)
      } else await supabase.from('work_tips').insert({ tip: lines[i], section_id: activeTipSectionId, position: i })
    }
    for (let i = lines.length; i < tips.length; i++) await supabase.from('work_tips').delete().eq('id', tips[i].id)
    const { data } = await supabase.from('work_tip_sections').select('*, work_tips(*)').eq('id', activeTipSectionId).single()
    if (data) tipSections = tipSections.map(s => s.id === data.id ? data : s)
  }

  function setStage(song, stageId) {
    saveActiveTips()
    saveWorkData(song, wd => { wd.current_stage = stageId })
    openTipSectionId = null
    activeTipSectionId = null
    activeTipText = ''
  }
  function toggleStageDone(song, stageId) {
    saveWorkData(song, wd => {
      if (!wd.stages[stageId]) wd.stages[stageId] = { done: false }
      wd.stages[stageId].done = !wd.stages[stageId].done
    })
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
  function sendToMastering(song) {
    saveWorkData(song, wd => { wd.sent_to_mastering = !wd.sent_to_mastering })
  }

  let activeInfoTab = $state('notes')
  let refLinkInput = $state({}) // project.id -> input value
  let refsOpen = $state({})    // project.id -> bool

  function projectRefs(p) {
    const m = p.project_meta || {}
    const raw = m.reference_links
    if (Array.isArray(raw)) return raw
    // migrate from old plain-text general_references
    if (p.general_references) {
      return p.general_references.split('\n').filter(Boolean).map(url => ({ id: 'r'+Date.now()+Math.random(), url: url.trim(), label: '' }))
    }
    return []
  }

  async function addRefLink(p, url) {
    if (!url.trim()) return
    let name = ''
    if (url.includes('spotify')) {
      try {
        const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url.trim())}`)
        if (r.ok) { const d = await r.json(); name = d.title || '' }
      } catch(e) {}
    }
    const refs = [...projectRefs(p), { id: 'r'+Date.now(), url: url.trim(), name }]
    await updateMeta(p, 'reference_links', refs)
    refLinkInput[p.id] = ''
    refsOpen[p.id] = true
    refsOpen = {...refsOpen}
  }

  // Preview audio player for reference links
  let refPreviewAudio = null
  let refPlayingUrl = $state('')

  async function playRefUrl(url) {
    if (!url) return
    const spotifyId = url.match(/track\/([A-Za-z0-9]+)/)?.[1]
    if (!spotifyId) { window.open(url, 'momentum_popup', 'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes'); return }

    // Toggle off if already playing
    if (refPlayingUrl === url) {
      refPreviewAudio?.pause()
      refPlayingUrl = ''
      return
    }

    // Look up preview_url from reference_tracks
    const { data } = await supabase.from('reference_tracks').select('preview_url').eq('spotify_id', spotifyId).maybeSingle()
    const previewUrl = data?.preview_url

    if (!previewUrl) {
      window.open(url, 'momentum_popup', 'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes')
      return
    }

    refPreviewAudio?.pause()
    refPreviewAudio = new Audio(previewUrl)
    refPreviewAudio.volume = 0.8
    refPreviewAudio.play()
    refPlayingUrl = url
    refPreviewAudio.onended = () => { refPlayingUrl = '' }
  }

  function openSpotifyPopupProj(url) {
    window.open(url, 'momentum_popup', 'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes')
  }

  async function removeRefLink(p, id) {
    const refs = projectRefs(p).filter(r => r.id !== id)
    await updateMeta(p, 'reference_links', refs)
  }

  function linkLabel(url) {
    try {
      const u = new URL(url)
      if (u.hostname.includes('spotify')) return '🎵 Spotify'
      if (u.hostname.includes('youtube') || u.hostname.includes('youtu.be')) return '▶ YouTube'
      if (u.hostname.includes('soundcloud')) return '☁ SoundCloud'
      if (u.hostname.includes('apple')) return '🍎 Apple Music'
      return '🔗 ' + u.hostname.replace('www.','')
    } catch { return '🔗 Link' }
  }

  // Song demo field editing
  let songTagInput = $state({})
  let songRefInput = $state({})
  let songAudioBlobUrls = $state({}) // separate from version audio

  const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B','Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m','Am','A#m','Bm']

  async function updateSongField(song, field, value) {
    song[field] = value
    songs = [...songs]
    await supabase.from('songs').update({ [field]: value }).eq('id', song.id)
  }

  async function addSongTag(song) {
    const val = (songTagInput[song.id] || '').trim()
    if (!val) return
    const tags = [...(song.tags || []), val]
    await updateSongField(song, 'tags', tags)
    songTagInput[song.id] = ''
  }

  async function addSongTag_direct(song, val) {
    if (!val || (song.tags||[]).includes(val)) return
    await updateSongField(song, 'tags', [...(song.tags || []), val])
  }

  async function removeSongTag(song, tag) {
    await updateSongField(song, 'tags', (song.tags||[]).filter(t=>t!==tag))
  }

  async function addSongRef(song) {
    const val = (songRefInput[song.id] || '').trim()
    if (!val) return
    songRefInput[song.id] = ''
    let name = ''
    if (val.includes('spotify')) {
      try {
        const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(val))
        if (r.ok) { const d = await r.json(); name = d.title || '' }
      } catch(e) {}
    }
    const newRef = {
      url: val,
      name: name || val,
      spotify_id: val.includes('spotify.com/track/') ? val.split('/track/')[1].split('?')[0] : null,
      added_at: new Date().toISOString()
    }
    const reference_links = [...(song.reference_links||[]), newRef]
    await updateSongField(song, 'reference_links', reference_links)
  }

  async function removeSongRef(song, urlOrId) {
    const reference_links = (song.reference_links||[]).filter(r =>
      r.url !== urlOrId && r.id !== urlOrId
    )
    await updateSongField(song, 'reference_links', reference_links)
  }

  function openSpotifySong(url) { playRefUrl(url) }

  async function analyzeVocalStyle(spotifyUrl) {
    const r = await fetch('http://localhost:4242/analyze-vocal-style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: spotifyUrl })
    })
    const d = await r.json()
    if (d.vocalProfile) {
      aiMessages = [...aiMessages, {
        role: 'assistant',
        content: '🎤 Vocal Profile: ' + (d.artist || '') + '\n\n' +
          'Range: ' + d.vocalProfile.vocal_range + '\n' +
          'Timbre: ' + d.vocalProfile.timbre + '\n' +
          'Expression: ' + d.vocalProfile.expressiveness + '\n' +
          'Vibrato: ' + d.vocalProfile.vibrato + '\n\n' +
          'Production recommendations:\n' +
          d.vocalProfile.recommendations.map(rec => '· ' + rec).join('\n')
      }]
    } else {
      aiMessages = [...aiMessages, { role: 'assistant', content: '🎤 Could not extract vocal profile — no pitch data in preview.' }]
    }
  }

  function handleSongAudioDrop(e, song) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]; if (!file) return
    if (songAudioBlobUrls[song.id]) URL.revokeObjectURL(songAudioBlobUrls[song.id])
    songAudioBlobUrls = { ...songAudioBlobUrls, [song.id]: URL.createObjectURL(file) }
    updateSongField(song, 'audio_path', file.name)
  }

  async function deleteSong(song) {
    if (!confirm('Permanently delete "' + (song.title || song.code) + '"? Audio files will be deleted. Work log and feedback are archived for analysis.')) return
    const wd = workData(song)

    // Archive all data to song_archive before deleting
    await supabase.from('song_archive').insert({
      song_code:    song.code || null,
      song_title:   song.title || null,
      project_name: selectedProject?.name || null,
      artist:       selectedProject?.artist || null,
      stage:        wd.current_stage || null,
      archived_at:  new Date().toISOString(),
      work_data:    song.work_data || {},
      tags:         song.tags || [],
      notes:        song.notes || null
    }).then(({ error }) => { if (error) console.warn('Archive failed:', error.message) })

    // Delete audio files from Dropbox
    if (wd.prod_audio) fetch(`http://localhost:4242/delete-audio?dir=production&filename=${encodeURIComponent(wd.prod_audio)}`, { method: 'POST' }).catch(() => {})
    if (wd.mix_audio)  fetch(`http://localhost:4242/delete-audio?dir=mixing&filename=${encodeURIComponent(wd.mix_audio)}`, { method: 'POST' }).catch(() => {})
    if (wd.instr_audio) fetch(`http://localhost:4242/delete-audio?dir=instrumental&filename=${encodeURIComponent(wd.instr_audio)}`, { method: 'POST' }).catch(() => {})

    await supabase.from('songs').delete().eq('id', song.id)
    songs = songs.filter(s => s.id !== song.id)
    if (expandedSongId === song.id) expandedSongId = null
  }
  // Save checklist textarea back to work_checklist table
  async function saveSanityText(text) {
    sanityText = text
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    // Update existing rows, add new ones, delete removed ones
    for (let i = 0; i < lines.length; i++) {
      if (sanityItems[i]) {
        if (sanityItems[i].item !== lines[i]) {
          await supabase.from('work_checklist').update({ item: lines[i] }).eq('id', sanityItems[i].id)
          sanityItems[i].item = lines[i]
        }
      } else {
        const { data } = await supabase.from('work_checklist').insert({ item: lines[i], position: i, stage_num: 6 }).select().single()
        if (data) sanityItems.push(data)
      }
    }
    // Delete rows beyond current line count
    for (let i = lines.length; i < sanityItems.length; i++) {
      await supabase.from('work_checklist').delete().eq('id', sanityItems[i].id)
    }
    sanityItems = sanityItems.slice(0, lines.length)
  }

  // Save tips textarea back to work_tip_sections / work_tips tables
  async function saveTipsText(text) {
    tipsText = text
    const blocks = text.split(/\n(?=##\s)/)
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi].trim()
      if (!block) continue
      const firstLine = block.split('\n')[0]
      const label = firstLine.replace(/^##\s*/, '').trim()
      const tipLines = block.split('\n').slice(1).map(l => l.trim()).filter(Boolean)
      const sec = tipSections[bi]
      if (sec) {
        if (sec.label !== label) {
          await supabase.from('work_tip_sections').update({ label }).eq('id', sec.id)
          sec.label = label
        }
        const tips = sec.work_tips || []
        for (let ti = 0; ti < tipLines.length; ti++) {
          if (tips[ti]) {
            if (tips[ti].tip !== tipLines[ti]) {
              await supabase.from('work_tips').update({ tip: tipLines[ti] }).eq('id', tips[ti].id)
              tips[ti].tip = tipLines[ti]
            }
          } else {
            const { data } = await supabase.from('work_tips').insert({ tip: tipLines[ti], section_id: sec.id, position: ti }).select().single()
            if (data) tips.push(data)
          }
        }
        for (let ti = tipLines.length; ti < tips.length; ti++) {
          await supabase.from('work_tips').delete().eq('id', tips[ti].id)
        }
        sec.work_tips = tips.slice(0, tipLines.length)
      }
    }
    tipSections = [...tipSections]
  }

  async function archiveProject(p) {
    if (!confirm('Archive "' + p.name + '"?')) return
    await supabase.from('projects').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', p.id)
    projects = projects.filter(x => x.id !== p.id)
    if (selectedProjectId === p.id) selectedProjectId = projects[0]?.id || null
  }
  async function deleteProject(p) {
    if (!confirm('Permanently delete "' + p.name + '" and all its songs? Audio files in Production and Mixing will also be deleted. This cannot be undone.')) return
    // Delete audio files for all songs in this project
    const projectSongs = songs.filter(s => s.project_id === p.id)
    for (const song of projectSongs) {
      const wd = workData(song)
      if (wd.prod_audio) fetch(`http://localhost:4242/delete-audio?dir=production&filename=${encodeURIComponent(wd.prod_audio)}`, { method: 'POST' }).catch(() => {})
      if (wd.mix_audio) fetch(`http://localhost:4242/delete-audio?dir=mixing&filename=${encodeURIComponent(wd.mix_audio)}`, { method: 'POST' }).catch(() => {})
      if (wd.instr_audio) fetch(`http://localhost:4242/delete-audio?dir=instrumental&filename=${encodeURIComponent(wd.instr_audio)}`, { method: 'POST' }).catch(() => {})
    }
    await supabase.from('songs').delete().eq('project_id', p.id)
    await supabase.from('projects').delete().eq('id', p.id)
    projects = projects.filter(x => x.id !== p.id)
    if (selectedProjectId === p.id) selectedProjectId = projects[0]?.id || null
  }
  async function captureDawSession(song) {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add API key in Settings.'); return }
    alert('Switch to your DAW now.\nCapturing in 4 seconds...')
    await new Promise(r => setTimeout(r, 4000))
    try {
      const res = await fetch('http://localhost:4242/capture-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          context: `DAW mixing/production session for song: ${song.title || song.code}. Look for: arrangement structure, track organization, mixing decisions, what stage of production this appears to be.`,
          category: 'production_style'
        })
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      alert('DAW Analysis:\n\n' + d.analysis.slice(0, 400))
      const wd = workData(song)
      const activeV = wd.versions?.find(v => v.id === wd.active_version_id) || wd.versions?.[wd.versions.length - 1]
      if (activeV) {
        await saveWorkData(song, wd2 => {
          const v = wd2.versions.find(v => v.id === activeV.id)
          if (v) v.notes = (v.notes || '') + '\n\n[DAW Capture ' + new Date().toLocaleDateString('de-CH') + ']\n' + d.analysis
        })
      }
    } catch(e) {
      alert('Capture failed: ' + e.message)
    }
  }

  async function archiveSong(song) {
    if (!confirm('Archive "' + (song.title || song.code) + '"?')) return
    await saveWorkData(song, wd => { wd.archived = true })
    if (expandedSongId === song.id) expandedSongId = null
  }

  async function moveSongToDemo(song) {
    if (!confirm('Move "' + (song.title || song.code) + '" back to Demos?\nThe last audio will be copied to Demos as ' + song.code + '_v00 and deleted from Production/Mixing.')) return

    const wd = workData(song)
    const lastAudio = wd.mix_audio || wd.prod_audio || null
    let newAudioPath = null
    const sourceDir = wd.mix_audio ? 'mixing' : 'production'

    if (lastAudio) {
      const ext = lastAudio.split('.').pop() || 'wav'
      const demoFilename = `${song.code}_v00.${ext}`
      try {
        const res = await fetch('http://localhost:4242/copy-to-demos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceDir, sourceFile: lastAudio, destFile: demoFilename })
        })
        const result = await res.json()
        if (result.ok) {
          newAudioPath = demoFilename
          // Delete the source file from production/mixing
          await deleteAudioFile(sourceDir, lastAudio)
          // Also delete the other dir's file if it exists
          if (wd.mix_audio && wd.prod_audio) {
            await deleteAudioFile(wd.mix_audio ? 'production' : 'mixing', wd.mix_audio ? wd.prod_audio : wd.mix_audio)
          }
        }
      } catch(e) { console.error('copy-to-demos failed', e) }
    }

    await supabase.from('songs').update({
      project_id: null, status: 'demo',
      audio_path: newAudioPath || song.audio_path || null,
      work_data: {}
    }).eq('id', song.id)

    songs = songs.filter(s => s.id !== song.id)
    if (expandedSongId === song.id) expandedSongId = null
  }

  // ── Create project ─────────────────────────────────────────────
  async function createProject() {
    if (!newProjName.trim()) return
    const { data } = await supabase.from('projects')
      .insert({ name: newProjName.trim(), artist: newProjArtist.trim(), color: newProjColor, status: 'active', position: projects.length, deadlines: [], tasks: [], songs: [], general_notes: '', general_references: '' })
      .select().single()
    if (data) {
      projects = [...projects, data]
      selectedProjectId = data.id
    }
    newProjName = ''; newProjArtist = ''; newProjColor = '#9b6fd4'
    showCreateProject = false
  }

  // ── Update project field ───────────────────────────────────────
  async function updateProjectColor(p, color) {
    p.color = color
    projects = [...projects]
    await supabase.from('projects').update({ color }).eq('id', p.id)
  }
  async function updateProjectField(p, field, value) {
    p[field] = value
    projects = [...projects]
    await supabase.from('projects').update({ [field]: value }).eq('id', p.id)
  }
  function projectMeta(p) {
    const m = p.project_meta || {}
    return {
      comp_type: m.comp_type || 'flat',
      comp_val:  m.comp_val  || '',
      agreement: m.agreement || false,
      agreement_date: m.agreement_date || '',
      suisa:     m.suisa     || false,
      invoice:   m.invoice   || false,
      invoice_date: m.invoice_date || '',
      payment:   m.payment   || false,
      songs_done: m.songs_done || false,
      release_done: m.release_done || false,
      release_date: m.release_date || '',
      aftercheck: m.aftercheck || false,
    }
  }
  async function updateMeta(p, field, value) {
    const meta = { ...(p.project_meta || {}), [field]: value }
    p.project_meta = meta
    projects = [...projects]
    await supabase.from('projects').update({ project_meta: meta }).eq('id', p.id)
  }

  // ── Version system ─────────────────────────────────────────────
  function generateVersionName(versions, versionType) {
    if (versionType === 'mixing') {
      const n = versions.filter(v => v.version_type === 'mixing').length
      return 'MIX_v' + String(n+1).padStart(2,'0')
    }
    if (versionType === 'production') {
      const n = versions.filter(v => v.version_type === 'production').length
      return 'v' + String(n + 1).padStart(2,'0')
    }
    if (versionType === 'vocal_rec') {
      const prodCount = versions.filter(v => v.version_type === 'production').length
      const vocCount  = versions.filter(v => v.version_type === 'vocal_rec').length
      return 'v' + String(prodCount + vocCount + 1).padStart(2,'0')
    }
    return 'v' + String(versions.length + 1).padStart(2,'0')
  }

  function addVersion(song, versionType) {
    saveWorkData(song, wd => {
      const name = generateVersionName(wd.versions, versionType)
      const v = { id: 'v'+Date.now(), name, version_type: versionType, created_at: new Date().toISOString(), feedback: [], notes: '', audio_path: '', sent_to_artist: false }
      wd.versions.push(v)
      wd.active_version_id = v.id
    })
  }
  function setActiveVersion(song, vId) {
    saveWorkData(song, wd => { wd.active_version_id = vId })
  }
  function addFeedback(song, vId, text) {
    if (!text.trim()) return
    pushUndo('Added feedback item', song.id, JSON.parse(JSON.stringify(workData(song))))
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.feedback.push({ id: 'f'+Date.now(), text: text.trim(), done: false })
    })
  }
  function toggleFeedback(song, vId, fId) {
    pushUndo('Toggled feedback item', song.id, JSON.parse(JSON.stringify(workData(song))))
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (!v) return
      const f = v.feedback.find(f => f.id === fId)
      if (f) f.done = !f.done
      if (v.feedback.length && v.feedback.every(f => f.done)) {
        const text = v.name + ' Changes:\n' + v.feedback.map(f => '✓ ' + f.text).join('\n')
        navigator.clipboard.writeText(text).catch(() => {})
        song._copied = v.id; songs = [...songs]
        setTimeout(() => { song._copied = null; songs = [...songs] }, 2500)
      }
    })
  }
  function deleteFeedback(song, vId, fId) {
    pushUndo('Deleted feedback item', song.id, JSON.parse(JSON.stringify(workData(song))))
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.feedback = v.feedback.filter(f => f.id !== fId)
    })
  }
  function saveVersionNotes(song, vId, text) {
    saveWorkData(song, wd => {
      const v = wd.versions.find(v => v.id === vId)
      if (v) v.notes = text
    })
  }

  async function processNotesToFeedback(song, vId) {
    const wd = workData(song)
    const v = wd.versions.find(v => v.id === vId)
    if (!v?.notes?.trim()) return
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    v._processingNotes = true; songs = [...songs]
    try {
      const brainContext = await buildMozartContext(supabase, { currentSong: song.title || song.code, songVersions: wd.versions || [] })
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 800,
          system: brainContext,
          messages: [{ role: 'user', content: `Convert the notes below into a clear list of single, actionable feedback points for a music producer. Each point max 10 words. Return ONLY a JSON array of strings, no explanation, no markdown, no code fences.\n\nNotes:\n${v.notes}` }]
        })
      })
      const d = await res.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/notes-feedback', model: 'claude-sonnet-4-20250514', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000003) + (d.usage.output_tokens * 0.000015) }) }).catch(() => {})
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error))
      const raw = d.content?.[0]?.text || ''
      console.log('notes-feedback raw:', raw)
      const match = raw.match(/\[[\s\S]*\]/)
      const points = match ? JSON.parse(match[0]) : []
      if (!points.length) throw new Error('No feedback points extracted — Claude returned: ' + raw.slice(0, 200))
      saveWorkData(song, wd2 => {
        const v2 = wd2.versions.find(v => v.id === vId)
        if (v2) v2.feedback = [...(v2.feedback||[]), ...points.map(p => ({ id: 'f'+Date.now()+Math.random(), text: p, done: false }))]
      })
    } catch(e) { alert('Claude error: ' + e.message) }
    v._processingNotes = false; songs = [...songs]
  }

  async function processPdfToFeedback(song, vId, file) {
    const wd = workData(song)
    const v = wd.versions.find(v => v.id === vId)
    if (!v) return
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    v._processingPdf = true; songs = [...songs]
    try {
      const brainContext = await buildMozartContext(supabase, { currentSong: song.title || song.code, songVersions: wd.versions || [] })
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = () => rej(new Error('Could not read PDF'))
        r.readAsDataURL(file)
      })
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          system: brainContext || 'You are a music production assistant. Return only JSON arrays.',
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `Read this document and extract all feedback, notes, corrections, or action items relevant to music production. Return short bullet points, max 10 words each. Return ONLY a JSON array of strings, no explanation, no markdown, no code fences.` }
          ]}]
        })
      })
      const d = await response.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/pdf-feedback', model: 'claude-sonnet-4-20250514', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000003) + (d.usage.output_tokens * 0.000015) }) }).catch(() => {})
      if (d.error?.type === 'overloaded_error') throw new Error('API overloaded — try again in a moment')
      if (d.error) throw new Error(d.error.message)
      const rawText = d.content?.[0]?.text || ''
      const match = (rawText).match(/\[[\s\S]*\]/)
      const points = match ? JSON.parse(match[0]) : []
      if (!points.length) throw new Error('No feedback points extracted')
      saveWorkData(song, wd2 => {
        const v2 = wd2.versions.find(v => v.id === vId)
        if (v2) v2.feedback = [...(v2.feedback||[]), ...points.map(p => ({ id: 'f'+Date.now()+Math.random(), text: p, done: false }))]
      })
    } catch(e) {
      console.error('PDF processing error:', e)
      alert('PDF processing error: ' + e.message)
    }
    v._processingPdf = false; songs = [...songs]
  }

  async function generateListenLink(song) {
    const wd = workData(song)
    const v = wd.versions?.find(v => v.id === wd.active_version_id) || wd.versions?.[wd.versions.length - 1]

    // Determine audio file and its Dropbox subfolder
    let audioFile = '', audioDir = 'Production'
    if (v?.audio_path) {
      audioFile = v.audio_path
      audioDir = v.version_type === 'mixing' ? 'Mixing' : 'Production'
    } else if (wd.mix_audio) {
      audioFile = wd.mix_audio
      audioDir = 'Mixing'
    } else if (wd.prod_audio) {
      audioFile = wd.prod_audio
      audioDir = 'Production'
    } else if (wd.instr_audio) {
      audioFile = wd.instr_audio
      audioDir = 'Production/-Instrumentals'
    }

    if (!audioFile) { alert('No audio file found for this song. Drop an audio file first.'); return }

    const LISTEN_URL = 'https://momentummusic.vercel.app'
    const id = Math.random().toString(36).slice(2, 10).toUpperCase()
    const url = `${LISTEN_URL}?s=${id}`

    try { await navigator.clipboard.writeText(url) } catch(e) {
      const ta = document.createElement('textarea')
      ta.value = url; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }

    song._listenFlash = true; songs = [...songs]
    setTimeout(() => { song._listenFlash = false; songs = [...songs] }, 2500)

    ;(async () => {
      try {
        const dbxPath = `/!MOMENTUM MUSIC/${audioDir}/${audioFile}`
        const linkRes = await fetch('http://localhost:4242/share-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: dbxPath })
        })
        const linkData = await linkRes.json()
        const songEntry = {
          code: song.code,
          title: audioFile,
          filename: audioFile,
          shareUrl: linkData.shareLink || null,
          mp3ShareUrl: linkData.mp3ShareLink || null,
          previewUrl: null
        }
        const mp3Filename = audioFile ? audioFile.replace(/\.wav$/i, '.mp3') : null
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        await supabase.from('share_sessions').insert({
          id,
          songs: [songEntry],
          patch_name: `${selectedProject?.artist || ''} — ${song.title || song.code}`.trim(),
          expires_at: expiresAt,
          background: selectedListenBg,
          feedback_enabled: true,
          session_type: 'production',
          mp3_path: mp3Filename
        })
      } catch(e) { console.warn('Listen link background error:', e.message) }
    })()
  }

  async function sendToArtist(song, vId) {
    const wd = workData(song)
    const vIdx = wd.versions.findIndex(v => v.id === vId)
    const v = wd.versions[vIdx]
    if (!v) return

    // Get ALL feedback items from the PREVIOUS version of same type
    const sameType = wd.versions.filter(v2 => v2.version_type === v.version_type)
    const myIdxInType = sameType.findIndex(v2 => v2.id === vId)
    const prevVersion = myIdxInType > 0 ? sameType[myIdxInType - 1] : null
    const prevItems = prevVersion ? (prevVersion.feedback || []) : []

    // Generate listen link ID immediately — copy to clipboard right away
    const LISTEN_URL = 'https://momentummusic.vercel.app'
    const listenId = Math.random().toString(36).slice(2, 10).toUpperCase()
    const listenUrl = `${LISTEN_URL}?s=${listenId}`

    // Build clipboard text with listen link
    const feedbackItems = (v.feedback || []).filter(f => !f.done).map(f => '• ' + f.text)
    const lines = [
      `${song.title || song.code} — ${v.name.toUpperCase()}`,
      '',
      `Listen / Download: ${listenUrl}`,
      ...(prevItems.length ? ['', 'REVISIONS:', ...prevItems.map(f => '• ' + f.text)] : []),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
    } catch(e) {
      const ta = document.createElement('textarea')
      ta.value = lines.join('\n'); document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }

    pushUndo('Sent ' + v.name + ' to artist', song.id, JSON.parse(JSON.stringify(workData(song))))

    saveWorkData(song, wd2 => {
      const v2 = wd2.versions.find(v => v.id === vId)
      if (v2) v2.sent_to_artist = true
    })
    song._sent_flash = vId; songs = [...songs]
    setTimeout(() => { song._sent_flash = null; songs = [...songs] }, 2500)

    const v_type = v.version_type
    const versionsOfType = workData(song).versions.filter(v2 => v2.version_type === v_type)
    const sentVersion = versionsOfType.find(v2 => v2.id === vId)
    const sentIndex = versionsOfType.indexOf(sentVersion)
    const isLatest = sentIndex === versionsOfType.length - 1
    const nextExists = versionsOfType[sentIndex + 1] !== undefined

    if (isLatest && !nextExists) {
      await saveWorkData(song, wd3 => {
        const nextName = generateVersionName(wd3.versions, v_type)
        const newV = { id: 'v'+Date.now(), name: nextName, version_type: v_type, created_at: new Date().toISOString(), feedback: [], notes: '', audio_path: '', sent_to_artist: false }
        wd3.versions.push(newV)
        wd3.active_version_id = newV.id
      })
    } else if (!isLatest) {
      await saveWorkData(song, wd3 => {
        wd3.active_version_id = versionsOfType[versionsOfType.length - 1].id
      })
    }

    // Insert listen session in background (Dropbox link + Supabase)
    ;(async () => {
      try {
        const subdir = v.version_type === 'mixing' ? 'Mixing' : 'Production'
        const isMix = v.version_type === 'mixing'
        const cachedLink = isMix ? wd.mix_sharelink : wd.prod_sharelink
        let shareLink = cachedLink || null
        let mp3ShareLink = null
        if (!shareLink) {
          const dbxPath = `/!MOMENTUM MUSIC/${subdir}/${v.audio_path}`
          const linkRes = await fetch('http://localhost:4242/share-link', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: dbxPath })
          })
          const data = await linkRes.json()
          shareLink = data.shareLink || null
          mp3ShareLink = data.mp3ShareLink || null
          if (shareLink) {
            saveWorkData(song, wd2 => {
              if (isMix) { wd2.mix_sharelink = shareLink } else { wd2.prod_sharelink = shareLink }
            })
          }
        }
        if (!shareLink) { console.warn('No Dropbox share link — audio will not play on listen page'); }
        const songEntry = {
          code: song.code,
          title: v.audio_path || song.title || song.code,
          filename: v.audio_path,
          public_filename: getPublicFilename(v.audio_path || '', selectedProject?.artist || ''),
          shareUrl: shareLink || null,
          mp3ShareUrl: mp3ShareLink || null,
          previewUrl: null
        }
        const mp3Filename = v.audio_path ? v.audio_path.replace(/\.wav$/i, '.mp3') : null
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        const sessionPayload = {
          id: listenId,
          songs: [songEntry],
          patch_name: `${selectedProject?.artist || ''} — ${song.title || song.code}`.trim(),
          expires_at: expiresAt,
          background: selectedListenBg,
          feedback_enabled: true,
          session_type: v.version_type === 'mixing' ? 'mixing' : 'production',
          mp3_path: mp3Filename
        }
        const { error } = await supabase.from('share_sessions').insert(sessionPayload)
        if (error) {
          const { session_type, mp3_path, ...payloadNoType } = sessionPayload
          await supabase.from('share_sessions').insert(payloadNoType)
        }
        console.log('✓ Listen session ready:', listenUrl)
      } catch(e) { console.warn('Listen session background error:', e.message) }
    })()
  }

  // Copy Dropbox share link for production/mixing audio
  async function copyDropboxLink(song) {
    const wd = workData(song)
    const audioFile = wd.current_stage === 'mixing' ? wd.mix_audio : wd.prod_audio
    if (!audioFile) { alert('No audio file found.'); return }

    // Use cached link if available
    const savedLink = wd.current_stage === 'mixing' ? wd.mix_sharelink : wd.prod_sharelink
    if (savedLink) {
      try { await navigator.clipboard.writeText(savedLink) } catch(e) {
        const ta = document.createElement('textarea')
        ta.value = savedLink; document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
      }
      song._dbxCopied = true; songs = [...songs]
      setTimeout(() => { song._dbxCopied = false; songs = [...songs] }, 2000)
      return
    }

    // Fetch fresh from watcher and cache it
    const subdir = wd.current_stage === 'mixing' ? 'Mixing' : 'Production'
    try {
      const res = await fetch('http://localhost:4242/share-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: `/!MOMENTUM MUSIC/${subdir}/${audioFile}` })
      })
      const { shareLink } = await res.json()
      if (!shareLink) { alert('Could not get Dropbox link. Make sure the watcher is running.'); return }
      try { await navigator.clipboard.writeText(shareLink) } catch(e) {
        const ta = document.createElement('textarea')
        ta.value = shareLink; document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
      }
      // Cache for next time
      await saveWorkData(song, wd2 => {
        if (wd.current_stage === 'mixing') {
          wd2.mix_sharelink = shareLink
        } else {
          wd2.prod_sharelink = shareLink
        }
      })
      song._dbxCopied = true; songs = [...songs]
      setTimeout(() => { song._dbxCopied = false; songs = [...songs] }, 2000)
    } catch(e) { alert('Watcher not running.') }
  }

  // ── Audio ─────────────────────────────────────────────────────
  function handleVersionAudioDrop(e, song, vId) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]; if (!file) return
    if (audioBlobUrls[vId]) URL.revokeObjectURL(audioBlobUrls[vId])
    audioBlobUrls = { ...audioBlobUrls, [vId]: URL.createObjectURL(file) }
    saveWorkData(song, wd => { const v = wd.versions.find(v => v.id === vId); if (v) v.audio_path = file.name })
  }
  function clearVersionAudio(song, vId) {
    if (audioBlobUrls[vId]) URL.revokeObjectURL(audioBlobUrls[vId])
    audioBlobUrls = { ...audioBlobUrls, [vId]: null }
    saveWorkData(song, wd => { const v = wd.versions.find(v => v.id === vId); if (v) v.audio_path = '' })
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
  function lastVersion(song) {
    const wd = workData(song)
    return wd.versions.length ? wd.versions[wd.versions.length - 1] : null
  }

  // ── Song reorder ──────────────────────────────────────────────
  async function moveSong(e, song, dir) {
    e.stopPropagation()
    const list = songs.filter(s => s.project_id === selectedProjectId && !getArchived(s)).sort((a,b) => (a.position||0)-(b.position||0))
    const idx = list.findIndex(s => s.id === song.id)
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= list.length) return
    const a = list[idx], b = list[newIdx]
    const posA = a.position ?? idx, posB = b.position ?? newIdx
    const sa = songs.find(s => s.id === a.id), sb = songs.find(s => s.id === b.id)
    if (sa) sa.position = posB
    if (sb) sb.position = posA
    songs = [...songs]
    await Promise.all([
      supabase.from('songs').update({ position: posB }).eq('id', a.id),
      supabase.from('songs').update({ position: posA }).eq('id', b.id),
    ])
  }

  // ── Add song ──────────────────────────────────────────────────
  async function addSong() {
    if (!selectedProjectId) return
    const now = new Date()
    const yy = String(now.getFullYear()).slice(2)
    const mm = String(now.getMonth()+1).padStart(2,'0')
    const dd = String(now.getDate()).padStart(2,'0')
    const code = yy+mm+dd+String(songs.filter(s=>s.code&&s.code.startsWith(yy+mm+dd)).length+1).padStart(2,'0')
    const { data } = await supabase.from('songs')
      .insert({ code, project_id: selectedProjectId, status: 'demo', tags: [], reference_links: [], position: songs.length, work_data: {} })
      .select('id,title,code,project_id,work_data,position').single()
    if (data) { songs = [...songs, data]; expandedSongId = data.id }
  }

  // ── Deadlines & Tasks ─────────────────────────────────────────
  async function addDeadline() {
    if (!newDeadlineLabel.trim() || !selectedProject) return
    const deadlines = [...(selectedProject.deadlines||[]), { id: 'd'+Date.now(), label: newDeadlineLabel.trim(), date: newDeadlineDate, done: false }]
    await supabase.from('projects').update({ deadlines }).eq('id', selectedProject.id)
    selectedProject.deadlines = deadlines; projects = [...projects]
    newDeadlineLabel = ''; newDeadlineDate = ''
  }
  async function toggleDeadline(dl) {
    if (!selectedProject) return
    const deadlines = (selectedProject.deadlines||[]).map(d => d.id===dl.id ? {...d,done:!d.done} : d)
    await supabase.from('projects').update({ deadlines }).eq('id', selectedProject.id)
    selectedProject.deadlines = deadlines; projects = [...projects]
  }
  async function addTask() {
    if (!selectedProject) return
    const stageConf = PROJ_SONG_STAGES.find(s => s.id === newTaskStage)
    const songObj = newTaskSong ? songs.find(s => s.id === newTaskSong) : null
    // Build label
    let label = newTaskLabel.trim()
    if (stageConf && songObj) {
      const ver = (newTaskStage === 'production' || newTaskStage === 'mixing')
        ? getProjActiveVersion(songObj, newTaskStage) : null
      const verStr = ver ? ' ' + ver.name.toUpperCase() : ''
      const stageLabel = { production:'PRODUCTION REVISION', mix_prep:'MIX PREP', mixing:'MIX REVISION', mastering:'MASTERING', stems:'STEMS' }[newTaskStage]
      const autoLabel = stageLabel + verStr
      label = label ? autoLabel + ' — ' + label : autoLabel
    } else if (stageConf && !songObj) {
      // Stage only, no song — use stage label as prefix
      const stageLabel = { production:'PRODUCTION', mix_prep:'MIX PREP', mixing:'MIXING', mastering:'MASTERING', stems:'STEMS' }[newTaskStage]
      label = label ? stageLabel + ' — ' + label : (label || stageLabel)
    }
    if (!label) return

    const now = new Date()
    const todayISO = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    const taskDate = newTaskDate || todayISO
    const taskEntry = {
      id: 't'+Date.now(), label, date: taskDate,
      time: newTaskTime || '08:00', type: songObj ? 'song' : 'project',
      project: selectedProject.name, project_id: selectedProject.id,
      song: songObj ? (songObj.title || songObj.code) : '',
      song_id: songObj?.id || null,
      stage: newTaskStage, done: false, hidden_from_upcoming: false, recurring: false
    }

    // Write to projects.tasks for backwards compat
    const tasks = [...(selectedProject.tasks||[]), { id: taskEntry.id, label, date: taskDate, time: newTaskTime || '08:00', done: false }]
    await supabase.from('projects').update({ tasks }).eq('id', selectedProject.id)
    selectedProject.tasks = tasks; projects = [...projects]

    // Write to daily_state — find today's row by trying both date formats Daily uses
    const dailyKey = new Date().toDateString() // e.g. "Thu Apr 02 2026"
    const { data: rows } = await supabase.from('daily_state').select('id,tasks').or(`date.eq.${dailyKey},date.eq.${todayISO}`)
    const ds = rows?.[0] || null
    const dailyTasks = [...(ds?.tasks || []), taskEntry]
    if (ds?.id) {
      // Update existing row by ID
      await supabase.from('daily_state').update({ tasks: dailyTasks }).eq('id', ds.id)
    } else {
      // No row yet for today — create with Daily's format
      await supabase.from('daily_state').insert({ date: dailyKey, tasks: dailyTasks })
    }

    newTaskLabel = ''; newTaskDate = ''; newTaskTime = ''; newTaskSong = ''; newTaskStage = ''
  }
  async function toggleTask(task) {
    if (!selectedProject) return
    const tasks = (selectedProject.tasks||[]).map(t => t.id===task.id ? {...t,done:!t.done} : t)
    await supabase.from('projects').update({ tasks }).eq('id', selectedProject.id)
    selectedProject.tasks = tasks; projects = [...projects]
  }

  // ── Timer (counts UP, alarm every hour) ───────────────────────
  function playAlarm() {
    try {
      const ctx = new AudioContext()
      ;[0,0.3,0.6].forEach(offset => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = offset === 0.3 ? 660 : 880
        gain.gain.setValueAtTime(0.4, ctx.currentTime+offset)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+offset+0.25)
        osc.start(ctx.currentTime+offset); osc.stop(ctx.currentTime+offset+0.27)
      })
    } catch(e) {}
  }
  function startTimer() {
    if (timerRunning) return
    if (!timerPreset) return
    if (timerSec === 0) {
      if (!noLog) {
        timerSong  = expandedSong || null
        timerStage = timerSong ? (workData(timerSong).current_stage || '') : ''
        if (!timerSong || !timerStage) { alert('Open a song and select an active stage first.'); return }
      }
      timerTarget = timerPreset
    }
    timerRunning = true
    timerInterval = setInterval(() => {
      timerSec++
      if (timerSec >= timerTarget) {
        clearInterval(timerInterval)
        timerRunning = false
        if (!noLog) sessionLog = [...sessionLog, { stage: timerStage, seconds: timerTarget }]
        timerSec = 0
        timerTarget = 0
        playAlarm()
        showTimerDone(`⏰ ${timerPreset >= 60 ? timerPreset/60+'min' : timerPreset+'s'} done${!noLog && sessionLog.length ? ' — '+Math.round(sessionLog.reduce((s,e)=>s+e.seconds,0)/60)+'min total' : ''}`)
      }
    }, 1000)
  }

  function pauseTimer() {
    if (!timerRunning) return
    clearInterval(timerInterval)
    timerRunning = false
    // timerSec preserved — Start will resume
  }

  async function resetTimer() {
    clearInterval(timerInterval)
    timerRunning = false
    if (!noLog) {
      if (timerSec > 0 && timerSong && timerStage) {
        sessionLog = [...sessionLog, { stage: timerStage, seconds: timerSec }]
      }
    }
    timerSec = 0; timerTarget = 0
    if (!noLog && sessionLog.length > 0 && timerSong) {
      const date = new Date().toISOString().slice(0, 10)
      const byStage = {}
      sessionLog.forEach(e => { byStage[e.stage] = (byStage[e.stage] || 0) + e.seconds })
      const songToLog = timerSong
      const wd = workData(songToLog)
      if (!wd.session_log) wd.session_log = []
      Object.entries(byStage).forEach(([s, sec]) => {
        wd.session_log.push({ date, stage: s, seconds: sec })
      })
      // Write to Supabase
      await supabase.from('songs').update({ work_data: wd }).eq('id', songToLog.id)
      // Reload fresh from Supabase so UI gets the new data
      const { data } = await supabase.from('songs')
        .select('id,title,code,project_id,work_data,position,key,tempo,tags,reference_links,audio_path,notes,feedback,status,rating,release_date,spotify_url')
        .eq('id', songToLog.id).single()
      if (data) {
        songs = songs.map(s => s.id === data.id ? data : s)
      }
    }
    sessionLog = []
    timerSong  = null
    timerStage = ''
  }

  async function saveLog() {
    timerSec = 0
  }
  function formatTime(sec) {
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60
    return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')
  }

  // ── Mozart — builds project context, never passes contact/financial data ─
  function buildProjectContext() {
    const lines = ['You are Mozart, an expert music production AI assistant built into the Momentum Framework.']
    lines.push('You have read-only context about the current project state. Be concise, direct and inspiring.')
    lines.push('Never repeat this context back to the user. Just use it to give relevant answers.')
    lines.push('IMPORTANT: Never output raw signal analysis numbers (BPM, LUFS, energy, danceability scores etc) unless the user explicitly asks for them. All technical analysis is shown in the ANALYZER panel. Focus only on creative, strategic, and actionable advice. When referencing analysis use natural language like "the groove feels flat" not "danceability: 0.47".')
    lines.push('')

    if (selectedProject) {
      lines.push('PROJECT: ' + selectedProject.name + (selectedProject.artist ? ' — Artist: ' + selectedProject.artist : ''))
      if (selectedProject.general_notes) lines.push('Project notes: ' + selectedProject.general_notes.slice(0, 300))
      if (selectedProject.general_references) lines.push('References: ' + selectedProject.general_references.slice(0, 300))
      if (selectedProject.general_business) lines.push('Business context: ' + selectedProject.general_business.slice(0, 200))
      if (selectedProject.general_release) lines.push('Release info: ' + selectedProject.general_release.slice(0, 200))

      const openDeadlines = (selectedProject.deadlines||[]).filter(d=>!d.done).map(d=>d.label+(d.date?' ('+d.date+')':'')).join(', ')
      if (openDeadlines) lines.push('Open deadlines: ' + openDeadlines)

      const openTasks = (selectedProject.tasks||[]).filter(t=>!t.done).map(t=>t.label).join(', ')
      if (openTasks) lines.push('Open tasks: ' + openTasks)
    }

    if (expandedSong) {
      const wd = workData(expandedSong)
      lines.push('')
      lines.push('CURRENT SONG: ' + (expandedSong.title || expandedSong.code))
      lines.push('Current stage: ' + wd.current_stage.replace('_',' ').toUpperCase())
      if (wd.project_info) lines.push('Song notes: ' + wd.project_info.slice(0, 300))

      const doneStages = STAGES.filter(s => wd.stages[s.id]?.done).map(s => s.label).join(', ')
      if (doneStages) lines.push('Completed stages: ' + doneStages)

      const activeV = wd.versions.find(v => v.id === wd.active_version_id)
      if (activeV) {
        lines.push('Active version: ' + activeV.name)
        const openFb = activeV.feedback.filter(f=>!f.done).map(f=>f.text).join('; ')
        const doneFb = activeV.feedback.filter(f=>f.done).map(f=>f.text).join('; ')
        if (openFb) lines.push('Open feedback: ' + openFb.slice(0, 400))
        if (doneFb) lines.push('Implemented: ' + doneFb.slice(0, 300))
        if (activeV.notes) lines.push('Session notes: ' + activeV.notes.slice(0, 400))
      }
    }

    lines.push('')
    lines.push('Songs in project: ' + projectSongs.map(s=>(s.title||s.code)+' ['+workData(s).current_stage+']').join(', '))

    return lines.join('\n')
  }

  function stopWorkTimer(shouldLog = true) {
    if (!workTimerStart || !workTimerSong) return
    const elapsed = Math.round((Date.now() - workTimerStart) / 60000)
    if (shouldLog && elapsed >= MIN_LOG_MINUTES) logWorkSession(workTimerSong, workTimerStage, elapsed)
    workTimerStart = null; workTimerSong = null; workTimerStage = null
  }

  function startWorkTimer(song) {
    stopWorkTimer(false)
    workTimerStart = Date.now()
    workTimerSong = song
    const wd = workData(song)
    workTimerStage = wd?.current_stage || 'production'
    console.log('Work timer started for', song.title || song.code, 'stage:', workTimerStage)
  }

  async function logWorkSession(song, stage, minutes) {
    await supabase.from('work_logs').insert({
      song_id: song.id,
      song_title: song.title || song.code,
      stage,
      duration_minutes: minutes,
      logged_at: new Date().toISOString(),
      note: ''
    })
    await supabase.from('brain_knowledge').insert({
      category: 'own_production',
      title: 'Work session: ' + (song.title || song.code),
      content: stage + ' — ' + minutes + ' min · ' + new Date().toLocaleDateString(),
      entry_type_v2: 'observation',
      confidence: 'medium',
      source_type: 'auto_log',
      active: true
    })
    console.log('Work session logged:', minutes, 'min on', song.title || song.code)
  }

  async function loadSongWorkLogs(songId) {
    const { data } = await supabase.from('work_logs').select('*').eq('song_id', songId)
      .order('logged_at', { ascending: false }).limit(10)
    songWorkLogs = data || []
  }

  async function generateNarrative(song) {
    const wd = workData(song)
    const mixVersions = (wd.versions || []).filter(v => v.version_type === 'mixing')
    if (mixVersions.length < 2) return
    try {
      const res = await fetch('http://localhost:4242/generate-version-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id, versions: mixVersions })
      })
      const d = await res.json()
      if (d.narrative) {
        aiMessages = [...aiMessages, {
          role: 'assistant',
          content: '## Mixing Journey\n' + d.narrative
        }]
      }
    } catch (e) { console.error('generateNarrative error', e) }
  }

  async function toggleReleaseCheck(song, itemId, checked) {
    await saveWorkData(song, wd => {
      if (!wd.release_checklist) wd.release_checklist = {}
      wd.release_checklist[itemId] = checked
    })
  }

  async function loadVocalEq(songId) {
    const r = await fetch('http://localhost:4242/vocal-eq-curves?song_id=' + songId)
    const d = await r.json()
    const songCurves = d.curves || []

    // Load global reference curves (from background pipeline, song_id IS NULL)
    const { data: globalRefCurves } = await supabase
      .from('vocal_eq_curves')
      .select('*')
      .is('song_id', null)
      .eq('source_type', 'reference')
      .order('created_at', { ascending: false })

    // Merge song curves + global ref curves
    const allCurves = [...songCurves, ...(globalRefCurves || [])]
    vocalEqCurves[songId] = allCurves
    vocalEqCurves = { ...vocalEqCurves }
    vocalEqCache.set(songId, allCurves)

    // Load all library tracks for ref dropdown
    const { data: libraryTracks } = await supabase
      .from('reference_tracks')
      .select('id, title, artist, source, credits, popularity, collection_name, spotify_id')
      .in('source', ['user', 'agent', 'mozart', 'promoted'])
      .order('artist', { ascending: true })
      .limit(200)
    refTrackOptions = libraryTracks || []

    // Auto-compare: latest mix vs selected or first ref for current stem
    const stemKey = activeStem[songId] || 'vocals'
    const latestMix = allCurves.find(c => c.source_type === 'mix' && c.stem_type === stemKey)
    const selRef = selectedRefId[songId]
    const latestRef = selRef
      ? allCurves.find(c => c.reference_track_id === selRef && c.stem_type === stemKey)
      : allCurves.find(c => c.source_type === 'reference' && c.stem_type === stemKey)
    if (latestMix?.curve && latestRef?.curve) {
      const cr = await fetch('http://localhost:4242/compare-vocal-eq', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mix_curve: latestMix.curve, reference_curve: latestRef.curve })
      })
      const cd = await cr.json()
      if (cd.ok) {
        vocalComparison[songId] = cd
        vocalComparison = { ...vocalComparison }
      }
    }
  }

  async function loadMozartInsight(songId, refTrack) {
    if (!refTrack) return
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) return
    mozartInsight = { ...mozartInsight, [songId]: null }
    mozartInsightLoading = { ...mozartInsightLoading, [songId]: true }
    const song = songs.find(s => s.id === songId)
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: `You are Mozart, expert music producer advisor.
Compare producer's current mix to the reference track.
Return JSON only:
{
  "strategic": ["point 1", "point 2", "point 3"],
  "creative": ["direction 1", "direction 2", "direction 3"],
  "next_step": "one concrete next action"
}`,
          messages: [{
            role: 'user',
            content: 'My mix: ' + (song?.title || song?.code || 'current') +
              '\nReference: ' + (refTrack.artist || 'Unknown') + ' — ' + refTrack.title +
              '\nCompare and give strategic + creative direction.'
          }]
        })
      })
      const d = await r.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/mozart-insight', model: 'claude-haiku-4-5-20251001', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.0000008) + (d.usage.output_tokens * 0.000004) }) }).catch(() => {})
      const text = (d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()
      try { mozartInsight = { ...mozartInsight, [songId]: JSON.parse(text) } }
      catch(e) { mozartInsight = { ...mozartInsight, [songId]: { next_step: d.content?.[0]?.text || '' } } }
    } catch(e) { mozartInsight = { ...mozartInsight, [songId]: { next_step: 'Error: ' + e.message } } }
    mozartInsightLoading = { ...mozartInsightLoading, [songId]: false }
  }

  async function loadSuccessMatch(song) {
    const sid = String(song.id)
    if (successMatch[sid]) return
    successMatchLoading = { ...successMatchLoading, [sid]: true }
    try {
      const r = await fetch('http://localhost:4242/analyze-success-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id })
      })
      successMatch = { ...successMatch, [sid]: await r.json() }
    } catch(e) { successMatch = { ...successMatch, [sid]: { ok: false, error: e.message } } }
    successMatchLoading = { ...successMatchLoading, [sid]: false }
  }

  async function loadFeedbackInsights(song) {
    const sid = String(song.id)
    feedbackLoading = { ...feedbackLoading, [sid]: true }
    try {
      const r = await fetch('http://localhost:4242/feedback-insights?song_id=' + song.id)
      feedbackInsights = { ...feedbackInsights, [sid]: await r.json() }
    } catch(e) { feedbackInsights = { ...feedbackInsights, [sid]: { ok: false } } }
    feedbackLoading = { ...feedbackLoading, [sid]: false }
  }

  async function loadTrendVelocity() {
    if (trendLoading || trendVelocity) return
    trendLoading = true
    try {
      const r = await fetch('http://localhost:4242/trend-velocity')
      trendVelocity = await r.json()
    } catch(e) { trendVelocity = { ok: false } }
    trendLoading = false
  }

  function toggleAnalyzerSection(songId, section) {
    const sid = String(songId)
    const cur = analyzerOpen[sid] || {}
    const opening = !cur[section]
    analyzerOpen = { ...analyzerOpen, [sid]: { ...cur, [section]: opening } }
    if (opening && section === 'match') loadSuccessMatch({ id: songId })
    if (opening && section === 'feedback') loadFeedbackInsights({ id: songId })
    if (opening && section === 'trend') loadTrendVelocity()
  }

  async function analyzeMyVocal(song) {
    const sid = String(song.id)
    vocalEqStatus = { ...vocalEqStatus, [sid]: 'separating' }
    try {
      const r = await fetch('http://localhost:4242/analyze-vocal-eq', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'mix', song_id: sid, label: 'MIX ' + new Date().toLocaleDateString() })
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'failed')
      await loadVocalEq(sid)
      showVocalEq[sid] = true
      showVocalEq = { ...showVocalEq }
      vocalEqStatus = { ...vocalEqStatus, [sid]: 'done' }
    } catch(e) {
      vocalEqStatus = { ...vocalEqStatus, [sid]: 'error' }
      alert('Vocal EQ analysis failed: ' + e.message)
    }
  }

  async function addReferenceVocal(song, url, label) {
    if (!url) return
    const sid = song.id
    vocalEqLoading[sid] = 'ref'
    vocalEqLoading = { ...vocalEqLoading }
    try {
      const r = await fetch('http://localhost:4242/analyze-vocal-eq', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reference', song_id: sid, url, label: label || url })
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'failed')
      vocalRefUrl[sid] = ''
      vocalRefUrl = { ...vocalRefUrl }
      await loadVocalEq(sid)
    } catch(e) {
      alert('Reference vocal analysis failed: ' + e.message)
    } finally {
      vocalEqLoading[sid] = null
      vocalEqLoading = { ...vocalEqLoading }
    }
  }

  async function runMozartAnalysis(song) {
    const sid = song.id
    const query = (mozartTrackQuery[sid] || '').trim()
    if (!query) return
    mozartAnalysis[sid] = { loading: true }
    mozartAnalysis = { ...mozartAnalysis }
    const close = () => {
      mozartAnalyzeOpen[sid] = false
      mozartAnalyzeOpen = { ...mozartAnalyzeOpen }
      mozartTrackQuery[sid] = ''
      mozartTrackQuery = { ...mozartTrackQuery }
    }
    // Direct URL → pass straight to analyze
    if (query.includes('spotify.com/track') || query.includes('youtu')) {
      await addReferenceVocal(song, query, '')
      close()
      mozartAnalysis[sid] = { loading: false, ok: true }
      mozartAnalysis = { ...mozartAnalysis }
      return
    }
    // Text query → ask Claude for the Spotify URL
    const apiKey = localStorage.getItem('mm_api_key')
    if (!apiKey) {
      mozartAnalysis[sid] = { loading: false, error: 'No API key set in Settings' }
      mozartAnalysis = { ...mozartAnalysis }
      return
    }
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: `Return ONLY the Spotify track URL for: "${query}". Format: https://open.spotify.com/track/ID — no other text.` }]
        })
      })
      const json = await resp.json()
      const spotifyUrl = (json.content?.[0]?.text || '').trim()
      if (!spotifyUrl.includes('spotify.com/track/')) {
        mozartAnalysis[sid] = { loading: false, error: 'Could not identify track — paste a Spotify URL directly' }
        mozartAnalysis = { ...mozartAnalysis }
        return
      }
      await addReferenceVocal(song, spotifyUrl, query)
      close()
      mozartAnalysis[sid] = { loading: false, ok: true }
      mozartAnalysis = { ...mozartAnalysis }
    } catch(e) {
      mozartAnalysis[sid] = { loading: false, error: e.message }
      mozartAnalysis = { ...mozartAnalysis }
    }
  }

  async function loadFinishingChecklist() {
    const { data, error } = await supabase
      .from('brain_knowledge')
      .select('content, created_at')
      .eq('category', 'checklist_70')
      .eq('title', 'Finishing Checklist — Latest')
      .maybeSingle()
    if (error) { console.error('checklist load error:', error.message); return }
    if (data?.content) {
      try { finishingChecklist = JSON.parse(data.content) } catch(e) { console.error('checklist parse error:', e.message) }
    }
  }

  loadFinishingChecklist()

  onDestroy(() => stopWorkTimer(true))

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopWorkTimer(true)
      else if (expandedSong) startWorkTimer(expandedSong)
    })
  }

  async function expandSong(song, isExpanding) {
    saveActiveTips(); activeTipSectionId = null; activeTipText = ''
    if (isExpanding) {
      startWorkTimer(song)
      loadSongWorkLogs(song.id)
    } else {
      stopWorkTimer(true)
      songWorkLogs = []
    }
    expandedSongId = isExpanding ? song.id : null
    if (!isExpanding) return
    const wd = workData(song)
    const latestWithAnalysis = (wd.versions || []).filter(v => v.analysis)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    if (!latestWithAnalysis) return
    const a = latestWithAnalysis.analysis
    const autoMsg =
      'Auto-analysis for ' + (song.title || song.code) + ' ' + latestWithAnalysis.name + ': ' +
      Math.round(a.bpm) + 'bpm · ' + a.key + ' ' + a.scale +
      ' (' + a.camelot + ') · nrg ' + a.energy +
      ' · dnc ' + a.danceability +
      ' · ' + a.loudness_lufs + 'LUFS. ' +
      'Compare to my references and flag gaps. ' +
      'What is the single most important thing to fix next?'
    aiMessages = []
    await sendAI(autoMsg)
  }

  function saveMozartSession(userMsg, mozartResponse, songId, songTitle) {
    const keyInsight = mozartResponse.slice(0, 300).replace(/\n+/g, ' ').trim()
    const urls = (userMsg.match(/https?:\/\/[^\s]+/g) || [])
    fetch('http://localhost:4242/save-brain-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'mozart_session',
        title: 'Mozart · ' + (songTitle || 'session') + ' · ' + new Date().toLocaleDateString('de-CH'),
        content: keyInsight,
        source_type: 'mozart',
        metadata: {
          song_id: songId || null,
          user_message: userMsg.slice(0, 200),
          full_response: mozartResponse.slice(0, 1000),
          urls
        }
      })
    }).catch(() => {})

    // Auto-import any Spotify track URLs pasted by the user
    const spotifyMatches = userMsg.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/g) || []
    for (const link of spotifyMatches) {
      const trackId = link.split('/').pop().split('?')[0]
      fetch('http://localhost:4242/save-brain-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_spotify_ref', spotify_id: trackId, song_id: songId || null, source: 'mozart_chat' })
      }).catch(() => {})
    }
  }

  async function sendAI(overrideMsg = null) {
    const msg = (typeof overrideMsg === 'string' && overrideMsg.trim()) ? overrideMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    if (!(typeof overrideMsg === 'string' && overrideMsg.trim())) aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) {
      aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set — add it via the ⚙ Settings button.' }]
      aiLoading = false; return
    }
    try {
      const wd = expandedSong ? workData(expandedSong) : null

      let songSpecificRefs = []
      const refLinks = expandedSong?.reference_links || []
      if (refLinks.length) {
        const spotifyIds = refLinks.map(r => {
          const url = typeof r === 'string' ? r : r.url
          const m = url?.match(/track\/([A-Za-z0-9]+)/)
          return m?.[1]
        }).filter(Boolean)
        if (spotifyIds.length) {
          const { data } = await supabase.from('reference_tracks').select('*').in('spotify_id', spotifyIds)
          songSpecificRefs = data || []
        }
      }

      const brainContext = await buildMozartContext(supabase, {
        currentSong: expandedSong?.title || expandedSong?.code,
        songVersions: wd?.versions || [],
        songSpecificRefs
      })
      let system = brainContext + '\n\n' + buildProjectContext()
      if (selectedProject && !expandedSongId) {
        system += '\nCurrent project: ' + selectedProject.artist + ' — ' + selectedProject.name +
          ' (id: ' + selectedProject.id + ')\nNo specific song open. References go to PROJECT level.'
      } else if (expandedSong) {
        system += '\nCurrent song open: ' + (expandedSong.title || expandedSong.code) +
          ' (id: ' + expandedSong.id + ')\nReferences go to THIS SONG.'
      }

      const apiHeaders = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      const convoMessages = aiMessages.slice(-12)

      // First call — may return tool_use
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, system, messages: convoMessages, tools: mozartTools })
      })
      const d = await res.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/project-chat', model: 'claude-sonnet-4-20250514', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000003) + (d.usage.output_tokens * 0.000015) }) }).catch(() => {})

      if (d.stop_reason === 'tool_use') {
        const toolUseBlocks = (d.content || []).filter(b => b.type === 'tool_use')
        const toolResults = []

        for (const block of toolUseBlocks) {
          if (block.name !== 'take_action') continue
          const actionRes = await fetch('http://localhost:4242/mozart-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(block.input)
          })
          const actionData = await actionRes.json()
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: actionData.result || (actionData.ok ? 'done' : 'error') })
        }

        // Continuation call with tool results
        const res2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 400,
            system,
            tools: mozartTools,
            messages: [...convoMessages, { role: 'assistant', content: d.content }, { role: 'user', content: toolResults }]
          })
        })
        const d2 = await res2.json()
        if (d2.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/project-chat', model: 'claude-sonnet-4-20250514', input_tokens: d2.usage.input_tokens, output_tokens: d2.usage.output_tokens, cost_usd: (d2.usage.input_tokens * 0.000003) + (d2.usage.output_tokens * 0.000015) }) }).catch(() => {})

        // Show action results as system messages
        for (const tr of toolResults) aiMessages = [...aiMessages, { role: 'assistant', content: tr.content, _system: true }]
        const finalText = (d2.content || []).find(b => b.type === 'text')?.text || ''
        if (finalText) aiMessages = [...aiMessages, { role: 'assistant', content: finalText }]
        saveMozartSession(msg, finalText || toolResults.map(t => t.content).join(' '), expandedSong?.id, expandedSong?.title || expandedSong?.code)

        // Refresh reference_links if a reference was added
        const didAddRef = toolUseBlocks.some(b => b.input?.action === 'add_project_reference')
        if (didAddRef && expandedSong) {
          const { data: refreshed } = await supabase.from('songs').select('reference_links').eq('id', expandedSong.id).single()
          if (refreshed) {
            expandedSong.reference_links = refreshed.reference_links
            songs = songs.map(s => s.id === expandedSong.id ? { ...s, reference_links: refreshed.reference_links } : s)
          }
        }

      } else {
        // Normal text response — fall back to legacy regex actions if any
        let reply = (d.content || []).find(b => b.type === 'text')?.text || 'No response.'
        if (reply.length > 300 && /research|found|analysis|suggests|shows|according|trend|data|insight|indicates/i.test(reply)) {
          reply += '\n\n---\n💡 Worth saving to Brain? Paste the key insight in Brain dump.'
        }
        const actions = parseActions(reply)
        const cleanReply = reply.replace(/\[ACTION:[^\]]+\]/g, '').trim()
        aiMessages = [...aiMessages, { role: 'assistant', content: cleanReply }]
        for (const action of actions) {
          const result = await executeAction(action, supabase, expandedSong, selectedProject)
          if (result) aiMessages = [...aiMessages, { role: 'assistant', content: result, _system: true }]
        }
        saveMozartSession(msg, cleanReply, expandedSong?.id, expandedSong?.title || expandedSong?.code)
      }
    } catch(e) { aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: '+e.message }] }
    aiLoading = false
  }

  load()
</script>

<svelte:window onkeydown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !e.target.closest('input, textarea')) { e.preventDefault(); undo() } }} />

{#if loading}
  <p class="empty">Loading...</p>
{:else}
<div class="layout">

  <!-- ── LEFT ────────────────────────────────────────────────── -->
  <div class="left-col">
    <div class="left-top">
      <div class="left-header">PROJECTS</div>
      <button class="btn-new-proj" onclick={() => showCreateProject = true}>+</button>
    </div>

    {#each sortedProjects as p}
      <div class="proj-item {selectedProjectId === p.id ? 'sel' : ''}">
        <button class="proj-btn" onclick={() => { saveActiveTips(); activeTipSectionId = null; activeTipText = ''; selectedProjectId = p.id; localStorage.setItem('mm_last_project_id', p.id); expandedSongId = null; audioTick++ }}>
          <div class="proj-dot" style="background:{p.color}"></div>
          <div class="proj-info">
            {#if p.artist}<span class="proj-artist">{p.artist}</span>{/if}
            <span class="proj-name">{p.name}</span>
          </div>
          <div class="proj-counts">
            <span class="proj-count">{songs.filter(s=>s.project_id===p.id&&!getArchived(s)).length} songs</span>
            {#if (p.deadlines||[]).filter(d=>!d.done).length}
              <span class="proj-dl">{(p.deadlines||[]).filter(d=>!d.done).length} dl</span>
            {/if}
          </div>
        </button>
        <div class="proj-actions">
          <button class="proj-action-btn" onclick={() => archiveProject(p)} title="Archive">▽</button>
          <button class="proj-action-btn del" onclick={() => deleteProject(p)} title="Delete">✕</button>
        </div>
      </div>
    {/each}
  </div>

  <!-- ── MIDDLE ──────────────────────────────────────────────── -->
  <div class="mid-col">
    {#if !selectedProject}
      <p class="empty">Select a project.</p>
    {:else}
      <!-- Project header -->
      <div class="mid-header">
        <div class="color-picker-wrap">
          {#each COLORS as c}
            <button class="color-dot {selectedProject.color===c?'active':''}" style="background:{c}" onclick={() => updateProjectColor(selectedProject, c)}></button>
          {/each}
        </div>
        <div class="mid-title-wrap">
          <input class="mid-title-input" value={selectedProject.artist||''}
            placeholder="Artist..."
            style="color:{selectedProject.color}"
            onchange={e => updateProjectField(selectedProject, 'artist', e.target.value)}
            onkeydown={e => e.key==='Enter' && e.target.blur()} />
          <input class="mid-artist-input" value={selectedProject.name}
            onchange={e => updateProjectField(selectedProject, 'name', e.target.value)}
            onkeydown={e => e.key==='Enter' && e.target.blur()} />
        </div>
        <button class="undo-tab-btn" onclick={undo} disabled={undoStack.length === 0} title={undoStack[0]?.description || 'Nothing to undo'}>
          ↩ {undoStack[0] ? undoStack[0].description.slice(0, 20) + '...' : 'undo'}
        </button>
      </div>

      <!-- General project info — tabbed -->
      <div class="proj-info-block">
        <div class="info-tabs">
          {#each [['notes','NOTES'],['references','REFERENCES']] as [id,label]}
            <button class="info-tab {activeInfoTab===id?'on':''}" onclick={() => activeInfoTab=id}>{label}</button>
          {/each}
        </div>
        {#if activeInfoTab === 'notes'}
          <textarea class="ta proj-ta" placeholder="Goals, brief, artist vision..." value={selectedProject.general_notes||''} oninput={e => updateProjectField(selectedProject, 'general_notes', e.target.value)}></textarea>
        {:else if activeInfoTab === 'references'}
          {@const refs = projectRefs(selectedProject)}
          <div class="ref-manager">
            <div class="ref-add-row"
              ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              ondragleave={e => e.currentTarget.classList.remove('drag-over')}
              ondrop={e => {
                e.preventDefault(); e.currentTarget.classList.remove('drag-over')
                const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
                if (url.trim()) addRefLink(selectedProject, url)
              }}>
              <input class="ref-inp" bind:value={refLinkInput[selectedProject.id]}
                placeholder="Paste Spotify / YouTube / any URL… or drop here"
                onkeydown={e => e.key === 'Enter' && addRefLink(selectedProject, refLinkInput[selectedProject.id]||'')} />
              <button class="btn-ghost-sm" onclick={() => addRefLink(selectedProject, refLinkInput[selectedProject.id]||'')}>+ Add</button>
            </div>
            {#if refs.length}
              <div class="refs-inline">
                {#each refs as ref}
                  {@const isSpotify = ref.url.includes('spotify')}
                  <span class="ref-chip">
                    {#if isSpotify}
                      <button class="spotidown-btn" onclick={() => { navigator.clipboard.writeText(ref.url); window.open('https://spotidown.app/de4', '_blank') }} title="Download from Spotidown">↓</button>
                      <button class="spotify-play-btn-sm" onclick={() => playRefUrl(ref.url)}>{refPlayingUrl === ref.url ? '■' : '▶'}</button>
                    {:else}
                      <a href={ref.url} target="_blank" class="ref-link-btn">{linkLabel(ref.url)}</a>
                    {/if}
                    <span class="ref-chip-name">{ref.name || (ref.url.length>40?'…'+ref.url.slice(-36):ref.url)}</span>
                    <button class="ref-del" onclick={() => removeRefLink(selectedProject, ref.id)}>×</button>
                  </span>
                {/each}
              </div>
            {:else}
              <p class="ref-empty">No references yet.</p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Songs -->
      {#if !projectSongs.length}
        <p class="empty" style="padding:20px 0">No songs yet.</p>
      {:else}
        {#each projectSongs as song (song.id)}
          {@const wd = workData(song)}
          {@const doneCount = STAGES.filter(s => wd.stages[s.id]?.done).length}
          {@const currentStageConf = STAGES.find(s => s.id === wd.current_stage)}
          {@const expanded = expandedSongId === song.id}
          {@const blobUrl = activeVersionBlobUrl(song)}
          {@const audioPath = activeVersionAudioPath(song)}
          {@const bestAudio = bestAudioSrc(song)}
          {@const lv = lastVersion(song)}

          <div class="song-card {expanded?'exp':''} {wd.sent_to_mastering?'mastering':''}">
            <div class="song-head">
              <div class="reorder-btns">
                <button class="reorder-btn" onclick={e => moveSong(e, song, -1)}>▲</button>
                <button class="reorder-btn" onclick={e => moveSong(e, song, 1)}>▼</button>
              </div>
              <!-- LEFT: info + pills, grows -->
              <div class="song-head-left" onclick={() => expandSong(song, !expanded)}>
                <div class="song-info">
                  <div class="code-stars-row">
                    <span class="song-code">{song.code}</span>
                    <div class="stars" onclick={e => e.stopPropagation()}>
                      {#each [1,2,3] as n}
                        <button class="star {(song.rating||0) >= n ? 'on' : ''}"
                          onclick={() => { updateSongField(song, 'rating', (song.rating||0) === n ? 0 : n) }}>★</button>
                      {/each}
                    </div>
                  </div>
                  <input class="song-title-input" value={song.title||''} placeholder="Add title..."
                    onclick={e => e.stopPropagation()}
                    onchange={e => { updateSongField(song, 'title', e.target.value); renameSongAudioFiles(song, e.target.value) }}
                    onkeydown={e => e.key==='Enter' && e.target.blur()} />
                </div>
                <div class="stage-pills">
                  {#each STAGES.filter(s => s.id !== 'demo') as stage}
                    {@const sdone = wd.stages[stage.id]?.done}
                    {@const isActive = wd.current_stage === stage.id}
                    <div class="stage-pill {sdone?'done':''} {isActive?'active':''}" title={stage.label}>
                      {#if stage.id === 'production'}
                        <span class="sub-dot {wd.prod_lyrics?'on':''}" title="Lyrics"></span>
                        <span class="sub-dot {wd.prod_vocal_rec?'on':''}" title="Vocal Rec"></span>
                        <span class="sub-dot {wd.prod_vocal_prep?'on':''}" title="Vocal Prep"></span>
                      {/if}
                    </div>
                  {/each}
                  <div class="stage-pill stems-pill {wd.stems_received?'done':''}" title="STEMS"
                    onclick={e => { e.stopPropagation(); saveWorkData(song, wd => { wd.stems_received = !wd.stems_received }) }}>
                  </div>
                </div>
              </div>
              <!-- RIGHT: fixed width, player always in same position -->
              <div class="song-head-right" onclick={e => e.stopPropagation()}>
                <div class="song-head-badges">
                  <span class="stage-lbl-sm">{STAGES.find(s=>s.id===wd.current_stage)?.label || (wd.current_stage==='stems'?'STEMS':'')}</span>
                  {#if lv}
                    <span class="version-badge {lv.sent_to_artist?'sent':''}">{lv.name}</span>
                  {/if}
                </div>
                <div class="song-player-slot">
                  {#key audioTick}
                    {#if bestAudio}
                      <div class="player-wrap-head" onpointerdown={e => e.stopPropagation()}>
                        <audio class="mini-player" controls preload="none" src={bestAudio.src}></audio>
                      </div>
                    {:else if blobUrl}
                      <div class="player-wrap-head" onpointerdown={e => e.stopPropagation()}>
                        <audio class="mini-player" controls preload="none" src={blobUrl}></audio>
                      </div>
                    {:else if songAudioBlobUrls[song.id]}
                      <div class="player-wrap-head" onpointerdown={e => e.stopPropagation()}>
                        <audio class="mini-player" controls preload="none" src={songAudioBlobUrls[song.id]}></audio>
                      </div>
                    {:else if song.audio_path}
                      <div class="audio-drop-sm"
                        ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
                        ondragleave={e => e.currentTarget.classList.remove('drag-over')}
                        ondrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); handleSongAudioDrop(e, song) }}
                        title="Drop audio file here to play">
                        🎵 {song.audio_path}
                      </div>
                    {/if}
                  {/key}
                </div>
                <button class="daw-capture-btn" title="Capture DAW session for this song" onclick={e => { e.stopPropagation(); captureDawSession(song) }}>📸</button>
                <span class="arr {expanded?'open':''}" onclick={() => expandSong(song, !expanded)}>▶</span>
              </div>
            </div>

            {#if expanded}
              <div class="song-body">
                <!-- Stage row -->
                <div class="stages-row">
                  {#each STAGES.filter(s => s.id !== 'demo') as stage}
                    {@const sd = wd.stages[stage.id]}
                    <div class="stage-box {wd.current_stage===stage.id?'active':''} {sd.done?'done':''}">
                      <button class="stage-ckb" onclick={() => toggleStageDone(song, stage.id)}>{sd.done?'✓':''}</button>
                      <button class="stage-name-btn" onclick={() => setStage(song, stage.id)}>{stage.label}</button>
                    </div>
                  {/each}
                  <!-- STEMS — appears after mastering, looks identical to a stage box -->
                  <div class="stage-box {wd.stems_received?'done':''} {wd.current_stage==='stems'?'active':''}">
                    <button class="stage-ckb" onclick={() => saveWorkData(song, wd => { wd.stems_received = !wd.stems_received })}>{wd.stems_received?'✓':''}</button>
                    <button class="stage-name-btn" onclick={() => setStage(song, 'stems')}>STEMS</button>
                  </div>
                  <!-- RELEASE button after STEMS — one click creates release entry -->
                  <button class="release-stage-btn {releasedSongIds.includes(song.id)||releasedSongIds.includes(song.code)?'done':''}"
                    onclick={async () => {
                      if (releasedSongIds.includes(song.id) || releasedSongIds.includes(song.code)) {
                        alert('A release has already been created for this song. Edit it in the RELEASES tab.')
                        return
                      }
                      const _wd = workData(song)
                      const res = await fetch('http://localhost:4242/create-release-entry', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          song_id: song.id, code: song.code, title: song.title || song.code,
                          artist: selectedProject?.artist || '', release_date: song.release_date || '',
                          work_data: _wd
                        })
                      })
                      const r = await res.json()
                      if (!r.ok) { alert('Release creation failed: ' + r.error); return }
                      // Delete instrumental file on release
                      if (_wd.instr_audio) fetch(`http://localhost:4242/delete-audio?dir=instrumental&filename=${encodeURIComponent(_wd.instr_audio)}`, { method: 'POST' }).catch(() => {})
                      releasedSongIds = [...releasedSongIds, song.id, song.code]
                      // Log release milestone to brain
                      supabase.from('brain_knowledge').insert({
                        category: 'own_production',
                        title: 'Released: ' + (song.title || song.code),
                        content: (selectedProject?.artist ? selectedProject.artist + ' — ' : '') + (song.title || song.code) + ' released on ' + new Date().toLocaleDateString() + '. Mix versions: ' + (_wd.versions?.filter(v=>v.version_type==='mixing').length || 0) + '. Production versions: ' + (_wd.versions?.filter(v=>v.version_type==='production').length || 0) + '.',
                        entry_type_v2: 'milestone', confidence: 'high', source_type: 'release_event', active: true
                      }).then(() => {})
                      generateNarrative(song)
                    }}>
                    {releasedSongIds.includes(song.id)||releasedSongIds.includes(song.code) ? 'RELEASED ✓' : 'RELEASE'}
                  </button>
                  <!-- LOG tab flush right -->
                  <button class="log-tab-btn {activeSongTab[song.id]==='log'?'on':''}"
                    onclick={() => { activeSongTab = {...activeSongTab, [song.id]: activeSongTab[song.id]==='log' ? null : 'log'} }}>
                    LOG
                  </button>
                </div>

                <!-- LOG panel -->
                {#if activeSongTab[song.id] === 'log'}
                  {@const log = wd.session_log || []}
                  {@const totalSec = log.reduce((s,e) => s+e.seconds, 0)}
                  <div class="log-panel">
                    {#if !log.length}
                      <p class="empty-sm" style="padding:10px 0;color:#333">No sessions logged yet.</p>
                    {:else}
                      <!-- Group by stage -->
                      {#each [...new Set(log.map(e => e.stage))] as stageId}
                        {@const stageEntries = log.filter(e => e.stage === stageId)}
                        {@const stageSec = stageEntries.reduce((s,e) => s+e.seconds, 0)}
                        {@const stageLabel = STAGES.find(s=>s.id===stageId)?.label || stageId.replace('_',' ').toUpperCase()}
                        <!-- Stage header -->
                        <div class="log-stage-header">
                          <span class="log-stage-label">{stageLabel}</span>
                          <span class="log-stage-total-inline">{formatMinSec(stageSec)}</span>
                        </div>
                        <!-- Entries under this stage -->
                        {#each stageEntries as entry}
                          <div class="log-row">
                            <span class="log-col-date">{entry.date}</span>
                            <span class="log-col-time">{formatMinSec(entry.seconds)}</span>
                          </div>
                        {/each}
                      {/each}
                      <!-- Grand total -->
                      <div class="log-total">
                        <span>TOTAL</span>
                        <span>{formatMinSec(totalSec)}</span>
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Per-song project info — only in production stage -->
                {#if wd.current_stage === 'production'}
                <div class="song-meta-block">
                  <div class="song-meta-row1">
                    <div class="field field-sm">
                      <label>TITLE</label>
                      <input class="inp-sm" value={song.title||''} placeholder="Working title..." onchange={e => { updateSongField(song, 'title', e.target.value); renameSongAudioFiles(song, e.target.value) }} />
                    </div>
                    <div class="field field-sm">
                      <label>KEY</label>
                      <select class="inp-sm" value={song.key||''} onchange={e => updateSongField(song, 'key', e.target.value)}>
                        <option value="">—</option>
                        {#each KEYS as k}<option value={k}>{k}</option>{/each}
                      </select>
                    </div>
                    <div class="field field-sm">
                      <label>TEMPO</label>
                      <input class="inp-sm" type="number" placeholder="120" value={song.tempo||''} onchange={e => updateSongField(song, 'tempo', parseInt(e.target.value)||null)} />
                    </div>
                    <div class="field" style="flex:1">
                      <label>TAGS</label>
                      <div class="tags-wrap">
                        {#each (song.tags||[]) as tag}
                          {@const tagLabel = GENRE_LIST.find(g => g.tag === tag)?.label || tag}
                          <span class="tag">{tagLabel}<button class="tag-del" onclick={() => removeSongTag(song, tag)}>×</button></span>
                        {/each}
                        <select class="tag-genre-select" onchange={e => {
                          const val = e.target.value
                          if (val && !(song.tags||[]).includes(val)) addSongTag_direct(song, val)
                          e.target.value = ''
                        }}>
                          <option value="">+ genre</option>
                          {#each GENRE_LIST as g}
                            {#if g.type === 'main'}
                              <option disabled style="font-weight:700;color:#c9a84c">{g.label}</option>
                            {:else}
                              <option value={g.tag} disabled={(song.tags||[]).includes(g.tag)}>{g.label}</option>
                            {/if}
                          {/each}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                {/if}

                <!-- Reference links — always visible -->
                <div class="song-meta-block" style="margin-top:-8px">
                  <div class="field">
                    <label>REFERENCE LINKS</label>
                    <div class="refs-wrap">
                      <div class="refs-inline">
                        {#each (song.reference_links||[]) as ref}
                          {@const refUrl = ref.url || (ref.spotify_id ? 'https://open.spotify.com/track/' + ref.spotify_id : null)}
                          {@const refName = ref.name || (ref.artist ? ref.artist + ' — ' + ref.title : ref.title || ref.url || '')}
                          {@const isSpotify = refUrl?.includes('spotify')}
                          <span class="ref-chip">
                            {#if refUrl}
                              {#if isSpotify}
                                <button class="spotidown-btn" onclick={() => { navigator.clipboard.writeText(refUrl); window.open('https://spotidown.app/de4', '_blank') }} title="Download from Spotidown">↓</button>
                                <button class="spotify-play-btn-sm" onclick={() => playRefUrl(refUrl)}>{refPlayingUrl === refUrl ? '■' : '▶'}</button>
                                <button class="vocal-btn" onclick={() => analyzeVocalStyle(refUrl)} title="Analyze vocal style">🎤</button>
                              {:else}
                                <a href={refUrl} target="_blank" class="ref-link-btn">↗</a>
                              {/if}
                            {/if}
                            <span class="ref-chip-name">{refName.length > 40 ? '…' + refName.slice(-36) : refName}</span>
                            <button class="tag-del" onclick={() => removeSongRef(song, ref.url || ref.id)}>×</button>
                          </span>
                        {/each}
                      </div>
                      <div class="ref-add-row">
                        <input class="inp-sm" placeholder="Spotify / YouTube URL..." bind:value={songRefInput[song.id]} onkeydown={e => e.key==='Enter' && addSongRef(song)} />
                        <button class="btn-ghost-sm" onclick={() => addSongRef(song)}>+ Add</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="field" style="margin-top:-8px">
                  <label>SONG NOTES / BRIEF</label>
                  <textarea class="ta ta-auto" placeholder="Song-specific vision, references..." value={wd.project_info} use:autoResize oninput={e => saveProjectInfo(song, e.target.value)}></textarea>
                </div>
                <!-- Production sub-steps: Lyrics, Vocal Rec, Vocal Prep -->
                {#if wd.current_stage === 'production'}
                  <div class="prod-substeps">
                    <div class="prod-sub-row">
                      <button class="prod-ckb {wd.prod_lyrics?'done':''}" onclick={() => saveWorkData(song, wd => { wd.prod_lyrics = !wd.prod_lyrics })}>{wd.prod_lyrics?'✓':''}</button>
                      <span class="prod-sub-label {wd.prod_lyrics?'done':''}">LYRICS</span>
                    </div>
                    <div class="prod-sub-row">
                      <button class="prod-ckb {wd.prod_vocal_rec?'done':''}" onclick={() => saveWorkData(song, wd => { wd.prod_vocal_rec = !wd.prod_vocal_rec })}>{wd.prod_vocal_rec?'✓':''}</button>
                      <span class="prod-sub-label {wd.prod_vocal_rec?'done':''}">VOCAL REC</span>
                    </div>
                    <div class="prod-sub-row">
                      <button class="prod-ckb {wd.prod_vocal_prep?'done':''}" onclick={() => saveWorkData(song, wd => { wd.prod_vocal_prep = !wd.prod_vocal_prep })}>{wd.prod_vocal_prep?'✓':''}</button>
                      <span class="prod-sub-label {wd.prod_vocal_prep?'done':''}">VOCAL PREP</span>
                    </div>
                  </div>
                  <!-- Lyrics + Production audio — only in production stage -->
                  <div class="lyrics-block">
                    <button class="lyrics-toggle" onclick={() => { lyricsOpen[song.id] = !lyricsOpen[song.id]; lyricsOpen = {...lyricsOpen} }}>
                      <span>LYRICS</span>
                      {#if wd.lyrics_text}<span class="lyrics-preview">{wd.lyrics_text.slice(0,40)}{wd.lyrics_text.length>40?'…':''}</span>{/if}
                      <span class="lyrics-arr {lyricsOpen[song.id]?'open':''}">▶</span>
                    </button>
                    {#if lyricsOpen[song.id]}
                      <textarea class="ta lyrics-ta" placeholder="Paste or write lyrics here..." value={wd.lyrics_text} use:autoResize oninput={e => saveWorkData(song, wd => { wd.lyrics_text = e.target.value })}></textarea>
                    {/if}
                  </div>
                  <!-- Production audio drop + Instrumental drop — side by side -->
                  {#if song._instr_flash}<div class="sent-flash" style="font-size:10px;padding:4px 8px">✉ SENT!</div>{/if}
                  {#if song._instr_copied}<div class="sent-flash" style="font-size:10px;padding:4px 8px">🔗 COPIED!</div>{/if}
                  <div class="dual-drop-row">
                    <!-- Left: production audio -->
                    <div class="dual-drop-col">
                      <div class="dual-drop-label">VERSION</div>
                      <div class="stage-audio-drop dual-drop {song._prodDrag?'drag-over':''}"
                        ondragover={e => { e.preventDefault(); song._prodDrag=true; songs=[...songs] }}
                        ondragleave={() => { song._prodDrag=false; songs=[...songs] }}
                        ondrop={e => handleProdDrop(e, song)}>
                        {#if prodBlobUrls[song.id] || wd.prod_audio}
                          <span class="stage-audio-name">🎵 {wd.prod_audio || 'Loaded'}</span>
                          <span class="drop-rehint">Drop new version · <span class="drop-alt-hint">⌥+drop to overwrite</span></span>
                        {:else}
                          <span class="drop-hint">↓ Drop production audio</span>
                          <span class="drop-alt-hint" style="display:block;margin-top:2px">⌥+drop to overwrite current version</span>
                        {/if}
                      </div>
                    </div>
                    <!-- Right: instrumental -->
                    <div class="dual-drop-col">
                      <div class="dual-drop-label">INSTRUMENTAL</div>
                      <div class="stage-audio-drop dual-drop {song._instrDrag?'drag-over':''}"
                        ondragover={e => { e.preventDefault(); song._instrDrag=true; songs=[...songs] }}
                        ondragleave={() => { song._instrDrag=false; songs=[...songs] }}
                        ondrop={e => handleInstrumentalDrop(e, song)}>
                        {#if instrBlobUrls[song.id] || wd.instr_audio}
                          <span class="stage-audio-name">🎵 {instrPendingName[song.id] || wd.instr_audio || 'Loaded'}</span>
                          <span class="drop-rehint">Drop to overwrite</span>
                        {:else}
                          <span class="drop-hint">↓ Drop instrumental</span>
                          <span class="drop-hint-sub">CODE_ARTIST_TITLE_VXX_BPM</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                  <!-- Send rows — same grid, both identical structure -->
                  <div class="dual-drop-row" style="margin-top:6px">
                    <div class="dual-send-row-inner">
                      <ListenLinkBlock compact bind:backgroundStyle={selectedListenBg} />
                      {#if wd.prod_audio}
                        <button class="copy-dbx-btn" onclick={() => copyDropboxLink(song)}>🔗</button>
                      {/if}
                      <button class="dual-send-btn {wd.versions?.filter(ver=>ver.version_type==='production').slice(-1)[0]?.sent_to_artist?'sent':''}" style="flex:1"
                        onclick={() => { const pvs = wd.versions?.filter(ver=>ver.version_type==='production'); const activeV = pvs?.find(ver=>ver.id===wd.active_version_id)||pvs?.[pvs.length-1]; if(activeV) sendToArtist(song,activeV.id) }}>
                        ✉ Send Version
                      </button>
                    </div>
                    <div class="dual-send-row-inner">
                      <ListenLinkBlock compact bind:backgroundStyle={selectedListenBg} />
                      {#if wd.instr_audio}
                        <button class="copy-dbx-btn" onclick={() => copyInstrumentalLink(song)}>🔗</button>
                      {/if}
                      <button class="dual-send-btn {wd.instr_sent?'sent':''}" style="flex:1"
                        disabled={!wd.instr_audio}
                        onclick={() => sendInstrumentalToArtist(song)}>
                        ✉ Send Instrumental
                      </button>
                    </div>
                  </div>
                {/if}

                <!-- Mixing audio drop zone -->
                {#if wd.current_stage === 'mixing'}
                  <div class="stage-audio-drop {song._mixDrag?'drag-over':''}"
                    ondragover={e => { e.preventDefault(); song._mixDrag=true; songs=[...songs] }}
                    ondragleave={() => { song._mixDrag=false; songs=[...songs] }}
                    ondrop={e => handleMixDrop(e, song)}>
                    {#if mixBlobUrls[song.id] || wd.mix_audio}
                      <span class="stage-audio-name">🎵 {wd.mix_audio || 'Loaded'}</span>
                      <span class="drop-rehint">Drop new version · <span class="drop-alt-hint">⌥+drop to overwrite</span></span>
                    {:else}
                      <span class="drop-hint">↓ Drop mix — saves to Dropbox/Mixing as CODE_Title_MIX_v01</span>
                      <span class="drop-alt-hint" style="display:block;margin-top:2px">⌥+drop to overwrite current version</span>
                    {/if}
                  </div>
                  <div class="dual-send-grid" style="margin-top:6px">
                    <div class="dual-send-col" style="grid-column:1/-1;flex-direction:row;display:flex;gap:8px;align-items:center">
                      <ListenLinkBlock compact showLabels bind:backgroundStyle={selectedListenBg} />
                      {#if wd.mix_audio}
                        <button class="copy-dbx-btn" onclick={() => copyDropboxLink(song)}>
                          {song._dbxCopied ? '✓ Copied!' : '🔗 Dropbox Link'}
                        </button>
                      {/if}
                      <button class="dual-send-btn {wd.versions?.filter(ver=>ver.version_type==='mixing').slice(-1)[0]?.sent_to_artist?'sent':''}" style="flex:1"
                        onclick={() => { const mvs = wd.versions?.filter(ver=>ver.version_type==='mixing'); const activeV = mvs?.find(ver=>ver.id===wd.active_version_id)||mvs?.[mvs.length-1]; if(activeV) sendToArtist(song,activeV.id) }}>
                        ✉ Send Version
                      </button>
                    </div>
                  </div>
                {/if}

                <!-- Stems ZIP drop zone -->
                {#if wd.current_stage === 'stems'}
                  {#if song._stemsSent}
                    <div class="sent-flash">✉ Stems link copied!</div>
                  {/if}
                  <div class="stage-audio-drop {song._stemsDrag?'drag-over':''}"
                    ondragover={e => { e.preventDefault(); song._stemsDrag=true; songs=[...songs] }}
                    ondragleave={() => { song._stemsDrag=false; songs=[...songs] }}
                    ondrop={e => handleStemsZipDrop(e, song)}>
                    {#if wd.stems_zip}
                      <span class="stage-audio-name">📦 {wd.stems_zip}</span>
                      <span class="drop-rehint">Drop new ZIP to overwrite</span>
                    {:else}
                      <span class="drop-hint">↓ Drop stems ZIP — naming: CODE_ARTIST_TITLE_STEMS_V01_133bpm.zip</span>
                    {/if}
                  </div>
                  <div class="dual-send-row" style="margin-top:6px">
                    {#if wd.stems_zip}
                      <button class="copy-dbx-btn" onclick={() => copyDropboxStemsLink(song)}>
                        {song._stemsCopied ? '✓ Copied!' : '🔗 Dropbox Link'}
                      </button>
                      <button class="dual-send-btn {wd.stems_sent?'sent':''}" onclick={() => sendStems(song)}>
                        {song._stemsSent ? '✓ Copied!' : '↗ Send Stems'}
                      </button>
                    {/if}
                  </div>
                {/if}

                <!-- Versions — production / mixing only -->
                {#if currentStageConf?.hasVersions}
                  {@const stageVers = wd.versions.filter(v => v.version_type === wd.current_stage)}
                  {@const activeVfilt = stageVers.find(v => v.id === wd.active_version_id) || stageVers[stageVers.length-1] || null}
                  <div class="versions-block">
                    <div class="versions-header">
                      <label>VERSIONS — {currentStageConf.label}</label>
                      <button class="btn-ghost-sm" onclick={() => addVersion(song, wd.current_stage)}>+ New Version</button>
                    </div>
                    {#if stageVers.length}
                      <div class="version-tabs">
                        {#each stageVers as v}
                          <button class="vtab {wd.active_version_id===v.id?'on':''} {v.sent_to_artist?'vtab-sent':''}" onclick={() => setActiveVersion(song, v.id)}>
                            {v.name}{audioBlobUrls[v.id]?' ♪':''}{v.sent_to_artist?' ✉':''}
                          </button>
                        {/each}
                      </div>
                      {#if activeVfilt}
                        <!-- Banners -->
                        {#if song._sent_flash === activeVfilt.id}
                          <div class="sent-flash">✉ Sent to artist — text copied!</div>
                        {/if}
                        {#if song._copied === activeVfilt.id}
                          <div class="copied-banner">✓ Changelog copied!</div>
                        {/if}
                        <!-- Feedback -->
                        <div class="feedback-list">
                          {#each activeVfilt.feedback as fb (fb.id)}
                            <div class="fb-row {fb.done?'fb-done':''}">
                              <button class="ckb-sm" onclick={() => toggleFeedback(song,activeVfilt.id,fb.id)}>{fb.done?'✓':''}</button>
                              <span class="fb-text">{fb.text}</span>
                              <button class="del-btn" onclick={() => deleteFeedback(song,activeVfilt.id,fb.id)}>×</button>
                            </div>
                          {/each}
                          {#if !activeVfilt.feedback.length}<p class="empty-sm">No feedback yet.</p>{/if}
                        </div>
                        <div class="fb-add-row">
                          <input class="add-inp" bind:value={fbInput[activeVfilt.id]} placeholder="Add feedback item..."
                            onkeydown={e => { if(e.key==='Enter'){addFeedback(song,activeVfilt.id,fbInput[activeVfilt.id]||'');fbInput[activeVfilt.id]=''}}} />
                          <button class="add-btn" onclick={() => {addFeedback(song,activeVfilt.id,fbInput[activeVfilt.id]||'');fbInput[activeVfilt.id]=''}}>+</button>
                        </div>
                        {#if activeVfilt.feedback.length && activeVfilt.feedback.every(f=>f.done)}
                          <div class="all-done-hint">All done — changelog copied ✓</div>
                        {/if}
                        <!-- Notes dump -->
                        <div class="version-notes-block">
                          <label>NOTES / DUMP <span style="color:#555;font-size:9px">— ⌘+Enter → Claude makes feedback points · drop PDF to extract</span></label>
                          <div class="notes-drop-wrap {activeVfilt._pdfDrag?'pdf-drag-over':''}"
                            ondragover={e => { e.preventDefault(); activeVfilt._pdfDrag=true; songs=[...songs] }}
                            ondragleave={() => { activeVfilt._pdfDrag=false; songs=[...songs] }}
                            ondrop={e => { e.preventDefault(); activeVfilt._pdfDrag=false; songs=[...songs]; const f=e.dataTransfer.files[0]; if(f && (f.type==='application/pdf' || f.name?.toLowerCase().endsWith('.pdf'))) processPdfToFeedback(song, activeVfilt.id, f) }}>
                            <textarea class="ta ta-auto notes-ta" placeholder="Dump anything here — rough ideas, things to fix, references... or drop a PDF"
                              value={activeVfilt.notes||''} use:autoResize
                              oninput={e => saveVersionNotes(song, activeVfilt.id, e.target.value)}
                              onkeydown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); processNotesToFeedback(song, activeVfilt.id) } }}
                            ></textarea>
                          </div>
                          {#if activeVfilt._processingNotes}
                            <span style="font-family:'Space Mono',monospace;font-size:10px;color:#c9a84c">✦ Claude is processing...</span>
                          {/if}
                          {#if activeVfilt._processingPdf}
                            <span style="font-family:'Space Mono',monospace;font-size:10px;color:#c9a84c">✦ Reading PDF...</span>
                          {/if}
                        </div>
                        {#if activeVfilt.analysis}
                          <div class="version-analysis-row">
                            <div class="analysis-line">
                              {[
                                activeVfilt.analysis.bpm ? Math.round(activeVfilt.analysis.bpm) + 'bpm' : null,
                                activeVfilt.analysis.key ? activeVfilt.analysis.key + ' ' + (activeVfilt.analysis.scale||'') + (activeVfilt.analysis.camelot ? ' (' + activeVfilt.analysis.camelot + ')' : '') : null,
                                activeVfilt.analysis.loudness_lufs != null ? activeVfilt.analysis.loudness_lufs + 'LUFS' : null
                              ].filter(Boolean).join(' · ')}
                            </div>
                            <div class="analysis-line">
                              {[
                                activeVfilt.analysis.energy != null ? 'nrg ' + activeVfilt.analysis.energy : null,
                                activeVfilt.analysis.danceability != null ? 'dnc ' + activeVfilt.analysis.danceability : null,
                                activeVfilt.analysis.valence != null ? 'val ' + activeVfilt.analysis.valence : null
                              ].filter(Boolean).join(' · ')}
                            </div>
                            {#if [activeVfilt.analysis.loudness_range, activeVfilt.analysis.dynamic_complexity, activeVfilt.analysis.warmth, activeVfilt.analysis.rhythm_regularity, activeVfilt.analysis.harmonic_complexity, activeVfilt.analysis.vocal_root_note].some(v => v != null)}
                            <div class="analysis-line">
                              {[
                                activeVfilt.analysis.loudness_range != null ? 'LRA ' + activeVfilt.analysis.loudness_range + 'dB' : null,
                                activeVfilt.analysis.dynamic_complexity != null ? 'dyn ' + activeVfilt.analysis.dynamic_complexity : null,
                                activeVfilt.analysis.warmth != null ? 'warm ' + activeVfilt.analysis.warmth : null,
                                activeVfilt.analysis.rhythm_regularity != null ? 'groove ' + activeVfilt.analysis.rhythm_regularity : null,
                                activeVfilt.analysis.harmonic_complexity != null ? 'harm ' + activeVfilt.analysis.harmonic_complexity : null,
                                activeVfilt.analysis.vocal_root_note ? 'vocal ' + activeVfilt.analysis.vocal_root_note + (activeVfilt.analysis.vocal_octave != null ? activeVfilt.analysis.vocal_octave : '') : null
                              ].filter(Boolean).join(' · ')}
                            </div>
                            {/if}
                          </div>
                          {#if hitBenchmark}
                            {@const a = activeVfilt.analysis}
                            {@const bpmDiff = hitBenchmark.bpm && a.bpm ? Math.abs(a.bpm - hitBenchmark.bpm) : null}
                            {@const lufsDiff = hitBenchmark.loudness_lufs && a.loudness_lufs != null ? Math.abs(a.loudness_lufs - hitBenchmark.loudness_lufs) : null}
                            {@const nrgDiff = hitBenchmark.energy && a.energy != null ? Math.abs(a.energy - hitBenchmark.energy) : null}
                            {@const dncDiff = hitBenchmark.danceability && a.danceability != null ? Math.abs(a.danceability - hitBenchmark.danceability) : null}
                            <div class="ver-progress-block">
                              <div class="ver-progress-header">VERSION PROGRESS</div>
                              <div class="ver-progress-table">
                                <div class="vp-row vp-header-row"><span>SIGNAL</span><span>THIS MIX</span><span>HIT AVG</span><span>GAP</span></div>
                                {#if a.bpm && hitBenchmark.bpm}
                                  <div class="vp-row"><span>BPM</span><span>{Math.round(a.bpm)}</span><span>{hitBenchmark.bpm}</span><span class:vp-close={bpmDiff <= 5} class:vp-far={bpmDiff > 10}>{bpmDiff <= 2 ? '✓' : bpmDiff <= 5 ? '↑' : '–'} {bpmDiff}</span></div>
                                {/if}
                                {#if a.loudness_lufs != null && hitBenchmark.loudness_lufs != null}
                                  <div class="vp-row"><span>LUFS</span><span>{a.loudness_lufs}</span><span>{hitBenchmark.loudness_lufs}</span><span class:vp-close={lufsDiff <= 1} class:vp-far={lufsDiff > 3}>{lufsDiff <= 0.5 ? '✓' : lufsDiff <= 2 ? '↑' : '–'} {lufsDiff?.toFixed(1)}</span></div>
                                {/if}
                                {#if a.energy != null && hitBenchmark.energy != null}
                                  <div class="vp-row"><span>ENERGY</span><span>{a.energy}</span><span>{hitBenchmark.energy}</span><span class:vp-close={nrgDiff <= 0.05} class:vp-far={nrgDiff > 0.15}>{nrgDiff <= 0.03 ? '✓' : nrgDiff <= 0.1 ? '↑' : '–'} {nrgDiff?.toFixed(2)}</span></div>
                                {/if}
                                {#if a.danceability != null && hitBenchmark.danceability != null}
                                  <div class="vp-row"><span>DANCE</span><span>{a.danceability}</span><span>{hitBenchmark.danceability}</span><span class:vp-close={dncDiff <= 0.05} class:vp-far={dncDiff > 0.15}>{dncDiff <= 0.03 ? '✓' : dncDiff <= 0.1 ? '↑' : '–'} {dncDiff?.toFixed(2)}</span></div>
                                {/if}
                              </div>
                              <div class="vp-ref-count">{hitBenchmark.count} reference tracks</div>
                            </div>
                          {/if}
                        {/if}
                      {/if}
                    {:else}
                      <p class="empty-sm" style="padding:14px">No versions yet.</p>
                    {/if}
                  </div>
                {/if}

                <!-- Work log -->
                {#if songWorkLogs?.length && expandedSongId === song.id}
                  <div class="work-log-section">
                    <div class="work-log-title">WORK LOG</div>
                    {#each songWorkLogs as log}
                      <div class="work-log-entry">
                        <span class="work-log-stage">{log.stage}</span>
                        <span class="work-log-dur">{log.duration_minutes}min</span>
                        <span class="work-log-date">{new Date(log.logged_at).toLocaleDateString()}</span>
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Vocal EQ section -->
                <div class="vocal-eq-section">
                  <button class="vocal-eq-header" onclick={() => {
                    showVocalEq[song.id] = !showVocalEq[song.id]
                    showVocalEq = { ...showVocalEq }
                    if (showVocalEq[song.id]) {
                      // Restore from cache immediately, then refresh
                      if (vocalEqCache.has(song.id)) {
                        vocalEqCurves[song.id] = vocalEqCache.get(song.id)
                        vocalEqCurves = { ...vocalEqCurves }
                      }
                      loadVocalEq(song.id)
                    }
                  }}>
                    <span class="vocal-eq-title">🎤 ANALYZER</span>
                    <span class="vocal-eq-arr {showVocalEq[song.id] ? 'open' : ''}">▶</span>
                  </button>
                  {#if showVocalEq[song.id]}
                    {@const songCurves = vocalEqCurves[song.id] || []}
                    {@const stemKey = activeStem[song.id] || 'vocals'}
                    {@const selectedRef = selectedRefId[song.id] || ''}
                    {@const mixCurveData = songCurves.find(c => c.source_type === 'mix' && c.stem_type === stemKey)}
                    {@const refCurveData = selectedRef
                      ? songCurves.find(c => String(c.reference_track_id) === selectedRef && c.stem_type === stemKey)
                      : songCurves.find(c => c.source_type === 'reference' && c.stem_type === stemKey)}
                    {@const refCurves = songCurves.filter(c => c.source_type === 'reference' && c.stem_type === stemKey && !c.reference_track_id)}
                    {@const mixCurves = songCurves.filter(c => c.source_type === 'mix' && c.stem_type === stemKey)}
                    {@const mixCurve = mixCurveData?.curve && typeof mixCurveData.curve === 'object' ? mixCurveData.curve : null}
                    {@const refCurve = refCurveData?.curve && typeof refCurveData.curve === 'object' ? refCurveData.curve : null}
                    {@const selectedRefTrack = selectedRef ? refTrackOptions.find(r => String(r.id) === selectedRef) : null}
                    {@const cmp = vocalComparison[song.id]}
                    {@const refLoading = vocalEqLoading[song.id]}
                    {@const ao = analyzerOpen[String(song.id)] || {}}
                    {@const latestA = (wd.versions||[]).filter(v=>v.analysis).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]?.analysis}
                    {@const refLinks = new Set(wd.reference_links || [])}
                    {@const projectRefs = refTrackOptions.filter(r => refLinks.has(String(r.id)))}
                    {@const hitRefs = refTrackOptions.filter(r => !refLinks.has(String(r.id)) && ((r.popularity || 0) > 70 || r.collection_name === 'daily_chart' || r.collection_name === 'tiktok_trending'))}
                    {@const libraryRefs = refTrackOptions.filter(r => !refLinks.has(String(r.id)) && (r.popularity || 0) <= 70 && r.collection_name !== 'daily_chart' && r.collection_name !== 'tiktok_trending')}
                    <div class="vocal-eq-body">
                      <!-- Stem selector -->
                      <div class="stem-tabs">
                        {#each ['vocals', 'drums', 'bass', 'other'] as stem}
                          <button class="stem-tab {stemKey === stem ? 'active' : ''}"
                            onclick={() => { activeStem[song.id] = stem; activeStem = { ...activeStem }; loadVocalEq(song.id) }}>
                            {stem.toUpperCase()}
                          </button>
                        {/each}
                      </div>
                      <!-- Ref dropdown — always show, curves load when available -->
                      <div class="ref-select-row">
                        <span class="ref-select-label">Compare:</span>
                        <select class="ref-select"
                          value={selectedRef}
                          onchange={e => {
                            selectedRefId[song.id] = e.currentTarget.value
                            selectedRefId = { ...selectedRefId }
                            loadVocalEq(song.id)
                            const ref = refTrackOptions.find(r => String(r.id) === e.currentTarget.value)
                            if (ref) loadMozartInsight(song.id, ref)
                          }}>
                          <option value="">— no ref —</option>
                          {#if projectRefs.length}
                            <optgroup label="── PROJECT REFS ──">
                              {#each projectRefs as ref}
                                <option value={String(ref.id)}>{ref.artist || 'Unknown'} — {ref.title}</option>
                              {/each}
                            </optgroup>
                          {/if}
                          {#if hitRefs.length}
                            <optgroup label="── HIT SONGS ──">
                              {#each hitRefs as ref}
                                <option value={String(ref.id)}>{ref.artist || 'Unknown'} — {ref.title}</option>
                              {/each}
                            </optgroup>
                          {/if}
                          {#if libraryRefs.length}
                            <optgroup label="── LIBRARY ──">
                              {#each libraryRefs as ref}
                                <option value={String(ref.id)}>{ref.artist || 'Unknown'} — {ref.title}</option>
                              {/each}
                            </optgroup>
                          {/if}
                        </select>
                      </div>
                      {#if selectedRef && !refCurveData}
                        <div class="no-curve-msg">No EQ curve yet for this track — background analysis pending</div>
                      {/if}
                      <!-- Chart -->
                      <VocalEqChart
                        mixCurve={mixCurve}
                        refCurve={refCurve}
                        mixLabel={mixCurveData?.label ?? ''}
                        refLabel={refCurveData?.label ?? ''}
                      />
                      <!-- Credits (when a ref track is selected and has credits) -->
                      {#if selectedRefTrack?.credits}
                        <div class="ref-credits">
                          {#if selectedRefTrack.credits.producers?.length}
                            <div class="credit-row">
                              <span class="credit-label">Produced</span>
                              <span class="credit-val">{selectedRefTrack.credits.producers.join(', ')}</span>
                            </div>
                          {/if}
                          {#if selectedRefTrack.credits.mixers?.length}
                            <div class="credit-row">
                              <span class="credit-label">Mixed</span>
                              <span class="credit-val">{selectedRefTrack.credits.mixers.join(', ')}</span>
                            </div>
                          {/if}
                          {#if selectedRefTrack.credits.masterers?.length}
                            <div class="credit-row">
                              <span class="credit-label">Mastered</span>
                              <span class="credit-val">{selectedRefTrack.credits.masterers.join(', ')}</span>
                            </div>
                          {/if}
                        </div>
                      {/if}

                      <!-- Mozart Insight -->
                      {#if mozartInsightLoading[song.id]}
                        <div class="mz-loading">Mozart analyzing...</div>
                      {:else if mozartInsight[song.id]}
                        {@const mz = mozartInsight[song.id]}
                        <div class="mz-insight">
                          {#if mz.strategic?.length}
                            <div class="mz-section">
                              <div class="mz-label">STRATEGIC CONTEXT</div>
                              {#each mz.strategic as point}
                                <div class="mz-point">{point}</div>
                              {/each}
                            </div>
                          {/if}
                          {#if mz.creative?.length}
                            <div class="mz-section">
                              <div class="mz-label">CREATIVE DIRECTION</div>
                              {#each mz.creative as point}
                                <div class="mz-point">{point}</div>
                              {/each}
                            </div>
                          {/if}
                          {#if mz.next_step}
                            <div class="mz-section">
                              <div class="mz-label">NEXT STEP</div>
                              <div class="mz-next">{mz.next_step}</div>
                            </div>
                          {/if}
                        </div>
                      {/if}

                      <!-- Status -->
                      {#if vocalEqStatus[song.id] === 'separating'}
                        <div class="vocal-status">⏳ Separating stems… (60–90s)</div>
                      {:else if vocalEqStatus[song.id] === 'error'}
                        <div class="vocal-status err">✗ Analysis failed — try again</div>
                      {/if}

                      <!-- Action row -->
                      <div class="vocal-eq-actions">
                        <div style="display:flex;gap:6px;align-items:center">
                          <button class="vocal-btn" disabled={vocalEqStatus[song.id] === 'separating'}
                            onclick={() => analyzeMyVocal(song)}>
                            {vocalEqStatus[song.id] === 'separating' ? 'Analyzing…' : 'Analyze My Stems'}
                          </button>
                          {#if vocalEqStatus[song.id] === 'separating'}
                            <button class="vocal-btn" style="font-size:9px;color:#555;border-color:#252525"
                              onclick={() => { vocalEqStatus = { ...vocalEqStatus, [song.id]: null } }}>
                              Reset
                            </button>
                          {/if}
                        </div>
                        <div class="vocal-mozart-wrap">
                          <button class="vocal-mozart-toggle {mozartAnalyzeOpen[song.id] ? 'active' : ''}"
                            onclick={() => { mozartAnalyzeOpen[song.id] = !mozartAnalyzeOpen[song.id]; mozartAnalyzeOpen = { ...mozartAnalyzeOpen } }}>
                            + Add Reference
                          </button>
                          {#if mozartAnalyzeOpen[song.id]}
                            <div class="vocal-mozart-panel">
                              <input class="vocal-ref-inp" type="text"
                                placeholder="Artist · Title or Spotify URL…"
                                value={mozartTrackQuery[song.id] || ''}
                                oninput={e => { mozartTrackQuery[song.id] = e.currentTarget.value; mozartTrackQuery = { ...mozartTrackQuery } }}
                                onkeydown={e => e.key === 'Enter' && runMozartAnalysis(song)} />
                              <button class="vocal-btn vocal-btn-ref"
                                disabled={mozartAnalysis[song.id]?.loading || !!refLoading || !mozartTrackQuery[song.id]}
                                onclick={() => runMozartAnalysis(song)}>
                                {mozartAnalysis[song.id]?.loading ? 'Fetching…' : 'Analyze'}
                              </button>
                            </div>
                            {#if mozartAnalysis[song.id]?.error}
                              <div class="vocal-mozart-err">{mozartAnalysis[song.id].error}</div>
                            {/if}
                          {/if}
                        </div>
                      </div>

                      <!-- Comparison results -->
                      {#if cmp}
                        <div class="eq-match-score">Vocals match: <span class="{cmp.match_score >= 70 ? 'eq-match-good' : cmp.match_score >= 40 ? 'eq-match-mid' : 'eq-match-low'}">{cmp.match_score}%</span></div>
                        {#if cmp.instructions?.length}
                          <div class="eq-instructions">
                            {#each cmp.instructions as inst}
                              <div class="eq-inst {inst.action === 'BOOST' ? 'boost' : 'cut'}">
                                <span class="eq-inst-action">{inst.action}</span>
                                <span class="eq-inst-db">{inst.action === 'BOOST' ? '+' : '-'}{inst.amount}dB</span>
                                <span class="eq-inst-band">{inst.freqLabel}</span>
                                <span class="eq-inst-reason">{inst.reason}</span>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {/if}

                      <!-- Curve list -->
                      {#if refCurves.length || mixCurves.length}
                        <div class="eq-curve-list">
                          {#each refCurves as ref, i}
                            <div class="eq-curve-item eq-curve-ref" style="color: {['rgba(201,168,76,.7)','rgba(76,175,130,.7)','rgba(74,159,212,.7)'][i] || 'rgba(201,168,76,.7)'}">● {ref.label || 'Reference ' + (i+1)}</div>
                          {/each}
                          {#each mixCurves as mix}
                            <div class="eq-curve-item eq-curve-mix">● My Mix ({new Date(mix.created_at).toLocaleDateString()})</div>
                          {/each}
                        </div>
                      {/if}

                      <!-- TRACK ANALYSIS sub-section -->
                      {#if latestA}
                        <button class="az-section-hdr" onclick={() => toggleAnalyzerSection(song.id, 'track')}>
                          <span>TRACK ANALYSIS</span><span class="az-arr {ao.track?'open':''}">▶</span>
                        </button>
                        {#if ao.track}
                          <div class="az-body">
                            <div class="az-grid">
                              {#each [['BPM', latestA.bpm ? Math.round(latestA.bpm) : null], ['Key', latestA.key ? latestA.key + ' ' + (latestA.scale||'') : null], ['Camelot', latestA.camelot], ['LUFS', latestA.loudness_lufs], ['LRA', latestA.loudness_range], ['Energy', latestA.energy != null ? Math.round(latestA.energy*100)+'%' : null], ['Dance', latestA.danceability != null ? Math.round(latestA.danceability*100)+'%' : null], ['Valence', latestA.valence != null ? Math.round(latestA.valence*100)+'%' : null], ['Brightness', latestA.brightness != null ? Math.round(latestA.brightness*100)+'%' : null], ['Bass', latestA.bass_energy != null ? Math.round(latestA.bass_energy*100)+'%' : null], ['Warmth', latestA.warmth != null ? Math.round(latestA.warmth*100)+'%' : null], ['Harmonic', latestA.harmonic_complexity != null ? latestA.harmonic_complexity.toFixed(2) : null], ['Dynamic', latestA.dynamic_complexity != null ? latestA.dynamic_complexity.toFixed(2) : null], ['Vocal Root', latestA.vocal_root_note ? latestA.vocal_root_note + (latestA.vocal_octave != null ? latestA.vocal_octave : '') : null]] as [label, val]}
                                {#if val != null}
                                  <div class="az-stat"><span class="az-label">{label}</span><span class="az-val">{val}</span></div>
                                {/if}
                              {/each}
                            </div>
                            {#if latestA.arc_contrast != null}
                              <div class="az-arc-meta">arc peak: seg {latestA.arc_peak_segment} · contrast: {latestA.arc_contrast?.toFixed(2)} · buildup: {latestA.arc_buildup >= 0 ? '+' : ''}{latestA.arc_buildup?.toFixed(2)}</div>
                            {/if}
                          </div>
                        {/if}
                      {/if}

                      <!-- SUCCESS MATCH sub-section -->
                      <button class="az-section-hdr" onclick={() => toggleAnalyzerSection(song.id, 'match')}>
                        <span>SUCCESS MATCH</span><span class="az-arr {ao.match?'open':''}">▶</span>
                      </button>
                      {#if ao.match}
                        <div class="az-body">
                          {#if successMatchLoading[String(song.id)]}
                            <div class="az-loading">Comparing to references…</div>
                          {:else if successMatch[String(song.id)]?.matchScore != null}
                            {@const sm = successMatch[String(song.id)]}
                            <div class="az-score-row">
                              <span class="az-score" style="color:{sm.matchScore>=70?'#4caf82':sm.matchScore>=45?'#e8a838':'#e05a4a'}">{sm.matchScore}%</span>
                              <span class="az-score-label">match vs your {sm.pattern?.sample_count || '?'} reference tracks</span>
                            </div>
                            {#if sm.gaps?.length}
                              <div class="az-gaps-title">TOP GAPS</div>
                              {#each sm.gaps.slice(0,3) as gap}
                                <div class="az-gap-row">
                                  <span class="az-gap-label">{gap.label}</span>
                                  <span class="az-gap-val">you: {gap.value != null ? (typeof gap.value === 'number' ? gap.value.toFixed(2) : gap.value) : '?'}</span>
                                  <span class="az-gap-target">target: {gap.target}</span>
                                  <span class="az-gap-pct" style="color:#e05a4a">{gap.match}%</span>
                                </div>
                              {/each}
                            {/if}
                            {#if sm.strengths?.length}
                              <div class="az-gaps-title" style="color:#4caf82;margin-top:6px">STRENGTHS</div>
                              {#each sm.strengths.slice(0,3) as s}
                                <div class="az-gap-row"><span class="az-gap-label">{s.label}</span><span class="az-gap-pct" style="color:#4caf82">{s.match}% ✓</span></div>
                              {/each}
                            {/if}
                          {:else if successMatch[String(song.id)]?.error}
                            <div class="az-loading">{successMatch[String(song.id)].error}</div>
                          {:else}
                            <div class="az-loading">No analysis data — analyze this version first.</div>
                          {/if}
                        </div>
                      {/if}

                      <!-- EMOTIONAL ARC sub-section -->
                      {#if latestA?.emotional_arc?.length}
                        <button class="az-section-hdr" onclick={() => toggleAnalyzerSection(song.id, 'arc')}>
                          <span>EMOTIONAL ARC</span><span class="az-arr {ao.arc?'open':''}">▶</span>
                        </button>
                        {#if ao.arc}
                          {@const arc = latestA.emotional_arc}
                          {@const maxE = Math.max(...arc.map(s=>s.energy), 0.01)}
                          <div class="az-body">
                            <svg viewBox="0 0 520 80" class="arc-svg">
                              {#each arc as seg, i}
                                {@const x = i * (520/arc.length) + 2}
                                {@const barW = (520/arc.length) - 4}
                                {@const barH = Math.round((seg.energy/maxE)*60)}
                                <rect x={x} y={76-barH} width={barW} height={barH}
                                  fill="rgba(201,168,76,{0.3 + seg.energy*0.5})" rx="1" />
                                <line x1={x} y1={76-Math.round(seg.brightness*60)} x2={x+barW} y2={76-Math.round(seg.brightness*60)}
                                  stroke="#4caf82" stroke-width="1.5" opacity="0.7" />
                              {/each}
                              <text x="2" y="78" font-size="7" fill="#333" font-family="Space Mono, monospace">INTRO</text>
                              <text x="500" y="78" font-size="7" fill="#333" font-family="Space Mono, monospace" text-anchor="end">OUTRO</text>
                            </svg>
                            <div class="az-arc-legend">
                              <span style="color:rgba(201,168,76,.8)">■ energy</span>
                              <span style="color:#4caf82">— brightness</span>
                              {#if latestA.arc_peak_segment}<span>peak: seg {latestA.arc_peak_segment}</span>{/if}
                              {#if latestA.arc_contrast != null}<span>contrast: {latestA.arc_contrast.toFixed(2)}</span>{/if}
                            </div>
                          </div>
                        {/if}
                      {/if}

                      <!-- FEEDBACK HISTORY sub-section -->
                      <button class="az-section-hdr" onclick={() => toggleAnalyzerSection(song.id, 'feedback')}>
                        <span>FEEDBACK HISTORY</span><span class="az-arr {ao.feedback?'open':''}">▶</span>
                      </button>
                      {#if ao.feedback}
                        <div class="az-body">
                          {#if feedbackLoading[String(song.id)]}
                            <div class="az-loading">Loading feedback patterns…</div>
                          {:else if feedbackInsights[String(song.id)]?.history?.length}
                            {@const fi = feedbackInsights[String(song.id)]}
                            <div class="az-history-total">{fi.total} feedback items logged</div>
                            {#each fi.history as h}
                              <div class="az-feedback-row">
                                <span class="az-fb-type">{h.type.replace(/_/g,' ')}</span>
                                <span class="az-fb-count">{h.count}×</span>
                                <div class="az-fb-bar"><div class="az-fb-fill" style="width:{h.pct}%"></div></div>
                                <span class="az-fb-pct">{h.pct}%</span>
                              </div>
                            {/each}
                          {:else}
                            <div class="az-loading">No feedback patterns yet — add feedback to versions.</div>
                          {/if}
                        </div>
                      {/if}

                      <!-- TREND CONTEXT sub-section -->
                      <button class="az-section-hdr" onclick={() => toggleAnalyzerSection(song.id, 'trend')}>
                        <span>TREND CONTEXT</span><span class="az-arr {ao.trend?'open':''}">▶</span>
                      </button>
                      {#if ao.trend}
                        <div class="az-body">
                          {#if trendLoading}
                            <div class="az-loading">Loading chart velocity…</div>
                          {:else if trendVelocity?.rising?.length || trendVelocity?.falling?.length}
                            {#if trendVelocity.rising?.length}
                              <div class="az-gaps-title" style="color:#4caf82">RISING ↑</div>
                              {#each trendVelocity.rising.slice(0,5) as t}
                                <div class="az-trend-row"><span class="az-trend-name">{t.artist} — {t.title}</span><span class="az-trend-vel" style="color:#4caf82">+{Math.round(t.velocity)}/day</span></div>
                              {/each}
                            {/if}
                            {#if trendVelocity.falling?.length}
                              <div class="az-gaps-title" style="color:#e05a4a;margin-top:6px">FALLING ↓</div>
                              {#each trendVelocity.falling.slice(0,3) as t}
                                <div class="az-trend-row"><span class="az-trend-name">{t.artist} — {t.title}</span><span class="az-trend-vel" style="color:#e05a4a">{Math.round(t.velocity)}/day</span></div>
                              {/each}
                            {/if}
                          {:else}
                            <div class="az-loading">No chart history yet — runs automatically with morning briefing.</div>
                          {/if}
                        </div>
                      {/if}

                    </div>
                  {/if}
                </div>

                <!-- Release checklist -->
                {#if releasedSongIds.includes(song.id) || releasedSongIds.includes(song.code) || wd.current_stage === 'mastering' || wd.current_stage === 'stems'}
                  {@const checklist = wd.release_checklist || {}}
                  {@const doneCount = RELEASE_CHECKLIST.filter(i => checklist[i.id]).length}
                  <div class="release-checklist">
                    <div class="rl-title">RELEASE CHECKLIST
                      <span class="rl-progress">{doneCount}/{RELEASE_CHECKLIST.length}</span>
                    </div>
                    {#each RELEASE_CHECKLIST as item}
                      <label class="rl-item {checklist[item.id] ? 'done' : ''}">
                        <input type="checkbox" checked={!!checklist[item.id]}
                          onchange={e => toggleReleaseCheck(song, item.id, e.currentTarget.checked)} />
                        <span>{item.label}</span>
                      </label>
                    {/each}
                  </div>
                {/if}

                <!-- Song footer: Move to Demos | Send to Artist (hidden on prod/mix) | Delete -->
                <div class="song-footer-row">
                  <button class="sfooter-btn move" onclick={() => moveSongToDemo(song)}>← Move to Demos</button>
                  {#if wd.current_stage !== 'production' && wd.current_stage !== 'mixing' && wd.current_stage !== 'mastering' && wd.current_stage !== 'stems'}
                    <button class="sfooter-btn send {wd.versions?.length && wd.versions.find(v=>v.id===wd.active_version_id)?.sent_to_artist ? 'sent' : ''}"
                      onclick={() => { const v = wd.versions?.find(v=>v.id===wd.active_version_id) || wd.versions?.[wd.versions.length-1]; if(v) sendToArtist(song,v.id) }}>
                      ✉ Send to Artist
                    </button>
                  {/if}
                  <button class="sfooter-btn del" onclick={() => deleteSong(song)}>Delete Song</button>
                </div>

              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  </div>

  <!-- ── RIGHT ───────────────────────────────────────────────── -->
  <div class="right-col">

    <!-- Timer -->
    <div class="timer-block">
      <div class="timer-presets">
        {#each TIMER_PRESETS as p}
          <button class="timer-preset-btn {timerPreset===p.sec?'on':''}"
            onclick={() => { if (!timerRunning) { timerPreset=p.sec; timerTarget=0; timerSec=0 } }}>
            {p.label}
          </button>
        {/each}
        <button class="timer-preset-btn nolog-btn {noLog?'on':''}"
          onclick={() => noLog = !noLog}
          title="Run timer without logging to session log">
          NOLOG
        </button>
      </div>
      <div class="timer-row">
        <span class="timer-disp {timerTarget>0 && timerTarget-timerSec<=60 && timerRunning ? 'urgent' : ''}">{timerDisplay}</span>
        <div class="timer-btns">
          {#if !timerRunning}
            <button class="btn-ghost-sm" onclick={startTimer}>Start</button>
          {:else}
            <button class="btn-ghost-sm" onclick={pauseTimer}>Pause</button>
          {/if}
          <button class="btn-ghost-sm" onclick={resetTimer}>Reset</button>
        </div>
      </div>
      {#if noLog}
        <div class="session-acc" style="color:#e05a4a">NOLOG — timer runs without logging</div>
      {:else if sessionLog.length > 0}
        <div class="session-acc">
          {Math.floor(sessionLog.reduce((s,e)=>s+e.seconds,0)/60)}min logged this session
        </div>
      {/if}
      {#if timerDoneMsg}
        <div class="timer-done-banner">{timerDoneMsg}</div>
      {/if}
    </div>

    <!-- Checklist 70% -->
    <div class="right-section">
      <button class="right-section-head" onclick={() => sanityOpen=!sanityOpen}>
        <span class="right-section-title">CHECKLIST 70%</span>
        <span class="right-arr {sanityOpen?'open':''}">▶</span>
      </button>
      {#if sanityOpen}
        <div class="checklist-panel">
          <div class="checklist-title">FINISHING QUESTIONS</div>
          <div class="checklist-subtitle">Mozart-generated · {finishingChecklist.length} questions</div>
          {#if finishingChecklist.length === 0}
            <div class="checklist-empty">Run /rebuild-finishing-checklist to generate</div>
          {:else}
            {@const phases = [...new Set(finishingChecklist.map(i => i.phase))]}
            {#each phases as phase}
              <div class="checklist-phase-group">
                <div class="checklist-phase-label">{phase}</div>
                {#each finishingChecklist.filter(i => i.phase === phase) as item}
                  <div class="checklist-item {checkedItems[item.question] ? 'done' : ''}">
                    <input type="checkbox"
                      checked={checkedItems[item.question] || false}
                      onchange={() => { checkedItems[item.question] = !checkedItems[item.question]; checkedItems = { ...checkedItems } }} />
                    <div class="checklist-content">
                      <div class="checklist-q">{item.question}</div>
                      {#if item.why}
                        <div class="checklist-why">{item.why}</div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
            <button class="reset-checklist-btn" onclick={() => checkedItems = {}}>Reset</button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Tips -->
    <div class="right-section">
      <button class="right-section-head" onclick={() => tipsOpen=!tipsOpen}>
        <span class="right-section-title">TIPS</span>
        <span class="right-arr {tipsOpen?'open':''}">▶</span>
      </button>
      {#if tipsOpen}
        {#each tipSections as sec (sec.id)}
        <div class="tip-sec-block">
          <button class="tip-sec-head" onclick={async () => {
            if (openTipSectionId === sec.id) {
              await saveActiveTips()
              openTipSectionId = null
              activeTipSectionId = null
              activeTipText = ''
            } else {
              await saveActiveTips()
              openTipSectionId = sec.id
              activeTipSectionId = sec.id
              activeTipText = (sec.work_tips||[]).sort((a,b)=>a.position-b.position).map(t=>t.tip).join('\n')
            }
          }}>
            <span>{sec.label}</span>
            <span class="arr-sm {openTipSectionId===sec.id?'open':''}">▶</span>
          </button>
          {#if openTipSectionId === sec.id}
            <textarea class="tips-edit-ta tips-active-ta"
              use:setVal={activeTipText}
              onblur={async e => {
                const text = e.target.value
                const sectionId = activeTipSectionId
                const savedSec = tipSections.find(s => s.id === sectionId)
                if (!savedSec) return
                const lines = text.split('\n').map(l => l.trimEnd())
                while (lines.length && lines[lines.length-1] === '') lines.pop()
                const tips = (savedSec.work_tips||[]).sort((a,b)=>a.position-b.position)
                for (let i = 0; i < lines.length; i++) {
                  if (tips[i]) {
                    if (tips[i].tip !== lines[i] || tips[i].position !== i)
                      await supabase.from('work_tips').update({ tip: lines[i], position: i }).eq('id', tips[i].id)
                  } else {
                    await supabase.from('work_tips').insert({ tip: lines[i], section_id: sectionId, position: i })
                  }
                }
                for (let i = lines.length; i < tips.length; i++) await supabase.from('work_tips').delete().eq('id', tips[i].id)
                const { data } = await supabase.from('work_tip_sections').select('*, work_tips(*)').eq('id', sectionId).single()
                if (data) {
                  tipSections = tipSections.map(s => s.id === data.id ? data : s)
                  activeTipText = (data.work_tips||[]).sort((a,b)=>a.position-b.position).map(t=>t.tip).join('\n')
                }
              }}></textarea>
          {/if}
        </div>
      {/each}
      {/if}
    </div>

    <!-- Oblique card -->
    {#if currentCard}
      <div class="card-block">
        <div class="card-label">// oblique strategy</div>
        <div class="card-text">"{currentCard.text}"</div>
        <button class="btn-ghost-sm" onclick={() => cardIdx++}>Next →</button>
      </div>
    {/if}

    <!-- Tasks -->
    <div class="right-section">
      <div class="right-section-title-plain">TASKS</div>
      {#if selectedProject}
        <div class="dt-body">
          <!-- Row 1: song + stage pickers -->
          <div class="task-add-row">
            <select class="add-inp-sm" bind:value={newTaskSong}>
              <option value="">— Song (optional) —</option>
              {#each songs.filter(s => s.project_id === selectedProjectId) as s}
                <option value={s.id}>{s.title || s.code}</option>
              {/each}
            </select>
            <select class="add-inp-sm" bind:value={newTaskStage}>
              <option value="">— Stage —</option>
              {#each PROJ_SONG_STAGES as st}
                <option value={st.id}>{st.label}</option>
              {/each}
            </select>
          </div>
          <!-- Row 2: task label -->
          <div class="task-add-row">
            <input class="add-inp-sm" style="flex:1" bind:value={newTaskLabel}
              placeholder="Task description (optional if stage selected)..."
              onkeydown={e=>e.key==='Enter'&&addTask()} />
          </div>
          <!-- Row 3: date + time + add -->
          <div class="task-add-row">
            <input class="add-inp-sm date-inp" type="date" bind:value={newTaskDate} />
            <input class="add-inp-sm time-inp" type="time" bind:value={newTaskTime} />
            <button class="add-btn-sm" onclick={addTask}>+ Add</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Mozart -->
    <div class="mozart-block">
      <div class="mozart-title">ASK MOZART
        {#if aiMessages.length > 0}
          <button class="clear-chat" onclick={() => aiMessages = []}>Clear</button>
        {/if}
        {#if expandedSong && (workData(expandedSong).versions || []).filter(v => v.version_type === 'mixing').length >= 2}
          <button class="clear-chat" onclick={() => generateNarrative(expandedSong)}>Learn from versions</button>
        {/if}
      </div>
      <div class="chat-input-row">
        <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..." onkeydown={e=>e.key==='Enter'&&sendAI()} />
        <button class="btn-gold-sm" onclick={() => sendAI()}>Ask</button>
      </div>
      <div class="chat-out" bind:this={chatContainer}>
        {#each aiMessages as msg}
          <div class="chat-msg {msg.role}">
            <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
            {#if msg.role === 'assistant'}
              <div class="chat-text">{@html formatMozartOutput(msg.content)}</div>
            {:else}
              <div class="chat-text">{msg.content}</div>
            {/if}
          </div>
        {/each}
        {#if aiLoading}<div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>{/if}
      </div>
    </div>

  </div>
</div>
{/if}

<!-- Create project modal -->
{#if showCreateProject}
  <div class="modal-bg" onclick={() => showCreateProject=false}>
    <div class="modal" onclick={e=>e.stopPropagation()}>
      <div class="modal-title">New Project</div>
      <div class="field">
        <label>ARTIST</label>
        <input class="inp-md" bind:value={newProjArtist} placeholder="Artist name..." onkeydown={e=>e.key==='Enter'&&createProject()} />
      </div>
      <div class="field" style="margin-top:10px">
        <label>PROJECT NAME</label>
        <input class="inp-md" bind:value={newProjName} placeholder="Project name..." onkeydown={e=>e.key==='Enter'&&createProject()} />
      </div>
      <div class="field" style="margin-top:10px">
        <label>COLOR</label>
        <div class="color-picker-row">
          {#each COLORS as c}
            <button class="color-dot-lg {newProjColor===c?'active':''}" style="background:{c}" onclick={() => newProjColor=c}></button>
          {/each}
        </div>
      </div>
      <div class="modal-btns" style="margin-top:14px">
        <button class="btn-gold-full" onclick={createProject}>Create Project</button>
        <button class="modal-cancel" onclick={() => showCreateProject=false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 230px 1fr 500px; gap: 0; min-height: calc(100vh - 60px); }
  .empty { font-family: 'Space Mono', monospace; font-size: 14px; color: #555; padding: 32px 0; text-align: center; }
  .empty-sm { font-family: 'Space Mono', monospace; font-size: 13px; color: #444; padding: 4px 0; }

  /* LEFT */
  .left-col { border-right: 1px solid #1c1c1c; padding-bottom: 32px; }
  .left-top { display: flex; align-items: center; justify-content: space-between; padding: 0 10px 12px 14px; border-bottom: 1px solid #1c1c1c; margin-bottom: 6px; }
  .left-header { font-family: 'Space Mono', monospace; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .btn-new-proj { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; padding: 2px 8px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .btn-new-proj:hover { border-color: #c9a84c; color: #c9a84c; }
  .proj-item { display: flex; align-items: stretch; }
  .proj-btn { display: flex; align-items: center; gap: 9px; padding: 11px 12px; background: transparent; border: none; cursor: pointer; flex: 1; text-align: left; border-left: 3px solid transparent; transition: all .15s; }
  .proj-btn:hover { background: #111; }
  .proj-item.sel .proj-btn { background: #111; border-left-color: #c9a84c; }
  .proj-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .proj-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .proj-name { font-size: 11px; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proj-item.sel .proj-name { color: #7a6230; }
  .proj-artist { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #9e9690; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proj-item.sel .proj-artist { color: #c9a84c; }
  .proj-counts { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .proj-count { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; }
  .proj-dl { font-family: 'Space Mono', monospace; font-size: 10px; color: #7a6230; }
  .proj-actions { display: flex; align-items: stretch; opacity: 0; transition: opacity .15s; }
  .proj-item:hover .proj-actions { opacity: 1; }
  .proj-action-btn { background: transparent; border: none; color: #444; font-size: 12px; cursor: pointer; padding: 0 7px; }
  .proj-action-btn:hover { color: #9e9690; }
  .proj-action-btn.del:hover { color: #e05a4a; }

  /* MIDDLE */
  .mid-col { padding: 0 28px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
  .mid-header { display: flex; align-items: center; gap: 12px; padding: 0 0 12px; border-bottom: 1px solid #1c1c1c; margin-bottom: 4px; flex-wrap: wrap; }
  .undo-tab-btn { margin-left: auto; font-family: 'Space Mono', monospace; font-size: 9px; background: transparent; border: 1px solid #303030; color: #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; transition: all .15s; }
  .undo-tab-btn:not(:disabled):hover { border-color: #c9a84c; color: #c9a84c; }
  .undo-tab-btn:disabled { opacity: .3; cursor: default; }
  .color-picker-wrap { display: flex; gap: 5px; align-items: center; }
  .color-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; flex-shrink: 0; padding: 0; transition: transform .1s; }
  .color-dot.active { border-color: #f5f1ea; transform: scale(1.2); }
  .color-dot:hover { transform: scale(1.15); }
  .mid-title-wrap { display: flex; flex-direction: column; gap: 2px; }
  .mid-title-input { font-family: 'Space Mono', monospace; font-size: 18px; font-weight: 700; letter-spacing: .1em; color: #f5f1ea; background: transparent; border: none; border-bottom: 1px solid transparent; outline: none; padding: 1px 0; cursor: text; width: 200px; }
  .mid-title-input:hover { border-bottom-color: #303030; }
  .mid-title-input:focus { border-bottom-color: rgba(201,168,76,.5); }
  .mid-title-input::placeholder { color: #333; }
  .mid-artist-input { font-family: 'Space Mono', monospace; font-size: 13px; color: #555; background: transparent; border: none; border-bottom: 1px solid transparent; outline: none; padding: 1px 0; cursor: text; width: 200px; }
  .mid-artist-input:hover { border-bottom-color: #303030; }
  .mid-artist-input:focus { border-bottom-color: rgba(201,168,76,.4); }
  .mid-artist-input::placeholder { color: #333; }

  .ref-manager { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
  .ref-add-row { display: flex; gap: 8px; align-items: center; padding: 2px 8px; border: 1px dashed #252525; border-radius: 3px; transition: border-color .15s; background: #0d0d0d; }
  .ref-add-row.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .ref-inp { flex: 1; background: transparent; border: none; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 3px 4px; outline: none; }
  .ref-inp::placeholder { color: #333; }
  .refs-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: #111; border: 1px solid #1c1c1c; border-radius: 3px; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; color: #555; width: 100%; }
  .refs-toggle:hover { border-color: #303030; color: #9e9690; }
  .refs-arr { font-size: 9px; transition: transform .2s; }
  .refs-arr.open { transform: rotate(90deg); }
  .refs-list { display: flex; flex-direction: column; gap: 3px; }
  .ref-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #111; border: 1px solid #1c1c1c; border-radius: 3px; }
  .ref-link-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #4a9fd4; background: transparent; border: none; cursor: pointer; padding: 0; flex-shrink: 0; white-space: nowrap; }
  .ref-link-btn:hover { text-decoration: underline; }
  .refs-inline { display: flex; flex-wrap: wrap; gap: 6px; }
  .ref-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; }
  .ref-chip-name { font-size: 13px; color: #cec9c1; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-name-txt { font-size: 13px; color: #cec9c1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-url-txt { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spotidown-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 3px 7px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .spotidown-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .spotify-play-btn-sm { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 9px; background: rgba(30,215,96,.08); border: 1px solid rgba(30,215,96,.4); color: #1ed760; border-radius: 2px; cursor: pointer; flex-shrink: 0; font-weight: 700; }
  .spotify-play-btn-sm:hover { background: rgba(30,215,96,.15); }
  .vocal-btn { font-size: 11px; padding: 2px 5px; background: transparent; border: 1px solid #303030; border-radius: 2px; cursor: pointer; flex-shrink: 0; line-height: 1; }
  .vocal-btn:hover { border-color: rgba(201,168,76,.4); }
  .ref-del { background: transparent; border: none; color: #333; font-size: 16px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .ref-del:hover { color: #e05a4a; }
  .ref-empty { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; padding: 4px 0; }
  .info-tabs { display: flex; border-bottom: 1px solid #1c1c1c; }
  .info-tab { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 9px 14px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #444; cursor: pointer; margin-bottom: -1px; transition: color .15s; }
  .info-tab:hover { color: #9e9690; }
  .info-tab.on { color: #c9a84c; border-bottom-color: #c9a84c; }
  .meta-block { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .meta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .meta-field { display: flex; flex-direction: column; gap: 5px; }
  .meta-checks { display: flex; flex-direction: column; gap: 6px; }
  .meta-check-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; background: #111; border-radius: 3px; border: 1px solid #1c1c1c; }
  .meta-ckb { width: 16px; height: 16px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #4caf82; cursor: pointer; background: transparent; padding: 0; flex-shrink: 0; }
  .meta-ckb.on { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .meta-ck-label { font-family: 'Space Mono', monospace; font-size: 12px; color: #cec9c1; flex: 1; }
  .meta-check-row:has(.meta-ckb.on) .meta-ck-label { color: #4caf82; }
  .date-sm { width: 130px !important; flex-shrink: 0; font-size: 12px; padding: 4px 8px; flex-grow: 0; }
  .date-sm-song { width: 140px; font-size: 12px; padding: 4px 8px; }
  .release-date-label { font-family: "Space Mono", monospace; font-size: 12px; font-weight: 700; color: #c9a84c; flex-shrink: 0; }
  .release-ta { font-family: "DM Sans", sans-serif !important; font-size: 14px !important; font-weight: 300 !important; line-height: 1.7 !important; color: #9e9690 !important; }
  .meta-released-badge { font-family: "Space Mono", monospace; font-size: 10px; color: #4caf82; border: 1px solid rgba(76,175,130,.4); padding: 2px 7px; border-radius: 2px; }
  .proj-ta:focus { border-color: transparent; outline: none; box-shadow: inset 0 0 0 1px rgba(201,168,76,.3); }
  .ref-drop-wrap { position: relative; }
  .ref-drop-wrap.drag-over .ref-ta { box-shadow: inset 0 0 0 2px #c9a84c; background: rgba(201,168,76,.04); }
  .ref-ta { min-height: 80px; }
  .ref-drop-hint { position: absolute; bottom: 10px; right: 12px; font-family: 'Space Mono', monospace; font-size: 10px; color: #333; pointer-events: none; }

  /* Demo fields block */
  .demo-fields-block { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .song-meta-block { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid #1a1a1a; margin-bottom: 8px; }
  .song-meta-row1 { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
  .field-sm { flex: 0 0 auto; }
  .demo-fields-header { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); padding: 9px 14px; background: #111; border-bottom: 1px solid #1c1c1c; }
  .demo-row3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; padding: 12px 14px 0; }
  .demo-fields-block .field { padding: 0 14px 12px; }
  .demo-fields-block .field:first-child { padding-top: 0; }
  .inp-sm { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 4px 8px; outline: none; border-radius: 3px; width: 100%; }
  .inp-sm:focus { border-color: rgba(201,168,76,.5); }
  .tags-wrap { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { font-family: 'Space Mono', monospace; font-size: 12px; padding: 4px 9px; border-radius: 2px; background: rgba(201,168,76,.1); border: 1px solid rgba(201,168,76,.3); color: #c9a84c; display: flex; align-items: center; gap: 4px; }
  .tag-del { background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 14px; opacity: .6; }
  .tag-del:hover { opacity: 1; }
  .tag-inp { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 4px 9px; outline: none; border-radius: 3px; width: 130px; }
  .tag-genre-select { background: #1c1c1c; border: 1px solid #303030; color: #555; font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 6px; outline: none; border-radius: 3px; cursor: pointer; }
  .tag-genre-select:focus { border-color: rgba(201,168,76,.4); }
  .tag-genre-select option[disabled] { font-weight: 700; color: rgba(201,168,76,.75); background: #1c1c1c; }
  .tag-genre-select option:not([disabled]) { background: #141414; color: #cec9c1; }
  .refs-wrap { display: flex; flex-direction: column; gap: 6px; }
  .ref-row { display: flex; align-items: center; gap: 8px; }
  .ref-link { font-family: 'Space Mono', monospace; font-size: 12px; color: #4a9fd4; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-link:hover { text-decoration: underline; }
  .ref-add-row { display: flex; gap: 8px; align-items: center; }
  .drop-zone-sm { display: flex; align-items: center; gap: 9px; padding: 9px 10px; background: #080808; border: 1px dashed #252525; border-radius: 3px; min-height: 44px; transition: border-color .15s; }
  .drop-zone-sm.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .demo-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-top: 1px solid #1c1c1c; background: #080808; }
  .btn-move-demo { font-family: 'Space Mono', monospace; font-size: 11px; padding: 5px 12px; background: transparent; border: 1px solid rgba(74,159,212,.3); color: #4a9fd4; border-radius: 3px; cursor: pointer; }
  .btn-move-demo:hover { background: rgba(74,159,212,.08); }
  .btn-delete-song { font-family: 'Space Mono', monospace; font-size: 11px; padding: 5px 12px; background: transparent; border: 1px solid rgba(224,90,74,.3); color: #e05a4a; border-radius: 3px; cursor: pointer; }
  .btn-delete-song:hover { background: rgba(224,90,74,.08); }

  /* Song cards */
  .song-card { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .song-card.exp { border-color: rgba(201,168,76,.4); }
  .song-card.mastering { border-color: rgba(155,111,212,.4); }
  .song-head { display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: #1c1c1c; }
  .song-card.exp .song-head { background: #252525; }
  .song-head-left { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; cursor: pointer; overflow: hidden; }
  .song-head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; width: 420px; justify-content: flex-end; }
  .song-head-badges { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .song-player-slot { width: 240px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-start; }
  .reorder-btns { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
  .reorder-btn { font-size: 10px; padding: 2px 4px; background: transparent; border: none; color: #444; cursor: pointer; }
  .reorder-btn:hover { color: #c9a84c; }
  .song-info { display: flex; flex-direction: column; gap: 2px; min-width: 85px; cursor: pointer; }
  .song-code { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; color: #c9a84c; }
  .code-stars-row { display: flex; align-items: center; gap: 6px; }
  .stars { display: flex; gap: 1px; }
  .star { background: transparent; border: none; font-size: 11px; color: #2a2a2a; cursor: pointer; padding: 0; line-height: 1; }
  .star.on { color: #4caf82; }
  .star:hover { color: #4caf82; }
  .song-title-input { background: transparent; border: none; border-bottom: 1px solid transparent; color: #9e9690; font-size: 13px; font-family: 'DM Sans', sans-serif; padding: 1px 0; outline: none; width: 100%; cursor: text; }
  .song-title-input:hover { border-bottom-color: #303030; }
  .song-title-input:focus { border-bottom-color: rgba(201,168,76,.5); color: #cec9c1; }
  .song-title-input::placeholder { color: #333; }
  .stage-pills { display: flex; gap: 4px; cursor: pointer; align-items: center; flex-shrink: 0; }
  .stage-pill { width: 18px; height: 6px; border-radius: 2px; background: #252525; border: 1px solid #303030; flex-shrink: 0; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 2px; overflow: visible; }
  .stage-pill.done { background: #4caf82; border-color: #4caf82; }
  .stage-pill.active { background: rgba(201,168,76,.5); border-color: #c9a84c; }
  .stage-pill.stems-pill { cursor: pointer; }
  .stage-pill.stems-pill:hover { border-color: #c9a84c; }
  .sub-dot { width: 3px; height: 3px; border-radius: 50%; background: #444; flex-shrink: 0; margin-bottom: -6px; }
  .sub-dot.on { background: #c9a84c; }
  .prod-substeps { display: flex; gap: 20px; padding: 4px 0 8px; margin-bottom: 6px; }
  .prod-sub-row { display: flex; align-items: center; gap: 8px; }
  .prod-ckb { width: 17px; height: 17px; border: 1px solid #3c3c3c; border-radius: 2px; background: transparent; color: #4caf82; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; }
  .prod-ckb.done { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .prod-sub-label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: #555; }
  .prod-sub-label.done { color: #4caf82; }
  .stage-audio-drop { display: flex; align-items: center; gap: 10px; padding: 18px 14px; border: 1px dashed #252525; border-radius: 3px; background: #080808; transition: all .15s; margin-top: 2px; cursor: copy; min-height: 64px; }
  .stage-audio-drop.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .stage-audio-drop:hover { border-color: #303030; }
  .stage-audio-name { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .player-wrap-head { display: flex; align-items: center; gap: 4px; width: 100%; }
  .player-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: #4a9fd4; letter-spacing: .08em; flex-shrink: 0; }
  .version-badge { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 2px; border: 1px solid #303030; color: #555; flex-shrink: 0; }
  .version-badge.sent { color: #4caf82; border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.08); }
  .mastering-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 2px; color: #9b6fd4; border: 1px solid rgba(155,111,212,.4); background: rgba(155,111,212,.06); flex-shrink: 0; }
  .mini-player { height: 40px; width: 100%; accent-color: #c9a84c; }
  .audio-ref { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .audio-drop-sm { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; padding: 3px 8px; border: 1px dashed #303030; border-radius: 3px; cursor: copy; transition: border-color .15s; }
  .audio-drop-sm:hover, .audio-drop-sm.drag-over { border-color: #c9a84c; color: #c9a84c; }
  .song-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; cursor: pointer; }
  .stage-lbl-sm { font-family: 'Space Mono', monospace; font-size: 10px; color: #c9a84c; letter-spacing: .08em; }
  .song-prog { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; }
  .archive-song-btn { background: transparent; border: none; color: #333; font-size: 13px; cursor: pointer; padding: 0 3px; flex-shrink: 0; }
  .archive-song-btn:hover { color: #e05a4a; }
  .arr { font-size: 11px; color: #555; transition: transform .2s; flex-shrink: 0; cursor: pointer; font-family: 'Space Mono', monospace; }
  .arr.open { transform: rotate(90deg); }

  .song-body { padding: 16px; border-top: 1px solid #1c1c1c; display: flex; flex-direction: column; gap: 16px; background: #0a0a0a; }
  .stages-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid #1c1c1c; padding-bottom: 12px; }
  .stage-box { display: flex; align-items: center; gap: 5px; padding: 7px 11px; border: 1px solid #1c1c1c; border-radius: 3px; background: #111; transition: all .15s; }
  .stage-box:hover { border-color: #252525; background: #151515; }
  .stage-box.active { border-color: rgba(201,168,76,.5); background: rgba(201,168,76,.06); }
  .stage-box.done { opacity: .45; }
  .stage-ckb { width: 15px; height: 15px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #4caf82; cursor: pointer; background: transparent; padding: 0; flex-shrink: 0; }
  .stage-box.done .stage-ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .stage-name-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #555; cursor: pointer; background: transparent; border: none; padding: 0; }
  .stage-box:hover .stage-name-btn { color: #9e9690; }
  .stage-box.active .stage-name-btn { color: #c9a84c; }
  .stage-box.done .stage-name-btn { color: #4caf82; }
  .sent-ckb { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .06em; padding: 2px 6px; background: transparent; border: 1px solid #303030; color: #444; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .sent-ckb.sent { color: #4caf82; border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.08); }
  .btn-mastering { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 6px 11px; background: transparent; border: 1px solid rgba(155,111,212,.4); color: #9b6fd4; border-radius: 3px; cursor: pointer; margin-left: auto; }
  .btn-mastering.active { background: rgba(155,111,212,.1); }
  .btn-mastering:hover { background: rgba(155,111,212,.08); }
  .stems-ckb-wrap { display: flex; align-items: center; gap: 6px; cursor: pointer; flex-shrink: 0; }
  .stems-ckb-wrap .stage-ckb.on { background: rgba(76,175,130,.15); border-color: #4caf82; color: #4caf82; }
  .stems-label { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .1em; color: #9e9690; }

  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.65); }
  .ta { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 7px 10px; outline: none; resize: none; border-radius: 3px; width: 100%; min-height: 32px; line-height: 1.6; overflow: hidden; }
  .ta:focus { border-color: rgba(201,168,76,.4); }
  .ta-auto { min-height: 32px; }
  .lyrics-ta { min-height: 80px; resize: vertical; overflow: auto; }
  .lyrics-block { border: 1px solid #1c1c1c; border-radius: 3px; overflow: hidden; margin-bottom: 16px; }
  .prod-section-divider { height: 1px; background: linear-gradient(to right, rgba(201,168,76,.6), rgba(201,168,76,.15), transparent); margin: 4px 0 6px; }
  .lyrics-toggle { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: #111; border: none; cursor: pointer; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; color: rgba(201,168,76,.75); }
  .lyrics-toggle:hover { background: #1c1c1c; }
  .lyrics-preview { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #555; font-weight: 300; letter-spacing: 0; flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lyrics-arr { font-size: 9px; color: #555; transition: transform .2s; flex-shrink: 0; }
  .lyrics-arr.open { transform: rotate(90deg); }
  .lyrics-block .ta { border: none; border-top: 1px solid #1c1c1c; border-radius: 0; background: #0d0d0d; }
  .proj-ta { min-height: 75px; font-size: 13px; font-family: "DM Sans", sans-serif; font-weight: 300; line-height: 1.7; color: #cec9c1; }
  .proj-ta-sm { min-height: 55px; font-size: 13px; font-family: "DM Sans", sans-serif; font-weight: 300; line-height: 1.7; color: #cec9c1; }
  .trace-label { font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.5); letter-spacing: .1em; margin: 8px 0 4px; }
  .mono-ta { font-family: 'Space Mono', monospace !important; font-size: 13px !important; line-height: 1.7 !important; }
  .proj-info-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .proj-info-row:last-child { grid-template-columns: 1fr 1fr 1fr; }
  .ref-drop-wrap { position: relative; }
  .ref-drop-wrap.drag-over .ref-ta { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .ref-ta { min-height: 75px; }
  .label-hint { font-size: 10px; color: #444; letter-spacing: .05em; text-transform: none; font-weight: 300; }

  .versions-block { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .versions-header { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; background: #111; border-bottom: 1px solid #1c1c1c; }
  .versions-header label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; color: rgba(201,168,76,.75); }
  .version-tabs { display: flex; border-bottom: 1px solid #1c1c1c; }
  .vtab { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 8px 14px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #444; cursor: pointer; margin-bottom: -1px; transition: color .15s; }
  .vtab:hover { color: #9e9690; }
  .vtab.on { color: #c9a84c; border-bottom-color: #c9a84c; }
  .vtab.vtab-sent { color: #4caf82; }
  .vtab.vtab-sent.on { border-bottom-color: #4caf82; }
  .version-audio-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: #080808; border-bottom: 1px solid #1c1c1c; }
  .version-audio { display: flex; align-items: center; gap: 9px; padding: 9px 14px; background: #080808; border-bottom: 1px solid #1c1c1c; min-height: 48px; }
  .version-player { height: 28px; flex: 1; accent-color: #c9a84c; }
  .version-audio-name { font-family: 'Space Mono', monospace; font-size: 12px; color: #4caf82; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .version-audio-name.dim { color: #555; }
  .drop-hint { font-family: 'Space Mono', monospace; font-size: 13px; color: #333; flex: 1; text-align: center; }
  .drop-hint-sub { font-family: 'Space Mono', monospace; font-size: 10px; color: #252525; text-align: center; display: block; margin-top: 3px; }
  .drop-rehint { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; }
  .drop-alt-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; }
  .instr-block { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 0 14px; }
  .instr-filename { color: #4caf82 !important; font-family: 'Space Mono', monospace; font-size: 11px; }
  .instr-player-row { padding: 4px 0; }
  .instr-actions-row { display: flex; gap: 8px; padding-bottom: 10px; }
  .dual-drop-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 2px; align-items: start; }
  .dual-drop-col { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .dual-send-row-inner { display: flex; flex-direction: row; align-items: center; gap: 5px; min-width: 0; }
  .dual-drop-label { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: .1em; color: rgba(201,168,76,.45); }
  .stage-audio-drop.dual-drop { min-height: 72px; flex-direction: column; align-items: flex-start; justify-content: center; padding: 10px 14px; box-sizing: border-box; }
  .dual-send-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .dual-send-col { display: flex; flex-direction: column; gap: 5px; }
.dual-send-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 6px 12px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; transition: all .15s; }
  .dual-send-btn:hover { border-color: #4caf82; color: #4caf82; }
  .dual-send-btn.sent { border-color: rgba(76,175,130,.4); color: #4caf82; }
  .dual-send-btn:disabled { opacity: .3; cursor: not-allowed; }
  .dual-send-btn:disabled:hover { border-color: #303030; color: #9e9690; }
  .copy-dbx-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 5px 12px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; transition: all .15s; }
  .copy-dbx-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .drop-clear { background: transparent; border: none; color: #555; font-size: 18px; cursor: pointer; flex-shrink: 0; padding: 0; }
  .drop-clear:hover { color: #e05a4a; }
  .sent-flash { font-family: 'Space Mono', monospace; font-size: 13px; color: #4a9fd4; padding: 8px 14px; background: rgba(74,159,212,.08); border-bottom: 1px solid rgba(74,159,212,.2); }
  .copied-banner { font-family: 'Space Mono', monospace; font-size: 13px; color: #4caf82; padding: 8px 14px; background: rgba(76,175,130,.08); border-bottom: 1px solid rgba(76,175,130,.2); }
  .feedback-list { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; }
  .fb-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #0f0f0f; }
  .fb-row.fb-done { opacity: .38; }
  .ckb-sm { width: 15px; height: 15px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }
  .ckb-sm.gold { color: #c9a84c; }
  .fb-done .ckb-sm { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .fb-text { flex: 1; font-size: 13px; color: #cec9c1; }
  .fb-done .fb-text { text-decoration: line-through; color: #555; }
  .del-btn { background: transparent; border: none; color: #333; font-size: 16px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .fb-add-row { display: flex; gap: 7px; padding: 10px 14px; border-top: 1px solid #1c1c1c; }
  .add-inp { background: #111; border: 1px solid #252525; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 7px 11px; outline: none; border-radius: 3px; flex: 1; }
  .add-inp:focus { border-color: rgba(201,168,76,.4); }
  .add-inp::placeholder { color: #444; }
  .add-btn { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; padding: 7px 14px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .all-done-hint { font-family: 'Space Mono', monospace; font-size: 12px; color: #4caf82; padding: 7px 14px; text-align: center; opacity: .7; border-top: 1px solid #1c1c1c; }
  .version-notes-block { padding: 10px 14px; border-top: 1px solid #1c1c1c; display: flex; flex-direction: column; gap: 6px; }
  .version-analysis-row { display: flex; flex-direction: column; gap: 3px; padding: 6px 14px 8px; border-top: 1px solid #1a1a1a; }
  .analysis-line { font-family: 'Space Mono', monospace; font-size: 11px; color: #9e9690; letter-spacing: .04em; }
  .ver-progress-block { padding: 8px 14px 10px; border-top: 1px solid #1a1a1a; }
  .ver-progress-header { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: #c9a84c; letter-spacing: .08em; margin-bottom: 6px; }
  .ver-progress-table { display: flex; flex-direction: column; gap: 2px; }
  .vp-row { display: grid; grid-template-columns: 70px 60px 60px 60px; font-family: 'Space Mono', monospace; font-size: 8px; color: #555; }
  .vp-header-row { color: #404040; margin-bottom: 3px; }
  .vp-close { color: #4caf82; }
  .vp-far { color: #9e4c4c; }
  .vp-ref-count { font-family: 'Space Mono', monospace; font-size: 7px; color: #383838; margin-top: 5px; }
  .notes-ta { min-height: 70px; font-size: 14px; background: #0d0d0d; }
  .notes-drop-wrap { border-radius: 3px; transition: all .15s; }
  .notes-drop-wrap.pdf-drag-over { outline: 1px dashed rgba(201,168,76,.5); background: rgba(201,168,76,.03); }
  .send-to-artist-row { padding: 10px 14px; border-top: 1px solid #1c1c1c; }
  .work-log-section { padding: 8px 14px 10px; border-top: 1px solid #1a1a1a; margin-top: 4px; }
  .work-log-title { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-bottom: 5px; }
  .work-log-entry { display: flex; gap: 12px; align-items: center; padding: 2px 0; }
  .work-log-stage { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; text-transform: uppercase; letter-spacing: .06em; min-width: 80px; }
  .work-log-dur { font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; min-width: 40px; }
  .work-log-date { font-family: 'Space Mono', monospace; font-size: 10px; color: #666; }
  .release-checklist { padding: 10px 14px 12px; border-top: 1px solid #1a1a1a; margin-top: 4px; }
  .rl-title { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-bottom: 7px; display: flex; align-items: center; gap: 8px; }
  .rl-progress { color: #4caf82; font-size: 10px; }
  .rl-item { display: flex; align-items: center; gap: 7px; padding: 2px 0; cursor: pointer; font-size: 12px; color: #9e9690; }
  .rl-item input[type="checkbox"] { accent-color: #4caf82; cursor: pointer; }
  .rl-item.done span { color: #4caf82; text-decoration: line-through; }
  .song-footer-row { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid #1a1a1a; margin-top: 4px; }
  .sfooter-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; padding: 5px 12px; background: transparent; border-radius: 3px; cursor: pointer; }
  .sfooter-btn.move { border: 1px solid rgba(74,159,212,.3); color: #4a9fd4; margin-right: auto; }
  .sfooter-btn.move:hover { background: rgba(74,159,212,.08); }
  .sfooter-btn.send { border: 1px solid #303030; color: #9e9690; }
  .sfooter-btn.send:hover { border-color: #4caf82; color: #4caf82; }
  .sfooter-btn.send.sent { border-color: rgba(76,175,130,.4); color: #4caf82; }
  .sfooter-btn.listen-link-btn { border: 1px solid #303030; color: #9e9690; }
  .sfooter-btn.listen-link-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .sfooter-btn.listen-link-btn.flashed { border-color: #c9a84c; color: #c9a84c; }
  .sfooter-btn.del { border: 1px solid rgba(224,90,74,.2); color: #555; margin-left: auto; }
  .sfooter-btn.del:hover { border-color: rgba(224,90,74,.5); color: #e05a4a; }
  .btn-send-artist { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; padding: 6px 12px; background: rgba(74,159,212,.08); border: 1px solid rgba(74,159,212,.4); color: #4a9fd4; border-radius: 3px; cursor: pointer; }
  .btn-send-artist:hover { background: rgba(74,159,212,.15); }
  .btn-send-artist.sent { background: rgba(76,175,130,.08); border-color: rgba(76,175,130,.4); color: #4caf82; }

  /* RIGHT */
  .right-col { border-left: 1px solid #1c1c1c; padding: 0 0 32px 22px; display: flex; flex-direction: column; gap: 16px; }
  .timer-block { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: #1c1c1c; border: 1px solid #252525; border-radius: 4px; }
  .timer-presets { display: flex; gap: 6px; }
  .timer-preset-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 3px 8px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .timer-preset-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .timer-preset-btn.on { border-color: #c9a84c; color: #c9a84c; background: rgba(201,168,76,.08); }
  .timer-row { display: flex; align-items: center; gap: 10px; }
  .timer-disp { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; color: #c9a84c; min-width: 80px; }
  .timer-disp.urgent { color: #e05a4a; }
  .timer-btns { display: flex; gap: 6px; margin-left: auto; }
  .session-acc { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; }
  .timer-done-banner { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #0a0a0a; background: #4caf82; border-radius: 3px; padding: 6px 12px; text-align: center; animation: fadeout 4s forwards; }
  @keyframes fadeout { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
  .log-tab-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; padding: 3px 10px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; margin-left: auto; }
  .log-tab-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .log-tab-btn.on { border-color: rgba(201,168,76,.5); color: #c9a84c; background: rgba(201,168,76,.06); }
  .release-stage-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; padding: 3px 10px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .release-stage-btn:hover { border-color: rgba(76,175,130,.4); color: #4caf82; }
  .release-stage-btn.on { border-color: rgba(76,175,130,.5); color: #4caf82; background: rgba(76,175,130,.06); }
  .release-stage-btn.done { border-color: rgba(76,175,130,.5); color: #4caf82; cursor: default; }
  .release-panel { background: #0d0d0d; border: 1px solid #1c1c1c; border-radius: 3px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .rel-panel-row { display: flex; align-items: center; gap: 10px; }
  .rel-panel-row label { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; width: 90px; flex-shrink: 0; }
  .rel-panel-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
  .btn-create-release { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 5px 14px; background: transparent; border: 1px solid rgba(76,175,130,.4); color: #4caf82; border-radius: 2px; cursor: pointer; }
  .btn-create-release:hover { background: rgba(76,175,130,.08); }
  .rel-created-badge { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; }
  .log-panel { background: #080808; border: 1px solid #1c1c1c; border-radius: 3px; padding: 10px 14px; font-family: 'Space Mono', monospace; font-size: 11px; }
  .nolog-btn { color: #555; }
  .nolog-btn.on { border-color: #e05a4a; color: #e05a4a; background: rgba(224,90,74,.08); }
  .log-head-row { display: flex; gap: 0; color: #444; font-weight: 700; padding-bottom: 6px; border-bottom: 1px solid #1c1c1c; margin-bottom: 4px; }
  .log-stage-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 0 4px; border-bottom: 1px solid #1c1c1c; margin-top: 4px; }
  .log-stage-label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #c9a84c; letter-spacing: .08em; }
  .log-stage-total-inline { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .log-row { display: flex; gap: 0; padding: 4px 0; border-bottom: 1px solid #0d0d0d; }
  .log-col-date { width: 90px; flex-shrink: 0; color: #555; }
  .log-col-stage { flex: 1; color: #9e9690; }
  .log-col-time { width: 60px; flex-shrink: 0; text-align: right; color: #c9a84c; }
  .log-total { display: flex; justify-content: space-between; padding-top: 8px; margin-top: 4px; border-top: 1px solid #1c1c1c; font-weight: 700; color: #c9a84c; }
  .log-stage-total { display: flex; gap: 0; padding: 3px 0; border-top: 1px dashed #151515; margin-top: 2px; }

  .right-section { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .right-section-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #111; border: none; cursor: pointer; width: 100%; }
  .right-section-head:hover { background: #1c1c1c; }
  .right-section-title { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.75); }
  .right-section-title-plain { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.75); padding: 10px 14px; border-bottom: 1px solid #1c1c1c; }
  .right-arr { font-size: 10px; color: #555; transition: transform .2s; font-family: 'Space Mono', monospace; }
  .right-arr.open { transform: rotate(90deg); }

  .checklist-panel { padding: 8px 14px 10px; border-bottom: 1px solid #1a1a1a; margin-bottom: 4px; }
  .checklist-title { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: rgba(201,168,76,.75); letter-spacing: .1em; margin-bottom: 2px; }
  .checklist-subtitle { font-family: 'DM Sans', sans-serif; font-size: 9px; color: #333; margin-bottom: 8px; }
  .checklist-phase-group { margin-bottom: 10px; }
  .checklist-phase-label { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; color: rgba(201,168,76,.5); letter-spacing: .12em; margin-bottom: 5px; padding-bottom: 3px; border-bottom: 1px solid #1a1a1a; }
  .checklist-item { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #111; align-items: flex-start; }
  .checklist-item.done .checklist-q { color: #333; text-decoration: line-through; }
  .checklist-item input[type=checkbox] { margin-top: 3px; accent-color: #c9a84c; flex-shrink: 0; }
  .checklist-content { display: flex; flex-direction: column; gap: 2px; }
  .checklist-q { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #cec9c1; line-height: 1.5; }
  .checklist-why { font-family: 'DM Sans', sans-serif; font-size: 9px; color: #444; font-style: italic; margin-top: 2px; }
  .checklist-empty { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #333; font-style: italic; padding: 6px 0; }
  .reset-checklist-btn { font-family: 'Space Mono', monospace; font-size: 8px; background: transparent; border: 1px solid #1a1a1a; color: #333; padding: 3px 10px; border-radius: 2px; cursor: pointer; margin-top: 8px; }
  .reset-checklist-btn:hover { color: #555; border-color: #252525; }
  .sanity-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 5px; max-height: 320px; overflow-y: auto; }
  .sanity-row { display: flex; align-items: flex-start; gap: 9px; padding: 5px 0; border-bottom: 1px solid #0f0f0f; }
  .sanity-row.checked { opacity: .35; }
  .sanity-add-row { display: flex; gap: 6px; padding: 8px 0 4px; }
  .tip-sec-block { border-bottom: 1px solid #1a1a1a; }
  .tip-sec-head { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 7px 0; background: transparent; border: none; cursor: pointer; font-family: 'Space Mono', monospace; font-size: 11px; color: #555; text-align: left; transition: color .15s; }
  .tip-sec-head:hover { color: #9e9690; }
  .arr-sm { font-size: 9px; transition: transform .2s; }
  .arr-sm.open { transform: rotate(90deg); }
  .sanity-text { font-size: 13px; color: #cec9c1; line-height: 1.55; flex: 1; }
  .sanity-row.checked .sanity-text { text-decoration: line-through; color: #555; }
  .sanity-edit { font-size: 13px; color: #cec9c1; line-height: 1.55; flex: 1; background: transparent; border: none; outline: none; font-family: inherit; width: 100%; cursor: text; }
  .sanity-edit:hover { background: rgba(255,255,255,.03); border-radius: 2px; }
  .sanity-edit:focus { background: rgba(255,255,255,.05); border-radius: 2px; }
  .sanity-row.checked .sanity-edit { text-decoration: line-through; color: #555; }
  .reset-sanity { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; background: transparent; border: none; cursor: pointer; padding: 8px 0 2px; }
  .reset-sanity:hover { color: #c9a84c; }

  .tip-sec { border-bottom: 1px solid #1c1c1c; }
  .tip-sec:last-child { border-bottom: none; }
  .tip-toggle { display: flex; align-items: center; gap: 8px; padding: 9px 14px; cursor: pointer; background: transparent; border: none; width: 100%; text-align: left; }
  .tip-toggle:hover { background: #111; }
  .tip-toggle-lbl { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .06em; color: rgba(201,168,76,.8); flex: 1; }
  .tip-tier { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .tip-arr { font-size: 10px; color: #555; transition: transform .2s; flex-shrink: 0; font-family: 'Space Mono', monospace; }
  .tip-arr.open { transform: rotate(90deg); }
  .tips-body { padding: 10px 14px; border-top: 1px solid #1c1c1c; display: flex; flex-direction: column; gap: 6px; background: #080808; max-height: 300px; overflow-y: auto; }
  .tip-row { font-size: 14px; color: #9e9690; line-height: 1.7; padding: 3px 0; border-bottom: 1px solid #0f0f0f; display: flex; align-items: flex-start; gap: 4px; }
  .tip-row:last-child { border-bottom: none; }
  .edit-box-label { font-family: "Space Mono", monospace; font-size: 10px; color: #333; letter-spacing: .08em; margin-top: 12px; margin-bottom: 4px; }
  .tip-sections-row { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
  .tip-sel-btn { font-family: "Space Mono", monospace; font-size: 11px; font-weight: 700; padding: 5px 10px; background: transparent; border: 1px solid #1c1c1c; border-radius: 2px; color: #555; cursor: pointer; text-align: left; transition: all .15s; }
  .tip-sel-btn:hover { border-color: #303030; color: #9e9690; }
  .tip-sel-btn.on { border-color: rgba(201,168,76,.4); color: #c9a84c; background: rgba(201,168,76,.05); }
  .tip-hint { font-family: "Space Mono", monospace; font-size: 11px; color: #333; padding: 8px 0; }
  .tips-active-ta { min-height: 220px; }
  .tips-edit-ta { width: 100%; min-height: 180px; background: #0d0d0d; border: 1px solid #1c1c1c; border-radius: 3px; color: #cec9c1; font-size: 13px; font-family: 'DM Sans', sans-serif; font-weight: 300; line-height: 1.7; padding: 10px; resize: vertical; overflow: auto; outline: none; box-sizing: border-box; }
  .tips-edit-ta:focus { border-color: #252525; color: #9e9690; }
  .tip-dash { flex-shrink: 0; color: #555; }
  .tip-edit { font-size: 14px; color: #9e9690; line-height: 1.7; flex: 1; background: transparent; border: none; outline: none; font-family: inherit; cursor: text; }
  .tip-edit:hover { background: rgba(255,255,255,.03); border-radius: 2px; }
  .tip-edit:focus { background: rgba(255,255,255,.05); color: #cec9c1; border-radius: 2px; }

  .card-block { padding: 12px 14px; background: #1c1c1c; border-radius: 4px; border: 1px solid #252525; display: flex; flex-direction: column; gap: 8px; }
  .card-label { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; letter-spacing: .1em; }
  .card-text { font-family: 'Space Mono', monospace; font-size: 12px; color: #9e9690; line-height: 1.6; font-style: italic; }

  .dt-body { padding: 10px 14px; display: flex; flex-direction: column; gap: 5px; }
  .dt-row { display: flex; align-items: center; gap: 9px; padding: 5px 0; border-bottom: 1px solid #111; }
  .dt-label { flex: 1; font-size: 14px; color: #cec9c1; }
  .dt-date { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; flex-shrink: 0; }
  .dt-add { display: flex; gap: 5px; margin-top: 5px; }
  .task-add-row { display: flex; gap: 5px; margin-top: 5px; width: 100%; }
  .add-inp-sm { background: #111; border: 1px solid #1c1c1c; color: #f5f1ea; font-family: 'Space Mono', monospace; font-size: 12px; padding: 6px 9px; outline: none; border-radius: 3px; flex: 1; min-width: 0; }
  .add-inp-sm:focus { border-color: rgba(201,168,76,.4); }
  .add-inp-sm::placeholder { color: #333; }
  .date-inp { width: 115px; flex: none; }
  .time-inp { width: 78px; flex: none; }
  .add-btn-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 6px 10px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; white-space: nowrap; }

  .mozart-block { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 500px; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); margin-bottom: 2px; display: flex; align-items: center; gap: 10px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: #555; color: #9e9690; }
  .chat-out { overflow-y: auto; max-height: 70vh; min-height: 300px; display: flex; flex-direction: column; gap: 10px; padding: 4px 0; scroll-behavior: smooth; }
  .chat-msg { display: flex; flex-direction: column; gap: 3px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 12px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-size: 14px; color: #cec9c1; line-height: 1.6; }
  .chat-text.dim { color: #444; }
  :global(.moz-header) { font-family: 'Space Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: rgba(201,168,76,.75); margin: 12px 0 4px; padding-bottom: 4px; border-bottom: 1px solid #1c1c1c; display: block; }
  :global(.moz-bullet) { padding: 2px 0 2px 12px; line-height: 1.6; color: #9e9690; display: block; }
  :global(.moz-spacer) { height: 8px; display: block; }
  :global(.moz-gap) { color: #e05a4a; font-weight: 500; }
  :global(.moz-ok) { color: #4caf82; font-weight: 500; }
  :global(.moz-confirmed) { color: #c9a84c; font-weight: 500; }
  :global(.moz-tension) { color: #e8a838; font-weight: 500; }
  :global(.moz-outdated) { color: #9e9690; font-weight: 500; }
  :global(.moz-new) { color: #4a9fd4; font-weight: 500; }
  :global(.moz-next-label) { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-top: 10px; margin-bottom: 4px; display: block; }
  .chat-input-row { display: flex; gap: 7px; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 8px 11px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }

  .btn-ghost-sm { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; padding: 6px 12px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .btn-ghost-sm:hover { border-color: #c9a84c; color: #c9a84c; }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; padding: 7px 14px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }

  /* Modals */
  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.75); z-index: 9999; display: flex; align-items: center; justify-content: center; }
  .modal { background: #1c1c1c; border: 1px solid #303030; border-radius: 6px; padding: 28px; width: 440px; display: flex; flex-direction: column; gap: 12px; }
  .modal-title { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; color: #c9a84c; }
  .modal-sub { font-size: 14px; color: #9e9690; }
  .modal-btns { display: flex; gap: 8px; }
  .btn-gold-full { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: .08em; padding: 10px 18px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex: 1; }
  .modal-cancel { font-family: 'Space Mono', monospace; font-size: 12px; padding: 10px 14px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 3px; cursor: pointer; }
  .modal-cancel:hover { color: #9e9690; }
  .inp-md { background: #0a0a0a; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 15px; padding: 9px 12px; outline: none; border-radius: 3px; width: 100%; }
  .inp-md:focus { border-color: rgba(201,168,76,.5); }
  .color-picker-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .color-dot-lg { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; transition: transform .1s; }
  .color-dot-lg.active { border-color: #f5f1ea; transform: scale(1.15); }
  .color-dot-lg:hover { transform: scale(1.1); }
  .daw-capture-btn { background: transparent; border: none; cursor: pointer; font-size: 13px; padding: 2px 4px; opacity: .25; transition: opacity .15s; flex-shrink: 0; }
  .daw-capture-btn:hover { opacity: 1; }

  /* Vocal EQ */
  .vocal-eq-section { border-top: 1px solid #1a1a1a; margin-top: 16px; position: relative; z-index: 1; padding-top: 10px; }
  .vocal-eq-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 6px 0; background: transparent; border: none; cursor: pointer; text-align: left; position: relative; z-index: 2; pointer-events: all; }
  .vocal-eq-header:hover { background: rgba(255,255,255,.02); }
  .vocal-eq-title { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .1em; }
  .vocal-eq-arr { font-size: 9px; color: #555; transition: transform .2s; font-family: 'Space Mono', monospace; }
  .vocal-eq-arr.open { transform: rotate(90deg); }
  .vocal-eq-body { padding: 6px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
  .vocal-eq-actions { display: flex; flex-direction: column; gap: 6px; }
  .vocal-ref-row { display: flex; gap: 6px; }
  .vocal-mozart-wrap { display: flex; flex-direction: column; gap: 4px; }
  .vocal-mozart-toggle { background: transparent; border: 1px solid #1c1c1c; color: #444; font-size: 10px; font-family: 'Space Mono', monospace; padding: 3px 8px; border-radius: 2px; cursor: pointer; text-align: left; }
  .vocal-mozart-toggle:hover, .vocal-mozart-toggle.active { border-color: rgba(74,159,212,.3); color: #4a9fd4; }
  .vocal-mozart-panel { display: flex; gap: 6px; }
  .vocal-mozart-err { font-size: 9px; color: #c44; }
  .vocal-ref-inp { flex: 1; background: #111; border: 1px solid #1c1c1c; color: #f5f1ea; font-size: 12px; font-family: 'DM Sans', sans-serif; padding: 5px 9px; border-radius: 3px; outline: none; min-width: 0; }
  .vocal-ref-inp:focus { border-color: rgba(201,168,76,.4); }
  .vocal-ref-inp::placeholder { color: #333; }
  .vocal-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .07em; padding: 5px 12px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .vocal-btn:hover:not(:disabled) { border-color: #c9a84c; color: #c9a84c; }
  .vocal-btn:disabled { opacity: .4; cursor: default; }
  .vocal-btn-ref { border-color: rgba(74,159,212,.3); color: #4a9fd4; flex-shrink: 0; }
  .vocal-btn-ref:hover:not(:disabled) { border-color: #4a9fd4; background: rgba(74,159,212,.05); color: #4a9fd4; }
  .eq-match-score { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .eq-match-good { color: #4caf82; }
  .eq-match-mid { color: #f5a623; }
  .eq-match-low { color: #e05a4a; }
  .eq-instructions { display: flex; flex-wrap: wrap; gap: 5px; }
  .eq-inst { display: flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 3px; font-family: 'Space Mono', monospace; font-size: 10px; }
  .eq-inst.boost { background: rgba(76,175,130,.08); border: 1px solid rgba(76,175,130,.25); }
  .eq-inst.cut { background: rgba(224,90,74,.08); border: 1px solid rgba(224,90,74,.25); }
  .eq-inst-action { font-weight: 700; }
  .eq-inst.boost .eq-inst-action { color: #4caf82; }
  .eq-inst.cut .eq-inst-action { color: #e05a4a; }
  .eq-inst-db { color: #cec9c1; min-width: 32px; }
  .eq-inst-band { color: #9e9690; }
  .eq-curve-list { display: flex; flex-direction: column; gap: 2px; }
  .eq-curve-item { font-family: 'Space Mono', monospace; font-size: 10px; }
  .eq-curve-ref { color: rgba(201,168,76,.7); }
  .eq-curve-mix { color: rgba(224,219,210,.5); }
  .eq-inst-reason { color: #555; font-style: italic; }
  .vocal-status { font-family: 'Space Mono', monospace; font-size: 10px; color: #c9a84c; padding: 5px 0; animation: va-pulse 1.5s ease-in-out infinite; }
  .vocal-status.done { color: #4caf82; animation: none; }
  .vocal-status.err { color: #e05a4a; animation: none; }
  .mz-insight { margin: 10px 0; border-top: 1px solid #1a1a1a; padding-top: 10px; }
  .mz-section { margin-bottom: 10px; }
  .mz-label { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; color: rgba(201,168,76,.5); letter-spacing: .12em; margin-bottom: 5px; }
  .mz-point { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 300; color: #9e9690; line-height: 1.6; padding: 3px 0; border-bottom: 1px solid #111; }
  .mz-next { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 400; color: #cec9c1; line-height: 1.6; }
  .mz-loading { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; padding: 8px 0; font-style: italic; }
  @keyframes va-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .stem-tabs { display: flex; gap: 4px; margin-bottom: 4px; }
  .stem-tab { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; padding: 3px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; letter-spacing: .06em; }
  .stem-tab.active { border-color: #c9a84c; color: #c9a84c; background: rgba(201,168,76,.08); }
  .stem-tab:hover:not(.active) { border-color: #333; color: #666; }
  .ref-select-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .ref-select-label { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; white-space: nowrap; }
  .ref-select { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 11px; padding: 4px 8px; border-radius: 2px; outline: none; }
  .no-curve-msg { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #444; font-style: italic; padding: 2px 0 4px; }
  .ref-credits { margin: 4px 0; padding: 6px 8px; background: #111; border-radius: 3px; border-left: 2px solid #252525; }
  .credit-row { display: flex; gap: 8px; padding: 2px 0; font-family: 'DM Sans', sans-serif; font-size: 11px; }
  .credit-label { font-family: 'Space Mono', monospace; font-size: 8px; color: #555; width: 55px; flex-shrink: 0; padding-top: 2px; text-transform: uppercase; }
  .credit-val { color: #9e9690; }

  /* ANALYZER sub-sections */
  .az-section-hdr { display:flex; align-items:center; justify-content:space-between; width:100%; background:transparent; border:none; border-top:1px solid #1a1a1a; padding:7px 0 4px; cursor:pointer; font-family:'Space Mono',monospace; font-size:9px; font-weight:700; color:rgba(201,168,76,.5); letter-spacing:.1em; margin-top:4px; }
  .az-section-hdr:hover { color:rgba(201,168,76,.8); }
  .az-arr { font-size:8px; color:#333; transition:transform .15s; }
  .az-arr.open { transform:rotate(90deg); color:#555; }
  .az-body { padding:6px 0 8px; }
  .az-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:4px 8px; }
  .az-stat { display:flex; flex-direction:column; }
  .az-label { font-family:'Space Mono',monospace; font-size:8px; color:#444; }
  .az-val { font-family:'Space Mono',monospace; font-size:11px; color:#cec9c1; }
  .az-arc-meta { font-family:'Space Mono',monospace; font-size:8px; color:#444; margin-top:6px; }
  .az-score-row { display:flex; align-items:baseline; gap:8px; margin-bottom:8px; }
  .az-score { font-family:'Space Mono',monospace; font-size:22px; font-weight:700; }
  .az-score-label { font-family:'DM Sans',sans-serif; font-size:11px; color:#555; }
  .az-gaps-title { font-family:'Space Mono',monospace; font-size:8px; color:rgba(201,168,76,.5); letter-spacing:.08em; margin-bottom:4px; }
  .az-gap-row { display:flex; align-items:center; gap:8px; padding:3px 0; border-bottom:1px solid #111; font-family:'Space Mono',monospace; font-size:9px; }
  .az-gap-label { color:#9e9690; flex:1; }
  .az-gap-val { color:#555; font-size:8px; }
  .az-gap-target { color:#444; font-size:8px; }
  .az-gap-pct { font-weight:700; flex-shrink:0; }
  .az-loading { font-family:'DM Sans',sans-serif; font-size:11px; color:#444; padding:4px 0; font-style:italic; }
  .arc-svg { width:100%; height:auto; display:block; background:#0a0a0a; border-radius:3px; margin-bottom:4px; }
  .az-arc-legend { display:flex; gap:12px; font-family:'Space Mono',monospace; font-size:8px; color:#444; }
  .az-history-total { font-family:'DM Sans',sans-serif; font-size:10px; color:#555; margin-bottom:6px; }
  .az-feedback-row { display:flex; align-items:center; gap:6px; padding:3px 0; }
  .az-fb-type { font-family:'Space Mono',monospace; font-size:8px; color:#9e9690; width:90px; flex-shrink:0; }
  .az-fb-count { font-family:'Space Mono',monospace; font-size:9px; color:#555; width:20px; text-align:right; flex-shrink:0; }
  .az-fb-bar { flex:1; height:4px; background:#1a1a1a; border-radius:2px; overflow:hidden; }
  .az-fb-fill { height:100%; background:rgba(201,168,76,.4); border-radius:2px; }
  .az-fb-pct { font-family:'Space Mono',monospace; font-size:8px; color:#444; width:28px; text-align:right; flex-shrink:0; }
  .az-trend-row { display:flex; align-items:center; gap:8px; padding:3px 0; border-bottom:1px solid #111; }
  .az-trend-name { font-family:'DM Sans',sans-serif; font-size:11px; color:#9e9690; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .az-trend-vel { font-family:'Space Mono',monospace; font-size:9px; font-weight:700; flex-shrink:0; }
</style>