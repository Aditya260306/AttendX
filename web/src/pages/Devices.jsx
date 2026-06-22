import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor, RefreshCw, Trash2, Info, Power, UserPlus, Download,
  Users, ArrowRightLeft, X, ChevronRight, Clock, TimerReset,
  Search, UserMinus, AlertCircle, CheckCircle2, Shield, Loader
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDevice, setActiveDevice] = useState(null);
  const [deviceUsers, setDeviceUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState('');
  const [deviceActions, setDeviceActions] = useState({});

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ enroll_number: '', name: '', privilege: 0 });

  // 1. Initial Fetch & Realtime Subscriptions
  useEffect(() => {
    fetchDevices();

    const channel = supabase.channel('devices_page_realtime')
      // Listen to devices table
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
        fetchDevices();
      })
      // Listen to commands queue for UI Locking and Progress
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_commands' }, (payload) => {
        const cmd = payload.new;
        if (['pending', 'processing', 'acknowledged', 'streaming'].includes(cmd.status)) {
          let label = cmd.status;
          if (cmd.status === 'processing') label = 'Device Handling...';
          if (cmd.status === 'acknowledged') label = 'Waiting for data...';
          setDeviceActions(prev => ({ 
            ...prev, 
            [cmd.device_id]: { action: `${cmd.command_type} — ${label}`, progress: true } 
          }));
        } else {
          setDeviceActions(prev => ({ 
            ...prev, 
            [cmd.device_id]: { action: `${cmd.command_type} — ${cmd.status}`, progress: false } 
          }));
          setTimeout(() => {
            setDeviceActions(prev => {
              const next = { ...prev };
              delete next[cmd.device_id];
              return next;
            });
          }, 4000);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // 2. Fetch Users Realtime
  useEffect(() => {
    if (!activeDevice) return;
    fetchDeviceUsers(activeDevice);

    const channel = supabase.channel(`users_realtime_${activeDevice}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_users', filter: `device_id=eq.${activeDevice}` }, () => {
        fetchDeviceUsers(activeDevice);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [activeDevice]);

  async function fetchDevices() {
    const { data } = await supabase.from('devices').select('*').order('id');
    setDevices(data || []);
    setLoading(false);
  }

  async function fetchDeviceUsers(deviceId) {
    setLoadingUsers(true);
    const { data } = await supabase.from('device_users').select('*').eq('device_id', deviceId).order('enroll_number');
    setDeviceUsers(data || []);
    setLoadingUsers(false);
  }

  // 3. Fire-and-Forget Commands (Backend handles the rest)
  async function dispatchCommand(deviceId, type, payload = {}) {
    const { error } = await supabase.from('device_commands').insert({
      device_id: deviceId,
      command_type: type,
      payload: payload
    });
    if (error) {
      if (error.code === '23505') {
        alert('A command of this type is already active on this device.');
      } else {
        alert('Failed to dispatch command: ' + error.message);
      }
    }
  }

  async function handleAddUser() {
    if (!activeDevice || !addForm.enroll_number || !addForm.name) return;
    await dispatchCommand(activeDevice, 'add_user', {
      enroll_number: parseInt(addForm.enroll_number),
      name: addForm.name,
      privilege: parseInt(addForm.privilege),
      cardNumber: 0
    });
    setShowAddModal(false);
    setAddForm({ enroll_number: '', name: '', privilege: 0 });
  }

  async function handleDeleteUser(user) {
    if (!confirm(`Remove user #${user.enroll_number} from this device?`)) return;
    await dispatchCommand(activeDevice, 'delete_user', { enroll_number: user.enroll_number });
  }

  const deviceById = (id) => devices.find(d => d.id === id);
  const activeDeviceData = activeDevice ? deviceById(activeDevice) : null;
  const filteredUsers = deviceUsers.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || String(u.enroll_number).includes(search)
  );

  const PRIV_LABELS = { 0: 'User', 7: 'Manager', 14: 'Enroller', 15: 'Admin' };

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div><h2 className="page-title">Machines</h2><p className="page-subtitle">{devices.length} devices configured</p></div>
        <motion.button className="btn btn-secondary" onClick={fetchDevices} whileTap={{ scale: 0.96 }}><RefreshCw size={13} /> Refresh</motion.button>
      </div></div>
      <div className="page-body">
        {/* Device Cards */}
        <motion.div className="device-cards" {...fadeUp()}>
          {loading ? [1, 2].map(i => <div key={i} className="skeleton" style={{ height: 180, borderRadius: 10 }} />)
          : devices.map((d, i) => (
            <motion.div key={d.id} className={`device-card ${d.status === 'connected' ? 'connected' : 'disconnected'}`}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>

              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div className="device-name"><Monitor size={15} />{d.name}</div>
                  <div className="device-ip">{d.ip_address}:{d.port}</div>
                </div>
                <span className={`badge ${d.status === 'connected' ? 'green' : 'red'}`}><span className="badge-dot" />{d.status}</span>
              </div>

              {/* Meta */}
              <div className="device-meta">
                <div className="meta-item"><span className="meta-label">Model</span><span className="meta-value">{d.model_name || 'K30 Pro'}</span></div>
                <div className="meta-item"><span className="meta-label">Machine ID</span><span className="meta-value">{d.machine_id}</span></div>
                <div className="meta-item"><span className="meta-label">Last Seen</span><span className="meta-value">{d.last_seen ? format(new Date(d.last_seen), 'dd MMM, HH:mm') : '—'}</span></div>
                <div className="meta-item"><span className="meta-label">Last Sync</span><span className="meta-value">{d.last_sync ? format(new Date(d.last_sync), 'dd MMM, HH:mm') : '—'}</span></div>
              </div>

              {/* Progress bar */}
              <AnimatePresence>
                {deviceActions[d.id] && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.74rem', fontWeight: 600, color: deviceActions[d.id].progress ? 'var(--accent)' : 'var(--green)', marginBottom: 4 }}>
                      {deviceActions[d.id].progress ? <Loader size={12} className="spin" /> : <CheckCircle2 size={12} />}
                      {deviceActions[d.id].action}
                    </div>
                    {deviceActions[d.id].progress && (
                      <div style={{ height: 3, background: 'var(--border-light)', borderRadius: 2, overflow: 'hidden' }}>
                        <motion.div
                          style={{ height: '100%', background: 'var(--accent)', borderRadius: 2 }}
                          initial={{ width: '0%' }}
                          animate={{ width: '90%' }}
                          transition={{ duration: 25, ease: 'linear' }}
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="divider" />
              <div className="btn-group">
                <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }}
                  onClick={() => dispatchCommand(d.id, 'sync_attendance')}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Download size={11} />Sync Logs
                </motion.button>
                <motion.button className="btn btn-xs btn-primary" whileTap={{ scale: 0.95 }}
                  onClick={() => { setActiveDevice(d.id); dispatchCommand(d.id, 'sync_users'); }}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Users size={11} />Reconcile Device
                </motion.button>
                <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }}
                  onClick={() => dispatchCommand(d.id, 'sync_time')}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <TimerReset size={11} />Time
                </motion.button>
                <motion.button className="btn btn-xs btn-danger" whileTap={{ scale: 0.95 }}
                  onClick={() => { if (confirm('Restart this device?')) dispatchCommand(d.id, 'restart'); }}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Power size={11} />Restart
                </motion.button>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Device Users Panel */}
        <AnimatePresence>
          {activeDevice && (
            <motion.div className="card" style={{ marginBottom: 16 }}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={15} />
                  <h3 className="card-title">Users on {activeDeviceData?.name || 'Device'}</h3>
                  <span className="badge gray">{deviceUsers.length}</span>
                </div>
                <div className="btn-group">
                  <motion.button className="btn btn-sm btn-primary" whileTap={{ scale: 0.96 }}
                    onClick={() => { setAddForm({ enroll_number: '', name: '', privilege: 0 }); setShowAddModal(true); }}>
                    <UserPlus size={13} /> Add User
                  </motion.button>
                  <button className="btn btn-sm btn-secondary btn-icon" onClick={() => { setActiveDevice(null); setDeviceUsers([]); }}><X size={14} /></button>
                </div>
              </div>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
                <div className="search-wrap" style={{ maxWidth: 280 }}>
                  <Search size={14} className="search-icon" />
                  <input className="input" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              {loadingUsers ? (
                <div className="card-body">{[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 44, marginBottom: 6 }} />)}</div>
              ) : deviceUsers.length === 0 ? (
                <div className="empty-state"><Users className="icon" /><p className="message">No users on this device.</p></div>
              ) : filteredUsers.length === 0 ? (
                <div className="empty-state"><Search className="icon" /><p className="message">No users match this search.</p></div>
              ) : (
                <div>{filteredUsers.map((u, i) => (
                  <motion.div key={u.id || u.enroll_number} className="user-row"
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                    <div className="user-info">
                      <div className="user-avatar">{u.name?.charAt(0)?.toUpperCase() || '#'}</div>
                      <div>
                        <div className="user-name">{u.name}</div>
                        <div className="user-id">Enroll: {u.enroll_number} | Slot: {u.device_uid} | {PRIV_LABELS[u.privilege] || u.privilege}</div>
                      </div>
                    </div>
                    <div className="btn-group">
                      <motion.button className="btn btn-xs btn-danger" whileTap={{ scale: 0.95 }}
                        onClick={() => handleDeleteUser(u)}>
                        <UserMinus size={11} /> Remove
                      </motion.button>
                    </div>
                  </motion.div>
                ))}</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div className="modal-overlay" onClick={() => setShowAddModal(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}>
              <div className="modal-header">
                <h3 className="modal-title">Add User</h3>
                <button className="btn btn-icon btn-secondary" onClick={() => setShowAddModal(false)}><X size={14} /></button>
              </div>
              <div className="modal-body">
                <div className="input-group"><label>Enroll Number</label><input className="input" type="number" placeholder="e.g. 103" value={addForm.enroll_number} onChange={e => setAddForm({ ...addForm, enroll_number: e.target.value })} /></div>
                <div className="input-group"><label>Full Name</label><input className="input" placeholder="e.g. Rahul Sharma" value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} /></div>
                <div className="input-group"><label>Privilege</label>
                  <select className="input select" value={addForm.privilege} onChange={e => setAddForm({ ...addForm, privilege: parseInt(e.target.value) })}>
                    <option value={0}>User</option>
                    <option value={7}>Manager</option>
                    <option value={14}>Enroller</option>
                    <option value={15}>Admin</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <motion.button className="btn btn-primary" whileTap={{ scale: 0.96 }} onClick={handleAddUser}
                  disabled={!addForm.enroll_number || !addForm.name}>
                  <UserPlus size={13} />Add to Device
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
