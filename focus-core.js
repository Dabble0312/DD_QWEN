// focus-core.js — Focus Mode core: state, data loading, game logic, chart setup, boot.
// This is the orchestrator — all other focus-*.js files provide helper functions
// that this file calls. Load this file LAST in focus.html.
//
// Load order in focus.html:
//   shared/chart.js → shared/ui.js → focus-summary.js → focus-patterns.js → focus-ui.js → focus-core.js

// =========================
// CONFIGURATION
// =========================
const MAX_REVEALS_PER_BURST = 7;
const MAX_WRONG             = 5;
const REVEAL_SPEED_MS       = 600;

function getRevealCount() {
    const el  = document.getElementById('revealCount');
    if (!el) return 4;
    const val = parseInt(el.value);
    if (isNaN(val) || val < 1) return 1;
    if (val > MAX_REVEALS_PER_BURST) return MAX_REVEALS_PER_BURST;
    return val;
}

// =========================
// STATE
// =========================
let allCandles    = [];
let futureCandles = [];
let revealIndex   = 0;
let revealedSoFar = [];

let correctCount  = 0;
let wrongCount    = 0;
let guessCount    = 0;

let awaitingGuess    = false;
let autoRevealActive = false;
let sessionActive    = false;

let pendingPrediction = null;

let chart;
let candlestickSeries;
let volumeSeries;

let detectedPatterns = [];

let username = localStorage.getItem("username") || "Player";

// =========================
// JOURNAL STATE
// =========================
let currentUserGuess = null;
let currentPriceTarget = null;
let lastNarrativeText = ""; // Store the last generated narrative

/* -----------------------------------------
   1. LOAD BLOCK FROM SUPABASE
----------------------------------------- */
async function loadFocusBlock() {
    showChartLoading();      // focus-ui.js
    showStatus("Loading chart...");

    try {
        const { data, error } = await supabaseClient
            .from('focus_blocks')
            .select('id, block_id, candles, future, window_start, detected_patterns')
            .order('id')
            .limit(500);

        if (error) throw error;

        if (!data || data.length === 0) {
            showStatus("No blocks available.");
            return;
        }

        const block = data[Math.floor(Math.random() * data.length)];

        if (!block.candles || !block.future) {
            console.error('Block missing candles or future:', block);
            return;
        }

        allCandles       = block.candles;
        futureCandles    = block.future;
        detectedPatterns = block.detected_patterns || [];
        revealIndex      = 0;
        revealedSoFar    = [];

        initChart();
        resetSession();
        updateStatsPanel();     // focus-ui.js
        showCandleInfo(null);   // focus-ui.js
        showPriceFeedback("");  // focus-ui.js
        showStatus("");
        
        // Ensure these helpers exist before calling
        if (typeof clearPatternHighlights === 'function') clearPatternHighlights();
        if (typeof hidePatternPanels === 'function') hidePatternPanels();
        if (typeof clearDynamicZones === 'function') clearDynamicZones();

    } catch (err) {
        console.error("Supabase Error:", err.message);
        showStatus("Failed to load block.");
    }
}

/* -----------------------------------------
   2. CHART SETUP
   Uses shared constants from shared/chart.js.
----------------------------------------- */
function initChart() {
    const chartDiv = document.getElementById('chart');
    if (chart) chart.remove();
    chartDiv.innerHTML = '';

    chart = window.LightweightCharts.createChart(chartDiv, {
        height: 501,
        layout: {
            textColor:       '#000',
            backgroundColor: '#fff',
        },
        timeScale: {
            timeVisible:    true,
            secondsVisible: false,
            rightOffset:    4,
        },
        rightPriceScale: {
            scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        crosshair: {
            mode: 0,   // 0 = Normal (free crosshair, not snapping)
        },
    });

    candlestickSeries = chart.addCandlestickSeries(CANDLESTICK_SERIES_OPTIONS);
    volumeSeries      = chart.addHistogramSeries(VOLUME_SERIES_OPTIONS);
    
    // Check if volume price scale options exist
    if (typeof VOLUME_PRICE_SCALE_OPTIONS !== 'undefined') {
        chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);
    }

    renderChart();

    // Focus mode lets the y-axis autoscale to visible candles only
    candlestickSeries.applyOptions({ autoscaleInfoProvider: undefined });

    chart.timeScale().fitContent();
    
    if (typeof updateDynamicZones === 'function') updateDynamicZones();

    // ── Candle click → update stats + info panel
    chart.subscribeClick((param) => {
        if (!param || !param.time) return;
        const clickedDate = param.time;
        const allVisible  = [...allCandles, ...revealedSoFar];
        const matched     = allVisible.find(c => c.date.slice(0, 10) === clickedDate);
        if (!matched) return;

        if (typeof updateStatsPanel === 'function') updateStatsPanel(matched);
        if (typeof showCandleInfo === 'function') showCandleInfo(matched);
        if (typeof refreshSummaryIfOpen === 'function') refreshSummaryIfOpen(matched);
    });

    // ── Redraw zone overlays on viewport change
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        requestAnimationFrame(() => {
            if (typeof drawZoneOverlays === 'function') drawZoneOverlays();
        });
    });
    chart.subscribeCrosshairMove(() => {
        requestAnimationFrame(() => {
            if (typeof drawZoneOverlays === 'function') drawZoneOverlays();
        });
    });

    if (typeof setupZoneCanvas === 'function') setupZoneCanvas(chartDiv);
}

