// Simple ATH Calculator - Get the all-time high of any Solana token
require('dotenv').config();
const axios = require('axios');

class ATHCalculator {
    constructor() {
        this.codexApiUrl = 'https://graph.codex.io/graphql';
        this.codexApiKey = process.env.CODEX_API_KEY;
    }

    async calculateATH(tokenAddress, fromDate = null) {
        if (!this.codexApiKey) {
            throw new Error('CODEX_API_KEY not found in environment variables');
        }

        console.log(`🔍 Calculating ATH for young token: ${tokenAddress}`);
        
        try {
            // Set time range - optimized for young tokens (default 48 hours)
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const fromTimestamp = fromDate ? 
                Math.floor(new Date(fromDate).getTime() / 1000) : 
                currentTimestamp - (48 * 60 * 60); // Default: 48 hours ago

            const timeRangeHours = (currentTimestamp - fromTimestamp) / 3600;
            
            console.log(`📅 Time range: ${timeRangeHours.toFixed(1)} hours (${(timeRangeHours/24).toFixed(1)} days)`);
            console.log(`   From: ${new Date(fromTimestamp * 1000).toLocaleString()}`);
            console.log(`   To: ${new Date(currentTimestamp * 1000).toLocaleString()}`);

            // Optimized resolution for young tokens - prioritize precision
            let resolution = "1"; // Always use 1-minute resolution for maximum precision
            let expectedDataPoints = Math.ceil(timeRangeHours * 60);
            
            // Only increase resolution if we'd exceed API limits (>1500 points)
            if (expectedDataPoints > 1400) {
                if (timeRangeHours <= 120) { // Up to 5 days
                    resolution = "5"; // 5 minutes
                    expectedDataPoints = Math.ceil(timeRangeHours * 12);
                } else {
                    resolution = "15"; // 15 minutes (for edge cases)
                    expectedDataPoints = Math.ceil(timeRangeHours * 4);
                }
            }

            console.log(`⚙️ Using ${resolution}-minute resolution (expecting ~${expectedDataPoints} data points)`);

            const query = `
                query GetPriceData($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
                    getBars(
                        symbol: $symbol
                        from: $from
                        to: $to
                        resolution: $resolution
                        removeLeadingNullValues: true
                        currencyCode: "USD"
                    ) {
                        t
                        h
                        l
                        o
                        c
                        v
                    }
                }
            `;

            const variables = {
                symbol: `${tokenAddress}:1399811149`, // Solana mainnet chain ID
                from: fromTimestamp,
                to: currentTimestamp,
                resolution: resolution
            };

            console.log(`🌐 Fetching price data from CODEX API...`);
            
            const response = await this.callCodexAPI(query, variables);
            
            if (!response.data?.getBars?.t || response.data.getBars.t.length === 0) {
                throw new Error('No price data available for this token');
            }

            const bars = response.data.getBars;
            console.log(`📊 Received ${bars.t.length} data points`);

            // Calculate ATH
            const athResult = this.findATH(bars);
            
            // Display results
            this.displayResults(tokenAddress, athResult, bars, resolution);
            
            return athResult;

        } catch (error) {
            console.error(`❌ Error calculating ATH: ${error.message}`);
            throw error;
        }
    }

