-- Modify the existing syllabus tables to include hierarchy codes and expected sequence metadata
ALTER TABLE public.topics
  ADD COLUMN grade text,
  ADD COLUMN term integer,
  ADD COLUMN code text UNIQUE;

ALTER TABLE public.subtopics
  ADD COLUMN code text UNIQUE;

ALTER TABLE public.learning_outcomes
  ADD COLUMN code text UNIQUE,
  ADD COLUMN learning_objective text;

-- Add topic_id foreign key to topic_analysis
ALTER TABLE public.topic_analysis
  ADD COLUMN topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL;


-- Create the Subtopic Analysis table
CREATE TABLE public.subtopic_analysis (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    result_id uuid NOT NULL REFERENCES public.results(id) ON DELETE CASCADE,
    subtopic_id uuid NOT NULL REFERENCES public.subtopics(id) ON DELETE CASCADE,
    total_questions integer NOT NULL,
    correct_answers integer NOT NULL,
    percentage numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS for subtopic_analysis
ALTER TABLE public.subtopic_analysis ENABLE ROW LEVEL SECURITY;

-- Policy for teachers to access subtopic analysis for their test streams/standalone tests
CREATE POLICY "Teachers can view subtopic analysis for their tests"
    ON public.subtopic_analysis
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.results r
            JOIN public.tests t ON r.test_id = t.id
            WHERE r.id = subtopic_analysis.result_id
            AND t.teacher_id = auth.uid()
        )
    );

CREATE POLICY "Teachers can insert subtopic analysis for their tests"
    ON public.subtopic_analysis
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.results r
            JOIN public.tests t ON r.test_id = t.id
            WHERE r.id = subtopic_analysis.result_id
            AND t.teacher_id = auth.uid()
        )
    );


-- Create the Learning Outcome Analysis table
CREATE TABLE public.learning_outcome_analysis (
    id uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    result_id uuid NOT NULL REFERENCES public.results(id) ON DELETE CASCADE,
    learning_outcome_id uuid NOT NULL REFERENCES public.learning_outcomes(id) ON DELETE CASCADE,
    total_questions integer NOT NULL,
    correct_answers integer NOT NULL,
    percentage numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS for learning_outcome_analysis
ALTER TABLE public.learning_outcome_analysis ENABLE ROW LEVEL SECURITY;

-- Policy for teachers to access LO analysis for their test streams/standalone tests
CREATE POLICY "Teachers can view LO analysis for their tests"
    ON public.learning_outcome_analysis
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.results r
            JOIN public.tests t ON r.test_id = t.id
            WHERE r.id = learning_outcome_analysis.result_id
            AND t.teacher_id = auth.uid()
        )
    );

CREATE POLICY "Teachers can insert LO analysis for their tests"
    ON public.learning_outcome_analysis
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.results r
            JOIN public.tests t ON r.test_id = t.id
            WHERE r.id = learning_outcome_analysis.result_id
            AND t.teacher_id = auth.uid()
        )
    );

-- Add easy/average/hard tracking to these new tables (to match topic_analysis)
ALTER TABLE public.subtopic_analysis
    ADD COLUMN easy_total integer DEFAULT 0,
    ADD COLUMN easy_correct integer DEFAULT 0,
    ADD COLUMN average_total integer DEFAULT 0,
    ADD COLUMN average_correct integer DEFAULT 0,
    ADD COLUMN hard_total integer DEFAULT 0,
    ADD COLUMN hard_correct integer DEFAULT 0;

ALTER TABLE public.learning_outcome_analysis
    ADD COLUMN easy_total integer DEFAULT 0,
    ADD COLUMN easy_correct integer DEFAULT 0,
    ADD COLUMN average_total integer DEFAULT 0,
    ADD COLUMN average_correct integer DEFAULT 0,
    ADD COLUMN hard_total integer DEFAULT 0,
    ADD COLUMN hard_correct integer DEFAULT 0;
