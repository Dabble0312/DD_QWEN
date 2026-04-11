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
     * Export journal to CSV format
     * @returns {string} CSV content
     */
    exportToCSV() {
        const logs = this.getHistory();
        if (logs.length === 0) return '';

        const headers = ['Date', 'Ticker', 'Direction', 'Target', 'Actual Close', 'Delta', 'Correct?', 'Narrative'];
        const rows = logs.map(log => [
            new Date(log.timestamp).toLocaleString(),
            log.ticker,
            log.userGuess.direction,
            log.userGuess.target,
            log.actualData.close,
            log.accuracyDelta,
            log.isCorrectDirection ? 'Yes' : 'No',
            `"${log.narrative.replace(/"/g, '""')}"` // Escape quotes
        ]);

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    /**
     * Download CSV file
     */
    downloadCSV() {
        const csvContent = this.exportToCSV();
        if (!csvContent) {
            alert('No data to export');
            return;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `dojidash_journal_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Generate UUID for unique entry IDs
     * @returns {string} UUID v4
     */
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
}

// Export singleton instance
window.JournalService = new JournalService();
