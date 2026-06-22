const { supabase } = require('../config/supabase');
const { escapeAdmsValue } = require('../utils/adms-formatter');

const commandService = {
    async queueTimeSync(deviceId) {
        const { error } = await supabase.from('device_commands').insert({
            device_id: deviceId,
            command_type: 'sync_time',
            status: 'pending'
        });
        if (error) console.error('[CMD] Error queuing time sync:', error);
    },

    async queueDeleteUser(deviceId, enrollNumber) {
        const { error } = await supabase.from('device_commands').insert({
            device_id: deviceId,
            command_type: 'delete_user',
            payload: { enroll_number: enrollNumber },
            status: 'pending'
        });
        if (error) console.error('[CMD] Error queuing delete user:', error);
    },

    async queueAddUser(deviceId, employeeData) {
        // employeeData should contain name, privilege, password, card_number, and template_data (if bio exists)
        const { error } = await supabase.from('device_commands').insert({
            device_id: deviceId,
            command_type: 'add_user',
            payload: employeeData,
            status: 'pending'
        });
        if (error) console.error('[CMD] Error queuing add user:', error);
    },

    async fetchPendingCommandsString(sn) {
        const { data: device } = await supabase.from('devices').select('id').eq('serial_number', sn).single();
        if (!device) return 'OK';

        const { data: commands } = await supabase
            .from('device_commands')
            .select('*')
            .eq('device_id', device.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(10);

        if (!commands || commands.length === 0) return 'OK';

        let responseText = '';
        
        for (const cmd of commands) {
            let shouldMarkProcessing = false;
            
            if (cmd.command_type === 'sync_time') {
                responseText += `C:${cmd.id}:LOG\n`;
                shouldMarkProcessing = true;
            } else if (cmd.command_type === 'restart') {
                responseText += `C:${cmd.id}:RESTART\n`;
                shouldMarkProcessing = true;
            } else if (cmd.command_type === 'sync_users') {
                responseText += `C:${cmd.id}:DATA QUERY USERINFO\n`;
                shouldMarkProcessing = true;
            } else if (cmd.command_type === 'sync_attendance') {
                responseText += `C:${cmd.id}:DATA QUERY ATTLOG\n`;
                shouldMarkProcessing = true;
            } else if (cmd.command_type === 'delete_user') {
                const pin = cmd.payload.enroll_number;
                // Deletes fingerprints and user
                responseText += `C:${cmd.id}:DATA DELETE USERINFO PIN=${pin}\n`;
                shouldMarkProcessing = true;
            } else if (cmd.command_type === 'add_user') {
                const p = cmd.payload;
                // 1. Send User Info
                let cmdStr = `C:${cmd.id}:DATA UPDATE USERINFO PIN=${p.enroll_number}\tName=${p.name}\tPri=${p.privilege}\tPasswd=${p.password || ''}\tCard=${p.card_number || ''}\n`;
                // 2. Send Fingerprints if included
                if (p.biometrics && p.biometrics.length > 0) {
                    for (const bio of p.biometrics) {
                        // Assuming bio has finger_index, template_data, valid
                        cmdStr += `C:${cmd.id}_FP${bio.finger_index}:DATA UPDATE FINGERTMP PIN=${p.enroll_number}\tFID=${bio.finger_index}\tSize=${bio.template_data.length}\tValid=${bio.valid}\tTMP=${bio.template_data}\n`;
                    }
                }
                responseText += cmdStr;
                shouldMarkProcessing = true;
            }

            if (shouldMarkProcessing) {
                await supabase.from('device_commands').update({ status: 'processing' }).eq('id', cmd.id);
            }
        }

        return responseText || 'OK';
    }
};

module.exports = commandService;
