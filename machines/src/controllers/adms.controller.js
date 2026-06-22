const { enqueueMessage } = require('../config/queue');
const { logInfo, logError } = require('../utils/logger');
const commandService = require('../services/command.service');
const authService = require('../services/auth.service');

const admsController = {
    /**
     * GET /iclock/cdata
     * Initial Handshake when the device connects.
     */
    async handshake(req, res) {
        const sn = (req.query.SN || '').trim();
        console.log(`\n=================================================`);
        console.log(`📡 [ADMS] DEVICE CONNECTED! SN: ${sn}`);
        console.log(`=================================================\n`);
        logInfo(`[ADMS Handshake] Device SN: ${sn}`);
        
        await authService.handleHandshake(sn, req.ip);

        res.setHeader('Content-Type', 'text/plain');
        res.send(`GET OPTION FROM:${sn}\nStamp=9999\nOpStamp=9999\nErrorDelay=60\nDelay=5\nTransTimes=00:00;14:00\nTransInterval=1\nTransFlag=11111111\nTimeZone=530\nRealtime=1\nEncrypt=0`);
    },

    /**
     * POST /iclock/cdata
     * Lightning Fast Ingestion: Receives data, queues it, and responds immediately.
     */
    async ingestData(req, res) {
        const sn = (req.query.SN || '').trim();
        const table = (req.query.table || '').toUpperCase();
        const payload = req.body || '';

        // 1. Respond instantly to free up the device
        res.setHeader('Content-Type', 'text/plain');
        res.send('OK');

        if (!sn || !table || !payload) return;

        // 2. Queue the payload based on priority
        try {
            let priority = 10; // Default Low
            if (table === 'ATTLOG') priority = 1; // High Priority for realtime punches
            else if (table === 'OPERLOG') priority = 5; // Medium

            await enqueueMessage(sn, table, payload, priority);
            logInfo(`[QUEUE] Ingested ${table} payload from SN: ${sn} (Priority: ${priority})`);
        } catch (error) {
            logError(`[QUEUE ERROR] Failed to ingest ${table} from SN: ${sn}`, error);
        }
    },

    /**
     * GET /iclock/getrequest
     * Device polling for commands (e.g. Add User, Delete User, Restart)
     */
    async getPendingCommands(req, res) {
        const sn = (req.query.SN || '').trim();
        
        // Let device know we are still here even if no commands
        res.setHeader('Content-Type', 'text/plain');

        // Log device connection status to terminal every 60 seconds
        if (!global.activeDevicesLog) global.activeDevicesLog = {};
        const now = Date.now();
        if (!global.activeDevicesLog[sn] || (now - global.activeDevicesLog[sn]) > 60000) {
            global.activeDevicesLog[sn] = now;
            console.log(`\x1b[36m[STATUS]\x1b[0m Device \x1b[32mCONNECTED & ACTIVE\x1b[0m | SN: ${sn} | IP: ${req.ip}`);
            // Update last_seen in DB once per minute
            const deviceRepo = require('../db/device.repo');
            deviceRepo.findBySerialNumber(sn).then(dev => {
                if (dev) {
                    deviceRepo.updateStatus(dev.id, 'connected');
                } else {
                    // Auto-register if device bypassed handshake
                    console.log(`[AUTH] Unknown device detected during polling (SN: ${sn}). Auto-registering...`);
                    deviceRepo.createDevice(sn, req.ip);
                }
            }).catch(() => {});
        }
        
        try {
            const commandsStr = await commandService.fetchPendingCommandsString(sn);
            res.send(commandsStr || 'OK');
        } catch (error) {
            logError(`[CMD ERROR] Fetching commands for SN: ${sn}`, error);
            res.send('OK');
        }
    },

    /**
     * POST /iclock/devicecmd
     * Device returning the success/failure result of a command
     */
    async commandResult(req, res) {
        const sn = (req.query.SN || '').trim();
        const payload = req.body || '';

        // Respond instantly
        res.setHeader('Content-Type', 'text/plain');
        res.send('OK');

        if (!sn || !payload) return;

        try {
            // Queue the command result so the command.worker can parse it asynchronously
            await enqueueMessage(sn, 'CMD_RESULT', payload, 5); // Medium priority
            logInfo(`[QUEUE] Ingested Command Result from SN: ${sn}`);
        } catch (error) {
            logError(`[QUEUE ERROR] Failed to ingest command result from SN: ${sn}`, error);
        }
    }
};

module.exports = admsController;
