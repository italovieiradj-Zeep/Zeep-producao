// setup-usuario.js — Usuários: listar | resetar senha | criar | vincular empresa/filial
// Exige a service_role. Rode LOCALMENTE e apague depois (nunca suba pro Git).
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ewxnxajifnakkeijlhwn.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eG54YWppZm5ha2tlaWpsaHduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk4NzY3NywiZXhwIjoyMTAyNTYzNjc3fQ.BFIdqZE71j61t-f8Uvze-BXhX00oYZv0siDUx6LHMQI';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const MODO  = process.argv[2] || 'list';          // list | reset | create | link
const EMAIL = process.argv[3] || '';
const P1    = process.argv[4] || '';              // reset: nova senha | link: company_id
const P2    = process.argv[5] || '';              // link: unit_id

async function listar() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  console.log('Usuários no Auth:');
  data.users.forEach(u => console.log(`${u.email}  | id: ${u.id}  | criado: ${u.created_at}`));
  console.log(`Total: ${data.users.length}`);
}

async function resetar() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find(u => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
  if (!user) { console.log(`❌ "${EMAIL}" NÃO existe no Auth. Use:  node setup-usuario.js create "${EMAIL}" "Senha"`); return; }
  const { error: err2 } = await supabase.auth.admin.updateUserById(user.id, { password: P1 });
  if (err2) throw err2;
  console.log(`✅ Senha de ${EMAIL} alterada para: ${P1}`);
}

async function criar() {
  const { data, error } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: P1 || 'Zeep@2026!',
    email_confirm: true        // ✅ confirma SEM depender de caixa postal
  });
  if (error) throw error;
  console.log(`✅ Usuário criado: ${data.user.email} | id: ${data.user.id}`);
  console.log('Agora vincule empresa/filial:');
  console.log(`   node setup-usuario.js link "${EMAIL}" COMPANY_ID UNIT_ID`);
}

async function vincular() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find(u => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
  if (!user) { console.log(`❌ Usuário ${EMAIL} não encontrado no Auth`); return; }
  const { error: err2 } = await supabase.from('profiles').upsert({
    id: user.id,
    company_id: P1,
    unit_id: P2,
    role: 'OWNER',
    updated_at: new Date().toISOString()
  });
  if (err2) throw err2;
  console.log(`✅ Profile vinculado: ${EMAIL}  ->  company ${P1}  |  unit ${P2}`);
}

(async () => {
  try {
    if (MODO === 'list')      await listar();
    else if (MODO === 'reset') await resetar();
    else if (MODO === 'create') await criar();
    else if (MODO === 'link')  await vincular();
    else console.log('Uso: node setup-usuario.js [list | reset EMAIL SENHA | create EMAIL SENHA | link EMAIL COMPANY_ID UNIT_ID]');
  } catch (err) {
    console.error('ERRO:', err.message || err);
  }
})();