const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const db = require('./db');

const app = express();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const PORT = Number(process.env.PORT) || 5000;
let JWT_SECRET = process.env.JWT_SECRET;

// ==========================================
// 1. SERVER CONFIGURATION
// ==========================================

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn(
    'WARNING: JWT_SECRET invalid ya missing hai! Development fallback key use ki ja rahi hai...'
  );
  JWT_SECRET = 'fallback_default_super_secret_synqora_jwt_key_2026_x9a8b7_32chars';
  process.env.JWT_SECRET = JWT_SECRET;
}

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

function safeUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    university: user.university || '',
    role: user.role || 'user'
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role || 'user'
    },
    JWT_SECRET,
    {
      expiresIn: '2h',
      issuer: 'synqora-api',
      audience: 'synqora-frontend'
    }
  );
}

// Verify the signed-in user's JWT token.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      success: false,
      message: 'Please sign in to continue.'
    });
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET, {
      issuer: 'synqora-api',
      audience: 'synqora-frontend'
    });

    const userId = Number(payload.sub);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session.'
      });
    }

    req.auth = {
      userId,
      email: payload.email,
      role: payload.role || 'user'
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Session expired or invalid. Please sign in again.'
    });
  }
}

// Users can access their own profile, or admins can access any profile.
function requireOwnUser(req, res, next) {
  if (String(req.params.userId) !== String(req.auth.userId) && req.auth.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'You can only access your own account.'
    });
  }

  next();
}

// Admin-only access middleware
function requireAdmin(req, res, next) {
  if (req.auth.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
}

// Helper to log admin live activities
async function logAdminActivity(userId, actionType, description) {
  try {
    await db.execute(
      'INSERT INTO admin_activity_logs (user_id, action_type, description) VALUES (?, ?, ?)',
      [userId || null, actionType, description]
    );
  } catch (err) {
    console.error('Failed to log admin activity:', err.message);
  }
}

// ==========================================
// 3. STATIC FILES & ROOT LANDING PAGE
// ==========================================

// Frontend folder ki saari static files serve karne ke liye
app.use(express.static(path.join(__dirname, '../frontend')));

// Root URL par index.html return karne ke liye
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.get('/api/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');

    res.json({
      success: true,
      api: 'ok',
      database: 'ok'
    });
  } catch (error) {
    console.error('Health Check Error:', error.message);

    res.status(503).json({
      success: false,
      api: 'ok',
      database: 'unavailable'
    });
  }
});

// ==========================================
// 4. EMAIL/PASSWORD REGISTRATION
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    const password = String(req.body.password || '');
    const university =
      String(req.body.university || '').trim() || null;

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Enter a name between 2 and 100 characters.'
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid email address.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Password must be 8–128 characters long.'
      });
    }

    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          'An account with this email already exists. Please sign in.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [insertResult] = await db.execute(
      `INSERT INTO users
       (full_name, email, password_hash, university, role)
       VALUES (?, ?, ?, ?, ?)`,
      [fullName, email, passwordHash, university, 'user']
    );

    const newUserId = insertResult.insertId;

    const [newUsers] = await db.execute(
      `SELECT id, full_name, email, university, role
       FROM users WHERE id = ?`,
      [newUserId]
    );

    const user = newUsers[0];

    // Log registration activity for admin
    await logAdminActivity(newUserId, 'USER_REGISTERED', `New user registered: ${fullName} (${email})`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      user: safeUser(user),
      token: createToken(user)
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    console.error('Registration Error:', error.message);

    res.status(500).json({
      success: false,
      message: 'Could not create account. Please try again.'
    });
  }
});

