/**
 * Simple logger utility to standardise logs
 */

function logInfo(message) {
    console.log(`[INFO] ${new Date().toISOString()} | ${message}`);
}

function logError(message, error = null) {
    console.error(`[ERROR] ${new Date().toISOString()} | ${message}`);
    if (error) {
        console.error(error);
    }
}

function logWarn(message) {
    console.warn(`[WARN] ${new Date().toISOString()} | ${message}`);
}

module.exports = {
    logInfo,
    logError,
    logWarn
};
