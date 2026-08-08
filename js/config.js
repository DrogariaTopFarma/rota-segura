/* ============================================================
   ROTA SEGURA — config.js
   Cole aqui as chaves do SEU projeto Supabase.
   Veja o passo a passo no README.md ("Passo 2: pegar as chaves").

   IMPORTANTE SOBRE SEGURANÇA:
   A "anon public key" é feita para ser pública — ela só permite
   o que as políticas de RLS (Row Level Security) autorizarem no
   banco. Por isso o schema.sql cria políticas restritas em toda
   tabela. NUNCA cole aqui a "service_role key": essa sim é
   secreta e nunca deve aparecer em código de front-end.
   ============================================================ */

export const SUPABASE_URL = "https://rmggyqqmhupkabgwmnzv.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_ZBpUZp9ZqjvnKMU0lNky_Q_poX_2huA";
