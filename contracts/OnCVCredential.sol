// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ICredentialToken} from "./interfaces/ICredentialToken.sol";
import {ProjectRegistry} from "./ProjectRegistry.sol";
import {ProofSkill} from "./ProofSkill.sol";

/**
 * @title onCV Credentials - soulbound ERC-1155 with fully on-chain, dynamic metadata
 * @notice Token id `eventId` is a verified attendance credential; token id `PROJECT_ID_OFFSET + projectId` is a
 *         project credential held by every team member. Metadata (JSON + SVG) is rendered on-chain from the
 *         registries at read time, so a project credential always reflects the project's latest stage and its
 *         3rd / 6th month checkpoints. Wallets and explorers (OKX Wallet, SnowTrace) display them natively.
 * @dev Transfers and approvals are disabled (soulbound). There is no admin: only ProofSkill mints/burns
 *      attendance tokens and only the (once-wired) ProjectRegistry mints/burns project tokens, and every mint
 *      is checked against the registry's own record, so a token can never exist without a real credential.
 */
contract OnCVCredential is ERC1155, ICredentialToken {
    using Strings for uint256;

    uint256 public constant PROJECT_ID_OFFSET = 1 << 128;

    string public constant name = "onCV Credentials";
    string public constant symbol = "ONCV";

    ProofSkill public immutable proofSkill;
    address public immutable deployer;
    ProjectRegistry public projectRegistry;

    /// @dev ERC-4906 style signal so wallets and indexers refresh a token's metadata.
    event MetadataUpdate(uint256 _tokenId);
    /// @dev ERC-5192: emitted when a token becomes (permanently) locked, i.e. on mint.
    event Locked(uint256 tokenId);
    event ProjectRegistryUpdated(address registry);

    error Soulbound();
    error RegistryNotSet();
    error Unauthorized();
    error AlreadyWired();
    error NoCredential();

    constructor(ProofSkill proofSkill_) ERC1155("") {
        proofSkill = proofSkill_;
        deployer = msg.sender;
    }

    /// @notice One-time wiring by the deployer (irreversible).
    function setProjectRegistry(ProjectRegistry registry) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (address(projectRegistry) != address(0)) revert AlreadyWired();
        projectRegistry = registry;
        emit ProjectRegistryUpdated(address(registry));
    }

    // ---------------------------------------------------------------------
    // Registry hooks
    // ---------------------------------------------------------------------

    function mintAttendance(address to, uint256 eventId) external {
        if (msg.sender != address(proofSkill)) revert Unauthorized();
        if (!proofSkill.isValidAttendance(to, eventId)) revert NoCredential();
        _mintLocked(to, eventId);
    }

    function burnAttendance(address from, uint256 eventId) external {
        if (msg.sender != address(proofSkill)) revert Unauthorized();
        if (balanceOf(from, eventId) > 0) _burn(from, eventId, 1);
    }

    function mintProject(address to, uint256 projectId) external {
        if (msg.sender != address(projectRegistry) || address(projectRegistry) == address(0)) revert Unauthorized();
        if (!projectRegistry.isMember(projectId, to)) revert NoCredential();
        _mintLocked(to, projectTokenId(projectId));
    }

    function burnProject(address from, uint256 projectId) external {
        if (msg.sender != address(projectRegistry) || address(projectRegistry) == address(0)) revert Unauthorized();
        uint256 id = projectTokenId(projectId);
        if (balanceOf(from, id) > 0) _burn(from, id, 1);
    }

    function refreshProject(uint256 projectId) external {
        if (msg.sender != address(projectRegistry) || address(projectRegistry) == address(0)) revert Unauthorized();
        emit MetadataUpdate(projectTokenId(projectId));
    }

    function _mintLocked(address to, uint256 id) internal {
        if (balanceOf(to, id) == 0) {
            _mint(to, id, 1, "");
            emit Locked(id);
        }
    }

    function projectTokenId(uint256 projectId) public pure returns (uint256) {
        return PROJECT_ID_OFFSET + projectId;
    }

    /// @notice ERC-5192 style: every onCV credential is permanently locked to its holder.
    function locked(uint256) external pure returns (bool) {
        return true;
    }

    // ---------------------------------------------------------------------
    // Soulbound
    // ---------------------------------------------------------------------

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId); // 0xb45a3c0e = ERC-5192
    }

    // ---------------------------------------------------------------------
    // On-chain metadata
    // ---------------------------------------------------------------------

    function uri(uint256 id) public view override returns (string memory) {
        string memory json = id >= PROJECT_ID_OFFSET ? _projectJson(id - PROJECT_ID_OFFSET) : _eventJson(id);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _eventJson(uint256 eventId) internal view returns (string memory) {
        ProofSkill.Event memory e = proofSkill.getEvent(eventId);
        string memory org = _jsonEscape(e.organizer);
        string memory head = string.concat(
            '{"name":"',
            _jsonEscape(e.name),
            '","description":"Verified attendance credential issued on onCV by ',
            org,
            '. Non-transferable (soulbound).","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_eventSvg(e))),
            '"'
        );
        string memory attributes = string.concat(
            ',"attributes":[{"trait_type":"Organizer","value":"',
            org,
            '"},{"trait_type":"Category","value":"',
            _categoryName(uint8(e.category)),
            '"},{"trait_type":"Location","value":"',
            e.isOnline ? "Online" : _jsonEscape(e.location),
            '"},{"display_type":"date","trait_type":"Date","value":',
            e.timestamp.toString(),
            '},{"trait_type":"Soulbound","value":"true"}]}'
        );
        return string.concat(head, attributes);
    }

    function _projectJson(uint256 projectId) internal view returns (string memory) {
        if (address(projectRegistry) == address(0)) revert RegistryNotSet();
        ProjectRegistry.Project memory p = projectRegistry.getProject(projectId);
        (ProjectRegistry.CheckpointStatus c1, , , , ) = projectRegistry.getCheckpoint(projectId, 1);
        (ProjectRegistry.CheckpointStatus c2, , , , ) = projectRegistry.getCheckpoint(projectId, 2);
        string memory stage = _stageName(uint8(p.stage));
        string memory status = p.hidden
            ? "Hidden by moderator"
            : (
                p.stage == ProjectRegistry.Stage.Registered
                    ? "Registered"
                    : (p.stageAttested ? "Attested" : "Self-reported")
            );

        string memory head = string.concat(
            '{"name":"',
            _jsonEscape(p.title),
            '","description":"onCV project credential. Stage and 3rd / 6th month checkpoints update on-chain.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_projectSvg(p, stage, status, c1, c2))),
            '"'
        );
        string memory attributes = string.concat(
            ',"attributes":[{"trait_type":"Stage","value":"',
            stage,
            '"},{"trait_type":"Verification","value":"',
            status,
            '"},{"trait_type":"Checkpoint 3M","value":"',
            _checkpointName(uint8(c1)),
            '"},{"trait_type":"Checkpoint 6M","value":"',
            _checkpointName(uint8(c2)),
            '"},{"trait_type":"Team size","value":',
            p.team.length.toString(),
            '},{"trait_type":"Event","value":',
            p.eventId.toString(),
            "}]}"
        );
        return string.concat(head, attributes);
    }

    function _eventSvg(ProofSkill.Event memory e) internal pure returns (string memory) {
        return
            string.concat(
                _svgHeader(),
                _text(32, 150, 13, "#A1A1AA", "VERIFIED ATTENDANCE"),
                _text(32, 190, 24, "#FAFAFA", _xmlEscape(_truncate(e.name, 30))),
                _text(32, 222, 15, "#A1A1AA", _xmlEscape(_truncate(e.organizer, 40))),
                _text(32, 250, 13, "#71717A", _xmlEscape(_truncate(e.location, 44))),
                _svgFooter()
            );
    }

    function _projectSvg(
        ProjectRegistry.Project memory p,
        string memory stage,
        string memory status,
        ProjectRegistry.CheckpointStatus c1,
        ProjectRegistry.CheckpointStatus c2
    ) internal pure returns (string memory) {
        string memory dot = p.stage == ProjectRegistry.Stage.ShutDown
            ? "#E84142"
            : (p.stage == ProjectRegistry.Stage.Registered ? "#71717A" : "#34D399");
        return
            string.concat(
                _svgHeader(),
                _text(32, 140, 13, "#A1A1AA", "PROJECT CREDENTIAL"),
                _text(32, 180, 24, "#FAFAFA", _xmlEscape(_truncate(p.title, 30))),
                string.concat("<circle cx='38' cy='215' r='5' fill='", dot, "'/>"),
                _text(52, 220, 16, "#FAFAFA", string.concat(stage, " - ", status)),
                _text(32, 262, 13, "#A1A1AA", string.concat("3rd month: ", _checkpointName(uint8(c1)))),
                _text(32, 284, 13, "#A1A1AA", string.concat("6th month: ", _checkpointName(uint8(c2)))),
                _svgFooter()
            );
    }

    function _svgHeader() internal pure returns (string memory) {
        return
            string.concat(
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>",
                "<rect width='400' height='400' rx='24' fill='#09090B'/>",
                "<rect x='12' y='12' width='376' height='376' rx='18' fill='none' stroke='#27272A'/>",
                "<rect x='32' y='36' width='36' height='36' rx='8' fill='#FAFAFA'/>",
                "<circle cx='49' cy='56' r='8' fill='none' stroke='#09090B' stroke-width='3.5'/>",
                "<circle cx='60' cy='45' r='3.5' fill='#E84142'/>",
                _text(80, 61, 18, "#FAFAFA", "onCV")
            );
    }

    function _svgFooter() internal pure returns (string memory) {
        return string.concat(_text(32, 356, 12, "#71717A", "Avalanche - Soulbound credential"), "</svg>");
    }

    function _text(
        uint256 x,
        uint256 y,
        uint256 size,
        string memory color,
        string memory content
    ) internal pure returns (string memory) {
        return
            string.concat(
                "<text x='",
                x.toString(),
                "' y='",
                y.toString(),
                "' font-family='Helvetica,Arial,sans-serif' font-size='",
                size.toString(),
                "' fill='",
                color,
                "'>",
                content,
                "</text>"
            );
    }

    function _categoryName(uint8 category) internal pure returns (string memory) {
        if (category == 0) return "Workshop";
        if (category == 1) return "Hackathon";
        if (category == 2) return "Conference";
        if (category == 3) return "Meetup";
        return "Bootcamp";
    }

    function _stageName(uint8 stage) internal pure returns (string memory) {
        if (stage == 1) return "Still active";
        if (stage == 2) return "First customer";
        if (stage == 3) return "Funded";
        if (stage == 4) return "Shut down";
        return "Registered";
    }

    function _checkpointName(uint8 status) internal pure returns (string memory) {
        if (status == 1) return "Open";
        if (status == 2) return "Completed";
        if (status == 3) return "Missed";
        return "Upcoming";
    }

    /// @dev Cuts at a UTF-8 character boundary and appends "...".
    function _truncate(string memory value, uint256 maxBytes) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        if (b.length <= maxBytes) return value;
        uint256 len = maxBytes;
        while (len > 0 && (uint8(b[len]) & 0xC0) == 0x80) len--;
        bytes memory out = new bytes(len + 3);
        for (uint256 i = 0; i < len; i++) out[i] = b[i];
        out[len] = ".";
        out[len + 1] = ".";
        out[len + 2] = ".";
        return string(out);
    }

    /// @dev Escapes quotes/backslashes and replaces control characters so user text cannot break the JSON.
    function _jsonEscape(string memory value) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        uint256 extra;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == '"' || b[i] == "\\") extra++;
        }
        bytes memory out = new bytes(b.length + extra);
        uint256 j;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[j++] = "\\";
                out[j++] = c;
            } else if (uint8(c) < 0x20) {
                out[j++] = " ";
            } else {
                out[j++] = c;
            }
        }
        return string(out);
    }

    /// @dev Escapes XML special characters so user text cannot inject SVG markup.
    function _xmlEscape(string memory value) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        uint256 extra;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") extra += 4;
            else if (c == "<" || c == ">") extra += 3;
            else if (c == '"' || c == "'") extra += 5;
        }
        bytes memory out = new bytes(b.length + extra);
        uint256 j;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bytes memory rep;
            if (c == "&") rep = "&amp;";
            else if (c == "<") rep = "&lt;";
            else if (c == ">") rep = "&gt;";
            else if (c == '"') rep = "&quot;";
            else if (c == "'") rep = "&apos;";
            if (rep.length > 0) {
                for (uint256 k = 0; k < rep.length; k++) out[j++] = rep[k];
            } else {
                out[j++] = uint8(c) < 0x20 ? bytes1(" ") : c;
            }
        }
        return string(out);
    }
}
