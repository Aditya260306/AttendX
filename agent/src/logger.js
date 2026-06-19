const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getTimestamp() {
  return new Date().toISOString();
}

function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `agent-${date}.log`);
}

function writeToFile(level, msg, data) {
  const line = `[${getTimestamp()}] [${level}] ${msg}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), line);
  } catch (_) { /* ignore file write errors */ }
}

const logger = {
  info(msg, data) {
    console.log(`  ℹ️  ${msg}`, data || '');
    writeToFile('INFO', msg, data);
  },
  success(msg, data) {
    console.log(`  ✅ ${msg}`, data || '');
    writeToFile('SUCCESS', msg, data);
  },
  warn(msg, data) {
    console.warn(`  ⚠️  ${msg}`, data || '');
    writeToFile('WARN', msg, data);
  },
  error(msg, data) {
    console.error(`  ❌ ${msg}`, data || '');
    writeToFile('ERROR', msg, data);
  },
  sync(msg, data) {
    console.log(`  🔄 ${msg}`, data || '');
    writeToFile('SYNC', msg, data);
  },
};

module.exports = logger;
