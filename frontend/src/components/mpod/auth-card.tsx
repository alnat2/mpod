import { useState, type FormEventHandler } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";

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
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card
      className={cn(
        "w-full max-w-[320px] items-center justify-center gap-4 rounded-[10px] px-4 py-5 shadow-xs md:max-w-[430px] md:gap-5 md:rounded-lg md:px-6 md:py-7",
        className
      )}
    >
      <CardHeader className="w-full px-0">
        <CardTitle className="text-2xl leading-8 font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="w-full px-0">
        <form className="flex w-full flex-col gap-4 md:gap-5" onSubmit={onSubmit}>
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
              <div className="relative">
                <Input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={passwordPlaceholder}
                  disabled={disabled}
                  className="pr-10"
                />
                <Button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1 size-6 -translate-y-1/2 rounded-md p-0"
                  variant="ghost"
                  type="button"
                  disabled={disabled}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <HugeiconsIcon
                    data-visible={showPassword}
                    data-testid="password-visibility-icon"
                    icon={showPassword ? ViewOffIcon : ViewIcon}
                    className="size-4 text-primary"
                    aria-hidden="true"
                  />
                </Button>
              </div>
            </Field>
          </FieldGroup>
          <Button className="h-10 w-full" type="submit" disabled={disabled}>
            {submitLabel}
          </Button>
          {error ? (
            <p
              className="text-sm leading-5 text-destructive"
              role="alert"
              aria-atomic="true"
            >
              {error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
