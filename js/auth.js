/* ============================================================================
   ROTA SEGURA — Autenticação (Supabase Auth)
   Login, cadastro, recuperação de senha, nova senha, logout e proteção
   das páginas internas. A senha NUNCA é gravada em tabela por nós.
   ============================================================================ */

import { supabase, traduzirErro, supabaseConfigurado } from './supabase.js';
import { mostrarMensagem, limparMensagem, botaoCarregando, toast } from './ui.js';

/* --------------------------------------------------------------- Sessão --- */

export async function usuarioAtual() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/** Usada nas páginas internas: sem login, volta para a tela de entrar. */
export async function exigirLogin() {
  if (!supabaseConfigurado) {
    toast('Configure js/config.js com a URL e a chave do Supabase.', 'erro', 8000);
    return null;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace('login.html');
    return null;
  }
  return data.session.user;
}

/** Usada nas páginas públicas: se já estiver logada, vai direto ao mapa. */
export async function redirecionarSeLogado(destino = 'pages/mapa.html') {
  if (!supabaseConfigurado) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) window.location.replace(destino);
}

export async function sair() {
  await supabase.auth.signOut();
  window.location.replace('login.html');
}

/* ------------------------------------------------------------ Validação --- */

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function marcarErro(input, elErro, texto) {
  input.setAttribute('aria-invalid', 'true');
  if (elErro) { elErro.textContent = texto; elErro.hidden = false; }
}

function limparErros(form) {
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  form.querySelectorAll('.campo-erro').forEach((e) => { e.hidden = true; e.textContent = ''; });
}

/* ------------------------------------------------- Mostrar/ocultar senha --- */

function ligarToggleSenha() {
  document.querySelectorAll('.senha-toggle').forEach((botao) => {
    botao.addEventListener('click', () => {
      const input = document.getElementById(botao.dataset.alvo);
      if (!input) return;
      const visivel = input.type === 'text';
      input.type = visivel ? 'password' : 'text';
      botao.setAttribute('aria-label', visivel ? 'Mostrar senha' : 'Ocultar senha');
      botao.dataset.icone = visivel ? 'olho' : 'olhoFechado';
      import('./icons.js').then(({ aplicarIcones }) => aplicarIcones(botao.parentElement));
    });
  });
}

/* --------------------------------------------------------------- LOGIN --- */

function ligarFormLogin() {
  const form = document.getElementById('form-login');
  if (!form) return;
  const msg = document.getElementById('mensagem');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    limparMensagem(msg);

    const email = form.email.value.trim();
    const senha = form.senha.value;

    if (!emailValido(email)) {
      return marcarErro(form.email, document.getElementById('erro-email'), 'Digite um e-mail válido.');
    }
    if (!senha) {
      return marcarErro(form.senha, document.getElementById('erro-senha'), 'Digite sua senha.');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Entrando...');

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    botaoCarregando(botao, false);

    if (error) {
      // Mensagem genérica de propósito: não revelamos se o e-mail existe.
      mostrarMensagem(msg, traduzirErro(error), 'erro');
      return;
    }
    window.location.replace('mapa.html');
  });
}

/* ------------------------------------------------------------ CADASTRO --- */

