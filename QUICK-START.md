# 🚀 Quick Setup Guide

Your Supabase credentials have been configured! Follow these steps to complete the setup:

## ✅ Step 1: Environment Variables (DONE)
Your `.env` file has been updated with:
- **Supabase URL**: https://gjiuseoqtzhdvxwvktfo.supabase.co
- **API Key**: Configured ✓

## 📋 Step 2: Set Up Database (DO THIS NOW)

1. **Open Supabase Dashboard**
   - Go to: https://gjiuseoqtzhdvxwvktfo.supabase.co
   - Navigate to **SQL Editor** (in the left sidebar)

2. **Create Database Schema**
   - Click **"+ New Query"**
   - Open the file: `supabase-schema.sql` (in your project folder)
   - Copy **ALL** the contents
   - Paste into the SQL Editor
   - Click **"Run"** (or press Ctrl+Enter)

3. **Verify Setup**
   - Go to **Table Editor** (left sidebar)
   - You should see 8 tables:
     - ✓ profiles
     - ✓ teachers
     - ✓ test_streams
     - ✓ tests
     - ✓ marking_schemes
     - ✓ pupils
     - ✓ results
     - ✓ topic_analysis

## 🎯 Step 3: Test the Application

1. **Open the App**
   - The dev server is running at: **http://localhost:5173**
   - Open this in your browser

2. **Create Your Teacher Account**
   - Click **"Login as Teacher"** → **"Sign up"**
   - Use any email and password
   - Complete the onboarding form with your details

3. **Explore the Features**
   - ✅ Create a test stream
   - ✅ Select subjects
   - ✅ Upload test papers (mock)
   - ✅ Generate marking schemes (mock AI)
   - ✅ View the assessment workflow

## 🔧 Optional: Enable Google SSO

If you want Google login:

1. In Supabase Dashboard → **Authentication** → **Providers**
2. Enable **Google**
3. Follow the setup instructions

## 🐛 Troubleshooting

**If you see "Missing Supabase environment variables":**
- The dev server should have auto-restarted ✓
- If not, press `Ctrl+C` in terminal, then run `npm run dev` again

**If authentication doesn't work:**
- Make sure you ran the SQL schema
- Check that RLS policies were created
- Try refreshing the page

**If tables don't appear:**
- The SQL query might have errors
- Check the SQL Editor for error messages
- Make sure you copied the entire file

## 📱 Next Steps After Setup

Once the database is set up and you've created an account:

1. Create a test stream (e.g., "Term 1 Mid-Term")
2. Select subjects like Math, English, Science
3. Go through the setup workflow
4. Explore the marking and analysis features

---

**Need Help?** The complete walkthrough is available in the walkthrough document!

🎉 **You're almost ready to start testing!**
