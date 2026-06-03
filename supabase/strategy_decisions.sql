-- strategy_decisions: pending strategy reviews surfaced by agents or manually entered
CREATE TABLE IF NOT EXISTS strategy_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  title         text NOT NULL,
  summary       text,
  recommendation text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('weekly_scan','monday_brief','manual'))
);

-- enable realtime
ALTER TABLE strategy_decisions REPLICA IDENTITY FULL;
