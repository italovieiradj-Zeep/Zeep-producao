// src/routes/bibliotecaRoutes.js
const express = require('express');
const router = express.Router();
const c = require('../controllers/bibliotecaController');

router.get('/', c.listar);
router.post('/', c.criar);
router.get('/:id/tracks', c.listarTracks);
router.put('/:id', c.editar);
router.delete('/:id', c.excluir);
router.post('/:id/tracks', c.adicionarTracks);
router.put('/:id/tracks', c.substituirTracks);
router.delete('/:id/tracks', c.removerTracks);

module.exports = router;