/* -----------------------------------------
   3. RENDER CHART
----------------------------------------- */
function renderChart() {
    const all        = [...allCandles, ...revealedSoFar];
    if (typeof toCandlePoint === 'function') {
        candlestickSeries.setData(all.map(toCandlePoint));
    }
    if (typeof toVolumePoint === 'function') {
        volumeSeries.setData(all.map(toVolumePoint));
    }
}

/* -----------------------------------------
   4. SESSION STATE
----------------------------------------- */
function resetSession() {
    correctCount     = 0;
    wrongCount       = 0;
    guessCount       = 0;
    awaitingGuess    = false;
    autoRevealActive = false;
    sessionActive    = true;

    pendingPrediction = null;
    currentUserGuess = null;
    currentPriceTarget = null;
    lastNarrativeText = "";

    if (typeof updateHUD === 'function') updateHUD();
    if (typeof setButtonState === 'function') setButtonState("reveal");
}

/* -----------------------------------------
   5. REVEAL LOGIC
----------------------------------------- */
function startAutoReveal() {
    if (!sessionActive || autoRevealActive || awaitingGuess) return;
    if (revealIndex >= futureCandles.length) {
        endSession("complete");
        return;
    }

    autoRevealActive = true;
    if (typeof setButtonState === 'function') setButtonState("revealing");

    let count = 0;
    const maxThisBurst = getRevealCount();

    function revealNext() {
        if (count >= maxThisBurst || revealIndex >= futureCandles.length) {
            autoRevealActive = false;
            awaitingGuess    = true;
            if (typeof setButtonState === 'function') setButtonState("guess");
            showStatus("What happens next?");

            // Capture journal entry BEFORE narrator speaks so we have the snapshot of the reveal
            captureTradeEntry();

            // Trigger narrator
            if (typeof runNarratorEngine === 'function') {
                runNarratorEngine();
            }

            return;
        }

        const candle    = futureCandles[revealIndex];
        const thisIndex = revealIndex;
        revealedSoFar.push(candle);
        revealIndex++;
        count++;

        renderChart();
       
        if (typeof updateStatsPanel === 'function') updateStatsPanel();
        if (typeof updateDynamicZones === 'function') updateDynamicZones();

        if (pendingPrediction && pendingPrediction.candleIndex === thisIndex) {
            scorePendingPrediction();
        }

        setTimeout(revealNext, REVEAL_SPEED_MS);
    }

    revealNext();
}

/* -----------------------------------------
   6. GUESS LOGIC
----------------------------------------- */
function handleGuess(guess) {
    if (!sessionActive || !awaitingGuess) return;
    awaitingGuess = false;

    if (!futureCandles[revealIndex]) {
        endSession("complete");
        return;
    }

    const priceInput  = document.getElementById('priceTarget');
    const targetValue = priceInput ? parseFloat(priceInput.value) : NaN;
    if (priceInput) priceInput.value = '';

    // Store current guess for journal
    currentUserGuess = guess;
    currentPriceTarget = targetValue;

    const burstEndIndex = Math.min(
        revealIndex + getRevealCount() - 1,
        futureCandles.length - 1
    );
    const baselineClose = revealedSoFar.length > 0
        ? revealedSoFar[revealedSoFar.length - 1].close
        : allCandles[allCandles.length - 1].close;

    pendingPrediction = {
        guess,
        targetPrice:  targetValue,
        candleIndex:  burstEndIndex,
        baseClose:    baselineClose,
        direction:    guess.toUpperCase() // Ensure direction is stored
    };

    showStatus("Reveal to see if you were right!");
    if (typeof setButtonState === 'function') setButtonState("reveal");
}

