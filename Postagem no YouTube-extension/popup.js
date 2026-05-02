// Popup control script with OAuth 2.0 and Google Sheets integration
let sheetsManager = null;
let pendingRows = [];
let isProcessing = false;

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const loginPanel = document.getElementById('loginPanel');
  const userPanel = document.getElementById('userPanel');
  const configSection = document.getElementById('configSection');
  const controlSection = document.getElementById('controlSection');

  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const userPhoto = document.getElementById('userPhoto');

  const sheetUrlInput = document.getElementById('sheetUrl');
  const sheetTabInput = document.getElementById('sheetTab');
  const videosFolderInput = document.getElementById('videosFolder');

  const validateConfigBtn = document.getElementById('validateConfigBtn');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const startBtn = document.getElementById('startReplay');
  const stopBtn = document.getElementById('stopReplay');

  const pendingCount = document.getElementById('pendingCount');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const currentVideoTitle = document.getElementById('currentVideoTitle');
  const errorLog = document.getElementById('errorLog');
  const errorList = document.getElementById('errorList');

  // Verificar se já está autenticado
  await checkAuthStatus();

  // Event Listeners
  loginBtn.addEventListener('click', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  validateConfigBtn.addEventListener('click', handleValidateConfig);
  saveConfigBtn.addEventListener('click', handleSaveConfig);
  startBtn.addEventListener('click', handleStartAutomation);
  stopBtn.addEventListener('click', handleStopAutomation);

  // Salvar rascunhos automaticamente para não perder dados se o popup fechar
  sheetUrlInput.addEventListener('input', () => chrome.storage.local.set({ draft_sheetUrl: sheetUrlInput.value }));
  sheetTabInput.addEventListener('input', () => chrome.storage.local.set({ draft_sheetTab: sheetTabInput.value }));
  if (videosFolderInput) {
    videosFolderInput.addEventListener('input', () => chrome.storage.local.set({ draft_videosFolder: videosFolderInput.value }));
  }

  // Carregar configurações salvas
  loadSavedConfig();

  // ========== AUTH FUNCTIONS ==========

  async function checkAuthStatus() {
    try {
      if (authManager.isAuthenticated()) {
        await showUserPanel();
      } else {
        showLoginPanel();
      }
    } catch (error) {
      console.error('Erro ao verificar autenticação:', error);
      showLoginPanel();
    }
  }

  async function handleLogin() {
    try {
      loginBtn.disabled = true;
      loginBtn.textContent = '🔄 Autenticando...';

      await authManager.authenticate();
      await showUserPanel();

      console.log('✅ Login realizado com sucesso');
    } catch (error) {
      console.error('Erro no login:', error);
      alert('Erro ao fazer login. Verifique as permissões da extensão.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span class="google-icon">G</span> Login com Google';
    }
  }

  async function handleLogout() {
    if (!confirm('Deseja realmente sair? Você precisará fazer login novamente.')) {
      return;
    }

    try {
      await authManager.logout();
      showLoginPanel();
      console.log('✅ Logout realizado');
    } catch (error) {
      console.error('Erro no logout:', error);
    }
  }

  async function showUserPanel() {
    try {
      const userInfo = await authManager.getUserInfo();

      userName.textContent = userInfo.name || 'Usuário';
      userEmail.textContent = userInfo.email || '';
      userPhoto.src = userInfo.picture || '';

      loginPanel.classList.add('hidden');
      userPanel.classList.remove('hidden');
      configSection.classList.remove('hidden');

      // Se tem config salva, mostrar controles
      const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab']);
      if (config.sheetUrl && config.sheetTab) {
        controlSection.classList.remove('hidden');
        await updatePendingCount();
      }
    } catch (error) {
      console.error('Erro ao obter informações do usuário:', error);
      showLoginPanel();
    }
  }

  function showLoginPanel() {
    loginPanel.classList.remove('hidden');
    userPanel.classList.add('hidden');
    configSection.classList.add('hidden');
    controlSection.classList.add('hidden');
  }

  // ========== CONFIG FUNCTIONS ==========

  async function loadSavedConfig() {
    const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab', 'videosFolder']);
    const drafts = await chrome.storage.local.get(['draft_sheetUrl', 'draft_sheetTab', 'draft_videosFolder']);

    if (drafts.draft_sheetUrl !== undefined) sheetUrlInput.value = drafts.draft_sheetUrl;
    else if (config.sheetUrl) sheetUrlInput.value = config.sheetUrl;

    if (drafts.draft_sheetTab !== undefined) sheetTabInput.value = drafts.draft_sheetTab;
    else if (config.sheetTab) sheetTabInput.value = config.sheetTab;

    if (videosFolderInput) {
      if (drafts.draft_videosFolder !== undefined) videosFolderInput.value = drafts.draft_videosFolder;
      else if (config.videosFolder) videosFolderInput.value = config.videosFolder;
    }
  }

  async function handleValidateConfig() {
    if (!validateInputs()) return;

    try {
      validateConfigBtn.disabled = true;
      validateConfigBtn.textContent = '🔍 Validando...';

      sheetsManager = new GoogleSheetsManager(
        sheetUrlInput.value.trim(),
        sheetTabInput.value.trim()
      );

      await sheetsManager.validateSheet();

      alert('✅ Configuração válida! Planilha encontrada com estrutura correta.');

    } catch (error) {
      console.error('Erro na validação:', error);
      alert(`❌ Erro na validação:\n\n${error.message}`);
    } finally {
      validateConfigBtn.disabled = false;
      validateConfigBtn.textContent = '🔍 Validar';
    }
  }

  async function handleSaveConfig() {
    if (!validateInputs()) return;

    try {
      saveConfigBtn.disabled = true;
      saveConfigBtn.textContent = '💾 Salvando...';

      // Validar antes de salvar
      sheetsManager = new GoogleSheetsManager(
        sheetUrlInput.value.trim(),
        sheetTabInput.value.trim()
      );

      await sheetsManager.validateSheet();

      // Salvar configuração
      await chrome.storage.sync.set({
        sheetUrl: sheetUrlInput.value.trim(),
        sheetTab: sheetTabInput.value.trim(),
        videosFolder: videosFolderInput.value.trim()
      });

      // Limpar rascunhos após salvar com sucesso
      await chrome.storage.local.remove(['draft_sheetUrl', 'draft_sheetTab', 'draft_videosFolder']);

      controlSection.classList.remove('hidden');
      await updatePendingCount();

      alert('✅ Configurações salvas com sucesso!');

    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert(`❌ Erro ao salvar:\n\n${error.message}`);
    } finally {
      saveConfigBtn.disabled = false;
      saveConfigBtn.textContent = '💾 Salvar';
    }
  }

  function validateInputs() {
    if (!sheetUrlInput.value.trim()) {
      alert('Por favor, preencha a URL da planilha');
      sheetUrlInput.focus();
      return false;
    }

    if (!sheetTabInput.value.trim()) {
      alert('Por favor, preencha o nome da aba');
      sheetTabInput.focus();
      return false;
    }

    if (!videosFolderInput.value.trim()) {
      alert('Por favor, preencha o caminho da pasta de vídeos');
      videosFolderInput.focus();
      return false;
    }

    return true;
  }

  async function updatePendingCount() {
    try {
      if (!sheetsManager) {
        const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab']);
        sheetsManager = new GoogleSheetsManager(config.sheetUrl, config.sheetTab);
      }

      pendingRows = await sheetsManager.readSheet();
      pendingCount.textContent = pendingRows.length;

    } catch (error) {
      console.error('Erro ao contar vídeos pendentes:', error);
      pendingCount.textContent = '?';
    }
  }

  // ========== AUTOMATION FUNCTIONS ==========

  async function handleStartAutomation() {
    try {
      // Carregar configuração
      const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab', 'videosFolder']);

      if (!config.sheetUrl || !config.sheetTab || !config.videosFolder) {
        alert('Por favor, configure a extensão primeiro');
        return;
      }

      // Inicializar sheets manager
      sheetsManager = new GoogleSheetsManager(config.sheetUrl, config.sheetTab);

      // Carregar linhas pendentes
      pendingRows = await sheetsManager.readSheet();

      if (pendingRows.length === 0) {
        alert('Nenhum vídeo pendente encontrado na planilha');
        return;
      }

      const confirmMsg = `Iniciar automação para ${pendingRows.length} vídeo(s)?\n\nIsso pode levar vários minutos.`;
      if (!confirm(confirmMsg)) {
        return;
      }

      // Obter aba ativa
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Verificar se está no YouTube Studio
      if (!tab.url.includes('studio.youtube.com')) {
        alert('⚠️ Por favor, abra o YouTube Studio antes de iniciar a automação.');
        return;
      }

      // UI: Mostrar status
      startBtn.disabled = true;
      stopBtn.disabled = false;
      status.classList.remove('hidden');
      errorLog.classList.add('hidden');
      errorList.innerHTML = '';
      isProcessing = true;

      // Injetar content script com configuração
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['auth.js', 'sheets-integration.js', 'youtube-integration.js', 'content.js']
      });

      // Iniciar processamento
      chrome.tabs.sendMessage(tab.id, {
        action: 'startReplayLoop',
        config: {
          pendingRows: pendingRows,
          videosFolder: config.videosFolder,
          sheetUrl: config.sheetUrl,
          sheetTab: config.sheetTab
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Erro ao iniciar:', chrome.runtime.lastError);
          handleAutomationComplete(false, chrome.runtime.lastError.message);
        } else if (response?.success) {
          console.log('Automação iniciada com sucesso');
        }
      });

    } catch (error) {
      console.error('Erro ao iniciar automação:', error);
      alert(`Erro: ${error.message}`);
      handleAutomationComplete(false, error.message);
    }
  }

  function handleStopAutomation() {
    if (!confirm('Deseja realmente parar a automação?')) {
      return;
    }

    isProcessing = false;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopReplay' });
      }
    });

    handleAutomationComplete(false, 'Parado pelo usuário');
  }

  function handleAutomationComplete(success, message) {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    isProcessing = false;

    if (success) {
      statusText.textContent = '✅ Concluído!';
      alert(`✅ Automação concluída!\n\n${message}`);
    } else {
      statusText.textContent = `❌ ${message || 'Erro'}`;
    }

    setTimeout(() => {
      status.classList.add('hidden');
      updatePendingCount();
    }, 3000);
  }

  // ========== MESSAGE LISTENER ==========

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'replayProgress') {
      // Atualizar progresso
      const percent = (request.current / request.total) * 100;
      progressFill.style.width = percent + '%';
      progressText.textContent = `Processando vídeo ${request.current} de ${request.total}`;

      if (request.videoTitle) {
        currentVideoTitle.textContent = request.videoTitle;
      }

      if (request.status) {
        statusText.textContent = request.status;
      }

    } else if (request.action === 'replayComplete') {
      handleAutomationComplete(request.success, request.message);

    } else if (request.action === 'replayError') {
      // Adicionar erro ao log
      const li = document.createElement('li');
      li.textContent = `Linha ${request.rowNumber}: ${request.error}`;
      errorList.appendChild(li);
      errorLog.classList.remove('hidden');
    }

    return true;
  });
});
