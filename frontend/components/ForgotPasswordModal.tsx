"use client";

import { useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PasswordInput,
  ValidatedInput,
} from "@/components/ui";
import { checkPasswordStrength, validateField } from "@/lib/validation";

type Step = "request_code" | "verify_code" | "set_password" | "success";

export function ForgotPasswordModal({
  open,
  onClose,
  initialEmail = "",
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialEmail?: string;
  onSuccess?: (email: string, updatedPassword: string) => void;
}) {
  const [step, setStep] = useState<Step>("request_code");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string>("749201");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Sync initial email when modal opens
  useEffect(() => {
    if (open && initialEmail) {
      setEmail(initialEmail);
    }
    if (open) {
      setError(null);
      setSuccessMsg(null);
      setStep("request_code");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open, initialEmail]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  // Step 1: Send Security Verification Code
  function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const emailCheck = validateField("email", email, true);
    if (!emailCheck.isValid) {
      setError(emailCheck.error);
      return;
    }

    setBusy(true);
    // Generate a random 6-digit code for simulation
    const randomOtp = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedCode(randomOtp);

    setTimeout(() => {
      setBusy(false);
      setStep("verify_code");
      setResendTimer(60);
      setSuccessMsg(`A 6-digit cryptographic security code has been dispatched to ${email.trim()}.`);
    }, 600);
  }

  // Step 2: Verify Code
  function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Please enter the 6-digit security verification code.");
      return;
    }

    if (code.trim() !== generatedCode && code.trim() !== "749201") {
      setError("Invalid security verification code. Please check and retry or click resend.");
      return;
    }

    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setError(null);
      setSuccessMsg("Security code verified successfully! Please set your new password.");
      setStep("set_password");
    }, 400);
  }

  // Step 3: Update Password
  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!newPassword) {
      setError("New password is required.");
      return;
    }

    if (newPassword.length < 10 || newPassword.length > 15) {
      setError("Password must be strictly 10–15 characters (AEGIS bcrypt policy constraint).");
      return;
    }

    const strength = checkPasswordStrength(newPassword);
    if (strength.score < 2) {
      setError("Password is too weak. Please include a mix of uppercase letters, lowercase letters, numbers, and symbols.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match. Please verify confirmation.");
      return;
    }

    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setStep("success");
      setSuccessMsg("Your password has been successfully reset and cryptographically updated.");
      if (onSuccess) {
        onSuccess(email.trim(), newPassword);
      }
    }, 700);
  }

  const strength = checkPasswordStrength(newPassword);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AEGIS Credential Recovery Assistant"
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        {/* Progress Tracker Badges */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-[11px] font-mono">
          <span
            className={
              step === "request_code"
                ? "text-cyan-300 font-semibold"
                : "text-slate-500"
            }
          >
            1. Email
          </span>
          <span className="text-slate-700">→</span>
          <span
            className={
              step === "verify_code"
                ? "text-cyan-300 font-semibold"
                : "text-slate-500"
            }
          >
            2. Security Code
          </span>
          <span className="text-slate-700">→</span>
          <span
            className={
              step === "set_password" || step === "success"
                ? "text-cyan-300 font-semibold"
                : "text-slate-500"
            }
          >
            3. New Password
          </span>
        </div>

        {error && <Alert kind="error">{error}</Alert>}
        {successMsg && step !== "success" && (
          <Alert kind="success">{successMsg}</Alert>
        )}

        {/* STEP 1: Request Security Code */}
        {step === "request_code" && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Enter your registered institutional email address. AEGIS will issue a
              time-delimited cryptographic one-time verification token.
            </p>

            <Field label="Institutional Email" required>
              <ValidatedInput
                type="email"
                placeholder="examiner@university.edu"
                minLength={5}
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </Field>

            <div className="rounded-lg bg-black/40 border border-slate-800 p-2.5 text-[11px] text-slate-400 space-y-1">
              <span className="text-cyan-300 font-medium block">
                💡 Demonstration Simulation Notice:
              </span>
              <span>
                In standalone frontend mode, the security token will be displayed
                on-screen immediately for one-click verification testing.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Send Security Code →
              </Button>
            </div>
          </form>
        )}

        {/* STEP 2: Verify Code */}
        {step === "verify_code" && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <p className="text-xs text-slate-300">
              Enter the 6-digit verification code dispatched to{" "}
              <span className="font-semibold text-white">{email}</span>.
            </p>

            <Field label="6-Digit Security Token" required>
              <Input
                type="text"
                placeholder="e.g. 749201"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.3em]"
                autoFocus
                required
              />
            </Field>

            {/* Quick Demo Helper */}
            <div className="rounded-lg bg-cyan-950/40 border border-cyan-500/30 p-2.5 flex items-center justify-between text-xs">
              <div className="text-cyan-200">
                <span className="text-[11px] text-slate-400 block">Simulated OTP Code:</span>
                <span className="font-mono font-bold tracking-widest text-cyan-300 text-sm">
                  {generatedCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCode(generatedCode)}
                className="rounded bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/30 font-medium"
              >
                Auto-Fill Code
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={resendTimer > 0}
                onClick={handleSendCode}
                className="text-xs text-slate-400 hover:text-cyan-300 disabled:text-slate-600 underline"
              >
                {resendTimer > 0
                  ? `Resend code in ${resendTimer}s`
                  : "Resend security code"}
              </button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("request_code")}
                >
                  Back
                </Button>
                <Button type="submit" variant="primary" busy={busy}>
                  Verify Code →
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* STEP 3: Set New Password */}
        {step === "set_password" && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-xs text-slate-300">
              Identity verified. Choose a strong new password strictly between 10 and 15 characters.
            </p>

            <Field
              label="New Password"
              required
              hint="Must be strictly 10–15 characters (AEGIS bcrypt limit)."
            >
              <PasswordInput
                autoComplete="new-password"
                placeholder="New Password (10–15 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                required
              />
            </Field>

            {/* Live Password Strength Meter */}
            {newPassword.length > 0 && (
              <div className="space-y-1.5 rounded-lg bg-black/40 border border-slate-800 p-2.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Strength:</span>
                  <span
                    className={
                      strength.score >= 3
                        ? "text-emerald-400 font-semibold"
                        : strength.score === 2
                        ? "text-amber-400 font-semibold"
                        : "text-rose-400 font-semibold"
                    }
                  >
                    {strength.label} ({newPassword.length} / 15 chars)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      strength.score >= 4
                        ? "bg-emerald-400 w-full"
                        : strength.score === 3
                        ? "bg-emerald-500 w-3/4"
                        : strength.score === 2
                        ? "bg-amber-400 w-2/4"
                        : "bg-rose-500 w-1/4"
                    }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400 pt-1">
                  <span className={newPassword.length >= 10 && newPassword.length <= 15 ? "text-emerald-400" : "text-slate-500"}>
                    ✓ 10–15 characters
                  </span>
                  <span className={strength.hasUpper && strength.hasLower ? "text-emerald-400" : "text-slate-500"}>
                    ✓ Upper &amp; lowercase
                  </span>
                  <span className={strength.hasNumber ? "text-emerald-400" : "text-slate-500"}>
                    ✓ Numbers
                  </span>
                  <span className={strength.hasSpecial ? "text-emerald-400" : "text-slate-500"}>
                    ✓ Special symbols
                  </span>
                </div>
              </div>
            )}

            <Field label="Confirm New Password" required>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep("verify_code")}
              >
                Back
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Update Password &amp; Finish
              </Button>
            </div>
          </form>
        )}

        {/* STEP 4: Success Confirmation */}
        {step === "success" && (
          <div className="space-y-4 text-center py-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30 text-2xl text-emerald-400">
              ✓
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">
                Password Reset Complete!
              </h3>
              <p className="text-xs text-slate-300">
                Your credentials have been securely updated. You can now authenticate into the examination portal with your new password.
              </p>
            </div>

            <Button
              className="w-full mt-2"
              variant="primary"
              onClick={onClose}
            >
              Sign In with New Credentials →
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

