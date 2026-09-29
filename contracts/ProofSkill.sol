// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAttendanceHook} from "./interfaces/IAttendanceHook.sol";
import {ICredentialToken} from "./interfaces/ICredentialToken.sol";

/**
 * @title onCV - Verifiable On-Chain Credentials & Attendance Infrastructure (ProofSkill registry)
 * @notice Admin-verified organizers publish events; attendees prove presence and every verified attendance is
 *         stored on-chain, adds POINTS_PER_CHECKIN to the attendee's Proof Score and mints a soulbound token.
 * @dev Trust model:
 *      - A single admin (AccessControlDefaultAdminRules: two-step transfer with a delay, e.g. to a Safe)
 *        verifies organizers and registers their organization name/domain. Events display that registered
 *        name, never free text, so a verified organizer cannot publish under another institution's name.
 *      - Satellite contracts (credential token, project registry) are wired exactly once. After wiring the
 *        admin cannot redirect them, mint tokens or award points: points only come from check-ins and from
 *        the wired ProjectRegistry.
 *      - Only an event's creator can rotate its QR signing key; admins can moderate (pause, revoke) but can
 *        never issue attendance on an organizer's behalf.
 *      Check-in modes:
 *      - Self-scan: the attendee scans the organizer screen's rotating QR (signed every 10 s, valid 120 s).
 *      - Gasless self-scan: a relayer submits the attendee's EIP-712 signed intent (checkInWithSig).
 *      - Kiosk: the organizer device scans the attendee's personal QR (EIP-712 consent) and co-signs with the
 *        event's QR key. This binds the credential to a physical scan of the attendee's phone.
 */
