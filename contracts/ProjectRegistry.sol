// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAttendanceHook} from "./interfaces/IAttendanceHook.sol";
import {ICredentialToken} from "./interfaces/ICredentialToken.sol";
import {ProofSkill} from "./ProofSkill.sol";

/**
 * @title onCV Projects - post-event project tracking
 * @notice Hackathon projects rarely survive; showing which ones do is the signal investors and employers need.
 *         1. A verified attendee registers the team's project and invites teammates; teammates join only by
 *            accepting (nobody can be locked into a team without consent).
 *         2. At the 3rd and 6th month checkpoints (counted from the event's end) the team reports progress:
 *            still active, first customer, funded or shut down, optionally with evidence.
 *         3. Claims are attested by the right party: "funded" only by a verified investor or the admin;
 *            other stages also by the event's verified organizer. Points are awarded only when the attested
 *            stage moves forward (cumulative 10 / 35 / 85 per member), so cycling stages earns nothing.
 *         4. A missed checkpoint is recorded as such - the "abandoned project" signal.
 *         5. Revoking a member's attendance removes them from the team, burns their project token and claws
 *            back the milestone points they received.
 * @dev Admin and organizer verification are read from ProofSkill (single source of trust).
 */
contract ProjectRegistry is IAttendanceHook, ReentrancyGuard {
    enum Stage {
        Registered,
        StillActive,
        FirstCustomer,
        Funded,
        ShutDown
    }

    enum CheckpointStatus {
        Upcoming,
        Open,
        Completed,
        Missed
    }

    struct ProjectInput {
        uint256 eventId;
        string title;
        string pitch;
        string url;
        address[] invitees;
    }

    struct Project {
        uint256 id;
        uint256 eventId;
        address owner;
        string title;
        string pitch;
        string url;
        uint64 registeredAt;
        uint64 anchorAt; // Event end: checkpoints are counted from here
        uint64 lastUpdateAt;
        Stage stage;
        bool stageAttested;
        bool hidden;
        Stage highestRewarded;
        address[] team;
        address[] pendingInvites;
    }

    struct Update {
        uint64 timestamp;
        Stage stage;
        bool attested;
        address attester;
        string note;
        string evidence;
    }

    struct Investor {
        string name;
        string url;
        bool active;
    }

    uint256 public constant MAX_TEAM_SIZE = 5;
    uint256 public constant MAX_UPDATES = 24;
    uint256 public constant CHECKPOINTS = 2;
    uint256 public constant REGISTRATION_WINDOW = 7 days;
    uint256 public constant MAX_PAGE_SIZE = 50;

    uint256 private constant MAX_TITLE = 80;
    uint256 private constant MAX_PITCH = 280;
    uint256 private constant MAX_URL = 200;
    uint256 private constant MAX_NOTE = 200;

    ProofSkill public immutable proofSkill;
    /// @notice Spacing between tracking checkpoints (90 days in production; shorter for demos).
    uint256 public immutable checkpointInterval;
    ICredentialToken public credentialToken;

    uint256 public projectCount;

    mapping(uint256 => Project) internal projects;
    mapping(uint256 => Update[]) internal updates;
    mapping(uint256 => uint256[]) internal eventProjects;
    mapping(address => uint256[]) internal memberProjects;
    mapping(address => uint256[]) internal inviteList;
    /// @notice eventId => member => projectId (0 = none). One team per person per event.
    mapping(uint256 => mapping(address => uint256)) public projectOf;
    mapping(uint256 => mapping(address => bool)) public isInvited;
    /// @notice Milestone points each member received from a project (clawed back on revocation).
    mapping(uint256 => mapping(address => uint256)) public pointsEarned;
    mapping(address => Investor) public investors;

    event ProjectRegistered(uint256 indexed projectId, uint256 indexed eventId, address indexed owner);
    event MemberInvited(uint256 indexed projectId, address indexed invitee);
    event InviteResolved(uint256 indexed projectId, address indexed invitee, bool accepted);
    event MemberJoined(uint256 indexed projectId, address indexed member);
    event MemberRemoved(uint256 indexed projectId, address indexed member);
    event OwnershipTransferred(uint256 indexed projectId, address indexed previousOwner, address indexed newOwner);
    event ProjectUpdated(uint256 indexed projectId, uint256 indexed updateIndex, Stage stage);
    event UpdateAttested(uint256 indexed projectId, uint256 indexed updateIndex, address indexed attester, Stage stage);
    event ProjectHidden(uint256 indexed projectId, bool hidden);
    event InvestorUpdated(address indexed investor, bool active);
    event CredentialTokenUpdated(address token);

    error NotAdmin();
    error NotProofSkill();
    error AlreadyWired();
    error ProjectNotFound();
    error RegistrationClosed();
    error NotAttendee();
    error InvalidInput();
    error TeamTooLarge();
    error InviteeNotAttendee(address invitee);
    error AlreadyInProject(address member);
    error AlreadyInvited(address invitee);
    error NotInvited();
    error NotProjectOwner();
    error NotTeamMember();
    error InvalidStage();
    error ProjectClosed();
    error TooManyUpdates();
    error UpdateNotFound();
    error AlreadyAttested();
    error NotAttester();
    error InvalidCheckpoint();

    modifier onlyAdmin() {
        if (!proofSkill.isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    constructor(ProofSkill proofSkill_, uint256 checkpointInterval_) {
        if (address(proofSkill_) == address(0) || checkpointInterval_ < 2) revert InvalidInput();
        proofSkill = proofSkill_;
        checkpointInterval = checkpointInterval_;
    }

    /// @notice One-time wiring (irreversible), so the token cannot be redirected later.
    function setCredentialToken(ICredentialToken token) external onlyAdmin {
        if (address(credentialToken) != address(0)) revert AlreadyWired();
        if (address(token) == address(0)) revert InvalidInput();
        credentialToken = token;
        emit CredentialTokenUpdated(address(token));
    }

    // ---------------------------------------------------------------------
    // Registration & team
    // ---------------------------------------------------------------------

    /// @notice Open from the event start until REGISTRATION_WINDOW after it ends. Invitees join by accepting.
    function registerProject(ProjectInput calldata input) external nonReentrant returns (uint256 projectId) {
        uint256 end = _requireRegistrationOpen(input.eventId);
        if (!proofSkill.isValidAttendance(msg.sender, input.eventId)) revert NotAttendee();
        _validateInput(input);
        if (input.invitees.length + 1 > MAX_TEAM_SIZE) revert TeamTooLarge();

        projectId = ++projectCount;
        Project storage p = projects[projectId];
        p.id = projectId;
        p.eventId = input.eventId;
        p.owner = msg.sender;
        p.title = input.title;
        p.pitch = input.pitch;
        p.url = input.url;
        p.registeredAt = uint64(block.timestamp);
        p.anchorAt = uint64(end);
        p.lastUpdateAt = uint64(block.timestamp);
        eventProjects[input.eventId].push(projectId);

        _addMember(p, projectId, msg.sender);
        for (uint256 i = 0; i < input.invitees.length; i++) {
            _invite(p, projectId, input.invitees[i]);
        }
        emit ProjectRegistered(projectId, input.eventId, msg.sender);
    }

    function inviteMember(uint256 projectId, address invitee) external {
        Project storage p = _getProject(projectId);
        if (msg.sender != p.owner) revert NotProjectOwner();
        _requireRegistrationOpen(p.eventId);
        if (p.team.length + p.pendingInvites.length + 1 > MAX_TEAM_SIZE) revert TeamTooLarge();
        _invite(p, projectId, invitee);
    }

    function cancelInvite(uint256 projectId, address invitee) external {
        Project storage p = _getProject(projectId);
        if (msg.sender != p.owner) revert NotProjectOwner();
        _resolveInvite(p, projectId, invitee, false);
    }

    function acceptInvite(uint256 projectId) external nonReentrant {
        Project storage p = _getProject(projectId);
        _requireRegistrationOpen(p.eventId);
        if (!isInvited[projectId][msg.sender]) revert NotInvited();
        if (p.owner == address(0)) revert ProjectClosed(); // every member was revoked
        if (!proofSkill.isValidAttendance(msg.sender, p.eventId)) revert NotAttendee();
        if (projectOf[p.eventId][msg.sender] != 0) revert AlreadyInProject(msg.sender);
        _resolveInvite(p, projectId, msg.sender, true);
        _addMember(p, projectId, msg.sender);
    }

    function declineInvite(uint256 projectId) external {
        Project storage p = _getProject(projectId);
        _resolveInvite(p, projectId, msg.sender, false);
    }

    function transferProjectOwnership(uint256 projectId, address newOwner) external {
        Project storage p = _getProject(projectId);
        if (msg.sender != p.owner) revert NotProjectOwner();
        if (projectOf[p.eventId][newOwner] != projectId) revert NotTeamMember();
        emit OwnershipTransferred(projectId, p.owner, newOwner);
        p.owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Tracking
    // ---------------------------------------------------------------------

    function postUpdate(uint256 projectId, Stage stage, string calldata note, string calldata evidence) external {
        Project storage p = _getProject(projectId);
        if (msg.sender != p.owner) revert NotProjectOwner();
        if (stage == Stage.Registered) revert InvalidStage();
        if (p.stage == Stage.ShutDown) revert ProjectClosed();
        if (bytes(note).length > MAX_NOTE || bytes(evidence).length > MAX_URL) revert InvalidInput();

        Update[] storage list = updates[projectId];
        if (list.length >= MAX_UPDATES) revert TooManyUpdates();
        list.push(Update(uint64(block.timestamp), stage, false, address(0), note, evidence));

        p.stage = stage;
        p.stageAttested = false;
        p.lastUpdateAt = uint64(block.timestamp);

        _refreshCredential(projectId);
        emit ProjectUpdated(projectId, list.length - 1, stage);
    }

    /// @notice Attests a progress claim. Points follow the highest attested stage (cumulative 10 / 35 / 85).
    function attestUpdate(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = _getProject(projectId);
        Update[] storage list = updates[projectId];
        if (index >= list.length) revert UpdateNotFound();
        Update storage u = list[index];
        if (!canAttestStage(projectId, msg.sender, u.stage)) revert NotAttester();
        if (u.attested) revert AlreadyAttested();

        u.attested = true;
        u.attester = msg.sender;
        if (index == list.length - 1) p.stageAttested = true;

        if (u.stage != Stage.ShutDown && u.stage > p.highestRewarded) {
            uint256 points = cumulativePoints(u.stage) - cumulativePoints(p.highestRewarded);
            p.highestRewarded = u.stage;
            for (uint256 i = 0; i < p.team.length; i++) {
                pointsEarned[projectId][p.team[i]] += points;
                proofSkill.awardPoints(p.team[i], points, "MILESTONE");
            }
        }

        _refreshCredential(projectId);
        emit UpdateAttested(projectId, index, msg.sender, u.stage);
    }

    /// @notice "Funded" needs a verified investor or the admin; other stages also accept the event's organizer.
    function canAttestStage(uint256 projectId, address account, Stage stage) public view returns (bool) {
        Project storage p = _getProject(projectId);
        if (projectOf[p.eventId][account] == projectId) return false;
        if (proofSkill.isAdmin(account) || investors[account].active) return true;
        if (stage == Stage.Funded) return false;
        (address creator, , , ) = proofSkill.getEventWindow(p.eventId);
        return account == creator && proofSkill.isVerifiedOrganizer(account);
    }

    function cumulativePoints(Stage stage) public pure returns (uint256) {
        if (stage == Stage.StillActive) return 10;
        if (stage == Stage.FirstCustomer) return 35;
        if (stage == Stage.Funded) return 85;
        return 0;
    }

    /**
     * @notice Checkpoint k (1 = 3rd month, 2 = 6th month) is due at anchorAt (event end) + k * interval and is
     *         satisfied by any update posted within +/- half an interval of that date.
     * @dev Evaluated at the latest block's timestamp; clients re-evaluate unmet checkpoints against wall time.
     */
    function getCheckpoint(
        uint256 projectId,
        uint256 k
    )
        public
        view
        returns (CheckpointStatus status, uint256 dueAt, uint256 windowStart, uint256 windowEnd, uint256 updateIndex)
    {
        if (k == 0 || k > CHECKPOINTS) revert InvalidCheckpoint();
        Project storage p = _getProject(projectId);
        dueAt = uint256(p.anchorAt) + k * checkpointInterval;
        windowStart = dueAt - checkpointInterval / 2;
        windowEnd = dueAt + checkpointInterval / 2;

        Update[] storage list = updates[projectId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].timestamp >= windowStart && list[i].timestamp < windowEnd) {
                return (CheckpointStatus.Completed, dueAt, windowStart, windowEnd, i + 1);
            }
        }
        if (block.timestamp < windowStart) status = CheckpointStatus.Upcoming;
        else if (block.timestamp < windowEnd) status = CheckpointStatus.Open;
        else status = CheckpointStatus.Missed;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function addInvestor(address investor, string calldata name, string calldata url) external onlyAdmin {
        if (investor == address(0) || bytes(name).length == 0 || bytes(name).length > MAX_TITLE) revert InvalidInput();
        if (bytes(url).length > MAX_URL) revert InvalidInput();
        investors[investor] = Investor(name, url, true);
        emit InvestorUpdated(investor, true);
    }

    function removeInvestor(address investor) external onlyAdmin {
        investors[investor].active = false;
        emit InvestorUpdated(investor, false);
    }

    /// @notice Moderation: hide an abusive project from public listings (data stays on-chain).
    function setProjectHidden(uint256 projectId, bool hidden) external onlyAdmin {
        _getProject(projectId).hidden = hidden;
        emit ProjectHidden(projectId, hidden);
    }

    // ---------------------------------------------------------------------
    // Revocation cascade (called by ProofSkill)
    // ---------------------------------------------------------------------

    function onAttendanceRevoked(address user, uint256 eventId) external {
        if (msg.sender != address(proofSkill)) revert NotProofSkill();
        uint256 projectId = projectOf[eventId][user];
        if (projectId == 0) return;
        Project storage p = projects[projectId];

        projectOf[eventId][user] = 0;
        _removeFromArray(p.team, user);
        _removeId(memberProjects[user], projectId);

        uint256 earned = pointsEarned[projectId][user];
        if (earned > 0) {
            pointsEarned[projectId][user] = 0;
            proofSkill.deductPoints(user, earned, "MEMBER_REVOKED");
        }
        if (address(credentialToken) != address(0)) {
            try credentialToken.burnProject(user, projectId) {} catch {}
        }

        if (p.owner == user) {
            address next = p.team.length > 0 ? p.team[0] : address(0);
            emit OwnershipTransferred(projectId, user, next);
            p.owner = next;
            if (next == address(0) && p.stage != Stage.ShutDown) {
                p.stage = Stage.ShutDown;
                p.stageAttested = false;
            }
        }
        _refreshCredential(projectId);
        emit MemberRemoved(projectId, user);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getProject(uint256 projectId) external view returns (Project memory) {
        return _getProject(projectId);
    }

    /// @notice Newest first; `limit` is capped at MAX_PAGE_SIZE. Includes hidden projects (flagged).
    function getProjects(uint256 offset, uint256 limit) external view returns (Project[] memory result) {
        if (offset >= projectCount) return new Project[](0);
        uint256 size = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        if (size > projectCount - offset) size = projectCount - offset;
        result = new Project[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = projects[projectCount - offset - i];
        }
    }

    function getEventProjects(uint256 eventId) external view returns (uint256[] memory) {
        return eventProjects[eventId];
    }

    function getMemberProjects(address member) external view returns (uint256[] memory) {
        return memberProjects[member];
    }

    function getInvites(address invitee) external view returns (uint256[] memory) {
        return inviteList[invitee];
    }

    function isMember(uint256 projectId, address account) external view returns (bool) {
        Project storage p = _getProject(projectId);
        return projectOf[p.eventId][account] == projectId;
    }

    function getUpdates(uint256 projectId) external view returns (Update[] memory) {
        _getProject(projectId);
        return updates[projectId];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _getProject(uint256 projectId) internal view returns (Project storage) {
        if (projectId == 0 || projectId > projectCount) revert ProjectNotFound();
        return projects[projectId];
    }

    function _requireRegistrationOpen(uint256 eventId) internal view returns (uint256 end) {
        uint256 start;
        (, start, end, ) = proofSkill.getEventWindow(eventId);
        if (block.timestamp < start || block.timestamp > end + REGISTRATION_WINDOW) revert RegistrationClosed();
    }

    function _invite(Project storage p, uint256 projectId, address invitee) internal {
        if (invitee == address(0) || invitee == p.owner) revert InvalidInput();
        if (isInvited[projectId][invitee]) revert AlreadyInvited(invitee);
        if (projectOf[p.eventId][invitee] != 0) revert AlreadyInProject(invitee);
        if (!proofSkill.isValidAttendance(invitee, p.eventId)) revert InviteeNotAttendee(invitee);
        isInvited[projectId][invitee] = true;
        p.pendingInvites.push(invitee);
        inviteList[invitee].push(projectId);
        emit MemberInvited(projectId, invitee);
    }

    function _resolveInvite(Project storage p, uint256 projectId, address invitee, bool accepted) internal {
        if (!isInvited[projectId][invitee]) revert NotInvited();
        isInvited[projectId][invitee] = false;
        _removeFromArray(p.pendingInvites, invitee);
        _removeId(inviteList[invitee], projectId);
        emit InviteResolved(projectId, invitee, accepted);
    }

    function _addMember(Project storage p, uint256 projectId, address member) internal {
        // Invites are capped so team + pending never exceeds MAX_TEAM_SIZE; this is a final guard.
        if (p.team.length >= MAX_TEAM_SIZE) revert TeamTooLarge();
        if (projectOf[p.eventId][member] != 0) revert AlreadyInProject(member);
        projectOf[p.eventId][member] = projectId;
        p.team.push(member);
        memberProjects[member].push(projectId);
        if (address(credentialToken) != address(0)) {
            try credentialToken.mintProject(member, projectId) {} catch {}
        }
        emit MemberJoined(projectId, member);
    }

    function _refreshCredential(uint256 projectId) internal {
        if (address(credentialToken) != address(0)) {
            try credentialToken.refreshProject(projectId) {} catch {}
        }
    }

    function _removeFromArray(address[] storage list, address value) internal {
        uint256 length = list.length;
        for (uint256 i = 0; i < length; i++) {
            if (list[i] == value) {
                list[i] = list[length - 1];
                list.pop();
                return;
            }
        }
    }

    function _removeId(uint256[] storage list, uint256 value) internal {
        uint256 length = list.length;
        for (uint256 i = 0; i < length; i++) {
            if (list[i] == value) {
                list[i] = list[length - 1];
                list.pop();
                return;
            }
        }
    }

    function _validateInput(ProjectInput calldata input) internal pure {
        uint256 titleLength = bytes(input.title).length;
        if (titleLength == 0 || titleLength > MAX_TITLE) revert InvalidInput();
        if (bytes(input.pitch).length == 0 || bytes(input.pitch).length > MAX_PITCH) revert InvalidInput();
        if (bytes(input.url).length > MAX_URL) revert InvalidInput();
    }
}
