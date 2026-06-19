const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function parseKeyValueFields(line) {
    const fields = {};
    const normalized = line.replace(/^USER\s+/, '').replace(/^FP\s+/, '');
    const regex = /([A-Za-z][A-Za-z0-9_]*)=([^\t\r\n]*?)(?=\t[A-Za-z][A-Za-z0-9_]*=|\s+[A-Za-z][A-Za-z0-9_]*=|$)/g;
    let match;
    while ((match = regex.exec(normalized)) !== null) {
        fields[match[1]] = match[2].trim();
    }
    return fields;
}

/**
 * Parses raw ATTLOG string from ADMS and inserts into Supabase
 * @param {string} rawData - The raw tab-separated string from the device
 * @param {string} sn - The serial number of the device
 */
async function parseAndInsertPunches(rawData, sn) {
    // 1. Get the device ID from Supabase using the Serial Number
    const { data: device, error: deviceError } = await supabase
        .from('devices')
        .select('id')
        .eq('serial_number', sn)
        .single();

    if (deviceError || !device) {
        console.error(`[ADMS] ❌ Could not find device with SN: ${sn} in the database.`);
        return;
    }

    const deviceDbId = device.id;

    // 2. Parse the raw text
    // Example: "103\t2026-06-19 14:30:00\t1\t1\t0\t0"
    const lines = rawData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) return;

    const rowsToInsert = [];

    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
            const enrollNumber = parseInt(parts[0], 10);
            const rawTime = parts[1]; // Format is already "YYYY-MM-DD HH:mm:ss" in local time!
            const status = parts.length > 2 ? parseInt(parts[2], 10) : 0;
            const verifyMode = parts.length > 3 ? parseInt(parts[3], 10) : 0;

            if (isNaN(enrollNumber) || enrollNumber <= 0) continue;

            rowsToInsert.push({
                enroll_number: enrollNumber,
                punch_time: rawTime,
                device_id: deviceDbId,
                verify_mode: verifyMode
            });
        }
    }

    if (rowsToInsert.length === 0) return;

    // 3. Upsert into raw_punches
    const { error: upsertError } = await supabase
        .from('raw_punches')
        .upsert(rowsToInsert, {
            onConflict: 'enroll_number,punch_time,device_id',
            ignoreDuplicates: true
        });

    if (upsertError) {
        console.error(`[ADMS] ❌ Error inserting punches: ${upsertError.message}`);
    } else {
        console.log(`[ADMS] ✅ Successfully inserted ${rowsToInsert.length} punches from device ${sn}`);
    }
}

/**
 * Parses raw USER string from ADMS and inserts into employees table
 */
