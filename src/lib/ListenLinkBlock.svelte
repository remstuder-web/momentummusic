<script>
  // Shared listen-page background picker + generate-link block.
  // Full mode  (default)       — DemoTab: label + gold pills + generate button
  // Compact mode (compact=true) — ProjectsTab: green pills inline (no label/button)
  let {
    sessionId      = null,
    sessionType    = 'demo',
    backgroundStyle = $bindable('stars'),
    feedbackEnabled = true,
    stemsOnly      = false,
    // extra props consumed by parents
    ongenerate     = null,   // () => void — shown as ↗ Generate Link in full mode
    compact        = false,  // true = green pills only, for inline ProjectsTab rows
    showLabels     = false,  // compact only: show '✦ Stars' vs just '✦'
  } = $props()

  const BG_OPTIONS = [
    { id: 'stars', label: '✦ Stars', short: '✦', desc: 'Hyperspace' },
    { id: 'void',  label: '○ Void',  short: '○', desc: 'Pure black' },
  ]
</script>

{#if compact}
  <!-- ProjectsTab green-pill variant — renders inline within send rows -->
  <div class="llb-compact">
    {#each BG_OPTIONS as bg}
      <button
        class="bg-pill-green {backgroundStyle === bg.id ? 'on' : ''}"
        onclick={() => backgroundStyle = bg.id}
        title={bg.desc}
      >{showLabels ? bg.label : bg.short}</button>
    {/each}
  </div>
{:else}
  <!-- DemoTab full-block variant -->
  <div class="bg-inline-row">
    <div class="bg-inline-label">LISTEN PAGE BG</div>
    <div class="bg-pills">
      {#each BG_OPTIONS as bg}
        <button
          class="bg-pill {backgroundStyle === bg.id ? 'on' : ''}"
          onclick={() => backgroundStyle = bg.id}
          title={bg.desc}
        >{bg.label}</button>
      {/each}
    </div>
    {#if ongenerate}
      <button class="btn-generate-link" onclick={e => { e.stopPropagation(); ongenerate() }}>↗ Generate Link</button>
    {/if}
  </div>
{/if}

<style>
  /* ── Full mode (DemoTab gold) ─────────────────────────────────────── */
  .bg-inline-row { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 6px; border-top: 1px solid transparent; margin-top: 6px; background: var(--chip-bg)}
  .bg-inline-label { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .1em; color: var(--text-mid); }
  .bg-pills { display: flex; flex-wrap: wrap; gap: 5px; }
  .bg-pill { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .06em; padding: 4px 9px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-dim); border-radius: 2px; cursor: pointer; transition: all .15s; }
  .bg-pill:hover { border-color: var(--border2); color: var(--text-mid); }
  .bg-pill.on { border-color: var(--accent-dim); color: var(--accent); background: var(--accent-a06); }
  .btn-generate-link { font-family: 'Space Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: .08em; padding: 7px 14px; background: var(--chip-bg); border: 1px solid transparent; color: var(--text-mid); border-radius: 3px; cursor: pointer; align-self: flex-start; transition: all .15s; }
  .btn-generate-link:hover { background: rgba(255,255,255,.06); border-color: var(--border2); }

  /* ── Compact mode (ProjectsTab green) ────────────────────────────── */
  .llb-compact { display: flex; gap: 4px; }
  .bg-pill-green { font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 500; letter-spacing: .06em; padding: 4px 9px; background: transparent; border: 1px solid rgba(76,175,130,.25); color: rgba(76,175,130,.5); border-radius: 2px; cursor: pointer; transition: all .15s; }
  .bg-pill-green:hover { border-color: rgba(76,175,130,.5); color: rgba(76,175,130,.8); }
  .bg-pill-green.on { border-color: #4caf82; color: #4caf82; background: rgba(76,175,130,.08); }
</style>
