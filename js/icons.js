/* ============================================================================
   ROTA SEGURA — Ícones SVG (estilo linha fina, inspirado no Lucide)
   Nenhum emoji é usado como ícone em nenhum lugar do projeto.
   Uso: icone('escudo', 24)  ->  string com o <svg>
   ============================================================================ */

const CAMINHOS = {
  escudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  lupa: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  mira: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  mapa: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  rotas: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  mais: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  fechar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alerta: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  lampada: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  pino: '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  hospital: '<path d="M12 8v8"/><path d="M8 12h8"/><rect x="3" y="3" width="18" height="18" rx="3"/>',
  predio: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h.01"/><path d="M15 8h.01"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 21v-4h4v4"/>',
  onibus: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M4 10h16"/><path d="M7 20v-2"/><path d="M17 20v-2"/><circle cx="8" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1" fill="currentColor" stroke="none"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  olhoFechado: '<path d="m3 3 18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8"/><path d="M6.2 6.2A16.7 16.7 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3.5-.6"/>',
  voltar: '<path d="m15 18-6-6 6-6"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/>',
  cadeado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  megafone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l7 5V5L6 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  coracao: '<path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20z"/>',
  camera: '<path d="M5 7h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  sos: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  vazio: '<circle cx="12" cy="12" r="9"/><path d="M8 15h8"/><path d="M9 9h.01"/><path d="M15 9h.01"/>',
  trocar: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  bandeira: '<path d="M4 22V4"/><path d="M4 4h14l-2.5 4L18 12H4"/>',
  andando: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21 11 14l-2-2 .5-4.5L12 6l2.5 1.5.5 4-2 2 1.5 7"/><path d="M14 10.5l3 2-1 3"/>',
  carro: '<path d="M14 16H9m10 0h2v-3.5a2 2 0 0 0-.4-1.2L18 7.5a2 2 0 0 0-1.6-.8H7.5a2 2 0 0 0-1.8 1.1L4.4 11a2 2 0 0 0-.4 1.2V16h2"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  lixeira: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  telefone: '<path d="M6.6 10.8a15.9 15.9 0 0 0 6.6 6.6l2.2-2.2a1.5 1.5 0 0 1 1.6-.35 9 9 0 0 0 2.8.45 1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5A17.5 17.5 0 0 1 2.5 4 1.5 1.5 0 0 1 4 2.5h3.2A1.5 1.5 0 0 1 8.7 4a9 9 0 0 0 .45 2.8 1.5 1.5 0 0 1-.35 1.6Z"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.09H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  compartilhar: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
  comentario: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  enviar: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  votoPositivo: '<circle cx="12" cy="12" r="9"/><path d="M12 16V8"/><path d="m8 12 4-4 4 4"/>',
  votoNegativo: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  som: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  semSom: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m17 9 5 6"/><path d="m22 9-5 6"/>'
};

/**
 * Devolve o HTML de um ícone SVG.
 * @param {string} nome - chave em CAMINHOS
 * @param {number} tamanho - largura/altura em pixels
 * @param {number} espessura - espessura do traço
 */
export function icone(nome, tamanho = 24, espessura = 1.8) {
  const conteudo = CAMINHOS[nome] || CAMINHOS.pino;
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="${espessura}" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">${conteudo}</svg>`;
}

/** Preenche automaticamente todo elemento com data-icone="nome". */
export function aplicarIcones(raiz = document) {
  raiz.querySelectorAll('[data-icone]').forEach((el) => {
    const nome = el.dataset.icone;
    const tamanho = Number(el.dataset.tamanho || 24);
    el.innerHTML = icone(nome, tamanho);
  });
}

/** Marcador de mapa (pino colorido com ícone dentro). */
export function pinoMapa(nomeIcone, cor) {
  return `
  <div class="marcador">
    <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 15 25 15 25s15-14.5 15-25c0-8.3-6.7-15-15-15z"
            fill="${cor}" stroke="#FFFFFF" stroke-width="2"/>
      <svg x="9" y="8" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${CAMINHOS[nomeIcone] || CAMINHOS.pino}
      </svg>
    </svg>
  </div>`;
}
