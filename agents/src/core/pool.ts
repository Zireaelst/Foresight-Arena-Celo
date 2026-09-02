import {encodeFunctionData, type Address, type Hex} from 'viem';

import {foresightPoolAbi, erc20Abi} from './abi.js';
import {sendTaggedAndWait, type ChainContext} from './chain.js';
import {Outcome, Side, type MarketView} from './types.js';

/** Typed read/write wrapper around ForesightPool. Every write goes through sendTagged. */
export class PoolClient {
  constructor(
    private readonly ctx: ChainContext,
    readonly address: Address,
  ) {}

  // -- reads -------------------------------------------------------------

  /**
   * The token the pool actually settles in, read from the pool itself rather than from a
   * local address table -- the contract is the only thing that can be wrong about this.
   */
  async stakeToken(): Promise<Address> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'stakeToken',
    });
  }

  async marketCount(): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'marketCount',
    });
  }

  async getMarket(marketId: bigint): Promise<MarketView> {
    const m = await this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'getMarket',
      args: [marketId],
    });
    return {
      id: marketId,
      creator: m.creator,
      resolver: m.resolver,
      closesAt: Number(m.closesAt),
      resolvesAt: Number(m.resolvesAt),
      outcome: m.outcome as Outcome,
      yesPool: m.yesPool,
      noPool: m.noPool,
      question: m.question,
      resolverConfig: m.resolverConfig,
    };
  }

  async listMarkets(): Promise<MarketView[]> {
    const count = await this.marketCount();
    const ids = Array.from({length: Number(count)}, (_, i) => BigInt(i));
    return Promise.all(ids.map((id) => this.getMarket(id)));
  }

  async stakeOf(marketId: bigint, account: Address, side: Side): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'stakeOf',
      args: [marketId, account, side],
    });
  }

  async previewPayout(marketId: bigint, account: Address): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'previewPayout',
      args: [marketId, account],
    });
  }

  async hasClaimed(marketId: bigint, account: Address): Promise<boolean> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'hasClaimed',
      args: [marketId, account],
    });
  }

  async openExposure(account: Address): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: this.address,
      abi: foresightPoolAbi,
      functionName: 'openExposure',
      args: [account],
    });
  }

  /** The pool's own caps. The runner clamps to these so local budgets can never exceed them. */
  async onChainLimits(account: Address): Promise<{maxPerPosition: bigint; maxExposure: bigint}> {
    const [maxPerPosition, maxExposure] = await Promise.all([
      this.ctx.publicClient.readContract({
        address: this.address,
        abi: foresightPoolAbi,
        functionName: 'MAX_STAKE_PER_POSITION',
      }),
      this.ctx.publicClient.readContract({
        address: this.address,
        abi: foresightPoolAbi,
        functionName: 'exposureCapOf',
        args: [account],
      }),
    ]);
    return {maxPerPosition, maxExposure};
  }

  // -- writes ------------------------------------------------------------

  private send(data: Hex) {
    return sendTaggedAndWait(this.ctx, {to: this.address, data});
  }

  async createMarket(args: {
    question: string;
    resolver: Address;
    resolverConfig: Hex;
    closesAt: number;
    resolvesAt: number;
  }) {
    return this.send(
      encodeFunctionData({
        abi: foresightPoolAbi,
        functionName: 'createMarket',
        args: [args.question, args.resolver, args.resolverConfig, BigInt(args.closesAt), BigInt(args.resolvesAt)],
      }),
    );
  }

  async stake(marketId: bigint, side: Side, amount: bigint) {
    return this.send(
      encodeFunctionData({abi: foresightPoolAbi, functionName: 'stake', args: [marketId, side, amount]}),
    );
  }

  async resolve(marketId: bigint) {
    return this.send(encodeFunctionData({abi: foresightPoolAbi, functionName: 'resolve', args: [marketId]}));
  }

  async claim(marketId: bigint) {
    return this.send(encodeFunctionData({abi: foresightPoolAbi, functionName: 'claim', args: [marketId]}));
  }

  /**
   * Tops the pool's allowance up to exactly `needed` when it is short.
   *
   * Deliberately not an infinite approval: these wallets hold symbolic balances and the
   * whole point of the project is that limits are visible, so the allowance stays
   * bounded too.
   */
  async ensureAllowance(token: Address, needed: bigint): Promise<void> {
    const current = await this.ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [this.ctx.account, this.address],
    });
    if (current >= needed) return;

    await sendTaggedAndWait(this.ctx, {
      to: token,
      data: encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [this.address, needed]}),
    });
  }

  async balanceOf(token: Address): Promise<bigint> {
    return this.ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.ctx.account],
    });
  }
}
