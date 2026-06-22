const express = require('express');
const router = express.Router();
const admsController = require('../controllers/adms.controller');

// ADMS Protocol Endpoints
// Some ZKTeco firmware appends .aspx, so we handle both

router.get(['/cdata', '/cdata.aspx'], admsController.handshake);
router.post(['/cdata', '/cdata.aspx'], admsController.ingestData);

router.get(['/getrequest', '/getrequest.aspx'], admsController.getPendingCommands);
router.post(['/devicecmd', '/devicecmd.aspx'], admsController.commandResult);

module.exports = router;
