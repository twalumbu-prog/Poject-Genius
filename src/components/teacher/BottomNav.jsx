import { NavLink } from 'react-router-dom';
import { FileText, Users, BarChart3 } from 'lucide-react';
import './BottomNav.css';

export default function BottomNav() {
    return (
        <nav className="bottom-nav">
            <NavLink to="/teacher/assessments" className="nav-item">
                <FileText size={24} />
                <span>Assessments</span>
            </NavLink>
            <NavLink to="/teacher/students" className="nav-item">
                <Users size={24} />
                <span>Students</span>
            </NavLink>
            <NavLink to="/teacher/analysis" className="nav-item">
                <BarChart3 size={24} />
                <span>Analysis</span>
            </NavLink>
        </nav>
    );
}
