// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Deployment addresses for the Celo networks Foresight Arena targets.
/// @dev Every value below was read back from the chain (see script/README or the
///      commands in docs/DECISIONS.md), not copied from a blog post. Re-verify before
///      any mainnet deployment -- the hackathon primitives are still moving.
library CeloAddresses {
    uint256 internal constant MAINNET_CHAIN_ID = 42220;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11142220;

    // -- stake token -------------------------------------------------------
    address internal constant MAINNET_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address internal constant SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;

    /// @dev Fee-abstraction adapters. USDC has 6 decimals, so `feeCurrency` must point at
    ///      the ADAPTER, never at the token itself.
    address internal constant MAINNET_USDC_FEE_ADAPTER = 0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B;
    address internal constant SEPOLIA_USDC_FEE_ADAPTER = 0xbf1441Ea57f43f35f713431001f35742c88071c7;

    // -- Mento oracle (Celo Registry: getAddressForString("SortedOracles")) --
    address internal constant MAINNET_SORTED_ORACLES = 0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33;
    address internal constant SEPOLIA_SORTED_ORACLES = 0xAb077999e5fA13bCda1599926F8927dDEADe533C;

    /// @dev cUSD; the classic Mento feeds use the stable token address as the rate feed id.
    address internal constant MAINNET_CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address internal constant SEPOLIA_CUSD = 0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80;

    // -- ERC-8004 registries ----------------------------------------------
    address internal constant MAINNET_IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address internal constant MAINNET_REPUTATION_REGISTRY = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address internal constant SEPOLIA_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant SEPOLIA_REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // -- Self (proof of personhood), for the Phase 5 human onboarding ------
    address internal constant MAINNET_SELF_HUB = 0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF;
    address internal constant TESTNET_SELF_HUB = 0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74;

    error UnsupportedChain(uint256 chainId);

    function usdc(uint256 chainId) internal pure returns (address) {
        if (chainId == MAINNET_CHAIN_ID) return MAINNET_USDC;
        if (chainId == SEPOLIA_CHAIN_ID) return SEPOLIA_USDC;
        revert UnsupportedChain(chainId);
    }

    function sortedOracles(uint256 chainId) internal pure returns (address) {
        if (chainId == MAINNET_CHAIN_ID) return MAINNET_SORTED_ORACLES;
        if (chainId == SEPOLIA_CHAIN_ID) return SEPOLIA_SORTED_ORACLES;
        revert UnsupportedChain(chainId);
    }

    function cusd(uint256 chainId) internal pure returns (address) {
        if (chainId == MAINNET_CHAIN_ID) return MAINNET_CUSD;
        if (chainId == SEPOLIA_CHAIN_ID) return SEPOLIA_CUSD;
        revert UnsupportedChain(chainId);
    }

    function identityRegistry(uint256 chainId) internal pure returns (address) {
        if (chainId == MAINNET_CHAIN_ID) return MAINNET_IDENTITY_REGISTRY;
        if (chainId == SEPOLIA_CHAIN_ID) return SEPOLIA_IDENTITY_REGISTRY;
        revert UnsupportedChain(chainId);
    }

    function reputationRegistry(uint256 chainId) internal pure returns (address) {
        if (chainId == MAINNET_CHAIN_ID) return MAINNET_REPUTATION_REGISTRY;
        if (chainId == SEPOLIA_CHAIN_ID) return SEPOLIA_REPUTATION_REGISTRY;
        revert UnsupportedChain(chainId);
    }
}
