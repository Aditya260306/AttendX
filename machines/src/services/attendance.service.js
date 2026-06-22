const attendanceRepo = require('../db/attendance.repo');
const { logInfo, logError } = require('../utils/logger');

const attendanceService = {
    /**
     * Process an array of punches parsed from ATTLOG.
     * Enforces the Primary Device rule.
     */
    async processPunches(deviceId, punchesArray) {
        if (!punchesArray || punchesArray.length === 0) return;

        let insertedCount = 0;
        let discardedCount = 0;

        for (const punch of punchesArray) {
            try {
                // Fetch employee constraints to enforce Primary Device rules
                const employee = await attendanceRepo.getEmployeeConstraints(punch.enroll_number);

                if (!employee) {
                    // Unknown user punched in. We could choose to ignore or save it.
                    // For safety, we save it (they might sync USERINFO later).
                    await attendanceRepo.insertPunch({
                        enroll_number: punch.enroll_number,
                        punch_time: punch.punch_time,
                        device_id: deviceId,
                        verify_mode: punch.verify_mode
                    });
                    insertedCount++;
                    continue;
                }

                // Rule: Reject punches from deleted employees
                if (employee.is_deleted) {
                    discardedCount++;
                    continue;
                }

                // Rule: Primary Device Enforcement
                if (employee.primary_device_id && employee.primary_device_id !== deviceId) {
                    // User has a primary device and this is not it. Discard.
                    discardedCount++;
                    continue;
                }

                await attendanceRepo.insertPunch({
                    enroll_number: punch.enroll_number,
                    punch_time: punch.punch_time,
                    device_id: deviceId,
                    verify_mode: punch.verify_mode
                });
                insertedCount++;

            } catch (error) {
                logError(`[ATTENDANCE] Error processing punch for SN: ${punch.enroll_number}`, error);
            }
        }

        logInfo(`[ATTENDANCE] Processed ${punchesArray.length} punches. Inserted: ${insertedCount}, Discarded: ${discardedCount}`);
    }
};

module.exports = attendanceService;