// ==========================================
// 5. EMAIL/PASSWORD LOGIN
// ==========================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    const [users] = await db.execute(
      `SELECT id, full_name, email, university, password_hash, role
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const user = users[0];

    const isBcryptHash =
      typeof user.password_hash === 'string' &&
      /^\$2[aby]\$/.test(user.password_hash);

    const passwordMatches =
      isBcryptHash &&
      await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message:
          'Invalid email or password. Older demo accounts may need a password reset.'
      });
    }

    // Log login activity for admin live feed
    await logAdminActivity(user.id, 'USER_LOGIN', `User signed in: ${user.full_name} (${user.email})`);

    res.json({
      success: true,
      message: 'Signed in successfully.',
      user: safeUser(user),
      token: createToken(user)
    });
  } catch (error) {
    console.error('Login Error:', error.message);

    res.status(500).json({
      success: false,
      message: 'Could not sign in. Please try again.'
    });
  }
});

// ==========================================
// 6. GOOGLE OAUTH LOGIN/REGISTRATION
// ==========================================

app.post('/api/auth/google', async (req, res) => {
  try {
    const idToken = String(req.body.idToken || '');

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'A Google ID token is required.'
      });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({
        success: false,
        message: 'Google sign-in is not configured on this server.'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (
      !payload ||
      !payload.sub ||
      !payload.email ||
      payload.email_verified !== true
    ) {
      return res.status(401).json({
        success: false,
        message: 'Google account could not be verified.'
      });
    }

    const email = payload.email.trim().toLowerCase();

    const fullName = String(
      payload.name || email.split('@')[0]
    ).trim().slice(0, 100);

    const [existingUsers] = await db.execute(
      `SELECT id, full_name, email, university, role
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    let user;
    let isNewUser = false;

    if (existingUsers.length > 0) {
      user = existingUsers[0];
    } else {
      isNewUser = true;
      const randomPassword = crypto.randomBytes(48).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      const [insertResult] = await db.execute(
        `INSERT INTO users
         (full_name, email, password_hash, university, role)
         VALUES (?, ?, ?, ?, ?)`,
        [fullName, email, passwordHash, null, 'user']
      );

      const [newUsers] = await db.execute(
        `SELECT id, full_name, email, university, role
         FROM users WHERE id = ?`,
        [insertResult.insertId]
      );

      user = newUsers[0];
    }

    // Log Google Auth action
    await logAdminActivity(user.id, isNewUser ? 'USER_REGISTERED_GOOGLE' : 'USER_LOGIN_GOOGLE', `Google sign-in by ${user.full_name}`);

    res.json({
      success: true,
      message: 'Google account verified successfully.',
      user: safeUser(user),
      token: createToken(user)
    });
  } catch (error) {
    console.error('Google Auth Error:', error.message);

    res.status(401).json({
      success: false,
      message: 'Google sign-in failed. Please try again.'
    });
  }
});

