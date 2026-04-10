// test.js — Quiz/Test Page Logic
console.log("Test page loaded");

// ═══════════════════════════════════════════════════════════════
// QUIZ DATA (mirrors learn.html curriculum for consistency)
// ═══════════════════════════════════════════════════════════════

const QUIZ_DATA = [
  {
    id: 1,
    unit: "Candle Anatomy",
    questions: [
      {
        text: "A green (bullish) candle means:",
        options: ["The close was lower than the open", "The close was higher than the open", "The price didn't move", "Volume was high"],
        correct: 1,
        explanation: "Green (bullish) candles form when price closes higher than it opened — buyers were in control."
      },
      {
        text: "What does a large candle body tell you?",
        options: ["The market was quiet", "There was a strong move in one direction", "Price reversed sharply", "Volume was low"],
        correct: 1,
        explanation: "A big body means price moved a lot from open to close — one side (buyers or sellers) dominated the period."
      },
      {
        text: "A doji candle suggests:",
        options: ["A strong bullish trend", "Sellers are winning", "Neither buyers nor sellers are in control", "Price is about to crash"],
        correct: 2,
        explanation: "Doji candles form when open and close are nearly identical — a sign of indecision and balance between buyers and sellers."
      },
      {
        text: "A long upper wick on a candle means:",
        options: ["Buyers stayed in control all period", "Price tried to go higher but sellers pushed it back down", "Volume was zero", "The candle is bullish"],
        correct: 1,
        explanation: "An upper wick shows that price tested higher levels, but sellers came in and drove it back down before the close."
      },
      {
        text: "What is 'chop' in a price chart?",
        options: ["A strong uptrend", "A series of candles with no clear direction", "High-volume buying", "A reversal pattern"],
        correct: 1,
        explanation: "Chop refers to mixed, directionless price action — candles go up and down without a clear trend, making it hard to trade."
      }
    ]
  },
  {
    id: 2,
    unit: "Volume",
    questions: [
      {
        text: "What does high volume during a price move indicate?",
        options: ["The move is weak", "Strong conviction behind the move", "Volume doesn't matter", "The move will reverse soon"],
        correct: 1,
        explanation: "High volume confirms strong participation and conviction — the move is more likely to continue."
      },
      {
        text: "Low volume during a breakout suggests:",
        options: ["The breakout is strong", "The breakout may fail", "Volume is irrelevant", "Price will gap higher"],
        correct: 1,
        explanation: "Breakouts on low volume often lack conviction and can fail — watch for volume confirmation."
      },
      {
        text: "A volume spike usually means:",
        options: ["Nothing significant", "Institutional activity or news", "Retail traders are exiting", "The market is closed"],
        correct: 1,
        explanation: "Volume spikes often signal institutional activity, major news, or a significant shift in sentiment."
      },
      {
        text: "When price rises on decreasing volume, it suggests:",
        options: ["Strong bullish trend", "Weakness in the uptrend", "Accumulation", "Distribution"],
        correct: 1,
        explanation: "Rising price on declining volume shows weakening momentum — the trend may be losing steam."
      },
      {
        text: "Volume precedes price means:",
        options: ["Volume is unimportant", "Changes in volume often signal upcoming price moves", "Price always leads volume", "They're unrelated"],
        correct: 1,
        explanation: "Volume often increases before significant price moves — watching volume can give early signals."
      }
    ]
  },
  {
    id: 3,
    unit: "Volatility",
    questions: [
      {
        text: "What does a candle with a very large range (high to low) tell you?",
        options: ["The market was quiet", "Volatility was high during that period", "Volume must have been low", "It's a doji"],
        correct: 1,
        explanation: "A large candle range means price moved a lot — that's high volatility. Whether that's good or bad depends on the context."
      },
      {
        text: "What do multiple long wicks in a row suggest?",
        options: ["A strong, clean trend", "The market is unstable and struggling for direction", "Volume is rising", "A breakout just happened"],
        correct: 1,
        explanation: "Repeated long wicks show price keeps getting rejected. It's a sign of instability — neither buyers nor sellers can gain lasting control."
      },
      {
        text: "What is 'compression' in price action?",
        options: ["A series of huge candles", "Tight, small candles clustering together in a narrow range", "A sharp drop in price", "High volume combined with low price movement"],
        correct: 1,
        explanation: "Compression is when candles become small and tight. The market is coiling — often a precursor to a larger move."
      },
      {
        text: "Low volatility in a market most likely means:",
        options: ["Nothing is happening and it doesn't matter", "The market is resting, waiting, or gathering energy", "A crash is guaranteed next", "Volume is always high"],
        correct: 1,
        explanation: "Low volatility is a phase, not a permanent state. It often means the market is compressing before its next expansion."
      },
      {
        text: "After a long period of tight, low-volatility candles, what often follows?",
        options: ["More tight candles forever", "A volatility expansion — a sharp move in one direction", "Doji candles appear", "Volume disappears completely"],
        correct: 1,
        explanation: "Markets cycle between compression and expansion. After a quiet stretch, volatility tends to expand — often with a notable breakout."
      }
    ]
  }
];

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

