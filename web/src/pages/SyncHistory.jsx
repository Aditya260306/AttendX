import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function SyncHistory() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchLogs(); }, []);

  async function fetchLogs() {
    setLoading(true);
    const { data } = await supabase.from('sync_history').select('*').order('created_at', { ascending: false }).limit(100);
    setLogs(data || []);
    setLoading(false);
  }

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div><h2 className="page-title">Sync History</h2><p className="page-subtitle">Last 100 sync events</p></div>
      </div></div>
      <div className="page-body">
        <motion.div className="card" {...fadeUp()}>
          {loading ? <div className="card-body">{[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 34, marginBottom: 5 }} />)}</div>
          : logs.length === 0 ? <div className="empty-state"><History className="icon" /><p className="message">No sync history</p></div>
          : <table className="data-table"><thead><tr><th>Time</th><th>Device</th><th>Action</th><th>Records</th><th>Status</th><th>Message</th></tr></thead>
            <tbody><AnimatePresence>{logs.map((l, i) => (
              <motion.tr key={l.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}>
                <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.76rem' }}>{format(new Date(l.created_at), 'MMM dd, HH:mm:ss')}</td>
                <td style={{ color: 'var(--text)', fontWeight: 500 }}>{l.device_name || `#${l.device_id}`}</td>
                <td><span className="badge purple">{l.action}</span></td>
                <td style={{ fontWeight: 600 }}>{l.records_count ?? '—'}</td>
                <td><span className={`badge ${l.status === 'success' ? 'green' : 'red'}`}>{l.status === 'success' && <CheckCircle2 size={10} />}{l.status === 'error' && <AlertCircle size={10} />}{l.status}</span></td>
                <td style={{ fontSize: '0.75rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.message || '—'}</td>
              </motion.tr>
            ))}</AnimatePresence></tbody></table>}
        </motion.div>
      </div>
    </>
  );
}
