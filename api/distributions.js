const fetch = require('node-fetch');

const DISTRIBUTION_WALLET = '2LK7yxZsy6YVCkFQ4PrL644ve1fgRj5FuDexj5JgS753';
const ZOOT_MINT = '3max6YL5yL6nrLHN3iHZWqfH1ufoSWFXs6RA4VjLhAtd';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '3036b078-dc16-44c0-9bf6-ac9d342d354d';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

    try {
        const distributions = await fetchDistributions();
        return res.json({ success: true, distributions });
    } catch (e) {
        console.error('Distribution fetch error:', e.message);
        return res.json({ success: false, error: e.message, distributions: [] });
    }
};

// Paginate the Helius enriched-transactions endpoint so dust spam against the
// distribution wallet can't push real ZOOT transfers out of the 100-tx window.
const HELIUS_MAX_PAGES = 60;
const HELIUS_PAGE_SIZE = 100;

async function fetchDistributions() {
    const distributions = [];
    const seen = new Set();
    let before = '';

    for (let page = 0; page < HELIUS_MAX_PAGES; page++) {
        const url = `https://api.helius.xyz/v0/addresses/${DISTRIBUTION_WALLET}/transactions?api-key=${HELIUS_API_KEY}&limit=${HELIUS_PAGE_SIZE}${before ? `&before=${before}` : ''}`;

        const response = await fetch(url);
        if (!response.ok) {
            if (page > 0) break;
            throw new Error(`Helius error: ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) break;

        for (const tx of data) {
            if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) continue;
            for (const transfer of tx.tokenTransfers) {
                if (
                    transfer.fromUserAccount === DISTRIBUTION_WALLET &&
                    transfer.mint === ZOOT_MINT &&
                    transfer.tokenAmount > 0
                ) {
                    const key = `${tx.signature}:${transfer.toUserAccount}:${transfer.tokenAmount}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    distributions.push({
                        recipient: transfer.toUserAccount,
                        zootAmount: transfer.tokenAmount,
                        txHash: tx.signature,
                        timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now()
                    });
                }
            }
        }

        if (data.length < HELIUS_PAGE_SIZE) break;
        before = data[data.length - 1].signature;
        if (!before) break;
    }

    return distributions;
}
