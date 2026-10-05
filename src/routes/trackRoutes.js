const express = require('express');
const router = express.Router();
const { listTracks, createTrack, updateTrack, deleteTrack } = require('../controllers/trackController');

router.get('/', listTracks);
router.post('/', createTrack);
router.put('/:id', updateTrack);
router.delete('/:id', deleteTrack);

module.exports = router;