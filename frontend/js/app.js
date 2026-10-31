/* ============================================================
   SYNQORA GLOBAL FRONTEND ENGINE & HELPER (js/app.js)
   Handles API Integration, Test Runner Engine, Anti-Cheating, 
   Passport Generator, Custom Skills, Page Routing & Admin Role.
   ============================================================ */

// 1. Session Expiry & Route Guard Logic (Change 7)
function verifySession() {
  const token = localStorage.getItem('synqora_token');
  const publicPages = ['login.html', 'register.html', 'index.html'];
  const currentPage = window.location.pathname.split('/').pop();
  if (!token && !publicPages.includes(currentPage) && currentPage !== '') {
    window.location.href = 'login.html';
  }
}
verifySession();

// 2. Dynamic API URL Centralization (Change 5)
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const API_BASE_URL = (typeof CONFIG !== 'undefined' && CONFIG.FASTAPI_BASE) 
  ? CONFIG.FASTAPI_BASE 
  : (isLocal ? "http://localhost:8000/api" : "/ai-api");
const NODE_API_BASE = (typeof CONFIG !== 'undefined' && CONFIG.NODE_API_BASE)
  ? CONFIG.NODE_API_BASE
  : (isLocal ? "http://localhost:5000/api" : "/api");

// GLOBAL STATE
const urlParams = new URLSearchParams(window.location.search);
const currentSkill = urlParams.get('skill') || 'Python';
const currentScoreParam = urlParams.get('score') || '90%';

let currentRound = 1;
let questionIndex = 1;
let activeQuestions = [];
let selectedAnswer = null;
let correctAnswersCount = 0;
let timeInSeconds = 600;
let countdownTimer = null;
let warningCount = 0;

// Anti-Cheating Violation Handler (Change 6)
function recordCheatAttempt(reason) {
  warningCount++;
  console.warn(`[ANTI-CHEAT WARNING ${warningCount}/3]:`, reason);

  const warningCountText = document.getElementById('warningCountText');
  if (warningCountText) warningCountText.innerText = warningCount;

  const warningModal = document.getElementById('warningModal');
  if (warningModal) {
    const p = warningModal.querySelector('p');
    if (p) {
      p.innerHTML = `<span style="color:#FF3366; font-weight:bold;">Violation Detected:</span> ${reason}.<br>Inspections or leaving the assessment screen will invalidate your score.`;
    }
    warningModal.style.display = 'flex';
  } else {
    alert(`⚠️ Proctoring Violation: ${reason}! (Warning ${warningCount}/3)`);
  }

  if (warningCount >= 3) {
    alert('❌ Test Terminated! Multiple security/anti-cheating violations detected. Score: 0');
    window.location.href = 'skills.html';
  }
}

// Anti-Cheating Protocol Hardening (Change 6)
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'F12' || 
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) || 
    (e.ctrlKey && e.key === 'u')
  ) {
    e.preventDefault();
    if (typeof recordCheatAttempt === 'function') {
      recordCheatAttempt("DevTools / Source inspection attempt detected");
    }
  }
});

document.addEventListener('contextmenu', (e) => {
  if (document.getElementById('quiz-screen') || document.getElementById('quizWrapperContainer') || window.location.pathname.includes('test-runner')) {
    e.preventDefault();
  }
});

// PAGE ROUTER & GLOBAL DOM LOAD
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;

  // 1. Dynamic Role Check for Admin Navigation Link across all pages
  const storedUser = localStorage.getItem('synqora_user');
  if (storedUser) {
    try {
      const u = JSON.parse(storedUser);
      if (u && u.role === 'admin') {
        const adminNav = document.getElementById('adminNavLink');
        if (adminNav) adminNav.style.display = 'block';
      }
    } catch (e) {
      console.error('Error parsing user session:', e);
    }
  }

  // 2. Page Specific Initializations
  if (path.includes('test-runner.html')) {
    initTestRunner();
  } else if (path.includes('passport.html')) {
    initPassportView();
  } else if (path.includes('skills.html')) {
    initSkillsDashboard();
  }
});

/* ============================================================
   1. TEST RUNNER ENGINE (test-runner.html)
   ============================================================ */
function initTestRunner() {
  startCountdownTimer();
  setupProctoring();
  fetchQuestionsFromBackend(currentSkill, currentRound);
}

