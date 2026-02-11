import { getGreeting } from '../../utils/greetings';
import { LogOut } from 'lucide-react';
import { signOut } from '../../lib/auth';
import { useNavigate } from 'react-router-dom';
import './TopBar.css';

export default function TopBar({ teacher }) {
    const navigate = useNavigate();

    const handleSignOut = async () => {
        await signOut();
        navigate('/');
    };

    return (
        <div className="top-bar">
            <div className="top-bar-content">
                <div className="user-info">
                    <div className="user-avatar">
                        {teacher.user_emoji}
                    </div>
                    <div className="user-text">
                        <p className="greeting">
                            {getGreeting()}, {teacher.first_name}
                        </p>
                    </div>
                </div>
                <button onClick={handleSignOut} className="btn-ghost icon-button" title="Sign out">
                    <LogOut size={20} />
                </button>
            </div>
        </div>
    );
}
