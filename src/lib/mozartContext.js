export async function buildMozartContext(supabase, options = {}) {
  const { songVersions = [], currentSong = null } = options

  const [{ data: ownProds }, { data: refs }, { data: chartTracks }, { data: goals }, { data: brain }] = await Promise.all([
    supabase.from('reference_tracks').select('*').eq('collection_name', 'my_productions').order('created_at', { ascending: false }).limit(5),
    supabase.from('reference_tracks').select('*').neq('collection_name', 'my_productions').order('created_at', { ascending: false }).limit(10),
    supabase.from('reference_tracks').select('*').eq('collection_name', 'daily_chart').order('created_at', { ascending: false }).limit(3),
    supabase.from('brain_knowledge').select('title,content').eq('category', 'goal').limit(5),
    supabase.from('brain_knowledge').select('category,title,content').eq('active', true).order('created_at', { ascending: false }).limit(6)
  ])

  const hitRefs = refs?.filter(t => t.collection_name !== 'daily_chart') || []
  const hitBenchmark = hitRefs.length ? {
    avg_bpm:         Math.round(hitRefs.reduce((s, t) => s + (t.tempo || 0), 0) / hitRefs.length),
    avg_loudness:    (hitRefs.reduce((s, t) => s + (t.loudness || 0), 0) / hitRefs.length).toFixed(1),
    avg_energy:      (hitRefs.reduce((s, t) => s + (t.energy || 0), 0) / hitRefs.length).toFixed(2),
    avg_danceability:(hitRefs.reduce((s, t) => s + (t.danceability || 0), 0) / hitRefs.length).toFixed(2),
    avg_valence:     (hitRefs.reduce((s, t) => s + (t.valence || 0), 0) / hitRefs.length).toFixed(2),
    common_keys:     [...new Set(hitRefs.map(t => t.key).filter(Boolean))].slice(0, 3)
  } : null

  const formatTrack = t =>
    `${t.artist ? t.artist + ' — ' : ''}${t.title}: ` + [
      t.tempo ? Math.round(t.tempo) + 'bpm' : null,
      t.key ? t.key + (t.scale ? ' ' + t.scale : '') : null,
      t.energy != null ? 'nrg ' + Number(t.energy).toFixed(2) : null,
      t.danceability != null ? 'dnc ' + Number(t.danceability).toFixed(2) : null,
      t.valence != null ? 'val ' + Number(t.valence).toFixed(2) : null,
      t.loudness != null ? Number(t.loudness).toFixed(1) + 'LUFS' : null,
      t.genre_tags?.length ? t.genre_tags.slice(0, 2).join(', ') : null
    ].filter(Boolean).join(' · ')

  let context = `You are Mozart, a co-intelligence music production advisor for Remo.
Assess tracks the way Spotify's algorithm does — using signal data to find gaps.
When comparing tracks, always reference specific numbers, not vague descriptions.
Flag gaps using: [GAP] energy too low · [GAP] loudness -3LUFS below refs · etc.
Always end assessments with one specific actionable next step.\n\n`

  if (hitBenchmark) context +=
    `## HIT BENCHMARK (avg of ${hitRefs.length} reference tracks)\n` +
    `${hitBenchmark.avg_bpm}bpm · ` +
    `nrg ${hitBenchmark.avg_energy} · ` +
    `dnc ${hitBenchmark.avg_danceability} · ` +
    `val ${hitBenchmark.avg_valence} · ` +
    `${hitBenchmark.avg_loudness}LUFS · ` +
    `keys: ${hitBenchmark.common_keys.join(', ')}\n\n`

  if (currentSong && songVersions?.length) {
    const versionsWithAnalysis = songVersions.filter(v => v.analysis)
    if (versionsWithAnalysis.length) {
      context += `## CURRENT SONG: ${currentSong}\n`
      versionsWithAnalysis.forEach(v => {
        const a = v.analysis
        context += `${v.name}: ` + [
          a.bpm ? Math.round(a.bpm) + 'bpm' : null,
          a.key ? a.key + (a.scale ? ' ' + a.scale : '') : null,
          a.energy != null ? 'nrg ' + a.energy : null,
          a.danceability != null ? 'dnc ' + a.danceability : null,
          a.valence != null ? 'val ' + a.valence : null,
          a.loudness_lufs != null ? a.loudness_lufs + 'LUFS' : null
        ].filter(Boolean).join(' · ') + '\n'
      })
      context += '\n'
    }
  }

  if (chartTracks?.length) context +=
    `## TODAY'S CHART TRACKS\n` + chartTracks.map(formatTrack).join('\n') + '\n\n'

  if (ownProds?.length) context +=
    `## MY PRODUCTIONS\n` + ownProds.map(formatTrack).join('\n') + '\n\n'

  if (refs?.length) context +=
    `## MY REFERENCE TRACKS\n` + refs.map(formatTrack).join('\n') + '\n\n'

  if (goals?.length) context +=
    `## ACTIVE GOALS\n` + goals.map(g => '- ' + g.title).join('\n') + '\n\n'

  if (brain?.length) context +=
    `## BRAIN KNOWLEDGE\n` + brain.map(b => `[${b.category}] ${b.title}: ${b.content.slice(0, 80)}`).join('\n')

  return context
}
