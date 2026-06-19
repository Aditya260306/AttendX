const ZKLib = require('node-zklib');
const logger = require('./logger');

class ZKManager {
  constructor() {
    /** @type {Map<number, {zk: ZKLib, config: object, connected: boolean}>} */
    this.devices = new Map();
    /** @type {Map<number, boolean>} tracks which machines have an active real-time listener */
    this.activeListeners = new Map();
  }

  /**
   * Register a machine config (does not connect yet)
   */
  register(machineConfig) {
    this.devices.set(machineConfig.machineId, {
      zk: null,
      config: machineConfig,
      connected: false,
    });
    logger.info(`Registered machine: ${machineConfig.name} (${machineConfig.ip}:${machineConfig.port})`);
  }

  /**
   * Connect to a specific machine
   */
  async connect(machineId) {
    const device = this.devices.get(machineId);
    if (!device) throw new Error(`Machine ${machineId} not registered`);

    const { config } = device;

    // Clean up any existing socket first
    if (device.zk) {
      try { await device.zk.disconnect(); } catch (_) {}
      device.zk = null;
      device.connected = false;
    }

    try {
      const zk = new ZKLib(config.ip, config.port, 20000, 10000, config.commKey || 0);
      await zk.createSocket();
      device.zk = zk;
      device.connected = true;
      logger.success(`Connected to ${config.name} (${config.ip}:${config.port})`);
      return true;
    } catch (err) {
      device.connected = false;
      device.zk = null;
      logger.error(`Failed to connect to ${config.name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Connect to all registered machines
   */
  async connectAll() {
    const results = {};
    for (const [id] of this.devices) {
      results[id] = await this.connect(id);
    }
    return results;
  }

  /**
   * Disconnect a specific machine
   */
  async disconnect(machineId) {
    const device = this.devices.get(machineId);
    if (!device) return;
    if (device.zk) {
      try {
        await device.zk.disconnect();
      } catch (_) { /* ignore */ }
    }
    device.connected = false;
    device.zk = null;
    logger.info(`Disconnected from ${device.config.name}`);
  }

  /**
   * Disconnect all machines
   */
  async disconnectAll() {
    for (const [id] of this.devices) {
      await this.disconnect(id);
    }
  }

  /**
   * Ensure connection is alive, reconnect if needed.
   * Actively tests the socket to detect stale connections.
   */
  async ensureConnected(machineId) {
    const device = this.devices.get(machineId);
    if (!device) return false;

    // If we think we're connected, verify with a lightweight probe
    if (device.connected && device.zk) {
      try {
        // Use a short timeout for the health check
        const infoPromise = device.zk.getInfo();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        );
        await Promise.race([infoPromise, timeoutPromise]);
        return true;
      } catch (err) {
        // Socket is dead — mark disconnected and try reconnecting
        logger.warn(`${device.config.name} connection stale: ${err.message}, reconnecting...`);
        device.connected = false;
        try { await device.zk.disconnect(); } catch (_) {}
        device.zk = null;
      }
    }

    return await this.connect(machineId);
  }

  /**
   * Get device info
   */
  async getInfo(machineId) {
    if (!await this.ensureConnected(machineId)) return null;
    const device = this.devices.get(machineId);
    try {
      return await device.zk.getInfo();
    } catch (err) {
      logger.error(`getInfo failed for ${device.config.name}: ${err.message}`);
      device.connected = false;
      return null;
    }
  }

  /**
   * Get all users from device
   */
  async getUsers(machineId) {
    if (!await this.ensureConnected(machineId)) return [];
    const device = this.devices.get(machineId);
    try {
      const result = await device.zk.getUsers();
      const users = result?.data || result || [];
      logger.sync(`Fetched ${users.length} users from ${device.config.name}`);
      return users;
    } catch (err) {
      logger.error(`getUsers failed for ${device.config.name}: ${err.message}`);
      device.connected = false;
      return [];
    }
  }

  /**
   * Get attendance logs from device
   */
  async getAttendances(machineId) {
    if (!await this.ensureConnected(machineId)) return [];
    const device = this.devices.get(machineId);
    try {
      const result = await device.zk.getAttendances();
      const logs = result?.data || result || [];
      logger.sync(`Fetched ${logs.length} attendance records from ${device.config.name}`);
      return logs;
    } catch (err) {
      logger.error(`getAttendances failed for ${device.config.name}: ${err.message}`);
      device.connected = false;
      return [];
    }
  }

  /**
   * Set (add/update) user on device
   */
  async setUser(machineId, uid, userId, name, password = '', role = 0, cardno = 0) {
    if (!await this.ensureConnected(machineId)) throw new Error('Not connected');
    const device = this.devices.get(machineId);
    try {
      await device.zk.setUser(uid, userId, name, password, role, cardno);
      logger.success(`Set user ${name} (UID:${uid}, role:${role}) on ${device.config.name}`);
      return true;
    } catch (err) {
      const msg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      logger.error(`setUser failed on ${device.config.name}: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Delete user from device
   */
  async deleteUser(machineId, uid) {
    if (!await this.ensureConnected(machineId)) throw new Error('Not connected');
    const device = this.devices.get(machineId);
    try {
      await device.zk.deleteUser(uid);
      logger.success(`Deleted user UID:${uid} from ${device.config.name}`);
      return true;
    } catch (err) {
      logger.error(`deleteUser failed on ${device.config.name}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Clear attendance logs on device
   */
  async clearAttendanceLog(machineId) {
    if (!await this.ensureConnected(machineId)) throw new Error('Not connected');
    const device = this.devices.get(machineId);
    try {
      await device.zk.clearAttendanceLog();
      logger.success(`Cleared attendance logs on ${device.config.name}`);
      return true;
    } catch (err) {
      logger.error(`clearAttendanceLog failed on ${device.config.name}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Restart device
   */
  async restartDevice(machineId) {
    if (!await this.ensureConnected(machineId)) throw new Error('Not connected');
    const device = this.devices.get(machineId);
    try {
      await device.zk.restart();
      logger.success(`Restart command sent to ${device.config.name}`);
      // Safely disconnect after restart command is sent
      try { await device.zk.disconnect(); } catch (_) {}
      device.connected = false;
      device.zk = null;
      return true;
    } catch (err) {
      const msg = err?.message || String(err);
      logger.error(`restart failed on ${device.config.name}: ${msg}`);
      device.connected = false;
      try { if (device.zk) await device.zk.disconnect(); } catch (_) {}
      device.zk = null;
      throw new Error(msg);
    }
  }

  /**
   * Set device time to current server time
   */
  async setTime(machineId) {
    if (!await this.ensureConnected(machineId)) throw new Error('Not connected');
    const device = this.devices.get(machineId);
    try {
      await device.zk.setTime(new Date());
      logger.success(`Time synced on ${device.config.name} → ${new Date().toLocaleTimeString()}`);
      return true;
    } catch (err) {
      logger.error(`setTime failed on ${device.config.name}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Start (or REPLACE) the real-time event listener on a device.
   * 
   * IMPORTANT: Always tears down any existing listener before attaching a new one.
   * This is the fix for the silent re-attach bug — previously the code checked
   * `activeListeners.has(machineId)` and skipped if true, meaning after a device
   * restart the socket would reconnect but the listener would NOT re-attach.
   * 
   * Now we always replace: disconnect old listener → attach fresh one.
   * Calls callback(enrollNumber, timestamp, machineId, deviceName) on every punch.
   */
  async startRealTimeListener(machineId, onPunch) {
    const device = this.devices.get(machineId);
    if (!device) {
      logger.error(`Cannot start real-time listener: machine ${machineId} not registered`);
      return false;
    }

    // ── Tear down existing listener before attaching a new one ──
    // This ensures we never have a dead listener silently swallowing punches.
    if (this.activeListeners.get(machineId)) {
      logger.info(`Re-attaching real-time listener on ${device.config.name} (replacing stale one)`);
      try {
        // Disconnect and reconnect the socket to get a clean state
        if (device.zk) {
          try { await device.zk.disconnect(); } catch (_) {}
          device.zk = null;
          device.connected = false;
        }
      } catch (_) {}
      this.activeListeners.set(machineId, false);
    }

    // Ensure we have a live connection
    if (!await this.ensureConnected(machineId)) {
      logger.error(`Cannot start real-time listener: not connected to machine ${machineId}`);
      return false;
    }

    try {
      await device.zk.getRealTimeLogs((data) => {
        // data has { visitorId/userId, visitorVerification, attendanceTime }
        const enrollNumber = parseInt(data.visitorId || data.userId || 0);
        const timestamp = data.attTime || data.attendanceTime || new Date();
        if (enrollNumber > 0) {
          logger.success(`[LIVE] Punch from #${enrollNumber} on ${device.config.name} at ${timestamp}`);
          if (typeof onPunch === 'function') {
            onPunch(enrollNumber, timestamp, machineId, device.config.name);
          }
        }
      });
      this.activeListeners.set(machineId, true);
      logger.success(`Real-time listener started on ${device.config.name}`);
      return true;
    } catch (err) {
      this.activeListeners.set(machineId, false);
      logger.error(`Real-time listener failed on ${device.config.name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Stop the real-time listener on a device (marks it as inactive).
   */
  stopRealTimeListener(machineId) {
    this.activeListeners.set(machineId, false);
    const device = this.devices.get(machineId);
    if (device) {
      logger.info(`Real-time listener stopped for ${device.config.name}`);
    }
  }

  /**
   * Get connection status of all machines
   */
  getStatuses() {
    const statuses = {};
    for (const [id, device] of this.devices) {
      statuses[id] = {
        name: device.config.name,
        ip: device.config.ip,
        connected: device.connected,
      };
    }
    return statuses;
  }
}

module.exports = ZKManager;