contract ProofSkill is AccessControlDefaultAdminRules, EIP712, ReentrancyGuard {
    enum Category {
        Workshop,
        Hackathon,
        Conference,
        Meetup,
        Bootcamp
    }

    struct EventInput {
        string name;
        string location;
        uint256 startTime; // 0 = now
        uint256 durationHours;
        int256 lat; // Latitude  * COORDINATE_SCALE (ignored for online events)
        int256 long; // Longitude * COORDINATE_SCALE (ignored for online events)
        Category category;
        string skillTags;
        address checkInSigner;
        uint256 maxAttendees; // 0 = unlimited
        bool isOnline;
    }

    struct Event {
        uint256 id;
        string name;
        string organizer; // Registered organization name (from organizerProfiles at creation time)
        bool organizerVerified; // Organizer's verified (blue tick) status at creation time
        string location;
        uint256 timestamp; // Event start, unix seconds
        uint256 durationHours;
        bool isActive;
        int256 lat;
        int256 long;
        Category category;
        string skillTags;
        address creator;
        address checkInSigner;
        uint256 attendeeCount;
        uint256 maxAttendees;
        bool isOnline;
    }

    struct AttendanceRecord {
        uint64 timestamp;
        uint64 blockNumber;
        bool revoked;
    }

    struct OrganizerProfile {
        string name;
        string domain;
    }

    uint256 public constant POINTS_PER_CHECKIN = 25;
    uint256 public constant QR_ROTATION_SECONDS = 10;
    uint256 public constant QR_CODE_TTL = 120;
    /// @dev Tolerance for codes that look "from the future". Avalanche does not produce empty blocks, so a
    ///      pre-flight eth_call on a quiet chain runs with an older block.timestamp; organizer clocks also drift.
    uint256 public constant MAX_CLOCK_SKEW = 5 minutes;
    uint256 public constant CHECKIN_OPENS_BEFORE = 1 hours;
    uint256 public constant MAX_BACKDATE = 1 hours;
    uint256 public constant MAX_DURATION_HOURS = 24 * 30;
    uint256 public constant MAX_START_OFFSET = 365 days;
    uint256 public constant MAX_KIOSK_VALIDITY = 15 minutes;
    uint256 public constant MAX_TEXT_LENGTH = 160;
    uint256 public constant MAX_ORG_NAME_LENGTH = 80;
    uint256 public constant MAX_DOMAIN_LENGTH = 100;
    int256 public constant COORDINATE_SCALE = 1e6;
    uint256 public constant MAX_AWARD_POINTS = 100;
    uint256 public constant MAX_PAGE_SIZE = 100;

    bytes32 public constant CHECKIN_TYPEHASH =
        keccak256("CheckIn(address attendee,uint256 eventId,uint256 codeWindow,uint256 deadline)");
    bytes32 public constant KIOSK_CONSENT_TYPEHASH = keccak256("KioskConsent(address attendee,uint256 deadline)");
    bytes32 public constant KIOSK_ATTEST_TYPEHASH =
        keccak256("KioskAttest(uint256 eventId,address attendee,uint256 deadline)");

    string private constant CHECKIN_DOMAIN = "ProofSkill:check-in";

    uint256 public eventCount;
    uint256 public totalCheckIns;
    ICredentialToken public credentialToken;
    /// @notice The only contract allowed to award / deduct bonus points and notified on revocations.
    address public projectRegistry;

    mapping(uint256 => Event) internal events;
    mapping(bytes32 => AttendanceRecord) public attendanceRecords;
    mapping(address => uint256[]) internal userEvents;
    mapping(uint256 => address[]) internal eventAttendees;
    mapping(address => uint256) public proofScore;
    mapping(address => uint256) public validCredentialCount;
    mapping(address => uint256[]) internal organizerEvents;
    mapping(address => bool) public isVerifiedOrganizer;
    mapping(address => OrganizerProfile) public organizerProfiles;

    event OrganizerAdded(address indexed organizer, address indexed admin);
    event OrganizerRemoved(address indexed organizer, address indexed admin);
    event OrganizerProfileUpdated(address indexed organizer, string name, string domain);
    event EventCreated(
        uint256 indexed eventId,
        address indexed creator,
        string name,
        uint256 startTime,
        address checkInSigner
    );
    event EventStatusChanged(uint256 indexed eventId, bool isActive);
    event CheckInSignerUpdated(uint256 indexed eventId, address indexed signer);
    event AttendanceRecorded(
        address indexed user,
        uint256 indexed eventId,
        uint256 newProofScore,
        uint256 timestamp
    );
    event CredentialRevoked(address indexed user, uint256 indexed eventId, address indexed revokedBy, string reason);
    event PointsAwarded(address indexed user, uint256 points, bytes32 indexed reason, uint256 newProofScore);
    event PointsDeducted(address indexed user, uint256 points, bytes32 indexed reason, uint256 newProofScore);
    event SatellitesWired(address token, address projectRegistry);
    /// @dev A token / registry hook failed; the attendance record itself is unaffected.
    event HookFailed(address indexed user, uint256 indexed eventId, bytes4 hook);

    error InvalidOrganizer();
    error InvalidPoints();
    error OrganizerNotVerified();
    error NotEventManager();
    error NotScorer();
    error AlreadyWired();
    error EventNotFound();
    error EventInactive();
    error EventFull();
    error CheckInNotOpen();
    error CheckInClosed();
    error CodeExpired();
    error CodeNotYetValid();
    error InvalidCheckInCode();
    error AlreadyCheckedIn();
    error EmptyName();
    error TextTooLong();
    error InvalidDuration();
    error InvalidStartTime();
    error InvalidCoordinates();
    error InvalidSigner();
    error InvalidDeadline();
    error EventAlreadyEnded();
    error SignatureExpired();
    error InvalidAttendeeSignature();
    error CredentialNotFound();
    error AlreadyRevoked();
    error PageTooLarge();

    modifier onlyAdmin() {
        _checkRole(DEFAULT_ADMIN_ROLE);
        _;
    }

    modifier onlyVerifiedOrganizer() {
        require(isVerifiedOrganizer[msg.sender], "Unauthorized: Not a verified organizer");
        _;
    }

    modifier onlyScorer() {
        if (msg.sender != projectRegistry || projectRegistry == address(0)) revert NotScorer();
        _;
    }

    /// @dev The event's creator (while still verified) or the admin. Used for moderation (pause, revoke).
    modifier onlyEventManager(uint256 eventId) {
        Event storage e = _getEvent(eventId);
        bool isVerifiedCreator = msg.sender == e.creator && isVerifiedOrganizer[msg.sender];
        if (!isVerifiedCreator && !isAdmin(msg.sender)) revert NotEventManager();
        _;
    }

    /// @dev Only the event's (still verified) creator. Admins must not be able to issue attendance on an
    ///      organizer's behalf, so rotating the QR signing key is reserved for the creator.
    modifier onlyEventCreator(uint256 eventId) {
        Event storage e = _getEvent(eventId);
        if (msg.sender != e.creator || !isVerifiedOrganizer[msg.sender]) revert NotEventManager();
        _;
    }

    /**
     * @param initialAdmin       The single admin (use a Safe multisig in production).
     * @param adminTransferDelay Delay for two-step admin transfers (AccessControlDefaultAdminRules).
     * @param adminOrgName       Registered organization name of the initial admin (e.g. "onCV").
     * @param adminDomain        Organization domain of the initial admin (e.g. "oncv.xyz").
     */
    constructor(
        address initialAdmin,
        uint48 adminTransferDelay,
        string memory adminOrgName,
        string memory adminDomain
    ) AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin) EIP712("onCV", "1") {
        _setOrganizer(initialAdmin, adminOrgName, adminDomain);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Grants the verified organizer status (blue tick) after off-chain review and registers the
    ///         organization's display name and domain. Call again to update the profile.
    function addOrganizer(address _organizer, string calldata name, string calldata domain) external onlyAdmin {
        _setOrganizer(_organizer, name, domain);
    }

    /// @notice Revokes the verified status. The organizer can no longer create or manage events and their
    ///         events stop accepting check-ins; credentials already issued remain on-chain.
    function removeOrganizer(address _organizer) external onlyAdmin {
        isVerifiedOrganizer[_organizer] = false;
        emit OrganizerRemoved(_organizer, msg.sender);
    }

    function isAdmin(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    /// @notice One-time wiring of the credential token and the project registry. Irreversible by design, so
    ///         the admin can never redirect minting or points after deployment.
    function wireSatellites(ICredentialToken token, address registry) external onlyAdmin {
        if (address(credentialToken) != address(0) || projectRegistry != address(0)) revert AlreadyWired();
        if (address(token) == address(0) || registry == address(0)) revert InvalidOrganizer();
        credentialToken = token;
        projectRegistry = registry;
        emit SatellitesWired(address(token), registry);
    }

    /// @notice Bonus Proof Score from the project registry (attested project milestones).
    function awardPoints(address user, uint256 points, bytes32 reason) external onlyScorer returns (uint256 newScore) {
        if (points == 0 || points > MAX_AWARD_POINTS) revert InvalidPoints();
        newScore = proofScore[user] + points;
        proofScore[user] = newScore;
        emit PointsAwarded(user, points, reason, newScore);
    }

    /// @notice Claws back bonus points (e.g. when a member's attendance is revoked). Saturates at zero.
    function deductPoints(address user, uint256 points, bytes32 reason) external onlyScorer returns (uint256 newScore) {
        uint256 current = proofScore[user];
        newScore = current >= points ? current - points : 0;
        proofScore[user] = newScore;
        emit PointsDeducted(user, points, reason, newScore);
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice The organizer name shown on credentials comes from the admin-registered profile.
    function createEvent(EventInput calldata input) external onlyVerifiedOrganizer returns (uint256 eventId) {
        _validateText(input.name, input.location, input.skillTags);
        if (!input.isOnline) _validateCoordinates(input.lat, input.long);
        if (input.durationHours == 0 || input.durationHours > MAX_DURATION_HOURS) revert InvalidDuration();
        if (input.checkInSigner == address(0)) revert InvalidSigner();

        uint256 start = input.startTime == 0 ? block.timestamp : input.startTime;
        if (start > block.timestamp + MAX_START_OFFSET || start + MAX_BACKDATE < block.timestamp) {
            revert InvalidStartTime();
        }
        if (start + input.durationHours * 1 hours <= block.timestamp) revert EventAlreadyEnded();

        eventId = ++eventCount;
        Event storage e = events[eventId];
        e.id = eventId;
        e.name = input.name;
        e.organizer = organizerProfiles[msg.sender].name;
        e.organizerVerified = true;
        e.location = input.location;
        e.timestamp = start;
        e.durationHours = input.durationHours;
        e.isActive = true;
        if (!input.isOnline) {
            e.lat = input.lat;
            e.long = input.long;
        }
        e.category = input.category;
        e.skillTags = input.skillTags;
        e.creator = msg.sender;
        e.checkInSigner = input.checkInSigner;
        e.maxAttendees = input.maxAttendees;
        e.isOnline = input.isOnline;

        organizerEvents[msg.sender].push(eventId);

        emit EventCreated(eventId, msg.sender, input.name, start, input.checkInSigner);
    }

    function setEventActive(uint256 eventId, bool active) external onlyEventManager(eventId) {
        events[eventId].isActive = active;
        emit EventStatusChanged(eventId, active);
    }

    /// @notice Rotate the QR signing key, e.g. when the QR screen moves to another device.
    function setCheckInSigner(uint256 eventId, address signer) external onlyEventCreator(eventId) {
        if (signer == address(0)) revert InvalidSigner();
        events[eventId].checkInSigner = signer;
        emit CheckInSignerUpdated(eventId, signer);
    }

    // ---------------------------------------------------------------------
    // Attendance
    // ---------------------------------------------------------------------

    /**
     * @param eventId    Event to check in to.
     * @param codeWindow unixTime / QR_ROTATION_SECONDS at the moment the QR code was generated.
     * @param signature  checkInSigner's EIP-191 signature over checkInMessageHash(eventId, codeWindow).
     */
    function checkIn(uint256 eventId, uint256 codeWindow, bytes calldata signature) external nonReentrant {
        _checkInWithCode(msg.sender, eventId, codeWindow, signature);
    }

    /// @notice Gasless self-scan: a relayer submits the attendee's EIP-712 signed intent and pays the gas.
    ///         Replay is impossible because attendance is one-time per event; `deadline` bounds the intent.
    function checkInWithSig(
        address attendee,
        uint256 eventId,
        uint256 codeWindow,
        bytes calldata qrSignature,
        uint256 deadline,
        bytes calldata attendeeSignature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CHECKIN_TYPEHASH, attendee, eventId, codeWindow, deadline)));
        if (!SignatureChecker.isValidSignatureNow(attendee, digest, attendeeSignature)) revert InvalidAttendeeSignature();
        _checkInWithCode(attendee, eventId, codeWindow, qrSignature);
    }

    /**
     * @notice Kiosk mode: the organizer device scanned the attendee's personal QR. The attendee consented
     *         (KioskConsent) and the event's QR key attests the physical scan (KioskAttest). Anyone - usually
     *         the relayer or the organizer - may submit.
     */
    function checkInViaKiosk(
        uint256 eventId,
        address attendee,
        uint256 deadline,
        bytes calldata attendeeSignature,
        bytes calldata kioskSignature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (deadline > block.timestamp + MAX_KIOSK_VALIDITY) revert InvalidDeadline();
        Event storage e = _getEvent(eventId);
        bytes32 key = _requireCanCheckIn(attendee, eventId, e);
        _verifyKiosk(eventId, attendee, deadline, attendeeSignature, kioskSignature, e.checkInSigner);
        _record(attendee, eventId, e, key);
    }

    /// @notice Revokes a credential issued by mistake or through abuse. Burns the soulbound token, removes the
    ///         Proof Score it granted and cascades to project membership. The record stays, marked revoked.
    function revokeCredential(
        address user,
        uint256 eventId,
        string calldata reason
    ) external nonReentrant onlyEventManager(eventId) {
        if (bytes(reason).length > MAX_TEXT_LENGTH) revert TextTooLong();
        bytes32 key = attendanceKey(user, eventId);
        AttendanceRecord storage record = attendanceRecords[key];
        if (record.timestamp == 0) revert CredentialNotFound();
        if (record.revoked) revert AlreadyRevoked();

        record.revoked = true;
        uint256 score = proofScore[user];
        proofScore[user] = score >= POINTS_PER_CHECKIN ? score - POINTS_PER_CHECKIN : 0;
        validCredentialCount[user] -= 1;
        events[eventId].attendeeCount -= 1;
        totalCheckIns -= 1;

        if (address(credentialToken) != address(0)) {
            try credentialToken.burnAttendance(user, eventId) {} catch {
                emit HookFailed(user, eventId, ICredentialToken.burnAttendance.selector);
            }
        }
        if (projectRegistry != address(0)) {
            try IAttendanceHook(projectRegistry).onAttendanceRevoked(user, eventId) {} catch {
                emit HookFailed(user, eventId, IAttendanceHook.onAttendanceRevoked.selector);
            }
        }
        emit CredentialRevoked(user, eventId, msg.sender, reason);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getUserAttendedEvents(address user) external view returns (uint256[] memory) {
        return userEvents[user];
    }

    function getUserEventCount(address user) external view returns (uint256) {
        return userEvents[user].length;
    }

    function getUserProofScore(address user) external view returns (uint256) {
        return proofScore[user];
    }

    /// @notice True once a user checked in, even if the credential was later revoked (no second check-in).
    function hasAttended(address user, uint256 eventId) external view returns (bool) {
        return attendanceRecords[attendanceKey(user, eventId)].timestamp != 0;
    }

    /// @notice True for a checked-in, non-revoked attendance.
    function isValidAttendance(address user, uint256 eventId) public view returns (bool) {
        AttendanceRecord storage record = attendanceRecords[attendanceKey(user, eventId)];
        return record.timestamp != 0 && !record.revoked;
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        return _getEvent(eventId);
    }

    /// @notice Lightweight accessor for other contracts (avoids copying the event's strings).
    function getEventWindow(
        uint256 eventId
    ) external view returns (address creator, uint256 start, uint256 end, bool isActive) {
        Event storage e = _getEvent(eventId);
        return (e.creator, e.timestamp, e.timestamp + e.durationHours * 1 hours, e.isActive);
    }

    function getEvents(uint256[] calldata eventIds) external view returns (Event[] memory result) {
        if (eventIds.length > MAX_PAGE_SIZE) revert PageTooLarge();
        result = new Event[](eventIds.length);
        for (uint256 i = 0; i < eventIds.length; i++) {
            result[i] = _getEvent(eventIds[i]);
        }
    }

    /// @notice Newest first; `limit` is capped at MAX_PAGE_SIZE.
    function getLatestEvents(uint256 offset, uint256 limit) external view returns (Event[] memory result) {
        if (offset >= eventCount) return new Event[](0);
        uint256 size = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        if (size > eventCount - offset) size = eventCount - offset;
        result = new Event[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = events[eventCount - offset - i];
        }
    }

    function getOrganizerEvents(address account) external view returns (uint256[] memory) {
        return organizerEvents[account];
    }

    /// @notice A page of a Web3 CV (oldest first). Use getUserEventCount to page from the newest end.
    function getUserCredentials(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (Event[] memory attended, AttendanceRecord[] memory records) {
        uint256[] storage ids = userEvents[user];
        uint256 size = _pageSize(ids.length, offset, limit);
        attended = new Event[](size);
        records = new AttendanceRecord[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 eventId = ids[offset + i];
            attended[i] = events[eventId];
            records[i] = attendanceRecords[attendanceKey(user, eventId)];
        }
    }

    /// @notice A page of an event's attendees (in check-in order) with their records.
    function getEventAttendees(
        uint256 eventId,
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory attendees, AttendanceRecord[] memory records) {
        address[] storage list = eventAttendees[eventId];
        uint256 size = _pageSize(list.length, offset, limit);
        attendees = new address[](size);
        records = new AttendanceRecord[](size);
        for (uint256 i = 0; i < size; i++) {
            address attendee = list[offset + i];
            attendees[i] = attendee;
            records[i] = attendanceRecords[attendanceKey(attendee, eventId)];
        }
    }

    function getEventAttendeeCount(uint256 eventId) external view returns (uint256) {
        return eventAttendees[eventId].length;
    }

    function attendanceKey(address user, uint256 eventId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, eventId));
    }

    function checkInMessageHash(uint256 eventId, uint256 codeWindow) public view returns (bytes32) {
        return keccak256(abi.encodePacked(CHECKIN_DOMAIN, block.chainid, address(this), eventId, codeWindow));
    }

    /// @notice EIP-712 domain separator (name "onCV", version "1").
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _checkInWithCode(address attendee, uint256 eventId, uint256 codeWindow, bytes calldata signature) internal {
        Event storage e = _getEvent(eventId);
        bytes32 key = _requireCanCheckIn(attendee, eventId, e);

        uint256 currentWindow = block.timestamp / QR_ROTATION_SECONDS;
        if (codeWindow > currentWindow + MAX_CLOCK_SKEW / QR_ROTATION_SECONDS) revert CodeNotYetValid();
        if (currentWindow > codeWindow + QR_CODE_TTL / QR_ROTATION_SECONDS) revert CodeExpired();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(checkInMessageHash(eventId, codeWindow));
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != e.checkInSigner) revert InvalidCheckInCode();

        _record(attendee, eventId, e, key);
    }

    function _requireCanCheckIn(address attendee, uint256 eventId, Event storage e) internal view returns (bytes32 key) {
        key = attendanceKey(attendee, eventId);
        if (attendanceRecords[key].timestamp != 0) revert AlreadyCheckedIn();
        if (!e.isActive) revert EventInactive();
        if (!isVerifiedOrganizer[e.creator]) revert OrganizerNotVerified();
        if (block.timestamp + CHECKIN_OPENS_BEFORE < e.timestamp) revert CheckInNotOpen();
        if (block.timestamp > e.timestamp + e.durationHours * 1 hours) revert CheckInClosed();
        if (e.maxAttendees != 0 && e.attendeeCount >= e.maxAttendees) revert EventFull();
    }

    function _verifyKiosk(
        uint256 eventId,
        address attendee,
        uint256 deadline,
        bytes calldata attendeeSignature,
        bytes calldata kioskSignature,
        address expectedSigner
    ) internal view {
        bytes32 consent = _hashTypedDataV4(keccak256(abi.encode(KIOSK_CONSENT_TYPEHASH, attendee, deadline)));
        if (!SignatureChecker.isValidSignatureNow(attendee, consent, attendeeSignature)) revert InvalidAttendeeSignature();
        bytes32 attest = _hashTypedDataV4(keccak256(abi.encode(KIOSK_ATTEST_TYPEHASH, eventId, attendee, deadline)));
        (address kiosk, ECDSA.RecoverError err, ) = ECDSA.tryRecover(attest, kioskSignature);
        if (err != ECDSA.RecoverError.NoError || kiosk != expectedSigner) revert InvalidCheckInCode();
    }

    function _record(address attendee, uint256 eventId, Event storage e, bytes32 key) internal {
        attendanceRecords[key] = AttendanceRecord(uint64(block.timestamp), uint64(block.number), false);
        userEvents[attendee].push(eventId);
        eventAttendees[eventId].push(attendee);
        e.attendeeCount += 1;
        totalCheckIns += 1;
        validCredentialCount[attendee] += 1;

        uint256 newScore = proofScore[attendee] + POINTS_PER_CHECKIN;
        proofScore[attendee] = newScore;

        // The credential is recorded even if the token hook fails (e.g. a wallet that rejects ERC-1155).
        if (address(credentialToken) != address(0)) {
            try credentialToken.mintAttendance(attendee, eventId) {} catch {
                emit HookFailed(attendee, eventId, ICredentialToken.mintAttendance.selector);
            }
        }

        emit AttendanceRecorded(attendee, eventId, newScore, block.timestamp);
    }

    function _setOrganizer(address organizer, string memory name, string memory domain) internal {
        if (organizer == address(0)) revert InvalidOrganizer();
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(name).length > MAX_ORG_NAME_LENGTH || bytes(domain).length > MAX_DOMAIN_LENGTH) revert TextTooLong();
        if (!isVerifiedOrganizer[organizer]) {
            isVerifiedOrganizer[organizer] = true;
            emit OrganizerAdded(organizer, msg.sender);
        }
        organizerProfiles[organizer] = OrganizerProfile(name, domain);
        emit OrganizerProfileUpdated(organizer, name, domain);
    }

    function _getEvent(uint256 eventId) internal view returns (Event storage) {
        if (eventId == 0 || eventId > eventCount) revert EventNotFound();
        return events[eventId];
    }

    function _pageSize(uint256 total, uint256 offset, uint256 limit) internal pure returns (uint256 size) {
        if (offset >= total) return 0;
        size = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        if (size > total - offset) size = total - offset;
    }

    function _validateText(string calldata name, string calldata location, string calldata skillTags) internal pure {
        if (bytes(name).length == 0) revert EmptyName();
        if (
            bytes(name).length > MAX_TEXT_LENGTH ||
            bytes(location).length > MAX_TEXT_LENGTH ||
            bytes(skillTags).length > MAX_TEXT_LENGTH
        ) revert TextTooLong();
    }

    function _validateCoordinates(int256 lat, int256 long) internal pure {
        if (
            lat < -90 * COORDINATE_SCALE ||
            lat > 90 * COORDINATE_SCALE ||
            long < -180 * COORDINATE_SCALE ||
            long > 180 * COORDINATE_SCALE
        ) revert InvalidCoordinates();
    }
}
