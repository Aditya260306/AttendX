require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');

const admsRoutes = require('./routes/adms.routes');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxies to get real client IP and prevent IP spoofing
app.set('trust proxy', true);

// Middleware
app.use(cors());
// ZKTeco sends raw text payloads, so we need a text parser for all routes
app.use(express.text({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
    if (!req.originalUrl.includes('getrequest')) {
        console.log(`[NETWORK] ${new Date().toISOString()} | ${req.method} ${req.originalUrl} | IP: ${req.ip}`);
    }
    next();
});

const { startWorker } = require('./workers/queue.worker');

// Routes
app.use('/iclock', admsRoutes);

// Start Queue Worker
startWorker();

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[EXPRESS ERROR] ${err.message}`);
    if (!res.headersSent) {
        res.status(400).send('Bad Request');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n===========================================');
    console.log(`🚀 AttendX Machines Server running on Port ${PORT}`);
    console.log('🛡️  Enterprise Mode Active (Fail-Safe Queues)');
    console.log('===========================================');
});
