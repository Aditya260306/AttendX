const userRepo = require('../db/user.repo');
const commandService = require('./command.service');
const { logInfo, logError } = require('../utils/logger');

const reconciliationService = {
    /**
     * Reconciles users uploaded from the device with the database.
     * Enforces the immutable Employee ID policy.
     */
    async processUsers(deviceId, usersArray) {
        if (!usersArray || usersArray.length === 0) return;

        let newUsers = 0;
        let rejectedUsers = 0;

        for (const u of usersArray) {
            try {
                const existing = await userRepo.getEmployeeByEnrollNumber(u.enroll_number);

                // RULE: If employee is soft-deleted, they are permanently rejected from the system.
                // We must actively delete them from the physical machine to prevent ghosting.
                if (existing && existing.is_deleted) {
                    logInfo(`[RECONCILIATION] Rejected deleted user ${u.enroll_number} from device ${deviceId}. Queuing DELETE command.`);
                    // Push a command to delete this user from the device
                    await commandService.queueDeleteUser(deviceId, u.enroll_number);
                    rejectedUsers++;
                    continue;
                }

                // Prepare employee data (only override name if it's a new user or missing)
                const employeeData = {
                    enroll_number: u.enroll_number,
                    name: existing ? existing.name : u.name, 
                    privilege: u.privilege,
                    card_number: u.card_number,
                    password: u.password,
                    // Auto-flag privilege=14 as maintenance
                    is_maintenance: u.privilege === 14 ? true : (existing ? existing.is_maintenance : false)
                };

                await userRepo.upsertEmployee(employeeData);
                
                // Link this user to this specific device
                // The device UID isn't always reliable in ATTLOG, so we use enroll_number as UID fallback
                await userRepo.linkDeviceUser(deviceId, u.enroll_number, u.enroll_number, u.name, u.privilege);

                if (!existing) newUsers++;

            } catch (error) {
                logError(`[RECONCILIATION] Error processing user ${u.enroll_number}`, error);
            }
        }

        logInfo(`[RECONCILIATION] Processed ${usersArray.length} users. New: ${newUsers}, Ghost-Rejected: ${rejectedUsers}`);
    },

    /**
     * Process biometric templates. Similar to users, reject if deleted.
     */
    async processBiometrics(deviceId, biosArray) {
        if (!biosArray || biosArray.length === 0) return;

        let inserted = 0;
        for (const bio of biosArray) {
            try {
                const existing = await userRepo.getEmployeeByEnrollNumber(bio.enroll_number);
                if (existing && existing.is_deleted) {
                    // Ignore bio payload for deleted user
                    continue;
                }

                await userRepo.upsertBiometric({
                    enroll_number: bio.enroll_number,
                    finger_index: bio.finger_index,
                    template_data: bio.template_data,
                    valid: bio.valid
                });
                inserted++;
            } catch (error) {
                logError(`[RECONCILIATION] Error processing bio for user ${bio.enroll_number}`, error);
            }
        }
        logInfo(`[RECONCILIATION] Saved ${inserted}/${biosArray.length} biometric templates.`);
    }
};

module.exports = reconciliationService;
