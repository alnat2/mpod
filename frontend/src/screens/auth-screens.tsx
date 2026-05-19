import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { AuthCard, AuthShell } from "@/components/mpod";
import { ApiError, api } from "@/lib/api";

type AuthScreenProps = {
  onAuthenticated?: () => void | Promise<void>;
};

function formValue(form: HTMLFormElement, key: string) {
  const value = new FormData(form).get(key);
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Request failed";
}

export function SetupScreen({ onAuthenticated }: AuthScreenProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const username = formValue(event.currentTarget, "username");
    const password = formValue(event.currentTarget, "password");

    try {
      await api.auth.register({
        username,
        password,
      });
      await onAuthenticated?.();
      navigate("/subscriptions", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell headline="Create the only account for your podcast library">
      <AuthCard
        title="Create your account"
        usernamePlaceholder="Choose a username"
        passwordPlaceholder="Create a password"
        submitLabel="Create account"
        disabled={submitting}
        error={error}
        onSubmit={handleSubmit}
      />
    </AuthShell>
  );
}

export function LoginScreen({ onAuthenticated }: AuthScreenProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const username = formValue(event.currentTarget, "username");
    const password = formValue(event.currentTarget, "password");

    try {
      await api.auth.login({ username, password });
      await onAuthenticated?.();
      navigate("/subscriptions", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell headline="Log in and keep listening">
      <AuthCard
        title="Log in"
        usernamePlaceholder="Enter your username"
        passwordPlaceholder="Enter your password"
        submitLabel="Log in"
        disabled={submitting}
        error={error}
        onSubmit={handleSubmit}
      />
    </AuthShell>
  );
}
