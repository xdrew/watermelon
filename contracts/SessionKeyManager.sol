// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SessionKeyManager - EIP-7702 Session Keys for Watermelon Snap
/// @notice Allows EOAs to delegate transaction signing to temporary session keys
/// @dev User delegates their EOA to this contract via EIP-7702, then creates a session
contract SessionKeyManager {
    // ============ STRUCTS ============

    struct Session {
        address sessionKey;         // Ephemeral key that can sign on behalf of user
        uint48 validUntil;          // Expiration timestamp
        uint48 validAfter;          // Start timestamp (for delayed activation)
        address allowedTarget;      // Contract this session can interact with
        bytes4[] allowedSelectors;  // Function selectors this session can call
        uint256 gameId;             // Specific gameId this session is for (0 = any)
    }

    // ============ STATE ============

    /// @notice Active session for each delegated EOA
    mapping(address => Session) public sessions;

    /// @notice Nonce for replay protection
    mapping(address => uint256) public nonces;

    // ============ EVENTS ============

    event SessionCreated(
        address indexed account,
        address indexed sessionKey,
        uint256 validUntil,
        address allowedTarget
    );

    event SessionRevoked(address indexed account);

    event SessionExecuted(
        address indexed account,
        address indexed target,
        bytes4 selector,
        bool success
    );

    // ============ ERRORS ============

    error InvalidSessionKey();
    error SessionExpired();
    error SessionNotYetValid();
    error TargetNotAllowed();
    error SelectorNotAllowed();
    error GameIdMismatch();
    error ExecutionFailed();
    error InvalidDuration();
    error SessionAlreadyActive();

    // ============ CONSTANTS ============

    uint256 public constant MAX_SESSION_DURATION = 24 hours;
    uint256 public constant MIN_SESSION_DURATION = 5 minutes;

    // ============ SESSION MANAGEMENT ============

    /// @notice Create a new session for the calling EOA (called via EIP-7702 delegation)
    /// @param sessionKey The ephemeral public key that can sign transactions
    /// @param duration How long the session is valid (in seconds)
    /// @param target The contract address this session can interact with
    /// @param selectors Array of function selectors this session can call
    /// @param gameId Specific gameId to restrict to (0 = allow any gameId)
    function createSession(
        address sessionKey,
        uint256 duration,
        address target,
        bytes4[] calldata selectors,
        uint256 gameId
    ) external {
        if (duration < MIN_SESSION_DURATION || duration > MAX_SESSION_DURATION) {
            revert InvalidDuration();
        }

        // Prevent overwriting active session (must revoke first)
        Session storage existing = sessions[msg.sender];
        if (existing.sessionKey != address(0) && existing.validUntil > block.timestamp) {
            revert SessionAlreadyActive();
        }

        sessions[msg.sender] = Session({
            sessionKey: sessionKey,
            validUntil: uint48(block.timestamp + duration),
            validAfter: uint48(block.timestamp),
            allowedTarget: target,
            allowedSelectors: selectors,
            gameId: gameId
        });

        emit SessionCreated(msg.sender, sessionKey, block.timestamp + duration, target);
    }

    /// @notice Revoke the current session
    function revokeSession() external {
        delete sessions[msg.sender];
        emit SessionRevoked(msg.sender);
    }

    /// @notice Execute a transaction using session key
    /// @dev Called by the session key, targeting the delegated EOA
    /// @param account The delegated EOA address (in EIP-7702, this equals address(this))
    /// @param target Contract to call
    /// @param data Calldata for the target contract
    function execute(address account, address target, bytes calldata data) external returns (bytes memory) {
        // In production with EIP-7702: account should equal address(this)
        // This parameter allows testing without EIP-7702 support
        Session storage session = sessions[account];

        // Validate session key
        if (msg.sender != session.sessionKey) {
            revert InvalidSessionKey();
        }

        // Validate timing
        if (block.timestamp > session.validUntil) {
            revert SessionExpired();
        }
        if (block.timestamp < session.validAfter) {
            revert SessionNotYetValid();
        }

        // Validate target
        if (target != session.allowedTarget) {
            revert TargetNotAllowed();
        }

        // Validate selector
        bytes4 selector = bytes4(data[:4]);
        if (!_isSelectorAllowed(session.allowedSelectors, selector)) {
            revert SelectorNotAllowed();
        }

        // Validate gameId if restricted
        if (session.gameId != 0) {
            // For addBand(uint256) and cashOut(uint256), gameId is first param
            if (data.length >= 36) {
                uint256 callGameId = abi.decode(data[4:36], (uint256));
                if (callGameId != session.gameId) {
                    revert GameIdMismatch();
                }
            }
        }

        // Execute the call as the delegated EOA
        (bool success, bytes memory result) = target.call(data);

        emit SessionExecuted(account, target, selector, success);

        if (!success) {
            // Bubble up the revert reason
            if (result.length > 0) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            revert ExecutionFailed();
        }

        return result;
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Check if a session is currently valid
    function isSessionValid(address account) external view returns (bool) {
        Session storage session = sessions[account];
        return session.sessionKey != address(0) &&
               block.timestamp >= session.validAfter &&
               block.timestamp <= session.validUntil;
    }

    /// @notice Get session details
    function getSession(address account) external view returns (
        address sessionKey,
        uint256 validUntil,
        uint256 validAfter,
        address allowedTarget,
        bytes4[] memory allowedSelectors,
        uint256 gameId
    ) {
        Session storage session = sessions[account];
        return (
            session.sessionKey,
            session.validUntil,
            session.validAfter,
            session.allowedTarget,
            session.allowedSelectors,
            session.gameId
        );
    }

    /// @notice Get remaining session time in seconds
    function getRemainingTime(address account) external view returns (uint256) {
        Session storage session = sessions[account];
        if (block.timestamp >= session.validUntil) return 0;
        return session.validUntil - block.timestamp;
    }

    // ============ INTERNAL ============

    function _isSelectorAllowed(bytes4[] storage allowed, bytes4 selector) internal view returns (bool) {
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return true;
        }
        return false;
    }
}
