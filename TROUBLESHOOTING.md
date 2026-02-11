# 🔧 Fixing the 401 Authentication Error

## Issue
Getting a 401 error when trying to sign up - this means the API key is not working correctly.

## Solution: Get the Correct API Key

### Step 1: Find Your Anon Key

1. Go to your Supabase Dashboard: https://gjiuseoqtzhdvxwvktfo.supabase.co
2. Click **Settings** (gear icon in the left sidebar, bottom)
3. Click **API** in the settings menu
4. You'll see two keys:
   - **Project URL** (already correct)
   - **anon** **public** key ← **COPY THIS ONE**

The key should look like: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey...` (starts with `eyJ`)

### Step 2: Update Your .env File

Replace the current key in `.env` with the **anon public** key you just copied.

The file should look like:
```
VITE_SUPABASE_URL=https://gjiuseoqtzhdvxwvktfo.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey...your-actual-anon-key
```

### Step 3: Restart Dev Server

The dev server should auto-reload, but if not:
1. Press `Ctrl+C` in the terminal
2. Run `npm run dev` again

### Step 4: Clear Browser Cache and Try Again

1. Open http://localhost:5173
2. Press `Ctrl+Shift+R` (hard refresh)
3. Try signing up again

---

## Alternative: Check Email Confirmation Settings

Another common issue is email confirmation being required:

1. In Supabase Dashboard → **Authentication** → **Settings**
2. Scroll to **Email Auth**
3. Look for **"Enable email confirmations"**
4. For testing, you can **disable** this temporarily
5. Click **Save**

## Rate Limit Error (429 Too Many Requests)

If you see an error like **"email rate limit exceeded"**, it means Supabase is blocking you because you've sent too many signup requests in a short time.

### How to Fix:
1. Go to **Supabase Dashboard** -> **Authentication** -> **Settings**.
2. Scroll down to **Rate Limits**.
3. You can increase the limits for:
   - **Max Sign In Attempts per hour**
   - **Max Sign Up Attempts per hour**
4. Alternatively, for testing, you can **disable rate limits** (though not recommended for production).
5. **Wait 10-15 minutes** for the current block to expire if you don't want to change settings.

### Tip for Testing:
If you are blocked on signup, you can try logging in with an account you already created, or manually create a user in the **Authentication** -> **Users** section of the Supabase dashboard.
