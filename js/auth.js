/* ============================================================
   ROTA SEGURA — auth.js
   Cadastro, login, logout e leitura do perfil da usuária logada.
   Toda a parte de senha/hash/sessão é delegada ao Supabase Auth
   — o app nunca manipula ou armazena senha em texto puro.
   ============================================================ */

import { supabase } from './supabaseClient.js';

/**
 * Cria a conta (auth.users) e o perfil (public.perfis) da usuária.
 * @param {{nome:string, email:string, senha:string, contatoEmergencia:string}} dados
 */
export async function cadastrar({ nome, email, senha, contatoEmergencia }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    // Guardamos nome e contato também no user_metadata (não só na
    // tabela perfis). Isso é o que permite recriar a linha em
    // `perfis` no primeiro login, caso a confirmação por e-mail
    // esteja ativada e ainda não exista sessão neste momento.
    options: { data: { nome, contato_emergencia: contatoEmergencia } }
  });

  if (error) throw error;

  if (data.session) {
    await criarPerfilSeNaoExistir({ id: data.user.id, nome, email, contatoEmergencia });
  }

  return data;
}

export async function entrar({ email, senha }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;

  const meta = data.user.user_metadata || {};
  // Garante que o perfil existe (cobre o caso de confirmação por
  // e-mail: no cadastro não havia sessão ainda para criar a linha).
  await criarPerfilSeNaoExistir({
    id: data.user.id,
    nome: meta.nome || email.split('@')[0],
    email,
    contatoEmergencia: meta.contato_emergencia || null
  });

  return data;
}

export async function sair() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function obterSessaoAtual() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Confirma no SERVIDOR se a sessão salva no navegador ainda é válida
 * (ex: a conta pode ter sido apagada no painel do Supabase mesmo com
 * o token local ainda não expirado). `getSession()` sozinho não pega
 * esse caso porque só lê o que está salvo no navegador; `getUser()`
 * faz uma chamada real à API de autenticação.
 * Se a sessão não for mais válida, ela é limpa automaticamente.
 */
export async function obterUsuarioValidado() {
  const { data: sessaoLocal } = await supabase.auth.getSession();
  if (!sessaoLocal.session) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    await supabase.auth.signOut();
    return null;
  }
  return data.user;
}

export function aoMudarAutenticacao(callback) {
  const { data } = supabase.auth.onAuthStateChange((evento, sessao) => callback(evento, sessao));
  return data.subscription;
}

export async function obterPerfil(userId) {
  const { data, error } = await supabase
    .from('perfis')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function criarPerfilSeNaoExistir({ id, nome, email, contatoEmergencia }) {
  const existente = await obterPerfil(id);
  if (existente) return existente;

  if (!contatoEmergencia) {
    // Perfil ainda não pode ser criado sem o contato de emergência
    // (é obrigatório no schema). A tela de cadastro sempre envia
    // esse valor; em logins subsequentes o perfil já existirá.
    return null;
  }

  const { data, error } = await supabase
    .from('perfis')
    .insert({ id, nome, email, contato_emergencia: contatoEmergencia })
    .select()
    .single();

  if (error) throw error;
  return data;
}
