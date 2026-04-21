export async function buildMozartContext(supabase, options = {}) {
  const { songVersions = [], currentSong = null, tasks = [], songSpecificRefs = [] } = options

  const [
    { data: ownProds }, { data: allRefs }, { data: goals }, { data: brain },
    { data: contactProfiles }, { data: recentMessages },
    { data: projectSongs }, { data: demoSongs },
    { data: pendingInbox }, { data: marketNews },
    { data: watchedArtists }, { data: activeProjects }
  ] = await Promise.all([
    supabase.from('reference_tracks').select('*').eq('collection_name', 'my_productions').order('created_at', { ascending: false }).limit(5),
    supabase.from('reference_tracks').select('*').neq('collection_name', 'my_productions').order('created_at', { ascending: false }).limit(20),
    supabase.from('brain_knowledge').select('title,content').eq('category', 'goal').limit(5),
    supabase.from('brain_knowledge').select('category,title,content').eq('active', true).order('created_at', { ascending: false }).limit(6),
    supabase.from('brain_knowledge').select('title,content').eq('category', 'contact_profile').eq('active', true).order('created_at', { ascending: false }).limit(10),
    supabase.from('inbox_notifications').select('message,metadata,created_at').eq('metadata->>platform', 'whatsapp').order('created_at', { ascending: false }).limit(5),
    supabase.from('songs').select('id,title,code,work_data,status').not('project_id', 'is', null).order('updated_at', { ascending: false }).limit(10),
    supabase.from('songs').select('id,title,code').is('project_id', null).limit(5),
    supabase.from('inbox_notifications').select('type,message,metadata,created_at').neq('metadata->>platform', 'whatsapp').eq('read', false).order('created_at', { ascending: false }).limit(5),
    supabase.from('brain_knowledge').select('title,content,created_at').eq('category', 'market_knowledge').order('created_at', { ascending: false }).limit(3),
    supabase.from('watched_artists').select('artist_name,genres').eq('active', true).limit(5),
    supabase.from('projects').select('name,artist,status,deadlines').eq('status', 'active').limit(5)
  ])

  const userRefs = (allRefs || []).filter(t => t.source === 'user' || t.promoted)
  const chartRefs = (allRefs || []).filter(t => t.source === 'agent' && !t.promoted)

  const benchmarkRefs = userRefs.length >= 2 ? userRefs : (allRefs || []).filter(t => t.collection_name !== 'daily_chart')
  const avg = (arr, key) => arr.filter(t => t[key] != null).reduce((s, t) => s + t[key], 0) / (arr.filter(t => t[key] != null).length || 1)

  const hitBenchmark = benchmarkRefs.length ? {
    avg_bpm:          Math.round(avg(benchmarkRefs, 'tempo')),
    avg_loudness:     avg(benchmarkRefs, 'loudness').toFixed(1),
    avg_energy:       avg(benchmarkRefs, 'energy').toFixed(2),
    avg_danceability: avg(benchmarkRefs, 'danceability').toFixed(2),
    avg_valence:      avg(benchmarkRefs, 'valence').toFixed(2),
    avg_brightness:   avg(benchmarkRefs, 'brightness').toFixed(2),
    avg_bass_energy:  avg(benchmarkRefs, 'bass_energy').toFixed(2),
    avg_acousticness: avg(benchmarkRefs, 'acousticness').toFixed(2),
    common_keys:      [...new Set(benchmarkRefs.map(t => t.key).filter(Boolean))].slice(0, 3)
  } : null

  const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null

  const formatTrack = t =>
    `${t.artist ? t.artist + ' — ' : ''}${t.title}: ` + [
      t.tempo       ? Math.round(t.tempo) + 'bpm'                                             : null,
      t.key         ? t.key + (t.scale ? ' ' + t.scale : '') + (t.camelot ? ' (' + t.camelot + ')' : '') : null,
      t.energy      != null ? 'nrg ' + Number(t.energy).toFixed(2)            : null,
      t.danceability!= null ? 'dnc ' + Number(t.danceability).toFixed(2)      : null,
      t.valence     != null ? 'val ' + Number(t.valence).toFixed(2)           : null,
      t.loudness    != null ? Number(t.loudness).toFixed(1) + 'LUFS'          : null,
      t.brightness  != null ? 'brt ' + Number(t.brightness).toFixed(2)       : null,
      t.bass_energy != null ? 'bas ' + Number(t.bass_energy).toFixed(2)      : null,
      t.acousticness!= null ? 'aco ' + Number(t.acousticness).toFixed(2)     : null,
      t.duration_seconds    ? fmtDur(t.duration_seconds)                      : null,
      t.genre_tags?.length  ? t.genre_tags.slice(0, 2).join(', ')             : null,
      t.notes               ? '(' + t.notes.slice(0, 60) + ')'               : null
    ].filter(Boolean).join(' · ')

  const formatVersion = (name, a) =>
    `${name}: ` + [
      a.bpm           ? Math.round(a.bpm) + 'bpm'                             : null,
      a.key           ? a.key + (a.scale ? ' ' + a.scale : '') + (a.camelot ? ' (' + a.camelot + ')' : '') : null,
      a.energy        != null ? 'nrg ' + Number(a.energy).toFixed(2)         : null,
      a.danceability  != null ? 'dnc ' + Number(a.danceability).toFixed(2)   : null,
      a.valence       != null ? 'val ' + Number(a.valence).toFixed(2)        : null,
      a.loudness_lufs != null ? Number(a.loudness_lufs).toFixed(1) + 'LUFS'  : null,
      a.brightness    != null ? 'brt ' + Number(a.brightness).toFixed(2)     : null,
      a.bass_energy   != null ? 'bas ' + Number(a.bass_energy).toFixed(2)    : null,
      a.acousticness  != null ? 'aco ' + Number(a.acousticness).toFixed(2)   : null,
      a.duration_seconds      ? fmtDur(a.duration_seconds)                   : null
    ].filter(Boolean).join(' · ')

  let context = `You are Mozart, a co-intelligence music production advisor for Remo.
Assess tracks the way Spotify's algorithm does — using signal data to find gaps.

FORMATTING RULES — always follow these:
- Use ## for section headers
- Use bullet points for lists, never long text blocks
- Max 2 sentences per bullet point
- Numbers and signal values always inline: 135bpm · E minor · nrg 0.82
- [GAP] prefix for every identified problem
- [OK] prefix for every strength
- End every response with ## Next Step — one specific action only
- Never write paragraphs of continuous text
- Never use bold (**text**) — no asterisks anywhere, not even for emphasis
- [CONFIRMED]/[TENSION]/[OUTDATED]/[NEW] tags are valid and encouraged for knowledge entries
- Keep each section tight — 3-5 bullets maximum
- If LUFS reads below -20 or above -4, flag it as a measurement error — do not use the value
- Every bullet point or numbered item MUST start on its own line
- Never run multiple points together in one paragraph
- After every period that ends a point, start a new line if another point follows
- Sections must have a blank line between them
- Every new topic or point MUST start on a new line
- Never continue two different points on the same line
- After a colon that introduces a new point, start a new line
- Between any two distinct ideas, insert a blank line
- Lists must have each item on its own line, never inline
- Never write: 'Point 1. Point 2. Point 3.' on one line
- Always write each point on a separate line with a - prefix\n\n`

  if (hitBenchmark) context +=
    `## HIT BENCHMARK (avg of ${benchmarkRefs.length} ref tracks${userRefs.length < 2 ? ' — add personal refs for better accuracy' : ''})\n` +
    `${hitBenchmark.avg_bpm}bpm · ` +
    `nrg ${hitBenchmark.avg_energy} · ` +
    `dnc ${hitBenchmark.avg_danceability} · ` +
    `val ${hitBenchmark.avg_valence} · ` +
    `${hitBenchmark.avg_loudness}LUFS · ` +
    `brt ${hitBenchmark.avg_brightness} · ` +
    `bas ${hitBenchmark.avg_bass_energy} · ` +
    `aco ${hitBenchmark.avg_acousticness} · ` +
    `keys: ${hitBenchmark.common_keys.join(', ')}\n\n`

  if (currentSong && songVersions?.length) {
    const versionsWithAnalysis = songVersions.filter(v => v.analysis)
    if (versionsWithAnalysis.length) {
      context += `## CURRENT SONG: ${currentSong}\n`
      versionsWithAnalysis.forEach(v => {
        context += formatVersion(v.name, v.analysis) + '\n'
      })
      context += '\n'
    }
  }

  if (songSpecificRefs.length) context +=
    `## THIS SONG'S REFERENCES (primary — compare against these first)\n` +
    songSpecificRefs.map(formatTrack).join('\n') + '\n\n'

  if (ownProds?.length) context +=
    `## MY PRODUCTIONS\n` + ownProds.map(formatTrack).join('\n') + '\n\n'

  if (userRefs.length) context +=
    `## MY REFERENCE TRACKS (personal choices)\n` + userRefs.map(formatTrack).join('\n') + '\n\n'

  if (chartRefs.length) context +=
    `## MARKET CONTEXT (auto-tracked charts — background only)\n` + chartRefs.slice(0, 3).map(formatTrack).join('\n') + '\n\n'

  const pinnedTask = tasks?.find(t => t.pinned)
  if (pinnedTask) context += `TODAY'S FOCUS TASK: ${pinnedTask.label}\n\n`

  if (goals?.length) context +=
    `## ACTIVE GOALS\n` + goals.map(g => '- ' + g.title).join('\n') + '\n\n'

  if (activeProjects?.length) {
    context += '## ACTIVE PROJECTS\n'
    context += activeProjects.map(p =>
      p.artist + ' — ' + p.name +
      (p.deadlines?.filter(d => !d.done).length ?
        ' · ' + p.deadlines.filter(d => !d.done).length + ' deadlines' : '')
    ).join('\n') + '\n\n'
  }

  if (projectSongs?.length) {
    context += '## SONGS IN PIPELINE\n'
    const byStage = {}
    for (const s of projectSongs) {
      const stage = s.work_data?.current_stage || 'unknown'
      if (!byStage[stage]) byStage[stage] = []
      byStage[stage].push(s.title || s.code)
    }
    context += Object.entries(byStage)
      .map(([stage, songs]) => stage.toUpperCase() + ': ' + songs.join(', '))
      .join('\n') + '\n\n'
  }

  if (demoSongs?.length) {
    context += '## DEMOS IN MARKET\n'
    context += demoSongs.length + ' demos sent · '
    context += demoSongs.slice(0, 3).map(s => s.title || s.code).join(', ') + '\n\n'
  }

  if (tasks?.length) {
    const todayTasks = tasks.filter(t => !t.done).slice(0, 5)
    if (todayTasks.length) {
      context += '## TODAY\'S TASKS\n'
      context += todayTasks.map(t => '- ' + t.label).join('\n') + '\n\n'
    }
  }

  if (pendingInbox?.length) {
    context += '## PENDING INBOX\n'
    context += pendingInbox.map(n =>
      n.type.toUpperCase() + ': ' +
      (n.metadata?.from ? n.metadata.from + ' — ' : '') +
      (n.message || '').slice(0, 80)
    ).join('\n') + '\n\n'
  }

  if (marketNews?.length) {
    context += '## MARKET INTELLIGENCE (latest)\n'
    context += marketNews.map(n =>
      new Date(n.created_at).toLocaleDateString() + ': ' +
      n.title + ' — ' + n.content.slice(0, 100)
    ).join('\n') + '\n\n'
  }

  if (watchedArtists?.length) {
    context += '## WATCHED ARTISTS\n'
    context += watchedArtists.map(a =>
      a.artist_name +
      (a.genres?.length ? ' (' + a.genres.slice(0, 2).join(', ') + ')' : '')
    ).join(', ') + '\n\n'
  }

  if (brain?.length) {
    const priorityBrain = brain.filter(b => b.priority)
    const normalBrain = brain.filter(b => !b.priority)
    if (priorityBrain.length) {
      context += `## HIGH PRIORITY KNOWLEDGE\n` + priorityBrain.map(b => `[${b.category}] ${b.title}: ${b.content.slice(0, 80)}`).join('\n') + '\n\n'
    }
    if (normalBrain.length) {
      context += `## BRAIN KNOWLEDGE\n` + normalBrain.map(b => `[${b.category}] ${b.title}: ${b.content.slice(0, 80)}`).join('\n')
    }
  }

  if (contactProfiles?.length) {
    context += '\n\n## ARTIST/CONTACT PROFILES\n'
    context += contactProfiles.map(p =>
      p.title.replace('Profile: ', '') + ': ' + p.content.slice(0, 120)
    ).join('\n')
  }

  if (recentMessages?.length) {
    context += '\n\n## RECENT WHATSAPP ACTIVITY\n'
    context += recentMessages.map(m => {
      const meta = m.metadata || {}
      return (meta.from || 'Unknown') + ': ' +
        (meta.real_intent || m.message?.slice(0, 80)) +
        (meta.urgency === 'high' ? ' [HIGH URGENCY]' : '')
    }).join('\n')
  }

  context += `\n\n## ACTION COMMANDS
When the user asks you to ADD, SAVE, FETCH, or ANALYZE something, include an action command at the END of your response in this format:
[ACTION: action_type | param1=value1 | param2=value2]

Available actions:
- add_reference: adds a track as reference. params: track (artist - title), song_id (optional)
- save_to_brain: saves text to brain. params: text, category
- analyze_track: analyzes a Spotify URL. params: url
- set_stage: changes song stage. params: song_id, stage

Always include the action AFTER your normal response text.
Only include actions when explicitly asked to perform them.`

  return context
}

