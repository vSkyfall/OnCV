import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const CONTRACT_ERRORS: Record<string, string> = {
  InvalidOrganizer: "Geçersiz organizatör adresi.",
  OrganizerNotVerified: "Bu etkinliğin organizatörünün doğrulaması kaldırılmış; check-in kabul edilmiyor.",
  NotEventManager: "Bu etkinliği yalnızca doğrulanmış organizatörü veya bir admin yönetebilir.",
  EventNotFound: "Etkinlik bulunamadı.",
  EventInactive: "Bu etkinlik check-in'e kapatılmış.",
  CheckInNotOpen: "Check-in henüz açılmadı (etkinlikten 1 saat önce açılır).",
  CheckInClosed: "Etkinlik sona erdi, check-in kapandı.",
  CodeExpired: "QR kodunun süresi doldu. Organizatör ekranındaki güncel kodu tekrar okutun.",
  CodeNotYetValid: "QR kodu geçersiz bir zaman içeriyor. Cihaz saatini kontrol edin.",
  InvalidCheckInCode: "QR imzası geçersiz. Organizatör ekranındaki güncel kodu okutun.",
  AlreadyCheckedIn: "Bu etkinliğe katılımınız zaten doğrulanmış.",
  EmptyName: "Etkinlik adı boş olamaz.",
  TextTooLong: "Metin alanları en fazla 160 karakter olabilir.",
  InvalidDuration: "Süre 1 ile 720 saat arasında olmalı.",
  InvalidStartTime: "Başlangıç en fazla 1 saat geçmişte veya 1 yıl sonrasında olabilir.",
  EventFull: "Etkinlik kontenjanı doldu.",
  InvalidDeadline: "Kiosk kodunun geçerlilik süresi çok uzun. Kişisel QR'ı yenileyip tekrar okutun.",
  NotScorer: "Puanlar yalnızca proje kaydı kontratı tarafından verilebilir.",
  AlreadyWired: "Kontrat bağlantıları zaten yapılmış (tek seferlik).",
  InvalidPoints: "Geçersiz puan miktarı.",
  AccessControlEnforcedDefaultAdminRules: "Admin yetkisi yalnızca iki adımlı devir ile değiştirilebilir.",
  AccessControlEnforcedDefaultAdminDelay: "Admin devri için bekleme süresi henüz dolmadı.",
  InvalidCoordinates: "Koordinatlar geçersiz (enlem ±90, boylam ±180).",
  InvalidSigner: "QR imza anahtarı geçersiz.",
  EventAlreadyEnded: "Etkinliğin bitiş zamanı geçmişte kalıyor.",
  AccessControlUnauthorizedAccount: "Bu işlem yalnızca onCV admin yetkisiyle yapılabilir.",
  SignatureExpired: "Onay imzasının süresi doldu. Tekrar deneyin.",
  InvalidAttendeeSignature: "Cüzdan imzası doğrulanamadı.",
  CredentialNotFound: "Bu adres için etkinlik kaydı bulunamadı.",
  AlreadyRevoked: "Bu kayıt zaten iptal edilmiş.",
  PageTooLarge: "İstek çok büyük.",
  // ProjectRegistry
  NotAdmin: "Bu işlem yalnızca onCV admin yetkisiyle yapılabilir.",
  ProjectNotFound: "Proje bulunamadı.",
  RegistrationClosed: "Proje kaydı kapalı (etkinlik bitiminden sonra 7 gün açık kalır).",
  NotAttendee: "Proje kaydı için bu etkinliğe geçerli bir katılımınız olmalı.",
  InvalidInput: "Form alanlarını kontrol edin.",
  TeamTooLarge: "Takım ve bekleyen davetler toplamda en fazla 5 kişi olabilir.",
  InviteeNotAttendee: "Davet edilen adreslerden biri bu etkinliğe katılmamış.",
  AlreadyInProject: "Bu kişi bu etkinlikte zaten bir projede.",
  AlreadyInvited: "Bu kişi zaten davet edilmiş.",
  NotInvited: "Bu proje için bekleyen bir davetiniz yok.",
  NotProjectOwner: "Bu işlemi yalnızca proje sahibi yapabilir.",
  NotTeamMember: "Sahiplik yalnızca bir takım üyesine devredilebilir.",
  InvalidStage: "Geçersiz durum.",
  ProjectClosed: "Proje kapanmış.",
  TooManyUpdates: "Bu proje için güncelleme sınırına ulaşıldı.",
  UpdateNotFound: "Güncelleme bulunamadı.",
  AlreadyAttested: "Bu güncelleme zaten onaylanmış.",
  NotAttester:
    "Bu güncellemeyi onaylama yetkiniz yok. 'Yatırım aldı' yalnızca doğrulanmış yatırımcı veya admin; diğer durumlar etkinliğin organizatörü tarafından da onaylanabilir. Takım üyeleri kendi projesini onaylayamaz.",
  InvalidCheckpoint: "Geçersiz kontrol noktası.",
  NotProofSkill: "Bu çağrı yalnızca onCV kayıt kontratından yapılabilir.",
  // OnCVCredential
  Soulbound: "onCV kredansiyelleri devredilemez.",
  Unauthorized: "Bu işlem için yetkiniz yok.",
  NoCredential: "Bu adres için geçerli bir kredansiyel yok.",
};

/** UI copy for a custom error name (e.g. returned by the relayer API). */
export function contractErrorMessage(errorName: string | undefined, fallback: string): string {
  return (errorName && CONTRACT_ERRORS[errorName]) || fallback;
}

/** Plain `require` reasons from the contract, mapped to UI copy. */
const REVERT_REASONS: Record<string, string> = {
  "Unauthorized: Not a verified organizer":
    "Unauthorized: Not a verified organizer. Etkinlik oluşturmak için organizatör doğrulaması gerekir.",
};

export function parseWeb3Error(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "İşlem cüzdanda reddedildi.";
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (reverted.reason) return REVERT_REASONS[reverted.reason] ?? reverted.reason;
    }
    const details = `${error.shortMessage} ${error.details ?? ""}`.toLowerCase();
    if (details.includes("insufficient funds")) {
      return "Yetersiz AVAX bakiyesi. Fuji faucet'ten ücretsiz test AVAX alın.";
    }
    return error.shortMessage;
  }
  if (error && typeof error === "object") {
    const { code, shortMessage, message } = error as { code?: number; shortMessage?: string; message?: string };
    if (code === 4001) return "İşlem cüzdanda reddedildi.";
    if (shortMessage) return shortMessage;
    if (message) return message.split("\n")[0];
  }
  return "Beklenmeyen bir hata oluştu.";
}
