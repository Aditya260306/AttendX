import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchLogs(); }, []);

  async function fetchLogs() {
    setLoading(true);
    const { data } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100);
    setLogs(data || []);
    setLoading(false);
  }

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div><h2 className="page-title">Audit Log</h2><p className="page-subtitle">System activity trail</p></div>
      </div></div>
      <div className="page-body">
        <motion.div className="card" {...fadeUp()}>
          {loading ? <div className="card-body">{[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 34, marginBottom: 5 }} />)}</div>
          : logs.length === 0 ? <div className="empty-state"><FileText className="icon" /><p className="message">No audit entries</p></div>
          : <table className="data-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody><AnimatePresence>{logs.map((l, i) => (
              <motion.tr key={l.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}>
                <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.76rem' }}>{format(new Date(l.created_at), 'MMM dd, HH:mm')}</td>
                <td>{l.user_email || 'system'}</td>
                <td><span className="badge blue">{l.action}</span></td>
                <td style={{ fontWeight: 500 }}>{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                <td style={{ fontSize: '0.75rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.new_value ? JSON.stringify(l.new_value).slice(0, 80) : '—'}</td>
              </motion.tr>
            ))}</AnimatePresence></tbody></table>}
        </motion.div>
      </div>
    </>
  );
}
