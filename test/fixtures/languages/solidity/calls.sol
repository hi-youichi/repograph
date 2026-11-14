// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

function helper(uint256 x) pure returns (uint256) {
    return x + 1;
}

function run(uint256 y) pure returns (uint256) {
    return helper(y);
}
