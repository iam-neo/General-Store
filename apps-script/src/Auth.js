/**
 * Authentication and Request Validation for Google Apps Script Backend.
 * Supports both HMAC-SHA256 signature verification and shared bearer secret comparison.
 * Enforces fail-closed configuration, constant-time comparison, and mandatory timestamp windows.
 */

var Auth = (function () {
  /**
   * Constant-time string equality check to prevent timing analysis attacks.
   */
  function constantTimeEquals(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    var result = 0;
    for (var i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Computes an HMAC-SHA256 hex digest using Apps Script Utilities.
   */
  function computeHmacSignature(data, secret) {
    var rawBytes = Utilities.computeHmacSha256Signature(data, secret);
    var hex = "";
    for (var i = 0; i < rawBytes.length; i++) {
      var b = rawBytes[i];
      if (b < 0) b += 256;
      var byteStr = b.toString(16);
      if (byteStr.length === 1) byteStr = "0" + byteStr;
      hex += byteStr;
    }
    return hex;
  }

  function verifyRequest(body, headers) {
    var configuredSecret = Config.getBackendSecret();

    // FAIL-CLOSED: Refuse requests if no backend secret is configured
    if (!configuredSecret || configuredSecret.length === 0) {
      return {
        valid: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Server security error: BACKEND_SECRET is not configured in Script Properties. Refusing unauthenticated request."
        }
      };
    }

    // MANDATORY TIMESTAMP: Enforce timestamp presence and maximum clock skew window
    if (!body || body.timestamp === undefined || body.timestamp === null) {
      return {
        valid: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request rejected: missing mandatory 'timestamp' field."
        }
      };
    }

    var clientTime = Number(body.timestamp);
    if (isNaN(clientTime)) {
      return {
        valid: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request rejected: 'timestamp' must be a valid epoch millisecond number."
        }
      };
    }

    var serverTime = new Date().getTime();
    var skew = Math.abs(serverTime - clientTime);
    var maxSkew = Config.getMaxRequestAgeMs();

    if (skew > maxSkew) {
      return {
        valid: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request timestamp rejected: clock skew exceeds maximum allowed window (" + (maxSkew / 1000) + "s)."
        }
      };
    }

    // CHECK AUTHENTICATION: 1) HMAC-SHA256 signature if present, or 2) Bearer token
    var incomingSig = (body && body.signature) || (headers && (headers["X-Signature"] || headers["x-signature"])) || "";
    if (incomingSig) {
      var dataToSign = String(body.timestamp) + "." + String(body.action || "") + "." + JSON.stringify(body.payload || {});
      var expectedSig = computeHmacSignature(dataToSign, configuredSecret);

      if (!constantTimeEquals(String(incomingSig).trim(), expectedSig)) {
        return {
          valid: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication failed: invalid HMAC request signature."
          }
        };
      }

      return { valid: true };
    }

    // Fallback: Bearer token comparison
    var incomingToken = "";
    if (body && body.token) {
      incomingToken = String(body.token).trim();
    } else if (headers) {
      var authHeader = headers["Authorization"] || headers["authorization"] || "";
      if (authHeader.indexOf("Bearer ") === 0) {
        incomingToken = authHeader.substring(7).trim();
      }
    }

    if (!incomingToken || !constantTimeEquals(incomingToken, configuredSecret)) {
      return {
        valid: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication failed: invalid or missing shared secret."
        }
      };
    }

    return { valid: true };
  }

  return {
    verifyRequest: verifyRequest,
    constantTimeEquals: constantTimeEquals,
    computeHmacSignature: computeHmacSignature
  };
})();
