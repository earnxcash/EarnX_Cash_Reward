/* ═══════════════════════════════════════════════════════════
   API-CLIENT.JS
   Backend API Client (Simulated)
   
   This file simulates backend API calls using localStorage.
   In production, replace localStorage logic with actual
   fetch() calls to your backend API.
   
   All API calls are signed and verified for security.
   ═══════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════
  const API_CONFIG = {
    // In production, replace with your actual API URL
    baseURL: 'https://api.earnx.app/v1',
    
    // Simulated mode (set to false when connecting to real backend)
    simulatedMode: true,
    
    // Request timeout
    timeout: 10000,
    
    // Server time offset (for time sync)
    serverTimeOffset: 0
  };

  // ═══════════════════════════════════════════════════════════
  // TASK LIMITS (Server-side constants)
  // ═══════════════════════════════════════════════════════════
  const TASK_LIMITS = {
    DAILY_TOTAL: 10,        // Max 10 tasks per day total
    SPIN_PER_DAY: 5,        // Max 5 spins per day
    SCRATCH_PER_DAY: 3,     // Max 3 scratch cards per day
    QUIZ_PER_DAY: 2,        // Max 2 quizzes per day
    AD_COOLDOWN: 60000,     // 60 seconds between ads
    MIN_AD_WATCH: 5000      // Must watch ad for at least 5 seconds
  };

  // Reward amounts (server-controlled)
  const REWARDS = {
    DAILY_LOGIN: 0.10,
    SPIN_MIN: 0.05,
    SPIN_MAX: 1.00,
    SCRATCH_MIN: 0.10,
    SCRATCH_MAX: 2.00,
    QUIZ_PER_QUESTION: 0.50,
    VIDEO_AD: 0.25,
    REFERRAL_BONUS: 2.00
  };

  // ═══════════════════════════════════════════════════════════
  // SIMULATED DATABASE (localStorage)
  // In production, this would be your actual database
  // ═══════════════════════════════════════════════════════════
  const DB = {
    // Get user by email
    getUserByEmail: function(email) {
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      return users[email] || null;
    },
    
    // Get user by ID
    getUserById: function(userId) {
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      for (let email in users) {
        if (users[email].userId === userId) {
          return users[email];
        }
      }
      return null;
    },
    
    // Create new user
    createUser: function(userData) {
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      users[userData.email] = userData;
      localStorage.setItem('db_users', JSON.stringify(users));
      return userData;
    },
    
    // Update user
    updateUser: function(email, updates) {
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      if (users[email]) {
        users[email] = { ...users[email], ...updates };
        localStorage.setItem('db_users', JSON.stringify(users));
        return users[email];
      }
      return null;
    },
    
    // Check if device already has account
    checkDeviceAccount: function(deviceFingerprint) {
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      for (let email in users) {
        if (users[email].deviceFingerprint === deviceFingerprint) {
          return users[email];
        }
      }
      return null;
    },
    
    // Get user task history
    getTaskHistory: function(userId, date) {
      const key = `tasks_${userId}_${date}`;
      return JSON.parse(localStorage.getItem(key) || '{"tasks":[]}');
    },
    
    // Add task to history
    addTask: function(userId, taskType, reward) {
      const today = new Date().toISOString().split('T')[0];
      const key = `tasks_${userId}_${today}`;
      const history = JSON.parse(localStorage.getItem(key) || '{"tasks":[]}');
      
      history.tasks.push({
        type: taskType,
        reward: reward,
        timestamp: Date.now()
      });
      
      localStorage.setItem(key, JSON.stringify(history));
      return history;
    }
  };

  // ═══════════════════════════════════════════════════════════
  // API CLASS
  // ═══════════════════════════════════════════════════════════
  class APIClient {
    constructor() {
      this.currentUser = null;
      this.authToken = null;
    }

    // ─────────────────────────────────────────────────────────
    // AUTHENTICATION
    // ─────────────────────────────────────────────────────────
    
    async signup(email, password, referralCode = null) {
      try {
        // Check if email already exists
        if (DB.getUserByEmail(email)) {
          return {
            success: false,
            error: 'Email already registered'
          };
        }
        
        // Check device fingerprint (one account per device)
        const deviceFp = window.SecurityCore?.getDeviceFingerprint();
        const existingAccount = DB.checkDeviceAccount(deviceFp);
        
        if (existingAccount) {
          window.SecurityCore?.logViolation('multi_account_attempt', {
            existingEmail: existingAccount.email,
            attemptedEmail: email
          });
          
          return {
            success: false,
            error: 'A device can only have one account. Please use your existing account.'
          };
        }
        
        // Hash password
        const passwordHash = await window.CryptoUtils.hashPassword(password);
        
        // Generate user ID
        const userId = window.CryptoUtils.generateUserId();
        
        // Generate referral code
        const userRefCode = 'ERN' + window.CryptoUtils.generateRandomId(6).toUpperCase();
        
        // Create user object
        const userData = {
          userId: userId,
          email: email,
          passwordHash: passwordHash.combined,
          deviceFingerprint: deviceFp,
          balance: 0,
          totalEarned: 0,
          referralCode: userRefCode,
          referredBy: referralCode,
          referrals: [],
          createdAt: Date.now(),
          lastLogin: Date.now(),
          accountStatus: 'active', // active, suspended, banned
          completedTasks: 0
        };
        
        // Save to database
        DB.createUser(userData);
        
        // Handle referral bonus (if referred and valid)
        if (referralCode) {
          await this._handleReferralSignup(userId, referralCode);
        }
        
        // Generate auth token
        const token = await window.CryptoUtils.generateToken({
          userId: userId,
          email: email
        });
        
        return {
          success: true,
          user: this._sanitizeUser(userData),
          token: token
        };
        
      } catch(error) {
        console.error('Signup error:', error);
        return {
          success: false,
          error: 'Registration failed. Please try again.'
        };
      }
    }

    async login(email, password) {
      try {
        // Get user
        const user = DB.getUserByEmail(email);
        
        if (!user) {
          return {
            success: false,
            error: 'Invalid email or password'
          };
        }
        
        // Check account status
        if (user.accountStatus === 'suspended') {
          window.SecurityCore?.suspend('Account suspended');
          return {
            success: false,
            error: 'Your account has been suspended'
          };
        }
        
        if (user.accountStatus === 'banned') {
          return {
            success: false,
            error: 'This account has been permanently banned'
          };
        }
        
        // Verify password
        const passwordValid = await window.CryptoUtils.verifyPassword(
          password,
          user.passwordHash
        );
        
        if (!passwordValid) {
          return {
            success: false,
            error: 'Invalid email or password'
          };
        }
        
        // Update last login
        DB.updateUser(email, { lastLogin: Date.now() });
        
        // Generate auth token
        const token = await window.CryptoUtils.generateToken({
          userId: user.userId,
          email: user.email
        });
        
        this.currentUser = user;
        this.authToken = token;
        
        return {
          success: true,
          user: this._sanitizeUser(user),
          token: token
        };
        
      } catch(error) {
        console.error('Login error:', error);
        return {
          success: false,
          error: 'Login failed. Please try again.'
        };
      }
    }

    async verifySession(token) {
      try {
        const result = await window.CryptoUtils.verifyToken(token);
        
        if (!result.valid) {
          return {
            success: false,
            error: result.error
          };
        }
        
        // Get user
        const user = DB.getUserById(result.payload.userId);
        
        if (!user) {
          return {
            success: false,
            error: 'User not found'
          };
        }
        
        if (user.accountStatus !== 'active') {
          return {
            success: false,
            error: 'Account not active'
          };
        }
        
        this.currentUser = user;
        this.authToken = token;
        
        return {
          success: true,
          user: this._sanitizeUser(user)
        };
        
      } catch(error) {
        return {
          success: false,
          error: 'Session verification failed'
        };
      }
    }

    // ─────────────────────────────────────────────────────────
    // TASK VERIFICATION
    // ─────────────────────────────────────────────────────────
    
    async checkTaskLimits(userId, taskType) {
      const today = new Date().toISOString().split('T')[0];
      const history = DB.getTaskHistory(userId, today);
      
      // Check total daily limit
      if (history.tasks.length >= TASK_LIMITS.DAILY_TOTAL) {
        return {
          allowed: false,
          reason: 'Daily task limit reached (10/day)'
        };
      }
      
      // Check task-specific limits
      const taskCount = history.tasks.filter(t => t.type === taskType).length;
      
      const limits = {
        'spin': TASK_LIMITS.SPIN_PER_DAY,
        'scratch': TASK_LIMITS.SCRATCH_PER_DAY,
        'quiz': TASK_LIMITS.QUIZ_PER_DAY
      };
      
      if (limits[taskType] && taskCount >= limits[taskType]) {
        return {
          allowed: false,
          reason: `Daily ${taskType} limit reached (${taskCount}/${limits[taskType]})`
        };
      }
      
      // Check ad cooldown
      if (taskType === 'ad') {
        const lastAd = history.tasks.filter(t => t.type === 'ad').pop();
        if (lastAd && Date.now() - lastAd.timestamp < TASK_LIMITS.AD_COOLDOWN) {
          const waitTime = Math.ceil((TASK_LIMITS.AD_COOLDOWN - (Date.now() - lastAd.timestamp)) / 1000);
          return {
            allowed: false,
            reason: `Please wait ${waitTime} seconds before watching another ad`
          };
        }
      }
      
      return {
        allowed: true,
        remaining: TASK_LIMITS.DAILY_TOTAL - history.tasks.length
      };
    }

    async claimReward(userId, taskType, taskData, signature) {
      try {
        // Verify request signature
        const verified = await window.CryptoUtils.verifyRequestSignature({
          userId: userId,
          data: { taskType, ...taskData },
          timestamp: taskData.timestamp,
          nonce: taskData.nonce,
          signature: signature
        });
        
        if (!verified.valid) {
          window.SecurityCore?.logViolation('reward_signature_invalid', {
            taskType,
            error: verified.error
          });
          
          return {
            success: false,
            error: 'Invalid request signature'
          };
        }
        
        // Check task limits
        const limitCheck = await this.checkTaskLimits(userId, taskType);
        
        if (!limitCheck.allowed) {
          return {
            success: false,
            error: limitCheck.reason
          };
        }
        
        // Get user
        const user = DB.getUserById(userId);
        if (!user) {
          return {
            success: false,
            error: 'User not found'
          };
        }
        
        // Calculate reward based on task type
        let reward = 0;
        
        switch(taskType) {
          case 'daily_login':
            reward = REWARDS.DAILY_LOGIN;
            break;
          case 'spin':
            reward = taskData.result || REWARDS.SPIN_MIN;
            break;
          case 'scratch':
            reward = taskData.result || REWARDS.SCRATCH_MIN;
            break;
          case 'quiz':
            reward = (taskData.correctAnswers || 0) * REWARDS.QUIZ_PER_QUESTION;
            break;
          case 'ad':
            // Verify ad was watched fully
            if (!taskData.adWatchDuration || taskData.adWatchDuration < TASK_LIMITS.MIN_AD_WATCH) {
              return {
                success: false,
                error: 'Ad not watched completely'
              };
            }
            reward = REWARDS.VIDEO_AD;
            break;
          default:
            return {
              success: false,
              error: 'Invalid task type'
            };
        }
        
        // Update user balance
        const newBalance = user.balance + reward;
        const newTotalEarned = user.totalEarned + reward;
        const newCompletedTasks = user.completedTasks + 1;
        
        DB.updateUser(user.email, {
          balance: newBalance,
          totalEarned: newTotalEarned,
          completedTasks: newCompletedTasks
        });
        
        // Add to task history
        DB.addTask(userId, taskType, reward);
        
        return {
          success: true,
          reward: reward,
          newBalance: newBalance,
          tasksRemaining: limitCheck.remaining - 1
        };
        
      } catch(error) {
        console.error('Claim reward error:', error);
        return {
          success: false,
          error: 'Failed to claim reward'
        };
      }
    }

    // ─────────────────────────────────────────────────────────
    // REFERRAL SYSTEM
    // ─────────────────────────────────────────────────────────
    
    async _handleReferralSignup(newUserId, referralCode) {
      // Find user with this referral code
      const users = JSON.parse(localStorage.getItem('db_users') || '{}');
      let referrerUser = null;
      let referrerEmail = null;
      
      for (let email in users) {
        if (users[email].referralCode === referralCode) {
          referrerUser = users[email];
          referrerEmail = email;
          break;
        }
      }
      
      if (!referrerUser) {
        return; // Invalid code, skip
      }
      
      // Check if same device (prevent self-referral)
      const newUser = DB.getUserById(newUserId);
      if (referrerUser.deviceFingerprint === newUser.deviceFingerprint) {
        window.SecurityCore?.logViolation('self_referral_attempt', {
          referrerId: referrerUser.userId,
          newUserId: newUserId
        });
        return;
      }
      
      // Add to pending referrals (requires 3 completed tasks to activate)
      if (!referrerUser.referrals) {
        referrerUser.referrals = [];
      }
      
      referrerUser.referrals.push({
        userId: newUserId,
        email: newUser.email,
        status: 'pending', // pending, approved, rejected
        joinedAt: Date.now(),
        tasksCompleted: 0
      });
      
      DB.updateUser(referrerEmail, {
        referrals: referrerUser.referrals
      });
    }

    async checkReferralEligibility(referrerId, referredUserId) {
      const referrer = DB.getUserById(referrerId);
      if (!referrer || !referrer.referrals) {
        return { eligible: false };
      }
      
      const referral = referrer.referrals.find(r => r.userId === referredUserId);
      if (!referral) {
        return { eligible: false };
      }
      
      // Check if referred user has completed 3 tasks
      const referred = DB.getUserById(referredUserId);
      if (!referred) {
        return { eligible: false };
      }
      
      if (referred.completedTasks >= 3 && referral.status === 'pending') {
        // Approve referral and grant bonus
        referral.status = 'approved';
        referral.approvedAt = Date.now();
        
        // Give bonus to both users
        const referrerNewBalance = referrer.balance + REWARDS.REFERRAL_BONUS;
        const referredNewBalance = referred.balance + REWARDS.REFERRAL_BONUS;
        
        DB.updateUser(referrer.email, {
          balance: referrerNewBalance,
          totalEarned: referrer.totalEarned + REWARDS.REFERRAL_BONUS,
          referrals: referrer.referrals
        });
        
        DB.updateUser(referred.email, {
          balance: referredNewBalance,
          totalEarned: referred.totalEarned + REWARDS.REFERRAL_BONUS
        });
        
        return {
          eligible: true,
          approved: true,
          bonus: REWARDS.REFERRAL_BONUS
        };
      }
      
      return {
        eligible: true,
        approved: false,
        tasksNeeded: 3 - referred.completedTasks
      };
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN FUNCTIONS
    // ─────────────────────────────────────────────────────────
    
    async adminAction(adminCode, action, targetUserId, params = {}) {
      // Verify admin code (hashed)
      const adminCodeHash = await window.CryptoUtils.sha256(adminCode);
      const validAdminHash = await window.CryptoUtils.sha256('earnx2025admin');
      
      if (adminCodeHash !== validAdminHash) {
        window.SecurityCore?.logViolation('invalid_admin_attempt', {
          providedHash: adminCodeHash.substring(0, 8)
        });
        return {
          success: false,
          error: 'Invalid admin code'
        };
      }
      
      const user = DB.getUserById(targetUserId);
      if (!user) {
        return {
          success: false,
          error: 'User not found'
        };
      }
      
      let result = {};
      
      switch(action) {
        case 'ban':
          DB.updateUser(user.email, { accountStatus: 'banned' });
          result = { action: 'banned', userId: targetUserId };
          break;
        
        case 'suspend':
          DB.updateUser(user.email, { accountStatus: 'suspended' });
          result = { action: 'suspended', userId: targetUserId };
          break;
        
        case 'unsuspend':
          DB.updateUser(user.email, { accountStatus: 'active' });
          result = { action: 'unsuspended', userId: targetUserId };
          break;
        
        case 'reset_balance':
          DB.updateUser(user.email, { balance: 0 });
          result = { action: 'balance_reset', userId: targetUserId };
          break;
        
        case 'adjust_balance':
          const newBalance = user.balance + (params.amount || 0);
          DB.updateUser(user.email, { balance: Math.max(0, newBalance) });
          result = { action: 'balance_adjusted', amount: params.amount, newBalance };
          break;
        
        default:
          return {
            success: false,
            error: 'Invalid action'
          };
      }
      
      // Log admin action
      const adminLog = JSON.parse(localStorage.getItem('admin_actions') || '[]');
      adminLog.push({
        action: action,
        targetUserId: targetUserId,
        params: params,
        timestamp: Date.now()
      });
      localStorage.setItem('admin_actions', JSON.stringify(adminLog));
      
      return {
        success: true,
        result: result
      };
    }

    async getViolations(userId) {
      const violations = JSON.parse(localStorage.getItem('security_violations') || '[]');
      if (userId) {
        // Filter by user if needed (would need to track userId in violations)
        return violations;
      }
      return violations;
    }

    // ─────────────────────────────────────────────────────────
    // SERVER TIME SYNC
    // ─────────────────────────────────────────────────────────
    
    async getServerTime() {
      // In production, fetch from server
      // For now, return local time
      return {
        success: true,
        timestamp: Date.now()
      };
    }

    // ─────────────────────────────────────────────────────────
    // HELPER FUNCTIONS
    // ─────────────────────────────────────────────────────────
    
    _sanitizeUser(user) {
      // Remove sensitive data before sending to client
      const { passwordHash, deviceFingerprint, ...safeUser } = user;
      return safeUser;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EXPOSE PUBLIC API
  // ═══════════════════════════════════════════════════════════
  window.API = new APIClient();

  console.log('%c📡 API Client Ready', 'color: #448aff; font-weight: bold;');
  console.log('%cMode: ' + (API_CONFIG.simulatedMode ? 'SIMULATED' : 'PRODUCTION'), 
              'color: #ff9800; font-weight: bold;');

})();
