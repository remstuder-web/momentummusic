<script>
  let { mixCurve = null, refCurve = null, mixLabel = '', refLabel = '' } = $props()

  const REF_COLOR = '#c9a84c'
  const MIX_COLOR = 'rgba(255,255,255,0.85)'

  // Keep last non-null values so chart doesn't blank out during async reloads
  let lastMixCurve = $state(null)
  let lastRefCurve = $state(null)

  $effect(() => { if (mixCurve != null) lastMixCurve = mixCurve })
  $effect(() => { if (refCurve != null) lastRefCurve = refCurve })

  const displayMix = $derived(mixCurve ?? lastMixCurve)
  const displayRef = $derived(refCurve ?? lastRefCurve)

  const ISO_FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000
  ]

  const W = 580, H = 200
  const PAD_L = 44, PAD_T = 16, PAD_R = 16, PAD_B = 32
  const CHART_W = W - PAD_L - PAD_R
  const CHART_H = H - PAD_T - PAD_B
  const DB_MIN = -20, DB_MAX = 20

  function xForFreq(f) {
    const logMin = Math.log10(20), logMax = Math.log10(16000)
    return PAD_L + ((Math.log10(f) - logMin) / (logMax - logMin)) * CHART_W
  }

  function yForDb(db) {
    return PAD_T + ((DB_MAX - db) / (DB_MAX - DB_MIN)) * CHART_H
  }

  function curveToPoints(curve) {
    if (!curve) return ''
    return ISO_FREQS
      .filter(f => curve[String(f)] !== undefined)
      .map(f => `${xForFreq(f).toFixed(1)},${yForDb(curve[String(f)]).toFixed(1)}`)
      .join(' ')
  }

  function curveToArea(curve) {
    if (!curve) return ''
    const baseline = yForDb(0).toFixed(1)
    const pts = ISO_FREQS.filter(f => curve[String(f)] !== undefined)
    if (!pts.length) return ''
    const first = xForFreq(pts[0]).toFixed(1)
    const last = xForFreq(pts[pts.length - 1]).toFixed(1)
    const points = pts.map(f => `${xForFreq(f).toFixed(1)},${yForDb(curve[String(f)]).toFixed(1)}`).join(' ')
    return `${first},${baseline} ${points} ${last},${baseline}`
  }

  const gridDbs = [-15, -10, -5, 0, 5, 10, 15]
  const labelFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000]
  const labelText = { 20: '20', 50: '50', 100: '100', 200: '200', 500: '500', 1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 16000: '16k' }
</script>

<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" class="eq-svg">
  <defs>
    <clipPath id="chart-clip">
      <rect x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H} />
    </clipPath>
  </defs>

  <!-- dB grid lines -->
  {#each gridDbs as db}
    {@const y = yForDb(db)}
    <line x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
      stroke={db === 0 ? 'rgba(255,255,255,0.3)' : '#1a1a1a'} stroke-width={db === 0 ? 1.5 : 0.5} />
    <text x={PAD_L - 4} y={y + 3.5} text-anchor="end" font-size="9" fill="#444" font-family="Space Mono, monospace">{db > 0 ? '+' : ''}{db}</text>
  {/each}

  <!-- Frequency grid lines -->
  {#each labelFreqs as f}
    {@const x = xForFreq(f)}
    <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + CHART_H} stroke="#1a1a1a" stroke-width="0.5" />
    <text x={x} y={PAD_T + CHART_H + 12} text-anchor="middle" font-size="9" fill="#444" font-family="Space Mono, monospace">{labelText[f]}</text>
  {/each}

  <rect x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H} fill="none" stroke="#252525" stroke-width="0.5" />

  <!-- Reference curve (behind mix) — gold -->
  {#if displayRef}
    <polygon points={curveToArea(displayRef)} fill="rgba(201,168,76,0.05)" clip-path="url(#chart-clip)" />
    <polyline points={curveToPoints(displayRef)} fill="none" stroke={REF_COLOR} stroke-width="1.5"
      stroke-linejoin="round" stroke-linecap="round" opacity="0.7" clip-path="url(#chart-clip)" />
  {/if}

  <!-- Mix curve (on top) — bright white -->
  {#if displayMix}
    <polygon points={curveToArea(displayMix)} fill="rgba(255,255,255,0.03)" clip-path="url(#chart-clip)" />
    <polyline points={curveToPoints(displayMix)} fill="none" stroke={MIX_COLOR} stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" clip-path="url(#chart-clip)" />
  {/if}

  <!-- Legend -->
  {#if displayRef}
    <line x1={PAD_L + 4} y1={PAD_T + 8} x2={PAD_L + 18} y2={PAD_T + 8} stroke={REF_COLOR} stroke-width="1.5" opacity="0.7" />
    <text x={PAD_L + 22} y={PAD_T + 11.5} font-size="9" fill={REF_COLOR} font-family="Space Mono, monospace" opacity="0.7">{refLabel || 'REF'}</text>
  {/if}
  {#if displayMix}
    {@const legendX = displayRef ? PAD_L + 4 + 88 : PAD_L + 4}
    <line x1={legendX} y1={PAD_T + 8} x2={legendX + 14} y2={PAD_T + 8} stroke={MIX_COLOR} stroke-width="2" />
    <text x={legendX + 18} y={PAD_T + 11.5} font-size="9" fill="rgba(255,255,255,0.8)" font-family="Space Mono, monospace">{mixLabel || 'MY MIX'}</text>
  {/if}
</svg>

<style>
  .eq-svg { width: 100%; height: auto; display: block; background: #080808; border-radius: 3px; }
</style>
