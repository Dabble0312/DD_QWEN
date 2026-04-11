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
        clearPatternHighlights();  // focus-patterns.js
        hidePatternPanels();       // focus-patterns.js
        clearDynamicZones();       // focus-patterns.js

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
    chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);

    renderChart();

    // Focus mode lets the y-axis autoscale to visible candles only
    candlestickSeries.applyOptions({ autoscaleInfoProvider: undefined });

    chart.timeScale().fitContent();
    updateDynamicZones();   // focus-patterns.js — draws initial zones

    // ── Candle click → update stats + info panel
    chart.subscribeClick((param) => {
        if (!param || !param.time) return;
        const clickedDate = param.time;
        const allVisible  = [...allCandles, ...revealedSoFar];
        const matched     = allVisible.find(c => c.date.slice(0, 10) === clickedDate);
        if (!matched) return;

        updateStatsPanel(matched);   // focus-ui.js
        showCandleInfo(matched);     // focus-ui.js
        refreshSummaryIfOpen(matched); // focus-ui.js
    });

    // ── Redraw zone overlays on viewport change
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        requestAnimationFrame(drawZoneOverlays);   // focus-patterns.js
    });
    chart.subscribeCrosshairMove(() => {
        requestAnimationFrame(drawZoneOverlays);
    });

    setupZoneCanvas(chartDiv);   // focus-patterns.js
}

/* -----------------------------------------
   3. RENDER CHART
----------------------------------------- */
function renderChart() {
    const all        = [...allCandles, ...revealedSoFar];
    candlestickSeries.setData(all.map(toCandlePoint));   // shared/chart.js
    volumeSeries.setData(all.map(toVolumePoint));        // shared/chart.js
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
    updateHUD();             // focus-ui.js
    setButtonState("reveal"); // focus-ui.js
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
    setButtonState("revealing");

    let count = 0;
    const maxThisBurst = getRevealCount();

    function revealNext() {
        if (count >= maxThisBurst || revealIndex >= futureCandles.length) {
            autoRevealActive = false;
            awaitingGuess    = true;
            setButtonState("guess");
            showStatus("What happens next?");

            // Capture journal entry before narrator speaks
            captureTradeEntry();

            // Trigger narrator
            if (window.runNarratorEngine) {
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
       
        updateStatsPanel();      // focus-ui.js
        updateDynamicZones();    // focus-patterns.js

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
    };

    showStatus("Reveal to see if you were right!");
    setButtonState("reveal");
}

/* -----------------------------------------
   6b. SCORE PENDING PREDICTION
----------------------------------------- */
function scorePendingPrediction() {
    if (!pendingPrediction) return;

    const { guess, targetPrice, candleIndex, baseClose } = pendingPrediction;
    pendingPrediction = null;
    guessCount++;

    const predictedCandle = futureCandles[candleIndex];
    const priceWentUp     = predictedCandle.close > baseClose;
    const correct         = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    if (correct) {
        correctCount++;
        showPopup("correct");    // shared/ui.js
        showWSBPopup(true);      // shared/ui.js
    } else {
        wrongCount++;
        showPopup("wrong");
        showWSBPopup(false);
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
        showPriceFeedback(msg);   // focus-ui.js
    }

    updateHUD();    // focus-ui.js

    // ★★★ CRITICAL FIX: Capture journal entry NOW, after scoring but before next round
    captureTradeEntry();

    if (wrongCount >= MAX_WRONG) {
        setTimeout(() => endSession("focus_lost"), 1400);
        return;
    }
    if (revealIndex >= futureCandles.length) {
        setTimeout(() => endSession("complete"), 1400);
        return;
    }

    setTimeout(() => { showStatus(""); }, 2000);
}

/* -----------------------------------------
   6c. CAPTURE TRADE ENTRY FOR JOURNAL
----------------------------------------- */
function captureTradeEntry() {
    if (!pendingPrediction || !chart || !window.JournalService) return;

    const { candleIndex, baseClose } = pendingPrediction;
    const predictedCandle = futureCandles[candleIndex];

    // Get the actual data for the burst end candle
    const actualData = {
        close: predictedCandle.close,
        open: predictedCandle.open,
        high: predictedCandle.high,
        low: predictedCandle.low
    };

    // Generate narrative text for journal (without speaking)
    let narrativeText = '';
    if (typeof generateNarrativeText === 'function') {
        narrativeText = generateNarrativeText() || 'No analysis generated.';
    }

    // Capture with JournalService
    window.JournalService.captureTradeEntry(
        chart,
        narrativeText,
        { direction: currentUserGuess ? currentUserGuess.toUpperCase() : 'UNKNOWN', target: currentPriceTarget || 0 },
        actualData,
        'FOCUS_SESSION'
    ).catch(err => {
        console.error('[focus-core] Failed to capture trade entry:', err);
    });

    // Reset guess storage for next round
    currentUserGuess = null;
    currentPriceTarget = null;
}

/* -----------------------------------------
   7. END SESSION
----------------------------------------- */
async function endSession(reason) {
    sessionActive    = false;
    autoRevealActive = false;
    awaitingGuess    = false;
    setButtonState("revealing");

    // 1. Save Final Trade Entry if pending
    if (pendingPrediction && pendingPrediction.direction) {
        try {
            const lastNarrative = window.lastNarrativeText || "Session Ended";
            const currentCandle = allCandles[revealIndex - 1] || {};
            
            if (typeof JournalService !== 'undefined') {
                await JournalService.saveEntry(
                    chart,
                    pendingPrediction,
                    lastNarrative,
                    currentCandle
                );
                console.log("✅ Final trade saved to journal");
            }
        } catch (e) {
            console.error("❌ Failed to save final trade:", e);
        }
    }

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
    inputs.forEach(el => el.disabled = true);

    // 3. Show Mission Report Modal instead of basic end screen
    setTimeout(() => {
        showMissionReportModal(accuracy, reason);
    }, 800);
}

function showMissionReportModal(accuracy, reason) {
    const modal = document.getElementById('mission-report-modal');
    if (!modal) {
        console.warn("⚠️ Mission report modal not found in DOM");
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
    document.getElementById('report-grade').textContent = grade;
    document.getElementById('report-score').textContent = `${accuracy}% Accuracy`;
    document.getElementById('report-total-trades').textContent = guessCount;
    document.getElementById('report-accuracy').textContent = `${correctCount}/${guessCount} Correct`;
    
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
   8. KEYBOARD SHORTCUTS (Phase 5)
   ArrowUp = UP guess, ArrowDown = DOWN guess
----------------------------------------- */
window.addEventListener('keydown', (e) => {
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
    if (el('narratorBtn')) el('narratorBtn').addEventListener('click', toggleNarrator);
    if (el('revealBtn'))               el('revealBtn').addEventListener('click', startAutoReveal);
    if (el('upBtn'))                   el('upBtn').addEventListener('click', () => handleGuess('up'));
    if (el('downBtn'))                 el('downBtn').addEventListener('click', () => handleGuess('down'));
    if (el('togglePatternsBtn'))       el('togglePatternsBtn').addEventListener('click', togglePatterns);
    if (el('togglePatternExplainBtn')) el('togglePatternExplainBtn').addEventListener('click', togglePatternExplain);
    if (el('summaryToggleBtn'))        el('summaryToggleBtn').addEventListener('click', toggleSummary);

    loadFocusBlock();
});
