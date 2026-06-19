-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 009_cleanup
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Removes unused tables/columns and adds gatekeeper support.
-- Safe to run on an existing database.

-- ─── 1. Drop audit_log (never written to by any code) ───────────
DROP TABLE IF EXISTS public.audit_log;

-- ─── 2. Drop unused overtime columns from daily_attendance ───────
ALTER TABLE public.daily_attendance
  DROP COLUMN IF EXISTS is_overtime,
  DROP COLUMN IF EXISTS ot_hours;

-- ─── 3. Drop unused overtime column from attendance_rules ────────
ALTER TABLE public.attendance_rules
  DROP COLUMN IF EXISTS overtime_trigger_mins;

-- ─── 4. Add gatekeeper settings to attendance_rules ──────────────
ALTER TABLE public.attendance_rules
  ADD COLUMN IF NOT EXISTS gatekeeper_enabled   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gatekeeper_enroll_number BIGINT;

-- Foreign key (soft — only applied if employees table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_gatekeeper_enroll'
  ) THEN
    ALTER TABLE public.attendance_rules
      ADD CONSTRAINT fk_gatekeeper_enroll
      FOREIGN KEY (gatekeeper_enroll_number)
      REFERENCES public.employees(enroll_number)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 5. Faster gatekeeper punch lookup ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_raw_punches_enroll_time
  ON public.raw_punches (enroll_number, punch_time DESC);

-- ─── 6. Document daily_attendance.status valid values ────────────
COMMENT ON COLUMN public.daily_attendance.status IS
  'Valid: Present | Present (No Out) | Absent | Half Day | Weekend | Holiday | Leave';
