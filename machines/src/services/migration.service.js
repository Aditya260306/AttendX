const { supabase } = require('../config/supabase');
const commandService = require('./command.service');
const { logInfo, logError } = require('../utils/logger');

const migrationService = {
    /**
     * Migrates a user from the database to a new physical machine.
     * Includes their basic info and all biometric templates.
     */
    async migrateUserToDevice(enrollNumber, targetDeviceId) {
        try {
            // 1. Fetch User Data
            const { data: employee, error: empErr } = await supabase
                .from('employees')
                .select('*')
                .eq('enroll_number', enrollNumber)
                .single();
                
            if (empErr || !employee) {
                throw new Error(`Employee ${enrollNumber} not found.`);
            }

            if (employee.is_deleted) {
                throw new Error(`Cannot migrate soft-deleted user ${enrollNumber}.`);
            }

            // 2. Fetch Biometric Templates
            const { data: biometrics, error: bioErr } = await supabase
                .from('biometrics')
                .select('*')
                .eq('enroll_number', enrollNumber);

            if (bioErr) {
                console.error('[MIGRATION] Error fetching biometrics:', bioErr);
            }

            // 3. Construct Payload
            const payload = {
                enroll_number: employee.enroll_number,
                name: employee.name,
                privilege: employee.privilege,
                password: employee.password,
                card_number: employee.card_number,
                biometrics: biometrics || []
            };

            // 4. Queue the add_user command
            await commandService.queueAddUser(targetDeviceId, payload);
            
            logInfo(`[MIGRATION] Queued user ${enrollNumber} for migration to device ${targetDeviceId}.`);
            return true;
        } catch (error) {
            logError(`[MIGRATION] Failed to migrate user ${enrollNumber} to device ${targetDeviceId}`, error);
            throw error;
        }
    }
};

module.exports = migrationService;
