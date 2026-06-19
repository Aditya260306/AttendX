import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, Plus, Trash2, X, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function Settings() {
  const [rules, setRules] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [hForm, setHForm] = useState({ name: '', holiday_date: '', type: 'public' });
  const [saving, setSaving] = useState(false);
  const [savingGk, setSavingGk] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [{ data: r }, { data: h }, { data: e }] = await Promise.all([
      supabase.from('attendance_rules').select('*').single(),
      supabase.from('holidays').select('*').order('holiday_date'),
      supabase.from('employees').select('enroll_number, name').eq('is_active', true).order('name'),
    ]);
    setRules(r); setHolidays(h || []); setEmployees(e || []);
  }

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    // exclude gatekeeper fields from rules save (saved separately)
    const { gatekeeper_enabled, gatekeeper_enroll_number, ...coreRules } = rules;
    await supabase.from('attendance_rules').update(coreRules).eq('id', rules.id);
    setSaving(false);
  }

  async function saveGatekeeper() {
    if (!rules) return;
    setSavingGk(true);
    await supabase.from('attendance_rules').update({
      gatekeeper_enabled: rules.gatekeeper_enabled,
      gatekeeper_enroll_number: rules.gatekeeper_enroll_number || null,
    }).eq('id', rules.id);
    setSavingGk(false);
  }

  async function addHoliday() {
    await supabase.from('holidays').insert(hForm);
    setShowHolidayModal(false); setHForm({ name: '', holiday_date: '', type: 'public' }); fetchAll();
  }

  async function deleteHoliday(id) { await supabase.from('holidays').delete().eq('id', id); fetchAll(); }

  if (!rules) return <div className="page-body"><div className="skeleton" style={{ height: 280, borderRadius: 10 }} /></div>;

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div><h2 className="page-title">Settings</h2><p className="page-subtitle">Attendance rules and configuration</p></div>
        <motion.button className="btn btn-primary" onClick={saveRules} disabled={saving} whileTap={{ scale: 0.96 }}>
          <Save size={13} />{saving ? 'Saving...' : 'Save Changes'}
        </motion.button>
      </div></div>
      <div className="page-body">
        <motion.div className="grid-2" style={{ marginBottom: 16 }} {...fadeUp()}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Company</h3></div>
            <div className="card-body">
              <div className="input-group"><label>Company Name</label><input className="input" value={rules.company_name || ''} onChange={e => setRules({ ...rules, company_name: e.target.value })} /></div>
              <div className="grid-2">
                <div className="input-group"><label>Default Shift Start</label><input className="input" type="time" value={rules.shift_start?.slice(0, 5) || '09:00'} onChange={e => setRules({ ...rules, shift_start: e.target.value + ':00' })} /></div>
                <div className="input-group"><label>Default Shift End</label><input className="input" type="time" value={rules.shift_end?.slice(0, 5) || '18:00'} onChange={e => setRules({ ...rules, shift_end: e.target.value + ':00' })} /></div>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Rules</h3></div>
            <div className="card-body">
              <div className="input-group"><label>Grace Period (minutes)</label><input className="input" type="number" value={rules.grace_period_mins || 15} onChange={e => setRules({ ...rules, grace_period_mins: parseInt(e.target.value) })} /></div>
              <div className="input-group"><label>Half Day Threshold (hours)</label><input className="input" type="number" step="0.5" value={rules.half_day_threshold_hrs || 4.5} onChange={e => setRules({ ...rules, half_day_threshold_hrs: parseFloat(e.target.value) })} /></div>
            </div>
          </div>
        </motion.div>

        {/* Gatekeeper Control */}
        <motion.div className="card" style={{ marginBottom: 16 }} {...fadeUp(0.08)}>
          <div className="card-header">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={15} /> Gatekeeper Control</h3>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: 14 }}>When enabled, the dashboard locks until the selected employee punches in for the day. Syncs all devices automatically on unlock.</p>
            <div className="grid-2">
              <div className="input-group">
                <label>Gatekeeper Employee</label>
                <select className="input select" value={rules.gatekeeper_enroll_number || ''} onChange={e => setRules({ ...rules, gatekeeper_enroll_number: e.target.value ? parseInt(e.target.value) : null })}>
                  <option value="">— None —</option>
                  {employees.map(e => <option key={e.enroll_number} value={e.enroll_number}>{e.name} (#{e.enroll_number})</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>Enable Lockout</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <input type="checkbox" id="gk-toggle" checked={!!rules.gatekeeper_enabled} onChange={e => setRules({ ...rules, gatekeeper_enabled: e.target.checked })} style={{ width: 16, height: 16 }} />
                  <label htmlFor="gk-toggle" style={{ fontSize: '0.84rem', cursor: 'pointer' }}>{rules.gatekeeper_enabled ? 'Lockout Active' : 'Lockout Disabled'}</label>
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: '0 16px 14px', display: 'flex', justifyContent: 'flex-end' }}>
            <motion.button className="btn btn-primary" onClick={saveGatekeeper} disabled={savingGk} whileTap={{ scale: 0.96 }}>
              <Save size={13} />{savingGk ? 'Saving...' : 'Save Gatekeeper'}
            </motion.button>
          </div>
        </motion.div>

        {/* Holidays */}
        <motion.div className="card" {...fadeUp(0.12)}>
          <div className="card-header"><h3 className="card-title">Holidays</h3><motion.button className="btn btn-sm btn-primary" whileTap={{ scale: 0.96 }} onClick={() => setShowHolidayModal(true)}><Plus size={12} /> Add</motion.button></div>
          {holidays.length === 0 ? <div className="empty-state"><p className="message">No holidays configured</p></div>
          : <table className="data-table"><thead><tr><th>Date</th><th>Name</th><th>Type</th><th></th></tr></thead>
            <tbody>{holidays.map(h => (
              <tr key={h.id}>
                <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.78rem' }}>{format(new Date(h.holiday_date), 'dd MMM yyyy')}</td>
                <td style={{ color: 'var(--text)', fontWeight: 500 }}>{h.name}</td>
                <td><span className={`badge ${h.type === 'public' ? 'green' : 'orange'}`}>{h.type}</span></td>
                <td><motion.button className="btn btn-icon-sm btn-danger" whileTap={{ scale: 0.95 }} onClick={() => deleteHoliday(h.id)}><Trash2 size={12} /></motion.button></td>
              </tr>
            ))}</tbody></table>}
        </motion.div>
      </div>

      <AnimatePresence>
        {showHolidayModal && (
          <motion.div className="modal-overlay" onClick={() => setShowHolidayModal(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}>
              <div className="modal-header"><h3 className="modal-title">Add Holiday</h3><button className="btn btn-icon btn-secondary" onClick={() => setShowHolidayModal(false)}><X size={14} /></button></div>
              <div className="modal-body">
                <div className="input-group"><label>Date</label><input className="input" type="date" value={hForm.holiday_date} onChange={e => setHForm({ ...hForm, holiday_date: e.target.value })} /></div>
                <div className="input-group"><label>Holiday Name</label><input className="input" placeholder="e.g. Republic Day" value={hForm.name} onChange={e => setHForm({ ...hForm, name: e.target.value })} /></div>
                <div className="input-group"><label>Type</label><select className="input select" value={hForm.type} onChange={e => setHForm({ ...hForm, type: e.target.value })}><option value="public">Public</option><option value="optional">Optional</option></select></div>
              </div>
              <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowHolidayModal(false)}>Cancel</button><motion.button className="btn btn-primary" whileTap={{ scale: 0.96 }} onClick={addHoliday} disabled={!hForm.name || !hForm.holiday_date}>Add Holiday</motion.button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