// ==========================================
// 7. GET CURRENT SIGNED-IN USER
// ==========================================

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, full_name, email, university, role
       FROM users WHERE id = ? LIMIT 1`,
      [req.auth.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Account no longer exists.'
      });
    }

    res.json({
      success: true,
      user: safeUser(users[0])
    });
  } catch (error) {
    console.error('Current User Error:', error.message);

    res.status(500).json({
      success: false,
      message: 'Could not fetch account.'
    });
  }
});


// ==========================================
// 7B. DYNAMIC AI QUESTIONS ROUTE (GROQ + 10-QUESTION FALLBACK)
// ==========================================
function getFallbackQuestions(skillName, roundNum) {
  const suite = [
    {
      id: 1,
      type: "Standard MCQ",
      company_tag: "Amazon | 2026",
      question: `Which core data structure or paradigm in ${skillName} provides O(1) average time complexity for key-based lookups?`,
      options: ["A) Hash Table / Dictionary", "B) Linear Unsorted Array", "C) Singly Linked List", "D) FIFO Queue"],
      correct_answer: "A"
    },
    {
      id: 2,
      type: "Manual Fill-In",
      company_tag: "Google | 2025",
      question: `What is the average time complexity (in Big-O notation, e.g., O(1) or O(n)) for direct hash-indexed lookup in ${skillName}?`,
      options: [],
      correct_answer: "O(1)"
    },
    {
      id: 3,
      type: "True / False",
      company_tag: "Microsoft | 2026",
      question: `True or False: In ${skillName}, immutable primitive or tuple-like objects allow in-place memory mutation after creation.`,
      options: ["A) TRUE", "B) FALSE"],
      correct_answer: "B"
    },
    {
      id: 4,
      type: "Spot the Bug",
      company_tag: "Atlassian | 2025",
      question: `Identify the error when accessing the 4th element in a 0-indexed collection of size 3 in ${skillName}:\n\nitems = [10, 20, 30]\nval = items[3]`,
      options: ["A) IndexError / Out of Bounds", "B) SyntaxError", "C) NullPointerException on line 1", "D) StackOverflowError"],
      correct_answer: "A"
    },
    {
      id: 5,
      type: "Standard MCQ",
      company_tag: "Uber | 2026",
      question: `When optimizing ${skillName} applications for high concurrency, which technique prevents race conditions on shared state?`,
      options: ["A) Busy waiting without locks", "B) Mutex Locks / Atomic Operations", "C) Global unguarded variables", "D) Disabling garbage collection"],
      correct_answer: "B"
    },
    {
      id: 6,
      type: "Standard MCQ",
      company_tag: "Flipkart | 2025",
      question: `What is the worst-case time complexity of Binary Search on a sorted array of N elements in ${skillName}?`,
      options: ["A) O(N)", "B) O(N log N)", "C) O(log N)", "D) O(1)"],
      correct_answer: "C"
    },
    {
      id: 7,
      type: "True / False",
      company_tag: "Stripe | 2026",
      question: `True or False: Recursion without a valid termination base case leads to a Stack Overflow / RecursionError in ${skillName}.`,
      options: ["A) TRUE", "B) FALSE"],
      correct_answer: "A"
    },
    {
      id: 8,
      type: "Spot the Bug",
      company_tag: "Zomato | 2025",
      question: `What is the logical issue in the following loop condition?\n\ncount = 10\nwhile count > 0:\n    count += 1`,
      options: ["A) Infinite loop because count increases instead of decreasing", "B) SyntaxError in while header", "C) Variable count is undefined", "D) Loop executes zero times"],
      correct_answer: "A"
    },
    {
      id: 9,
      type: "Manual Fill-In",
      company_tag: "TCS Digital | 2026",
      question: `Which HTTP status code number represents 'OK / Success' in RESTful APIs built with ${skillName}?`,
      options: [],
      correct_answer: "200"
    },
    {
      id: 10,
      type: "Standard MCQ",
      company_tag: "Razorpay | 2026",
      question: `Which principle of software design in ${skillName} states that a class or module should have only one reason to change?`,
      options: ["A) Single Responsibility Principle (SRP)", "B) Liskov Substitution Principle", "C) Premature Optimization", "D) Tight Coupling"],
      correct_answer: "A"
    }
  ];
  return suite.sort(() => Math.random() - 0.5);
}

app.get('/api/questions', async (req, res) => {
  const skill = String(req.query.skill || 'Python').trim();
  const round = Number(req.query.round || 1);
  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey || typeof fetch !== 'function') {
    return res.json(getFallbackQuestions(skill, round));
  }

  const prompt = `You are Synqora's AI Assessment Engine. Generate 10 fresh, non-repeating technical assessment questions for the skill: '${skill}' (Round ${round}).
  STRICT QUESTION TYPE DISTRIBUTION:
  - 4 Standard MCQs (4 options starting with A), B), C), D))
  - 2 True / False questions (options: ["A) TRUE", "B) FALSE"])
  - 2 Manual Fill-In / Value Output prediction questions (options: [])
  - 2 Debugging / Spot the Bug scenarios (4 options starting with A), B), C), D))
  Output MUST be a valid JSON object containing a "questions" array of 10 items with keys: id, type, company_tag, question, options, correct_answer.`;

  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  for (const model of models) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Output ONLY valid JSON containing a 'questions' array of 10 technical assessment questions." },
            { role: "user", content: prompt }
          ]
        })
      });
      if (response.ok) {
        const result = await response.json();
        const content = JSON.parse(result.choices[0].message.content);
        const list = content.questions || content.data || Object.values(content)[0];
        if (Array.isArray(list) && list.length >= 5) {
          return res.json(list);
        }
      }
    } catch (err) {
      console.warn(`Groq model ${model} fallback:`, err.message);
    }
  }
  return res.json(getFallbackQuestions(skill, round));
});

// ==========================================
// 8. GET PASSPORT DETAILS BY HASH KEY
// ==========================================

app.get('/api/passport/:hashKey', async (req, res) => {
  try {
    const { hashKey } = req.params;

    const query = `
      SELECT u.full_name, u.university, s.skill_name,
             ua.score_percentage, ua.grade, ua.roster_rank,
             ua.proctoring_status, ua.hash_key, ua.issued_at
      FROM user_assessments ua
      JOIN users u ON ua.user_id = u.id
      JOIN skills s ON ua.skill_id = s.id
      WHERE ua.hash_key = ?
    `;

    const [rows] = await db.execute(query, [hashKey]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Passport Credentials Not Found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Passport API Error:', error.message);

    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
});

// ==========================================
// 9. SUBMIT ASSESSMENT & GENERATE PASSPORT
// ==========================================

app.post(
  '/api/assessment/submit',
  requireAuth,
  async (req, res) => {
    let connection;

    try {
      const {
        skill_id,
        skill_name,
        score_percentage,
        proctor_violations
      } = req.body;

      const score = Number(score_percentage);
      const violationsCount = Number(proctor_violations || 0);

      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return res.status(400).json({
          success: false,
          message: 'Score must be between 0 and 100.'
        });
      }

      if (
        !Number.isInteger(violationsCount) ||
        violationsCount < 0 ||
        violationsCount > 1000
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid proctoring violation count.'
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      let targetSkillId = Number(skill_id) || null;

      if (skill_name && String(skill_name).trim()) {
        const skillName = String(skill_name).trim().slice(0, 100);

        const [existingSkills] = await connection.execute(
          'SELECT id FROM skills WHERE skill_name = ? LIMIT 1',
          [skillName]
        );

        if (existingSkills.length > 0) {
          targetSkillId = existingSkills[0].id;
        } else {
          const [skillInsert] = await connection.execute(
            `INSERT INTO skills (skill_name, category)
             VALUES (?, ?)`,
            [skillName, 'General Technical']
          );

          targetSkillId = skillInsert.insertId;
        }
      }

      if (!targetSkillId) {
        const [skills] = await connection.execute(
          'SELECT id FROM skills ORDER BY id LIMIT 1'
        );

        if (skills.length === 0) {
          throw new Error(
            'No skills exist. Add a skill before submitting an assessment.'
          );
        }

        targetSkillId = skills[0].id;
      }

      const [validSkills] = await connection.execute(
        'SELECT id FROM skills WHERE id = ? LIMIT 1',
        [targetSkillId]
      );

      if (validSkills.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: 'Invalid skill.'
        });
      }

      let grade = 'Grade B';
      let rosterRank = 'Top 25.0%';

      if (score >= 90) {
        grade = 'Grade O';
        rosterRank = 'Top 1.0%';
      } else if (score >= 80) {
        grade = 'Grade A+';
        rosterRank = 'Top 2.5%';
      } else if (score >= 70) {
        grade = 'Grade A';
        rosterRank = 'Top 10.0%';
      }

      let proctoringStatus = '100% Clean';

      if (violationsCount > 2) {
        proctoringStatus = 'Flagged (Multiple Warnings)';
      } else if (violationsCount > 0) {
        proctoringStatus = 'Minor Warnings';
      }

      const hashHex = crypto
        .randomBytes(8)
        .toString('hex')
        .toUpperCase();

      const hashKey = `SYNQ-0x${hashHex}`;

      const [result] = await connection.execute(
        `INSERT INTO user_assessments
         (user_id, skill_id, score_percentage, grade,
          roster_rank, proctoring_status, hash_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.auth.userId,
          targetSkillId,
          score,
          grade,
          rosterRank,
          proctoringStatus,
          hashKey
        ]
      );

      if (violationsCount > 0) {
        await connection.execute(
          `INSERT INTO proctor_logs
           (assessment_id, violation_type, warning_count)
           VALUES (?, ?, ?)`,
          [
            result.insertId,
            'TAB_SWITCH_OR_FOCUS_LOST',
            violationsCount
          ]
        );
      }

      await connection.commit();

      // Log assessment verification for admin live notifications
      await logAdminActivity(req.auth.userId, 'ASSESSMENT_VERIFIED', `User completed assessment with score ${score}%`);

      res.json({
        success: true,
        message: 'Assessment submitted successfully!',
        passport_url: `passport.html?hash=${hashKey}`,
        hash_key: hashKey
      });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Rollback Error:', rollbackError.message);
        }
      }

      console.error('Assessment Submission Error:', error.message);

      res.status(500).json({
        success: false,
        message: 'Failed to process assessment result.'
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

// ==========================================
// 10. GET USER PROFILE & PASSPORTS
// ==========================================

app.get(
  '/api/user/:userId/profile',
  requireAuth,
  requireOwnUser,
  async (req, res) => {
    try {
      const userId = req.params.userId;

      const [userRows] = await db.execute(
        `SELECT id, full_name, email, university, role
         FROM users WHERE id = ?`,
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found.'
        });
      }

      const passportsQuery = `
        SELECT s.skill_name, ua.score_percentage, ua.grade,
               ua.roster_rank, ua.proctoring_status,
               ua.hash_key, ua.issued_at
        FROM user_assessments ua
        JOIN skills s ON ua.skill_id = s.id
        WHERE ua.user_id = ?
        ORDER BY ua.issued_at DESC
      `;

      const [passportRows] = await db.execute(
        passportsQuery,
        [userId]
      );

      res.json({
        success: true,
        user: userRows[0],
        passports: passportRows
      });
    } catch (error) {
      console.error('Profile API Error:', error.message);

      res.status(500).json({
        success: false,
        message: 'Failed to fetch user profile.'
      });
    }
  }
);

