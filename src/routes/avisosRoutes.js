const express = require('express');
const router = express.Router();
const { gerarAviso, servirAudio, listarAvisos } = require('../controllers/elevenlabsController');

router.post('/gerar', gerarAviso);
router.get('/audio/:id', servirAudio);
router.get('/', listarAvisos);

module.exports = router;