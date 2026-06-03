<script>
  import { supabase } from './supabase.js'
  import { buildMozartContext, parseActions, executeAction } from './mozartContext.js'
  import { onMount } from 'svelte'

  const today = new Date().toDateString()
  const todayISO = new Date().toISOString().slice(0,10)

  let state = $state({
    date: today, ticks: {}, customs: [], healthChecks: {}, healthTicks: {},
    helpers: [], helperTicks: {},
    checkItems: [], checkTicks: {}
  })

  let projects = $state([])
  let projectSongs = $state({})
  let allSongs_ = $state([])
  let demoSongs_ = $state([])
  let loading = $state(true)

  // Inline preview audio
  let inlineAudio = null
  let inlinePlayingUrl = $state('')
  let activeSection = $state('routine')

  let newCheck = $state('')
  let newCheckUrl = $state('')
  let normDragging = $state(false)
  let normStatus = $state('')   // '' | 'working' | 'ok' | 'err'
  let normMsg = $state('')
  let titleGenInput = $state('')
  let titleGenLoading = $state(false)
  let titleGenResults = $state([])

  let acapellaFile = $state(null)
  let acapellaLoading = $state(false)
  let acapellaResult = $state(null)
  let acapellaDragging = $state(false)

  let midiFile = $state(null)
  let midiLoading = $state(false)
  let midiResult = $state(null)
  let midiDragging = $state(false)
  let midiSteps = $state([])

  let abletonConnected = $state(false)
  let abletonInstruction = $state('')
  let abletonMode = $state('single')  // 'single' | 'sequence'
  let abletonLoading = $state(false)
  let abletonResponse = $state(null)
  let abletonSteps = $state([])

  let refUrl = $state('')
  let recentRefMoves = $state([])

  async function openSpotidown() {
    const url = refUrl.trim()
    if (url) {
      try { await navigator.clipboard.writeText(url) } catch(_) {}
    }
    window.open('https://spotidown.app/de4', '_blank')
    pollRefMoves()
  }

  async function pollRefMoves() {
    try {
      const r = await fetch('http://localhost:4242/recent-reference-moves')
      const d = await r.json()
      if (Array.isArray(d.files)) recentRefMoves = d.files
    } catch(_) {}
  }

  const ABLETON_TOOLS = [
    { cat: 'SESSION', tools: [
      { name: 'get_session_info', hint: 'Get info about the current session' },
      { name: 'get_session_path', hint: 'Get the current session file path' },
      { name: 'is_session_modified', hint: 'Check if session has unsaved changes' },
      { name: 'get_current_view', hint: 'Get the current view' },
      { name: 'focus_view', hint: 'Focus the arrangement view' },
      { name: 'start_playback', hint: 'Start playback' },
      { name: 'stop_playback', hint: 'Stop playback' },
      { name: 'start_recording', hint: 'Start recording' },
      { name: 'stop_recording', hint: 'Stop recording' },
      { name: 'toggle_arrangement_record', hint: 'Toggle arrangement recording on' },
      { name: 'toggle_session_record', hint: 'Toggle session recording on' },
      { name: 'capture_midi', hint: 'Capture MIDI from last played notes' },
      { name: 'set_tempo', hint: 'Set tempo to 128 BPM' },
      { name: 'set_overdub', hint: 'Enable overdub recording' },
      { name: 'jump_to_time', hint: 'Jump to bar 1 beat 1' },
      { name: 'get_playback_position', hint: 'Get the current playback position' },
      { name: 'get_arrangement_length', hint: 'Get the total arrangement length' },
      { name: 'set_arrangement_loop', hint: 'Set arrangement loop from bar 1 to bar 8' },
      { name: 'health_check', hint: 'Check AbletonMCP health status' },
      { name: 'get_cpu_load', hint: 'Get current CPU load' },
      { name: 'undo', hint: 'Undo the last action' },
      { name: 'redo', hint: 'Redo the last undone action' },
    ]},
    { cat: 'TRACKS', tools: [
      { name: 'get_track_info', hint: 'Get info about track 1' },
      { name: 'set_track_name', hint: 'Rename track 1 to Kick' },
      { name: 'select_track', hint: 'Select track 1' },
      { name: 'create_midi_track', hint: 'Create a new MIDI track' },
      { name: 'create_audio_track', hint: 'Create a new audio track' },
      { name: 'create_group_track', hint: 'Create a group track' },
      { name: 'duplicate_track', hint: 'Duplicate track 1' },
      { name: 'delete_track', hint: 'Delete track 1' },
      { name: 'freeze_track', hint: 'Freeze track 1' },
      { name: 'flatten_track', hint: 'Flatten track 1' },
      { name: 'fold_track', hint: 'Fold track 1' },
      { name: 'unfold_track', hint: 'Unfold track 1' },
      { name: 'unarm_all', hint: 'Unarm all tracks' },
      { name: 'set_track_volume', hint: 'Set track 1 volume to 0 dB' },
      { name: 'set_track_pan', hint: 'Set track 1 pan to center' },
      { name: 'set_track_mute', hint: 'Mute track 1' },
      { name: 'set_track_solo', hint: 'Solo track 1' },
      { name: 'set_track_arm', hint: 'Arm track 1 for recording' },
      { name: 'set_track_color', hint: 'Set track 1 color to blue' },
      { name: 'set_track_monitoring', hint: 'Set track 1 monitoring to auto' },
      { name: 'get_track_monitoring', hint: 'Get monitoring mode of track 1' },
      { name: 'set_track_input_routing', hint: 'Set track 1 input routing' },
      { name: 'get_track_input_routing', hint: 'Get input routing of track 1' },
      { name: 'set_track_output_routing', hint: 'Set track 1 output routing' },
      { name: 'get_track_output_routing', hint: 'Get output routing of track 1' },
      { name: 'get_available_inputs', hint: 'Get all available audio inputs' },
      { name: 'get_available_outputs', hint: 'Get all available audio outputs' },
      { name: 'get_send_level', hint: 'Get send A level on track 1' },
      { name: 'set_send_level', hint: 'Set send A level on track 1 to 0.5' },
    ]},
    { cat: 'RETURN/MASTER', tools: [
      { name: 'get_return_tracks', hint: 'Get all return tracks' },
      { name: 'get_return_track_info', hint: 'Get info about return track A' },
      { name: 'set_return_volume', hint: 'Set return track A volume to 0 dB' },
      { name: 'set_return_pan', hint: 'Set return track A pan to center' },
      { name: 'get_master_info', hint: 'Get master track info' },
      { name: 'set_master_volume', hint: 'Set master volume to 0 dB' },
      { name: 'set_master_pan', hint: 'Set master pan to center' },
    ]},
    { cat: 'CLIPS', tools: [
      { name: 'create_clip', hint: 'Create a 4-bar MIDI clip on track 1 slot 0' },
      { name: 'delete_clip', hint: 'Delete clip on track 1 slot 0' },
      { name: 'duplicate_clip', hint: 'Duplicate clip on track 1 slot 0' },
      { name: 'select_clip', hint: 'Select clip on track 1 slot 0' },
      { name: 'fire_clip', hint: 'Fire clip on track 1 slot 0' },
      { name: 'stop_clip', hint: 'Stop clip on track 1 slot 0' },
      { name: 'set_clip_name', hint: 'Rename clip on track 1 slot 0 to Intro' },
      { name: 'set_clip_color', hint: 'Set clip color to red' },
      { name: 'get_clip_color', hint: 'Get color of clip on track 1 slot 0' },
      { name: 'get_clip_loop', hint: 'Get loop settings of clip on track 1 slot 0' },
      { name: 'set_clip_loop', hint: 'Set clip loop to 4 bars' },
      { name: 'get_clip_notes', hint: 'Get notes in clip on track 1 slot 0' },
      { name: 'add_notes_to_clip', hint: 'Add a C3 note at beat 1 for 1 bar to clip' },
      { name: 'remove_notes', hint: 'Remove notes from beat 1 to 2 in clip' },
      { name: 'remove_all_notes', hint: 'Remove all notes from clip on track 1 slot 0' },
      { name: 'transpose_notes', hint: 'Transpose all notes up by 12 semitones' },
      { name: 'quantize_clip_notes', hint: 'Quantize notes to 1/16 note grid' },
      { name: 'humanize_clip_velocity', hint: 'Humanize note velocities by 20%' },
      { name: 'humanize_clip_timing', hint: 'Humanize note timing by 10ms' },
      { name: 'get_clip_automation', hint: 'Get automation data from clip' },
      { name: 'set_clip_automation', hint: 'Set volume automation in clip' },
      { name: 'clear_clip_automation', hint: 'Clear all automation from clip' },
      { name: 'get_clip_gain', hint: 'Get gain of clip on track 1 slot 0' },
      { name: 'set_clip_gain', hint: 'Set clip gain to 0 dB' },
      { name: 'get_clip_pitch', hint: 'Get pitch of clip on track 1 slot 0' },
      { name: 'set_clip_pitch', hint: 'Pitch clip up 2 semitones' },
      { name: 'get_clip_warp_info', hint: 'Get warp info of clip on track 1 slot 0' },
      { name: 'set_clip_warp_mode', hint: 'Set clip warp mode to Complex' },
      { name: 'get_warp_markers', hint: 'Get warp markers of clip' },
      { name: 'add_warp_marker', hint: 'Add a warp marker at beat 1' },
      { name: 'delete_warp_marker', hint: 'Delete warp marker at beat 1' },
      { name: 'commit_groove', hint: 'Commit groove to clip' },
      { name: 'apply_groove', hint: 'Apply MPC groove to clip' },
    ]},
    { cat: 'SCENES', tools: [
      { name: 'get_all_scenes', hint: 'Get all scenes' },
      { name: 'fire_scene', hint: 'Fire scene 1' },
      { name: 'stop_scene', hint: 'Stop scene 1' },
      { name: 'select_scene', hint: 'Select scene 1' },
      { name: 'create_scene', hint: 'Create a new scene' },
      { name: 'duplicate_scene', hint: 'Duplicate scene 1' },
      { name: 'delete_scene', hint: 'Delete scene 1' },
      { name: 'set_scene_name', hint: 'Rename scene 1 to Drop' },
      { name: 'get_scene_color', hint: 'Get color of scene 1' },
      { name: 'set_scene_color', hint: 'Set scene 1 color to green' },
    ]},
    { cat: 'DEVICES', tools: [
      { name: 'get_device_parameters', hint: 'Get all parameters of device on track 1' },
      { name: 'get_device_by_name', hint: 'Get Compressor device on track 1' },
      { name: 'set_device_parameter', hint: 'Set attack on Compressor to 10ms' },
      { name: 'toggle_device', hint: 'Toggle device on/off on track 1' },
      { name: 'delete_device', hint: 'Delete device 0 from track 1' },
      { name: 'move_device_left', hint: 'Move device left in chain on track 1' },
      { name: 'move_device_right', hint: 'Move device right in chain on track 1' },
      { name: 'get_rack_chains', hint: 'Get chains of rack on track 1' },
      { name: 'select_rack_chain', hint: 'Select chain 0 in rack on track 1' },
      { name: 'load_browser_item', hint: 'Load API 2500 plugin on master track' },
    ]},
    { cat: 'LOCATORS', tools: [
      { name: 'get_locators', hint: 'Get all locators in the arrangement' },
      { name: 'create_locator', hint: 'Create a locator called Drop at bar 33' },
      { name: 'delete_locator', hint: 'Delete the locator at bar 33' },
    ]},
    { cat: 'MUSIC', tools: [
      { name: 'get_scale_notes', hint: 'Get notes in A minor scale' },
      { name: 'generate_bassline', hint: 'Generate a bassline in A minor at 128 BPM' },
      { name: 'generate_drum_pattern', hint: 'Generate a drum pattern at 128 BPM' },
    ]},
    { cat: 'BROWSER', tools: [
      { name: 'search_browser', hint: 'Search browser for reverb plugins' },
      { name: 'get_browser_items_at_path', hint: 'Get browser items at Instruments/Analog' },
      { name: 'browse_path', hint: 'Browse to Drums/808 folder in browser' },
    ]},
    { cat: 'METRONOME/GROOVE', tools: [
      { name: 'get_metronome_state', hint: 'Get metronome on/off state' },
      { name: 'set_metronome', hint: 'Turn metronome on' },
      { name: 'get_groove_pool', hint: 'Get all grooves in the groove pool' },
    ]},
  ]
  let newCustom = $state(''), newCustomUrl = $state(''), newHealth = $state('')

  // Mozart
  let aiInput = $state(''), aiMessages = $state([]), aiLoading = $state(false)
  let chatContainer = $state(null)
  $effect(() => {
    if (aiMessages.length && chatContainer) {
      setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight }, 50)
    }
  })
  let correctionInputs = $state({}) // keyed by message index

  let speakingId = $state(null)
  let openArticles = $state({})
  let currentAudio = $state(null)
  let speakToast = $state('')
  let speakToastTimer = null
  let librarySpotifyIds = $state(new Set())

  async function loadLibraryIds() {
    const { data } = await supabase
      .from('reference_tracks')
      .select('spotify_id')
      .in('source', ['agent', 'user', 'mozart', 'promoted', 'chart'])
      .not('spotify_id', 'is', null)
    librarySpotifyIds = new Set((data || []).map(r => r.spotify_id).filter(Boolean))
  }

  function showSpeakToast(msg) {
    speakToast = msg
    if (speakToastTimer) clearTimeout(speakToastTimer)
    speakToastTimer = setTimeout(() => speakToast = '', 3500)
  }

  // Goals
  let activeGoals = $state([])

  async function loadGoals() {
    const { data } = await supabase
      .from('brain_knowledge')
      .select('id,title,content')
      .eq('active', true)
      .eq('category', 'goal')
      .order('created_at', { ascending: false })
    activeGoals = data || []
  }

  async function speakText(id, text) {
    if (speakingId === id) {
      if (currentAudio) { currentAudio.pause(); currentAudio = null }
      speakingId = null
      return
    }
    if (currentAudio) { currentAudio.pause(); currentAudio = null }
    speakingId = id
    try {
      const res = await fetch('http://localhost:4242/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4000) })
      })
      if (!res.ok) {
        try {
          const data = await res.json()
          if (data.error) showSpeakToast('Add OPENAI_API_KEY to .env to enable audio')
        } catch(_) {}
        speakingId = null
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      audio.onended = () => { speakingId = null; currentAudio = null; URL.revokeObjectURL(url) }
      audio.onerror = () => { speakingId = null; currentAudio = null }
      audio.play()
    } catch(e) { speakingId = null }
  }

  // Check Out — brain_knowledge entries surfaced for daily review
  let checkOutItems = $state([])

  async function loadStaticData() {
    const keys = ['customs', 'helpers', 'helper_ticks']
    const { data } = await supabase.from('user_settings').select('key, value').in('key', keys)
    const map = {}
    for (const row of (data || [])) map[row.key] = JSON.parse(row.value)

    if (map.customs) {
      state.customs = map.customs
    } else {
      const { data: fb } = await supabase.from('daily_state')
        .select('customs').not('customs', 'eq', '[]').order('date', { ascending: false }).limit(1).maybeSingle()
      state.customs = fb?.customs || []
      await saveCustoms()
    }

    if (map.helpers) {
      state.helpers = map.helpers
    } else {
      const { data: fb } = await supabase.from('daily_state')
        .select('helpers').not('helpers', 'eq', '[]').order('date', { ascending: false }).limit(1).maybeSingle()
      state.helpers = fb?.helpers || []
      await saveHelpers()
    }

    if (map.helper_ticks) state.helperTicks = map.helper_ticks
  }

  async function load() {
    try {
      const { data: proj } = await supabase.from('projects').select('id,name,artist,color,deadlines').order('position')
      projects = proj || []
      const { data: allSongs } = await supabase.from('songs').select('id,title,code,project_id,work_data').not('project_id','is',null)
      const { data: demoSongs } = await supabase.from('songs').select('id,title,code').is('project_id',null)
      const songMap = {}
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) { if (!songMap[p.id]) songMap[p.id] = []; songMap[p.id].push(s) }
      })
      // Also key by name for backwards compat
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) { if (!songMap[p.name]) songMap[p.name] = []; songMap[p.name].push(s) }
      })
      allSongs_ = allSongs || []
      demoSongs_ = demoSongs || []
      projectSongs = songMap
      const { data } = await supabase.from('daily_state').select('*').eq('date', today).maybeSingle()

      // Fallback for check_items (still per-day)
      let fallback = null
      if (!data?.check_items?.length) {
        const { data: fb } = await supabase.from('daily_state')
          .select('helper_ticks, check_items, check_ticks')
          .neq('date', today)
          .order('id', { ascending: false }).limit(1).maybeSingle()
        fallback = fb
      }

      if (data) {
        state = { ...state,
          ticks: data.ticks||{},
          healthChecks: data.health_checks||[], healthTicks: data.health_ticks||{},
          helperTicks: data.helper_ticks||{},
          checkItems: data.check_items?.length ? data.check_items : (fallback?.check_items||[]),
          checkTicks: data.check_ticks||{}
        }
      } else if (fallback) {
        state = { ...state,
          helperTicks: {},
          checkItems: fallback?.check_items||[],
          checkTicks: {}
        }
      }
      if (fallback) await save()
    } catch(e) { console.error('LOAD ERROR:', e) }
    loading = false
  }

  async function saveCustoms() {
    await supabase.from('user_settings').upsert({ key: 'customs', value: JSON.stringify(state.customs) }, { onConflict: 'key' })
  }
  async function saveHelpers() {
    await supabase.from('user_settings').upsert({ key: 'helpers', value: JSON.stringify(state.helpers) }, { onConflict: 'key' })
  }
  async function saveHelperTicks() {
    await supabase.from('user_settings').upsert({ key: 'helper_ticks', value: JSON.stringify(state.helperTicks) }, { onConflict: 'key' })
  }

  async function save() {
    await supabase.from('daily_state').upsert({
      date: today,
      ticks: state.ticks,
      health_ticks: state.healthTicks
    }, { onConflict: 'date' })
  }

  async function tick(id) { state.ticks = {...state.ticks, [id]: !state.ticks[id]}; await save() }

  async function tickHealth(id) { state.healthTicks = {...state.healthTicks, [id]: !state.healthTicks[id]}; await save() }
  async function addCustom() {
    if (!newCustom.trim()) return
    state.customs = [...state.customs, { id: 'c'+Date.now(), label: newCustom.trim(), url: newCustomUrl.trim() }]
    newCustom = ''; newCustomUrl = ''; await saveCustoms()
  }
  async function delCustom(id) { state.customs = state.customs.filter(c => c.id !== id); await saveCustoms() }
  async function addHealth() {
    if (!newHealth.trim()) return
    state.healthChecks = [...(state.healthChecks||[]), { id: 'h'+Date.now(), label: newHealth.trim() }]
    newHealth = ''; await save()
  }
  async function delHealth(id) {
    state.healthChecks = (state.healthChecks||[]).filter(h => h.id !== id)
    const ht = {...state.healthTicks}; delete ht[id]; state.healthTicks = ht; await save()
  }

  let newHelper = $state(''), newHelperUrl = $state('')
  let helperSearchInputs = $state({})

  function getHelperSearchConfig(url) {
    if (!url) return null
    if (url.includes('youtube.com') || url.includes('youtu.be'))
      return { placeholder: 'Search YouTube...', buildUrl: q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) }
    if (url.includes('open.spotify.com') || url.includes('spotify.com'))
      return { placeholder: 'Search Spotify...', buildUrl: q => 'https://open.spotify.com/search/' + encodeURIComponent(q) }
    if (url.includes('gemini.google.com'))
      return { placeholder: 'Ask Gemini...', buildUrl: q => 'https://gemini.google.com/app?q=' + encodeURIComponent(q) }
    if (url.includes('deepseek.com'))
      return { placeholder: 'Ask DeepSeek...', buildUrl: q => 'https://chat.deepseek.com/?q=' + encodeURIComponent(q) }
    return null
  }

  async function tickHelper(id) { state.helperTicks = {...state.helperTicks, [id]: !state.helperTicks[id]}; await saveHelperTicks() }
  async function addHelper() {
    if (!newHelper.trim()) return
    state.helpers = [...(state.helpers||[]), { id: 'h'+Date.now(), label: newHelper.trim(), url: newHelperUrl.trim() }]
    newHelper = ''; newHelperUrl = ''; await saveHelpers()
  }
  async function delHelper(id) { state.helpers = (state.helpers||[]).filter(h => h.id !== id); await saveHelpers() }
  async function moveHelper(id, dir) {
    const arr = [...(state.helpers||[])]
    const idx = arr.findIndex(h => h.id === id), ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp; state.helpers = arr; await saveHelpers()
  }

  async function generateTitles() {
    if (!titleGenInput.trim() || titleGenLoading) return
    titleGenLoading = true
    titleGenResults = []
    try {
      const r = await fetch('http://localhost:4242/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: titleGenInput.trim() })
      })
      const d = await r.json()
      titleGenResults = d.titles || []
    } catch(e) { alert('Title generator error: ' + e.message) }
    titleGenLoading = false
  }

  async function moveCustom(id, dir) {
    const arr = [...(state.customs||[])]
    const idx = arr.findIndex(c => c.id === id)
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    state.customs = arr; await saveCustoms()
  }
  async function moveHealth(id, dir) {
    const arr = [...(state.healthChecks||[])]
    const idx = arr.findIndex(h => h.id === id)
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    state.healthChecks = arr; await save()
  }

  async function addCheck() {
    if (!newCheck.trim()) return
    const item = { id: 'ck'+Date.now(), label: newCheck.trim(), url: newCheckUrl.trim() }
    state.checkItems = [...(state.checkItems||[]), item]
    newCheck = ''; newCheckUrl = ''
    await save()
  }
  async function delCheck(id) {
    state.checkItems = (state.checkItems||[]).filter(i => i.id !== id)
    await save()
  }
  async function moveCheck(id, dir) {
    const arr = [...(state.checkItems||[])]
    const i = arr.findIndex(x => x.id === id)
    if (i + dir < 0 || i + dir >= arr.length) return
    ;[arr[i], arr[i+dir]] = [arr[i+dir], arr[i]]
    state.checkItems = arr; await save()
  }

  let inboxItems = $state([])
  let inboxUnread = $state(0)
  let generatingBriefing = $state(false)
  let autoBriefingLoading = $state(false)
  let agentLastRun = $state({})
  let todayBriefing = $derived(inboxItems.find(n => n.type === 'briefing' && n.created_at?.slice(0,10) === todayISO))
  let pressItems = $derived(inboxItems.filter(n => n.type === 'press' && n.created_at?.slice(0,10) === todayISO).slice(0, 3))
  let scoutingArtists = $state(false)

  // WhatsApp on-demand analysis
  let waContacts = $state([])
  let waSelectedContact = $state('')
  let waAnalyzing = $state(false)
  let waResult = $state(null)
  let waError = $state('')

  async function loadWaContacts() {
    try {
      const r = await fetch('http://localhost:4242/whatsapp-contacts')
      const d = await r.json()
      if (d.ok) waContacts = (d.contacts || []).filter(c => c.monitored && !c.is_group)
    } catch(e) {}
  }

  async function analyzeWaContact() {
    if (!waSelectedContact || waAnalyzing) return
    waAnalyzing = true
    waResult = null
    waError = ''
    try {
      const r = await fetch('http://localhost:4242/analyze-whatsapp-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactName: waSelectedContact })
      })
      const d = await r.json()
      if (d.ok) waResult = d
      else waError = d.error || 'Analysis failed'
    } catch(e) { waError = e.message }
    waAnalyzing = false
  }

  function timeAgo(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000)
    if (mins < 60) return mins + 'm ago'
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return hrs + 'h ago'
    return Math.round(hrs / 24) + 'd ago'
  }

  async function generateBriefing() {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (apiKey) localStorage.setItem('mm_api_key', apiKey)
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    generatingBriefing = true
    try {
      const res = await fetch('http://localhost:4242/morning-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      agentLastRun = { ...agentLastRun, briefing: new Date().toISOString() }
      await loadInbox()
    } catch(e) {
      alert('Briefing error: ' + e.message + '\nMake sure watcher is running.')
    }
    generatingBriefing = false
  }

  async function scoutArtists() {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    scoutingArtists = true
    try {
      const res = await fetch('http://localhost:4242/agent-scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      agentLastRun = { ...agentLastRun, scout: new Date().toISOString() }
      await loadInbox()
    } catch(e) {
      alert('Scout error: ' + e.message + '\nMake sure watcher is running.')
    }
    scoutingArtists = false
  }



  async function loadInbox() {
    // Delete old notifications first: feedback after 1 day, downloads after 7 days
    const oneDayAgo  = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'feedback').lt('created_at', oneDayAgo)
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'download').lt('created_at', sevenDaysAgo)
    await supabase.from('inbox_notifications').delete()
      .eq('type', 'reference').lt('metadata->>expires', new Date().toISOString())

    const { data } = await supabase.from('inbox_notifications')
      .select('*').order('created_at', { ascending: false }).limit(50)
    inboxItems = data || []
    inboxUnread = inboxItems.filter(n => !n.read).length

    // Seed last-run timestamps from most recent notification per agent
    const titleToKey = { 'Morning Briefing': 'briefing', 'Artist Scout': 'scout', 'Demo Match': 'match', 'Pulse Check': 'pulse' }
    const seeded = {}
    for (const n of inboxItems) {
      const key = titleToKey[n.song_title]
      if (key && !seeded[key]) seeded[key] = n.created_at
    }
    agentLastRun = { ...agentLastRun, ...seeded }
  }

  // Check share_sessions for new downloads and create inbox notifications
  async function syncDownloadNotifications() {
    try {
      const { data: sessions } = await supabase
        .from('share_sessions')
        .select('id, patch_name, songs, downloads, feedback_enabled, created_at')
        .neq('downloads', '{}')
        .not('downloads', 'is', null)
      if (!sessions?.length) return

      // Use Supabase as source of truth — not localStorage — so deleting a notification is permanent
      const { data: existing } = await supabase
        .from('inbox_notifications')
        .select('session_id, song_code')
        .eq('type', 'download')
      const alreadyNotified = new Set((existing || []).map(r => `${r.session_id}::${r.song_code}`))

      const toInsert = []
      for (const session of sessions) {
        const dlCodes = Object.keys(session.downloads || {})
        for (const code of dlCodes) {
          if (alreadyNotified.has(`${session.id}::${code}`)) continue
          const songEntry = (session.songs || []).find(s => s.code === code)
          toInsert.push({
            type: 'download',
            song_code: code,
            song_title: songEntry?.title || code,
            artist: '',
            session_id: session.id,
            patch_name: session.patch_name || '',
            message: `Downloaded from listen link`,
            read: false
          })
        }
      }

      if (toInsert.length) {
        await supabase.from('inbox_notifications').insert(toInsert)
        await loadInbox()
      }
    } catch(e) { console.warn('syncDownloadNotifications error:', e.message) }
  }

  async function markInboxRead() {
    const unreadIds = inboxItems.filter(n => !n.read).map(n => n.id)
    if (!unreadIds.length) return
    await supabase.from('inbox_notifications').update({ read: true }).in('id', unreadIds)
    inboxItems = inboxItems.map(n => ({ ...n, read: true }))
    inboxUnread = 0
  }

  async function addChartTrackToBrain(track) {
    const entry = `${track.artist} — ${track.title}${track.spotify_id ? ' (spotify:' + track.spotify_id + ')' : ''}`
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'reference_current', entry, source: 'chart', notes: track.source || ''
    })
    if (!error) alert(`Added to brain: ${track.artist} — ${track.title}`)
    else alert('Error: ' + error.message)
  }

  async function addChartTrackToLibrary(track) {
    const res = await fetch('http://localhost:4242/save-to-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: track.title, artist: track.artist, spotify_id: track.spotify_id || null,
        source: 'chart', collection_name: 'chart_pick'
      })
    })
    const j = await res.json().catch(() => ({}))
    if (j.ok) {
      if (track.spotify_id) librarySpotifyIds = new Set([...librarySpotifyIds, track.spotify_id])
      alert(`Saved to library: ${track.artist} — ${track.title}`)
    } else alert('Error: ' + (j.error || 'unknown'))
  }

  function playSpotifyTrack(spotifyId) {
    window.open(`https://open.spotify.com/track/${spotifyId}`, '_blank')
  }

  async function deleteInboxItem(id) {
    // For download notifications: also remove from share_sessions.downloads so sync won't re-create it
    const notif = inboxItems.find(n => n.id === id)
    if (notif?.type === 'download' && notif.session_id && notif.song_code) {
      const { data: sess } = await supabase.from('share_sessions').select('downloads').eq('id', notif.session_id).maybeSingle()
      if (sess?.downloads) {
        const updated = { ...sess.downloads }
        delete updated[notif.song_code]
        await supabase.from('share_sessions').update({ downloads: updated }).eq('id', notif.session_id)
      }
    }
    await supabase.from('inbox_notifications').delete().eq('id', id)
    inboxItems = [...inboxItems.filter(n => n.id !== id)]
    inboxUnread = inboxItems.filter(n => !n.read).length
  }

  // Mozart
  async function sendAI(rawMsg) {
    const msg = (typeof rawMsg === 'string' && rawMsg.trim()) ? rawMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set — add it in Settings ⚙.' }]; aiLoading = false; return }

    const mozartContext = await buildMozartContext(supabase, {})

    const system = `You are this producer's co-intelligence.
A sharp, direct thinking partner for music production decisions.
Today: ${todayISO}.

CHARACTER:
- Challenge assumptions before confirming them
- Offer the angle the producer hasn't considered
- Be specific — no generic music industry advice
- For recommendations note: ✓ [why this works] / ✗ [what speaks against it]
- When corrected, acknowledge it and update your reasoning

${mozartContext}`
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system, messages: aiMessages.slice(-10) })
      })
      const data = await res.json()
      if (data.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/mozart', model: 'claude-sonnet-4-20250514', input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, cost_usd: (data.usage.input_tokens * 0.000003) + (data.usage.output_tokens * 0.000015) }) }).catch(() => {})
      let reply = data.content?.[0]?.text || 'No response.'
      if (reply.length > 300 && /research|found|analysis|suggests|shows|according|trend|data|insight|indicates/i.test(reply)) {
        reply += '\n\n---\n💡 Worth saving to Brain? Paste the key insight in Brain dump.'
      }
      const actions = parseActions(reply)
      const cleanReply = reply.replace(/\[ACTION:[^\]]+\]/g, '').trim()
      aiMessages = [...aiMessages, { role: 'assistant', content: cleanReply }]
      for (const action of actions) {
        const result = await executeAction(action, supabase, null)
        if (result) aiMessages = [...aiMessages, { role: 'assistant', content: result, _system: true }]
      }
    } catch(e) { aiMessages = [...aiMessages, { role: 'assistant', content: 'Error: '+e.message }] }
    aiLoading = false
  }


  function getTracksFromMessage(msg) {
    if (!msg) return []
    const m = msg.match(/<!--TRACKS:([\s\S]*?)-->/)
    if (!m) return []
    try { return JSON.parse(m[1]) } catch { return [] }
  }

  function stripTracksFromMessage(msg) {
    return (msg || '').replace(/\n*<!--TRACKS:[\s\S]*?-->/g, '')
  }

  async function addTrackToBrain(track) {
    const { error } = await supabase.from('brain_knowledge').insert({
      category: 'reference_current',
      title: `${track.artist} — ${track.title}`,
      content: [
        track.bpm ? `${Math.round(track.bpm)}bpm` : null,
        track.key ? `${track.key}${track.scale ? ' ' + track.scale : ''}${track.camelot ? ' (' + track.camelot + ')' : ''}` : null,
        track.energy != null ? `nrg ${Number(track.energy).toFixed(2)}` : null,
        track.source ? `source: ${track.source}` : null,
      ].filter(Boolean).join(' · '),
      entry_type: 'reference_track',
      confidence: 'medium',
      active: true,
      metadata: { source_type: track.source, spotify_id: track.spotify_id }
    })
    await supabase.from('reference_tracks').insert({
      title: track.title,
      artist: track.artist,
      spotify_id: track.spotify_id || null,
      preview_url: track.spotify_url || null,
      source: 'checkout',
      checkout_date: new Date().toISOString(),
      collection_name: 'reference_current',
      approved: true
    })
    if (!error) alert(`Saved to Brain: ${track.artist} — ${track.title}`)
    else alert('Error saving: ' + error.message)
  }

  function addTrackButtons(html, tracks) {
    // Detect "Artist — Title" or "Artist - Title" (spaces required around plain hyphen)
    return html.replace(
      /([A-Z][^—<\n]{1,35})\s*(?:—| - )\s*([^<\n,;(—]{2,50})/g,
      (match, artist, title) => {
        const a = artist.trim()
        const t = title.trim()
        if (a.length < 2 || t.length < 2) return match
        const track = tracks?.find(tr =>
          tr.title?.toLowerCase().includes(t.toLowerCase()) ||
          tr.artist?.toLowerCase().includes(a.toLowerCase())
        )
        const url = (track?.spotify_url ||
          'https://open.spotify.com/search/' + encodeURIComponent(a + ' ' + t))
          .replace(/"/g, '&quot;')
        const previewUrl = (track?.preview_url || '').replace(/"/g, '&quot;')
        return match +
          ` <button class="inline-play-btn" data-url="${url}" data-preview="${previewUrl}">▶</button>` +
          ` <button class="inline-brain-btn" data-artist="${a.replace(/"/g,'&quot;')}" data-title="${t.replace(/"/g,'&quot;')}" data-url="${url}">+</button>`
      }
    )
  }

  function parseAgentOutput(text) {
    if (!text) return ''
    const tracks = getTracksFromMessage(text)
    text = stripTracksFromMessage(text)
    // Strip "▶ YOUTUBE TOP N\n<anything>" blocks (YouTube data unavailable)
    text = text.replace(/▶\s*YOUTUBE TOP \d+[^\n]*\n[^\n]*/gi, '')
    // Strip standalone --- / -- separators
    text = text.replace(/^-{2,}\s*$/gm, '')
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const lines = text.split('\n')
    let html = ''
    let inNextMove = false

    function closeNextMove() {
      if (inNextMove) { html += '</div>'; inNextMove = false }
    }

    function colorTagLine(s) {
      return s
        .replace(/\[GAP\]/g,       '<span class="ao-tag-gap">[GAP]</span>')
        .replace(/\[OK\]/g,        '<span class="ao-tag-ok">[OK]</span>')
        .replace(/\[CONFIRMED\]/g, '<span class="agent-label-confirmed">[CONFIRMED]</span>')
        .replace(/\[TENSION\]/g,   '<span class="agent-label-tension">[TENSION]</span>')
        .replace(/\[OUTDATED\]/g,  '<span class="agent-label-outdated">[OUTDATED]</span>')
        .replace(/\[NEW\]/g,       '<span class="agent-label-new">[NEW]</span>')
    }

    for (const rawLine of lines) {
      const t = rawLine.trim()
      if (!t) continue
      if (/^[-—]{1,3}$/.test(t) || t.toLowerCase() === 'unavailable' || t.toLowerCase() === 'n/a') continue

      if (t.startsWith('## ')) {
        closeNextMove()
        const title = esc(t.slice(3).trim())
        const isNextMoveOrStep = /^NEXT (MOVE|STEP)$/i.test(title)
        html += `<div class="agent-header">${title}</div>`
        if (isNextMoveOrStep) { html += '<div class="agent-next-move">'; inNextMove = true }
      } else if (t.startsWith('- ') || t.startsWith('• ')) {
        const parts = t.replace(/^[-•]\s+/, '').split(/\s+[-•]\s+/)
        for (const part of parts) {
          if (part.trim()) {
            const content = addTrackButtons(colorTagLine(esc(part.trim())), tracks)
            html += `<div class="agent-bullet">${content}</div>`
          }
        }
      } else if (/^\d+\.\s/.test(t)) {
        const content = addTrackButtons(colorTagLine(esc(t.replace(/^\d+\.\s+/, ''))), tracks)
        html += `<div class="agent-bullet">${content}</div>`
      } else if (t.startsWith('[GAP]')) {
        html += `<div class="agent-gap">${colorTagLine(esc(t))}</div>`
      } else if (t.startsWith('[OK]')) {
        html += `<div class="agent-ok">${colorTagLine(esc(t))}</div>`
      } else if (t.length > 100) {
        const sentences = t.split(/(?<=\. )/)
        for (const s of sentences) {
          if (s.trim()) {
            const content = addTrackButtons(colorTagLine(esc(s.trim())), tracks)
            html += `<div class="agent-p">${content}</div>`
          }
        }
      } else {
        const content = addTrackButtons(colorTagLine(esc(t)), tracks)
        html += `<div class="agent-p">${content}</div>`
      }
    }
    closeNextMove()
    return html
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
      .replace(/\n/g, '<br>')
  }

  async function reloadProjectData() {
    try {
      const { data: proj } = await supabase.from('projects').select('id,name,artist,color,deadlines').order('position')
      projects = proj || []
      const { data: allSongs } = await supabase.from('songs').select('id,title,code,project_id,work_data').not('project_id','is',null)
      const { data: demoSongs } = await supabase.from('songs').select('id,title,code').is('project_id',null)
      allSongs_ = allSongs || []
      demoSongs_ = demoSongs || []
      const songMap = {}
      ;(allSongs||[]).forEach(s => {
        const p = projects.find(p => p.id === s.project_id)
        if (p) {
          if (!songMap[p.id]) songMap[p.id] = []
          songMap[p.id].push(s)
          if (!songMap[p.name]) songMap[p.name] = []
          songMap[p.name].push(s)
        }
      })
      projectSongs = songMap
      // Also reload today's tasks in case Projects tab added some
      const { data: ds } = await supabase.from('daily_state').select('tasks').eq('date', today).maybeSingle()
      if (ds?.tasks) state = { ...state, tasks: ds.tasks }
    } catch(e) {}
  }

  async function loadCheckOut() {
    const { data } = await supabase
      .from('brain_knowledge')
      .select('id, title, category, source_url, metadata')
      .eq('surfaced_in_daily', true)
      .gte('surfaced_until', todayISO)
      .or('reviewed.is.null,reviewed.eq.false')
      .order('created_at', { ascending: false })
    checkOutItems = data || []
  }

  async function dismissCheckOut(id) {
    await supabase.from('brain_knowledge').update({ surfaced_in_daily: false, reviewed: true }).eq('id', id)
    checkOutItems = checkOutItems.filter(i => i.id !== id)
  }

  function handleAcapellaDrop(e) {
    e.preventDefault()
    acapellaDragging = false
    const file = e.dataTransfer.files[0]
    if (file) { acapellaFile = file; acapellaResult = null }
  }

  async function runAcapellaExtract() {
    if (!acapellaFile) return
    acapellaLoading = true
    acapellaResult = null
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.readAsDataURL(acapellaFile)
    })
    const ext = acapellaFile.name.split('.').pop()
    try {
      const r = await fetch('http://localhost:4242/extract-acapella', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: base64, ext })
      })
      acapellaResult = await r.json()
    } catch(e) {
      acapellaResult = { ok: false, error: e.message }
    }
    acapellaLoading = false
    acapellaFile = null
  }

  function handleMidiDrop(e) {
    e.preventDefault()
    midiDragging = false
    const file = e.dataTransfer.files[0]
    if (file && /\.mid$/i.test(file.name)) { midiFile = file; midiResult = null; midiSteps = [] }
  }

  async function runMidiGenerate() {
    if (!midiFile || midiLoading) return
    midiLoading = true
    midiResult = null
    midiSteps = []
    const apiKey = localStorage.getItem('mm_api_key') || ''
    const base64 = await new Promise(res => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.readAsDataURL(midiFile)
    })
    const ext = midiFile.name.split('.').pop().toLowerCase()
    const filename = midiFile.name.replace(/\.[^.]+$/, '')
    try {
      const response = await fetch('http://localhost:4242/generate-midi-from-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_data: base64, ext, filename, apiKey })
      })
      const reader2 = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader2.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.step) midiSteps = [...midiSteps, event.step]
            if (event.done) { midiResult = event; midiLoading = false }
            if (event.error) { midiResult = { ok: false, error: event.error }; midiLoading = false }
          } catch {}
        }
      }
    } catch(e) {
      midiResult = { ok: false, error: e.message }
      midiLoading = false
    }
    midiFile = null
  }

  async function checkAbletonStatus() {
    try {
      const r = await fetch('http://localhost:4242/ableton-status')
      const d = await r.json()
      abletonConnected = !!d.connected
    } catch { abletonConnected = false }
  }

  async function sendToAbleton() {
    const text = abletonInstruction.trim()
    if (!text || abletonLoading) return
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add your Anthropic API key in Settings first.'); return }
    abletonLoading = true
    abletonResponse = null
    abletonSteps = []
    try {
      if (abletonMode === 'sequence') {
        const r = await fetch('http://localhost:4242/ableton-sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: text, apiKey })
        })
        const data = await r.json()
        abletonSteps = data.steps || []
        abletonResponse = { ok: data.ok, _mode: 'sequence' }
        if (!data.ok && !data.steps) abletonResponse.error = data.error
      } else {
        const r = await fetch('http://localhost:4242/ableton-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: text, apiKey })
        })
        abletonResponse = await r.json()
      }
    } catch(e) {
      abletonResponse = { ok: false, error: e.message }
    } finally {
      abletonLoading = false
    }
  }

  // loadStaticData MUST complete before load() so customs/helpers aren't lost to the state spread
  ;(async () => { await loadStaticData(); load() })()
  ;(async () => { await loadInbox() })()
  loadCheckOut()
  loadGoals()
  loadWaContacts()

  onMount(() => {
    syncDownloadNotifications()
    loadLibraryIds()
    const onFocus = () => reloadProjectData()
    const onVisible = () => { if (document.visibilityState === 'visible') reloadProjectData() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    const onInlineClick = (e) => {
      const playBtn = e.target.closest('.inline-play-btn')
      if (playBtn) {
        const previewUrl = playBtn.dataset.preview
        const spotifyUrl = playBtn.dataset.url
        if (previewUrl) {
          if (inlinePlayingUrl === previewUrl) {
            inlineAudio?.pause()
            inlinePlayingUrl = ''
            playBtn.textContent = '▶'
            return
          }
          inlineAudio?.pause()
          document.querySelectorAll('.inline-play-btn').forEach(b => { b.textContent = '▶' })
          inlineAudio = new Audio(previewUrl)
          inlineAudio.volume = 0.8
          inlineAudio.play()
          inlinePlayingUrl = previewUrl
          playBtn.textContent = '■'
          inlineAudio.onended = () => { inlinePlayingUrl = ''; playBtn.textContent = '▶' }
        } else if (spotifyUrl) {
          window.open(spotifyUrl, 'momentum_popup', 'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes')
        }
        return
      }
      const brainBtn = e.target.closest('.inline-brain-btn')
      if (brainBtn) addTrackToBrain({ artist: brainBtn.dataset.artist, title: brainBtn.dataset.title, spotify_url: brainBtn.dataset.url })
    }
    document.addEventListener('click', onInlineClick)

    checkAbletonStatus()
    const abletonPoll = setInterval(checkAbletonStatus, 30000)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('click', onInlineClick)
      clearInterval(abletonPoll)
    }
  })
