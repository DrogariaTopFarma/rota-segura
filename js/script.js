/* ============================================================
   ROTA SEGURA — script.js
   Dados, busca, filtros por categoria, "Minha Rota" (salvos) e
   cadastro rápido com upload de foto (FileReader → Base64).

   IMPORTANTE: este é um site 100% front-end, sem banco de dados.
   Os locais cadastrados pelo formulário ficam só na memória da
   página — ao recarregar, a lista volta aos exemplos abaixo.
   Isso é ótimo para demonstrar o funcionamento na feira; para um
   uso real e multiusuário, o próximo passo seria ligar isso a um
   backend (Firebase, Supabase etc.).
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

  /* ---------- Ícones (SVG inline, substituem os emojis do design anterior) ---------- */
  const ICONS = {
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-10-9.3C.4 8 1.8 4.5 5 3.6c2-.6 4 .2 5 2 .1.2.5.9 2 3 1.5-2.1 1.9-2.8 2-3 1-1.8 3-2.6 5-2 3.2.9 4.6 4.4 3 7.6-2.5 4.7-10 9.3-10 9.3Z"/></svg>',
    heartFilled: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 20.5s-7.5-4.6-10-9.3C.4 8 1.8 4.5 5 3.6c2-.6 4 .2 5 2 .1.2.5.9 2 3 1.5-2.1 1.9-2.8 2-3 1-1.8 3-2.6 5-2 3.2.9 4.6 4.4 3 7.6-2.5 4.7-10 9.3-10 9.3Z"/></svg>',
    road: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3 5 21"/><path d="M17 3l4 18"/><path d="M12 3v3M12 10v3M12 17v3"/></svg>',
    store: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 4 4h16l1 5"/><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z"/><path d="M9 20v-6h6v6"/></svg>',
    bus: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 12h18"/><circle cx="7.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/></svg>',
    train: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="13" rx="4"/><path d="M5 12h14"/><path d="M8 17l-2 4M16 17l2 4"/><circle cx="9" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r="1" fill="currentColor" stroke="none"/></svg>',
    placeholder: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>'
  };

  /* ---------- Dados de exemplo (fictícios, só para demonstração) ---------- */
  let locations = [
    {
      id: 1,
      name: 'Praça das Acácias',
      neighborhood: 'Centro',
      category: 'rua',
      safety: 'seguro',
      description: 'Praça bem iluminada, com policiamento frequente à noite e movimento constante de famílias.',
      photo: null
    },
    {
      id: 2,
      name: 'Rua dos Ipês',
      neighborhood: 'Vila Nova',
      category: 'rua',
      safety: 'alerta',
      description: 'Trecho com pouca iluminação entre os números 200 e 400. Poucas pessoas relatam caminhar por ali à noite.',
      photo: null
    },
    {
      id: 3,
      name: 'Mercado Central',
      neighborhood: 'Centro',
      category: 'estabelecimento',
      safety: 'seguro',
      description: 'Estabelecimento movimentado, com segurança própria e boa iluminação externa.',
      photo: null
    },
    {
      id: 4,
      name: 'Ponto Rua da Praia',
      neighborhood: 'Zona Sul',
      category: 'onibus',
      safety: 'atencao',
      description: 'Ponto sem cobertura e com iluminação fraca depois das 20h. O movimento cai bastante à noite.',
      photo: null
    },
    {
      id: 5,
      name: 'Estação Jardim Bela Vista',
      neighborhood: 'Zona Norte',
      category: 'estacao',
      safety: 'seguro',
      description: 'Estação com câmeras de segurança, funcionários no local e fluxo constante de pessoas.',
      photo: null
    },
    {
      id: 6,
      name: 'Beco das Palmeiras',
      neighborhood: 'Vila Rica',
      category: 'rua',
      safety: 'alerta',
      description: 'Rua estreita e isolada, sem comércio ou iluminação adequada no trecho final.',
      photo: null
    }
  ];

  let savedRoute = [];          // ids dos locais salvos em "Minha Rota"
  let currentCategory = 'todos';
  let currentSearch = '';
  let showOnlySaved = false;
  let uploadedPhotoData = null; // base64 da foto escolhida no formulário

  const categoryLabels = { rua: 'Rua & Praça', estabelecimento: 'Estabelecimento', onibus: 'Ponto de Ônibus', estacao: 'Estação' };
  const categoryIcons  = { rua: ICONS.road, estabelecimento: ICONS.store, onibus: ICONS.bus, estacao: ICONS.train };
  const safetyLabels   = { seguro: 'Seguro', atencao: 'Pouco iluminado', alerta: 'Isolado / Alerta' };

  /* ---------- Referências do DOM ---------- */
  const grid = document.getElementById('cardsGrid');
  const resultsCount = document.getElementById('resultsCount');
  const searchInput = document.getElementById('searchInput');
  const searchForm = document.getElementById('searchForm');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const form = document.getElementById('cadastroForm');
  const photoInput = document.getElementById('inputFoto');
  const photoPreview = document.getElementById('fotoPreview');
  const formMessage = document.getElementById('formMessage');
  const savedCountEl = document.getElementById('savedCount');
  const navHome = document.getElementById('navHome');
  const navRoute = document.getElementById('navRoute');
  const navCadastrar = document.getElementById('navCadastrar');
  const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
  const cadastroOverlay = document.getElementById('cadastroOverlay');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  /* ---------- Utilidades ---------- */

  // Evita que texto digitado pelas usuárias seja interpretado como HTML.
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function setActiveBottomNav(id) {
    bottomNavItems.forEach(function (item) {
      item.classList.toggle('active', item.id === id);
    });
  }

  function updateActiveTab(category) {
    tabButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.category === category);
    });
  }

  function updateSavedBadge() {
    if (savedRoute.length > 0) {
      savedCountEl.textContent = String(savedRoute.length);
      savedCountEl.hidden = false;
    } else {
      savedCountEl.hidden = true;
    }
  }

  /* ---------- Modal de cadastro (abre só quando a usuária pede) ---------- */
  function openCadastroModal() {
    cadastroOverlay.classList.add('is-open');
    cadastroOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeCadastroModal() {
    cadastroOverlay.classList.remove('is-open');
    cadastroOverlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  modalCloseBtn.addEventListener('click', closeCadastroModal);
  cadastroOverlay.addEventListener('click', function (e) {
    if (e.target === cadastroOverlay) closeCadastroModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && cadastroOverlay.classList.contains('is-open')) {
      closeCadastroModal();
    }
  });

  /* ---------- Renderização dos cards ---------- */

  function getFilteredLocations() {
    return locations.filter(function (loc) {
      const matchesCategory = currentCategory === 'todos' || loc.category === currentCategory;
      const q = currentSearch;
      const matchesSearch = !q ||
        loc.name.toLowerCase().includes(q) ||
        loc.neighborhood.toLowerCase().includes(q) ||
        loc.description.toLowerCase().includes(q);
      const matchesSaved = !showOnlySaved || savedRoute.includes(loc.id);
      return matchesCategory && matchesSearch && matchesSaved;
    });
  }

  function cardTemplate(loc, index) {
    const isSaved = savedRoute.includes(loc.id);
    const photoHtml = loc.photo
      ? '<img class="card-photo" src="' + loc.photo + '" alt="Foto de ' + escapeHtml(loc.name) + '">'
      : '<div class="card-photo card-photo-placeholder" aria-hidden="true">' + ICONS.placeholder + '</div>';

    return (
      '<article class="card" style="animation-delay:' + (index * 0.06) + 's">' +
        photoHtml +
        '<div class="card-body">' +
          '<span class="badge badge-' + loc.safety + '"><span class="lamp" aria-hidden="true"></span>' + safetyLabels[loc.safety] + '</span>' +
          '<h3>' + escapeHtml(loc.name) + '</h3>' +
          '<p class="card-neighborhood">' + ICONS.pin + ' ' + escapeHtml(loc.neighborhood) + '</p>' +
          '<span class="tag">' + categoryIcons[loc.category] + ' ' + categoryLabels[loc.category] + '</span>' +
          '<p class="card-desc">' + escapeHtml(loc.description) + '</p>' +
          '<button type="button" class="btn-save' + (isSaved ? ' saved' : '') + '" data-id="' + loc.id + '">' +
            (isSaved ? ICONS.heartFilled + ' Salvo na Rota' : ICONS.heart + ' Salvar na Minha Rota') +
          '</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderCards() {
    const filtered = getFilteredLocations();

    if (filtered.length === 0) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<p>' + (showOnlySaved
            ? 'Você ainda não salvou nenhum local na sua rota.'
            : 'Nenhum local encontrado por aqui ainda. Seja a primeira a registrar este lugar.') +
          '</p>' +
          (showOnlySaved ? '' : '<button type="button" class="empty-cta" id="emptyCta">Cadastrar agora</button>') +
        '</div>';

      const emptyCta = document.getElementById('emptyCta');
      if (emptyCta) {
        emptyCta.addEventListener('click', function () {
          openCadastroModal();
        });
      }
    } else {
      grid.innerHTML = filtered.map(cardTemplate).join('');
      grid.querySelectorAll('.btn-save').forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleSaved(Number(btn.dataset.id));
        });
      });
    }

    if (showOnlySaved) {
      resultsCount.textContent = filtered.length + (filtered.length === 1 ? ' local salvo na sua rota' : ' locais salvos na sua rota');
    } else if (currentSearch || currentCategory !== 'todos') {
      resultsCount.textContent = filtered.length + (filtered.length === 1 ? ' resultado encontrado' : ' resultados encontrados');
    } else {
      resultsCount.textContent = filtered.length + (filtered.length === 1 ? ' local registrado até agora' : ' locais registrados até agora');
    }
  }

  function toggleSaved(id) {
    const index = savedRoute.indexOf(id);
    if (index > -1) {
      savedRoute.splice(index, 1);
    } else {
      savedRoute.push(id);
    }
    updateSavedBadge();
    renderCards();
  }

  /* ---------- Busca ---------- */
  searchInput.addEventListener('input', function (e) {
    currentSearch = e.target.value.trim().toLowerCase();
    renderCards();
  });
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault(); // a busca já acontece ao digitar
  });

  /* ---------- Abas de categoria ---------- */
  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentCategory = btn.dataset.category;
      showOnlySaved = false;
      updateActiveTab(currentCategory);
      setActiveBottomNav('navHome');
      renderCards();
    });
  });

  /* ---------- Navegação inferior ---------- */
  navHome.addEventListener('click', function () {
    currentCategory = 'todos';
    showOnlySaved = false;
    currentSearch = '';
    searchInput.value = '';
    updateActiveTab('todos');
    setActiveBottomNav('navHome');
    renderCards();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  navRoute.addEventListener('click', function () {
    showOnlySaved = true;
    setActiveBottomNav('navRoute');
    renderCards();
    document.getElementById('cardsSection').scrollIntoView({ behavior: 'smooth' });
  });

  // "Cadastrar" agora abre o formulário em um modal, em vez de
  // deixá-lo sempre visível no fim da página.
  navCadastrar.addEventListener('click', function () {
    openCadastroModal();
  });

  /* ---------- Upload e pré-visualização de foto (FileReader → Base64) ---------- */
  photoInput.addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];

    if (!file) {
      uploadedPhotoData = null;
      photoPreview.hidden = true;
      photoPreview.src = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      formMessage.textContent = 'Escolha um arquivo de imagem (jpg, png, etc).';
      formMessage.className = 'form-message error';
      photoInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      uploadedPhotoData = event.target.result; // string base64 (data URL)
      photoPreview.src = uploadedPhotoData;
      photoPreview.hidden = false;
    };
    reader.onerror = function () {
      formMessage.textContent = 'Não foi possível ler essa imagem. Tente outro arquivo.';
      formMessage.className = 'form-message error';
    };
    reader.readAsDataURL(file);
  });

  /* ---------- Envio do formulário de cadastro ---------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = document.getElementById('inputNome').value.trim();
    const neighborhood = document.getElementById('inputBairro').value.trim();
    const category = document.getElementById('inputCategoria').value;
    const safetyInput = form.querySelector('input[name="nivel"]:checked');
    const description = document.getElementById('inputDescricao').value.trim();

    if (!name || !neighborhood || !category || !safetyInput) {
      formMessage.textContent = 'Preencha o nome do local, o bairro, a categoria e o nível de atenção para continuar.';
      formMessage.className = 'form-message error';
      return;
    }

    const newLocation = {
      id: Date.now(),
      name: name,
      neighborhood: neighborhood,
      category: category,
      safety: safetyInput.value,
      description: description || 'Sem descrição adicional.',
      photo: uploadedPhotoData
    };

    locations.unshift(newLocation);

    form.reset();
    uploadedPhotoData = null;
    photoPreview.hidden = true;
    photoPreview.src = '';

    currentCategory = 'todos';
    currentSearch = '';
    showOnlySaved = false;
    searchInput.value = '';
    updateActiveTab('todos');
    setActiveBottomNav('navHome');
    renderCards();

    formMessage.textContent = 'Local cadastrado. Obrigada por ajudar outras mulheres a se cuidarem.';
    formMessage.className = 'form-message success';

    // Fecha o modal após mostrar a confirmação e leva a usuária até o card novo.
    setTimeout(function () {
      closeCadastroModal();
      document.getElementById('cardsSection').scrollIntoView({ behavior: 'smooth' });
    }, 1200);
  });

  /* ---------- Inicialização ---------- */
  renderCards();
  updateSavedBadge();

});