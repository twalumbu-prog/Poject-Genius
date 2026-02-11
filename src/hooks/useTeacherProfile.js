import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Custom hook for fetching teacher profile data
 */
export function useTeacherProfile(userId) {
    const [teacher, setTeacher] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!userId) {
            // If we don't have a userId yet, we keep loading as true 
            // unless we are sure there is no auth session coming.
            return;
        }

        fetchTeacherProfile();
    }, [userId]);

    async function fetchTeacherProfile() {
        try {
            setLoading(true);
            setError(null);

            const { data, error: fetchError } = await supabase
                .from('teachers')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            if (fetchError) {
                // Handle 406 specifically by suggesting a schema reload
                if (fetchError.status === 406) {
                    console.error('Supabase 406 error - Schema might be out of sync.', fetchError);
                }
                throw fetchError;
            }

            setTeacher(data);
        } catch (err) {
            console.error('Error fetching teacher profile:', err);
            setError(err.message);
            setTeacher(null);
        } finally {
            setLoading(false);
        }
    }

    return { teacher, loading, error, refetch: fetchTeacherProfile };
}
