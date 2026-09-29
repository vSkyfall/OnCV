// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ProofSkill} from "../ProofSkill.sol";

/// @dev Test-only: a minimal smart account (ERC-1271) that also accepts ERC-1155 tokens.
contract TestSmartWallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && signer == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}

/// @dev Test-only: a contract wallet without ERC-1155 receiver support; token mints to it revert.
contract TestRejectingWallet {
    function checkIn(ProofSkill proofSkill, uint256 eventId, uint256 codeWindow, bytes calldata signature) external {
        proofSkill.checkIn(eventId, codeWindow, signature);
    }
}