// ==========================================
// 11. UPDATE USER PROFILE
// ==========================================

app.post(
  '/api/user/:userId/update',
  requireAuth,
  requireOwnUser,
  async (req, res) => {
    try {
      const fullName = String(req.body.full_name || '').trim();
      const university =
        String(req.body.university || '').trim() || null;

      const email = String(req.body.email || '')
        .trim()
        .toLowerCase();

      if (fullName.length < 2 || fullName.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid full name.'
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 100
      ) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid email address.'
        });
      }

      const [result] = await db.execute(
        `UPDATE users
         SET full_name = ?, university = ?, email = ?
         WHERE id = ?`,
        [
          fullName,
          university,
          email,
          req.params.userId
        ]
      );

      if (!result.affectedRows) {
        const [existing] = await db.execute(
          'SELECT id FROM users WHERE id = ?',
          [req.params.userId]
        );

        if (!existing.length) {
          return res.status(404).json({
            success: false,
            message: 'User not found.'
          });
        }
      }

      const [updatedUsers] = await db.execute(
        `SELECT id, full_name, email, university, role
         FROM users WHERE id = ?`,
        [req.params.userId]
      );

      res.json({
        success: true,
        message: 'Profile updated successfully!',
        user: safeUser(updatedUsers[0])
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: 'That email is already in use.'
        });
      }

      console.error('Update Profile Error:', error.message);

      res.status(500).json({
        success: false,
        message: 'Failed to update profile.'
      });
    }
  }
);

