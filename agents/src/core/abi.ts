/** Hand-written ABI fragments. Regenerate from `forge inspect <C> abi` if the contracts change. */

export const foresightPoolAbi = [
  {
    type: 'function',
    name: 'createMarket',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'question', type: 'string'},
      {name: 'resolver', type: 'address'},
      {name: 'resolverConfig', type: 'bytes'},
      {name: 'closesAt', type: 'uint64'},
      {name: 'resolvesAt', type: 'uint64'},
    ],
    outputs: [{name: 'marketId', type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'stake',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'marketId', type: 'uint256'},
      {name: 'side', type: 'uint8'},
      {name: 'amount', type: 'uint256'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'nonpayable',
    inputs: [{name: 'marketId', type: 'uint256'}],
    outputs: [{name: 'outcome', type: 'uint8'}],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{name: 'marketId', type: 'uint256'}],
    outputs: [{name: 'payout', type: 'uint256'}],
  },
  {type: 'function', name: 'marketCount', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256'}]},
  {type: 'function', name: 'stakeToken', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
  {
    type: 'function',
    name: 'getMarket',
    stateMutability: 'view',
    inputs: [{name: 'marketId', type: 'uint256'}],
    outputs: [
      {
        type: 'tuple',
        components: [
          {name: 'creator', type: 'address'},
          {name: 'resolver', type: 'address'},
          {name: 'closesAt', type: 'uint64'},
          {name: 'resolvesAt', type: 'uint64'},
          {name: 'outcome', type: 'uint8'},
          {name: 'yesPool', type: 'uint128'},
          {name: 'noPool', type: 'uint128'},
          {name: 'question', type: 'string'},
          {name: 'resolverConfig', type: 'bytes'},
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'stakeOf',
    stateMutability: 'view',
    inputs: [
      {name: 'marketId', type: 'uint256'},
      {name: 'account', type: 'address'},
      {name: 'side', type: 'uint8'},
    ],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'previewPayout',
    stateMutability: 'view',
    inputs: [
      {name: 'marketId', type: 'uint256'},
      {name: 'account', type: 'address'},
    ],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'openExposure',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'hasClaimed',
    stateMutability: 'view',
    inputs: [
      {name: 'marketId', type: 'uint256'},
      {name: 'account', type: 'address'},
    ],
    outputs: [{type: 'bool'}],
  },
  {type: 'function', name: 'MAX_STAKE_PER_POSITION', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256'}]},
  {
    type: 'function',
    name: 'exposureCapOf',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'agentIdOf',
    stateMutability: 'view',
    inputs: [{name: 'wallet', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'isApprovedResolver',
    stateMutability: 'view',
    inputs: [{name: 'resolver', type: 'address'}],
    outputs: [{type: 'bool'}],
  },
  {type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
  {type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{type: 'bool'}]},
  {
    type: 'function',
    name: 'MAX_OPEN_EXPOSURE_AGENT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'MAX_OPEN_EXPOSURE_HUMAN',
    stateMutability: 'view',
    inputs: [],
    outputs: [{type: 'uint256'}],
  },

  // -- owner-only administration ---------------------------------------
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'wallet', type: 'address'},
      {name: 'agentId', type: 'uint256'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deregisterAgent',
    stateMutability: 'nonpayable',
    inputs: [{name: 'wallet', type: 'address'}],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setResolverApproval',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'resolver', type: 'address'},
      {name: 'approved', type: 'bool'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'voidMarket',
    stateMutability: 'nonpayable',
    inputs: [{name: 'marketId', type: 'uint256'}],
    outputs: [],
  },
  {type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: []},
  {type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: []},

  // -- events the dashboard indexes ------------------------------------
  {
    type: 'event',
    name: 'MarketCreated',
    inputs: [
      {name: 'marketId', type: 'uint256', indexed: true},
      {name: 'creator', type: 'address', indexed: true},
      {name: 'resolver', type: 'address', indexed: true},
      {name: 'closesAt', type: 'uint64', indexed: false},
      {name: 'resolvesAt', type: 'uint64', indexed: false},
      {name: 'question', type: 'string', indexed: false},
    ],
  },
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      {name: 'marketId', type: 'uint256', indexed: true},
      {name: 'account', type: 'address', indexed: true},
      {name: 'side', type: 'uint8', indexed: false},
      {name: 'amount', type: 'uint256', indexed: false},
    ],
  },
  {
    type: 'event',
    name: 'MarketResolved',
    inputs: [
      {name: 'marketId', type: 'uint256', indexed: true},
      {name: 'outcome', type: 'uint8', indexed: false},
      {name: 'yesPool', type: 'uint256', indexed: false},
      {name: 'noPool', type: 'uint256', indexed: false},
    ],
  },
  {
    type: 'event',
    name: 'Claimed',
    inputs: [
      {name: 'marketId', type: 'uint256', indexed: true},
      {name: 'account', type: 'address', indexed: true},
      {name: 'payout', type: 'uint256', indexed: false},
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'spender', type: 'address'},
      {name: 'amount', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      {name: 'owner', type: 'address'},
      {name: 'spender', type: 'address'},
    ],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{type: 'uint256'}]},
  {type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{type: 'uint8'}]},
  {type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{type: 'string'}]},
] as const;

/** ERC-8004 Reputation Registry -- only the call this project makes. */
export const reputationRegistryAbi = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'agentId', type: 'uint256'},
      {name: 'value', type: 'int128'},
      {name: 'valueDecimals', type: 'uint8'},
      {name: 'tag1', type: 'string'},
      {name: 'tag2', type: 'string'},
      {name: 'endpoint', type: 'string'},
      {name: 'feedbackURI', type: 'string'},
      {name: 'feedbackHash', type: 'bytes32'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      {name: 'agentId', type: 'uint256'},
      {name: 'clientAddresses', type: 'address[]'},
      {name: 'tag1', type: 'string'},
      {name: 'tag2', type: 'string'},
    ],
    outputs: [
      {name: 'count', type: 'uint64'},
      {name: 'summaryValue', type: 'int128'},
      {name: 'summaryValueDecimals', type: 'uint8'},
    ],
  },
] as const;