async function parseAndInsertUser(rawData, sn) {
    const lines = rawData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return [];

    const usersToInsert = [];
    const processedUsers = [];

    for (const line of lines) {
        const fields = parseKeyValueFields(line);
        const parts = line.split('\t');
        let enrollNumber = 0;
        let name = '';
        let privilege = 0;
        let password = '';
        let card = '0';
        let uid = 0;

        if (fields.PIN) {
            enrollNumber = parseInt(fields.PIN, 10);
            name = fields.Name || '';
            privilege = parseInt(fields.Pri || '0', 10);
            password = fields.Passwd || '';
            card = fields.Card || '0';
            uid = parseInt(fields.UID || '0', 10);
        } else {
            for (const part of parts) {
                if (part.startsWith('PIN=')) enrollNumber = parseInt(part.split('=')[1], 10);
                else if (part.startsWith('Name=')) name = part.split('=')[1];
                else if (part.startsWith('Pri=')) privilege = parseInt(part.split('=')[1], 10);
                else if (part.startsWith('Passwd=')) password = part.split('=')[1] || '';
                else if (part.startsWith('Card=')) card = part.split('=')[1] || '0';
                else if (part.startsWith('UID=')) uid = parseInt(part.split('=')[1], 10);
            }
        }

        if (enrollNumber > 0) {
            usersToInsert.push({
                enroll_number: enrollNumber,
                name: name || `User ${enrollNumber}`,
                privilege: privilege,
                password: password,
                card_number: card
            });
            processedUsers.push({ enrollNumber, uid });
        }
    }

    // Batch upsert users
    if (usersToInsert.length > 0) {
        const { error } = await supabase.from('employees').upsert(usersToInsert, { onConflict: 'enroll_number', ignoreDuplicates: false });
        if (error) {
            console.error(`[ADMS] ❌ Error syncing users: ${error.message}`);
        } else {
            console.log(`[ADMS] 👥 Synced ${usersToInsert.length} Users from SN: ${sn}`);
            
            // Add to device_users
            const { data: device } = await supabase.from('devices').select('id').eq('serial_number', sn).single();
            if (device) {
                const deviceUsersToInsert = processedUsers.map(u => {
                    const user = usersToInsert.find(row => row.enroll_number === u.enrollNumber) || {};
                    return {
                        device_id: device.id,
                        enroll_number: u.enrollNumber,
                        device_uid: u.uid || u.enrollNumber,
                        name: user.name || `User ${u.enrollNumber}`,
                        privilege: user.privilege || 0,
                        card_number: user.card_number || '0',
                        synced_at: new Date().toISOString()
                    };
                });
                await supabase.from('device_users').upsert(deviceUsersToInsert, { onConflict: 'device_id,enroll_number' });
            }
        }
    }
    
    return processedUsers.map(u => u.enrollNumber);
}

/**
 * Parses raw BIODATA string from ADMS and inserts into biometrics table
 */
async function parseAndInsertBiometrics(rawData, sn) {
    const lines = rawData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return;

    const rowsToInsert = [];

    for (const line of lines) {
        let enrollNumber = 0;
        let fingerIndex = 0;
        let templateType = 1;
        let templateData = '';
        let valid = 1;

        const fields = parseKeyValueFields(line);
        if (fields.PIN || fields.FID || fields.TMP) {
            enrollNumber = parseInt(fields.PIN, 10);
            fingerIndex = parseInt(fields.FID ?? fields.No ?? fields.Index ?? '0', 10);
            templateType = parseInt(fields.Type ?? fields.MajorVer ?? '1', 10) || 1;
            templateData = fields.TMP || fields.Tmp || '';
            valid = parseInt(fields.Valid ?? '1', 10) || 1;
        } else {
            // Example BIODATA: PIN\tNo\tIndex\tValid\tDuress\tType\tMajorVer\tMinorVer\tFormat\tTmp
            const parts = line.split('\t');
            if (parts.length >= 4) {
                enrollNumber = parseInt(parts[0], 10);
                fingerIndex = parseInt(parts[1], 10);
                valid = parseInt(parts[3], 10) || 1;
                if (parts.length >= 10) templateType = parseInt(parts[5], 10) || 1;
                templateData = parts[parts.length - 1];
            }
        }

        if (isNaN(enrollNumber) || enrollNumber <= 0 || isNaN(fingerIndex) || !templateData) continue;

        rowsToInsert.push({
            enroll_number: enrollNumber,
            finger_index: fingerIndex,
            template_type: templateType,
            template_data: templateData,
            valid
        });
    }

    if (rowsToInsert.length === 0) return;

    const { error } = await supabase.from('biometrics').upsert(rowsToInsert, {
        onConflict: 'enroll_number,finger_index',
        ignoreDuplicates: false // Overwrite if they re-registered the same finger
    });

    if (error) {
        console.error(`[ADMS] ❌ Error inserting biometrics: ${error.message}`);
    } else {
        console.log(`[ADMS] 🧬 Synced ${rowsToInsert.length} Biometric Templates from device ${sn}`);
    }
}

