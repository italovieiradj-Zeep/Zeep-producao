const express = require('express');
const router = express.Router();
const { listJingles, createJingle, updateJingle, deleteJingle } = require('../controllers/jingleController');

router.get('/', listJingles);
router.post('/', createJingle);
router.put('/:id', updateJingle);
router.delete('/:id', deleteJingle);

module.exports = router;