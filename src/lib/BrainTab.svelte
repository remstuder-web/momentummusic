<script>
  import { onMount } from 'svelte'
  import { supabase } from './supabase.js'
  import { buildMozartContext, parseActions, executeAction } from './mozartContext.js'

  const DUMP_HINTS = [
    "Paste a Spotify link to analyze a track...",
    "Drop an image or screenshot here...",
    "Write a rule: 'I never release without...'",
    "Paste a YouTube link to analyze...",
    "What did you learn from the last session?",
    "Which artist inspires your current sound?",
    "Paste a WhatsApp conversation to extract info...",
    "What's a production technique you keep coming back to?",
    "Drop a PDF for feedback extraction...",
    "What's a business opportunity you noticed today?"
  ]
  let placeholderIndex = $state(0)

  let undoStack = $state([])

  function pushBrainUndo(description, entryId, entrySnapshot) {
    undoStack = [{ description, entryId, entrySnapshot, timestamp: Date.now() }, ...undoStack].slice(0, 10)
  }

  async function undoBrain() {
    if (!undoStack.length) return
    const action = undoStack[0]
    undoStack = undoStack.slice(1)
    if (action.entrySnapshot) {
      await supabase.from('brain_knowledge').insert(action.entrySnapshot)
    } else {
      await supabase.from('brain_knowledge').delete().eq('id', action.entryId)
    }
    await loadEntries()
  }

  let dumpText = $state('')
  let dumpDragging = $state(null)
  let fileDragging = $state(false)
  let uploadedFile = $state(null)
  let fileUploading = $state(false)
  let processing = $state(false)
  let capturing = $state(false)
  let captureResult = $state(null)
  let captureMixingSuggestions = $state([])
  let captureEntryId = $state(null)
  let captureContext = $state('')
  let capturedSavedCategory = $state('')
  let entries = $state([])
  let lastExtracted = $state(null)
  let entriesOpen = $state(false)
  let libraryExpanded = $state(false)
  let myRefsExpanded = $state(true)
  let checkoutExpanded = $state(true)
  let librarySearch = $state('')

  // Preview audio player
  let previewAudio = null
  let playingId = $state(null)

  function playPreview(track) {
    if (!track.preview_url) {
      window.open(
        'https://open.spotify.com/track/' + track.spotify_id,
        'momentum_popup',
        'width=900,height=700,left=200,top=100,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes'
      )
      return
    }
    if (playingId === track.id) {
      previewAudio?.pause()
      playingId = null
      return
    }
    previewAudio?.pause()
    previewAudio = new Audio(track.preview_url)
    previewAudio.volume = 0.8
    previewAudio.play()
    playingId = track.id
    previewAudio.onended = () => { playingId = null }
  }
  let expandedEntries = $state({})
  let watchedArtists = $state([])
  let referenceTrackEntries = $state([])
  let importResult = $state(null)
  let importCategory = $state('reference_tracks')
  let newCategoryForImport = $state('')
  let duplicateWarnings = $state([])
  let pendingApproval = $state([])
  let pendingOriginalText = $state('')
  let showApproval = $state(false)
  let newCategoryInput = $state({})
  let spotifyPreview = $state(null)
  let spotifyPreviewType = $state('reference_current')
  let spotifyMixerName = $state('')

  let catSuggestion = $state(null)
  let catSuggestLoading = $state(false)
  let catSuggestOverride = $state('')
  let splitEdits = $state([])
  let prefilledCategory = $state('')
  let dumpCollection = $state('')
  let priorityFilter = $state(false)

  let brainSearch = $state('')
  let confidenceTooltip = $state(null) // { entryId, to, label }
  let dueReviewItems = $state([])

  let tracksByGenre = $derived.by(() => {
    const groups = {}
    for (const t of referenceTrackEntries) {
      if (t.collection_name === 'my_productions') continue
      const genre = (t.genre_tags?.[0]) || 'other'
      if (!groups[genre]) groups[genre] = []
      groups[genre].push(t)
    }
    return groups
  })

  const COL_LABELS = {
    daily_chart: 'DAILY CHART TRACKS',
    my_productions: 'MY PRODUCTIONS',
    reference_current: 'AKTUELLE REFS',
    reference_mixing: 'MIX REFS',
    reference_inspiration: 'MUSIC REFS',
    reference_sound: 'SOUND REFS'
  }

  let refByCollection = $derived.by(() => {
    const acc = {}
    for (const t of referenceTrackEntries) {
      const col = t.collection_name || 'other'
      if (!acc[col]) acc[col] = []
      acc[col].push(t)
    }
    return acc
  })

  const checkoutRefs = $derived(
    referenceTrackEntries
      .filter(t => t.source === 'checkout')
      .sort((a, b) => (a.artist || '').localeCompare(b.artist || ''))
  )
  const myRefs = $derived(
    referenceTrackEntries
      .filter(t => t.source === 'user' || t.source === 'mozart' || t.promoted === true)
      .sort((a, b) => (a.artist || '').localeCompare(b.artist || ''))
  )
  const libraryRefs = $derived(
    referenceTrackEntries
      .filter(t => t.source === 'agent' && !t.promoted)
      .sort((a, b) => (a.artist || '').localeCompare(b.artist || ''))
  )
  const filteredLibraryRefs = $derived(
    libraryRefs.filter(t =>
      !librarySearch ||
      (t.title || '').toLowerCase().includes(librarySearch.toLowerCase()) ||
      (t.artist || '').toLowerCase().includes(librarySearch.toLowerCase())
    )
  )

  // Categories derived from loaded entries — used for Claude prompts inside processDump
  let distinctCategories = $derived([...new Set(entries.map(e => e.category).filter(Boolean))].sort())

  // Live-loaded category list — used for datalist, suggest-category, and post-save refresh
  let existingCategories = $state([])

  async function loadCategories() {
    const { data } = await supabase
      .from('brain_knowledge')
      .select('category')
      .not('category', 'is', null)
    existingCategories = [...new Set((data || []).map(r => r.category))].sort()
  }

  async function loadEntries() {
    const { data, error } = await supabase
      .from('brain_knowledge')
      .select('*')
      .order('category')
      .order('created_at', { ascending: false })
    if (error) console.error('brain_knowledge load error:', error.message)
    entries = data || []

    const seen = {}
    const warnings = []
    for (const e of entries) {
      const key = e.category
      if (!seen[key]) seen[key] = []
      const shortTitle = e.title.slice(0, 30).toLowerCase()
      if (seen[key].some(t => t.includes(shortTitle.slice(0, 15)))) {
        warnings.push(`Possible duplicate in ${e.category}: "${e.title.slice(0, 40)}"`)
      }
      seen[key].push(shortTitle)
    }
    duplicateWarnings = warnings

    const { data: wa, error: waErr } = await supabase
      .from('watched_artists')
      .select('*')
      .eq('active', true)
      .order('artist_name')
    if (waErr) console.error('watched_artists load error:', waErr.message)
    watchedArtists = wa || []

    const { data: tracks, error: tErr } = await supabase
      .from('reference_tracks')
      .select('*')
      .order('created_at', { ascending: false })
    if (tErr) console.error('reference_tracks load error:', tErr.message)
    referenceTrackEntries = tracks || []
    await loadCategories()
  }

  async function updateTrackNotes(id, notes) {
    await supabase.from('reference_tracks').update({ notes }).eq('id', id)
    referenceTrackEntries = referenceTrackEntries.map(t => t.id === id ? { ...t, notes } : t)
  }

  async function promoteTrack(id) {
    await supabase.from('reference_tracks').update({ source: 'user', promoted: true }).eq('id', id)
    referenceTrackEntries = referenceTrackEntries.map(t => t.id === id ? { ...t, source: 'user', promoted: true } : t)
  }

  async function promoteToMyRefs(id) {
    await supabase.from('reference_tracks').update({ source: 'user', checkout_date: null }).eq('id', id)
    referenceTrackEntries = referenceTrackEntries.map(t => t.id === id ? { ...t, source: 'user', checkout_date: null } : t)
  }

  async function promoteToLibrary(id) {
    await supabase.from('reference_tracks').update({ source: 'agent', checkout_date: null }).eq('id', id)
    referenceTrackEntries = referenceTrackEntries.map(t => t.id === id ? { ...t, source: 'agent', checkout_date: null } : t)
  }

  async function deleteRef(id) {
    await supabase.from('reference_tracks').delete().eq('id', id)
    referenceTrackEntries = referenceTrackEntries.filter(t => t.id !== id)
  }

  async function unwatchArtist(id) {
    await supabase.from('watched_artists').update({ active: false }).eq('id', id)
    watchedArtists = watchedArtists.filter(a => a.id !== id)
  }

  async function captureScreen() {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add API key in Settings.'); return }
    capturing = true
    captureResult = null
    captureMixingSuggestions = []
    captureEntryId = null
    try {
      await new Promise(r => setTimeout(r, 3000))
      const res = await fetch('http://localhost:4242/capture-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, context: captureContext })
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      captureResult = d.analysis
      captureMixingSuggestions = d.mixing_suggestions || []
      captureEntryId = d.saved_entry_id || null
      // Auto-suggest category from analysis text
      try {
        await loadCategories()
        const catRes = await fetch('http://localhost:4242/suggest-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: d.analysis, existingCategories, apiKey })
        })
        const catD = await catRes.json()
        const suggestedCat = catD.ok ? (catD.suggestion || catD.category || '') : ''
        capturedSavedCategory = suggestedCat
        if (suggestedCat && captureEntryId) {
          await supabase.from('brain_knowledge').update({ category: suggestedCat }).eq('id', captureEntryId)
        }
      } catch(e) { console.error('capture category suggest error:', e.message) }
      await loadEntries()
    } catch(e) {
      alert('Screen capture failed: ' + e.message + '\nMake sure watcher is running.')
    }
    capturing = false
  }

  async function processImageDump(file) {
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { alert('Add API key in Settings.'); return }

    processing = true
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const catList = existingCategories.join(', ')

      const imgSystemContext = await buildMozartContext(supabase)

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          ...(imgSystemContext ? { system: imgSystemContext } : {}),
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 }},
            { type: 'text', text:
              `Read this image and extract all useful information for a music producer.
Could be: artist info, chart data, conversation screenshot, trends, analytics, anything.

Extract what is relevant. Keep all concrete facts verbatim.
Suggest the best category from:
${catList}

Return ONLY JSON:
[{
  "category": "best category",
  "isNewCategory": false,
  "entry_type": "fact",
  "title": "what this image shows (max 8 words)",
  "content": "all extracted information, verbatim where possible"
}]`
            }
          ]}]
        })
      })

      const d = await response.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/brain-vision', model: 'claude-sonnet-4-20250514', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000003) + (d.usage.output_tokens * 0.000015) }) }).catch(() => {})
      if (d.error) throw new Error(d.error.message)

      const raw = d.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '[]'
      const match = raw.match(/\[[\s\S]*\]/)
      const items = match ? JSON.parse(match[0]) : []

      if (items.length) {
        pendingApproval = items
        showApproval = true
      }
    } catch(e) { alert('Image processing error: ' + e.message) }
    processing = false
  }

  async function fetchCatSuggestion() {
    if (/spotify\.com/.test(dumpText)) return
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) return
    catSuggestLoading = true
    catSuggestion = null
    catSuggestOverride = ''
    splitEdits = []

    // Goal/rule text — skip API call, route directly to goal category
    if (/main goal|always|never|rule:|goal:|north star|principle|philosophy/i.test(dumpText)) {
      catSuggestion = {
        action: 'existing',
        suggestion: 'goal',
        reason: 'This looks like a personal goal or rule — saved directly to goal category.',
        alternatives: []
      }
      catSuggestLoading = false
      return
    }

    try {
      // Always refresh categories before suggesting — never use a stale list
      await loadCategories()
      const res = await fetch('http://localhost:4242/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: dumpText, existingCategories, apiKey })
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      catSuggestion = d
      if (d.action === 'split' && Array.isArray(d.splits)) {
        splitEdits = d.splits.map(s => ({ category: s.category, title: s.title || s.content?.slice(0, 60) || '', content: s.content || s.text || '' }))
      }
    } catch(e) {
      console.error('suggest-category error:', e.message)
      // On error just proceed directly to normal processing
      catSuggestion = null
    }
    catSuggestLoading = false
  }

  async function proceedAfterSuggestion(category) {
    prefilledCategory = category
    catSuggestion = null
    await processDump()
    prefilledCategory = ''
  }

  async function saveSplitsDirect() {
    for (const s of splitEdits) {
      if (!s.content.trim()) continue
      const title = s.title || s.content.trim().slice(0, 60)
      const { data: existing } = await supabase.from('brain_knowledge').select('id').eq('category', s.category).eq('title', title).maybeSingle()
      if (existing) { console.warn('Duplicate skipped:', title); continue }
      await supabase.from('brain_knowledge').insert({
        category: s.category,
        title,
        content: s.content.trim(),
        entry_type: 'knowledge',
        active: true
      })
    }
    catSuggestion = null
    splitEdits = []
    dumpText = ''
    await loadEntries()
  }

  async function handleFileDrop(file) {
    fileUploading = true
    uploadedFile = null
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('http://localhost:4242/brain-file-upload', { method: 'POST', body: fd })
      const d = await r.json()
      uploadedFile = d.ok ? { name: file.name, ok: true } : { name: file.name, ok: false, error: d.error }
    } catch(e) {
      uploadedFile = { name: file.name, ok: false, error: e.message }
    } finally {
      fileUploading = false
    }
  }

  async function processDump() {
    if (processing) return
    if (!dumpText.trim()) return
    const apiKey = localStorage.getItem('mm_api_key') || ''

    const _isQuestion = dumpText.trim().endsWith('?') || /^(how|what|why|when|where|who|should|can|could|would)/i.test(dumpText.trim())
    const _isLong = dumpText.trim().split(/\s+/).length > 300
    console.log('CHECK ORDER: spotify=', /spotify\.com\/(track|playlist|album|artist)/.test(dumpText), 'question=', _isQuestion, 'long=', _isLong)

    if (!apiKey) { alert('Add API key in Settings.'); return }

    // 1a0. WHATSAPP EXPORT — multi-entry extraction (supports / and . date separators)
    if (/\d{1,2}[/.]\d{1,2}[/.]\d{2,4}.*[-–].*:/.test(dumpText) && dumpText.split('\n').length > 5) {
      processing = true
      const chatText = dumpText
      dumpText = ''
      try {
        const r = await fetch('http://localhost:4242/analyze-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatText, apiKey, existingCategories: distinctCategories })
        })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error)
        const rawEntries = d.entries || d.items || []
        pendingApproval = rawEntries.map(e => ({
          ...e,
          suggestedCategory: e.suggestedCategory || e.category || 'collaboration',
          isNewCategory: e.isNewCategory ?? !existingCategories.includes(e.suggestedCategory || e.category || 'collaboration')
        }))
        showApproval = true
      } catch(e) { alert('Chat analysis failed: ' + e.message) }
      processing = false
      return
    }

    // 1aa. TIKTOK / INSTAGRAM / YOUTUBE URL — audio extraction
    if (/tiktok\.com|instagram\.com|youtube\.com\/watch|youtu\.be/.test(dumpText.trim())) {
      processing = true
      const urlToAnalyze = dumpText.trim()
      dumpText = ''
      try {
        const r = await fetch('http://localhost:4242/analyze-youtube-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlToAnalyze })
        })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error)
        spotifyPreview = { ...d, art_url: null, album: '', genres: [], popularity: null, key_confidence: null }
        spotifyPreviewType = 'reference_current'
      } catch(e) { alert('Audio analysis failed: ' + e.message) }
      processing = false
      return
    }

    // 1a. SPOTIFY TRACK — preview card flow (no Claude needed)
    const spotifyTrackM = dumpText.match(/spotify\.com\/(?:intl-\w+\/)?track\/([a-zA-Z0-9]+)/)
    if (spotifyTrackM) {
      processing = true
      dumpText = '' // clear immediately on URL recognition
      try {
        const r = await fetch('http://localhost:4242/analyze-spotify-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: spotifyTrackM[0] })
        })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error)
        spotifyPreview = d
      } catch(e) { alert('Spotify track analysis failed: ' + e.message) }
      processing = false
      return
    }

    // 1b. SPOTIFY PLAYLIST / ARTIST — full import flow
    const spotifyM = dumpText.match(
      /https:\/\/open\.spotify\.com\/(?:intl-\w+\/)?(playlist|album|artist)\/([a-zA-Z0-9]+)/
    )
    if (spotifyM) {
      processing = true
      try {
        const r = await fetch('http://localhost:4242/agent-import-spotify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: spotifyM[0], type: spotifyM[1], apiKey })
        })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error)
        importResult = d; dumpText = ''; await loadEntries()
      } catch(e) { alert('Spotify import failed: ' + e.message) }
      processing = false
      return
    }

    // 2. QUESTION CHECK — verbatim, no Claude
    const isQuestion = dumpText.trim().endsWith('?')
      || /^(how|what|why|when|where|who|should|can|could|would)/i.test(dumpText.trim())
    if (isQuestion) {
      pendingApproval = [{
        entry_type: 'question',
        suggestedCategory: 'question',
        title: dumpText.trim().slice(0, 60),
        content: dumpText.trim(),
        verbatim_full: dumpText.trim()
      }]
      showApproval = true
      return
    }

    // 2b. CATEGORY SUGGESTION — intercept for text > 200 chars (unless already suggested or prefilled)
    if (dumpText.trim().length > 200 && catSuggestion === null && !prefilledCategory) {
      await fetchCatSuggestion()
      return
    }

    // 3. LENGTH CHECK — long text gets chunked
    const wordCount = dumpText.trim().split(/\s+/).length
    const isLong = wordCount > 300

    // 4. ARTICLE CHECK — external formatting signals
    const isArticle = /https?:\/\//.test(dumpText)
      || dumpText.includes('©')
      || dumpText.split('\n').length > 15

    // Fix 1 — SHORT text with category already chosen: save directly, skip Claude
    if (prefilledCategory && !isLong && !isArticle) {
      processing = true
      try {
        const lines = dumpText.trim().split('\n').filter(Boolean)
        const title = (lines[0] || dumpText.trim()).slice(0, 60)
        await supabase.from('brain_knowledge').insert({
          category: prefilledCategory,
          title,
          content: dumpText.trim(),
          entry_type: 'knowledge',
          active: true,
          collection_name_display: dumpCollection.trim() || null
        })
        dumpText = ''
        dumpCollection = ''
        catSuggestion = null
        newCategoryInput = {}
        await loadEntries()
      } catch(e) { alert('Save error: ' + e.message) }
      processing = false
      return
    }

    processing = true
    try {
      // Full signal context for system prompt
      const systemContext = await buildMozartContext(supabase)

      let prompt = ''

      if (prefilledCategory) {
        // Category already chosen — only extract/structure, never re-suggest
        if (isLong && !isArticle) {
          prompt = `The category is already chosen: ${prefilledCategory}.
Do NOT suggest a different category. Only split and structure the content.
Split this text into logical chunks at natural topic breaks.
Keep ALL text verbatim — do not summarize or rephrase.

Return ONLY JSON:
[{
  "entry_type": "chunk",
  "suggestedCategory": "${prefilledCategory}",
  "isNewCategory": false,
  "title": "short topic label for this chunk",
  "content": "verbatim chunk text"
}]`
        } else {
          prompt = `The category is already chosen: ${prefilledCategory}.
Do NOT suggest a different category. Only extract and structure the content.
Extract ONLY concrete facts: numbers, names, dates, specific claims, statistics.
NO opinions, NO generic advice.
Note the source URL if present.

Return ONLY JSON:
[{
  "entry_type": "fact",
  "suggestedCategory": "${prefilledCategory}",
  "isNewCategory": false,
  "title": "topic of these facts",
  "content": "• fact 1\\n• fact 2\\n• fact 3",
  "source_url": "url if found or empty string"
}]`
        }
      } else if (isLong && !isArticle) {
        prompt = `Split this text into logical chunks at natural topic breaks.
Each chunk should be self-contained and meaningful.
Keep ALL text verbatim — do not summarize or rephrase.
Assign each chunk one of these categories or propose a new one:
${existingCategories.join(', ')}

Return ONLY JSON:
[{
  "entry_type": "chunk",
  "suggestedCategory": "category name",
  "isNewCategory": true/false,
  "title": "short topic label for this chunk",
  "content": "verbatim chunk text"
}]`
      } else if (isArticle) {
        prompt = `Extract ONLY concrete facts from this text:
numbers, names, dates, specific claims, statistics.
NO opinions. NO generic advice. NO interpretations.
Each fact as one short line.
Note the source URL if present.
Suggest a category from: ${existingCategories.join(', ')}

Return ONLY JSON:
[{
  "entry_type": "fact",
  "suggestedCategory": "category name",
  "isNewCategory": false,
  "title": "topic of these facts",
  "content": "• fact 1\\n• fact 2\\n• fact 3",
  "source_url": "url if found or empty string"
}]`
      } else {
        prompt = `Classify this input for a music producer's knowledge base.
Rules:
- If it reads like a personal thought → entry_type: "thought"
- If it's structured knowledge → entry_type: "knowledge"
- Keep content verbatim — do NOT rephrase or summarize
- Title should be descriptive, max 8 words
Existing categories: ${existingCategories.join(', ')}

Return ONLY JSON (single item array):
[{
  "entry_type": "knowledge",
  "suggestedCategory": "exact category name",
  "isNewCategory": true/false,
  "title": "descriptive title",
  "content": "verbatim content"
}]`
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          ...(systemContext ? { system: systemContext } : {}),
          messages: [{ role: 'user', content: prompt + '\n\nINPUT:\n' + dumpText }]
        })
      })
      const d = await res.json()
      if (d.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/brain-dump', model: 'claude-haiku-4-5-20251001', input_tokens: d.usage.input_tokens, output_tokens: d.usage.output_tokens, cost_usd: (d.usage.input_tokens * 0.000001) + (d.usage.output_tokens * 0.000005) }) }).catch(() => {})
      if (d.error) throw new Error(d.error.message)
      const raw = d.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '[]'
      const match = raw.match(/\[[\s\S]*\]/)
      const items = match ? JSON.parse(match[0]) : []

      pendingApproval = items
      pendingOriginalText = dumpText
      showApproval = true

    } catch(e) { alert('Processing error: ' + e.message) }
    processing = false
  }

  async function saveApproved() {
    for (const item of pendingApproval) {
      if ((item.content || '').includes('spotify_id') || (item.content || '').toLowerCase().includes('spotify track')) {
        console.error('saveApproved: blocked Spotify item — use saveSpotifyPreview() instead', item)
        continue
      }
      const { data: existing } = await supabase.from('brain_knowledge').select('id').eq('category', item.suggestedCategory).eq('title', item.title).maybeSingle()
      if (existing) { console.warn('Duplicate skipped:', item.title); continue }
      const _entry = {
        category: item.suggestedCategory,
        title: item.title,
        content: item.content,
        entry_type: item.entry_type || 'knowledge',
        confidence: item.suggestedCategory === 'goal' ? 'locked' : (item.confidence || null),
        source_url: item.source_url || null,
        verbatim_full: item.entry_type === 'chunk' ? pendingOriginalText : null,
        active: true,
        collection_name_display: dumpCollection.trim() || null
      }
      const { data: inserted } = await supabase.from('brain_knowledge').insert(_entry).select('id').single()
      if (inserted?.id) pushBrainUndo('Added: ' + item.title, inserted.id, null)
      fetch('http://localhost:4242/save-brain-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_entry) }).catch(() => {})
    }
    pendingApproval = []
    pendingOriginalText = ''
    showApproval = false
    dumpText = ''
    dumpCollection = ''
    newCategoryInput = {}
    catSuggestion = null
    await loadEntries()
  }

  async function saveTrackImport(trackData) {
    const manualCat = importCategory === '__new__'
      ? newCategoryForImport.trim()
      : importCategory

    // Auto-derive category from first genre if user left it at default
    const firstGenre = trackData.genres?.[0] || ''
    const autoCat = firstGenre.includes('house') || firstGenre.includes('electronic') || firstGenre.includes('techno') ? 'electronic'
      : firstGenre.includes('hip') || firstGenre.includes('rap') || firstGenre.includes('trap') ? 'hiphop'
      : firstGenre.includes('r-n-b') || firstGenre.includes('soul') || firstGenre.includes('rnb') ? 'rnb'
      : firstGenre.includes('afro') ? 'afrobeats'
      : firstGenre.includes('latin') || firstGenre.includes('reggaeton') ? 'latin'
      : firstGenre.includes('pop') ? 'pop'
      : 'reference_inspiration'

    const cat = manualCat || autoCat

    if (cat !== 'reference_tracks' && importResult?.trackData?.spotifyId) {
      await supabase.from('reference_tracks')
        .update({ collection_name: cat })
        .eq('spotify_id', importResult.trackData.spotifyId)
    }

    const content = [
      `Artist: ${trackData.artist}`,
      `Album: ${trackData.album} (${trackData.release_date?.slice(0,4) || '?'})`,
      `BPM: ${trackData.tempo} · Key: ${trackData.key}`,
      `Energy: ${trackData.energy?.toFixed(2)} · Dance: ${trackData.danceability?.toFixed(2)}`,
      `Valence: ${trackData.valence?.toFixed(2)} · Popularity: ${trackData.popularity}/100`,
      `Genres: ${(trackData.genres||[]).join(', ')}`,
      `Followers: ${trackData.artistFollowers?.toLocaleString()}`
    ].join('\n')

    const importTitle = `${trackData.title} — ${trackData.artist}`
    const importSpotifyId = importResult?.trackData?.spotifyId
    let importBrainExists = false
    if (importSpotifyId) {
      const { data: eb } = await supabase
        .from('brain_knowledge')
        .select('id')
        .ilike('source_url', `%${importSpotifyId}%`)
        .maybeSingle()
      importBrainExists = !!eb
    } else {
      const { data: eb2 } = await supabase
        .from('brain_knowledge')
        .select('id')
        .eq('title', importTitle)
        .maybeSingle()
      importBrainExists = !!eb2
    }

    if (!importBrainExists) {
      await supabase.from('brain_knowledge').insert({
        category: cat,
        title: importTitle,
        content,
        entry_type: 'reference_track',
        source_url: importSpotifyId ? `https://open.spotify.com/track/${importSpotifyId}` : null,
        active: true
      })
    }

    importResult = null
    importCategory = 'reference_tracks'
    await loadEntries()
  }

  // spotifyPreviewType is used directly as the brain_knowledge category
  // valid values: reference_current | reference_mixing | reference_inspiration | reference_sound

  async function saveSpotifyPreview() {
    if (!spotifyPreview) return
    const t = spotifyPreview
    const cat = spotifyPreviewType || 'reference_inspiration'

    // Upsert to reference_tracks
    await supabase.from('reference_tracks').upsert({
      spotify_id: t.spotify_id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      release_date: t.release_date,
      genre_tags: t.genres,
      tempo: t.bpm,
      key: t.key,
      energy: t.energy,
      danceability: t.danceability,
      valence: t.valence,
      acousticness: t.acousticness,
      instrumentalness: t.instrumentalness,
      loudness: t.loudness,
      scale: t.scale,
      key_strength: t.key_strength,
      duration_seconds: t.duration_seconds,
      popularity: t.popularity,
      artist_popularity: t.artist_popularity,
      artist_followers: t.artist_followers,
      preview_url: t.preview_url,
      album_art: t.art_url,
      source: 'user',
      approved: true
    }, { onConflict: 'spotify_id' })

    const keyLabel = t.key ? t.key + (t.scale ? ' ' + t.scale : '') : 'unknown'
    const content = [
      `Artist: ${t.artist}`,
      `Album: ${t.album} (${t.release_date?.slice(0,4) || '?'})`,
      t.bpm ? `BPM: ${t.bpm} · Key: ${keyLabel}${t.energy != null ? ' · Energy: ' + t.energy : ''}${t.danceability != null ? ' · Dance: ' + t.danceability : ''}` : null,
      t.valence != null ? `Valence: ${t.valence} · Acousticness: ${t.acousticness ?? '?'} · Instrumental: ${t.instrumentalness ?? '?'}` : null,
      t.loudness != null ? `Loudness: ${t.loudness}LUFS` : null,
      `Popularity: ${t.popularity}/100`,
      t.artist_followers ? `Artist followers: ${t.artist_followers?.toLocaleString()}` : null,
      `Genres: ${(t.genres||[]).slice(0,4).join(', ')}`,
    ].filter(Boolean).join('\n')

    const isCurrent = spotifyPreviewType === 'reference_current'
    const surfacedUntil = isCurrent
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null
    const metadata = {
      ...(spotifyPreviewType === 'reference_mixing' && spotifyMixerName.trim() ? { mixer: spotifyMixerName.trim() } : {}),
      art_url: t.art_url || null,
      artist: t.artist || null,
      spotify_id: t.spotify_id || null
    }

    const spotifyUrl = `https://open.spotify.com/track/${t.spotify_id}`
    let brainAlreadyExists = false
    if (t.spotify_id) {
      const { data: existBrain } = await supabase
        .from('brain_knowledge')
        .select('id')
        .ilike('source_url', `%${t.spotify_id}%`)
        .maybeSingle()
      brainAlreadyExists = !!existBrain
    }

    if (!brainAlreadyExists) {
      await supabase.from('brain_knowledge').insert({
        category: cat,
        title: `${t.title} — ${t.artist}`,
        content,
        entry_type: 'FACT',
        source_url: spotifyUrl,
        active: true,
        surfaced_in_daily: isCurrent,
        surfaced_until: surfacedUntil,
        metadata,
      })
    }

    spotifyPreview = null
    spotifyPreviewType = 'reference_current'
    spotifyMixerName = ''
    await loadEntries()
  }

  async function saveExtracted() {
    if (!lastExtracted?.length) return
    for (const item of lastExtracted) {
      await supabase.from('brain_knowledge').insert({
        category: item.category,
        title: item.title,
        content: item.content,
        active: true
      })
    }
    dumpText = ''
    lastExtracted = null
    await loadEntries()
  }

  async function toggleEntry(id, active) {
    await supabase.from('brain_knowledge')
      .update({ active: !active }).eq('id', id)
    entries = entries.map(e => e.id === id ? { ...e, active: !active } : e)
  }

  async function deleteEntry(id) {
    const entry = entries.find(e => e.id === id)
    if (entry) pushBrainUndo('Deleted: ' + entry.title, id, { ...entry })
    await supabase.from('brain_knowledge').delete().eq('id', id)
    entries = entries.filter(e => e.id !== id)
  }

  const CONF_LEVELS = ['low', 'medium', 'strong', 'locked']
  const CONF_DISPLAY = { low: 'weak', medium: 'medium', strong: 'strong', locked: 'locked' }
  const CONF_PROMOTE_MSG = {
    strong: "Mark as confirmed pattern? Mozart will apply this consistently.",
    locked: "Lock as permanent rule? You can unlock anytime."
  }

  function cycleConfidence(entry) {
    const cur = CONF_LEVELS.indexOf(entry.confidence || 'low')
    const next = CONF_LEVELS[(cur + 1) % CONF_LEVELS.length]
    if (next === 'locked') {
      confidenceTooltip = { entryId: entry.id, to: next, label: CONF_PROMOTE_MSG.locked }
    } else {
      saveConfidence(entry.id, next)
    }
  }

  async function saveConfidence(id, val) {
    await supabase.from('brain_knowledge').update({ confidence: val }).eq('id', id)
    entries = entries.map(e => e.id === id ? { ...e, confidence: val } : e)
    confidenceTooltip = null
  }

  async function updatePriority(id, val) {
    await supabase.from('brain_knowledge').update({ priority: val }).eq('id', id)
    entries = entries.map(e => e.id === id ? { ...e, priority: val } : e)
  }

  async function setReviewDate(id, date) {
    await supabase.from('brain_knowledge').update({ review_date: date || null }).eq('id', id)
    entries = entries.map(e => e.id === id ? { ...e, review_date: date } : e)
    dueReviewItems = await loadDueReview()
  }

  async function loadDueReview() {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('brain_knowledge')
      .select('id, title, category, review_date')
      .lte('review_date', today)
      .not('review_date', 'is', null)
      .order('review_date')
    return data || []
  }

  function parseRefContent(content) {
    const out = {}
    for (const line of (content || '').split('\n')) {
      const bpmM = line.match(/BPM:\s*([\d.]+)/)
      if (bpmM) out.bpm = bpmM[1]
      const keyM = line.match(/Key:\s*([A-G][#b]?\s*(?:major|minor))/)
      if (keyM) out.key = keyM[1]
      const engM = line.match(/Energy:\s*([\d.]+)/)
      if (engM) out.energy = engM[1]
      const dncM = line.match(/Dance:\s*([\d.]+)/)
      if (dncM) out.danceability = dncM[1]
      const valM = line.match(/Valence:\s*([\d.]+)/)
      if (valM) out.valence = valM[1]
      const lufsM = line.match(/Loudness:\s*([-\d.]+)LUFS/)
      if (lufsM) out.loudness = lufsM[1]
      const genM = line.match(/Genres:\s*(.+)/)
      if (genM) out.genres = genM[1]
    }
    return out
  }

  onMount(async () => {
    await loadEntries()
    loadDueReview().then(items => dueReviewItems = items)

    const interval = setInterval(() => {
      placeholderIndex = (placeholderIndex + 1) % DUMP_HINTS.length
    }, 4000)
    return () => clearInterval(interval)
  })

  // Pick up items dispatched from DailyTab WhatsApp button
  const pending = localStorage.getItem('mm_pending_chat_items')
  if (pending) {
    try {
      pendingApproval = JSON.parse(pending)
      showApproval = true
    } catch(e) {}
    localStorage.removeItem('mm_pending_chat_items')
  }

  let aiMessages = $state([])
  let aiInput = $state('')
  let aiLoading = $state(false)

  async function sendAI(rawMsg) {
    const msg = (typeof rawMsg === 'string' && rawMsg.trim()) ? rawMsg.trim() : aiInput.trim()
    if (!msg || aiLoading) return
    aiInput = ''
    aiMessages = [...aiMessages, { role: 'user', content: msg }]
    aiLoading = true
    const apiKey = localStorage.getItem('mm_api_key') || ''
    if (!apiKey) { aiMessages = [...aiMessages, { role: 'assistant', content: 'No API key set — add it in Settings ⚙.' }]; aiLoading = false; return }
    const mozartContext = await buildMozartContext(supabase, {})
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: mozartContext, messages: aiMessages.slice(-10) })
      })
      const data = await res.json()
      if (data.usage) fetch('http://localhost:4242/track-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'browser/mozart', model: 'claude-sonnet-4-20250514', input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens, cost_usd: (data.usage.input_tokens * 0.000003) + (data.usage.output_tokens * 0.000015) }) }).catch(() => {})
      const reply = data.content?.[0]?.text || 'No response.'
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
  }
</script>

<div class="tab-layout">
<div class="tab-main">
<div class="brain-wrap">

  <!-- Left: dump input -->
  <div class="brain-dump-col"
    ondragover={e => {
      e.preventDefault()
      const hasImage = [...(e.dataTransfer?.items||[])].some(i => i.type.startsWith('image/'))
      const isText = [...(e.dataTransfer?.items||[])].some(i => i.type === 'text/plain')
      dumpDragging = hasImage ? 'image' : 'text'
      fileDragging = !hasImage && !isText
    }}
    ondragleave={() => { dumpDragging = null; fileDragging = false }}
    ondrop={async e => {
      e.preventDefault()
      dumpDragging = null; fileDragging = false
      const file = [...e.dataTransfer.files][0]
      if (!file) return
      if (file.type.startsWith('image/')) { await processImageDump(file); return }
      if (file.type === 'text/plain') { dumpText = await file.text(); return }
      await handleFileDrop(file)
    }}>

    <div class="brain-screen-section">
      <div class="brain-section-title">SCREEN CAPTURE</div>
      <p class="brain-hint">
        Captures your screen in 3 seconds — switch to
        DAW, WhatsApp, or anything you want analyzed.
      </p>
      <div class="brain-screen-controls">
        <input class="brain-spotify-inp"
          bind:value={captureContext}
          placeholder="What should I look for? (e.g. mixing session, chord chart...)"
          style="flex:1"
        />
      </div>
      <button
        class="brain-process-btn {capturing ? 'loading' : ''}"
        onclick={captureScreen}
        disabled={capturing}>
        {capturing ? '📸 Capturing in 3s...' : '📸 Capture Screen → Brain'}
      </button>
      {#if captureResult}
        <div class="brain-capture-result">
          <div class="brain-preview-title">CAPTURED & SAVED TO BRAIN</div>
          <div class="brain-approval-content">{captureResult}</div>
          {#if captureMixingSuggestions.length}
            <div class="brain-preview-title" style="margin-top:10px">MIXING NOTES</div>
            {#each captureMixingSuggestions as s}
              <div class="brain-mixing-suggestion">• {s}</div>
            {/each}
          {/if}
          <div class="brain-capture-meta">
            Saved to Brain{capturedSavedCategory ? ` · ${capturedSavedCategory}` : ''}
            {#if captureEntryId}
              · <button class="brain-capture-delete-link" onclick={async () => { await deleteEntry(captureEntryId); captureResult = null; captureMixingSuggestions = []; captureEntryId = null }}>delete</button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="brain-section-title">DUMP ANYTHING</div>
    <p class="brain-hint">
      Paste articles, notes, thoughts, research —
      Claude extracts and files it automatically.
    </p>
    <textarea
      class="brain-textarea {dumpDragging === 'image' ? 'drag-image' : ''}"
      bind:value={dumpText}
      placeholder={DUMP_HINTS[placeholderIndex]}
    ></textarea>
    {#if dumpDragging === 'image'}
      <p class="brain-image-drop-hint">📷 Drop image — Claude will read and extract info</p>
    {/if}
    {#if fileDragging}
      <p class="brain-image-drop-hint">📎 Drop file — saved to Dropbox/Brain/uploads</p>
    {/if}
    {#if fileUploading}
      <p class="brain-file-status">⏳ Uploading file...</p>
    {/if}
    {#if uploadedFile}
      <p class="brain-file-status {uploadedFile.ok ? 'ok' : 'err'}">
        {uploadedFile.ok ? `✓ ${uploadedFile.name} saved to Brain` : `✗ ${uploadedFile.error || 'Upload failed'}`}
      </p>
    {/if}
    {#if dumpText.match(/open\.spotify\.com/)}
      {#each [dumpText.match(/open\.spotify\.com\/(playlist|artist|album|track)/)?.[1] || 'link'] as urlType}
        <p class="brain-spotify-hint">🎵 Spotify {urlType} URL detected</p>
      {/each}
    {/if}
    <div class="brain-actions">
      <button
        class="brain-process-btn {processing ? 'loading' : ''}"
        onclick={processDump}
        disabled={processing || !dumpText.trim()}
      >
        {#if processing}
          ✦ Processing...
        {:else if /spotify\.com\/(?:intl-\w+\/)?track\//.test(dumpText)}
          ✦ Analyze Track
        {:else if dumpText.includes('spotify.com/playlist')}
          ✦ Import Playlist
        {:else if dumpText.includes('spotify.com/artist')}
          ✦ Import or Watch Artist
        {:else}
          ✦ Extract & Categorize
        {/if}
      </button>
    </div>

    {#if spotifyPreview}
      <div class="brain-track-preview">
        {#if spotifyPreview.art_url}
          <img src={spotifyPreview.art_url} class="brain-track-art" alt={spotifyPreview.album} width="60" height="60" />
        {/if}
        <div class="brain-track-preview-info">
          <div class="brain-track-preview-title">{spotifyPreview.artist} — {spotifyPreview.title}</div>
          <div class="brain-track-preview-stats">
            {#if spotifyPreview.bpm}
              {spotifyPreview.bpm}bpm ·
              {spotifyPreview.key || '?'}{spotifyPreview.camelot ? ` (${spotifyPreview.camelot})` : ''}{#if spotifyPreview.key_confidence === 'low'} <span class="key-confidence-warn" title="Detected from 30s preview — verify manually">⚠</span>{/if}
            {:else}
              BPM: no preview available
            {/if}
            · {spotifyPreview.popularity}/100 popularity
          </div>
          <div class="brain-track-preview-genres">
            {#each (spotifyPreview.genres||[]).slice(0,4) as g}
              <span class="brain-genre-pill">{g}</span>
            {/each}
          </div>
          <!-- Contextual tag step -->
          <div class="sp-type-row">
            {#each [
              { id: 'reference_current',     label: 'Aktuelle Ref',  desc: 'surfaces in Daily for 7 days' },
              { id: 'reference_mixing',      label: 'Mix Ref',       desc: 'for EQ/compression/width decisions' },
              { id: 'reference_inspiration', label: 'Music Ref',     desc: 'general direction + inspiration' },
              { id: 'reference_sound',       label: 'Sound Ref',     desc: 'specific sound/texture/element' },
            ] as opt}
              <label class="sp-type-opt {spotifyPreviewType === opt.id ? 'on' : ''}">
                <input type="radio" name="sp-type" value={opt.id} bind:group={spotifyPreviewType} />
                <span class="sp-type-label">{opt.label}</span>
                <span class="sp-type-desc">{opt.desc}</span>
              </label>
            {/each}
          </div>
          {#if spotifyPreviewType === 'reference_mixing'}
            <input class="sp-mixer-inp" bind:value={spotifyMixerName} placeholder="Mixer name (optional)" />
          {/if}
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="brain-save-btn" onclick={saveSpotifyPreview}>Add to Brain</button>
            <button class="brain-discard-btn" onclick={() => { spotifyPreview = null; spotifyPreviewType = 'reference_current'; spotifyMixerName = '' }}>Discard</button>
          </div>
        </div>
      </div>
    {/if}

    {#if importResult?.type === 'track' && importResult.trackData}
      {@const t = importResult.trackData}
      <div class="brain-track-preview">
        {#if t.albumArt}
          <img src={t.albumArt} class="brain-track-art" alt={t.album} width="50" height="50" />
        {/if}
        <div class="brain-track-preview-info">
          <div class="brain-track-preview-title">{t.title} — {t.artist}</div>
          <div class="brain-track-preview-stats">
            {t.tempo}bpm · {t.key} · energy {t.energy?.toFixed(2)} · {t.popularity}/100
          </div>
          <div class="brain-track-preview-genres">
            {#each (t.genres||[]).slice(0,4) as g}
              <span class="brain-genre-pill">{g}</span>
            {/each}
          </div>
          <div class="brain-track-cat-row">
            <span class="brain-approval-cat-label">FILE UNDER:</span>
            <input class="brain-cat-rename-inp" list="brain-cats-dl" bind:value={importCategory} placeholder="category" />
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="brain-save-btn" onclick={() => saveTrackImport(t)}>
              ✓ Save Track to Brain
            </button>
            <button class="brain-discard-btn" onclick={() => importResult = null}>Discard</button>
          </div>
        </div>
      </div>
    {:else if importResult}
      <div class="brain-import-result">
        <div class="brain-preview-title">IMPORTED</div>
        <div class="brain-import-summary">
          {importResult.summary || `Imported: ${importResult.trackCount ?? '?'} tracks · ${importResult.artistCount ?? '?'} artists · Top genres: ${importResult.topGenres?.join(', ') || '—'} · Avg ${importResult.avgTempo ?? '?'}bpm`}
        </div>
        {#if importResult.trackCount !== undefined}
          <div class="brain-import-stats">
            {importResult.trackCount} tracks · {importResult.artistCount} artists · {importResult.genreCount} genres
            {#if importResult.topGenres?.length} · {importResult.topGenres.join(', ')}{/if}
          </div>
        {/if}
        <button class="brain-import-dismiss" onclick={() => importResult = null}>dismiss</button>
      </div>
    {/if}

    {#if catSuggestion || catSuggestLoading}
      <input
        class="dump-collection-inp"
        placeholder="Group with… (optional, e.g. 'Kumbia V05 Session')"
        bind:value={dumpCollection}
      />
    {/if}

    {#if catSuggestLoading}
      <div class="cat-suggest-card">
        <div class="cat-suggest-header">ANALYSING CATEGORY…</div>
        <div class="cat-suggest-loading">thinking</div>
      </div>
    {:else if catSuggestion}
      <div class="cat-suggest-card">
        <div class="cat-suggest-header">SUGGESTED CATEGORY</div>

        {#if catSuggestion.action === 'split'}
          <!-- SPLIT MODE -->
          <div class="cat-suggest-reason">{catSuggestion.reason}</div>
          <div class="cat-suggest-label">SPLIT INTO {splitEdits.length} ENTRIES</div>
          {#each splitEdits as part, i}
            <div class="cat-suggest-split-row">
              <input
                class="cat-suggest-inp cat-suggest-inp-sm"
                list="brain-cats-dl"
                value={part.category}
                oninput={e => splitEdits = splitEdits.map((s, j) => j === i ? { ...s, category: e.target.value } : s)}
                placeholder="category"
              />
              <textarea
                class="cat-suggest-split-text"
                rows="3"
                value={part.content}
                oninput={e => splitEdits = splitEdits.map((s, j) => j === i ? { ...s, content: e.target.value } : s)}
              ></textarea>
            </div>
          {/each}
          <div class="cat-suggest-actions">
            <button class="cat-suggest-btn-primary" onclick={saveSplitsDirect}>✓ Save Split</button>
            <button class="cat-suggest-btn-ghost" onclick={() => proceedAfterSuggestion('')}>Process as One</button>
            <button class="cat-suggest-btn-ghost" onclick={() => { catSuggestion = null; splitEdits = [] }}>Cancel</button>
          </div>

        {:else}
          <!-- EXISTING / NEW MODE -->
          <div class="cat-suggest-pill cat-suggest-pill-{catSuggestion.action}">
            {catSuggestion.action === 'new' ? 'NEW CATEGORY' : 'EXISTING'}
          </div>
          <div class="cat-suggest-name">{catSuggestion.suggestion}</div>
          <div class="cat-suggest-reason">{catSuggestion.reason}</div>
          {#if catSuggestion.alternatives?.length}
            <div class="cat-suggest-label">ALTERNATIVES</div>
            <div class="cat-suggest-alts">
              {#each catSuggestion.alternatives as alt}
                {@const altCat = typeof alt === 'string' ? alt : alt.category}
                {@const altReason = typeof alt === 'string' ? '' : alt.reason}
                <button class="cat-suggest-alt-btn" onclick={() => proceedAfterSuggestion(altCat)} title={altReason}>{altCat}</button>
              {/each}
            </div>
          {/if}
          <div class="cat-suggest-label">OR TYPE A DIFFERENT CATEGORY</div>
          <input
            class="cat-suggest-inp"
            list="brain-cats-dl"
            bind:value={catSuggestOverride}
            placeholder="override category…"
          />
          <div class="cat-suggest-actions">
            <button class="cat-suggest-btn-primary"
              onclick={() => proceedAfterSuggestion(catSuggestOverride || catSuggestion.suggestion)}>
              ✓ Use {catSuggestOverride || catSuggestion.suggestion}
            </button>
            <button class="cat-suggest-btn-ghost" onclick={() => catSuggestion = null}>Cancel</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if showApproval && pendingApproval.length}
      <div class="brain-approval-panel">
        <div class="brain-preview-title">
          REVIEW BEFORE SAVING — {pendingApproval.length} item(s)
        </div>
        {#each pendingApproval as item, idx}
          <div class="brain-approval-item">
            <div class="brain-approval-item-header">
              <span class="brain-approval-type">
                {item.entry_type === 'chunk' ? '📄' :
                 item.entry_type === 'fact' ? '📊' :
                 item.entry_type === 'thought' ? '💭' :
                 item.entry_type === 'question' ? '❓' : '📝'}
              </span>
              <input
                class="brain-approval-cat-inp"
                list="brain-cats-dl"
                value={item.suggestedCategory}
                oninput={e => pendingApproval = pendingApproval.map((it, i) => i === idx ? { ...it, suggestedCategory: e.target.value, isNewCategory: !existingCategories.includes(e.target.value) } : it)}
                placeholder="category"
              />
              {#if item.isNewCategory}
                <span class="brain-approval-new-badge">NEW</span>
              {/if}
              {#if item.confidence}
                <span class="brain-approval-conf conf-badge-{item.confidence}">{item.confidence}</span>
              {/if}
              <button class="brain-approval-remove" onclick={() => pendingApproval = pendingApproval.filter((_, i) => i !== idx)}>×</button>
            </div>
            <div class="brain-approval-title">{item.title}</div>
            <div class="brain-approval-content">{item.content}</div>
          </div>
        {/each}
        <div class="brain-approval-actions">
          <button class="brain-save-btn" onclick={saveApproved}>
            ✓ Save All ({pendingApproval.length}) to Brain
          </button>
          <button class="brain-discard-btn"
            onclick={() => { showApproval = false; pendingApproval = []; dumpText = '' }}>
            Discard
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Shared datalist for category autocomplete — built from live Supabase data -->
  <datalist id="brain-cats-dl">
    {#each existingCategories as cat}
      <option value={cat}></option>
    {/each}
  </datalist>

  <!-- Right: entries -->
  <div class="brain-entries-col">
    <div style="display:flex;align-items:center;gap:8px;">
      <button class="brain-entries-toggle" onclick={() => entriesOpen = !entriesOpen} style="flex:1">
        <span>BRAIN ENTRIES</span>
        <span class="brain-cat-count">{entries.length + watchedArtists.length + referenceTrackEntries.length}</span>
        <span class="brain-cat-arrow {entriesOpen ? 'open' : ''}">▶</span>
      </button>
      <button class="brain-priority-filter-btn {priorityFilter ? 'active' : ''}" onclick={() => priorityFilter = !priorityFilter} title="Show priority only">
        ★
      </button>
      <button class="undo-tab-btn" onclick={undoBrain} disabled={undoStack.length === 0} title={undoStack[0]?.description || 'Nothing to undo'}>
        ↩ {undoStack[0] ? undoStack[0].description.slice(0, 20) + '...' : 'undo'}
      </button>
    </div>

    {#if entriesOpen}
      <!-- Search -->
      <div class="brain-search-row">
        <input
          class="brain-search-inp"
          bind:value={brainSearch}
          placeholder="Search brain..."
        />
        {#if brainSearch}
          <button class="brain-search-clear" onclick={() => brainSearch = ''}>×</button>
        {/if}
      </div>

      <!-- Due review banner -->
      {#if dueReviewItems.length}
        <div class="brain-review-banner">
          🧠 {dueReviewItems.length} brain {dueReviewItems.length === 1 ? 'entry' : 'entries'} ready for review
        </div>
      {/if}

      {@const allNormal = [...entries.filter(e => e.category !== 'reference_tracks')].sort((a,b) => {
        if (a.priority && !b.priority) return -1
        if (!a.priority && b.priority) return 1
        return a.category.localeCompare(b.category)
      })}
      {@const normalEntries = brainSearch
        ? allNormal.filter(e =>
            e.title?.toLowerCase().includes(brainSearch.toLowerCase()) ||
            e.content?.toLowerCase().includes(brainSearch.toLowerCase()))
        : priorityFilter ? allNormal.filter(e => e.priority) : allNormal}
      {@const quickNotes = normalEntries.filter(e =>
        (e.category === 'quick_note' || e.entry_type_v2 === 'observation') && (e.content || '').length < 100
      )}
      {@const mainEntries = normalEntries.filter(e =>
        !(e.category === 'quick_note' || (e.entry_type_v2 === 'observation' && (e.content || '').length < 100))
      )}
      {@const collections = [...new Set(mainEntries.map(e => e.collection_name_display).filter(Boolean))]}
      {@const collectionEntries = mainEntries.filter(e => e.collection_name_display)}
      {@const uncollected = mainEntries.filter(e => !e.collection_name_display)}
      {@const catIds = [...new Set(uncollected.map(e => e.category))]}

      {#if duplicateWarnings.length && !brainSearch}
        <div class="brain-dup-warning">
          ⚠ {duplicateWarnings.length} possible duplicate(s) — review and delete to keep the brain clean
        </div>
      {/if}

      {#if !entries.length && !watchedArtists.length && !referenceTrackEntries.length}
        <p class="brain-empty">No entries yet. Dump something above.</p>
      {/if}

      <!-- Quick Notes section -->
      {#if quickNotes.length}
        <div class="brain-cat-divider">QUICK NOTES</div>
        <div class="brain-quicknotes-list">
          {#each quickNotes as qn}
            <div class="brain-quick-note">
              <span class="brain-quick-note-dot">·</span>
              <span class="brain-quick-note-text">{qn.content}</span>
              <span class="brain-quick-note-date">{new Date(qn.created_at).toLocaleDateString('de-CH')}</span>
              <button class="brain-del" onclick={() => deleteEntry(qn.id)}>×</button>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Collection groups -->
      {#each collections as col}
        <div class="brain-collection-header">
          <span class="brain-collection-icon">◈</span>
          {col}
        </div>
        {#each mainEntries.filter(e => e.collection_name_display === col) as entry}
          {#if entry.category === 'question'}
            <div class="brain-question-row">
              <span class="brain-question-icon">❓</span>
              <span class="brain-question-text">{entry.content}</span>
              <span class="brain-question-date">{new Date(entry.created_at).toLocaleDateString('de-CH')}</span>
              <button class="track-del-btn" onclick={() => deleteEntry(entry.id)}>×</button>
            </div>
          {:else}
            <div class="brain-entry {entry.active ? '' : 'inactive'} {entry.priority ? 'priority' : ''}">
              <div class="brain-entry-header">
                <button
                  class="brain-toggle {entry.active ? 'on' : ''}"
                  onclick={() => toggleEntry(entry.id, entry.active)}
                  title={entry.active ? 'Active' : 'Paused'}
                >{entry.active ? '◉' : '○'}</button>
                <span
                  class="brain-entry-title clickable-title"
                  title={entry.content?.slice(0, 120)}
                  onclick={() => expandedEntries = { ...expandedEntries, [entry.id]: !expandedEntries[entry.id] }}
                >{entry.title}</span>
                <button class="brain-priority-star {entry.priority ? 'on' : ''}" onclick={() => updatePriority(entry.id, !entry.priority)}>★</button>
                <button class="conf-pill conf-pill-{entry.confidence || 'low'}" onclick={() => cycleConfidence(entry)}>{CONF_DISPLAY[entry.confidence || 'low']}</button>
                <button class="brain-del" onclick={() => deleteEntry(entry.id)}>×</button>
              </div>
              {#if expandedEntries[entry.id]}
                <div class="brain-entry-content">{entry.content}</div>
                <div class="brain-review-row">
                  <span class="brain-review-label">Review by:</span>
                  <input type="date" class="brain-review-date-inp" value={entry.review_date || ''} onchange={e => setReviewDate(entry.id, e.target.value)} />
                  {#if entry.review_date}<button class="brain-review-clear" onclick={() => setReviewDate(entry.id, '')}>×</button>{/if}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      {/each}

      <!-- Knowledge entries grouped by category (uncollected) -->
      {#each catIds as catId}
        <div class="brain-cat-divider">{catId.replace(/_/g, ' ')}</div>
        {#each uncollected.filter(e => e.category === catId) as entry}
          {#if entry.category === 'question'}
            <div class="brain-question-row">
              <span class="brain-question-icon">❓</span>
              <span class="brain-question-text">{entry.content}</span>
              <span class="brain-question-date">
                {new Date(entry.created_at).toLocaleDateString('de-CH')}
              </span>
              <button class="track-del-btn" onclick={() => deleteEntry(entry.id)}>×</button>
            </div>
          {:else if entry.entry_type === 'reference_track' || entry.category?.startsWith('reference_')}
            {@const rc = parseRefContent(entry.content)}
            <div class="brain-entry brain-ref-entry {entry.active ? '' : 'inactive'}">
              <div class="brain-entry-header">
                <button
                  class="brain-toggle {entry.active ? 'on' : ''}"
                  onclick={() => toggleEntry(entry.id, entry.active)}
                  title={entry.active ? 'Active' : 'Paused'}
                >{entry.active ? '◉' : '○'}</button>
                <div class="brain-ref-body">
                  <span class="brain-ref-title">{entry.title}</span>
                  {#if rc.bpm || rc.key || rc.energy || rc.danceability || rc.loudness}
                    <span class="brain-ref-stats">
                      {rc.bpm ? rc.bpm + 'bpm' : ''}
                      {rc.key ? ' · ' + rc.key : ''}
                      {rc.energy ? ' · nrg ' + rc.energy : ''}
                      {rc.danceability ? ' · dnc ' + rc.danceability : ''}
                      {rc.valence ? ' · val ' + rc.valence : ''}
                      {rc.loudness ? ' · ' + rc.loudness + 'LUFS' : ''}
                    </span>
                  {/if}
                  {#if rc.genres}
                    <div class="brain-ref-genres">
                      {#each rc.genres.split(',').slice(0,2).map(g => g.trim()).filter(Boolean) as g}
                        <span class="brain-genre-pill">{g}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                {#if entry.source_url}
                  <a class="brain-sp-link" href={entry.source_url} target="_blank" title="Open in Spotify">♫</a>
                {/if}
                <button class="brain-del" onclick={() => deleteEntry(entry.id)}>×</button>
              </div>
            </div>
          {:else}
            <div class="brain-entry {entry.active ? '' : 'inactive'} {entry.priority ? 'priority' : ''}">
              <div class="brain-entry-header">
                <button
                  class="brain-toggle {entry.active ? 'on' : ''}"
                  onclick={() => toggleEntry(entry.id, entry.active)}
                  title={entry.active ? 'Active' : 'Paused'}
                >{entry.active ? '◉' : '○'}</button>
                <span
                  class="brain-entry-title clickable-title"
                  title={entry.content?.slice(0, 120)}
                  onclick={() => expandedEntries = { ...expandedEntries, [entry.id]: !expandedEntries[entry.id] }}
                >{entry.title}</span>
                <button class="brain-priority-star {entry.priority ? 'on' : ''}" onclick={() => updatePriority(entry.id, !entry.priority)}>★</button>
                <button
                  class="conf-pill conf-pill-{entry.confidence || 'low'}"
                  onclick={() => cycleConfidence(entry)}
                >{CONF_DISPLAY[entry.confidence || 'low']}</button>
                <button class="brain-del" onclick={() => deleteEntry(entry.id)}>×</button>
              </div>
              {#if expandedEntries[entry.id]}
                <div class="brain-entry-content">{entry.content}</div>
                <div class="brain-review-row">
                  <span class="brain-review-label">Review by:</span>
                  <input
                    type="date"
                    class="brain-review-date-inp"
                    value={entry.review_date || ''}
                    onchange={e => setReviewDate(entry.id, e.target.value)}
                  />
                  {#if entry.review_date}
                    <button class="brain-review-clear" onclick={() => setReviewDate(entry.id, '')}>×</button>
                  {/if}
                </div>
                {@const titleWords = (entry.title || '').split(/\s+/).filter(w => w.length > 4).map(w => w.toLowerCase())}
                {@const related = entries.filter(e =>
                  e.id !== entry.id &&
                  e.category !== 'question' &&
                  (e.category === entry.category ||
                   titleWords.some(w => e.title?.toLowerCase().includes(w)))
                ).slice(0, 3)}
                {#if related.length}
                  <div class="brain-related-row">
                    <span class="brain-related-label">Related:</span>
                    {#each related as rel}
                      <button
                        class="brain-related-chip"
                        onclick={() => expandedEntries = { ...expandedEntries, [rel.id]: true }}
                        title={rel.category}
                      >{rel.title?.slice(0, 30)}{rel.title?.length > 30 ? '…' : ''}</button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      {/each}

      <!-- Confidence promotion tooltip -->
      {#if confidenceTooltip}
        <div class="brain-conf-tooltip">
          <p class="brain-conf-tooltip-msg">{confidenceTooltip.label}</p>
          <div class="brain-conf-tooltip-btns">
            <button class="brain-conf-confirm" onclick={() => saveConfidence(confidenceTooltip.entryId, confidenceTooltip.to)}>Confirm</button>
            <button class="brain-conf-cancel" onclick={() => confidenceTooltip = null}>Cancel</button>
          </div>
        </div>
      {/if}

      <!-- Watched Artists -->
      {#if watchedArtists.length}
        <div class="brain-subsection-title">WATCHED ARTISTS</div>
        {#each watchedArtists as artist}
          <div class="brain-watched-row">
            <span class="brain-watched-name">{artist.artist_name}</span>
            <span class="brain-watched-genre">{Array.isArray(artist.genres) ? artist.genres.slice(0,2).join(', ') : (artist.genres || '—')}</span>
            <span class="brain-watched-checked">{artist.last_checked ? new Date(artist.last_checked).toLocaleDateString('en-GB', {day:'2-digit',month:'short'}) : 'never'}</span>
            <button class="brain-del" onclick={() => unwatchArtist(artist.id)} title="Stop watching">×</button>
          </div>
        {/each}
      {/if}

      <!-- Reference Tracks grouped by collection -->
      {#if referenceTrackEntries.length}
        {#each Object.entries(refByCollection) as [col, tracks]}
          {@const filteredTracks = brainSearch
            ? tracks.filter(t => (t.artist + ' ' + t.title).toLowerCase().includes(brainSearch.toLowerCase()))
            : tracks}
          {#if filteredTracks.length}
            <div class="brain-cat-divider">{COL_LABELS[col] || col.toUpperCase()}</div>
            {#each filteredTracks as track}
              <div class="brain-reftrack-row">
                {#if track.source === 'user' || track.promoted}
                  <span class="brain-reftrack-dot user" title={track.promoted ? 'Promoted chart track' : 'Your reference'}>
                    {track.promoted ? '◑' : '●'}
                  </span>
                {:else}
                  <span class="brain-reftrack-dot agent" title="Auto-added chart track">○</span>
                  <button class="brain-reftrack-promote" title="Promote to personal reference" onclick={async () => {
                    await supabase.from('reference_tracks').update({ promoted: true, source: 'user' }).eq('id', track.id)
                    referenceTrackEntries = referenceTrackEntries.map(t => t.id === track.id ? { ...t, promoted: true, source: 'user' } : t)
                  }}>+</button>
                {/if}
                <span class="brain-reftrack-info">
                  {track.artist ? track.artist + ' — ' : ''}{track.title}
                  <span class="brain-reftrack-stats">
                    {track.tempo ? Math.round(track.tempo) + 'bpm' : ''}
                    {track.key ? ' · ' + track.key + (track.scale ? ' ' + track.scale : '') : ''}
                    {track.energy != null ? ' · nrg ' + Number(track.energy).toFixed(2) : ''}
                    {track.danceability != null ? ' · dnc ' + Number(track.danceability).toFixed(2) : ''}
                    {track.loudness != null ? ' · ' + track.loudness + 'LUFS' : ''}
                  </span>
                  <textarea
                    class="brain-reftrack-notes"
                    placeholder="Why saved? (drums, energy, mix, arrangement...)"
                    value={track.notes || ''}
                    onblur={e => { if (e.target.value !== (track.notes || '')) updateTrackNotes(track.id, e.target.value) }}
                    rows="1"
                  ></textarea>
                </span>
                <span class="brain-reftrack-source">{col === 'daily_chart' ? 'chart' : !track.spotify_id ? 'youtube' : 'spotify'}</span>
                <button class="brain-del" onclick={async () => {
                  await supabase.from('reference_tracks').delete().eq('id', track.id)
                  referenceTrackEntries = referenceTrackEntries.filter(t => t.id !== track.id)
                }}>×</button>
              </div>
            {/each}
          {/if}
        {/each}
      {/if}
    {/if}
  </div>

  <!-- Reference Tracks — checkout / my refs / library -->
  <div class="brain-entries-col" style="margin-top: 12px;">

    <!-- CHECKOUT — always open -->
    <div class="refs-section">
      <div class="refs-section-header refs-checkout">
        <span>⬇ CHECKOUT</span>
        <span class="refs-count">{checkoutRefs.length}</span>
        <span style="font-size:9px;color:#555;margin-left:4px">listen & decide</span>
      </div>
      {#if checkoutRefs.length === 0}
        <div class="refs-empty">Scout will place tracks here for review</div>
      {:else}
        {#each checkoutRefs as track}
          <div class="ref-track-row checkout-row">
            <span class="ref-source-dot checkout">⬇</span>
            <span class="ref-title">{track.artist ? track.artist + ' — ' : ''}{track.title}</span>
            <span class="ref-stats">
              {track.tempo ? Math.round(track.tempo) + 'bpm' : ''}
              {track.camelot ? ' · ' + track.camelot : ''}
            </span>
            <div class="ref-checkout-btns">
              {#if track.preview_url || track.spotify_id}
                <button class="track-play-btn"
                  onclick={() => playPreview(track)}
                >{playingId === track.id ? '■' : '▶'}</button>
              {/if}
              <button class="promote-btn gold"
                onclick={() => promoteToMyRefs(track.id)}
                title="Move to My References">★ Mine</button>
              <button class="promote-btn"
                onclick={() => promoteToLibrary(track.id)}
                title="Move to Library">→ lib</button>
              <button class="track-del-btn"
                onclick={() => deleteRef(track.id)}>×</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- MY REFERENCES -->
    <div class="refs-section">
      <div class="refs-section-header refs-curated"
           onclick={() => myRefsExpanded = !myRefsExpanded}>
        <span>● MY REFERENCES</span>
        <span class="refs-count">{myRefs.length}</span>
        <span style="margin-left:auto">{myRefsExpanded ? '▲' : '▼'}</span>
      </div>
      {#if myRefsExpanded}
        {#if !myRefs.length}
          <p class="brain-empty" style="font-size:11px;padding:8px 0">No curated refs yet — import a Spotify track or promote from checkout.</p>
        {/if}
        {#each myRefs as track}
          <div class="ref-track-row">
            <span class="ref-source-dot user">●</span>
            <span class="ref-title">{track.artist ? track.artist + ' — ' : ''}{track.title}</span>
            <span class="ref-stats">
              {track.tempo ? Math.round(track.tempo) + 'bpm' : ''}
              {track.camelot ? ' · ' + track.camelot : (track.key ? ' · ' + track.key : '')}
              {track.loudness != null ? ' · ' + track.loudness + 'LUFS' : ''}
            </span>
            <div class="ref-checkout-btns">
              {#if track.preview_url || track.spotify_id}
                <button class="track-play-btn"
                  onclick={() => playPreview(track)}
                >{playingId === track.id ? '■' : '▶'}</button>
              {/if}
              <button class="track-del-btn" onclick={() => deleteRef(track.id)}>×</button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- LIBRARY -->
    <div class="refs-section">
      <div class="refs-section-header refs-library"
           onclick={() => libraryExpanded = !libraryExpanded}>
        <span>○ LIBRARY</span>
        <span class="refs-count">{libraryRefs.length}</span>
        <span style="margin-left:auto">{libraryExpanded ? '▲' : '▼'}</span>
      </div>
      {#if libraryExpanded}
        <input class="library-search" placeholder="Search library..." bind:value={librarySearch} />
        {#each filteredLibraryRefs as track}
          <div class="ref-track-row library">
            <span class="ref-source-dot">○</span>
            <span class="ref-title">{track.artist ? track.artist + ' — ' : ''}{track.title}</span>
            <span class="ref-stats">
              {track.tempo ? Math.round(track.tempo) + 'bpm' : ''}
              {track.camelot ? ' · ' + track.camelot : (track.key ? ' · ' + track.key : '')}
            </span>
            <div class="ref-checkout-btns">
              {#if track.preview_url || track.spotify_id}
                <button class="track-play-btn"
                  onclick={() => playPreview(track)}
                >{playingId === track.id ? '■' : '▶'}</button>
              {/if}
              <button class="promote-btn gold"
                onclick={() => promoteToMyRefs(track.id)}
                title="Move to My References">★</button>
              <button class="track-del-btn" onclick={() => deleteRef(track.id)}>×</button>
            </div>
          </div>
        {/each}
        {#if !filteredLibraryRefs.length}
          <p class="brain-empty" style="font-size:11px;padding:6px 0">{librarySearch ? 'No matches.' : 'Library empty.'}</p>
        {/if}
      {/if}
    </div>

  </div>

</div>
</div>
<div class="tab-sidebar">
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
    <div class="chat-out">
      {#each aiMessages as msg}
        <div class="chat-msg {msg.role}">
          <div class="chat-who">{msg.role==='user'?'You':'Mozart'}</div>
          <div class="chat-text">{@html msg.role === 'assistant' ? formatMozartOutput(msg.content) : msg.content}</div>
        </div>
      {/each}
      {#if aiLoading}
        <div class="chat-msg assistant"><div class="chat-who">Mozart</div><div class="chat-text dim">...</div></div>
      {/if}
    </div>
  </div>
</div>
</div>

<style>
  .tab-layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; min-height: calc(100vh - 100px); align-items: start; }
  .tab-main { display: flex; flex-direction: column; min-width: 0; }
  .tab-sidebar { border-left: 1px solid #1c1c1c; padding-left: 24px; display: flex; flex-direction: column; }
  .brain-wrap {
    display: grid;
    grid-template-columns: 40% 1fr;
    gap: 32px;
    align-items: start;
  }

  .brain-section-title {
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: rgba(201,168,76,.75);
    margin-bottom: 10px;
  }

  /* ── Left column ── */
  .brain-dump-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: sticky;
    top: 24px;
  }

  .brain-hint {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #555;
    line-height: 1.6;
    margin-bottom: 2px;
  }

  .brain-textarea {
    width: 100%;
    min-height: 200px;
    background: #1c1c1c;
    border: 1px solid #303030;
    color: #cec9c1;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    padding: 10px 12px;
    outline: none;
    resize: vertical;
    border-radius: 3px;
    line-height: 1.6;
  }
  .brain-textarea:focus { border-color: rgba(201,168,76,.4); }
  .brain-textarea::placeholder { color: #3a3a3a; }
  .brain-textarea.drag-image { border-color: #4caf82; background: rgba(76,175,130,.04); }
  .brain-spotify-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: #4caf82; margin: 4px 0 0; letter-spacing: .04em; }
  .brain-image-drop-hint { font-family: 'Space Mono', monospace; font-size: 9px; color: #4caf82; margin: 4px 0 0; letter-spacing: .04em; }
  .brain-file-status { font-family: 'Space Mono', monospace; font-size: 9px; color: #9e9690; margin: 4px 0 0; letter-spacing: .04em; }
  .brain-file-status.ok { color: #4caf82; }
  .brain-file-status.err { color: #c0392b; }

  .brain-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
  .brain-process-btn {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .08em;
    padding: 9px 18px;
    background: transparent;
    border: 1px solid rgba(201,168,76,.5);
    color: #c9a84c;
    border-radius: 3px;
    cursor: pointer;
    transition: all .2s;
  }
  .brain-process-btn:hover:not(:disabled) {
    background: rgba(201,168,76,.1);
    border-color: #c9a84c;
  }
  .brain-process-btn:disabled { opacity: .4; cursor: not-allowed; }
  .brain-process-btn.loading { opacity: .7; }

  /* ── Preview block ── */
  .brain-preview {
    background: #111;
    border: 1px solid rgba(201,168,76,.2);
    border-radius: 4px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .brain-preview-title {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .12em;
    color: rgba(201,168,76,.6);
    text-transform: uppercase;
  }

  .brain-preview-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px;
    background: #1c1c1c;
    border: 1px solid #252525;
    border-radius: 3px;
  }

  .brain-preview-cat {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: rgba(201,168,76,.6);
    letter-spacing: .06em;
  }

  .brain-approval-meta { display: flex; gap: 6px; align-items: center; }
  .brain-approval-type { font-family: 'Space Mono', monospace; font-size: 9px; color: rgba(201,168,76,.6); letter-spacing: .06em; text-transform: uppercase; }
  .brain-approval-new-cat { font-family: 'Space Mono', monospace; font-size: 8px; color: #4caf82; letter-spacing: .06em; border: 1px solid #4caf82; padding: 1px 4px; border-radius: 2px; }
  .brain-approval-cat-row { display: flex; align-items: center; gap: 6px; }
  .brain-approval-cat-label { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; white-space: nowrap; }

  .brain-title-edit {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #f5f1ea;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 8px;
    outline: none;
    border-radius: 2px;
    width: 100%;
  }
  .brain-title-edit:focus { border-color: rgba(201,168,76,.4); }

  .brain-content-edit {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    color: #cec9c1;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    padding: 6px 8px;
    outline: none;
    resize: vertical;
    border-radius: 2px;
    width: 100%;
    min-height: 70px;
    line-height: 1.5;
  }
  .brain-content-edit:focus { border-color: rgba(201,168,76,.4); }

  .brain-preview-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .brain-save-btn {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 7px 16px;
    background: #c9a84c;
    color: #0a0a0a;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  .brain-save-btn:hover { background: #d4b45e; }

  .brain-discard-btn {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    padding: 7px 12px;
    background: transparent;
    border: 1px solid #303030;
    color: #555;
    border-radius: 3px;
    cursor: pointer;
  }
  .brain-discard-btn:hover { border-color: #e05a4a; color: #e05a4a; }

  .brain-track-preview { display: flex; gap: 12px; margin-top: 12px; padding: 10px; background: #0d0d0d; border: 1px solid #252525; border-radius: 3px; }
  .brain-track-art { border-radius: 2px; flex-shrink: 0; }
  .brain-track-preview-info { flex: 1; min-width: 0; }
  .brain-track-preview-title { font-family: 'Space Mono', monospace; font-size: 10px; color: #f5f1ea; margin-bottom: 4px; }
  .brain-track-preview-stats { font-family: 'Space Mono', monospace; font-size: 8px; color: #666; margin-bottom: 6px; }
  .key-confidence-warn { color: #c9a84c; cursor: help; font-size: 9px; }

  /* Spotify preview type selector */
  .sp-type-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .sp-type-opt { display: flex; flex-direction: column; gap: 2px; padding: 5px 9px; border: 1px solid #252525; border-radius: 2px; color: #555; cursor: pointer; transition: all .15s; }
  .sp-type-opt input[type=radio] { display: none; }
  .sp-type-opt.on { border-color: #c9a84c; background: rgba(201,168,76,.06); }
  .sp-type-opt:hover { border-color: #444; }
  .sp-type-opt .sp-type-label { font-family: 'Space Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: .06em; color: #555; }
  .sp-type-opt.on .sp-type-label { color: #c9a84c; }
  .sp-type-opt:hover .sp-type-label { color: #9e9690; }
  .sp-type-opt .sp-type-desc { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #9e9690; }
  .sp-mixer-inp { font-family: 'DM Sans', sans-serif; font-size: 13px; background: #1c1c1c; border: 1px solid #303030; color: #cec9c1; padding: 5px 9px; outline: none; border-radius: 3px; width: 100%; margin-top: 5px; }
  .brain-track-preview-genres { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 8px; }
  .brain-genre-pill { font-family: 'Space Mono', monospace; font-size: 7px; padding: 1px 5px; border-radius: 2px; background: rgba(76,175,130,.1); color: rgba(76,175,130,.7); border: 1px solid rgba(76,175,130,.2); }
  .brain-track-cat-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }

  /* ── Category Suggestion Card ───────────────────────────────────────────── */
  .cat-suggest-card { margin-top: 12px; background: #1c1c1c; border: 1px solid #303030; border-radius: 3px; padding: 14px; }
  .cat-suggest-header { font-family: 'Space Mono', monospace; font-size: 10px; color: rgba(201,168,76,.75); letter-spacing: .12em; margin-bottom: 10px; }
  .cat-suggest-loading { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .4 } 50% { opacity: 1 } }
  .cat-suggest-pill { display: inline-block; font-family: 'Space Mono', monospace; font-size: 8px; letter-spacing: .1em; padding: 2px 7px; border-radius: 2px; margin-bottom: 6px; }
  .cat-suggest-pill-existing { background: rgba(76,175,130,.15); color: #4caf82; border: 1px solid rgba(76,175,130,.3); }
  .cat-suggest-pill-new { background: rgba(201,168,76,.12); color: #c9a84c; border: 1px solid rgba(201,168,76,.3); }
  .cat-suggest-name { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; color: #c9a84c; margin-bottom: 6px; }
  .cat-suggest-reason { font-size: 12px; color: #9e9690; margin-bottom: 10px; line-height: 1.4; }
  .cat-suggest-label { font-family: 'Space Mono', monospace; font-size: 8px; color: rgba(201,168,76,.6); letter-spacing: .1em; margin-bottom: 6px; margin-top: 8px; }
  .cat-suggest-alts { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
  .cat-suggest-alt-btn { background: #252525; border: 1px solid #303030; color: #cec9c1; font-family: 'Space Mono', monospace; font-size: 10px; padding: 4px 9px; border-radius: 2px; cursor: pointer; }
  .cat-suggest-alt-btn:hover { border-color: #c9a84c; color: #c9a84c; }
  .cat-suggest-inp { width: 100%; background: #0a0a0a; border: 1px solid #303030; color: #f5f1ea; font-size: 12px; padding: 6px 8px; border-radius: 2px; margin-bottom: 10px; box-sizing: border-box; }
  .cat-suggest-inp:focus { outline: none; border-color: #c9a84c; }
  .cat-suggest-inp-sm { width: auto; flex: 1; margin-bottom: 0; }
  .cat-suggest-split-row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; padding: 8px; background: #0d0d0d; border: 1px solid #252525; border-radius: 2px; }
  .cat-suggest-split-text { background: #0a0a0a; border: 1px solid #303030; color: #cec9c1; font-size: 11px; font-family: inherit; padding: 6px 8px; border-radius: 2px; resize: vertical; }
  .cat-suggest-split-text:focus { outline: none; border-color: #c9a84c; }
  .cat-suggest-actions { display: flex; gap: 7px; flex-wrap: wrap; }
  .cat-suggest-btn-primary { background: rgba(201,168,76,.15); border: 1px solid rgba(201,168,76,.4); color: #c9a84c; font-family: 'Space Mono', monospace; font-size: 10px; padding: 6px 12px; border-radius: 2px; cursor: pointer; }
  .cat-suggest-btn-primary:hover { background: rgba(201,168,76,.25); }
  .cat-suggest-btn-ghost { background: transparent; border: 1px solid #303030; color: #9e9690; font-family: 'Space Mono', monospace; font-size: 10px; padding: 6px 12px; border-radius: 2px; cursor: pointer; }
  .cat-suggest-btn-ghost:hover { color: #cec9c1; border-color: #555; }

  .brain-approval-panel { margin-top: 12px; border: 1px solid rgba(201,168,76,.2); border-radius: 3px; padding: 12px; background: #0d0d0d; }
  .brain-approval-item { padding: 8px 0; border-bottom: 1px solid #1a1a1a; margin-bottom: 8px; }
  .brain-approval-type { font-family: 'Space Mono', monospace; font-size: 8px; color: #444; letter-spacing: .1em; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
  .brain-new-cat-badge { background: rgba(201,168,76,.1); color: rgba(201,168,76,.7); border: 1px solid rgba(201,168,76,.2); border-radius: 2px; padding: 1px 5px; font-size: 7px; }
  .brain-approval-category-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .brain-approval-cat-label { font-family: 'Space Mono', monospace; font-size: 8px; color: #555; }
  .brain-cat-rename-inp { flex: 1; background: #111; border: 1px solid rgba(201,168,76,.2); color: #c9a84c; font-family: 'Space Mono', monospace; font-size: 9px; padding: 3px 7px; border-radius: 2px; outline: none; }
  .brain-approval-title { font-family: 'Space Mono', monospace; font-size: 10px; color: #cec9c1; margin-bottom: 4px; }
  .brain-approval-content { font-size: 12px; color: #666; line-height: 1.5; max-height: 80px; overflow-y: auto; }
  .brain-approval-actions { display: flex; gap: 8px; margin-top: 10px; }

  /* ── Right column ── */
  .brain-entries-col {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .brain-entries-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid #252525;
    cursor: pointer;
    padding: 9px 0;
    color: rgba(201,168,76,.9);
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .14em;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .brain-entries-toggle:hover { color: #c9a84c; border-bottom-color: rgba(201,168,76,.25); }
  .undo-tab-btn { font-family: 'Space Mono', monospace; font-size: 9px; background: transparent; border: 1px solid #303030; color: #555; padding: 3px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap; transition: all .15s; flex-shrink: 0; }
  .undo-tab-btn:not(:disabled):hover { border-color: #c9a84c; color: #c9a84c; }
  .undo-tab-btn:disabled { opacity: .3; cursor: default; }

  .brain-cat-count { font-size: 8px; color: #444; margin-left: 4px; }
  .brain-cat-arrow { margin-left: auto; font-size: 8px; color: #333; transition: transform .15s; }
  .brain-cat-arrow.open { transform: rotate(90deg); color: #c9a84c; }

  .brain-cat-divider {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: rgba(201,168,76,.5);
    padding: 10px 0 5px;
    border-bottom: 1px solid #1a1a1a;
    margin-bottom: 4px;
  }

  .brain-subsection-title {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: rgba(201,168,76,.4);
    padding: 14px 0 5px;
    border-bottom: 1px solid #1a1a1a;
    margin-bottom: 4px;
  }

  .brain-reftrack-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 0;
    border-bottom: 1px solid #111;
  }
  .brain-reftrack-info {
    flex: 1;
    min-width: 0;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 300;
    color: #cec9c1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .brain-reftrack-stats {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brain-reftrack-source {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: #444;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 2px;
    padding: 1px 4px;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  .brain-reftrack-dot {
    font-size: 10px;
    flex-shrink: 0;
    line-height: 1;
  }
  .brain-reftrack-dot.user { color: #c9a84c; }
  .brain-reftrack-dot.agent { color: #444; }
  .brain-reftrack-promote {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #444;
    background: transparent;
    border: 1px solid #2a2a2a;
    border-radius: 2px;
    padding: 0 4px;
    cursor: pointer;
    flex-shrink: 0;
    line-height: 14px;
  }
  .brain-reftrack-promote:hover { color: #4caf82; border-color: #4caf82; }
  .brain-reftrack-notes { width: 100%; background: transparent; border: none; border-top: 1px solid #1a1a1a; color: #666; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 300; line-height: 1.4; padding: 3px 0 0; resize: none; outline: none; margin-top: 2px; }
  .brain-reftrack-notes::placeholder { color: #333; }
  .brain-reftrack-notes:focus { color: #9e9690; }

  .dump-collection-inp {
    width: 100%;
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 3px;
    color: #9e9690;
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 300;
    padding: 6px 10px;
    margin-top: 6px;
    outline: none;
    box-sizing: border-box;
  }
  .dump-collection-inp:focus { border-color: #3c3c3c; color: #f5f1ea; }
  .dump-collection-inp::placeholder { color: #444; }

  .brain-priority-filter-btn {
    background: #1c1c1c;
    border: 1px solid #303030;
    border-radius: 3px;
    color: #444;
    font-size: 14px;
    padding: 4px 8px;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s;
  }
  .brain-priority-filter-btn.active { color: #c9a84c; border-color: #c9a84c; }
  .brain-priority-filter-btn:hover { color: #c9a84c; }

  .brain-quicknotes-list { margin-bottom: 8px; }
  .brain-quick-note {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 3px;
    background: #141414;
    margin-bottom: 3px;
  }
  .brain-quick-note-dot { color: #555; font-size: 14px; flex-shrink: 0; }
  .brain-quick-note-text { flex: 1; font-size: 12px; color: #cec9c1; font-weight: 300; }
  .brain-quick-note-date { font-size: 10px; color: #555; flex-shrink: 0; }

  .brain-collection-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0 4px;
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    color: #c9a84c;
    letter-spacing: 0.05em;
    border-bottom: 1px solid rgba(201,168,76,0.2);
    margin-bottom: 4px;
    margin-top: 10px;
  }
  .brain-collection-icon { font-size: 10px; opacity: 0.7; }

  .brain-priority-star {
    background: none;
    border: none;
    color: #333;
    font-size: 13px;
    padding: 0 3px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .brain-priority-star.on { color: #c9a84c; }
  .brain-priority-star:hover { color: #c9a84c; }

  .brain-entry {
    background: #1c1c1c;
    border: 1px solid #252525;
    border-radius: 3px;
    padding: 8px 10px;
    margin-bottom: 4px;
    transition: opacity .2s;
  }
  .brain-entry.inactive { opacity: .35; }
  .brain-entry.priority { border-left: 2px solid #c9a84c; }
  .brain-question-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px solid #111;
  }
  .brain-question-icon {
    font-size: 10px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .brain-question-text {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #cec9c1;
    flex: 1;
    font-style: italic;
    line-height: 1.5;
  }
  .brain-question-date {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: #333;
    flex-shrink: 0;
  }

  .brain-entry-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .brain-entry-title {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    color: #f5f1ea;
    line-height: 1.4;
    flex: 1;
  }
  .brain-entry-title.clickable-title {
    cursor: pointer;
  }
  .brain-entry-title.clickable-title:hover { color: #c9a84c; }

  .brain-toggle {
    background: transparent;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    color: #444;
    transition: color .15s;
    flex-shrink: 0;
  }
  .brain-toggle.on { color: #c9a84c; }
  .brain-toggle:hover { color: #c9a84c; }

  .brain-del {
    background: transparent;
    border: none;
    color: #555;
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }
  .brain-del:hover { color: #e05a4a; }

  .brain-entry-content {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #9e9690;
    line-height: 1.6;
    padding: 6px 0 2px 22px;
  }

  .brain-ref-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    background: #1c1c1c;
    border: 1px solid #252525;
    border-radius: 3px;
    margin-bottom: 3px;
    transition: opacity .2s;
  }
  .brain-ref-row.inactive { opacity: .35; }
  .brain-ref-title {
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    font-weight: 700;
    color: #cec9c1;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brain-ref-meta {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #555;
    white-space: nowrap;
    letter-spacing: .03em;
  }

  .brain-watched-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: #1c1c1c;
    border: 1px solid #252525;
    border-radius: 3px;
    margin-bottom: 3px;
  }
  .brain-watched-name {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    color: #cec9c1;
    flex: 1;
  }
  .brain-watched-genre {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 300;
    color: #555;
    white-space: nowrap;
  }
  .brain-watched-checked {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #444;
    white-space: nowrap;
  }

  .brain-dup-warning {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: rgba(201,168,76,.6);
    padding: 4px 0;
    letter-spacing: .06em;
  }

  .brain-empty {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    color: #333;
    margin-top: 8px;
  }

  .brain-spotify-row { margin-bottom: 24px; }
  .brain-spotify-input-row { display: flex; gap: 8px; margin-top: 8px; }
  .brain-spotify-inp {
    flex: 1;
    background: #111;
    border: 1px solid #252525;
    color: #f5f1ea;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 3px;
    outline: none;
  }
  .brain-spotify-inp:focus { border-color: rgba(201,168,76,.3); }
  .brain-spotify-inp::placeholder { color: #333; }
  .brain-import-result {
    margin-top: 10px;
    padding: 10px;
    background: #111;
    border: 1px solid #252525;
    border-radius: 3px;
  }
  .brain-import-summary {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #9e9690;
    line-height: 1.5;
    margin-top: 4px;
  }
  .brain-import-stats {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #444;
    margin-top: 6px;
    letter-spacing: .04em;
  }
  .brain-import-dismiss {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #333;
    background: transparent;
    border: none;
    cursor: pointer;
    margin-top: 6px;
    padding: 0;
    display: block;
  }
  .brain-import-dismiss:hover { color: #555; }

  /* ── Reference Tracks ── */
  .brain-genre-group { margin-bottom: 8px; }

  .brain-genre-label {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: .1em;
    color: rgba(201,168,76,.5);
    padding: 6px 0 3px;
    text-transform: uppercase;
    border-bottom: 1px solid #1c1c1c;
  }

  .brain-track-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 0;
    border-bottom: 1px solid #111;
  }

  .track-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .track-artist-title {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    color: #cec9c1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-stats {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: #444;
  }

  .track-genres-row { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }

  .brain-ref-entry .brain-entry-header { align-items: flex-start; }
  .brain-ref-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .brain-ref-title { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; color: #cec9c1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .brain-ref-stats { font-family: 'Space Mono', monospace; font-size: 8px; color: #444; }
  .brain-ref-genres { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 1px; }
  .brain-sp-link { color: rgba(201,168,76,.6); font-size: 10px; text-decoration: none; flex-shrink: 0; padding: 0 4px; }
  .brain-sp-link:hover { color: #c9a84c; }

  .track-play-btn {
    color: #4caf82;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 10px;
    flex-shrink: 0;
    padding: 2px 4px;
  }
  .track-play-btn:hover { color: #6fcfa0; }

  .track-dl-btn {
    color: #555;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 11px;
    flex-shrink: 0;
    padding: 2px 4px;
    font-family: 'Space Mono', monospace;
  }
  .track-dl-btn:hover { color: #4caf82; }

  .track-del-btn {
    color: #333;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    flex-shrink: 0;
    padding: 2px 4px;
  }
  .track-del-btn:hover { color: #e05a4a; }
  .brain-screen-section { padding-bottom: 16px; border-bottom: 1px solid #1c1c1c; margin-bottom: 16px; }
  .brain-screen-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .brain-capture-result { margin-top: 8px; padding: 8px 10px; background: #0d0d0d; border: 1px solid #252525; border-radius: 3px; }
  .brain-mixing-suggestion { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 300; color: #cec9c1; padding: 3px 0; }
  .brain-capture-meta { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; margin-top: 8px; padding-top: 6px; border-top: 1px solid #1a1a1a; }
  .brain-capture-delete-link { background: none; border: none; padding: 0; font-family: 'Space Mono', monospace; font-size: 10px; color: #666; cursor: pointer; text-decoration: underline; }
  .brain-capture-delete-link:hover { color: #e74c3c; }

  /* Brain search */
  .brain-search-row { display: flex; align-items: center; gap: 6px; margin: 8px 0 6px; }
  .brain-search-inp {
    flex: 1;
    background: #111;
    border: 1px solid #303030;
    border-radius: 3px;
    color: #f5f1ea;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    padding: 5px 8px;
  }
  .brain-search-inp::placeholder { color: #555; }
  .brain-search-inp:focus { outline: none; border-color: #3c3c3c; }
  .brain-search-clear {
    background: transparent; border: none; color: #555; font-size: 14px;
    cursor: pointer; padding: 2px 4px; flex-shrink: 0;
  }
  .brain-search-clear:hover { color: #e05a4a; }

  /* Due review banner */
  .brain-review-banner {
    background: rgba(76,175,130,.08);
    border: 1px solid rgba(76,175,130,.25);
    border-radius: 4px;
    color: #4caf82;
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    padding: 6px 10px;
    margin-bottom: 8px;
  }

  /* Confidence pills */
  .conf-pill { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; letter-spacing: .06em; padding: 2px 6px; border-radius: 10px; cursor: pointer; flex-shrink: 0; text-transform: uppercase; border: none; transition: opacity .15s; }
  .conf-pill:hover { opacity: .75; }
  .conf-pill-low    { background: rgba(255,255,255,.05); color: #444; }
  .conf-pill-medium { background: rgba(206,201,193,.1);  color: #9e9690; }
  .conf-pill-strong { background: rgba(201,168,76,.15);  color: #c9a84c; }
  .conf-pill-locked { background: rgba(76,175,130,.15);  color: #4caf82; }

  /* Confidence tooltip */
  .brain-conf-tooltip {
    background: #1c1c1c;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    padding: 10px 12px;
    margin: 6px 0;
  }
  .brain-conf-tooltip-msg {
    font-size: 12px; color: #cec9c1; margin: 0 0 8px;
  }
  .brain-conf-tooltip-btns { display: flex; gap: 6px; }
  .brain-conf-confirm {
    background: rgba(76,175,130,.15); border: 1px solid rgba(76,175,130,.4);
    color: #4caf82; font-family: 'Space Mono', monospace; font-size: 11px;
    padding: 4px 10px; border-radius: 3px; cursor: pointer;
  }
  .brain-conf-confirm:hover { background: rgba(76,175,130,.25); }
  .brain-conf-cancel {
    background: transparent; border: 1px solid #303030;
    color: #9e9690; font-family: 'Space Mono', monospace; font-size: 11px;
    padding: 4px 10px; border-radius: 3px; cursor: pointer;
  }

  /* Review date in expanded view */
  .brain-review-row {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 0 3px; border-top: 1px solid #1c1c1c; margin-top: 6px;
  }
  .brain-review-label {
    font-family: 'Space Mono', monospace; font-size: 9px;
    color: rgba(201,168,76,.6); text-transform: uppercase; letter-spacing: .05em;
    flex-shrink: 0;
  }
  .brain-review-date-inp {
    background: #111; border: 1px solid #303030; border-radius: 3px;
    color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 12px;
    padding: 3px 6px; cursor: pointer;
  }
  .brain-review-date-inp:focus { outline: none; border-color: rgba(201,168,76,.4); }
  .brain-review-clear {
    background: transparent; border: none; color: #444;
    font-size: 12px; cursor: pointer; padding: 0 2px;
  }
  .brain-review-clear:hover { color: #e05a4a; }

  /* Approval panel — per-item header with editable category */
  .brain-approval-item-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .brain-approval-cat-inp {
    flex: 1; background: #111; border: 1px solid #303030; border-radius: 3px;
    color: #cec9c1; font-family: 'DM Sans', sans-serif; font-size: 11px; padding: 2px 6px;
  }
  .brain-approval-cat-inp:focus { outline: none; border-color: rgba(201,168,76,.4); }
  .brain-approval-conf {
    font-family: 'Space Mono', monospace; font-size: 9px; padding: 1px 5px;
    border-radius: 2px; flex-shrink: 0; text-transform: uppercase; letter-spacing: .05em;
  }
  .conf-badge-weak   { background: rgba(68,68,68,.4); color: #666; }
  .conf-badge-medium { background: rgba(201,168,76,.15); color: rgba(201,168,76,.8); }
  .conf-badge-strong { background: rgba(76,175,130,.15); color: #4caf82; }
  .brain-approval-new-badge {
    font-family: 'Space Mono', monospace; font-size: 8px; padding: 1px 4px;
    border-radius: 2px; flex-shrink: 0; letter-spacing: .08em;
    background: rgba(76,175,130,.12); color: #4caf82; border: 1px solid rgba(76,175,130,.25);
  }
  .brain-approval-remove {
    background: transparent; border: none; color: #444; font-size: 13px;
    cursor: pointer; padding: 0 2px; flex-shrink: 0;
  }
  .brain-approval-remove:hover { color: #e05a4a; }

  /* Entry connections */
  .brain-related-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding-top: 5px; margin-top: 4px; border-top: 1px solid #1c1c1c; }
  .brain-related-label {
    font-family: 'Space Mono', monospace; font-size: 9px;
    color: rgba(201,168,76,.5); text-transform: uppercase; letter-spacing: .05em; flex-shrink: 0;
  }
  .brain-related-chip {
    background: #1c1c1c; border: 1px solid #303030; border-radius: 3px;
    color: #9e9690; font-family: 'Space Mono', monospace; font-size: 10px;
    padding: 2px 7px; cursor: pointer; transition: border-color .15s, color .15s;
  }
  .brain-related-chip:hover { border-color: rgba(201,168,76,.4); color: #cec9c1; }
  .mozart-block { margin-top: 16px; border-top: 1px solid #1c1c1c; padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .mozart-title-row { display: flex; align-items: center; justify-content: space-between; }
  .mozart-title { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .14em; color: rgba(201,168,76,.75); margin-bottom: 2px; }
  .clear-chat { font-family: 'Space Mono', monospace; font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid #252525; color: #444; border-radius: 2px; cursor: pointer; }
  .clear-chat:hover { border-color: #555; color: #9e9690; }
  .chat-out { overflow-y: auto; max-height: 70vh; min-height: 200px; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; scroll-behavior: smooth; }
  .chat-msg { display: flex; flex-direction: column; gap: 2px; }
  .chat-who { font-family: 'Space Mono', monospace; font-size: 10px; color: #555; }
  .chat-msg.assistant .chat-who { color: #7a6230; }
  .chat-text { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #cec9c1; line-height: 1.5; }
  .chat-text.dim { color: #444; }
  .chat-input-row { display: flex; gap: 6px; }
  .chat-inp { flex: 1; background: #1c1c1c; border: 1px solid #303030; color: #f5f1ea; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 7px 10px; outline: none; border-radius: 3px; }
  .chat-inp:focus { border-color: rgba(201,168,76,.4); }
  .btn-gold-sm { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 700; padding: 7px 12px; background: #c9a84c; color: #0a0a0a; border: none; border-radius: 3px; cursor: pointer; }
  .refs-section { margin-bottom: 4px; }
  .refs-section-header { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; padding: 8px 0 4px; border-bottom: 1px solid #1c1c1c; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .refs-section-header.refs-curated { color: rgba(201,168,76,.75); }
  .refs-section-header.refs-curated:hover { color: rgba(201,168,76,1); }
  .refs-section-header.refs-checkout { color: #9e9690; cursor: default; }
  .refs-section-header.refs-library { color: #444; }
  .refs-section-header.refs-library:hover { color: #666; }
  .refs-count { font-family: 'Space Mono', monospace; font-size: 8px; background: #1c1c1c; padding: 1px 5px; border-radius: 8px; color: #555; }
  .refs-empty { font-size: 11px; color: #444; padding: 6px 0 8px; font-style: italic; }
  .ref-track-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #161616; font-size: 12px; }
  .ref-track-row.checkout-row { background: rgba(158,150,144,.03); }
  .ref-track-row.library { opacity: 0.65; }
  .ref-track-row.library:hover { opacity: 1; }
  .ref-source-dot { font-size: 9px; flex-shrink: 0; color: #555; }
  .ref-source-dot.user { color: #c9a84c; }
  .ref-source-dot.checkout { color: #9e9690; font-size: 8px; }
  .ref-title { color: #cec9c1; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ref-stats { font-family: 'Space Mono', monospace; font-size: 9px; color: #555; white-space: nowrap; flex-shrink: 0; }
  .ref-checkout-btns { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
  .library-search { background: #1c1c1c; border: 1px solid #252525; color: #9e9690; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px; border-radius: 3px; width: 100%; margin-bottom: 6px; outline: none; box-sizing: border-box; }
  .library-search:focus { border-color: #303030; }
  .promote-btn { font-family: 'Space Mono', monospace; font-size: 9px; background: transparent; border: 1px solid #303030; color: #666; padding: 1px 5px; border-radius: 2px; cursor: pointer; flex-shrink: 0; }
  .promote-btn:hover { background: rgba(201,168,76,.1); color: #c9a84c; }
  .promote-btn.gold { font-family: 'Space Mono', monospace; font-size: 8px; font-weight: 700; color: #c9a84c; border: 1px solid rgba(201,168,76,.4); background: rgba(201,168,76,.06); padding: 2px 6px; border-radius: 2px; cursor: pointer; }
  .promote-btn.gold:hover { background: rgba(201,168,76,.15); border-color: #c9a84c; }
</style>
