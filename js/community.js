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

export async function publicarPost({ autorId, autorNome, conteudo, tipo = 'relato', anonimo = false }) {
  const texto = conteudo.trim();
  if (!texto) throw new Error('A mensagem não pode estar vazia.');
  if (texto.length > 1000) throw new Error('Mensagem muito longa (máximo de 1000 caracteres).');

  const { data, error } = await supabase
    .from('comunidade_posts')
    .insert({ autor_id: autorId, autor_nome: autorNome, conteudo: texto, tipo, anonimo: !!anonimo })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** "há 5 min", "há 2 h", "há 3 dias"... */
export function formatarTempoRelativo(isoString) {
  const segundos = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (segundos < 60) return 'agora mesmo';
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia${dias > 1 ? 's' : ''}`;
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
