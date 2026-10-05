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
    userId: userData.user.id,
    role: profile ? (profile.role || 'MANAGER') : 'MANAGER',
    companyId: profile && ehUuid(profile.company_id) ? profile.company_id : null,
    unitId: profile && ehUuid(profile.unit_id) ? profile.unit_id : null
  };
}

function ehAdmin(auth) { return ADMIN_ROLES.includes(auth.role); }

async function listUnits(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    let query = supabase.from('units').select('*');
    if (ehAdmin(auth) && req.query.company_id && ehUuid(req.query.company_id)) {
      query = query.eq('company_id', req.query.company_id);
    } else if (!ehAdmin(auth)) {
      if (!auth.companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
      query = query.eq('company_id', auth.companyId);
    }
    // admin sem filtro: vê TODAS as unidades (bypass)

    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw error;
    res.json({ success: true, units: data });
  } catch (err) {
    console.error('[UNITS] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar unidades.' });
  }
}

async function createUnit(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const { company_id, name, address, status, timezone, email } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: 'Informe o nome da unidade.' });

    const companyId = (ehAdmin(auth) && company_id && ehUuid(company_id)) ? company_id : auth.companyId;
    if (!companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });

    const { data, error } = await supabase
      .from('units')
      .insert({ company_id: companyId, name, address: address || null, status: status || 'ACTIVE', timezone: timezone || 'America/Sao_Paulo', email: email || null })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, unit: data });
  } catch (err) {
    console.error('[UNITS] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao criar unidade.' });
  }
}

async function updateUnit(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const updates = {};
    for (const f of ['name', 'address', 'status', 'timezone', 'email']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    updates.updated_at = new Date().toISOString();

    let query = supabase.from('units').update(updates).eq('id', id);
    if (!ehAdmin(auth)) query = query.eq('company_id', auth.companyId);
    const { data, error } = await query.select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Unidade não encontrada.' });
    res.json({ success: true, unit: data });
  } catch (err) {
    console.error('[UNITS] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar unidade.' });
  }
}

async function deleteUnit(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    let query = supabase.from('units').delete().eq('id', id);
    if (!ehAdmin(auth)) query = query.eq('company_id', auth.companyId);
    const { data, error } = await query.select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Unidade não encontrada.' });
    res.json({ success: true, message: 'Unidade excluída.' });
  } catch (err) {
    console.error('[UNITS] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir unidade.' });
  }
}

module.exports = { listUnits, createUnit, updateUnit, deleteUnit };