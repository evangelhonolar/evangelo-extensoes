// Google Sheets Integration with OAuth 2.0
class GoogleSheetsManager {
    constructor(spreadsheetUrl, sheetName) {
        this.spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);
        this.sheetName = sheetName;
        this.baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
        this.statusColumnLetter = 'F'; // Default, will be updated dynamically
    }

    /**
     * Extrai ID da planilha da URL
     */
    extractSpreadsheetId(url) {
        const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!match) {
            throw new Error('URL da planilha inválida');
        }
        return match[1];
    }

    /**
     * Lê todos os dados da planilha
     * @returns {Promise<Array>} Array de objetos com dados das linhas
     */
    async readSheet() {
        const token = await authManager.getToken();
        // Aumentado range para AZ para aceitar colunas extras do usuário
        const range = `${this.sheetName}!A1:Z1000`;
        const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                // Token expirado - tentar renovar
                console.log('Token expirado, renovando...');
                const newToken = await authManager.getToken(true);
                return this.readSheet(); // Retry com novo token
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Erro ao ler planilha: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            return this.parseSheetData(data.values);

        } catch (error) {
            console.error('Erro ao ler planilha:', error);
            throw error;
        }
    }

    /**
     * Converte dados brutos em objetos estruturados
     */
    parseSheetData(values) {
        if (!values || values.length === 0) {
            return [];
        }

        const headers = values[0].map(h => h.trim()); // Trim headers
        const rows = [];

        // Helper para achar índice ignorando case/espaços
        const findColIndex = (name) => {
            return headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
        };

        // Encontrar índices das colunas
        const colIndexes = {
            dataPostagem: findColIndex('Data Postagem'),
            tituloVideo: findColIndex('Título do Video'),
            descricaoVideo: findColIndex('Descrição do Vídeo'),
            nomeArquivo: findColIndex('Nome do Arquivo de Video'),
            situacao: findColIndex('Situação da Postagem')
        };

        // Fallback names (tentar variações comuns se não achar)
        if (colIndexes.tituloVideo === -1) colIndexes.tituloVideo = findColIndex('Titulo do Video');
        if (colIndexes.descricaoVideo === -1) colIndexes.descricaoVideo = findColIndex('Descricao do Video');
        if (colIndexes.situacao === -1) colIndexes.situacao = findColIndex('Situacao da Postagem');

        // Atualizar letra da coluna de status para uso futuro (escrita)
        if (colIndexes.situacao !== -1) {
            this.statusColumnLetter = this.columnIndexToLetter(colIndexes.situacao);
            console.log(`📍 Coluna de Status identificada: ${this.statusColumnLetter} (Índice ${colIndexes.situacao})`);
        }

        // Validar que todas as colunas existem
        for (const [key, index] of Object.entries(colIndexes)) {
            if (index === -1) {
                console.error(`Colunas encontradas: ${headers.join(', ')}`);
                throw new Error(`Coluna "${this.getColumnDisplayName(key)}" não encontrada na planilha. Verifique o nome exato.`);
            }
        }

        // Processar cada linha (pula o cabeçalho)
        for (let i = 1; i < values.length; i++) {
            const row = values[i];

            const rowData = {
                rowNumber: i + 1, // Linha real na planilha (1-indexed)
                dataPostagem: row[colIndexes.dataPostagem] || '',
                tituloVideo: row[colIndexes.tituloVideo] || '',
                descricaoVideo: row[colIndexes.descricaoVideo] || '',
                nomeArquivo: row[colIndexes.nomeArquivo] || '',
                situacao: row[colIndexes.situacao] || ''
            };

            // Apenas linhas com status vazio e com arquivo definido
            if (rowData.situacao === '' && rowData.nomeArquivo.trim()) {
                rows.push(rowData);
            }
        }

        return rows;
    }

    /**
     * Converte índice 0-based para letra da coluna (0->A, 1->B, 26->AA)
     */
    columnIndexToLetter(index) {
        let temp, letter = '';
        while (index >= 0) {
            temp = index % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            index = Math.floor(index / 26) - 1;
        }
        return letter;
    }

    /**
     * Atualiza o status de uma linha específica
     * @param {number} rowNumber - Número da linha (1-indexed)
     * @param {string} status - Novo status
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async updateStatus(rowNumber, status) {
        const token = await authManager.getToken();

        // Usar a letra da coluna descoberta dinamicamente
        const range = `${this.sheetName}!${this.statusColumnLetter}${rowNumber}`;
        const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`;

        const body = {
            values: [[status]]
        };

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.status === 401) {
                console.log('Token expirado, renovando...');
                await authManager.getToken(true);
                return this.updateStatus(rowNumber, status);
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Erro ao atualizar planilha: ${error.error?.message || response.statusText}`);
            }

            console.log(`✅ Linha ${rowNumber} atualizada: "${status}" na coluna ${this.statusColumnLetter}`);
            return true;

        } catch (error) {
            console.error(`❌ Erro ao atualizar linha ${rowNumber}:`, error);
            console.warn('⚠️ Vídeo foi postado mas a planilha pode não ter sido atualizada');
            return false;
        }
    }

    /**
     * Atualiza múltiplas células de uma vez (batch update)
     */
    async batchUpdate(updates) {
        const token = await authManager.getToken();
        const url = `${this.baseUrl}/${this.spreadsheetId}/values:batchUpdate`;

        const data = updates.map(update => ({
            range: `${this.sheetName}!${update.range}`,
            values: update.values
        }));

        const body = {
            valueInputOption: 'RAW',
            data: data
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Erro no batch update: ${error.error?.message || response.statusText}`);
            }

            console.log('✅ Batch update concluído');
            return true;

        } catch (error) {
            console.error('❌ Erro no batch update:', error);
            return false;
        }
    }

    /**
     * Helper: Nome amigável das colunas
     */
    getColumnDisplayName(key) {
        const names = {
            dataPostagem: 'Data Postagem',
            tituloVideo: 'Título do Video',
            descricaoVideo: 'Descrição do Vídeo',
            nomeArquivo: 'Nome do Arquivo de Video',
            situacao: 'Situação da Postagem'
        };
        return names[key] || key;
    }

    /**
     * Valida se a planilha está acessível e tem as colunas corretas
     */
    async validateSheet() {
        try {
            const token = await authManager.getToken();
            // FETCH MAIS COLUNAS (A1:Z1) para garantir pegar todas
            const range = `${this.sheetName}!A1:Z1`;
            const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}`;

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Aba "${this.sheetName}" não encontrada na planilha`);
                }
                throw new Error(`Erro ao acessar planilha: ${response.statusText}`);
            }

            const data = await response.json();
            const headers = (data.values?.[0] || []).map(h => h.trim());

            console.log('Validando colunas (RAW):', headers);

            const requiredColumns = [
                'Data Postagem',
                'Título do Video',
                'Descrição do Vídeo',
                'Nome do Arquivo de Video',
                'Situação da Postagem'
            ];

            const missingColumns = requiredColumns.filter(reqCol => {
                // Check case-insensitive and trimmed
                return !headers.some(h => h.toLowerCase() === reqCol.toLowerCase());
            });

            if (missingColumns.length > 0) {
                console.error(`Cabeçalhos recebidos: "${headers.join('", "')}"`);
                console.error(`Colunas faltando: ${missingColumns.join(', ')}`);
                throw new Error(`Colunas faltando: ${missingColumns.join(', ')}. Verifique se os nomes estão EXATOS.`);
            }

            // Identificar coluna de status durante a validação também
            const situacaoIndex = headers.findIndex(h => h.toLowerCase() === 'situação da postagem' || h.toLowerCase() === 'situacao da postagem');
            if (situacaoIndex !== -1) {
                this.statusColumnLetter = this.columnIndexToLetter(situacaoIndex);
                console.log(`✅ Coluna 'Situação da Postagem' encontrada na coluna ${this.statusColumnLetter}`);
            }

            console.log('✅ Planilha validada com sucesso');
            return true;

        } catch (error) {
            console.error('❌ Erro na validação da planilha:', error);
            throw error;
        }
    }
}
