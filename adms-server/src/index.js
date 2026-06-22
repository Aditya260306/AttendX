require('dotenv').config({ path: '../.env' });
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const {
    parseAndInsertPunches,
    parseAndInsertUser,
    parseAndInsertBiometrics,
    parseOperLog
} = require('./parser');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Fatal Error: Missing Supabase credentials in root .env file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.text({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));

// Background Watchdog: Checks for stalled commands
setInterval(async () => {
    const staleCutoff = Date.now() - 6000;
    
    // Find active sync_users commands that haven't received data recently
    const { data: activeCmds } = await supabase
        .from('device_commands')
        .select('*')
        .eq('command_type', 'sync_users')
        .in('status', ['acknowledged', 'streaming']);

    if (activeCmds) {
        for (const cmd of activeCmds) {
            const lastActivity = cmd.sync_metadata?.last_activity;
            if (lastActivity && lastActivity < staleCutoff) {
                console.log(`\n[ADMS] 🏁 Sync data transfer complete for command ${cmd.id}. Finalizing command...`);
                await completeCommand(cmd, cmd.id, 'Sync complete (Watchdog)');
            }
        }
    }
}, 5000);

async function getDeleteIdentifiers(cmd, enroll) {
    const identifiers = new Set();
    const enrollNumber = parseInt(enroll, 10);
    if (!isNaN(enrollNumber) && enrollNumber > 0) identifiers.add(enrollNumber);

    const { data: userRow } = await supabase
        .from('device_users')
        .select('device_uid')
        .eq('device_id', cmd.device_id)
        .eq('enroll_number', enrollNumber)
        .maybeSingle();

    const deviceUid = parseInt(userRow?.device_uid, 10);
    if (!isNaN(deviceUid) && deviceUid > 0) identifiers.add(deviceUid);

    return Array.from(identifiers);
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/, '');
}

async function resolveDevice(sn, req) {
    if (sn) {
        const { data: bySerial } = await supabase
            .from('devices')
            .select('*')
            .eq('serial_number', sn)
            .maybeSingle();
        if (bySerial) return bySerial;
    }

    const ip = getClientIp(req);
    if (ip) {
        const { data: byIp } = await supabase
            .from('devices')
            .select('*')
            .eq('ip_address', ip)
            .maybeSingle();
        if (byIp) {
            if (sn && byIp.serial_number !== sn) {
                await supabase.from('devices').update({ serial_number: sn }).eq('id', byIp.id);
                byIp.serial_number = sn;
                console.log(`[ADMS] Linked SN ${sn} to ${byIp.name} by IP ${ip}`);
            }
            return byIp;
        }
    }

    if (sn) {
        const { data: unclaimed } = await supabase
            .from('devices')
            .select('*')
            .is('serial_number', null)
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (unclaimed) {
            await supabase.from('devices').update({ serial_number: sn }).eq('id', unclaimed.id);
            unclaimed.serial_number = sn;
            console.log(`[ADMS] Linked SN ${sn} to first unclaimed device ${unclaimed.name}`);
            return unclaimed;
        }
    }

    return null;
}

function escapeAdmsValue(value) {
    return String(value ?? '').replace(/[\t\r\n]/g, ' ').trim();
}

function extractCommandParts(rawCmdId) {
    const raw = String(rawCmdId || '');
    const match = raw.match(/^(\d+)(?:_(.+))?$/);
    if (!match) return { mainId: NaN, suffix: '' };
    return { mainId: parseInt(match[1], 10), suffix: match[2] || '' };
}

async function completeCommand(cmdData, commandId, result) {
    console.log(`[ADMS] ✅ COMMAND COMPLETED: ${cmdData.command_type || 'unknown'} (ID: ${commandId}). Final message sent to dashboard.`);
    await supabase.from('device_commands').update({
        status: 'completed',
        result,
        executed_at: new Date().toISOString()
    }).eq('id', commandId);

    if (cmdData.command_type === 'add_user') {
        const payload = cmdData.payload || {};
        const enroll = parseInt(payload.enroll_number || payload.uid, 10);
        if (!enroll) return;

        await supabase.from('employees').upsert({
            enroll_number: enroll,
            name: payload.name || `User ${enroll}`,
            privilege: payload.privilege || 0,
            password: payload.password || '',
            card_number: payload.cardNumber ? String(payload.cardNumber) : '0'
        }, { onConflict: 'enroll_number', ignoreDuplicates: true });

        await supabase.from('device_users').upsert({
            device_id: cmdData.device_id,
            enroll_number: enroll,
            device_uid: enroll,
            name: payload.name || `User ${enroll}`,
            privilege: payload.privilege || 0,
            card_number: payload.cardNumber ? String(payload.cardNumber) : '0',
            synced_at: new Date().toISOString()
        }, { onConflict: 'device_id,enroll_number' });
    }

    if (cmdData.command_type === 'delete_user') {
        const enroll = cmdData.payload?.enroll_number || cmdData.payload?.uid;
        if (enroll) {
            await supabase.from('device_users').delete()
                .eq('device_id', cmdData.device_id)
                .eq('enroll_number', enroll);
        }
    }
}