let currentUnitIndex = 0;
let currentQuestionIndex = 0;
let scores = {};
let answeredQuestions = {};
let selectedOption = null;
let submitted = false;

// ═══════════════════════════════════════════════════════════════
// AUTH CHECK
// ═══════════════════════════════════════════════════════════════

const username = localStorage.getItem("username");
if (!username) {
  window.location.href = "login.html";
} else {
  document.getElementById("currentUsername").textContent = username;
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("username");
  window.location.href = "login.html";
});

// ═══════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function render() {
  const unit = QUIZ_DATA[currentUnitIndex];
  const question = unit.questions[currentQuestionIndex];
  const totalQuestions = unit.questions.length;
  const key = `${unit.id}-${currentQuestionIndex}`;
  const alreadyAnswered = answeredQuestions[key] !== undefined;

  // Render question
  const app = document.getElementById('app');
  app.innerHTML = '';

  // HUD
  const streakCount = Object.values(answeredQuestions).filter(v => v).length;
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = `
    <span class="progress-label">${unit.unit}</span>
    <span class="streak-badge" id="streakBadge">🔥 ${streakCount} correct</span>
  `;
  app.appendChild(hud);

  // Progress bar
  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-bar-wrap';
  progressWrap.innerHTML = `<div class="progress-bar" id="progressBar" style="width: ${(currentQuestionIndex) / totalQuestions * 100}%"></div>`;
  app.appendChild(progressWrap);

  // Update progress (after HTML is rendered)
  setTimeout(() => {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const streakBadge = document.getElementById('streakBadge');
    
    if (progressBar) progressBar.style.width = ((currentQuestionIndex) / totalQuestions * 100) + '%';
    if (progressText) progressText.textContent = `Question ${currentQuestionIndex + 1} of ${totalQuestions}`;
    
    // Update streak badge
    const currentStreak = Object.values(answeredQuestions).filter(v => v).length;
    if (streakBadge) streakBadge.textContent = `🔥 ${currentStreak} correct`;
  }, 0);

  // Unit badges
  const badgesRow = document.createElement('div');
  badgesRow.className = 'badges-row';
  QUIZ_DATA.forEach((u, i) => {
    const badge = document.createElement('span');
    badge.className = 'unit-badge';
    if (i === currentUnitIndex) {
      badge.style.background = 'rgba(99, 102, 241, 0.15)';
      badge.style.borderColor = 'rgba(99, 102, 241, 0.3)';
      badge.style.color = '#818cf8';
    } else {
      badge.style.background = 'rgba(255,255,255,0.03)';
      badge.style.borderColor = 'var(--border-subtle)';
      badge.style.color = 'var(--text-tertiary)';
    }
    badge.textContent = `U${u.id}: ${u.unit}`;
    badgesRow.appendChild(badge);
  });
  app.appendChild(badgesRow);

  // Question content
  const h3 = document.createElement('h3');
  h3.textContent = question.text;
  app.appendChild(h3);

  // Options
  question.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    
    if (alreadyAnswered) {
      btn.disabled = true;
      if (i === question.correct) btn.classList.add('correct');
      else if (i === selectedOption && i !== question.correct) btn.classList.add('wrong');
    } else if (submitted) {
      btn.disabled = true;
      if (i === question.correct) btn.classList.add('correct');
      else if (i === selectedOption) btn.classList.add('wrong');
    } else {
      if (i === selectedOption) btn.classList.add('selected');
      btn.addEventListener('click', () => selectOption(i));
    }
    
    app.appendChild(btn);
  });

  // Feedback
  if (alreadyAnswered || submitted) {
    const correct = alreadyAnswered ? answeredQuestions[key] : (selectedOption === question.correct);
    const feedback = document.createElement('div');
    feedback.className = `feedback ${correct ? 'correct' : 'wrong'}`;
    feedback.textContent = correct ? `✓ Correct! ${question.explanation}` : `✗ Not quite. ${question.explanation}`;
    app.appendChild(feedback);

    const actionBtn = document.createElement('button');
    if (currentQuestionIndex < totalQuestions - 1) {
      actionBtn.className = 'continue-btn';
      actionBtn.textContent = 'Next Question →';
      actionBtn.addEventListener('click', nextQuestion);
    } else {
      actionBtn.className = 'retry-btn';
      actionBtn.textContent = 'View Results';
      actionBtn.addEventListener('click', showResults);
    }
    app.appendChild(actionBtn);
  } else {
    const submitBtn = document.createElement('button');
    submitBtn.className = 'continue-btn';
    submitBtn.textContent = 'Submit Answer';
    submitBtn.disabled = selectedOption === null;
    submitBtn.addEventListener('click', submitAnswer);
    app.appendChild(submitBtn);
  }
}

