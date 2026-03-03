import { supabase } from './supabase';

/**
 * SyllabusService
 * Handles hierarchical syllabus data from Supabase
 */
export const SyllabusService = {
    /**
     * Fetch the full structured syllabus for a specific grade
     */
    async getSyllabusForGrade(grade) {
        // 1. Fetch all topics for this grade
        const { data: topics, error: topicsError } = await supabase
            .from('topics')
            .select(`
        id,
        name,
        grade,
        term,
        code,
        subject_id,
        subjects(name)
      `)
            .eq('grade', grade)
            .order('term', { ascending: true })
            .order('name', { ascending: true });

        if (topicsError) throw topicsError;

        // 2. Fetch all subtopics for these topics
        const topicIds = topics.map(t => t.id);
        if (topicIds.length === 0) return {};

        const { data: subtopics, error: subError } = await supabase
            .from('subtopics')
            .select('*')
            .in('topic_id', topicIds)
            .order('name', { ascending: true });

        if (subError) throw subError;

        // 3. Fetch all learning outcomes for these subtopics
        const subtopicIds = subtopics.map(st => st.id);
        let learningOutcomes = [];
        if (subtopicIds.length > 0) {
            const { data: loData, error: loError } = await supabase
                .from('learning_outcomes')
                .select('*')
                .in('subtopic_id', subtopicIds)
                .order('description', { ascending: true });
            if (loError) throw loError;
            learningOutcomes = loData || [];
        }

        // 4. Assemble Hierarchy
        const hierarchy = {};

        topics.forEach(t => {
            const subjectName = t.subjects?.name || 'Unknown';
            if (!hierarchy[subjectName]) hierarchy[subjectName] = {};

            const termKey = `Term ${t.term || 1}`;
            if (!hierarchy[subjectName][termKey]) hierarchy[subjectName][termKey] = [];

            const topicNode = {
                ...t,
                subtopics: subtopics
                    .filter(st => st.topic_id === t.id)
                    .map(st => ({
                        ...st,
                        learningOutcomes: learningOutcomes.filter(lo => lo.subtopic_id === st.id)
                    }))
            };

            hierarchy[subjectName][termKey].push(topicNode);
        });

        return hierarchy;
    },

    /**
     * Resolve a topic name to an ID (Fuzzy Match)
     */
    resolveTopic(gradeSyllabus, topicName, subject) {
        if (!gradeSyllabus || !topicName) return null;

        const subjectSyllabus = gradeSyllabus[subject];
        if (!subjectSyllabus) return null;

        // Flatten all terms to find the topic
        const allTopics = Object.values(subjectSyllabus).flat();

        // 1. Try exact code match
        const codeMatch = allTopics.find(t => t.code && t.code.toLowerCase() === topicName.toLowerCase());
        if (codeMatch) return codeMatch.id;

        // 2. Try exact name match
        const exactMatch = allTopics.find(t => t.name.toLowerCase() === topicName.toLowerCase());
        if (exactMatch) return exactMatch.id;

        // 3. Fallback to fuzzy match
        const fuzzyMatch = allTopics.find(t =>
            t.name.toLowerCase().includes(topicName.toLowerCase()) ||
            topicName.toLowerCase().includes(t.name.toLowerCase())
        );
        return fuzzyMatch ? fuzzyMatch.id : null;
    },

    /**
     * Resolve a subtopic name to an ID
     */
    resolveSubtopic(gradeSyllabus, subtopicName, topicId, subject) {
        if (!gradeSyllabus || !subtopicName) return null;

        const subjectSyllabus = gradeSyllabus[subject];
        if (!subjectSyllabus) return null;

        const allTopics = Object.values(subjectSyllabus).flat();
        const topic = allTopics.find(t => t.id === topicId);
        if (!topic || !topic.subtopics) return null;

        // 1. Try exact code match
        const codeMatch = topic.subtopics.find(s => s.code && s.code.toLowerCase() === subtopicName.toLowerCase());
        if (codeMatch) return codeMatch.id;

        // 2. Try exact name match
        const exactMatch = topic.subtopics.find(s => s.name.toLowerCase() === subtopicName.toLowerCase());
        if (exactMatch) return exactMatch.id;

        // 3. Fallback to fuzzy
        const fuzzyMatch = topic.subtopics.find(s =>
            s.name.toLowerCase().includes(subtopicName.toLowerCase()) ||
            subtopicName.toLowerCase().includes(s.name.toLowerCase())
        );
        return fuzzyMatch ? fuzzyMatch.id : null;
    },

    /**
     * Resolve a learning outcome description to an ID
     */
    resolveLearningOutcome(gradeSyllabus, loDescription, subtopicId, subject) {
        if (!gradeSyllabus || !loDescription) return null;

        const subjectSyllabus = gradeSyllabus[subject];
        if (!subjectSyllabus) return null;

        const allTopics = Object.values(subjectSyllabus).flat();
        let subtopic = null;
        for (const t of allTopics) {
            subtopic = t.subtopics.find(s => s.id === subtopicId);
            if (subtopic) break;
        }
        if (!subtopic || !subtopic.learningOutcomes) return null;

        // 1. Try exact code match
        const codeMatch = subtopic.learningOutcomes.find(l => l.code && l.code.toLowerCase() === loDescription.toLowerCase());
        if (codeMatch) return codeMatch.id;

        // 2. Try exact description match
        const exactMatch = subtopic.learningOutcomes.find(l => l.description.toLowerCase() === loDescription.toLowerCase());
        if (exactMatch) return exactMatch.id;

        // 3. Fallback to fuzzy
        const fuzzyMatch = subtopic.learningOutcomes.find(l =>
            l.description.toLowerCase().includes(loDescription.toLowerCase()) ||
            loDescription.toLowerCase().includes(l.description.toLowerCase())
        );
        return fuzzyMatch ? fuzzyMatch.id : null;
    }
};
