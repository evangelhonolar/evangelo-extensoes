// YouTube API Integration
class YouTubeManager {
    constructor() {
        this.baseUrl = 'https://www.googleapis.com/youtube/v3';
    }

    /**
     * Verifica se um vídeo já está agendado ou publicado com o mesmo título e data
     * @param {string} title - Título do vídeo
     * @param {string} dateStr - Data de postagem (formato da planilha: DD/MM/YYYY)
     * @returns {Promise<boolean>} True se já existe video agendado/publicado para essa data
     */
    async checkVideoScheduled(title, dateStr) {
        try {
            console.log(`🔍 Verificando agendamento no YouTube para: "${title}" em ${dateStr}`);

            // 1. Buscar vídeos com título similar
            const videos = await this.searchVideos(title);

            if (videos.length === 0) {
                console.log('   Nenhum vídeo encontrado com este título.');
                return false;
            }

            console.log(`   Encontrados ${videos.length} vídeos potenciais. Verificando detalhes...`);

            // 2. Verificar data de publicação/agendamento de cada vídeo
            for (const video of videos) {
                const details = await this.getVideoDetails(video.id.videoId);

                if (!details) continue;

                // Data alvo (da planilha)
                const targetDate = this.parseDate(dateStr);

                // Data do vídeo (publicado ou agendado)
                // Se status.uploadStatus === 'processed' e privacyStatus === 'private' com publishAt, é agendado
                // Se privacyStatus === 'public', usar publishedAt

                let videoDate = null;
                const status = details.status;

                if (status.publishAt) {
                    videoDate = new Date(status.publishAt);
                    console.log(`   - Vídeo "${details.snippet.title}" está AGENDADO para ${videoDate.toLocaleDateString()}`);
                } else {
                    videoDate = new Date(details.snippet.publishedAt);
                    console.log(`   - Vídeo "${details.snippet.title}" foi PUBLICADO em ${videoDate.toLocaleDateString()}`);
                }

                // Comparar datas (ignorando hora)
                if (this.isSameDate(targetDate, videoDate)) {
                    console.log(`   ✅ ENCONTRADO! Vídeo já existe para esta data.`);
                    return true;
                }
            }

            console.log('   Nenhum conflito de data encontrado.');
            return false;

        } catch (error) {
            console.error('❌ Erro ao verificar YouTube:', error);
            // Em caso de erro (ex: cota excedida), melhor não bloquear o upload ou perguntar?
            // Por segurança, assumimos false para tentar criar, ou true para não duplicar?
            // Vamos assumir false mas logar o erro visivelmente.
            return false;
        }
    }

    /**
     * Busca vídeos pelo título (search.list)
     */
    async searchVideos(query) {
        const token = await authManager.getToken();
        const params = new URLSearchParams({
            part: 'snippet',
            q: query,
            type: 'video',
            forMine: 'true',
            maxResults: '5'
        });

        const url = `${this.baseUrl}/search?${params.toString()}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Erro na busca do YouTube: ${error.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.items || [];
    }

    /**
     * Obtém detalhes compeltos do vídeo (videos.list) para ver status de agendamento
     */
    async getVideoDetails(videoId) {
        const token = await authManager.getToken();
        const params = new URLSearchParams({
            part: 'snippet,status',
            id: videoId
        });

        const url = `${this.baseUrl}/videos?${params.toString()}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.items?.[0] || null;
    }

    /**
     * Helper: Parse data DD/MM/YYYY para Date object
     */
    parseDate(dateStr) {
        if (!dateStr) return new Date(); // fallback

        // Remove time part if exists (e.g. "16/02/2026 20:00")
        const dateOnly = dateStr.trim().split(' ')[0];

        const [day, month, year] = dateOnly.split('/');

        // Month is 0-indexed in JS Date
        return new Date(year, month - 1, day);
    }

    /**
     * Helper: Compara se duas datas são o mesmo dia/mês/ano
     */
    isSameDate(d1, d2) {
        return d1.getDate() === d2.getDate() &&
            d1.getMonth() === d2.getMonth() &&
            d1.getFullYear() === d2.getFullYear();
    }
}

// Export instance
const youTubeManager = new YouTubeManager();
