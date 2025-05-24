// src/services/jsonLogger.js - Simple scan results logger
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class JsonLogger {
    constructor(config = {}) {
        this.config = {
            logsDirectory: config.logsDirectory || path.join(process.cwd(), 'scan_results'),
            maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
            ...config
        };

        // Ensure logsDirectory is always a string
        if (!this.config.logsDirectory || typeof this.config.logsDirectory !== 'string') {
            this.config.logsDirectory = path.join(process.cwd(), 'scan_results');
        }

        this.ensureDirectoryExists();
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(this.config.logsDirectory, { recursive: true });
        } catch (error) {
            logger.error('Failed to create scan results directory:', error);
        }
    }

    /**
     * Save scan result - ONLY the basics
     */
    async saveScanResult(analysisResult) {
        try {
            const { tokenInfo, twitterMetrics, operationId } = analysisResult;
            
            // Just the basics - exactly what you asked for
            const scanData = {
                timestamp: new Date().toISOString(),
                id: operationId,
                eventType: tokenInfo?.eventType || 'creation',
                address: tokenInfo?.address || tokenInfo?.mint || '',
                symbol: tokenInfo?.symbol || 'Unknown',
                name: tokenInfo?.name || 'Unknown',
                tweetLink: twitterMetrics?.link || '',
                likes: twitterMetrics?.likes || 0,
                views: twitterMetrics?.views || 0
            };
            
            const eventType = scanData.eventType;
            const filename = `${eventType}_scans.json`;
            const filepath = path.join(this.config.logsDirectory, filename);
            
            await this.appendToJsonFile(filepath, scanData);
            
        } catch (error) {
            // Silent fail - don't spam logs with JSON errors
        }
    }

    async appendToJsonFile(filepath, data) {
        try {
            let existingData = [];
            
            // Try to read existing file
            try {
                const fileContent = await fs.readFile(filepath, 'utf8');
                if (fileContent.trim()) {
                    existingData = JSON.parse(fileContent);
                    if (!Array.isArray(existingData)) {
                        existingData = [existingData];
                    }
                }
            } catch (error) {
                // File doesn't exist, start with empty array
                existingData = [];
            }
            
            // Add new data
            existingData.push(data);
            
            // Check file size and rotate if needed
            const dataSize = JSON.stringify(existingData).length;
            if (dataSize > this.config.maxFileSize) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedPath = filepath.replace('.json', `_${timestamp}.json`);
                await fs.rename(filepath, rotatedPath);
                existingData = [data]; // Start fresh
            }
            
            // Write data
            await fs.writeFile(filepath, JSON.stringify(existingData, null, 2), 'utf8');
            
        } catch (error) {
            // Silent fail
        }
    }
}

module.exports = JsonLogger;