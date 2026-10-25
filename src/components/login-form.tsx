"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/locale-provider";

export function LoginForm() {
  const { t } = useLocale();
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!username.trim() || !password) {
      setFeedback(t("requiredFieldsMessage"));
      return;
    }

    setFeedback(t("authNotConnected"));
  }

  const usernameInvalid = hasAttemptedSubmit && !username.trim();
  const passwordInvalid = hasAttemptedSubmit && !password;

  return (
    <main className="login-page min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="login-language"><LanguageToggle /></div>
      <section aria-labelledby="login-title" className="login-card">
        <div aria-hidden="true" className="login-brand-icon"><Icon name="store" size={24} /></div>
        <p className="login-product-name">{t("appName")}</p>
        <h1 className="login-title" id="login-title">{t("loginWelcome")}</h1>
        <p className="login-subtitle">{t("loginSubtitle")}</p>

        <div className="login-demo-notice" role="note">
          <strong>{t("demoData")}</strong>
          <span>{t("loginDemoNotice")}</span>
        </div>

        <form className="login-form" noValidate onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="username">{t("username")}</label>
            <input
              aria-describedby={usernameInvalid ? "login-feedback" : undefined}
              aria-invalid={usernameInvalid}
              autoComplete="username"
              id="username"
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("usernamePlaceholder")}
              required
              value={username}
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">{t("password")}</label>
            <div className="password-field">
              <input
                aria-describedby={passwordInvalid ? "login-feedback" : undefined}
                aria-invalid={passwordInvalid}
                autoComplete="current-password"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("passwordPlaceholder")}
                required
                type={passwordVisible ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={passwordVisible ? t("hidePassword") : t("showPassword")}
                aria-pressed={passwordVisible}
                className="password-visibility"
                onClick={() => setPasswordVisible((visible) => !visible)}
                type="button"
              >
                <Icon name={passwordVisible ? "eyeOff" : "eye"} size={17} />
              </button>
            </div>
          </div>

          {feedback ? <p aria-live="polite" className="login-feedback" id="login-feedback" role="alert">{feedback}</p> : null}
          <button className="primary-button login-button" type="submit">{t("signIn")}</button>
        </form>

        <div className="login-card-footer">
          <Link className="demo-link" href="/dashboard">
            {t("dashboardDemoLink")} <Icon name="arrow" size={15} />
          </Link>
          <p>{t("loginFooter")}</p>
        </div>
      </section>
      <p className="login-disclaimer">{t("demoRouteNotice")}</p>
    </main>
  );
}
