// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Isolated, operator-funded grant demonstration. This contract does not
///         attest to a Track0 close, payable, approval, or customer obligation.
///         It cannot access Track0's database or settlement authority.
contract GrantSplitDemo {
    using SafeERC20 for IERC20;

    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 public constant ARC_MAINNET_CHAIN_ID = 5042;
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 public constant MAX_TOTAL_BASE_UNITS = 1_000_000; // 1.000000 USDC

    address public immutable payer;
    address public immutable recipientA;
    address public immutable recipientB;
    uint256 public immutable amountA;
    uint256 public immutable amountB;
    uint256 public immutable chainId;
    bytes32 public immutable demoId;
    bool public executed;

    error UnsupportedChain();
    error WrongChain();
    error InvalidPayer();
    error InvalidRecipient();
    error RecipientIsPayer();
    error DuplicateRecipient();
    error InvalidAmount();
    error AmountCapExceeded();
    error InvalidDemoId();
    error AlreadyExecuted();

    event DemoSplitExecuted(
        bytes32 indexed demoId,
        address indexed payer,
        address indexed token,
        address recipientA,
        uint256 amountA,
        address recipientB,
        uint256 amountB
    );

    constructor(
        address payer_,
        address recipientA_,
        address recipientB_,
        uint256 amountA_,
        uint256 amountB_,
        uint256 expectedChainId_,
        bytes32 demoId_
    ) {
        if (expectedChainId_ != ARC_TESTNET_CHAIN_ID && expectedChainId_ != ARC_MAINNET_CHAIN_ID) revert UnsupportedChain();
        if (block.chainid != expectedChainId_) revert WrongChain();
        if (payer_ == address(0) || payer_ != msg.sender) revert InvalidPayer();
        if (recipientA_ == address(0) || recipientB_ == address(0)) revert InvalidRecipient();
        if (recipientA_ == payer_ || recipientB_ == payer_) revert RecipientIsPayer();
        if (recipientA_ == recipientB_) revert DuplicateRecipient();
        if (amountA_ == 0 || amountB_ == 0) revert InvalidAmount();
        if (amountA_ > MAX_TOTAL_BASE_UNITS || amountB_ > MAX_TOTAL_BASE_UNITS - amountA_) revert AmountCapExceeded();
        if (demoId_ == bytes32(0)) revert InvalidDemoId();

        payer = payer_;
        recipientA = recipientA_;
        recipientB = recipientB_;
        amountA = amountA_;
        amountB = amountB_;
        chainId = expectedChainId_;
        demoId = demoId_;
    }

    /// @dev No arguments: a connected wallet cannot inject a different amount or recipient.
    ///      A revert rolls back the flag and both ERC-20 transfers atomically.
    function execute() external {
        if (block.chainid != chainId) revert WrongChain();
        if (msg.sender != payer) revert InvalidPayer();
        if (executed) revert AlreadyExecuted();
        executed = true; // single-use and reentrancy guard before external calls

        IERC20(USDC).safeTransferFrom(payer, recipientA, amountA);
        IERC20(USDC).safeTransferFrom(payer, recipientB, amountB);

        emit DemoSplitExecuted(demoId, payer, USDC, recipientA, amountA, recipientB, amountB);
    }
}
