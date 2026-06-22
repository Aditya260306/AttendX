const { parseKeyValueFields, escapeAdmsValue } = require('../utils/adms-formatter');

const parserService = {
    /**
     * Parses raw ATTLOG string from device into an array of punch objects.
     * Raw ATTLOG line format: 12345\t2023-10-25 09:00:00\t1\t15\t0\t0\t0
     */
    parseAttLog(rawPayload) {
        const punches = [];
        const lines = rawPayload.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parts = trimmed.split('\t');
            if (parts.length < 2) continue;

            punches.push({
                enroll_number: parseInt(parts[0], 10),
                punch_time: parts[1].replace('\r', ''),
                verify_mode: parseInt(parts[3] || '0', 10),
                // parts[2] is state (check-in/out) but usually 1 on simple devices
            });
        }
        return punches;
    },

    /**
     * Parses raw USERINFO string.
     * Example: USER PIN=104 Name=John Pri=0
     */
    parseUserInfo(rawPayload) {
        const users = [];
        const lines = rawPayload.split('\n');

        for (const line of lines) {
            if (!line.trim() || !line.startsWith('USER')) continue;
            
            const fields = parseKeyValueFields(line);
            if (fields.PIN) {
                users.push({
                    enroll_number: parseInt(fields.PIN, 10),
                    name: escapeAdmsValue(fields.Name),
                    privilege: parseInt(fields.Pri || '0', 10),
                    card_number: escapeAdmsValue(fields.Card),
                    password: escapeAdmsValue(fields.Password)
                });
            }
        }
        return users;
    },

    /**
     * Parses raw BIODATA string.
     * Example: FP PIN=104 FID=0 Size=1234 Valid=1 TMP=Base64String...
     */
    parseBioData(rawPayload) {
        const bios = [];
        const lines = rawPayload.split('\n');

        for (const line of lines) {
            if (!line.trim() || !line.startsWith('FP')) continue;

            const fields = parseKeyValueFields(line);
            if (fields.PIN && fields.TMP) {
                bios.push({
                    enroll_number: parseInt(fields.PIN, 10),
                    finger_index: parseInt(fields.FID || '0', 10),
                    template_data: escapeAdmsValue(fields.TMP),
                    valid: parseInt(fields.Valid || '1', 10)
                });
            }
        }
        return bios;
    }
};

module.exports = parserService;
