-- phantom_settings: generic key/value store for app settings
create table if not exists phantom_settings (
  key   text primary key,
  value text not null
);

-- Allow anon read/write (same pattern as other phantom_* tables)
alter table phantom_settings enable row level security;
create policy "anon all" on phantom_settings for all to anon using (true) with check (true);

-- Seed default withdrawal goal
insert into phantom_settings (key, value)
values ('withdrawal_goal', '1000')
on conflict (key) do nothing;
