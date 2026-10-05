const supabase = require('../supabase');

const ADMIN_ROLES = ['ADMIN', 'ZEEP_ADMIN', 'SUPER_ADMIN', 'MASTER'];

function ehUuid(valor) {
  return typeof valor === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

async function autenticar(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { erro: 401, mensagem: 'Token ausente.' };
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return { erro: 401, mensagem: 'Sessão inválida.' };
  const { data: profile } = await supabase
    .from('profiles').select('company_id, unit_id, role')
    .eq('id', userData.user.id).maybeSingle();
  return { role: profile ? (profile.role || 'MANAGER') : 'MANAGER' };
}

function ehAdmin(auth) { return ADMIN_ROLES.includes(auth.role); }

// Biblioteca é global: qualquer usuário autenticado pode consultar
async function listTracks(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const { data, error } = await supabase
      .from('tracks').select('*')
      .order('title', { ascending: true });
    if (error) throw error;
    res.json({ success: true, tracks: data });
  } catch (err) {
    console.error('[TRACKS] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar músicas.' });
  }
}

async function createTrack(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem adicionar músicas.' });

    const { title, artist, album, duration, file_url, cover_url, tags, mood, energy } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: 'Informe o título.' });

    const { data, error } = await supabase
      .from('tracks')
      .insert({
        title,
        artist: artist || null,
        album: album || null,
        duration: duration !== undefined ? Number(duration) : null,
        file_url: file_url || null,
        cover_url: cover_url || null,
        tags: Array.isArray(tags) ? tags : [],
        mood: mood || null,
        energy: energy !== undefined ? Number(energy) : null
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, track: data });
  } catch (err) {
    console.error('[TRACKS] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao adicionar música.' });
  }
}

async function updateTrack(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem editar músicas.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const updates = {};
    for (const f of ['title', 'artist', 'album', 'file_url', 'cover_url', 'mood']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.duration !== undefined) updates.duration = Number(req.body.duration);
    if (req.body.energy !== undefined) updates.energy = Number(req.body.energy);
    if (req.body.tags !== undefined) updates.tags = req.body.tags;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('tracks').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Música não encontrada.' });
    res.json({ success: true, track: data });
  } catch (err) {
    console.error('[TRACKS] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar música.' });
  }
}

async function deleteTrack(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem excluir músicas.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const { data, error } = await supabase.from('tracks').delete().eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Música não encontrada.' });
    res.json({ success: true, message: 'Música excluída.' });
  } catch (err) {
    console.error('[TRACKS] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir música.' });
  }
}

module.exports = { listTracks, createTrack, updateTrack, deleteTrack };