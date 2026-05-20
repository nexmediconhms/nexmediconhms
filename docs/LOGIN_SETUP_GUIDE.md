# Login OTP / Magic Link Setup Guide

## Problem: "Not receiving OTP email" or "Login button in email doesn't work"

### Root Causes & Fixes

---

## 1. Supabase Email Configuration (MOST COMMON ISSUE)

Go to **Supabase Dashboard → Authentication → Email Templates** and configure:

### Magic Link Template

The email template MUST contain a proper link. Supabase by default sends both:
- A **6-digit OTP code** (user types it on the login page)
- A **magic link button** (user clicks it and gets auto-logged in)

**Recommended Email Template** (paste in Supabase → Auth → Email Templates → Magic Link):

```html
<h2>Your Login Code</h2>
<p>Hello,</p>
<p>Your login code for NexMedicon HMS is:</p>
<h1 style="font-size: 36px; letter-spacing: 8px; font-family: monospace; background: #f0f0f0; padding: 16px; text-align: center; border-radius: 8px;">{{ .Token }}</h1>
<p>Or click the button below to sign in directly:</p>
<a href="{{ .ConfirmationURL }}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Sign In to NexMedicon HMS</a>
<p style="margin-top: 20px; color: #666; font-size: 12px;">This code expires in 1 hour. If you didn't request this, ignore this email.</p>
```

### Important Settings in Supabase → Auth → Email

| Setting | Recommended Value |
|---------|-------------------|
| Enable email confirmations | OFF (for OTP login flow) |
| Secure email change | ON |
| OTP Expiry | 3600 (1 hour) |
| Mailer OTP Length | 6 |

---

## 2. Supabase URL Configuration

Go to **Supabase Dashboard → Authentication → URL Configuration**:

| Field | Value |
|-------|-------|
| Site URL | `https://your-app.vercel.app` (your production URL) |
| Redirect URLs | Add ALL of these: |
| | `https://your-app.vercel.app/auth/callback` |
| | `https://your-app.vercel.app/login` |
| | `http://localhost:3000/auth/callback` (for local dev) |
| | `http://localhost:3000/login` (for local dev) |

**⚠️ CRITICAL**: If the redirect URL is not in the allow-list, Supabase will silently fail to send the email or the link won't work.

---

## 3. Email Delivery Issues

### Supabase Free Tier (Development)
- Supabase uses its own SMTP on free tier
- Emails may go to **spam/junk** folder
- Rate limit: ~4 emails/hour to same address
- Sender: `noreply@mail.app.supabase.io`

### Production (Recommended)
Set up custom SMTP in **Supabase → Project Settings → Auth → SMTP**:
- Use **Resend**, **SendGrid**, **Mailgun**, or your clinic's email provider
- Set a recognizable sender like `noreply@yourclinic.com`
- This prevents spam folder issues

---

## 4. How the Login Flow Works

```
User enters email
    ↓
Clicks "Send Login Code"
    ↓
supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: '/auth/callback' }
})
    ↓
Supabase sends email with:
  - 6-digit OTP code (user types on login page)
  - Magic link button (redirects to /auth/callback?code=XXX)
    ↓
Option A: User types OTP → supabase.auth.verifyOtp() → success → dashboard
Option B: User clicks magic link → /auth/callback → exchangeCodeForSession → dashboard
```

---

## 5. Troubleshooting Checklist

| Symptom | Fix |
|---------|-----|
| No email received | Check spam folder; verify email exists in Supabase Auth → Users |
| Email received but OTP doesn't work | Check if OTP has expired (>1 hour); verify correct email was used |
| Magic link button doesn't work | Check Supabase → Auth → URL Configuration → Redirect URLs |
| "No account found" error | User needs to be created first. Admin must invite them via Settings → User Management |
| Link says "expired" | OTP validity window passed. Click "Resend code" |
| Multiple login tabs open | Close other tabs — auth state can conflict |

---

## 6. For Development (localhost)

Add to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

In Supabase → Auth → URL Configuration, add:
```
http://localhost:3000/auth/callback
http://localhost:3000/login
```

---

## 7. Password Login Fallback

If OTP/magic link isn't working, users can:
1. Click "Sign in with password instead" on the login page
2. Enter email + password
3. If they forgot password, click "Forgot password?" to get a reset link

**To set a password for a user** (as admin):
- Go to Supabase Dashboard → Authentication → Users
- Find the user → Click "Reset password"
- This sends them a password reset email
