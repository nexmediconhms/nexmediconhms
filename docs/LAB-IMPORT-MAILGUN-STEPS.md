# Lab Report Auto-Import via Mailgun — Step-by-Step

## What This Does
Your partner lab sends an email with the patient's PDF report → Mailgun receives it → forwards to your app → report automatically attached to patient record.

---

## Step-by-Step Setup (30 minutes)

### Step 1: Create Mailgun Account (5 min)
1. Go to [mailgun.com/signup](https://www.mailgun.com/signup)
2. Sign up with email (free tier: 5,000 emails/month)
3. Verify your email
4. Add payment method (required by Mailgun, but free tier won't charge)

### Step 2: Add Your Domain (10 min)
1. Log into Mailgun Dashboard
2. Go to **Sending** → **Domains** → **Add New Domain**
3. Enter: `labs.yourclinic.com` (or any subdomain)
4. Mailgun shows DNS records to add:
   - Go to your domain registrar (GoDaddy / Namecheap / Cloudflare)
   - Add MX record: `mxa.mailgun.org` (priority 10)
   - Add MX record: `mxb.mailgun.org` (priority 10)
   - Add TXT record for SPF verification
5. Wait 5-10 minutes, then click **Verify** in Mailgun

### Step 3: Create a Route (5 min)
1. In Mailgun Dashboard → **Receiving** → **Routes** → **Create Route**
2. Settings:
   - **Expression Type**: Match Recipient
   - **Recipient**: `reports@labs.yourclinic.com`
   - **Actions**: Select "Store and Notify"
   - **Forward URL**: `https://your-app.vercel.app/api/labs/import-email`
   - Check: "Post MIME data"
3. Click **Create Route**

### Step 4: Add Environment Variable (2 min)
1. Go to Vercel → Project → Settings → Environment Variables
2. Add: `LAB_IMPORT_SECRET` = copy the Mailgun webhook signing key
   (Found in: Mailgun → Settings → Security → Webhook signing key)

### Step 5: Test It (5 min)
1. Send a test email:
   - **To**: `reports@labs.yourclinic.com`
   - **Subject**: `CBC Report for P-001` (use a real MRN from your system)
   - **Attach**: Any PDF file
2. Check your app's Labs page — the report should appear within 2 minutes
3. If it doesn't appear, check Vercel Function Logs for errors

---

## What to Tell Your Lab Partner

Send them this message:

> "Please email all lab reports to: **reports@labs.yourclinic.com**
>
> **Important:** Include the patient's MRN number in the email subject.
> Example: `CBC Report for P-042` or `Blood Sugar - P-042`
>
> The MRN is printed on the lab requisition slip we give you.
> Attach the PDF report to the email.
>
> Reports will be automatically added to the patient's record."

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Report not appearing | Check Mailgun → Logs → is email received? |
| "Could not identify patient" | MRN not in subject. Tell lab to include P-XXX |
| Route not working | Verify domain DNS records are correct |
| Webhook returning 401 | Check LAB_IMPORT_SECRET matches Mailgun signing key |

---

## Costs
- **Mailgun Free Tier**: 5,000 emails/month (more than enough for a clinic)
- **If you exceed**: $0.80 per 1,000 emails after that
- **Typical clinic**: 10-20 lab reports/day = 300-600/month = **always free**