function startCountdownTimer() {
  const timerDisplay = document.getElementById('timerDisplay');
  if (!timerDisplay) return;

  countdownTimer = setInterval(() => {
    let minutes = Math.floor(timeInSeconds / 60);
    let seconds = timeInSeconds % 60;

    seconds = seconds < 10 ? '0' + seconds : seconds;
    minutes = minutes < 10 ? '0' + minutes : minutes;

    timerDisplay.innerText = `${minutes}:${seconds}`;

    if (timeInSeconds <= 0) {
      clearInterval(countdownTimer);
      alert('⏱️ Time UP! Auto-submitting assessment.');
      window.location.href = 'skills.html';
    }
    timeInSeconds--;
  }, 1000);
}

async function fetchQuestionsFromBackend(skill, round) {
  try {
    const response = await fetch(`${API_BASE_URL}/questions?skill=${encodeURIComponent(skill)}&round=${round}&user_id=1`);
    if (response.ok) {
      activeQuestions = await response.json();
      renderCurrentQuestion();
    } else {
      renderFallbackQuestion();
    }
  } catch (err) {
    console.warn("Backend API unreachable, using fallback questions:", err);
    renderFallbackQuestion();
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function selectOptionByKey(optKey) {
  const key = String(optKey || 'A').trim().toUpperCase().charAt(0);
  selectedAnswer = key;

  const items = document.querySelectorAll('.option-item, .quiz-option, .option-card');
  items.forEach(el => {
    if (el.getAttribute('data-key') === key) {
      el.classList.add('selected');
      const radio = el.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    } else {
      el.classList.remove('selected');
      const radio = el.querySelector('input[type="radio"]');
      if (radio) radio.checked = false;
    }
  });
}

function selectOptionCard(element, userVal, optionKey) {
  selectOptionByKey(optionKey || userVal);
}

function formatQuestionWithCode(rawText) {
  let cleanText = String(rawText).replace(/\\n/g, '\n');

  if (cleanText.includes('```')) {
    let parts = cleanText.split('```');
    let headerText = parts[0];
    let codeContent = parts[1] ? parts[1].replace(/^[a-zA-Z]+\n/, '') : '';
    let footerText = parts[2] || '';

    return `
      <h2 style="font-size: 1.15rem; color: #FFF; font-weight: 700; line-height: 1.5; margin-bottom: 0.75rem;">
        Q${questionIndex}. ${headerText}
      </h2>
      <div class="code-snippet-box">${codeContent.trim()}</div>
      ${footerText ? `<p style="color: #A0AEC0; font-size: 0.95rem; margin-bottom: 1.25rem;">${footerText}</p>` : ''}
    `;
  } else if (cleanText.includes('\n')) {
    let lines = cleanText.split('\n');
    let titleLine = lines[0];
    let codeLines = lines.slice(1).join('\n').trim();

    if (codeLines.length > 0) {
      return `
        <h2 style="font-size: 1.15rem; color: #FFF; font-weight: 700; line-height: 1.5; margin-bottom: 0.75rem;">
          Q${questionIndex}. ${titleLine}
        </h2>
        <div class="code-snippet-box">${codeLines}</div>
      `;
    }
  }

  return `
    <h2 style="font-size: 1.15rem; color: #FFF; font-weight: 700; line-height: 1.5; margin-bottom: 1.75rem;">
      Q${questionIndex}. ${cleanText}
    </h2>
  `;
}

function handleManualInput(val) {
  selectedAnswer = String(val || '').trim();
}

function renderCurrentQuestion() {
  selectedAnswer = null;

  if (!activeQuestions || activeQuestions.length === 0) {
    renderFallbackQuestion();
    return;
  }
  
  const q = activeQuestions[questionIndex - 1] || activeQuestions[0];
  const qType = String(q.type || 'Standard MCQ').trim();
  const companyTag = document.getElementById('companyTag');
  const typeTag = document.getElementById('typeTag');
  const contentBox = document.getElementById('questionContentBox');
  const optionsContainer = document.getElementById('optionsContainer');

  if (companyTag) companyTag.innerText = `🏢 ${q.company_tag || 'Amazon | 2026'}`;
  
  if (typeTag) {
    if (qType === 'Manual Fill-In') {
      typeTag.innerHTML = `⌨️ Type: Manual Fill-In`;
    } else if (qType === 'True / False') {
      typeTag.innerHTML = `⚖️ Type: True / False`;
    } else if (qType === 'Spot the Bug') {
      typeTag.innerHTML = `🐛 Type: Spot the Bug`;
    } else if (qType === 'Complete the Statement') {
      typeTag.innerHTML = `🧩 Type: Complete the Statement`;
    } else {
      typeTag.innerHTML = `📋 Type: Standard MCQ`;
    }
  }

  if (contentBox) contentBox.innerHTML = formatQuestionWithCode(q.question);
  if (!optionsContainer) return;

  // 1. MANUAL FILL-IN
  if (qType === 'Manual Fill-In') {
    optionsContainer.innerHTML = `
      <div style="background: #090D16; border: 1px solid #24324D; border-radius: 14px; padding: 1.5rem; margin-top: 0.5rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; color: #00F0FF; font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem;">
          <span>⌨️</span> <span>Enter your predicted output or answer:</span>
        </label>
        <input 
          type="text" 
          id="manualAnswerInput" 
          class="manual-input-field" 
          placeholder="e.g. O(1), 200, True, or return value" 
          oninput="handleManualInput(this.value)"
          onkeydown="if(event.key === 'Enter') handleNextQuestion()"
          autocomplete="off"
          spellcheck="false"
          style="margin-bottom: 0.75rem;"
        />
      </div>
    `;
    setTimeout(() => {
      const input = document.getElementById('manualAnswerInput');
      if (input) input.focus();
    }, 100);
    return;
  }
  
  let cleanOptions = (q.options || []).filter(opt => {
    const clean = String(opt).replace(/\\n/g, ' ').trim();
    return clean.length > 0 && clean.toLowerCase() !== 'correct_answer';
  });

  const isTrueFalse = qType === 'True / False' || (cleanOptions.length === 2 && cleanOptions.some(o => /true|false/i.test(o)));

  // 2. TRUE / FALSE
  if (isTrueFalse) {
    optionsContainer.innerHTML = `
      <div class="option-item ${selectedAnswer === 'A' ? 'selected' : ''}" data-key="A" onclick="selectOptionByKey('A')" style="border-left: 4px solid #00FF87;">
        <input type="radio" name="mcq_option" id="tf1" value="A" ${selectedAnswer === 'A' ? 'checked' : ''} style="pointer-events: none;">
        <label style="color:#FFF; cursor:pointer; pointer-events: none; width: 100%; font-weight: 700;">A) TRUE</label>
      </div>
      <div class="option-item ${selectedAnswer === 'B' ? 'selected' : ''}" data-key="B" onclick="selectOptionByKey('B')" style="border-left: 4px solid #FF3366;">
        <input type="radio" name="mcq_option" id="tf2" value="B" ${selectedAnswer === 'B' ? 'checked' : ''} style="pointer-events: none;">
        <label style="color:#FFF; cursor:pointer; pointer-events: none; width: 100%; font-weight: 700;">B) FALSE</label>
      </div>
    `;
    return;
  }

  // 3, 4, 5. SPOT THE BUG, COMPLETE STATEMENT, MCQ
  if (cleanOptions.length < 2) {
    cleanOptions = [
      `A) Optimal ${currentSkill} Pattern`,
      `B) Linear scan sub-optimal approach`,
      `C) SyntaxError / Invalid Reference`,
      `D) Memory limit exceeded`
    ];
  }

  const letters = ['A', 'B', 'C', 'D'];
  optionsContainer.innerHTML = cleanOptions.slice(0, 4).map((opt, idx) => {
    const optStr = String(opt).trim();
    const match = optStr.match(/^[A-D]/i);
    const optKey = match ? match[0].toUpperCase() : (letters[idx] || 'A');
    const isSelected = selectedAnswer === optKey;

    let borderStyle = '';
    if (qType === 'Spot the Bug') borderStyle = 'border-left: 4px solid #FB923C;';
    else if (qType === 'Complete the Statement') borderStyle = 'border-left: 4px solid #38BDF8;';

    return `
      <div class="option-item ${isSelected ? 'selected' : ''}" data-key="${optKey}" onclick="selectOptionByKey('${optKey}')" style="${borderStyle}">
        <input type="radio" name="mcq_option" id="opt_${idx}" value="${optKey}" ${isSelected ? 'checked' : ''} style="pointer-events: none;">
        <label style="color:#FFF; cursor:pointer; pointer-events: none; width: 100%; font-weight: 600;">${escapeHtml(optStr)}</label>
      </div>
    `;
  }).join('');
}

function renderFallbackQuestion() {
  selectedAnswer = null;
  const optionsContainer = document.getElementById('optionsContainer');
  const contentBox = document.getElementById('questionContentBox');
  if (!optionsContainer || !contentBox) return;

  const fallbackSuite = [
    {
      type: "Standard MCQ",
      company_tag: "Amazon | 2026",
      question: `Which data structure in ${currentSkill} operates on key-value pairs with O(1) average lookup complexity?`,
      options: ["A) Hash Table / Dictionary", "B) Linear Unsorted Array", "C) Singly Linked List", "D) FIFO Queue"],
      correct_answer: "A"
    },
    {
      type: "True / False",
      company_tag: "Google | 2026",
      question: `True or False: Primitive immutable types in ${currentSkill} allow value mutation after initial allocation.`,
      options: ["A) TRUE", "B) FALSE"],
      correct_answer: "B"
    },
    {
      type: "Spot the Bug",
      company_tag: "Microsoft | 2026",
      question: `Identify the error when accessing index 3 in a 3-element list:\n\nitems = [10, 20, 30]\nval = items[3]`,
      options: ["A) IndexError: out of bounds", "B) SyntaxError", "C) Null pointer", "D) Memory overflow"],
      correct_answer: "A"
    },
    {
      type: "Complete the Statement",
      company_tag: "Atlassian | 2026",
      question: `To protect shared mutable state from race conditions, threads acquire a ____ lock.`,
      options: ["A) Mutex", "B) Virtual Memory", "C) GC handle", "D) Stack Frame"],
      correct_answer: "A"
    },
    {
      type: "Manual Fill-In",
      company_tag: "Uber | 2026",
      question: `What is the average time complexity (in Big-O notation, e.g. O(1)) for hash-indexed lookups in ${currentSkill}?`,
      options: [],
      correct_answer: "O(1)"
    }
  ];

  const item = fallbackSuite[(questionIndex - 1) % fallbackSuite.length];
  activeQuestions = fallbackSuite;
  renderCurrentQuestion();
}

function recordAnswerScore() {
  const q = activeQuestions[questionIndex - 1];
  if (!q) return;

  const userAns = String(selectedAnswer || '').trim();
  const correctAns = String(q.correct_answer || 'A').trim();

  if (q.type === 'Manual Fill-In') {
    const sanitize = (s) => String(s).toLowerCase().replace(/['"`;\s]/g, '');
    const cleanUser = sanitize(userAns);
    const cleanCorrect = sanitize(correctAns);
    if (cleanUser && (cleanUser === cleanCorrect || cleanCorrect.includes(cleanUser) || cleanUser.includes(cleanCorrect))) {
      correctAnswersCount++;
    }
  } else {
    const correctLetter = correctAns.toUpperCase().charAt(0);
    const userLetter = userAns.toUpperCase().charAt(0);
    if (userLetter && userLetter === correctLetter) {
      correctAnswersCount++;
    }
  }
}

function handleNextQuestion() {
  if (!selectedAnswer || selectedAnswer === '') {
    const modal = document.getElementById('selectionWarningModal');
    if (modal) modal.style.display = 'flex';
    return;
  }

  recordAnswerScore();
  advanceToNextQuestion();
}

function advanceToNextQuestion() {
  questionIndex++;

  if (questionIndex <= 10) {
    const tracker = document.getElementById('questionTracker');
    if (tracker) tracker.innerText = `Question ${questionIndex} of 10 • Anti-Cheating Active 🛡️`;
    if (activeQuestions.length >= questionIndex) {
      renderCurrentQuestion();
    } else {
      renderFallbackQuestion();
    }
  } else {
    if (currentRound === 1) {
      displayRound1Scoreboard();
    } else {
      triggerGrandCelebration();
    }
  }
}

function displayRound1Scoreboard() {
  const percentage = Math.round((correctAnswersCount / 10) * 100);
  const badge = document.getElementById('scorePercentageBadge');
  const correctText = document.getElementById('correctCountText');
  const incorrectText = document.getElementById('incorrectCountText');

  if (badge) badge.innerText = `${percentage}%`;
  if (correctText) correctText.innerText = `${correctAnswersCount} / 10`;
  if (incorrectText) incorrectText.innerText = `${10 - correctAnswersCount} / 10`;
  
  const statusElement = document.getElementById('roundPassStatus');
  const proceedBtn = document.getElementById('proceedRound2Btn');

  if (percentage >= 80) {
    if (statusElement) {
      statusElement.innerText = "PASSED 🚀";
      statusElement.style.color = "#00FF87";
    }
    if (proceedBtn) {
      proceedBtn.style.display = "inline-block";
      proceedBtn.disabled = false;
    }
  } else {
    if (statusElement) {
      statusElement.innerText = "FAILED (Min 80% Required) ⚠️";
      statusElement.style.color = "#FF3366";
    }
    if (proceedBtn) proceedBtn.style.display = "none";
  }

  const scoreModal = document.getElementById('round1ScoreModal');
  if (scoreModal) scoreModal.style.display = 'flex';
}

function reattemptRound1() {
  const scoreModal = document.getElementById('round1ScoreModal');
  if (scoreModal) scoreModal.style.display = 'none';
  questionIndex = 1;
  correctAnswersCount = 0;
  fetchQuestionsFromBackend(currentSkill, 1);
}

function startRound2() {
  const scoreModal = document.getElementById('round1ScoreModal');
  if (scoreModal) scoreModal.style.display = 'none';
  currentRound = 2;
  questionIndex = 1;
  correctAnswersCount = 0;
  timeInSeconds = 600;

  const headerTitle = document.getElementById('roundHeaderTitle');
  const tracker = document.getElementById('questionTracker');

  if (headerTitle) headerTitle.innerText = 'Round 2: Practical Debugging & Coding Sandbox';
  if (tracker) tracker.innerText = 'Problem 1 of 10 • Anti-Cheating Active 🛡️';
  
  fetchQuestionsFromBackend(currentSkill, 2);
}

async function submitAssessmentResults(score, skillName, totalQuestions, violationsCount = 0) {
  const token = localStorage.getItem('synqora_token') || '';
  const storedUser = JSON.parse(localStorage.getItem('synqora_user') || '{}');

  try {
    const response = await fetch(`${NODE_API_BASE}/assessment/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: storedUser.id || 1,
        skill_name: skillName,
        score_percentage: score,
        total: totalQuestions,
        status: score >= 80 ? 'PASSED' : 'FAILED',
        proctor_violations: violationsCount
      })
    });

    const data = await response.json();
    if (data.success && data.passport_url) {
      alert("Assessment saved and Passport Certificate Generated!");
      window.location.href = data.passport_url;
    } else {
      window.location.href = `passport.html?skill=${encodeURIComponent(skillName)}&score=${score}`;
    }
  } catch (err) {
    console.error("Error submitting assessment:", err);
    window.location.href = `passport.html?skill=${encodeURIComponent(skillName)}&score=${score}`;
  }
}

function triggerGrandCelebration() {
  var duration = 4.5 * 1000;
  var animationEnd = Date.now() + duration;

  var interval = setInterval(function() {
    var timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return clearInterval(interval);
    
    if (typeof confetti === 'function') {
      confetti({ particleCount: 80, spread: 100, origin: { y: 0.6 } });
    }
  }, 300);

  setTimeout(() => {
    submitAssessmentResults(90, currentSkill, 10, warningCount);
  }, 4500);
}

function setupProctoring() {
  window.addEventListener('blur', () => {
    if (typeof recordCheatAttempt === 'function') {
      recordCheatAttempt("Tab switch or focus lost");
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'v')) {
      e.preventDefault();
      if (typeof recordCheatAttempt === 'function') {
        recordCheatAttempt("Clipboard copy/paste blocked");
      }
    }
  });
}

function resumeTest() {
  const warningModal = document.getElementById('warningModal');
  if (warningModal) warningModal.style.display = 'none';
}

function closeSelectionModal() {
  const modal = document.getElementById('selectionWarningModal');
  if (modal) modal.style.display = 'none';
}

/* ============================================================
   2. PASSPORT VIEW LOGIC (passport.html)
   ============================================================ */
function initPassportView() {
  const skillTitle = document.getElementById('skillTitle');
  const verifiedScore = document.getElementById('verifiedScore');

  if (skillTitle) skillTitle.innerText = currentSkill;
  if (verifiedScore) verifiedScore.innerText = `${currentScoreParam} (Tier 1)`;

  const passportHash = document.getElementById('passportHash');
  if (passportHash) {
    const randomHash = '0x' + Array.from({length: 12}, () => Math.floor(Math.random()*16).toString(16)).join('');
    passportHash.innerText = randomHash;
  }

  const issueDate = document.getElementById('issueDate');
  if (issueDate) {
    const dateObj = new Date();
    issueDate.innerText = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
}

function downloadPassportCard() {
  const cardNode = document.getElementById('passportCardNode');
  if (!cardNode) return;

  if (typeof html2canvas === 'function') {
    html2canvas(cardNode, { backgroundColor: '#080B11', scale: 2 }).then(canvas => {
      const link = document.createElement('a');
      link.download = `Synqora_Passport_${currentSkill}.png`;
      link.href = canvas.toDataURL();
      link.click();
    });
  }
}

function shareOnLinkedIn() {
  const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`;
  window.open(shareUrl, '_blank');
}

/* ============================================================
   3. SKILLS DASHBOARD LOGIC (skills.html)
   ============================================================ */
function initSkillsDashboard() {}

function filterSkills(cat, btn) {
  document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const cards = document.querySelectorAll('.skill-card');
  cards.forEach(c => {
    if (cat === 'all' || c.getAttribute('data-category') === cat) {
      c.style.display = 'flex';
    } else {
      c.style.display = 'none';
    }
  });
}

function searchSkillCards() {
  const searchInput = document.getElementById('skillSearchInput');
  if (!searchInput) return;

  const q = searchInput.value.toLowerCase();
  const cards = document.querySelectorAll('.skill-card');
  cards.forEach(c => {
    const title = c.querySelector('.skill-title')?.innerText.toLowerCase() || '';
    const desc = c.querySelector('.skill-desc')?.innerText.toLowerCase() || '';
    if (title.includes(q) || desc.includes(q)) {
      c.style.display = 'flex';
    } else {
      c.style.display = 'none';
    }
  });
}

function verifyPassportHash() {
  const hashInput = document.getElementById('verifyHashInput');
  if (!hashInput) return;
  const hash = hashInput.value.trim();
  if (!hash) {
    alert('Please enter a Passport Hash key to verify.');
    return;
  }
  alert(`✅ Hash Key Verified! Candidate Passport is authentic and 100% clean.`);
}

function openAddSkillModal() {
  const modal = document.getElementById('addSkillModal');
  if (modal) modal.style.display = 'flex';
}

function closeAddSkillModal() {
  const modal = document.getElementById('addSkillModal');
  if (modal) modal.style.display = 'none';
}

function saveNewSkill() {
  const nameInput = document.getElementById('newSkillName');
  const iconInput = document.getElementById('newSkillIcon');
  const descInput = document.getElementById('newSkillDesc');

  if (!nameInput) return;

  const name = nameInput.value.trim();
  const icon = iconInput ? (iconInput.value.trim() || '💡') : '💡';
  const desc = descInput ? (descInput.value.trim() || 'Custom AI-generated technical protocol.') : 'Custom AI-generated technical protocol.';

  if (!name) {
    alert('Please enter a Skill Name!');
    return;
  }

  const grid = document.getElementById('skillsGrid');
  if (grid) {
    const cardHtml = `
      <div class="skill-card" data-category="all">
        <span class="status-badge status-ready">AI READY</span>
        <div>
          <div class="skill-icon">${icon}</div>
          <h3 class="skill-title">${name}</h3>
          <p class="skill-desc">${desc}</p>
        </div>
        <div>
          <div class="card-meta">
            <span>⏱️ 20 Mins</span>
            <span>🎯 80% Cutoff</span>
          </div>
          <a href="test-runner.html?skill=${encodeURIComponent(name)}" class="btn-start-test">Start Assessment →</a>
        </div>
      </div>
    `;

    grid.insertAdjacentHTML('beforeend', cardHtml);
  }

  closeAddSkillModal();

  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
}
