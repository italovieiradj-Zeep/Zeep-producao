const supabase = require('../supabase');
const { listFiles } = require('../r2');   // ★ r2.js que você colou — já exporta listFiles

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

function statusAtivo(status) {
  if (!status) return false;
  return ['ACTIVE', 'ATIVO', 'ATIVA', 'active', 'ativo'].indexOf(String(status).trim()) !== -1;
}

// GET /api/overview — métricas reais do dashboard (Visão Geral)
async function getOverview(req, res) {
  try {
    const auth = await autenticar(req);
    if (auth.erro) return res.status(auth.erro).json({ success: false, message: auth.mensagem });

    const isAdmin = ehAdmin(auth);
    const escopo = isAdmin ? null : auth.companyId;
    if (!isAdmin && !escopo) {
      return res.status(403).json({ success: false, message: 'Sem empresa vinculada.' });
    }

    // ── 1) Clientes ativos ───────────────────────────────
    let qClientes = supabase.from('companies').select('status');
    if (escopo) qClientes = qClientes.eq('id', escopo);
    const { data: clientes, error: errClientes } = await qClientes;
    if (errClientes) throw errClientes;
    const clientesAtivos = (clientes || []).filter(function (c) { return statusAtivo(c.status); }).length;

    // ── 2) Playlists ─────────────────────────────────────
    let qPlaylists = supabase.from('playlists').select('id');
    if (escopo) qPlaylists = qPlaylists.eq('company_id', escopo);
    const { data: playlists, error: errPlaylists } = await qPlaylists;
    if (errPlaylists) throw errPlaylists;
    const totalPlaylists = (playlists || []).length;

    // ── 3) Músicas no R2 — contagem REAL do bucket ★ ─────
    // Usa o listFiles() do r2.js (que você colou), filtra só áudio
    // e exclui a pasta Vinhetas/ — mesma regra do /api/r2/music
    let totalMusicas = 0;
    try {
      const files = await listFiles();
      totalMusicas = (files || []).filter(function (f) {
        return /\.(mp3|wav|m4a|flac|ogg|aac|opus)$/i.test(f.Key) && !/^Vinhetas\//i.test(f.Key);
      }).length;
    } catch (errR2) {
      console.warn('[OVERVIEW] R2 indisponível:', errR2.message);
    }

    // ── 4) Faturamento (soma de valor_mensal das companies) ★
    let faturamentoTotal = 0;
    {
      let qEmpresas = supabase.from('companies').select('valor_mensal');
      if (escopo) qEmpresas = qEmpresas.eq('id', escopo);
      const { data: empresas, error: errEmpresas } = await qEmpresas;
      if (!errEmpresas) {
        (empresas || []).forEach(function (e) {
          const v = Number(e.valor_mensal);
          if (isFinite(v)) faturamentoTotal += v;
        });
      } else {
        console.warn('[OVERVIEW] companies indisponível:', errEmpresas.message);
      }
    }
    const mesAtual = new Date().toISOString().slice(0, 7);

    // ── 5) SAC (tickets) ────────────────────────────────
    let sacTotal = 0;
    let sacAbertos = 0;
    let sacResolvidos = 0;
    {
      let qTickets = supabase.from('tickets').select('*');
      if (escopo) qTickets = qTickets.eq('company_id', escopo);
      const { data: chamados, error: errTickets } = await qTickets;
      if (!errTickets) {
        sacTotal = (chamados || []).length;
        (chamados || []).forEach(function (t) {
          const st = String(t.status || '').toUpperCase();
          if (['ABERTO', 'OPEN', 'PENDENTE', 'PENDING', 'NOVO', 'NEW'].indexOf(st) !== -1) sacAbertos++;
          if (['RESOLVIDO', 'RESOLVED', 'FECHADO', 'CLOSED', 'CONCLUIDO', 'CONCLUÍDO'].indexOf(st) !== -1) sacResolvidos++;
        });
      } else {
        console.warn('[OVERVIEW] tickets indisponível:', errTickets.message);
      }
    }

    res.json({
      success: true,
      overview: {
        clientes_ativos: clientesAtivos,
        playlists: totalPlaylists,
        musicas_r2: totalMusicas,
        faturamento: {
          total: Math.round(faturamentoTotal * 100) / 100,
          mes_atual: Math.round(faturamentoTotal * 100) / 100,
          por_mes: {},
          meses: []
        },
        sac: { total: sacTotal, abertos: sacAbertos, resolvidos: sacResolvidos },
        gerado_em: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[OVERVIEW] Erro:', err.message);
    res.status(500).json({ success: false, message: 'Erro interno ao montar visão geral.' });
  }
}

module.exports = { getOverview };