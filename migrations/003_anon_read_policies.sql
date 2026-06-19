-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUPABASE SQL EDITOR NAME: 003_anon_read_policies
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Temporary: Allow anon key to read data until auth is added.
-- Also allow anon to insert commands and manage employees/settings.

-- READ policies for anon
CREATE POLICY "Anon can read devices" ON public.devices FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read employees" ON public.employees FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read raw_punches" ON public.raw_punches FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read daily_attendance" ON public.daily_attendance FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read attendance_rules" ON public.attendance_rules FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read holidays" ON public.holidays FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read device_commands" ON public.device_commands FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read agent_heartbeat" ON public.agent_heartbeat FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read sync_history" ON public.sync_history FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read audit_log" ON public.audit_log FOR SELECT TO anon USING (true);

-- WRITE policies for anon (dashboard operations)
CREATE POLICY "Anon can insert device_commands" ON public.device_commands FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can manage employees" ON public.employees FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can update attendance_rules" ON public.attendance_rules FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage holidays" ON public.holidays FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can manage devices" ON public.devices FOR ALL TO anon USING (true) WITH CHECK (true);
