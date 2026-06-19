import { useState, useEffect, useCallback } from 'react';
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMigrateModal, setShowMigrateModal] = useState(false);
  const [migrateUser, setMigrateUser] = useState(null);
  const [migratingTo, setMigratingTo] = useState(null);
  const [migrateAction, setMigrateAction] = useState('copy');
  const [migrateProgress, setMigrateProgress] = useState(0);
  const [migrateSuccess, setMigrateSuccess] = useState('');
  const [addForm, setAddForm] = useState({ enroll_number: '', name: '', privilege: 0 });
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [deletingUser, setDeletingUser] = useState(null);
  const [search, setSearch] = useState('');
  const [deviceActions, setDeviceActions] = useState({});

  useEffect(() => {
    fetchDevices();
    const i = setInterval(fetchDevices, 15000);
    return () => clearInterval(i);
  }, []);

  async function fetchDevices() {
    const { data } = await supabase.from('devices').select('*').order('id');
    setDevices(data || []);
    setLoading(false);
  }

  async function fetchDeviceUsers(deviceId) {
    setLoadingUsers(true);
    setActiveDevice(deviceId);
    setSearch('');
    const { data, error } = await supabase
      .from('device_users')
      .select('*')
      .eq('device_id', deviceId)
      .order('enroll_number');
    if (error) {
      console.error('fetchDeviceUsers failed:', error);
    } else {
      console.log(`Loaded ${data?.length || 0} users for device ${deviceId}`, data);
    }
    setDeviceUsers(data || []);
    setLoadingUsers(false);
  }

  /**
   * Insert a command and poll the EXACT row by ID until done or timeout.
   * Fixes the race condition where any completed command of the same type
   * would close the poll prematurely.
   */
  async function insertAndPollCommand(deviceId, type, label, payload = null) {
    setDeviceActions(prev => ({ ...prev, [deviceId]: { action: label, progress: true } }));
    const commandPayload = { ...(payload || {}), transport: 'adms' };
    const { data: cmd, error } = await supabase
      .from('device_commands')
      .insert({ device_id: deviceId, command_type: type, payload: commandPayload, created_by: 'dashboard' })
      .select('id')
      .single();
    if (error || !cmd) {
      setDeviceActions(prev => ({ ...prev, [deviceId]: { action: `${label} — Failed to send`, progress: false } }));
      setTimeout(() => setDeviceActions(prev => { const n = { ...prev }; delete n[deviceId]; return n; }), 3000);
      return { status: 'error', result: error?.message };
    }
    const commandId = cmd.id;
    return new Promise((resolve) => {
      let isResolved = false;
      let poll;
      let channel;
      
      const finish = (finalStatus, resultText) => {
        if (isResolved) return;
        isResolved = true;
        if (poll) clearInterval(poll);
        if (channel) supabase.removeChannel(channel);
        
        const statusLabel = finalStatus === 'completed' ? 'Done ✓' : finalStatus === 'failed' ? 'Failed ✗' : 'Timeout';
        setDeviceActions(prev => ({ ...prev, [deviceId]: { action: `${label} — ${statusLabel}`, progress: false } }));
        fetchDevices();
        setTimeout(() => setDeviceActions(prev => { const n = { ...prev }; delete n[deviceId]; return n; }), 3000);
        resolve({ status: finalStatus, result: resultText || '' });
      };

      channel = supabase
        .channel(`cmd_${commandId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'device_commands', filter: `id=eq.${commandId}` },
          (payload) => {
            const { status, result } = payload.new;
            if (status === 'completed' || status === 'failed') {
              finish(status, result);
            }
          }
        )
        .subscribe();

      const startTime = Date.now();
      poll = setInterval(async () => {
        if (isResolved) return clearInterval(poll);
        const { data } = await supabase
          .from('device_commands')
          .select('status, result')
          .eq('id', commandId)
          .single();
        const done = data && (data.status === 'completed' || data.status === 'failed');
        const timedOut = Date.now() - startTime > 45000;
        if (done || timedOut) {
          const finalStatus = timedOut && !done ? 'timeout' : data?.status;
          finish(finalStatus, data?.result);
        }
      }, 4000);
    });
  }

  async function syncAndFetchUsers(deviceId) {
    setActiveDevice(deviceId);
    setDeviceUsers([]); // Clear users to show skeletons immediately
    setLoadingUsers(true);
    const syncPromise = insertAndPollCommand(deviceId, 'sync_users', 'Syncing Users');
    await syncPromise;
    await fetchDeviceUsers(deviceId);
  }

  function humanizeError(msg = '') {
    if (msg.includes('ECONNREFUSED') || msg.includes('offline')) return 'The device is offline. Check the network and try again.';
    if (msg.includes('slot') || msg.includes('full')) return 'The device has no more enrollment slots available.';
    if (msg.includes('timeout') || msg.includes('Timeout')) return 'The device did not respond in time. Try again.';
    if (msg.includes('not found') || msg.includes('Not found')) return 'User slot not found on this device.';
    return 'Operation failed. Check the device connection and try again.';
  }

  async function addUserToDevice() {
    if (!activeDevice || !addForm.enroll_number || !addForm.name) return;
    setEnrolling(true);
    setEnrollError('');
    const payload = {
      enroll_number: parseInt(addForm.enroll_number),
      name: addForm.name,
      privilege: parseInt(addForm.privilege),
      cardNumber: 0,
    };
    const res = await insertAndPollCommand(
      activeDevice, 'add_user',
      `Enrolling ${addForm.name} on ${activeDeviceData?.name}`,
      payload
    );
    if (res.status === 'completed') {
      // Only create employee record AFTER device confirms physical enrollment
      await supabase.from('employees').upsert({
        enroll_number: parseInt(addForm.enroll_number),
        name: addForm.name,
        privilege: parseInt(addForm.privilege),
      }, { onConflict: 'enroll_number', ignoreDuplicates: true });
      setShowAddModal(false);
      setAddForm({ enroll_number: '', name: '', privilege: 0 });
      await fetchDeviceUsers(activeDevice);
    } else if (res.status === 'failed') {
      setEnrollError(humanizeError(res.result));
    } else {
      setEnrollError('The device did not respond in 30 seconds. Check connection and try again.');
    }
    setEnrolling(false);
  }

  async function deleteUserFromDevice(deviceId, enrollNumber) {
    if (!confirm(`Remove user #${enrollNumber} from this device?`)) return;
    const userName = deviceUsers.find(u => u.enroll_number === enrollNumber)?.name || `#${enrollNumber}`;
    setDeletingUser(enrollNumber);

    // Only send enroll_number — agent looks up device_uid from device_users
    const res = await insertAndPollCommand(
      deviceId, 'delete_user',
      `Removing ${userName}`,
      { enroll_number: enrollNumber }
    );

    if (res.status === 'completed') {
      // Physical delete confirmed — now safe to update DB
      await supabase.from('device_users').delete()
        .eq('device_id', deviceId).eq('enroll_number', enrollNumber);

      await supabase.from('employee_archive_log').insert({
        enroll_number: enrollNumber, employee_name: userName,
        action: 'removed_from_device', device_id: deviceId,
        device_name: deviceById(deviceId)?.name || `Device #${deviceId}`,
        performed_by: 'dashboard',
      });

      const { data: remaining } = await supabase.from('device_users')
        .select('id').eq('enroll_number', enrollNumber).limit(1);
      if (!remaining || remaining.length === 0) {
        await supabase.from('employees')
          .update({ is_active: false, status: 'Inactive' }).eq('enroll_number', enrollNumber);
      }
      setDeviceUsers(prev => prev.filter(u => u.enroll_number !== enrollNumber));
    } else {
      alert(res.status === 'failed' ? humanizeError(res.result) : 'Device did not respond. User was NOT removed.');
    }
    setDeletingUser(null);
  }

  async function migrateUserToDevice(targetDeviceId) {
    if (!migrateUser || migratingTo) return;
    setMigratingTo(targetDeviceId);
    setMigrateProgress(15);
    setMigrateSuccess('');

    try {
      // Check if user already exists on target device
      const { data: existingUser } = await supabase
        .from('device_users')
        .select('id')
        .eq('device_id', targetDeviceId)
        .eq('enroll_number', migrateUser.enroll_number)
        .maybeSingle();

      if (existingUser) {
        alert('User already exists on the target device.');
        setMigratingTo(null);
        setMigrateProgress(0);
        return;
      }

      setMigrateProgress(30);

      // Fetch full employee details to get password
      const { data: empData } = await supabase
        .from('employees')
        .select('password, card_number, privilege')
        .eq('enroll_number', migrateUser.enroll_number)
        .maybeSingle();

      setMigrateProgress(50);

      const payload = {
        enroll_number: migrateUser.enroll_number,
        name: migrateUser.name,
        privilege: empData?.privilege ?? migrateUser.privilege ?? 0,
        cardNumber: parseInt(empData?.card_number || migrateUser.card_number) || 0,
        password: empData?.password || ''
      };

      const res = await insertAndPollCommand(
        targetDeviceId, 'add_user',
        `Migrating ${migrateUser.name}`,
        payload
      );

      if (res.status === 'completed') {
        setMigrateProgress(80);
        
        if (migrateAction === 'move') {
          // Delete from source device
          const delRes = await insertAndPollCommand(
            activeDevice, 'delete_user',
            `Removing ${migrateUser.name} from source`,
            { enroll_number: migrateUser.enroll_number }
          );
          
          if (delRes.status === 'completed') {
            await supabase.from('device_users').delete()
              .eq('device_id', activeDevice).eq('enroll_number', migrateUser.enroll_number);
              
            await supabase.from('employee_archive_log').insert({
              enroll_number: migrateUser.enroll_number, employee_name: migrateUser.name,
              action: 'removed_from_device', device_id: activeDevice,
              device_name: deviceById(activeDevice)?.name || `Device #${activeDevice}`,
              performed_by: 'dashboard_migration',
            });
            
            setDeviceUsers(prev => prev.filter(u => u.enroll_number !== migrateUser.enroll_number));
          }
        }
        
        setMigrateProgress(100);
        setMigrateSuccess(`Successfully ${migrateAction === 'move' ? 'moved' : 'copied'} to device.`);
        
        setTimeout(() => {
          setShowMigrateModal(false);
          setMigrateUser(null);
          setMigrateSuccess('');
          setMigrateProgress(0);
        }, 1500);
      } else {
        alert(humanizeError(res.result || ''));
        setMigrateProgress(0);
      }
    } catch (e) {
      alert('An error occurred during migration.');
      setMigrateProgress(0);
    } finally {
      setMigratingTo(null);
    }
  }

  async function changePrivilege(user, newPriv) {
    const label = { 0: 'User', 7: 'Manager', 14: 'Enroller', 15: 'Admin' }[newPriv] || newPriv;
    if (!confirm(`Change ${user.name} to ${label}?`)) return;
    const res = await insertAndPollCommand(
      activeDevice, 'add_user',
      `Updating ${user.name} privilege`,
      { enroll_number: user.enroll_number, name: user.name, privilege: newPriv }
    );
    if (res.status === 'completed') {
      setDeviceUsers(prev => prev.map(u => u.enroll_number === user.enroll_number ? { ...u, privilege: newPriv } : u));
      await supabase.from('employees').update({ privilege: newPriv }).eq('enroll_number', user.enroll_number);
    } else {
      alert(humanizeError(res.result || ''));
    }
  }

  async function getDeviceInfo(deviceId) {
    await insertAndPollCommand(deviceId, 'get_info', 'Fetching Info');
    fetchDevices();
  }

  const deviceById = (id) => devices.find(d => d.id === id);
  const activeDeviceData = activeDevice ? deviceById(activeDevice) : null;
  const otherDevices = devices.filter(d => d.id !== activeDevice);
  const filteredUsers = deviceUsers.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || String(u.enroll_number).includes(search)
  );

  // Realtime subscription: auto-refresh user panel when device_users changes
  useEffect(() => {
    if (!activeDevice) return;
    const channel = supabase
      .channel(`device_users_${activeDevice}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'device_users',
        filter: `device_id=eq.${activeDevice}`,
      }, () => fetchDeviceUsers(activeDevice))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [activeDevice]);

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

              {/* Progress bar (replaces "Recent Commands" table) */}
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
                  onClick={() => insertAndPollCommand(d.id, 'sync_attendance', 'Syncing Logs')}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Download size={11} />Sync Logs
                </motion.button>
                <motion.button className="btn btn-xs btn-primary" whileTap={{ scale: 0.95 }}
                  onClick={() => syncAndFetchUsers(d.id)}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Users size={11} />Users
                </motion.button>
                <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }}
                  onClick={() => insertAndPollCommand(d.id, 'sync_time', 'Syncing Time')}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <TimerReset size={11} />Time
                </motion.button>
                <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }}
                  onClick={() => getDeviceInfo(d.id)}
                  disabled={!!deviceActions[d.id]?.progress}>
                  <Info size={11} />Info
                </motion.button>
                <motion.button className="btn btn-xs btn-danger" whileTap={{ scale: 0.95 }}
                  onClick={() => { if (confirm('Restart this device?')) insertAndPollCommand(d.id, 'restart', 'Restarting'); }}
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
                <div className="empty-state"><Users className="icon" /><p className="message">No users on this device. Click "Users" to sync from hardware.</p></div>
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
                      <select
                        className="input select"
                        style={{ fontSize: '0.72rem', padding: '3px 6px', height: 28, width: 'auto' }}
                        value={u.privilege}
                        onChange={e => changePrivilege(u, parseInt(e.target.value))}
                      >
                        <option value={0}>User</option>
                        <option value={7}>Manager</option>
                        <option value={14}>Enroller</option>
                        <option value={15}>Admin</option>
                      </select>
                      <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }}
                        onClick={() => { setMigrateUser(u); setShowMigrateModal(true); }}
                        title="Copy to another device">
                        <ArrowRightLeft size={11} /> Migrate
                      </motion.button>
                      <motion.button className="btn btn-xs btn-danger" whileTap={{ scale: 0.95 }}
                        onClick={() => deleteUserFromDevice(activeDevice, u.enroll_number)}
                        disabled={deletingUser === u.enroll_number}>
                        {deletingUser === u.enroll_number ? <Loader size={11} className="spin" /> : <UserMinus size={11} />} Remove
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
                <h3 className="modal-title">Add User to {activeDeviceData?.name}</h3>
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
                {enrollError && (
                  <div style={{ padding: '8px 12px', background: 'var(--red-bg, rgba(239,68,68,0.08))', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: '0.78rem', color: 'var(--red, #ef4444)' }}>
                    <AlertCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />{enrollError}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => { setShowAddModal(false); setEnrollError(''); }}>Cancel</button>
                <motion.button className="btn btn-primary" whileTap={{ scale: 0.96 }} onClick={addUserToDevice}
                  disabled={!addForm.enroll_number || !addForm.name || enrolling}>
                  {enrolling ? <><Loader size={13} className="spin" /> Enrolling...</> : <><UserPlus size={13} />Add to Device</>}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Migrate Modal */}
      <AnimatePresence>
        {showMigrateModal && migrateUser && (
          <motion.div className="modal-overlay" onClick={() => setShowMigrateModal(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}>
              <div className="modal-header">
                <h3 className="modal-title">Migrate User</h3>
                <button className="btn btn-icon btn-secondary" onClick={() => setShowMigrateModal(false)}><X size={14} /></button>
              </div>
              <div className="modal-body">
                <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="user-avatar">{migrateUser.name?.charAt(0)?.toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{migrateUser.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>Enroll: {migrateUser.enroll_number}</div>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Action:</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" name="migrateAction" value="copy" checked={migrateAction === 'copy'} onChange={() => setMigrateAction('copy')} disabled={!!migratingTo} />
                      Copy <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>(Duplicate)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" name="migrateAction" value="move" checked={migrateAction === 'move'} onChange={() => setMigrateAction('move')} disabled={!!migratingTo} />
                      Move <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>(Add + Delete Source)</span>
                    </label>
                  </div>
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: 12 }}>
                  Select target device to {migrateAction} this user:
                </p>
                {otherDevices.filter(d => d.status === 'connected').map(d => (
                  <motion.button key={d.id} className="btn btn-secondary"
                    style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8, padding: '10px 14px' }}
                    disabled={!!migratingTo || !!migrateSuccess}
                    whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }} onClick={() => migrateUserToDevice(d.id)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Monitor size={14} /> {d.name}
                      <span className="badge gray" style={{ marginLeft: 4 }}>{d.ip_address}</span>
                    </span>
                    {migratingTo === d.id && !migrateSuccess ? <Loader size={14} className="spin" /> : <ChevronRight size={14} />}
                  </motion.button>
                ))}
                {otherDevices.filter(d => d.status === 'connected').length === 0 && (
                  <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-3)', fontSize: '0.8rem' }}>
                    No other connected devices available for migration.
                  </div>
                )}
                
                <AnimatePresence>
                  {migratingTo && !migrateSuccess && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: 'var(--accent)', marginBottom: 6, fontWeight: 600 }}>
                        <span>{migrateAction === 'move' ? (migrateProgress > 50 ? 'Removing from source...' : 'Adding to target...') : 'Migrating...'}</span>
                        <span>{migrateProgress}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--border-light)', borderRadius: 2, overflow: 'hidden' }}>
                        <motion.div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2 }} animate={{ width: `${migrateProgress}%` }} transition={{ duration: 0.4 }} />
                      </div>
                    </motion.div>
                  )}
                  {migrateSuccess && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginTop: 14 }}>
                      <div style={{ padding: '8px 12px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--green)', borderRadius: 'var(--r-sm)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <CheckCircle2 size={14} /> {migrateSuccess}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--amber-bg)', border: '1px solid rgba(217,119,6,0.12)', borderRadius: 'var(--r-sm)', fontSize: '0.74rem', color: 'var(--amber)' }}>
                  <AlertCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                  Fingerprints require re-enrollment on the target device.
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
