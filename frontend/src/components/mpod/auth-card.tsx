import type { FormEventHandler } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AuthCardProps = {
  className?: string;
  title?: string;
  usernameLabel?: string;
  usernamePlaceholder?: string;
  passwordLabel?: string;
  passwordPlaceholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  error?: string | null;
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

export function AuthCard({
  className,
  title = "Create your account",
  usernameLabel = "Username",
  usernamePlaceholder = "Choose a username",
  passwordLabel = "Password",
  passwordPlaceholder = "Create a password",
  submitLabel = "Create account",
  disabled,
  error,
  onSubmit,
}: AuthCardProps) {
  return (
    <Card
      className={cn(
        "w-full max-w-[430px] items-center justify-center gap-5 rounded-lg px-6 py-7 shadow-xs",
        className
      )}
    >
      <CardHeader className="w-full px-0">
        <CardTitle className="text-2xl leading-8 font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="w-full px-0">
        <form className="flex w-full flex-col gap-5" onSubmit={onSubmit}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="auth-username">{usernameLabel}</FieldLabel>
              <Input
                id="auth-username"
                name="username"
                autoComplete="username"
                placeholder={usernamePlaceholder}
                disabled={disabled}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="auth-password">{passwordLabel}</FieldLabel>
              <Input
                id="auth-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={passwordPlaceholder}
                disabled={disabled}
              />
            </Field>
          </FieldGroup>
          <Button className="h-10 w-full" type="submit" disabled={disabled}>
            {submitLabel}
          </Button>
          {error ? (
            <p className="text-sm leading-5 text-destructive">{error}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
