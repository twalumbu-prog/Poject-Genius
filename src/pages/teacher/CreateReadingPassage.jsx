import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Sparkles, BookOpen, Layers, Ruler, Target, Wand2 } from 'lucide-react';
import './CreateReadingPassage.css';

const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
const LEVELS = ['Emergent', 'Beginning', 'Transitional', 'Fluent', 'Advanced'];
const LENGTHS = [
    { label: 'Short (~50 words)', value: 50 },
    { label: 'Medium (~100 words)', value: 100 },
    { label: 'Long (~200 words)', value: 200 },
];
const FOCUS_AREAS = ['General Fluency', 'Phonics & Decoding', 'Vocabulary', 'Comprehension', 'High-Frequency Words'];

export default function CreateReadingPassage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        grade: 'Grade 3',
        level: 'Beginning',
        length: 100,
        focus: 'General Fluency'
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Call the edge function to generate the passage
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-reading-assessment`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        mode: 'generate_passage',
                        genParams: formData,
                        geminiKey: import.meta.env.VITE_GEMINI_API_KEY
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to generate passage');
            }
            const data = await response.json();

            // Save the passage to the database
            const { data: savedPassage, error: saveError } = await supabase
                .from('reading_passages')
                .insert({
                    teacher_id: user.id,
                    title: data.title,
                    text: data.text,
                    word_count: data.word_count,
                    grade: data.grade,
                    level: data.level,
                    metadata: { focus: formData.focus }
                })
                .select()
                .single();

            if (saveError) throw saveError;

            alert('Reading passage generated successfully!');
            navigate('/teacher/assessments');

        } catch (error) {
            console.error('Error:', error);
            alert(`Generation failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="create-reading-page">
            <div className="page-container">
                <button className="back-button" onClick={() => navigate('/teacher/assessments')}>
                    <ArrowLeft size={20} />
                    Back to Assessments
                </button>

                <div className="page-header">
                    <div className="header-icon">
                        <BookOpen size={32} />
                    </div>
                    <h1>Create Reading Test</h1>
                    <p>Generate curriculum-aligned reading passages for your students</p>
                </div>

                <form onSubmit={handleSubmit} className="gen-form">
                    <div className="form-grid">
                        <div className="form-group">
                            <label className="label">
                                <Layers size={16} />
                                Grade Level
                            </label>
                            <select
                                name="grade"
                                className="input"
                                value={formData.grade}
                                onChange={handleChange}
                                required
                            >
                                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">
                                <Target size={16} />
                                Reading Level
                            </label>
                            <select
                                name="level"
                                className="input"
                                value={formData.level}
                                onChange={handleChange}
                                required
                            >
                                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="form-grid">
                        <div className="form-group">
                            <label className="label">
                                <Ruler size={16} />
                                Length
                            </label>
                            <select
                                name="length"
                                className="input"
                                value={formData.length}
                                onChange={handleChange}
                                required
                            >
                                {LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="label">
                                <Sparkles size={16} />
                                Focus Area
                            </label>
                            <select
                                name="focus"
                                className="input"
                                value={formData.focus}
                                onChange={handleChange}
                                required
                            >
                                {FOCUS_AREAS.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-block btn-large gen-button"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className="spinner-white" />
                                Generating Story...
                            </>
                        ) : (
                            <>
                                <Wand2 size={20} />
                                Generate Reading Passage
                            </>
                        )}
                    </button>
                </form>

                <div className="info-card">
                    <Sparkles size={20} />
                    <p>AI will create a culturally relevant story for Zambian students, ensuring vocabulary is grade-appropriate.</p>
                </div>
            </div>
        </div>
    );
}
