/* ============================================================
   ROTA SEGURA — community.js
   Fórum/chat da comunidade: listar, publicar e ouvir novas
   mensagens em tempo real (Supabase Realtime).
   ============================================================ */

import { supabase } from './supabaseClient.js';

export async function buscarPosts(limite = 50) {
  const { data, error } = await supabase
    .from('comunidade_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (error) throw error;
  return data.reverse(); // mais antigos primeiro, como um chat
}

export async function publicarPost({ autorId, autorNome, conteudo, tipo = 'relato' }) {
  const texto = conteudo.trim();
  if (!texto) throw new Error('A mensagem não pode estar vazia.');
  if (texto.length > 1000) throw new Error('Mensagem muito longa (máximo de 1000 caracteres).');

  const { data, error } = await supabase
    .from('comunidade_posts')
    .insert({ autor_id: autorId, autor_nome: autorNome, conteudo: texto, tipo })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Chama `callback` toda vez que alguém publica uma nova mensagem. */
export function inscreverNovosPosts(callback) {
  return supabase
    .channel('comunidade-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comunidade_posts' }, (payload) => callback(payload.new))
    .subscribe();
}

export function cancelarInscricao(channel) {
  if (channel) supabase.removeChannel(channel);
}
