/**
 * Normalizes question number representations from AI to extract the first integer.
 * @param {number|string|null|undefined} value 
 * @returns {number|null}
 */
export function normalizeQuestionNumber(value) {
    if (value === null || value === undefined) return null;

    // Convert to string safely
    const strVal = String(value);

    // Extract first continuous block of digits
    const match = strVal.match(/\d+/);

    if (match) {
        const num = parseInt(match[0], 10);
        return isNaN(num) ? null : num;
    }

    return null;
}
