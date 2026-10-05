const supabase = require('../supabase');

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// Guarda o áudio em memória por até 30 min (temporário: toca e descarta)
const audioCache = new Map();

function gerarAudioElevenLabs(texto) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: texto,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0 },
    }),
  }).then(async (resp) => {
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('ElevenLabs: ' + resp.status + ' ' + err);
    }
    return Buffer.from(await resp.arrayBuffer());
  });
}

// Gera o aviso (imediato ou agendado) e registra na tabela avisos
async function gerarAviso(req, res) {
  try {
    const { title, text, target, target_units, mode, scheduled_at, company_id } = req.body;
    if (!title || !text) {
      return res.status(400).json({ success: false, error: 'title e text são obrigatórios' });
    }

    // 1. Gera o áudio na ElevenLabs
    const audio = await gerarAudioElevenLabs(text);

    // 2. Registra o aviso no Supabase
    const { data, error } = await supabase
      .from('avisos')
      .insert({
        company_id: company_id || null,
        title,
        text,
        target: target || 'rede',
        target_units: Array.isArray(target_units) ? target_units : [],
        mode: mode || 'now',
        scheduled_at: mode === 'scheduled' ? scheduled_at : null,
        status: mode === 'scheduled' ? 'agendado' : 'no_ar',
      })
      .select()
      .single();
    if (error) throw error;

    // 3. Guarda o áudio em memória (expira em 30 min)
    audioCache.set(data.id, { buffer: audio, expires: Date.now() + 30 * 60 * 1000 });

    res.json({
      success: true,
      aviso: data,
      audioUrl: '/api/avisos/audio/' + data.id,
      expiresIn: '30min',
    });
  } catch (err) {
    console.error('Erro ao gerar aviso:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// Serve o áudio UMA vez e descarta (toca na hora)
async function servirAudio(req, res) {
  try {
    const item = audioCache.get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Áudio expirado ou já tocado' });

    // NÃO apaga mais aqui — deixa expirar naturalmente em 30 min
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(item.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(item.buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Lista avisos (para o Histórico)
async function listarAvisos(req, res) {
  try {
    const { data, error } = await supabase
      .from('avisos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ success: true, avisos: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Limpa áudios expirados a cada 5 min
setInterval(() => {
  const agora = Date.now();
  for (const [id, item] of audioCache) {
    if (item.expires < agora) audioCache.delete(id);
  }
}, 5 * 60 * 1000);

module.exports = { gerarAviso, servirAudio, listarAvisos };