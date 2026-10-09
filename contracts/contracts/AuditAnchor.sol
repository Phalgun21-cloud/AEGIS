// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AEGIS audit anchor
/// @notice Stores checkpoints of the AEGIS hash-chained audit log.
/// @dev Each audit entry's hash covers the previous entry's hash, so anchoring the chain head
///      at entry N commits to every entry up to N. Only hashes are stored here, never exam
///      content or personal data.
contract AuditAnchor {
    struct Anchor {
        bytes32 headHash; // entry_hash of the newest audit entry covered
        uint64 auditEntryId; // id of that entry
        uint64 anchoredAt; // block timestamp
    }

    address public owner;
    Anchor[] private _anchors;

    event Anchored(uint256 indexed index, bytes32 indexed headHash, uint64 auditEntryId, uint64 anchoredAt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroHash();
    error ZeroAddress();
    error NotIncreasing(uint64 lastEntryId, uint64 givenEntryId);
    error NoSuchAnchor(uint256 index);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Record the audit-chain head. Entry ids must strictly increase.
    function anchor(bytes32 headHash, uint64 auditEntryId) external onlyOwner returns (uint256 index) {
        if (headHash == bytes32(0)) revert ZeroHash();
        index = _anchors.length;
        if (index > 0) {
            uint64 last = _anchors[index - 1].auditEntryId;
            if (auditEntryId <= last) revert NotIncreasing(last, auditEntryId);
        }
        uint64 ts = uint64(block.timestamp);
        _anchors.push(Anchor(headHash, auditEntryId, ts));
        emit Anchored(index, headHash, auditEntryId, ts);
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function getAnchor(uint256 index)
        external
        view
        returns (bytes32 headHash, uint64 auditEntryId, uint64 anchoredAt)
    {
        if (index >= _anchors.length) revert NoSuchAnchor(index);
        Anchor storage a = _anchors[index];
        return (a.headHash, a.auditEntryId, a.anchoredAt);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