// ==========================================
// 12. ADMIN ROUTES (Protected)
// ==========================================

// Get all users (Admin Only)
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, full_name, email, university, role, created_at FROM users ORDER BY id DESC'
    );
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('Admin Users API Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users.'
    });
  }
});

// Get all assessments/passports overview (Admin Only)
app.get('/api/admin/assessments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT ua.id, u.full_name, u.email, s.skill_name,
             ua.score_percentage, ua.grade, ua.roster_rank,
             ua.proctoring_status, ua.hash_key, ua.issued_at
      FROM user_assessments ua
      JOIN users u ON ua.user_id = u.id
      JOIN skills s ON ua.skill_id = s.id
      ORDER BY ua.issued_at DESC
    `;
    const [assessments] = await db.execute(query);
    res.json({
      success: true,
      assessments: assessments
    });
  } catch (error) {
    console.error('Admin Assessments API Error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assessments overview.'
    });
  }
});

// Get Live Admin Activity Logs & Notifications (Admin Only)
app.get('/api/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [logs] = await db.execute(`
      SELECT al.id, al.user_id, al.action_type, al.description, al.created_at, u.full_name, u.email
      FROM admin_activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Admin Logs Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch activity logs.' });
  }
});

// ==========================================
// 13. TEAMMATE, CHAT & REQUEST ROUTES (Protected)
// ==========================================

// Get all registered users for "Find Teammates"
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.auth.userId;
    const [users] = await db.execute(
      'SELECT id, full_name, email, university, role FROM users WHERE id != ? ORDER BY id DESC',
      [currentUserId]
    );
    res.json({ success: true, users });
  } catch (error) {
    console.error('Fetch Users API Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch users list.' });
  }
});

