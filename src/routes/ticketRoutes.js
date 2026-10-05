const express = require('express');
const router = express.Router();
const { listTickets, createTicket, updateTicket, deleteTicket } = require('../controllers/ticketController');

router.get('/', listTickets);
router.post('/', createTicket);
router.put('/:id', updateTicket);
router.delete('/:id', deleteTicket);

module.exports = router;