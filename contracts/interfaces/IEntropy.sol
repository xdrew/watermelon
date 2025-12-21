// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title IEntropy - Pyth Entropy VRF Interface (v2)
/// @notice Interface for requesting verifiable random numbers from Pyth Entropy
interface IEntropy {
    /// @notice Request a random number with callback (v2 API)
    /// @return sequenceNumber The unique identifier for this request
    function requestV2() external payable returns (uint64 sequenceNumber);

    /// @notice Request a random number with custom callback gas limit (v2 API)
    /// @param gasLimit The gas limit for the callback execution
    /// @return sequenceNumber The unique identifier for this request
    function requestV2(uint32 gasLimit) external payable returns (uint64 sequenceNumber);

    /// @notice Get the fee required for a random number request (v2 API)
    /// @return fee The required fee in wei
    function getFeeV2() external view returns (uint256 fee);

    /// @notice Get the default entropy provider
    /// @return provider The default provider address
    function getDefaultProvider() external view returns (address provider);
}

/// @title IEntropyConsumer - Abstract contract for consuming Pyth Entropy
/// @notice Contracts must inherit from this to receive entropy callbacks
/// @dev Based on official Pyth SDK: https://github.com/pyth-network/pyth-crosschain
abstract contract IEntropyConsumer {
    /// @notice Called by Entropy contract to deliver the random number
    /// @dev Do not override - this validates the caller and calls entropyCallback
    function _entropyCallback(
        uint64 sequence,
        address provider,
        bytes32 randomNumber
    ) external {
        address entropy = getEntropy();
        require(entropy != address(0), "Entropy address not set");
        require(msg.sender == entropy, "Only Entropy can call this function");

        entropyCallback(sequence, provider, randomNumber);
    }

    /// @notice Returns the Entropy contract address for callback validation
    /// @dev Must be implemented by the consumer
    function getEntropy() internal view virtual returns (address);

    /// @notice Handles the random number after validation
    /// @dev Must be implemented by the consumer
    function entropyCallback(
        uint64 sequence,
        address provider,
        bytes32 randomNumber
    ) internal virtual;
}
