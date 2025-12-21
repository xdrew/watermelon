// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IEntropy.sol";

/// @title MockEntropy - Mock Pyth Entropy for testing
/// @notice Immediately calls back with pseudo-random number (NOT SECURE - testing only)
contract MockEntropy {
    uint256 public constant FEE = 0.0001 ether;
    uint64 private _sequenceNumber;

    mapping(uint64 => address) public requesters;

    function getFeeV2() external pure returns (uint256) {
        return FEE;
    }

    function getDefaultProvider() external view returns (address) {
        return address(this);
    }

    function requestV2() external payable returns (uint64 sequenceNumber) {
        return _requestV2();
    }

    function requestV2(uint32 /* gasLimit */) external payable returns (uint64 sequenceNumber) {
        return _requestV2();
    }

    function _requestV2() internal returns (uint64 sequenceNumber) {
        require(msg.value >= FEE, "Insufficient fee");

        sequenceNumber = _sequenceNumber++;
        requesters[sequenceNumber] = msg.sender;

        // Generate pseudo-random number (NOT SECURE - for testing only)
        bytes32 randomNumber = keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            sequenceNumber
        ));

        // Immediately callback via _entropyCallback (the external entry point)
        IEntropyConsumer(msg.sender)._entropyCallback(
            sequenceNumber,
            address(this),
            randomNumber
        );

        return sequenceNumber;
    }
}
