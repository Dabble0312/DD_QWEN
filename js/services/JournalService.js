/**
 * JournalService - Trade Report & Performance Journal
 * Handles logging, screenshot capture, compression, and local storage
 */

class JournalService {
    constructor() {
        this.STORAGE_KEY = 'dojidash_journal_logs';
        this.MAX_ENTRIES = 50;
        this.THUMBNAIL_WIDTH = 400;
    }

    /**
     * Capture a trade entry with screenshot and analysis
     * @param {Object} chart - Lightweight Charts instance
     * @param {string} narrative - The narrator's analysis text
     * @param {Object} userGuess - { direction: 'UP'|'DOWN', target: number }
     * @param {Object} actualData - { close: number, timestamp: number }
     * @param {string} ticker - Current ticker symbol
     */
    async captureTradeEntry(chart, narrative, userGuess, actualData, ticker) {
        try {
            // 1. Capture screenshot
            const imageDataUrl = chart.takeScreenshot();
            
            // 2. Compress image to thumbnail size
            const compressedImage = await this.compressImage(imageDataUrl, this.THUMBNAIL_WIDTH);
            
            // 3. Calculate accuracy
            const accuracyDelta = Math.abs(userGuess.target - actualData.close);
            const isCorrectDirection = (userGuess.direction === 'UP' && actualData.close > actualData.open) || 
                                     (userGuess.direction === 'DOWN' && actualData.close < actualData.open);
            
            // 4. Create log entry
            const logEntry = {
                id: this.generateUUID(),
                timestamp: Date.now(),
                ticker: ticker || 'UNKNOWN',
                userGuess: {
                    direction: userGuess.direction,
                    target: userGuess.target
                },
                actualData: {
                    close: actualData.close,
                    open: actualData.open,
                    high: actualData.high,
                    low: actualData.low
                },
                accuracyDelta: parseFloat(accuracyDelta.toFixed(2)),
                isCorrectDirection,
                narrative: narrative,
                snapshotBase64: compressedImage
            };
            
            // 5. Save to storage
            this.saveEntry(logEntry);
            
            console.log('[JournalService] Trade entry captured:', logEntry.id);
            return logEntry;
            
        } catch (error) {
            console.error('[JournalService] Error capturing trade entry:', error);
            throw error;
        }
    }

