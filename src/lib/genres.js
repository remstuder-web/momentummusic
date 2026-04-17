export const GENRE_LIST = [
  { label: 'ELECTRONIC & DANCE', type: 'main', tag: 'electronic' },
  { label: 'house',              type: 'sub',  tag: 'house' },
  { label: 'afrobeats',          type: 'sub',  tag: 'afrobeats' },
  { label: 'melodic techno',     type: 'sub',  tag: 'melodic-techno' },
  { label: 'POP',                type: 'main', tag: 'pop' },
  { label: 'k-pop',              type: 'sub',  tag: 'k-pop' },
  { label: 'r&b',                type: 'sub',  tag: 'r-n-b' },
  { label: 'hyperpop',           type: 'sub',  tag: 'hyperpop' },
  { label: 'synth-pop',          type: 'sub',  tag: 'synth-pop' },
  { label: 'HIPHOP',             type: 'main', tag: 'hip-hop' },
  { label: 'german hiphop',      type: 'sub',  tag: 'german-hip-hop' },
  { label: 'rap',                type: 'sub',  tag: 'rap' },
  { label: 'trap',               type: 'sub',  tag: 'trap' },
  { label: 'drill',              type: 'sub',  tag: 'drill' },
  { label: 'phonk',              type: 'sub',  tag: 'phonk' },
  { label: 'emo rap',            type: 'sub',  tag: 'emo-rap' },
  { label: 'boom bap',           type: 'sub',  tag: 'boom-bap' },
  { label: 'INDIE / ALT',        type: 'main', tag: 'indie' },
  { label: 'dark pop',           type: 'sub',  tag: 'dark-pop' },
  { label: 'dream pop',          type: 'sub',  tag: 'dream-pop' },
  { label: 'chamber pop',        type: 'sub',  tag: 'chamber-pop' },
  { label: 'LATIN',              type: 'main', tag: 'latin' },
  { label: 'urban latino',       type: 'sub',  tag: 'urbano-latino' },
  { label: 'reggaeton',          type: 'sub',  tag: 'reggaeton' },
  { label: 'dancehall',          type: 'sub',  tag: 'dancehall' },
  { label: 'ROCK',               type: 'main', tag: 'rock' },
  { label: 'SOUL',               type: 'main', tag: 'soul' },
  { label: 'FUNK',               type: 'main', tag: 'funk' },
]

// Flat array of display labels for dropdowns
export const GENRE_LABELS = GENRE_LIST.map(g => g.label)

// Spotify-compatible tags for API calls
export const SPOTIFY_TAGS = GENRE_LIST.map(g => g.tag)
