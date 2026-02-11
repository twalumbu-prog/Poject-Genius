/**
 * Format a number as a percentage
 */
export function formatPercentage(value, decimals = 1) {
    return `${value.toFixed(decimals)}%`;
}

/**
 * Format a rank/position (1st, 2nd, 3rd, etc.)
 */
export function formatRank(rank) {
    if (!rank) return '-';

    const suffix = getRankSuffix(rank);
    return `${rank}${suffix}`;
}

function getRankSuffix(rank) {
    if (rank % 100 >= 11 && rank % 100 <= 13) {
        return 'th';
    }

    switch (rank % 10) {
        case 1:
            return 'st';
        case 2:
            return 'nd';
        case 3:
            return 'rd';
        default:
            return 'th';
    }
}

/**
 * Format a score out of total (e.g., "15/20")
 */
export function formatScore(score, total) {
    return `${score}/${total}`;
}
