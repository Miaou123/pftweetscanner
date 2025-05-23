// src/utils/retryUtils.js
const logger = require('./logger');

/**
 * Retry a function with exponential backoff
 * @param {Function} operation - The function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {Function} shouldRetry - Function to determine if error should trigger retry
 * @returns {Promise} - Promise that resolves with the operation result
 */
async function retryWithBackoff(
    operation, 
    maxRetries = 3, 
    baseDelay = 1000,
    shouldRetry = null
) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            
            if (attempt > 0) {
                logger.debug(`Operation succeeded on attempt ${attempt + 1}`);
            }
            
            return result;
        } catch (error) {
            lastError = error;
            
            // Check if we should retry this error
            if (shouldRetry && !shouldRetry(error)) {
                logger.debug(`Not retrying due to shouldRetry check: ${error.message}`);
                throw error;
            }
            
            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Calculate delay with exponential backoff and jitter
            const delay = baseDelay * Math.pow(2, attempt);
            const jitter = Math.random() * 0.1 * delay; // Add up to 10% jitter
            const finalDelay = delay + jitter;
            
            logger.debug(`Operation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${Math.round(finalDelay)}ms`);
            
            await sleep(finalDelay);
        }
    }
    
    logger.error(`Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
    throw lastError;
}

/**
 * Retry a function with linear backoff
 * @param {Function} operation - The function to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Fixed delay between retries in milliseconds
 * @returns {Promise} - Promise that resolves with the operation result
 */
async function retryWithFixedDelay(operation, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxRetries) {
                break;
            }
            
            logger.debug(`Operation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${delay}ms`);
            await sleep(delay);
        }
    }
    
    throw lastError;
}

/**
 * Retry a function with custom retry strategy
 * @param {Function} operation - The function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Promise that resolves with the operation result
 */
async function retryWithStrategy(operation, options = {}) {
    const {
        maxRetries = 3,
        delays = [1000, 2000, 4000], // Custom delay sequence
        shouldRetry = null,
        onRetry = null,
        timeout = null
    } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Add timeout if specified
            if (timeout) {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Operation timeout')), timeout)
                );
                return await Promise.race([operation(), timeoutPromise]);
            } else {
                return await operation();
            }
        } catch (error) {
            lastError = error;
            
            // Check if we should retry this error
            if (shouldRetry && !shouldRetry(error)) {
                throw error;
            }
            
            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Use custom delay or default exponential backoff
            const delay = delays[attempt] || (1000 * Math.pow(2, attempt));
            
            // Call retry callback if provided
            if (onRetry) {
                onRetry(error, attempt + 1, delay);
            }
            
            logger.debug(`Retrying operation in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await sleep(delay);
        }
    }
    
    throw lastError;
}

/**
 * Retry function specifically for API calls
 * @param {Function} apiCall - The API call function
 * @param {Object} options - Retry options
 * @returns {Promise} - Promise that resolves with the API response
 */
async function retryApiCall(apiCall, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        timeoutMs = 10000
    } = options;
    
    return retryWithStrategy(apiCall, {
        maxRetries,
        timeout: timeoutMs,
        shouldRetry: (error) => {
            // Don't retry client errors (4xx), but retry server errors (5xx) and network errors
            if (error.response) {
                const status = error.response.status;
                return status >= 500 || status === 429; // Retry server errors and rate limits
            }
            
            // Retry network errors
            return error.code === 'ECONNRESET' || 
                   error.code === 'ENOTFOUND' || 
                   error.code === 'ECONNREFUSED' ||
                   error.message.includes('timeout');
        },
        delays: Array.from({ length: maxRetries }, (_, i) => 
            Math.min(baseDelay * Math.pow(2, i), maxDelay)
        ),
        onRetry: (error, attempt, delay) => {
            const status = error.response?.status || 'network error';
            logger.warn(`API call failed (${status}), retrying in ${delay}ms (attempt ${attempt})`);
        }
    });
}

/**
 * Retry function with circuit breaker pattern
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 60000; // 60 seconds
        this.monitoringPeriod = options.monitoringPeriod || 60000; // 60 seconds
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        
        // Reset failure count periodically
        setInterval(() => {
            if (this.state === 'CLOSED') {
                this.failureCount = 0;
            }
        }, this.monitoringPeriod);
    }
    
    async execute(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime < this.recoveryTimeout) {
                throw new Error('Circuit breaker is OPEN');
            } else {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) { // Require 3 successes to close circuit
                this.state = 'CLOSED';
                logger.info('Circuit breaker closed after successful recovery');
            }
        }
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            logger.warn(`Circuit breaker opened after ${this.failureCount} failures`);
        }
    }
    
    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
        };
    }
}

/**
 * Rate limiter utility
 */
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }
    
    async execute(operation) {
        await this.waitForSlot();
        this.requests.push(Date.now());
        return operation();
    }
    
    async waitForSlot() {
        this.cleanup();
        
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = this.windowMs - (Date.now() - oldestRequest);
            
            if (waitTime > 0) {
                logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
                await sleep(waitTime);
                this.cleanup();
            }
        }
    }
    
    cleanup() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
    }
    
    getStatus() {
        this.cleanup();
        return {
            currentRequests: this.requests.length,
            maxRequests: this.maxRequests,
            windowMs: this.windowMs,
            isLimited: this.requests.length >= this.maxRequests
        };
    }
}

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the specified time
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a timeout promise
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Error message for timeout
 * @returns {Promise} - Promise that rejects after timeout
 */
function createTimeout(ms, message = 'Operation timed out') {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}

/**
 * Race operation against timeout
 * @param {Promise} operation - The operation to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} timeoutMessage - Error message for timeout
 * @returns {Promise} - Promise that resolves with operation result or rejects on timeout
 */
async function withTimeout(operation, timeoutMs, timeoutMessage = 'Operation timed out') {
    return Promise.race([
        operation,
        createTimeout(timeoutMs, timeoutMessage)
    ]);
}

/**
 * Batch operations with concurrency limit
 * @param {Array} items - Items to process
 * @param {Function} operation - Operation to perform on each item
 * @param {number} concurrency - Maximum concurrent operations
 * @returns {Promise<Array>} - Array of results
 */
async function batchProcess(items, operation, concurrency = 3) {
    const results = [];
    
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchPromises = batch.map(item => operation(item));
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
    }
    
    return results;
}

module.exports = {
    retryWithBackoff,
    retryWithFixedDelay,
    retryWithStrategy,
    retryApiCall,
    CircuitBreaker,
    RateLimiter,
    sleep,
    createTimeout,
    withTimeout,
    batchProcess
};