/** ERC-8004 Identity Registry -- registration only. */
export const identityRegistryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{name: 'agentURI', type: 'string'}],
    outputs: [{name: 'agentId', type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'setAgentURI',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'agentId', type: 'uint256'},
      {name: 'newURI', type: 'string'},
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      {name: 'agentId', type: 'uint256', indexed: true},
      {name: 'agentURI', type: 'string', indexed: false},
      {name: 'owner', type: 'address', indexed: true},
    ],
  },
] as const;

export const sortedOraclesAbi = [
  {
    type: 'function',
    name: 'medianRate',
    stateMutability: 'view',
    inputs: [{name: 'rateFeedId', type: 'address'}],
    outputs: [
      {name: 'numerator', type: 'uint256'},
      {name: 'denominator', type: 'uint256'},
    ],
  },
  {
    type: 'function',
    name: 'medianTimestamp',
    stateMutability: 'view',
    inputs: [{name: 'rateFeedId', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'numRates',
    stateMutability: 'view',
    inputs: [{name: 'rateFeedId', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
] as const;

/** AttestedScoreResolver -- the write the score attestor makes, plus the public record. */
export const attestedScoreResolverAbi = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'eventKey', type: 'bytes32'},
      {name: 'outcome', type: 'uint8'},
      {name: 'payloadHash', type: 'bytes32'},
      {name: 'sourceURI', type: 'string'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'attestations',
    stateMutability: 'view',
    inputs: [{name: 'eventKey', type: 'bytes32'}],
    outputs: [
      {name: 'outcome', type: 'uint8'},
      {name: 'publishedAt', type: 'uint64'},
      {name: 'payloadHash', type: 'bytes32'},
      {name: 'sourceURI', type: 'string'},
    ],
  },
  {type: 'function', name: 'attestor', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
] as const;

/** Shared by every resolver: the dashboard renders `describe` next to each market. */
export const outcomeResolverAbi = [
  {
    type: 'function',
    name: 'describe',
    stateMutability: 'view',
    inputs: [{name: 'config', type: 'bytes'}],
    outputs: [{type: 'string'}],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'view',
    inputs: [{name: 'config', type: 'bytes'}],
    outputs: [{type: 'uint8'}],
  },
] as const;

/** MentoPriceResolver -- the agent asks the resolver which oracle it will settle against. */
export const mentoPriceResolverAbi = [
  {type: 'function', name: 'sortedOracles', stateMutability: 'view', inputs: [], outputs: [{type: 'address'}]},
] as const;
