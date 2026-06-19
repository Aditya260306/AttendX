import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Calendar, Clock, Monitor, ChevronLeft, ChevronRight,
  Briefcase, CreditCard, Pencil, UserCheck, UserX, RotateCcw,
  TrendingUp, CheckCircle2, XCircle, AlertTriangle, Timer
} from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from 'date-fns';
import './EmployeeProfile.css';

export default function EmployeeProfile({ enrollNumber, employees, devices, punches, holidays, rules, modifications, onClose, onEdit }) {
  const [profileMonth, setProfileMonth] = useState(new Date());

  const data = useMemo(() => {
    const emp = employees.find(e => e.enroll_number === enrollNumber);
    if (!emp) return null;

    const device = devices.find(d => d.id === emp.primary_device_id);
    const monthStart = startOfMonth(profileMonth);
    const monthEnd = endOfMonth(profileMonth);
    const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const today = format(new Date(), 'yyyy-MM-dd');

    const holidaySet = new Set((holidays || []).map(h => h.holiday_date));
    const holidayMap = {};
    (holidays || []).forEach(h => { holidayMap[h.holiday_date] = h.name; });
    const weekendDays = (rules?.weekend_days || ['Sunday']).map(d => d.toLowerCase());
    const graceMins = rules?.grace_period_mins ?? 15;
    const halfDayHrs = rules?.half_day_threshold_hrs ?? 4.5;
    const empShiftStart = emp.shift_start || rules?.shift_start || '09:00:00';
    const empShiftEnd = emp.shift_end || rules?.shift_end || '18:00:00';

    function timeToMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
    const empShiftStartMins = timeToMins(empShiftStart);

    // Build punch map for this employee only
    const empPunches = punches.filter(p => p.enroll_number === emp.enroll_number && !p.is_deleted);
    const punchMap = {};
    for (const p of empPunches) {
      const day = p.punch_time.substring(0, 10);
      const time = p.punch_time.substring(11, 19);
      if (!punchMap[day]) punchMap[day] = [];
      punchMap[day].push(time);
    }

    // Employee mods for the selected month
    const monthStartStr = format(monthStart, 'yyyy-MM-dd');
    const monthEndStr = format(monthEnd, 'yyyy-MM-dd');
    const empMods = modifications.filter(m =>
      m.enroll_number === emp.enroll_number &&
      m.punch_date >= monthStartStr &&
      m.punch_date <= monthEndStr
    );
    const empModSet = new Set(empMods.map(m => m.punch_date));

    let presentDays = 0, absentDays = 0, lateDays = 0, halfDays = 0, onTimeDays = 0, workingDays = 0;

    const calendarDays = monthDays.map(d => {
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayName = format(d, 'EEEE').toLowerCase();
      const isWknd = weekendDays.includes(dayName);
      const isHoliday = holidaySet.has(dateStr);
      const isFuture = dateStr > today;
      const isToday = dateStr === today;
      const dayPunches = (punchMap[dateStr] || []).sort();
      const hasPunches = dayPunches.length > 0;
      const isModified = empModSet.has(dateStr);

      let status = '', checkIn = null, checkOut = null, totalHours = 0, isLate = false, lateMins = 0;

      if (hasPunches) {
        checkIn = dayPunches[0];
        checkOut = dayPunches.length > 1 ? dayPunches[dayPunches.length - 1] : null;
        if (checkIn && checkOut && checkIn !== checkOut) {
          totalHours = (timeToMins(checkOut) - timeToMins(checkIn)) / 60;
        }
        const checkInMins = timeToMins(checkIn);
        lateMins = Math.max(0, checkInMins - empShiftStartMins - graceMins);
        isLate = lateMins > 0;

        if (totalHours > 0 && totalHours < halfDayHrs) {
          status = 'HD'; halfDays++;
        } else {
          status = 'P'; presentDays++;
        }
        if (isLate) { status = 'L'; lateDays++; }
        else { onTimeDays++; }
        workingDays++;
      } else if (isWknd) {
        status = 'WO';
      } else if (isHoliday) {
        status = 'H';
      } else if (isFuture) {
        status = '—';
      } else {
        status = 'A'; absentDays++;
        workingDays++;
      }

      return {
        dateStr, status, checkIn, checkOut,
        totalHours: Math.round(totalHours * 100) / 100,
        isLate, lateMins, isModified, isToday,
        dayName: format(d, 'EEE'), dayNum: format(d, 'd'),
        isWknd, isHoliday, isFuture,
        holidayName: holidayMap[dateStr] || null,
      };
    });

    const onTimePct = workingDays > 0 ? Math.round((onTimeDays / workingDays) * 100) : 0;
    const dailyLog = calendarDays.filter(d => !d.isFuture && d.status !== '—');

    return {
      emp, device, calendarDays, dailyLog, empMods,
      stats: { presentDays, absentDays, lateDays, halfDays, onTimePct, totalMods: empMods.length },
      monthLabel: format(profileMonth, 'MMMM yyyy'),
      firstDayOffset: getDay(monthStart),
    };
  }, [enrollNumber, profileMonth, employees, punches, devices, holidays, rules, modifications]);

  if (!data) return null;

  const statusClassMap = { P: 'cal-p', L: 'cal-l', A: 'cal-a', HD: 'cal-hd', WO: 'cal-wo', H: 'cal-h' };

  return (
    <AnimatePresence>
      <motion.div className="ep-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}>
        <motion.div className="ep-panel"
          onClick={e => e.stopPropagation()}
          initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 60 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}>

          {/* ── Close ── */}
          <button className="ep-close" onClick={onClose}><X size={16} /></button>

          {/* ── Hero Header ── */}
          <div className="ep-hero">
            <div className="ep-hero-bg" />
            <div className="ep-hero-content">
              <div className="ep-avatar">
                <span>{data.emp.name?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 className="ep-name" style={{ margin: 0 }}>{data.emp.name}</h2>
                  {onEdit && (
                    <motion.button
                      className="btn btn-icon-sm btn-secondary"
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onEdit(data.emp)}
                      title="Edit"
                      style={{ borderRadius: 8, padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Pencil size={12} /> Edit
                    </motion.button>
                  )}
                </div>
                <p className="ep-designation">{data.emp.designation || data.emp.department || '—'}</p>
              </div>
              <div className="ep-chips">
                <span className="ep-chip">#{data.emp.enroll_number}</span>
                <span className="ep-chip"><Monitor size={10} /> {data.device?.name || 'No Device'}</span>
                <span className="ep-chip"><Clock size={10} /> {data.emp.shift_start?.substring(0,5) || '09:00'} – {data.emp.shift_end?.substring(0,5) || '18:00'}</span>
                <span className="ep-chip"><Briefcase size={10} /> {data.emp.joining_date ? format(parseISO(data.emp.joining_date), 'dd MMM yyyy') : '—'}</span>
                {data.emp.mobile_number && <span className="ep-chip">📞 {data.emp.mobile_number}</span>}
                {data.emp.email && <span className="ep-chip">✉ {data.emp.email}</span>}
              </div>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="ep-body">

            {/* ── Personal Details ── */}
            {(data.emp.father_name || data.emp.date_of_birth || data.emp.gender || data.emp.blood_group) && (
              <div className="ep-card" style={{ marginBottom: 14 }}>
                <div className="ep-card-head"><span>Personal Details</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', padding: '10px 14px', fontSize: 12 }}>
                  {data.emp.father_name && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Father</span><span style={{ color: '#fff' }}>{data.emp.father_name}</span></>}
                  {data.emp.date_of_birth && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>DOB</span><span style={{ color: '#fff' }}>{format(parseISO(data.emp.date_of_birth), 'dd MMM yyyy')}</span></>}
                  {data.emp.gender && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Gender</span><span style={{ color: '#fff' }}>{data.emp.gender}</span></>}
                  {data.emp.blood_group && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Blood Group</span><span style={{ color: '#fff', fontWeight: 600 }}>{data.emp.blood_group}</span></>}
                </div>
              </div>
            )}

            {/* ── Bank & IDs (masked) ── */}
            {(data.emp.bank_account_no || data.emp.pan_number || data.emp.aadhaar_number || data.emp.base_salary) && (
              <div className="ep-card" style={{ marginBottom: 14 }}>
                <div className="ep-card-head"><span>Bank & Compliance</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', padding: '10px 14px', fontSize: 12 }}>
                  {data.emp.base_salary > 0 && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Salary</span><span style={{ color: '#34d399', fontWeight: 600 }}>₹{Number(data.emp.base_salary).toLocaleString('en-IN')}</span></>}
                  {data.emp.bank_account_no && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Bank A/C</span><span style={{ color: '#fff', fontFamily: 'monospace' }}>{'****' + data.emp.bank_account_no.slice(-4)}</span></>}
                  {data.emp.bank_ifsc && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>IFSC</span><span style={{ color: '#fff', fontFamily: 'monospace' }}>{data.emp.bank_ifsc}</span></>}
                  {data.emp.bank_name && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Bank</span><span style={{ color: '#fff' }}>{data.emp.bank_name}</span></>}
                  {data.emp.pan_number && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>PAN</span><span style={{ color: '#fff', fontFamily: 'monospace' }}>{data.emp.pan_number}</span></>}
                  {data.emp.aadhaar_number && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>Aadhaar</span><span style={{ color: '#fff', fontFamily: 'monospace' }}>{'****' + data.emp.aadhaar_number.slice(-4)}</span></>}
                  {data.emp.uan_number && <><span style={{ color: 'rgba(255,255,255,0.35)' }}>UAN</span><span style={{ color: '#fff', fontFamily: 'monospace' }}>{data.emp.uan_number}</span></>}
                </div>
              </div>
            )}

            {/* ── KPIs ── */}
            <div className="ep-kpis">
              {[
                { icon: CheckCircle2, label: 'Present', value: data.stats.presentDays, cls: 'kpi-green' },
                { icon: XCircle, label: 'Absent', value: data.stats.absentDays, cls: 'kpi-red' },
                { icon: AlertTriangle, label: 'Late', value: data.stats.lateDays, cls: 'kpi-amber' },
                { icon: Timer, label: 'Half Day', value: data.stats.halfDays, cls: 'kpi-pink' },
                { icon: TrendingUp, label: 'On-Time', value: `${data.stats.onTimePct}%`, cls: 'kpi-blue' },
              ].map(kpi => (
                <motion.div key={kpi.label} className={`ep-kpi ${kpi.cls}`}
                  whileHover={{ y: -3, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
                  <kpi.icon size={16} className="ep-kpi-icon" />
                  <div className="ep-kpi-val">{kpi.value}</div>
                  <div className="ep-kpi-label">{kpi.label}</div>
                </motion.div>
              ))}
            </div>

            {/* ── Mini Calendar ── */}
            <div className="ep-card">
              <div className="ep-card-head">
                <div className="ep-card-title"><Calendar size={14} /> Calendar</div>
                <div className="ep-month-nav">
                  <button onClick={() => setProfileMonth(p => subMonths(p, 1))}><ChevronLeft size={15} /></button>
                  <span>{data.monthLabel}</span>
                  <button onClick={() => setProfileMonth(p => addMonths(p, 1))}><ChevronRight size={15} /></button>
                </div>
              </div>
              <div className="ep-cal">
                <div className="ep-cal-dow">
                  {['S','M','T','W','T','F','S'].map((d, i) => <div key={i}>{d}</div>)}
                </div>
                <div className="ep-cal-grid">
                  {Array.from({ length: data.firstDayOffset }).map((_, i) => (
                    <div key={`e${i}`} className="ep-cal-cell ep-cal-empty" />
                  ))}
                  {data.calendarDays.map(day => (
                    <div
                      key={day.dateStr}
                      className={`ep-cal-cell ${statusClassMap[day.status] || 'cal-future'} ${day.isModified ? 'cal-mod' : ''} ${day.isToday ? 'cal-today' : ''}`}
                      title={`${day.dateStr} — ${day.status}${day.checkIn ? ` In:${day.checkIn.substring(0,5)}` : ''}${day.checkOut ? ` Out:${day.checkOut.substring(0,5)}` : ''}${day.holidayName ? ` (${day.holidayName})` : ''}`}
                    >
                      <span className="ep-cal-num">{day.dayNum}</span>
                      {day.checkIn && <span className="ep-cal-time">{day.checkIn.substring(0,5)}</span>}
                    </div>
                  ))}
                </div>
                <div className="ep-cal-legend">
                  {[
                    { cls: 'cal-p', label: 'Present' },
                    { cls: 'cal-l', label: 'Late' },
                    { cls: 'cal-a', label: 'Absent' },
                    { cls: 'cal-hd', label: 'Half' },
                    { cls: 'cal-wo', label: 'Off' },
                    { cls: 'cal-h', label: 'Holiday' },
                  ].map(l => (
                    <span key={l.cls} className="ep-legend-item">
                      <span className={`ep-legend-dot ${l.cls}`} />{l.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Modification History ── */}
            {data.empMods.length > 0 && (
              <div className="ep-card">
                <div className="ep-card-title"><Pencil size={14} /> Modifications <span className="ep-count">{data.stats.totalMods}</span></div>
                <div className="ep-mods">
                  {data.empMods.map((mod, i) => (
                    <motion.div key={i} className="ep-mod-row"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}>
                      <div className="ep-mod-date">{format(parseISO(mod.punch_date), 'dd MMM')}</div>
                      <div className={`ep-mod-badge ${mod.action_type}`}>
                        {mod.action_type === 'modify' && <Pencil size={9} />}
                        {mod.action_type === 'mark_present' && <UserCheck size={9} />}
                        {mod.action_type === 'mark_absent' && <UserX size={9} />}
                        {mod.action_type === 'restore' && <RotateCcw size={9} />}
                        {mod.action_type.replace('_', ' ')}
                      </div>
                      <div className="ep-mod-times">
                        {mod.original_in_time && <span className="ep-t-old">{mod.original_in_time?.substring(0,5)}–{mod.original_out_time?.substring(0,5) || '—'}</span>}
                        {mod.new_in_time && <span className="ep-t-new">→ {mod.new_in_time?.substring(0,5)}–{mod.new_out_time?.substring(0,5) || '—'}</span>}
                      </div>
                      <div className="ep-mod-by">
                        {mod.modified_by} · {format(new Date(mod.modified_at), 'HH:mm')}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Daily Breakdown ── */}
            <div className="ep-card">
              <div className="ep-card-title"><Clock size={14} /> Daily Log</div>
              <div className="ep-table-wrap">
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Day</th><th>In</th><th>Out</th><th>Hrs</th><th>Status</th><th>Late</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyLog.map(day => (
                      <tr key={day.dateStr} className={`${day.isModified ? 'ep-row-mod' : ''} ${day.isToday ? 'ep-row-today' : ''}`}>
                        <td className="ep-td-date">{format(parseISO(day.dateStr), 'dd MMM')}</td>
                        <td className="ep-td-day">{day.dayName}</td>
                        <td className="ep-td-time">{day.checkIn?.substring(0,5) || '—'}</td>
                        <td className="ep-td-time">{day.checkOut?.substring(0,5) || '—'}</td>
                        <td className="ep-td-hrs">{day.totalHours > 0 ? `${day.totalHours}` : '—'}</td>
                        <td><span className={`ep-st ${day.status}`}>{day.status}</span></td>
                        <td className="ep-td-late">{day.lateMins > 0 ? `${day.lateMins}m` : ''}</td>
                        <td>{day.isModified && <Pencil size={10} className="ep-mod-dot" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Salary ── */}
            <div className="ep-salary-card">
              <div className="ep-salary-inner">
                <CreditCard size={20} className="ep-salary-icon" />
                <div>
                  <div className="ep-salary-amt">₹{(data.emp.base_salary || 0).toLocaleString('en-IN')}</div>
                  <div className="ep-salary-label">Monthly Salary</div>
                </div>
              </div>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
