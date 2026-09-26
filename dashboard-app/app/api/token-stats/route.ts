import { NextResponse } from "next/server";

const TOKEN_MINT = process.env.BITXBIT_TOKEN_MINT || "DK6PWMyuZ4NMjsm9AWNCTMKrajQYrtfMjMJ3QauX2UH5";
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY;
const TOKEN_CREATED_AT = "2021-10-17"; // bitxbit token creation date

interface TokenStats {
  price: number | null;
  priceChange24h: number | null;
  holders: number | null;
  liquidity: number | null;
  marketCap: number | null;
  createdAt: string;
  mint: string;
  errors: string[];
}

export async function GET() {
  const stats: TokenStats = {
    price: null,
    priceChange24h: null,
    holders: null,
    liquidity: null,
    marketCap: null,
    createdAt: TOKEN_CREATED_AT,
    mint: TOKEN_MINT,
    errors: [],
  };

  // Solscan Pro API V2 - latest price
  if (SOLSCAN_API_KEY) {
    try {
      const priceRes = await fetch(
        `https://pro-api.solscan.io/v2.0/token/price/latest?address=${TOKEN_MINT}`,
        {
          headers: { token: SOLSCAN_API_KEY },
          next: { revalidate: 60 },
        }
      );
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const tokenPrice = priceData?.data?.find((item: any) => item.address === TOKEN_MINT);
        if (tokenPrice) {
          stats.price = tokenPrice.price ?? null;
          stats.priceChange24h = tokenPrice.price_change_24h ?? null;
          stats.marketCap = tokenPrice.market_cap ?? null;
        }
      } else {
        stats.errors.push(`Solscan price API error: ${priceRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Solscan price fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Solscan Pro API V2 - holders
    try {
      const holdersRes = await fetch(
        `https://pro-api.solscan.io/v2.0/token/holders?address=${TOKEN_MINT}&page=1&page_size=10`,
        {
          headers: { token: SOLSCAN_API_KEY },
          next: { revalidate: 300 },
        }
      );
      if (holdersRes.ok) {
        const holdersData = await holdersRes.json();
        stats.holders = holdersData?.data?.total ?? null;
      } else {
        stats.errors.push(`Solscan holders API error: ${holdersRes.status}`);
      }
    } catch (err) {
      stats.errors.push(`Solscan holders fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    stats.errors.push("SOLSCAN_API_KEY not configured");
  }

  // Dexscreener Keyless API - total liquidity
  try {
    const dexRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${TOKEN_MINT}`,
      { next: { revalidate: 60 } }
    );
    if (dexRes.ok) {
      const dexData = await dexRes.json();
      const pairs = dexData?.pairs ?? [];
      const totalLiquidity = pairs.reduce((sum: number, pair: any) => {
        return sum + (pair.liquidity?.usd ?? 0);
      }, 0);
      stats.liquidity = totalLiquidity > 0 ? totalLiquidity : null;

      // Fallback price if Solscan didn't return one
      if (stats.price === null && pairs.length > 0) {
        stats.price = parseFloat(pairs[0].priceUsd) || null;
        stats.marketCap = pairs[0].marketCap ?? pairs[0].fdv ?? null;
      }
    } else {
      stats.errors.push(`Dexscreener API error: ${dexRes.status}`);
    }
  } catch (err) {
    stats.errors.push(`Dexscreener fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json(stats, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
