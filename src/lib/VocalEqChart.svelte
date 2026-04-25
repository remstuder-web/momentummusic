<script>
  let { mixCurve = null, refCurve = null, mixLabel = '', refLabel = '', isMixTab = false } = $props()

  const REF_COLOR = '#c9a84c'
  const MIX_COLOR = 'rgba(255,255,255,0.85)'

  // Keep last non-null values so chart doesn't blank out during async reloads
  let lastMixCurve = $state(null)
  let lastRefCurve = $state(null)

  $effect(() => { if (mixCurve != null) lastMixCurve = mixCurve })
  $effect(() => { if (refCurve != null) lastRefCurve = refCurve })

  // Normalize curve to {freq: dB} object — handles both array (Essentia) and object formats
  function normalizeCurve(curve) {
    if (!curve) return null
    if (Array.isArray(curve)) {
      const obj = {}
      ISO_FREQS.forEach((f, i) => { if (i < curve.length && Number.isFinite(curve[i])) obj[String(f)] = curve[i] })
      return obj
    }
    return curve
  }

  const displayMix = $derived(normalizeCurve(mixCurve ?? lastMixCurve))
  const displayRef = $derived(normalizeCurve(refCurve ?? lastRefCurve))

  const ISO_FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000
  ]

  const W = 580, H = 200
  const PAD_L = 44, PAD_T = 16, PAD_R = 16, PAD_B = 32
  const CHART_W = W - PAD_L - PAD_R
  const CHART_H = H - PAD_T - PAD_B

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

  const labelFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000]
  const labelText = { 20: '20', 50: '50', 100: '100', 200: '200', 500: '500', 1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 16000: '16k' }

  // iZotope 2024 Mastering Trends — Top 40 commercial average
  // [freq_hz, avg_dB, hi_dB, lo_dB]
  const IZOTOPE_2024 = [[22,-41.06,-31.69,-63.51],[22,-41.06,-31.69,-63.51],[32,-38.46,-29.12,-60.83],[43,-36.85,-28.1,-58.43],[54,-36.32,-28.02,-56.42],[65,-36.48,-28.43,-54.95],[86,-37.52,-29.71,-53.07],[108,-38.74,-31.04,-52.26],[129,-39.98,-32.4,-51.89],[172,-42.08,-35.14,-52.14],[215,-43.34,-36.38,-52.64],[280,-44.73,-37.8,-53.51],[345,-46.53,-39.7,-55.01],[441,-48.51,-41.65,-57.08],[560,-49.76,-42.78,-58.88],[711,-51.63,-44.65,-60.43],[904,-53.92,-47.15,-62.43],[1152,-56.29,-49.86,-64.5],[1453,-58.11,-52.06,-65.71],[1852,-59.79,-54.06,-66.96],[2347,-61.93,-56.57,-69.01],[2972,-63.81,-58.84,-70.83],[3779,-65.68,-60.91,-72.74],[4791,-67.84,-63.21,-74.85],[6083,-69.25,-64.23,-77.87],[7709,-69.88,-64.89,-79.4],[9787,-70.93,-65.97,-81.2],[12425,-75.17,-69.68,-84.64],[15762,-81.16,-75.32,-88.3],[20004,-86.22,-81.27,-91.21]]
  // Normalize: peak at 54hz (-36.32dB) maps to 0dB — subtract peak so all values become relative
  const IZOTOPE_PEAK_DB = Math.max(...IZOTOPE_2024.map(p => p[1]))  // -36.32
  function iZotopeNorm(db) { return db - IZOTOPE_PEAK_DB }

  // Dynamic Y-axis: include iZotope range only on FULL MIX tab (avoids squishing stem curves)
  const dbRange = $derived((() => {
    const mixVals = displayMix ? ISO_FREQS.filter(f => displayMix[String(f)] !== undefined).map(f => displayMix[String(f)]) : []
    const refVals = displayRef ? ISO_FREQS.filter(f => displayRef[String(f)] !== undefined).map(f => displayRef[String(f)]) : []
    const izVals = isMixTab ? IZOTOPE_2024.map(([,avg]) => iZotopeNorm(avg)) : []
    const all = [...mixVals, ...refVals, ...izVals].filter(v => isFinite(v))
    if (!all.length) return { min: -20, max: 20 }
    const dataMin = Math.min(...all)
    const dataMax = Math.max(...all)
    return {
      min: Math.max(Math.floor((dataMin - 3) / 5) * 5, -60),
      max: Math.min(Math.ceil((dataMax + 3) / 5) * 5, 30)
    }
  })())

  const DB_MIN = $derived(dbRange.min)
  const DB_MAX = $derived(dbRange.max)

  const gridDbs = $derived(
    Array.from({ length: Math.round((DB_MAX - DB_MIN) / 5) + 1 }, (_, i) => DB_MIN + i * 5)
  )

  // Unique clip-path ID per instance — prevents ID collision when multiple charts render
  const clipId = 'cc-' + Math.random().toString(36).slice(2, 7)

  let showIzotope = $state(true)

  function makeIzotopePath() {
    const pts = IZOTOPE_2024.map(([freq, avg]) => {
      const x = xForFreq(freq).toFixed(1)
      const y = yForDb(iZotopeNorm(avg)).toFixed(1)
      return `${x},${y}`
    })
    return 'M ' + pts.join(' L ')
  }

  function makeIzotopeRange() {
    const hiPts = IZOTOPE_2024.map(([freq,,hi]) => {
      const x = xForFreq(freq).toFixed(1)
      const y = yForDb(iZotopeNorm(hi)).toFixed(1)
      return `${x},${y}`
    })
    const loPts = [...IZOTOPE_2024].reverse().map(([freq,,,lo]) => {
      const x = xForFreq(freq).toFixed(1)
      const y = yForDb(iZotopeNorm(lo)).toFixed(1)
      return `${x},${y}`
    })
    return 'M ' + hiPts.join(' L ') + ' L ' + loPts.join(' L ') + ' Z'
  }
