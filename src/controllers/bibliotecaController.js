// src/controllers/bibliotecaController.js
// Playlists Biblioteca Zeep — GLOBAIS (liberadas por PLANO), separadas da curadoria (por empresa)
const supabase = require('../supabase');

const PLANOS = ['STANDARD', 'BUSINESS', 'ENTERPRISE'];

// Libera playlists conforme o plano do cliente:
// STANDARD vê STANDARD | BUSINESS vê STANDARD+BUSINESS | ENTERPRISE vê tudo
function liberarPorPlano(planoPlaylist, planoCliente) {
  const idxCliente = PLANOS.indexOf(planoCliente);
  if (idxCliente < 0) return false;
  const idxPlaylist = PLANOS.indexOf(planoPlaylist);
  return idxPlaylist >= 0 && idxPlaylist <= idxCliente;
}

// GET /api/biblioteca?plano=BUSINESS  |  plano=ALL → admin/dashboard vê tudo
async function listar(req, res) {
  try {
    const plano = (req.query.plano || 'STANDARD').toUpperCase();

    const { data, error } = await supabase
      .from('playlists_biblioteca')
      .select('*')
      .eq('active', true)
      .order('name');

    if (error) return res.status(500).json({ success: false, message: error.message });

    // plano=ALL (dashboard/admin) retorna todas; senão filtra pelo plano do cliente
    const playlists = (plano === 'ALL')
      ? data
      : data.filter(p => liberarPorPlano((p.min_plan || 'STANDARD').toUpperCase(), plano));

    // Conta faixas de cada playlist
    for (const p of playlists) {
      const { count } = await supabase
        .from('playlist_biblioteca_tracks')
        .select('id', { count: 'exact', head: true })
        .eq('playlist_id', p.id);
      p.track_count = count || 0;
    }

    res.json({ success: true, playlists });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// GET /api/biblioteca/:id/tracks — faixas de uma playlist (na ordem de position)
async function listarTracks(req, res) {
  try {
    const { id } = req.params;
    const { data: vinculos, error } = await supabase
      .from('playlist_biblioteca_tracks')
      .select('track_id, position')
      .eq('playlist_id', id)
      .order('position');

    if (error) return res.status(500).json({ success: false, message: error.message });

    if (!vinculos.length) return res.json({ success: true, tracks: [] });

    const trackIds = vinculos.map(v => v.track_id);
    const { data: tracks, error: errTracks } = await supabase
      .from('tracks')
      .select('*')
      .in('id', trackIds);

    if (errTracks) return res.status(500).json({ success: false, message: errTracks.message });

    // Ordena conforme a posição do vínculo
    const mapa = {};
    tracks.forEach(t => { mapa[t.id] = t; });
    const ordenadas = vinculos.map(v => mapa[v.track_id]).filter(Boolean);

    res.json({ success: true, tracks: ordenadas });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/biblioteca — cria playlist (com opção de já vincular faixas)
async function criar(req, res) {
  try {
    const { name, description, min_plan = 'STANDARD', track_ids = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Informe o nome.' });
    if (!PLANOS.includes(min_plan.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'min_plan inválido.' });
    }

    const { data: playlist, error } = await supabase
      .from('playlists_biblioteca')
      .insert({ name, description, min_plan: min_plan.toUpperCase() })
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, message: error.message });

    // Vincula faixas se vierem
    if (track_ids.length) {
      const linhas = track_ids.map((tid, i) => ({
        playlist_id: playlist.id,
        track_id: tid,
        position: i
      }));
      const { error: errTracks } = await supabase
        .from('playlist_biblioteca_tracks')
        .insert(linhas);
      if (errTracks) {
        return res.status(500).json({ success: false, message: 'Playlist criada, mas erro ao vincular faixas: ' + errTracks.message });
      }
    }

    res.status(201).json({ success: true, playlist });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /api/biblioteca/:id — edita (nome, descrição, plano, ativo)
async function editar(req, res) {
  try {
    const { id } = req.params;
    const { name, description, min_plan, active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (min_plan !== undefined) updates.min_plan = min_plan.toUpperCase();
    if (active !== undefined) updates.active = active;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('playlists_biblioteca')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true, playlist: data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// DELETE /api/biblioteca/:id — exclui (cascade remove vínculos)
async function excluir(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('playlists_biblioteca')
      .delete()
      .eq('id', id);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /api/biblioteca/:id/tracks — adiciona faixas ao final
async function adicionarTracks(req, res) {
  try {
    const { id } = req.params;
    const { track_ids = [] } = req.body;
    if (!track_ids.length) return res.status(400).json({ success: false, message: 'Informe track_ids.' });

    const { data: existentes } = await supabase
      .from('playlist_biblioteca_tracks')
      .select('position')
      .eq('playlist_id', id)
      .order('position', { ascending: false })
      .limit(1);
    let inicio = existentes && existentes.length ? existentes[0].position + 1 : 0;

    const linhas = track_ids.map(tid => ({ playlist_id: id, track_id: tid, position: inicio++ }));
    const { error } = await supabase.from('playlist_biblioteca_tracks').insert(linhas);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /api/biblioteca/:id/tracks — substitui a lista inteira de faixas
async function substituirTracks(req, res) {
  try {
    const { id } = req.params;
    const { track_ids = [] } = req.body;

    const { error: errDel } = await supabase
      .from('playlist_biblioteca_tracks')
      .delete()
      .eq('playlist_id', id);
    if (errDel) return res.status(500).json({ success: false, message: errDel.message });

    if (track_ids.length) {
      const linhas = track_ids.map((tid, i) => ({ playlist_id: id, track_id: tid, position: i }));
      const { error: errIns } = await supabase.from('playlist_biblioteca_tracks').insert(linhas);
      if (errIns) return res.status(500).json({ success: false, message: errIns.message });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}
// DELETE /api/biblioteca/:id/tracks — remove faixas específicas do vínculo
async function removerTracks(req, res) {
  try {
    const { id } = req.params;
    const { track_ids = [] } = req.body;
    if (!track_ids.length) return res.status(400).json({ success: false, message: 'Informe track_ids.' });
    const { error } = await supabase
      .from('playlist_biblioteca_tracks')
      .delete()
      .eq('playlist_id', id)
      .in('track_id', track_ids);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}
module.exports = { listar, listarTracks, criar, editar, excluir, adicionarTracks, substituirTracks, removerTracks };