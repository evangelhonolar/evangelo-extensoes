// OAuth 2.0 Authentication Manager for Google APIs
class GoogleAuthManager {
    constructor() {
        this.accessToken = null;
        this.tokenExpiresAt = null;
    }

    /**
     * Inicia o fluxo OAuth 2.0 interativo
     * @returns {Promise<string>} Access token
     */
    async authenticate() {
        // Content Script doesn't have chrome.identity, proxy to background
        if (typeof chrome.identity === 'undefined') {
            return this.requestTokenFromBackground();
        }

        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    console.error('Erro na autenticação:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (!token) {
                    reject(new Error('Token não obtido'));
                    return;
                }

                this.accessToken = token;
                // Tokens do Google geralmente expiram em 1 hora
                this.tokenExpiresAt = Date.now() + (60 * 60 * 1000);

                console.log('✅ Autenticação bem-sucedida');
                resolve(token);
            });
        });
    }

    /**
     * Proxies token request to background script
     */
    async requestTokenFromBackground() {
        return new Promise((resolve, reject) => {
            console.log('📡 Solicitando token ao background...');
            chrome.runtime.sendMessage({ action: 'getAuthToken', interactive: true }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else if (!response || !response.success) {
                    console.error('Falha na resposta do background:', response);
                    reject(new Error(response?.error || 'Falha ao obter token do background'));
                } else {
                    this.accessToken = response.token;
                    this.tokenExpiresAt = Date.now() + (60 * 60 * 1000);
                    resolve(response.token);
                }
            });
        });
    }

    /**
     * Obtém o token atual ou autentica se necessário
     * @param {boolean} forceRefresh - Forçar renovação do token
     * @returns {Promise<string>} Access token válido
     */
    async getToken(forceRefresh = false) {
        // Token ainda válido e não forçando refresh
        if (!forceRefresh && this.accessToken && this.tokenExpiresAt > Date.now()) {
            return this.accessToken;
        }

        // Token expirado ou não existe - obter novo
        console.log('🔄 Renovando token...');

        // Remover token antigo do cache
        if (this.accessToken) {
            await this.revokeToken(this.accessToken);
        }

        return await this.authenticate();
    }

    /**
     * Revoga o token atual
     * @param {string} token - Token a ser revogado
     */
    async revokeToken(token) {
        return new Promise((resolve) => {
            chrome.identity.removeCachedAuthToken({ token }, () => {
                console.log('🗑️ Token removido do cache');
                this.accessToken = null;
                this.tokenExpiresAt = null;
                resolve();
            });
        });
    }

    /**
     * Faz logout completo (revoga token e limpa cache)
     */
    async logout() {
        if (!this.accessToken) {
            console.log('Nenhum token para revogar');
            return;
        }

        try {
            // Revogar token no servidor do Google
            await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${this.accessToken}`);

            // Remover do cache local
            await this.revokeToken(this.accessToken);

            console.log('✅ Logout completo');
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            // Mesmo com erro, limpar localmente
            this.accessToken = null;
            this.tokenExpiresAt = null;
        }
    }

    /**
     * Verifica se o usuário está autenticado
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.accessToken !== null && this.tokenExpiresAt > Date.now();
    }

    /**
     * Obtém informações do usuário autenticado
     * @returns {Promise<object>} Dados do usuário
     */
    async getUserInfo() {
        const token = await this.getToken();

        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao obter informações do usuário');
        }

        return await response.json();
    }
}

// Exportar instância singleton
const authManager = new GoogleAuthManager();
