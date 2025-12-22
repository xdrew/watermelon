// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IEntropy.sol";

/// @title MockEntropy - Mock Pyth Entropy for testing
/// @notice Does NOT auto-callback - use fulfillRequest() to trigger callbacks manually
contract MockEntropy {
    uint256 public constant FEE = 0.0001 ether;
    uint64 private _sequenceNumber;

    mapping(uint64 => address) public requesters;

    function getFeeV2() external pure returns (uint256) {
        return FEE;
    }

    // Backward compat for tests
    function getFee(address) external pure returns (uint256) {
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

        sequenceNumber = ++_sequenceNumber; // Start from 1, not 0
        requesters[sequenceNumber] = msg.sender;

        // NOTE: No auto-callback - tests call fulfillRequest() manually
        return sequenceNumber;
    }

    /// @notice Manually trigger VRF callback for testing
    /// @param consumer The contract to callback
    /// @param sequenceNumber The sequence number
    /// @param desiredThreshold The threshold value you want (1-15)
    /// @dev Calculates the right random value so contract gets your desired threshold
    function fulfillRequest(address consumer, uint64 sequenceNumber, uint256 desiredThreshold) external {
        // Contract calculates: threshold = 1 + (randomNumber % 15)
        // So to get desiredThreshold, we need: randomNumber % 15 = desiredThreshold - 1
        // Therefore: randomNumber = desiredThreshold - 1
        uint256 randomValue = desiredThreshold - 1;
        bytes32 randomNumber = bytes32(randomValue);
        IEntropyConsumer(consumer)._entropyCallback(
            sequenceNumber,
            address(this),
            randomNumber
        );
    }
}
