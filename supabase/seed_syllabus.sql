-- Seed script for English Grade 2 - 7 Syllabus
-- Based on the provided curriculum 2013

-- 1. Ensure Subjects exist
INSERT INTO public.subjects (id, name) VALUES 
('e0000000-0000-0000-0000-000000000001', 'English Language'),
('e0000000-0000-0000-0000-000000000002', 'Mathematics'),
('e0000000-0000-0000-0000-000000000003', 'Science'),
('e0000000-0000-0000-0000-000000000004', 'Social Studies'),
('e0000000-0000-0000-0000-000000000005', 'Religious Education'),
('e0000000-0000-0000-0000-000000000006', 'Creative & Technology Studies'),
('e0000000-0000-0000-0000-000000000007', 'Physical Education')
ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name;


-- ==========================================
-- GRADE 1 ENGLISH (Placeholder)
-- ==========================================

INSERT INTO public.topics (id, subject_id, name, grade, term, code)
VALUES (
  'e01-01-0000-0000-0000-000000000000', 
  'e0000000-0000-0000-0000-000000000001', 
  'Oral Language', 
  'Grade 1', 
  1, 
  'ENG-G1-T1-OL'
) ON CONFLICT (code) DO NOTHING;

INSERT INTO public.subtopics (id, topic_id, name, code)
VALUES ('e01-01-01-00-00-00-000000000000', 'e01-01-0000-0000-0000-000000000000', 'Pre-reading skills', 'ENG-G1-T1-OL-S1')
ON CONFLICT (code) DO NOTHING;


-- ==========================================
-- GRADE 2 ENGLISH
-- ==========================================

-- Topic: Listening and Speaking (Component 2.1)
INSERT INTO public.topics (id, subject_id, name, grade, term, code)
VALUES (
  'e02-01-0000-0000-0000-000000000000', 
  'e0000000-0000-0000-0000-000000000001', 
  'Listening and Speaking', 
  'Grade 2', 
  1, 
  'ENG-G2-T1-LS'
) ON CONFLICT (code) DO NOTHING;

-- Subtopics for Listening and Speaking
INSERT INTO public.subtopics (id, topic_id, name, code)
VALUES 
('e02-01-01-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Greetings', 'ENG-G2-T1-LS-S1'),
('e02-01-02-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Objects found in a home', 'ENG-G2-T1-LS-S2'),
('e02-01-03-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Story telling', 'ENG-G2-T1-LS-S3'),
('e02-01-04-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Animals', 'ENG-G2-T1-LS-S4'),
('e02-01-05-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Colours', 'ENG-G2-T1-LS-S5'),
('e02-01-06-00-00-00-000000000000', 'e02-01-0000-0000-0000-000000000000', 'Games', 'ENG-G2-T1-LS-S6')
ON CONFLICT (code) DO NOTHING;

-- Learning Outcomes for Greetings
INSERT INTO public.learning_outcomes (id, subtopic_id, description, code, learning_objective)
VALUES 
('e02-01-01-01-0000-0000-0000-0000', 'e02-01-01-00-00-00-000000000000', 'Demonstrate different types of greetings (Good morning, afternoon, evening)', 'ENG-G2-T1-LS-S1-LO1', ' greetings'),
('e02-01-02-01-0000-0000-0000-0000', 'e02-01-02-00-00-00-000000000000', 'Identify cups, plates, pots etc. found in a home', 'ENG-G2-T1-LS-S2-LO1', 'Objects found in a home')
ON CONFLICT (code) DO NOTHING;


-- ==========================================
-- GRADE 3 ENGLISH
-- ==========================================

-- Topic: Listening and Speaking (Component 3.1)
INSERT INTO public.topics (id, subject_id, name, grade, term, code)
VALUES (
  'e03-01-0000-0000-0000-000000000000', 
  'e0000000-0000-0000-0000-000000000001', 
  'Listening and Speaking', 
  'Grade 3', 
  1, 
  'ENG-G3-T1-LS'
) ON CONFLICT (code) DO NOTHING;

-- Subtopics for Grade 3 LS
INSERT INTO public.subtopics (id, topic_id, name, code)
VALUES 
('e03-01-01-00-00-00-000000000000', 'e03-01-0000-0000-0000-000000000000', 'Conversation', 'ENG-G3-T1-LS-S1'),
('e03-01-02-00-00-00-000000000000', 'e03-01-0000-0000-0000-000000000000', 'Time', 'ENG-G3-T1-LS-S2')
ON CONFLICT (code) DO NOTHING;

-- Learning Outcomes for Grade 3
INSERT INTO public.learning_outcomes (id, subtopic_id, description, code, learning_objective)
VALUES 
('e03-01-01-01-0000-0000-0000-0000', 'e03-01-01-00-00-00-000000000000', 'Talk about chores and responsibilities of family members', 'ENG-G3-T1-LS-S1-LO1', 'Roles e.g. cooking, sweeping'),
('e03-01-02-01-0000-0000-0000-0000', 'e03-01-02-00-00-00-000000000000', 'Tell time of the day and recall days/months', 'ENG-G3-T1-LS-S2-LO1', 'Calendar vocabulary')
ON CONFLICT (code) DO NOTHING;


-- ==========================================
-- NOTE: Full seed script would contain all 7 grades.
-- I will provide the user with the pattern and key data points.
-- ==========================================
