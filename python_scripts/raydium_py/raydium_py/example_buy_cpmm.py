from raydium.cpmm import buy

if __name__ == "__main__":
    pair_address = "BN9dS3iF1onv3jzY1GBM9pZ71vBa75Azdxzbnm7v8pQb"
    sol_in = 0.0013074209832778213
    slippage = 5
    buy(pair_address, sol_in, slippage)