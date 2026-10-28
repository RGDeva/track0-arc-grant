// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantSplitDemo} from "../GrantSplitDemo.sol";

contract GrantMockUSDC is IERC20 {
    uint256 public totalSupply;
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;

    function mint(address account, uint256 amount) external {
        balances[account] += amount;
        totalSupply += amount;
        emit Transfer(address(0), account, amount);
    }
    function balanceOf(address account) external view returns (uint256) { return balances[account]; }
    function allowance(address owner, address spender) external view returns (uint256) { return allowances[owner][spender]; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balances[from] >= amount && allowances[from][msg.sender] >= amount, "insufficient");
        allowances[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract GrantSplitDemoTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    bytes32 constant DEMO_ID = keccak256("operator-funded-grant-demo");
    address payer = makeAddr("payer");
    address a = makeAddr("operator-wallet-a");
    address b = makeAddr("operator-wallet-b");
    GrantMockUSDC usdc;
    GrantSplitDemo demo;

    function setUp() public {
        vm.chainId(5042);
        GrantMockUSDC implementation = new GrantMockUSDC();
        vm.etch(USDC, address(implementation).code);
        usdc = GrantMockUSDC(USDC);
        vm.prank(payer);
        demo = new GrantSplitDemo(payer, a, b, 100_000, 200_000, 5042, DEMO_ID);
        usdc.mint(payer, 300_000);
    }

    function testExactSplitAndSingleUse() public {
        vm.prank(payer);
        usdc.approve(address(demo), 300_000);
        vm.prank(payer);
        demo.execute();
        assertEq(usdc.balanceOf(a), 100_000);
        assertEq(usdc.balanceOf(b), 200_000);
        assertEq(usdc.balanceOf(payer), 0);
        assertEq(usdc.allowance(payer, address(demo)), 0);
        assertTrue(demo.executed());
        vm.prank(payer);
        vm.expectRevert(GrantSplitDemo.AlreadyExecuted.selector);
        demo.execute();
    }

    function testNoApprovalLeavesAllStateUnchanged() public {
        vm.prank(payer);
        vm.expectRevert();
        demo.execute();
        assertFalse(demo.executed());
        assertEq(usdc.balanceOf(a), 0);
        assertEq(usdc.balanceOf(b), 0);
        assertEq(usdc.balanceOf(payer), 300_000);
    }

    function testPartialAllowanceRollsBackFirstTransfer() public {
        vm.prank(payer);
        usdc.approve(address(demo), 100_000);
        vm.prank(payer);
        vm.expectRevert();
        demo.execute();
        assertFalse(demo.executed());
        assertEq(usdc.balanceOf(a), 0);
        assertEq(usdc.balanceOf(b), 0);
        assertEq(usdc.allowance(payer, address(demo)), 100_000);
    }

    function testInsufficientBalanceRollsBackBothTransfers() public {
        vm.prank(payer);
        usdc.approve(address(demo), 300_000);
        vm.prank(payer);
        assertTrue(usdc.transfer(makeAddr("unrelated"), 50_000));
        vm.prank(payer);
        vm.expectRevert();
        demo.execute();
        assertFalse(demo.executed());
        assertEq(usdc.balanceOf(a), 0);
        assertEq(usdc.balanceOf(b), 0);
        assertEq(usdc.balanceOf(payer), 250_000);
        assertEq(usdc.allowance(payer, address(demo)), 300_000);
    }

    function testOnlyPinnedPayerMayExecute() public {
        vm.prank(a);
        vm.expectRevert(GrantSplitDemo.InvalidPayer.selector);
        demo.execute();
        assertFalse(demo.executed());
    }

    function testChainCannotChangeAfterDeployment() public {
        vm.chainId(5042002);
        vm.prank(payer);
        vm.expectRevert(GrantSplitDemo.WrongChain.selector);
        demo.execute();
    }

    function testConstructorRejectsInjectedRecipientsAndAmounts() public {
        vm.startPrank(payer);
        vm.expectRevert(GrantSplitDemo.DuplicateRecipient.selector);
        new GrantSplitDemo(payer, a, a, 1, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.AmountCapExceeded.selector);
        new GrantSplitDemo(payer, a, b, 1_000_000, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.InvalidAmount.selector);
        new GrantSplitDemo(payer, a, b, 0, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.InvalidRecipient.selector);
        new GrantSplitDemo(payer, address(0), b, 1, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.InvalidRecipient.selector);
        new GrantSplitDemo(payer, a, address(0), 1, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.RecipientIsPayer.selector);
        new GrantSplitDemo(payer, payer, b, 1, 1, 5042, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.RecipientIsPayer.selector);
        new GrantSplitDemo(payer, a, payer, 1, 1, 5042, DEMO_ID);
        vm.stopPrank();
    }

    function testConstructorRejectsOtherChainsAndOtherPayers() public {
        vm.startPrank(payer);
        vm.expectRevert(GrantSplitDemo.UnsupportedChain.selector);
        new GrantSplitDemo(payer, a, b, 1, 1, 1, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.WrongChain.selector);
        new GrantSplitDemo(payer, a, b, 1, 1, 5042002, DEMO_ID);
        vm.expectRevert(GrantSplitDemo.InvalidPayer.selector);
        new GrantSplitDemo(a, a, b, 1, 1, 5042, DEMO_ID);
        vm.stopPrank();
    }
}
