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
   6b. SCORE PENDING PREDICTION (UPDATED)
----------------------------------------- */
function scorePendingPrediction() {
    if (!pendingPrediction) return;

    const { guess, targetPrice, candleIndex, baseClose } = pendingPrediction;
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
        
        // ★★★ FIX 1: Immediate Feedback on 5th Wrong Guess
        if (wrongCount >= MAX_WRONG) {
            showStatus("❌ 5 Wrong Guesses — Session Ended!");
            // We don't stop here, we let the reveal finish, then endSession triggers
        }
    }

    // Price target feedback
    const hasTarget = !isNaN(targetPrice) && targetPrice > 0;
    if (hasTarget) {
        const actual  = predictedCandle.close;
        const diff    = actual - targetPrice;
        const diffPct = ((Math.abs(diff) / actual) * 100).toFixed(1);
        let msg;
        if (Math.abs(diff) / actual < 0.005)
            msg = `🎯 Spot on! Target ₹${targetPrice.toFixed(2)} vs actual ₹${actual.toFixed(2)}`;
        else if (diff > 0)
            msg = `📈 Actual was ${diffPct}% higher than your target`;
        else
            msg = `📉 Actual was ${diffPct}% lower than your target`;

        if (typeof showPriceFeedback === 'function') showPriceFeedback(msg);
    }

    if (typeof updateHUD === 'function') updateHUD();

    pendingPrediction = null;
}

/* -----------------------------------------
   7. END SESSION (UPDATED)
----------------------------------------- */
async function endSession(reason) {
    sessionActive    = false;
    autoRevealActive = false;
    awaitingGuess    = false;
    
    if (typeof setButtonState === 'function') setButtonState("done");

    // Reveal all remaining candles
    revealedSoFar = [...futureCandles];
    renderChart();

    const accuracy = guessCount > 0 ? Math.round((correctCount / guessCount) * 100) : 0;

    // ★★★ FIX 2: Clear Status Message before Modal
    showStatus(reason === "focus_lost" ? "Session Ended: Focus Lost" : "Session Complete");

    // Disable ONLY the game controls (Up/Down/Reveal), NOT the whole page
    const controlGroup = document.querySelector('.control-group');
    if (controlGroup) {
        controlGroup.style.pointerEvents = 'none';
        controlGroup.style.opacity = '0.5'; // Visual cue that it's disabled
    }
    
    // Specifically disable game buttons but leave others alone
    ['upBtn', 'downBtn', 'revealBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });

    // ★★★ FIX 3: Ensure Journal Button stays ENABLED
    const journalBtn = document.getElementById('journalBtn'); // Or whatever your ID is
    if (journalBtn) {
        journalBtn.disabled = false;
        journalBtn.style.pointerEvents = 'auto';
        journalBtn.style.opacity = '1';
        journalBtn.textContent = "📊 View Final Report"; // Change text to invite click
    }

    // Show Mission Report Modal automatically
    setTimeout(() => {
        showMissionReportModal(accuracy, reason);
    }, 1000);
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
