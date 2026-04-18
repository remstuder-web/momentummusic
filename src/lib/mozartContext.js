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
  const avg = (arr, key) => arr.filter(t => t[key] != null).reduce((s, t) => s + t[key], 0) / (arr.filter(t => t[key] != null).length || 1)

  const hitBenchmark = hitRefs.length ? {
    avg_bpm:          Math.round(avg(hitRefs, 'tempo')),
    avg_loudness:     avg(hitRefs, 'loudness').toFixed(1),
    avg_energy:       avg(hitRefs, 'energy').toFixed(2),
    avg_danceability: avg(hitRefs, 'danceability').toFixed(2),
    avg_valence:      avg(hitRefs, 'valence').toFixed(2),
    avg_brightness:   avg(hitRefs, 'brightness').toFixed(2),
    avg_bass_energy:  avg(hitRefs, 'bass_energy').toFixed(2),
    avg_acousticness: avg(hitRefs, 'acousticness').toFixed(2),
    common_keys:      [...new Set(hitRefs.map(t => t.key).filter(Boolean))].slice(0, 3)
  } : null

  const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null

  const formatTrack = t =>
    `${t.artist ? t.artist + ' — ' : ''}${t.title}: ` + [
      t.tempo       ? Math.round(t.tempo) + 'bpm'                              : null,
      t.key         ? t.key + (t.scale ? ' ' + t.scale : '')                  : null,
      t.energy      != null ? 'nrg ' + Number(t.energy).toFixed(2)            : null,
      t.danceability!= null ? 'dnc ' + Number(t.danceability).toFixed(2)      : null,
      t.valence     != null ? 'val ' + Number(t.valence).toFixed(2)           : null,
      t.loudness    != null ? Number(t.loudness).toFixed(1) + 'LUFS'          : null,
      t.brightness  != null ? 'brt ' + Number(t.brightness).toFixed(2)       : null,
      t.bass_energy != null ? 'bas ' + Number(t.bass_energy).toFixed(2)      : null,
      t.acousticness!= null ? 'aco ' + Number(t.acousticness).toFixed(2)     : null,
      t.duration_seconds    ? fmtDur(t.duration_seconds)                      : null,
      t.genre_tags?.length  ? t.genre_tags.slice(0, 2).join(', ')             : null
    ].filter(Boolean).join(' · ')

  const formatVersion = (name, a) =>
    `${name}: ` + [
      a.bpm           ? Math.round(a.bpm) + 'bpm'                             : null,
      a.key           ? a.key + (a.scale ? ' ' + a.scale : '')                : null,
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
- If LUFS reads below -20 or above -4, flag it as a measurement error — do not use the value\n\n`

  if (hitBenchmark) context +=
    `## HIT BENCHMARK (avg of ${hitRefs.length} reference tracks)\n` +
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
