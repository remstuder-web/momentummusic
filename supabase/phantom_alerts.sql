-- phantom_alerts: trading bot events + manual alerts
-- Bot writes here on: circuit_breaker, safety_monitor, regime_change, equity_drawdown
create table if not exists phantom_alerts (
  id         uuid        default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  message    text        not null,
  type       text        default 'manual',
  dismissed  boolean     default false
);

alter table phantom_alerts enable row level security;
create policy "anon all" on phantom_alerts for all to anon using (true) with check (true);
