const deviceRepo = require('../db/device.repo');
const commandService = require('./command.service');
const { logInfo, logError } = require('../utils/logger');

const authService = {
    /**
     * Handles the initial /iclock/cdata handshake.
     * Updates device status and triggers an auto-time-sync if connecting fresh.
     */
    async handleHandshake(sn, ipAddress) {
        let device = await deviceRepo.findBySerialNumber(sn);
        if (!device) {
            logInfo(`[AUTH] Unknown device detected (SN: ${sn}). Auto-registering...`);
            device = await deviceRepo.createDevice(sn, ipAddress);
            if (!device) {
                logError(`[AUTH] Failed to auto-register device. SN: ${sn}, IP: ${ipAddress}`);
                return;
            }
        }

        const wasOffline = device.status !== 'connected';
        
        await deviceRepo.updateStatus(device.id, 'connected');
        logInfo(`[AUTH] Device Authenticated: ${device.name} (SN: ${sn})`);

        // Business Rule: Auto time sync on reconnect
        if (wasOffline) {
            logInfo(`[AUTH] Device ${sn} came online. Triggering auto-time-sync.`);
            await commandService.queueTimeSync(device.id);
        }
    }
};

module.exports = authService;