async function failCommand(commandId, result) {
    console.log(`[ADMS] ❌ COMMAND FAILED (ID: ${commandId}): ${result}. Final message sent to dashboard.`);
    await supabase.from('device_commands').update({
        status: 'failed',
        result,
        executed_at: new Date().toISOString()
    }).eq('id', commandId);
}

app.use((req, res, next) => {
    if (!req.originalUrl.includes('getrequest')) {
        console.log(`[NETWORK] Incoming request: ${req.method} ${req.originalUrl}`);
    }
    next();
});

app.get(['/iclock/cdata', '/iclock/cdata.aspx'], (req, res) => {
    const sn = (req.query.SN || '').trim();
    console.log(`\n[ADMS] Handshake request from SN: ${sn}`);

    resolveDevice(sn, req).then(device => {
        if (!device) return;
        supabase.from('devices').update({
            status: 'connected',
            last_seen: new Date().toISOString()
        }).eq('id', device.id).then(() => {});
    }).catch(err => console.error(`[ADMS] Device resolve failed: ${err.message}`));

    res.setHeader('Content-Type', 'text/plain');
    res.send(`GET OPTION FROM:${sn}\nStamp=9999\nOpStamp=9999\nErrorDelay=60\nDelay=5\nTransTimes=00:00;14:00\nTransInterval=1\nTransFlag=11111111\nTimeZone=530\nRealtime=1\nEncrypt=0`);
});

app.post(['/iclock/cdata', '/iclock/cdata.aspx'], async (req, res) => {
    const sn = (req.query.SN || '').trim();
    const table = req.query.table;
    const rawData = req.body || '';
    // 1. Reply to the device immediately so it can send the next batch without waiting!
    res.setHeader('Content-Type', 'text/plain');
    res.send('OK');

    // 2. Insert payload into the database queue for absolute crash safety
    (async () => {
        try {
            const opstamp = req.query.OpStamp || '';
            await supabase.from('raw_cdata_payloads').insert({
                device_sn: sn,
                table_name: table,
                payload: rawData,
                opstamp: opstamp
            });
            console.log(`\n[ADMS] 📥 Queued raw payload for SN: ${sn} | Table: ${table}`);
        } catch (err) {
            console.error(`[ADMS] Error queueing cdata for SN: ${sn}`, err);
        }
    })();
});

// ---------------------------------------------------------
// BACKGROUND WORKER: Processes raw payloads from the DB queue
// ---------------------------------------------------------
let isWorkerRunning = false;
setInterval(async () => {
    if (isWorkerRunning) return;
    isWorkerRunning = true;

    try {
        const { data: payloads } = await supabase
            .from('raw_cdata_payloads')
            .select('*')
            .eq('processed', false)
            .order('created_at', { ascending: true })
            .limit(10);

        if (!payloads || payloads.length === 0) {
            isWorkerRunning = false;
            return;
        }

        for (const record of payloads) {
            const sn = record.device_sn;
            const table = record.table_name;
            const rawData = record.payload;

            try {
                // Determine device to update last seen
                const { data: device } = await supabase
                    .from('devices')
                    .select('id')
                    .eq('serial_number', sn)
                    .maybeSingle();

                if (device) {
                    await supabase.from('devices').update({
                        status: 'connected',
                        last_seen: new Date().toISOString()
                    }).eq('id', device.id);
                }

                if (table === 'ATTLOG') {
                    console.log(`[ADMS Worker] Processing ATTLOG for SN: ${sn}`);
                    await parseAndInsertPunches(rawData, sn);
                } else if (table === 'USER' || table === 'USERINFO' || table === 'OPERLOG' || table === 'BIODATA' || table === 'FINGERTMP') {
                    const { data: activeCmd } = await supabase
                        .from('device_commands')
                        .select('*')
                        .eq('device_id', device?.id)
                        .eq('command_type', 'sync_users')
                        .in('status', ['acknowledged', 'streaming'])
                        .maybeSingle();

                    if (activeCmd) {
                        if (activeCmd.status !== 'streaming') {
                            await supabase.from('device_commands').update({ status: 'streaming' }).eq('id', activeCmd.id);
                        }
                        console.log(`[ADMS Worker] Processing ${table} for SN: ${sn}`);
                        
                        let itemsCount = 0;
                        if (table === 'USER' || table === 'USERINFO') {
                            const users = await parseAndInsertUser(rawData, sn);
                            itemsCount = users?.length || 0;
                        } else if (table === 'OPERLOG') {
                            const users = await parseOperLog(rawData, sn);
                            itemsCount = users?.length || 0;
                        } else {
                            await parseAndInsertBiometrics(rawData, sn);
                            itemsCount = 1;
                        }

                        if (itemsCount > 0) {
                            const meta = activeCmd.sync_metadata || {};
                            meta.parsed_count = (meta.parsed_count || 0) + itemsCount;
                            meta.last_activity = Date.now();
                            await supabase.from('device_commands').update({ sync_metadata: meta }).eq('id', activeCmd.id);
                        }
                    }
                }

                // Mark processed
                await supabase.from('raw_cdata_payloads').update({
                    processed: true,
                    processed_at: new Date().toISOString()
                }).eq('id', record.id);
            } catch (err) {
                console.error(`[ADMS Worker] Error processing payload ${record.id}:`, err);
                await supabase.from('raw_cdata_payloads').update({
                    processed: true,
                    error: err.message,
                    processed_at: new Date().toISOString()
                }).eq('id', record.id);
            }
        }
    } catch (e) {
        console.error(`[ADMS Worker] Fatal worker error:`, e);
    } finally {
        isWorkerRunning = false;
    }
}, 2000);