    findATH(bars) {
        let ath = 0;
        let athIndex = -1;
        let athTimestamp = null;
        
        // For young tokens, we want to be very precise about the ATH timing
        // Check every single minute for the exact peak
        for (let i = 0; i < bars.h.length; i++) {
            if (bars.h[i] > ath) {
                ath = bars.h[i];
                athIndex = i;
                athTimestamp = bars.t[i];
            }
        }

        // Get additional data for the ATH point
        const athData = {
            price: ath,
            timestamp: athTimestamp,
            date: athTimestamp ? new Date(athTimestamp * 1000) : null,
            index: athIndex,
            open: athIndex >= 0 ? bars.o[athIndex] : null,
            close: athIndex >= 0 ? bars.c[athIndex] : null,
            low: athIndex >= 0 ? bars.l[athIndex] : null,
            volume: athIndex >= 0 ? bars.v[athIndex] : null,
            // Add minute-precise timing info for young tokens
            minutesFromStart: athIndex >= 0 ? Math.round((athTimestamp - bars.t[0]) / 60) : null,
            hoursFromStart: athIndex >= 0 ? ((athTimestamp - bars.t[0]) / 3600).toFixed(2) : null
        };

        // Calculate some additional metrics relevant to young tokens
        const currentPrice = bars.c[bars.c.length - 1];
        const firstPrice = bars.o[0];
        const launchPrice = bars.o[0]; // More relevant term for young tokens
        
        // Find the steepest price movement (pump detection)
        let maxRise = 0;
        let maxRiseStartIndex = -1;
        let maxRiseEndIndex = -1;
        
        for (let i = 1; i < bars.h.length; i++) {
            const prevLow = bars.l[i-1];
            const currentHigh = bars.h[i];
            const rise = (currentHigh - prevLow) / prevLow;
            
            if (rise > maxRise) {
                maxRise = rise;
                maxRiseStartIndex = i-1;
                maxRiseEndIndex = i;
            }
        }
        
        return {
            ath: athData,
            currentPrice: currentPrice,
            launchPrice: launchPrice,
            firstPrice: firstPrice,
            totalBars: bars.t.length,
            priceRange: {
                min: Math.min(...bars.l),
                max: ath
            },
            pumpDetails: maxRise > 0 ? {
                maxRisePercent: maxRise * 100,
                pumpStartTime: new Date(bars.t[maxRiseStartIndex] * 1000),
                pumpEndTime: new Date(bars.t[maxRiseEndIndex] * 1000),
                pumpDurationMinutes: Math.round((bars.t[maxRiseEndIndex] - bars.t[maxRiseStartIndex]) / 60)
            } : null
        };
    }

    displayResults(tokenAddress, result, bars, resolution) {
        console.log('\n🏆 ATH ANALYSIS FOR YOUNG TOKEN');
        console.log('='.repeat(50));
        
        console.log(`\n📍 Token: ${tokenAddress}`);
        console.log(`📊 Data points analyzed: ${result.totalBars} (${resolution}-minute resolution)`);
        console.log(`⏱️ Total tracking period: ${(result.totalBars * parseInt(resolution) / 60).toFixed(1)} hours`);
        
        if (result.ath.price > 0) {
            console.log(`\n🚀 ALL-TIME HIGH (MINUTE-PRECISE):`);
            console.log(`   Price: ${result.ath.price.toFixed(8)}`);
            console.log(`   Exact time: ${result.ath.date.toLocaleString()}`);
            
            if (result.ath.minutesFromStart !== null) {
                console.log(`   Time from launch: ${result.ath.minutesFromStart} minutes (${result.ath.hoursFromStart}h)`);
            }
            
            if (result.ath.volume) {
                console.log(`   Volume at ATH: ${result.ath.volume.toLocaleString()}`);
            }
            
            console.log(`\n📈 Young Token Price Analysis:`);
            console.log(`   Launch Price: ${result.launchPrice?.toFixed(8) || 'N/A'}`);
            console.log(`   ATH: ${result.ath.price.toFixed(8)}`);
            console.log(`   Current: ${result.currentPrice?.toFixed(8) || 'N/A'}`);
            console.log(`   Lowest: ${result.priceRange.min.toFixed(8)}`);
            
            if (result.launchPrice && result.launchPrice > 0) {
                const athGainFromLaunch = ((result.ath.price - result.launchPrice) / result.launchPrice) * 100;
                const athMultiplier = (result.ath.price / result.launchPrice).toFixed(1);
                console.log(`   Launch → ATH: +${athGainFromLaunch.toFixed(2)}% (${athMultiplier}x)`);
            }
            
            if (result.currentPrice && result.currentPrice > 0) {
                const currentFromLaunch = ((result.currentPrice - result.launchPrice) / result.launchPrice) * 100;
                const currentFromATH = ((result.currentPrice - result.ath.price) / result.ath.price) * 100;
                console.log(`   Launch → Current: ${currentFromLaunch >= 0 ? '+' : ''}${currentFromLaunch.toFixed(2)}%`);
                console.log(`   Down from ATH: ${Math.abs(currentFromATH).toFixed(2)}%`);
            }
            
            // Show pump analysis for young tokens
            if (result.pumpDetails) {
                console.log(`\n🎯 BIGGEST PUMP DETECTED:`);
                console.log(`   Max rise: ${result.pumpDetails.maxRisePercent.toFixed(2)}% in ${result.pumpDetails.pumpDurationMinutes} minutes`);
                console.log(`   Pump start: ${result.pumpDetails.pumpStartTime.toLocaleString()}`);
                console.log(`   Pump peak: ${result.pumpDetails.pumpEndTime.toLocaleString()}`);
            }
            
            // Token age analysis
            const tokenAgeHours = (Date.now() - bars.t[0] * 1000) / (1000 * 60 * 60);
            console.log(`\n⏰ Token Age Analysis:`);
            console.log(`   Token age: ${tokenAgeHours.toFixed(1)} hours (${(tokenAgeHours/24).toFixed(1)} days)`);
            console.log(`   ATH reached after: ${result.ath.hoursFromStart}h (${((result.ath.hoursFromStart / tokenAgeHours) * 100).toFixed(1)}% of lifetime)`);
            
        } else {
            console.log(`\n❌ No valid price data found`);
        }
        
        console.log('\n' + '='.repeat(50));
    }

