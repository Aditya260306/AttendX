-- 008_employee_extended_profile.sql
-- Adds personal, contact, and bank columns to employees table

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS father_name       varchar(100),
  ADD COLUMN IF NOT EXISTS date_of_birth     date,
  ADD COLUMN IF NOT EXISTS gender            varchar(10),
  ADD COLUMN IF NOT EXISTS blood_group       varchar(5),
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS current_address   text,
  ADD COLUMN IF NOT EXISTS bank_account_no   varchar(20),
  ADD COLUMN IF NOT EXISTS bank_ifsc         varchar(15),
  ADD COLUMN IF NOT EXISTS bank_name         varchar(100);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_is_active   ON employees(is_active);
