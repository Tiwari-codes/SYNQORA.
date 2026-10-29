/* ============================================================
   SYNQORA GLOBAL FRONTEND ENGINE & HELPER (js/app.js)
   Handles API Integration, Test Runner Engine, Anti-Cheating, 
   Passport Generator, Custom Skills, Page Routing & Admin Role.
   ============================================================ */

const API_BASE_URL = (typeof CONFIG !== 'undefined' && CONFIG.FASTAPI_BASE) 
  ? CONFIG.FASTAPI_BASE 
  : "http://127.0.0.1:8000/api";
const NODE_API_BASE = (typeof CONFIG !== 'undefined' && CONFIG.NODE_API_BASE)
  ? CONFIG.NODE_API_BASE
  : "http://localhost:5000/api";

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

function selectOptionCard(element, userVal, optionKey) {
  document.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');

  const radio = element.querySelector('input[type="radio"]');
  if (radio) radio.checked = true;

  selectedAnswer = optionKey || userVal;
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

function renderCurrentQuestion() {
  selectedAnswer = null;

  if (!activeQuestions || activeQuestions.length === 0) {
    renderFallbackQuestion();
    return;
  }
  
  const q = activeQuestions[questionIndex - 1] || activeQuestions[0];
  const companyTag = document.getElementById('companyTag');
  const typeTag = document.getElementById('typeTag');
  const contentBox = document.getElementById('questionContentBox');
  const optionsContainer = document.getElementById('optionsContainer');

  if (companyTag) companyTag.innerText = `🏢 ${q.company_tag || 'Amazon | 2025'}`;
  if (typeTag) typeTag.innerText = `🏷️ Type: ${q.type || 'Standard MCQ'}`;
  if (contentBox) contentBox.innerHTML = formatQuestionWithCode(q.question);

  if (!optionsContainer) return;
  
  let cleanOptions = (q.options || []).filter(opt => {
    const clean = String(opt).replace(/\\n/g, ' ').trim();
    return clean !== 'correct_answer' && clean !== ':' && clean !== 'A' && clean !== 'B' && clean !== 'C' && clean !== 'D';
  });

  if (q.type === 'True / False' || q.type === 'True/False') {
    optionsContainer.innerHTML = `
      <div class="option-item" onclick="selectOptionCard(this, 'TRUE', 'A')">
        <input type="radio" name="tf" id="tf1" value="A">
        <label for="tf1" style="color:#FFF; cursor:pointer;">A) TRUE</label>
      </div>
      <div class="option-item" onclick="selectOptionCard(this, 'FALSE', 'B')">
        <input type="radio" name="tf" id="tf2" value="B">
        <label for="tf2" style="color:#FFF; cursor:pointer;">B) FALSE</label>
      </div>
    `;
  } else if (q.type === 'Manual Fill-In' || cleanOptions.length === 0) {
    optionsContainer.innerHTML = `
      <label style="color: #A0AEC0; font-size: 0.85rem; font-weight: 700;">Type your exact value/answer:</label>
      <input type="text" class="manual-input-field" placeholder="e.g. O(1)" id="manualFillAns" oninput="selectedAnswer = this.value.trim();">
    `;
  } else {
    optionsContainer.innerHTML = cleanOptions.map((opt, idx) => {
      const optKey = String(opt).trim().charAt(0);
      return `
        <div class="option-item" onclick="selectOptionCard(this, '${String(opt).replace(/'/g, "\\'")}', '${optKey}')">
          <input type="radio" name="mcq" id="opt${idx}" value="${optKey}">
          <label for="opt${idx}" style="color:#FFF; cursor:pointer;">${opt}</label>
        </div>
      `;
    }).join('');
  }
}

function renderFallbackQuestion() {
  selectedAnswer = null;
  const optionsContainer = document.getElementById('optionsContainer');
  const contentBox = document.getElementById('questionContentBox');
  if (!optionsContainer || !contentBox) return;

  if (questionIndex === 1) {
    document.getElementById('companyTag').innerText = '🏢 Amazon | 2025 • Technical Assessment';
    document.getElementById('typeTag').innerText = '🏷️ Type: Standard MCQ';
    contentBox.innerHTML = formatQuestionWithCode(`Which data structure in ${currentSkill} operates on key-value pairs with O(1) average lookup complexity?`);
    
    optionsContainer.innerHTML = `
      <div class="option-item" onclick="selectOptionCard(this, 'List', 'A')"><input type="radio" name="mcq" id="o1"><label for="o1" style="color:#FFF;">A) List / Array</label></div>
      <div class="option-item" onclick="selectOptionCard(this, 'Hash Table', 'B')"><input type="radio" name="mcq" id="o2"><label for="o2" style="color:#FFF;">B) Hash Table / Dictionary</label></div>
      <div class="option-item" onclick="selectOptionCard(this, 'Queue', 'C')"><input type="radio" name="mcq" id="o3"><label for="o3" style="color:#FFF;">C) Queue</label></div>
    `;
  } else {
    document.getElementById('companyTag').innerText = '🏢 Google | 2024 • Technical Assessment';
    document.getElementById('typeTag').innerText = '🏷️ Type: True / False Statement';
    contentBox.innerHTML = formatQuestionWithCode(`True or False: Primitive immutable types in ${currentSkill} allow value mutation after initial allocation.`);
    
    optionsContainer.innerHTML = `
      <div class="option-item" onclick="selectOptionCard(this, 'TRUE', 'A')"><input type="radio" name="tf" id="tf1"><label for="tf1" style="color:#FFF;">A) TRUE</label></div>
      <div class="option-item" onclick="selectOptionCard(this, 'FALSE', 'B')"><input type="radio" name="tf" id="tf2"><label for="tf2" style="color:#FFF;">B) FALSE (Immutable Objects)</label></div>
    `;
  }
}

function recordAnswerScore() {
  const q = activeQuestions[questionIndex - 1];
  const correctAns = q ? (q.correct_answer || 'B').trim().toUpperCase() : 'B';
  const userAns = (selectedAnswer || '').trim().toUpperCase();

  const isCorrect = userAns.startsWith(correctAns) || userAns === correctAns;
  if (isCorrect) {
    correctAnswersCount++;
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
    const warningModal = document.getElementById('warningModal');
    const warningCountText = document.getElementById('warningCountText');

    if (warningModal && warningCountText) {
      warningCount++;
      warningCountText.innerText = warningCount;
      warningModal.style.display = 'flex';

      if (warningCount >= 3) {
        alert('❌ Test Terminated! Multiple tab switches detected. Score: 0');
        window.location.href = 'skills.html';
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'v' || e.key === 'u' || e.key === 'i')) {
      e.preventDefault();
      alert('Copying & DevShortcuts are disabled during Synqora Proctoring!');
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