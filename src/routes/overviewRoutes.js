const express = require('express');
const router = express.Router();
const { getOverview } = require('../controllers/overviewController');

router.get('/', getOverview);

module.exports = router;