<script module>
  // Module-level maps — survive component unmount/remount when switching tabs
  const blobUrls = {}   // song.id -> blob URL (only for same-session drops)
  const gainMap  = {}

  const AUDIO_SERVER = 'http://localhost:4242/audio'

  function audioSrc(song) {
    if (blobUrls[song.id]) return blobUrls[song.id]
    if (song.audio_path) return `${AUDIO_SERVER}/${encodeURIComponent(song.audio_path)}`
    return null
  }

  async function saveToDropbox(file, code, oldFilename) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp3'
    const filename = code + '_v00.' + ext

    try {
      // Post binary to watcher — it saves to Demos folder, deletes old file if different name
      const buf = await file.arrayBuffer()
      await fetch(
        `http://localhost:4242/save-audio?dir=demo&filename=${encodeURIComponent(filename)}&oldfile=${encodeURIComponent(oldFilename || '')}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }
      )
    } catch(e) {
      // Fallback: browser download (watcher picks it up)
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    }
    return filename
  }
</script>

<script>
  import { supabase } from './supabase.js'
  import { onMount, onDestroy } from 'svelte'
  import { GENRE_LIST } from '$lib/genres.js'
  import ListenLinkBlock from './ListenLinkBlock.svelte'

  let { initialView = 'demos' } = $props()
  let view = $state(initialView)
  let songs = $state([])
  let projectSongsAll = $state([])
  let patches = $state([])
  let sessionDownloads = $state({})
  let showBgPicker = $state(false)
  let bgPickerPatch = $state(null)
  let selectedBg = $state('stars')

  async function loadSessionDownloads() {
    const { data, error } = await supabase.from('share_sessions')
      .select('id, patch_name, downloads')
      .order('created_at', { ascending: false })
    if (error || !data?.length) return
    const map = {}
    data.forEach(s => {
      const dl = s.downloads
      if (!dl || typeof dl !== 'object') return
      const codes = Object.keys(dl).filter(k => dl[k])
      if (!codes.length) return
      if (!map[s.patch_name]) map[s.patch_name] = { codes: [] }
      map[s.patch_name].codes = [...new Set([...map[s.patch_name].codes, ...codes])]
    })
    sessionDownloads = map
  }
  let connections = $state([])
  let loading = $state(true)
  let expandedId = $state(null)
  function toggleDemo(song) {
    expandedId = expandedId === song.id ? null : song.id
    showBatchPicker = {}
  }
  let tagInput = $state({})
  let refInput = $state({})
  let genreSearch = $state({})   // song.id → search string in genre picker
  let showGenrePicker = $state({}) // song.id → boolean
  let availableGenres = $state(GENRE_LIST.filter(g => g.type === 'sub').map(g => g.tag))

  let audioTick = $state(0) // increment to force player re-render after drop

  let showPatchModal = $state(false)
  let newPatchArtistName = $state('')
  // Single flat format — same shape in memory and in Supabase jsonb
  // { filename, title, code, bpm, song_id, prev_sent }
  let subDropFiles = $state({})   // patchId → [DropFile]
  let subDragging = $state({})
  let expandedPatchId = $state(null)

  const STATUS = {
    demo: { label: 'DEMO', color: '#c9a84c' },
    sent: { label: 'SENT', color: '#4a9fd4' },
    placed: { label: 'PLACED', color: '#4caf82' },
  }

  const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B','Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m','Am','A#m','Bm']

  let newDemoDragging = $state(false)
  let tagSearch = $state('')
  let headerGenre = $state('')       // genre filter in header
  let showHeaderGenrePicker = $state(false)

  async function renameDemoAudio(song, newTitle) {
    if (!song.audio_path || !newTitle?.trim()) return
    try {
      const res = await fetch('http://localhost:4242/rename-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id, old_filename: song.audio_path, new_title: newTitle.trim() })
      })
      const result = await res.json()
      if (result.ok && result.new_filename && result.new_filename !== song.audio_path) {
        song.audio_path = result.new_filename
        songs = [...songs]
      }
    } catch(e) {}
  }

  async function handleTitleChange(song, newTitle) {
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === (song.title || '').trim()) return
    song.title = trimmed
    songs = [...songs]
    if (song.audio_path) {
      await renameDemoAudio(song, trimmed)
    } else {
      await supabase.from('songs').update({ title: trimmed }).eq('id', song.id)
    }
  }

  async function loadAvailableGenres() {
    try {
      const { data } = await supabase.from('reference_tracks').select('genre_tag, genres')
      const genreSet = new Set(GENRE_LIST.filter(g => g.type === 'sub').map(g => g.tag))
      for (const r of (data || [])) {
        if (r.genre_tag) genreSet.add(r.genre_tag.toLowerCase())
        if (Array.isArray(r.genres)) r.genres.forEach(g => g && genreSet.add(g.toLowerCase()))
      }
      availableGenres = [...genreSet].sort()
    } catch(e) {}
  }

  async function load() {
    loadAvailableGenres()
    const [songsRes, patchesRes, connectionsRes, projSongsRes] = await Promise.all([
      supabase.from('songs').select('*').is('project_id', null).order('created_at', { ascending: false }),      supabase.from('patches').select('*, patch_songs(song_id)').order('created_at', { ascending: false }),
      supabase.from('connections').select('id, name, folder_link, sent_history, group_type, group_types').order('name'),
      supabase.from('songs').select('id, title, code, project_id, tags, status').not('project_id', 'is', null).order('created_at', { ascending: false }),
    ])
    songs = songsRes.data || []
    connections = connectionsRes.data || []
    projectSongsAll = projSongsRes.data || []
    if (connectionsRes.error) console.error('Connections load error:', connectionsRes.error)

    const allPatchSongIds = (patchesRes.data || []).flatMap(p => p.patch_songs.map(ps => ps.song_id))
    let patchSongsData = []
    if (allPatchSongIds.length) {
      const { data } = await supabase.from('songs').select('*').in('id', allPatchSongIds)
      patchSongsData = data || []
    }

    patches = (patchesRes.data || []).map(p => ({
      ...p,
      songs: p.patch_songs
        .map(ps => patchSongsData.find(s => s.id === ps.song_id))
        .filter(Boolean)
        .sort((a, b) => (b.created_at || '') > (a.created_at || '') ? 1 : -1)
    }))

    // Restore persisted drop files from Supabase jsonb
    const restored = {}
    for (const p of patches) {
      console.log('LOADED DROPPED FILES:', p.id, p.name, JSON.stringify(p.dropped_files))
      if (Array.isArray(p.dropped_files) && p.dropped_files.length) {
        restored[p.id] = p.dropped_files
      }
    }
    if (Object.keys(restored).length) subDropFiles = { ...subDropFiles, ...restored }

    loading = false
    loadSessionDownloads()
  }

  async function addSong() {
    const code = await generateCode()
    const { data } = await supabase
      .from('songs')
      .insert({ code, status: 'demo', tags: [], reference_links: [] })
      .select().single()
    songs = [data, ...songs]
    expandedId = data.id
  }

  async function createDemoFromDrop(file) {
    await addSong()
    const newSong = songs[0]
    if (!newSong) return

    const code = newSong.code || ''
    const ext = file.name.split('.').pop().toLowerCase()
    const filename = `${code}.${ext}`

    const buf = await file.arrayBuffer()
    const res = await fetch(`http://localhost:4242/save-audio?dir=demo&filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf
    })
    const result = await res.json()
    if (!result.ok) return

    await supabase.from('songs').update({ audio_path: filename }).eq('id', newSong.id)

    try {
      const analysis = await fetch('http://localhost:4242/analyze-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, dir: 'demo' })
      }).then(r => r.json())
      if (analysis.bpm || analysis.key) {
        await supabase.from('songs').update({
          tempo: analysis.bpm || newSong.tempo,
          key: analysis.key || newSong.key
        }).eq('id', newSong.id)
      }
    } catch(e) {}

    await loadSongs()
  }

  async function updateField(song, field, value) {
    song[field] = value
    songs = [...songs]
    await supabase.from('songs').update({ [field]: value }).eq('id', song.id)
  }

  async function updateCollaborator(song, name) {
    const work_data = { ...(song.work_data || {}), collaborator: name.trim() || undefined }
    if (!name.trim()) delete work_data.collaborator
    song.work_data = work_data
    songs = [...songs]
    await supabase.from('songs').update({ work_data }).eq('id', song.id)
  }

  async function updateTempo(song, newTempo) {
    const t = Math.round(newTempo)
    song.tempo = t
    song._bpmHalf = Math.round(t / 2)
    song._bpmDouble = t * 2
    songs = [...songs]
    await supabase.from('songs').update({ tempo: t }).eq('id', song.id)
  }

  async function handleAudioDrop(e, song) {
    e.preventDefault()
    song._dragging = false
    const file = e.dataTransfer.files[0]
    if (!file) { songs = [...songs]; return }

    // Download renamed file → watcher moves it to Dropbox
    const savedName = await saveToDropbox(file, song.code, song.audio_path || '')

    // Blob URL for immediate playback this session
    if (blobUrls[song.id]) URL.revokeObjectURL(blobUrls[song.id])
    blobUrls[song.id] = URL.createObjectURL(file)

    song.audio_path = savedName

    // Decode audio for LUFS gain only (browser-side)
    try {
      const buf = await file.arrayBuffer()
      const offCtx = new OfflineAudioContext(1, 44100, 44100)
      const decoded = await offCtx.decodeAudioData(buf.slice(0))
      const ch = decoded.getChannelData(0)
      let sum = 0
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
      const rmsDB = 10 * Math.log10(sum / ch.length + 1e-12)
      gainMap[song.id] = Math.min(1.0, Math.pow(10, (-14 - rmsDB) / 20))
    } catch(e) {
      gainMap[song.id] = 1.0
    }

    // ── BPM + Key via watcher (accurate, ffmpeg-powered) ──
    try {
      const res = await fetch('http://localhost:4242/analyze-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: savedName, dir: 'demo' })
      })
      const { bpm, bpmHalf, bpmDouble, key } = await res.json()
      const updates = { audio_path: savedName, lufs_gain: gainMap[song.id] }
      if (bpm) { updates.tempo = bpm; song.tempo = bpm; song._bpmHalf = bpmHalf; song._bpmDouble = bpmDouble }
      if (key)  { updates.key   = key;  song.key   = key  }
      await supabase.from('songs').update(updates).eq('id', song.id)
    } catch(err) {
      console.warn('Analysis failed (watcher not running?):', err.message)
      await supabase.from('songs').update({ audio_path: savedName, lufs_gain: gainMap[song.id] || 1.0 }).eq('id', song.id)
    }

    songs = [...songs]
    audioTick++
  }

  async function reAnalyzeSong(song) {
    if (!song.audio_path || song._analyzing) return
    song._analyzing = true; songs = [...songs]
    try {
      const res = await fetch('http://localhost:4242/analyze-audio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: song.audio_path, dir: 'demo' })
      })
      const { bpm, bpmHalf, bpmDouble, key } = await res.json()
      const updates = {}
      if (bpm) { updates.tempo = bpm; song.tempo = bpm; song._bpmHalf = bpmHalf; song._bpmDouble = bpmDouble }
      if (key)  { updates.key   = key;  song.key   = key  }
      if (Object.keys(updates).length) await supabase.from('songs').update(updates).eq('id', song.id)
    } catch(e) { console.warn('Re-analyze failed:', e.message) }
    song._analyzing = false; songs = [...songs]
  }

  function clearAudio(song) {
    if (blobUrls[song.id]) { URL.revokeObjectURL(blobUrls[song.id]); delete blobUrls[song.id] }
    delete gainMap[song.id]
    song.audio_path = ''
    songs = [...songs]
    audioTick++
    supabase.from('songs').update({ audio_path: '' }).eq('id', song.id)
  }

  // On mount: increment audioTick so audio server URLs render for existing songs
  onMount(() => { audioTick++ })
  function openInPreview(song) {
    if (!song.audio_path) return
    // Write a trigger JSON to Downloads — watcher opens the file in QuickTime
    const trigger = JSON.stringify({ file: song.audio_path })
    const blob = new Blob([trigger], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = '__momentum_open__.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  // Simple gain: just set volume on the audio element
  // Web Audio createMediaElementSource() hijacks the audio routing causing silence
  function applyGain(node, id) {
    const g = gainMap[id] ?? 1.0
    node.volume = g
    return { update(newId) { node.volume = gainMap[newId] ?? 1.0 } }
  }

  function saveTagPattern(song, tags) {
    const analysis = song.work_data?.analysis
    if (!analysis || !tags.length) return
    const content = JSON.stringify({
      tags,
      bpm: song.tempo || analysis.bpm,
      key: song.key || analysis.key,
      energy: analysis.energy,
      brightness: analysis.brightness,
      bass_energy: analysis.bass_energy,
      danceability: analysis.danceability,
      warmth: analysis.warmth
    })
    supabase.from('brain_knowledge').upsert({
      category: 'tag_pattern',
      title: `Tag pattern: ${tags.join(', ')} (${song.code})`,
      content,
      confidence: 'confirmed',
      active: true,
      source_type: 'manual'
    }, { onConflict: 'title' }).then(() => {})
  }

  async function addTag(song) {
    const val = (tagInput[song.id] || '').trim()
    if (!val) return
    const tags = [...(song.tags || []), val]
    await updateField(song, 'tags', tags)
    tagInput[song.id] = ''
    saveTagPattern(song, tags)
  }

  async function removeTag(song, tag) {
    const tags = (song.tags || []).filter(t => t !== tag)
    await updateField(song, 'tags', tags)
    saveTagPattern(song, tags)
  }

  async function addRef(song) {
    const val = (refInput[song.id] || '').trim()
    if (!val) return
    refInput[song.id] = ''

    // Try to fetch name from Spotify oEmbed (no auth needed)
    let name = ''
    if (val.includes('spotify')) {
      try {
        const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(val)}`)
        if (r.ok) {
          const d = await r.json()
          name = d.title || ''
        }
      } catch(e) {}
    }

    const entry = { url: val, name }
    const reference_links = [...(song.reference_links || []), entry]
    await updateField(song, 'reference_links', reference_links)
  }

  async function removeRef(song, url) {
    const reference_links = (song.reference_links || []).filter(r => {
      const u = typeof r === 'string' ? r : r.url
      return u !== url
    })
    await updateField(song, 'reference_links', reference_links)
  }

  // Normalize refs — support old plain strings and new {url,name} objects
  function normRef(r) {
    if (typeof r === 'string') return { url: r, name: '' }
    return r
  }

  async function remove(id) {
    if (!confirm('Delete this demo?')) return
    const song = songs.find(s => s.id === id)
    // Delete audio file from Demos folder
    if (song?.audio_path) {
      fetch(`http://localhost:4242/delete-audio?dir=demo&filename=${encodeURIComponent(song.audio_path)}`, {
        method: 'POST'
      }).catch(() => {})
    }
    await supabase.from('songs').delete().eq('id', id)
    songs = songs.filter(s => s.id !== id)
  }

  async function generateTags(song) {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    if (!song.key && !song.tempo && !song.notes) { alert('Add key, tempo or notes first.'); return }
    song._generating = true
    songs = [...songs]
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 200,
          messages: [{ role: 'user', content: `Generate 5-8 concise style tags for a music demo. Key: ${song.key}. Tempo: ${song.tempo} BPM. Notes: ${song.notes}. Return ONLY a JSON array of short tag strings (2-3 words max). No explanation.` }]
        })
      })
      const result = await res.json()
      if (result.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/demo-tags', model: 'claude-sonnet-4-20250514', input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens, cost_usd: (result.usage.input_tokens * 0.000003) + (result.usage.output_tokens * 0.000015) }) }).catch(() => {})
      const generated = JSON.parse(result.content?.[0]?.text.replace(/```json|```/g, '').trim() || '[]')
      await updateField(song, 'tags', [...new Set([...(song.tags || []), ...generated])])
    } catch(e) { alert('Claude error: ' + e.message) }
    song._generating = false
    songs = [...songs]
  }

  function randomTitle() {
    const adj = ['DARK','COLD','LOST','DEEP','WILD','SOFT','LOUD','SLOW','NUMB','ALIVE','FADED','HEAVY','GOLDEN','SILENT','BROKEN','HOLLOW','BLURRY','ECHOED','STOLEN','WASTED','BURNING','DISTANT','ANCIENT','DREAMING','FLOATING','SUNKEN','SHAKING','CRAVING','MISSING','RUSHING']
    const noun = ['WAVE','LIGHT','FIRE','GHOST','RAIN','DREAM','BLADE','VOICE','SHADE','PULSE','BLOOM','STORM','SMOKE','DRIFT','THREAD','MIRROR','SIGNAL','SPIRAL','BRIDGE','VESSEL','CURRENT','SHADOW','VALLEY','CHAMBER','CANYON','SILENCE','CURRENT','WINDOW','MOTION','ECHO']
    const structure = Math.random()
    if (structure < 0.33) return adj[Math.floor(Math.random()*adj.length)] + ' ' + noun[Math.floor(Math.random()*noun.length)]
    if (structure < 0.66) return noun[Math.floor(Math.random()*noun.length)] + ' ' + noun[Math.floor(Math.random()*noun.length)]
    return adj[Math.floor(Math.random()*adj.length)] + ' ' + adj[Math.floor(Math.random()*adj.length)] + ' ' + noun[Math.floor(Math.random()*noun.length)]
  }

  async function createShareSession(patch) {
    const filenames = patch.songs.filter(s => s.audio_path).map(s => s.audio_path)
    if (!filenames.length) { alert('No audio files in this submission yet.'); return }
    bgPickerPatch = patch
    await confirmCreateSession()
  }

  async function confirmCreateSession() {
    const patch = bgPickerPatch
    showBgPicker = false
    const filenames = patch.songs.filter(s => s.audio_path).map(s => s.audio_path)
    if (!filenames.length) { alert('No audio files in this patch.'); return }

    // Generate ID + URL and copy to clipboard immediately — while user gesture is fresh
    const id = Math.random().toString(36).slice(2, 10).toUpperCase()
    const LISTEN_URL = 'https://momentummusic.vercel.app'
    const url = `${LISTEN_URL}?s=${id}`
    try {
      await navigator.clipboard.writeText(url)
    } catch(e) {
      const ta = document.createElement('textarea')
      ta.value = url; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }

    // Alert immediately — link is copied, Dropbox links fill in the background
    alert(`✓ Link copied!\n${url}\n\nGenerating Dropbox links in background…`)

    // Now fetch Dropbox links and insert session (can take 5-20s)
    try {
      const res = await fetch('http://localhost:4242/get-share-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      })
      const data = await res.json()
      const shareLinks = data.results || []
      const linkMap = Object.fromEntries(shareLinks.map(r => [r.filename, r.shareUrl]))
      const songList = patch.songs.filter(s => s.audio_path).map(s => ({
        code: s.code,
        title: s.title || s.code,
        shareUrl: linkMap[s.audio_path] || null
      })).filter(s => s.shareUrl)

      if (!songList.length) { console.warn('No Dropbox links returned'); return }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('share_sessions').insert({ id, songs: songList, patch_name: patch.name, expires_at: expiresAt, background: selectedBg })
      console.log('✓ Session ready:', url)
    } catch(e) {
      console.warn('Background session creation failed:', e.message)
    }
  }

  async function generateSubmissionCode() {
    const yy = String(new Date().getFullYear()).slice(2)
    const { data } = await supabase.from('patches').select('name').like('name', yy + '%')
    const nums = (data || []).map(p => {
      const seg = (p.name || '').split('_')[0]
      return (seg.length === 5 && seg.startsWith(yy)) ? (parseInt(seg.slice(2)) || 0) : 0
    })
    const max = nums.length ? Math.max(...nums) : 0
    return yy + String(max + 1).padStart(3, '0')
  }

  function parseDemoFilenameFront(filename) {
    const nameNoExt = filename.replace(/\.[^.]+$/, '')
    const parts = nameNoExt.split('_')
    let code = null, bpm = null
    if (parts.length > 1 && /^\d{6,8}$/.test(parts[0])) code = parts.shift()
    if (parts.length > 0 && /^\d{2,3}bpm$/i.test(parts[parts.length - 1])) bpm = parseInt(parts.pop())
    const title = parts.join(' ').trim() || nameNoExt
    return { code, title, bpm }
  }

  async function createPatch() {
    const code = await generateSubmissionCode()
    const safe = s => (s||'').toUpperCase().replace(/[^A-Z0-9 ]/g,'').trim().replace(/\s+/g,'_')
    const artistSafe = safe(newPatchArtistName.trim())
    const contact = connections.find(c => String(c.id) === String(newPatchContact))
    const contactSafe = safe(contact?.name || '')
    const parts = [code, contactSafe, artistSafe].filter(Boolean)
    if (parts.length === 1) parts.push('DEMOS')
    const name = parts.join('_')
    const { data } = await supabase.from('patches')
      .insert({ name, artist: newPatchArtistName.trim() || null, contact_id: contact?.id || null, status: 'open' })
      .select().single()
    patches = [{ ...data, songs: [] }, ...patches]
    newPatchArtistName = ''
    newPatchContact = ''
    showNewPatchContactPicker = false
    showPatchModal = false
    expandedPatchId = data.id
  }

  async function handleSubDrop(e, patch) {
    e.preventDefault()
    subDragging = { ...subDragging, [patch.id]: false }
    const audioExts = new Set(['.wav', '.mp3', '.aiff', '.aif', '.m4a'])
    const current = [...(subDropFiles[patch.id] || [])]
    for (const file of Array.from(e.dataTransfer.files)) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (!audioExts.has(ext)) continue
      if (current.find(f => f.filename === file.name)) continue
      const { code: parsedCode, title, bpm } = parseDemoFilenameFront(file.name)
      const { data: matched } = await supabase.from('songs')
        .select('id, code, title').eq('audio_path', file.name).maybeSingle()
      let prev_sent = []
      if (matched) {
        const { data: ps } = await supabase.from('patch_songs')
          .select('patches(name, status)').eq('song_id', matched.id)
        prev_sent = (ps || []).filter(r => r.patches?.status === 'sent').map(r => r.patches?.name).filter(Boolean)
      }
      current.push({
        filename: file.name,
        title:    title || file.name.replace(/\.[^.]+$/, ''),
        code:     matched?.code || parsedCode || '',
        bpm:      bpm || null,
        song_id:  matched?.id || null,
        prev_sent
      })
    }
    subDropFiles = { ...subDropFiles, [patch.id]: current }
    const { error } = await supabase.from('patches').update({ dropped_files: current }).eq('id', patch.id)
    console.log('DROPPED FILES SAVED:', patch.id, JSON.stringify(current), error ? 'ERR:' + error.message : 'ok')
  }

  async function removeDropFile(patchId, filename) {
    const updated = (subDropFiles[patchId] || []).filter(f => f.filename !== filename)
    subDropFiles = { ...subDropFiles, [patchId]: updated }
    const { error } = await supabase.from('patches').update({ dropped_files: updated }).eq('id', patchId)
    if (error) console.warn('removeDropFile save error:', error.message)
  }

  async function addSongToPatch(patch, song) {
    const already = patch.songs.find(s => s.id === song.id)
    if (already) return

    await supabase.from('patch_songs').insert({ patch_id: patch.id, song_id: song.id })
    patch.songs = [...patch.songs, song]
    patches = [...patches]
  }

  async function removeSongFromPatch(patch, songId) {
    await supabase.from('patch_songs').delete().eq('patch_id', patch.id).eq('song_id', songId)
    patch.songs = patch.songs.filter(s => s.id !== songId)
    patches = [...patches]
  }

  async function sendPatch(patch) {
    const dropFiles = subDropFiles[patch.id] || []
    const allFiles = [...dropFiles.map(f => f.filename), ...patch.songs.map(s => s.audio_path).filter(Boolean)]
    if (!allFiles.length) { alert('Drop some audio files first.'); return }
    if (!confirm(`Send submission "${patch.name}" with ${allFiles.length} file(s) and copy link to clipboard?`)) return

    // Files are in DEMOS_DIR — watcher copies by filename on send

    try {
      const res = await fetch('http://localhost:4242/create-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patchName: patch.name, artist: patch.artist || '', audioFiles: allFiles })
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error)

      const linkToSave = result.shareLink || result.folderPath
      if (linkToSave) navigator.clipboard.writeText(linkToSave).catch(() => {})

      // Insert patch_songs for newly dropped matched songs
      const newSongIds = dropFiles.filter(f => f.song_id).map(f => f.song_id)
      if (newSongIds.length) {
        await supabase.from('patch_songs').insert(newSongIds.map(id => ({ patch_id: patch.id, song_id: id })))
        await supabase.from('songs').update({ status: 'sent' }).in('id', newSongIds)
        songs = songs.map(s => newSongIds.includes(s.id) ? { ...s, status: 'sent' } : s)
      }
      // Mark existing patch songs as sent
      const existingSongIds = patch.songs.map(s => s.id)
      if (existingSongIds.length) {
        await supabase.from('songs').update({ status: 'sent' }).in('id', existingSongIds)
        songs = songs.map(s => existingSongIds.includes(s.id) ? { ...s, status: 'sent' } : s)
      }

      const songCodes = dropFiles.map(f => ({ code: f.title, filename: f.filename }))
      await supabase.from('patches').update({
        folder_link: linkToSave, status: 'sent', sent_at: new Date().toISOString(),
        song_codes: songCodes, dropped_files: []
      }).eq('id', patch.id)

      patch.status = 'sent'
      patch.folder_link = linkToSave
      patches = [...patches]
      subDropFiles = { ...subDropFiles, [patch.id]: [] }

      alert(`✓ Sent! Link copied.${result.missing?.length ? '\n⚠ Missing: ' + result.missing.join(', ') : ''}`)
    } catch(err) {
      alert('Error: ' + err.message + '\nMake sure the watcher is running.')
    }
  }

  function getLatestOpenSub() {
    return patches.filter(p => p.status !== 'sent' && p.status !== 'deleted').at(-1) || null
  }
  let patchView = $state('open')
  let newPatchContact = $state('')
  let showNewPatchContactPicker = $state(false)

  let sortedPatches = $derived(
    [...patches]
      .filter(p => patchView === 'open'
        ? (p.status === 'open' || p.status === 'sent')
        : p.status === 'archived')
      .sort((a, b) => (b.created_at || b.id) > (a.created_at || a.id) ? 1 : -1)
  )

  async function releaseSong(song) {
    if (!confirm('Release this song? It will become free to send again.')) return

    // Find which patch/folder this song is in
    const patch = patches.find(p => p.songs.some(s => s.id === song.id))

    // Delete song's audio file from the submission Dropbox folder
    if (patch?.name) {
      try {
        await fetch('http://localhost:4242/delete-from-submission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patchName: patch.name, audioFile: song.audio_path, songCode: song.code })
        })
      } catch(e) {}
    }

    await supabase.from('songs').update({ status: 'demo' }).eq('id', song.id)
    song.status = 'demo'
    await supabase.from('patch_songs').delete().eq('song_id', song.id)
    patches = patches.map(p => ({ ...p, songs: p.songs.filter(s => s.id !== song.id) }))
    songs = songs.map(s => s.id === song.id ? { ...s, status: 'demo' } : s)
  }

  async function deletePatch(id) {
    if (!confirm('Delete this submission?\nDropbox folder will be deleted. Info stays in database.')) return
    const patch = patches.find(p => p.id === id)

    // Delete the Dropbox submission folder
    if (patch?.name) {
      fetch('http://localhost:4242/delete-submission-folder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patchName: patch.name })
      }).catch(() => {})
    }

    // Mark deleted in DB — keep row with all info intact
    await supabase.from('patches').update({ status: 'deleted' }).eq('id', id)
    patches = patches.filter(p => p.id !== id)
  }

  async function archivePatch(id) {
    await supabase.from('patches').update({ status: 'archived' }).eq('id', id)
    patches = patches.map(p => p.id === id ? { ...p, status: 'archived' } : p)
  }

  async function generateCode() {
    const now = new Date()
    const yy = String(now.getFullYear()).slice(2)
    const mm = String(now.getMonth()+1).padStart(2,'0')
    const prefix = yy + mm
    const { data } = await supabase.from('songs').select('code').like('code', prefix+'%')
    const existing = (data||[])
      .filter(s => s.code && s.code.length === 6)
      .map(s => parseInt(s.code.slice(4)) || 0)
    const max = existing.length ? Math.max(...existing) : 0
    return prefix + String(max + 1).padStart(2,'0')
  }

  async function updatePatchField(patch, field, value) {
    patch[field] = value
    patches = [...patches]
    await supabase.from('patches').update({ [field]: value }).eq('id', patch.id)
  }

  function openLink(url) {
    if (!url) return
    if (url.startsWith('/') || url.startsWith('~')) {
      window.open('file://' + url.replace(/^~/, '/Users/' + (navigator.userAgent.includes('Mac') ? '' : '')), '_blank')
    } else {
      window.open(url, '_blank')
    }
  }

  // Count how many active (non-deleted, non-sent) patches each song is in
  let songBatchCount = $derived((() => {
    const counts = {}
    patches
      .filter(p => p.status !== 'deleted')
      .forEach(p => p.songs.forEach(s => { counts[s.id] = (counts[s.id] || 0) + 1 }))
    return counts
  })())
  let songsInBatches = $derived(new Set(Object.keys(songBatchCount).map(Number)))
  let freeSongs = $derived(songs.filter(s => !songsInBatches.has(s.id)))
  let projectSongsForBatch = $derived(projectSongsAll.filter(s => !songsInBatches.has(s.id)))
  let showBatchPicker = $state({})
  let showContactPicker = $state({})
  let filteredSongs = $derived((() => {
    let list = songs
    if (tagSearch.trim()) {
      // Split on spaces/commas — each term must match (AND logic)
      const terms = tagSearch.trim().toLowerCase().split(/[\s,]+/).filter(Boolean)
      list = list.filter(s => terms.every(term => {
        // Match against tags
        if ((s.tags||[]).some(t => t.toLowerCase().includes(term))) return true
        // Match against tempo: "94", "94bpm", "bpm94"
        if (s.tempo) {
          const bpmStr = String(s.tempo)
          if (bpmStr.includes(term.replace(/bpm/i, ''))) return true
          if (term.replace(/bpm/i, '') === bpmStr) return true
        }
        return false
      }))
    }
    if (headerGenre) {
      list = list.filter(s => (s.tags||[]).includes(headerGenre))
    }
    return list
  })())

  function openSpotifyPopup(url) {
    window.open(url, 'spotify_preview', 'width=400,height=600,left=100,top=100,toolbar=no,menubar=no')
  }

  // Mozart
  let aiInput = $state('')
  let aiMessages = $state([])
  let aiLoading = $state(false)

  async function sendAI() {
    if (!aiInput.trim() || aiLoading) return
    const msg = aiInput.trim(); aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set — add it in Settings ⚙.' }]; aiLoading = false; return }
    const ctx = 'You are Mozart, a music production AI. The producer is in the DEMO tab managing demos and patches. Be concise and helpful about demo selection, A&R decisions, and sending to contacts.'
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: ctx, messages: aiMessages.slice(-10) })
      })
      const d = await res.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/demo-chat', model: 'claude-sonnet-4-20250514', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000003) + (d.usage.output_tokens * 0.000015) }) }).catch(() => {})
      aiMessages = [...aiMessages, { role: 'assistant', content: d.content?.[0]?.text || 'No response.' }]
    } catch(e) { aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: '+e.message }] }
    aiLoading = false
  }

  load()

  const pollInterval = setInterval(async () => {
    const { data } = await supabase
      .from('songs')
      .select('*')
      .is('project_id', null)
      .order('created_at', { ascending: false })
    if (!data) return
    const incoming = new Map(data.map(s => [s.id, s]))
    const current  = new Map(songs.map(s => [s.id, s]))
    const hasNew     = data.some(s => !current.has(s.id))
    const hasMissing = songs.some(s => !incoming.has(s.id))
    if (hasNew || hasMissing) songs = data
  }, 5000)

  onDestroy(() => clearInterval(pollInterval))
