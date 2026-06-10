/**
 * Formats a WhatsApp JID or raw number into a conventional, readable phone number format.
 * Supports Nigerian (+234), US/Canada (+1), and general international formats.
 * Keeps LID strings clearly identified.
 * 
 * @param jid The WhatsApp JID (e.g., "2348033130603@s.whatsapp.net") or raw phone number string
 */
// Mapping dictionary of raw LID JIDs to their real, readable phone numbers (fallback hardcoded)
const LID_TO_PHONE: Record<string, string> = {
  '180740897673374': '08033130603',
};

// Dynamically populated cache that links LID identifiers to their real phone numbers
export const LID_TO_PHONE_CACHE = new Map<string, string>();

export function formatWhatsappNumber(jid: string): string {
  if (!jid) return '';

  // Extract the raw number part before '@'
  const [raw, domain] = jid.split('@');
  let cleanNumber = raw.trim();
  let resolvedDomain = domain;

  // Resolve JID from dynamic group sync cache first, then fallback to static hardcoded dictionary
  if (LID_TO_PHONE_CACHE.has(cleanNumber)) {
    cleanNumber = LID_TO_PHONE_CACHE.get(cleanNumber)!;
    resolvedDomain = 's.whatsapp.net';
  } else if (LID_TO_PHONE[cleanNumber]) {
    cleanNumber = LID_TO_PHONE[cleanNumber];
    resolvedDomain = 's.whatsapp.net';
  }

  // If it is a LID (internal WhatsApp private identifier)
  if (resolvedDomain === 'lid') {
    return `LID: ${cleanNumber}`;
  }

  // Check if it is a pure numeric string (phone number JID)
  if (/^\d+$/.test(cleanNumber)) {
    // 1. Nigerian Number (e.g. 2348033130603 -> +234 803 313 0603)
    if (cleanNumber.startsWith('234') && cleanNumber.length === 13) {
      return `+234 ${cleanNumber.slice(3, 6)} ${cleanNumber.slice(6, 9)} ${cleanNumber.slice(9)}`;
    }
    // 2. US/Canada Number (e.g. 15551234567 -> +1 (555) 123-4567)
    if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
      return `+1 (${cleanNumber.slice(1, 4)}) ${cleanNumber.slice(4, 7)}-${cleanNumber.slice(7)}`;
    }
    // 3. UK Number (e.g. 447123456789 -> +44 7123 456789)
    if (cleanNumber.startsWith('44') && cleanNumber.length === 12) {
      return `+44 ${cleanNumber.slice(2, 6)} ${cleanNumber.slice(6)}`;
    }
    // 4. Local Nigerian Number (e.g. 08033130603 -> +234 803 313 0603)
    if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
      return `+234 ${cleanNumber.slice(1, 4)} ${cleanNumber.slice(4, 7)} ${cleanNumber.slice(7)}`;
    }

    // Default fallback for general numbers
    return `+${cleanNumber}`;
  }

  return cleanNumber;
}
