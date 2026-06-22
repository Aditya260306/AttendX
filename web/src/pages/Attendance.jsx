import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Clock, Search, Download, RefreshCw,
  CheckSquare, X, Users, AlertTriangle, Zap, Monitor,
  ArrowUpDown, ArrowUp, ArrowDown, Info, RotateCcw,
  UserCheck, UserX, Pencil, MoreVertical, Loader, CheckCircle, CloudOff
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format, subDays, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  generateDateRangeArray,
  buildRoster,
  getStatusColor,
  getXlsxColor,
} from '../utils/attendance-helpers';
import EmployeeProfile from './EmployeeProfile';

const fadeUp = (d = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: d, duration: 0.3 },
});

export default function Attendance() {
  // ─── State ─────────────────────────────────────────────
  const [employees, setEmployees] = useState([]);
  const [punches, setPunches] = useState([]);
  const [holidays, setHolidays] = useState([]);
    const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState(() => {
    const saved = localStorage.getItem('attn_start');
    if (saved) return saved;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });

  const [endDate, setEndDate] = useState(() => {
    return localStorage.getItem('attn_end') || format(new Date(), 'yyyy-MM-dd');
  });

  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedCells, setSelectedCells] = useState(new Set());
  const lastClickedRef = useRef(null); // { empIdx, dayIdx } for shift-click range
  const [bulkModal, setBulkModal] = useState(null); // { inTime, outTime } for bulk modify

  // ─── Optimistic UI State Removed (Using Realtime) ──────
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' }); // key: 'name'|'id'|'device', dir: 'asc'|'desc'

  // Context menu
  const [ctxMenu, setCtxMenu] = useState(null);
  // Punch edit modal
  const [editModal, setEditModal] = useState(null);
  // Details modal (audit trail)
    // Modification records
    // Employee profile modal
  const [profileModal, setProfileModal] = useState(null); // { enrollNumber }
  // 3-dot menu for employee row
  const [empMenu, setEmpMenu] = useState(null); // { enrollNumber }

  // Persist date range
  useEffect(() => {
    localStorage.setItem('attn_start', startDate);
    localStorage.setItem('attn_end', endDate);
  }, [startDate, endDate]);

  // ─── Data Fetching ─────────────────────────────────────
  const dateRange = useMemo(() => generateDateRangeArray(startDate, endDate), [startDate, endDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const startStr = startDate + ' 00:00:00';
    const endStr = endDate + ' 23:59:59';

    const [empRes, punchRes, holRes, devRes] = await Promise.all([
      supabase.from('employees').select('enroll_number, name, department, designation, shift_start, shift_end, is_deleted, track_attendance, primary_device_id, joining_date, base_salary').order('name'),
      supabase.from('raw_punches')
        .select('enroll_number, punch_time, device_id, is_deleted')
        .gte('punch_time', startStr)
        .lte('punch_time', endStr)
        .order('punch_time'),
      supabase.from('holidays').select('*'),
      supabase.from('devices').select('id, name').eq('is_active', true),
    ]);

    const trackableEmps = (empRes.data || []).filter(e => e.track_attendance !== false && e.is_deleted === false);
    setEmployees(trackableEmps);
    setPunches(punchRes.data || []);
    console.log('[fetchData] punches:', (punchRes.data || []).length);
    setHolidays(holRes.data || []);
        setDevices(devRes.data || []);
        setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
    
    // Subscribe to realtime punches
    const channel = supabase.channel('punches_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_punches' }, (payload) => {
        console.log('[Realtime] raw_punches event:', payload);
        fetchData(); // Simplest way to recalculate roster reliably
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // ─── Roster Computation ────────────────────────────────
  const activePunches = useMemo(() => {
    let filtered = punches.filter(p => !p.is_deleted);
    if (deviceFilter !== 'all') {
      filtered = filtered.filter(p => String(p.device_id) === deviceFilter);
    }
    return filtered;
  }, [punches, deviceFilter]);

  // Set of modified cells removed (no longer highlighting them manually to reduce complexity)

  const roster = useMemo(() => {
    if (!employees.length || !dateRange.length) return [];
    return buildRoster(employees, activePunches, holidays, null, dateRange);
  }, [employees, activePunches, holidays, dateRange]);

  const filteredRoster = useMemo(() => {
    let result = roster;

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(emp =>
        emp.name?.toLowerCase().includes(s) ||
        String(emp.enroll_number).includes(s) ||
        emp.department?.toLowerCase().includes(s)
      );
    }

    // Status filter
    if (statusFilter === 'Absentees') {
      result = result.filter(emp => emp.summary.A > 0);
    } else if (statusFilter === 'Late Arrivals') {
      result = result.filter(emp => emp.days.some(d => d.isLate));
    } else if (statusFilter === 'Present Today') {
      const today = format(new Date(), 'yyyy-MM-dd');
      result = result.filter(emp => emp.days.find(d => d.dateStr === today)?.status === 'P' || emp.days.find(d => d.dateStr === today)?.status === 'L');
    }

    // Sorting
    result = [...result].sort((a, b) => {
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      if (sortConfig.key === 'name') return dir * (a.name || '').localeCompare(b.name || '');
      if (sortConfig.key === 'id') return dir * (a.enroll_number - b.enroll_number);
      if (sortConfig.key === 'device') {
        const adev = employees.find(e => e.enroll_number === a.enroll_number)?.primary_device_id || 0;
        const bdev = employees.find(e => e.enroll_number === b.enroll_number)?.primary_device_id || 0;
        return dir * (adev - bdev);
      }
      return 0;
    });

    return result;
  }, [roster, search, statusFilter, sortConfig, employees]);

  // ─── Cell Selection (with Shift+Click range) ──────────
  const handleCellClick = useCallback((e, empIdx, dayIdx) => {
    const emp = filteredRoster[empIdx];
    const day = emp?.days[dayIdx];
    if (!emp || !day) return;
    const key = `${emp.enroll_number}:${day.dateStr}`;

    if (e.shiftKey && lastClickedRef.current) {
      // Range select: from anchor to this cell
      const anchor = lastClickedRef.current;
      const minEmp = Math.min(anchor.empIdx, empIdx);
      const maxEmp = Math.max(anchor.empIdx, empIdx);
      const minDay = Math.min(anchor.dayIdx, dayIdx);
      const maxDay = Math.max(anchor.dayIdx, dayIdx);

      setSelectedCells(prev => {
        const next = new Set(prev);
        for (let ei = minEmp; ei <= maxEmp; ei++) {
          const r = filteredRoster[ei];
          if (!r) continue;
          for (let di = minDay; di <= maxDay; di++) {
            const d = r.days[di];
            if (!d) continue;
            next.add(`${r.enroll_number}:${d.dateStr}`);
          }
        }
        return next;
      });
    } else {
      // Normal toggle
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      lastClickedRef.current = { empIdx, dayIdx };
    }
  }, [filteredRoster]);

  const clearSelection = useCallback(() => {
    setSelectedCells(new Set());
    lastClickedRef.current = null;
  }, []);

  // ─── Bulk Actions ─────────────────────────────────────
  // Parse selected cells into { enrollNumber, dateStr, day } items
  function getSelectedItems() {
    const items = [];
    for (const key of selectedCells) {
      const [enStr, dateStr] = key.split(':');
      const enrollNumber = parseInt(enStr, 10);
      const emp = filteredRoster.find(e => e.enroll_number === enrollNumber);
      if (!emp) continue;
      const day = emp.days.find(d => d.dateStr === dateStr);
      if (!day) continue;
      items.push({ enrollNumber, dateStr, day, emp });
    }
    return items;
  }

  // ─── Simplified Syncing ─────────────────────────────────
  async function runBulkSync(items, execFn) {
    const promises = items.map(async (item) => {
      try {
        await execFn(item);
      } catch (err) {
        console.error('Sync failed for', item, err);
      }
    });
    await Promise.allSettled(promises);
    await fetchData();
  }

  async function bulkMarkPresent() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    clearSelection();
    await runBulkSync(items, ({ enrollNumber, dateStr, day }) => _doMarkPresent(enrollNumber, dateStr, day));
  }

  async function bulkMarkAbsent() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    clearSelection();
    await runBulkSync(items, ({ enrollNumber, dateStr, day }) => _doMarkAbsent(enrollNumber, dateStr, day));
  }

  async function bulkSavePunch() {
    if (!bulkModal) return;
    const items = getSelectedItems();
    if (items.length === 0) return;
    const { inTime, outTime } = bulkModal;
    setBulkModal(null);
    clearSelection();

    await runBulkSync(items, async ({ enrollNumber, dateStr, day, emp }) => {
      const deviceId = emp.primary_device_id || (devices.length > 0 ? devices[0].id : null);
      
      await supabase.from('raw_punches').update({ is_deleted: false, deleted_at: null, deleted_by: null, delete_reason: null })
        .eq('enroll_number', enrollNumber).gte('punch_time', dateStr + ' 00:00:00').lte('punch_time', dateStr + ' 23:59:59');
      await supabase.from('raw_punches').delete()
        .eq('enroll_number', enrollNumber).gte('punch_time', dateStr + ' 00:00:00').lte('punch_time', dateStr + ' 23:59:59');
      const inserts = [];
      if (inTime) inserts.push({ enroll_number: enrollNumber, punch_time: `${dateStr} ${inTime}:00`, device_id: deviceId, is_deleted: false });
      if (outTime && outTime !== inTime) inserts.push({ enroll_number: enrollNumber, punch_time: `${dateStr} ${outTime}:00`, device_id: deviceId, is_deleted: false });
      if (inserts.length > 0) await supabase.from('raw_punches').insert(inserts);
    });
  }

  // ─── Aggregated Stats ──────────────────────────────────
  const todayStats = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    let present = 0, absent = 0, late = 0;
    for (const emp of roster) {
      const d = emp.days.find(d => d.dateStr === today);
      if (!d) continue;
      if (d.status === 'P' || d.status === 'L' || d.status === 'HD') present++;
      if (d.status === 'A') absent++;
      if (d.isLate) late++;
    }
    return { present, absent, late, total: roster.length };
  }, [roster]);

  // ─── Quick Date Presets ────────────────────────────────
  function setThisMonth() {
    const now = new Date();
    setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
    setEndDate(format(now, 'yyyy-MM-dd'));
  }
  function setLastMonth() {
    const last = new Date();
    last.setMonth(last.getMonth() - 1);
    setStartDate(format(startOfMonth(last), 'yyyy-MM-dd'));
    setEndDate(format(endOfMonth(last), 'yyyy-MM-dd'));
  }
  function setLast7Days() {
    setStartDate(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
    setEndDate(format(new Date(), 'yyyy-MM-dd'));
  }

  // ─── Sort Toggle ────────────────────────────────────────
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

  // ─── Employee Profile ──────────────────────────────────
  function openProfile(enrollNumber) {
    setProfileModal({ enrollNumber });
    setEmpMenu(null);
  }

  // Click away for empMenu
  useEffect(() => {
    if (!empMenu) return;
    const handler = (e) => {
      if (!e.target.closest('.emp-menu-popup') && !e.target.closest('.emp-menu-btn')) {
        setEmpMenu(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [empMenu]);

  // ─── Mark as Absent (soft delete + audit) ─────────────
  // Silent DB-only helper (no UI refresh)
  async function _doMarkAbsent(enrollNumber, dateStr, day) {
    
    const { error: updErr } = await supabase.from('raw_punches')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'admin', delete_reason: 'mark_absent' })
      .eq('enroll_number', enrollNumber)
      .gte('punch_time', dateStr + ' 00:00:00')
      .lte('punch_time', dateStr + ' 23:59:59');
    if (updErr) console.error('markAbsent update error:', updErr);
  }
  // UI wrapper (single-cell context menu)
  async function markAbsent(enrollNumber, dateStr, day) {
    try {
      console.log('[markAbsent]', { enrollNumber, dateStr, day });
      await _doMarkAbsent(enrollNumber, dateStr, day);
      setCtxMenu(null);
      await fetchData();
      console.log('[markAbsent] done');
    } catch (err) {
      console.error('markAbsent crashed:', err);
    }
  }

  // ─── Mark as Present (insert default shift punches + audit) ─
  // Silent DB-only helper (no UI refresh)
  async function _doMarkPresent(enrollNumber, dateStr, day) {
    const emp = employees.find(e => e.enroll_number === enrollNumber);
    const inTime = emp?.shift_start?.substring(0, 5) || '09:00';
    const outTime = emp?.shift_end?.substring(0, 5) || '18:00';
    const deviceId = emp?.primary_device_id || (devices.length > 0 ? devices[0].id : null);

    

    await supabase.from('raw_punches')
      .update({ is_deleted: false, deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('enroll_number', enrollNumber)
      .gte('punch_time', dateStr + ' 00:00:00')
      .lte('punch_time', dateStr + ' 23:59:59');

    await supabase.from('raw_punches')
      .delete()
      .eq('enroll_number', enrollNumber)
      .gte('punch_time', dateStr + ' 00:00:00')
      .lte('punch_time', dateStr + ' 23:59:59');

    await supabase.from('raw_punches').insert([
      { enroll_number: enrollNumber, punch_time: `${dateStr} ${inTime}:00`, device_id: deviceId, is_deleted: false },
      { enroll_number: enrollNumber, punch_time: `${dateStr} ${outTime}:00`, device_id: deviceId, is_deleted: false },
    ]);
  }
  // UI wrapper (single-cell context menu)
  async function markPresent(enrollNumber, dateStr, day) {
    try {
      console.log('[markPresent]', { enrollNumber, dateStr, day });
      await _doMarkPresent(enrollNumber, dateStr, day);
      setCtxMenu(null);
      await fetchData();
      console.log('[markPresent] done');
    } catch (err) {
      console.error('markPresent crashed:', err);
    }
  }

  

  // ─── Save Punch (Modify — add/edit with audit) ────────
  async function savePunch() {
    if (!editModal) return;
    const { enroll, dateStr, inTime, outTime, originalIn, originalOut } = editModal;
    const emp = employees.find(e => e.enroll_number === enroll);
    const deviceId = emp?.primary_device_id || (devices.length > 0 ? devices[0].id : null);

    // (Audit log logic removed as part of schema update)

    // Un-soft-delete first, then hard-delete all
    await supabase.from('raw_punches')
      .update({ is_deleted: false, deleted_at: null, deleted_by: null, delete_reason: null })
      .eq('enroll_number', enroll)
      .gte('punch_time', dateStr + ' 00:00:00')
      .lte('punch_time', dateStr + ' 23:59:59');

    await supabase.from('raw_punches')
      .delete()
      .eq('enroll_number', enroll)
      .gte('punch_time', dateStr + ' 00:00:00')
      .lte('punch_time', dateStr + ' 23:59:59');

    const inserts = [];
    if (inTime) inserts.push({ enroll_number: enroll, punch_time: `${dateStr} ${inTime}:00`, device_id: deviceId, is_deleted: false });
    if (outTime && outTime !== inTime) inserts.push({ enroll_number: enroll, punch_time: `${dateStr} ${outTime}:00`, device_id: deviceId, is_deleted: false });
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('raw_punches').insert(inserts);
      if (insErr) console.error('Modify insert error:', insErr);
    }

    setEditModal(null);
    fetchData();
  }

  // ─── Context Menu ──────────────────────────────────────
  function handleCellRightClick(e, emp, day) {
    e.preventDefault();
    e.stopPropagation();
    const cellKey = `${emp.enroll_number}:${day.dateStr}`;
    setCtxMenu({ x: e.clientX, y: e.clientY, enroll: emp.enroll_number, name: emp.name, dateStr: day.dateStr, day });
  }

  function openEditModal() {
    if (!ctxMenu) return;
    const { enroll, name, dateStr, day } = ctxMenu;
    setEditModal({
      enroll, name, dateStr,
      inTime: day.checkIn ? day.checkIn.substring(0, 5) : '',
      outTime: day.checkOut ? day.checkOut.substring(0, 5) : '',
      originalIn: day.checkIn || '',
      originalOut: day.checkOut || '',
    });
    setCtxMenu(null);
  }

  

  // Close context menu on any click
  useEffect(() => {
    const close = () => setCtxMenu(null);
    if (ctxMenu) window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  // ─── Excel Export ──────────────────────────────────────
  async function handleExport() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AttendX';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Attendance', {
      properties: { defaultRowHeight: 22 },
    });

    // ── Design tokens ────────────────────────────────────
    const BRAND      = 'FF4338CA'; // indigo-700
    const BRAND_LITE = 'FFEEF2FF'; // indigo-50
    const DARK       = 'FF1E293B'; // slate-800
    const DARK_MED   = 'FF334155'; // slate-700
    const WHITE      = 'FFFFFFFF';
    const BORDER     = 'FFE2E8F0'; // slate-200
    const BORDER_MED = 'FFCBD5E1'; // slate-300
    const GRAY_BG    = 'FFF8FAFC'; // slate-50
    const SUMMARY_BG = 'FFF1F5F9'; // slate-100
    const thinBorder = (color = BORDER) => ({
      top: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    });

    // ── Column widths ─────────────────────────────────────
    const totalCols = 2 + dateRange.length + 5; // ID, Name, ...dates, P, A, L, HD, WO
    ws.getColumn(1).width = 8;   // ID
    ws.getColumn(2).width = 26;  // Name
    dateRange.forEach((_, i) => { ws.getColumn(i + 3).width = 13; });
    for (let s = 0; s < 5; s++) ws.getColumn(dateRange.length + 3 + s).width = 6;

    // ── Row 1: Company Name ──────────────────────────────
    ws.mergeCells(1, 1, 1, totalCols);
    const companyCell = ws.getCell('A1');
    companyCell.value = 'Building Solutions (India) Pvt. Ltd.';
    companyCell.font = { bold: true, size: 14, color: { argb: DARK } };
    companyCell.alignment = { vertical: 'middle', horizontal: 'left' };
    companyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
    ws.getRow(1).height = 30;

    // ── Row 2: Report Title + Month ──────────────────────
    const sDate = parseISO(startDate);
    const eDate = parseISO(endDate);
    const monthName = format(sDate, 'MMMM yyyy');
    const rangeStr = `${format(sDate, 'dd MMM yyyy')} — ${format(eDate, 'dd MMM yyyy')}`;

    ws.mergeCells(2, 1, 2, totalCols);
    const titleCell = ws.getCell('A2');
    titleCell.value = `Attendance Report  •  ${monthName}`;
    titleCell.font = { bold: true, size: 11, color: { argb: BRAND } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LITE } };
    ws.getRow(2).height = 24;

    // ── Row 3: Meta details ──────────────────────────────
    ws.mergeCells(3, 1, 3, totalCols);
    const metaCell = ws.getCell('A3');
    metaCell.value = `Period: ${rangeStr}  |  Employees: ${filteredRoster.length}  |  Generated: ${format(new Date(), 'dd MMM yyyy, hh:mm a')}`;
    metaCell.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
    metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
    ws.getRow(3).height = 20;

    // ── Row 4: Empty spacer ──────────────────────────────
    ws.getRow(4).height = 6;

    // ── Row 5: Day Name sub-header (Mon, Tue, …) ─────────
    const dayNameRow = ws.getRow(5);
    dayNameRow.height = 18;
    ws.getCell(5, 1).value = '';
    ws.getCell(5, 2).value = '';
    dateRange.forEach((d, i) => {
      const dt = parseISO(d);
      const dayAbr = format(dt, 'EEE').toUpperCase(); // MON, TUE…
      const cell = ws.getCell(5, i + 3);
      cell.value = dayAbr;
      cell.font = { bold: true, size: 7.5, color: { argb: 'FF94A3B8' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
    });
    // Summary sub-header labels
    ['P', 'A', 'L', 'HD', 'WO'].forEach((lbl, si) => {
      const cell = ws.getCell(5, dateRange.length + 3 + si);
      cell.value = '';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
    });

    // ── Row 6: Main header (ID, Name, date numbers, summaries) ─
    const hdrRowNum = 6;
    const hdrRow = ws.getRow(hdrRowNum);
    hdrRow.height = 28;

    // ID
    ws.getCell(hdrRowNum, 1).value = 'ID';
    // Name
    ws.getCell(hdrRowNum, 2).value = 'EMPLOYEE';
    // Date numbers
    const weekendDays = (rules?.weekend_days || ['Sunday']).map(d => d.toLowerCase());
    dateRange.forEach((d, i) => {
      const dt = parseISO(d);
      const dayNum = dt.getDate();
      const cell = ws.getCell(hdrRowNum, i + 3);
      cell.value = dayNum;
      // Weekend columns get a subtle tint
      const fullDay = format(dt, 'EEEE').toLowerCase();
      if (weekendDays.includes(fullDay)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      }
    });
    // Summary headers
    const summaryLabels = ['P', 'A', 'L', 'HD', 'WO'];
    summaryLabels.forEach((lbl, si) => {
      ws.getCell(hdrRowNum, dateRange.length + 3 + si).value = lbl;
    });

    // Style entire header row
    hdrRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = { color: { argb: WHITE }, bold: true, size: 9.5 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder(DARK_MED);
      if (!cell.fill || cell.fill.fgColor?.argb !== 'FF334155') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
      }
    });
    // Name left-aligned
    ws.getCell(hdrRowNum, 2).alignment = { vertical: 'middle', horizontal: 'left' };

    // ── Freeze panes: ID + Name frozen, rows 1-6 frozen ──
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: hdrRowNum }];

    // ── Data rows ────────────────────────────────────────
    for (const emp of filteredRoster) {
      const rowArr = [
        emp.enroll_number,
        emp.name,
      ];

      // Day cells
      for (const day of emp.days) {
        let content = day.status;
        if (day.checkIn) {
          content = day.checkIn.substring(0, 5);
          if (day.checkOut && day.checkOut !== day.checkIn) {
            content += ' \u2192 ' + day.checkOut.substring(0, 5);
          }
        }
        rowArr.push(content);
      }

      // Summary cells
      rowArr.push(emp.summary.P);
      rowArr.push(emp.summary.A);
      rowArr.push(emp.days.filter(d => d.isLate).length);
      rowArr.push(emp.summary.HD);
      rowArr.push(emp.summary.WO);

      const row = ws.addRow(rowArr);
      row.height = 24;
      const rowNum = row.number;

      // Style ID cell
      const idCell = ws.getCell(rowNum, 1);
      idCell.font = { size: 9, color: { argb: 'FF64748B' } };
      idCell.alignment = { vertical: 'middle', horizontal: 'center' };
      idCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
      idCell.border = thinBorder();

      // Style Name cell (frozen look)
      const nameCell = ws.getCell(rowNum, 2);
      nameCell.font = { bold: true, size: 10, color: { argb: DARK } };
      nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
      nameCell.border = thinBorder();

      // Style each day cell with calendar colors
      emp.days.forEach((day, idx) => {
        const cell = ws.getCell(rowNum, idx + 3);
        const colors = getXlsxColor(day.status);
        if (colors) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.bg } };
          cell.font = { color: { argb: colors.text }, bold: true, size: 9 };
        } else {
          cell.font = { size: 9, color: { argb: 'FF94A3B8' } };
        }
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = thinBorder();
      });

      // Style summary cells
      summaryLabels.forEach((lbl, si) => {
        const cell = ws.getCell(rowNum, dateRange.length + 3 + si);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { bold: true, size: 9, color: { argb: DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_BG } };
        cell.border = thinBorder(BORDER_MED);
      });
    }

    // ── Bottom border accent ─────────────────────────────
    const lastDataRow = ws.lastRow?.number || hdrRowNum;
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(lastDataRow, c);
      cell.border = {
        ...cell.border,
        bottom: { style: 'medium', color: { argb: BRAND } },
      };
    }

    // ── Legend row ────────────────────────────────────────
    const legendRow = ws.addRow([]);
    legendRow.height = 18;
    const lr = legendRow.number;
    ws.mergeCells(lr, 1, lr, totalCols);
    const legendCell = ws.getCell(lr, 1);
    legendCell.value = 'P = Present  |  A = Absent  |  L = Late  |  HD = Half Day  |  WO = Week Off  |  H = Holiday';
    legendCell.font = { size: 8, italic: true, color: { argb: 'FF94A3B8' } };
    legendCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // ── File name with month ─────────────────────────────
    const fileName = `Attendance_${format(sDate, 'MMM_yyyy')}_${format(sDate, 'dd')}_to_${format(eDate, 'dd')}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);
  }

  // ─── Render ────────────────────────────────────────────
  return (
    <>
      {/* ── Header ── */}
      <div className="page-header"><div className="page-header-inner">
        <div>
          <h2 className="page-title">Attendance Calendar</h2>
          <p className="page-subtitle">
            {format(parseISO(startDate), 'dd MMM')} — {format(parseISO(endDate), 'dd MMM yyyy')} • {todayStats.present}/{todayStats.total} present today
          </p>
        </div>
        <div className="btn-group">
          {selectedCells.size > 0 && (
            <>
            <motion.button className="btn btn-sm" style={{ background: '#16a34a', color: '#fff' }} onClick={bulkMarkPresent}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.96 }}>
              <UserCheck size={12} /> Present ({selectedCells.size})
            </motion.button>
            <motion.button className="btn btn-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={bulkMarkAbsent}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.96 }}>
              <UserX size={12} /> Absent ({selectedCells.size})
            </motion.button>
            <motion.button className="btn btn-sm" style={{ background: '#3b82f6', color: '#fff' }} onClick={() => setBulkModal({ inTime: '', outTime: '' })}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.96 }}>
              <Pencil size={12} /> Modify ({selectedCells.size})
            </motion.button>
            <motion.button className="btn btn-danger btn-sm" onClick={clearSelection}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.96 }}>
              <X size={12} /> Clear
            </motion.button>
            </>
          )}
          <motion.button className="btn btn-secondary" onClick={fetchData} whileTap={{ scale: 0.96 }}>
            <RefreshCw size={13} /> Sync
          </motion.button>
          <motion.button className="btn btn-primary" onClick={handleExport} whileTap={{ scale: 0.96 }}>
            <Download size={13} /> Export .xlsx
          </motion.button>
        </div>
      </div></div>

      <div className="page-body">
        {/* ── Quick Stats ── */}
        <motion.div className="attn-stats-row" {...fadeUp()}>
          <div className="attn-stat">
            <Users size={14} className="stat-i green" />
            <span className="stat-n">{todayStats.present}</span>
            <span className="stat-l">Present</span>
          </div>
          <div className="attn-stat">
            <AlertTriangle size={14} className="stat-i red" />
            <span className="stat-n">{todayStats.absent}</span>
            <span className="stat-l">Absent</span>
          </div>
          <div className="attn-stat">
            <Clock size={14} className="stat-i orange" />
            <span className="stat-n">{todayStats.late}</span>
            <span className="stat-l">Late</span>
          </div>
          <div className="attn-stat">
            <Zap size={14} className="stat-i purple" />
            <span className="stat-n">{todayStats.total}</span>
            <span className="stat-l">Total</span>
          </div>
        </motion.div>

        {/* ── Controls ── */}
        <motion.div {...fadeUp(0.05)} className="calendar-controls">
          <div className="calendar-dates">
            <div className="date-pair">
              <label>From</label>
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <span className="date-sep">→</span>
            <div className="date-pair">
              <label>To</label>
              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="btn-group">
              <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }} onClick={setLast7Days}>7 Days</motion.button>
              <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }} onClick={setThisMonth}>This Month</motion.button>
              <motion.button className="btn btn-xs btn-secondary" whileTap={{ scale: 0.95 }} onClick={setLastMonth}>Last Month</motion.button>
            </div>
          </div>
        </motion.div>

        {/* ── Filter & Sort Bar (Employees-page style) ── */}
        <motion.div {...fadeUp(0.07)} className="emp-filter-bar">
          <div className="emp-filter-search">
            <Search size={14} className="emp-filter-search-icon" />
            <input className="input" placeholder="Search name, ID..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
            {search && <button className="emp-filter-search-clear" onClick={() => setSearch('')}><X size={12} /></button>}
          </div>

          {/* Device chips */}
          <div className="emp-chip-group">
            <button className={`emp-chip ${deviceFilter === 'all' ? 'active' : ''}`} onClick={() => setDeviceFilter('all')}>All Devices</button>
            {devices.map(d => (
              <button key={d.id} className={`emp-chip ${deviceFilter === String(d.id) ? 'active' : ''}`} onClick={() => setDeviceFilter(String(d.id))}>
                <Monitor size={10} /> {d.name}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <select className="input select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 130, height: 30, fontSize: '0.75rem' }}>
            <option value="All">All Status</option>
            <option value="Present Today">Present Today</option>
            <option value="Absentees">Absentees</option>
            <option value="Late Arrivals">Late Arrivals</option>
          </select>

          {/* Sort buttons */}
          <div className="emp-chip-group">
            {[{ key: 'name', label: 'Name' }, { key: 'id', label: 'ID' }, { key: 'device', label: 'Device' }].map(s => {
              const Icon = getSortIcon(s.key);
              return (
                <button key={s.key} className={`emp-chip ${sortConfig.key === s.key ? 'active' : ''}`} onClick={() => toggleSort(s.key)}>
                  <Icon size={10} /> {s.label}
                </button>
              );
            })}
          </div>

          <span className="emp-filter-result-count">{filteredRoster.length} of {roster.length}</span>
        </motion.div>

        {/* ── Calendar Grid ── */}
        <motion.div className="calendar-grid-wrapper" {...fadeUp(0.1)}>
          {loading ? (
            <div className="card-body">{[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 38, marginBottom: 4 }} />)}</div>
          ) : filteredRoster.length === 0 ? (
            <div className="empty-state"><Calendar className="icon" /><p className="message">No employees found</p></div>
          ) : (
            <div className="calendar-scroll-container">
              <table className="calendar-table">
                <thead>
                  <tr>
                    <th className="sticky-col sticky-header name-col">Employee</th>
                    {dateRange.map(dateStr => {
                      const d = parseISO(dateStr);
                      const dayName = format(d, 'EEE');
                      const fullDayName = format(d, 'EEEE');
                      const dayNum = format(d, 'd');
                      const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                      const weekendDays = (rules?.weekend_days || ['Sunday']).map(d => d.toLowerCase());
                      const isWknd = weekendDays.includes(fullDayName.toLowerCase());
                      return (
                        <th key={dateStr} className={`day-header sticky-header ${isToday ? 'today-col' : ''} ${isWknd ? 'weekend-header' : ''}`}>
                          <div className="day-label">{dayName}</div>
                          <div className="day-num">{dayNum}</div>
                        </th>
                      );
                    })}
                    <th className="sticky-header summary-header">P</th>
                    <th className="sticky-header summary-header">A</th>
                    <th className="sticky-header summary-header">L</th>
                    <th className="sticky-header summary-header">HD</th>
                    <th className="sticky-header summary-header">WO</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>{filteredRoster.map((emp, i) => (
                    <motion.tr key={emp.enroll_number}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.015, 0.4) }}>
                      {/* Frozen name column */}
                      <td className="sticky-col name-cell">
                        <div className="emp-avatar">{emp.name?.charAt(0)?.toUpperCase() || '#'}</div>
                        <div className="emp-info">
                          <div className="emp-name">{emp.name}</div>
                          <div className="emp-dept">{emp.department || `#${emp.enroll_number}`}</div>
                        </div>
                        <button className="emp-menu-btn" onClick={(e) => { e.stopPropagation(); setEmpMenu(empMenu?.enrollNumber === emp.enroll_number ? null : { enrollNumber: emp.enroll_number }); }}>
                          <MoreVertical size={12} />
                        </button>
                        <AnimatePresence>{empMenu?.enrollNumber === emp.enroll_number && (
                          <motion.div className="emp-menu-popup"
                            initial={{ opacity: 0, scale: 0.85, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.85, y: -4 }}
                            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}>
                            <button onClick={() => openProfile(emp.enroll_number)}>
                              <Users size={12} /> Profile
                            </button>
                          </motion.div>
                        )}</AnimatePresence>
                      </td>
                      {/* Day cells */}
                      {emp.days.map(day => {
                        const cellKey = `${emp.enroll_number}:${day.dateStr}`;

                        const dStatus = day.status;
                        const dCheckIn = day.checkIn;
                        const dCheckOut = day.checkOut;

                        const colors = getStatusColor(dStatus);
                        const isSelected = selectedCells.has(cellKey);
                        const isToday = day.dateStr === format(new Date(), 'yyyy-MM-dd');

                        let cellContent;
                        if (dCheckIn && dCheckOut && dCheckIn !== dCheckOut) {
                          cellContent = (
                            <div className="time-stack">
                              <span className="time-in">▸ {dCheckIn.substring(0, 5)}</span>
                              <span className="time-out">▪ {dCheckOut.substring(0, 5)}</span>
                            </div>
                          );
                        } else if (dCheckIn) {
                          cellContent = <span className="time-in single">▸ {dCheckIn.substring(0, 5)}</span>;
                        } else {
                          cellContent = <span className={`status-label status-${dStatus}`}>{dStatus}</span>;
                        }

                        const tooltip = day.isHoliday ? `🎉 ${day.holidayName}`
                          : day.isLate ? `Late by ${day.lateMins} min • ${day.totalHours}h`
                          : dCheckIn ? `${day.totalHours}h worked` : '';

                        return (
                          <td key={day.dateStr}
                            className={`day-cell ${isToday ? 'today-col' : ''} ${isSelected ? 'cell-selected' : ''} ${isModified ? 'cell-modified' : ''} ${isPending ? 'cell-pending' : ''}`}
                            style={{ background: isSelected ? 'rgba(79,110,247,0.12)' : colors.bg, cursor: 'pointer' }}
                            onClick={(e) => handleCellClick(e, i, emp.days.indexOf(day))}
                            onContextMenu={(e) => handleCellRightClick(e, emp, day)}
                            title={tooltip + (isModified ? ' (Modified)' : '') + (isPending ? ' (Syncing…)' : '')}>
                            <div className="cell-content">
                              {cellContent}
                              {day.isLate && day.checkIn && !isPending && <span className="late-dot" />}
                              {isModified && <span className="mod-dot" />}
                              {isPending && <span className="pending-dot" />}
                            </div>
                          </td>
                        );
                      })}
                      {/* Summary columns */}
                      <td className="summary-cell green">{emp.summary.P}</td>
                      <td className="summary-cell red">{emp.summary.A}</td>
                      <td className="summary-cell orange">{emp.days.filter(d => d.isLate).length}</td>
                      <td className="summary-cell pink">{emp.summary.HD}</td>
                      <td className="summary-cell gray">{emp.summary.WO}</td>
                    </motion.tr>
                  ))}</AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

        {/* ── Legend ── */}
        <motion.div className="calendar-legend" {...fadeUp(0.15)}>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#dbeafe', borderColor: '#93c5fd' }} />Present</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#fef3c7', borderColor: '#fcd34d' }} />Late</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#ffe4e6', borderColor: '#fca5a5' }} />Absent</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#fce7f3', borderColor: '#f9a8d4' }} />Half Day</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#f1f5f9', borderColor: '#cbd5e1' }} />Week Off</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#e0e7ff', borderColor: '#a5b4fc' }} />Holiday</div>
          <div className="legend-item"><span className="legend-dot" style={{ background: '#fff', borderColor: '#a78bfa', border: '2px dashed #a78bfa' }} />Modified</div>
          {selectedCells.size > 0 && (
            <div className="legend-item" style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--accent)' }}>
              <CheckSquare size={12} /> {selectedCells.size} cells selected
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Context Menu (Color-coded) ── */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
          <div className="ctx-header">{ctxMenu.name} — {format(parseISO(ctxMenu.dateStr), 'dd MMM')}</div>
          {ctxMenu.day.checkIn && (
            <div className="ctx-detail">
              <span>In: {ctxMenu.day.checkIn.substring(0, 5)}</span>
              {ctxMenu.day.checkOut && <span>Out: {ctxMenu.day.checkOut.substring(0, 5)}</span>}
              {ctxMenu.day.totalHours > 0 && <span>{ctxMenu.day.totalHours}h</span>}
            </div>
          )}
          <div className="ctx-sep" />

          {/* 1. Modify Punch — Blue */}
          <button className="ctx-item ctx-modify" onClick={() => openEditModal()}>
            <Pencil size={12} /> Modify Punch
          </button>

          {/* 2. Mark as Present — Green */}
          <button className="ctx-item ctx-present" onClick={() => markPresent(ctxMenu.enroll, ctxMenu.dateStr, ctxMenu.day)}>
            <UserCheck size={12} /> Mark as Present
          </button>

          {/* 3. Mark as Absent — Red */}
          <button className="ctx-item ctx-absent" onClick={() => markAbsent(ctxMenu.enroll, ctxMenu.dateStr, ctxMenu.day)}>
            <UserX size={12} /> Mark as Absent
          </button>

          
        </div>
      )}

      {/* ── Edit Punch Modal ── */}
      <AnimatePresence>{editModal && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setEditModal(null)}>
          <motion.div className="modal" onClick={e => e.stopPropagation()}
            initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}>
            <div className="modal-header">
              <h3>Modify Punch</h3>
              <button className="btn-icon" onClick={() => setEditModal(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-sub">{editModal.name} — {format(parseISO(editModal.dateStr), 'EEEE, dd MMM yyyy')}</p>
              <div className="form-row">
                <div className="form-group">
                  <label>In-Time</label>
                  <input type="time" className="input" value={editModal.inTime}
                    onChange={e => setEditModal({ ...editModal, inTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Out-Time</label>
                  <input type="time" className="input" value={editModal.outTime}
                    onChange={e => setEditModal({ ...editModal, outTime: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={savePunch}
                disabled={!editModal.inTime}>Save Punch</button>
            </div>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      {/* ── Bulk Modify Punch Modal ── */}
      <AnimatePresence>{bulkModal && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setBulkModal(null)}>
          <motion.div className="modal" onClick={e => e.stopPropagation()}
            initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}>
            <div className="modal-header">
              <h3>Bulk Modify Punch</h3>
              <button className="btn-icon" onClick={() => setBulkModal(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <p className="modal-sub" style={{ marginBottom: 12 }}>
                Applying to <strong>{selectedCells.size}</strong> selected cell{selectedCells.size > 1 ? 's' : ''}
              </p>
              <div className="form-row">
                <div className="form-group">
                  <label>In-Time</label>
                  <input type="time" className="input" value={bulkModal.inTime}
                    onChange={e => setBulkModal({ ...bulkModal, inTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Out-Time</label>
                  <input type="time" className="input" value={bulkModal.outTime}
                    onChange={e => setBulkModal({ ...bulkModal, outTime: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setBulkModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={bulkSavePunch}
                disabled={!bulkModal.inTime}>Apply to {selectedCells.size} cells</button>
            </div>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      

      {/* ── Employee Profile (Slide-Over) ── */}
      <AnimatePresence>
        {profileModal && (
          <EmployeeProfile
            enrollNumber={profileModal.enrollNumber}
            employees={employees}
            devices={devices}
            punches={punches}
            holidays={holidays}
            onClose={() => setProfileModal(null)}
          />
        )}
      </AnimatePresence>
      {/* ── Sync Status Indicator Removed (Using Realtime) ── */}
    </>
  );
}
