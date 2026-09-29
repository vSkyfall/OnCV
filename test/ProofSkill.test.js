const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { encodePacked, keccak256 } = require("viem");
const {
  ADMIN_DELAY,
  Category,
  messageHash,
  signCode,
  currentWindow,
  getEventById,
  eventInput,
  eip712Domain,
  CHECKIN_TYPES,
  KIOSK_CONSENT_TYPES,
  KIOSK_ATTEST_TYPES,
  deploySystem,
  newAccount,
} = require("./helpers");

describe("ProofSkill", function () {
  async function deployFixture() {
    const sys = await deploySystem();
    const [owner, organizer, alice, bob, outsider, relayer] = sys.signers;
    return { ...sys, owner, organizer, alice, bob, outsider, relayer };
  }

  async function withEventFixture() {
    const ctx = await deployFixture();
    await ctx.proofSkill.createEvent(
      eventInput({
        name: "Avalanche Solidity Bootcamp",
        location: "ITU Ari Teknokent, Istanbul",
        durationHours: 8,
        lat: 41_104_530,
        long: 29_022_690,
        category: Category.Bootcamp,
        skillTags: "Solidity,Avalanche",
        checkInSigner: ctx.qrSigner.address,
      }),
    );
    return { ...ctx, eventId: 1n };
  }

  async function freshCode(ctx, account = ctx.qrSigner, eventId = ctx.eventId) {
    const codeWindow = await currentWindow();
    const signature = await signCode(account, ctx.chainId, ctx.address, eventId, codeWindow);
    return { codeWindow, signature };
  }

  describe("admin and organizer verification", function () {
    it("makes the deployer admin and first verified organizer with a profile", async function () {
      const { proofSkill, owner } = await loadFixture(deployFixture);
      expect(await proofSkill.isAdmin(owner.address)).to.equal(true);
      expect(await proofSkill.defaultAdmin()).to.equal(owner.address);
      expect(await proofSkill.defaultAdminDelay()).to.equal(ADMIN_DELAY);
      expect(await proofSkill.isVerifiedOrganizer(owner.address)).to.equal(true);
      const profile = await proofSkill.organizerProfiles(owner.address);
      expect(profile.name).to.equal("onCV");
      expect(profile.domain).to.equal("oncv.xyz");
    });

    it("lets the admin add (with profile) and remove organizers", async function () {
      const { proofSkill, owner, organizer } = await loadFixture(deployFixture);
      await expect(proofSkill.addOrganizer(organizer.address, "Blockchain ITU", "blockchainitu.com"))
        .to.emit(proofSkill, "OrganizerAdded")
        .withArgs(organizer.address, owner.address)
        .and.to.emit(proofSkill, "OrganizerProfileUpdated")
        .withArgs(organizer.address, "Blockchain ITU", "blockchainitu.com");
      expect(await proofSkill.isVerifiedOrganizer(organizer.address)).to.equal(true);

      await expect(proofSkill.removeOrganizer(organizer.address))
        .to.emit(proofSkill, "OrganizerRemoved")
        .withArgs(organizer.address, owner.address);
      expect(await proofSkill.isVerifiedOrganizer(organizer.address)).to.equal(false);
    });

    it("rejects the zero address, empty and oversized organization profiles", async function () {
      const { proofSkill, organizer } = await loadFixture(deployFixture);
      await expect(proofSkill.addOrganizer(ethers.ZeroAddress, "X", "")).to.be.revertedWithCustomError(
        proofSkill,
        "InvalidOrganizer",
      );
      await expect(proofSkill.addOrganizer(organizer.address, "", "")).to.be.revertedWithCustomError(proofSkill, "EmptyName");
      await expect(proofSkill.addOrganizer(organizer.address, "N".repeat(81), "")).to.be.revertedWithCustomError(
        proofSkill,
        "TextTooLong",
      );
    });

    it("blocks non-admins from managing organizers", async function () {
      const { proofSkill, outsider, owner } = await loadFixture(deployFixture);
      const adminRole = await proofSkill.DEFAULT_ADMIN_ROLE();
      await expect(proofSkill.connect(outsider).addOrganizer(outsider.address, "Fake", ""))
        .to.be.revertedWithCustomError(proofSkill, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, adminRole);
      await expect(proofSkill.connect(outsider).removeOrganizer(owner.address))
        .to.be.revertedWithCustomError(proofSkill, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, adminRole);
    });

    it("blocks unverified wallets from creating events with the required message", async function () {
      const { proofSkill, outsider, qrSigner } = await loadFixture(deployFixture);
      await expect(
        proofSkill.connect(outsider).createEvent(eventInput({ checkInSigner: qrSigner.address })),
      ).to.be.revertedWith("Unauthorized: Not a verified organizer");
    });

    it("uses the registered organization name, so events cannot impersonate another institution", async function () {
      const { proofSkill, organizer, qrSigner } = await loadFixture(deployFixture);
      await proofSkill.addOrganizer(organizer.address, "Small Bootcamp", "smallbootcamp.io");
      await proofSkill.connect(organizer).createEvent(eventInput({ name: "Meetup", category: 3, checkInSigner: qrSigner.address }));
      const e = await getEventById(proofSkill, 1);
      expect(e.creator).to.equal(organizer.address);
      expect(e.organizer).to.equal("Small Bootcamp");
      expect(e.organizerVerified).to.equal(true);
    });

    it("revokes create, manage and check-in rights when an organizer is removed", async function () {
      const ctx = await loadFixture(deployFixture);
      const { proofSkill, organizer, alice, qrSigner } = ctx;
      await proofSkill.addOrganizer(organizer.address, "Org", "");
      await proofSkill.connect(organizer).createEvent(eventInput({ checkInSigner: qrSigner.address }));
      await proofSkill.removeOrganizer(organizer.address);

      await expect(
        proofSkill.connect(organizer).createEvent(eventInput({ checkInSigner: qrSigner.address })),
      ).to.be.revertedWith("Unauthorized: Not a verified organizer");
      await expect(proofSkill.connect(organizer).setEventActive(1n, false)).to.be.revertedWithCustomError(
        proofSkill,
        "NotEventManager",
      );

      const code = await freshCode(ctx, qrSigner, 1n);
      await expect(proofSkill.connect(alice).checkIn(1n, code.codeWindow, code.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "OrganizerNotVerified",
      );
      await expect(proofSkill.setEventActive(1n, false)).to.emit(proofSkill, "EventStatusChanged");
    });

    it("prevents an admin who is not the creator from rotating an event's QR key", async function () {
      const { proofSkill, owner, organizer, qrSigner } = await loadFixture(deployFixture);
      await proofSkill.addOrganizer(organizer.address, "Org2", "");
      await proofSkill.connect(organizer).createEvent(eventInput({ checkInSigner: qrSigner.address }));
      await expect(proofSkill.connect(owner).setCheckInSigner(1n, owner.address)).to.be.revertedWithCustomError(
        proofSkill,
        "NotEventManager",
      );
    });

    it("hands the admin role over in two steps with a delay (K4)", async function () {
      const { proofSkill, owner, outsider } = await loadFixture(deployFixture);
      const adminRole = await proofSkill.DEFAULT_ADMIN_ROLE();
      await expect(proofSkill.grantRole(adminRole, outsider.address)).to.be.revertedWithCustomError(
        proofSkill,
        "AccessControlEnforcedDefaultAdminRules",
      );

      await proofSkill.beginDefaultAdminTransfer(outsider.address);
      await expect(proofSkill.connect(outsider).acceptDefaultAdminTransfer()).to.be.revertedWithCustomError(
        proofSkill,
        "AccessControlEnforcedDefaultAdminDelay",
      );
      await time.increase(Number(ADMIN_DELAY) + 1);
      await proofSkill.connect(outsider).acceptDefaultAdminTransfer();
      expect(await proofSkill.isAdmin(outsider.address)).to.equal(true);
      expect(await proofSkill.isAdmin(owner.address)).to.equal(false);
    });
  });

  describe("one-time wiring (C1 / C2)", function () {
    it("cannot be re-wired, and nobody but the registry can award or deduct points", async function () {
      const { proofSkill, owner, outsider, tokenAddress, registryAddress } = await loadFixture(deployFixture);
      expect(await proofSkill.credentialToken()).to.equal(tokenAddress);
      expect(await proofSkill.projectRegistry()).to.equal(registryAddress);
      await expect(proofSkill.wireSatellites(outsider.address, outsider.address)).to.be.revertedWithCustomError(
        proofSkill,
        "AlreadyWired",
      );
      for (const caller of [owner, outsider]) {
        await expect(
          proofSkill.connect(caller).awardPoints(caller.address, 10, ethers.ZeroHash),
        ).to.be.revertedWithCustomError(proofSkill, "NotScorer");
        await expect(
          proofSkill.connect(caller).deductPoints(caller.address, 10, ethers.ZeroHash),
        ).to.be.revertedWithCustomError(proofSkill, "NotScorer");
      }
    });

    it("only the admin can wire, and never to the zero address", async function () {
      const [admin, outsider] = await ethers.getSigners();
      const fresh = await (await ethers.getContractFactory("ProofSkill")).deploy(admin.address, 0, "onCV", "");
      await expect(fresh.connect(outsider).wireSatellites(outsider.address, outsider.address)).to.be.revertedWithCustomError(
        fresh,
        "AccessControlUnauthorizedAccount",
      );
      await expect(fresh.wireSatellites(ethers.ZeroAddress, outsider.address)).to.be.revertedWithCustomError(
        fresh,
        "InvalidOrganizer",
      );
      await expect(fresh.awardPoints(admin.address, 10, ethers.ZeroHash)).to.be.revertedWithCustomError(fresh, "NotScorer");
    });
  });

  describe("createEvent", function () {
    it("stores the event and emits EventCreated", async function () {
      const { proofSkill, owner, qrSigner } = await loadFixture(deployFixture);
      await expect(
        proofSkill.createEvent(
          eventInput({
            name: "Avalanche Hackathon",
            durationHours: 16,
            lat: 41_015_137,
            long: 28_979_530,
            category: Category.Hackathon,
            skillTags: "Solidity,DeFi",
            checkInSigner: qrSigner.address,
            maxAttendees: 150,
          }),
        ),
      )
        .to.emit(proofSkill, "EventCreated")
        .withArgs(1n, owner.address, "Avalanche Hackathon", anyValue, qrSigner.address);

      const e = await getEventById(proofSkill, 1);
      expect(e.id).to.equal(1n);
      expect(e.name).to.equal("Avalanche Hackathon");
      expect(e.organizer).to.equal("onCV");
      expect(e.organizerVerified).to.equal(true);
      expect(e.durationHours).to.equal(16n);
      expect(e.isActive).to.equal(true);
      expect(e.lat).to.equal(41_015_137n);
      expect(e["long"]).to.equal(28_979_530n);
      expect(e.category).to.equal(BigInt(Category.Hackathon));
      expect(e.skillTags).to.equal("Solidity,DeFi");
      expect(e.creator).to.equal(owner.address);
      expect(e.checkInSigner).to.equal(qrSigner.address);
      expect(e.maxAttendees).to.equal(150n);
      expect(e.isOnline).to.equal(false);
      expect(await proofSkill.getOrganizerEvents(owner.address)).to.deep.equal([1n]);
    });

    it("validates input", async function () {
      const { proofSkill, qrSigner } = await loadFixture(deployFixture);
      const s = qrSigner.address;
      const reverts = (input, error) => expect(proofSkill.createEvent(eventInput(input))).to.be.revertedWithCustomError(proofSkill, error);
      await reverts({ name: "", checkInSigner: s }, "EmptyName");
      await reverts({ durationHours: 0, checkInSigner: s }, "InvalidDuration");
      await reverts({ durationHours: 24 * 30 + 1, checkInSigner: s }, "InvalidDuration");
      await reverts({ lat: 91_000_000, checkInSigner: s }, "InvalidCoordinates");
      await reverts({ long: -181_000_000, checkInSigner: s }, "InvalidCoordinates");
      await reverts({}, "InvalidSigner");
      await reverts({ name: "N".repeat(161), checkInSigner: s }, "TextTooLong");
      await reverts({ skillTags: "T".repeat(161), checkInSigner: s }, "TextTooLong");

      const now = BigInt(await time.latest());
      await reverts({ startTime: now - 3n * 3600n, durationHours: 1, checkInSigner: s }, "InvalidStartTime");
      await reverts({ startTime: now + 366n * 24n * 3600n, checkInSigner: s }, "InvalidStartTime");
    });

    it("limits back-dating to one hour, so old events cannot be recreated (C-4)", async function () {
      const { proofSkill, qrSigner } = await loadFixture(deployFixture);
      const now = BigInt(await time.latest());
      await expect(
        proofSkill.createEvent(eventInput({ startTime: now - 3000n, durationHours: 2, checkInSigner: qrSigner.address })),
      ).to.emit(proofSkill, "EventCreated");
      await expect(
        proofSkill.createEvent(eventInput({ startTime: now - 2n * 3600n, durationHours: 8, checkInSigner: qrSigner.address })),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidStartTime");
    });

    it("creates online events without coordinates (F-10)", async function () {
      const ctx = await loadFixture(deployFixture);
      const { proofSkill, qrSigner, alice } = ctx;
      await proofSkill.createEvent(
        eventInput({ name: "Online AMA", location: "Online", isOnline: true, lat: 999_000_000, long: 999_000_000, checkInSigner: qrSigner.address }),
      );
      const e = await getEventById(proofSkill, 1n);
      expect(e.isOnline).to.equal(true);
      expect(e.lat).to.equal(0n);
      expect(e["long"]).to.equal(0n);
      const code = await freshCode(ctx, qrSigner, 1n);
      await expect(proofSkill.connect(alice).checkIn(1n, code.codeWindow, code.signature)).to.emit(proofSkill, "AttendanceRecorded");
    });
  });

  describe("checkIn", function () {
    it("records attendance, adds 25 points and emits AttendanceRecorded", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, eventId } = ctx;
      const { codeWindow, signature } = await freshCode(ctx);

      const tx = proofSkill.connect(alice).checkIn(eventId, codeWindow, signature);
      await expect(tx).to.emit(proofSkill, "AttendanceRecorded").withArgs(alice.address, eventId, 25n, anyValue);
      const receipt = await (await tx).wait();

      expect(await proofSkill.getUserProofScore(alice.address)).to.equal(25n);
      expect(await proofSkill.hasAttended(alice.address, eventId)).to.equal(true);
      expect(await proofSkill.isValidAttendance(alice.address, eventId)).to.equal(true);
      expect(await proofSkill.validCredentialCount(alice.address)).to.equal(1n);
      expect(await proofSkill.getUserAttendedEvents(alice.address)).to.deep.equal([eventId]);
      const key = keccak256(encodePacked(["address", "uint256"], [alice.address, eventId]));
      expect(await proofSkill.attendanceKey(alice.address, eventId)).to.equal(key);
      const record = await proofSkill.attendanceRecords(key);
      expect(record.blockNumber).to.equal(BigInt(receipt.blockNumber));
      expect(record.revoked).to.equal(false);
      expect((await getEventById(proofSkill, eventId)).attendeeCount).to.equal(1n);
      expect(await proofSkill.totalCheckIns()).to.equal(1n);
    });

    it("computes the same message hash as the frontend", async function () {
      const ctx = await loadFixture(withEventFixture);
      const expected = messageHash(ctx.chainId, ctx.address, 1n, 123n);
      expect(await ctx.proofSkill.checkInMessageHash(1n, 123n)).to.equal(expected);
    });

    it("accumulates score across events and returns paginated credentials", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, qrSigner } = ctx;
      await proofSkill.createEvent(eventInput({ name: "AI x Web3", location: "Ankara", skillTags: "AI Engineering", checkInSigner: qrSigner.address }));

      const c1 = await freshCode(ctx, qrSigner, 1n);
      await proofSkill.connect(alice).checkIn(1n, c1.codeWindow, c1.signature);
      const c2 = await freshCode(ctx, qrSigner, 2n);
      const receipt = await (await proofSkill.connect(alice).checkIn(2n, c2.codeWindow, c2.signature)).wait();

      expect(await proofSkill.getUserProofScore(alice.address)).to.equal(50n);
      expect(await proofSkill.getUserEventCount(alice.address)).to.equal(2n);
      const [events, records] = await proofSkill.getUserCredentials(alice.address, 0, 100);
      expect(events.map((e) => e.name)).to.deep.equal(["Avalanche Solidity Bootcamp", "AI x Web3"]);
      expect(records[1].blockNumber).to.equal(BigInt(receipt.blockNumber));
      expect(records[1].revoked).to.equal(false);

      const [page] = await proofSkill.getUserCredentials(alice.address, 1, 1);
      expect(page.map((e) => e.name)).to.deep.equal(["AI x Web3"]);
      const [empty] = await proofSkill.getUserCredentials(alice.address, 5, 10);
      expect(empty.length).to.equal(0);
    });

    it("rejects a second check-in to the same event", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { codeWindow, signature } = await freshCode(ctx);
      await ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, codeWindow, signature);
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, codeWindow, signature),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "AlreadyCheckedIn");
    });

    it("accepts a fresh code even when simulated against an older block", async function () {
      const ctx = await loadFixture(withEventFixture);
      const codeWindow = (await currentWindow()) + 12n;
      const signature = await signCode(ctx.qrSigner, ctx.chainId, ctx.address, ctx.eventId, codeWindow);
      await expect(ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, codeWindow, signature)).to.emit(
        ctx.proofSkill,
        "AttendanceRecorded",
      );
    });

    it("rejects expired QR codes and accepts codes inside the TTL", async function () {
      const ctx = await loadFixture(withEventFixture);
      const fresh = await freshCode(ctx);
      await time.increase(90);
      await expect(ctx.proofSkill.connect(ctx.bob).checkIn(ctx.eventId, fresh.codeWindow, fresh.signature)).to.emit(
        ctx.proofSkill,
        "AttendanceRecorded",
      );
      await time.increase(60);
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, fresh.codeWindow, fresh.signature),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "CodeExpired");
    });

    it("rejects codes from the future", async function () {
      const ctx = await loadFixture(withEventFixture);
      const codeWindow = (await currentWindow()) + 40n; // 400 s ahead > MAX_CLOCK_SKEW (300 s)
      const signature = await signCode(ctx.qrSigner, ctx.chainId, ctx.address, ctx.eventId, codeWindow);
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, codeWindow, signature),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "CodeNotYetValid");
    });

    it("rejects codes signed by the wrong key, malformed signatures and codes for another event", async function () {
      const ctx = await loadFixture(withEventFixture);
      const forged = await freshCode(ctx, newAccount());
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, forged.codeWindow, forged.signature),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "InvalidCheckInCode");
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(ctx.eventId, forged.codeWindow, "0x1234"),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "InvalidCheckInCode");

      await ctx.proofSkill.createEvent(eventInput({ name: "Other", durationHours: 2, checkInSigner: ctx.qrSigner.address }));
      const codeForEvent1 = await freshCode(ctx, ctx.qrSigner, 1n);
      await expect(
        ctx.proofSkill.connect(ctx.alice).checkIn(2n, codeForEvent1.codeWindow, codeForEvent1.signature),
      ).to.be.revertedWithCustomError(ctx.proofSkill, "InvalidCheckInCode");
    });

    it("rejects unknown, inactive, not-yet-open and finished events", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, qrSigner } = ctx;

      await expect(proofSkill.connect(alice).checkIn(99n, 0n, "0x")).to.be.revertedWithCustomError(proofSkill, "EventNotFound");
      await expect(proofSkill.connect(alice).checkIn(0n, 0n, "0x")).to.be.revertedWithCustomError(proofSkill, "EventNotFound");

      await proofSkill.setEventActive(1n, false);
      let code = await freshCode(ctx);
      await expect(proofSkill.connect(alice).checkIn(1n, code.codeWindow, code.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "EventInactive",
      );
      await proofSkill.setEventActive(1n, true);

      const inTwoHours = BigInt(await time.latest()) + 2n * 3600n;
      await proofSkill.createEvent(eventInput({ name: "Later", startTime: inTwoHours, durationHours: 2, checkInSigner: qrSigner.address }));
      code = await freshCode(ctx, qrSigner, 2n);
      await expect(proofSkill.connect(alice).checkIn(2n, code.codeWindow, code.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "CheckInNotOpen",
      );

      await time.increase(9 * 3600);
      code = await freshCode(ctx, qrSigner, 1n);
      await expect(proofSkill.connect(alice).checkIn(1n, code.codeWindow, code.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "CheckInClosed",
      );
    });

    it("enforces the attendee cap (EventFull)", async function () {
      const ctx = await loadFixture(deployFixture);
      const { proofSkill, alice, bob, qrSigner } = ctx;
      await proofSkill.createEvent(eventInput({ maxAttendees: 1, checkInSigner: qrSigner.address }));
      const code = await freshCode(ctx, qrSigner, 1n);
      await proofSkill.connect(alice).checkIn(1n, code.codeWindow, code.signature);
      await expect(proofSkill.connect(bob).checkIn(1n, code.codeWindow, code.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "EventFull",
      );
      // A revoked seat frees a slot.
      await proofSkill.revokeCredential(alice.address, 1n, "Seat released");
      await expect(proofSkill.connect(bob).checkIn(1n, code.codeWindow, code.signature)).to.emit(proofSkill, "AttendanceRecorded");
    });

    it("lets the event creator rotate the QR signer and invalidates the old key", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, bob, outsider, eventId } = ctx;
      const newSigner = newAccount();

      await expect(proofSkill.connect(outsider).setCheckInSigner(eventId, newSigner.address)).to.be.revertedWithCustomError(
        proofSkill,
        "NotEventManager",
      );
      await expect(proofSkill.setCheckInSigner(eventId, ethers.ZeroAddress)).to.be.revertedWithCustomError(proofSkill, "InvalidSigner");
      await expect(proofSkill.setCheckInSigner(eventId, newSigner.address))
        .to.emit(proofSkill, "CheckInSignerUpdated")
        .withArgs(eventId, newSigner.address);

      const oldCode = await freshCode(ctx);
      await expect(proofSkill.connect(alice).checkIn(eventId, oldCode.codeWindow, oldCode.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "InvalidCheckInCode",
      );
      const newCode = await freshCode(ctx, newSigner);
      await expect(proofSkill.connect(bob).checkIn(eventId, newCode.codeWindow, newCode.signature)).to.emit(
        proofSkill,
        "AttendanceRecorded",
      );
    });

    it("still records the credential when the wallet rejects the token (HookFailed)", async function () {
      const ctx = await loadFixture(withEventFixture);
      const wallet = await (await ethers.getContractFactory("TestRejectingWallet")).deploy();
      const walletAddress = await wallet.getAddress();
      const { codeWindow, signature } = await freshCode(ctx);
      await expect(wallet.checkIn(ctx.address, ctx.eventId, codeWindow, signature))
        .to.emit(ctx.proofSkill, "HookFailed")
        .and.to.emit(ctx.proofSkill, "AttendanceRecorded");
      expect(await ctx.proofSkill.isValidAttendance(walletAddress, ctx.eventId)).to.equal(true);
      expect(await ctx.token.balanceOf(walletAddress, ctx.eventId)).to.equal(0n);
    });
  });

  describe("gasless check-in (EIP-712)", function () {
    async function signIntent(ctx, wallet, eventId, codeWindow, deadline, attendee = wallet.address) {
      return wallet.signTypedData(eip712Domain(ctx), CHECKIN_TYPES, { attendee, eventId, codeWindow, deadline });
    }

    it("lets a relayer submit an attendee's signed check-in", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, relayer, eventId } = ctx;
      const { codeWindow, signature } = await freshCode(ctx);
      const deadline = BigInt(await time.latest()) + 600n;
      const intent = await signIntent(ctx, alice, eventId, codeWindow, deadline);

      await expect(proofSkill.connect(relayer).checkInWithSig(alice.address, eventId, codeWindow, signature, deadline, intent))
        .to.emit(proofSkill, "AttendanceRecorded")
        .withArgs(alice.address, eventId, 25n, anyValue);
      expect(await proofSkill.getUserProofScore(alice.address)).to.equal(25n);
      expect(await proofSkill.getUserProofScore(relayer.address)).to.equal(0n);
      expect(await ctx.token.balanceOf(alice.address, eventId)).to.equal(1n);
    });

    it("rejects intents signed by someone else or past their deadline", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, bob, relayer, eventId } = ctx;
      const { codeWindow, signature } = await freshCode(ctx);
      const deadline = BigInt(await time.latest()) + 60n;
      const bobIntent = await signIntent(ctx, bob, eventId, codeWindow, deadline);
      await expect(
        proofSkill.connect(relayer).checkInWithSig(alice.address, eventId, codeWindow, signature, deadline, bobIntent),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidAttendeeSignature");

      const aliceIntent = await signIntent(ctx, alice, eventId, codeWindow, deadline);
      await time.increase(90);
      await expect(
        proofSkill.connect(relayer).checkInWithSig(alice.address, eventId, codeWindow, signature, deadline, aliceIntent),
      ).to.be.revertedWithCustomError(proofSkill, "SignatureExpired");
    });

    it("supports smart-account attendees through ERC-1271", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, relayer, eventId } = ctx;
      const wallet = await (await ethers.getContractFactory("TestSmartWallet")).deploy(alice.address);
      const walletAddress = await wallet.getAddress();
      const { codeWindow, signature } = await freshCode(ctx);
      const deadline = BigInt(await time.latest()) + 600n;
      const intent = await signIntent(ctx, alice, eventId, codeWindow, deadline, walletAddress);
      await expect(
        proofSkill.connect(relayer).checkInWithSig(walletAddress, eventId, codeWindow, signature, deadline, intent),
      ).to.emit(proofSkill, "AttendanceRecorded");
      expect(await ctx.token.balanceOf(walletAddress, eventId)).to.equal(1n);
    });
  });

  describe("kiosk check-in (K3)", function () {
    async function kioskSignatures(ctx, attendeeWallet, { eventId = ctx.eventId, deadline, kiosk = ctx.qrSigner } = {}) {
      const d = deadline ?? BigInt(await time.latest()) + 300n;
      const consent = await attendeeWallet.signTypedData(eip712Domain(ctx), KIOSK_CONSENT_TYPES, {
        attendee: attendeeWallet.address,
        deadline: d,
      });
      const attest = await kiosk.signTypedData({
        domain: eip712Domain(ctx),
        types: KIOSK_ATTEST_TYPES,
        primaryType: "KioskAttest",
        message: { eventId, attendee: attendeeWallet.address, deadline: d },
      });
      return { deadline: d, consent, attest };
    }

    it("records attendance when the attendee consented and the event's QR key attests the scan", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, relayer, eventId } = ctx;
      const { deadline, consent, attest } = await kioskSignatures(ctx, alice);
      await expect(proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, deadline, consent, attest))
        .to.emit(proofSkill, "AttendanceRecorded")
        .withArgs(alice.address, eventId, 25n, anyValue);
      expect(await ctx.token.balanceOf(alice.address, eventId)).to.equal(1n);
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, deadline, consent, attest),
      ).to.be.revertedWithCustomError(proofSkill, "AlreadyCheckedIn");
    });

    it("rejects a forged kiosk, a consent from someone else, stale and over-long deadlines", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, bob, relayer, eventId } = ctx;

      const forged = await kioskSignatures(ctx, alice, { kiosk: newAccount() });
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, forged.deadline, forged.consent, forged.attest),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidCheckInCode");

      const bobs = await kioskSignatures(ctx, bob);
      const alices = await kioskSignatures(ctx, alice, { deadline: bobs.deadline });
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, bobs.deadline, bobs.consent, alices.attest),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidAttendeeSignature");

      const long = await kioskSignatures(ctx, alice, { deadline: BigInt(await time.latest()) + 3600n });
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, long.deadline, long.consent, long.attest),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidDeadline");

      const ok = await kioskSignatures(ctx, alice);
      await time.increase(400);
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(eventId, alice.address, ok.deadline, ok.consent, ok.attest),
      ).to.be.revertedWithCustomError(proofSkill, "SignatureExpired");
    });

    it("binds the attestation to one event", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, relayer, qrSigner } = ctx;
      await proofSkill.createEvent(eventInput({ name: "Other", checkInSigner: qrSigner.address }));
      const sigs = await kioskSignatures(ctx, alice, { eventId: 1n });
      await expect(
        proofSkill.connect(relayer).checkInViaKiosk(2n, alice.address, sigs.deadline, sigs.consent, sigs.attest),
      ).to.be.revertedWithCustomError(proofSkill, "InvalidCheckInCode");
    });
  });

  describe("revocation", function () {
    it("lets the organizer revoke a credential, removing its score, count and token", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, token, owner, alice, eventId } = ctx;
      const { codeWindow, signature } = await freshCode(ctx);
      await proofSkill.connect(alice).checkIn(eventId, codeWindow, signature);
      expect(await token.balanceOf(alice.address, eventId)).to.equal(1n);

      await expect(proofSkill.revokeCredential(alice.address, eventId, "Checked in remotely"))
        .to.emit(proofSkill, "CredentialRevoked")
        .withArgs(alice.address, eventId, owner.address, "Checked in remotely");
      expect(await proofSkill.getUserProofScore(alice.address)).to.equal(0n);
      expect(await proofSkill.isValidAttendance(alice.address, eventId)).to.equal(false);
      expect(await proofSkill.hasAttended(alice.address, eventId)).to.equal(true);
      expect(await proofSkill.validCredentialCount(alice.address)).to.equal(0n);
      expect(await proofSkill.totalCheckIns()).to.equal(0n);
      expect(await token.balanceOf(alice.address, eventId)).to.equal(0n);
      expect((await getEventById(proofSkill, eventId)).attendeeCount).to.equal(0n);
      const [, records] = await proofSkill.getUserCredentials(alice.address, 0, 10);
      expect(records[0].revoked).to.equal(true);
      const [attendees, attendeeRecords] = await proofSkill.getEventAttendees(eventId, 0, 10);
      expect(attendees).to.deep.equal([alice.address]);
      expect(attendeeRecords[0].revoked).to.equal(true);

      await expect(proofSkill.revokeCredential(alice.address, eventId, "")).to.be.revertedWithCustomError(proofSkill, "AlreadyRevoked");
      const again = await freshCode(ctx);
      await expect(proofSkill.connect(alice).checkIn(eventId, again.codeWindow, again.signature)).to.be.revertedWithCustomError(
        proofSkill,
        "AlreadyCheckedIn",
      );
    });

    it("only the event manager can revoke, only existing credentials, with a bounded reason", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, outsider, eventId } = ctx;
      await expect(proofSkill.revokeCredential(alice.address, eventId, "")).to.be.revertedWithCustomError(
        proofSkill,
        "CredentialNotFound",
      );
      const { codeWindow, signature } = await freshCode(ctx);
      await proofSkill.connect(alice).checkIn(eventId, codeWindow, signature);
      await expect(proofSkill.connect(outsider).revokeCredential(alice.address, eventId, "")).to.be.revertedWithCustomError(
        proofSkill,
        "NotEventManager",
      );
      await expect(proofSkill.revokeCredential(alice.address, eventId, "R".repeat(161))).to.be.revertedWithCustomError(
        proofSkill,
        "TextTooLong",
      );
    });
  });

  describe("pagination (L4 / L5)", function () {
    it("pages the latest events newest first and caps page sizes", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, qrSigner } = ctx;
      for (let i = 0; i < 4; i++) await proofSkill.createEvent(eventInput({ name: `E${i + 2}`, checkInSigner: qrSigner.address }));

      expect((await proofSkill.getLatestEvents(0, 3)).map((e) => e.id)).to.deep.equal([5n, 4n, 3n]);
      expect((await proofSkill.getLatestEvents(3, 3)).map((e) => e.id)).to.deep.equal([2n, 1n]);
      expect((await proofSkill.getLatestEvents(5, 3)).length).to.equal(0);
      expect((await proofSkill.getLatestEvents(0, 10_000)).length).to.equal(5);

      await expect(proofSkill.getEvents(Array.from({ length: 101 }, () => 1n))).to.be.revertedWithCustomError(
        proofSkill,
        "PageTooLarge",
      );
      expect((await proofSkill.getEvents([1n, 5n])).map((e) => e.name)).to.deep.equal(["Avalanche Solidity Bootcamp", "E5"]);
    });

    it("pages event attendees", async function () {
      const ctx = await loadFixture(withEventFixture);
      const { proofSkill, alice, bob, outsider, eventId } = ctx;
      const code = await freshCode(ctx);
      for (const s of [alice, bob, outsider]) await proofSkill.connect(s).checkIn(eventId, code.codeWindow, code.signature);

      expect(await proofSkill.getEventAttendeeCount(eventId)).to.equal(3n);
      const [first] = await proofSkill.getEventAttendees(eventId, 0, 2);
      expect(first).to.deep.equal([alice.address, bob.address]);
      const [rest] = await proofSkill.getEventAttendees(eventId, 2, 2);
      expect(rest).to.deep.equal([outsider.address]);
      const [none] = await proofSkill.getEventAttendees(eventId, 3, 2);
      expect(none.length).to.equal(0);
    });
  });
});