async function parseOperLog(rawData, sn) {
    const lines = rawData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const processedUsers = [];
    
    for (const line of lines) {
        if (line.includes('OPLOG OP=')) {
            // e.g. OPLOG OP=3 PIN=102
            const fields = parseKeyValueFields(line);
            const parts = line.split('\t');
            let opCode = null;
            let opPin = null;

            if (fields.OP || fields.PIN) {
                opCode = parseInt(fields.OP, 10);
                opPin = parseInt(fields.PIN, 10);
            } else {
                for (const part of parts) {
                    if (part.startsWith('OP=')) opCode = parseInt(part.split('=')[1], 10);
                    else if (part.startsWith('PIN=')) opPin = parseInt(part.split('=')[1], 10);
                }
            }

            if (opCode === 3 && opPin) {
                console.log(`[ADMS] 🗑️ Physical device deletion detected (OP=3) for PIN ${opPin}. Removing from device_users...`);
                // Lookup device id
                const { data: device } = await supabase.from('devices').select('id').eq('serial_number', sn).single();
                if (device) {
                    await supabase.from('device_users').delete()
                        .eq('device_id', device.id)
                        .eq('enroll_number', opPin);
                }
            }
            continue;
        }

        if (line.startsWith('USER PIN=')) {
            // e.g. USER PIN=104    Name=J  Pri=0   Passwd= Card= ...
            const fields = parseKeyValueFields(line);
            let enrollNumber = 0;
            let name = '';
            let privilege = 0;
            let password = '';
            let card = '0';
            let uid = 0;

            enrollNumber = parseInt(fields.PIN, 10);
            name = fields.Name || '';
            privilege = parseInt(fields.Pri || '0', 10);
            password = fields.Passwd || '';
            card = fields.Card || '0';
            uid = parseInt(fields.UID || '0', 10);

            if (enrollNumber > 0) {
                processedUsers.push(enrollNumber);
                const { error } = await supabase.from('employees').upsert({
                    enroll_number: enrollNumber,
                    name: name || `User ${enrollNumber}`,
                    privilege: privilege,
                    password: password,
                    card_number: card
                }, { onConflict: 'enroll_number', ignoreDuplicates: false });

                // Add to device_users
                const { data: device } = await supabase.from('devices').select('id').eq('serial_number', sn).single();
                if (device) {
                    const { error: deviceUserError } = await supabase.from('device_users').upsert(
                        {
                            device_id: device.id,
                            enroll_number: enrollNumber,
                            device_uid: uid || enrollNumber,
                            name: name || `User ${enrollNumber}`,
                            privilege: privilege,
                            card_number: card,
                            synced_at: new Date().toISOString()
                        },
                        { onConflict: 'device_id,enroll_number' }
                    );
                    if (deviceUserError) console.error(`[ADMS] ❌ Error inserting device_user: ${deviceUserError.message}`);
                }

                if (!error) console.log(`[ADMS] 👤 Synced User from OPERLOG: ${name} (${enrollNumber})`);
                else console.error(`[ADMS] ❌ Error syncing user from OPERLOG: ${error.message}`);
            }
        } 
        else if (line.startsWith('FP PIN=')) {
            // e.g. FP PIN=104      FID=7   Size=1280       Valid=1 TMP=Sv1T...
            const fields = parseKeyValueFields(line);
            let enrollNumber = 0;
            let fid = 0;
            let tmp = '';

            enrollNumber = parseInt(fields.PIN, 10);
            fid = parseInt(fields.FID || '0', 10);
            tmp = fields.TMP || '';

            if (enrollNumber > 0 && tmp) {
                const { error } = await supabase.from('biometrics').upsert({
                    enroll_number: enrollNumber,
                    finger_index: fid,
                    template_type: 1, // standard FP
                    template_data: tmp,
                    valid: 1
                }, { onConflict: 'enroll_number,finger_index', ignoreDuplicates: false });

                if (!error) console.log(`[ADMS] 🧬 Synced Fingerprint from OPERLOG for User ${enrollNumber} (Finger ${fid})`);
                else console.error(`[ADMS] ❌ Error syncing fingerprint from OPERLOG: ${error.message}`);
            }
        }
    }
    
    return processedUsers;
}

module.exports = {
    parseAndInsertPunches,
    parseAndInsertUser,
    parseAndInsertBiometrics,
    parseOperLog
};