</script>

<svelte:window onclick={() => { if (Object.values(showBatchPicker).some(Boolean)) showBatchPicker = {}; if (showPatchArtistPicker) showPatchArtistPicker = false; if (Object.values(showGenrePicker).some(Boolean)) showGenrePicker = {}; if (showHeaderGenrePicker) showHeaderGenrePicker = false }} />
<div class="demo-layout">
<div class="demo-main">

<div class="header">
  <span class="title">{initialView === 'patches' ? 'SUBMISSIONS' : 'DEMOS'}</span>
  <div class="view-tabs" style="display:none">
    <button class="vtab {view === 'demos' ? 'on' : ''}" onclick={() => view = 'demos'}>DEMOS</button>
    <button class="vtab {view === 'patches' ? 'on' : ''}" onclick={() => view = 'patches'}>SUBMISSIONS</button>
  </div>
  {#if view === 'demos'}
    <div class="header-genre-wrap" onclick={e => e.stopPropagation()}>
      <input class="tag-search-inp" placeholder="Genre..." readonly
        value={headerGenre}
        onclick={() => { showHeaderGenrePicker = !showHeaderGenrePicker }}
        style={headerGenre ? 'color:#c9a84c;border-color:rgba(201,168,76,.4)' : ''} />
      {#if showHeaderGenrePicker}
        <div class="header-genre-dropdown">
          {#if headerGenre}
            <button class="genre-opt" style="color:#555;font-style:italic" onclick={() => { headerGenre = ''; showHeaderGenrePicker = false }}>— Clear —</button>
          {/if}
          {#each availableGenres as g}
            <button class="genre-opt {headerGenre === g ? 'sel' : ''}" onclick={() => { headerGenre = g; showHeaderGenrePicker = false }}>{g}</button>
          {/each}
        </div>
      {/if}
    </div>
    <input class="tag-search-inp" bind:value={tagSearch} placeholder="tag1 tag2 94bpm..." />
    <div
      class="new-demo-dropzone {newDemoDragging ? 'drag-over' : ''}"
      ondragover={e => { e.preventDefault(); newDemoDragging = true }}
      ondragleave={() => newDemoDragging = false}
      ondrop={async e => {
        e.preventDefault(); newDemoDragging = false
        const file = e.dataTransfer.files[0]
        if (!file) return
        const ext = file.name.split('.').pop().toLowerCase()
        if (!['wav','mp3','aiff','aif','flac','m4a'].includes(ext)) {
          alert('Drop an audio file to create a demo')
          return
        }
        await createDemoFromDrop(file)
      }}>
      <span class="new-demo-drop-hint">↓ Drop audio to create demo</span>
      <button class="demo-add-btn" onclick={addSong}>+ New Demo</button>
    </div>
  {:else}
    <div class="patch-sort-row">
      <button class="sort-sm {patchView==='open'?'on':''}" onclick={() => patchView='open'}>OPEN</button>
      <button class="sort-sm {patchView==='archive'?'on':''}" onclick={() => patchView='archive'}>ARCHIVE</button>
    </div>
    <button class="btn-gold" onclick={() => showPatchModal = true}>+ New Submission</button>
  {/if}
</div>

{#if loading}
  <p class="empty">Loading...</p>

{:else if view === 'demos'}
  {#if !songs.length}
    <p class="empty">No demos yet. Hit + New Demo to start.</p>
  {:else}
    <div class="list">
      {#each filteredSongs as song (song.id)}
        {@const isExpanded = expandedId === song.id}
        <div class="card {isExpanded ? 'exp' : ''}">

          <!-- CARD HEADER -->
          <div class="card-head" onclick={() => toggleDemo(song)}>
            <div class="head-left">
              <div class="code-wrap">
                <div class="code-stars-row">
                  <span class="code">{song.code}</span>
                  <div class="stars" onclick={e => e.stopPropagation()}>
                    {#each [1,2,3] as n}
                      <button class="star {(song.rating||0) >= n ? 'on' : ''}"
                        onclick={() => { updateField(song, 'rating', (song.rating||0) === n ? 0 : n) }}>★</button>
                    {/each}
                  </div>
                </div>
                {#if song.title}<span class="song-title">{song.title}</span>{/if}
              </div>
              <div class="head-meta">
                {#each (song.tags || []).slice(0,3) as tag}
                  <span class="tag-sm">{tag}</span>
                {/each}
                {#if song.key}<span class="meta-pill">{song.key}</span>{/if}
                {#if song.tempo}<span class="meta-pill">{song.tempo} BPM</span>{/if}
                {#if song.work_data?.collaborator}<span class="meta-pill collab-pill">feat. {song.work_data.collaborator}</span>{/if}
                {#if song.notes}
                  <span class="notes-preview">{song.notes.slice(0,60)}{song.notes.length>60?'…':''}</span>
                {/if}
                {#if song.work_data?.auto_detected}
                  <span class="auto-badge">AUTO</span>
                {/if}
              </div>
            </div>

            <div class="head-right" onclick={e => e.stopPropagation()}>
              <div class="head-badges" onclick={e => e.stopPropagation()}>
                <div class="s-wrap">
                  {#if showBatchPicker[song.id]}
                    {@const openSubs = [...patches]
                      .filter(p => p.status !== 'sent' && p.status !== 'deleted')
                      .sort((a,b) => (a.songs.length === 0 ? -1 : 1) - (b.songs.length === 0 ? -1 : 1) || (a.created_at > b.created_at ? -1 : 1))}
                    <div class="s-picker-above" onclick={e => e.stopPropagation()}>
                      {#if openSubs.length}
                        <div class="s-pick-list">
                          {#each openSubs as sub}
                            {@const bContact = connections.find(c => c.id == sub.contact_id)}
                            <button class="s-pick-opt" onclick={() => { addSongToPatch(sub, song); showBatchPicker = {...showBatchPicker, [song.id]: false} }}>
                              <span class="s-pick-name">{sub.name}</span>
                              {#if bContact}<span class="s-pick-contact">→ {bContact.name}</span>{/if}
                              <span class="s-pick-count">{sub.songs.length} songs</span>
                            </button>
                          {/each}
                        </div>
                      {:else}
                        <div class="s-pick-empty">No open submissions — create one first</div>
                      {/if}
                    </div>
                  {/if}
                  <button class="s-btn {songBatchCount[song.id] >= 2 ? 'multi-batch' : songBatchCount[song.id] === 1 ? 'in-batch' : ''}"
                    onclick={e => { e.stopPropagation(); showBatchPicker = {...showBatchPicker, [song.id]: !showBatchPicker[song.id]} }}>S</button>
                </div>
              </div>
              {#key audioTick}
                {@const src = audioSrc(song)}
                <div class="player-slot">
                  {#if src}
                    <div class="player-wrap" onpointerdown={e => e.stopPropagation()}>
                      <audio class="mini-player" controls preload="auto"
                        src={src}
                        use:applyGain={song.id}></audio>
                      <button class="open-preview-btn" onclick={e => { e.stopPropagation(); openInPreview(song) }} title="Open in QuickTime">▶︎</button>
                    </div>
                  {:else if song.audio_path}
                    <button class="audio-ref clickable" onclick={e => { e.stopPropagation(); openInPreview(song) }} title="Open in QuickTime">🎵 {song.audio_path}</button>
                  {/if}
                </div>
              {/key}
            </div>
            <span class="arr" onclick={e => { e.stopPropagation(); toggleDemo(song) }}>▶</span>
          </div>

          <!-- CARD BODY -->
          {#if expandedId === song.id}
            <div class="card-body">
              <!-- Title row with inline audio drop -->
              <div class="title-audio-row">
                <div class="field" style="flex:0 0 90px">
                  <label>CODE</label>
                  <input class="inp-sm" value={song.code} onchange={e => updateField(song, 'code', e.target.value)} style="font-family:'Space Mono',monospace;font-size:12px" />
                </div>
                <div class="field" style="flex:1;min-width:0">
                  <label style="display:flex;align-items:center;gap:6px">
                    TITLE
                    <button class="btn-rand-title" onclick={() => handleTitleChange(song, randomTitle())} title="Random title">✦</button>
                  </label>
                  <input class="inp-sm" placeholder="Working title..." value={song.title || ''}
                    onchange={e => handleTitleChange(song, e.target.value)}
                    onkeydown={e => e.key === 'Enter' && e.target.blur()} />
                  {#if song.audio_path}
                    <div class="filename-hint">{song.audio_path}</div>
                  {/if}
                </div>
                <div class="field" style="flex:2">
                  <label>AUDIO</label>
                  <div class="drop-zone-inline {song._dragging ? 'drag-over' : ''}"
                    ondragover={e => { e.preventDefault(); song._dragging = true; songs = [...songs] }}
                    ondragleave={() => { song._dragging = false; songs = [...songs] }}
                    ondrop={e => handleAudioDrop(e, song)}>
                    {#if song.audio_path}
                      <span class="drop-path">🎵 {song.audio_path}</span>
                      <button class="drop-clear" onclick={() => clearAudio(song)}>×</button>
                    {:else}
                      <span class="drop-hint-sm">↓ Drop audio</span>
                    {/if}
                  </div>
                </div>
              </div>
              <div class="key-tempo-row">
                <div class="field" style="flex:0 0 130px">
                  <label>KEY</label>
                  <select class="inp-sm" value={song.key || ''} onchange={e => updateField(song, 'key', e.target.value)}>
                    <option value="">—</option>
                    {#each KEYS as k}<option value={k}>{k}</option>{/each}
                  </select>
                </div>
                <div class="field" style="flex-shrink:0">
                  <label>TEMPO</label>
                  <div class="tempo-input-row">
                    <input class="inp-sm" type="number" placeholder="120" value={song.tempo || ''} onchange={e => updateTempo(song, parseInt(e.target.value))} style="width:70px" />
                    {#if song.tempo}
                      <span class="bpm-alt" onclick={() => updateTempo(song, song._bpmHalf || Math.round(song.tempo / 2))}>÷2</span>
                      <span class="bpm-alt" onclick={() => updateTempo(song, song._bpmDouble || song.tempo * 2)}>×2</span>
                    {/if}
                  </div>
                </div>
                <div class="field" style="flex-shrink:0">
                  <label>FEAT.</label>
                  <input class="inp-sm" placeholder="Collaborator..."
                    style="width:220px;max-width:220px"
                    value={song.work_data?.collaborator || ''}
                    onchange={e => updateCollaborator(song, e.target.value)} />
                </div>
                {#if song.audio_path}
                  <button class="reanalyze-btn {song._analyzing ? 'loading' : ''}" onclick={() => reAnalyzeSong(song)}
                    title="Re-read key & tempo from file (run after Mixed In Key tags it)">
                    {song._analyzing ? '...' : '↻'}
                  </button>
                {/if}
              </div>
              <div class="field">
                <label>TAGS</label>
                <div class="tags-input-row" onclick={e => e.stopPropagation()}>
                  <!-- Genre dropdown - same width as KEY box -->
                  <div class="genre-picker-wrap" style="flex:0 0 130px">
                    <input class="inp-sm genre-search-inp" placeholder="+ Genre..."
                      value={genreSearch[song.id]||''}
                      oninput={e => { genreSearch = {...genreSearch, [song.id]: e.target.value}; showGenrePicker = {...showGenrePicker, [song.id]: true} }}
                      onfocus={() => { showGenrePicker = {...showGenrePicker, [song.id]: true} }} />
                    {#if showGenrePicker[song.id]}
                      {@const filteredGenres = availableGenres.filter(g => (!(genreSearch[song.id]||'') || g.includes((genreSearch[song.id]||'').toLowerCase())) && !(song.tags||[]).includes(g))}
                      {#if filteredGenres.length}
                        <div class="genre-dropdown">
                          {#each filteredGenres as g}
                            <button class="genre-opt" onclick={() => {
                              const tags = [...(song.tags||[]), g]
                              updateField(song, 'tags', tags)
                              saveTagPattern(song, tags)
                              genreSearch = {...genreSearch, [song.id]: ''}
                              showGenrePicker = {...showGenrePicker, [song.id]: false}
                            }}>{g}</button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                  <!-- Custom tag input - same width -->
                  <div style="flex:0 0 130px">
                    <input class="inp-sm" placeholder="Custom tag..." value={tagInput[song.id]||''}
                      oninput={e => tagInput = {...tagInput, [song.id]: e.target.value}}
                      onkeydown={e => e.key === 'Enter' && addTag(song)} />
                  </div>
                  <!-- Tags on same line -->
                  <div class="tags-inline">
                    {#each (song.tags || []) as tag}
                      <span class="tag">{tag}<button class="tag-del" onclick={() => removeTag(song, tag)}>×</button></span>
                    {/each}
                  </div>
                  <button class="btn-ghost-sm {song._generating ? 'dim' : ''}" style="margin-left:auto;flex-shrink:0" onclick={() => generateTags(song)}>
                    {song._generating ? '...' : '✦ Claude'}
                  </button>
                </div>
              </div>
              <div class="field">
                <label>REFERENCE LINKS</label>
                <div class="refs-wrap">
                  <div class="refs-inline">
                    {#each (song.reference_links || []) as ref}
                      {@const r = normRef(ref)}
                      {@const isSpotify = r.url.includes('spotify')}
                      <span class="ref-chip">
                        {#if isSpotify}
                          <button class="spotidown-btn" onclick={() => { navigator.clipboard.writeText(r.url); window.open('https://spotidown.app/de4', '_blank') }} title="Download from Spotidown">↓</button>
                          <button class="spotify-play-btn" onclick={() => openSpotifyPopup(r.url)}>▶</button>
                        {:else}
                          <a href={r.url} target="_blank" rel="noopener" class="ref-link-open">↗</a>
                        {/if}
                        <span class="ref-chip-name">{r.name || r.url}</span>
                        <button class="tag-del" onclick={() => removeRef(song, r.url)}>×</button>
                      </span>
                    {/each}
                  </div>
                  <div class="ref-add">
                    <input class="inp-sm" placeholder="Spotify / YouTube URL..." bind:value={refInput[song.id]} onkeydown={e => e.key === 'Enter' && addRef(song)} />
                    <button class="btn-ghost-sm" onclick={() => addRef(song)}>+ Add</button>
                  </div>
                </div>
              </div>
              <div class="row2">
                <div class="field">
                  <label>NOTES</label>
                  <textarea class="ta" placeholder="Production notes..." value={song.notes || ''} oninput={e => updateField(song, 'notes', e.target.value)}></textarea>
                </div>
                <div class="field">
                  <label>FEEDBACK</label>
                  <textarea class="ta" placeholder="Feedback received..." value={song.feedback || ''} oninput={e => updateField(song, 'feedback', e.target.value)}></textarea>
                </div>
              </div>
              <div class="card-footer">
                <button class="btn-delete" onclick={() => remove(song.id)}>Delete</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

{:else}
  {#if !patches.length}
    <p class="empty">No submissions yet. Create one to group demos for sending.</p>
  {:else}
    <div class="list">
      {#each sortedPatches as patch (patch.id)}
        {@const dropCount = (subDropFiles[patch.id]?.length || 0) + patch.songs.length}
        <div class="patch-card {expandedPatchId === patch.id ? 'exp' : ''}">
          <div class="patch-head" onclick={() => expandedPatchId = expandedPatchId === patch.id ? null : patch.id}>
            <div class="patch-info">
              <span class="patch-name">{patch.name}</span>
              {#if patch.artist}<span class="patch-contact">{patch.artist}</span>{/if}
            </div>
            {#if patch.folder_link}
              <button class="patch-link-btn" onclick={e => { e.stopPropagation(); openLink(patch.folder_link) }} title={patch.folder_link}>📁</button>
            {/if}
            <button class="patch-listen-btn" onclick={e => { e.stopPropagation(); createShareSession(patch) }} title="Generate listen link">↗</button>
            {#if patch.status === 'open'}
              <span class="patch-count">{dropCount} files</span>
            {:else}
              <span class="patch-count">{patch.songs.length} songs</span>
            {/if}
            {#if sessionDownloads[patch.name]?.codes?.length}
              <span class="patch-dl-badge" title="Downloaded: {sessionDownloads[patch.name].codes.join(', ')}">
                ↓ {sessionDownloads[patch.name].codes.length}
              </span>
            {/if}
            <span class="patch-status {patch.status} {patch.feedback ? 'has-feedback' : ''}">{patch.status.toUpperCase()}</span>
            {#if patch.status !== 'archived'}
              <button class="patch-archive-btn" onclick={e => { e.stopPropagation(); archivePatch(patch.id) }}>Archive</button>
            {/if}
            <button class="del" onclick={e => { e.stopPropagation(); deletePatch(patch.id) }}>×</button>
            <span class="arr">▶</span>
          </div>

          {#if expandedPatchId === patch.id}
            <div class="patch-body">

              {#if patch.status !== 'sent'}
                <!-- Drop zone -->
                <div class="sub-drop-zone {subDragging[patch.id] ? 'drag-over' : ''}"
                  ondragover={e => { e.preventDefault(); subDragging = {...subDragging, [patch.id]: true} }}
                  ondragleave={() => { subDragging = {...subDragging, [patch.id]: false} }}
                  ondrop={e => handleSubDrop(e, patch)}>
                  <span class="sub-drop-hint">↓ Drop audio files here (.wav .mp3 .aiff .m4a)</span>
                </div>

                <!-- File list -->
                {#if dropCount > 0}
                  <div class="patch-songs">
                    {#each (subDropFiles[patch.id] || []) as df}
                      <div class="patch-song-row">
                        {#if df.code}<span class="song-code-in-list">{df.code}</span><span class="sep-dot">·</span>{/if}
                        <span class="sub-filename">{df.title || df.filename}</span>
                        {#if df.bpm}<span class="meta-pill">{df.bpm} BPM</span>{/if}
                        {#if df.prev_sent?.length}
                          <span class="prev-sent-row">
                            sent:
                            {#each df.prev_sent as pp}
                              <span class="prev-sent-chip">{pp}</span>
                            {/each}
                          </span>
                        {/if}
                        <button class="sold-btn" onclick={() => alert('Coming soon — will create release and lock demo')}>SOLD</button>
                        <button class="del" onclick={() => removeDropFile(patch.id, df.filename)}>×</button>
                      </div>
                    {/each}
                    {#each patch.songs as song}
                      <div class="patch-song-row">
                        <span class="song-code-in-list">{song.code}</span>
                        <span class="sep-dot">·</span>
                        <span class="song-title">{song.title || song.code}</span>
                        <button class="sold-btn" onclick={() => alert('Coming soon — will create release and lock demo')}>SOLD</button>
                        <button class="del" onclick={() => removeSongFromPatch(patch, song.id)}>×</button>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="empty-sm">No files yet — drop audio above or use S on demo cards.</p>
                {/if}

                <div class="patch-footer">
                  <button class="btn-send" onclick={() => sendPatch(patch)}>→ Send Submission ({dropCount} files)</button>
                </div>
                <ListenLinkBlock bind:backgroundStyle={selectedBg} ongenerate={() => createShareSession(patch)} />
              {:else}
                <div class="sent-info">
                  <span>Sent {patch.sent_at ? new Date(patch.sent_at).toLocaleDateString('de-CH') : ''}</span>
                  {#if patch.folder_link}
                    <button class="link-open-btn" onclick={() => openLink(patch.folder_link)}>📁 {patch.folder_link.length > 40 ? '…'+patch.folder_link.slice(-38) : patch.folder_link}</button>
                  {/if}
                </div>
                {#if patch.songs.length}
                  <div class="patch-songs">
                    {#each patch.songs as song}
                      <div class="patch-song-row">
                        <span class="song-code-in-list">{song.code}</span>
                        <span class="sep-dot">·</span>
                        <span class="song-title">{song.title || song.code}</span>
                        {#if sessionDownloads[patch.name]?.codes?.includes(song.code)}
                          <span class="song-dl-indicator" title="Downloaded by recipient">↓ downloaded</span>
                        {/if}
                        <button class="sold-btn" onclick={() => alert('Coming soon — will create release and lock demo')}>SOLD</button>
                      </div>
                    {/each}
                  </div>
                {/if}
                <ListenLinkBlock bind:backgroundStyle={selectedBg} ongenerate={() => createShareSession(patch)} />
                <div class="field" style="padding:0 0 4px">
                  <label>FEEDBACK RECEIVED</label>
                  <textarea class="ta-sm" placeholder="Paste feedback from the artist / label here..." value={patch.feedback||''} oninput={e => updatePatchField(patch, 'feedback', e.target.value)}></textarea>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

</div><!-- end demo-main -->

<!-- Right panel: Mozart -->
<div class="demo-right">
  <div class="mozart-block">
    <div class="mozart-title-row">
      <div class="mozart-title">ASK MOZART</div>
      {#if aiMessages.length}
        <button class="clear-chat" onclick={() => aiMessages = []}>Clear</button>
      {/if}
    </div>
    <div class="chat-input-row">
      <input class="chat-inp" bind:value={aiInput} placeholder="Ask anything..." onkeydown={e=>e.key==='Enter'&&sendAI()} />
      <button class="btn-gold-sm" onclick={sendAI}>Ask</button>
    </div>
    <div class="chat-out">
      {#each aiMessages as msg}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
          <div class="chat-text">{msg.content}</div>
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
      {/if}
    </div>
  </div>
</div>

</div><!-- end demo-layout -->

{#if showPatchModal}
  <div class="modal-bg" onclick={() => { showPatchModal = false; newPatchContact = ''; showNewPatchContactPicker = false }}>
    <div class="modal" onclick={e => e.stopPropagation()}>
      <div class="modal-title">New Submission</div>
      <div class="field">
        <label>ARTIST / LABEL NAME</label>
        <input class="inp-sm" placeholder="e.g. SONY, CAPITAL BRA, NIDJO..."
          bind:value={newPatchArtistName}
          onkeydown={e => e.key === 'Enter' && createPatch()} />
      </div>
      <div class="field" style="margin-top:6px">
        <label>SEND TO <span style="font-weight:300;color:#444;text-transform:none">— optional</span></label>
        <div class="contact-current" onclick={() => showNewPatchContactPicker = !showNewPatchContactPicker}>
          {#if newPatchContact}
            <span class="contact-chosen">{connections.find(c => c.id == newPatchContact)?.name || '—'}</span>
          {:else}
            <span class="contact-none">— No contact —</span>
          {/if}
          <span class="contact-arr">▶</span>
        </div>
        {#if showNewPatchContactPicker}
          <div class="contact-list">
            <button class="contact-opt {!newPatchContact?'sel':''}" onclick={() => { newPatchContact = ''; showNewPatchContactPicker = false }}>— None —</button>
            {#each connections.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')) as c}
              <button class="contact-opt {newPatchContact == c.id ? 'sel' : ''}" onclick={() => { newPatchContact = c.id; showNewPatchContactPicker = false }}>{c.name}</button>
            {/each}
          </div>
        {/if}
      </div>
      {#if newPatchArtistName.trim() || newPatchContact}
        {@const safe = s => (s||'').toUpperCase().replace(/[^A-Z0-9 ]/g,'').trim().replace(/\s+/g,'_')}
        {@const artistPart = safe(newPatchArtistName.trim())}
        {@const contactPart = safe(connections.find(c => c.id == newPatchContact)?.name || '')}
        {@const parts = [contactPart, artistPart].filter(Boolean)}
        <div class="patch-name-preview">{String(new Date().getFullYear()).slice(2)}???_{parts.length ? parts.join('_') : 'DEMOS'}</div>
      {/if}
      <button class="btn-gold-full" style="margin-top:10px" onclick={createPatch}>Create Submission</button>
      <button class="modal-cancel" onclick={() => { showPatchModal = false; newPatchContact = ''; showNewPatchContactPicker = false }}>Cancel</button>
    </div>
  </div>
{/if}

<!-- Background Picker Modal -->
{#if false}{/if}<!-- bg picker now inline in patch body -->

<style>
  .demo-layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; min-height: calc(100vh - 100px); }
  .demo-main { display: flex; flex-direction: column; min-width: 0; }
  .demo-right { border-left: 1px solid #1c1c1c; padding-left: 24px; display: flex; flex-direction: column; }
  .mozart-block { display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .mozart-title-row { display: flex; align-items: center; justify-content: space-between; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); margin-bottom: 2px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: #555; color: #9e9690; }
  .chat-input-row { display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 8px 11px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }
  .chat-out { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-size: 14px; color: #cec9c1; line-height: 1.6; }
  .chat-text.dim { color: #444; }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; padding: 7px 13px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .title { font-family: 'Space Mono', monospace; font-size: 17px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #c9a84c; }
  .view-tabs { display: flex; border: 1px solid #303030; border-radius: 3px; overflow: hidden; }
  .vtab { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; padding: 6px 14px; background: transparent; border: none; color: #555; cursor: pointer; transition: all .15s; }
  .vtab.on { background: #c9a84c; color: #0a0a0a; }
  .btn-gold { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 8px 16px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; margin-left: auto; }
  .empty { font-family: 'Space Mono', monospace; font-size: 12px; color: #9e9690; padding: 32px 0; text-align: center; }
  .empty-sm { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 8px 0; }
  .list { display: flex; flex-direction: column; gap: 8px; }

  .card { border: 1px solid #303030; border-radius: 4px; overflow: visible; }
  .card.exp { border-color: rgba(201,168,76,.5); }
  .card-head { padding: 0 14px; height: 52px; display: flex; align-items: center; gap: 10px; cursor: pointer; background: #1c1c1c; user-select: none; transition: background .15s; overflow: visible; position: relative; }
  .card-head:hover { background: #252525; }
  .card.exp .card-head { background: #252525; }
  .head-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; overflow: hidden; }
  .head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; width: 420px; justify-content: flex-end; }
  .player-slot { width: 250px; flex-shrink: 0; display: flex; align-items: center; }
  .head-badges { display: flex; align-items: center; gap: 6px; flex-shrink: 0; width: 150px; justify-content: flex-end; }
  .notes-preview { font-size: 10px; color: #444; font-style: italic; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; }
  .code-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 90px; flex-shrink: 0; }
  .code-stars-row { display: flex; align-items: center; gap: 6px; }
  .stars { display: flex; gap: 1px; }
  .star { background: transparent; border: none; font-size: 11px; color: #2a2a2a; cursor: pointer; padding: 0; line-height: 1; }
  .star.on { color: #4caf82; }
  .star:hover { color: #4caf82; }
  .code { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #c9a84c; }
  .song-title { font-size: 12px; color: #9e9690; }
  .head-meta { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; align-items: center; min-width: 0; overflow: hidden; }
  .tag-sm { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 2px; background: rgba(201,168,76,.08); border: 1px solid rgba(201,168,76,.2); color: #c9a84c; }
  .meta-pill { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 6px; border-radius: 2px; background: #252525; border: 1px solid #303030; color: #9e9690; }
  .auto-badge { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 5px; border-radius: 2px; color: #4caf82; border: 1px solid rgba(76,175,130,.35); background: rgba(76,175,130,.06); flex-shrink: 0; }
  .collab-pill { color: rgba(201,168,76,.85) !important; border-color: rgba(201,168,76,.25) !important; }
  .filename-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: #3a3a3a; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .1em; padding: 3px 8px; border-radius: 2px; border: 1px solid; flex-shrink: 0; }
  .arr { font-size: 11px; color: #9e9690; transition: transform .2s; flex-shrink: 0; }
  .card.exp .arr { transform: rotate(90deg); }
  .patch-card.exp .arr { transform: rotate(90deg); }
  .s-wrap { position: relative; display: flex; align-items: center; }
  .s-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 2px 7px; background: transparent; border: 1px solid rgba(76,175,130,.5); color: #4caf82; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .s-btn:hover { background: rgba(76,175,130,.1); }
  .s-btn.in-batch { border-color: rgba(74,159,212,.6); color: #4a9fd4; }
  .s-btn.in-batch:hover { background: rgba(74,159,212,.1); }
  .s-btn.multi-batch { border-color: rgba(224,90,74,.6); color: #e05a4a; }
  .s-btn.multi-batch:hover { background: rgba(224,90,74,.1); }
  .tag-search-inp { font-family: 'Space Mono', monospace; font-size: 11px; padding: 5px 10px; background: #1c1c1c; border: 1px solid #252525; color: #cec9c1; border-radius: 3px; outline: none; width: 140px; cursor: pointer; }
  .tag-search-inp:focus { border-color: rgba(201,168,76,.4); }
  .tag-search-inp::placeholder { color: #333; }
  .header-genre-wrap { position: relative; }
  .header-genre-dropdown { position: absolute; top: calc(100% + 4px); left: 0; min-width: 160px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 999; max-height: 220px; overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
  .genre-opt.sel { color: #c9a84c; background: rgba(201,168,76,.06); }
  .s-picker-above { position: absolute; bottom: calc(100% + 6px); right: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 4px; min-width: 240px; z-index: 99; overflow: hidden; box-shadow: 0 -4px 20px rgba(0,0,0,.5); }
  .s-pick-list { max-height: 220px; overflow-y: auto; }
  .s-pick-opt { display: flex; align-items: center; gap: 6px; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px 12px; background: transparent; border: none; border-bottom: 1px solid #252525; color: #9e9690; cursor: pointer; text-align: left; }
  .s-pick-opt:last-child { border-bottom: none; }
  .s-pick-opt:hover { background: #252525; color: #c9a84c; }
  .s-pick-name { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-pick-contact { color: #4caf82; font-size: 10px; flex-shrink: 0; }
  .s-pick-count { color: #444; font-size: 10px; flex-shrink: 0; }
  .s-pick-empty { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 8px 12px; }
  .s-picker { position: absolute; top: 100%; right: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; min-width: 200px; z-index: 99; box-shadow: 0 4px 20px rgba(0,0,0,.5); overflow: hidden; margin-top: 2px; }
  .s-pick-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px 12px; background: transparent; border: none; border-bottom: 1px solid #252525; color: #9e9690; cursor: pointer; text-align: left; }
  .s-pick-opt:last-child { border-bottom: none; }
  .s-pick-opt:hover { background: #252525; color: #c9a84c; }
  .s-pick-empty { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 8px 12px; }
  .patch-sort-row { display: flex; gap: 4px; }
  .sort-sm { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 4px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .sort-sm.on { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .btn-release { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; background: transparent; border: 1px solid rgba(224,90,74,.4); color: #e05a4a; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .btn-release:hover { background: rgba(224,90,74,.08); }

  .mini-player { height: 40px; flex-shrink: 0; max-width: 220px; accent-color: #c9a84c; }
  .audio-ref { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .audio-ref.clickable { background: transparent; border: none; cursor: pointer; padding: 0; color: #4a9fd4; }
  .audio-ref.clickable:hover { color: #c9a84c; }
  .open-preview-btn { font-family: 'Space Mono', monospace; font-size: 11px; padding: 3px 7px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; margin-left: 4px; }
  .open-preview-btn:hover { border-color: #c9a84c; color: #c9a84c; }

  .card-body { padding: 16px; border-top: 1px solid #303030; display: flex; flex-direction: column; gap: 14px; background: #0a0a0a; }
  .key-tempo-row { display: flex; gap: 8px; align-items: center; }
  .key-tempo-row .field { flex-shrink: 0; }
  .reanalyze-btn { font-family: 'Space Mono', monospace; font-size: 13px; padding: 4px 8px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; margin-bottom: 1px; flex-shrink: 0; }
  .reanalyze-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .reanalyze-btn.loading { color: #333; cursor: wait; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-head { display: flex; align-items: center; justify-content: space-between; }
  label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #9e9690; }
  .inp-sm { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 6px 10px; outline: none; border-radius: 3px; width: 100%; }
  .tempo-input-row { display: flex; align-items: center; gap: 2px; }
  .bpm-alt { font-family: 'Space Mono', monospace; font-size: 9px; color: #2e2e2e; cursor: pointer; padding: 2px 4px; background: #111; border: 1px solid #1e1e1e; border-radius: 2px; white-space: nowrap; line-height: 1; }
  .bpm-alt:hover { color: #c9a84c; border-color: rgba(201,168,76,.3); }
  .inp-sm:focus { border-color: rgba(201,168,76,.5); }
  .ta { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 300; padding: 8px 10px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 80px; line-height: 1.6; }
  .ta:focus { border-color: rgba(201,168,76,.5); }

  .drop-zone { border: 1px dashed #3c3c3c; border-radius: 3px; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; transition: all .15s; min-height: 42px; justify-content: center; }
  .drop-zone.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.06); }
  .drop-file-row { display: flex; align-items: center; gap: 8px; }
  .drop-path { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; word-break: break-all; flex: 1; }
  .drop-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; text-align: center; }
  .drop-rehint { font-family: 'Space Mono', monospace; font-size: 10px; color: #333; }
  .drop-clear { background: transparent; border: none; color: #555; font-size: 16px; cursor: pointer; flex-shrink: 0; padding: 0; }
  .drop-clear:hover { color: #e05a4a; }

  .tags-input-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tags-inline { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; flex: 1; }
  .genre-picker-wrap { position: relative; }
  .genre-search-inp { width: 100%; }
  .genre-dropdown { position: absolute; top: calc(100% + 2px); left: 0; min-width: 160px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; z-index: 99; max-height: 160px; overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
  .genre-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 10px; background: transparent; border: none; border-bottom: 1px solid #1a1a1a; color: #9e9690; cursor: pointer; text-align: left; }
  .genre-opt:last-child { border-bottom: none; }
  .genre-opt:hover { background: #252525; color: #c9a84c; }
  .genre-header-label { font-weight: 700; color: rgba(201,168,76,.75); font-size: 9px; letter-spacing: .1em; padding: 5px 10px 2px; pointer-events: none; cursor: default; background: transparent; border: none; }
  .tag { font-family: 'Space Mono', monospace; font-size: 11px; padding: 3px 8px; border-radius: 2px; background: rgba(201,168,76,.1); border: 1px solid rgba(201,168,76,.3); color: #c9a84c; display: flex; align-items: center; gap: 4px; }
  .tag-del { background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 14px; opacity: .6; }
  .tag-del:hover { opacity: 1; }
  .tag-inp { background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 3px 8px; outline: none; border-radius: 3px; width: 120px; }
  .refs-wrap { display: flex; flex-direction: column; gap: 6px; }
  .refs-inline { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .ref-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; }
  .ref-chip-name { font-size: 13px; color: #cec9c1; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-row { display: flex; align-items: center; gap: 8px; }
  .ref-label { font-size: 13px; color: #cec9c1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-link-open { font-family: 'Space Mono', monospace; font-size: 10px; color: #4a9fd4; text-decoration: none; flex-shrink: 0; }
  .ref-link-open:hover { text-decoration: underline; }
  .spotidown-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 3px 7px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .spotidown-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .spotify-play-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 9px; background: rgba(30,215,96,.08); border: 1px solid rgba(30,215,96,.4); color: #1ed760; border-radius: 2px; cursor: pointer; flex-shrink: 0; font-weight: 700; }
  .spotify-play-btn:hover { background: rgba(30,215,96,.15); }
  .spotify-embed-wrap { margin: 4px 0 6px; border-radius: 8px; overflow: hidden; }

  .ref-add { display: flex; gap: 8px; align-items: center; }
  .btn-ghost-sm { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 4px 10px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .btn-ghost-sm:hover { border-color: #c9a84c; color: #c9a84c; }
  .btn-ghost-sm.dim { opacity: .5; pointer-events: none; }
  .title-audio-row { display: flex; gap: 8px; align-items: flex-start; }
  .drop-zone-inline { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #0d0d0d; border: 1px dashed #252525; border-radius: 3px; min-height: 36px; transition: border-color .15s; cursor: copy; }
  .drop-zone-inline.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .drop-zone-inline:hover { border-color: #303030; }
  .drop-hint-sm { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; }
  .drop-path { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn-rand-title { background: transparent; border: 1px solid #303030; color: #555; font-size: 10px; padding: 1px 5px; border-radius: 2px; cursor: pointer; font-family: 'Space Mono', monospace; line-height: 1; }
  .btn-rand-title:hover { border-color: #c9a84c; color: #c9a84c; }
  .card-footer { display: flex; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid #1c1c1c; }
  .archive-section { margin-top: 16px; border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; }
  .archive-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 14px; background: #111; border: none; cursor: pointer; }
  .archive-toggle:hover { background: #1c1c1c; }
  .archive-title { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; color: #444; }
  .archive-arr { font-size: 9px; color: #444; transition: transform .2s; }
  .archive-arr.open { transform: rotate(90deg); }
  .archive-list { display: flex; flex-direction: column; }
  .archive-row { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-top: 1px solid #1a1a1a; background: #0a0a0a; }
  .archive-name { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex-shrink: 0; }
  .archive-contact { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; flex-shrink: 0; }
  .archive-date { font-family: 'Space Mono', monospace; font-size: 10px; color: #333; flex-shrink: 0; }
  .archive-codes { font-family: 'Space Mono', monospace; font-size: 10px; color: #333; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .batch-pick-list { position: absolute; bottom: calc(100% + 4px); left: 0; background: #1c1c1c; border: 1px solid #303030; border-radius: 4px; min-width: 220px; z-index: 99; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.5); }
  .batch-pick-opt { display: block; width: 100%; font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; padding: 9px 14px; background: transparent; border: none; border-bottom: 1px solid #252525; color: #9e9690; cursor: pointer; text-align: left; }
  .batch-pick-opt:last-child { border-bottom: none; }
  .batch-pick-opt:hover { background: #252525; color: #c9a84c; }
  .batch-pick-empty { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; padding: 10px 14px; }
  .btn-delete { font-family: 'Space Mono', monospace; font-size: 11px; padding: 6px 12px; background: transparent; border: 1px solid rgba(224,90,74,.3); color: #e05a4a; border-radius: 3px; cursor: pointer; }

  .patch-card { border: 1px solid #303030; border-radius: 4px; overflow: hidden; }
  .patch-card.exp { border-color: rgba(74,159,212,.4); }
  .patch-head { padding: 12px 16px; display: flex; align-items: center; gap: 10px; cursor: pointer; background: #1c1c1c; user-select: none; transition: background .15s; overflow: hidden; }
  .patch-head:hover { background: #252525; }
  .patch-card.exp .patch-head { background: #252525; }
  .patch-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; overflow: hidden; }
  .patch-name { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #cec9c1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .patch-card.exp .patch-name { color: #4a9fd4; }
  .patch-contact { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #4a9fd4; }
  .patch-no-contact { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .patch-link-btn { background: transparent; border: none; font-size: 16px; cursor: pointer; padding: 0 4px; flex-shrink: 0; line-height: 1; }
  .patch-listen-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 2px 7px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; transition: all .15s; }
  .patch-listen-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .patch-notes-row { padding: 12px 14px; border-bottom: 1px solid #1c1c1c; }
  .audio-ok { font-size: 12px; flex-shrink: 0; }
  .audio-missing { font-family: 'Space Mono', monospace; font-size: 10px; color: #e05a4a; flex-shrink: 0; }
  .ta-sm { background: #111; border: 1px solid #252525; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; resize: vertical; border-radius: 3px; width: 100%; min-height: 55px; line-height: 1.5; }
  .ta-sm:focus { border-color: rgba(201,168,76,.4); }
  .label-hint { font-size: 10px; color: #444; letter-spacing: .04em; text-transform: none; font-weight: 300; font-family: 'DM Sans', sans-serif; }
  .link-drop-zone { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: #080808; border: 1px dashed #252525; border-radius: 3px; min-height: 36px; transition: border-color .15s; margin-bottom: 5px; }
  .link-drop-zone.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .link-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; flex: 1; }
  .link-open-btn { font-family: 'Space Mono', monospace; font-size: 11px; color: #4a9fd4; background: transparent; border: none; cursor: pointer; text-align: left; flex: 1; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link-open-btn:hover { text-decoration: underline; }
  .in-batch-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 2px; color: #9b6fd4; border: 1px solid rgba(155,111,212,.4); background: rgba(155,111,212,.06); flex-shrink: 0; }
  .proj-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 2px; color: #c9a84c; border: 1px solid rgba(201,168,76,.3); background: rgba(201,168,76,.06); flex-shrink: 0; }
  .contact-current { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: #111; border: 1px solid #303030; border-radius: 3px; cursor: pointer; transition: border-color .15s; }
  .contact-current:hover { border-color: #c9a84c; }
  .contact-chosen { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; color: #4a9fd4; flex: 1; }
  .contact-none { font-family: 'Space Mono', monospace; font-size: 12px; color: #444; flex: 1; }
  .contact-arr { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .contact-list { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; max-height: 200px; overflow-y: auto; border: 1px solid #303030; border-radius: 3px; background: #0a0a0a; }
  .contact-opt { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; padding: 8px 12px; background: transparent; border: none; color: #9e9690; cursor: pointer; text-align: left; border-bottom: 1px solid #111; transition: all .1s; }
  .contact-opt:last-child { border-bottom: none; }
  .contact-opt:hover { background: #1c1c1c; color: #c9a84c; }
  .contact-group-label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .12em; color: #4caf82; padding: 10px 12px 5px; text-transform: uppercase; border-bottom: 1px solid #252525; border-top: 1px solid #1a1a1a; background: #0f0f0f; margin-top: 2px; }
  .contact-opt.sel { color: #4a9fd4; background: rgba(74,159,212,.06); }
  .player-wrap { display: flex; align-items: center; flex-shrink: 0; min-width: 220px; }
  .mini-player { height: 40px; width: 100%; max-width: 220px; accent-color: #c9a84c; }
  .btn-send { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .08em; padding: 10px 20px; background: rgba(74,159,212,.1); border: 1px solid rgba(74,159,212,.4); color: #4a9fd4; border-radius: 3px; cursor: pointer; width: 100%; }
  .btn-send:hover { background: rgba(74,159,212,.18); }
  .patch-count { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .patch-dl-badge { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 1px 6px; background: rgba(76,175,130,.1); border: 1px solid rgba(76,175,130,.4); color: #4caf82; border-radius: 2px; flex-shrink: 0; }
  .song-dl-indicator { font-family: 'Space Mono', monospace; font-size: 9px; color: #4caf82; padding: 1px 5px; border: 1px solid rgba(76,175,130,.3); border-radius: 2px; flex-shrink: 0; }
  .patch-status { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 2px; border: 1px solid; }
  .patch-status.open { color: #c9a84c; border-color: rgba(201,168,76,.3); background: rgba(201,168,76,.06); }
  .patch-status.sent { color: #4a9fd4; border-color: rgba(74,159,212,.3); background: rgba(74,159,212,.06); }
  .patch-status.sent.has-feedback { color: #4caf82; border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.08); }
  .patch-status.archived { color: #555; border-color: #303030; background: transparent; }
  .patch-archive-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 7px; background: transparent; border: 1px solid rgba(201,168,76,.3); color: rgba(201,168,76,.7); border-radius: 2px; cursor: pointer; flex-shrink: 0; letter-spacing: .06em; }
  .patch-archive-btn:hover { background: rgba(201,168,76,.08); color: #c9a84c; }
  .song-code-in-list { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: #c9a84c; flex-shrink: 0; }
  .sep-dot { color: #333; font-size: 10px; flex-shrink: 0; padding: 0 2px; }
  .sold-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; padding: 2px 7px; background: transparent; border: 1px solid rgba(224,90,74,.35); color: #e05a4a; border-radius: 2px; cursor: pointer; flex-shrink: 0; letter-spacing: .06em; }
  .sold-btn:hover { background: rgba(224,90,74,.08); }
  .del { background: transparent; border: none; color: #555; font-size: 18px; cursor: pointer; padding: 0 4px; flex-shrink: 0; }
  .del:hover { color: #e05a4a; }
  .patch-body { padding: 16px; border-top: 1px solid #303030; display: flex; flex-direction: column; gap: 12px; background: #0a0a0a; }
  .patch-songs { display: flex; flex-direction: column; gap: 4px; }
  .patch-song-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #1c1c1c; border-radius: 3px; border: 1px solid #252525; }
  .patch-add-section { border-top: 1px solid #1c1c1c; padding-top: 12px; }
  .sh-sm { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #555; margin-bottom: 8px; }
  .free-songs { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto; }
  .free-song-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #111; border-radius: 3px; border: 1px solid #1c1c1c; cursor: pointer; transition: all .15s; }
  .free-song-row:hover { background: #1c1c1c; border-color: rgba(201,168,76,.3); }
  .add-icon { font-family: 'Space Mono', monospace; font-size: 16px; color: #c9a84c; flex-shrink: 0; }
  .patch-footer { border-top: 1px solid #1c1c1c; padding-top: 12px; }
  .sent-info { display: flex; flex-direction: column; gap: 4px; }
  .sent-info span { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .sent-hint { font-size: 10px !important; color: #333 !important; }

  .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 999; display: flex; align-items: center; justify-content: center; }
  .modal { background: #1c1c1c; border: 1px solid #303030; border-radius: 6px; padding: 24px; width: 380px; display: flex; flex-direction: column; gap: 8px; }
  .modal-title { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; color: #f5f1ea; margin-bottom: 8px; }
  .gold { color: #c9a84c; }
  .btn-gold-full { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 10px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; margin-top: 4px; }
  .patch-name-preview { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; padding: 7px 0 2px; border-top: 1px solid #1c1c1c; margin-top: 10px; letter-spacing: .04em; }
  .modal-cancel { font-family: 'Space Mono', monospace; font-size: 11px; padding: 8px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 3px; cursor: pointer; }
  .modal-cancel:hover { color: #9e9690; }
  .sub-drop-zone { border: 1px dashed #303030; border-radius: 3px; padding: 14px 16px; display: flex; align-items: center; justify-content: center; background: #080808; transition: all .15s; cursor: copy; }
  .sub-drop-zone.drag-over { border-color: #4a9fd4; background: rgba(74,159,212,.05); }
  .sub-drop-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; }
  .sub-drop-zone.drag-over .sub-drop-hint { color: #4a9fd4; }
  .sub-filename { font-family: 'Space Mono', monospace; font-size: 11px; color: #cec9c1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prev-sent-row { display: flex; align-items: center; gap: 4px; flex-shrink: 0; font-family: 'Space Mono', monospace; font-size: 9px; color: #555; }
  .prev-sent-chip { font-family: 'Space Mono', monospace; font-size: 9px; padding: 1px 5px; border-radius: 2px; background: rgba(224,90,74,.08); border: 1px solid rgba(224,90,74,.3); color: #e05a4a; white-space: nowrap; }
  .bg-options { display: flex; flex-direction: column; gap: 6px; }
  .bg-opt { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #141414; border: 1px solid #252525; border-radius: 4px; cursor: pointer; text-align: left; transition: all .15s; }
  .bg-opt:hover { border-color: #303030; background: #1c1c1c; }
  .bg-opt.on { border-color: rgba(201,168,76,.6); background: rgba(201,168,76,.06); }
  .bg-opt-label { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #cec9c1; }
  .bg-opt.on .bg-opt-label { color: #c9a84c; }
  .bg-opt-desc { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; }
  .new-demo-dropzone { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px dashed #252525; border-radius: 3px; background: #080808; transition: all .15s; }
  .new-demo-dropzone.drag-over { border-color: #4caf82; background: rgba(76,175,130,.05); }
  .new-demo-drop-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; flex: 1; }
  .new-demo-dropzone.drag-over .new-demo-drop-hint { color: #4caf82; }
  .demo-add-btn { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; padding: 6px 14px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  .demo-add-btn:hover { background: #d4b660; }
</style>