function selectOption(index) {
  selectedOption = index;
  render();
}

function submitAnswer() {
  const unit = QUIZ_DATA[currentUnitIndex];
  const question = unit.questions[currentQuestionIndex];
  const key = `${unit.id}-${currentQuestionIndex}`;
  const isCorrect = selectedOption === question.correct;
  
  answeredQuestions[key] = isCorrect;
  
  if (!scores[unit.id]) {
    scores[unit.id] = { correct: 0, total: unit.questions.length };
  }
  if (isCorrect) {
    scores[unit.id].correct++;
  }
  
  submitted = true;
  render();
}

function nextQuestion() {
  const unit = QUIZ_DATA[currentUnitIndex];
  if (currentQuestionIndex < unit.questions.length - 1) {
    currentQuestionIndex++;
    selectedOption = null;
    submitted = false;
    render();
  }
}

function showResults() {
  const unit = QUIZ_DATA[currentUnitIndex];
  const score = scores[unit.id] || { correct: 0, total: unit.questions.length };
  const percentage = Math.round((score.correct / score.total) * 100);

  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="text-align: center;">
      <div class="complete-icon">🏆</div>
      <h2 class="complete-title">${unit.unit} Complete!</h2>
      <p class="complete-subtitle">You've finished the quiz for this unit.</p>
      
      <div class="stat-row">
        <div class="stat">
          <div class="stat-num" style="color: ${percentage >= 70 ? '#4ade80' : '#f87171'}">${percentage}%</div>
          <div class="stat-lbl">Score</div>
        </div>
        <div class="stat">
          <div class="stat-num">${score.correct}</div>
          <div class="stat-lbl">Correct</div>
        </div>
        <div class="stat">
          <div class="stat-num">${score.total}</div>
          <div class="stat-lbl">Total</div>
        </div>
      </div>
      
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
          ${percentage >= 80 ? '🎉 Excellent work! You have a strong understanding of this topic.' : 
            percentage >= 60 ? '👍 Good job! Review the lessons to strengthen your knowledge.' : 
            '📚 Keep studying! Revisit the learning modules and try again.'}
        </p>
      </div>
      
      <div style="display: flex; gap: 12px; flex-direction: column;">
        ${currentUnitIndex < QUIZ_DATA.length - 1 ? `
          <button class="continue-btn" onclick="nextUnit()">
            Next Unit: ${QUIZ_DATA[currentUnitIndex + 1].unit} →
          </button>
        ` : ''}
        <button class="retry-btn" onclick="restartUnit()">
          🔄 Retry This Unit
        </button>
        <button class="logout-link" onclick="window.location.href='index.html'" style="background: transparent; width: 100%;">
          ← Back to Dashboard
        </button>
      </div>
    </div>
  `;
}

function nextUnit() {
  if (currentUnitIndex < QUIZ_DATA.length - 1) {
    currentUnitIndex++;
    currentQuestionIndex = 0;
    selectedOption = null;
    submitted = false;
    render();
  }
}

function restartUnit() {
  const unit = QUIZ_DATA[currentUnitIndex];
  // Clear answers for this unit
  for (let i = 0; i < unit.questions.length; i++) {
    const key = `${unit.id}-${i}`;
    delete answeredQuestions[key];
  }
  scores[unit.id] = { correct: 0, total: unit.questions.length };
  currentQuestionIndex = 0;
  selectedOption = null;
  submitted = false;
  render();
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

render();
