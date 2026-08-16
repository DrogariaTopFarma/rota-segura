/* ============================================================================
   ROTA SEGURA — Cliente Supabase
   Cria UMA única conexão com o Supabase, usada por todos os outros arquivos.
   ============================================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configurado =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('SEU-PROJETO') &&
  !SUPABASE_ANON_KEY.includes('COLE_AQUI');

if (!configurado) {
  console.error(
    '[Rota Segura] As chaves do Supabase não foram configuradas. ' +
    'Abra js/config.js e preencha SUPABASE_URL e SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(
  configurado ? SUPABASE_URL : 'https://placeholder.supabase.co',
  configurado ? SUPABASE_ANON_KEY : 'placeholder',
  {
    auth: {
      persistSession: true,      // mantém você logada ao recarregar a página
      autoRefreshToken: true,
      detectSessionInUrl: true   // necessário para o link de recuperação de senha
    }
  }
);

export const supabaseConfigurado = configurado;

/** Traduz erros técnicos do Supabase para mensagens amigáveis em português. */
export function traduzirErro(erro) {
  if (!erro) return 'Algo deu errado. Tente novamente.';
  const msg = (erro.message || String(erro)).toLowerCase();

  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
  if (msg.includes('user already registered')) return 'Já existe uma conta com este e-mail.';
  if (msg.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'Digite um e-mail válido.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'Sem conexão com o servidor. Verifique sua internet.';
  if (msg.includes('row-level security') || msg.includes('violates row-level')) return 'Você não tem permissão para esta ação.';
  if (msg.includes('jwt') || msg.includes('session')) return 'Sua sessão expirou. Entre novamente.';

  return 'Não foi possível concluir a ação. Tente novamente.';
}
