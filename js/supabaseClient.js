/* ============================================================
   ROTA SEGURA — supabaseClient.js
   Cria UMA instância do cliente Supabase e a exporta para os
   demais módulos (auth.js, database.js, community.js...).
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const chavesConfiguradas =
  SUPABASE_URL && !SUPABASE_URL.startsWith('COLE_AQUI') &&
  SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('COLE_AQUI');

if (!chavesConfiguradas) {
  console.warn(
    '[Rota Segura] As chaves do Supabase ainda não foram configuradas em js/config.js. ' +
    'Login, mapa e comunidade não vão funcionar até você preencher SUPABASE_URL e SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(
  chavesConfiguradas ? SUPABASE_URL : 'https://placeholder.supabase.co',
  chavesConfiguradas ? SUPABASE_ANON_KEY : 'placeholder-key'
);

export const supabaseConfigurado = chavesConfiguradas;
