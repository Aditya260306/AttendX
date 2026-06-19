-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 005_employee_archive_log
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Tracks when employees are removed from devices / deactivated.
-- The employee row stays in `employees` (soft-deleted via is_active=false).
-- Raw punches stay in `raw_punches` for historical reports.
-- This table is the audit trail only.

CREATE TABLE IF NOT EXISTS public.employee_archive_log (
  id              BIGSERIAL PRIMARY KEY,
  enroll_number   BIGINT       NOT NULL,
  employee_name   VARCHAR(200),
  action          VARCHAR(50)  NOT NULL,  -- 'removed_from_device' | 'deactivated' | 'deleted_from_all_devices'
  device_id       BIGINT,
  device_name     VARCHAR(100),
  reason          TEXT,
  performed_by    TEXT         DEFAULT 'dashboard',
  archived_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_archive_log_enroll ON public.employee_archive_log (enroll_number);
CREATE INDEX idx_archive_log_time ON public.employee_archive_log (archived_at DESC);

-- RLS
ALTER TABLE public.employee_archive_log ENABLE ROW LEVEL SECURITY;

-- Anon policies (matches existing pattern)
CREATE POLICY "Anon can read employee_archive_log"
  ON public.employee_archive_log FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert employee_archive_log"
  ON public.employee_archive_log FOR INSERT TO anon WITH CHECK (true);

-- Service role (agent) gets full access via bypass
COMMENT ON TABLE public.employee_archive_log IS 'Audit trail for employee removals/deactivations. Employees are soft-deleted (is_active=false), never hard-deleted.';