/* -----------------------------------------
   6b. SCORE PENDING PREDICTION
----------------------------------------- */
function scorePendingPrediction() {
    if (!pendingPrediction) return;

    const { guess, targetPrice, candleIndex, baseClose } = pendingPrediction;
    // Do not nullify pendingPrediction yet, we need it for the journal capture in revealNext
    
    guessCount++;

    const predictedCandle = futureCandles[candleIndex];
    const priceWentUp     = predictedCandle.close > baseClose;
    const correct         = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    if (correct) {
        correctCount++;
        if (typeof showPopup === 'function') showPopup("correct");
        if (typeof showWSBPopup === 'function') showWSBPopup(true);
    } else {
        wrongCount++;
        if (typeof showPopup === 'function') showPopup("wrong");
        if (typeof showWSBPopup === 'function') showWSBPopup(false);
    }

    // ── Price target feedback
    const hasTarget = !isNaN(targetPrice) && targetPrice > 0;
    if (hasTarget) {
        const actual  = predictedCandle.close;
        const diff    = actual - targetPrice;
        const diffPct = ((Math.abs(diff) / actual) * 100).toFixed(1);
        let msg;
        if (Math.abs(diff) / actual < 0.005)
            msg = `🎯 Spot on! Target ₹${targetPrice.toFixed(2)} vs actual ₹${actual.toFixed(2)}`;
        else if (diff > 0)
            msg = `📈 Actual was ${diffPct}% higher than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        else
            msg = `📉 Actual was ${diffPct}% lower than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        
        if (typeof showPriceFeedback === 'function') showPriceFeedback(msg);
    }

    if (typeof updateHUD === 'function') updateHUD();

    // Note: Journal capture happens in revealNext() after the candle is visually rendered
}

/* -----------------------------------------
   6c. CAPTURE TRADE ENTRY FOR JOURNAL
----------------------------------------- */
function captureTradeEntry() {
    // Only capture if we have a pending prediction and the chart is ready
    if (!pendingPrediction || !chart || !window.JournalService) return;

    const { candleIndex, baseClose, guess, targetPrice } = pendingPrediction;
    
    // Safety check: ensure index exists
    if (!futureCandles[candleIndex]) return;

    const predictedCandle = futureCandles[candleIndex];
    const priceWentUp     = predictedCandle.close > baseClose;
    const isCorrect       = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    // Get the actual data for the burst end candle
    const actualData = {
        close: predictedCandle.close,
        open: predictedCandle.open,
        high: predictedCandle.high,
        low: predictedCandle.low
    };

    // Use the narrative text that was just generated/spoken
    // If the narrator hasn't finished, we might grab the latest partial, 
    // but ideally this is called right after the narrator starts or finishes.
    // For now, we grab the global lastNarrativeText which the narrator updates.
    const narrativeText = lastNarrativeText || "Analysis generated for this move.";

    // Determine result string
    const resultString = isCorrect ? "WIN" : "LOSS";

    // Capture with JournalService
    window.JournalService.captureTradeEntry(
        chart,
        narrativeText,
        { direction: guess ? guess.toUpperCase() : 'UNKNOWN', target: targetPrice || 0 },
        actualData,
        resultString
    ).catch(err => {
        console.error('[focus-core] Failed to capture trade entry:', err);
    });

    // Reset guess storage for next round ONLY AFTER capturing
    // We keep pendingPrediction alive until the next guess starts
    // But we clear the specific guess data used for this log
    // currentUserGuess = null; 
    // currentPriceTarget = null;
}

/* -----------------------------------------
   7. END SESSION
----------------------------------------- */
async function endSession(reason) {
    sessionActive    = false;
    autoRevealActive = false;
    awaitingGuess    = false;
    
    if (typeof setButtonState === 'function') setButtonState("revealing");

    // Reveal all remaining candles at once
    revealedSoFar = [...futureCandles];
    renderChart();

    const accuracy = guessCount > 0
        ? Math.round((correctCount / guessCount) * 100)
        : 0;

    const title = reason === "focus_lost" ? "Focus Lost — Reset Needed" : "Session Complete";

    // 2. Disable Controls
    const controls = document.querySelector('.control-group');
    if (controls) controls.style.pointerEvents = 'none';
    
    const inputs = document.querySelectorAll('input, button');
    inputs.forEach(el => {
        // Don't disable the journal button or home button if they exist outside control-group
        if (!el.closest('#mission-report-modal')) {
             el.disabled = true;
        }
    });

    // 3. Show Mission Report Modal instead of basic end screen
    setTimeout(() => {
        showMissionReportModal(accuracy, reason);
    }, 800);
}

