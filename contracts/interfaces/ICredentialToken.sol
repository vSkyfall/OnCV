// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Hooks the registries call on the soulbound credential token (OnCVCredential).
interface ICredentialToken {
    function mintAttendance(address to, uint256 eventId) external;

    function burnAttendance(address from, uint256 eventId) external;

    function mintProject(address to, uint256 projectId) external;

    function burnProject(address from, uint256 projectId) external;

    function refreshProject(uint256 projectId) external;
}
