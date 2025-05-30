// Simple ATH Performance Analyzer - Following Codex API best practices
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class SimpleATHAnalyzer {
    constructor() {
        this.scanResultsDir = path.join(process.cwd(), 'scan_results');
        this.codexApiUrl = 'https://graph.codex.io/graphql';
        this.codexApiKey = process.env.CODEX_API_KEY;
        
        // Fixed entry price for all tokens
        this.FIXED_ENTRY_PRICE = 0.0001;
        
        this.results = {
            analyzed: 0,
            successful: 0,
            failed: 0,
            tokens: []
        };
    }

    async analyzeScanResults() {
        console.log('🔍 Simple ATH Analysis using Codex API best practices...');
        
        try {
            const files = await fs.readdir(this.scanResultsDir);
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            
            console.log(`📁 Found ${jsonFiles.length} scan result files`);
            
            for (const file of jsonFiles) {
                await this.analyzeFile(file);
            }
            
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Error analyzing scan results:', error);
        }
    }

    async analyzeFile(filename) {
        const filepath = path.join(this.scanResultsDir, filename);
        
        try {
            const content = await fs.readFile(filepath, 'utf8');
            const data = JSON.parse(content);
            
            const records = Array.isArray(data) ? data : [data];
            console.log(`📊 Analyzing ${records.length} records from ${filename}`);
            
            for (const record of records) {
                await this.analyzeTokenRecord(record);
            }
            
        } catch (error) {
            console.error(`❌ Error processing ${filename}:`, error.message);
        }
    }

    async analyzeTokenRecord(record) {
        try {
            const tokenData = {
                address: record.address,
                symbol: record.symbol,
                name: record.name,
                scanTimestamp: new Date(record.timestamp),
                eventType: record.eventType,
                twitterMetrics: {
                    likes: record.likes || 0,
                    views: record.views || 0
                },
                tweetLink: record.tweetLink
            };

            console.log(`\n🔍 Analyzing ${tokenData.symbol} (${tokenData.address})`);
            console.log(`   Scanned: ${tokenData.scanTimestamp.toLocaleString()}`);
            console.log(`   Twitter: ${tokenData.twitterMetrics.likes} likes, ${tokenData.twitterMetrics.views} views`);

            // Get ATH using Codex recommended approach
            const athPrice = await this.getATHSimple(tokenData.address);
            
            if (athPrice !== null) {
                const performance = {
                    ...tokenData,
                    entryPrice: this.FIXED_ENTRY_PRICE,
                    ath: athPrice,
                    performanceMetrics: this.calculatePerformanceMetrics(athPrice)
                };
                
                this.results.tokens.push(performance);
                this.results.successful++;
                
                console.log(`✅ Analysis complete:`);
                console.log(`   Entry price: $${this.FIXED_ENTRY_PRICE} (fixed)`);
                console.log(`   ATH: $${performance.ath?.toFixed(8) || 'N/A'}`);
                console.log(`   Max Gain: ${performance.performanceMetrics.maxGainPercent?.toFixed(2) || 'N/A'}%`);
                
            } else {
                console.log(`❌ Failed to get ATH data`);
                this.results.failed++;
            }
            
            this.results.analyzed++;
            
        } catch (error) {
            console.error(`❌ Error analyzing token record:`, error.message);
            this.results.failed++;
        }
    }

    async getATHSimple(tokenAddress) {
        try {
            if (!this.codexApiKey) {
                throw new Error('CODEX_API_KEY not found in environment variables');
            }

            console.log(`   📈 Fetching ATH with smart pagination for precision...`);

            // Smart approach: 
            // 1. First get daily bars to find approximate ATH period
            // 2. Then get 1-minute data around that period for precision
            
            // Step 1: Get daily overview to find the rough ATH period
            const dailyATH = await this.getDailyATHOverview(tokenAddress);
            if (!dailyATH) {
                return null;
            }

            // Step 2: Get precise 1-minute data around the ATH period
            const preciseATH = await this.getPreciseATHAround(tokenAddress, dailyATH.athTimestamp);
            
            return preciseATH || dailyATH.price;

        } catch (error) {
            console.log(`   ❌ Error getting ATH: ${error.message}`);
            return null;
        }
    }

    async getDailyATHOverview(tokenAddress) {
        try {
            // Step 1: Get daily bars for entire history (within limits)
            const query = `
                query GetDailyATH($symbol: String!, $from: Int!, $to: Int!) {
                    getBars(
                        symbol: $symbol
                        from: $from
                        to: $to
                        resolution: "1D"
                        removeLeadingNullValues: true
                        currencyCode: "USD"
                    ) {
                        t
                        h
                    }
                }
            `;

            const currentTime = Math.floor(Date.now() / 1000);
            // Limit to ~3 years of daily data (1095 days) to stay under 1500 limit
            const fromTime = currentTime - (1095 * 24 * 60 * 60);

            const variables = {
                symbol: `${tokenAddress}:1399811149`,
                from: fromTime,
                to: currentTime
            };

            const response = await axios.post(this.codexApiUrl, {
                query,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.codexApiKey,
                },
                timeout: 30000
            });

            if (response.data.errors) {
                console.log(`   ❌ Daily overview errors:`, response.data.errors);
                return null;
            }

            const bars = response.data.data?.getBars;
            if (!bars || !bars.h || bars.h.length === 0) {
                console.log(`   ❌ No daily data available`);
                return null;
            }

            // Find the day with highest price
            let maxPrice = 0;
            let maxIndex = -1;
            
            for (let i = 0; i < bars.h.length; i++) {
                if (bars.h[i] > maxPrice) {
                    maxPrice = bars.h[i];
                    maxIndex = i;
                }
            }

            console.log(`   📊 Daily overview: ATH ~${maxPrice.toFixed(8)} (${bars.h.length} days analyzed)`);

            return {
                price: maxPrice,
                athTimestamp: bars.t[maxIndex]
            };

        } catch (error) {
            console.log(`   ❌ Error in daily overview: ${error.message}`);
            return null;
        }
    }

    async getPreciseATHAround(tokenAddress, athTimestamp) {
        try {
            // Step 2: Get 1-minute data around the ATH day for precision
            // Use ±12 hours around the ATH timestamp (1440 minutes = within limit)
            const bufferHours = 12;
            const fromTime = athTimestamp - (bufferHours * 60 * 60);
            const toTime = athTimestamp + (bufferHours * 60 * 60);

            console.log(`   🎯 Getting precise 1-minute data around ATH period...`);

            const query = `
                query GetPreciseATH($symbol: String!, $from: Int!, $to: Int!) {
                    getBars(
                        symbol: $symbol
                        from: $from
                        to: $to
                        resolution: "1"
                        removeLeadingNullValues: true
                        currencyCode: "USD"
                    ) {
                        h
                    }
                }
            `;

            const variables = {
                symbol: `${tokenAddress}:1399811149`,
                from: fromTime,
                to: toTime
            };

            const response = await axios.post(this.codexApiUrl, {
                query,
                variables
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.codexApiKey,
                },
                timeout: 30000
            });

            if (response.data.errors) {
                console.log(`   ⚠️ Precision data not available, using daily ATH`);
                return null;
            }

            const bars = response.data.data?.getBars;
            if (!bars || !bars.h || bars.h.length === 0) {
                console.log(`   ⚠️ No 1-minute data, using daily ATH`);
                return null;
            }

            // Find the precise ATH from 1-minute data
            const preciseATH = Math.max(...bars.h.filter(price => price > 0));
            
            console.log(`   ✅ Precise ATH: ${preciseATH.toFixed(8)} (from ${bars.h.length} 1-minute bars)`);
            
            return preciseATH;

        } catch (error) {
            console.log(`   ⚠️ Precision lookup failed, using daily ATH: ${error.message}`);
            return null;
        }
    }

    calculatePerformanceMetrics(ath) {
        if (!ath || ath === 0) {
            return {
                maxGainPercent: null,
                signalQuality: 'unknown'
            };
        }

        // Calculate gain from FIXED entry price only
        const maxGainPercent = ((ath - this.FIXED_ENTRY_PRICE) / this.FIXED_ENTRY_PRICE) * 100;
        
        // Determine signal quality based on gains
        let signalQuality = 'poor';
        if (maxGainPercent > 1000) signalQuality = 'excellent'; // 10x+
        else if (maxGainPercent > 500) signalQuality = 'great'; // 5x+
        else if (maxGainPercent > 100) signalQuality = 'good'; // 2x+
        else if (maxGainPercent > 50) signalQuality = 'fair'; // 1.5x+

        return {
            maxGainPercent,
            signalQuality
        };
    }

    generateReport() {
        console.log('\n📊 SIMPLE ATH PERFORMANCE REPORT');
        console.log('='.repeat(50));
        
        console.log(`\n📈 Overall Statistics:`);
        console.log(`   Total tokens analyzed: ${this.results.analyzed}`);
        console.log(`   Successful analyses: ${this.results.successful}`);
        console.log(`   Failed analyses: ${this.results.failed}`);
        console.log(`   Fixed entry price: $${this.FIXED_ENTRY_PRICE}`);
        console.log(`   Method: Codex daily bars (entire history)`);
        
        if (this.results.tokens.length === 0) {
            console.log('\n❌ No successful analyses to report');
            return;
        }

        // Sort by max gain
        const sortedTokens = this.results.tokens
            .filter(t => t.performanceMetrics.maxGainPercent !== null)
            .sort((a, b) => b.performanceMetrics.maxGainPercent - a.performanceMetrics.maxGainPercent);

        console.log(`\n🏆 Top Performing Tokens:`);
        sortedTokens.slice(0, 15).forEach((token, i) => {
            const gain = token.performanceMetrics.maxGainPercent;
            const multiplier = (gain / 100 + 1).toFixed(1);
            console.log(`   ${i + 1}. ${token.symbol} - ${gain.toFixed(2)}% (${multiplier}x)`);
            console.log(`      ATH: $${token.ath?.toFixed(8)} | Twitter: ${token.twitterMetrics.likes} likes`);
        });

        // Calculate statistics
        const validGains = sortedTokens.map(t => t.performanceMetrics.maxGainPercent);
        const avgGain = validGains.reduce((sum, gain) => sum + gain, 0) / validGains.length;
        const medianGain = validGains.sort((a, b) => a - b)[Math.floor(validGains.length / 2)];
        
        // Performance brackets
        const brackets = {
            '10x+': validGains.filter(g => g > 1000).length,
            '5x-10x': validGains.filter(g => g > 500 && g <= 1000).length,
            '2x-5x': validGains.filter(g => g > 100 && g <= 500).length,
            '1.5x-2x': validGains.filter(g => g > 50 && g <= 100).length,
            '<1.5x': validGains.filter(g => g <= 50).length
        };

        console.log(`\n📊 Performance Metrics:`);
        console.log(`   Average gain: ${avgGain.toFixed(2)}%`);
        console.log(`   Median gain: ${medianGain.toFixed(2)}%`);
        console.log(`   Performance brackets:`);
        Object.entries(brackets).forEach(([bracket, count]) => {
            const percentage = ((count / validGains.length) * 100).toFixed(1);
            console.log(`     ${bracket}: ${count} tokens (${percentage}%)`);
        });

        this.exportResults();
    }

    async exportResults() {
        try {
            const filename = `simple_ath_analysis_${new Date().toISOString().split('T')[0]}.json`;
            const filepath = path.join(this.scanResultsDir, filename);
            
            const exportData = {
                summary: {
                    analyzed: this.results.analyzed,
                    successful: this.results.successful,
                    failed: this.results.failed,
                    fixedEntryPrice: this.FIXED_ENTRY_PRICE,
                    method: 'Codex daily bars - entire token history'
                },
                tokens: this.results.tokens.map(token => ({
                    symbol: token.symbol,
                    address: token.address,
                    scanDate: token.scanTimestamp,
                    twitterLikes: token.twitterMetrics.likes,
                    twitterViews: token.twitterMetrics.views,
                    entryPrice: this.FIXED_ENTRY_PRICE,
                    ath: token.ath,
                    maxGainPercent: token.performanceMetrics.maxGainPercent,
                    signalQuality: token.performanceMetrics.signalQuality
                }))
            };
            
            await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
            console.log(`\n💾 Results exported to: ${filename}`);
            
        } catch (error) {
            console.error('❌ Error exporting results:', error.message);
        }
    }
}

// Usage
async function main() {
    console.log('🚀 Simple ATH Performance Analysis');
    console.log('==================================');
    console.log('📘 Following Codex API documentation exactly:');
    console.log('   1. Use getBars API');
    console.log('   2. Set resolution: "1D" for daily data');
    console.log('   3. Set from: 0 with removeLeadingNullValues: true');
    console.log('   4. Parse only the h (high) prices');
    console.log('   5. Find max value = ATH');
    console.log(`   6. Calculate gain from fixed $0.0001 entry`);
    console.log('');
    
    const analyzer = new SimpleATHAnalyzer();
    await analyzer.analyzeScanResults();
}

// Export for use as module
module.exports = SimpleATHAnalyzer;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    });
}