function showMissionReportModal(accuracy, reason) {
    const modal = document.getElementById('mission-report-modal');
    if (!modal) {
        console.warn("⚠️ Mission report modal not found in DOM");
        // Fallback alert if modal is missing
        alert(`Session Ended! Accuracy: ${accuracy}%\nRefresh to play again.`);
        return;
    }

    // Calculate Grade
    let grade = 'F';
    if (accuracy >= 90) grade = 'A+';
    else if (accuracy >= 80) grade = 'A';
    else if (accuracy >= 70) grade = 'B';
    else if (accuracy >= 60) grade = 'C';
    else if (accuracy >= 50) grade = 'D';

    // Populate Stats
    const gradeEl = document.getElementById('report-grade');
    const scoreEl = document.getElementById('report-score');
    const totalEl = document.getElementById('report-total-trades');
    const accEl = document.getElementById('report-accuracy');

    if (gradeEl) gradeEl.textContent = grade;
    if (scoreEl) scoreEl.textContent = `${accuracy}% Accuracy`;
    if (totalEl) totalEl.textContent = guessCount;
    if (accEl) accEl.textContent = `${correctCount}/${guessCount} Correct`;
    
    // Render Trade List from Journal
    const listContainer = document.getElementById('report-trade-list');
    if (listContainer) {
        listContainer.innerHTML = '';
        
        const recentTrades = typeof JournalService !== 'undefined' 
            ? JournalService.getRecentTrades(5) 
            : [];
        
        if (recentTrades.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No trades recorded this session</div>';
        } else {
            recentTrades.forEach(trade => {
                const item = document.createElement('div');
                item.className = 'trade-log-item';
                const resultClass = trade.result === 'WIN' ? 'badge-success' : 'badge-danger';
                item.innerHTML = `
                    <div class="trade-snapshot">
                        <img src="${trade.snapshot || ''}" alt="Chart" onerror="this.style.display='none'" />
                    </div>
                    <div class="trade-details">
                        <div class="trade-header">
                            <span class="badge ${resultClass}">${trade.result}</span>
                            <span class="trade-dir">${trade.direction}</span>
                        </div>
                        <div class="trade-narrative">${trade.narrative ? trade.narrative.substring(0, 60) + '...' : 'No analysis'}</div>
                    </div>
                `;
                listContainer.appendChild(item);
            });
        }
    }

    // Show Modal
    modal.classList.add('active');
    console.log("📊 Mission Report Modal Displayed");
}

// Expose global functions for HTML buttons
window.downloadPDFReport = () => {
    if (typeof JournalService !== 'undefined') {
        JournalService.exportPDF();
    } else {
        alert("Journal service not loaded");
    }
};

window.closeMissionReport = () => {
    const modal = document.getElementById('mission-report-modal');
    if (modal) modal.classList.remove('active');
    window.location.href = 'index.html';
};

// Fallback navigation if buttons exist
const homeBtn = document.getElementById('homeBtn');
if (homeBtn) {
    homeBtn.onclick = () => {
        window.location.href = 'index.html';
    };
}

/* -----------------------------------------
   8. KEYBOARD SHORTCUTS
----------------------------------------- */
window.addEventListener('keydown', (e) => {
    if (!sessionActive || awaitingGuess === false && autoRevealActive === false) return;
    
    if (e.key === 'ArrowUp')   { e.preventDefault(); handleGuess('up');   }
    if (e.key === 'ArrowDown') { e.preventDefault(); handleGuess('down'); }
});

/* -----------------------------------------
   9. BOOT
----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
    const display = document.getElementById('usernameDisplay');
    if (display) display.textContent = 'Player: ' + username;

    // ── Bind button listeners
    const el = id => document.getElementById(id);
    
    // Safe binding: only bind if element exists
    if (el('narratorBtn')) el('narratorBtn').addEventListener('click', () => {
        if (typeof toggleNarrator === 'function') toggleNarrator();
    });
    
    if (el('revealBtn')) el('revealBtn').addEventListener('click', startAutoReveal);
    
    if (el('upBtn')) el('upBtn').addEventListener('click', () => handleGuess('up'));
    if (el('downBtn')) el('downBtn').addEventListener('click', () => handleGuess('down'));
    
    if (el('togglePatternsBtn')) el('togglePatternsBtn').addEventListener('click', () => {
        if (typeof togglePatterns === 'function') togglePatterns();
    });
    
    if (el('togglePatternExplainBtn')) el('togglePatternExplainBtn').addEventListener('click', () => {
        if (typeof togglePatternExplain === 'function') togglePatternExplain();
    });
    
    if (el('summaryToggleBtn')) el('summaryToggleBtn').addEventListener('click', () => {
        if (typeof toggleSummary === 'function') toggleSummary();
    });

    loadFocusBlock();
});
