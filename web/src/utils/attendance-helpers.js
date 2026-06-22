import { format, eachDayOfInterval, parseISO } from 'date-fns';

/**
 * Generate array of date strings between two dates (inclusive)
 */
export function generateDateRangeArray(startStr, endStr) {
  const start = parseISO(startStr);
  const end = parseISO(endStr);
  if (start > end) return [];
  return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));
}

/**
 * Build the full attendance roster from raw data
 * 
 * @param employees - employees array from Supabase
 * @param punches - raw_punches array (with is_deleted flag)
 * @param holidays - holidays array
 * @param rules - attendance_rules row
 * @param dateRange - array of 'yyyy-MM-dd' strings
 * @returns roster array with per-day status and summary counts
 */
export function buildRoster(employees, punches, holidays, rules, dateRange) {
  const holidaySet = new Set((holidays || []).map(h => h.holiday_date));
  const holidayMap = {};
  (holidays || []).forEach(h => { holidayMap[h.holiday_date] = h.name; });

  const weekendDays = (rules?.weekend_days || ['Sunday']).map(d => d.toLowerCase());
  const shiftStart = rules?.shift_start || '09:00:00';
  const shiftEnd = rules?.shift_end || '18:00:00';
  const graceMins = rules?.grace_period_mins ?? 15;
  const halfDayHrs = rules?.half_day_threshold_hrs ?? 4.5;

  // Build punch lookup: { enroll_number: { 'YYYY-MM-DD': ['HH:mm:ss', ...] } }
  const punchMap = {};
  // Punches are pre-filtered by the component (is_deleted and device filter)
  for (const p of punches) {
    const en = p.enroll_number;
    const day = p.punch_time.substring(0, 10);
    const time = p.punch_time.substring(11, 19);
    if (!punchMap[en]) punchMap[en] = {};
    if (!punchMap[en][day]) punchMap[en][day] = [];
    punchMap[en][day].push(time);
  }

  // Parse time string to minutes from midnight
  function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  const shiftStartMins = timeToMins(shiftStart);

  return employees
    .filter(emp => !emp.is_deleted)
    .map(emp => {
      const en = emp.enroll_number;
      // Per-employee shift override
      const empShiftStart = emp.shift_start || shiftStart;
      const empShiftEnd = emp.shift_end || shiftEnd;
      const empShiftStartMins = timeToMins(empShiftStart);

      const summary = { P: 0, A: 0, L: 0, HD: 0, WO: 0, H: 0, total: 0 };
      const today = format(new Date(), 'yyyy-MM-dd');

      const days = dateRange.map(dateStr => {
        const dateObj = parseISO(dateStr);
        const dayName = format(dateObj, 'EEEE').toLowerCase();
        const isWknd = weekendDays.includes(dayName);
        const isHoliday = holidaySet.has(dateStr);
        const isFuture = dateStr > today;
        const isToday = dateStr === today;

        const dayPunches = (punchMap[en]?.[dateStr] || []).sort();
        const hasPunches = dayPunches.length > 0;

        let status = '';
        let checkIn = null;
        let checkOut = null;
        let totalHours = 0;
        let isLate = false;
        let lateMins = 0;

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
            status = 'HD';
            summary.HD++;
          } else {
            status = 'P';
            summary.P++;
          }
          if (isLate) status = 'L'; // Late overrides P for display, but still counts as present
        } else if (isWknd) {
          status = 'WO';
          summary.WO++;
        } else if (isHoliday) {
          status = 'H';
          summary.H++;
        } else if (isFuture) {
          status = '—';
        } else {
          status = 'A';
          summary.A++;
        }

        summary.total++;

        return {
          dateStr,
          status,
          checkIn,
          checkOut,
          totalHours: Math.round(totalHours * 100) / 100,
          isLate,
          lateMins,
          punchCount: dayPunches.length,
          isWeekend: isWknd,
          isHoliday,
          holidayName: holidayMap[dateStr] || null,
          isFuture,
          isToday,
        };
      });

      return {
        enroll_number: en,
        name: emp.name,
        department: emp.department || '',
        designation: emp.designation || '',
        shiftStart: empShiftStart,
        shiftEnd: empShiftEnd,
        days,
        summary,
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Get the status color class for a day cell
 */
export function getStatusColor(status) {
  switch (status) {
    case 'P':  return { bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd' };
    case 'L':  return { bg: '#fffbeb', text: '#b45309', border: '#fed7aa' };
    case 'A':  return { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' };
    case 'HD': return { bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8' };
    case 'WO': return { bg: '#f8fafc', text: '#94a3b8', border: '#e2e8f0' };
    case 'H':  return { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' };
    default:   return { bg: 'transparent', text: '#d1d5db', border: 'transparent' };
  }
}

/**
 * Get Excel cell colors
 */
export function getXlsxColor(status) {
  switch (status) {
    case 'P':  return { bg: 'FFF0F9FF', text: 'FF0369A1' };
    case 'L':  return { bg: 'FFFFFBEB', text: 'FFB45309' };
    case 'A':  return { bg: 'FFFFF1F2', text: 'FFBE123C' };
    case 'HD': return { bg: 'FFFDF2F8', text: 'FFBE185D' };
    case 'WO': return { bg: 'FFF8FAFC', text: 'FF94A3B8' };
    case 'H':  return { bg: 'FFEEF2FF', text: 'FF4338CA' };
    default:   return null;
  }
}

/**
 * Days between two dates (inclusive)
 */
export function getDaysBetween(start, end) {
  const s = parseISO(start);
  const e = parseISO(end);
  return Math.floor((e - s) / 86400000) + 1;
}
