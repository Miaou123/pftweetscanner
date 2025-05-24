// src/utils/formatters.js

/**
 * Format numbers with appropriate suffixes (K, M, B)
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number string
 */
function formatNumber(num, decimals = 1) {
    if (num === null || num === undefined || isNaN(num)) {
        return '0';
    }
    
    const absNum = Math.abs(num);
    
    if (absNum >= 1000000000) {
        return (num / 1000000000).toFixed(decimals) + 'B';
    }
    if (absNum >= 1000000) {
        return (num / 1000000).toFixed(decimals) + 'M';
    }
    if (absNum >= 1000) {
        return (num / 1000).toFixed(decimals) + 'K';
    }
    
    return num.toLocaleString();
}

/**
 * Format percentage with proper symbol
 * @param {number} percentage - Percentage value
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage string
 */
function formatPercentage(percentage, decimals = 2) {
    if (percentage === null || percentage === undefined || isNaN(percentage)) {
        return '0%';
    }
    return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format SOL amount
 * @param {number} amount - SOL amount
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted SOL amount
 */
function formatSol(amount, decimals = 2) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return '0 SOL';
    }
    return `${amount.toFixed(decimals)} SOL`;
}

/**
 * Format USD amount
 * @param {number} amount - USD amount
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted USD amount
 */
function formatUSD(amount, decimals = 2) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return '$0';
    }
    return `$${formatNumber(amount, decimals)}`;
}

/**
 * Format duration in milliseconds to human readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
    if (!ms || isNaN(ms)) {
        return '0ms';
    }
    
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format token address for display (shortened)
 * @param {string} address - Token address
 * @param {number} startChars - Characters to show at start
 * @param {number} endChars - Characters to show at end
 * @returns {string} Shortened address
 */
function formatAddress(address, startChars = 6, endChars = 4) {
    if (!address || typeof address !== 'string') {
        return 'N/A';
    }
    
    if (address.length <= startChars + endChars) {
        return address;
    }
    
    return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format timestamp to readable date
 * @param {number|Date} timestamp - Timestamp or Date object
 * @returns {string} Formatted date string
 */
function formatDate(timestamp) {
    if (!timestamp) {
        return 'N/A';
    }
    
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Format risk level with appropriate emoji
 * @param {string} riskLevel - Risk level (LOW, MEDIUM, HIGH, VERY_HIGH)
 * @returns {string} Formatted risk level with emoji
 */
function formatRiskLevel(riskLevel) {
    const riskEmojis = {
        'LOW': '🟢 LOW',
        'MEDIUM': '🟡 MEDIUM', 
        'HIGH': '🟠 HIGH',
        'VERY_HIGH': '🔴 VERY HIGH',
        'UNKNOWN': '⚪ UNKNOWN'
    };
    
    return riskEmojis[riskLevel] || riskEmojis['UNKNOWN'];
}

/**
 * Escape HTML characters for Telegram
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add when truncated
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 100, suffix = '...') {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    if (text.length <= maxLength) {
        return text;
    }
    
    return text.slice(0, maxLength - suffix.length) + suffix;
}

module.exports = {
    formatNumber,
    formatPercentage,
    formatSol,
    formatUSD,
    formatDuration,
    formatAddress,
    formatDate,
    formatRiskLevel,
    escapeHtml,
    truncateText
};