app.get(['/iclock/getrequest', '/iclock/getrequest.aspx'], async (req, res) => {
    const sn = (req.query.SN || '').trim();
    const device = await resolveDevice(sn, req);
    if (!device) {
        res.setHeader('Content-Type', 'text/plain');
        return res.send('OK');
    }

    const staleCutoff = new Date(Date.now() - 90 * 1000).toISOString();
    await supabase
        .from('device_commands')
        .update({ status: 'pending', result: 'Recovered stale ADMS processing command' })
        .eq('device_id', device.id)
        .eq('status', 'processing')
        .eq('payload->>transport', 'adms')
        .lt('created_at', staleCutoff);

    const { data: commands } = await supabase
        .from('device_commands')
        .select('*')
        .eq('device_id', device.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10);

    if (!commands || commands.length === 0) {
        res.setHeader('Content-Type', 'text/plain');
        return res.send('OK');
    }

    let responseText = '';
    console.log(`\n[ADMS] Sending ${commands.length} pending command(s) to SN: ${sn}`);

    for (const cmd of commands) {
        const payload = cmd.payload || {};
        let shouldMarkProcessing = false;

        if (cmd.command_type === 'add_user') {
            const enroll = payload.enroll_number || payload.uid;
            const userCmd = `DATA UPDATE USERINFO PIN=${enroll}\tName=${escapeAdmsValue(payload.name || '')}\tPri=${payload.privilege || 0}\tPasswd=${escapeAdmsValue(payload.password || '')}\tCard=${escapeAdmsValue(payload.cardNumber || '')}\tGrp=1\tTZ=0000000100000000`;
            responseText += `C:${cmd.id}_USER:${userCmd}\n`;
            shouldMarkProcessing = true;

            const { data: bios } = await supabase
                .from('biometrics')
                .select('*')
                .eq('enroll_number', enroll)
                .order('finger_index', { ascending: true });

            for (const bio of (bios || [])) {
                const bioSize = bio.template_data.length;
                const bioCmd = `DATA UPDATE FINGERTMP PIN=${enroll}\tFID=${bio.finger_index}\tSize=${bioSize}\tValid=${bio.valid ?? 1}\tTMP=${bio.template_data}`;
                responseText += `C:${cmd.id}_FP_${bio.finger_index}:${bioCmd}\n`;
            }
        } else if (cmd.command_type === 'delete_user') {
            const enroll = payload.enroll_number || payload.uid;
            const identifiers = await getDeleteIdentifiers(cmd, enroll);
            shouldMarkProcessing = true;

            for (const identifier of identifiers) {
                for (let i = 0; i <= 9; i++) {
                    responseText += `C:${cmd.id}_DELFP_${identifier}_${i}:DATA DELETE FINGERTMP PIN=${identifier}\tFID=${i}\n`;
                }
                responseText += `C:${cmd.id}_DELUSER_${identifier}:DATA DELETE USER PIN=${identifier}\n`;
                responseText += `C:${cmd.id}_DELUSERINFO_${identifier}:DATA DELETE USERINFO PIN=${identifier}\n`;
            }
            responseText += `C:${cmd.id}_DELETEQUERY:DATA QUERY USERINFO\n`;
            responseText += `C:${cmd.id}_DELETEVERIFY:CHECK\n`;
        } else if (cmd.command_type === 'sync_users') {
            shouldMarkProcessing = true;
            responseText += `C:${cmd.id}_U:DATA QUERY USERINFO\n`;
            responseText += `C:${cmd.id}_B:DATA QUERY FINGERTMP\n`;
            responseText += `C:${cmd.id}_SYNC:CHECK\n`;
        } else if (cmd.command_type === 'sync_time') {
            shouldMarkProcessing = true;
            responseText += `C:${cmd.id}:LOG\n`;
        }

        if (shouldMarkProcessing) {
            await supabase.from('device_commands').update({ status: 'processing' }).eq('id', cmd.id);
        }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(responseText || 'OK');
});

app.post(['/iclock/devicecmd', '/iclock/devicecmd.aspx'], async (req, res) => {
    const sn = (req.query.SN || '').trim();
    const body = req.body || '';

    console.log(`\n[ADMS] Command Result from SN: ${sn}:`);
    console.log(body);

    const lines = body.split('\n');
    for (const line of lines) {
        if (!line) continue;

        const idMatch = line.match(/ID=([^&\s]+)/);
        const returnMatch = line.match(/Return=([-0-9]+)/);
        if (!idMatch || !returnMatch) continue;

        const rawCmdId = idMatch[1];
        const { mainId, suffix } = extractCommandParts(rawCmdId);
        const returnCode = parseInt(returnMatch[1], 10);
        if (isNaN(mainId)) continue;

        const { data: cmdData } = await supabase
            .from('device_commands')
            .select('command_type, device_id, payload, status')
            .eq('id', mainId)
            .single();
        if (!cmdData || cmdData.status === 'completed' || cmdData.status === 'failed') continue;

        const succeeded = returnCode >= 0;
        await supabase.from('device_commands').update({ result: line }).eq('id', mainId);

        if (cmdData.command_type === 'add_user') {
            const enroll = cmdData.payload?.enroll_number || cmdData.payload?.uid;
            const { data: bios } = await supabase
                .from('biometrics')
                .select('finger_index')
                .eq('enroll_number', enroll)
                .order('finger_index', { ascending: true });
            const lastFinger = (bios || []).length ? String(bios[bios.length - 1].finger_index) : null;
            const isRequiredFinal = lastFinger === null ? suffix === 'USER' : suffix === `FP_${lastFinger}`;
            const isRequiredFailure = suffix === 'USER' || suffix.startsWith('FP_');

            if (!succeeded && isRequiredFailure) {
                await failCommand(mainId, line);
            } else if (succeeded && isRequiredFinal) {
                await completeCommand(cmdData, mainId, line);
            }
        } else if (cmdData.command_type === 'delete_user') {
            const isFingerprintCleanup = suffix.startsWith('DELFP_');
            const isDeleteVerify = suffix === 'DELETEVERIFY';

            if (!succeeded && isFingerprintCleanup) {
                console.log(`[ADMS] Ignoring best-effort fingerprint cleanup failure for ${rawCmdId}`);
            } else if (!succeeded && isDeleteVerify) {
                await failCommand(mainId, line);
            } else if (succeeded && isDeleteVerify) {
                // We've moved away from memory state, so we'll just optimistically complete it
                await completeCommand(cmdData, mainId, line);
            }
        } else if (cmdData.command_type === 'sync_users') {
            if (!succeeded && suffix === 'SYNC') {
                await failCommand(mainId, line);
            } else if (succeeded && suffix === 'SYNC') {
                console.log(`[ADMS] Sync command acknowledged for SN: ${sn}. Waiting for uploads to finish...`);
                await supabase.from('device_commands').update({ 
                    status: 'acknowledged',
                    result: line,
                    sync_metadata: { last_activity: Date.now(), parsed_count: 0 }
                }).eq('id', mainId);
            }
        } else if (succeeded) {
            await completeCommand(cmdData, mainId, line);
        } else {
            await failCommand(mainId, line);
        }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send('OK');
});

// Global Error Handler to prevent raw-body/TCP abort crashes
app.use((err, req, res, next) => {
    if (err) {
        console.error(`[ADMS] Express Stream Error: ${err.message}`);
        if (!res.headersSent) {
            res.status(400).send('Bad Request');
        }
    } else {
        next();
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log('\n===========================================');
    console.log(`ADMS Express Server running on Port ${port}`);
    console.log('===========================================');
    console.log('Waiting for ZK devices to connect...');
});
