const { ethers } = require('ethers');

// Caching mechanism to avoid redundant lookups
const ensCache = new Map();

/**
 * Resolves an Ethereum address to its corresponding ENS name.
 * @param {string} address The Ethereum address to resolve.
 * @returns {Promise<string|null>} The ENS name, or null if not found.
 */
async function resolveEnsName(address) {
    // Check cache first
    if (ensCache.has(address)) {
        return ensCache.get(address);
    }

    try {
        const provider = new ethers.JsonRpcProvider('https://eth.drpc.org');

        const ensName = await provider.lookupAddress(address);

        // Cache the result
        ensCache.set(address, ensName);

        return ensName;
    } catch (error) {
        console.error(`Error resolving ENS name for ${address}:`, error);
        // Cache null on error to prevent repeated failed lookups
        ensCache.set(address, null);
        return null;
    }
}

module.exports = {
    resolveEnsName,
};