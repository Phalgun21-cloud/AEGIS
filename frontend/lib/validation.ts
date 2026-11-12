/**
 * Centralized Validation Rules & Helpers for AEGIS
 * Enforces strict minimum and maximum lengths, whitespace trimming,
 * duplicate space prevention, and field-specific format validation.
 */

export type ValidationRule = {
  min: number;
  max: number;
  label: string;
  pattern?: RegExp;
  patternMessage?: string;
};

export const VALIDATION_RULES: Record<string, ValidationRule> = {
  user_name: { min: 2, max: 50, label: "User name" },
  full_name: { min: 2, max: 100, label: "Full name" },
  subject_name: { min: 2, max: 80, label: "Subject name" },
  exam_title: { min: 5, max: 120, label: "Examination title" },
  topic_name: { min: 2, max: 80, label: "Topic name" },
  question_text: { min: 10, max: 2000, label: "Question text" },
  question_option: { min: 1, max: 500, label: "Question option" },
  short_description: { min: 10, max: 300, label: "Short description" },
  long_description: { min: 20, max: 2000, label: "Long description / Instructions" },
  email: {
    min: 5,
    max: 254,
    label: "Email address",
    pattern: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
    patternMessage: "Please enter a valid RFC-compliant email address.",
  },
  username: { min: 3, max: 30, label: "Username" },
  password: { min: 8, max: 15, label: "Password" }, // bcrypt safety limit
  rejection_reason: { min: 5, max: 500, label: "Rejection reason" },
};

/**
 * Sanitizes input text: trims leading and trailing whitespace,
 * and collapses consecutive internal whitespace into single spaces.
 */
export function sanitizeText(text: string): string {
  if (!text) return "";
  return text.trim().replace(/[ \t\r\f\v]+/g, " ");
}

export type ValidationResult = {
  isValid: boolean;
  error: string | null;
  sanitized: string;
  charCount: number;
  min: number;
  max: number;
};

/**
 * Validates a text field against centralized rules.
 */
export function validateField(
  ruleKey: keyof typeof VALIDATION_RULES,
  rawValue: string,
  required: boolean = true
): ValidationResult {
  const rule = VALIDATION_RULES[ruleKey] || { min: 1, max: 1000, label: "Field" };
  const sanitized = sanitizeText(rawValue);
  const charCount = sanitized.length;

  if (required && charCount === 0) {
    return {
      isValid: false,
      error: `${rule.label} is required and cannot be empty or whitespace only.`,
      sanitized,
      charCount,
      min: rule.min,
      max: rule.max,
    };
  }

  if (!required && charCount === 0) {
    return {
      isValid: true,
      error: null,
      sanitized,
      charCount: 0,
      min: rule.min,
      max: rule.max,
    };
  }

  if (charCount < rule.min) {
    return {
      isValid: false,
      error: `${rule.label} must be at least ${rule.min} characters (currently ${charCount}).`,
      sanitized,
      charCount,
      min: rule.min,
      max: rule.max,
    };
  }

  if (charCount > rule.max) {
    return {
      isValid: false,
      error: `${rule.label} cannot exceed ${rule.max} characters (currently ${charCount}).`,
      sanitized,
      charCount,
      min: rule.min,
      max: rule.max,
    };
  }

  if (rule.pattern && !rule.pattern.test(sanitized)) {
    return {
      isValid: false,
      error: rule.patternMessage || `${rule.label} format is invalid.`,
      sanitized,
      charCount,
      min: rule.min,
      max: rule.max,
    };
  }

  return {
    isValid: true,
    error: null,
    sanitized,
    charCount,
    min: rule.min,
    max: rule.max,
  };
}

/**
 * Validates scheduling times:
 * 1. Start time must be at least 30 minutes in the future.
 * 2. End time must be strictly after start time.
 * 3. Duration must be positive.
 */
export function validateExamSchedule(
  startAtIso: string,
  endAtIso: string,
  durationMinutes: number
): { isValid: boolean; error: string | null } {
  if (!startAtIso) return { isValid: false, error: "Scheduled start date and time is required." };
  if (!endAtIso) return { isValid: false, error: "Scheduled end date and time is required." };

  const now = Date.now();
  const startTime = new Date(startAtIso).getTime();
  const endTime = new Date(endAtIso).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return { isValid: false, error: "Invalid date or time format provided." };
  }

  // 30-minute strict scheduling requirement
  const minPermittedStart = now + 30 * 60 * 1000;
  if (startTime < minPermittedStart) {
    const earliestTimeStr = new Date(minPermittedStart).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      isValid: false,
      error: `Strict Scheduling Rule: Examinations must be scheduled at least 30 minutes in advance. Earliest permitted start time is ${earliestTimeStr}.`,
    };
  }

  if (endTime <= startTime) {
    return {
      isValid: false,
      error: "Scheduled end time must be strictly later than scheduled start time.",
    };
  }

  const windowMinutes = Math.round((endTime - startTime) / 60000);
  if (durationMinutes <= 0) {
    return { isValid: false, error: "Examination duration must be a positive number of minutes." };
  }

  if (windowMinutes < durationMinutes) {
    return {
      isValid: false,
      error: `Availability window (${windowMinutes} min) must be at least as long as examination duration (${durationMinutes} min).`,
    };
  }

  return { isValid: true, error: null };
}

export type PasswordStrength = {
  score: number; // 0 to 4
  label: "Too Short" | "Weak" | "Fair" | "Good" | "Strong";
  hasMinLen: boolean;
  hasMaxLen: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
};

export function checkPasswordStrength(password: string): PasswordStrength {
  const hasMinLen = password.length >= 8;
  const hasMaxLen = password.length <= 15;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  let criteriaMet = 0;
  if (hasMinLen && hasMaxLen) criteriaMet++;
  if (hasUpper && hasLower) criteriaMet++;
  if (hasNumber) criteriaMet++;
  if (hasSpecial) criteriaMet++;

  let label: PasswordStrength["label"] = "Weak";
  if (password.length < 8) label = "Too Short";
  else if (criteriaMet <= 1) label = "Weak";
  else if (criteriaMet === 2) label = "Fair";
  else if (criteriaMet === 3) label = "Good";
  else if (criteriaMet >= 4) label = "Strong";

  return {
    score: criteriaMet,
    label,
    hasMinLen,
    hasMaxLen,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
  };
}


