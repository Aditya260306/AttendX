const { supabase, logSync } = require('./sync-service');
const logger = require('./logger');

/**
 * Process pending commands from the device_commands table.
 * The dashboard inserts commands, the agent picks them up and executes on the physical machine.
 */
async function processCommands(zkManager) {
  const { data: commands, error } = await supabase
    .from('device_commands')
    .select('*, devices(name, machine_id)')
    .eq('status', 'pending')
    .not('payload->>transport', 'eq', 'adms')
    .not('command_type', 'in', '(add_user,delete_user,sync_users)')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error || !commands || commands.length === 0) return;

  for (const cmd of commands) {
    if (cmd.payload?.transport === 'adms') continue;
    if (['add_user', 'delete_user', 'sync_users'].includes(cmd.command_type) && cmd.payload?.transport !== 'lan') continue;

    const machineId  = cmd.devices?.machine_id;
    const deviceName = cmd.devices?.name || `Device ${cmd.device_id}`;

    if (!machineId) {
      await markCommand(cmd.id, 'failed', 'Machine not found for this device');
      continue;
    }

    await markCommand(cmd.id, 'processing');
    logger.info(`Processing command: ${cmd.command_type} on ${deviceName}`);

    try {
      let result = '';

      switch (cmd.command_type) {

        case 'sync_attendance': {
          const { syncAttendance } = require('./sync-service');
          const count = await syncAttendance(zkManager, machineId, cmd.device_id);
          result = `Synced ${count} new records`;
          await logSync(cmd.device_id, deviceName, 'sync_attendance', count, 'success', result);
          break;
        }

        case 'sync_users': {
          const { syncUsers } = require('./sync-service');
          const count = await syncUsers(zkManager, machineId, cmd.device_id);
          result = `Synced ${count} users`;
          await logSync(cmd.device_id, deviceName, 'sync_users', count, 'success', result);
          break;
        }

        case 'add_user': {
          const p = cmd.payload || {};

          // ── Slot assignment: agent owns all slot decisions ─────────────────
          // 1. Check if user already exists on this device (re-enrollment / privilege update)
          const { data: existingUser } = await supabase
            .from('device_users')
            .select('device_uid')
            .eq('device_id', cmd.device_id)
            .eq('enroll_number', parseInt(p.enroll_number))
            .maybeSingle();

          let deviceUid;
          if (existingUser?.device_uid) {
            // Re-enrollment: reuse existing slot
            deviceUid = existingUser.device_uid;
            logger.info(`Re-enrolling user ${p.enroll_number} in existing slot ${deviceUid} on ${deviceName}`);
          } else {
            // New enrollment: find the lowest available slot
            const allUsers = await zkManager.getUsers(machineId);
            const usedUids = new Set(allUsers.map(u => parseInt(u.uid)));
            // Find the lowest positive slot not already occupied
            deviceUid = 1;
            while (usedUids.has(deviceUid)) deviceUid++;
            logger.info(`Assigning new slot ${deviceUid} to user ${p.enroll_number} on ${deviceName}`);
          }

          // Call the device
          await zkManager.setUser(
            machineId,
            deviceUid,
            String(p.enroll_number),
            p.name || 'Unknown',
            p.password || '',
            p.privilege || 0,
            p.cardNumber || 0
          );

          // After physical confirmation: upsert into device_users
          await supabase.from('device_users').upsert({
            device_id: cmd.device_id,
            enroll_number: parseInt(p.enroll_number),
            device_uid: deviceUid,
            name: p.name || 'Unknown',
            privilege: p.privilege || 0,
            card_number: p.cardNumber ? String(p.cardNumber) : '0',
            synced_at: new Date().toISOString(),
          }, { onConflict: 'device_id,enroll_number' });

          result = `Enrolled user ${p.name} (Enroll: ${p.enroll_number}, Slot: ${deviceUid}, Privilege: ${p.privilege})`;
          await logSync(cmd.device_id, deviceName, 'add_user', 1, 'success', result);
          break;
        }

        case 'delete_user': {
          const p = cmd.payload || {};
          const enrollNumber = parseInt(p.enroll_number);

          // ── Always resolve device_uid from device_users table ────────────
          // Never trust the payload uid — the agent is the source of truth for slots.
          const { data: userRow } = await supabase
            .from('device_users')
            .select('device_uid')
            .eq('device_id', cmd.device_id)
            .eq('enroll_number', enrollNumber)
            .maybeSingle();

          if (!userRow?.device_uid) {
            const msg = `User ${enrollNumber} not found in device_users for device ${cmd.device_id} — may already be deleted`;
            await markCommand(cmd.id, 'failed', msg);
            continue;
          }

          const deviceUid = userRow.device_uid;
          await zkManager.deleteUser(machineId, deviceUid);

          // Physical deletion confirmed — now safe to remove from device_users
          await supabase
            .from('device_users')
            .delete()
            .eq('device_id', cmd.device_id)
            .eq('enroll_number', enrollNumber);

          result = `Deleted user ${enrollNumber} (Slot: ${deviceUid}) from ${deviceName}`;
          await logSync(cmd.device_id, deviceName, 'delete_user', 1, 'success', result);
          break;
        }

        case 'clear_logs': {
          await zkManager.clearAttendanceLog(machineId);
          result = 'Attendance logs cleared on device';
          await logSync(cmd.device_id, deviceName, 'clear_logs', 0, 'success', result);
          break;
        }

        case 'restart': {
          await zkManager.restartDevice(machineId);
          result = 'Restart command sent';
          await logSync(cmd.device_id, deviceName, 'restart', 0, 'success', result);
          break;
        }

        case 'sync_time': {
          await zkManager.setTime(machineId);
          result = `Device time synced to server: ${new Date().toISOString()}`;
          await logSync(cmd.device_id, deviceName, 'sync_time', 0, 'success', result);
          break;
        }

        case 'get_info': {
          const info = await zkManager.getInfo(machineId);
          result = JSON.stringify(info);

          if (info) {
            await supabase.from('devices').update({
              serial_number: info.serialNumber || null,
              firmware:      info.firmwareVersion || null,
              mac_address:   info.mac || null,
            }).eq('id', cmd.device_id);
          }
          break;
        }

        default:
          result = `Unknown command type: ${cmd.command_type}`;
          await markCommand(cmd.id, 'failed', result);
          continue;
      }

      await markCommand(cmd.id, 'completed', result);
      logger.success(`Command completed: ${cmd.command_type} → ${result}`);

    } catch (err) {
      const errMsg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      await markCommand(cmd.id, 'failed', errMsg);
      await logSync(cmd.device_id, deviceName, cmd.command_type, 0, 'error', errMsg);
      logger.error(`Command failed: ${cmd.command_type} → ${errMsg}`);
    }
  }
}

async function markCommand(commandId, status, result = null) {
  const update = { status };
  if (result) update.result = result;
  if (status === 'completed' || status === 'failed') {
    update.executed_at = new Date().toISOString();
  }
  await supabase
    .from('device_commands')
    .update(update)
    .eq('id', commandId);
}

module.exports = { processCommands };
