const { supabase } = require('../config/supabase');

const deviceRepo = {
    async findBySerialNumber(sn) {
        const { data, error } = await supabase
            .from('devices')
            .select('*')
            .eq('serial_number', sn)
            .single();
        if (error) return null;
        return data;
    },

    async createDevice(sn, ipAddress) {
        const { data, error } = await supabase
            .from('devices')
            .insert({
                name: `Device ${sn}`,
                serial_number: sn,
                ip_address: ipAddress || '0.0.0.0',
                status: 'connected',
                last_seen: new Date().toISOString()
            })
            .select('*')
            .single();
        
        if (error) {
            console.error('[DB] Error auto-registering device:', error);
            return null;
        }
        return data;
    },

    async updateStatus(id, status) {
        await supabase
            .from('devices')
            .update({ status, last_seen: new Date().toISOString() })
            .eq('id', id);
    }
};

module.exports = deviceRepo;