    async callCodexAPI(query, variables) {
        try {
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
                console.error('GraphQL Errors:', response.data.errors);
                throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
            }

            return response.data;
            
        } catch (error) {
            if (error.response) {
                console.error('API Response Error:', error.response.status, error.response.data);
                throw new Error(`CODEX API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                throw error;
            }
        }
    }
}

// CLI Usage
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('🚀 ATH Calculator for Solana Tokens');
        console.log('===================================');
        console.log('');
        console.log('Usage:');
        console.log('  node ath-calculator.js TOKEN_ADDRESS [FROM_DATE]');
        console.log('');
        console.log('Examples:');
        console.log('  node ath-calculator.js HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm');
        console.log('  node ath-calculator.js HBiqfjGvfVhXozbo2vG2gzsMKLUDZiZSJBYWWEtqx2rm "2024-11-27"');
        console.log('  node ath-calculator.js DDiP1d5aAjdKUCq1WrJGshk58TUFAkdmZ3zUXwAopump "2024-11-27T10:30:00"');
        console.log('');
        console.log('Optimized for young tokens (<48 hours old):');
        console.log('  - Uses 1-minute resolution for maximum precision');
        console.log('  - Default 48-hour lookback period');
        console.log('  - Shows exact timing of ATH from launch');
        console.log('  - Detects biggest pump movements');
        console.log('');
        console.log('Requirements:');
        console.log('  - Add CODEX_API_KEY to your .env file');
        process.exit(1);
    }

    const tokenAddress = args[0];
    const fromDate = args[1] || null;

    if (!tokenAddress || tokenAddress.length < 32) {
        console.error('❌ Invalid token address. Please provide a valid Solana token address.');
        process.exit(1);
    }

    try {
        const calculator = new ATHCalculator();
        const result = await calculator.calculateATH(tokenAddress, fromDate);
        
        console.log('\n✅ ATH calculation completed successfully!');
        
        // Return result for programmatic use
        return result;
        
    } catch (error) {
        console.error(`❌ Failed to calculate ATH: ${error.message}`);
        process.exit(1);
    }
}

// Export for use as module
module.exports = ATHCalculator;

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}