-- phantom_deposits: track capital added to the PHANTOM trading account
create table if not exists phantom_deposits (
  id           bigint generated always as identity primary key,
  amount       numeric(12, 2) not null,
  deposited_at timestamptz    not null default now(),
  notes        text
);

-- Initial deposit
insert into phantom_deposits (amount, deposited_at, notes)
values (591.98, '2026-05-01 00:00:00+00', 'Initial deposit');

-- Allow anon read/write (same pattern as other phantom_* tables)
alter table phantom_deposits enable row level security;
create policy "anon all" on phantom_deposits for all to anon using (true) with check (true);
