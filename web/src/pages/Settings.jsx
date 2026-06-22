import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, Plus, Trash2, X, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function Settings() {
  const [holidays, setHolidays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [hForm, setHForm] = useState({ name: '', holiday_date: '', type: 'public' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [{ data: h }, { data: e }] = await Promise.all([
      supabase.from('holidays').select('*').order('holiday_date'),
      supabase.from('employees').select('enroll_number, name').eq('is_deleted', false).order('name'),
    ]);
    setHolidays(h || []); setEmployees(e || []);
  }

  async function addHoliday() {
    await supabase.from('holidays').insert(hForm);
    setShowHolidayModal(false); setHForm({ name: '', holiday_date: '', type: 'public' }); fetchAll();
  }

  async function deleteHoliday(id) { await supabase.from('holidays').delete().eq('id', id); fetchAll(); }

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div><h2 className="page-title">Settings</h2><p className="page-subtitle">System configuration</p></div>
      </div></div>
      <div className="page-body">

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