export function parseActions(text) {
  const actions = []
  const regex = /\[ACTION:\s*(\w+)\s*\|([^\]]+)\]/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const type = match[1]
    const params = {}
    match[2].split('|').forEach(p => {
      const eqIdx = p.indexOf('=')
      if (eqIdx < 0) return
      const k = p.slice(0, eqIdx).trim()
      const v = p.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (k) params[k] = v
    })
    actions.push({ type, params })
  }
  return actions
}

export async function executeAction(action, supabase, currentSong) {
  switch (action.type) {
    case 'add_reference': {
      const songId = action.params.song_id || currentSong?.id
      const res = await fetch('http://localhost:4242/agent-import-spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: action.params.track,
          song_id: songId,
          collection: 'reference_current',
          source: 'mozart'
        })
      })
      const d = await res.json()
      if (!d.ok) return '✗ Could not find track'

      if (songId && d.spotify_id) {
        const { data: songData } = await supabase.from('songs').select('work_data').eq('id', songId).maybeSingle()
        const wd = songData?.work_data || {}
        const refs = Array.isArray(wd.reference_links) ? wd.reference_links : []
        if (!refs.find(r => r.spotify_id === d.spotify_id)) {
          refs.push({
            id: 'ref' + Date.now(),
            title: d.title,
            artist: d.artist,
            spotify_id: d.spotify_id,
            url: 'https://open.spotify.com/track/' + d.spotify_id,
            source: 'mozart'
          })
          wd.reference_links = refs
          await supabase.from('songs').update({ work_data: wd }).eq('id', songId)
        }
      }

      return '✓ Added ' + (d.title ? d.title + ' — ' + d.artist : action.params.track)
    }

    case 'save_to_brain': {
      await supabase.from('brain_knowledge').insert({
        category: action.params.category || 'observation',
        title: action.params.text?.slice(0, 60),
        content: action.params.text,
        entry_type_v2: 'observation',
        confidence: 'medium',
        source_type: 'mozart',
        active: true
      })
      return '✓ Saved to brain'
    }

    case 'analyze_track': {
      const res = await fetch('http://localhost:4242/analyze-spotify-track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: action.params.url })
      })
      const d = await res.json()
      return d.ok ? '✓ Analyzed: ' + (d.title || action.params.url) : '✗ Could not analyze'
    }

    case 'set_stage': {
      if (!action.params.song_id || !action.params.stage) return null
      const { data: song } = await supabase.from('songs').select('work_data').eq('id', action.params.song_id).single()
      const newWorkData = { ...(song?.work_data || {}), current_stage: action.params.stage }
      await supabase.from('songs').update({ work_data: newWorkData }).eq('id', action.params.song_id)
      return '✓ Stage updated to ' + action.params.stage
    }

    default:
      return null
  }
}
