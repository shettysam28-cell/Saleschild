"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
export function ContactForm({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!enabled) {
      setStatus({
        error: true,
        message: "This preview can’t send messages yet. Your message has not been submitted.",
      });
      return;
    }
    const data = new FormData(form);
    if (data.get("bot-field")) {
      setStatus({ error: true, message: "We couldn’t submit this message. Please try again." });
      return;
    }
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(
          Array.from(data.entries()).map(([k, v]) => [k, String(v)]),
        ).toString(),
      });
      if (!response.ok) throw new Error();
      setStatus({
        error: false,
        message: "Your message was submitted. Thank you for getting in touch.",
      });
      form.reset();
    } catch {
      setStatus({
        error: true,
        message: "We couldn’t submit your message. Your text is still here—please try again later.",
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      name="saleschild-contact"
      className="m-contact-form"
      method="post"
      action="/__forms.html"
      data-netlify="true"
      data-netlify-honeypot="bot-field"
      onSubmit={submit}
    >
      <input type="hidden" name="form-name" value="saleschild-contact" />
      <p className="m-honeypot" aria-hidden="true">
        <label>
          Leave this blank
          <input name="bot-field" tabIndex={-1} autoComplete="off" />
        </label>
      </p>
      {!enabled && (
        <div className="m-contact-availability">
          This preview lets you explore the contact form. Sending is not enabled yet; nothing will
          be submitted.
        </div>
      )}
      <div className="m-contact-row">
        <label className="form-field">
          Your name
          <input name="name" required maxLength={100} autoComplete="name" placeholder="Your name" />
        </label>
        <label className="form-field">
          Work email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@organization.com"
          />
        </label>
      </div>
      <label className="form-field">
        Organization
        <input
          name="organization"
          maxLength={100}
          autoComplete="organization"
          placeholder="Your organization (optional)"
        />
      </label>
      <label className="form-field">
        What would you like to make possible?
        <textarea
          name="message"
          rows={6}
          required
          minLength={20}
          maxLength={4000}
          placeholder="Tell us a little about your team and what you’re looking for…"
        />
      </label>
      <label className="m-consent">
        <input type="checkbox" name="consent" value="yes" required />
        <span>
          I agree that Saleschild may use these details to respond to my inquiry, as described in
          the <Link href="/privacy">privacy notice</Link>.
        </span>
      </label>
      {status && (
        <div
          role={status.error ? "alert" : "status"}
          className="form-message"
          data-error={status.error}
        >
          {status.message}
        </div>
      )}
      <button className="button button-dark" disabled={pending}>
        {pending ? "Submitting…" : "Send your message"}
        <ArrowUpRight size={16} />
      </button>
    </form>
  );
}
