import { supabase } from './supabase';

/**
 * Sign up a new user with email and password
 */
export async function signUp(email, password, role = 'teacher') {
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    role: role,
                },
            },
        });

        if (error) {
            console.error('Signup error:', error);
            throw error;
        }

        // If session is null, email confirmation might be enabled
        if (data.user && !data.session) {
            console.log('Sign up successful, but email confirmation is required.');
            return { data, error: null, confirmationRequired: true };
        }

        // Note: A database trigger now handles profile creation automatically.
        // We add a short delay and check if the profile exists, or create it if it doesn't.
        if (data.user && data.session) {
            // Small delay to let trigger finish
            await new Promise(resolve => setTimeout(resolve, 500));

            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', data.user.id)
                .maybeSingle();

            if (!profile) {
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert({
                        id: data.user.id,
                        role: role,
                    });

                if (profileError) {
                    console.error('Error creating profile manually:', profileError);
                }
            }
        }

        return { data, error: null, confirmationRequired: false };
    } catch (error) {
        return { data: null, error };
    }
}

/**
 * Sign in with email and password
 */
export async function signIn(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
        return { data, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
            },
        });

        if (error) throw error;
        return { data, error: null };
    } catch (error) {
        return { data: null, error };
    }
}

/**
 * Sign out current user
 */
export async function signOut() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return { error: null };
    } catch (error) {
        return { error };
    }
}

/**
 * Get current user with profile and role
 */
export async function getCurrentUser() {
    try {
        // 1. Get the authenticated user from Supabase Auth
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError) {
            if (userError.status === 401 || userError.status === 403) {
                return { user: null, profile: null, error: null };
            }
            throw userError;
        }

        if (!user) return { user: null, profile: null, error: null };

        // 2. Try to get the profile record
        let { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        // 3. Fallback: If user exists but profile doesn't, try to create it
        // This handles cases where the trigger might have failed or signup insert failed
        if (!profile && !profileError) {
            const role = user.user_metadata?.role || 'teacher';
            const { data: newProfile, error: insertError } = await supabase
                .from('profiles')
                .insert({ id: user.id, role })
                .select()
                .maybeSingle();

            if (!insertError) {
                profile = newProfile;
            } else {
                console.error('Failed to auto-create missing profile:', insertError);
            }
        }

        if (profileError) {
            console.error('Error fetching profile:', profileError);
            return { user, profile: null, error: profileError };
        }

        return { user, profile, error: null };
    } catch (error) {
        console.error('Unexpected error in getCurrentUser:', error);
        return { user: null, profile: null, error };
    }
}

/**
 * Listen to auth state changes
 */
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}
