const { dequeueMessage, completeMessage, failMessage } = require('../config/queue');
const { logInfo, logError } = require('../utils/logger');
const parserService = require('../services/parser.service');
const attendanceService = require('../services/attendance.service');
const reconciliationService = require('../services/reconciliation.service');
const deviceRepo = require('../db/device.repo');
const { supabase } = require('../config/supabase');

const POLL_INTERVAL_MS = 1000; // Poll every 1 second when idle
const ACTIVE_POLL_MS = 100; // Poll very fast when processing backlog

async function processMessage(msg) {
    const { id, device_sn, table_name, payload } = msg;

    try {
        const device = await deviceRepo.findBySerialNumber(device_sn);
        if (!device) throw new Error(`Unknown device SN: ${device_sn}`);

        if (table_name === 'ATTLOG') {
            const punches = parserService.parseAttLog(payload);
            await attendanceService.processPunches(device.id, punches);
        } else if (table_name === 'USERINFO') {
            const users = parserService.parseUserInfo(payload);
            await reconciliationService.processUsers(device.id, users);
        } else if (table_name === 'BIODATA') {
            const bios = parserService.parseBioData(payload);
            await reconciliationService.processBiometrics(device.id, bios);
        } else if (table_name === 'CMD_RESULT') {
            // Parse return from device e.g. "Return=0" for success
            logInfo(`[WORKER] Command result from ${device_sn}: ${payload.trim()}`);
            // Logic to update device_commands table could go here
        } else if (table_name === 'OPERLOG') {
            // Could log system events from the device
            logInfo(`[WORKER] OperLog from ${device_sn}: ${payload.trim()}`);
        } else {
            logInfo(`[WORKER] Unknown table ${table_name}. Ignoring payload.`);
        }

        // Mark as successfully processed
        await completeMessage(id);

    } catch (error) {
        logError(`[WORKER] Error processing message ${id} for table ${table_name}`, error);
        await failMessage(id, error.message);
    }
}

async function startWorker() {
    logInfo('[WORKER] Queue Polling Started...');
    
    let isPolling = false;

    setInterval(async () => {
        if (isPolling) return; // Prevent overlapping runs
        isPolling = true;

        try {
            let msgProcessed = true;
            
            // Loop aggressively until the queue is empty
            while (msgProcessed) {
                const msg = await dequeueMessage();
                
                if (msg) {
                    await processMessage(msg);
                } else {
                    msgProcessed = false; // Queue is empty, exit aggressive loop
                }
            }
        } catch (error) {
            logError('[WORKER] Critical error in poll loop', error);
        } finally {
            isPolling = false;
        }

    }, POLL_INTERVAL_MS);
}

module.exports = { startWorker };
