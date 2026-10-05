const { listFiles, getMetadata, getObjectStream, headObject, putObject, deleteObject } = require('../r2');
const supabase = require('../supabase');
// Lista as músicas do bucket com metadados, preview e o UUID da tabela tracks
async function listMusic(req, res) {
  try {
    const files = await listFiles();
    // Filtra apenas arquivos de áudio, EXCLUINDO a pasta Vinhetas/
    const musicFiles = files.filter(f =>
      /\.(mp3|wav|m4a|flac|ogg|aac|aiff|wma|opus|m4b|oga|amr)$/i.test(f.Key) &&
      !/^Vinhetas\//i.test(f.Key)
    );
    const tracks = [];
    for (const file of musicFiles) {
      // 1. Busca metadados no cache (Supabase)
      const { data: cached, error: cacheErr } = await supabase
        .from('track_metadata')
        .select('title, artist, album, genre, duration')
        .eq('file_key', file.Key)
        .maybeSingle();
      if (cacheErr) throw cacheErr;
      let title, artist, album, genre, duration;
      if (cached) {
        title = cached.title;
        artist = cached.artist;
        album = cached.album;
        genre = cached.genre;
        duration = cached.duration;
      } else {
        const meta = await getMetadata(file.Key, file.Size);
        title = meta.title;
        artist = meta.artist;
        album = meta.album;
        genre = meta.genre;
        duration = meta.duration;
        const { error: upsertErr } = await supabase
          .from('track_metadata')
          .upsert(
            {
              file_key: file.Key,
              file_name: file.Key.split('/').pop(),
              title,
              artist,
              album,
              genre,
              duration,
            },
            { onConflict: 'file_key' }
          );
        if (upsertErr) console.error('UPSERT FALHOU →', file.Key, upsertErr.message);
      }
      // ★ FIX: busca o UUID da tabela tracks (é ele que o modal precisa salvar)
      const { data: trackRow } = await supabase
        .from('tracks')
        .select('id')
        .eq('file_url', file.Key)
        .maybeSingle();
      // 2. URL de preview AUTO-CONTIDA
      const basePreview = `${req.protocol}://${req.get('host')}/api/r2/preview?key=${encodeURIComponent(file.Key)}`;
      const previewUrl = duration ? `${basePreview}&duration=${duration}` : basePreview;
      tracks.push({
        key: file.Key,
        id: trackRow ? trackRow.id : null,   // ★ UUID da tracks (ou null se ainda não sincronizada)
        name: file.Key.split('/').pop().replace(/\.[^.]+$/, ''),
        title,
        artist,
        album,
        genre,
        duration,
        size: file.Size,
        lastModified: file.LastModified,
        previewUrl,
      });
    }
    res.json({ total: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
// Adiciona faixas a uma playlist (grava em playlist_tracks)
async function addTracksToPlaylist(req, res) {
  try {
    const { playlistId } = req.params;
    const { track_ids } = req.body;
    if (!playlistId) return res.status(400).json({ success: false, error: 'playlistId é obrigatório' });
    if (!Array.isArray(track_ids) || !track_ids.length) return res.status(400).json({ success: false, error: 'track_ids é obrigatório' });
    // Descobre a posição máxima atual para anexar no final
    const { data: existing, error: errGet } = await supabase
      .from('playlist_tracks')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1);
    if (errGet) throw errGet;
    let position = (existing && existing[0] && existing[0].position != null) ? existing[0].position + 1 : 0;
    const rows = track_ids.map((trackId, i) => ({
      playlist_id: playlistId,
      track_id: trackId,
      position: position + i,
    }));
    const { error } = await supabase.from('playlist_tracks').insert(rows);
    if (error) throw error;
    res.json({ success: true, added: rows.length });
  } catch (err) {
    console.error('Erro ao adicionar faixas à playlist:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
// Serve o preview — estimativa generosa (garante >= 15s de áudio real)
async function streamPreview(req, res) {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'Parâmetro key é obrigatório' });
    let duration = req.query.duration ? parseFloat(req.query.duration) : null;
    if (!duration || isNaN(duration)) {
      const { data: meta } = await supabase
        .from('track_metadata')
        .select('duration')
        .eq('file_key', key)
        .maybeSingle();
      if (meta && meta.duration) duration = parseFloat(meta.duration);
    }
    const head = await headObject(key);
    const fileSize = head.ContentLength;
    let endByte = fileSize - 1;
    if (duration && duration > 0 && fileSize && fileSize > 0) {
      const estBytes = Math.floor((fileSize / duration) * 15 * 2.5);
      endByte = Math.min(estBytes - 1, Math.floor(fileSize * 0.5), fileSize - 1);
    }
    console.log('PREVIEW →', { key, duration, fileSize, endByte });
    const response = await getObjectStream(key, `bytes=0-${endByte}`);
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);
    res.status(200);
    res.setHeader('Content-Type', head.ContentType || 'audio/mpeg');
    res.setHeader('Content-Length', String(audioBuffer.length));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.end(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
// SYNC COMPLETO: garante que TODOS os arquivos de áudio do R2 tenham ficha na tabela tracks
async function syncTracksFromR2(req, res) {
  try {
    const files = await listFiles();
    const musicFiles = files.filter(f =>
      /\.(mp3|wav|m4a|flac|ogg|aac|aiff|wma|opus|m4b|oga|amr)$/i.test(f.Key) &&
      !/^Vinhetas\//i.test(f.Key)
    );
    let criadas = 0, atualizadas = 0, puladas = 0;
    for (const file of musicFiles) {
      const { data: cached } = await supabase
        .from('track_metadata')
        .select('title, artist, album, genre, duration')
        .eq('file_key', file.Key)
        .maybeSingle();
      let title, artist, album, genre, duration;
      if (cached) {
        title = cached.title; artist = cached.artist; album = cached.album;
        genre = cached.genre; duration = cached.duration;
      } else {
        const meta = await getMetadata(file.Key, file.Size);
        title = meta.title; artist = meta.artist; album = meta.album;
        genre = meta.genre; duration = meta.duration;
        await supabase.from('track_metadata').upsert({
          file_key: file.Key,
          file_name: file.Key.split('/').pop(),
          title, artist, album, genre, duration
        }, { onConflict: 'file_key' });
      }
      const nome = title || file.Key.split('/').pop().replace(/\.[^.]+$/, '');
      const { data: porTitulo } = await supabase
        .from('tracks').select('id').ilike('title', nome).maybeSingle();
      const { data: porUrl } = await supabase
        .from('tracks').select('id').eq('file_url', file.Key).maybeSingle();
      const existente = porTitulo || porUrl;
      if (existente) {
        await supabase.from('tracks').update({ file_size: file.Size }).eq('id', existente.id);
        atualizadas++;
      } else {
        const { error: insErr } = await supabase.from('tracks').insert({
          title: nome,
          artist: artist || null,
          album: album || null,
          duration: duration || null,
          file_url: file.Key,
          file_size: file.Size
        });
        if (insErr) { console.error('INSERT FALHOU →', file.Key, insErr.message); puladas++; continue; }
        criadas++;
      }
    }
    res.json({ success: true, total: musicFiles.length, criadas, atualizadas, puladas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
// ★ NOVO: remove uma música do R2 + da tabela tracks + vínculos + metadados
async function deleteMusic(req, res) {
  try {
    const key = req.params.key ? decodeURIComponent(req.params.key) : null;
    if (!key) return res.status(400).json({ success: false, error: 'key é obrigatória' });
    // 1. Acha a ficha na tabela tracks (pelo file_url)
    const { data: trackRow } = await supabase
      .from('tracks')
      .select('id')
      .eq('file_url', key)
      .maybeSingle();
    // 2. Remove os vínculos nas playlists (playlist_tracks)
    if (trackRow && trackRow.id) {
      const { error: ptErr } = await supabase
        .from('playlist_tracks')
        .delete()
        .eq('track_id', trackRow.id);
      if (ptErr) console.error('DELETE playlist_tracks FALHOU →', ptErr.message);
      // 3. Remove a ficha da tabela tracks
      const { error: trErr } = await supabase
        .from('tracks')
        .delete()
        .eq('id', trackRow.id);
      if (trErr) console.error('DELETE tracks FALHOU →', trErr.message);
    }
    // 4. Remove os metadados em cache (track_metadata)
    await supabase.from('track_metadata').delete().eq('file_key', key);
    // 5. Remove o arquivo do R2
    await deleteObject(key);
    res.json({ success: true, key, trackRemoved: !!(trackRow && trackRow.id) });
  } catch (err) {
    console.error('DELETE MÚSICA FALHOU →', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
/* ============ FUNÇÕES DE VINHETA ============ */
async function listVinhetas(req, res) {
  try {
    const files = await listFiles();
    const vinhetaFiles = files.filter(f =>
      /^Vinhetas\//i.test(f.Key) && /\.(mp3|wav|m4a|flac|ogg|aac|aiff|wma|opus|m4b|oga|amr)$/i.test(f.Key)
    );
    const vinhetas = vinhetaFiles.map(function (file) {
      var nome = file.Key.split('/').pop().replace(/\.[^.]+$/, '');
      var previewUrl = `${req.protocol}://${req.get('host')}/api/r2/preview?key=${encodeURIComponent(file.Key)}`;
      return {
        file_key: file.Key,
        title: nome,
        file_url: previewUrl,
        duration: null
      };
    });
    res.json({ success: true, vinhetas: vinhetas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
async function uploadVinheta(req, res) {
  try {
    const { company_id, unit_id, title, type, interval_count } = req.body;
    const file = req.file;
    // ★ FIX: cliente é OPCIONAL — sobe para a pasta "Geral" e associa depois
    if (!title || !file) {
      return res.status(400).json({ success: false, error: 'title e arquivo são obrigatórios' });
    }
    const pasta = (company_id && String(company_id).trim()) ? String(company_id).trim() : 'Geral';
    const key = `Vinhetas/${pasta}/${title}.mp3`;
    await putObject(key, file.buffer, file.mimetype || 'audio/mpeg');
    const file_url = `https://pub-3cfbf48389614de9982ae7630c0f9ba3.r2.dev/${encodeURIComponent(key)}`;
    const { data, error } = await supabase
      .from('jingles')
      .upsert(
        {
          company_id: company_id || null,   // ★ null = sem cliente ainda
          unit_id: unit_id || null,
          title,
          file_url,
          type: type || 'FIXA',
          active: true,
          interval_count: interval_count ? parseInt(interval_count) : 5,
        },
        { onConflict: 'company_id,title' }
      );
    if (error) throw error;
    res.json({ success: true, vinheta: data });
  } catch (err) {
    console.error('Erro no upload da vinheta:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
async function associarVinheta(req, res) {
  try {
    const { file_key, company_id, unit_id, interval_count } = req.body;
    if (!file_key || !company_id) {
      return res.status(400).json({ success: false, error: 'file_key e company_id são obrigatórios' });
    }
    const title = file_key.split('/').pop().replace(/\.[^.]+$/, '');
    const file_url = `https://pub-3cfbf48389614de9982ae7630c0f9ba3.r2.dev/${encodeURIComponent(file_key)}`;

    // ★ AQUI entra o bloco do "existente" — atualiza a ficha sem duplicar
    const { data: existente } = await supabase
      .from('jingles')
      .select('id')
      .eq('file_key', file_key)
      .maybeSingle();

    if (existente) {
      const { error: upErr } = await supabase
        .from('jingles')
        .update({
          company_id,
          unit_id: unit_id || null,
          active: true,
          interval_count: interval_count ? parseInt(interval_count) : 5,
        })
        .eq('id', existente.id);
      if (upErr) throw upErr;
      return res.json({ success: true, vinheta: existente, atualizada: true });
    }

    // Se não existia, cria a ficha do zero (como antes)
    const { data, error } = await supabase
      .from('jingles')
      .upsert(
        {
          company_id,
          unit_id: unit_id || null,
          title,
          file_url,
          type: 'FIXA',
          active: true,
          interval_count: interval_count ? parseInt(interval_count) : 5,
        },
        { onConflict: 'company_id,title' }
      );
    if (error) throw error;
    res.json({ success: true, vinheta: data });
  } catch (err) {
    console.error('Erro na associação da vinheta:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
/* ============ UPLOAD DE MÚSICA DA BIBLIOTECA (validação R2) ============ */
async function uploadMusic(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'arquivo é obrigatório' });
    if (!/\.(mp3|wav|m4a|flac|ogg|aac|aiff|wma|opus|m4b|oga|amr)$/i.test(file.originalname)) {
      return res.status(400).json({ success: false, error: 'Formato inválido. Envie MP3, WAV, M4A, FLAC, OGG ou AAC.' });
    }
    
    /* Key na RAIZ do bucket (fora de Vinhetas/ — é assim que a listMusic enxerga) */
    const key = file.originalname;

    /* ⛔ BLOQUEIO DE DUPLICADO: mesmo nome já tem ficha na tabela? */
    const { data: jaExiste } = await supabase
      .from('tracks')
      .select('id, title')
      .eq('file_url', key)
      .maybeSingle();

    if (jaExiste) {
      return res.status(409).json({
        success: false,
        error: 'Este arquivo já está na biblioteca: "' +
          (jaExiste.title || key) +
          '". Nada foi enviado.'
      });
    }

    await putObject(key, file.buffer, file.mimetype || 'audio/mpeg');

    /* Tenta extrair metadados (título, artista, álbum, gênero, duração) */
    let title = key.replace(/\.[^.]+$/, '');
    let artist = null, album = null, genre = null, duration = null;
    try {
      const meta = await getMetadata(key, file.size);
      title = meta.title || title;
      artist = meta.artist || null;
      album = meta.album || null;
      genre = meta.genre || null;
      duration = meta.duration || null;
      await supabase.from('track_metadata').upsert({
        file_key: key,
        file_name: key,
        title, artist, album, genre, duration
      }, { onConflict: 'file_key' });
    } catch (e) {
      console.warn('[UPLOAD] Sem metadados para', key, e.message);
    }

    /* Ficha na tabela tracks (mesmo padrão do syncTracksFromR2) */
    const { data: existente } = await supabase
      .from('tracks').select('id').eq('file_url', key).maybeSingle();
    if (existente) {
      await supabase.from('tracks').update({
        title, artist, album, duration, file_size: file.size
      }).eq('id', existente.id);
    } else {
      await supabase.from('tracks').insert({
        title, artist, album, duration, file_url: key, file_size: file.size
      });
    }

    res.json({ success: true, key });
  } catch (err) {
    console.error('Erro no upload da música:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}
/* Remove a vinheta do R2 e limpa as fichas no Supabase */
async function removerVinhetaPorChave(req, res) {
  try {
    const file_key = (req.body && req.body.file_key) ? String(req.body.file_key) : '';
    if (!file_key) {
      return res.status(400).json({ success: false, message: 'file_key é obrigatório.' });
    }
    // Segurança: só permite remover arquivos que estão dentro de Vinhetas/
    if (!/^Vinhetas\//i.test(file_key)) {
      return res.status(400).json({ success: false, message: 'Apenas arquivos em Vinhetas/ podem ser removidos por aqui.' });
    }

    // 1) Remove o arquivo do Cloudflare R2
    try {
      await deleteObject(file_key);
      console.log('[ZEEP] Vinheta removida do R2:', file_key);
    } catch (e) {
      console.error('[ZEEP] Erro ao deletar do R2 (continua):', e.message);
    }

    // 2) Remove a ficha da tabela de vinhetas (jingles) e do cache, se existirem
    try { await supabase.from('jingles').delete().eq('file_key', file_key); } catch (e) { console.error('[ZEEP] jingles:', e.message); }
    try { await supabase.from('track_metadata').delete().eq('file_key', file_key); } catch (e) { console.error('[ZEEP] track_metadata:', e.message); }

    res.json({ success: true, message: 'Vinheta removida.' });
  } catch (err) {
    console.error('[ZEEP] Erro ao remover vinheta:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}
module.exports = { listMusic, streamPreview, syncTracksFromR2, deleteMusic, addTracksToPlaylist, listVinhetas, uploadVinheta, associarVinheta, uploadMusic, removerVinhetaPorChave };