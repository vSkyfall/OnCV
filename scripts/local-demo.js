/**
 * Local demo setup: deploys onCV to the local demo chain and prepares three test wallets you can import into
 * your browser wallet (MetaMask recommended for local testing).
 *
 *   Terminal 1:  npm run demo:node      (keep it open)
 *   Terminal 2:  npm run demo:setup     then restart `npm run dev`
 *
 * Wallets (keys kept in .demo-wallets.local.json and written to DEMO-WALLETS.local.md, both gitignored):
 *   - Kurum / Admin : onCV admin + verified organizer  -> Enterprise Portal, create events, dynamic QR
 *   - Katilimci     : attendee with two demo credentials and a registered project -> Web3 CV, check-in
 *   - Yatirimci     : verified investor -> attests "Yatirim aldi" (funded) project updates
 * Each gets 100 demo AVAX on the local chain. These keys are for this local chain only.
 *
 * Also writes .env.development.local so `npm run dev` reads the local chain and relays gasless check-ins.
 * To go back to Fuji: delete .env.development.local and run `npm run deploy:fuji`.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const hre = require("hardhat");

const ROOT = path.join(__dirname, "..");
const WALLETS_FILE = path.join(ROOT, ".demo-wallets.local.json");
const WALLETS_DOC = path.join(ROOT, "DEMO-WALLETS.local.md");
const ENV_FILE = path.join(ROOT, ".env.development.local");
const ENV_MARKER = "# onCV local demo (npm run demo:setup)";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const FUJI_PUBLIC_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
// Hardhat's built-in account #5: a publicly known test key, used only as the local gas relayer.
const LOCAL_RELAYER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const DEMO_BALANCE = "0x56BC75E2D63100000"; // 100 AVAX

function loadOrCreateWallets(ethers) {
  if (fs.existsSync(WALLETS_FILE)) return JSON.parse(fs.readFileSync(WALLETS_FILE, "utf8"));
  const make = () => ethers.Wallet.createRandom().privateKey;
  const wallets = { kurum: make(), katilimci: make(), yatirimci: make() };
  fs.writeFileSync(WALLETS_FILE, `${JSON.stringify(wallets, null, 2)}\n`, "utf8");
  return wallets;
}

async function copyMulticall(ethers) {
  if ((await ethers.provider.getCode(MULTICALL3)) !== "0x") return;
  const res = await fetch(FUJI_PUBLIC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [MULTICALL3, "latest"] }),
  });
  const { result } = await res.json();
  if (!result || result === "0x") throw new Error("Multicall3 bytecode could not be fetched from Fuji (internet needed once).");
  await ethers.provider.send("hardhat_setCode", [MULTICALL3, result]);
}

function writeEnvFile() {
  if (fs.existsSync(ENV_FILE) && !fs.readFileSync(ENV_FILE, "utf8").startsWith(ENV_MARKER)) {
    console.warn(`  ! ${path.basename(ENV_FILE)} exists and was not created by this script; not overwritten.`);
    console.warn("    Add NEXT_PUBLIC_FUJI_RPC_URL=http://127.0.0.1:8545 and the relayer settings yourself.");
    return;
  }
  const lines = [
    ENV_MARKER,
    "# Points the dApp at the local demo chain. Delete this file to use Avalanche Fuji again.",
    "NEXT_PUBLIC_FUJI_RPC_URL=http://127.0.0.1:8545",
    "NEXT_PUBLIC_GASLESS_CHECKIN=true",
    "# Hardhat test account #5 (public test key), pays gas for gasless check-ins on the local chain only.",
    `RELAYER_PRIVATE_KEY=${LOCAL_RELAYER_KEY}`,
    "",
  ];
  fs.writeFileSync(ENV_FILE, lines.join("\n"), "utf8");
}

function writeWalletDoc(entries, deployment) {
  const rows = entries
    .map((w) => `### ${w.title}\n\n- Adres: \`${w.address}\`\n- Private key: \`${w.key}\`\n- Rol: ${w.role}\n`)
    .join("\n");
  const doc = `# onCV yerel demo cüzdanları

> Bu anahtarlar **yalnızca yerel demo zinciri** içindir (http://127.0.0.1:8545). Gerçek bir ağda kullanmayın,
> bu cüzdanlara gerçek varlık göndermeyin. Dosya .gitignore'dadır; paylaşmayın.

## 1. Cüzdanınıza ağı ekleyin

| Alan | Değer |
| --- | --- |
| Ağ adı | onCV Local (Fuji) |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 43113 |
| Para birimi | AVAX |

MetaMask'ta "Avalanche Fuji" zaten ekliyse: Ayarlar → Ağlar → Avalanche Fuji → RPC URL → **RPC URL ekle**
(http://127.0.0.1:8545) ve onu seçin. Demo bitince tekrar herkese açık Fuji RPC'sini seçin.

## 2. Hesapları içe aktarın

Cüzdan → Hesap ekle → **Private key ile içe aktar** → aşağıdaki anahtarlardan birini yapıştırın.
Her biri yerel zincirde 100 AVAX ile gelir.

${rows}
## 3. Neyi deneyebilirsiniz

1. **Kurum / Admin** ile http://localhost:3000 → sağ üstte **Enterprise Portal** → etkinlik oluşturun
   ("Konumumu kullan" ya da "Online etkinlik" işaretleyin) → dinamik QR → **Test linki**.
2. Cüzdanda **Katılımcı** hesabına geçin → test linkini açın → **Claim & Verify Attendance** (gassız: sadece imza).
3. **Web3 CV**: Katılımcı'nın iki hazır kaydı ve "Demo Projesi" görünür.
4. **Projeler** → Demo Projesi → Katılımcı olarak durum girin ("Hâlâ aktif" / "Yatırım aldı") →
   Kurum hesabıyla "Hâlâ aktif"i, **Yatırımcı** hesabıyla "Yatırım aldı"yı onaylayın.
5. Admin araçları (Enterprise Portal'ın altında): tüm etkinlikler, kayıt iptali, yatırımcı ve organizatör yönetimi.
6. Doğrulanmamış bir hesapla (ör. yeni bir hesap) Enterprise Portal → "Kurumsal doğrulama gereklidir" ekranı.

Kontrol noktası aralığı demo için 120 saniyedir: 1 saatlik bir etkinlikte "3. ay" penceresi etkinlik bittikten ~1 dk
sonra açılır.

## Tekrar başlatma

Yerel zincir terminal kapanınca sıfırlanır. Tekrar: \`npm run demo:node\` (açık kalsın) → \`npm run demo:setup\` →
\`npm run dev\`'i yeniden başlatın. Cüzdanlar aynı kalır; cüzdandaki "nonce"u sıfırlamak gerekebilir
(MetaMask: Ayarlar → Gelişmiş → Hesap etkinliğini temizle).

Kontratlar: ProofSkill \`${deployment.address}\` · ProjectRegistry \`${deployment.projectRegistry}\` ·
OnCVCredential \`${deployment.credential}\`
`;
  fs.writeFileSync(WALLETS_DOC, doc, "utf8");
}

async function main() {
  const { ethers } = hre;
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 43113n) {
    throw new Error("Local demo chain not found. Start it first with `npm run demo:node` (chain id 43113).");
  }

  const keys = loadOrCreateWallets(ethers);
  const kurum = new ethers.Wallet(keys.kurum, ethers.provider);
  const katilimci = new ethers.Wallet(keys.katilimci, ethers.provider);
  const yatirimci = new ethers.Wallet(keys.yatirimci, ethers.provider);
  for (const w of [kurum, katilimci, yatirimci]) {
    await ethers.provider.send("hardhat_setBalance", [w.address, DEMO_BALANCE]);
  }
  await copyMulticall(ethers);

  console.log("\n  Deploying onCV to the local demo chain...");
  execSync("npx hardhat run scripts/deploy.js --network localhost", {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      CHECKPOINT_INTERVAL_SECONDS: "120",
      ADMIN_TRANSFER_DELAY_SECONDS: "0",
      ADMIN_ORG_NAME: "onCV",
      ADMIN_ORG_DOMAIN: "oncv.xyz",
      ORGANIZER_ADDRESSES: "",
    },
  });
  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "deployment.json"), "utf8"));
  const [deployer, seedOrganizer] = await ethers.getSigners();
  const skill = await ethers.getContractAt("ProofSkill", deployment.address);
  const registry = await ethers.getContractAt("ProjectRegistry", deployment.projectRegistry);
  const wait = async (tx) => (await tx).wait();

  // Roles (the deployer is still admin here; admin is handed to the Kurum wallet at the end).
  await wait(skill.addOrganizer(kurum.address, "onCV Demo Kurumu", "oncv.xyz"));
  await wait(skill.addOrganizer(seedOrganizer.address, "Team1 Türkiye", "team1.network"));
  await wait(registry.addInvestor(yatirimci.address, "Demo Ventures", "https://oncv.xyz"));

  // Sample credentials so the Web3 CV and project pages are not empty.
  const qr = ethers.Wallet.createRandom();
  const base = { startTime: 0, checkInSigner: qr.address, maxAttendees: 0 };
  await wait(
    skill.connect(seedOrganizer).createEvent({
      ...base,
      name: "Avalanche Build Games İstanbul",
      location: "İTÜ Arı Teknokent, İstanbul",
      durationHours: 48,
      lat: 41104530,
      long: 29022690,
      category: 1,
      skillTags: "Solidity,Avalanche,DeFi",
      isOnline: false,
    }),
  );
  await wait(
    skill.connect(seedOrganizer).createEvent({
      ...base,
      name: "Online Solidity AMA",
      location: "Discord Stage",
      durationHours: 6,
      lat: 0,
      long: 0,
      category: 3,
      skillTags: "Solidity,Smart Contract Security",
      isOnline: true,
    }),
  );
  const eventCount = await skill.eventCount();
  const firstSeedEvent = eventCount - 1n;
  for (const eventId of [firstSeedEvent, eventCount]) {
    const codeWindow = BigInt(Math.floor(Date.now() / 10000));
    const hash = await skill.checkInMessageHash(eventId, codeWindow);
    const signature = await qr.signMessage(ethers.getBytes(hash));
    await wait(skill.connect(katilimci).checkIn(eventId, codeWindow, signature));
  }
  await wait(
    registry.connect(katilimci).registerProject({
      eventId: firstSeedEvent,
      title: "Demo Projesi",
      pitch: "Etkinlik katılımlarını doğrulanmış yetkinlik sinyaline çeviren küçük bir araç.",
      url: "https://oncv.xyz",
      invitees: [],
    }),
  );

  // Hand the admin role to the Kurum wallet (two-step transfer, zero delay on the demo chain).
  await wait(skill.connect(deployer).beginDefaultAdminTransfer(kurum.address));
  await ethers.provider.send("evm_mine", []);
  await wait(skill.connect(kurum).acceptDefaultAdminTransfer());

  writeEnvFile();
  const entries = [
    { title: "Kurum / Admin", address: kurum.address, key: keys.kurum, role: "onCV admini + doğrulanmış organizatör (\"onCV Demo Kurumu\"). Enterprise Portal, etkinlik ve QR, admin konsolu." },
    { title: "Katılımcı", address: katilimci.address, key: keys.katilimci, role: "İki hazır katılım kaydı ve \"Demo Projesi\"nin sahibi. Web3 CV, check-in, proje güncelleme." },
    { title: "Yatırımcı", address: yatirimci.address, key: keys.yatirimci, role: "Doğrulanmış yatırımcı (\"Demo Ventures\"). \"Yatırım aldı\" beyanlarını onaylar." },
  ];
  writeWalletDoc(entries, deployment);

  console.log("\n  Local demo ready");
  console.log("  ----------------");
  for (const e of entries) console.log(`  ${e.title.padEnd(14)} ${e.address}`);
  console.log(`\n  Private keys and wallet setup: ${path.basename(WALLETS_DOC)} (gitignored)`);
  console.log("  Restart `npm run dev`, then open http://localhost:3000\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
