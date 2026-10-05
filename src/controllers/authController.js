const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Valida se o valor parece um UUID de verdade
function ehUuid(valor) {
  return typeof valor === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

// POST /api/auth/login — e-mail + senha → token + dados do usuário
async function login(req, res) {
  try {
    const body = req.body || {};
    const email = body.email;
    const senha = body.password || body.senha;   // aceita os dois nomes de campo

    if (!email || !senha) {
      return res.status(400).json({ success: false, message: 'Informe e-mail e senha.' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.user) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }

    // ⚠️ FIX CRÍTICO: buscar o role junto — sem ele, admin nunca é reconhecido
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, unit_id, role')
      .eq('id', data.user.id)
      .maybeSingle();

    const ADMIN_ROLES = ['ADMIN', 'OWNER'];
    const isAdmin = ADMIN_ROLES.includes(profile ? profile.role : '');

    // Admin (Master/OWNER) pode entrar sem empresa; cliente precisa de empresa
    if (!profile || (!isAdmin && !profile.company_id)) {
      return res.status(403).json({ success: false, message: 'Usuário sem empresa vinculada.' });
    }

    res.json({
      success: true,
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile.role,
        company_id: profile.company_id,
        unit_id: profile.unit_id
      }
    });
  } catch (err) {
    console.error('[LOGIN] Erro:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno no login.' });
  }
}
// POST /api/auth/criar-acesso — cria o usuário de acesso do Player para uma filial
async function criarAcesso(req, res) {
  try {
    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    const senha = body.password || body.senha;
    const unitId = body.unit_id;
    const companyId = body.company_id;
    const nome = body.name || '';

    if (!email || !senha) {
      return res.status(400).json({ success: false, message: 'Informe e-mail e senha.' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 6 caracteres.' });
    }
    if (!unitId || !companyId) {
      return res.status(400).json({ success: false, message: 'Informe unit_id e company_id.' });
    }

    // Cria o usuário no Supabase (auth) com a service role
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: email,
      password: senha,
      email_confirm: true
    });
    if (userError) {
      return res.status(400).json({ success: false, message: 'Erro ao criar usuário: ' + userError.message });
    }

    // Vincula o usuário à filial (company_id + unit_id) na tabela profiles
    const { error: profileError } = await supabase
      .from('profiles')
       .upsert({
        id: userData.user.id,
        email: email,
        company_id: companyId,
        unit_id: unitId,
        role: 'MANAGER',
        full_name: nome || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('[ACESSO] Erro ao vincular profile:', profileError.message);
      return res.status(500).json({ success: false, message: 'Usuário criado, mas erro ao vincular à filial.' });
    }

    res.status(201).json({ success: true, user: { id: userData.user.id, email: email, unit_id: unitId, company_id: companyId } });
  } catch (err) {
    console.error('[ACESSO] Erro:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao criar acesso.' });
  }
}

module.exports = { login, criarAcesso };