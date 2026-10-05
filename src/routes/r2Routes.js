const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const supabase = require('../supabase');

const { listMusic, streamPreview, syncTracksFromR2, deleteMusic, listVinhetas, uploadVinheta, associarVinheta, uploadMusic, removerVinhetaPorChave } = require('../controllers/r2Controller');

// Música
router.get('/music', listMusic);
router.get('/preview', streamPreview);
router.post('/upload-music', upload.single('file'), uploadMusic);
// SYNC AUTOMÁTICO
router.post('/sync-tracks', syncTracksFromR2);

// ★ NOVO: remove uma música
router.delete('/music/:key', deleteMusic);

// Atualiza o gênero
router.put('/music/genero', async (req, res) => {
  try {
    const { key, genre } = req.body;
    if (!key || !genre) {
      return res.status(400).json({ success: false, error: 'key e genre são obrigatórios' });
    }
    const { error } = await supabase
      .from('track_metadata')
      .update({ genre: genre })
      .eq('file_key', key);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar gênero:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Vinhetas
router.get('/vinhetas', listVinhetas);
router.post('/upload-vinheta', upload.single('file'), uploadVinheta);
router.post('/associar-vinheta', associarVinheta);
router.post('/remover-por-chave', removerVinhetaPorChave);

module.exports = router;