/**
 * JournalManager.js
 * Frontend-only logging system for Focus Mode.
 * Designed to be swapped with a Supabase backend later without changing consumer code.
 */

const JournalManager = (function() {
    // Internal State (In-Memory Store)
    let logs = [];
    const MAX_IN_MEMORY_LOGS = 50; // Prevent memory leaks during long sessions

    // Helper: Generate UUID
    const generateId = () => 'uuid-' + Math.random().toString(36).substr(2, 9);

    // Public API
    return {
        /**
         * Adds a new trade entry to the journal.
         * @param {Object} entry - The log object matching the required contract
         */
        addEntry: function(entry) {
            const logObject = {
                id: generateId(),
                timestamp: Date.now(),
                screenshot: entry.screenshot || null,
                narration: entry.narration || "No analysis generated.",
                userGuess: entry.userGuess || { trend: 'unknown', priceTarget: 0 },
                accuracy: typeof entry.accuracy === 'number' ? entry.accuracy : 0,
                metadata: entry.metadata || {}
            };

            logs.unshift(logObject); // Add to top

            // Enforce limit
            if (logs.length > MAX_IN_MEMORY_LOGS) {
                logs.pop();
            }

            console.log(`[Journal] Entry saved: ${logObject.id} | Accuracy: ${logObject.accuracy}%`);
            return logObject;
        },

        /**
         * Retrieves all logs.
         * @returns {Array} Array of log objects
         */
        getAll: function() {
            return [...logs]; // Return copy to prevent direct mutation
        },

        /**
         * Clears all logs (useful for testing or "New Session")
         */
        clear: function() {
            logs = [];
            console.log("[Journal] All logs cleared.");
        },

        /**
         * Utility to get stats for the current session
         */
        getSessionStats: function() {
            const total = logs.length;
            if (total === 0) return { total: 0, avgAccuracy: 0 };
            
            const sumAccuracy = logs.reduce((acc, curr) => acc + Math.abs(curr.accuracy), 0);
            
            return {
                total,
                avgAccuracy: (sumAccuracy / total).toFixed(2)
            };
        }
    };
})();

// Expose to window for access in other scripts
window.JournalManager = JournalManager;