    /**
     * Compress Base64 image to specified width while maintaining aspect ratio
     * @param {string} base64String - Original Base64 image
     * @param {number} maxWidth - Target width in pixels
     * @returns {Promise<string>} Compressed Base64 image
     */
    compressImage(base64String, maxWidth) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scaleSize = maxWidth / img.width;
                canvas.width = maxWidth;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Compress to JPEG with 0.7 quality for smaller file size
                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
            img.src = base64String;
        });
    }

    /**
     * Save entry to localStorage with rotation logic
     * @param {Object} entry - Log entry to save
     */
    saveEntry(entry) {
        try {
            const existingLogs = this.getHistory();
            existingLogs.unshift(entry); // Add to beginning
            
            // Limit to MAX_ENTRIES
            if (existingLogs.length > this.MAX_ENTRIES) {
                existingLogs.splice(this.MAX_ENTRIES);
            }
            
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(existingLogs));
        } catch (error) {
            console.error('[JournalService] Error saving entry (possibly storage full):', error);
            // If storage is full, try to clear old entries and retry
            if (error.name === 'QuotaExceededError') {
                this.clearOldEntries(10); // Remove oldest 10
                this.saveEntry(entry); // Retry
            }
        }
    }

    /**
     * Get trade history from localStorage
     * @param {number} limit - Optional limit on number of entries
     * @returns {Array} Array of log entries
     */
    getHistory(limit = null) {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (!stored) return [];
            
            const logs = JSON.parse(stored);
            return limit ? logs.slice(0, limit) : logs;
        } catch (error) {
            console.error('[JournalService] Error retrieving history:', error);
            return [];
        }
    }

    /**
     * Clear oldest entries to free up space
     * @param {number} count - Number of oldest entries to remove
     */
    clearOldEntries(count) {
        const logs = this.getHistory();
        if (logs.length > count) {
            logs.splice(logs.length - count, count);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs));
        }
    }

    /**
     * Export journal to PDF format using html2pdf
     */
    async exportPDF() {
        const logs = this.getHistory();
        if (logs.length === 0) {
            alert('No data to export');
            return;
        }

        // Create a temporary container for PDF generation
        const container = document.createElement('div');
        container.style.padding = '20px';
        container.style.fontFamily = 'Inter, sans-serif';
        container.style.background = '#09090b';
        container.style.color = '#e4e4e7';

        // Header
        const header = document.createElement('h1');
        header.textContent = 'DojiDash Trade Journal Report';
        header.style.fontSize = '24px';
        header.style.marginBottom = '10px';
        header.style.color = '#a855f7';
        container.appendChild(header);

        const dateRange = document.createElement('p');
        dateRange.textContent = `Generated: ${new Date().toLocaleString()}`;
        dateRange.style.fontSize = '12px';
        dateRange.style.color = '#71717a';
        dateRange.style.marginBottom = '20px';
        container.appendChild(dateRange);

        // Stats Summary
        const totalTrades = logs.length;
        const wins = logs.filter(l => l.isCorrectDirection).length;
        const winRate = ((wins / totalTrades) * 100).toFixed(1);
        const avgAccuracy = (logs.reduce((sum, l) => sum + (l.isCorrectDirection ? 1 : 0), 0) / totalTrades * 100).toFixed(1);

        const statsDiv = document.createElement('div');
        statsDiv.style.display = 'flex';
        statsDiv.style.gap = '20px';
        statsDiv.style.marginBottom = '30px';
        statsDiv.style.padding = '15px';
        statsDiv.style.background = '#18181b';
        statsDiv.style.borderRadius = '8px';
        statsDiv.innerHTML = `
            <div><strong>Total Trades:</strong> ${totalTrades}</div>
            <div><strong>Win Rate:</strong> ${winRate}%</div>
            <div><strong>Avg Accuracy:</strong> ${avgAccuracy}%</div>
        `;
        container.appendChild(statsDiv);

        // Trade Entries
        logs.forEach((log, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.style.marginBottom = '20px';
            entryDiv.style.padding = '15px';
            entryDiv.style.background = '#18181b';
            entryDiv.style.borderRadius = '8px';
            entryDiv.style.border = '1px solid #27272a';

            const entryHeader = document.createElement('div');
            entryHeader.style.display = 'flex';
            entryHeader.style.justifyContent = 'space-between';
            entryHeader.style.marginBottom = '10px';
            entryHeader.innerHTML = `
                <span style="font-weight: 600;">Trade #${index + 1} - ${log.ticker}</span>
                <span style="color: ${log.isCorrectDirection ? '#22c55e' : '#ef4444'};">${log.isCorrectDirection ? 'WIN' : 'LOSS'}</span>
            `;
            entryDiv.appendChild(entryHeader);

            const detailsGrid = document.createElement('div');
            detailsGrid.style.display = 'grid';
            detailsGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
            detailsGrid.style.gap = '10px';
            detailsGrid.style.fontSize = '13px';
            detailsGrid.style.marginBottom = '10px';
            detailsGrid.innerHTML = `
                <div><strong>Direction:</strong> ${log.userGuess.direction}</div>
                <div><strong>Target:</strong> $${log.userGuess.target.toFixed(2)}</div>
                <div><strong>Actual Close:</strong> $${log.actualData.close.toFixed(2)}</div>
                <div><strong>Delta:</strong> $${log.accuracyDelta.toFixed(2)}</div>
            `;
            entryDiv.appendChild(detailsGrid);

            if (log.snapshotBase64) {
                const img = document.createElement('img');
                img.src = log.snapshotBase64;
                img.style.width = '100%';
                img.style.maxWidth = '400px';
                img.style.borderRadius = '4px';
                img.style.marginTop = '10px';
                entryDiv.appendChild(img);
            }

            const narrative = document.createElement('p');
            narrative.style.fontSize = '12px';
            narrative.style.color = '#a1a1aa';
            narrative.style.marginTop = '10px';
            narrative.textContent = log.narrative;
            entryDiv.appendChild(narrative);

            container.appendChild(entryDiv);
        });

        document.body.appendChild(container);

        try {
            await html2pdf()
                .set({
                    margin: 10,
                    filename: `dojidash_journal_${new Date().toISOString().split('T')[0]}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                })
                .from(container)
                .save()
                .then(() => {
                    document.body.removeChild(container);
                });
        } catch (error) {
            console.error('[JournalService] PDF export error:', error);
            alert('Error generating PDF. Please try again.');
            document.body.removeChild(container);
        }
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Clear all journal data
     */
    clearAll() {
        localStorage.removeItem(this.STORAGE_KEY);
        console.log('[JournalService] All journal data cleared');
    }

    /**
     * Get recent trades for the mission report modal
     * @param {number} limit - Number of recent trades to return
     * @returns {Array} Array of trade entries with normalized properties
     */
    getRecentTrades(limit = 5) {
        const logs = this.getHistory(limit);
        return logs.map(log => ({
            id: log.id,
            timestamp: log.timestamp,
            ticker: log.ticker,
            direction: log.userGuess.direction,
            target: log.userGuess.target,
            actualClose: log.actualData.close,
            accuracyDelta: log.accuracyDelta,
            result: log.isCorrectDirection ? 'WIN' : 'LOSS',
            narrative: log.narrative,
            snapshot: log.snapshotBase64 || ''
        }));
    }

    /**
     * Get session statistics for the mission report
     * @returns {Object} Session stats including grade, winRate, totalTrades, avgAccuracy, recentTrades
     */
    getSessionStats() {
        const logs = this.getHistory(50); // Get last 50 trades for session analysis
        
        if (logs.length === 0) {
            return {
                grade: 'F',
                winRate: 0,
                totalTrades: 0,
                avgAccuracy: 0,
                recentTrades: []
            };
        }

        const wins = logs.filter(l => l.isCorrectDirection).length;
        const winRate = Math.round((wins / logs.length) * 100);
        
        // Calculate average accuracy (inverse of delta percentage)
        const avgAccuracy = Math.round(winRate); // Simplified: use win rate as accuracy proxy

        // Determine grade
        let grade = 'F';
        if (winRate >= 90) grade = 'A+';
        else if (winRate >= 80) grade = 'A';
        else if (winRate >= 70) grade = 'B';
        else if (winRate >= 60) grade = 'C';
        else if (winRate >= 50) grade = 'D';

        return {
            grade,
            winRate,
            totalTrades: logs.length,
            avgAccuracy,
            recentTrades: this.getRecentTrades(5)
        };
    }

    /**
     * Save entry with normalized parameters (wrapper for compatibility)
     * @param {Object} chart - Lightweight Charts instance
     * @param {Object} userGuess - { direction, target }
     * @param {string} narrative - Narrator text
     * @param {Object} actualData - { close, open, high, low }
     * @param {string} ticker - Ticker symbol
     */
    async saveEntry(chart, userGuess, narrative, actualData, ticker = 'UNKNOWN') {
        try {
            await this.captureTradeEntry(chart, narrative, userGuess, actualData, ticker);
        } catch (error) {
            console.error('[JournalService] saveEntry error:', error);
        }
    }
}

// Export singleton instance
window.JournalService = new JournalService();
