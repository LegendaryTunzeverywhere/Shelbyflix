# Security Policy

## 🔒 Reporting a Vulnerability

We take security seriously at ShelbyFlix. If you discover a security vulnerability, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please report security issues via one of these methods:

1. **GitHub Security Advisories** (Recommended)
   - Go to: https://github.com/Legendarytunzeverywhere/shelbyflix/security/advisories
   - Click "Report a vulnerability"
   - Fill out the form with details

2. **Email**
   - Send to: security@shelbyflix.com (replace with actual email)
   - Use subject line: "Security Vulnerability Report"
   - Include detailed information about the vulnerability

### What to Include

Please provide as much information as possible:

- **Type of vulnerability** (e.g., XSS, SQL injection, authentication bypass)
- **Location** (file path, URL, or function where the vulnerability exists)
- **Steps to reproduce** (detailed, step-by-step instructions)
- **Impact** (what an attacker could do with this vulnerability)
- **Suggested fix** (if you have one)
- **Your contact information** (for follow-up questions)

### Response Timeline

- **24 hours:** Initial acknowledgment of your report
- **7 days:** Preliminary assessment and severity classification
- **30 days:** Fix developed, tested, and deployed (for high-severity issues)
- **90 days:** Public disclosure (coordinated with reporter)

We appreciate your patience during the investigation and fix process.

---

## 🛡️ Security Best Practices

### For Users

1. **Keep your wallet secure**
   - Never share your private keys or seed phrases
   - Use hardware wallets for large amounts
   - Verify wallet addresses before signing transactions

2. **Verify transaction details**
   - Always check transaction details in your wallet before signing
   - Confirm the contract address matches the official one
   - Be wary of unexpected permission requests

3. **Use strong passwords**
   - For Supabase accounts and any admin access
   - Enable 2FA where available

4. **Keep software updated**
   - Update your browser regularly
   - Keep wallet extensions up to date
   - Update Node.js for local development

### For Developers

1. **Environment Variables**
   - Never commit `.env.local` to git
   - Never expose service role keys in client-side code
   - Use `NEXT_PUBLIC_` prefix only for truly public variables
   - Rotate API keys regularly

2. **Smart Contract Interactions**
   - Always validate transaction responses
   - Check for transaction success before updating state
   - Verify contract addresses before calling functions
   - Use TypeScript for type safety

3. **Database Security**
   - Keep Row Level Security (RLS) enabled
   - Use service role client only in API routes (server-side)
   - Never expose service role key to the client
   - Sanitize all user inputs before database queries

4. **Encryption**
   - Video encryption keys are generated client-side
   - Keys stored in database are encrypted at rest (by Supabase)
   - Never log encryption keys
   - Use secure random number generators

5. **Authentication**
   - Verify wallet signatures on the server
   - Use nonce-based challenge-response
   - Implement rate limiting
   - Validate all user inputs

---

## 🔐 Known Security Considerations

### Encryption Key Storage

**Current Approach:**
- Encryption keys are stored in Supabase database
- Protected by RLS policies
- Encrypted at rest by Supabase

**Considerations:**
- Supabase admins could theoretically access keys
- For maximum security, consider:
  - Client-side key derivation from wallet signature
  - Hardware wallet integration
  - Threshold encryption schemes

### Access Control

**Blockchain-First:**
- Access policies stored on Aptos blockchain (immutable)
- Supabase mirrors blockchain state (for performance)
- Always verify critical operations on-chain

**Trust Model:**
- If `NEXT_PUBLIC_ACCESS_BACKEND=supabase`, you trust the database
- If `NEXT_PUBLIC_ACCESS_BACKEND=move`, you trust the blockchain
- Recommended: Use `move` for production

### Service Role Key

**Purpose:**
- Bypasses RLS for privileged operations
- Used only in server-side API routes
- Never exposed to client

**Security:**
- Keep in `.env.local` (server-only)
- Rotate periodically
- Never commit to git
- Monitor usage via Supabase logs

---

## 📋 Security Checklist

Before deploying to production:

- [ ] All environment variables properly configured
- [ ] Service role key kept secret (not in git)
- [ ] RLS policies enabled and tested on all tables
- [ ] API routes validate wallet signatures
- [ ] Rate limiting implemented (middleware.ts)
- [ ] CORS configured properly
- [ ] CSP headers configured (next.config.js)
- [ ] Dependencies updated (npm audit)
- [ ] Smart contract addresses verified
- [ ] HTTPS enabled on deployment
- [ ] Error messages don't leak sensitive data
- [ ] Logging doesn't include secrets
- [ ] Database backups configured

---

## 🔍 Dependency Security

We regularly audit dependencies for known vulnerabilities.

### Check for Vulnerabilities

```bash
# Check for known vulnerabilities
npm audit

# Fix automatically (if possible)
npm audit fix

# Review high-severity issues
npm audit --audit-level=high
```

### Update Dependencies

```bash
# Update all dependencies
npm update

# Update Next.js
npm install next@latest react@latest react-dom@latest

# Update Aptos SDK
npm install @aptos-labs/ts-sdk@latest
```

---

## 🚨 Past Security Issues

We maintain transparency about resolved security issues:

### None Yet

This project is new. As security issues are discovered and fixed, we'll document them here.

---

## 📜 Security Disclosure Policy

### Coordinated Disclosure

We follow coordinated disclosure:

1. **Private disclosure** to maintainers
2. **Investigation and fix** (target: 30 days)
3. **Patch released** (security advisory published)
4. **Public disclosure** (90 days after report, or after fix)

### Hall of Fame

We recognize security researchers who help us:

| Researcher | Vulnerability | Date | Severity |
|------------|---------------|------|----------|
| *No entries yet* | - | - | - |

If you report a valid security issue, we'll credit you here (with your permission).

---

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Aptos Security Best Practices](https://aptos.dev/guides/move-guides/move-security-guidelines/)
- [Next.js Security](https://nextjs.org/docs/app/building-your-application/configuring/security)
- [Supabase Security](https://supabase.com/docs/guides/platform/security)

---

## 📞 Contact

- **Security Issues:** Use GitHub Security Advisories
- **General Questions:** [GitHub Discussions](https://github.com/Legendarytunzeverywhere/shelbyflix/discussions)
- **Twitter:** [@ShelbyFlix](https://twitter.com/shelbyflix) (replace with actual)

---

<div align="center">
  <strong>Thank you for helping keep ShelbyFlix secure! 🔒</strong>
</div>
