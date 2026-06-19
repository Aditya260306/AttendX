const config = require('./config');
const logger = require('./logger');
const ZKManager = require('./zk-manager');
const {
  syncAttendance,
  syncAttendanceIncremental,
  syncUsers,
  updateDeviceStatus,
  logSync,
  sendHeartbeat,
  insertRealtimePunch,
  ensureDeviceRecord,
  computeDailyAttendance,
} = require('./sync-service');
const { processCommands } = require('./command-processor');
const cron = require('node-cron');

const zkManager = new ZKManager();

// Map machineId → Supabase device DB id
const deviceMap = new Map();

async function init() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   AttendX Agent — ESSL K30 Pro Sync Service     ║');
  console.log('  ║   Starting up...                                 ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  // Register machines from config
  for (const machine of config.machines) {
    zkManager.register(machine);
  }

  // Ensure device records in Supabase exist and reset status to 'disconnected'
  // (ensureDeviceRecord now always resets status on startup — stale 'connected'
  //  from a crashed agent is never shown to the dashboard)
  for (const machine of config.machines) {
    const dbId = await ensureDeviceRecord(machine);
    if (dbId) deviceMap.set(machine.machineId, dbId);
  }

  logger.info(`Agent ID: ${config.agentId}`);
  logger.info(`Machines configured: ${config.machines.length}`);
  logger.info(`Command poll: ${config.sync.commandPollSeconds} seconds`);

  // ── Initial boot sequence ─────────────────────────────────────────────────
  // 1. Connect to all devices
  await connectAllDevices();

  // 2. Startup catch-up: pull only punches we missed since last_sync
  //    (safe — uses incremental, not wipe-and-reload)
  await startupCatchupSync();

  // 3. Initial user sync (once on boot, not on a timer)
  await syncUsersAllDevices();

  // 4. Start real-time punch listeners
  await startRealTimeListeners();

  // ── Scheduled Tasks ───────────────────────────────────────────────────────

  // A. Incremental attendance catch-up every 5 minutes
  //    (safety net — handles punches missed during brief listener outages)
  let catchingUp = false;
  setInterval(async () => {
    if (catchingUp) return;
    catchingUp = true;
    try {
      await incrementalCatchupSync();
    } catch (err) {
      logger.error(`Incremental catch-up error: ${err.message}`);
    } finally {
      catchingUp = false;
    }
  }, 5 * 60 * 1000); // every 5 minutes

  // B. Connection health check + real-time listener re-attach every 3 minutes
  //    (zk-manager.startRealTimeListener now always tears down stale listeners
  //     and attaches fresh ones — this replaces the old broken skip-if-present logic)
  cron.schedule('*/3 * * * *', async () => {
    await connectAllDevices();
    await startRealTimeListeners(); // safe to call — always replaces stale listener
  });

  // C. Nightly user sync at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    logger.sync('--- Nightly user sync ---');
    await syncUsersAllDevices();
  });

  // D. Final daily attendance computation at 1:30 AM for yesterday's data
  cron.schedule('30 1 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);
    logger.sync(`--- Computing final daily attendance for ${dateStr} ---`);
    await computeDailyAttendance(dateStr);
  });

  // E. Poll command queue every N seconds
  setInterval(async () => {
    try {
      await processCommands(zkManager);
    } catch (err) {
      logger.error(`Command poll error: ${err.message}`);
    }
  }, config.sync.commandPollSeconds * 1000);

  // F. Heartbeat every N seconds
  setInterval(async () => {
    try {
      await sendHeartbeat(config.agentId, zkManager.getStatuses());
    } catch (err) {
      logger.error(`Heartbeat error: ${err.message}`);
    }
  }, config.sync.heartbeatSeconds * 1000);

  // Send initial heartbeat
  await sendHeartbeat(config.agentId, zkManager.getStatuses());

  logger.success('Agent is running. Real-time listeners active. Press Ctrl+C to stop.');
}

// ─── Device connection management ─────────────────────────────────────────

