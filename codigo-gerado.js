const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://ewxnxajifnakkeijlhwn.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eG54YWppZm5ha2tlaWpsaHduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njk4NzY3NywiZXhwIjoyMTAyNTYzNjc3fQ.BFIdqZE71j61t-f8Uvze-BXhX00oYZv0siDUx6LHMQI', { auth: { autoRefreshToken: false, persistSession: false } });
(async () => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  data.users.forEach(u => console.log(u.email, '|', u.id));
  console.log('Total:', data.users.length);
})();
