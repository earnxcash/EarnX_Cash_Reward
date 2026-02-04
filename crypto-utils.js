/* ═══════════════════════════════════════════════════════════
   CRYPTO-UTILS.JS
   Cryptographic utilities for secure authentication
   
   Features:
   - SHA-256 password hashing
   - JWT-style token generation/validation
   - Secure random token generation
   - HMAC signatures for request verification
   ═══════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  window.CryptoUtils = {};

  // ═══════════════════════════════════════════════════════════
  // 1. SHA-256 HASHING (Browser-native implementation)
  // ═══════════════════════════════════════════════════════════
  async function sha256(message) {
    // Encode as UTF-8
    const msgBuffer = new TextEncoder().encode(message);
    
    // Hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    
    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  }

  // ═══════════════════════════════════════════════════════════
  // 2. PASSWORD HASHING WITH SALT
  // Adds random salt to password before hashing
  // ═══════════════════════════════════════════════════════════
  async function hashPassword(password, salt = null) {
    // Generate random salt if not provided
    if (!salt) {
      salt = generateSalt();
    }
    
    // Combine password + salt
    const combined = password + salt;
    
    // Hash with SHA-256
    const hash = await sha256(combined);
    
    return {
      hash: hash,
      salt: salt,
      combined: `${hash}:${salt}` // Store format: hash:salt
    };
  }

  // Verify password against stored hash
  async function verifyPassword(password, storedHash) {
    // Split stored hash into hash:salt
    const [hash, salt] = storedHash.split(':');
    
    if (!hash || !salt) return false;
    
    // Hash provided password with stored salt
    const result = await hashPassword(password, salt);
    
    // Compare hashes (timing-safe comparison)
    return timingSafeEqual(result.hash, hash);
  }

  // Generate random salt
  function generateSalt(length = 32) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // Timing-safe string comparison
  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. JWT-STYLE TOKEN GENERATION
  // Creates secure session tokens
  // ═══════════════════════════════════════════════════════════
  async function generateToken(payload, secret = null) {
    if (!secret) {
      secret = getOrCreateSecret();
    }
    
    // Add standard claims
    const fullPayload = {
      ...payload,
      iat: Math.floor(Date.now() / 1000), // Issued at
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // Expires in 7 days
      jti: generateRandomId() // JWT ID (unique token ID)
    };
    
    // Create header
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Base64url encode
    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
    
    // Create signature
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    const signature = await hmacSHA256(dataToSign, secret);
    const encodedSignature = base64urlEncode(signature);
    
    // Combine into JWT
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  // Verify and decode JWT token
  async function verifyToken(token, secret = null) {
    if (!secret) {
      secret = getOrCreateSecret();
    }
    
    try {
      // Split token
      const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
      
      if (!encodedHeader || !encodedPayload || !encodedSignature) {
        return { valid: false, error: 'Invalid token format' };
      }
      
      // Verify signature
      const dataToVerify = `${encodedHeader}.${encodedPayload}`;
      const expectedSignature = await hmacSHA256(dataToVerify, secret);
      const expectedEncoded = base64urlEncode(expectedSignature);
      
      if (!timingSafeEqual(encodedSignature, expectedEncoded)) {
        return { valid: false, error: 'Invalid signature' };
      }
      
      // Decode payload
      const payload = JSON.parse(base64urlDecode(encodedPayload));
      
      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }
      
      return {
        valid: true,
        payload: payload
      };
      
    } catch(e) {
      return { valid: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. HMAC-SHA256 SIGNATURE
  // For request verification
  // ═══════════════════════════════════════════════════════════
  async function hmacSHA256(message, secret) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);
    
    // Import key
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Sign
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    
    // Convert to hex
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Sign request data (for API calls)
  async function signRequest(data, userId, secret = null) {
    if (!secret) {
      secret = getOrCreateSecret();
    }
    
    const timestamp = Date.now();
    const nonce = generateRandomId();
    
    // Create signature payload
    const payload = {
      userId: userId,
      data: data,
      timestamp: timestamp,
      nonce: nonce
    };
    
    // Create signature
    const dataString = JSON.stringify(payload);
    const signature = await hmacSHA256(dataString, secret);
    
    return {
      ...payload,
      signature: signature
    };
  }

  // Verify request signature
  async function verifyRequestSignature(request, secret = null) {
    if (!secret) {
      secret = getOrCreateSecret();
    }
    
    const { signature, ...payload } = request;
    
    // Recreate signature
    const dataString = JSON.stringify(payload);
    const expectedSignature = await hmacSHA256(dataString, secret);
    
    // Verify
    if (!timingSafeEqual(signature, expectedSignature)) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    // Check timestamp (within 5 minutes)
    const now = Date.now();
    if (Math.abs(now - payload.timestamp) > 5 * 60 * 1000) {
      return { valid: false, error: 'Request expired' };
    }
    
    return { valid: true, payload };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════
  
  // Base64url encoding
  function base64urlEncode(str) {
    if (typeof str === 'object') {
      str = JSON.stringify(str);
    }
    
    const base64 = btoa(
      String.fromCharCode.apply(null, 
        new TextEncoder().encode(str)
      )
    );
    
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  // Base64url decoding
  function base64urlDecode(str) {
    // Add padding
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
      str += '=';
    }
    
    const decoded = atob(str);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    
    return new TextDecoder().decode(bytes);
  }

  // Generate random ID
  function generateRandomId(length = 16) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(36)).join('').substring(0, length);
  }

  // Get or create app secret (stored in localStorage)
  function getOrCreateSecret() {
    let secret = localStorage.getItem('app_secret');
    
    if (!secret) {
      secret = generateRandomId(64);
      localStorage.setItem('app_secret', secret);
    }
    
    return secret;
  }

  // Generate unique user ID
  function generateUserId() {
    const timestamp = Date.now().toString(36);
    const random = generateRandomId(12);
    const deviceFp = window.SecurityCore?.getDeviceFingerprint() || 'unknown';
    
    return `usr_${timestamp}_${random}_${deviceFp.substring(0, 8)}`;
  }

  // ═══════════════════════════════════════════════════════════
  // EXPOSE PUBLIC API
  // ═══════════════════════════════════════════════════════════
  window.CryptoUtils = {
    // Password hashing
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    sha256: sha256,
    
    // Token management
    generateToken: generateToken,
    verifyToken: verifyToken,
    
    // Request signing
    signRequest: signRequest,
    verifyRequestSignature: verifyRequestSignature,
    hmacSHA256: hmacSHA256,
    
    // Utilities
    generateRandomId: generateRandomId,
    generateUserId: generateUserId,
    generateSalt: generateSalt,
    base64urlEncode: base64urlEncode,
    base64urlDecode: base64urlDecode
  };

  console.log('%c🔐 Crypto Utils Loaded', 'color: #ffb300; font-weight: bold;');

})();