function ligarFormCadastro() {
  const form = document.getElementById('form-cadastro');
  if (!form) return;
  const msg = document.getElementById('mensagem');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    limparMensagem(msg);

    const nome = form.nome.value.trim();
    const email = form.email.value.trim();
    const senha = form.senha.value;
    const confirmar = form.confirmar.value;
    const telefone = form.telefone.value.trim();

    if (nome.length < 3) {
      return marcarErro(form.nome, document.getElementById('erro-nome'), 'Digite seu nome completo.');
    }
    if (!emailValido(email)) {
      return marcarErro(form.email, document.getElementById('erro-email'), 'Digite um e-mail válido.');
    }
    if (senha.length < 6) {
      return marcarErro(form.senha, document.getElementById('erro-senha'), 'A senha precisa ter pelo menos 6 caracteres.');
    }
    if (senha !== confirmar) {
      return marcarErro(form.confirmar, document.getElementById('erro-confirmar'), 'As senhas não são iguais.');
    }
    if (!form.termos.checked) {
      return mostrarMensagem(msg, 'É preciso aceitar os termos de uso para continuar.', 'atencao');
    }
    if (!form.privacidade.checked) {
      return mostrarMensagem(msg, 'É preciso aceitar a política de privacidade para continuar.', 'atencao');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Criando conta...');

    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        data: {
          full_name: nome,
          phone: telefone || null,
          accepted_terms: true,
          accepted_privacy: true
        },
        emailRedirectTo: new URL('login.html', window.location.href).href
      }
    });

    botaoCarregando(botao, false);

    if (error) {
      mostrarMensagem(msg, traduzirErro(error), 'erro');
      return;
    }

    // Se a confirmação de e-mail estiver LIGADA, não vem sessão.
    if (data.session) {
      window.location.replace('mapa.html');
    } else {
      form.reset();
      mostrarMensagem(
        msg,
        'Conta criada. Enviamos um link de confirmação para o seu e-mail. Confirme e depois faça login.',
        'sucesso'
      );
    }
  });
}

/* ------------------------------------------------ RECUPERAR SENHA (envio) --- */

function ligarFormRecuperar() {
  const form = document.getElementById('form-recuperar');
  if (!form) return;
  const msg = document.getElementById('mensagem');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    limparMensagem(msg);

    const email = form.email.value.trim();
    if (!emailValido(email)) {
      return marcarErro(form.email, document.getElementById('erro-email'), 'Digite um e-mail válido.');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Enviando...');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('nova-senha.html', window.location.href).href
    });

    botaoCarregando(botao, false);

    if (error && !String(error.message).toLowerCase().includes('rate')) {
      mostrarMensagem(msg, traduzirErro(error), 'erro');
      return;
    }

    // Sempre a mesma resposta: não revelamos se o e-mail está cadastrado.
    mostrarMensagem(
      msg,
      'Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.',
      'sucesso'
    );
    form.reset();
  });
}

/* ------------------------------------------------- NOVA SENHA (pelo link) --- */

function ligarFormNovaSenha() {
  const form = document.getElementById('form-nova-senha');
  if (!form) return;
  const msg = document.getElementById('mensagem');

  // Ao abrir pelo link do e-mail, o Supabase cria uma sessão temporária.
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') {
      mostrarMensagem(msg, 'Link confirmado. Agora escolha sua nova senha.', 'info');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros(form);
    limparMensagem(msg);

    const senha = form.senha.value;
    const confirmar = form.confirmar.value;

    if (senha.length < 6) {
      return marcarErro(form.senha, document.getElementById('erro-senha'), 'A senha precisa ter pelo menos 6 caracteres.');
    }
    if (senha !== confirmar) {
      return marcarErro(form.confirmar, document.getElementById('erro-confirmar'), 'As senhas não são iguais.');
    }

    const botao = form.querySelector('button[type="submit"]');
    botaoCarregando(botao, true, 'Salvando...');

    const { error } = await supabase.auth.updateUser({ password: senha });

    botaoCarregando(botao, false);

    if (error) {
      mostrarMensagem(
        msg,
        'Não foi possível salvar a nova senha. O link pode ter expirado — peça outro na tela "Esqueci minha senha".',
        'erro'
      );
      return;
    }

    mostrarMensagem(msg, 'Senha alterada. Redirecionando para o login...', 'sucesso');
    await supabase.auth.signOut();
    setTimeout(() => window.location.replace('login.html'), 2200);
  });
}

/* --------------------------------------------------------- Inicialização --- */

export function iniciarAuth() {
  ligarToggleSenha();
  ligarFormLogin();
  ligarFormCadastro();
  ligarFormRecuperar();
  ligarFormNovaSenha();

  document.querySelectorAll('[data-acao="sair"]').forEach((b) =>
    b.addEventListener('click', sair)
  );
}
