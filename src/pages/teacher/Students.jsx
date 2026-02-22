import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Search, User, GraduationCap, Hash } from 'lucide-react';
import './Students.css';

export default function Students() {
    const navigate = useNavigate();
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetchAssessedStudents();
    }, []);

    async function fetchAssessedStudents() {
        try {
            // Get all pupils who have at least one result
            const { data, error } = await supabase
                .from('pupils')
                .select(`
                    id,
                    name,
                    grade,
                    results (
                        id,
                        test_id,
                        percentage
                    )
                `)
                .not('results', 'is', null)
                .order('name');

            if (error) throw error;

            // Filter to only pupils with at least one result
            const assessed = (data || []).filter(p => p.results && p.results.length > 0);

            // Compute summary stats for each student
            const enriched = assessed.map(pupil => {
                const results = pupil.results;
                const totalTests = results.length;
                const avgPercentage = results.reduce((sum, r) => sum + Number(r.percentage), 0) / totalTests;
                return {
                    ...pupil,
                    totalTests,
                    avgPercentage: Math.round(avgPercentage),
                };
            });

            setStudents(enriched);
        } catch (error) {
            console.error('Error fetching students:', error);
        } finally {
            setLoading(false);
        }
    }

    const filtered = students.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <span style={{ color: 'var(--color-accent-primary)', fontWeight: 700 }}>Loading students...</span>
            </div>
        );
    }

    return (
        <div className="students-page">
            <div className="students-header">
                <h1>Students</h1>
                <p className="students-subtitle">{students.length} assessed student{students.length !== 1 ? 's' : ''}</p>
            </div>

            {students.length > 0 && (
                <div className="search-bar">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search students..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {filtered.length === 0 && !searchQuery && (
                <div className="empty-state">
                    <div className="empty-icon">
                        <GraduationCap size={64} strokeWidth={1.5} />
                    </div>
                    <h2>No Students Yet</h2>
                    <p>Students will appear here once they have been assessed in at least one test.</p>
                </div>
            )}

            {filtered.length === 0 && searchQuery && (
                <div className="empty-state">
                    <p>No students found matching "{searchQuery}"</p>
                </div>
            )}

            <div className="students-list">
                {filtered.map((student) => (
                    <div
                        key={student.id}
                        className="student-card"
                        onClick={() => navigate(`/teacher/student/${student.id}`)}
                    >
                        <div className="student-avatar">
                            <User size={22} />
                        </div>
                        <div className="student-info">
                            <h3 className="student-name">{student.name}</h3>
                            <div className="student-meta">
                                {student.grade && (
                                    <span className="meta-badge grade-badge">
                                        <GraduationCap size={12} />
                                        {student.grade}
                                    </span>
                                )}
                                <span className="meta-badge id-badge">
                                    <Hash size={12} />
                                    {student.id.slice(0, 8)}
                                </span>
                            </div>
                        </div>
                        <div className="student-stats">
                            <span className="stat-value">{student.totalTests}</span>
                            <span className="stat-label">test{student.totalTests !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
