const express = require('express');
const router = express.Router();
const { listUnits, createUnit, updateUnit, deleteUnit } = require('../controllers/unitController');

router.get('/', listUnits);
router.post('/', createUnit);
router.put('/:id', updateUnit);
router.delete('/:id', deleteUnit);

module.exports = router;