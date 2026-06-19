/**
 * AttendX ZKLib Protocol Patch
 * 
 * Adds missing write operations to node-zklib:
 *   - setUser()      → CMD_USER_WRQ (8)
 *   - deleteUser()   → CMD_DELETE_USER (18)
 *   - setTime()      → CMD_SET_TIME (202)
 *   - restart()      → CMD_RESTART (1004)
 *   - powerOff()     → CMD_POWEROFF (1005)
 *   - refreshData()  → CMD_REFRESHDATA (1013)
 * 
 * Based on pyzk (github.com/fananimi/pyzk) binary packet formats.
 * Applied automatically via npm postinstall.
 */

const path = require('path');
const fs = require('fs');

function applyPatch() {
  const agentDir = path.resolve(__dirname, '..');

  // ─── 1. Patch constants.js — add missing command IDs ──────────────
  const constantsPath = path.join(agentDir, 'node_modules', 'node-zklib', 'constants.js');
  let constantsContent = fs.readFileSync(constantsPath, 'utf8');

  const newConstants = {
    CMD_SET_TIME: 202,
    CMD_RESTART: 1004,
    CMD_POWEROFF: 1005,
    CMD_REFRESHDATA: 1013,
    CMD_DISABLEDEVICE: 1003,
    CMD_ENABLEDEVICE: 1002,
  };

  for (const [key, val] of Object.entries(newConstants)) {
    if (!constantsContent.includes(key)) {
      constantsContent = constantsContent.replace(
        /CMD_ACK_OK/,
        `${key}:${val},\n    CMD_ACK_OK`
      );
      console.log(`  + Added ${key}:${val}`);
    }
  }

  fs.writeFileSync(constantsPath, constantsContent, 'utf8');

  // ─── 2. Patch zklibtcp.js — add write methods ─────────────────────
  const tcpPath = path.join(agentDir, 'node_modules', 'node-zklib', 'zklibtcp.js');
  let tcpContent = fs.readFileSync(tcpPath, 'utf8');

  // Only apply if not already patched
  if (!tcpContent.includes('setUser(')) {
    // Add methods before the closing "module.exports"
    const insertBefore = 'module.exports = ZKLibTCP';
    const newMethods = `

  // ═══════════════════════════════════════════════════════════════
  // AttendX Protocol Patch — Write Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Encode a JavaScript Date to ZK timestamp format.
   * Formula: ((year%100)*12*31 + (month-1)*31 + day-1) * 86400 + hour*3600 + minute*60 + second
   */
  encodeTime(date) {
    const d = (
      ((date.getFullYear() % 100) * 12 * 31 + (date.getMonth()) * 31 + date.getDate() - 1) *
      (24 * 60 * 60) + (date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()
    );
    return d;
  }

  /**
   * Set device time.
   * CMD_SET_TIME (202) — payload: UInt32LE encoded timestamp
   */
  async setTime(date) {
    const encoded = this.encodeTime(date);
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(encoded, 0);
    const reply = await this.executeCmd(COMMANDS.CMD_SET_TIME, buf);
    if (reply) {
      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;
      if (cmdId === COMMANDS.CMD_ACK_OK) return true;
    }
    throw new Error('CMD_SET_TIME failed');
  }

  /**
   * Set (add/update) a user on the device.
   * CMD_USER_WRQ (8) — 72-byte struct for ZK8/TCP firmware:
   *   uid(2) + privilege(1) + password(8) + name(24) + card(4) + pad(1) + group(7) + pad(1) + userId(24)
   *   Pack format: '<HB8s24s4sx7sx24s'
   */
  async setUser(uid, userId, name, password = '', privilege = 0, cardno = 0) {
    uid = parseInt(uid) || 0;
    privilege = parseInt(privilege) || 0;
    cardno = parseInt(cardno) || 0;
    if (!userId) userId = String(uid);
    if (!name) name = 'User ' + uid;

    // Build the 72-byte packet matching pyzk repack73 / set_user for TCP
    const buf = Buffer.alloc(72);
    let offset = 0;

    // uid — UInt16LE (2 bytes)
    buf.writeUInt16LE(uid, offset); offset += 2;

    // privilege — UInt8 (1 byte)
    buf.writeUInt8(privilege, offset); offset += 1;

    // password — 8 bytes null-padded
    const pwBuf = Buffer.alloc(8, 0);
    Buffer.from(String(password).slice(0, 8)).copy(pwBuf);
    pwBuf.copy(buf, offset); offset += 8;

    // name — 24 bytes null-padded
    const nameBuf = Buffer.alloc(24, 0);
    Buffer.from(String(name).slice(0, 24)).copy(nameBuf);
    nameBuf.copy(buf, offset); offset += 24;

    // card number — 4 bytes UInt32LE
    buf.writeUInt32LE(cardno, offset); offset += 4;

    // padding — 1 byte
    buf.writeUInt8(0, offset); offset += 1;

    // group_id — 7 bytes null-padded (default empty)
    offset += 7;

    // padding — 1 byte
    buf.writeUInt8(0, offset); offset += 1;

    // user_id string — 24 bytes null-padded
    const userIdBuf = Buffer.alloc(24, 0);
    Buffer.from(String(userId).slice(0, 24)).copy(userIdBuf);
    userIdBuf.copy(buf, offset); offset += 24;

    // Total: 2+1+8+24+4+1+7+1+24 = 72 bytes ✓

    const reply = await this.executeCmd(COMMANDS.CMD_USER_WRQ, buf);
    if (reply) {
      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;
      if (cmdId === COMMANDS.CMD_ACK_OK) {
        // Refresh device data cache
        await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');
        return true;
      }
    }
    throw new Error('CMD_USER_WRQ failed');
  }

  /**
   * Delete a user from the device.
   * CMD_DELETE_USER (18) — payload: Int16LE uid
   */
  async deleteUser(uid) {
    uid = parseInt(uid) || 0;
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(uid, 0);
    const reply = await this.executeCmd(COMMANDS.CMD_DELETE_USER, buf);
    if (reply) {
      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;
      if (cmdId === COMMANDS.CMD_ACK_OK) {
        await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');
        return true;
      }
    }
    throw new Error('CMD_DELETE_USER failed');
  }

  /**
   * Restart the device.
   * CMD_RESTART (1004) — empty payload
   */
  async restart() {
    const reply = await this.executeCmd(COMMANDS.CMD_RESTART, '');
    if (reply) {
      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;
      if (cmdId === COMMANDS.CMD_ACK_OK) return true;
    }
    throw new Error('CMD_RESTART failed');
  }

  /**
   * Power off the device.
   * CMD_POWEROFF (1005) — empty payload
   */
  async powerOff() {
    const reply = await this.executeCmd(COMMANDS.CMD_POWEROFF, '');
    if (reply) {
      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;
      if (cmdId === COMMANDS.CMD_ACK_OK) return true;
    }
    throw new Error('CMD_POWEROFF failed');
  }

  /**
   * Refresh device internal data cache.
   * CMD_REFRESHDATA (1013) — empty payload
   */
  async refreshData() {
    return await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');
  }

`;

    tcpContent = tcpContent.replace(insertBefore, newMethods + insertBefore);
    fs.writeFileSync(tcpPath, tcpContent, 'utf8');
    console.log('  + Added setUser, deleteUser, setTime, restart, powerOff, refreshData to zklibtcp.js');
  } else {
    console.log('  = zklibtcp.js already patched');
  }

  // ─── 3. Patch zklib.js — add wrapper methods ──────────────────────
  const libPath = path.join(agentDir, 'node_modules', 'node-zklib', 'zklib.js');
  let libContent = fs.readFileSync(libPath, 'utf8');

  if (!libContent.includes('async setUser(')) {
    // Use regex to find the last } before module.exports and insert before it
    const insertRegex = /(\n}\s*\n+\s*module\.exports\s*=\s*ZKLib)/;
    const wrapperBlock = `
    // ═══════════ AttendX Protocol Patch — Wrapper Methods ═══════════

    async setUser(uid, userId, name, password, privilege, cardno) {
        return await this.functionWrapper(
            () => this.zklibTcp.setUser(uid, userId, name, password, privilege, cardno),
            () => { throw new Error('setUser not supported over UDP'); }
        )
    }

    async deleteUser(uid) {
        return await this.functionWrapper(
            () => this.zklibTcp.deleteUser(uid),
            () => { throw new Error('deleteUser not supported over UDP'); }
        )
    }

    async setTime(date) {
        return await this.functionWrapper(
            () => this.zklibTcp.setTime(date),
            () => { throw new Error('setTime not supported over UDP'); }
        )
    }

    async restart() {
        return await this.functionWrapper(
            () => this.zklibTcp.restart(),
            () => { throw new Error('restart not supported over UDP'); }
        )
    }

    async powerOff() {
        return await this.functionWrapper(
            () => this.zklibTcp.powerOff(),
            () => { throw new Error('powerOff not supported over UDP'); }
        )
    }

    async refreshData() {
        return await this.functionWrapper(
            () => this.zklibTcp.refreshData(),
            () => { throw new Error('refreshData not supported over UDP'); }
        )
    }
`;
    libContent = libContent.replace(insertRegex, '\n' + wrapperBlock + '$1');
    fs.writeFileSync(libPath, libContent, 'utf8');
    console.log('  + Added wrapper methods to zklib.js');
  } else {
    console.log('  = zklib.js already patched');
  }

  console.log('  ✓ ZKLib protocol patch applied successfully');
}

applyPatch();
