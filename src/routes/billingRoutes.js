const express = require('express');
const router = express.Router();
const { listBillings, createBilling, markPaid, updateBilling, deleteBilling } = require('../controllers/billingController');

router.get('/', listBillings);
router.post('/', createBilling);
router.post('/:id/paid', markPaid);
router.put('/:id', updateBilling);
router.delete('/:id', deleteBilling);

module.exports = router;