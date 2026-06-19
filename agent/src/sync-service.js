const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const logger = require('./logger');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

/**
 * Convert a device-reported timestamp to a local ISO string for storage.
 *
 * IMPORTANT: The raw_punches.punch_time column is TIMESTAMP (without TZ).
 * The K30 Pro returns times in local timezone (IST).
 * We format as 'YYYY-MM-DD HH:mm:ss' in LOCAL time so what the device
 * reports is exactly what gets stored and displayed.
 *
 * DO NOT use .toISOString() — that converts to UTC and causes the
 * dashboard to show times 5:30 behind.
 */
function toLocalISOString(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Debounce guard for computeDailyAttendance ─────────────────────────────
// Prevents burst recomputation when many real-time punches arrive at once
// (e.g., 50 employees clocking in at shift start). Only recalculates at most
// once every 5 minutes per date.
const lastComputedAt = new Map(); // dateStr → timestamp

function shouldRecompute(dateStr) {
  const last = lastComputedAt.get(dateStr) || 0;
  return Date.now() - last > 5 * 60 * 1000; // 5 minutes
}
function markComputed(dateStr) {
  lastComputedAt.set(dateStr, Date.now());
}

// ─── Incremental attendance sync tracking ──────────────────────────────────
// Tracks the last punch time seen per device so incremental syncs only
// fetch genuinely new records.
const lastSyncTimestamp = new Map(); // deviceDbId → ISO timestamp string

/**
 * Sync ALL attendance records from a machine (used on startup and manual trigger).
 * Returns count of newly inserted punches.
 */
async function syncAttendance(zkManager, machineId, deviceDbId) {
  const logs = await zkManager.getAttendances(machineId);
  if (!logs || logs.length === 0) {
    logger.info(`No attendance records on machine ${machineId}`);
    return 0;
  }

  const newCount = await _insertPunchBatch(logs, deviceDbId);

  // Update last_sync in devices table
  await supabase.from('devices').update({
    last_sync: new Date().toISOString(),
  }).eq('id', deviceDbId);

  // Track local timestamp for incremental syncs
  if (logs.length > 0) {
    const lastTime = logs.reduce((max, log) => {
      const t = new Date(log.recordTime || log.timestamp || 0);
      return t > max ? t : max;
    }, new Date(0));
    lastSyncTimestamp.set(deviceDbId, lastTime.toISOString());
  }

  logger.sync(`Full sync: ${newCount} new punches from machine ${machineId} (${logs.length} total on device)`);
  return newCount;
}

/**
 * Incremental sync — only fetches punches newer than last_sync.
 * Used by the 5-minute watchdog cron. Much lighter than full sync.
 * Returns count of newly inserted punches.
 */
async function syncAttendanceIncremental(zkManager, machineId, deviceDbId) {
  // Get last_sync timestamp from Supabase (authoritative across restarts)
  const { data: deviceRow } = await supabase
    .from('devices')
    .select('last_sync')
    .eq('id', deviceDbId)
    .single();

  const sinceTimestamp = deviceRow?.last_sync
    ? new Date(deviceRow.last_sync)
    : new Date(Date.now() - 30 * 60 * 1000); // default: last 30 minutes

  const logs = await zkManager.getAttendances(machineId);
  if (!logs || logs.length === 0) return 0;

  // Filter to only records newer than last_sync
  const newLogs = logs.filter(log => {
    const t = new Date(log.recordTime || log.timestamp || 0);
    return t > sinceTimestamp;
  });

  if (newLogs.length === 0) {
    logger.info(`Incremental sync: no new punches since ${sinceTimestamp.toISOString()} on machine ${machineId}`);
    return 0;
  }

  const newCount = await _insertPunchBatch(newLogs, deviceDbId);

  if (newCount > 0) {
    // Update last_sync to now
    await supabase.from('devices').update({
      last_sync: new Date().toISOString(),
    }).eq('id', deviceDbId);

    // Trigger attendance recomputation for today (debounced)
    const today = new Date().toISOString().slice(0, 10);
    if (shouldRecompute(today)) {
      markComputed(today);
      setImmediate(() => computeDailyAttendance(today).catch(err =>
        logger.error(`computeDaily after incremental sync: ${err.message}`)
      ));
    }
  }

  logger.sync(`Incremental sync: ${newCount} new punches from machine ${machineId}`);
  return newCount;
}

/**
 * Internal: batch insert punch records with upsert/ignoreDuplicates.
 */
async function _insertPunchBatch(logs, deviceDbId) {
  let newCount = 0;
  const batchSize = 100;

  for (let i = 0; i < logs.length; i += batchSize) {
    const batch = logs.slice(i, i + batchSize);
    const rows = batch.map(log => {
      const rawTime = log.recordTime || log.timestamp || null;
      return {
        enroll_number: parseInt(log.deviceUserId || log.userId || log.uid || 0),
        punch_time: toLocalISOString(rawTime),
        device_id: deviceDbId,
        verify_mode: log.type || log.verifyMode || 0,
      };
    }).filter(r => r.enroll_number > 0 && r.punch_time);

    if (rows.length === 0) continue;

    const { error } = await supabase
      .from('raw_punches')
      .upsert(rows, {
        onConflict: 'enroll_number,punch_time,device_id',
        ignoreDuplicates: true,
      });

    if (error) {
      // Fallback: insert one by one to skip bad rows
      for (const row of rows) {
        const { error: singleErr } = await supabase
          .from('raw_punches')
          .upsert(row, {
            onConflict: 'enroll_number,punch_time,device_id',
            ignoreDuplicates: true,
          });
        if (!singleErr) newCount++;
      }
    } else {
      newCount += rows.length;
    }
  }

  return newCount;
}

/**
 * Sync users from machine to both employees AND device_users tables.
 *
 * SYNC-AND-PRUNE PATTERN (replaces wipe-then-insert):
 *   1. Upsert all valid users into device_users (table always populated)
 *   2. Delete only those NOT in the current valid set
 *
 * This eliminates the empty-window bug where the table was blank
 * for up to 30 seconds between delete and re-insert.
 *
 * Key mapping:
 *   - u.uid    = device-internal slot number (1, 2, 3...)
 *   - u.userId = the enrollment ID string ("102", "103"...) — actual enroll_number
 *   - u.name   = user name
 */
async function syncUsers(zkManager, machineId, deviceDbId) {
  const users = await zkManager.getUsers(machineId);
  if (!users || users.length === 0) return 0;

  let synced = 0;
  const validEnrollNumbers = []; // Track valid ones for the prune step

  for (const u of users) {
    // ── GHOST USER GUARDS ─────────────────────────────────────────
    const rawUserId = u.userId;

    // Guard 1: userId must be explicitly present — never fall back to uid
    if (!rawUserId || rawUserId === '' || rawUserId === '0') continue;

    const enrollNumber = parseInt(rawUserId, 10);
    const deviceUid    = parseInt(u.uid || 0, 10);

    // Guard 2: enrollNumber must be real, positive, bounded
    if (isNaN(enrollNumber) || enrollNumber <= 0 || enrollNumber >= 65535) continue;

    // Guard 3: Name must not be empty or contain control characters
    const cleanName = (u.name || '').replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (!cleanName) {
      logger.warn(`Skipping ghost user: uid=${u.uid} userId=${rawUserId} — no valid name (deleted slot)`);
      continue;
    }

    // Guard 4: Privilege must be standard ZK value: 0, 7, 14, or 15
    const privilege = parseInt(u.role ?? 0, 10);
    if (![0, 7, 14, 15].includes(privilege)) {
      logger.warn(`Skipping ghost user: uid=${u.uid} userId=${rawUserId} — invalid privilege ${privilege}`);
      continue;
    }
    // ──────────────────────────────────────────────────────────────

    validEnrollNumbers.push(enrollNumber);

    // Only INSERT new employees — never overwrite existing ones
    await supabase.from('employees').upsert({
      enroll_number: enrollNumber,
      name: cleanName,
      privilege: privilege,
      card_number: u.cardno ? String(u.cardno) : '0',
      password: u.password || '',
    }, {
      onConflict: 'enroll_number',
      ignoreDuplicates: true,
    });

    // Step 1: UPSERT into device_users (never empty the table during sync)
    if (deviceDbId) {
      const { error } = await supabase.from('device_users').upsert({
        device_id: deviceDbId,
        enroll_number: enrollNumber,
        device_uid: deviceUid,
        name: cleanName,
        privilege: privilege,
        card_number: u.cardno ? String(u.cardno) : '0',
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'device_id,enroll_number',
      });
      if (!error) synced++;
    } else {
      synced++;
    }
  }

  // Step 2: PRUNE — delete only those device_users NOT in the current valid set
  // This removes users who were physically deleted from the device
  if (deviceDbId && validEnrollNumbers.length > 0) {
    const { error: pruneErr } = await supabase
      .from('device_users')
      .delete()
      .eq('device_id', deviceDbId)
      .not('enroll_number', 'in', `(${validEnrollNumbers.join(',')})`);

    if (pruneErr) {
      logger.error(`Prune device_users failed for device ${deviceDbId}: ${pruneErr.message}`);
    }
  }

  logger.sync(`Synced ${synced} users from machine ${machineId} (pruned orphans from device_users)`);
  return synced;
}

/**
 * Insert a single real-time punch.
 * Triggers a debounced daily attendance recomputation so the dashboard
 * updates within seconds — not on the next cron cycle.
 */
async function insertRealtimePunch(deviceDbId, enrollNumber, punchTime) {
  const localTime = toLocalISOString(punchTime);
  const { error } = await supabase
    .from('raw_punches')
    .upsert({
      enroll_number: enrollNumber,
      punch_time: localTime,
      device_id: deviceDbId,
      verify_mode: 0,
    }, {
      onConflict: 'enroll_number,punch_time,device_id',
      ignoreDuplicates: true,
    });

  if (error) {
    logger.error(`Failed to insert realtime punch: ${error.message}`);
    return;
  }

  logger.success(`Real-time punch: Employee #${enrollNumber} at ${punchTime}`);

  // Trigger debounced daily attendance recomputation
  const today = new Date().toISOString().slice(0, 10);
  if (shouldRecompute(today)) {
    markComputed(today);
    setImmediate(() => computeDailyAttendance(today).catch(err =>
      logger.error(`computeDaily after realtime punch: ${err.message}`)
    ));
  }
}

/**
 * Update device status in Supabase.
 */
async function updateDeviceStatus(deviceDbId, status, lastSync = false) {
  const update = { status };
  if (status === 'connected') update.last_seen = new Date().toISOString();
  if (lastSync) update.last_sync = new Date().toISOString();
  await supabase.from('devices').update(update).eq('id', deviceDbId);
}

/**
 * Log a sync event to sync_history.
 */
async function logSync(deviceDbId, deviceName, action, recordsCount, status, message) {
  await supabase.from('sync_history').insert({
    device_id: deviceDbId,
    device_name: deviceName,
    action,
    records_count: recordsCount,
    status,
    message,
  });
}

/**
 * Send heartbeat to Supabase.
 */
async function sendHeartbeat(agentId, machineStatuses) {
  const { error } = await supabase
    .from('agent_heartbeat')
    .upsert({
      agent_id: agentId,
      last_ping: new Date().toISOString(),
      ip_address: getLocalIP(),
      version: '1.0.0',
      status: 'online',
      machine_statuses: machineStatuses,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id' });
  if (error) logger.error(`Heartbeat failed: ${error.message}`);
}

/**
 * Ensure the device record in Supabase matches the .env config.
 * Always resets status to 'disconnected' on startup so stale
 * 'connected' states from a crashed agent are never shown.
 */
async function ensureDeviceRecord(machine) {
  const { data: existing } = await supabase
    .from('devices')
    .select('*')
    .eq('machine_id', machine.machineId)
    .single();

  if (existing) {
    // Always reset status to disconnected on agent startup
    await supabase.from('devices').update({
      ip_address: machine.ip,
      status: 'disconnected',
    }).eq('id', existing.id);

    if (existing.ip_address !== machine.ip) {
      logger.info(`Updated ${machine.name} IP: ${existing.ip_address} → ${machine.ip}`);
    }
    return existing.id;
  } else {
    const { data, error } = await supabase.from('devices').insert({
      machine_id: machine.machineId,
      name: machine.name,
      ip_address: machine.ip,
      port: machine.port,
      status: 'disconnected',
      is_active: true,
    }).select('id').single();
    if (error) {
      logger.error(`Failed to create device record for ${machine.name}: ${error.message}`);
      return null;
    }
    logger.success(`Created device record for ${machine.name}`);
    return data.id;
  }
}

function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

/**
 * Compute daily attendance summaries from raw_punches for a given date.
 *
 * Single-punch rule:
 *   1 punch  → 'Present (No Out)'  — employee arrived but no out punch recorded
 *   2+ punches → 'Present' or 'Half Day' (calculated normally)
 *   0 punches  → 'Absent'
 */
async function computeDailyAttendance(dateStr) {
  const dayStart = `${dateStr} 00:00:00`;
  const dayEnd   = `${dateStr} 23:59:59`;

  const { data: rules } = await supabase
    .from('attendance_rules')
    .select('*')
    .single();

  const shiftStart   = rules?.shift_start || '09:00:00';
  const graceMins    = rules?.grace_period_mins || 15;
  const halfDayHrs   = rules?.half_day_threshold_hrs || 4.5;
  const weekendDays  = rules?.weekend_days || ['Sunday'];

  const { data: employees } = await supabase
    .from('employees')
    .select('enroll_number, shift_start, shift_end, track_attendance, primary_device_id')
    .eq('is_active', true)
    .neq('track_attendance', false);

  if (!employees || employees.length === 0) return 0;

  const { data: punches } = await supabase
    .from('raw_punches')
    .select('enroll_number, punch_time')
    .gte('punch_time', dayStart)
    .lte('punch_time', dayEnd)
    .order('punch_time');

  // Group punches by employee
  const punchMap = {};
  for (const p of (punches || [])) {
    if (!punchMap[p.enroll_number]) punchMap[p.enroll_number] = [];
    punchMap[p.enroll_number].push(p.punch_time);
  }

  // Check holiday
  const { data: holiday } = await supabase
    .from('holidays')
    .select('id')
    .eq('holiday_date', dateStr)
    .maybeSingle();

  // Check weekend
  const dayOfWeek = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
  const isWeekend = weekendDays.map(d => d.toLowerCase()).includes(dayOfWeek.toLowerCase());

  const rows = [];
  for (const emp of employees) {
    const empPunches    = punchMap[emp.enroll_number] || [];
    const empShiftStart = emp.shift_start || shiftStart;

    let status, inTime = null, outTime = null, totalHours = 0;
    let isLate = false, lateByMins = 0;

    if (holiday) {
      status = 'Holiday';
    } else if (isWeekend) {
      status = 'Weekend';
    } else if (empPunches.length === 0) {
      status = 'Absent';
    } else if (empPunches.length === 1) {
      // ── Single punch: mark as Present (No Out) ──
      inTime = empPunches[0];
      outTime = null;
      totalHours = 0;

      // Still calculate late status based on in-time
      const inDate = new Date(inTime);
      const shiftParts = empShiftStart.split(':');
      const shiftDate = new Date(inDate);
      shiftDate.setHours(parseInt(shiftParts[0]), parseInt(shiftParts[1]), parseInt(shiftParts[2] || 0));
      const lateMs = inDate - shiftDate;
      lateByMins = Math.max(0, Math.floor(lateMs / 60000));
      isLate = lateByMins > graceMins;

      status = 'Present (No Out)';
    } else {
      // 2+ punches — normal calculation
      inTime  = empPunches[0];
      outTime = empPunches[empPunches.length - 1];

      if (outTime !== inTime) {
        totalHours = (new Date(outTime) - new Date(inTime)) / (1000 * 60 * 60);
        totalHours = Math.round(totalHours * 100) / 100;
      }

      const inDate = new Date(inTime);
      const shiftParts = empShiftStart.split(':');
      const shiftDate = new Date(inDate);
      shiftDate.setHours(parseInt(shiftParts[0]), parseInt(shiftParts[1]), parseInt(shiftParts[2] || 0));
      const lateMs = inDate - shiftDate;
      lateByMins = Math.max(0, Math.floor(lateMs / 60000));
      isLate = lateByMins > graceMins;

      status = (totalHours > 0 && totalHours < halfDayHrs) ? 'Half Day' : 'Present';
    }

    rows.push({
      enroll_number: emp.enroll_number,
      work_date: dateStr,
      in_time: inTime,
      out_time: outTime,
      total_hours: totalHours,
      status,
      is_late: isLate,
      late_by_mins: lateByMins,
      computed_at: new Date().toISOString(),
    });
  }

  // Upsert in batches
  let count = 0;
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from('daily_attendance')
      .upsert(batch, { onConflict: 'enroll_number,work_date' });
    if (!error) count += batch.length;
    else logger.error(`daily_attendance upsert error: ${error.message}`);
  }

  logger.sync(`Computed daily attendance for ${dateStr}: ${count} records`);
  return count;
}

module.exports = {
  supabase,
  syncAttendance,
  syncAttendanceIncremental,
  syncUsers,
  insertRealtimePunch,
  updateDeviceStatus,
  logSync,
  sendHeartbeat,
  ensureDeviceRecord,
  computeDailyAttendance,
};
