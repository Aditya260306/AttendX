-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 004_device_users_table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Maps which users exist on which devices (many-to-many)
-- Tracks the UID slot on each device separately from the employee enroll_number

CREATE TABLE IF NOT EXISTS public.device_users (
  id BIGSERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  enroll_number INTEGER NOT NULL,
  device_uid INTEGER NOT NULL,
  name TEXT,
  privilege INTEGER DEFAULT 0,
  card_number TEXT DEFAULT '0',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (device_id, enroll_number)
);

ALTER TABLE public.device_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon full access device_users" ON public.device_users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access device_users" ON public.device_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access device_users" ON public.device_users FOR ALL TO service_role USING (true) WITH CHECK (true);
