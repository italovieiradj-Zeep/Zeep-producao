const supabase = require('../supabase');

// Roles que podem administrar TODOS os clientes (Dashboard Produção)
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id, unit_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) return { erro: 500, mensagem: 'Erro ao buscar perfil.' };

  return {
    userId: userData.user.id,
    role: profile ? (profile.role || 'MANAGER') : 'MANAGER',
    companyId: profile && ehUuid(profile.company_id) ? profile.company_id : null,
    unitId: profile && ehUuid(profile.unit_id) ? profile.unit_id : null
  };
}

function ehAdmin(auth) { return ADMIN_ROLES.includes(auth.role); }

// GET /api/companies — admin vê todos; cliente vê só a própria empresa
async function listCompanies(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    let query = supabase.from('companies').select('*');
    if (!ehAdmin(auth)) {
      if (!auth.companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
      // ★ FIX: era .eq('company_id', ...) — companies não tem essa coluna
      query = query.eq('id', auth.companyId);
    }
    const { status } = req.query;
    if (ehAdmin(auth) && status) query = query.eq('status', status);

    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw error;

    // ★ NOVO: conta playlists por empresa (resolve o "Playlists 0" do dashboard)
    // Busca todas as playlists e agrupa por company_id — funciona mesmo sem FK declarada
    const { data: playlists } = await supabase.from('playlists').select('company_id');
    const contagem = {};
    (playlists || []).forEach(function (p) {
      if (p.company_id) contagem[p.company_id] = (contagem[p.company_id] || 0) + 1;
    });

    const companies = (data || []).map(function (c) {
      return Object.assign({}, c, { playlists_count: contagem[c.id] || 0 });
    });

    res.json({ success: true, companies });
  } catch (err) {
    console.error('[COMPANIES] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar clientes.' });
  }
}

// GET /api/companies/:id
async function getCompany(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    let query = supabase.from('companies').select('*').eq('id', id);
    if (!ehAdmin(auth)) query = query.eq('id', auth.companyId);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cliente não encontrado.' });

    res.json({ success: true, company: data });
  } catch (err) {
    console.error('[COMPANIES] Erro ao buscar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno.' });
  }
}

// POST /api/companies — cria cliente (só admin)
async function createCompany(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem criar clientes.' });

    const {
      name, document, plan, status, email, phone, address,
      segmento, valor_mensal, forma_pagamento
    } = req.body || {};

    if (!name) return res.status(400).json({ success: false, message: 'Informe o nome do cliente.' });

    const { data, error } = await supabase
      .from('companies')
      .insert({
        name,
        document: document || null,
        plan: plan || 'BUSINESS',
        status: status || 'ACTIVE',
        email: email || null,
        phone: phone || null,
        address: address || null,
        segmento: segmento || null,
        valor_mensal: (valor_mensal !== undefined && valor_mensal !== null && valor_mensal !== '') ? Number(valor_mensal) : null,
        forma_pagamento: forma_pagamento || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, company: data });
  } catch (err) {
    console.error('[COMPANIES] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao criar cliente.' });
  }
}

// PUT /api/companies/:id — edita cliente (só admin)
async function updateCompany(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem editar clientes.' });

    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const fields = ['name', 'document', 'plan', 'status', 'email', 'phone', 'address', 'segmento', 'forma_pagamento'];
    const updates = {};
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.valor_mensal !== undefined) {
      updates.valor_mensal = (req.body.valor_mensal === '' || req.body.valor_mensal === null)
        ? null : Number(req.body.valor_mensal);
    }
    updates.updated_at = new Date().toISOString();

    // ★ FIX: maybeSingle em vez de single → retorna 404 (não 500) se não achar
    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cliente não encontrado.' });

    res.json({ success: true, company: data });
  } catch (err) {
    console.error('[COMPANIES] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar cliente.' });
  }
}

// DELETE /api/companies/:id — exclui cliente (só admin)
async function deleteCompany(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem excluir clientes.' });

    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    // ★ FIX: maybeSingle → 404 limpo em vez de 500
    const { data, error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cliente não encontrado.' });

    res.json({ success: true, message: 'Cliente excluído.' });
  } catch (err) {
    console.error('[COMPANIES] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir cliente.' });
  }
}

module.exports = { listCompanies, getCompany, createCompany, updateCompany, deleteCompany };