// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IEntropy.sol";

/// @title MockEntropy - Mock Pyth Entropy for testing
/// @notice Simulates Pyth Entropy behavior for local testing
contract MockEntropy is IEntropy {
    uint64 public sequenceCounter;
    uint256 public constant FEE = 0.001 ether;

    mapping(uint64 => address) public requestCallbacks;
    mapping(uint64 => bytes32) public userRandomNumbers;

    event RandomRequested(uint64 indexed sequenceNumber, address indexed callback);
    event RandomFulfilled(uint64 indexed sequenceNumber, bytes32 randomNumber);

    function requestWithCallback(
        address provider,
        bytes32 userRandomNumber
    ) external payable override returns (uint64 sequenceNumber) {
        require(msg.value >= FEE, "Insufficient fee");

        sequenceNumber = ++sequenceCounter;
        requestCallbacks[sequenceNumber] = msg.sender;
        userRandomNumbers[sequenceNumber] = userRandomNumber;

        emit RandomRequested(sequenceNumber, msg.sender);
    }

    function getFee(address) external pure override returns (uint256) {
        return FEE;
    }

    function reveal(
        address,
        uint64,
        bytes32,
        bytes32 providerRevelation
    ) external pure override returns (bytes32) {
        return providerRevelation;
    }

    // Test helper: Fulfill a request with a specific threshold
    function fulfillRequest(
        address callback,
        uint64 sequenceNumber,
        uint256 threshold
    ) external {
        // Generate a random number that will produce the desired threshold
        // threshold = SOLO_MIN_THRESHOLD + (randomNumber % range)
        // For testing, we encode the threshold directly
        bytes32 randomNumber = bytes32(threshold - 30); // Subtract SOLO_MIN_THRESHOLD

        IEntropyConsumer(callback).entropyCallback(
            sequenceNumber,
            address(this),
            randomNumber
        );

        emit RandomFulfilled(sequenceNumber, randomNumber);
    }

    // Test helper: Fulfill with raw random bytes
    function fulfillWithRandom(
        address callback,
        uint64 sequenceNumber,
        bytes32 randomNumber
    ) external {
        IEntropyConsumer(callback).entropyCallback(
            sequenceNumber,
            address(this),
            randomNumber
        );

        emit RandomFulfilled(sequenceNumber, randomNumber);
    }
}
