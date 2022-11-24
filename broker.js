// Information about the stock that is currently analyzed
let CACHED_STOCK = [];
// A ledger of the stocks we currently own, how many we own, and at what price we bought that amount
let STOCKS_OWNED = []; // 2D arr
// Minimum forecast is for shorting, maximum forecast are for long buys
const FORECAST_BOUNDS = [0.35, 0.65];
// For those that dont wanna play the safe stocks that pay very little
// const MINVOL = 0.001;
// Bigger risk bigger gain but risking billions on a single tick is uh.. unwise?
const MAXVOL = 0.10;
// const SELL_CUTOFF = 0.5
const SLEEP = 6000; // Stocks update every ~6 seconds
let hasBitnode = false;
// If you have essentially infinite money then you can always buy out a stock, for maximum potential
// profit.
const infCash = false;
let S = 100; // Default
const STOP_LOSS = 0.90; // Oops. Bad pick. Pull the plug.

/** @param {NS} ns */
export async function main(ns) {
    ns.tprint("[¤] BROKER DAEMON ONLINE --");
    if (ns.args.length != 2) {
        ns.tprint("Usage: ./broker.js [Stocks per buy] [Can short stocks (0/1)");
        return;
    }
    // The number of shares to buy
    S = ns.args[0];
    // Bitnode-8 decides if a player is allowed to short stocks or not
    hasBitnode = (ns.args[1] === 1);
    // Get the ticker names of all the stocks on the market, so we can check them one by one
    let symbols = ns.stock.getSymbols();
    while(true) {
        for (let i = 0; i < symbols.length; i++) {
            let SYM = symbols[i];
            // ns.tprint("Evaluating " + SYM + "...");
            // Buys a stock IF it is likely to be profitable
            await evalInvestment(ns, SYM);
            // Sells a stock IF it has made money
            // Unlike reality, most stocks will, eventually, be profitable
            if (ownsStock(SYM))
                await evalSell(ns, SYM);
            // ns.tprint(SYM + " evaluated!");
        }
        await ns.sleep(SLEEP);
    }
}

// Easier to read than a single unspaced number
const toPrintableNumber = (N) => { return N.toLocaleString().replace(" ", ","); }

// Updates the cache with the information of the current stock, to avoid having more ns calls than necessary
async function updateCache (ns, SYM) { 
    let shares       = infCash ? (await ns.stock.getMaxShares(SYM)) : S;
    CACHED_STOCK     = await ns.stock.getPosition(SYM);
    CACHED_STOCK[4]  = await ns.stock.getForecast(SYM);
    CACHED_STOCK[5]  = await ns.stock.getVolatility(SYM);
    CACHED_STOCK[6]  = await ns.stock.getSaleGain(SYM, shares, "Long");
    CACHED_STOCK[7]  = await ns.stock.getSaleGain(SYM, shares, "Short");
    CACHED_STOCK[8]  = await ns.stock.getPurchaseCost(SYM, shares, "Long");
    CACHED_STOCK[9]  = await ns.stock.getPurchaseCost(SYM, shares, "Short");
}
// Fetches the fields of the cache, for easier readability
const ownsLong   = () => {  return CACHED_STOCK[0];  }
const longAVG    = () => {  return CACHED_STOCK[1];  }
const ownsShort  = () => {  return CACHED_STOCK[2];  }
const shortAVG   = () => {  return CACHED_STOCK[3];  }
const forecast   = () => {  return CACHED_STOCK[4];  }
const volatility = () => {  return CACHED_STOCK[5];  }
const gainLong   = () => {  return CACHED_STOCK[6];  }
const gainShort  = () => {  return CACHED_STOCK[7];  }
const priceLong  = () => {  return CACHED_STOCK[8];  }
const priceShort = () => {  return CACHED_STOCK[9];  }

// Check if a stock is currently owned
const ownsStock = (SYM) => {
    for (let i = 0; i < STOCKS_OWNED.length; i++) {
        if (STOCKS_OWNED[i][0] == SYM) return true;
    } return false;
}

