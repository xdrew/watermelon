// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title IEntropy - Pyth Entropy VRF Interface
/// @notice Interface for requesting verifiable random numbers from Pyth Entropy
interface IEntropy {
    /// @notice Request a random number with callback
    /// @param provider The entropy provider address
    /// @param userRandomNumber User-provided randomness for mixing
    /// @return sequenceNumber The unique identifier for this request
    function requestWithCallback(
        address provider,
        bytes32 userRandomNumber
    ) external payable returns (uint64 sequenceNumber);

    /// @notice Get the fee required for a random number request
    /// @param provider The entropy provider address
    /// @return fee The required fee in wei
    function getFee(address provider) external view returns (uint256 fee);

    /// @notice Reveal a random number (alternative to callback)
    /// @param provider The entropy provider address
    /// @param sequenceNumber The sequence number from the request
    /// @param userRandomNumber The user random number used in the request
    /// @param providerRevelation The provider's revelation
    /// @return randomNumber The generated random number
    function reveal(
        address provider,
        uint64 sequenceNumber,
        bytes32 userRandomNumber,
        bytes32 providerRevelation
    ) external returns (bytes32 randomNumber);
}

/// @title IEntropyConsumer - Interface for contracts consuming entropy
/// @notice Contracts that want to receive entropy callbacks must implement this
interface IEntropyConsumer {
    /// @notice Called by Entropy when random number is ready
    /// @param sequenceNumber The sequence number identifying the request
    /// @param provider The entropy provider that fulfilled the request
    /// @param randomNumber The generated random number
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) external;
}
