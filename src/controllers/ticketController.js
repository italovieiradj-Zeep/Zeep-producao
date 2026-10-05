const supabase = require('../supabase');

const ADMIN_ROLES = ['ADMIN', 'ZEEP_ADMIN', 'SUPER_ADMIN', 'MASTER'];
const STATUS_VALIDOS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

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

async function listTickets(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    let query = supabase.from('tickets').select('*');
    if (ehAdmin(auth) && req.query.company_id && ehUuid(req.query.company_id)) {
      query = query.eq('company_id', req.query.company_id);
    } else if (!ehAdmin(auth)) {
      if (!auth.companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
      query = query.eq('company_id', auth.companyId);
    }
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, tickets: data });
  } catch (err) {
    console.error('[TICKETS] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar chamados.' });
  }
}

async function createTicket(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const { company_id, unit_id, subject, description, priority } = req.body || {};
    if (!subject) return res.status(400).json({ success: false, message: 'Informe o assunto.' });

    const companyId = (ehAdmin(auth) && company_id && ehUuid(company_id)) ? company_id : auth.companyId;
    if (!companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        company_id: companyId,
        unit_id: ehUuid(unit_id) ? unit_id : null,
        subject,
        description: description || null,
        priority: priority || 'NORMAL',
        status: 'OPEN',
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, ticket: data });
  } catch (err) {
    console.error('[TICKETS] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao abrir chamado.' });
  }
}

async function updateTicket(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const updates = {};
    if (req.body.subject !== undefined) updates.subject = req.body.subject;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.status !== undefined) {
      if (!STATUS_VALIDOS.includes(req.body.status)) return res.status(400).json({ success: false, message: 'Status inválido.' });
      updates.status = req.body.status;
    }
    updates.updated_at = new Date().toISOString();

    let query = supabase.from('tickets').update(updates).eq('id', id);
    if (!ehAdmin(auth)) query = query.eq('company_id', auth.companyId);
    const { data, error } = await query.select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Chamado não encontrado.' });
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('[TICKETS] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar chamado.' });
  }
}

async function deleteTicket(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem excluir chamados.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const { data, error } = await supabase.from('tickets').delete().eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Chamado não encontrado.' });
    res.json({ success: true, message: 'Chamado excluído.' });
  } catch (err) {
    console.error('[TICKETS] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir chamado.' });
  }
}

module.exports = { listTickets, createTicket, updateTicket, deleteTicket };