// Send a join/chat request to another user
app.post('/api/requests/send', requireAuth, async (req, res) => {
  try {
    const senderId = req.auth.userId;
    const { receiver_id, project_title } = req.body;

    if (!receiver_id || !project_title) {
      return res.status(400).json({ success: false, message: 'Receiver and project title are required.' });
    }

    if (Number(senderId) === Number(receiver_id)) {
      return res.status(400).json({ success: false, message: 'You cannot send a request to yourself.' });
    }

    await db.execute(
      'INSERT INTO project_requests (sender_id, receiver_id, project_title, status) VALUES (?, ?, ?, ?)',
      [senderId, receiver_id, project_title, 'pending']
    );

    await logAdminActivity(senderId, 'CONNECTION_REQUEST_SENT', `User sent connection request for project: ${project_title}`);

    res.json({ success: true, message: 'Request sent successfully!' });
  } catch (error) {
    console.error('Send Request Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send request.' });
  }
});

// Get incoming/outgoing requests for logged-in user
app.get('/api/requests', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [requests] = await db.execute(`
      SELECT pr.id, pr.project_title, pr.status, pr.created_at,
             IF(pr.sender_id = ?, pr.receiver_id, pr.sender_id) as peer_id,
             u.full_name as peer_name, u.email as peer_email,
             pr.sender_id, pr.receiver_id
      FROM project_requests pr
      JOIN users u ON u.id = IF(pr.sender_id = ?, pr.receiver_id, pr.sender_id)
      WHERE pr.receiver_id = ? OR pr.sender_id = ?
      ORDER BY pr.created_at DESC
    `, [userId, userId, userId, userId]);

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Fetch Requests Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch requests.' });
  }
});

// Accept or Decline a request
app.post('/api/requests/:requestId/update', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body; // 'accepted' or 'declined'

    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status update.' });
    }

    await db.execute(
      'UPDATE project_requests SET status = ? WHERE id = ?',
      [status, requestId]
    );

    await logAdminActivity(req.auth.userId, 'REQUEST_STATUS_UPDATED', `Connection request ${status}`);

    res.json({ success: true, message: `Request ${status} successfully!` });
  } catch (error) {
    console.error('Update Request Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update request.' });
  }
});

// Get accepted project members / teammates for logged-in user
app.get('/api/project-members', requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const [members] = await db.execute(`
      SELECT pr.project_title, pr.updated_at,
             CASE 
               WHEN pr.sender_id = ? THEN pr.receiver_id 
               ELSE pr.sender_id 
             END as member_id,
             u.full_name as member_name, u.email as member_email, u.university
      FROM project_requests pr
      JOIN users u ON u.id = CASE 
                            WHEN pr.sender_id = ? THEN pr.receiver_id 
                            ELSE pr.sender_id 
                          END
      WHERE (pr.receiver_id = ? OR pr.sender_id = ?) AND pr.status = 'accepted'
    `, [userId, userId, userId, userId]);

    res.json({ success: true, members });
  } catch (error) {
    console.error('Fetch Project Members Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch project members.' });
  }
});

// Send a chat message
app.post('/api/chat/send', requireAuth, async (req, res) => {
  try {
    const senderId = req.auth.userId;
    const { receiver_id, message } = req.body;

    if (!receiver_id || !message) {
      return res.status(400).json({ success: false, message: 'Receiver and message are required.' });
    }

    await db.execute(
      'INSERT INTO chat_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
      [senderId, receiver_id, message]
    );

    res.json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Send Chat Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// Get chat history between logged-in user and another user
app.get('/api/chat/:userId', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.auth.userId;
    const targetUserId = req.params.userId;

    const [messages] = await db.execute(`
      SELECT * FROM chat_messages 
      WHERE (sender_id = ? AND receiver_id = ?) 
         OR (sender_id = ? AND receiver_id = ?)
      ORDER BY sent_at ASC
    `, [currentUserId, targetUserId, targetUserId, currentUserId]);

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Fetch Chat Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch chat history.' });
  }
});

// ==========================================
// 14. GLOBAL ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    message: 'Unexpected server error.'
  });
});

// ==========================================
// 15. START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(
    `Synqora Backend running on http://localhost:${PORT}`
  );
});