const { supabase } = require('../config/supabase');

const userRepo = {
    async getEmployeeByEnrollNumber(enrollNumber) {
        const { data, error } = await supabase
            .from('employees')
            .select('*')
            .eq('enroll_number', enrollNumber)
            .single();
        if (error && error.code !== 'PGRST116') { // PGRST116 is "Rows not found"
            console.error('[DB] Error fetching employee:', error);
            return null;
        }
        return data || null;
    },

    async upsertEmployee(employee) {
        const { error } = await supabase
            .from('employees')
            .upsert(employee, { onConflict: 'enroll_number' });
        if (error) {
            console.error('[DB] Failed to upsert employee:', error);
            throw error;
        }
    },

    async linkDeviceUser(deviceId, enrollNumber, deviceUid, name, privilege) {
        const { error } = await supabase
            .from('device_users')
            .upsert({
                device_id: deviceId,
                enroll_number: enrollNumber,
                device_uid: deviceUid,
                name: name,
                privilege: privilege,
                synced_at: new Date().toISOString()
            }, { onConflict: 'device_id, enroll_number' });
            
        if (error) {
            console.error('[DB] Failed to link device_users:', error);
            throw error;
        }
    },

    async upsertBiometric(bio) {
        const { error } = await supabase
            .from('biometrics')
            .upsert(bio, { onConflict: 'enroll_number, finger_index' });
        
        if (error) {
            console.error('[DB] Failed to upsert biometric:', error);
            throw error;
        }
    }
};

module.exports = userRepo;
