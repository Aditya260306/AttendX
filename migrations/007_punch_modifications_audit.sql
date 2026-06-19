-- Tracks every manual punch modification for audit trail
CREATE TABLE IF NOT EXISTS punch_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enroll_number INTEGER NOT NULL REFERENCES employees(enroll_number) ON DELETE CASCADE,
  punch_date DATE NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('modify', 'mark_present', 'mark_absent', 'restore')),
  original_in_time TEXT,    -- HH:mm:ss or null
  original_out_time TEXT,   -- HH:mm:ss or null
  new_in_time TEXT,         -- HH:mm:ss or null
  new_out_time TEXT,        -- HH:mm:ss or null
  modified_by TEXT NOT NULL DEFAULT 'admin',
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- Index for quick lookups by employee + date
CREATE INDEX IF NOT EXISTS idx_punch_mods_lookup ON punch_modifications(enroll_number, punch_date);

-- Allow full access for now (auth will be added later)
ALTER TABLE punch_modifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all punch_modifications" ON punch_modifications FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
