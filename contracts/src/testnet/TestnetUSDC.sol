// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title TestnetUSDC -- a faucet-backed stake token for Celo Sepolia ONLY
///
/// @notice Celo Sepolia's USDC (0x01C5...C44E) is a real Circle FiatToken: there is no
///         public mint, and `mint` reverts with "caller is not a minter" for everyone but
///         Circle's master minter. A demo whose stake token nobody can obtain is not a
///         demo, and the whole point of Phase 5 is that independent people can take a
///         position without us funding their wallet first -- which is also precisely what
///         the hackathon counts as an independent participant.
///
///         So on testnet the pool settles in this token, which anyone can tap. On mainnet
///         it settles in real USDC (CeloAddresses.MAINNET_USDC) and this contract is
///         never deployed.
///
/// @dev Six decimals is not cosmetic: {ForesightPool} rejects any stake token whose
///      `decimals()` is not 6, because its symbolic-limit constants are written in
///      6-decimal units. Keeping the stand-in at 6 keeps those limits meaning the same
///      thing on both networks.
contract TestnetUSDC is ERC20, EIP712 {
    /// @notice How much one faucet call hands out. Ten times the per-account exposure cap
    ///         for a human, so a visitor can take positions without returning repeatedly,
    ///         and small enough that the token stays obviously worthless.
    uint256 public constant FAUCET_AMOUNT = 50e6;

    /// @notice Minimum gap between two faucet calls for the same recipient.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    event FaucetDripped(address indexed recipient, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Foresight Testnet USDC", "tUSDC") EIP712("Foresight Testnet USDC", "2") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint the faucet amount to `recipient`. Permissionless by design.
    /// @dev Rate limited per recipient rather than per caller: limiting the caller would
    ///      only mean paying gas from a second address, which is no limit at all.
    function faucet(address recipient) external {
        uint256 last = lastFaucetAt[recipient];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[recipient] = block.timestamp;
        _mint(recipient, FAUCET_AMOUNT);
        emit FaucetDripped(recipient, FAUCET_AMOUNT);
    }

    /// @notice When `recipient` may tap the faucet again. Zero means "right now".
    function faucetAvailableAt(address recipient) external view returns (uint256) {
        uint256 last = lastFaucetAt[recipient];
        if (last == 0) return 0;
        uint256 next = last + FAUCET_COOLDOWN;
        return next <= block.timestamp ? 0 : next;
    }

    // -----------------------------------------------------------------
    // EIP-3009: transfer with authorization
    // -----------------------------------------------------------------
    //
    // Real USDC implements EIP-3009, and x402's "exact" EVM scheme settles with it: the
    // payer signs an authorization off chain and the facilitator submits it, so the payer
    // needs no gas and the resource server is paid in one HTTP exchange. Without it this
    // stand-in could not stand in for USDC on the payment path -- the arena would settle
    // in a token the payment layer cannot move.

    /// @dev keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    /// @dev keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    /// @notice authorizer => nonce => used. Nonces are arbitrary bytes32, not sequential.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();

    /// @notice Move `value` from `from` to `to` on the strength of `from`'s signature.
    /// @dev Permissionless to submit: anyone may relay a valid authorization, which is
    ///      the whole point -- the facilitator pays the gas, not the payer.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) != from) revert InvalidSignature();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /// @notice Burn an unused authorization before anyone can submit it.
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        if (authorizationState[authorizer][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));
        if (ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) != authorizer) revert InvalidSignature();

        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /// @notice The EIP-712 domain separator, which x402 clients need to sign correctly.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-3009 implementations are conventionally version "2"; x402 reads this
    ///         to build the signing domain.
    function version() external pure returns (string memory) {
        return "2";
    }
}
