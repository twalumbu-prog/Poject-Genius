-- Project: Genius Database Schema
-- This file contains all the SQL commands to set up the database in Supabase

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- TEACHERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  phone_number TEXT,
  assigned_grades TEXT[],
  user_emoji TEXT DEFAULT '👨‍🏫',
  onboarding_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on teachers
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- Policies for teachers
CREATE POLICY "Teachers can view their own data" ON teachers
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Teachers can insert their own data" ON teachers
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Teachers can update their own data" ON teachers
  FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- TEST STREAMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS test_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'setup', 'ready', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on test_streams
ALTER TABLE test_streams ENABLE ROW LEVEL SECURITY;

-- Policies for test_streams
CREATE POLICY "Teachers can view their own streams" ON test_streams
  FOR SELECT USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can insert their own streams" ON test_streams
  FOR INSERT WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers can update their own streams" ON test_streams
  FOR UPDATE USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can delete their own streams" ON test_streams
  FOR DELETE USING (auth.uid() = teacher_id);

-- ============================================
-- TESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_stream_id UUID REFERENCES test_streams(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  test_paper_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'scheme_ready', 'marking', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on tests
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;

-- Policies for tests
CREATE POLICY "Teachers can view their own tests" ON tests
  FOR SELECT USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can insert their own tests" ON tests
  FOR INSERT WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers can update their own tests" ON tests
  FOR UPDATE USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can delete their own tests" ON tests
  FOR DELETE USING (auth.uid() = teacher_id);

-- ============================================
-- MARKING SCHEMES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS marking_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  questions JSONB NOT NULL,
  topic_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on marking_schemes
ALTER TABLE marking_schemes ENABLE ROW LEVEL SECURITY;

-- Policies for marking_schemes
CREATE POLICY "Teachers can view schemes for their tests" ON marking_schemes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = marking_schemes.test_id AND tests.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can insert schemes for their tests" ON marking_schemes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = marking_schemes.test_id AND tests.teacher_id = auth.uid()
    )
  );

-- ============================================
-- PUPILS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS pupils (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  grade TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on pupils
ALTER TABLE pupils ENABLE ROW LEVEL SECURITY;

-- Policies for pupils (all teachers can view/add pupils for now)
CREATE POLICY "Teachers can view all pupils" ON pupils
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'teacher')
  );

CREATE POLICY "Teachers can insert pupils" ON pupils
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'teacher')
  );

-- ============================================
-- RESULTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  pupil_id UUID NOT NULL REFERENCES pupils(id) ON DELETE CASCADE,
  answers JSONB,
  score NUMERIC NOT NULL,
  percentage NUMERIC NOT NULL,
  rank INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, pupil_id)
);

-- Enable RLS on results
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

-- Policies for results
CREATE POLICY "Teachers can view results for their tests" ON results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = results.test_id AND tests.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can insert results for their tests" ON results
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = results.test_id AND tests.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can update results for their tests" ON results
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM tests WHERE tests.id = results.test_id AND tests.teacher_id = auth.uid()
    )
  );

-- ============================================
-- TOPIC ANALYSIS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS topic_analysis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  result_id UUID NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  percentage NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on topic_analysis
ALTER TABLE topic_analysis ENABLE ROW LEVEL SECURITY;

-- Policies for topic_analysis
CREATE POLICY "Teachers can view topic analysis for their tests" ON topic_analysis
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM results
      JOIN tests ON tests.id = results.test_id
      WHERE results.id = topic_analysis.result_id AND tests.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can insert topic analysis for their tests" ON topic_analysis
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM results
      JOIN tests ON tests.id = results.test_id
      WHERE results.id = topic_analysis.result_id AND tests.teacher_id = auth.uid()
    )
  );

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Trigger to automatically create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'role', 'teacher'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teachers_updated_at BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_streams_updated_at BEFORE UPDATE ON test_streams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_teachers_id ON teachers(id);
CREATE INDEX IF NOT EXISTS idx_test_streams_teacher ON test_streams(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tests_teacher ON tests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tests_stream ON tests(test_stream_id);
CREATE INDEX IF NOT EXISTS idx_results_test ON results(test_id);
CREATE INDEX IF NOT EXISTS idx_results_pupil ON results(pupil_id);
CREATE INDEX IF NOT EXISTS idx_topic_analysis_result ON topic_analysis(result_id);
