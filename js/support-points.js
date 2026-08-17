/* ============================================================================
   ROTA SEGURA — Pontos de apoio e delegacias
   Um único formulário: se o tipo escolhido for "delegacia", grava na tabela
   police_stations; nos outros casos, grava em support_points.

   Assim como no relato, o local vem do seletor com mini-mapa e começa vazio
   toda vez que o formulário abre.
   ============================================================================ */

import { supabase, traduzirErro } from './supabase.js';
import { toast, botaoCarregando, fecharModal, mostrarMensagem, limparMensagem } from './ui.js';
import { carregarDadosDaAreaVisivel } from './map.js';
import { criarSeletorLocal } from './location-picker.js';

let seletor = null;

export function seletorDeLocalDoPonto() { return seletor; }

export function prepararFormularioPonto() {
  const form = document.getElementById('form-ponto');
  if (!form) return;

  const msg = document.getElementById('mensagem-ponto');
  const checkDeam = document.getElementById('ponto-deam-wrapper');

  seletor = criarSeletorLocal({
    mapa: 'ponto-mini-mapa',
    busca: 'ponto-endereco',
    sugestoes: 'ponto-sugestoes',
    resumo: 'ponto-local-escolhido',
    botaoGps: 'ponto-usar-localizacao'
  });

  form.tipo.addEventListener('change', () => {
    checkDeam.hidden = form.tipo.value !== 'delegacia';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparMensagem(msg);

    const local = seletor.valor();

    if (!form.tipo.value) return mostrarMensagem(msg, 'Escolha o tipo do local.', 'atencao');
    if (!form.nome.value.trim()) return mostrarMensagem(msg, 'Informe o nome do local.', 'atencao');
    if (!local) {
      return mostrarMensagem(
        msg,
        'Ainda não temos o local. Toque em "Usar minha localização" ou corrija o endereço em "Não é aqui?".',
        'atencao'
      );
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');

    try {
      const { data: sessao } = await supabase.auth.getUser();
      const user = sessao?.user;
      if (!user) throw new Error('session');

      const ehDelegacia = form.tipo.value === 'delegacia';

      const base = {
        user_id: user.id,
        name: form.nome.value.trim(),
        address: form.endereco.value.trim() || local.nome,
        lat: local.lat,
        lng: local.lng,
        phone: form.telefone.value.trim() || null,
        description: form.descricao.value.trim() || null,
        opening_hours: form.horario.value.trim() || null
      };

      const { error } = ehDelegacia
        ? await supabase.from('police_stations').insert({
            ...base,
            is_women_only: form.deam.checked
          })
        : await supabase.from('support_points').insert({
            ...base,
            type: form.tipo.value,
            extra_info: form.extra.value.trim() || null
          });

      if (error) throw error;

      toast('Local enviado. Ele aparece no mapa após a aprovação.', 'sucesso');
      form.reset();
      checkDeam.hidden = true;
      seletor.limpar();
      fecharModal('modal-ponto');
      await carregarDadosDaAreaVisivel();
    } catch (erro) {
      console.error(erro);
      mostrarMensagem(msg, traduzirErro(erro), 'erro');
    } finally {
      botaoCarregando(botao, false);
    }
  });
}
