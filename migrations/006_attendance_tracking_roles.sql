-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 006_attendance_tracking_roles
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Adds per-employee attendance tracking flag and per-device purpose.
--
-- track_attendance (employees): false for owners/IT who don't need attendance
-- primary_device_id (employees): the device where attendance is tracked
-- purpose (device_users): 'attendance' | 'admin_only'
--   - attendance: punches count toward daily attendance
--   - admin_only: user is on this device for management (enroll users, etc.)
--                 punches are still logged as access events for audit

-- 1. Add track_attendance to employees (default true for existing workers)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS track_attendance BOOLEAN DEFAULT true;

-- 2. Add primary_device_id to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS primary_device_id INTEGER REFERENCES public.devices(id);

-- 3. Add purpose to device_users (default 'attendance' for existing records)
ALTER TABLE public.device_users
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) DEFAULT 'attendance'
  CHECK (purpose IN ('attendance', 'admin_only'));

-- Update comment
COMMENT ON COLUMN public.employees.track_attendance IS 'false = owner/IT staff who dont need attendance, only access logging';
COMMENT ON COLUMN public.employees.primary_device_id IS 'The device where this employees attendance is tracked';
COMMENT ON COLUMN public.device_users.purpose IS 'attendance = punches count for daily attendance; admin_only = access logged but no attendance';
