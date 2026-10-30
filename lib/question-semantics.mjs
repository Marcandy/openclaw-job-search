export function isConsentQuestion(q) {
  if (q.kind === 'consent') return true;
  const label = String(q.label ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  // A technical narrative about consent is not consent by the applicant.
  // Never soften a direct legal/permission request, even inside a long prompt.
  if (
    /\b(?:do you|I)\s+(?:hereby\s+)?(?:agree|consent|authorize|acknowledge|certify|attest)\b|\b(?:by submitting|you agree|consent to|agree to|terms and conditions|arbitration|background check)\b/i.test(
      label,
    )
  )
    return true;
  if (
    ['text', 'textarea'].includes(q.type) &&
    /^(?:describe|explain|tell us|for the following)/i.test(label)
  )
    return false;
  return /consent|background check|recording|arbitration|agree to|terms and conditions|privacy policy|certify|attest|acknowledge/i.test(
    label,
  );
}
