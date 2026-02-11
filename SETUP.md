# Project: Genius - Setup Instructions

## Prerequisites
- Node.js (v18+)
- A Supabase account (free tier is fine for MVP)

## Setup Steps

### 1. Supabase Project Setup

1. Go to [https://supabase.com](https://supabase.com) and create a new project
2. Once created, go to **Project Settings > API**
3. Copy your:
   - Project URL
   - Anon/Public Key

### 2. Database Setup

1. In your Supabase dashboard, go to **SQL Editor**
2. Create a new query
3. Copy and paste the entire contents of `supabase-schema.sql`
4. Click **Run** to execute the schema

### 3. Enable Google OAuth (Optional)

1. In Supabase dashboard, go to **Authentication > Providers**
2. Enable **Google** provider
3. Follow the instructions to set up Google OAuth (you'll need to create a Google Cloud project)
4. Add your Google Client ID and Client Secret

### 4. Environment Variables

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

### 5. Install Dependencies

```bash
npm install
```

### 6. Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Testing the Application

### Create a Teacher Account

1. Navigate to the landing page
2. Click "Login as Teacher" > "Sign up"
3. Create an account with email/password
4. Complete the onboarding form
5. Explore the teacher workspace

### Create a Test Stream

1. In the Assessments page, click the "+" button
2. Select "Create Test Stream"
3. Enter a title (e.g., "Term 1 Mid-Term")
4. Select subjects
5. Click through the setup process

## MVP Limitations

This is an MVP for hypothesis validation. The following features are placeholders:

- **OCR/Camera Scanning**: Mock implementation (shows alerts)
- **AI Marking Scheme Generation**: Mock data (creates sample data)
- **PDF Upload**: Mock implementation
- **Students Page**: "Coming Soon" placeholder
- **Analysis Page**: "Coming Soon" placeholder
- **Admin Dashboard**: Basic placeholder

## Next Steps

For production deployment:

1. **Implement Real OCR**: Integrate Tesseract.js or cloud OCR service
2. **AI Integration**: Connect to OpenAI API or similar for marking scheme generation
3. **File Upload**: Implement Supabase Storage for PDF uploads
4. **Enhanced Analytics**: Build out the Analysis page with charts
5. **Admin Features**: Complete admin dashboard
6. **Mobile App**: Consider React Native for native mobile experience

## Project Structure

```
src/
├── components/        # Reusable UI components
│   └── teacher/      # Teacher-specific components
├── hooks/            # Custom React hooks
├── lib/              # Third-party integrations
├── pages/            # Page components
│   ├── admin/       # Admin pages
│   └── teacher/     # Teacher pages
├── styles/          # Global styles and design tokens
└── utils/           # Helper functions
```

## Support

For questions about this project, please refer to the implementation plan in the artifacts folder.