</script>

<div class="eq-wrap">
  <svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" class="eq-svg">
    <defs>
      <clipPath id={clipId}>
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

    <!-- iZotope range band + avg line — only on FULL MIX tab -->
    {#if isMixTab && showIzotope}
      <path d={makeIzotopeRange()} fill="rgba(255,255,255,0.04)" stroke="none" clip-path="url(#{clipId})" />
      <path d={makeIzotopePath()} fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,4" clip-path="url(#{clipId})" />
    {/if}

    <!-- Reference curve (behind mix) — gold -->
    {#if displayRef}
      <polygon points={curveToArea(displayRef)} fill="rgba(201,168,76,0.05)" clip-path="url(#{clipId})" />
      <polyline points={curveToPoints(displayRef)} fill="none" stroke={REF_COLOR} stroke-width="1.5"
        stroke-linejoin="round" stroke-linecap="round" opacity="0.7" clip-path="url(#{clipId})" />
    {/if}

    <!-- Mix curve (on top) — bright white -->
    {#if displayMix}
      <polygon points={curveToArea(displayMix)} fill="rgba(255,255,255,0.03)" clip-path="url(#{clipId})" />
      <polyline points={curveToPoints(displayMix)} fill="none" stroke={MIX_COLOR} stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" clip-path="url(#{clipId})" />
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
    {#if isMixTab && showIzotope}
      {@const izX = W - PAD_R - 114}
      <line x1={izX} y1={PAD_T + 8} x2={izX + 14} y2={PAD_T + 8} stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-dasharray="3,3" />
      <text x={izX + 18} y={PAD_T + 11.5} font-size="9" fill="rgba(255,255,255,0.3)" font-family="Space Mono, monospace">iZotope 2024</text>
    {/if}
  </svg>

  <div class="eq-controls">
    {#if isMixTab}
      <button
        class="izotope-toggle {showIzotope ? 'active' : ''}"
        onclick={() => showIzotope = !showIzotope}>
        iZ
      </button>
    {/if}
  </div>
</div>

<style>
  .eq-wrap { position: relative; }
  .eq-svg { width: 100%; height: auto; display: block; background: #080808; border-radius: 3px; }
  .eq-controls {
    display: flex;
    justify-content: flex-end;
    padding: 3px 0 0;
  }
  .izotope-toggle {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    background: transparent;
    border: 1px solid #252525;
    color: #333;
    padding: 1px 6px;
    border-radius: 2px;
    cursor: pointer;
  }
  .izotope-toggle.active {
    border-color: rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.3);
  }
</style>
