<script>
  import { onMount } from 'svelte'

  const SB_URL = 'https://ukqpnjgvjeduipmdaczn.supabase.co'
  const SB_KEY = 'sb_publishable_4yMwlAo6OLpgGPN_6yWvIw_g5bnjnWS'
  const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

  let { sessionId } = $props()

  let session    = $state(null)
  let loading    = $state(true)
  let notFound   = $state(false)
  let semitones  = $state(0)
  let audioEl    = $state(null)
  let feedback   = $state('')
  let fbSent     = $state(false)
  let fbSending  = $state(false)
  let stars      = $state([])

  // Pitch shift via playbackRate: each semitone = rate * 2^(1/12)
  $effect(() => {
    if (audioEl) audioEl.playbackRate = Math.pow(2, semitones / 12)
  })

  onMount(async () => {
    // Generate stars once
    stars = Array.from({ length: 140 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: Math.random() * 1.4 + 0.3,
      o: Math.random() * 0.6 + 0.2
    }))

    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/share_sessions?id=eq.${sessionId}&select=*`,
        { headers: sbH }
      )
      const rows = await r.json()
      if (!rows?.length) { notFound = true } else { session = rows[0] }
    } catch(e) { notFound = true }
    loading = false
  })

  // Build streamable URL from Dropbox share link (replace dl=0 → dl=1)
  function audioUrl(shareUrl) {
    if (!shareUrl) return null
    return shareUrl.replace('?dl=0', '?dl=1').replace('?dl=1&', '?dl=1&')
  }

  function semLabel(n) {
    if (n === 0) return '0'
    return n > 0 ? '+' + n : String(n)
  }

  function shiftDown() { semitones = Math.max(-3, semitones - 1) }
  function shiftUp()   { semitones = Math.min(3, semitones + 1) }
  function shiftReset() { semitones = 0 }

  async function submitFeedback() {
    if (!feedback.trim() || !session) return
    fbSending = true
    try {
      const existing = Array.isArray(session.feedback) ? session.feedback : []
      const updated = [...existing, { text: feedback.trim(), created_at: new Date().toISOString() }]
      await fetch(`${SB_URL}/rest/v1/share_sessions?id=eq.${sessionId}`, {
        method: 'PATCH',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ feedback: updated })
      })
      fbSent = true
      feedback = ''
    } catch(e) {}
    fbSending = false
  }

  // Derive display info from session
  const song       = $derived(session?.songs?.[0])
  const mp3Src     = $derived(song?.mp3ShareUrl ? audioUrl(song.mp3ShareUrl) : null)
  const wavSrc     = $derived(song?.shareUrl ? audioUrl(song.shareUrl) : null)
  const previewSrc = $derived(song?.previewUrl || null)
  const hasBg      = $derived(session?.background === 'stars')
  const typeLabel  = $derived({
    production: 'PRODUCTION', mixing: 'MIX', demo: 'DEMO',
    instrumental: 'INSTRUMENTAL', stems: 'STEMS'
  }[session?.session_type] || '')
  // Public filename — strips internal code prefix for download button label
  const publicWavName  = $derived(song?.public_filename || (song?.filename || '').replace(/^\d{8}_/, '') || null)
  const publicMp3Name  = $derived(publicWavName ? publicWavName.replace(/\.wav$/i, '.mp3') : null)
</script>

<div class="lp-wrap" class:stars-bg={hasBg}>
  {#if hasBg}
    <svg class="stars-svg" aria-hidden="true">
      {#each stars as s}
        <circle cx="{s.x}%" cy="{s.y}%" r="{s.r}" fill="white" opacity="{s.o}" />
      {/each}
    </svg>
  {/if}

  <div class="lp-card">
    {#if loading}
      <div class="lp-loading">Loading…</div>

    {:else if notFound || !session}
      <div class="lp-not-found">
        <div class="lp-nf-title">Link not found</div>
        <div class="lp-nf-sub">This link may have expired or been removed.</div>
      </div>

    {:else}
      <!-- Header -->
      <div class="lp-header">
        {#if typeLabel}
          <span class="lp-type-badge">{typeLabel}</span>
        {/if}
        <div class="lp-patch-name">{session.patch_name || 'Untitled'}</div>
        {#if song?.title && song.title !== session.patch_name}
          <div class="lp-song-title">{song.title}</div>
        {/if}
      </div>

      <!-- Player -->
      {#if mp3Src || wavSrc || previewSrc}
        <div class="lp-player-wrap">
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio
            bind:this={audioEl}
            controls
            preload="metadata"
            class="lp-audio"
          >
            {#if mp3Src}<source src={mp3Src} type="audio/mpeg">{/if}
            {#if wavSrc}<source src={wavSrc} type="audio/wav">{/if}
            {#if previewSrc}<source src={previewSrc} type="audio/mpeg">{/if}
          </audio>

          <!-- Pitch shift controls -->
          <div class="lp-pitch-row">
            <span class="lp-pitch-label">PITCH</span>
            <button class="lp-pitch-btn" onclick={shiftDown} disabled={semitones <= -3}>−</button>
            <button
              class="lp-pitch-val"
              ondblclick={shiftReset}
              title="Double-click to reset"
            >{semLabel(semitones)}</button>
            <button class="lp-pitch-btn" onclick={shiftUp} disabled={semitones >= 3}>+</button>
            {#if semitones !== 0}
              <span class="lp-pitch-hint">semitones · tempo shifts with pitch</span>
            {:else}
              <span class="lp-pitch-hint">semitones</span>
            {/if}
          </div>
        </div>
      {:else}
        <div class="lp-no-audio">No audio available for streaming.</div>
      {/if}

      <!-- Feedback -->
      {#if session.feedback_enabled}
        <div class="lp-feedback-wrap">
          <div class="lp-feedback-label">FEEDBACK</div>
          {#if fbSent}
            <div class="lp-fb-thanks">Feedback sent — thanks!</div>
          {:else}
            <textarea
              class="lp-fb-ta"
              bind:value={feedback}
              placeholder="Leave feedback on this version…"
              rows="4"
            ></textarea>
            <button
              class="lp-fb-btn"
              onclick={submitFeedback}
              disabled={fbSending || !feedback.trim()}
            >{fbSending ? 'Sending…' : 'Send Feedback'}</button>
          {/if}
        </div>
      {/if}

      <!-- Download -->
      {#if wavSrc}
        <div class="lp-download-row">
          {#if mp3Src}
            <a class="lp-dl-link" href={mp3Src} download={publicMp3Name || true}>↓ Download MP3</a>
          {/if}
          <a class="lp-dl-link" href={wavSrc} download={publicWavName || true}>↓ Download WAV</a>
        </div>
        {#if publicWavName}
          <div class="lp-dl-filename">{publicWavName}</div>
        {/if}
      {/if}

      <div class="lp-footer">Momentum Music</div>
    {/if}
  </div>
</div>

<style>
  /* ── Layout ─────────────────────────────────────────────────────────── */
  .lp-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0a;
    position: relative;
    overflow: hidden;
    padding: 32px 16px;
  }
  .stars-bg { background: #050508; }
  .stars-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ── Card ────────────────────────────────────────────────────────────── */
  .lp-card {
    position: relative;
    z-index: 1;
    background: rgba(28,28,28,.92);
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 36px 32px 28px;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    backdrop-filter: blur(8px);
  }

  /* ── Loading / not-found ─────────────────────────────────────────────── */
  .lp-loading, .lp-no-audio {
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    color: #555;
    text-align: center;
    padding: 24px 0;
  }
  .lp-not-found { text-align: center; padding: 24px 0; }
  .lp-nf-title { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; color: #9e9690; margin-bottom: 8px; }
  .lp-nf-sub { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .lp-header { display: flex; flex-direction: column; gap: 6px; }
  .lp-type-badge {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .14em;
    color: rgba(201,168,76,.6);
    align-self: flex-start;
  }
  .lp-patch-name {
    font-family: 'Space Mono', monospace;
    font-size: 17px;
    font-weight: 700;
    color: #c9a84c;
    line-height: 1.3;
  }
  .lp-song-title {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    color: #9e9690;
    font-weight: 300;
  }

  /* ── Player ──────────────────────────────────────────────────────────── */
  .lp-player-wrap { display: flex; flex-direction: column; gap: 12px; }
  .lp-audio {
    width: 100%;
    height: 36px;
    accent-color: #c9a84c;
  }

  /* Pitch shift row */
  .lp-pitch-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .lp-pitch-label {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .12em;
    color: #555;
    margin-right: 4px;
  }
  .lp-pitch-btn {
    width: 28px;
    height: 26px;
    font-family: 'Space Mono', monospace;
    font-size: 14px;
    font-weight: 700;
    background: #1c1c1c;
    border: 1px solid #303030;
    color: #c9a84c;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1;
    padding: 0;
    transition: all .1s;
    flex-shrink: 0;
  }
  .lp-pitch-btn:hover:not(:disabled) { background: #252525; border-color: #c9a84c; }
  .lp-pitch-btn:disabled { opacity: .3; cursor: default; }
  .lp-pitch-val {
    width: 28px;
    height: 26px;
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    background: #1c1c1c;
    border: 1px solid #303030;
    color: #c9a84c;
    border-radius: 3px;
    cursor: pointer;
    text-align: center;
    padding: 0;
    transition: all .1s;
    flex-shrink: 0;
  }
  .lp-pitch-val:hover { border-color: rgba(201,168,76,.5); }
  .lp-pitch-hint {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: #404040;
    margin-left: 4px;
  }

  /* ── Feedback ────────────────────────────────────────────────────────── */
  .lp-feedback-wrap { display: flex; flex-direction: column; gap: 8px; }
  .lp-feedback-label {
    font-family: 'Space Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .12em;
    color: rgba(201,168,76,.5);
  }
  .lp-fb-ta {
    width: 100%;
    background: #0d0d0d;
    border: 1px solid #252525;
    color: #f5f1ea;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    font-weight: 300;
    padding: 10px 12px;
    border-radius: 3px;
    resize: vertical;
    outline: none;
    line-height: 1.5;
  }
  .lp-fb-ta:focus { border-color: rgba(201,168,76,.3); }
  .lp-fb-btn {
    align-self: flex-start;
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 8px 18px;
    background: #c9a84c;
    color: #0a0a0a;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    letter-spacing: .06em;
    transition: opacity .15s;
  }
  .lp-fb-btn:disabled { opacity: .4; cursor: default; }
  .lp-fb-btn:hover:not(:disabled) { opacity: .88; }
  .lp-fb-thanks {
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    color: #4caf82;
    padding: 8px 0;
  }

  /* ── Download ────────────────────────────────────────────────────────── */
  .lp-download-row { display: flex; gap: 12px; }
  .lp-dl-link {
    font-family: 'Space Mono', monospace;
    font-size: 10px;
    color: #555;
    text-decoration: none;
    letter-spacing: .06em;
    transition: color .15s;
  }
  .lp-dl-link:hover { color: #9e9690; }
  .lp-dl-filename { font-family: 'Space Mono', monospace; font-size: 8px; color: #333; margin-top: 4px; letter-spacing: .04em; word-break: break-all; }

  /* ── Footer ──────────────────────────────────────────────────────────── */
  .lp-footer {
    font-family: 'Space Mono', monospace;
    font-size: 8px;
    color: #2a2a2a;
    text-align: center;
    letter-spacing: .14em;
    text-transform: uppercase;
  }
</style>
