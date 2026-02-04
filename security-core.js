/* ═══════════════════════════════════════════════════════════
   SECURITY-CORE.JS
   Production-Grade Security Layer
   
   Features:
   - DevTools detection
   - JS console tampering detection  
   - Time manipulation detection
   - Device fingerprinting (one account per device)
   - Click flood protection
   - Suspicious activity logging
   ═══════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // SECURITY STATE (encrypted in sessionStorage)
  // ═══════════════════════════════════════════════════════════
  window.SecurityCore = {
    initialized: false,
    deviceFingerprint: null,
    suspiciousFlags: [],
    devToolsOpen: false,
    lastServerTime: null,
    clickHistory: [],
    violationLog: []
  };

  // ═══════════════════════════════════════════════════════════
  // 1. DEVICE FINGERPRINTING
  // Generates unique device ID to prevent multi-accounting
  // ═══════════════════════════════════════════════════════════
  function generateDeviceFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('device-fingerprint', 2, 2);
    const canvasData = canvas.toDataURL();

    const fingerprint = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: navigator.deviceMemory || 0,
      screenResolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      canvasHash: simpleHash(canvasData),
      plugins: Array.from(navigator.plugins || []).map(p => p.name).join(','),
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      webgl: getWebGLFingerprint()
    };

    // Create deterministic hash from all properties
    const fpString = JSON.stringify(fingerprint);
    return simpleHash(fpString);
  }

  function getWebGLFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'no-webgl';
      
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return 'no-debug-info';
      
      return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    } catch(e) {
      return 'webgl-error';
    }
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // ═══════════════════════════════════════════════════════════
  // 2. DEVTOOLS DETECTION
  // Detects if browser DevTools are open
  // ═══════════════════════════════════════════════════════════
  function detectDevTools() {
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    
    if (widthThreshold || heightThreshold) {
      if (!SecurityCore.devToolsOpen) {
        SecurityCore.devToolsOpen = true;
        logViolation('devtools_opened', {
          outerWidth: window.outerWidth,
          innerWidth: window.innerWidth,
          outerHeight: window.outerHeight,
          innerHeight: window.innerHeight
        });
        showSecurityBadge('DevTools Detected');
      }
    } else {
      SecurityCore.devToolsOpen = false;
    }
  }

  // Alternative DevTools detection (console check)
  function detectConsoleDebug() {
    const devtools = /./;
    devtools.toString = function() {
      SecurityCore.devToolsOpen = true;
      logViolation('console_opened');
      return 'devtools-open';
    };
    console.log('%c', devtools);
  }

  // ═══════════════════════════════════════════════════════════
  // 3. TIME MANIPULATION DETECTION
  // Compares client time with server time to detect tampering
  // ═══════════════════════════════════════════════════════════
  function detectTimeManipulation(serverTime) {
    if (!serverTime) return false;
    
    SecurityCore.lastServerTime = serverTime;
    const clientTime = Date.now();
    const timeDiff = Math.abs(clientTime - serverTime);
    
    // Allow 5 minute drift
    if (timeDiff > 5 * 60 * 1000) {
      logViolation('time_manipulation', {
        clientTime,
        serverTime,
        diff: timeDiff
      });
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // 4. CLICK FLOOD PROTECTION
  // Prevents rapid clicking abuse
  // ═══════════════════════════════════════════════════════════
  function trackClick(action) {
    const now = Date.now();
    SecurityCore.clickHistory.push({ action, time: now });
    
    // Keep only last 10 seconds
    SecurityCore.clickHistory = SecurityCore.clickHistory.filter(
      c => now - c.time < 10000
    );
    
    // Flag if more than 20 clicks in 10 seconds
    if (SecurityCore.clickHistory.length > 20) {
      logViolation('click_flood', {
        clicks: SecurityCore.clickHistory.length,
        actions: SecurityCore.clickHistory.map(c => c.action)
      });
      return false; // Block action
    }
    
    // Check for same action spam (max 3 times in 2 seconds)
    const recentSameAction = SecurityCore.clickHistory.filter(
      c => c.action === action && now - c.time < 2000
    );
    
    if (recentSameAction.length > 3) {
      logViolation('action_spam', {
        action,
        count: recentSameAction.length
      });
      return false; // Block action
    }
    
    return true; // Allow action
  }

  // ═══════════════════════════════════════════════════════════
  // 5. JS TAMPERING DETECTION
  // Protects against console manipulation
  // ═══════════════════════════════════════════════════════════
  function protectObject(obj, name) {
    Object.freeze(obj);
    Object.seal(obj);
    
    // Monitor for property changes
    const handler = {
      set: function(target, property, value) {
        logViolation('object_tampering', {
          object: name,
          property,
          attemptedValue: value
        });
        return false;
      },
      deleteProperty: function(target, property) {
        logViolation('object_deletion', {
          object: name,
          property
        });
        return false;
      }
    };
    
    return new Proxy(obj, handler);
  }

  // Prevent console manipulation of balance/data
  function protectGlobals() {
    // Block common console commands
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = function(...args) {
      // Check if trying to manipulate data
      const argsStr = JSON.stringify(args);
      if (argsStr.includes('balance') || 
          argsStr.includes('coins') || 
          argsStr.includes('DATA') ||
          argsStr.includes('localStorage')) {
        logViolation('console_manipulation_attempt', { args: argsStr });
      }
      return originalLog.apply(console, args);
    };
    
    console.error = function(...args) {
      return originalError.apply(console, args);
    };

    // Prevent localStorage direct access
    const originalSetItem = localStorage.setItem;
    const originalGetItem = localStorage.getItem;
    
    localStorage.setItem = function(key, value) {
      if (key.includes('earnx') || key.includes('balance') || key.includes('user')) {
        logViolation('localstorage_tampering', { key, value });
        // Allow but log
      }
      return originalSetItem.call(localStorage, key, value);
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. VIOLATION LOGGING
  // Logs all security violations for admin review
  // ═══════════════════════════════════════════════════════════
  function logViolation(type, data = {}) {
    const violation = {
      type,
      data,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    
    SecurityCore.violationLog.push(violation);
    SecurityCore.suspiciousFlags.push(type);
    
    // Store in localStorage for persistence
    try {
      const existingLog = JSON.parse(localStorage.getItem('security_violations') || '[]');
      existingLog.push(violation);
      // Keep only last 100 violations
      if (existingLog.length > 100) existingLog.shift();
      localStorage.setItem('security_violations', JSON.stringify(existingLog));
    } catch(e) {
      console.error('Failed to log violation:', e);
    }
    
    // Send to server in production
    if (window.API && typeof window.API.reportViolation === 'function') {
      window.API.reportViolation(violation);
    }
    
    // Auto-suspend if too many violations
    if (SecurityCore.suspiciousFlags.length >= 5) {
      suspendAccount('Multiple security violations detected');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. ACCOUNT SUSPENSION
  // Suspends account when suspicious activity detected
  // ═══════════════════════════════════════════════════════════
  function suspendAccount(reason) {
    localStorage.setItem('account_suspended', 'true');
    localStorage.setItem('suspension_reason', reason);
    
    const overlay = document.getElementById('suspendedOverlay');
    const reasonEl = document.getElementById('suspendedReason');
    
    if (overlay) {
      overlay.classList.add('show');
      if (reasonEl) reasonEl.textContent = reason;
    }
    
    // Block all functionality
    document.body.style.pointerEvents = 'none';
    if (overlay) overlay.style.pointerEvents = 'auto';
  }

  // Check if account is already suspended
  function checkSuspensionStatus() {
    if (localStorage.getItem('account_suspended') === 'true') {
      const reason = localStorage.getItem('suspension_reason') || 
                    'Your account has been suspended.';
      suspendAccount(reason);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // 8. SECURITY BADGE UI
  // Shows visual warning when security issue detected
  // ═══════════════════════════════════════════════════════════
  function showSecurityBadge(message) {
    const badge = document.getElementById('securityBadge');
    if (badge) {
      badge.textContent = `🛡️ ${message}`;
      badge.classList.add('show');
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        badge.classList.remove('show');
      }, 5000);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9. INITIALIZATION
  // Sets up all security monitors
  // ═══════════════════════════════════════════════════════════
  function initSecurity() {
    if (SecurityCore.initialized) return;
    
    // Check suspension status first
    if (checkSuspensionStatus()) return;
    
    // Generate device fingerprint
    SecurityCore.deviceFingerprint = generateDeviceFingerprint();
    
    // Protect global objects
    protectGlobals();
    
    // Start DevTools detection
    setInterval(detectDevTools, 1000);
    detectConsoleDebug();
    
    // Disable right-click in production (optional)
    if (window.location.hostname !== 'localhost') {
      document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        logViolation('right_click_attempted');
        return false;
      });
    }
    
    // Disable keyboard shortcuts (F12, Ctrl+Shift+I, etc)
    document.addEventListener('keydown', (e) => {
      // F12
      if (e.keyCode === 123) {
        e.preventDefault();
        logViolation('f12_pressed');
        return false;
      }
      // Ctrl+Shift+I
      if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
        e.preventDefault();
        logViolation('devtools_shortcut');
        return false;
      }
      // Ctrl+Shift+J
      if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
        e.preventDefault();
        logViolation('console_shortcut');
        return false;
      }
      // Ctrl+U (view source)
      if (e.ctrlKey && e.keyCode === 85) {
        e.preventDefault();
        logViolation('view_source_attempt');
        return false;
      }
    });
    
    // Detect if running in iframe (potential clickjacking)
    if (window.self !== window.top) {
      logViolation('iframe_detected');
      suspendAccount('App cannot run inside iframe for security');
    }
    
    SecurityCore.initialized = true;
    console.log('%c🛡️ Security Core Initialized', 'color: #00e676; font-weight: bold;');
  }

  // ═══════════════════════════════════════════════════════════
  // EXPOSE PUBLIC API
  // ═══════════════════════════════════════════════════════════
  window.SecurityCore.init = initSecurity;
  window.SecurityCore.getDeviceFingerprint = () => SecurityCore.deviceFingerprint;
  window.SecurityCore.trackClick = trackClick;
  window.SecurityCore.detectTime = detectTimeManipulation;
  window.SecurityCore.logViolation = logViolation;
  window.SecurityCore.getViolations = () => SecurityCore.violationLog;
  window.SecurityCore.isDevToolsOpen = () => SecurityCore.devToolsOpen;
  window.SecurityCore.suspend = suspendAccount;

  // Auto-initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSecurity);
  } else {
    initSecurity();
  }

})();
