import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Trash2, Search, Upload, Pencil, X, Shield, Clock, Eye,
  ChevronDown, Monitor, LayoutGrid, List, MoreVertical,
  UserCheck, UserX, Zap, ArrowUpDown, ArrowUp, ArrowDown, Briefcase,
  FileText, CheckCircle2, AlertTriangle, Download, Table2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import EmployeeProfile from './EmployeeProfile';

const fadeUp = (d = 0) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.3 } });

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceUsers, setDeviceUsers] = useState([]); // which users are on which devices
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');       // 'all' | 'active' | 'inactive'
  const [filterDept, setFilterDept] = useState('all');
  const [filterRole, setFilterRole] = useState('all');              // 'all' | 'admin' | 'user'
  const [filterTracking, setFilterTracking] = useState('attendance'); // 'attendance' default = hide owners
  const [filterDevice, setFilterDevice] = useState('all');          // 'all' | device id

  const [viewMode, setViewMode] = useState(() => localStorage.getItem('emp_view_mode') || 'grid');
  const setViewModePersisted = (mode) => { setViewMode(mode); localStorage.setItem('emp_view_mode', mode); };
  const [showModal, setShowModal] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [formTab, setFormTab] = useState(0);
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });
  // Profile slide-over
  const [profileModal, setProfileModal] = useState(null);
  const [profileData, setProfileData] = useState({ punches: [], holidays: [], rules: null, modifications: [] });
  // 3-dot menu
  const [empMenu, setEmpMenu] = useState(null);
  // CSV import
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvDone, setCsvDone] = useState(null); // { ok, fail }

  const emptyForm = {
    enroll_number: '', name: '', father_name: '', date_of_birth: '',
    gender: '', blood_group: '', department: '', designation: '', joining_date: format(new Date(), 'yyyy-MM-dd'),
    mobile_number: '', emergency_contact: '', email: '', permanent_address: '', current_address: '', same_address: false,
    shift_start: '09:00', shift_end: '18:00', track_attendance: true, primary_device_id: '', card_number: '',
    base_salary: '', bank_account_no: '', bank_ifsc: '', bank_name: '',
    pan_number: '', aadhaar_number: '', uan_number: '',
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [{ data: emps }, { data: devs }, { data: du }] = await Promise.all([
      supabase.from('employees').select('*').order('enroll_number'),
      supabase.from('devices').select('id, name').eq('is_active', true),
      supabase.from('device_users').select('device_id, enroll_number, purpose'),
    ]);
    setEmployees(emps || []);
    setDevices(devs || []);
    setDeviceUsers(du || []);
    setLoading(false);
  }

  // Get devices this employee is registered on
  function getEmpDevices(enrollNumber) {
    return deviceUsers
      .filter(du => du.enroll_number === enrollNumber)
      .map(du => ({ device_id: du.device_id, purpose: du.purpose || 'attendance' }));
  }

  async function handleSave() {
    const r = {
      enroll_number: parseInt(form.enroll_number),
      name: form.name,
      father_name: form.father_name || null,
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      blood_group: form.blood_group || null,
      department: form.department || null,
      designation: form.designation || null,
      joining_date: form.joining_date || null,
      mobile_number: form.mobile_number || null,
      emergency_contact: form.emergency_contact || null,
      email: form.email || null,
      permanent_address: form.permanent_address || null,
      current_address: form.same_address ? (form.permanent_address || null) : (form.current_address || null),
      shift_start: form.shift_start + ':00',
      shift_end: form.shift_end + ':00',
      track_attendance: form.track_attendance,
      primary_device_id: form.primary_device_id ? parseInt(form.primary_device_id) : null,
      card_number: form.card_number || null,
      base_salary: form.base_salary ? parseInt(form.base_salary) : 0,
      bank_account_no: form.bank_account_no || null,
      bank_ifsc: form.bank_ifsc ? form.bank_ifsc.toUpperCase() : null,
      bank_name: form.bank_name || null,
      pan_number: form.pan_number ? form.pan_number.toUpperCase() : null,
      aadhaar_number: form.aadhaar_number || null,
      uan_number: form.uan_number || null,
    };
    if (editEmp) {
      await supabase.from('employees').update(r).eq('enroll_number', editEmp.enroll_number);
    } else {
      await supabase.from('employees').upsert(r, { onConflict: 'enroll_number' });
    }
    setShowModal(false); setEditEmp(null); setFormTab(0); fetchAll();
  }

  async function handleDelete(id) {
    const emp = employees.find(e => e.enroll_number === id);
    if (!confirm(`Deactivate ${emp?.name || '#' + id}? Records will be preserved.`)) return;
    await supabase.from('employees')
      .update({ is_active: false, status: 'Inactive' })
      .eq('enroll_number', id);
    await supabase.from('employee_archive_log').insert({
      enroll_number: id,
      employee_name: emp?.name || `#${id}`,
      action: 'deactivated',
      reason: 'Manually deactivated from Employees page',
      performed_by: 'dashboard',
    }).catch(() => {}); // ignore if table doesn't exist yet
    fetchAll();
  }

  async function toggleActive(emp) {
    const newStatus = !emp.is_active;
    setEmployees(prev => prev.map(e =>
      e.enroll_number === emp.enroll_number
        ? { ...e, is_active: newStatus, status: newStatus ? 'Active' : 'Inactive' }
        : e
    ));
    const { error } = await supabase.from('employees')
      .update({ is_active: newStatus, status: newStatus ? 'Active' : 'Inactive' })
      .eq('enroll_number', emp.enroll_number);
    if (error) {
      console.error('toggleActive failed:', error);
      setEmployees(prev => prev.map(e =>
        e.enroll_number === emp.enroll_number
          ? { ...e, is_active: emp.is_active, status: emp.status }
          : e
      ));
    }
  }

  async function toggleTrackAttendance(emp) {
    const newVal = !emp.track_attendance;
    setEmployees(prev => prev.map(e =>
      e.enroll_number === emp.enroll_number ? { ...e, track_attendance: newVal } : e
    ));
    const { error } = await supabase.from('employees')
      .update({ track_attendance: newVal })
      .eq('enroll_number', emp.enroll_number);
    if (error) {
      console.error('toggleTrackAttendance failed:', error);
      setEmployees(prev => prev.map(e =>
        e.enroll_number === emp.enroll_number ? { ...e, track_attendance: emp.track_attendance } : e
      ));
    }
  }

  async function togglePrivilege(emp) {
    const newPriv = emp.privilege === 14 ? 0 : 14;
    setEmployees(prev => prev.map(e =>
      e.enroll_number === emp.enroll_number ? { ...e, privilege: newPriv } : e
    ));
    const { error } = await supabase.from('employees')
      .update({ privilege: newPriv })
      .eq('enroll_number', emp.enroll_number);
    if (error) {
      console.error('togglePrivilege failed:', error);
      setEmployees(prev => prev.map(e =>
        e.enroll_number === emp.enroll_number ? { ...e, privilege: emp.privilege } : e
      ));
      return;
    }
    // Only push to devices where this employee ACTUALLY EXISTS
    const empDevs = getEmpDevices(emp.enroll_number);
    for (const ed of empDevs) {
      await supabase.from('device_commands').insert({
        device_id: ed.device_id,
        command_type: 'add_user',
        payload: {
          enroll_number: emp.enroll_number,
          name: emp.name,
          privilege: newPriv,
          transport: 'adms',
        },
        created_by: 'dashboard',
      });
    }
  }

  async function pushToDevice(emp, devId) {
    await supabase.from('device_commands').insert({
      device_id: devId, command_type: 'add_user',
      payload: { enroll_number: emp.enroll_number, name: emp.name, privilege: emp.privilege || 0, transport: 'adms' },
      created_by: 'dashboard',
    });
    alert(`Push command queued for ${emp.name}`);
  }

  function openEdit(e) {
    setEditEmp(e);
    setForm({
      enroll_number: e.enroll_number, name: e.name,
      father_name: e.father_name || '', date_of_birth: e.date_of_birth || '',
      gender: e.gender || '', blood_group: e.blood_group || '',
      department: e.department || '', designation: e.designation || '',
      joining_date: e.joining_date || '',
      mobile_number: e.mobile_number || '', emergency_contact: e.emergency_contact || '',
      email: e.email || '',
      permanent_address: e.permanent_address || '', current_address: e.current_address || '', same_address: false,
      shift_start: e.shift_start?.slice(0, 5) || '09:00',
      shift_end: e.shift_end?.slice(0, 5) || '18:00',
      track_attendance: e.track_attendance !== false,
      primary_device_id: e.primary_device_id || '', card_number: e.card_number || '',
      base_salary: e.base_salary || '', bank_account_no: e.bank_account_no || '',
      bank_ifsc: e.bank_ifsc || '', bank_name: e.bank_name || '',
      pan_number: e.pan_number || '', aadhaar_number: e.aadhaar_number || '',
      uan_number: e.uan_number || '',
    });
    setFormTab(0); setShowModal(true);
  }

  function openAdd() {
    setEditEmp(null);
    setForm({ ...emptyForm });
    setFormTab(0); setShowModal(true);
  }

  // ── CSV Import helpers ──
  const CSV_HEADERS = [
    'enroll_number','name','father_name','date_of_birth','gender','blood_group',
    'department','designation','joining_date','mobile_number','email',
    'shift_start','shift_end','base_salary','pan_number','aadhaar_number','uan_number',
    'bank_account_no','bank_ifsc','bank_name',
  ];

  function parseCSV(raw) {
    const lines = raw.trim().split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { rows: [], errors: ['No data found.'] };
    // Detect delimiter: if first line has tab, use tab
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    // Skip header row if first cell matches 'enroll_number'
    const dataStart = header[0] === 'enroll_number' ? 1 : 0;
    const rows = []; const errors = [];
    for (let i = dataStart; i < lines.length; i++) {
      const cols = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
      const map = dataStart === 1
        ? Object.fromEntries(header.map((h, idx) => [h, cols[idx] ?? '']))
        : Object.fromEntries(CSV_HEADERS.map((h, idx) => [h, cols[idx] ?? '']));
      if (!map.enroll_number || !map.name) {
        errors.push(`Row ${i + 1}: enroll_number and name are required.`);
        continue;
      }
      if (isNaN(parseInt(map.enroll_number))) {
        errors.push(`Row ${i + 1}: enroll_number must be a number.`);
        continue;
      }
      rows.push({
        enroll_number: parseInt(map.enroll_number),
        name: map.name,
        father_name: map.father_name || null,
        date_of_birth: map.date_of_birth || null,
        gender: map.gender || null,
        blood_group: map.blood_group || null,
        department: map.department || null,
        designation: map.designation || null,
        joining_date: map.joining_date || null,
        mobile_number: map.mobile_number || null,
        email: map.email || null,
        shift_start: map.shift_start ? (map.shift_start.length === 5 ? map.shift_start + ':00' : map.shift_start) : '09:00:00',
        shift_end: map.shift_end ? (map.shift_end.length === 5 ? map.shift_end + ':00' : map.shift_end) : '18:00:00',
        base_salary: map.base_salary ? parseInt(map.base_salary) : 0,
        pan_number: map.pan_number ? map.pan_number.toUpperCase() : null,
        aadhaar_number: map.aadhaar_number || null,
        uan_number: map.uan_number || null,
        bank_account_no: map.bank_account_no || null,
        bank_ifsc: map.bank_ifsc ? map.bank_ifsc.toUpperCase() : null,
        bank_name: map.bank_name || null,
        track_attendance: true,
        is_active: true,
        status: 'Active',
      });
    }
    return { rows, errors };
  }

  function previewCSV(raw) {
    const { rows, errors } = parseCSV(raw);
    setCsvRows(rows); setCsvErrors(errors); setCsvDone(null);
  }

  async function handleCsvImport() {
    if (!csvRows.length) return;
    setCsvImporting(true); setCsvDone(null);
    // Upsert in chunks of 20 to avoid request size limits
    const CHUNK = 20; let ok = 0; let fail = 0;
    for (let i = 0; i < csvRows.length; i += CHUNK) {
      const chunk = csvRows.slice(i, i + CHUNK);
      const { error } = await supabase.from('employees')
        .upsert(chunk, { onConflict: 'enroll_number' });
      if (error) { fail += chunk.length; console.error('CSV chunk error:', error); }
      else ok += chunk.length;
    }
    setCsvImporting(false); setCsvDone({ ok, fail });
    if (ok > 0) fetchAll();
  }

  function downloadTemplate() {
    const header = CSV_HEADERS.join(',');
    const example = '101,Rahul Sharma,Suresh Sharma,1990-01-15,Male,B+,Engineering,Developer,2024-01-01,9876543210,rahul@example.com,09:00,18:00,25000,ABCDE1234F,123456789012,100234567890,12345678901234,SBIN0001234,State Bank of India';
    const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'employee_import_template.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  // Sort toggle
  function toggleSort(key) {
    setSortConfig(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  }
  function getSortIcon(key) {
    if (sortConfig.key !== key) return ArrowUpDown;
    return sortConfig.dir === 'asc' ? ArrowUp : ArrowDown;
  }

  // Open profile with lazy data fetch
  async function openProfile(enrollNumber) {
    setEmpMenu(null);
    setProfileModal({ enrollNumber });
    const [{ data: p }, { data: h }, { data: r }, { data: m }] = await Promise.all([
      supabase.from('raw_punches').select('*').eq('enroll_number', enrollNumber),
      supabase.from('holidays').select('*'),
      supabase.from('attendance_rules').select('*').single(),
      supabase.from('punch_modifications').select('*').eq('enroll_number', enrollNumber).order('modified_at', { ascending: false }),
    ]);
    setProfileData({ punches: p || [], holidays: h || [], rules: r, modifications: m || [] });
  }

  // Dynamic department list from actual data
  const departments = useMemo(() => {
    const depts = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
    return depts;
  }, [employees]);

  // Count active filters (excluding defaults)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterStatus !== 'active') count++;
    if (filterDept !== 'all') count++;
    if (filterRole !== 'all') count++;
    if (filterTracking !== 'attendance') count++;
    if (filterDevice !== 'all') count++;
    if (search) count++;
    return count;
  }, [filterStatus, filterDept, filterRole, filterTracking, filterDevice, search]);

  function clearAllFilters() {
    setSearch('');
    setFilterStatus('active');
    setFilterDept('all');
    setFilterRole('all');
    setFilterTracking('attendance');
    setFilterDevice('all');
  }

  // Multi-criteria filter + sort
  const filtered = useMemo(() => {
    let result = employees.filter(e => {
      if (filterStatus === 'active' && !e.is_active) return false;
      if (filterStatus === 'inactive' && e.is_active) return false;
      if (filterDept !== 'all' && (e.department || '') !== filterDept) return false;
      if (filterRole === 'admin' && e.privilege !== 14) return false;
      if (filterRole === 'user' && e.privilege === 14) return false;
      if (filterTracking === 'attendance' && e.track_attendance === false) return false;
      if (filterTracking === 'access_only' && e.track_attendance !== false) return false;
      if (filterDevice !== 'all') {
        if (e.primary_device_id !== parseInt(filterDevice)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return e.name?.toLowerCase().includes(q) || String(e.enroll_number).includes(q)
          || e.department?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q);
      }
      return true;
    });
    // Sort
    result.sort((a, b) => {
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      const va = a[sortConfig.key] ?? '';
      const vb = b[sortConfig.key] ?? '';
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * ((va > vb ? 1 : va < vb ? -1 : 0));
    });
    return result;
  }, [employees, filterStatus, filterDept, filterRole, filterTracking, filterDevice, search, sortConfig]);

  // KPI stats
  const kpi = useMemo(() => ({
    total: employees.length,
    active: employees.filter(e => e.is_active).length,
    inactive: employees.filter(e => !e.is_active).length,
    admins: employees.filter(e => e.privilege === 14).length,
    tracking: employees.filter(e => e.track_attendance !== false).length,
  }), [employees]);

  return (
    <>
      <div className="page-header"><div className="page-header-inner">
        <div>
          <h2 className="page-title">Employees</h2>
          <p className="page-subtitle">{kpi.active} active / {kpi.total} total</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <motion.button className="btn btn-secondary" onClick={() => { setShowCsvModal(true); setCsvText(''); setCsvRows([]); setCsvErrors([]); setCsvDone(null); }} whileTap={{ scale: 0.96 }}>
            <Upload size={14} /> Import CSV
          </motion.button>
          <motion.button className="btn btn-primary" onClick={openAdd} whileTap={{ scale: 0.96 }}>
            <Plus size={14} /> Add Employee
          </motion.button>
        </div>
      </div></div>



      <div className="page-body">
        {/* ─── Filter & Sort Bar (Attendance-page style) ─── */}
        <motion.div {...fadeUp()} className="emp-filter-bar">

          {/* Search */}
          <div className="emp-filter-search">
            <Search size={14} className="emp-filter-search-icon" />
            <input
              className="input"
              placeholder="Search name, ID, dept..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            {search && (
              <button className="emp-filter-search-clear" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Status chips */}
          <div className="emp-chip-group">
            {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([val, label]) => (
              <button
                key={val}
                className={`emp-chip ${filterStatus === val ? 'active' : ''}`}
                onClick={() => setFilterStatus(val)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Department select */}
          <div className="emp-select-wrap">
            <select
              className="input emp-filter-select"
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <ChevronDown size={12} className="emp-select-arrow" />
          </div>

          {/* Role chips */}
          <div className="emp-chip-group">
            {[['all', 'All'], ['admin', 'Admin'], ['user', 'User']].map(([val, label]) => (
              <button
                key={val}
                className={`emp-chip ${filterRole === val ? 'active' : ''}`}
                onClick={() => setFilterRole(val)}
              >
                {val === 'admin' && <Shield size={10} />}
                {label}
              </button>
            ))}
          </div>

          {/* Tracking chips */}
          <div className="emp-chip-group">
            {[['attendance', 'Attendance'], ['access_only', 'Access Only'], ['all', 'All']].map(([val, label]) => (
              <button
                key={val}
                className={`emp-chip ${filterTracking === val ? 'active' : ''}`}
                onClick={() => setFilterTracking(val)}
              >
                {val === 'attendance' && <Clock size={10} />}
                {val === 'access_only' && <Eye size={10} />}
                {label}
              </button>
            ))}
          </div>

          {/* Machine chips */}
          <div className="emp-chip-group">
            <button
              className={`emp-chip ${filterDevice === 'all' ? 'active' : ''}`}
              onClick={() => setFilterDevice('all')}
            >
              All
            </button>
            {devices.map(d => (
              <button
                key={d.id}
                className={`emp-chip ${filterDevice === String(d.id) ? 'active' : ''}`}
                onClick={() => setFilterDevice(String(d.id))}
              >
                <Monitor size={10} /> {d.name}
              </button>
            ))}
          </div>

          {/* Sort chips */}
          <div className="emp-chip-group">
            {[
              { key: 'name', label: 'Name' },
              { key: 'enroll_number', label: 'ID' },
              { key: 'department', label: 'Dept' },
              { key: 'joining_date', label: 'Joining' },
            ].map(s => {
              const Icon = getSortIcon(s.key);
              return (
                <button
                  key={s.key}
                  className={`emp-chip ${sortConfig.key === s.key ? 'active' : ''}`}
                  onClick={() => toggleSort(s.key)}
                >
                  <Icon size={10} /> {s.label}
                </button>
              );
            })}
          </div>

          {/* Result count */}
          <span className="emp-filter-result-count">
            {filtered.length} of {employees.length}
          </span>

          {/* View toggle */}
          <div className="emp-view-toggle">
            <button
              className={`emp-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewModePersisted('grid')}
              title="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              className={`emp-view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewModePersisted('table')}
              title="Table view"
            >
              <List size={14} />
            </button>
          </div>
        </motion.div>

        {/* ─── Content Area (Table or Grid) ─── */}
        {loading
          ? <motion.div className="card" {...fadeUp(0.1)}>
              <div className="card-body">{[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 38, marginBottom: 6 }} />)}</div>
            </motion.div>
          : filtered.length === 0
            ? <motion.div className="card" {...fadeUp(0.1)}>
                <div className="empty-state">
                  <Users className="icon" />
                  <p className="message">{(search || activeFilterCount > 0) ? 'No employees match your filters' : 'No employees yet'}</p>
                  {(search || activeFilterCount > 0) && (
                    <button className="btn btn-sm btn-secondary" onClick={clearAllFilters} style={{ marginTop: 8 }}>
                      <XCircle size={12} /> Clear Filters
                    </button>
                  )}
                </div>
              </motion.div>
            : viewMode === 'grid'
              ? /* ═══ GRID VIEW ═══ */
                <motion.div className="emp-grid" {...fadeUp(0.1)}>
                  <AnimatePresence>
                    {filtered.map((e, i) => {
                      const empDevs = getEmpDevices(e.enroll_number);
                      const primaryDev = devices.find(d => d.id === e.primary_device_id);
                      return (
                        <motion.div
                          key={e.enroll_number}
                          className={`emp-card ${!e.is_active ? 'inactive' : ''}`}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                        >
                          {/* Card Header */}
                          <div className="emp-card-header">
                            <div className="emp-card-avatar">
                              {e.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div className="emp-card-identity">
                              <span className="emp-card-name">{e.name}</span>
                              <span className="emp-card-id">#{e.enroll_number}{e.department ? ` · ${e.department}` : ''}</span>
                            </div>
                            <div className="emp-card-actions" style={{ position: 'relative' }}>
                              <motion.button className="btn btn-icon-sm btn-secondary" whileTap={{ scale: 0.95 }}
                                onClick={(ev) => { ev.stopPropagation(); setEmpMenu(empMenu === e.enroll_number ? null : e.enroll_number); }}
                                title="Options"
                              >
                                <MoreVertical size={14} />
                              </motion.button>
                              <AnimatePresence>
                                {empMenu === e.enroll_number && (
                                  <motion.div
                                    className="emp-context-menu"
                                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                                    transition={{ duration: 0.15 }}
                                    style={{
                                      position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                                      background: 'rgba(24,24,32,0.95)', backdropFilter: 'blur(16px)',
                                      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
                                      padding: '4px', minWidth: 140, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                                    }}
                                    onClick={(ev) => ev.stopPropagation()}
                                  >
                                    <button className="emp-ctx-item" onClick={() => { setEmpMenu(null); openEdit(e); }}>
                                      <Pencil size={13} /> Edit
                                    </button>
                                    <button className="emp-ctx-item" onClick={() => openProfile(e.enroll_number)}>
                                      <Eye size={13} /> Profile
                                    </button>
                                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 6px' }} />
                                    <button className="emp-ctx-item danger" onClick={() => { setEmpMenu(null); handleDelete(e.enroll_number); }}>
                                      <Trash2 size={13} /> Deactivate
                                    </button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>

                          {/* Card Body — settings */}
                          <div className="emp-card-body">
                            {/* Shift */}
                            {e.track_attendance !== false && (
                              <div className="emp-card-row">
                                <span className="emp-card-label">Shift</span>
                                <span className="emp-card-value mono">
                                  {e.shift_start?.slice(0, 5)} – {e.shift_end?.slice(0, 5)}
                                </span>
                              </div>
                            )}

                            {/* Primary Device */}
                            {primaryDev && (
                              <div className="emp-card-row">
                                <span className="emp-card-label">Primary</span>
                                <span className="emp-card-value">
                                  <Monitor size={10} style={{ marginRight: 4 }} />
                                  {primaryDev.name}
                                </span>
                              </div>
                            )}

                            {/* On Devices */}
                            <div className="emp-card-row">
                              <span className="emp-card-label">Devices</span>
                              <div className="emp-card-devices">
                                {empDevs.length === 0
                                  ? <span className="emp-card-none">None</span>
                                  : empDevs.map(ed => {
                                    const dev = devices.find(d => d.id === ed.device_id);
                                    const isPrimary = e.primary_device_id === ed.device_id;
                                    return (
                                      <span key={ed.device_id} className={`emp-card-device-badge ${isPrimary ? 'primary' : ''} ${ed.purpose === 'admin_only' ? 'admin-only' : ''}`}>
                                        {dev?.name || `#${ed.device_id}`}
                                        {isPrimary && ' ★'}
                                      </span>
                                    );
                                  })
                                }
                              </div>
                            </div>
                          </div>

                          {/* Card Footer — toggle chips */}
                          <div className="emp-card-footer">
                            <motion.button
                              className={`emp-card-tag ${e.track_attendance !== false ? 'attendance' : 'access-only'}`}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => toggleTrackAttendance(e)}
                            >
                              {e.track_attendance !== false
                                ? <><Clock size={10} /> Attendance</>
                                : <><Eye size={10} /> Access Only</>
                              }
                            </motion.button>

                            <motion.button
                              className={`emp-card-tag ${e.privilege === 14 ? 'admin' : 'user-role'}`}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => togglePrivilege(e)}
                            >
                              <Shield size={10} />
                              {e.privilege === 14 ? 'Admin' : 'User'}
                            </motion.button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>

              : /* ═══ TABLE VIEW ═══ */
                <motion.div className="card" {...fadeUp(0.1)}>
                  <table className="data-table">
                    <thead><tr>
                      <th>ID</th><th>Name</th><th>Department</th><th>Shift</th>
                      <th>Tracking</th><th>Role</th>
                      <th>On Devices</th><th></th>
                    </tr></thead>
                    <tbody>
                      <AnimatePresence>
                        {filtered.map((e, i) => {
                          const empDevs = getEmpDevices(e.enroll_number);
                          const primaryDev = devices.find(d => d.id === e.primary_device_id);
                          return (
                            <motion.tr key={e.enroll_number}
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                              style={{ opacity: e.is_active ? 1 : 0.45 }}>

                              <td style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.82rem' }}>#{e.enroll_number}</td>
                              <td style={{ color: 'var(--text)', fontWeight: 600 }}>{e.name}</td>
                              <td>{e.department || '—'}</td>
                              <td style={{ fontFamily: 'Consolas,monospace', fontSize: '0.76rem' }}>
                                {e.track_attendance !== false
                                  ? <>{e.shift_start?.slice(0, 5)} – {e.shift_end?.slice(0, 5)}</>
                                  : <span style={{ color: 'var(--text-muted)' }}>—</span>
                                }
                              </td>

                              {/* Tracking toggle */}
                              <td>
                                <motion.button
                                  className={`btn btn-xs ${e.track_attendance !== false ? 'btn-secondary' : 'btn-warning'}`}
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => toggleTrackAttendance(e)}
                                  title={e.track_attendance !== false ? 'Tracking attendance — click to set as Access Only' : 'Access Only — click to enable attendance tracking'}
                                  style={{ minWidth: 90, fontSize: '0.7rem' }}>
                                  {e.track_attendance !== false
                                    ? <><Clock size={10} /> Attendance</>
                                    : <><Eye size={10} /> Access Only</>
                                  }
                                </motion.button>
                              </td>

                              {/* Privilege toggle */}
                              <td>
                                <motion.button
                                  className={`btn btn-xs ${e.privilege === 14 ? 'btn-primary' : 'btn-secondary'}`}
                                  whileTap={{ scale: 0.95 }}
                                  onClick={() => togglePrivilege(e)}
                                  title={e.privilege === 14 ? 'Demote to Normal' : 'Promote to Admin'}>
                                  <Shield size={10} />{e.privilege === 14 ? 'Admin' : 'User'}
                                </motion.button>
                              </td>

                              {/* Devices this user is on */}
                              <td>
                                <div className="btn-group" style={{ flexWrap: 'wrap', gap: 3 }}>
                                  {empDevs.length === 0
                                    ? <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>None</span>
                                    : empDevs.map(ed => {
                                      const dev = devices.find(d => d.id === ed.device_id);
                                      const isPrimary = e.primary_device_id === ed.device_id;
                                      return (
                                        <span key={ed.device_id} style={{
                                          fontSize: '0.68rem', padding: '2px 6px', borderRadius: 4,
                                          background: isPrimary ? 'var(--accent-light)' : ed.purpose === 'admin_only' ? 'rgba(255,152,0,0.12)' : 'var(--bg-surface)',
                                          color: isPrimary ? 'var(--accent)' : ed.purpose === 'admin_only' ? '#e67700' : 'var(--text-muted)',
                                          fontWeight: isPrimary ? 700 : 500,
                                          border: `1px solid ${isPrimary ? 'var(--accent)' : 'var(--border-light)'}`,
                                        }}>
                                          {dev?.name || `#${ed.device_id}`}
                                          {isPrimary && ' ★'}
                                          {ed.purpose === 'admin_only' && ' 🔑'}
                                        </span>
                                      );
                                    })
                                  }
                                </div>
                              </td>

                              {/* Actions */}
                              <td style={{ position: 'relative' }}>
                                <motion.button className="btn btn-icon-sm btn-secondary" whileTap={{ scale: 0.95 }}
                                  onClick={(ev) => { ev.stopPropagation(); setEmpMenu(empMenu === e.enroll_number ? null : e.enroll_number); }}>
                                  <MoreVertical size={14} />
                                </motion.button>
                                <AnimatePresence>
                                  {empMenu === e.enroll_number && (
                                    <motion.div className="emp-context-menu"
                                      initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.9, y: -4 }} transition={{ duration: 0.15 }}
                                      style={{
                                        position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                                        background: 'rgba(24,24,32,0.95)', backdropFilter: 'blur(16px)',
                                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
                                        padding: '4px', minWidth: 140, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                                      }}
                                      onClick={(ev) => ev.stopPropagation()}>
                                      <button className="emp-ctx-item" onClick={() => { setEmpMenu(null); openEdit(e); }}><Pencil size={13} /> Edit</button>
                                      <button className="emp-ctx-item" onClick={() => openProfile(e.enroll_number)}><Eye size={13} /> Profile</button>
                                      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '2px 6px' }} />
                                      <button className="emp-ctx-item danger" onClick={() => { setEmpMenu(null); handleDelete(e.enroll_number); }}><Trash2 size={13} /> Deactivate</button>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </motion.div>
        }
      </div>

      {/* Add/Edit Modal — 4-Tab Form */}
      <AnimatePresence>
        {showModal && (
          <motion.div className="modal-overlay" onClick={() => { setShowModal(false); setFormTab(0); }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" onClick={e => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}
              style={{ maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

              <div className="modal-header">
                <h3 className="modal-title">{editEmp ? 'Edit' : 'Add'} Employee</h3>
                <button className="btn btn-icon btn-secondary" onClick={() => { setShowModal(false); setFormTab(0); }}><X size={14} /></button>
              </div>

              {/* Tab nav */}
              <div style={{
                display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
                padding: '0 20px', flexShrink: 0,
              }}>
                {['📋 Basic', '📞 Contact', '⚙️ Work', '🏦 Bank & IDs'].map((label, i) => (
                  <button key={i} onClick={() => setFormTab(i)} style={{
                    padding: '10px 14px', fontSize: 12, fontWeight: formTab === i ? 600 : 400,
                    color: formTab === i ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                    borderBottom: formTab === i ? '2px solid #a78bfa' : '2px solid transparent',
                    background: 'none', border: 'none', cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}>{label}</button>
                ))}
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                {/* ── Tab 0: Basic Info ── */}
                {formTab === 0 && (<>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Enroll Number *</label>
                      <input className="input" type="number" placeholder="e.g. 103" value={form.enroll_number}
                        onChange={e => setForm({ ...form, enroll_number: e.target.value })} disabled={!!editEmp} />
                    </div>
                    <div className="input-group">
                      <label>Full Name *</label>
                      <input className="input" placeholder="e.g. Rahul Sharma" value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Father's Name</label>
                    <input className="input" placeholder="e.g. Suresh Sharma" value={form.father_name}
                      onChange={e => setForm({ ...form, father_name: e.target.value })} />
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Date of Birth</label>
                      <input className="input" type="date" value={form.date_of_birth}
                        onChange={e => setForm({ ...form, date_of_birth: e.target.value })} />
                    </div>
                    <div className="input-group">
                      <label>Gender</label>
                      <select className="input" value={form.gender}
                        onChange={e => setForm({ ...form, gender: e.target.value })}>
                        <option value="">— Select —</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Blood Group</label>
                      <select className="input" value={form.blood_group}
                        onChange={e => setForm({ ...form, blood_group: e.target.value })}>
                        <option value="">— Select —</option>
                        {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => (
                          <option key={bg} value={bg}>{bg}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group">
                      <label>Joining Date</label>
                      <input className="input" type="date" value={form.joining_date}
                        onChange={e => setForm({ ...form, joining_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Department</label>
                      <input className="input" list="dept-list" placeholder="Engineering" value={form.department}
                        onChange={e => setForm({ ...form, department: e.target.value })} />
                      <datalist id="dept-list">
                        {departments.map(d => <option key={d} value={d} />)}
                      </datalist>
                    </div>
                    <div className="input-group">
                      <label>Designation</label>
                      <input className="input" placeholder="Manager" value={form.designation}
                        onChange={e => setForm({ ...form, designation: e.target.value })} />
                    </div>
                  </div>
                </>)}

                {/* ── Tab 1: Contact ── */}
                {formTab === 1 && (<>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Mobile Number</label>
                      <input className="input" type="tel" placeholder="9876543210" value={form.mobile_number}
                        onChange={e => setForm({ ...form, mobile_number: e.target.value })} />
                    </div>
                    <div className="input-group">
                      <label>Emergency Contact</label>
                      <input className="input" type="tel" placeholder="9876543211" value={form.emergency_contact}
                        onChange={e => setForm({ ...form, emergency_contact: e.target.value })} />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Email</label>
                    <input className="input" type="email" placeholder="rahul@example.com" value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="input-group">
                    <label>Permanent Address</label>
                    <textarea className="input" rows={2} placeholder="House no, Street, City, State, PIN"
                      value={form.permanent_address}
                      onChange={e => setForm({ ...form, permanent_address: e.target.value })}
                      style={{ resize: 'vertical', minHeight: 48 }} />
                  </div>
                  <div className="input-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      Current Address
                      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 400 }}>
                        <input type="checkbox" checked={form.same_address}
                          onChange={e => setForm({ ...form, same_address: e.target.checked, current_address: e.target.checked ? form.permanent_address : form.current_address })}
                          style={{ width: 13, height: 13 }} />
                        Same as permanent
                      </label>
                    </label>
                    <textarea className="input" rows={2} placeholder="House no, Street, City, State, PIN"
                      value={form.same_address ? form.permanent_address : form.current_address}
                      onChange={e => setForm({ ...form, current_address: e.target.value })}
                      disabled={form.same_address}
                      style={{ resize: 'vertical', minHeight: 48, opacity: form.same_address ? 0.5 : 1 }} />
                  </div>
                </>)}

                {/* ── Tab 2: Work Config ── */}
                {formTab === 2 && (<>
                  <div className="input-group">
                    <label>Card Number</label>
                    <input className="input" placeholder="Biometric card ID" value={form.card_number}
                      onChange={e => setForm({ ...form, card_number: e.target.value })} />
                  </div>

                  {/* Track attendance + primary device: only if on 2+ devices */}
                  {(() => {
                    const enrollNum = parseInt(form.enroll_number);
                    const empDevCount = deviceUsers.filter(du => du.enroll_number === enrollNum).length;
                    if (empDevCount < 2) return null;
                    return (<>
                      <div className="input-group" style={{
                        background: 'rgba(139,92,246,0.06)', borderRadius: 10, padding: 14,
                        border: '1px solid rgba(139,92,246,0.12)',
                      }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
                          <input type="checkbox" checked={form.track_attendance}
                            onChange={e => setForm({ ...form, track_attendance: e.target.checked })}
                            style={{ width: 16, height: 16 }} />
                          Track Attendance
                        </label>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                          {form.track_attendance
                            ? 'Punches count for daily attendance.'
                            : 'Access Only — punches logged for audit, not counted as attendance.'}
                        </p>
                      </div>
                      {form.track_attendance && (
                        <div className="input-group">
                          <label>Primary Device</label>
                          <select className="input" value={form.primary_device_id}
                            onChange={e => setForm({ ...form, primary_device_id: e.target.value })}>
                            <option value="">— Auto (any device) —</option>
                            {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>
                            Attendance tracked from this device. Other devices logged as access.
                          </p>
                        </div>
                      )}
                    </>);
                  })()}

                  {/* Shift times */}
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Shift Start</label>
                      <input className="input" type="time" value={form.shift_start}
                        onChange={e => setForm({ ...form, shift_start: e.target.value })} />
                    </div>
                    <div className="input-group">
                      <label>Shift End</label>
                      <input className="input" type="time" value={form.shift_end}
                        onChange={e => setForm({ ...form, shift_end: e.target.value })} />
                    </div>
                  </div>
                </>)}

                {/* ── Tab 3: Bank & IDs ── */}
                {formTab === 3 && (<>
                  <div className="input-group">
                    <label>Base Salary (₹ / month)</label>
                    <input className="input" type="number" placeholder="25000" value={form.base_salary}
                      onChange={e => setForm({ ...form, base_salary: e.target.value })} />
                  </div>
                  <div style={{
                    background: 'rgba(52,211,153,0.05)', borderRadius: 10, padding: 14,
                    border: '1px solid rgba(52,211,153,0.12)', marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#34d399', marginBottom: 10 }}>🏦 Bank Details</div>
                    <div className="input-group" style={{ marginBottom: 8 }}>
                      <label>Account Number</label>
                      <input className="input" placeholder="1234567890123456" value={form.bank_account_no}
                        onChange={e => setForm({ ...form, bank_account_no: e.target.value })} />
                    </div>
                    <div className="grid-2">
                      <div className="input-group">
                        <label>IFSC Code</label>
                        <input className="input" placeholder="SBIN0001234" value={form.bank_ifsc}
                          onChange={e => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })}
                          style={{ textTransform: 'uppercase' }} />
                      </div>
                      <div className="input-group">
                        <label>Bank Name</label>
                        <input className="input" placeholder="State Bank of India" value={form.bank_name}
                          onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                      </div>
                    </div>
                  </div>
                  <div style={{
                    background: 'rgba(96,165,250,0.05)', borderRadius: 10, padding: 14,
                    border: '1px solid rgba(96,165,250,0.12)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', marginBottom: 10 }}>📄 Statutory IDs</div>
                    <div className="grid-2">
                      <div className="input-group">
                        <label>PAN Number</label>
                        <input className="input" placeholder="ABCDE1234F" value={form.pan_number}
                          onChange={e => setForm({ ...form, pan_number: e.target.value.toUpperCase() })}
                          style={{ textTransform: 'uppercase' }} />
                      </div>
                      <div className="input-group">
                        <label>UAN Number</label>
                        <input className="input" placeholder="100123456789" value={form.uan_number}
                          onChange={e => setForm({ ...form, uan_number: e.target.value })} />
                      </div>
                    </div>
                    <div className="input-group">
                      <label>Aadhaar Number</label>
                      <input className="input" placeholder="1234 5678 9012" value={form.aadhaar_number}
                        onChange={e => setForm({ ...form, aadhaar_number: e.target.value })} maxLength={14} />
                    </div>
                  </div>
                </>)}
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {formTab > 0 && (
                    <button className="btn btn-secondary" onClick={() => setFormTab(t => t - 1)} style={{ fontSize: 12 }}>
                      ← Back
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => { setShowModal(false); setFormTab(0); }}>Cancel</button>
                  {formTab < 3 ? (
                    <motion.button className="btn btn-primary" whileTap={{ scale: 0.96 }}
                      onClick={() => setFormTab(t => t + 1)}>
                      Next →
                    </motion.button>
                  ) : (
                    <motion.button className="btn btn-primary" whileTap={{ scale: 0.96 }}
                      onClick={handleSave} disabled={!form.enroll_number || !form.name}>
                      {editEmp ? 'Update' : 'Add Employee'}
                    </motion.button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Employee Profile Slide-over */}
      <AnimatePresence>
        {profileModal && (
          <EmployeeProfile
            enrollNumber={profileModal.enrollNumber}
            employees={employees}
            devices={devices}
            punches={profileData.punches}
            holidays={profileData.holidays}
            rules={profileData.rules}
            modifications={profileData.modifications}
            onClose={() => setProfileModal(null)}
            onEdit={(emp) => { setProfileModal(null); openEdit(emp); }}
          />
        )}
      </AnimatePresence>

      {/* Click-away handler for 3-dot menus */}
      {empMenu !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          onClick={() => setEmpMenu(null)} />
      )}

      {/* ══════ CSV Import Modal ══════ */}
      <AnimatePresence>
        {showCsvModal && (
          <motion.div className="modal-overlay" onClick={() => setShowCsvModal(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" onClick={e => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}
              style={{ maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

              {/* Header */}
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Table2 size={18} color="#a78bfa" />
                  </div>
                  <div>
                    <h3 className="modal-title" style={{ margin: 0 }}>Bulk Import Employees</h3>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0 }}>CSV or tab-separated • upserts on enroll_number</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <motion.button className="btn btn-secondary" whileTap={{ scale: 0.95 }} onClick={downloadTemplate}
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Download size={13} /> Template
                  </motion.button>
                  <button className="btn btn-icon btn-secondary" onClick={() => setShowCsvModal(false)}><X size={14} /></button>
                </div>
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>

                {/* Column legend */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14,
                  padding: '10px 12px', borderRadius: 8, background: 'rgba(139,92,246,0.06)',
                  border: '1px solid rgba(139,92,246,0.12)',
                }}>
                  <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600, marginRight: 4, whiteSpace: 'nowrap' }}>Expected columns:</span>
                  {['enroll_number *', 'name *', 'father_name', 'date_of_birth', 'gender', 'blood_group',
                    'department', 'designation', 'joining_date', 'mobile_number', 'email',
                    'shift_start', 'shift_end', 'base_salary', 'pan_number', 'aadhaar_number', 'uan_number',
                    'bank_account_no', 'bank_ifsc', 'bank_name'].map(col => (
                    <span key={col} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 5,
                      background: col.includes('*') ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.04)',
                      color: col.includes('*') ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
                      border: `1px solid ${col.includes('*') ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.06)'}`,
                      fontFamily: 'monospace',
                    }}>{col}</span>
                  ))}
                </div>

                {/* Input area */}
                <div className="input-group" style={{ marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Paste CSV / Upload File</span>
                    <label style={{
                      fontSize: 11, color: '#a78bfa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(139,92,246,0.3)',
                      background: 'rgba(139,92,246,0.08)',
                    }}>
                      <Upload size={11} /> Browse file
                      <input type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }}
                        onChange={e => {
                          const file = e.target.files[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => { const text = ev.target.result; setCsvText(text); previewCSV(text); };
                          reader.readAsText(file); e.target.value = '';
                        }} />
                    </label>
                  </label>
                  <textarea
                    className="input"
                    rows={6}
                    placeholder={`Paste CSV data here. First row must be headers.\nExample:\nenroll_number,name,department,joining_date\n101,Rahul Sharma,Engineering,2024-01-01`}
                    value={csvText}
                    onChange={e => { setCsvText(e.target.value); previewCSV(e.target.value); }}
                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 11, minHeight: 110 }}
                  />
                </div>

                {/* Errors */}
                {csvErrors.length > 0 && (
                  <div style={{
                    borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                    background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#f87171', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} /> {csvErrors.length} parse error{csvErrors.length !== 1 ? 's' : ''}
                    </div>
                    {csvErrors.map((err, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'monospace', marginBottom: 2 }}>• {err}</div>
                    ))}
                  </div>
                )}

                {/* Preview table */}
                {csvRows.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={14} /> {csvRows.length} valid row{csvRows.length !== 1 ? 's' : ''} ready to import
                      </span>
                      {csvRows.length > 10 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Showing first 10</span>}
                    </div>
                    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                            {['#', 'Name', 'Dept', 'Designation', 'Mobile', 'Shift', 'Salary'].map(h => (
                              <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.slice(0, 10).map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '6px 10px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>{row.enroll_number}</td>
                              <td style={{ padding: '6px 10px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>{row.name}</td>
                              <td style={{ padding: '6px 10px', color: 'rgba(255,255,255,0.6)' }}>{row.department || '—'}</td>
                              <td style={{ padding: '6px 10px', color: 'rgba(255,255,255,0.6)' }}>{row.designation || '—'}</td>
                              <td style={{ padding: '6px 10px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>{row.mobile_number || '—'}</td>
                              <td style={{ padding: '6px 10px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{row.shift_start?.slice(0,5)}–{row.shift_end?.slice(0,5)}</td>
                              <td style={{ padding: '6px 10px', color: '#34d399', fontWeight: 600 }}>{row.base_salary > 0 ? `₹${row.base_salary.toLocaleString('en-IN')}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Done state */}
                {csvDone && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    style={{
                      marginTop: 14, padding: '14px 16px', borderRadius: 10,
                      background: csvDone.fail === 0 ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)',
                      border: `1px solid ${csvDone.fail === 0 ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'}`,
                    }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: csvDone.fail === 0 ? '#34d399' : '#fbbf24', marginBottom: 4 }}>
                      {csvDone.fail === 0 ? '✅ Import complete!' : '⚠️ Partial import'}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      {csvDone.ok} imported successfully{csvDone.fail > 0 ? ` · ${csvDone.fail} failed (check console)` : ''}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                  Existing employees (same ID) will be updated, new ones added.
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => setShowCsvModal(false)}>Close</button>
                  <motion.button
                    className="btn btn-primary"
                    whileTap={{ scale: 0.96 }}
                    onClick={handleCsvImport}
                    disabled={csvRows.length === 0 || csvImporting}
                    style={{ minWidth: 120 }}
                  >
                    {csvImporting
                      ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginRight: 6 }} />Importing…</>
                      : <><Upload size={13} /> Import {csvRows.length > 0 ? `${csvRows.length} rows` : ''}</>
                    }
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
