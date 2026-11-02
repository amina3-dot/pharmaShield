// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PharmaShield - role-restricted pharmaceutical package traceability
/// @notice Prototype. Stores only hashes and addresses, never patient or confidential data.
contract PharmaShield is AccessControl {
    bytes32 public constant MANUFACTURER = keccak256("MANUFACTURER");
    bytes32 public constant DISTRIBUTOR  = keccak256("DISTRIBUTOR");
    bytes32 public constant PHARMACY     = keccak256("PHARMACY");
    bytes32 public constant RECALL_ADMIN = keccak256("RECALL_ADMIN");

    enum Status { None, Registered, InTransit, Received, Dispensed, Recalled }

    struct Package {
        bytes32 batchId;
        bytes32 metadataHash;
        address currentCustodian;
        address pendingCustodian;
        uint64  registeredAt;
        Status  status;
    }

    mapping(bytes32 => Package) private packages;
    mapping(bytes32 => bool) public batchRegistered;
    mapping(bytes32 => bool) public batchRecalled;

    event BatchRegistered(bytes32 indexed batchId, address indexed manufacturer, bytes32 certHash);
    event PackageRegistered(bytes32 indexed packageId, bytes32 indexed batchId, address indexed manufacturer);
    event TransferInitiated(bytes32 indexed packageId, address indexed from, address indexed to);
    event TransferAccepted(bytes32 indexed packageId, address indexed by);
    event PackageDispensed(bytes32 indexed packageId, address indexed pharmacy);
    event BatchRecalled(bytes32 indexed batchId, address indexed admin);
    event SuspiciousScan(bytes32 indexed packageId, uint8 indexed ruleId, address indexed reporter, bytes32 locationHash);

    constructor() { _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); }

    modifier onlyParticipant() {
        require(
            hasRole(MANUFACTURER, msg.sender) || hasRole(DISTRIBUTOR, msg.sender) ||
            hasRole(PHARMACY, msg.sender) || hasRole(RECALL_ADMIN, msg.sender),
            "R2: not a registered participant"
        );
        _;
    }

    function registerBatch(bytes32 batchId, bytes32 certHash) external onlyRole(MANUFACTURER) {
        require(!batchRegistered[batchId], "R1: batch exists");
        batchRegistered[batchId] = true;
        emit BatchRegistered(batchId, msg.sender, certHash);
    }

    function registerPackage(bytes32 packageId, bytes32 batchId, bytes32 metadataHash) external onlyRole(MANUFACTURER) {
        require(batchRegistered[batchId], "R4: unknown batch");
        require(packages[packageId].status == Status.None, "R1: duplicate package id");
        packages[packageId] = Package(batchId, metadataHash, msg.sender, address(0), uint64(block.timestamp), Status.Registered);
        emit PackageRegistered(packageId, batchId, msg.sender);
    }

    function transferPackage(bytes32 packageId, address to) external {
        Package storage p = packages[packageId];
        require(p.status != Status.None, "R4: unknown package");
        require(p.currentCustodian == msg.sender, "R2: caller is not custodian");
        require(p.status == Status.Registered || p.status == Status.Received, "R4: invalid state");
        require(!batchRecalled[p.batchId], "R4: batch recalled");
        require(hasRole(DISTRIBUTOR, to) || hasRole(PHARMACY, to), "R2: recipient not authorised");
        p.pendingCustodian = to;
        p.status = Status.InTransit;
        emit TransferInitiated(packageId, msg.sender, to);
    }

    function acceptPackage(bytes32 packageId) external {
        Package storage p = packages[packageId];
        require(p.status == Status.InTransit, "R4: no pending transfer");
        require(p.pendingCustodian == msg.sender, "R2: not intended recipient");
        p.currentCustodian = msg.sender;
        p.pendingCustodian = address(0);
        p.status = Status.Received;
        emit TransferAccepted(packageId, msg.sender);
    }

    function dispensePackage(bytes32 packageId) external onlyRole(PHARMACY) {
        Package storage p = packages[packageId];
        require(p.status == Status.Received && p.currentCustodian == msg.sender, "R4: cannot dispense");
        p.status = Status.Dispensed;
        emit PackageDispensed(packageId, msg.sender);
    }

    function recallBatch(bytes32 batchId) external onlyRole(RECALL_ADMIN) {
        require(batchRegistered[batchId], "R4: unknown batch");
        batchRecalled[batchId] = true;
        emit BatchRecalled(batchId, msg.sender);
    }

    /// @notice Authorised participants persist an alert (rules R3/R5 are evaluated off-chain).
    function reportSuspiciousScan(bytes32 packageId, uint8 ruleId, bytes32 locationHash) external onlyParticipant {
        require(packages[packageId].status != Status.None, "R4: unknown package");
        emit SuspiciousScan(packageId, ruleId, msg.sender, locationHash);
    }

    /// @notice Public read. Recalled batches always override the stored status.
    function verifyPackage(bytes32 packageId) external view returns (Status status, address custodian, bytes32 batchId) {
        Package storage p = packages[packageId];
        status = batchRecalled[p.batchId] ? Status.Recalled : p.status;
        return (status, p.currentCustodian, p.batchId);
    }
}
