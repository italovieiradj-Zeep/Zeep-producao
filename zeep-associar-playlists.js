// Script: lista o cliente Juice & Co e as playlists orfas (so leitura, nao altera nada)
let supabase = null;
const candidatos = ['./src/supabase','./src/lib/supabase','./src/supabaseClient','./src/lib/supabaseClient','./supabase','./supabaseClient','./config/supabase','./src/db/supabase'];
for (const c of candidatos) {
  try { supabase = require(c); console.log('OK usando:', c); break; } catch (e) {}
}
if (!supabase) { console.log('NAO ACHEI o arquivo do Supabase.'); process.exit(0); }
(async () => {
  const { data: clientes, error: e1 } = await supabase.from('companies').select('id, name').ilike('name', '%juice%');
  console.log('CLIENTES (Juice):');
  if (e1) console.log('erro:', e1.message);
  else console.log(JSON.stringify(clientes, null, 2));
  const { data: orfas, error: e2 } = await supabase.from('playlists').select('id, name, company_id').is('company_id', null);
  console.log('PLAYLISTS ORFAS (sem cliente):');
  if (e2) console.log('erro:', e2.message);
  else console.log(JSON.stringify(orfas || [], null, 2));
})();
