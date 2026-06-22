import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Clock, CheckCircle, AlertTriangle, ArrowUpRight, Monitor, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (delay = 0) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay, ease: [0.25, 0.46, 0.45, 0.94] } });

export default function Dashboard() {
  const [stats, setStats] = useState({ totalEmployees: 0, presentToday: 0, absentToday: 0, lateToday: 0, totalPunches: 0 });
  const [devices, setDevices] = useState([]);
  const [recentPunches, setRecentPunches] = useState([]);
  const [recentSync, setRecentSync] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [{ count: empCount }, todayRes, { count: totalPunches }, devRes, punchRes, syncRes] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('raw_punches').select('enroll_number').gte('punch_time', format(new Date(), 'yyyy-MM-dd') + ' 00:00:00'),
        supabase.from('raw_punches').select('*', { count: 'exact', head: true }),
        supabase.from('devices').select('*').eq('is_active', true).order('id'),
        supabase.from('raw_punches').select('*, employees(name, department)').order('punch_time', { ascending: false }).limit(8),
        supabase.from('device_commands').select('*, devices(name)').order('created_at', { ascending: false }).limit(5),
      ]);
      const unique = new Set((todayRes.data || []).map(p => p.enroll_number));
      setStats({ totalEmployees: empCount || 0, presentToday: unique.size, absentToday: Math.max(0, (empCount || 0) - unique.size), lateToday: 0, totalPunches: totalPunches || 0 });
      setDevices(devRes.data || []);
      setRecentPunches(punchRes.data || []);
      setRecentSync(syncRes.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Subscribe to key tables for live dashboard updates
    const channel = supabase.channel('dashboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_punches' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_commands' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  const statCards = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'purple' },
    { label: 'Present Today', value: stats.presentToday, icon: CheckCircle, color: 'green' },
    { label: 'Absent Today', value: stats.absentToday, icon: AlertTriangle, color: 'red' },
    { label: 'Late Arrivals', value: stats.lateToday, icon: Clock, color: 'orange' },
    { label: 'All Punches', value: stats.totalPunches.toLocaleString(), icon: ArrowUpRight, color: 'blue' },
  ];

  if (loading) return (
    <div className="page-body">
      <div className="stats-grid">{[...Array(5)].map((_, i) => <div key={i} className="stat-card"><div className="skeleton" style={{ width: 32, height: 32, marginBottom: 10 }} /><div className="skeleton" style={{ width: 50, height: 24, marginBottom: 4 }} /><div className="skeleton" style={{ width: 80, height: 12 }} /></div>)}</div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div className="page-header-inner">
          <div>
            <h2 className="page-title">Dashboard</h2>
            <p className="page-subtitle">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          </div>
          <motion.button className="btn btn-secondary" onClick={fetchData} whileTap={{ scale: 0.96 }}>
            <RefreshCw size={13} /> Refresh
          </motion.button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid">
          {statCards.map((s, i) => (
            <motion.div key={s.label} className="stat-card" {...fadeUp(i * 0.05)} whileHover={{ y: -2, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
              <div className={`stat-icon ${s.color}`}><s.icon size={16} /></div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Devices */}
        <div className="device-cards">
          {devices.map((d, i) => (
            <motion.div key={d.id} className={`device-card ${d.status === 'connected' ? 'connected' : 'disconnected'}`} {...fadeUp(0.2 + i * 0.06)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div className="device-name"><Monitor size={14} />{d.name}</div><div className="device-ip">{d.ip_address}:{d.port}</div></div>
                <span className={`badge ${d.status === 'connected' ? 'green' : 'red'}`}><span className="badge-dot" />{d.status}</span>
              </div>
              <div className="device-meta">
                <div className="meta-item"><span className="meta-label">Model</span><span className="meta-value">{d.model_name}</span></div>
                <div className="meta-item"><span className="meta-label">Last Sync</span><span className="meta-value">{d.last_sync ? format(new Date(d.last_sync), 'HH:mm:ss') : '—'}</span></div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tables */}
        <motion.div className="grid-2" {...fadeUp(0.3)}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Recent Punches</h3><span className="badge gray">{stats.totalPunches}</span></div>
            {recentPunches.length === 0 ? <div className="empty-state"><Clock className="icon" /><p className="message">No punches recorded yet</p></div>
            : <table className="data-table"><thead><tr><th>Employee</th><th>Dept</th><th>Time</th></tr></thead>
              <tbody><AnimatePresence>{recentPunches.map((p, i) => (
                <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                  <td style={{ color: 'var(--text)', fontWeight: 600 }}>{p.employees?.name || `#${p.enroll_number}`}</td>
                  <td>{p.employees?.department || '—'}</td>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.76rem' }}>{format(new Date(p.punch_time), 'dd MMM, HH:mm:ss')}</td>
                </motion.tr>
              ))}</AnimatePresence></tbody></table>}
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Sync Activity</h3></div>
            {recentSync.length === 0 ? <div className="empty-state"><RefreshCw className="icon" /><p className="message">No sync activity yet</p></div>
            : <table className="data-table"><thead><tr><th>Device</th><th>Action</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>{recentSync.map(s => {
                const actionLabel = s.command_type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                return (
                <tr key={s.id}>
                  <td style={{ color: 'var(--text)', fontWeight: 500 }}>{s.devices?.name || '—'}</td>
                  <td><span className="badge purple">{actionLabel}</span></td>
                  <td><span className={`badge ${s.status === 'completed' ? 'green' : s.status === 'failed' ? 'red' : 'gray'}`}>{s.status}</span></td>
                  <td style={{ fontFamily: 'Consolas, monospace', fontSize: '0.76rem' }}>{format(new Date(s.created_at), 'HH:mm:ss')}</td>
                </tr>
              )})}</tbody></table>}
          </div>
        </motion.div>
      </div>
    </>
  );
}
