-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 002_enable_rls
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ╔══════════════════════════════════════════════════════════════╗
-- ║  AttendX — Migration 002: Enable RLS + Policies             ║
-- ║  Run this AFTER 001_create_tables.sql                       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Enable RLS on all tables
ALTER TABLE public.devices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_punches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_heartbeat  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- ─── Policy: Authenticated users can READ everything ────────────
-- (Fine-grained role filtering happens in the app layer)

CREATE POLICY "Authenticated users can read devices"
  ON public.devices FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read employees"
  ON public.employees FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read raw_punches"
  ON public.raw_punches FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read daily_attendance"
  ON public.daily_attendance FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read attendance_rules"
  ON public.attendance_rules FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read holidays"
  ON public.holidays FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read device_commands"
  ON public.device_commands FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read agent_heartbeat"
  ON public.agent_heartbeat FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read sync_history"
  ON public.sync_history FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can read audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated USING (true);

-- ─── Policy: Authenticated users can INSERT commands ────────────
CREATE POLICY "Authenticated users can create device_commands"
  ON public.device_commands FOR INSERT
  TO authenticated WITH CHECK (true);

-- ─── Policy: Authenticated users can manage employees ──────────
CREATE POLICY "Authenticated users can insert employees"
  ON public.employees FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update employees"
  ON public.employees FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete employees"
  ON public.employees FOR DELETE
  TO authenticated USING (true);

-- ─── Policy: Authenticated users can manage settings ────────────
CREATE POLICY "Authenticated users can update attendance_rules"
  ON public.attendance_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage holidays"
  ON public.holidays FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ─── Policy: Authenticated users can manage devices ─────────────
CREATE POLICY "Authenticated users can insert devices"
  ON public.devices FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update devices"
  ON public.devices FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete devices"
  ON public.devices FOR DELETE
  TO authenticated USING (true);

-- ─── Note: The agent uses service_role key which BYPASSES RLS ──
-- So the agent can write to raw_punches, daily_attendance,
-- agent_heartbeat, sync_history, and update device_commands
-- without needing explicit policies for those writes.
