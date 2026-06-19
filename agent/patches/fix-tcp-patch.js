/**
 * Fix the patched zklibtcp.js — moves methods inside the class body
 */
const fs = require('fs');
const path = require('path');

const tcpPath = path.join(__dirname, '..', 'node_modules', 'node-zklib', 'zklibtcp.js');
let content = fs.readFileSync(tcpPath, 'utf8');

// Remove the old badly-placed patch (everything after the class closing brace that isn't module.exports)
// Find the last occurrence of the class closing brace
const classEndIndex = content.lastIndexOf('\n}');
const beforeClass = content.substring(0, classEndIndex);

// Build the methods to insert inside the class
const methods = [
  '',
  '  // === AttendX Protocol Patch — Write Operations ===',
  '',
  '  encodeTime(date) {',
  '    const d = (',
  '      ((date.getFullYear() % 100) * 12 * 31 + (date.getMonth()) * 31 + date.getDate() - 1) *',
  '      (24 * 60 * 60) + (date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()',
  '    );',
  '    return d;',
  '  }',
  '',
  '  async setTime(date) {',
  '    const encoded = this.encodeTime(date);',
  '    const buf = Buffer.alloc(4);',
  '    buf.writeUInt32LE(encoded, 0);',
  '    const reply = await this.executeCmd(COMMANDS.CMD_SET_TIME, buf);',
  '    if (reply) {',
  '      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;',
  '      if (cmdId === COMMANDS.CMD_ACK_OK) return true;',
  '    }',
  "    throw new Error('CMD_SET_TIME failed');",
  '  }',
  '',
  "  async setUser(uid, userId, name, password = '', privilege = 0, cardno = 0) {",
  '    uid = parseInt(uid) || 0;',
  '    privilege = parseInt(privilege) || 0;',
  '    cardno = parseInt(cardno) || 0;',
  '    if (!userId) userId = String(uid);',
  "    if (!name) name = 'User ' + uid;",
  '    const buf = Buffer.alloc(72);',
  '    let o = 0;',
  '    buf.writeUInt16LE(uid, o); o += 2;',
  '    buf.writeUInt8(privilege, o); o += 1;',
  '    const pw = Buffer.alloc(8, 0);',
  "    Buffer.from(String(password || '').slice(0, 8)).copy(pw);",
  '    pw.copy(buf, o); o += 8;',
  '    const nm = Buffer.alloc(24, 0);',
  '    Buffer.from(String(name).slice(0, 24)).copy(nm);',
  '    nm.copy(buf, o); o += 24;',
  '    buf.writeUInt32LE(cardno, o); o += 4;',
  '    buf.writeUInt8(0, o); o += 1;',
  '    o += 7;',
  '    buf.writeUInt8(0, o); o += 1;',
  '    const ui = Buffer.alloc(24, 0);',
  '    Buffer.from(String(userId).slice(0, 24)).copy(ui);',
  '    ui.copy(buf, o);',
  '    const reply = await this.executeCmd(COMMANDS.CMD_USER_WRQ, buf);',
  '    if (reply) {',
  '      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;',
  '      if (cmdId === COMMANDS.CMD_ACK_OK) {',
  "        await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');",
  '        return true;',
  '      }',
  '    }',
  "    throw new Error('CMD_USER_WRQ failed');",
  '  }',
  '',
  '  async deleteUser(uid) {',
  '    uid = parseInt(uid) || 0;',
  '    const buf = Buffer.alloc(2);',
  '    buf.writeInt16LE(uid, 0);',
  '    const reply = await this.executeCmd(COMMANDS.CMD_DELETE_USER, buf);',
  '    if (reply) {',
  '      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;',
  '      if (cmdId === COMMANDS.CMD_ACK_OK) {',
  "        await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');",
  '        return true;',
  '      }',
  '    }',
  "    throw new Error('CMD_DELETE_USER failed');",
  '  }',
  '',
  '  async restart() {',
  "    const reply = await this.executeCmd(COMMANDS.CMD_RESTART, '');",
  '    if (reply) {',
  '      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;',
  '      if (cmdId === COMMANDS.CMD_ACK_OK) return true;',
  '    }',
  "    throw new Error('CMD_RESTART failed');",
  '  }',
  '',
  '  async powerOff() {',
  "    const reply = await this.executeCmd(COMMANDS.CMD_POWEROFF, '');",
  '    if (reply) {',
  '      const cmdId = reply.length >= 2 ? reply.readUInt16LE(0) : 0;',
  '      if (cmdId === COMMANDS.CMD_ACK_OK) return true;',
  '    }',
  "    throw new Error('CMD_POWEROFF failed');",
  '  }',
  '',
  '  async refreshData() {',
  "    return await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');",
  '  }',
  '',
].join('\n');

// Reconstruct: original class body + new methods + closing brace + module.exports
const newContent = beforeClass + '\n' + methods + '\n}\n\nmodule.exports = ZKLibTCP\n';

fs.writeFileSync(tcpPath, newContent, 'utf8');
console.log('OK - zklibtcp.js patched (methods inside class)');
