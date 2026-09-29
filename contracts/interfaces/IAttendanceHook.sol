// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Implemented by ProjectRegistry so a revoked attendance cascades to project membership.
interface IAttendanceHook {
    function onAttendanceRevoked(address user, uint256 eventId) external;
}
