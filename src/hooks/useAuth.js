import { useState, useEffect } from 'react';
import { getCurrentUser, onAuthStateChange } from '../lib/auth';

/**
 * Custom hook for managing authentication state
 */
export function useAuth() {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check for current user on mount
        checkUser();

        // Listen for auth state changes
        const { data: authListener } = onAuthStateChange(async (event, session) => {
            if (session) {
                checkUser();
            } else {
                setUser(null);
                setProfile(null);
                setLoading(false);
            }
        });

        return () => {
            authListener?.subscription?.unsubscribe();
        };
    }, []);

    async function checkUser() {
        try {
            const { user: currentUser, profile: currentProfile, error } = await getCurrentUser();

            // We set the user if we found one, even if the profile fetch had an error
            setUser(currentUser);
            setProfile(currentProfile);

            if (error) {
                console.warn('User authenticated but profile could not be loaded:', error);
            }
        } catch (err) {
            console.error('Failed to check user auth status:', err);
            setUser(null);
            setProfile(null);
        } finally {
            setLoading(false);
        }
    }

    return {
        user,
        profile,
        loading,
        isAuthenticated: !!user,
        role: profile?.role,
    };
}
