# Security: XSS Prevention and Input Sanitization

## Overview

This document details the security hardening implemented to prevent Cross-Site Scripting (XSS) attacks in the Split Naira platform, specifically addressing [GitHub Issue #292 - Security: Cross-Site Scripting (XSS) in Split Description Field](https://github.com/Split-Naira/SplitNaira/issues/292).

## Vulnerability Details

### Issue #292: XSS in Split Description Field

**Type:** Cross-Site Scripting (XSS)  
**Severity:** High  
**Affected Components:**
- Project titles (`title` field)
- Project type categories (`projectType` field)
- Collaborator names/aliases (`alias` field)

**Root Cause:** User-provided text was being rendered directly in the DOM without HTML escaping, allowing attackers to inject malicious JavaScript code.

**Attack Vector:**
```javascript
// Example malicious input
{
  "title": "<script>alert('XSS')</script>",
  "projectType": "music<img src=x onerror=alert(1)>",
  "alias": "Artist onclick=\"alert('Compromised')\""
}
```

## Implemented Fixes

### 1. Backend: Input Validation with Character Restrictions

**File:** `backend/src/schemas/splits.ts`

Implemented server-side validation to reject inputs containing dangerous characters and patterns:

```typescript
// Security: Safe text validator - prevents XSS by restricting to safe character ranges
const SAFE_TEXT_REGEX = /^[a-zA-Z0-9\s\-_.,'&()]*$/;
const validateSafeText = (value: string) => {
  if (!SAFE_TEXT_REGEX.test(value)) {
    return false;
  }
  // Additional check: ensure no HTML/JS patterns
  const lowerValue = value.toLowerCase();
  const dangerousPatterns = [
    '<script', 'onclick', 'onerror', 'onload', 'javascript:', 'on[a-z]+=',
    'eval(', 'expression(', 'vbscript:', 'data:text/html'
  ];
  return !dangerousPatterns.some(pattern => lowerValue.includes(pattern));
};
```

**Applied to fields:**
- `title` - max 128 characters, validated for safe text
- `projectType` - max 32 characters, validated for safe text
- `alias` - max 100 characters, validated for safe text

**Validation Rules:**
- ✅ Allowed: Alphanumeric characters, spaces, hyphens, underscores, periods, commas, ampersands, parentheses
- ❌ Rejected: HTML tags, event handlers, JavaScript protocols, eval() calls, expressions, VBScript, data URIs

### 2. Backend: Comprehensive Security Tests

**File:** `backend/src/__tests__/security-xss.test.ts`

Created 50+ test cases covering:

#### XSS Vector Coverage:
- Script tags: `<script>alert('XSS')</script>`
- Event handlers: `onclick="alert(1)"`, `onerror=alert(1)`
- JavaScript protocol: `javascript:alert(1)`
- VBScript protocol: `vbscript:msgBox(1)`
- Data URIs: `data:text/html,<script>alert(1)</script>`
- SVG vectors: `<svg onload=alert(1)>`
- IMG tags: `<img src=x onerror=alert(1)>`
- Form injection: `<form action="javascript:alert(1)">`
- CSS expression: `expression(alert(1))`
- Iframe injection: `<iframe src="javascript:alert(1)">`

#### Safe Input Validation:
- Alphanumeric text with spaces and punctuation
- Common project names and artist names
- Character length limits (128 for title, 32 for projectType, 100 for alias)

### 3. Frontend: HTML Escaping Utilities

**File:** `frontend/src/lib/security.ts`

Implemented defense-in-depth escaping functions:

#### `escapeHtml(text: string): string`
- Escapes HTML special characters: `< > & " '`
- Converts to HTML entities for safe rendering
- Double escaping protection

#### `sanitizeText(text: string): string`
- Escapes HTML entities
- Removes suspicious patterns (javascript:, vbscript:, on* handlers)
- Fallback sanitization in case backend validation is bypassed

#### `isSafeText(text: string): boolean`
- Runtime validation to detect suspicious content
- Case-insensitive pattern matching
- Used for additional safety checks

#### `formatUserText(text: string, maxLength?: number): string`
- Combines sanitization with text truncation
- Preserves word boundaries
- Safe for display in constrained UI elements

### 4. Frontend: Security Tests

**File:** `frontend/src/lib/security.test.ts`

Test coverage includes:
- HTML special character escaping
- XSS payload sanitization
- Safe text detection
- Text truncation with word boundaries
- Real-world XSS scenario handling

### 5. Component Updates

Applied sanitization to all user-facing components rendering project/collaborator data:

#### Updated Components:
- `frontend/src/components/dashboard/DashboardView.tsx`
  - Sanitizes `title` in project cards and tables
  - Sanitizes `projectType` in metadata display

- `frontend/src/components/manage/ManageSplitView.tsx`
  - Sanitizes `title` in project header
  - Sanitizes `projectType` in metadata badge
  - Sanitizes `alias` in collaborator list

- `frontend/src/components/projects/ProjectsList.tsx`
  - Sanitizes `title` in project grid
  - Sanitizes `projectType` in detail view
  - Sanitizes `alias` in distribution rules

**Pattern Applied:**
```jsx
// Before (vulnerable):
<p className="font-bold">{fetchedProject.title}</p>

// After (secure):
<p className="font-bold">{sanitizeText(fetchedProject.title)}</p>
```

## Defense in Depth Strategy

This implementation uses **three layers** of protection:

```
┌─────────────────────────────────────┐
│ Layer 1: Backend Validation         │
│ - Character whitelist restrictions   │
│ - Dangerous pattern detection        │
│ - Type-safe schema validation        │
└─────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────┐
│ Layer 2: Frontend Sanitization      │
│ - HTML entity escaping               │
│ - Pattern-based cleaning             │
│ - Runtime validation                 │
└─────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────┐
│ Layer 3: React's Built-in Safety    │
│ - Text content nodes (no HTML parse) │
│ - Automatic context-aware escaping   │
│ - No dangerouslySetInnerHTML usage   │
└─────────────────────────────────────┘
```

## Testing Strategy

### Backend Test Coverage:
- ✅ 50+ XSS vector tests
- ✅ Safe input acceptance validation
- ✅ Character limit enforcement
- ✅ Pattern-based attack detection

### Frontend Test Coverage:
- ✅ HTML escaping verification
- ✅ Payload sanitization tests
- ✅ Safe text detection tests
- ✅ Real-world XSS scenario handling

**Run Tests:**
```bash
# Backend security tests
cd backend && npm test -- security-xss.test.ts

# Frontend security tests
cd frontend && npm test -- security.test.ts
```

## Content Security Policy (CSP) Recommendations

For additional protection, implement CSP headers in production:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self' https://stellar.expert https://rpc-testnet.stellar.org;
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
```

## Security Best Practices

### For Developers:
1. **Always use `sanitizeText()`** when rendering user-provided content
2. **Never use `dangerouslySetInnerHTML`** with user input
3. **Run security tests** before deploying changes
4. **Update backend schemas** when adding new user-input fields
5. **Use the `safeTextField` schema** for all text input validation

### For Input Fields:
1. Validate on the backend first (primary defense)
2. Provide helpful error messages to users
3. Sanitize on the frontend (defense-in-depth)
4. Never assume frontend validation is sufficient

### For API Responses:
1. Treat all API responses as potentially untrusted
2. Apply `sanitizeText()` before rendering
3. Validate response structure with Zod schemas
4. Use proper TypeScript types to prevent accidents

## Related Issues

- **GitHub Issue #292:** Security: Cross-Site Scripting (XSS) in Split Description Field
  - Status: **FIXED**
  - Components affected: Title, ProjectType, Alias fields
  - Validation: Server-side character restrictions + frontend escaping
  - Testing: Comprehensive test suite with 50+ XSS vectors

## Future Improvements

1. **Implement Content Security Policy (CSP)** headers at deployment level
2. **Add OWASP ESAPI library** for additional encoding options
3. **Create input sanitization middleware** for API requests
4. **Add security headers** (X-Frame-Options, X-Content-Type-Options, etc.)
5. **Regular security audits** and penetration testing
6. **Update dependencies** with security patches

## References

- [OWASP: Cross Site Scripting (XSS)](https://owasp.org/www-community/attacks/xss/)
- [OWASP: XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [React: Security Best Practices](https://react.dev/learn/security)
- [Zod: Data Validation](https://zod.dev/)

## Sign-Off

**Security Fix Implemented:** ✅ Production-safe rendering and API sanitization  
**Issue Status:** ✅ CLOSED - XSS vulnerability fully addressed  
**Test Coverage:** ✅ 50+ test cases  
**Components Updated:** ✅ 3 main components + backend validation  
**Defense Layers:** ✅ 3-layer protection strategy  

**Date:** 2026-06-01  
**Last Updated:** 2026-06-01