async function connectAllDevices() {
  for (const machine of config.machines) {
    const dbId = deviceMap.get(machine.machineId);
    if (!dbId) continue;
    try {
      const connected = await zkManager.ensureConnected(machine.machineId);
      await updateDeviceStatus(dbId, connected ? 'connected' : 'disconnected');
    } catch (err) {
      logger.error(`Connection check failed for ${machine.name}: ${err.message}`);
      await updateDeviceStatus(dbId, 'disconnected');
    }
  }
}

// ─── Real-time listener management ────────────────────────────────────────
// Note: zk-manager.startRealTimeListener() now handles teardown+reattach
// internally. Calling it every 3 minutes is safe and guarantees freshness.

async function startRealTimeListeners() {
  for (const machine of config.machines) {
    const dbId = deviceMap.get(machine.machineId);
    if (!dbId) continue;

    try {
      await zkManager.startRealTimeListener(
        machine.machineId,
        async (enrollNumber, timestamp, machineId, deviceName) => {
          const deviceDbId = deviceMap.get(machineId);
          if (!deviceDbId) return;

          // Insert punch (triggers debounced computeDailyAttendance internally)
          await insertRealtimePunch(deviceDbId, enrollNumber, timestamp);

          // Log to sync_history for audit trail
          await logSync(
            deviceDbId,
            deviceName,
            'realtime_punch',
            1,
            'success',
            `Employee #${enrollNumber} punched at ${timestamp}`
          );
        }
      );
    } catch (err) {
      logger.error(`Failed to start real-time listener for ${machine.name}: ${err.message}`);
    }
  }
}

// ─── Sync utilities ────────────────────────────────────────────────────────

/**
 * On-boot catch-up: pull attendance newer than last_sync from each device.
 * Handles punches that came in while the agent was offline.
 */
async function startupCatchupSync() {
  for (const machine of config.machines) {
    const dbId = deviceMap.get(machine.machineId);
    if (!dbId) continue;
    try {
      const count = await syncAttendanceIncremental(zkManager, machine.machineId, dbId);
      if (count > 0) {
        await updateDeviceStatus(dbId, 'connected', true);
        await logSync(dbId, machine.name, 'startup_catchup', count, 'success',
          `Caught up ${count} punch(es) missed while agent was offline`);
      }
    } catch (err) {
      logger.error(`Startup catch-up failed for ${machine.name}: ${err.message}`);
    }
  }
}

/**
 * 5-minute incremental catch-up: only new punches since last_sync.
 * Much lighter than the old 30s full sync.
 */
async function incrementalCatchupSync() {
  for (const machine of config.machines) {
    const dbId = deviceMap.get(machine.machineId);
    if (!dbId) continue;
    try {
      await syncAttendanceIncremental(zkManager, machine.machineId, dbId);
    } catch (err) {
      logger.error(`Incremental sync failed for ${machine.name}: ${err.message}`);
    }
  }
}

/**
 * Sync users from all devices using sync-and-prune (no wipe window).
 */
async function syncUsersAllDevices() {
  for (const machine of config.machines) {
    const dbId = deviceMap.get(machine.machineId);
    if (!dbId) continue;
    try {
      const count = await syncUsers(zkManager, machine.machineId, dbId);
      await logSync(dbId, machine.name, 'sync_users', count, 'success',
        `Synced ${count} users with sync-and-prune`);
    } catch (err) {
      logger.error(`User sync failed for ${machine.name}: ${err.message}`);
      await logSync(dbId, machine.name, 'sync_users', 0, 'error', err.message);
    }
  }
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  logger.info('Shutting down agent...');
  await zkManager.disconnectAll();

  const { supabase } = require('./sync-service');
  await supabase.from('agent_heartbeat').update({ status: 'offline' }).eq('agent_id', config.agentId);

  for (const [, dbId] of deviceMap) {
    await updateDeviceStatus(dbId, 'disconnected');
  }

  logger.info('Agent stopped.');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err}`);
});

init().catch(err => {
  logger.error(`Agent startup failed: ${err.message}`);
  process.exit(1);
});