</script>

{#if loading}
  <p class="empty">Loading...</p>
{:else}
<div class="layout">

  <!-- LEFT COLUMN -->
  <div class="main">


    <!-- SECTION 1: TRENDS & NEWS -->
    <div class="section-block">
      <div class="sh">TRENDS & NEWS</div>

      <div class="agent-row">
        <div class="agent-btn-wrap">
          <button class="briefing-btn agent-brief {generatingBriefing?'loading':''}" onclick={() => generateBriefing()}>
            {generatingBriefing ? '✦ Generating...' : '✦ Morning Briefing'}
          </button>
          {#if agentLastRun.briefing}<div class="agent-last-run">{timeAgo(agentLastRun.briefing)}</div>{/if}
        </div>
        <div class="agent-btn-wrap">
          <button class="briefing-btn agent-scout {scoutingArtists?'loading':''}" onclick={() => scoutArtists()}>
            {scoutingArtists ? '✦ Scouting...' : '✦ Scout'}
          </button>
          {#if agentLastRun.scout}<div class="agent-last-run">{timeAgo(agentLastRun.scout)}</div>{/if}
        </div>
      </div>

      {#if todayBriefing}
        <div class="today-briefing-block">
          <div class="today-briefing-header">
            <button class="inbox-del-btn" onclick={() => deleteInboxItem(todayBriefing.id)}>×</button>
            <span class="inbox-type-badge br">✦ AI</span>
            <span class="today-briefing-label">TODAY'S BRIEFING</span>
            {#if todayBriefing.message}
              <button class="inbox-speak-btn {speakingId === todayBriefing.id ? 'playing' : ''}" onclick={() => speakText(todayBriefing.id, todayBriefing.message)} title={speakingId === todayBriefing.id ? 'Stop' : 'Read aloud'}>
                {speakingId === todayBriefing.id ? '■' : '▶'}
              </button>
            {/if}
          </div>
          <div class="agent-output">{@html parseAgentOutput(todayBriefing.message)}</div>
        </div>
      {/if}

      <!-- Aktuelle Refs -->
      {#if inboxItems.some(n => n.type === 'reference')}
        <div class="year-today-sep" style="margin-bottom:6px">AKTUELLE REFS</div>
        {#each inboxItems.filter(n => n.type === 'reference') as item (item.id)}
          <div class="inbox-item ref-item">
            <div class="ref-item-header">
              <span class="ref-badge">REF</span>
              <span class="ref-name">{item.message}</span>
              {#if item.metadata?.bpm}
                <span class="ref-meta">{Math.round(item.metadata.bpm)}bpm{item.metadata.camelot ? ' · ' + item.metadata.camelot : ''}</span>
              {/if}
              <button class="del-btn" onclick={() => deleteInboxItem(item.id)}>×</button>
            </div>
            <div class="ref-expires">surfaces for {Math.max(0, Math.round((new Date(item.metadata?.expires) - Date.now()) / 86400000))} more days</div>
          </div>
        {/each}
      {/if}

      <!-- Inbox stream (no WhatsApp auto-poll messages) -->
      {#each [inboxItems.filter(n => n.type !== 'message' && n.type !== 'reference')] as inboxStream}
      {#if !inboxStream.length}
        <p class="empty-sm" style="padding:10px 0;color:#333">No notifications yet. Run an agent or send a listen link.</p>
      {:else}
        {@const todayInbox = inboxStream.filter(n => n.created_at?.slice(0,10) === todayISO && !(n.type === 'briefing' && n.id === todayBriefing?.id))}
        {@const olderInbox = inboxStream.filter(n => n.created_at?.slice(0,10) !== todayISO)}
        <div class="inbox-scroll">
          {#if todayInbox.length}
            <div class="year-today-sep">TODAY</div>
            {#each todayInbox as n (n.id)}
              <div class="inbox-item {n.read ? 'read' : 'unread'}">
                <div class="inbox-item-header">
                  {#if n.type === 'download'}<span class="inbox-type-badge dl">↓ DL</span>{:else if n.type === 'briefing' || n.type === 'scout'}<span class="inbox-type-badge br">✦ AI</span>{:else}<span class="inbox-type-badge fb">✎ FB</span>{/if}
                  <span class="inbox-code">{n.song_code}</span>
                  {#if n.artist}<span class="inbox-artist">{n.artist.toUpperCase()}</span>{/if}
                  <span class="inbox-title">{n.song_title}</span>
                  <span class="inbox-date">{new Date(n.created_at).toLocaleDateString('de-CH')}</span>
                  {#if !n.read}<span class="inbox-new-dot"></span>{/if}
                  {#if (n.type === 'briefing' || n.type === 'scout') && n.message}
                    <button class="inbox-speak-btn {speakingId === n.id ? 'playing' : ''}" onclick={() => speakText(n.id, n.message)} title={speakingId === n.id ? 'Stop' : 'Read aloud'}>
                      {speakingId === n.id ? '■' : '▶'}
                    </button>
                  {/if}
                  <button class="inbox-del-btn" onclick={() => deleteInboxItem(n.id)}>×</button>
                </div>
                {#if n.type === 'briefing' || n.type === 'scout'}
                  {@const scoutMsg = n.type === 'scout' ? n.message.replace(/^## CHARTS[\s\S]*/m, '').trim() : n.message}
                  {#if n.type === 'scout' && n.metadata?.spotify_global?.length}
                    <div class="chart-grid">
                      {#each [
                        {key:'spotify_global', label:'🌍 SPOTIFY GLOBAL'},
                        {key:'spotify_de', label:'🇩🇪 SPOTIFY DE'},
                        {key:'tiktok', label:'📱 TIKTOK'},
                        {key:'youtube', label:'▶ YOUTUBE'}
                      ] as chart}
                        {#if (n.metadata[chart.key]||[]).length === 0}{:else if chart.key === 'tiktok'}
                          <div class="tiktok-col">
                            <div class="chart-title">{chart.label}</div>
                            {#each (n.metadata.tiktok || []) as t, i}
                              <div class="chart-track-row">
                                <span class="chart-pos">{i+1}</span>
                                <div class="chart-track-info">
                                  {#if typeof t === 'string'}
                                    <span class="chart-track-artist">{t}</span>
                                  {:else}
                                    <span class="chart-track-artist">{t.artist || ''}</span>
                                    <span class="chart-track-title-text">{t.title || ''}</span>
                                  {/if}
                                </div>
                                <div class="chart-track-actions">
                                  {#if typeof t !== 'string' && t.spotify_id}
                                    <button class="chart-play-btn" onclick={() => playSpotifyTrack(t.spotify_id)} title="Open in Spotify">▶</button>
                                  {/if}
                                  {#if typeof t !== 'string'}
                                    {#if !librarySpotifyIds.has(t.spotify_id)}
                                      <button class="chart-lib-btn" onclick={() => addChartTrackToLibrary(t)}>lib</button>
                                    {:else}
                                      <span class="in-library-badge">✓</span>
                                    {/if}
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="chart-col">
                            <div class="chart-title">{chart.label}</div>
                            {#each (n.metadata[chart.key] || []) as t, i}
                              <div class="chart-track-row">
                                <span class="chart-pos">{i+1}</span>
                                <div class="chart-track-info">
                                  {#if typeof t === 'string'}
                                    <span class="chart-track-artist">{t}</span>
                                  {:else}
                                    <span class="chart-track-artist">{t.artist || ''}</span>
                                    <span class="chart-track-title-text">{t.title || ''}</span>
                                  {/if}
                                </div>
                                <div class="chart-track-actions">
                                  {#if typeof t !== 'string' && t.spotify_id}
                                    <button class="chart-play-btn" onclick={() => playSpotifyTrack(t.spotify_id)} title="Open in Spotify">▶</button>
                                  {/if}
                                  {#if typeof t !== 'string'}
                                    {#if !librarySpotifyIds.has(t.spotify_id)}
                                      <button class="chart-lib-btn" onclick={() => addChartTrackToLibrary(t)}>lib</button>
                                    {:else}
                                      <span class="in-library-badge">✓</span>
                                    {/if}
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                  {#if n.type === 'scout' && n.metadata?.suggested_tracks?.length}
                    {@const chartTrackKeys = new Set([...(n.metadata.spotify_global||[]),...(n.metadata.spotify_de||[]),...(n.metadata.tiktok||[]),...(n.metadata.youtube||[])].map(t => typeof t === 'string' ? t.toLowerCase().replace(/\W/g,'') : ((t.artist||'')+(t.title||'')).toLowerCase().replace(/\W/g,'')))}
                    {@const uniqueScoutTracks = (n.metadata.suggested_tracks||[]).filter(t => !chartTrackKeys.has(((t.artist||'')+(t.title||'')).toLowerCase().replace(/\W/g,'')))}
                    {#if uniqueScoutTracks.length}
                      <div class="suggested-tracks">
                        <div class="chart-title" style="margin-bottom:6px">ALSO MENTIONED</div>
                        {#each uniqueScoutTracks as t}
                          <div class="chart-track-row">
                            <div class="chart-track-info">
                              <span class="chart-track-artist">{t.artist || ''}</span>
                              <span class="chart-track-title-text">{t.title || ''}</span>
                            </div>
                            <div class="chart-track-actions">
                              {#if !librarySpotifyIds.has(t.spotify_id)}
                                <button class="chart-lib-btn" onclick={() => addChartTrackToLibrary(t)}>lib</button>
                              {:else}
                                <span class="in-library-badge">✓</span>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                  <div class="agent-output">{@html parseAgentOutput(scoutMsg)}</div>
                {:else if n.type === 'scout_articles'}
                  <div class="articles-block">
                    <div class="articles-header" onclick={() => openArticles[n.id] = !openArticles[n.id]}>
                      <span class="articles-count">{n.metadata?.article_count || '?'} sources</span>
                      <span class="articles-toggle">{openArticles[n.id] ? '▲' : '▼'}</span>
                    </div>
                    {#if openArticles[n.id]}
                      <div class="agent-output">{@html parseAgentOutput(n.message)}</div>
                    {/if}
                  </div>
                {:else}
                  <div class="inbox-msg">{n.message}</div>
                {/if}
                {#if n.patch_name}<div class="inbox-patch">via {n.patch_name}</div>{/if}
              </div>
            {/each}
          {:else}
            <p class="empty-sm" style="padding:8px 0;color:#333">Nothing today.</p>
          {/if}
          {#if olderInbox.length}
            <div class="year-today-sep" style="margin-top:10px;opacity:.4">EARLIER</div>
            {#each olderInbox as n (n.id)}
              <div class="inbox-item read" style="opacity:.35">
                <div class="inbox-item-header">
                  {#if n.type === 'download'}<span class="inbox-type-badge dl">↓ DL</span>{:else if n.type === 'briefing'}<span class="inbox-type-badge br">✦ AI</span>{:else}<span class="inbox-type-badge fb">✎ FB</span>{/if}
                  <span class="inbox-code">{n.song_code}</span>
                  {#if n.artist}<span class="inbox-artist">{n.artist.toUpperCase()}</span>{/if}
                  <span class="inbox-title">{n.song_title}</span>
                  <span class="inbox-date">{new Date(n.created_at).toLocaleDateString('de-CH')}</span>
                  <button class="inbox-del-btn" onclick={() => deleteInboxItem(n.id)}>×</button>
                </div>
                {#if n.type === 'briefing' || n.type === 'scout'}
                  {@const scoutMsg = n.type === 'scout' ? n.message.replace(/^## CHARTS[\s\S]*/m, '').trim() : n.message}
                  <div class="agent-output">{@html parseAgentOutput(scoutMsg)}</div>
                {:else}
                  <div class="inbox-msg">{n.message}</div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
      {/each}
    </div>

    <!-- SECTION 2: WHATSAPP ANALYSIS (on-demand) -->
    <div class="section-block">
      <div class="sh">WHATSAPP</div>
      {#if waContacts.length === 0}
        <p class="empty-sm" style="color:#444">No monitored contacts. Add contacts in Settings ⚙.</p>
      {:else}
        <div class="wa-analyze-row">
          <select class="wa-contact-sel" bind:value={waSelectedContact}>
            <option value="">— Select contact —</option>
            {#each waContacts as c (c.jid)}
              <option value={c.name}>{c.name}</option>
            {/each}
          </select>
          <button class="briefing-btn {waAnalyzing ? 'loading' : ''}" onclick={analyzeWaContact} disabled={!waSelectedContact || waAnalyzing}>
            {waAnalyzing ? 'Analyzing...' : 'Analyze Conversation'}
          </button>
        </div>
        {#if waError}
          <p class="empty-sm" style="color:#e05a4a;margin-top:6px">{waError}</p>
        {/if}
        {#if waResult}
          <div class="wa-result">
            {#if waResult.urgency}
              <div class="wa-result-row">
                <span class="wa-result-label">URGENCY</span>
                <span class="wa-urgency-val urgency-{waResult.urgency}">{waResult.urgency.toUpperCase()}</span>
              </div>
            {/if}
            {#if waResult.summary}
              <div class="wa-result-section">
                <div class="wa-result-label">SUMMARY</div>
                <div class="wa-result-text">{waResult.summary}</div>
              </div>
            {/if}
            {#if waResult.real_intent}
              <div class="wa-result-section">
                <div class="wa-result-label">REAL INTENT</div>
                <div class="wa-result-text">{waResult.real_intent}</div>
              </div>
            {/if}
            {#if waResult.tone}
              <div class="wa-result-section">
                <div class="wa-result-label">TONE</div>
                <div class="wa-result-text">{waResult.tone}</div>
              </div>
            {/if}
            {#if waResult.opportunities}
              <div class="wa-result-section">
                <div class="wa-result-label">OPPORTUNITIES</div>
                <div class="wa-result-text">{waResult.opportunities}</div>
              </div>
            {/if}
            {#if waResult.recommended_response}
              <div class="wa-result-section">
                <div class="wa-result-label">RECOMMENDED RESPONSE</div>
                <div class="wa-result-text wa-reply-wrap">
                  <span class="wa-reply-text">{waResult.recommended_response}</span>
                  <button class="wa-copy-btn" onclick={() => navigator.clipboard.writeText(waResult.recommended_response)}>Copy</button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <!-- SECTION 3: ROUTINE / HELPERS -->
    <div class="section-block">

      <div class="sections">
        <button class="sec-tab {activeSection==='routine'?'on':''}" onclick={() => activeSection='routine'}>ROUTINE</button>
        <button class="sec-tab {activeSection==='helpers'?'on':''}" onclick={() => activeSection='helpers'}>HELPERS</button>
      </div>

      {#if activeSection === 'routine'}
      <div class="check-list">
        {#each state.customs as item (item.id)}
          {@const isYoutube  = /youtube\.com|youtu\.be/.test(item.url||'')}
          {@const isSpotify  = /spotify\.com/.test(item.url||'')}
          {@const isGemini   = /gemini\.google\.com/.test(item.url||'')}
          {@const isDeepseek = /deepseek\.com/.test(item.url||'')}
          {@const hasSearch  = isYoutube || isSpotify || isGemini || isDeepseek}
          {@const searchPlaceholder = isYoutube ? 'Search YouTube...' : isSpotify ? 'Search Spotify...' : isGemini ? 'Ask Gemini...' : 'Ask DeepSeek...'}
          {@const buildSearchUrl = (q) => isYoutube
            ? 'https://youtube.com/results?search_query=' + encodeURIComponent(q)
            : isSpotify
            ? 'https://open.spotify.com/search/' + encodeURIComponent(q)
            : isGemini
            ? 'https://gemini.google.com/app?q=' + encodeURIComponent(q)
            : 'https://chat.deepseek.com/?q=' + encodeURIComponent(q)}
          <div class="check-item {state.ticks[item.id]?'done':''}">
            <button class="ckb" onclick={() => tick(item.id)}>{state.ticks[item.id]?'✓':''}</button>
            {#if item.url}
              <a href={item.url} target="_blank" class="item-label">{item.label}</a>
            {:else}
              <span class="item-label">{item.label}</span>
            {/if}
            {#if hasSearch}
              <input
                class="helper-search-inp"
                placeholder={searchPlaceholder}
                value={helperSearchInputs[item.id] || ''}
                oninput={e => helperSearchInputs = {...helperSearchInputs, [item.id]: e.target.value}}
                onkeydown={e => { if (e.key === 'Enter') { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') } }}
              />
              <button class="helper-search-go" onclick={() => { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') }}>→</button>
            {/if}
            <div class="reorder-col"><button class="reorder-micro" onclick={() => moveCustom(item.id,-1)}>▲</button><button class="reorder-micro" onclick={() => moveCustom(item.id,1)}>▼</button></div>
            <button class="del-btn" onclick={() => delCustom(item.id)}>×</button>
          </div>
        {/each}
        </div>
        <div class="add-row">
          <input class="add-inp" bind:value={newCustom} placeholder="New item..." onkeydown={e=>e.key==='Enter'&&addCustom()} />
          <input class="add-inp url" bind:value={newCustomUrl} placeholder="URL (optional)..." />
          <button class="add-btn" onclick={addCustom}>+</button>
        </div>

        {#if (state.checkItems||[]).length}
          <div class="routine-divider">CHECK</div>
          <div class="check-list">
          {#each (state.checkItems||[]) as item (item.id)}
            {@const isYoutube  = /youtube\.com|youtu\.be/.test(item.url||'')}
            {@const isSpotify  = /spotify\.com/.test(item.url||'')}
            {@const isGemini   = /gemini\.google\.com/.test(item.url||'')}
            {@const isDeepseek = /deepseek\.com/.test(item.url||'')}
            {@const hasSearch  = isYoutube || isSpotify || isGemini || isDeepseek}
            {@const searchPlaceholder = isYoutube ? 'Search YouTube...' : isSpotify ? 'Search Spotify...' : isGemini ? 'Ask Gemini...' : 'Ask DeepSeek...'}
            {@const buildSearchUrl = (q) => isYoutube
              ? 'https://youtube.com/results?search_query=' + encodeURIComponent(q)
              : isSpotify
              ? 'https://open.spotify.com/search/' + encodeURIComponent(q)
              : isGemini
              ? 'https://gemini.google.com/app?q=' + encodeURIComponent(q)
              : 'https://chat.deepseek.com/?q=' + encodeURIComponent(q)}
            <div class="check-item {state.checkTicks[item.id]?'done':''}">
              <button class="ckb" onclick={async () => { state.checkTicks = {...state.checkTicks, [item.id]: !state.checkTicks[item.id]}; await save() }}>{state.checkTicks[item.id]?'✓':''}</button>
              {#if item.url}
                <a href={item.url} target="_blank" class="item-label">{item.label}</a>
              {:else}
                <span class="item-label">{item.label}</span>
              {/if}
              {#if hasSearch}
                <input
                  class="helper-search-inp"
                  placeholder={searchPlaceholder}
                  value={helperSearchInputs[item.id] || ''}
                  oninput={e => helperSearchInputs = {...helperSearchInputs, [item.id]: e.target.value}}
                  onkeydown={e => { if (e.key === 'Enter') { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') } }}
                />
                <button class="helper-search-go" onclick={() => { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') }}>→</button>
              {/if}
              <div class="reorder-col">
                <button class="reorder-micro" onclick={() => moveCheck(item.id,-1)}>▲</button>
                <button class="reorder-micro" onclick={() => moveCheck(item.id,1)}>▼</button>
              </div>
              <button class="del-btn" onclick={() => delCheck(item.id)}>×</button>
            </div>
          {/each}
          </div>
        {/if}

      <div class="helpers-built-in">

        <!-- REFERENCES -->
        <div class="helper-block">
          <div class="normalizer-title">REFERENCES</div>
          <div class="ref-row">
            <input class="add-inp ref-inp" bind:value={refUrl} placeholder="Paste Spotify track or album URL..." />
            <button class="btn-gold-sm" onclick={openSpotidown}>Open Spotidown</button>
          </div>
          {#if recentRefMoves.length}
            <div class="ref-moves">
              {#each recentRefMoves as f}
                <div class="ref-move-item">✓ Moved: {f}</div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- TITLE GENERATOR -->
        <div class="helper-block">
          <div class="normalizer-title">TITLE GENERATOR</div>
          <div class="title-gen-row">
            <input class="add-inp title-gen-inp" bind:value={titleGenInput}
              placeholder="Describe the vibe, genre, mood, artist style..."
              onkeydown={e => e.key === 'Enter' && generateTitles()} />
            <button class="btn-gold-sm {titleGenLoading ? 'dim' : ''}" onclick={generateTitles} disabled={titleGenLoading}>
              {titleGenLoading ? '...' : 'Generate Titles'}
            </button>
          </div>
          {#if titleGenResults.length}
            <div class="title-gen-results">
              {#each titleGenResults as t}
                <div class="title-gen-item">
                  <span class="title-gen-text">{t}</span>
                  <button class="title-copy-btn" onclick={() => navigator.clipboard.writeText(t)}>Copy</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- NORMALIZER -->
        <div class="helper-block">
          <div class="normalizer-title">NORMALIZER</div>
          <div class="normalizer-drop
            {normDragging ? 'dragging' : ''}
            {normStatus === 'ok' ? 'ok' : ''}
            {normStatus === 'err' ? 'err' : ''}"
            ondragover={e => { e.preventDefault(); normDragging = true }}
            ondragleave={() => normDragging = false}
            ondrop={async e => {
              e.preventDefault()
              normDragging = false
              normStatus = 'working'
              normMsg = ''
              const file = e.dataTransfer.files[0]
              if (!file) return
              const exts = ['.mp3','.wav','.aiff','.aif','.flac','.m4a']
              const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
              if (!exts.includes(ext)) { normStatus = 'err'; normMsg = 'Unsupported format'; return }
              try {
                const buf = await file.arrayBuffer()
                const res = await fetch('http://localhost:4242/normalize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
                  body: buf
                })
                const data = await res.json()
                if (data.ok) { normStatus = 'ok'; normMsg = data.outFile }
                else { normStatus = 'err'; normMsg = data.error || 'Error' }
              } catch(err) { normStatus = 'err'; normMsg = err.message }
            }}>
            {#if normStatus === 'working'}
              <span class="norm-hint">Normalizing...</span>
            {:else if normStatus === 'ok'}
              <span class="norm-ok">✓ {normMsg}</span>
            {:else if normStatus === 'err'}
              <span class="norm-err">✗ {normMsg}</span>
            {:else}
              <span class="norm-hint">Drop audio here → –14 LUFS → Desktop</span>
            {/if}
          </div>
        </div>

        <!-- ACAPELLA EXTRACTOR -->
        <div class="helper-block">
          <div class="normalizer-title">ACAPELLA EXTRACTOR</div>
          <div class="helper-sub">Drop track → strips vocals → trims to vocal start → saves to Desktop with BPM tag</div>
          <div class="acapella-drop {acapellaDragging ? 'dragging' : ''}"
            ondragover={e => { e.preventDefault(); acapellaDragging = true }}
            ondragleave={() => acapellaDragging = false}
            ondrop={handleAcapellaDrop}>
            {#if acapellaLoading}
              <div class="acapella-loading">● Extracting... 2-5 min</div>
            {:else if acapellaFile}
              <div class="acapella-ready">
                📁 {acapellaFile.name}
                <button class="extract-btn" onclick={runAcapellaExtract}>Extract Acapella</button>
              </div>
            {:else}
              <div class="acapella-placeholder">
                🎤 Drop audio file here
                <span style="font-size:9px;color:#252525">mp3 · wav · aif · m4a</span>
              </div>
            {/if}
          </div>
          {#if acapellaResult}
            <div class="acapella-result">
              {#if acapellaResult.ok}
                <div class="result-row">
                  <span class="result-label">FILE</span>
                  <span class="result-val">{acapellaResult.filename}</span>
                </div>
                {#if acapellaResult.bpm}
                  <div class="result-row">
                    <span class="result-label">BPM</span>
                    <span class="result-val">{acapellaResult.bpm}</span>
                  </div>
                {/if}
                {#if acapellaResult.key}
                  <div class="result-row">
                    <span class="result-label">KEY</span>
                    <span class="result-val">{acapellaResult.key}{acapellaResult.camelot ? ' · ' + acapellaResult.camelot : ''}</span>
                  </div>
                {/if}
                {#if acapellaResult.onset !== undefined}
                  <div class="result-row">
                    <span class="result-label">VOCAL IN</span>
                    <span class="result-val">{typeof acapellaResult.onset === 'number' ? acapellaResult.onset.toFixed(2) : acapellaResult.onset}s</span>
                  </div>
                {/if}
                <div style="font-family:'Space Mono',monospace;font-size:9px;color:#4caf82;margin-top:6px">✓ Saved to Desktop</div>
              {:else}
                <div style="color:#e57373;font-size:11px">{acapellaResult.error}</div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- MIDI FROM REFERENCE -->
        <div class="helper-block">
          <div class="normalizer-title">MIDI FROM REFERENCE</div>
          <div class="helper-sub">Drop a MIDI file to generate 5 new ideas in the same style</div>
          <div class="acapella-drop {midiDragging ? 'dragging' : ''}"
            ondragover={e => { e.preventDefault(); midiDragging = true }}
            ondragleave={() => midiDragging = false}
            ondrop={handleMidiDrop}>
            {#if midiLoading}
              <div class="acapella-loading">● Generating{midiSteps.length ? ` · step ${midiSteps.length}/4` : '...'}</div>
            {:else if midiFile}
              <div class="acapella-ready">
                📁 {midiFile.name}
                <button class="extract-btn" onclick={runMidiGenerate}>Analyze &amp; Generate MIDIs</button>
              </div>
            {:else}
              <div class="acapella-placeholder">
                🎹 Drop a .mid file — chords + melody → 5 new sequences
                <span style="font-size:9px;color:#444">analyzed temporarily · never saved</span>
              </div>
            {/if}
          </div>
          {#if midiSteps.length > 0 || midiResult}
            <div class="midi-progress">
              {#each midiSteps as step}
                <div class="midi-step">✓ {step}</div>
              {/each}
              {#if midiLoading && midiSteps.length < 4}
                <div class="midi-step pending">◌ Processing...</div>
              {/if}
            </div>
          {/if}
          {#if midiResult}
            <div class="acapella-result">
              {#if midiResult.ok}
                {#each (midiResult.files || []) as fname, i}
                  <div class="result-row">
                    <span class="result-label">{String(i+1).padStart(2,'0')}</span>
                    <span class="result-val">{fname}</span>
                  </div>
                {/each}
                <div style="font-family:'Space Mono',monospace;font-size:9px;color:#4caf82;margin-top:6px">✓ Saved to Desktop</div>
              {:else}
                <div style="color:#e57373;font-size:11px">{midiResult.error}</div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- ABLETON CONTROL -->
        <div class="helper-block">
        <div class="normalizer-title">ABLETON CONTROL</div>
        <div class="ableton-status-row">
          <span class="ableton-dot {abletonConnected ? 'on' : 'off'}"></span>
          <span class="ableton-status-text {abletonConnected ? 'on' : 'off'}">{abletonConnected ? 'Ableton connected' : 'Ableton offline'}</span>
        </div>
        <details class="ableton-tools-details">
          <summary class="ableton-tools-summary">📋 Browse tools</summary>
          <div class="ableton-tools-panel">
            {#each ABLETON_TOOLS as cat}
              <div class="ableton-cat-label">{cat.cat}</div>
              <div class="ableton-chips">
                {#each cat.tools as tool}
                  <button class="ableton-chip" onclick={() => { abletonInstruction = tool.hint }}>{tool.name}</button>
                {/each}
              </div>
            {/each}
          </div>
        </details>
        <textarea
          class="ableton-textarea"
          rows="4"
          placeholder={abletonMode === 'sequence' ? 'e.g. Set tempo to 140, create a MIDI track, generate a drum pattern, arm it for recording...' : 'e.g. Set tempo to 128 BPM, create a MIDI track, generate a drum pattern...'}
          bind:value={abletonInstruction}
        ></textarea>
        <div class="ableton-mode-row">
          <button class="ableton-mode-btn {abletonMode === 'single' ? 'active' : ''}" onclick={() => { abletonMode = 'single'; abletonResponse = null; abletonSteps = [] }}>Single Command</button>
          <button class="ableton-mode-btn {abletonMode === 'sequence' ? 'active' : ''}" onclick={() => { abletonMode = 'sequence'; abletonResponse = null; abletonSteps = [] }}>🎵 Full Sequence</button>
          <button class="ableton-send-btn {abletonLoading ? 'loading' : ''}" onclick={sendToAbleton} disabled={abletonLoading}>
            {#if abletonLoading}<span class="ableton-spinner"></span>{abletonMode === 'sequence' ? 'Planning...' : 'Sending...'}{:else}Send{/if}
          </button>
        </div>
        {#if abletonResponse && abletonResponse._mode !== 'sequence'}
          <div class="ableton-response {abletonResponse.ok ? 'ok' : 'err'}">
            {#if abletonResponse.ok}
              <div class="ableton-response-cmd">→ {abletonResponse.command?.type}</div>
              <pre class="ableton-response-pre">{JSON.stringify(abletonResponse.response, null, 2)}</pre>
            {:else}
              <div class="ableton-response-error">✗ {abletonResponse.error}</div>
            {/if}
          </div>
        {/if}
        {#if abletonSteps.length > 0}
          <div class="ableton-seq-results">
            {#each abletonSteps as step, i}
              <div class="ableton-seq-step {step.ok ? 'ok' : 'err'}">
                <span class="ableton-seq-icon">{step.ok ? '✓' : '✗'}</span>
                <span class="ableton-seq-type">{step.command?.type}</span>
                {#if !step.ok && step.error}
                  <span class="ableton-seq-err">{step.error}</span>
                {:else if step.response !== null && step.response !== undefined}
                  <span class="ableton-seq-peek">{typeof step.response === 'object' ? JSON.stringify(step.response).slice(0, 60) : String(step.response).slice(0, 60)}</span>
                {/if}
              </div>
            {/each}
            <div class="ableton-seq-summary {abletonSteps.every(s=>s.ok) ? 'ok' : 'partial'}">
              {abletonSteps.filter(s=>s.ok).length}/{abletonSteps.length} steps completed
            </div>
          </div>
        {/if}
        {#if abletonResponse && abletonResponse._mode === 'sequence' && abletonResponse.error}
          <div class="ableton-response err"><div class="ableton-response-error">✗ {abletonResponse.error}</div></div>
        {/if}
        </div><!-- /helper-block ableton -->

      </div><!-- /helpers-built-in routine -->
      {/if}

      {#if activeSection === 'helpers'}
        <div class="check-list">
        {#each (state.helpers||[]) as item (item.id)}
          {@const isYoutube  = /youtube\.com|youtu\.be/.test(item.url||'')}
          {@const isSpotify  = /spotify\.com/.test(item.url||'')}
          {@const isGemini   = /gemini\.google\.com/.test(item.url||'')}
          {@const isDeepseek = /deepseek\.com/.test(item.url||'')}
          {@const hasSearch  = isYoutube || isSpotify || isGemini || isDeepseek}
          {@const searchPlaceholder = isYoutube ? 'Search YouTube...' : isSpotify ? 'Search Spotify...' : isGemini ? 'Ask Gemini...' : 'Ask DeepSeek...'}
          {@const buildSearchUrl = (q) => isYoutube ? 'https://youtube.com/results?search_query=' + encodeURIComponent(q) : isSpotify ? 'https://open.spotify.com/search/' + encodeURIComponent(q) : isGemini ? 'https://gemini.google.com/app?q=' + encodeURIComponent(q) : 'https://chat.deepseek.com/?q=' + encodeURIComponent(q)}
          <div class="check-item {state.helperTicks[item.id]?'done':''}">
            <button class="ckb" onclick={() => tickHelper(item.id)}>{state.helperTicks[item.id]?'✓':''}</button>
            {#if item.url}
              <a href={item.url} target="_blank" class="item-label">{item.label}</a>
            {:else}
              <span class="item-label">{item.label}</span>
            {/if}
            {#if hasSearch}
              <input
                class="helper-search-inp"
                placeholder={searchPlaceholder}
                value={helperSearchInputs[item.id] || ''}
                oninput={e => helperSearchInputs = {...helperSearchInputs, [item.id]: e.target.value}}
                onkeydown={e => { if (e.key === 'Enter') { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') } }}
              />
              <button class="helper-search-go" onclick={() => { const q = helperSearchInputs[item.id]?.trim(); window.open(q ? buildSearchUrl(q) : item.url, '_blank') }}>→</button>
            {/if}
            <div class="reorder-col"><button class="reorder-micro" onclick={() => moveHelper(item.id,-1)}>▲</button><button class="reorder-micro" onclick={() => moveHelper(item.id,1)}>▼</button></div>
            <button class="del-btn" onclick={() => delHelper(item.id)}>×</button>
          </div>
        {/each}
        </div>
        <div class="add-row">
          <input class="add-inp" bind:value={newHelper} placeholder="New helper..." onkeydown={e=>e.key==='Enter'&&addHelper()} />
          <input class="add-inp url" bind:value={newHelperUrl} placeholder="URL (optional)..." />
          <button class="add-btn" onclick={addHelper}>+</button>
        </div>
      {/if}

    </div>
  </div>

  <div class="side">

    <!-- Mozart -->
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
      <div class="chat-out" bind:this={chatContainer}>
        {#each aiMessages as msg, i}
          <div class="chat-msg {msg.role}">
            <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
            <div class="chat-text">{@html msg.role === 'assistant' ? formatMozartOutput(msg.content) : msg.content}</div>
            {#if msg.role === 'assistant'}
              <div class="chat-correction-row">
                <button class="btn-wrong" onclick={() => correctionInputs = {...correctionInputs, [i]: correctionInputs[i] !== undefined ? undefined : ''}}>✗ Wrong</button>
              </div>
              {#if correctionInputs[i] !== undefined}
                <input
                  class="correction-inp"
                  placeholder="What was wrong about this?"
                  value={correctionInputs[i]}
                  oninput={e => correctionInputs = {...correctionInputs, [i]: e.target.value}}
                  onkeydown={async e => {
                    if (e.key !== 'Enter') return
                    const val = correctionInputs[i]?.trim()
                    if (!val) return
                    await supabase.from('brain_knowledge').insert({
                      category: 'correction',
                      title: msg.content.slice(0, 60),
                      content: val,
                      active: true
                    })
                    correctionInputs = {...correctionInputs, [i]: undefined}
                  }}
                />
              {/if}
            {/if}
          </div>
        {/each}
        {#if aiLoading}
          <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
        {/if}
      </div>
    </div>

  </div>
</div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 1fr 380px; min-height: calc(100vh - 100px); gap: 32px; }
  .main { display: flex; flex-direction: column; gap: 20px; }
  .side { border-left: 1px solid #1c1c1c; padding-left: 28px; display: flex; flex-direction: column; gap: 0; }
  .empty { font-family: 'Space Mono', monospace; font-size: 13px; color: #555; padding: 32px 0; text-align: center; }
  .empty-sm { font-family: 'Space Mono', monospace; font-size: 12px; color: #333; }

  .reminders { display: flex; flex-direction: column; gap: 6px; }
  .reminder-row { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(201,168,76,.06); border: 1px solid rgba(201,168,76,.3); border-radius: 4px; }
  .brain-review-nudge {
    display: block; width: 100%; text-align: left;
    background: rgba(76,175,130,.07); border: 1px solid rgba(76,175,130,.25);
    border-radius: 4px; color: #4caf82;
    font-family: 'Space Mono', monospace; font-size: 11px;
    padding: 6px 10px; cursor: pointer; margin-bottom: 6px;
    transition: background .15s;
  }
  .brain-review-nudge:hover { background: rgba(76,175,130,.13); }

  .sub-reminders { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
  .sub-reminder-row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; background: rgba(224,90,74,.08); border: 1px solid rgba(224,90,74,.4); border-radius: 3px; cursor: pointer; width: 100%; text-align: left; transition: background .15s; }
  .sub-reminder-row:hover { background: rgba(224,90,74,.14); }
  .sub-remind-icon { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #e05a4a; flex-shrink: 0; }
  .sub-remind-text { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; flex: 1; letter-spacing: .02em; }
  .sub-remind-close { font-size: 14px; color: rgba(224,90,74,.5); flex-shrink: 0; }
  .reminder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .reminder-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .reminder-label { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; color: #c9a84c; letter-spacing: .06em; }
  .reminder-sub { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; }
  .reminder-dismiss { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .reminder-dismiss:hover { border-color: #c9a84c; color: #c9a84c; }

  .day-header { margin-bottom: 4px; }
  .day-title { font-family: 'Space Mono', monospace; font-size: 13px; color: #555; letter-spacing: .06em; }

  .section-block { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #1c1c1c; padding-top: 16px; }
  .press-divider { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .12em; color: #444; text-transform: uppercase; margin: 8px 0 4px; border-top: 1px solid #252525; padding-top: 6px; }
  .press-item { display: flex; align-items: baseline; gap: 7px; background: none; border: none; cursor: pointer; padding: 3px 0; text-align: left; width: 100%; }
  .press-item:hover .press-title { color: #c9a84c; }
  .press-source { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; flex-shrink: 0; text-transform: uppercase; letter-spacing: .06em; min-width: 110px; }
  .press-title { font-family: 'Space Mono', monospace; font-size: 9px; color: #9e9690; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .15s; }
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); padding-bottom: 6px; border-bottom: 1px solid #303030; margin-bottom: 4px; }

  /* Upcoming */
  .upcoming-row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-bottom: 1px solid #111; }
  .upcoming-row.task-row { background: #0a0a0a; border-radius: 2px; margin-bottom: 2px; border: 1px solid #111; }
  .upcoming-label { flex: 1; font-size: 14px; color: #cec9c1; }
  .upcoming-proj { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; }
  .upcoming-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex-shrink: 0; }
  .ckb-sm { width: 15px; height: 15px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }

  /* Tasks */
  .tasks-header { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .undo-tab-btn { font-family: 'Space Mono', monospace; font-size: 9px; background: transparent; border: 1px solid #303030; color: #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap; transition: all .15s; flex-shrink: 0; }
  .undo-tab-btn:not(:disabled):hover { border-color: #c9a84c; color: #c9a84c; }
  .undo-tab-btn:disabled { opacity: .3; cursor: default; }
  .cal-btns { display: flex; gap: 4px; }
  .cal-action-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .06em; padding: 3px 8px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; }
  .cal-action-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .add-task-form { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .date-inp { width: 130px; flex-shrink: 0; }
  .time-inp { width: 90px; flex-shrink: 0; }
  .time-sep { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex-shrink: 0; }

  .task-dropdown { border: 1px solid #1c1c1c; border-radius: 3px; overflow: hidden; margin-top: 4px; }
  .task-dropdown-toggle { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #111; border: none; cursor: pointer; width: 100%; font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .1em; color: #555; }
  .task-dropdown-toggle:hover { background: #1c1c1c; color: #9e9690; }
  .td-arr { font-size: 9px; transition: transform .2s; }
  .td-arr.open { transform: rotate(90deg); }
  .task-list { display: flex; flex-direction: column; gap: 2px; padding: 6px; background: #0a0a0a; }
  .task-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid #1c1c1c; border-radius: 3px; background: #1c1c1c; position: relative; overflow: hidden; }
  .task-item.done { opacity: .38; }
  .task-color-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
  .task-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .task-top-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .task-proj-bold { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
  .task-type-badge { font-family: 'Space Mono', monospace; font-size: 9px; opacity: .7; letter-spacing: .06em; }
  .task-label { font-size: 14px; color: #cec9c1; }
  .task-item.done .task-label { text-decoration: line-through; color: #555; }
  .task-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .task-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .task-dismissed { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; }
  .ckb { width: 15px; height: 15px; border: 1px solid #3c3c3c; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #4caf82; cursor: pointer; flex-shrink: 0; background: transparent; padding: 0; }
  .task-item.done .ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .del-btn { background: transparent; border: none; color: #333; font-size: 16px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .inbox-item .del-btn, .whatsapp-item .del-btn { font-size: 16px; padding: 2px 8px; min-width: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #444; background: transparent; border: none; cursor: pointer; opacity: 0; transition: opacity .15s; }
  .inbox-item:hover .del-btn, .whatsapp-item:hover .del-btn { opacity: 1; color: #e05a4a; }
  .dl-notif .del-btn { opacity: 0; transition: opacity .15s; }
  .dl-notif:hover .del-btn { opacity: 1; }

  /* Upcoming panel */
  .upcoming-panel { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
  .up-tabs { display: flex; border-bottom: 1px solid #1c1c1c; background: #111; }
  .up-tab { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 7px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #444; cursor: pointer; transition: all .15s; margin-bottom: -1px; }
  .up-tab:hover { color: #9e9690; }
  .up-tab.on { color: #c9a84c; border-bottom-color: #c9a84c; }
  .up-tab.has-badge { color: #e05a4a; }
  .inbox-item { padding: 9px 0 9px 10px; border-bottom: 1px solid #1a1a1a; }
  .inbox-item.unread { border-left: 2px solid #c9a84c; }
  .inbox-item.read { opacity: .5; border-left: 2px solid transparent; }
  .inbox-item-header { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; flex-wrap: nowrap; }
  .inbox-type-badge { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 2px; letter-spacing: .06em; flex-shrink: 0; }
  .inbox-type-badge.dl { background: rgba(76,175,130,.12); color: #4caf82; border: 1px solid rgba(76,175,130,.25); }
  .inbox-type-badge.fb { background: rgba(201,168,76,.08); color: rgba(201,168,76,.7); border: 1px solid rgba(201,168,76,.2); }
  .inbox-type-badge.br { background: rgba(120,80,200,.12); color: rgba(180,140,255,.8); border: 1px solid rgba(140,100,220,.25); }
  .agent-btn-wrap { display: flex; flex-direction: column; align-items: center; }
  .agent-last-run { font-family: 'Space Mono', monospace; font-size: 8px; color: #444; text-align: center; margin-top: 2px; }
  .agent-brief { border-left: 3px solid #c9a84c !important; }
  .agent-scout { border-left: 3px solid #4caf82 !important; }
  .agent-pulse { border-left: 3px solid #4a9fd4 !important; }
  .agent-match { border-left: 3px solid #9b59b6 !important; }
  .auto-briefing-loading { font-family: 'Space Mono', monospace; font-size: 9px; color: #9e9690; padding: 6px 0 2px; letter-spacing: .06em; }
  .today-briefing-block { background: transparent; border: 1px solid #252525; border-radius: 3px; padding: 10px 12px; margin: 8px 0; }
  .today-briefing-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .today-briefing-label { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); letter-spacing: .1em; flex: 1; }
  .agent-output-del { position: absolute; top: 6px; right: 6px; background: transparent; border: none; color: #444; font-size: 14px; cursor: pointer; line-height: 1; padding: 2px 4px; }
  .agent-output-del:hover { color: #e05a4a; }
  .briefing-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .08em; padding: 4px 10px; background: transparent; border: 1px solid rgba(201,168,76,.25); color: rgba(201,168,76,.5); border-radius: 2px; cursor: pointer; transition: all .15s; }
  .briefing-btn:hover { border-color: rgba(201,168,76,.5); color: rgba(201,168,76,.8); }
  .briefing-btn.loading { opacity: .5; cursor: default; }
  .inbox-code { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; }
  .inbox-artist { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); }
  .inbox-title { font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inbox-date { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; }
  .inbox-new-dot { width: 5px; height: 5px; border-radius: 50%; background: #e05a4a; flex-shrink: 0; }
  .inbox-msg { font-size: 11px; color: #9e9690; white-space: pre-wrap; line-height: 1.7; }
  .inbox-patch { font-family: 'Space Mono', monospace; font-size: 9px; color: #333; margin-top: 2px; }
  .inbox-type-badge.wa { background: rgba(76,175,130,.15); color: #4caf82; }

  /* WhatsApp analysis */
  .wa-urgency-badge { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: .05em; padding: 1px 5px; border-radius: 2px; text-transform: uppercase; }
  .wa-urgency-badge.high { background: rgba(224,90,74,.15); color: #e05a4a; }
  .wa-urgency-badge.medium { background: rgba(201,168,76,.15); color: #c9a84c; }
  .wa-urgency-badge.low { background: rgba(158,150,144,.15); color: #9e9690; }
  .wa-analysis { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 6px 8px; border-radius: 3px; background: #111; }
  .wa-analysis.has-boundary { border-left: 2px solid #e05a4a; background: rgba(224,90,74,.05); }
  .wa-boundary { font-size: 10px; color: #e05a4a; font-weight: 600; margin-bottom: 2px; }
  .wa-field { font-size: 10px; line-height: 1.5; }
  .wa-field.intent { color: #9e9690; font-style: italic; }
  .wa-field.state { font-size: 9px; color: #666; }
  .wa-field.biz { font-size: 9px; color: #666; }
  .wa-field.next { color: #c9a84c; }
  .wa-reply-wrap { display: flex; align-items: flex-start; gap: 8px; margin-top: 4px; background: #1c1c1c; padding: 6px 8px; border-radius: 3px; }
  .wa-reply-text { font-size: 11px; color: #cec9c1; flex: 1; line-height: 1.5; }
  .wa-copy-btn { font-family: 'Space Mono', monospace; font-size: 9px; padding: 2px 7px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .wa-copy-btn:hover { color: #c9a84c; border-color: #c9a84c; }
  .wa-analyze-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wa-contact-sel { background: #0a0a0a; border: 1px solid #303030; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; border-radius: 3px; flex: 1; min-width: 140px; }
  .wa-contact-sel:focus { border-color: rgba(201,168,76,.4); }
  .wa-result { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 12px; background: #111; border-radius: 4px; border: 1px solid #252525; }
  .wa-result-row { display: flex; align-items: center; gap: 8px; }
  .wa-result-section { display: flex; flex-direction: column; gap: 3px; }
  .wa-result-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; color: rgba(201,168,76,.6); text-transform: uppercase; }
  .wa-result-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; line-height: 1.6; }
  .wa-urgency-val { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 2px; }
  .wa-urgency-val.urgency-high { background: rgba(224,90,74,.15); color: #e05a4a; }
  .wa-urgency-val.urgency-medium { background: rgba(201,168,76,.15); color: #c9a84c; }
  .wa-urgency-val.urgency-low { background: rgba(76,175,130,.1); color: #4caf82; }

  /* WhatsApp MESSAGES section */
  .ref-item { border-left: 2px solid #c9a84c; background: rgba(201,168,76,.03); padding: 6px 10px; margin-bottom: 5px; border-radius: 0 3px 3px 0; }
  .ref-item-header { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
  .ref-badge { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; color: #c9a84c; border: 1px solid rgba(201,168,76,.3); padding: 1px 5px; border-radius: 2px; flex-shrink: 0; }
  .ref-name { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #cec9c1; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-meta { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; flex-shrink: 0; }
  .ref-expires { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #444; font-style: italic; margin-top: 2px; }
  .del-btn { background: transparent; border: none; color: #333; cursor: pointer; font-size: 14px; padding: 0 2px; flex-shrink: 0; }
  .del-btn:hover { color: #9e9690; }
  .whatsapp-item { border-left: 2px solid #25d366; background: rgba(37,211,102,.03); padding: 8px 10px; margin-bottom: 6px; border-radius: 0 3px 3px 0; }
  .whatsapp-item.boundary { border-left-color: #e05a4a; background: rgba(224,90,74,.05); }
  .whatsapp-item.urgent { border-left-color: #e8a838; }
  .notif-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .notif-from { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; color: #c9a84c; }
  .notif-urgency.high { color: #e05a4a; font-size: 9px; font-family: 'Space Mono', monospace; }
  .notif-urgency.medium { color: #e8a838; font-size: 9px; font-family: 'Space Mono', monospace; }
  .notif-message { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #9e9690; font-style: italic; margin: 4px 0; }
  .notif-real-intent { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #cec9c1; margin: 2px 0; }
  .notif-next-step { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #4caf82; margin: 2px 0; }
  .notif-suggestion { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #9e9690; background: #1c1c1c; padding: 4px 8px; border-radius: 3px; margin-top: 4px; display: flex; align-items: center; gap: 8px; }
  .boundary-alert { font-family: 'Space Mono', monospace; font-size: 9px; color: #e05a4a; background: rgba(224,90,74,.1); padding: 3px 8px; border-radius: 2px; margin-bottom: 4px; }
  .del-btn { font-size: 12px; background: transparent; border: none; color: #444; cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0; }
  .del-btn:hover { color: #e05a4a; }
  .copy-btn { font-family: 'Space Mono', monospace; font-size: 8px; background: transparent; border: 1px solid #303030; color: #555; padding: 1px 5px; border-radius: 2px; cursor: pointer; margin-left: auto; flex-shrink: 0; }
  .copy-btn:hover { color: #c9a84c; border-color: #c9a84c; }

  :global(.inline-play-btn) {
    display: inline; font-size: 9px; font-family: 'Space Mono', monospace;
    background: transparent; border: 1px solid #2a2a2a; color: #4caf82;
    padding: 2px 6px; border-radius: 2px; cursor: pointer;
    margin-left: 5px; vertical-align: middle; line-height: 1.6;
  }
  :global(.inline-brain-btn) {
    display: inline; font-size: 9px; font-family: 'Space Mono', monospace;
    background: transparent; border: 1px solid #2a2a2a; color: #c9a84c;
    padding: 2px 6px; border-radius: 2px; cursor: pointer;
    margin-left: 3px; vertical-align: middle; line-height: 1.6;
  }
  :global(.inline-play-btn:hover)  { border-color: #4caf82; }
  :global(.inline-brain-btn:hover) { border-color: #c9a84c; }

  /* Structured agent output renderer */
  .agent-output {
    padding: 2px 0 4px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #9e9690;
    line-height: 1.65;
  }
  .agent-output * {
    font-family: 'DM Sans', sans-serif;
    font-weight: 300;
  }
  :global(.agent-header) {
    font-family: 'Space Mono', monospace !important;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: rgba(201,168,76,.75);
    margin: 12px 0 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid #1c1c1c;
  }
  :global(.agent-header:first-child) { margin-top: 6px; }
  :global(.agent-bullet) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #9e9690;
    line-height: 1.65;
    padding: 2px 0 2px 12px;
    margin: 0;
  }
  :global(.agent-gap) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #e05a4a;
    padding: 2px 0 2px 12px;
    line-height: 1.65;
  }
  :global(.agent-ok) {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #4caf82;
    padding: 2px 0 2px 12px;
    line-height: 1.65;
  }
  :global(.agent-next-move) {
    background: transparent;
    border: none;
    border-left: 2px solid #c9a84c;
    padding: 6px 12px;
    margin-top: 8px;
    color: #cec9c1;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    line-height: 1.65;
  }
  :global(.agent-p) { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; color: #9e9690; line-height: 1.65; margin: 3px 0; }
  .agent-tracks { margin-top: 8px; border-top: 1px solid #1c1c1c; padding-top: 6px; }
  .agent-track-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #111; }
  .agent-track-row:last-child { border-bottom: none; }
  .agent-track-name { font-family: 'Space Mono', monospace; font-size: 9px; color: #9e9690; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent-track-btns { display: flex; gap: 4px; flex-shrink: 0; }
  .track-play-btn { background: transparent; border: 1px solid #4caf82; color: #4caf82; font-size: 9px; padding: 2px 6px; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .track-play-btn:hover { background: rgba(76,175,130,.12); }
  .track-brain-btn { background: transparent; border: 1px solid #c9a84c; color: #c9a84c; font-size: 9px; padding: 2px 6px; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .track-brain-btn:hover { background: rgba(201,168,76,.1); }
  :global(.ao-tag-gap) { color: #e05a4a; font-weight: 500; margin-right: 4px; }
  :global(.ao-tag-ok)  { color: #4caf82; font-weight: 500; margin-right: 4px; }
  :global(.agent-label-confirmed) { color: #c9a84c; font-weight: 500; }
  :global(.agent-label-tension)   { color: #e8a838; font-weight: 500; }
  :global(.agent-label-outdated)  { color: #9e9690; font-weight: 500; }
  :global(.agent-label-new)       { color: #4a9fd4; font-weight: 500; }
  .task-scroll { }
  .task-scroll.scrollable { max-height: calc(7 * 50px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .year-scroll { max-height: calc(10 * 32px); overflow-y: auto; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .inbox-scroll { max-height: 600px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #252525 transparent; }
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #1a1a1a; }
  .chart-col { display: flex; flex-direction: column; gap: 3px; }
  .tiktok-col { grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px; }
  .tiktok-col .chart-title { grid-column: span 2; }
  .chart-title { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: rgba(201,168,76,.6); letter-spacing: .08em; margin-bottom: 4px; }
  .chart-track-row { display: flex; align-items: center; gap: 5px; padding: 3px 0; border-bottom: 1px solid #151515; }
  .chart-track-row:last-child { border-bottom: none; }
  .chart-pos { font-family: 'Space Mono', monospace; font-size: 9px; color: #3c3c3c; min-width: 13px; text-align: right; flex-shrink: 0; }
  .chart-track-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .chart-track-artist { font-size: 11px; color: #cec9c1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .chart-track-title-text { font-size: 10px; color: #9e9690; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
  .chart-track-actions { display: flex; gap: 2px; flex-shrink: 0; }
  .chart-play-btn, .chart-lib-btn { background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; cursor: pointer; font-size: 9px; padding: 2px 4px; line-height: 1; }
  .chart-play-btn { color: #4caf82; }
  .chart-lib-btn { color: #9e9690; }
  .chart-play-btn:hover, .chart-lib-btn:hover { background: #252525; }
  .in-library-badge { font-family: 'Space Mono', monospace; font-size: 7px; color: #2a4a2a; padding: 2px 5px; }
  .suggested-tracks { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #1a1a1a; }
  .articles-block { padding: 4px 0; }
  .articles-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 6px 0; border-top: 1px solid #1a1a1a; }
  .articles-count { font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.6); letter-spacing: .05em; }
  .articles-toggle { font-size: 9px; color: #3c3c3c; }
  .inbox-row { display: flex; align-items: flex-start; gap: 0; }
  .inbox-del-btn { flex-shrink: 0; order: -1; background: transparent; border: none; color: #444; font-size: 13px; cursor: pointer; padding: 10px 6px 10px 2px; align-self: flex-start; }
  .inbox-del-btn:hover { color: #e05a4a; }
  .inbox-speak-btn { width: 28px; height: 28px; border-radius: 50%; background: #1c1c1c; border: 1px solid #303030; color: #c9a84c; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; transition: all .15s; }
  .inbox-speak-btn:hover { border-color: rgba(201,168,76,.5); }
  .inbox-speak-btn.playing { background: rgba(201,168,76,.1); border-color: #c9a84c; }
  .speak-toast { font-family: 'Space Mono', monospace; font-size: 10px; color: #f5f1ea; background: #252525; border: 1px solid #303030; border-radius: 3px; padding: 7px 12px; margin-bottom: 6px; }
  .goal-check-btn { border-color: rgba(76,175,130,.25); color: rgba(76,175,130,.5); }
  .goal-check-btn:hover { border-color: rgba(76,175,130,.5); color: rgba(76,175,130,.8); }
  .year-done-row { opacity: .35; }
  .year-past-row { opacity: .5; }
  .year-today-sep { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: #c9a84c; letter-spacing: .1em; padding: 6px 0 3px; border-top: 1px solid rgba(201,168,76,.2); margin-top: 4px; }
  .task-flat-row.deadline-row { background: #0d0d0a; }
  .week-view { display: flex; flex-direction: column; }
  .week-day-block { border-bottom: 1px solid #1c1c1c; }
  .week-day-block.is-today { background: rgba(201,168,76,.04); border-left: 2px solid rgba(201,168,76,.3); }
  .week-day-header { display: flex; align-items: baseline; gap: 10px; padding: 8px 10px 4px; }
  .week-day-name { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .1em; color: #9e9690; }
  .week-day-name.today-name { color: #c9a84c; }
  .week-day-date { font-family: 'Space Mono', monospace; font-size: 10px; color: #444; }
  .week-empty-day { padding: 4px 10px 8px; font-family: 'Space Mono', monospace; font-size: 10px; color: #222; }
  .task-flat-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #0f0f0f; }
  .tfl-date { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #cec9c1; flex-shrink: 0; min-width: 38px; }
  .tfl-time { font-family: 'Space Mono', monospace; font-size: 11px; color: #9e9690; flex-shrink: 0; min-width: 38px; }
  .tfl-prefix { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; flex-shrink: 0; }
  .tfl-edit { flex: 1; background: transparent; border: none; color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; min-width: 0; padding: 0; }
  .tfl-edit:focus { background: rgba(255,255,255,.03); border-radius: 2px; }
  .tfl-label { flex: 1; color: #cec9c1; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tfl-done { background: transparent; border: 1px solid #252525; border-radius: 2px; color: #333; font-size: 10px; cursor: pointer; padding: 1px 5px; flex-shrink: 0; }
  .tfl-done:hover { border-color: #4caf82; color: #4caf82; }
  .del-flat { background: transparent; border: none; color: #333; font-size: 14px; cursor: pointer; padding: 0 2px; flex-shrink: 0; }
  .del-flat:hover { color: #e05a4a; }
  .pin-btn { background: transparent; border: none; color: #333; font-size: 13px; cursor: pointer; padding: 0 3px; flex-shrink: 0; line-height: 1; }
  .pin-btn.pinned { color: #c9a84c; }
  .pin-btn:hover { color: #c9a84c; }
  .focus-block { background: rgba(201,168,76,.08); border: 1px solid rgba(201,168,76,.3); border-left: 3px solid #c9a84c; border-radius: 4px; padding: 10px 14px; margin-bottom: 12px; }
  .focus-label { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-bottom: 4px; }
  .focus-task { font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 400; color: #f5f1ea; }
  .edit-time-btn { background: transparent; border: none; color: #444; font-size: 12px; cursor: pointer; padding: 0 3px; flex-shrink: 0; }
  .edit-time-btn:hover, .edit-time-btn.on { color: #c9a84c; }
  .task-edit-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px 6px; background: #111; border-bottom: 1px solid #0f0f0f; }
  .cal-actions-row { display: flex; gap: 8px; padding: 8px 0 0; }
  .clickable-row { cursor: pointer; transition: background .1s; }
  .clickable-row:hover { background: rgba(76,175,130,.06); border-radius: 3px; }
  .type-sel { flex-shrink: 0; width: 90px; }
  .proj-sel { flex-shrink: 0; width: 110px; }
  .up-row { display: flex; align-items: center; gap: 9px; padding: 7px 12px; border-bottom: 1px solid #0d0d0d; background: #0a0a0a; }
  .up-row:last-child { border-bottom: none; }
  .up-row.today { background: rgba(201,168,76,.04); border-left: 3px solid rgba(201,168,76,.5); }
  .up-row.tomorrow { background: rgba(74,159,212,.03); border-left: 3px solid rgba(74,159,212,.3); }
  .up-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .up-label { font-size: 14px; color: #cec9c1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .up-proj { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; }
  .up-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; flex-shrink: 0; }
  .up-row.today .up-date { color: #c9a84c; font-weight: 700; }
  .up-row.tomorrow .up-date { color: #4a9fd4; }

  /* Routine / Health */
  .sections { display: flex; border-bottom: 1px solid #1c1c1c; margin-bottom: 8px; }
  .sec-tab { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: .1em; padding: 8px 14px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #555; cursor: pointer; transition: all .15s; margin-bottom: -1px; }
  .sec-tab:hover { color: #9e9690; }
  .sec-tab.on { color: #c9a84c; border-bottom-color: #c9a84c; }
  .check-list { display: flex; flex-direction: column; gap: 6px; }
  .routine-divider { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: .1em; color: rgba(201,168,76,.4); padding: 10px 0 4px; border-top: 1px solid #1a1a1a; margin-top: 16px; }
  .check-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: transparent; min-height: 0; }
  .check-item.done { opacity: .38; }
  .helper-search-inp { background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; font-size: 12px; font-family: 'DM Sans', sans-serif; padding: 3px 8px; border-radius: 3px; width: 150px; flex-shrink: 0; outline: none; }
  .helper-search-inp::placeholder { color: #3a3a3a; }
  .helper-search-inp:focus { border-color: rgba(201,168,76,.4); }
  .helper-search-go { font-family: 'Space Mono', monospace; font-size: 12px; padding: 3px 8px; background: transparent; border: 1px solid #303030; color: #9e9690; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .helper-search-go:hover { color: #c9a84c; border-color: #c9a84c; }
  .reorder-col { display: flex; flex-direction: row; gap: 2px; flex-shrink: 0; }
  .reorder-micro { font-size: 9px; padding: 2px 4px; background: transparent; border: none; color: #2a2a2a; cursor: pointer; line-height: 1; }
  .reorder-micro:hover { color: #c9a84c; }
  .ckb.blue { color: #4a90e2; }
  .check-item.done .ckb { background: rgba(76,175,130,.15); border-color: #4caf82; }
  .check-item.done .ckb.blue { background: rgba(74,144,226,.12); border-color: #4a90e2; }
  .item-label { flex: 1; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; color: #9e9690; text-decoration: none; }
  .check-item.done .item-label { color: #555; text-decoration: line-through; }
  .add-row { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
  .add-inp { background: #1c1c1c; border: 1px solid #252525; color: #f5f1ea; font-family: 'Space Mono', monospace; font-size: 12px; padding: 5px 9px; outline: none; border-radius: 3px; }
  .add-inp:focus { border-color: rgba(201,168,76,.4); }
  .helpers-built-in { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
  .ref-row { display: flex; gap: 6px; align-items: center; }
  .ref-inp { flex: 1; }
  .ref-moves { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .ref-move-item { font-family: 'Space Mono', monospace; font-size: 10px; color: #4caf82; }
  .helper-block { display: flex; flex-direction: column; gap: 8px; }
  .normalizer-title { font-family: 'Space Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .title-gen-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  .title-gen-inp { flex: 1; }
  .title-gen-results { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
  .title-gen-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #111; border: 1px solid #1c1c1c; border-radius: 3px; }
  .title-gen-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; flex: 1; }
  .title-copy-btn { font-family: 'Space Mono', monospace; font-size: 10px; padding: 3px 8px; background: transparent; border: 1px solid #252525; color: #555; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .title-copy-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .btn-gold-sm.dim { opacity: .5; cursor: not-allowed; }
  .normalizer-drop { border: 1px dashed #252525; border-radius: 3px; padding: 10px 14px; cursor: copy; transition: all .15s; }
  .normalizer-drop.dragging { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .normalizer-drop.ok { border-color: rgba(76,175,130,.4); background: rgba(76,175,130,.04); }
  .normalizer-drop.err { border-color: rgba(224,90,74,.4); background: rgba(224,90,74,.04); }
  .norm-hint { font-family: 'Space Mono', monospace; font-size: 11px; color: #333; }
  .norm-ok { font-family: 'Space Mono', monospace; font-size: 11px; color: #4caf82; }
  .norm-err { font-family: 'Space Mono', monospace; font-size: 11px; color: #e05a4a; }
  .helper-sub { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #333; }
  .acapella-drop { border: 1px dashed #252525; border-radius: 3px; padding: 20px; text-align: center; min-height: 70px; display: flex; align-items: center; justify-content: center; cursor: pointer; margin: 6px 0; transition: border-color .15s; }
  .acapella-drop.dragging { border-color: #c9a84c; background: rgba(201,168,76,.04); }
  .acapella-placeholder { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #333; display: flex; flex-direction: column; gap: 4px; align-items: center; }
  .acapella-loading { font-family: 'Space Mono', monospace; font-size: 10px; color: #c9a84c; }
  .acapella-ready { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .extract-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; background: rgba(201,168,76,.08); border: 1px solid rgba(201,168,76,.3); color: #c9a84c; padding: 5px 14px; border-radius: 2px; cursor: pointer; }
  .extract-btn:hover { background: rgba(201,168,76,.15); }
  .acapella-result { background: #111; border-radius: 3px; padding: 8px 10px; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
  .result-row { display: flex; gap: 8px; align-items: baseline; }
  .result-label { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; letter-spacing: .08em; width: 56px; flex-shrink: 0; }
  .result-val { font-family: 'Space Mono', monospace; font-size: 10px; color: #9e9690; }
  .midi-progress { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .midi-step { font-family: 'Space Mono', monospace; font-size: 9px; color: #4caf82; }
  .midi-step.pending { color: #444; }
  .ableton-status-row { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; }
  .ableton-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .ableton-dot.on { background: #4caf82; box-shadow: 0 0 4px rgba(76,175,130,.6); }
  .ableton-dot.off { background: #555; }
  .ableton-status-text { font-family: 'Space Mono', monospace; font-size: 10px; }
  .ableton-status-text.on { color: #4caf82; }
  .ableton-status-text.off { color: #555; }
  .ableton-tools-details { margin-bottom: 8px; }
  .ableton-tools-summary { font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.75); cursor: pointer; padding: 4px 0; user-select: none; }
  .ableton-tools-summary::-webkit-details-marker { color: rgba(201,168,76,.5); }
  .ableton-tools-panel { background: #111; border: 1px solid #252525; border-radius: 3px; padding: 10px; margin-top: 6px; max-height: 280px; overflow-y: auto; }
  .ableton-cat-label { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); text-transform: uppercase; letter-spacing: .06em; margin: 8px 0 4px; }
  .ableton-cat-label:first-child { margin-top: 0; }
  .ableton-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ableton-chip { font-family: 'Space Mono', monospace; font-size: 9px; background: rgba(201,168,76,.07); border: 1px solid rgba(201,168,76,.2); color: #c9a84c; padding: 3px 7px; border-radius: 2px; cursor: pointer; line-height: 1.4; }
  .ableton-chip:hover { background: rgba(201,168,76,.18); border-color: rgba(201,168,76,.45); }
  .ableton-textarea { width: 100%; background: #111; border: 1px solid #252525; border-radius: 3px; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 8px 10px; resize: vertical; outline: none; box-sizing: border-box; }
  .ableton-textarea:focus { border-color: rgba(201,168,76,.4); }
  .ableton-textarea::placeholder { color: #333; }
  .ableton-mode-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .ableton-mode-btn { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; background: transparent; border: 1px solid #303030; color: #555; padding: 5px 10px; border-radius: 2px; cursor: pointer; white-space: nowrap; }
  .ableton-mode-btn.active { background: rgba(201,168,76,.12); border-color: rgba(201,168,76,.45); color: #c9a84c; }
  .ableton-mode-btn:hover:not(.active) { border-color: #444; color: #9e9690; }
  .ableton-send-btn { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; background: rgba(201,168,76,.1); border: 1px solid rgba(201,168,76,.35); color: #c9a84c; padding: 5px 14px; border-radius: 2px; cursor: pointer; margin-left: auto; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .ableton-send-btn:hover:not(:disabled) { background: rgba(201,168,76,.18); }
  .ableton-send-btn:disabled { opacity: .6; cursor: not-allowed; }
  .ableton-spinner { width: 10px; height: 10px; border: 2px solid rgba(201,168,76,.3); border-top-color: #c9a84c; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ableton-response { margin-top: 8px; border-radius: 3px; font-family: 'Space Mono', monospace; font-size: 10px; overflow: hidden; }
  .ableton-response.ok { border: 1px solid rgba(76,175,130,.3); }
  .ableton-response.err { border: 1px solid rgba(229,115,115,.3); }
  .ableton-response-cmd { padding: 5px 8px; color: #4caf82; background: rgba(76,175,130,.06); border-bottom: 1px solid rgba(76,175,130,.15); }
  .ableton-response-pre { margin: 0; padding: 8px; color: #cec9c1; background: #0d0d0d; font-size: 9.5px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .ableton-response-error { padding: 8px; color: #e57373; background: rgba(229,115,115,.06); }
  .ableton-seq-results { margin-top: 8px; border: 1px solid #252525; border-radius: 3px; overflow: hidden; }
  .ableton-seq-step { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border-bottom: 1px solid #1a1a1a; font-family: 'Space Mono', monospace; font-size: 9.5px; }
  .ableton-seq-step:last-of-type { border-bottom: none; }
  .ableton-seq-step.ok { background: rgba(76,175,130,.03); }
  .ableton-seq-step.err { background: rgba(229,115,115,.04); }
  .ableton-seq-icon { flex-shrink: 0; width: 12px; }
  .ableton-seq-step.ok .ableton-seq-icon { color: #4caf82; }
  .ableton-seq-step.err .ableton-seq-icon { color: #e57373; }
  .ableton-seq-type { color: #c9a84c; flex-shrink: 0; }
  .ableton-seq-peek { color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .ableton-seq-err { color: #e57373; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ableton-seq-summary { padding: 5px 8px; font-family: 'Space Mono', monospace; font-size: 9px; border-top: 1px solid #252525; }
  .ableton-seq-summary.ok { color: #4caf82; background: rgba(76,175,130,.05); }
  .ableton-seq-summary.partial { color: #e57373; background: rgba(229,115,115,.04); }
  .add-inp::placeholder { color: #555; }
  .add-inp.url { flex: 2; min-width: 120px; }
  .add-btn { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; padding: 5px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
  .daily-toggle { font-size: 14px; padding: 3px 7px; background: transparent; border: 1px solid #252525; border-radius: 3px; cursor: pointer; color: #444; flex-shrink: 0; }
  .daily-toggle.on { border-color: #c9a84c; color: #c9a84c; background: rgba(201,168,76,.08); }
  .recurring-row { background: transparent; }
  .tfl-daily { font-size: 13px; color: #c9a84c; width: 40px; flex-shrink: 0; }

  /* Calendar */
  .cal-wrap { background: #1c1c1c; border-radius: 4px; padding: 14px; border: 1px solid #252525; }
  .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .cal-month { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; color: #cec9c1; }
  .cal-nav { background: transparent; border: none; color: #555; font-size: 18px; cursor: pointer; padding: 0 6px; }
  .cal-nav:hover { color: #c9a84c; }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .cal-day-lbl { font-family: 'Space Mono', monospace; font-size: 9px; color: #444; text-align: center; padding: 3px 0; }
  .cal-cell { position: relative; font-family: 'Space Mono', monospace; font-size: 11px; color: #9e9690; text-align: center; padding: 5px 2px; border-radius: 3px; cursor: pointer; background: transparent; border: none; transition: all .15s; width: 100%; }
  .cal-cell:hover { background: #252525; color: #f5f1ea; }
  .cal-cell.today { color: #f5f1ea; font-weight: 700; }
  .cal-cell.sel { background: rgba(201,168,76,.15); color: #c9a84c; }
  .cal-dot { position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; display: block; }
  .gold-dot { background: #c9a84c; }
  .blue-dot { background: #4a9fd4; left: 55%; }

  /* Day detail */
  .day-detail { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .detail-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #111; }
  .dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .detail-label { flex: 1; font-size: 13px; color: #cec9c1; }
  .done-txt { text-decoration: line-through; color: #444; }
  .detail-proj { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }

  /* Upcoming week */
  .week-block { margin-top: 16px; border-top: 1px solid #1c1c1c; padding-top: 12px; }
  .week-today-badge { font-family: 'Space Mono', monospace; font-size: 9px; padding: 1px 5px; background: rgba(201,168,76,.15); border: 1px solid rgba(201,168,76,.3); color: #c9a84c; border-radius: 2px; }
  .week-task-row { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 2px; background: #0f0f0f; margin-bottom: 2px; }
  .week-task-row.dim { opacity: .35; }
  .week-task-label { flex: 1; font-size: 12px; color: #cec9c1; }
  .week-task-proj { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .week-task-time { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; flex-shrink: 0; }

  /* TODAY section */
  .today-section { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; margin-bottom: 8px; display: flex; flex-direction: column; gap: 0; }
  .agent-row { display: flex; gap: 6px; justify-content: flex-end; padding: 8px 10px; border-bottom: 1px solid #141414; background: #0d0d0d; }
  .today-tasks-list { border-bottom: 1px solid #141414; }

  /* PLAN section */
  .plan-section { border: 1px solid #1c1c1c; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }

  /* Mozart */
  .mozart-block { margin-top: 16px; border-top: 1px solid #1c1c1c; padding-top: 12px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 500px; }
  .mozart-title-row { display: flex; align-items: center; justify-content: space-between; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); margin-bottom: 2px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: #555; color: #9e9690; }
  .chat-out { overflow-y: auto; max-height: 70vh; min-height: 300px; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; scroll-behavior: smooth; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; line-height: 1.5; }
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
  .chat-input-row { display: flex; gap: 6px; }
  .chat-correction-row { display: flex; gap: 6px; margin-top: 4px; }
  .btn-wrong { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 7px; background: transparent; border: 1px solid #303030; color: #555; border-radius: 2px; cursor: pointer; }
  .btn-wrong:hover { border-color: #c0392b; color: #c0392b; }
  .correction-inp { margin-top: 4px; width: 100%; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; padding: 5px 8px; font-size: 12px; color: #cec9c1; font-family: 'DM Sans', sans-serif; outline: none; }
  .correction-inp:focus { border-color: #c0392b; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 7px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
  /* References tab */
</style>
