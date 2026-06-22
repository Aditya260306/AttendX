const { supabase } = require('../config/supabase');

const attendanceRepo = {
    async getEmployeeConstraints(enrollNumber) {
        const { data, error } = await supabase
            .from('employees')
            .select('enroll_number, primary_device_id, is_deleted')
            .eq('enroll_number', enrollNumber)
            .single();
            
        if (error) return null;
        return data;
    },

    async insertPunch(punch) {
        // punch: { enroll_number, punch_time, device_id, verify_mode }
        const { error } = await supabase
            .from('raw_punches')
            .upsert(punch, { onConflict: 'enroll_number, punch_time, device_id', ignoreDuplicates: true });
        
        if (error) {
            console.error('[DB] Failed to insert punch:', error);
            throw error;
        }
    }
};

module.exports = attendanceRepo;
