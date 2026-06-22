/**
 * Helper functions for formatting and parsing ZKTeco ADMS specific strings.
 */

function escapeAdmsValue(value) {
    return String(value ?? '').replace(/[\t\r\n]/g, ' ').trim();
}

/**
 * Extracts Key=Value pairs from a raw ZKTeco string
 * e.g., "USER PIN=104 Name=John Pri=0"
 */
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
 * Extracts main ID and suffix from command return strings
 * e.g., "ID=123_USER" -> { mainId: 123, suffix: "USER" }
 */
function extractCommandParts(rawCmdId) {
    const raw = String(rawCmdId || '');
    const match = raw.match(/^(\d+)(?:_(.+))?$/);
    if (!match) return { mainId: NaN, suffix: '' };
    return { mainId: parseInt(match[1], 10), suffix: match[2] || '' };
}

module.exports = {
    escapeAdmsValue,
    parseKeyValueFields,
    extractCommandParts
};
