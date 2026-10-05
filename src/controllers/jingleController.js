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
  return {
    role: profile ? (profile.role || 'MANAGER') : 'MANAGER',
    companyId: profile && ehUuid(profile.company_id) ? profile.company_id : null,
    unitId: profile && ehUuid(profile.unit_id) ? profile.unit_id : null
  };
}

function ehAdmin(auth) { return ADMIN_ROLES.includes(auth.role); }

async function listJingles(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    let query = supabase.from('jingles').select('*');
    if (ehAdmin(auth) && req.query.company_id && ehUuid(req.query.company_id)) {
      query = query.eq('company_id', req.query.company_id);
    } else if (!ehAdmin(auth)) {
      if (!auth.companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
      query = query.eq('company_id', auth.companyId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, jingles: data });
  } catch (err) {
    console.error('[JINGLES] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar vinhetas.' });
  }
}

async function createJingle(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const { company_id, unit_id, title, file_url, duration, type, interval_count } = req.body || {};
    if (!title || !file_url) return res.status(400).json({ success: false, message: 'Informe title e file_url.' });

    const companyId = (ehAdmin(auth) && company_id && ehUuid(company_id)) ? company_id : auth.companyId;
    if (!companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });

    const { data, error } = await supabase
      .from('jingles')
      .insert({
        company_id: companyId,
        unit_id: ehUuid(unit_id) ? unit_id : null,
        title,
        file_url,
        duration: duration !== undefined ? Number(duration) : null,
        type: type || 'VINHETA',
        interval_count: interval_count !== undefined ? Number(interval_count) : 5,
        active: true
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, jingle: data });
  } catch (err) {
    console.error('[JINGLES] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao criar vinheta.' });
  }
}

async function updateJingle(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const updates = {};
    for (const f of ['title', 'file_url', 'type', 'active']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.duration !== undefined) updates.duration = Number(req.body.duration);
    if (req.body.interval_count !== undefined) updates.interval_count = Number(req.body.interval_count);
    updates.updated_at = new Date().toISOString();

    let query = supabase.from('jingles').update(updates).eq('id', id);
    if (!ehAdmin(auth)) query = query.eq('company_id', auth.companyId);
    const { data, error } = await query.select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Vinheta não encontrada.' });
    res.json({ success: true, jingle: data });
  } catch (err) {
    console.error('[JINGLES] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar vinheta.' });
  }
}

async function deleteJingle(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem excluir vinhetas.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const { data, error } = await supabase.from('jingles').delete().eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Vinheta não encontrada.' });
    res.json({ success: true, message: 'Vinheta excluída.' });
  } catch (err) {
    console.error('[JINGLES] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir vinheta.' });
  }
}

module.exports = { listJingles, createJingle, updateJingle, deleteJingle };