// Get our current position on a selected stock, returns undefined if the stock is not owned
const getPos = (SYM) => {
    for(let i = 0; i < STOCKS_OWNED.length; i++) {
        if (STOCKS_OWNED[i][0] === SYM) {
            return STOCKS_OWNED[i];
        }
    } return undefined;
}

// Buys a number of shares of a stock IF we can afford it, and stores it in the ledger
async function buyStock (ns, SYM, POS, N) {
    let price = 0;
    let cash = ns.getPlayer().money;
    if (POS == "short" && hasBitnode) {
        price = priceShort();
        if (price <= cash)
            await ns.stock.buyShort(SYM, N);
    } else {
        price = priceLong();
        if (price <= cash)
            await ns.stock.buyStock(SYM, N);
    }
    STOCKS_OWNED.push([SYM, N, price]);
}

// Sells all the shares we own of a stock, and purges it from the ledger
async function sellStock (ns, SYM, POS, N) {
    if (POS == "short" && hasBitnode) {
        await ns.stock.sellShort(SYM, N);
    } else {
        await ns.stock.sellStock(SYM, N);
    }
    let pos = getPos(SYM);
    STOCKS_OWNED.splice(STOCKS_OWNED.indexOf(pos), 1);
}

// Either returns the max number of shares a stock has, or the preprogrammed number
async function max (ns, SYM) {
    return infCash ? (await ns.stock.getMaxShares(SYM)) : S;
}

async function evalInvestment (ns, SYM) {
    // Update the cache
    await updateCache(ns, SYM);
    // Get our money
    let cash = ns.getPlayer().money;
    let price = 0;
    // Get the number of shares to buy
    let M = await max(ns, SYM);
    // Don't rebuy a stock that is already owned
    if (!ownsStock(SYM)) {
        // Ensure that we dont do anything too insane
        if (volatility() < MAXVOL) { // If there is less than 5% max change per tick
            // Ensure that number go up
            if (forecast() > FORECAST_BOUNDS[1]) { // Buy long, >65% chance of rising
                price = priceLong();
                if (price <= cash) {
                    ns.tprint("Bought " + SYM + " at $" + toPrintableNumber(Math.floor(price)));
                    ns.tprint("Forecast is " + forecast() + " and volatility is " + volatility());
                    await buyStock(ns, SYM, "long", M);
                }
            // Ensure that number go down
            } else if (forecast() < FORECAST_BOUNDS[0] && hasBitnode) { // Buy short, <35% chance of rising
                price = priceShort();
                if (price <= cash) {
                    ns.tprint("Bought " + SYM + " at $" + toPrintableNumber(Math.floor(price)));
                    ns.tprint("Forecast is " + forecast() + " and volatility is " + volatility());
                    await buyStock(ns, SYM, "short", M);
                }
                
            } // else ns.tprint(SYM + " rejected because forecast too uncertain");
        } // else ns.tprint(SYM + " rejected because volatility is too high");
    } // else ns.tprint(SYM + " rejected because it is already owned");
}

async function evalSell (ns, SYM) {
    // Update the cache
    // SHOULD be uneccessary since we always run a SELL after a BUY
    // await updateCache(ns, SYM);
    let gain = 0;
    // Get our position
    let pos = getPos(SYM);
    if (ownsStock(SYM)) { // Just in case
        if (ownsLong() > 0) {
            // If selling now makes money or if we're htting the stop loss, then sell
            gain = gainLong() - pos[2];
            if (gain > 0 || gainLong() < pos[2] * STOP_LOSS) {
                ns.tprint("Sold " + SYM + " for $" + toPrintableNumber(Math.floor(gain + pos[2])));
                ns.tprint(gain > 0 ? "Profited $" + toPrintableNumber(gain) : "STOP LOSS: lost $" + toPrintableNumber(gain));
                await sellStock(ns, SYM, "long", ownsLong());
            }
        } if (ownsShort() > 0) {
            gain = gainShort() - pos[2];
            if (gain > 0 || gainShort() < pos[2] * STOP_LOSS) {
                ns.tprint("Sold " + SYM + " for $" + toPrintableNumber(Math.floor(gain + pos[2])));
                ns.tprint("Profited $" + toPrintableNumber(gain));
                await sellStock(ns, SYM, "short", ownsShort());
                
            }
        }
    }
}
