// Sidebar control script for YouTube extension

let sheetsManager = null;
let pendingRows = [];
let isProcessing = false;

document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userPanel = document.getElementById('userPanel');
    const loginPanel = document.getElementById('loginPanel');
    const configSection = document.getElementById('configSection');
    const controlSection = document.getElementById('controlSection');
    const statusSection = document.getElementById('statusSection');

    // Inputs
    const sheetUrlInput = document.getElementById('sheetUrl');
    const sheetTabInput = document.getElementById('sheetTab');
    const videosFolderInput = document.getElementById('videosFolder');

    // Buttons
    const validateConfigBtn = document.getElementById('validateConfigBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const startBtn = document.getElementById('startReplay');
    const stopBtn = document.getElementById('stopReplay');

    // Display
    const pendingCount = document.getElementById('pendingCount');
    const logsArea = document.getElementById('logs-area');
    const progressFill = document.getElementById('progressFill');
    const videoTitle = document.getElementById('videoTitle');
    const statusText = document.getElementById('statusText');

    // Auth & Init
    await checkAuthStatus();
    loadSavedConfig();

    // Event Listeners
    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    validateConfigBtn.addEventListener('click', handleValidateConfig);
    saveConfigBtn.addEventListener('click', handleSaveConfig);
    startBtn.addEventListener('click', handleStartAutomation);
    stopBtn.addEventListener('click', handleStopAutomation);

    // Auto-save drafts so data isn't lost if sidebar closes
    sheetUrlInput.addEventListener('input', () => chrome.storage.local.set({ draft_sheetUrl: sheetUrlInput.value }));
    sheetTabInput.addEventListener('input', () => chrome.storage.local.set({ draft_sheetTab: sheetTabInput.value }));
    if (videosFolderInput) {
        videosFolderInput.addEventListener('input', () => chrome.storage.local.set({ draft_videosFolder: videosFolderInput.value }));
    }

    // ================= HELPER: LOGGING =================
    function log(message, type = 'info') {
        const div = document.createElement('div');
        div.className = 'log-entry';

        const time = new Date().toLocaleTimeString();

        let typeClass = 'log-info';
        if (type === 'success') typeClass = 'log-success';
        if (type === 'warn') typeClass = 'log-warn';
        if (type === 'error') typeClass = 'log-error';

        div.innerHTML = `<span class="log-time">[${time}]</span> <span class="${typeClass}">${message}</span>`;
        logsArea.appendChild(div);
        logsArea.scrollTop = logsArea.scrollHeight;
    }

    // ================= AUTH =================
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
            log('Login realizado com sucesso', 'success');
        } catch (error) {
            log('Erro no login: ' + error.message, 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login com Google';
        }
    }

    async function handleLogout() {
        try {
            await authManager.logout();
            showLoginPanel();
            log('Logout realizado', 'warn');
        } catch (error) {
            log('Erro no logout: ' + error.message, 'error');
        }
    }

    async function showUserPanel() {
        try {
            const userInfo = await authManager.getUserInfo();
            document.getElementById('userName').textContent = userInfo.name || 'Usuário';
            document.getElementById('userEmail').textContent = userInfo.email || '';
            document.getElementById('userPhoto').src = userInfo.picture || '';

            loginPanel.classList.add('hidden');
            userPanel.classList.remove('hidden');
            configSection.classList.remove('hidden');

            const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab']);
            if (config.sheetUrl && config.sheetTab) {
                controlSection.classList.remove('hidden');
                updatePendingCount();
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

    // ================= CONFIG =================
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

    function validateInputs() {
        if (!sheetUrlInput.value.trim()) {
            log('Preencha a URL da planilha!', 'warn');
            sheetUrlInput.focus();
            return false;
        }
        if (!sheetTabInput.value.trim()) {
            log('Preencha o nome da aba!', 'warn');
            sheetTabInput.focus();
            return false;
        }
        if (!videosFolderInput.value.trim()) {
            log('Preencha o caminho da pasta de vídeos!', 'warn');
            videosFolderInput.focus();
            return false;
        }
        return true;
    }

    async function handleValidateConfig() {
        if (!validateInputs()) return;

        try {
            validateConfigBtn.disabled = true;
            validateConfigBtn.textContent = '🔍 Validando...';
            log('Validando configuração...', 'info');

            sheetsManager = new GoogleSheetsManager(
                sheetUrlInput.value.trim(),
                sheetTabInput.value.trim()
            );

            await sheetsManager.validateSheet();
            log('Configuração válida! Planilha encontrada com estrutura correta.', 'success');

        } catch (error) {
            log('Erro na validação: ' + error.message, 'error');
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
            log('Salvando configuração...', 'info');

            // Validar antes de salvar
            sheetsManager = new GoogleSheetsManager(
                sheetUrlInput.value.trim(),
                sheetTabInput.value.trim()
            );

            await sheetsManager.validateSheet();

            await chrome.storage.sync.set({
                sheetUrl: sheetUrlInput.value.trim(),
                sheetTab: sheetTabInput.value.trim(),
                videosFolder: videosFolderInput.value.trim()
            });

            // Limpar rascunhos após salvar com sucesso
            await chrome.storage.local.remove(['draft_sheetUrl', 'draft_sheetTab', 'draft_videosFolder']);

            controlSection.classList.remove('hidden');
            updatePendingCount();
            log('Configuração salva e validada!', 'success');

        } catch (error) {
            log('Erro ao salvar: ' + error.message, 'error');
        } finally {
            saveConfigBtn.disabled = false;
            saveConfigBtn.textContent = '💾 Salvar';
        }
    }

    async function updatePendingCount() {
        try {
            if (!sheetsManager) {
                const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab']);
                sheetsManager = new GoogleSheetsManager(config.sheetUrl, config.sheetTab);
            }
            pendingRows = await sheetsManager.readSheet();
            pendingCount.textContent = pendingRows.length;
        } catch (e) {
            pendingCount.textContent = '?';
        }
    }

    // ================= AUTOMATION =================
    async function handleStartAutomation() {
        try {
            const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab', 'videosFolder']);

            if (!config.sheetUrl || !config.sheetTab || !config.videosFolder) {
                log('Configure a extensão primeiro!', 'warn');
                return;
            }

            sheetsManager = new GoogleSheetsManager(config.sheetUrl, config.sheetTab);
            pendingRows = await sheetsManager.readSheet();

            if (pendingRows.length === 0) {
                log('Nenhum vídeo pendente encontrado na planilha.', 'warn');
                return;
            }

            // Check URL
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.url.includes('studio.youtube.com')) {
                log('Abra o YouTube Studio antes de iniciar a automação.', 'error');
                return;
            }

            // UI Updates
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusSection.classList.remove('hidden');
            isProcessing = true;
            log(`Iniciando automação para ${pendingRows.length} vídeo(s)...`, 'info');

            // Inject Scripts
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['auth.js', 'sheets-integration.js', 'youtube-integration.js', 'content.js']
            });

            // Start Message
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
                    log('Erro ao iniciar: ' + chrome.runtime.lastError.message, 'error');
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                } else if (response?.success) {
                    log('Automação iniciada com sucesso', 'success');
                }
            });

        } catch (error) {
            log('Erro ao iniciar: ' + error.message, 'error');
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    function handleStopAutomation() {
        isProcessing = false;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'stopReplay' });
        });
        log('Solicitado parada...', 'warn');
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }

    // ================= MESSAGE LISTENER =================
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'replayProgress') {
            const percent = (request.current / request.total) * 100;
            progressFill.style.width = percent + '%';

            if (request.videoTitle) videoTitle.textContent = request.videoTitle;
            if (request.status) statusText.textContent = request.status;

            // Log start of new video with details
            if (request.status === 'Processando...') {
                log(`🎥 Iniciando: ${request.videoTitle}`, 'info');
                if (request.fileName) log(`📁 Arquivo: ${request.fileName}`, 'info');
            } else if (request.status) {
                log(`[${request.current}/${request.total}] ${request.status}`);
            }

        } else if (request.action === 'replayComplete') {
            isProcessing = false;
            startBtn.disabled = false;
            stopBtn.disabled = true;

            if (request.success) {
                log('✅ ' + (request.message || 'Ciclo Completo'), 'success');
            } else {
                log('❌ ' + (request.message || 'Erro'), 'error');
            }
            updatePendingCount();

        } else if (request.action === 'replayError') {
            log(`❌ Erro na linha ${request.rowNumber}: ${request.error}`, 'error');
        }
        return true;
    });

});
