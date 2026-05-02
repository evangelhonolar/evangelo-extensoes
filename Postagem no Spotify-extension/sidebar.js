// Sidebar control script

let sheetsManager = null;
let pendingRows = [];
let isProcessing = false;

document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const loginBtn = document.getElementById('loginBtn');
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
    saveConfigBtn.addEventListener('click', handleSaveConfig);
    startBtn.addEventListener('click', handleStartAutomation);
    stopBtn.addEventListener('click', handleStopAutomation);


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
        if (authManager.isAuthenticated()) {
            await showUserPanel();
        } else {
            showLoginPanel();
        }
    }

    async function handleLogin() {
        try {
            await authManager.authenticate();
            await showUserPanel();
            log('Login realizado com sucesso', 'success');
        } catch (error) {
            log('Erro no login: ' + error.message, 'error');
        }
    }

    async function showUserPanel() {
        try {
            const userInfo = await authManager.getUserInfo();
            document.getElementById('userName').textContent = userInfo.name;
            document.getElementById('userEmail').textContent = userInfo.email;
            document.getElementById('userPhoto').src = userInfo.picture;

            loginPanel.classList.add('hidden');
            userPanel.classList.remove('hidden');
            configSection.classList.remove('hidden');

            const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab']);
            if (config.sheetUrl) {
                controlSection.classList.remove('hidden');
                updatePendingCount();
            }
        } catch (e) {
            console.error(e);
        }
    }

    function showLoginPanel() {
        loginPanel.classList.remove('hidden');
        userPanel.classList.add('hidden');
    }

    // ================= CONFIG =================
    async function loadSavedConfig() {
        const config = await chrome.storage.sync.get(['sheetUrl', 'sheetTab', 'videosFolder']);
        if (config.sheetUrl) sheetUrlInput.value = config.sheetUrl;
        if (config.sheetTab) sheetTabInput.value = config.sheetTab;
        if (config.videosFolder) videosFolderInput.value = config.videosFolder;
    }

    async function handleSaveConfig() {
        const url = sheetUrlInput.value.trim();
        const tab = sheetTabInput.value.trim();
        const folder = videosFolderInput.value.trim();

        if (!url || !tab || !folder) {
            log('Preencha todos os campos!', 'warn');
            return;
        }

        try {
            sheetsManager = new GoogleSheetsManager(url, tab);
            await sheetsManager.validateSheet();

            await chrome.storage.sync.set({
                sheetUrl: url,
                sheetTab: tab,
                videosFolder: folder
            });

            controlSection.classList.remove('hidden');
            updatePendingCount();
            log('Configuração salva e validada!', 'success');
        } catch (error) {
            log('Erro na validação: ' + error.message, 'error');
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
            if (!config.sheetUrl) return alert('Configure primeiro');

            sheetsManager = new GoogleSheetsManager(config.sheetUrl, config.sheetTab);
            pendingRows = await sheetsManager.readSheet();

            if (pendingRows.length === 0) {
                return log('Nenhum vídeo pendente encontrado.', 'warn');
            }

            // Check URL
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.url.includes('creators.spotify.com')) {
                return log('Abra o site "creators.spotify.com" antes de iniciar.', 'error');
            }

            // UI Updates
            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusSection.classList.remove('hidden');
            isProcessing = true;
            log(`Iniciando automação para ${pendingRows.length} vídeos...`, 'info');

            // Inject Scripts
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['auth.js', 'sheets-integration.js', 'content.js']
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
            });

        } catch (error) {
            log('Erro ao iniciar: ' + error.message, 'error');
            startBtn.disabled = false;
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
