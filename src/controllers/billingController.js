const supabase = require('../supabase');

const ADMIN_ROLES = ['ADMIN', 'ZEEP_ADMIN', 'SUPER_ADMIN', 'MASTER'];
const STATUS_VALIDOS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'];

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

async function listBillings(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    let query = supabase.from('billings').select('*');
    if (ehAdmin(auth) && req.query.company_id && ehUuid(req.query.company_id)) {
      query = query.eq('company_id', req.query.company_id);
    } else if (!ehAdmin(auth)) {
      if (!auth.companyId) return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
      query = query.eq('company_id', auth.companyId);
    }
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query.order('due_date', { ascending: false });
    if (error) throw error;
    res.json({ success: true, billings: data });
  } catch (err) {
    console.error('[BILLINGS] Erro ao listar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao listar pagamentos.' });
  }
}

async function createBilling(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem lançar pagamentos.' });

    const { company_id, unit_id, amount, due_date, status } = req.body || {};
    if (!company_id || !ehUuid(company_id)) return res.status(400).json({ success: false, message: 'Informe company_id válido.' });
    if (amount === undefined || amount === null || amount === '') return res.status(400).json({ success: false, message: 'Informe o valor.' });
    if (!due_date) return res.status(400).json({ success: false, message: 'Informe a data de vencimento.' });

    const { data, error } = await supabase
      .from('billings')
      .insert({
        company_id,
        unit_id: ehUuid(unit_id) ? unit_id : null,
        amount: Number(amount),
        due_date,
        status: STATUS_VALIDOS.includes(status) ? status : 'PENDING'
      })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, billing: data });
  } catch (err) {
    console.error('[BILLINGS] Erro ao criar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao criar cobrança.' });
  }
}

// "Dar baixa" no pagamento
async function markPaid(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem dar baixa.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const { data, error } = await supabase
      .from('billings')
      .update({ status: 'PAID', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cobrança não encontrada.' });
    res.json({ success: true, billing: data });
  } catch (err) {
    console.error('[BILLINGS] Erro ao dar baixa:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao dar baixa.' });
  }
}

async function updateBilling(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem editar cobranças.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const updates = {};
    if (req.body.amount !== undefined) updates.amount = Number(req.body.amount);
    if (req.body.due_date !== undefined) updates.due_date = req.body.due_date;
    if (req.body.status !== undefined) {
      if (!STATUS_VALIDOS.includes(req.body.status)) return res.status(400).json({ success: false, message: 'Status inválido.' });
      updates.status = req.body.status;
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('billings').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cobrança não encontrada.' });
    res.json({ success: true, billing: data });
  } catch (err) {
    console.error('[BILLINGS] Erro ao editar:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao editar cobrança.' });
  }
}

async function deleteBilling(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });
    if (!ehAdmin(auth)) return res.status(403).json({ success: false, message: 'Apenas administradores podem excluir cobranças.' });
    const { id } = req.params;
    if (!ehUuid(id)) return res.status(400).json({ success: false, message: 'ID inválido.' });

    const { data, error } = await supabase.from('billings').delete().eq('id', id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Cobrança não encontrada.' });
    res.json({ success: true, message: 'Cobrança excluída.' });
  } catch (err) {
    console.error('[BILLINGS] Erro ao excluir:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao excluir cobrança.' });
  }
}

module.exports = { listBillings, createBilling, markPaid, updateBilling, deleteBilling };