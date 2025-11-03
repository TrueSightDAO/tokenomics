# Understanding TrueSight DAO's Daily Buy-Back Budget: Building Value Through Asset-Backed Stability

At TrueSight DAO, we're building a purpose-driven economy where every decision strengthens our community and drives meaningful change. A cornerstone of this vision is our Daily Buy-Back Budget, an initiative to repurchase TDG tokens from the market, supporting token stability and reinforcing value for our ecosystem. This budget updates every day, reflecting our latest performance and treasury strength. In this post, we'll break down how it works, how each part is calculated, and why it matters to our mission.

## What Is the Daily Buy-Back Budget?

The Daily Buy-Back Budget is the amount TrueSight DAO allocates each day to buy back TDG tokens. Rather than relying on speculative market prices, this budget is used to support our [voting rights cash-out program](https://dapp.truesight.me/withdraw_voting_rights.html), allowing community members to exchange their TDG voting rights for tangible assets at their intrinsic asset-backed value. This program, which was voted into effect on-chain by our community to ensure transparency and collective decision-making, helps maintain token stability, rewards our community's commitment, and aligns with our goal of fostering a resilient ecosystem. You can view the governance proposal and voting details here. Displayed among our ecosystem statistics, the budget is a transparent measure of our dedication to building value.

Unlike a fixed amount, the budget changes daily based on a formula that captures our sales activity and treasury-backed value. Let's dive into how we calculate it.

## The Formula Behind the Budget

The Daily Buy-Back Budget is determined by a clear and balanced formula:

**Daily Buy-Back Budget = (Last 30 Days Sales / 30) × min(Asset Per Issued TDG, 1 - US 1 Month Treasury Bill Rate)**

Each component is carefully calculated to ensure the budget reflects TrueSight DAO's growth and asset-backed value. Here's how we compute each part:

### Last 30 Days Sales

**What It Is:** This is the total revenue TrueSight DAO generates over the previous 30 days, capturing the community's engagement through sales and transactions.

**How It's Calculated:** We sum all USD-denominated sales recorded in our off-chain transaction ledger over the past 30 days. For example, our ecosystem statistics show $806.09 in sales, representing the total value of qualifying transactions in that period.

**Why It Matters:** This figure grounds the budget in our actual performance, ensuring the buy-back program scales with our growth.

### Divided by 30

**What It Is:** We divide the Last 30 Days Sales by 30 to find the average daily sales.

**How It's Calculated:** Using the example of $806.09, we compute $806.09 / 30 ≈ $26.87. This average smooths out daily fluctuations, providing a stable base for the budget.

**Why It Matters:** The daily average ensures our buy-back budget is sustainable, reflecting consistent activity rather than short-term spikes.

### Asset Per Issued TDG

**What It Is:** This is the intrinsic value of each TDG token, backed by TrueSight DAO's treasury assets. It represents how much in assets (USD) backs each TDG token in circulation.

**How It's Calculated:** We calculate this by dividing TrueSight DAO's total assets by the voting rights circulated. Our total assets include:
- Off-chain assets (inventory, receivables, cash)
- USDT vault balance on Solana
- AGL (Agroverse) investment holdings

For example, if total assets are $32,000 and voting rights circulated are 80,000, we compute $32,000 / 80,000 = $0.40 per TDG.

**Why It Matters:** Using asset-backed value instead of market price ensures our buy-back budget reflects the tangible value supporting TDG tokens. This protects our treasury from speculative market volatility while maintaining a price floor grounded in real assets. When market prices drop below asset backing, we can buy back at intrinsic value, strengthening the treasury. When market prices exceed asset backing, the formula prevents overpaying for tokens.

### US 1 Month Treasury Bill Rate

**What It Is:** This is the yield on 1-month US Treasury Bills, a standard measure of short-term interest rates.

**How It's Calculated:** We retrieve the most recent 1-month Treasury Bill rate from financial data sources, expressed as a decimal (e.g., a 5% rate is 0.05). In the formula, we compute 1 - rate (e.g., 1 - 0.05 = 0.95).

**Why It Matters:** This rate acts as a benchmark for economic conditions, helping us cap the budget responsibly by accounting for the opportunity cost of capital.

### Minimum Function (min)

**What It Is:** We take the lower of the Asset Per Issued TDG or 1 - US 1 Month Treasury Bill Rate.

**How It's Calculated:** For example, if Asset Per Issued TDG is $0.40 and the Treasury rate is 0.05, we compare 0.40 to 1 - 0.05 = 0.95. The minimum is 0.40.

**Why It Matters:** This ensures the budget doesn't overcommit funds when market or economic conditions suggest restraint, while using asset-backed value protects our treasury from buying back tokens above their intrinsic backing value.

### Final Calculation

**How It's Calculated:** We multiply the daily sales average by the minimum value. Using our examples: $26.87 × 0.40 = $10.75 yields the daily budget in USD.

**Why It Matters:** This step combines performance (sales) with treasury-backed value, producing a budget that reflects both our growth and the tangible assets supporting TDG tokens.

Each day, we recalculate these components using the latest data—updated sales, current asset-per-issued-TDG ratio, and current Treasury rates—to set a new Daily Buy-Back Budget.

## Why Do We Buy Back TDG Tokens?

The Daily Buy-Back Budget is a powerful tool with clear benefits for TrueSight DAO:

### Supporting the Cash-Out Program

The budget directly supports our [voting rights cash-out program](https://dapp.truesight.me/withdraw_voting_rights.html), allowing community members to convert their TDG tokens back into cash at asset-backed intrinsic value. Unlike speculative exchanges where prices fluctuate wildly, our program offers a stable, transparent exit option tied to real treasury assets.

### Supporting Stability

By providing a reliable cash-out mechanism at intrinsic value, we reduce price volatility and foster confidence among token holders, knowing they have a clear path to convert their TDG tokens when needed.

### Investing in Our Vision

The buy-back program signals our belief in TDG's long-term potential, reinvesting in the community that drives us while providing a safety net for community members who need to exit.

### Protecting Treasury Value

By using asset-backed intrinsic value rather than speculative market price, we ensure our buy-backs strengthen the treasury without overpaying for tokens. When market prices are below asset backing, we can acquire tokens at or below their intrinsic value, effectively increasing the asset-per-token ratio for remaining holders. This creates a natural price floor supported by our real assets.

### Scaling with Success

By tying the budget to sales, we ensure the program grows as TrueSight DAO thrives.

### Embracing Transparency

We share the budget in our ecosystem statistics, letting everyone see our commitment in action. The entire cash-out process is transparent through our [withdraw voting rights system](https://dapp.truesight.me/withdraw_voting_rights.html), where community members can see exactly how their voting rights are valued based on treasury assets.

## Looking Ahead

Because the Daily Buy-Back Budget updates every day, it's a living reflection of TrueSight DAO's progress. As our sales grow, DAO assets expand, or Treasury rates fluctuate, the budget adapts to keep us on track. By anchoring our buy-back calculations to asset-backed value rather than market price, we ensure the program remains sustainable and aligned with our treasury's true strength.

This approach sets TrueSight DAO apart from speculative token models by creating a built-in valuation floor tied to real assets. We're also exploring ways to deepen community input, ensuring this program evolves with your vision.

You can see the latest budget in our ecosystem statistics, a testament to our transparency and shared purpose. It's not just about numbers—it's about building trust, step by step.

## Need to Cash Out Your Voting Rights?

Community members can exchange their TDG voting rights for cash through our [voting rights cash-out program](https://dapp.truesight.me/withdraw_voting_rights.html). The system calculates your payout based on the asset-per-issued-TDG ratio, ensuring you receive the intrinsic value backed by TrueSight DAO's treasury assets. This program is supported by the Daily Buy-Back Budget, creating a sustainable, transparent exit mechanism for our community.

## Join the Movement

Ready to explore more? Dive into TrueSight DAO's vision and discover how you can contribute to a purpose-driven economy. Have questions about the Daily Buy-Back Budget, TDG tokens, or the cash-out program? Reach out—we're here to walk this path together.

Together, we're shaping a future that matters.

