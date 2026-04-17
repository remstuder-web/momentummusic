<script>
  import { supabase } from './supabase.js'

  let archivedProjects = $state([])
  let loading = $state(true)

  let sorted = $derived(
    archivedProjects.slice().sort((a,b) => (a.artist||a.name).localeCompare(b.artist||b.name))
  )

  async function load() {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, artist, color, archived_at, position')
      .eq('status', 'archived')
    if (error) { console.error('Archive load error:', error); loading = false; return }
    archivedProjects = (data || []).sort((a,b) => {
      const da = a.archived_at || '', db = b.archived_at || ''
      return db.localeCompare(da)
    })
    loading = false
  }

  async function revive(p) {
    await supabase.from('projects').update({ status: 'active', archived_at: null }).eq('id', p.id)
    archivedProjects = archivedProjects.filter(x => x.id !== p.id)
  }

  async function deleteForever(p) {
    if (!confirm('Permanently delete "' + p.name + '"? This cannot be undone.')) return
    await supabase.from('songs').delete().eq('project_id', p.id)
    await supabase.from('projects').delete().eq('id', p.id)
    archivedProjects = archivedProjects.filter(x => x.id !== p.id)
  }

  load()
</script>

<div class="header">
  <div class="sh">Archive</div>
  {#if !loading}
    <span class="count">{archivedProjects.length} project{archivedProjects.length !== 1 ? 's' : ''}</span>
  {/if}
</div>

{#if loading}
  <p class="empty">Loading...</p>
{:else if !archivedProjects.length}
  <p class="empty">No archived projects yet.</p>
{:else}
  <div class="list">
    {#each sorted as p}
      <div class="proj-row">
        <div class="proj-dot" style="background:{p.color}"></div>
        <div class="proj-info">
          <span class="proj-name">{p.name}</span>
          {#if p.artist}<span class="proj-artist">/ {p.artist}</span>{/if}
          {#if p.archived_at}
            <span class="proj-date">archived {new Date(p.archived_at).toLocaleDateString('de-CH', { day:'2-digit', month:'2-digit', year:'2-digit' })}</span>
          {/if}
        </div>
        <div class="proj-btns">
          <button class="btn-revive" onclick={() => revive(p)}>↑ Revive</button>
          <button class="btn-delete" onclick={() => deleteForever(p)}>Delete</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .sh { font-family: 'Space Mono', monospace; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: rgba(201,168,76,.75); }
  .count { font-family: 'Space Mono', monospace; font-size: 11px; color: #555; }
  .empty { font-family: 'Space Mono', monospace; font-size: 13px; color: #555; padding: 40px 0; text-align: center; }
  .list { display: flex; flex-direction: column; gap: 6px; }
  .proj-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; background: #1c1c1c; border: 1px solid #252525; border-radius: 4px; transition: border-color .15s; }
  .proj-row:hover { border-color: #303030; }
  .proj-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .proj-info { display: flex; align-items: center; gap: 10px; flex: 1; flex-wrap: wrap; }
  .proj-name { font-family: 'Space Mono', monospace; font-size: 15px; font-weight: 700; color: #cec9c1; }
  .proj-artist { font-size: 13px; color: #555; }
  .proj-date { font-family: 'Space Mono', monospace; font-size: 11px; color: #444; margin-left: auto; }
  .proj-btns { display: flex; gap: 8px; flex-shrink: 0; }
  .btn-revive { font-family: 'Space Mono', monospace; font-size: 12px; font-weight: 700; letter-spacing: .08em; padding: 7px 16px; border: 1px solid rgba(76,175,130,.4); color: #4caf82; background: transparent; cursor: pointer; border-radius: 3px; transition: background .15s; }
  .btn-revive:hover { background: rgba(76,175,130,.08); }
  .btn-delete { font-family: 'Space Mono', monospace; font-size: 11px; padding: 7px 12px; border: 1px solid rgba(224,90,74,.25); color: #e05a4a; background: transparent; cursor: pointer; border-radius: 3px; transition: background .15s; }
  .btn-delete:hover { background: rgba(224,90,74,.08); }
</style>