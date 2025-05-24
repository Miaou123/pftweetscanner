const BigNumber = require('bignumber.js');
const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger');

const MIN_TOKEN_THRESHOLD = 1000;

async function getHolders(coinAddress, mainContext, subContext) {
  const solanaApi = getSolanaApi();
  try {
    const tokenSupplyInfo = await solanaApi.getTokenSupply(coinAddress, mainContext, subContext);
    const tokenDecimals = tokenSupplyInfo.value.decimals;

    let allHolders = new Map();
    let cursor = null;

    while (true) {
      const result = await solanaApi.getTokenAccounts(coinAddress, 1000, cursor, mainContext, subContext);
      result.token_accounts.forEach((account) => {
        const balance = new BigNumber(account.amount).dividedBy(new BigNumber(10).pow(tokenDecimals));
        if (balance.isGreaterThanOrEqualTo(MIN_TOKEN_THRESHOLD)) {
          allHolders.set(account.owner, {
            address: account.owner,
            balance: balance.toNumber(),
            tokenBalance: balance.toString() // Store as string to prevent precision loss
          });
        }
      });

      cursor = result.cursor;

      if (!cursor) {
        break;
      }
    }

    return Array.from(allHolders.values());
  } catch (error) {
    logger.error('Error fetching holders:', { error, coinAddress, mainContext, subContext });
    throw error;
  }
}

async function getTopHolders(coinAddress, count = 20, mainContext, subContext) {
  const solanaApi = getSolanaApi();
  try {
    let topHolders;
    const tokenSupplyInfo = await solanaApi.getTokenSupply(coinAddress, mainContext, subContext);
    const tokenDecimals = tokenSupplyInfo.value.decimals;

    if (count <= 20) {
      const result = await solanaApi.getTokenLargestAccounts(coinAddress, mainContext, subContext);

      if (!result || !result.value) {
        logger.error(`Invalid response from Helius API for coin: ${coinAddress}`, { result });
        throw new Error('Invalid response from Helius API');
      }

      topHolders = await Promise.all(result.value.map(async (account, index) => {
        const tokenAccountInfo = await solanaApi.getAccountInfo(account.address, { encoding: 'jsonParsed' }, mainContext, subContext);
        if (!isValidAccountInfo(tokenAccountInfo)) {
          logger.warn(`Invalid account info for address: ${account.address}`);
          return null;
        }

        const ownerAddress = tokenAccountInfo.value.data.parsed.info.owner;
        const solBalance = await getSolBalance(ownerAddress, solanaApi, mainContext, subContext);
        
        // Calculate the token amount with proper decimal handling
        const rawAmount = account.amount;
        const amount = new BigNumber(rawAmount).dividedBy(new BigNumber(10).pow(tokenDecimals));

        return {
          address: ownerAddress,
          amount: amount.toNumber(), // For sorting and display
          tokenBalance: amount.toString(), // Store exact value as string
          solBalance
        };
      }));

      topHolders = topHolders.filter(holder => holder !== null);
      topHolders = topHolders.slice(0, count);

    } else {
      const allHolders = await getHolders(coinAddress, mainContext, subContext);
      topHolders = allHolders
        .sort((a, b) => b.balance - a.balance)
        .slice(0, count);
    }

    return formatTopHolders(topHolders);
  } catch (error) {
    logger.error('Error fetching top holders:', { error, coinAddress, count, mainContext, subContext });
    throw error;
  }
}

/**
 * Formats the top holders into a consistent output structure.
 * @param {Array} holders - List of holder objects.
 * @returns {Array} - Formatted list of top holders.
 */
function formatTopHolders(holders) {
  return holders.map(holder => ({
    address: holder.address || holder.pubkey,
    tokenBalance: holder.tokenBalance || holder.balance.toString(),
    balance: typeof holder.balance === 'number' ? holder.balance : 
             typeof holder.amount === 'number' ? holder.amount :
             parseFloat(holder.balance || holder.amount || '0'),
    solBalance: holder.solBalance || '0'
  }));
}

/**
 * Checks if the account information is valid.
 * @param {Object} accountInfo - Account information.
 * @returns {boolean} - Returns true if account info is valid.
 */
function isValidAccountInfo(accountInfo) {
  return accountInfo && accountInfo.value && accountInfo.value.data && accountInfo.value.data.parsed;
}

/**
 * Retrieves the SOL balance for a given owner address.
 * @param {string} ownerAddress - Address of the account owner.
 * @param {Object} solanaApi - Solana API instance.
 * @param {string} mainContext - Main context for API calls.
 * @param {string} subContext - Sub context for API calls.
 * @returns {string} - SOL balance as a formatted string.
 */
async function getSolBalance(ownerAddress, solanaApi, mainContext, subContext) {
  try {
    const solBalanceResponse = await solanaApi.getBalance(ownerAddress, mainContext, subContext);
    if (solBalanceResponse && solBalanceResponse.value !== undefined) {
      return new BigNumber(solBalanceResponse.value).dividedBy(1e9).toFixed(9);
    } else {
      logger.warn(`Invalid SOL balance response for ${ownerAddress}:`, solBalanceResponse);
      return '0';
    }
  } catch (error) {
    logger.error(`Error fetching SOL balance for address: ${ownerAddress}`, { error });
    return '0';
  }
}

module.exports = { getHolders, getTopHolders };